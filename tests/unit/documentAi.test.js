// TASK documentai_limit_40mb_imageless §4 — guard на 40 МБ + imagelessMode у body.
// Підняли DOC_AI_MB_PER_REQUEST з 20 до 40 МБ (Google online/sync ліміт),
// додали imagelessMode:true у body postToDocAi.
//
// Підхід: справжній default-export `documentAi` з мокнутим `driveRequest` і
// `pdf-lib` — обходимо реальну мережу і pdf-lib parse важких блобів, але
// викликаємо повний extract() з продакшн-кодом (guard, body shape).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Мок Drive — повертає `arrayBuffer` з контрольованих байтів. Окремо
// перехоплюємо POST на `:process` endpoint Document AI — це і є тест на body.
const docAiCalls = [];
const driveDownloadBytes = { current: new ArrayBuffer(8) };

vi.mock('../../src/services/driveAuth.js', () => ({
  driveRequest: vi.fn(async (url, opts) => {
    // 1. Drive download — повертаємо контрольовані байти (`driveDownloadBytes`).
    if (url.includes('drive/v3/files/')) {
      return {
        ok: true,
        status: 200,
        async arrayBuffer() { return driveDownloadBytes.current; },
        async json() { return {}; },
        async text() { return ''; },
      };
    }
    // 2. Document AI :process — фіксуємо body і повертаємо мінімальний результат.
    if (url.includes(':process')) {
      docAiCalls.push({ url, body: opts?.body, headers: opts?.headers });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            document: {
              text: 'STUB OCR TEXT',
              pages: [{ pageNumber: 1, layout: { textAnchor: { textSegments: [{ startIndex: 0, endIndex: 13 }] } } }],
            },
          };
        },
        async text() { return ''; },
      };
    }
    return { ok: false, status: 404, async text() { return 'not found'; }, async json() { return {}; } };
  }),
}));

// pdf-lib замок — PDF з пагінацією для гілки "малий PDF" (один запит).
vi.mock('pdf-lib', () => ({
  PDFDocument: {
    load: vi.fn(async () => ({
      getPageCount: () => 5,             // ≤ DOC_AI_PAGES_PER_REQUEST (15) → один запит
    })),
    create: vi.fn(async () => ({
      copyPages: async () => [],
      addPage: () => {},
      save: async () => new Uint8Array([]),
    })),
  },
}));

import documentAi from '../../src/services/ocr/documentAi.js';
import * as resumeStore from '../../src/services/ocr/resumeStore.js';

const MB = 1024 * 1024;

function makePdfBytes(sizeMb) {
  // PDF magic + padding до потрібного розміру. Реальна структура неважлива —
  // pdf-lib замокнутий, ZIP-сигнатура (PK\x03\x04) у перших 4 байтах не стоїть.
  const buf = new Uint8Array(Math.floor(sizeMb * MB));
  buf[0] = 0x25; buf[1] = 0x50; buf[2] = 0x44; buf[3] = 0x46;  // "%PDF"
  return buf.buffer;
}

describe('documentAi — guard 40 МБ + imagelessMode у body', () => {
  beforeEach(() => {
    docAiCalls.length = 0;
    driveDownloadBytes.current = new ArrayBuffer(8);
    resumeStore.clearAll && resumeStore.clearAll();
  });
  afterEach(() => vi.clearAllMocks());

  // §4.1 — Файл ≤40 МБ → НЕ throw guard.
  it('PDF 30 МБ → проходить guard (не throw UNSUPPORTED >40 МБ)', async () => {
    driveDownloadBytes.current = makePdfBytes(30);
    const res = await documentAi.extract(
      { id: 'f30', name: 'big.pdf', mimeType: 'application/pdf' },
      { signal: new AbortController().signal },
    );
    expect(res.text).toBe('STUB OCR TEXT');
    expect(docAiCalls).toHaveLength(1);
  });

  // §4.1 — Файл 39 МБ (граничний випадок під 40) → проходить.
  it('PDF 39 МБ (граничний) → проходить guard', async () => {
    driveDownloadBytes.current = makePdfBytes(39);
    const res = await documentAi.extract(
      { id: 'f39', name: 'border.pdf', mimeType: 'application/pdf' },
      { signal: new AbortController().signal },
    );
    expect(res.text).toBe('STUB OCR TEXT');
  });

  // §4.1 — Файл >40 МБ → throw з повідомленням `Файл більший за 40 МБ`.
  it('PDF 41 МБ → throw UNSUPPORTED `Файл більший за 40 МБ`', async () => {
    driveDownloadBytes.current = makePdfBytes(41);
    await expect(
      documentAi.extract(
        { id: 'f41', name: 'huge.pdf', mimeType: 'application/pdf' },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED',
      message: expect.stringContaining('Файл більший за 40 МБ'),
    });
    // POST до Document AI не повинен відбутись — впав на guard.
    expect(docAiCalls).toHaveLength(0);
  });

  // §4.2 — body postToDocAi містить imagelessMode:true.
  it('postToDocAi body містить imagelessMode:true (підтверджено у запиті)', async () => {
    driveDownloadBytes.current = makePdfBytes(10);
    await documentAi.extract(
      { id: 'fIM', name: 'small.pdf', mimeType: 'application/pdf' },
      { signal: new AbortController().signal },
    );
    expect(docAiCalls).toHaveLength(1);
    const body = JSON.parse(docAiCalls[0].body);
    expect(body.imagelessMode).toBe(true);
    // Базова форма rawDocument збережена.
    expect(body.rawDocument).toBeDefined();
    expect(body.rawDocument.mimeType).toBe('application/pdf');
    expect(typeof body.rawDocument.content).toBe('string');
  });

  // §4.2 — image MIME теж відсилає imagelessMode (single-request гілка).
  it('image MIME → imagelessMode:true теж присутній', async () => {
    driveDownloadBytes.current = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]).buffer;  // JPEG magic
    await documentAi.extract(
      { id: 'fImg', name: 'photo.jpg', mimeType: 'image/jpeg' },
      { signal: new AbortController().signal },
    );
    expect(docAiCalls).toHaveLength(1);
    const body = JSON.parse(docAiCalls[0].body);
    expect(body.imagelessMode).toBe(true);
    expect(body.rawDocument.mimeType).toBe('image/jpeg');
  });
});
