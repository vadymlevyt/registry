// @vitest-environment jsdom
//
// Юніт-тести docxToPdf — конвертація DOCX → PDF через mammoth + html2pdf.js
// з валідацією ZIP-сигнатури і екстракцією plain-тексту через
// mammoth.extractRawText. Обидві залежності мокаємо: jsdom не виконує DOCX
// парсинг чи canvas рендер.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock mammoth ───────────────────────────────────────────────────────────
const mockMammothConvertToHtml = vi.fn();
const mockMammothExtractRawText = vi.fn();

vi.mock('mammoth', () => ({
  default: {
    convertToHtml: (opts) => mockMammothConvertToHtml(opts),
    extractRawText: (opts) => mockMammothExtractRawText(opts),
  },
  convertToHtml: (opts) => mockMammothConvertToHtml(opts),
  extractRawText: (opts) => mockMammothExtractRawText(opts),
}));

// ── Mock html2pdf.js ──────────────────────────────────────────────────────
// Mock PDF >= 5 КБ (MIN_PDF_SIZE_BYTES). Реальний PDF з вмістом — 30+ КБ;
// порожній рендер ~3-4 КБ. Цей mock імітує валідний результат конвертації.
function makeFakePdfBlob(sizeBytes = 8 * 1024) {
  return new Blob(['%PDF-1.4\n' + 'X'.repeat(sizeBytes)], { type: 'application/pdf' });
}
let mockOutputResult = makeFakePdfBlob();

vi.mock('html2pdf.js', () => {
  const chain = {
    from: vi.fn(() => chain),
    set: vi.fn(() => chain),
    outputPdf: vi.fn(() => Promise.resolve(mockOutputResult)),
  };
  return { default: () => chain };
});

import { docxToPdf } from '../../src/services/converter/docxToPdf.js';

// Тестовий DOCX з валідною ZIP-сигнатурою у заголовку (PK\x03\x04). Не справжній
// DOCX — mammoth все одно мокнутий, тому решта байт не важлива. Перші 4 байти
// проходять валідацію hasDocxSignature.
function docxFile(name = 'document.docx') {
  return new File(
    [new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00])],
    name,
    { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
  );
}

// Файл без ZIP-сигнатури — наприклад текст з .docx розширенням, або старий .doc
function nonZipFile(name = 'fake.docx') {
  return new File(
    [new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f])], // "hello"
    name,
    { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
  );
}

// Текст довший за MIN_TEXT_LENGTH (50). Це типовий заголовок позовної заяви.
const LONG_TEXT = 'Позовна заява про стягнення коштів за договором про надання правової допомоги №42';

describe('docxToPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOutputResult = makeFakePdfBlob();
    mockMammothExtractRawText.mockResolvedValue({
      value: LONG_TEXT,
      messages: [],
    });
    mockMammothConvertToHtml.mockResolvedValue({
      value: `<p>${LONG_TEXT}</p>`,
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

  it('викликає mammoth.extractRawText і mammoth.convertToHtml з arrayBuffer', async () => {
    await docxToPdf(docxFile(), {});
    expect(mockMammothExtractRawText).toHaveBeenCalledWith(
      expect.objectContaining({ arrayBuffer: expect.any(ArrayBuffer) })
    );
    expect(mockMammothConvertToHtml).toHaveBeenCalledWith(
      expect.objectContaining({ arrayBuffer: expect.any(ArrayBuffer) })
    );
  });

  it('передає mammoth warnings у результат', async () => {
    mockMammothConvertToHtml.mockResolvedValueOnce({
      value: `<p>${LONG_TEXT}</p>`,
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
    expect(mockMammothConvertToHtml).not.toHaveBeenCalled();
  });

  it('кидає чесну помилку коли mammoth падає на пошкодженому DOCX', async () => {
    mockMammothExtractRawText.mockRejectedValueOnce(new Error('zip parse error'));
    await expect(docxToPdf(docxFile(), {})).rejects.toThrow(/може бути пошкоджений/);
  });

  it('кидає чесну помилку коли DOCX містить менше MIN_TEXT_LENGTH символів', async () => {
    mockMammothExtractRawText.mockResolvedValueOnce({ value: 'Привіт', messages: [] });
    await expect(docxToPdf(docxFile(), {})).rejects.toThrow(/не містить тексту/);
  });

  it('кидає помилку коли DOCX взагалі порожній', async () => {
    mockMammothExtractRawText.mockResolvedValueOnce({ value: '', messages: [] });
    await expect(docxToPdf(docxFile(), {})).rejects.toThrow(/не містить тексту/);
  });

  it('кидає помилку коли convertToHtml повертає порожній HTML (граничний випадок)', async () => {
    // extractRawText дав текст, але convertToHtml порожній — рідкісний edge case
    mockMammothConvertToHtml.mockResolvedValueOnce({ value: '', messages: [] });
    await expect(docxToPdf(docxFile(), {})).rejects.toThrow(/HTML/);
  });

  // ── DOM cleanup ──────────────────────────────────────────────────────────

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

  it('кидає помилку коли PDF замалий (< 5 КБ — opacity:0 bug захист)', async () => {
    // Empty html2pdf output (опція з opacity:0 баг або content not rendered)
    // ~ 3-4 КБ. Поріг 5 КБ ловить це до того як адвокат збереже білу сторінку.
    mockOutputResult = new Blob(['%PDF-1.4\nfake-small'], { type: 'application/pdf' });
    await expect(docxToPdf(docxFile(), {})).rejects.toThrow(/занадто малий/);
  });
});
