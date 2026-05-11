// Юніт-тести retry / класифікації помилок / resumable state для documentAi.
//
// Покриваємо:
//   • classifyError — NETWORK vs AUTH vs QUOTA vs UNSUPPORTED розпізнавання
//   • executeWithRetry — 1/2/3 спроби (успіх / усі провалились)
//   • resumable state — partial state зберігається у resumeStore, наступний
//     виклик extract() продовжує з наступного чанка
//
// pdf-lib мокаємо мінімально: підставляємо фіктивний PDFDocument з потрібним
// pageCount. driveRequest мокаємо для контролю над HTTP відповідями
// Document AI.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── pdf-lib мок ─────────────────────────────────────────────────────────────
let fakePageCount = 0;
let chunkSaveBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

vi.mock('pdf-lib', () => ({
  PDFDocument: {
    load: vi.fn(async () => ({
      getPageCount: () => fakePageCount,
    })),
    create: vi.fn(async () => ({
      copyPages: vi.fn(async (_doc, indices) => indices.map(() => ({}))),
      addPage: vi.fn(),
      save: vi.fn(async () => chunkSaveBytes),
    })),
  },
}));

// ── driveRequest мок ───────────────────────────────────────────────────────
// Стратегія:
//   • GET /files/<id>?alt=media → 200 + ArrayBuffer (4 байти "%PDF")
//   • POST :process → керується через mockResponses[] (FIFO)
const mockResponses = [];

function pushResponse(spec) {
  mockResponses.push(spec);
}

vi.mock('../../src/services/driveAuth.js', () => ({
  driveRequest: vi.fn(async (url, opts = {}) => {
    if (url.includes('?alt=media')) {
      const ab = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x35]).buffer;
      return new Response(ab, { status: 200 });
    }
    if (url.includes(':process')) {
      const next = mockResponses.shift();
      if (!next) {
        return new Response(JSON.stringify({ document: { text: 'default', pages: [{ pageNumber: 1 }] } }), { status: 200 });
      }
      if (next.throw) {
        const err = new Error(next.throw.message || 'fetch throw');
        if (next.throw.name) err.name = next.throw.name;
        throw err;
      }
      if (next.body && typeof next.body === 'object') {
        return new Response(JSON.stringify(next.body), { status: next.status || 200 });
      }
      return new Response(next.body || '', { status: next.status || 200 });
    }
    return new Response('', { status: 404 });
  }),
}));

// Імпорти ПІСЛЯ моків
const documentAi = (await import('../../src/services/ocr/documentAi.js')).default;
const { classifyError } = await import('../../src/services/ocr/documentAi.js');
const resumeStore = await import('../../src/services/ocr/resumeStore.js');

// Прискорюємо тести — підмінюємо setTimeout щоб backoff не блокував
vi.useFakeTimers();

beforeEach(() => {
  mockResponses.length = 0;
  fakePageCount = 0;
  resumeStore._clearAllForTests();
  vi.clearAllTimers();
});

function fileFixture(overrides = {}) {
  return {
    id: 'drive_file_X',
    name: 'doc.pdf',
    mimeType: 'application/pdf',
    ...overrides,
  };
}

// Запускає extract з автоматичним advance таймерів (для backoff).
// Приймає factory (не promise) — щоб handler приєднався синхронно до
// створення promise і не було unhandled rejection до прокрутки таймерів.
async function runWithAdvancedTimers(factory) {
  let result = { ok: false, value: undefined, err: undefined };
  let done = false;
  const p = factory();
  p.then(
    (v) => { result = { ok: true, value: v }; done = true; },
    (e) => { result = { ok: false, err: e }; done = true; }
  );
  for (let i = 0; i < 50 && !done; i++) {
    await Promise.resolve();
    await vi.runAllTimersAsync();
  }
  if (result.ok) return result.value;
  throw result.err;
}

describe('classifyError', () => {
  it('AUTH для 401/403', () => {
    expect(classifyError(new Error('x'), 401)).toBe('AUTH');
    expect(classifyError(new Error('x'), 403)).toBe('AUTH');
  });

  it('QUOTA для 429', () => {
    expect(classifyError(new Error('x'), 429)).toBe('QUOTA');
  });

  it('UNSUPPORTED для 400', () => {
    expect(classifyError(new Error('x'), 400)).toBe('UNSUPPORTED');
  });

  it('NETWORK для 5xx (500/502/503/504)', () => {
    expect(classifyError(new Error('x'), 500)).toBe('NETWORK');
    expect(classifyError(new Error('x'), 502)).toBe('NETWORK');
    expect(classifyError(new Error('x'), 503)).toBe('NETWORK');
    expect(classifyError(new Error('x'), 504)).toBe('NETWORK');
  });

  it('NETWORK для AbortError (таймаут)', () => {
    const e = new Error('aborted');
    e.name = 'AbortError';
    expect(classifyError(e)).toBe('NETWORK');
  });

  it('NETWORK для "failed to fetch" / "load failed"', () => {
    expect(classifyError(new Error('Failed to fetch'))).toBe('NETWORK');
    expect(classifyError(new Error('Load failed'))).toBe('NETWORK');
    expect(classifyError(new Error('network timeout'))).toBe('NETWORK');
    expect(classifyError(new Error('ECONNRESET'))).toBe('NETWORK');
    expect(classifyError(new Error('ENOTFOUND host'))).toBe('NETWORK');
    expect(classifyError(new Error('ECONNREFUSED'))).toBe('NETWORK');
  });

  it('зберігає явні .code AUTH/QUOTA/UNSUPPORTED', () => {
    expect(classifyError(Object.assign(new Error('x'), { code: 'AUTH' }))).toBe('AUTH');
    expect(classifyError(Object.assign(new Error('x'), { code: 'QUOTA' }))).toBe('QUOTA');
    expect(classifyError(Object.assign(new Error('x'), { code: 'UNSUPPORTED' }))).toBe('UNSUPPORTED');
  });

  it('UNKNOWN розпізнається як NETWORK (краще retry ніж тиха ескалація)', () => {
    expect(classifyError(Object.assign(new Error('x'), { code: 'UNKNOWN' }))).toBe('NETWORK');
  });

  it('TIMEOUT збережений як NETWORK для backwards compat', () => {
    expect(classifyError(Object.assign(new Error('x'), { code: 'TIMEOUT' }))).toBe('NETWORK');
  });
});

describe('retry logic — малий PDF (один чанк)', () => {
  it('1-а спроба успішна — без retry', async () => {
    fakePageCount = 5;
    pushResponse({ body: { document: { text: 'OK', pages: [{ pageNumber: 1 }] } } });

    const result = await runWithAdvancedTimers(
      () => documentAi.extract(fileFixture(), {})
    );
    expect(result.text).toBe('OK');
  });

  it('2-а спроба успішна (1-а — NETWORK через AbortError)', async () => {
    fakePageCount = 5;
    pushResponse({ throw: { message: 'aborted', name: 'AbortError' } });
    pushResponse({ body: { document: { text: 'OK_retry', pages: [{ pageNumber: 1 }] } } });

    const retries = [];
    const result = await runWithAdvancedTimers(
      () => documentAi.extract(fileFixture(), {
        onRetry: (info) => retries.push(info),
      })
    );
    expect(result.text).toBe('OK_retry');
    expect(retries.length).toBe(1);
    expect(retries[0].attempt).toBe(2);
  });

  it('3-я спроба успішна (1-а і 2-а — 5xx)', async () => {
    fakePageCount = 5;
    pushResponse({ status: 503, body: 'service unavailable' });
    pushResponse({ status: 502, body: 'bad gateway' });
    pushResponse({ body: { document: { text: 'OK_3rd', pages: [{ pageNumber: 1 }] } } });

    const retries = [];
    const result = await runWithAdvancedTimers(
      () => documentAi.extract(fileFixture(), {
        onRetry: (info) => retries.push(info),
      })
    );
    expect(result.text).toBe('OK_3rd');
    expect(retries.length).toBe(2);
  });

  it('усі 3 спроби — провал, кидається NETWORK', async () => {
    fakePageCount = 5;
    pushResponse({ throw: { message: 'failed to fetch' } });
    pushResponse({ throw: { message: 'failed to fetch' } });
    pushResponse({ throw: { message: 'failed to fetch' } });

    await expect(
      runWithAdvancedTimers(() => documentAi.extract(fileFixture(), {}))
    ).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('AUTH помилка — БЕЗ retry, кидається одразу', async () => {
    fakePageCount = 5;
    pushResponse({ status: 401, body: 'unauthorized' });
    // Якщо retry відбудеться — друга відповідь буде успіх. Тест перевіряє що ні.
    pushResponse({ body: { document: { text: 'should not be returned', pages: [] } } });

    await expect(
      runWithAdvancedTimers(() => documentAi.extract(fileFixture(), {}))
    ).rejects.toMatchObject({ code: 'AUTH' });
  });

  it('QUOTA помилка — БЕЗ retry', async () => {
    fakePageCount = 5;
    pushResponse({ status: 429, body: 'rate limit' });

    await expect(
      runWithAdvancedTimers(() => documentAi.extract(fileFixture(), {}))
    ).rejects.toMatchObject({ code: 'QUOTA' });
  });

  it('UNSUPPORTED (400) — БЕЗ retry', async () => {
    fakePageCount = 5;
    pushResponse({ status: 400, body: { error: { message: 'bad format' } } });

    await expect(
      runWithAdvancedTimers(() => documentAi.extract(fileFixture(), {}))
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });
});

describe('resumable state — великий PDF з нарізкою', () => {
  it('успіх усіх чанків — resumeStore очищується', async () => {
    fakePageCount = 30; // 2 чанки по 15

    // Чанк 1 — успіх
    pushResponse({ body: { document: { text: 'chunk1', pages: [{ pageNumber: 1 }] } } });
    // Чанк 2 — успіх
    pushResponse({ body: { document: { text: 'chunk2', pages: [{ pageNumber: 1 }] } } });

    const result = await runWithAdvancedTimers(
      () => documentAi.extract(fileFixture(), {})
    );

    expect(result.text).toContain('chunk1');
    expect(result.text).toContain('chunk2');
    expect(resumeStore.hasResume('drive_file_X')).toBe(false);
  });

  it('чанк 2 з 3 впав 3 рази — partial state зберігається', async () => {
    fakePageCount = 45; // 3 чанки

    // Чанк 1 — успіх
    pushResponse({ body: { document: { text: 'chunk1_text', pages: [{ pageNumber: 1 }] } } });
    // Чанк 2 — 3 рази network fail
    pushResponse({ throw: { message: 'failed to fetch' } });
    pushResponse({ throw: { message: 'failed to fetch' } });
    pushResponse({ throw: { message: 'failed to fetch' } });

    await expect(
      runWithAdvancedTimers(() => documentAi.extract(fileFixture(), {}))
    ).rejects.toMatchObject({ code: 'NETWORK', partial: true });

    // State зберігся з обробленим першим чанком
    expect(resumeStore.hasResume('drive_file_X')).toBe(true);
    const state = resumeStore.getResume('drive_file_X');
    expect(state.processedRanges).toHaveLength(1);
    expect(state.processedRanges[0]).toEqual({ startPage: 1, endPage: 15 });
    expect(state.lastFailedRange).toEqual({ startPage: 16, endPage: 30 });
    expect(state.textChunks[0].text).toBe('chunk1_text');
  });

  it('повторний виклик extract() продовжує з наступного чанка', async () => {
    fakePageCount = 45;

    // Перша спроба: чанк 1 ok, чанк 2 — 3 fail
    pushResponse({ body: { document: { text: 'first_chunk', pages: [{ pageNumber: 1 }] } } });
    pushResponse({ throw: { message: 'failed to fetch' } });
    pushResponse({ throw: { message: 'failed to fetch' } });
    pushResponse({ throw: { message: 'failed to fetch' } });

    await expect(
      runWithAdvancedTimers(() => documentAi.extract(fileFixture(), {}))
    ).rejects.toMatchObject({ code: 'NETWORK' });

    // Друга спроба: чанк 2 ok, чанк 3 ok. Чанк 1 НЕ повторюється.
    pushResponse({ body: { document: { text: 'second_chunk', pages: [{ pageNumber: 1 }] } } });
    pushResponse({ body: { document: { text: 'third_chunk', pages: [{ pageNumber: 1 }] } } });

    const result = await runWithAdvancedTimers(
      () => documentAi.extract(fileFixture(), {})
    );

    // Текст склеєний з усіх трьох
    expect(result.text).toContain('first_chunk');
    expect(result.text).toContain('second_chunk');
    expect(result.text).toContain('third_chunk');
    // Resume стан очищений
    expect(resumeStore.hasResume('drive_file_X')).toBe(false);
  });

  it('AUTH у середині — очищує resumeStore (повтор не допоможе)', async () => {
    fakePageCount = 30;

    pushResponse({ body: { document: { text: 'chunk1', pages: [{ pageNumber: 1 }] } } });
    pushResponse({ status: 401, body: 'unauthorized' });

    await expect(
      runWithAdvancedTimers(() => documentAi.extract(fileFixture(), {}))
    ).rejects.toMatchObject({ code: 'AUTH' });

    expect(resumeStore.hasResume('drive_file_X')).toBe(false);
  });
});

describe('resumeStore — read-only API', () => {
  it('processedPageCount рахує суму діапазонів', () => {
    const state = {
      processedRanges: [
        { startPage: 1, endPage: 15 },
        { startPage: 16, endPage: 30 },
      ],
    };
    expect(resumeStore.processedPageCount(state)).toBe(30);
  });

  it('null/undefined state — 0', () => {
    expect(resumeStore.processedPageCount(null)).toBe(0);
    expect(resumeStore.processedPageCount(undefined)).toBe(0);
  });
});
