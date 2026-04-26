// ── OCR PROVIDER: pdfjs локально ────────────────────────────────────────────
// Витягує текстовий шар PDF + експорт Google Docs + читання text/markdown.
// Worker pdfjs ініціалізується в App.jsx (GlobalWorkerOptions) — модуль
// модульного рівня, тому тут просто імпортуємо pdfjsLib.
//
// Контракт провайдера — див. TASK.md розділ 2.3.

import * as pdfjsLib from 'pdfjs-dist';
import { driveRequest } from '../driveAuth.js';

function makeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export default {
  name: 'pdfjsLocal',

  canHandle(file) {
    if (!file) return false;
    if (file.mimeType === 'application/pdf') return true;
    if (file.mimeType === 'application/vnd.google-apps.document') return true;
    if (file.mimeType === 'text/plain') return true;
    if (file.mimeType === 'text/markdown') return true;
    if (file.mimeType === 'text/html') return true;
    if (file.mimeType === 'application/xhtml+xml') return true;
    const lname = file.name?.toLowerCase() || '';
    if (lname.endsWith('.txt')) return true;
    if (lname.endsWith('.md')) return true;
    if (lname.endsWith('.html')) return true;
    if (lname.endsWith('.htm')) return true;
    return false;
  },

  async extract(file /*, options */) {
    // 1. Google Doc → export text/plain
    if (file.mimeType === 'application/vnd.google-apps.document') {
      const resp = await driveRequest(
        `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`
      );
      if (resp.status === 401 || resp.status === 403) {
        throw makeError('AUTH', `Drive export auth ${resp.status}`);
      }
      if (!resp.ok) throw makeError('UNKNOWN', `Drive export ${resp.status}`);
      const text = await resp.text();
      return { text: text.trim(), pages: 1, warnings: [] };
    }

    // 2. Завантажити байти
    const dl = await driveRequest(
      `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`
    );
    if (dl.status === 401 || dl.status === 403) {
      throw makeError('AUTH', `Drive download auth ${dl.status}`);
    }
    if (!dl.ok) throw makeError('UNKNOWN', `Drive download ${dl.status}`);
    const arrayBuffer = await dl.arrayBuffer();

    const lname = (file.name || '').toLowerCase();
    const isText =
      file.mimeType === 'text/plain' ||
      file.mimeType === 'text/markdown' ||
      lname.endsWith('.txt') ||
      lname.endsWith('.md');

    // 3. Текстові формати
    if (isText) {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer);
      return { text: text.trim().slice(0, 500000), pages: 1, warnings: [] };
    }

    // 4. HTML / XHTML (ухвали з ЄСІТС приходять у text/html, часто у
    //    windows-1251 без явного <meta charset>). Має йти ПЕРЕД PDF
    //    блоком — HTML потребує спеціальної обробки (DOMParser +
    //    автодетекція кодування), яку plain text не дає.
    const isHtml =
      file.mimeType === 'text/html' ||
      file.mimeType === 'application/xhtml+xml' ||
      lname.endsWith('.html') ||
      lname.endsWith('.htm');

    if (isHtml) {
      // 4.1. Детекція кодування
      const head = new TextDecoder('latin1').decode(arrayBuffer.slice(0, 4096));
      const csMatch = head.match(/charset\s*=\s*["']?([^"'\s>]+)/i);

      let encoding = 'utf-8';
      if (csMatch) {
        const cs = csMatch[1].toLowerCase().replace(/['"]/g, '');
        encoding = (cs === 'cp1251' || cs === 'win-1251') ? 'windows-1251' : cs;
      } else {
        // Немає <meta charset> — пробуємо UTF-8, fallback на windows-1251.
        // Понад 1% replacement chars (U+FFFD) = вочевидь не UTF-8.
        const utf8Test = new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer);
        const replacements = (utf8Test.match(/�/g) || []).length;
        if (replacements > utf8Test.length * 0.01) {
          encoding = 'windows-1251';
        }
      }

      // 4.2. Декодування з фолбеком
      let html;
      try {
        html = new TextDecoder(encoding, { fatal: false }).decode(arrayBuffer);
      } catch (e) {
        html = new TextDecoder('windows-1251', { fatal: false }).decode(arrayBuffer);
        encoding = 'windows-1251';
      }

      // 4.3. Парсинг через нативний DOMParser
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('script, style').forEach((el) => el.remove());
      const text = (doc.body?.innerText || doc.documentElement?.textContent || '').trim();

      return {
        text: text.slice(0, 500000),
        pages: 1,
        warnings: encoding === 'windows-1251' ? ['HTML декодовано як windows-1251'] : [],
      };
    }

    const isPdf =
      file.mimeType === 'application/pdf' || lname.endsWith('.pdf');

    if (!isPdf) {
      throw makeError('UNSUPPORTED', `Формат не підтримується pdfjsLocal: ${file.mimeType}`);
    }

    // 4. PDF: перевірка ZIP-сигнатури (PK\x03\x04) — ЄСІТС
    const head = new Uint8Array(arrayBuffer.slice(0, 4));
    if (head[0] === 0x50 && head[1] === 0x4B && head[2] === 0x03 && head[3] === 0x04) {
      throw makeError('UNSUPPORTED', 'ZIP замаскований під PDF (ЄСІТС) — розпакування не підтримується');
    }

    // 5. Витягнути текстовий шар з УСІХ сторінок
    let pdf;
    try {
      pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    } catch (e) {
      throw makeError('UNKNOWN', `pdfjs.getDocument: ${e.message}`);
    }

    const numPages = pdf.numPages;
    let fullText = '';
    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      fullText += content.items.map((it) => it.str).join(' ') + '\n';
    }

    const trimmed = fullText.trim();
    const avgChars = numPages > 0 ? trimmed.length / numPages : 0;
    const minLength = 200 * Math.min(3, numPages);
    if (avgChars < 200 || trimmed.length < minLength) {
      throw makeError('UNSUPPORTED', 'PDF без текстового шару (скан) — потрібен OCR');
    }

    return { text: trimmed, pages: numPages, warnings: [] };
  },
};
