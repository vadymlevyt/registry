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
//
// КЛАСИФІКАЦІЯ ПОМИЛОК і RETRY (мікро-TASK fix error handling):
//   • NETWORK — таймаут / fetch обірваний / 5xx / абортнутий запит без явної
//     причини. Повторювана: 3 спроби з backoff 1s/3s/9s.
//   • AUTH — 401/403, без retry, fallback не допоможе.
//   • QUOTA — 429, без retry (адвокату показати "ліміт").
//   • UNSUPPORTED — 400 від Document AI або наш guard (ZIP-PDF, >20МБ).
//     Без retry — повторна спроба не змінить вердикт.
//   • UNKNOWN — за замовчуванням ставимо як NETWORK (краще зайвий retry
//     ніж тиха ескалація на claudeVision при моргнутій мережі).
//
// RESUMABILITY (мікро-TASK fix):
//   Великий PDF нарізається на чанки по 15 сторінок. Після кожного успішного
//   чанка стан зберігається в resumeStore (keyed by file.id). Якщо
//   ВСЕ ще після 3 retry чанк падає на NETWORK — стан остається у store,
//   а викидається помилка з code=NETWORK, partial=true, processedPages.
//   Наступний виклик extract() читає resumeStore і продовжує з першого
//   необробленого чанка. Споживач (ocrService) сам вирішує що з цим робити —
//   показати діалог з вибором claudeVision або просто залишити state до
//   наступного Перерозпізнати.

import { PDFDocument } from 'pdf-lib';
import { driveRequest } from '../driveAuth.js';
import { getResume, setResume, clearResume, processedPageCount } from './resumeStore.js';

const DOC_AI_ENDPOINT =
  'https://europe-west2-documentai.googleapis.com/v1/projects/73468500916/locations/europe-west2/processors/2cc453e438078154:process';
const DOC_AI_PAGES_PER_REQUEST = 15;
const DOC_AI_MB_PER_REQUEST = 20;
const DOC_AI_TIMEOUT_MS = 120_000;

// RETRY константи для NETWORK/UNKNOWN. 3 спроби, exponential backoff.
// Перша спроба негайно, далі 1s/3s/9s — total worst-case 13s + 3×timeout.
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [1000, 3000, 9000];

function makeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// Класифікація помилки за повідомленням / типом / HTTP статусом.
// Один сенс: «це повторювана NETWORK помилка чи ні». Один із 4 кодів.
export function classifyError(e, httpStatus) {
  // 1. Явні HTTP статуси (винесено вище для пріоритету над текстом)
  if (httpStatus === 401 || httpStatus === 403) return 'AUTH';
  if (httpStatus === 429) return 'QUOTA';
  if (httpStatus === 400) return 'UNSUPPORTED';
  if (httpStatus && httpStatus >= 500 && httpStatus < 600) return 'NETWORK';

  // 2. Якщо помилка вже має .code — довіряємо
  if (e && e.code) {
    const c = e.code;
    if (c === 'AUTH' || c === 'QUOTA' || c === 'UNSUPPORTED') return c;
    if (c === 'TIMEOUT' || c === 'NETWORK') return 'NETWORK';
    if (c === 'UNKNOWN') return 'NETWORK'; // unknown → краще retry
  }

  // 3. AbortError → таймаут наш або обірваний адвокатом
  if (e?.name === 'AbortError') return 'NETWORK';

  // 4. Сигнатури мережевих помилок у повідомленні
  const msg = (e?.message || String(e || '')).toLowerCase();
  if (
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('fetch') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound') ||
    msg.includes('econnrefused') ||
    msg.includes('failed to fetch') ||
    msg.includes('load failed') ||           // Safari/iOS варіант failed to fetch
    msg.includes('the operation was aborted')
  ) {
    return 'NETWORK';
  }

  // 5. За замовчуванням — NETWORK (краще retry ніж тиха ескалація).
  return 'NETWORK';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Запускає async fn з retry для NETWORK помилок. AUTH/QUOTA/UNSUPPORTED
// викидаються негайно. onRetry викликається перед кожною повторною спробою
// (attempt — 1-based номер тієї спроби яка зараз буде запущена, починаючи з 2).
async function executeWithRetry(fn, { onRetry, signal } = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) {
      throw makeError('NETWORK', 'aborted by caller');
    }
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      const code = e.code || classifyError(e);
      if (code !== 'NETWORK') throw e; // фінальні помилки — кидаємо одразу
      if (attempt >= RETRY_MAX_ATTEMPTS) break;
      const backoff = RETRY_BACKOFF_MS[attempt - 1] || 9000;
      try { onRetry && onRetry({ attempt: attempt + 1, of: RETRY_MAX_ATTEMPTS, error: e, backoffMs: backoff }); } catch {}
      await sleep(backoff);
    }
  }
  // Усі спроби вичерпані — кидаємо останню NETWORK помилку
  if (!lastErr.code) lastErr.code = 'NETWORK';
  throw lastErr;
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
      throw makeError('NETWORK', 'Document AI таймаут');
    }
    throw makeError('NETWORK', `Document AI fetch: ${e.message}`);
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
  if (resp.status >= 500 && resp.status < 600) {
    const t = await resp.text().catch(() => '');
    throw makeError('NETWORK', `Document AI ${resp.status}: ${t.slice(0, 300)}`);
  }
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw makeError('NETWORK', `Document AI ${resp.status}: ${t.slice(0, 300)}`);
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

// Виклик postToDocAi з retry. options.onRetry піднімається з extract().
async function postToDocAiWithRetry(bytes, mimeType, options) {
  return executeWithRetry(
    () => postToDocAi(bytes, mimeType, options.signal),
    { onRetry: options.onRetry, signal: options.signal }
  );
}

// Кидає помилку з partial state — споживач може показати діалог.
// e.code='NETWORK', e.partial=true, e.processedPages, e.totalPages.
function makePartialError(message, state) {
  const err = new Error(message);
  err.code = 'NETWORK';
  err.partial = true;
  err.totalPages = state.totalPages || 0;
  err.processedPages = processedPageCount(state);
  err.lastFailedRange = state.lastFailedRange;
  return err;
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
    // 1. Завантажити байти.
    //
    // file.localBlob — Blob/File у пам'яті (multi-image merge pipeline:
    // адвокат щойно вибрав з пристрою, файл ще не на Drive). Читаємо з нього
    // напряму, без виклику Drive API. Без цієї гілки OCR падав би 404 на
    // фейковому id 'local_<rand>' і pipeline продовжував з порожнім text.
    let arrayBuffer;
    if (file.localBlob instanceof Blob) {
      try {
        arrayBuffer = await file.localBlob.arrayBuffer();
      } catch (e) {
        throw makeError('NETWORK', `localBlob.arrayBuffer: ${e?.message || e}`);
      }
    } else {
      const dl = await driveRequest(
        `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`
      );
      if (dl.status === 401 || dl.status === 403) {
        throw makeError('AUTH', `Drive download auth ${dl.status}`);
      }
      if (!dl.ok) throw makeError('NETWORK', `Drive download ${dl.status}`);
      arrayBuffer = await dl.arrayBuffer();
    }

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

    // 4. Картинка → один запит з retry. Resume не застосовується (1 сторінка).
    if (!isPdf) {
      const { text, pageCount, pageStructure } = await postToDocAiWithRetry(
        arrayBuffer, mimeForDocAi, options
      );
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

    // 6. Малий PDF (вкладається в один запит) — теж з retry, без resume.
    if (pageCount <= DOC_AI_PAGES_PER_REQUEST) {
      const result = await postToDocAiWithRetry(arrayBuffer, mimeForDocAi, options);
      return {
        text: result.text,
        pageCount: result.pageCount || pageCount,
        pageStructure: result.pageStructure,
        warnings,
      };
    }

    // 7. Великий PDF — нарізка по 15 сторінок з resume.
    warnings.push(`PDF на ${pageCount} стор. — нарізаємо на чанки по ${DOC_AI_PAGES_PER_REQUEST}`);

    // Ініціалізація state з resumeStore (якщо це повторна спроба) або з нуля.
    const prevState = getResume(file.id);
    const state = (prevState && prevState.totalPages === pageCount)
      ? { ...prevState }
      : {
          driveId: file.id,
          totalPages: pageCount,
          processedRanges: [],
          textChunks: [],
          pageStructureAll: [],
          warnings,
          lastFailedRange: null,
          lastError: null,
          provider: 'documentAi',
        };

    // Якщо є попередній стан з іншим pageCount (файл змінився) — починаємо з нуля
    if (prevState && prevState.totalPages !== pageCount) {
      clearResume(file.id);
    }

    // Множина «оброблено» для швидкого перевіряння (1-based startPage)
    const isRangeProcessed = (startPage) =>
      state.processedRanges.some((r) => r.startPage === startPage);

    for (let start = 0; start < pageCount; start += DOC_AI_PAGES_PER_REQUEST) {
      const end = Math.min(start + DOC_AI_PAGES_PER_REQUEST, pageCount);
      const startPage1 = start + 1;       // 1-based для зовнішнього звіту
      const endPage1 = end;

      if (isRangeProcessed(startPage1)) {
        // Цей чанк уже оброблено в попередній спробі — пропускаємо.
        continue;
      }

      // Підготувати байти чанка (це може кинути pdf-lib помилку — UNSUPPORTED)
      let chunkBytes;
      try {
        const chunkDoc = await PDFDocument.create();
        const indices = [];
        for (let i = start; i < end; i++) indices.push(i);
        const pages = await chunkDoc.copyPages(pdfDoc, indices);
        pages.forEach((p) => chunkDoc.addPage(p));
        const saved = await chunkDoc.save();
        chunkBytes = saved.buffer;
      } catch (e) {
        // Зберегти стан і вийти
        state.lastFailedRange = { startPage: startPage1, endPage: endPage1 };
        state.lastError = { code: 'UNSUPPORTED', message: e.message };
        setResume(file.id, state);
        throw makeError('UNSUPPORTED', `pdf-lib chunk ${startPage1}-${endPage1}: ${e.message}`);
      }

      // Перевірка розміру чанка (на випадок дуже жирних сторінок)
      if (chunkBytes.byteLength > DOC_AI_MB_PER_REQUEST * 1024 * 1024) {
        state.lastFailedRange = { startPage: startPage1, endPage: endPage1 };
        state.lastError = { code: 'UNSUPPORTED', message: 'chunk > 20MB' };
        setResume(file.id, state);
        throw makeError(
          'UNSUPPORTED',
          `Чанк сторінок ${startPage1}-${endPage1} більший за ${DOC_AI_MB_PER_REQUEST} МБ`
        );
      }

      // Виклик з retry. options.onRetry передає toast наверх.
      // options.onChunkStart дозволяє показати "Обробка сторінок N-M..."
      try { options.onChunkStart && options.onChunkStart({ startPage: startPage1, endPage: endPage1, totalPages: pageCount, processedPages: processedPageCount(state) }); } catch {}

      let result;
      try {
        result = await postToDocAiWithRetry(chunkBytes, mimeForDocAi, options);
      } catch (e) {
        // Спроби вичерпані. AUTH/QUOTA/UNSUPPORTED — без resume сенсу.
        // NETWORK — зберігаємо state і кидаємо partial помилку.
        const code = e.code || classifyError(e);
        if (code === 'NETWORK') {
          state.lastFailedRange = { startPage: startPage1, endPage: endPage1 };
          state.lastError = { code: 'NETWORK', message: e.message };
          setResume(file.id, state);
          throw makePartialError(
            `Document AI: вичерпано retry на сторінках ${startPage1}-${endPage1}`,
            state
          );
        }
        // Для AUTH/QUOTA/UNSUPPORTED — кеш стану непотрібен, чистимо
        clearResume(file.id);
        throw e;
      }

      // Успіх чанка — додаємо до state
      state.processedRanges.push({ startPage: startPage1, endPage: endPage1 });
      state.textChunks.push({ startPage: startPage1, endPage: endPage1, text: result.text || '' });
      // Переіндексуємо pageNumber у глобальний.
      for (const page of (result.pageStructure || [])) {
        const localNumber = Number(page.pageNumber || 0);
        state.pageStructureAll.push({
          ...page,
          pageNumber: start + (localNumber || 1),
        });
      }
      state.lastFailedRange = null;
      state.lastError = null;
      setResume(file.id, state);

      try { options.onChunkDone && options.onChunkDone({ startPage: startPage1, endPage: endPage1, totalPages: pageCount, processedPages: processedPageCount(state) }); } catch {}
    }

    // 8. Усе оброблено — склеюємо результат і чистимо resumeStore
    // Сортуємо textChunks за startPage щоб resume в довільному порядку
    // не зламав текст (Document AI йде послідовно зараз, але claudeVision
    // fallback може додати з середини).
    const sortedTextChunks = [...state.textChunks].sort((a, b) => a.startPage - b.startPage);
    const sortedPages = [...state.pageStructureAll].sort(
      (a, b) => (a.pageNumber || 0) - (b.pageNumber || 0)
    );
    const text = sortedTextChunks.map((c) => c.text).join('\n\n--- Page break ---\n\n');

    clearResume(file.id);

    return {
      text,
      pageCount: pageCount,
      pageStructure: sortedPages.length > 0 ? sortedPages : undefined,
      warnings,
    };
  },
};
