// TASK 4 E — imageCompressor: пресети, resolvePreset, scanned-guard (чисті
// функції). Render-цикл (canvas/pdf.js) браузерний — у Node не виконується;
// реальний обсяг стиснення перевіряє адвокат на пристрої (не юніт-тест).
//
// Виняток — ГАРД «стиснення ніколи не збільшує розмір»: він суто про
// співвідношення outBytes vs inBytes, тож мокаємо pdf.js/pdf-lib/canvas і
// керуємо розміром виходу через globalThis.__MOCK_SAVE_BYTES (нижче).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// pdf-lib mock: PDFDocument.create() → fake outDoc; save() віддає буфер розміру
// globalThis.__MOCK_SAVE_BYTES (керуємо в тесті — більший/менший за вхід).
vi.mock('pdf-lib', () => ({
  PDFDocument: {
    create: async () => ({
      embedJpg: async () => ({}),
      addPage: () => ({ drawImage: () => {} }),
      save: async () => new Uint8Array(globalThis.__MOCK_SAVE_BYTES ?? 0),
    }),
  },
}));

// pdfjs-dist mock: одна scanned-сторінка (короткий текстовий шар → 'scanned',
// guard пропускає до перебудови).
vi.mock('pdfjs-dist', () => ({
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getViewport: ({ scale = 1 }) => ({ width: 1000 * scale, height: 1400 * scale }),
        getTextContent: async () => ({ items: [{ str: '' }] }),
        render: () => ({ promise: Promise.resolve() }),
        cleanup: () => {},
      }),
      destroy: () => {},
    }),
  }),
}));

import {
  COMPRESSION_PRESETS,
  DEFAULT_COMPRESSION_PRESET,
  resolvePreset,
  isCompressibleNature,
  compressPdfBuffer,
} from '../../src/services/compression/imageCompressor.js';

describe('imageCompressor — пресети', () => {
  it('три пресети зі стандартними значеннями (§4.1 doctrine)', () => {
    expect(COMPRESSION_PRESETS.weak).toEqual({ longEdge: 2200, quality: 0.8 });
    expect(COMPRESSION_PRESETS.medium).toEqual({ longEdge: 1800, quality: 0.7 });
    expect(COMPRESSION_PRESETS.strong).toEqual({ longEdge: 1600, quality: 0.65 });
  });

  it('дефолт = Середній (стандарт системи)', () => {
    expect(DEFAULT_COMPRESSION_PRESET).toBe('medium');
    expect(COMPRESSION_PRESETS[DEFAULT_COMPRESSION_PRESET]).toEqual({ longEdge: 1800, quality: 0.7 });
  });
});

describe('imageCompressor — resolvePreset', () => {
  it('назва пресета → параметри', () => {
    expect(resolvePreset('weak')).toEqual({ longEdge: 2200, quality: 0.8 });
    expect(resolvePreset('strong')).toEqual({ longEdge: 1600, quality: 0.65 });
  });

  it('невідома назва / undefined → дефолт Середній', () => {
    expect(resolvePreset('xxx')).toEqual({ longEdge: 1800, quality: 0.7 });
    expect(resolvePreset(undefined)).toEqual({ longEdge: 1800, quality: 0.7 });
    expect(resolvePreset(null)).toEqual({ longEdge: 1800, quality: 0.7 });
  });

  it('готовий обʼєкт {longEdge,quality} проходить як є', () => {
    expect(resolvePreset({ longEdge: 1500, quality: 0.5 })).toEqual({ longEdge: 1500, quality: 0.5 });
  });

  it('частковий/невалідний обʼєкт → дефолт', () => {
    expect(resolvePreset({ longEdge: 1500 })).toEqual({ longEdge: 1800, quality: 0.7 });
  });
});

describe('imageCompressor — isCompressibleNature (scanned-guard, одна детекція)', () => {
  it('scanned documentNature → true', () => {
    expect(isCompressibleNature({ documentNature: 'scanned' })).toBe(true);
  });

  it('searchable documentNature → false (текст/вектори, растрів нема)', () => {
    expect(isCompressibleNature({ documentNature: 'searchable' })).toBe(false);
  });

  it('image MIME / розширення → true', () => {
    expect(isCompressibleNature({ mimeType: 'image/jpeg' })).toBe(true);
    expect(isCompressibleNature({ name: 'scan.PNG' })).toBe(true);
    expect(isCompressibleNature({ name: 'photo.heic' })).toBe(true);
  });

  it('PDF без відомого nature → null (потрібна deep-детекція буфера)', () => {
    expect(isCompressibleNature({ mimeType: 'application/pdf' })).toBeNull();
    expect(isCompressibleNature({ name: 'doc.pdf' })).toBeNull();
  });

  it('не-PDF не-зображення (DOCX/HTML/txt) → false (pass-through)', () => {
    expect(isCompressibleNature({ name: 'позов.docx' })).toBe(false);
    expect(isCompressibleNature({ mimeType: 'text/html' })).toBe(false);
    expect(isCompressibleNature({ name: 'нотатка.txt' })).toBe(false);
  });

  it('порожній вхід → false', () => {
    expect(isCompressibleNature({})).toBe(false);
    expect(isCompressibleNature()).toBe(false);
  });
});

describe('imageCompressor — ГАРД «стиснення ніколи не збільшує розмір»', () => {
  // Мінімальний canvas-стаб: toBlob → Blob із заданим обсягом JPEG-байтів.
  // Розмір JPEG несуттєвий (per-page), бо guard зважує лише save() vs вхід.
  beforeEach(() => {
    globalThis.document = {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({}),
        toBlob: (cb) => cb({ arrayBuffer: async () => new Uint8Array(10).buffer }),
      }),
    };
  });
  afterEach(() => {
    delete globalThis.document;
    delete globalThis.__MOCK_SAVE_BYTES;
  });

  it('outBytes >= inBytes → ОРИГІНАЛ незмінним (pass-through, not_smaller)', async () => {
    const input = new Uint8Array(1000); // вхід 1000 байт
    globalThis.__MOCK_SAVE_BYTES = 5000; // перебудова роздула до 5000
    const res = await compressPdfBuffer(input, { scannedGuard: false });
    expect(res.compressed).toBe(false);
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('not_smaller');
    expect(res.inBytes).toBe(1000);
    expect(res.outBytes).toBe(1000);          // outBytes = inBytes (оригінал)
    expect(res.bytes).toBe(input);             // ТОЙ САМИЙ буфер, незмінний
  });

  it('outBytes < inBytes → стиснутий результат (compressed)', async () => {
    const input = new Uint8Array(5000);
    globalThis.__MOCK_SAVE_BYTES = 1000;      // перебудова менша за вхід
    const res = await compressPdfBuffer(input, { scannedGuard: false });
    expect(res.compressed).toBe(true);
    expect(res.skipped).toBe(false);
    expect(res.inBytes).toBe(5000);
    expect(res.outBytes).toBe(1000);
    expect(res.bytes.byteLength).toBe(1000);   // повертає перебудований буфер
  });
});
