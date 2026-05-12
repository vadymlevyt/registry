// @vitest-environment jsdom
//
// Інтеграційні тести multi-image PDF pipeline.
//
// КРИТИЧНО для TASK B (адвокат явно попередив): pipeline ВИКОНУЄ OCR
// через ocrService.extractText лише ОДИН РАЗ для КОЖНОГО зображення.
// Жодного повторного OCR на фінальному merged PDF.
//
// Цей файл тестує саме цей контракт.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────
// Мокаємо ocrService, sortation, heic2any і jsPDF щоб ізолювати pipeline
// логіку від реальних HTTP/Canvas.

const mockExtractText = vi.fn();
vi.mock('../../src/services/ocrService.js', () => ({
  extractText: (...args) => mockExtractText(...args),
}));

const mockSortImages = vi.fn();
const mockEnsureUniqueName = vi.fn((name) => name);
vi.mock('../../src/services/sortation/imageSortingAgent.js', () => ({
  sortImages: (...args) => mockSortImages(...args),
  ensureUniqueName: (...args) => mockEnsureUniqueName(...args),
}));

const mockRotateImageBlob = vi.fn(async (blob) => blob);
const mockExtractPageOrientation = vi.fn(() => 0);
const mockReadExifOrientation = vi.fn(async () => null);
const mockResolveOrientation = vi.fn(({ exifResult, docAiPage }) => {
  if (exifResult && exifResult.degrees) {
    return { degrees: exifResult.degrees, source: 'exif', logs: [] };
  }
  const docAiDeg = mockExtractPageOrientation(docAiPage);
  return {
    degrees: docAiDeg,
    source: docAiDeg ? 'docAi' : 'none',
    logs: [],
  };
});
vi.mock('../../src/services/sortation/orientationCorrector.js', () => ({
  rotateImageBlob: (...args) => mockRotateImageBlob(...args),
  extractPageOrientation: (...args) => mockExtractPageOrientation(...args),
  readExifOrientation: (...args) => mockReadExifOrientation(...args),
  resolveOrientation: (...args) => mockResolveOrientation(...args),
}));

vi.mock('../../src/services/converter/heicToJpeg.js', () => ({
  heicToJpeg: vi.fn(async (file) => ({ jpegFile: file, warnings: [] })),
}));

// jsPDF мок: повертає фіктивний PDF blob, count addPage
const mockAddImage = vi.fn();
const mockAddPage = vi.fn();
const mockOutput = vi.fn(() => new Blob(['%PDF-1.4 merged'], { type: 'application/pdf' }));
class MockJsPDF {
  constructor(opts) { this.opts = opts; }
  addImage(...args) { mockAddImage(...args); }
  addPage(...args) { mockAddPage(...args); }
  output(format) { return mockOutput(format); }
}
vi.mock('jspdf', () => ({
  jsPDF: MockJsPDF,
  default: MockJsPDF,
}));

// ── Globals ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom Image мок — onload одразу
  global.Image = class {
    constructor() {
      this.width = 200;
      this.height = 300;
      setTimeout(() => this.onload && this.onload(), 0);
    }
  };
  global.URL.createObjectURL = vi.fn(() => 'blob:fake');
  global.URL.revokeObjectURL = vi.fn();
  // Canvas мок
  const origCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag === 'canvas') {
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toDataURL: () => 'data:image/jpeg;base64,FAKE',
      };
    }
    return origCreate(tag);
  });
});

import { convertImagesToPdf } from '../../src/services/converter/multiImageToPdf.js';

function mockImage(name, mime = 'image/jpeg', sizeBytes = 100000) {
  // jsdom File — наш мок з name, type, size
  const f = new File([new Uint8Array(sizeBytes)], name, { type: mime });
  return f;
}

// ── Тести ────────────────────────────────────────────────────────────────

describe('multiImageToPdf — КРИТИЧНО: один OCR на зображення', () => {
  it('5 зображень → extractText викликається РІВНО 5 разів (не N+1)', async () => {
    // Mock OCR: повертає різний текст для кожного зображення
    mockExtractText.mockImplementation(async (file) => ({
      text: `OCR text for ${file.name}`,
      pageStructure: [{ pageNumber: 1, _text: `OCR text for ${file.name}` }],
      warnings: [],
    }));

    // Mock агент повертає identity order
    mockSortImages.mockResolvedValue({
      order: [0, 1, 2, 3, 4],
      warnings: [],
      missing: null,
      suggestedName: 'Документ',
      model: 'sonnet',
      usage: { inputTokens: 100, outputTokens: 20 },
    });

    const files = [
      mockImage('page1.jpg'),
      mockImage('page2.jpg'),
      mockImage('page3.jpg'),
      mockImage('page4.jpg'),
      mockImage('page5.jpg'),
    ];

    await convertImagesToPdf(files, { apiKey: 'test' });

    // Це і є КРИТИЧНА перевірка від TASK B
    expect(mockExtractText).toHaveBeenCalledTimes(5);
    expect(mockExtractText).not.toHaveBeenCalledTimes(6);
    expect(mockExtractText).not.toHaveBeenCalledTimes(10);
  });

  it('10 зображень → 10 OCR викликів, не 11', async () => {
    mockExtractText.mockImplementation(async () => ({ text: 'x', pageStructure: [], warnings: [] }));
    mockSortImages.mockResolvedValue({
      order: Array.from({ length: 10 }, (_, i) => i),
      warnings: [], missing: null, suggestedName: 'Doc',
      model: 's', usage: { inputTokens: 0, outputTokens: 0 },
    });

    const files = Array.from({ length: 10 }, (_, i) => mockImage(`p${i}.jpg`));
    await convertImagesToPdf(files, { apiKey: 'test' });

    expect(mockExtractText).toHaveBeenCalledTimes(10);
  });

  it('1 зображення → 1 OCR виклик, агент НЕ викликається', async () => {
    mockExtractText.mockResolvedValue({ text: 'single', pageStructure: [], warnings: [] });

    const files = [mockImage('single.jpg')];
    const result = await convertImagesToPdf(files, { apiKey: 'test' });

    expect(mockExtractText).toHaveBeenCalledTimes(1);
    expect(mockSortImages).not.toHaveBeenCalled();
    expect(result.sortResult).toBeNull();
  });
});

describe('multiImageToPdf — порядок результатів', () => {
  it('agent повертає order [2, 0, 1] — фінальні сторінки у цьому порядку', async () => {
    mockExtractText.mockImplementation(async (file) => ({
      text: `OCR-${file.name}`,
      pageStructure: [{ pageNumber: 1 }],
      warnings: [],
    }));
    mockSortImages.mockResolvedValue({
      order: [2, 0, 1],
      warnings: [],
      missing: null,
      suggestedName: 'Документ',
      model: 's',
      usage: { inputTokens: 0, outputTokens: 0 },
    });

    const files = [
      mockImage('first.jpg'),
      mockImage('second.jpg'),
      mockImage('third.jpg'),
    ];
    const result = await convertImagesToPdf(files, { apiKey: 'test' });

    expect(result.finalOrder).toEqual([2, 0, 1]);
    // Об'єднаний текст у порядку 2, 0, 1
    expect(result.extractedText).toContain('OCR-third.jpg');
    expect(result.extractedText.indexOf('OCR-third.jpg'))
      .toBeLessThan(result.extractedText.indexOf('OCR-first.jpg'));
    expect(result.extractedText.indexOf('OCR-first.jpg'))
      .toBeLessThan(result.extractedText.indexOf('OCR-second.jpg'));
  });

  it('jsPDF.addPage викликається (N-1) разів для N зображень', async () => {
    mockExtractText.mockResolvedValue({ text: 'x', pageStructure: [], warnings: [] });
    mockSortImages.mockResolvedValue({
      order: [0, 1, 2, 3],
      warnings: [], missing: null, suggestedName: 'D',
      model: 's', usage: { inputTokens: 0, outputTokens: 0 },
    });

    await convertImagesToPdf(
      [mockImage('a.jpg'), mockImage('b.jpg'), mockImage('c.jpg'), mockImage('d.jpg')],
      { apiKey: 'test' }
    );

    // First image — addImage без addPage. Решта — addPage + addImage.
    expect(mockAddImage).toHaveBeenCalledTimes(4);
    expect(mockAddPage).toHaveBeenCalledTimes(3);
  });
});

describe('multiImageToPdf — orientation correction', () => {
  it('rotateImageBlob викликається тільки для orientation != 0', async () => {
    mockExtractText.mockImplementation(async (file) => ({
      text: 'x',
      pageStructure: [{ pageNumber: 1 }],
      warnings: [],
    }));
    mockSortImages.mockResolvedValue({
      order: [0, 1, 2],
      warnings: [], missing: null, suggestedName: 'D',
      model: 's', usage: { inputTokens: 0, outputTokens: 0 },
    });
    // 0, 90, 180 для трьох зображень
    let call = 0;
    mockExtractPageOrientation.mockImplementation(() => {
      const orient = [0, 90, 180][call++ % 3];
      return orient;
    });

    await convertImagesToPdf(
      [mockImage('a.jpg'), mockImage('b.jpg'), mockImage('c.jpg')],
      { apiKey: 'test' }
    );

    // extractPageOrientation викликається багато разів (для агента + rotation):
    // 3 (sortImages buildItems) + 3 (rotation phase) = 6
    expect(mockExtractPageOrientation).toHaveBeenCalled();
    // rotate викликається 2 рази — для 90 і 180. Для 0 — no-op (skipped).
    expect(mockRotateImageBlob).toHaveBeenCalledTimes(2);
  });
});

describe('multiImageToPdf — error handling', () => {
  it('OCR fail для одного зображення — продовжуємо з рештою', async () => {
    mockExtractText.mockImplementation(async (file) => {
      if (file.name === 'bad.jpg') throw new Error('Document AI 500');
      return { text: `ok-${file.name}`, pageStructure: [{ pageNumber: 1 }], warnings: [] };
    });
    mockSortImages.mockResolvedValue({
      order: [0, 1, 2],
      warnings: [], missing: null, suggestedName: 'D',
      model: 's', usage: { inputTokens: 0, outputTokens: 0 },
    });

    const result = await convertImagesToPdf(
      [mockImage('a.jpg'), mockImage('bad.jpg'), mockImage('c.jpg')],
      { apiKey: 'test' }
    );

    expect(result.pdfBlob).toBeInstanceOf(Blob);
    expect(result.warnings.some((w) => w.includes('bad.jpg'))).toBe(true);
    expect(result.extractedText).toContain('ok-a.jpg');
    expect(result.extractedText).toContain('ok-c.jpg');
  });

  it('агент fail → fallback на identity order, продовжуємо', async () => {
    mockExtractText.mockResolvedValue({ text: 'x', pageStructure: [], warnings: [] });
    mockSortImages.mockRejectedValue(new Error('Anthropic 429'));

    const result = await convertImagesToPdf(
      [mockImage('a.jpg'), mockImage('b.jpg')],
      { apiKey: 'test' }
    );

    expect(result.pdfBlob).toBeInstanceOf(Blob);
    expect(result.finalOrder).toEqual([0, 1]); // identity
    expect(result.warnings.some((w) => w.includes('Sorting agent fail'))).toBe(true);
    expect(result.sortResult).toBeNull();
  });

  it('порожній files → throws', async () => {
    await expect(convertImagesToPdf([], { apiKey: 'x' })).rejects.toThrow(/непорожн/);
  });
});

describe('multiImageToPdf — progress callback', () => {
  it('onProgress викликається для всіх фаз: heic, ocr, sort, rotate, pdf', async () => {
    mockExtractText.mockResolvedValue({ text: 'x', pageStructure: [], warnings: [] });
    mockSortImages.mockResolvedValue({
      order: [0, 1],
      warnings: [], missing: null, suggestedName: 'D',
      model: 's', usage: { inputTokens: 0, outputTokens: 0 },
    });

    const phases = new Set();
    await convertImagesToPdf(
      [mockImage('a.jpg'), mockImage('b.jpg')],
      {
        apiKey: 'test',
        onProgress: (phase) => phases.add(phase),
      }
    );

    expect(phases.has('heic')).toBe(true);
    expect(phases.has('ocr')).toBe(true);
    expect(phases.has('sort')).toBe(true);
    expect(phases.has('rotate')).toBe(true);
    expect(phases.has('pdf')).toBe(true);
  });

  it('OCR progress: done count зростає від 0 до N', async () => {
    mockExtractText.mockImplementation(async (file) => ({
      text: 'x', pageStructure: [], warnings: [],
    }));
    mockSortImages.mockResolvedValue({
      order: [0, 1, 2],
      warnings: [], missing: null, suggestedName: 'D',
      model: 's', usage: { inputTokens: 0, outputTokens: 0 },
    });

    const ocrProgress = [];
    await convertImagesToPdf(
      [mockImage('a.jpg'), mockImage('b.jpg'), mockImage('c.jpg')],
      {
        apiKey: 'test',
        onProgress: (phase, done, total) => {
          if (phase === 'ocr') ocrProgress.push([done, total]);
        },
      }
    );

    // start 0/3, end 3/3, плюс кожен інкремент між
    expect(ocrProgress[0]).toEqual([0, 3]);
    expect(ocrProgress[ocrProgress.length - 1]).toEqual([3, 3]);
  });
});

describe('multiImageToPdf — concurrency', () => {
  it('OCR паралельно 3 одночасних (Б2=B)', async () => {
    let activeCount = 0;
    let maxActive = 0;
    mockExtractText.mockImplementation(async (file) => {
      activeCount++;
      maxActive = Math.max(maxActive, activeCount);
      await new Promise((r) => setTimeout(r, 5));
      activeCount--;
      return { text: file.name, pageStructure: [], warnings: [] };
    });
    mockSortImages.mockResolvedValue({
      order: [0, 1, 2, 3, 4, 5],
      warnings: [], missing: null, suggestedName: 'D',
      model: 's', usage: { inputTokens: 0, outputTokens: 0 },
    });

    await convertImagesToPdf(
      Array.from({ length: 6 }, (_, i) => mockImage(`p${i}.jpg`)),
      { apiKey: 'test' }
    );

    // Має бути ≤3 одночасних (OCR_CONCURRENCY=3)
    expect(maxActive).toBeLessThanOrEqual(3);
    // Але має бути >1 (паралельно, не послідовно)
    expect(maxActive).toBeGreaterThanOrEqual(2);
  });
});
