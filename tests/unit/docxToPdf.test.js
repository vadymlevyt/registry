// @vitest-environment jsdom
//
// Юніт-тести docxToPdf — конвертація DOCX → PDF через mammoth + html2pdf.js.
// Обидві залежності мокаємо: jsdom не виконує DOCX парсинг чи canvas рендер.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock mammoth ───────────────────────────────────────────────────────────
const mockMammothConvertToHtml = vi.fn();

vi.mock('mammoth', () => ({
  default: { convertToHtml: (opts) => mockMammothConvertToHtml(opts) },
  convertToHtml: (opts) => mockMammothConvertToHtml(opts),
}));

// ── Mock html2pdf.js ──────────────────────────────────────────────────────
let mockOutputResult = new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' });

vi.mock('html2pdf.js', () => {
  const chain = {
    from: vi.fn(() => chain),
    set: vi.fn(() => chain),
    outputPdf: vi.fn(() => Promise.resolve(mockOutputResult)),
  };
  return { default: () => chain };
});

import { docxToPdf } from '../../src/services/converter/docxToPdf.js';

function docxFile(name = 'document.docx') {
  return new File(
    [new Uint8Array([0x50, 0x4b, 0x03, 0x04])], // ZIP-сигнатура
    name,
    { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
  );
}

describe('docxToPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOutputResult = new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' });
    mockMammothConvertToHtml.mockResolvedValue({
      value: '<p>Позовна заява</p>',
      messages: [],
    });
  });

  it('повертає pdfBlob і warnings контракт', async () => {
    const result = await docxToPdf(docxFile(), {});
    expect(result).toHaveProperty('pdfBlob');
    expect(result).toHaveProperty('warnings');
    expect(result.pdfBlob).toBeInstanceOf(Blob);
    expect(result.pdfBlob.type).toBe('application/pdf');
  });

  it('викликає mammoth.convertToHtml з arrayBuffer', async () => {
    await docxToPdf(docxFile(), {});
    expect(mockMammothConvertToHtml).toHaveBeenCalledWith(
      expect.objectContaining({ arrayBuffer: expect.any(ArrayBuffer) })
    );
  });

  it('передає mammoth warnings у результат', async () => {
    mockMammothConvertToHtml.mockResolvedValueOnce({
      value: '<p>Текст</p>',
      messages: [
        { type: 'warning', message: 'Unrecognised numbering style: 1' },
        { type: 'info', message: 'Style applied' }, // не warning — ігноруємо
      ],
    });
    const result = await docxToPdf(docxFile(), {});
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('Unrecognised numbering');
  });

  it('кидає помилку коли mammoth повертає порожній HTML', async () => {
    mockMammothConvertToHtml.mockResolvedValueOnce({ value: '', messages: [] });
    await expect(docxToPdf(docxFile(), {})).rejects.toThrow(/порожній/);
  });

  it('кидає помилку коли mammoth падає', async () => {
    mockMammothConvertToHtml.mockRejectedValueOnce(new Error('zip parse error'));
    await expect(docxToPdf(docxFile(), {})).rejects.toThrow(/mammoth/);
  });

  it('видаляє контейнер з DOM після успіху (cleanup)', async () => {
    const before = document.body.children.length;
    await docxToPdf(docxFile(), {});
    expect(document.body.children.length).toBe(before);
  });

  it('видаляє контейнер навіть при помилці html2pdf (finally)', async () => {
    const before = document.body.children.length;
    mockOutputResult = new Blob([], { type: 'application/pdf' });
    await expect(docxToPdf(docxFile(), {})).rejects.toThrow();
    expect(document.body.children.length).toBe(before);
  });

  it('кидає помилку коли html2pdf повертає порожній blob', async () => {
    mockOutputResult = new Blob([], { type: 'application/pdf' });
    await expect(docxToPdf(docxFile(), {})).rejects.toThrow(/порожній/);
  });
});
