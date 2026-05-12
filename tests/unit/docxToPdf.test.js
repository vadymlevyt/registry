// @vitest-environment jsdom
//
// Юніт-тести docxToPdf — DOCX → PDF через mammoth.extractRawText + pdf-lib.
// pdfLibRenderer.textToPdf мокаємо щоб не fetch'ити шрифт у тестах.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock mammoth ───────────────────────────────────────────────────────────
const mockMammothExtractRawText = vi.fn();

vi.mock('mammoth', () => ({
  default: {
    extractRawText: (opts) => mockMammothExtractRawText(opts),
  },
  extractRawText: (opts) => mockMammothExtractRawText(opts),
}));

// ── Mock pdfLibRenderer ────────────────────────────────────────────────────
// textToPdf повертає Blob — у тестах перевіряємо що його викликали з текстом,
// не сам зміст PDF (це окремий unit на pdfLibRenderer).
let mockPdfBlob = new Blob(['%PDF-1.4 fake-pdf-from-pdflib'], { type: 'application/pdf' });
const mockTextToPdf = vi.fn(async () => mockPdfBlob);

vi.mock('../../src/services/converter/pdfLibRenderer.js', () => ({
  textToPdf: (text, opts) => mockTextToPdf(text, opts),
}));

import { docxToPdf } from '../../src/services/converter/docxToPdf.js';

function docxFile(name = 'document.docx') {
  return new File(
    [new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00])],
    name,
    { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
  );
}

function nonZipFile(name = 'fake.docx') {
  return new File(
    [new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f])], // "hello"
    name,
    { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
  );
}

// Текст довший за MIN_TEXT_LENGTH (50). Це типовий заголовок позовної заяви.
const LONG_TEXT = 'Позовна заява про стягнення коштів за договором про надання правової допомоги №42';

describe('docxToPdf — DOCX → PDF через mammoth + pdf-lib', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPdfBlob = new Blob(['%PDF-1.4 fake-pdf-from-pdflib'], { type: 'application/pdf' });
    mockMammothExtractRawText.mockResolvedValue({
      value: LONG_TEXT,
      messages: [],
    });
  });

  it('повертає pdfBlob, extractedText і warnings контракт', async () => {
    const result = await docxToPdf(docxFile(), {});
    expect(result).toHaveProperty('pdfBlob');
    expect(result).toHaveProperty('extractedText');
    expect(result).toHaveProperty('warnings');
    expect(result.pdfBlob).toBeInstanceOf(Blob);
    expect(result.pdfBlob.type).toBe('application/pdf');
    expect(result.extractedText).toBe(LONG_TEXT);
  });

  it('викликає mammoth.extractRawText з arrayBuffer', async () => {
    await docxToPdf(docxFile(), {});
    expect(mockMammothExtractRawText).toHaveBeenCalledWith(
      expect.objectContaining({ arrayBuffer: expect.any(ArrayBuffer) })
    );
  });

  it('передає extracted text у textToPdf для PDF generation', async () => {
    await docxToPdf(docxFile(), {});
    expect(mockTextToPdf).toHaveBeenCalledOnce();
    expect(mockTextToPdf.mock.calls[0][0]).toBe(LONG_TEXT);
  });

  it('передає mammoth warnings у результат', async () => {
    mockMammothExtractRawText.mockResolvedValueOnce({
      value: LONG_TEXT,
      messages: [
        { type: 'warning', message: 'Unrecognised numbering style: 1' },
        { type: 'info', message: 'Style applied' }, // не warning — ігноруємо
      ],
    });
    const result = await docxToPdf(docxFile(), {});
    expect(result.warnings.some((w) => w.includes('Unrecognised numbering'))).toBe(true);
  });

  // ── Валідація вхідного файлу ─────────────────────────────────────────────

  it('кидає чесну помилку коли файл не має ZIP-сигнатури', async () => {
    await expect(docxToPdf(nonZipFile(), {})).rejects.toThrow(/не є валідним DOCX/);
    // mammoth НЕ викликаний — провалидовано до завантаження бібліотеки
    expect(mockMammothExtractRawText).not.toHaveBeenCalled();
    expect(mockTextToPdf).not.toHaveBeenCalled();
  });

  it('кидає чесну помилку коли mammoth падає на пошкодженому DOCX', async () => {
    mockMammothExtractRawText.mockRejectedValueOnce(new Error('zip parse error'));
    await expect(docxToPdf(docxFile(), {})).rejects.toThrow(/може бути пошкоджений/);
    expect(mockTextToPdf).not.toHaveBeenCalled();
  });

  it('кидає чесну помилку коли DOCX містить менше MIN_TEXT_LENGTH символів', async () => {
    mockMammothExtractRawText.mockResolvedValueOnce({ value: 'Привіт', messages: [] });
    await expect(docxToPdf(docxFile(), {})).rejects.toThrow(/не містить тексту/);
    expect(mockTextToPdf).not.toHaveBeenCalled();
  });

  it('кидає помилку коли DOCX взагалі порожній', async () => {
    mockMammothExtractRawText.mockResolvedValueOnce({ value: '', messages: [] });
    await expect(docxToPdf(docxFile(), {})).rejects.toThrow(/не містить тексту/);
  });

  it('кидає помилку якщо pdf-lib повернув порожній blob', async () => {
    mockPdfBlob = new Blob([], { type: 'application/pdf' });
    await expect(docxToPdf(docxFile(), {})).rejects.toThrow(/порожній/);
  });

  it('кидає помилку якщо pdf-lib падає (наприклад шрифт не завантажився)', async () => {
    mockTextToPdf.mockRejectedValueOnce(new Error('Font fetch failed'));
    await expect(docxToPdf(docxFile(), {})).rejects.toThrow(/Не вдалось згенерувати PDF/);
  });
});
