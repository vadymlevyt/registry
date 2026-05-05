// ── OCR PROVIDER: Claude Vision (фолбек) ───────────────────────────────────
// Перенесена логіка з CaseDossier:438-450 + 530-540.
// Кожна сторінка PDF → PNG через canvas → image_block в Anthropic API.
// БЕЗ обмеження min(numPages, 5) — обробляються ВСІ сторінки.
//
// Контракт провайдера — див. TASK.md розділ 2.3.

import * as pdfjsLib from 'pdfjs-dist';
import { driveRequest } from '../driveAuth.js';
import { logAiUsageViaSink } from '../aiUsageService.js';
import { resolveModel } from '../modelResolver.js';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MAX_TOKENS = 8192;
const LARGE_PDF_THRESHOLD = 20;

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

export default {
  name: 'claudeVision',

  canHandle(file) {
    if (!file) return false;
    return (
      file.mimeType === 'application/pdf' ||
      (file.mimeType?.startsWith('image/'))
    );
  },

  async extract(file, options = {}) {
    const apiKey = options.apiKey || (typeof localStorage !== 'undefined' ? localStorage.getItem('claude_api_key') : null);
    if (!apiKey) throw makeError('AUTH', 'Немає API ключа Claude');

    // 1. Завантажити байти з Drive
    const dl = await driveRequest(
      `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`
    );
    if (dl.status === 401 || dl.status === 403) {
      throw makeError('AUTH', `Drive download auth ${dl.status}`);
    }
    if (!dl.ok) throw makeError('UNKNOWN', `Drive download ${dl.status}`);
    const arrayBuffer = await dl.arrayBuffer();

    const warnings = [];
    const images = [];
    let pages = 1;
    let mediaType = 'image/png';

    const isPdf =
      file.mimeType === 'application/pdf' ||
      file.name?.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      // ZIP-PDF (ЄСІТС) → невідправляємо, бо pdfjs все одно не відкриє
      const head = new Uint8Array(arrayBuffer.slice(0, 4));
      if (head[0] === 0x50 && head[1] === 0x4B && head[2] === 0x03 && head[3] === 0x04) {
        throw makeError('UNSUPPORTED', 'ZIP замаскований під PDF (ЄСІТС)');
      }

      let pdf;
      try {
        pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
      } catch (e) {
        throw makeError('UNKNOWN', `pdfjs.getDocument: ${e.message}`);
      }
      pages = pdf.numPages;
      if (pages > LARGE_PDF_THRESHOLD) {
        warnings.push(`Дуже великий PDF (${pages} стор.) — обробка може бути повільною і дорогою`);
      }

      for (let i = 1; i <= pages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        images.push(canvas.toDataURL('image/png').split(',')[1]);
      }
      mediaType = 'image/png';
    } else if (file.mimeType?.startsWith('image/')) {
      images.push(arrayBufferToBase64(arrayBuffer));
      mediaType = file.mimeType;
      pages = 1;
    } else {
      throw makeError('UNSUPPORTED', `claudeVision: ${file.mimeType}`);
    }

    // 2. Сформувати content масив для Anthropic API
    const content = images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: img },
    }));
    content.push({
      type: 'text',
      text: 'Витягни весь текст з цих сторінок документа. Поверни ТІЛЬКИ текст, без коментарів, без вступів, без розмітки.',
    });

    // 3. Виклик Anthropic API
    const visionModel = resolveModel('documentParserVision');
    let resp;
    try {
      resp = await fetch(ANTHROPIC_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: visionModel,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content }],
        }),
        signal: options.signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') throw makeError('TIMEOUT', 'Anthropic abort');
      throw makeError('UNKNOWN', `Anthropic fetch: ${e.message}`);
    }

    if (resp.status === 401 || resp.status === 403) {
      throw makeError('AUTH', 'Anthropic auth (перевір API ключ)');
    }
    if (resp.status === 429) {
      throw makeError('QUOTA', 'Anthropic rate limit');
    }
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      throw makeError('UNKNOWN', `Anthropic ${resp.status}: ${t.slice(0, 300)}`);
    }

    const data = await resp.json();
    try {
      logAiUsageViaSink({
        agentType: 'document_parser',
        model: visionModel,
        inputTokens: data?.usage?.input_tokens,
        outputTokens: data?.usage?.output_tokens,
        context: {
          caseId: options.caseId || null,
          module: 'DocumentProcessor',
          operation: 'parse_document',
        },
      }, options.aiUsageSink);
    } catch {}
    const text = data?.content?.[0]?.text || '';
    return { text: text.trim(), pages, warnings };
  },
};
