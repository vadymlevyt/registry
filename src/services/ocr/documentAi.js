// ── OCR PROVIDER: Google Document AI ────────────────────────────────────────
// Sync-обробка через :process endpoint у регіоні europe-west2.
// Ліміти: 15 сторінок і 20 МБ на запит. Для великих PDF — нарізка через pdf-lib.
//
// driveRequest вже додає Authorization: Bearer <token> з cloud-platform scope.
//
// Контракт результату (матриця виконавця):
//   { text, pageCount, pageStructure?, warnings }
//   pageStructure — масив сторінок Document AI з повною структурою
//   (paragraphs, blocks, tables, headers, footers, layout, dimension).
//   Кожна сторінка додатково має поле _text — витягнутий текст сторінки.
//   Це робить layout.json самодостатнім: textAnchor offset'и локальні
//   для свого чанка, але _text вже підставлений тут, споживач не возиться
//   з offset математикою при нарізаному PDF.

import { PDFDocument } from 'pdf-lib';
import { driveRequest } from '../driveAuth.js';

const DOC_AI_ENDPOINT =
  'https://europe-west2-documentai.googleapis.com/v1/projects/73468500916/locations/europe-west2/processors/2cc453e438078154:process';
const DOC_AI_PAGES_PER_REQUEST = 15;
const DOC_AI_MB_PER_REQUEST = 20;
const DOC_AI_TIMEOUT_MS = 120_000;

function makeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Витягнути текст сторінки з textAnchor.textSegments відносно chunkText.
// Document AI у textAnchor дає startIndex/endIndex у глобальному документі чанка.
// Робимо тут раз, щоб layout.json був самодостатнім — споживач не возиться
// з offset математикою коли pageStructure склеєний з кількох чанків.
function extractPageText(page, chunkText) {
  const segments = page?.layout?.textAnchor?.textSegments;
  if (!Array.isArray(segments) || !chunkText) return '';
  let out = '';
  for (const seg of segments) {
    const start = Number(seg.startIndex || 0);
    const end = Number(seg.endIndex || 0);
    if (end > start) out += chunkText.slice(start, end);
  }
  return out;
}

async function postToDocAi(bytes, mimeType, externalSignal) {
  const base64 = arrayBufferToBase64(bytes);
  const body = JSON.stringify({
    rawDocument: { content: base64, mimeType },
  });

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (externalSignal) externalSignal.addEventListener('abort', onAbort);
  const timeout = setTimeout(() => ctrl.abort(), DOC_AI_TIMEOUT_MS);

  let resp;
  try {
    resp = await driveRequest(DOC_AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw makeError('TIMEOUT', 'Document AI таймаут');
    }
    throw makeError('UNKNOWN', `Document AI fetch: ${e.message}`);
  } finally {
    clearTimeout(timeout);
    if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
  }

  if (resp.status === 401 || resp.status === 403) {
    throw makeError('AUTH', 'Помилка авторизації Document AI');
  }
  if (resp.status === 429) {
    throw makeError('QUOTA', 'Document AI rate limit');
  }
  if (resp.status === 400) {
    let msg = 'Document AI 400';
    try {
      const data = await resp.json();
      if (data?.error?.message) msg = data.error.message;
    } catch (e) {}
    throw makeError('UNSUPPORTED', msg);
  }
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw makeError('UNKNOWN', `Document AI ${resp.status}: ${t.slice(0, 300)}`);
  }

  const data = await resp.json();
  const text = data?.document?.text || '';
  const pages = Array.isArray(data?.document?.pages) ? data.document.pages : [];
  // Додаємо _text на кожну сторінку — витягнутий через textSegments.
  // Залишаємо весь оригінальний об'єкт сторінки як є (paragraphs, blocks,
  // tables, layout, dimension, formFields, tokens, symbols тощо).
  const pageStructure = pages.map((p) => ({
    ...p,
    _text: extractPageText(p, text),
  }));
  return { text, pageCount: pageStructure.length, pageStructure };
}

export default {
  name: 'documentAi',

  canHandle(file) {
    if (!file) return false;
    return (
      file.mimeType === 'application/pdf' ||
      (file.mimeType?.startsWith('image/'))
    );
  },

  async extract(file, options = {}) {
    // 1. Завантажити байти
    const dl = await driveRequest(
      `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`
    );
    if (dl.status === 401 || dl.status === 403) {
      throw makeError('AUTH', `Drive download auth ${dl.status}`);
    }
    if (!dl.ok) throw makeError('UNKNOWN', `Drive download ${dl.status}`);
    const arrayBuffer = await dl.arrayBuffer();

    const isPdf =
      file.mimeType === 'application/pdf' ||
      file.name?.toLowerCase().endsWith('.pdf');

    // 2. ZIP-сигнатура (PDF з ЄСІТС)
    if (isPdf) {
      const head = new Uint8Array(arrayBuffer.slice(0, 4));
      if (head[0] === 0x50 && head[1] === 0x4B && head[2] === 0x03 && head[3] === 0x04) {
        throw makeError('UNSUPPORTED', 'ZIP замаскований під PDF (ЄСІТС)');
      }
    }

    // 3. Розмір
    if (arrayBuffer.byteLength > DOC_AI_MB_PER_REQUEST * 1024 * 1024) {
      throw makeError('UNSUPPORTED', `Файл більший за ${DOC_AI_MB_PER_REQUEST} МБ`);
    }

    const warnings = [];
    const mimeForDocAi = isPdf ? 'application/pdf' : file.mimeType;

    // 4. Картинка → один запит
    if (!isPdf) {
      const { text, pageCount, pageStructure } = await postToDocAi(arrayBuffer, mimeForDocAi, options.signal);
      return { text, pageCount: pageCount || 1, pageStructure, warnings };
    }

    // 5. PDF — підрахувати сторінки
    let pdfDoc;
    try {
      pdfDoc = await PDFDocument.load(arrayBuffer);
    } catch (e) {
      throw makeError('UNSUPPORTED', `pdf-lib load: ${e.message}`);
    }
    const pageCount = pdfDoc.getPageCount();

    if (pageCount <= DOC_AI_PAGES_PER_REQUEST) {
      const result = await postToDocAi(arrayBuffer, mimeForDocAi, options.signal);
      return {
        text: result.text,
        pageCount: result.pageCount || pageCount,
        pageStructure: result.pageStructure,
        warnings,
      };
    }

    // 6. Великий PDF — нарізка по 15 сторінок. pageNumber у кожному чанку
    // починається з 1 — переіндексовуємо у глобальні позиції. _text вже
    // підставлений у postToDocAi (локально для чанка), тому склейка
    // pageStructure безпечна — offset'и більше не потрібні.
    warnings.push(`PDF на ${pageCount} стор. — нарізаємо на чанки по ${DOC_AI_PAGES_PER_REQUEST}`);
    const textChunks = [];
    const pageStructureAll = [];
    let totalPages = 0;
    let globalPageOffset = 0;

    for (let start = 0; start < pageCount; start += DOC_AI_PAGES_PER_REQUEST) {
      const end = Math.min(start + DOC_AI_PAGES_PER_REQUEST, pageCount);
      const chunkDoc = await PDFDocument.create();
      const indices = [];
      for (let i = start; i < end; i++) indices.push(i);
      const pages = await chunkDoc.copyPages(pdfDoc, indices);
      pages.forEach((p) => chunkDoc.addPage(p));
      const chunkBytes = await chunkDoc.save();

      // Перевірка розміру чанка (на випадок дуже жирних сторінок)
      if (chunkBytes.byteLength > DOC_AI_MB_PER_REQUEST * 1024 * 1024) {
        throw makeError(
          'UNSUPPORTED',
          `Чанк сторінок ${start + 1}-${end} більший за ${DOC_AI_MB_PER_REQUEST} МБ`
        );
      }

      const result = await postToDocAi(chunkBytes.buffer, mimeForDocAi, options.signal);
      textChunks.push(result.text);
      // Переіндексуємо pageNumber у глобальний.
      for (const page of (result.pageStructure || [])) {
        const localNumber = Number(page.pageNumber || 0);
        pageStructureAll.push({
          ...page,
          pageNumber: globalPageOffset + (localNumber || 1),
        });
      }
      totalPages += result.pageCount || (end - start);
      globalPageOffset += (end - start);
    }

    const text = textChunks.join('\n\n--- Page break ---\n\n');
    return {
      text,
      pageCount: totalPages || pageCount,
      pageStructure: pageStructureAll.length > 0 ? pageStructureAll : undefined,
      warnings,
    };
  },
};
