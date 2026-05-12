// @vitest-environment jsdom
//
// Юніт-тести docxToPdf — DOCX → PDF через mammoth.convertToHtml + pdfLibHtmlRenderer.
// pdfLibHtmlRenderer.htmlToPdfViaPdfLib мокаємо щоб не fetch'ити шрифти у тестах.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock mammoth ───────────────────────────────────────────────────────────
const mockConvertToHtml = vi.fn();
const mockExtractRawText = vi.fn();
const mockImgElement = (fn) => ({ __img: fn });

vi.mock('mammoth/mammoth.browser.js', () => ({
  default: {
    convertToHtml: (opts, conf) => mockConvertToHtml(opts, conf),
    extractRawText: (opts) => mockExtractRawText(opts),
    images: { imgElement: mockImgElement },
  },
  convertToHtml: (opts, conf) => mockConvertToHtml(opts, conf),
  extractRawText: (opts) => mockExtractRawText(opts),
  images: { imgElement: mockImgElement },
}));

// ── Mock pdfLibHtmlRenderer ────────────────────────────────────────────────
let mockPdfBlob = new Blob(['%PDF-1.4 fake-pdf-from-pdflib'], { type: 'application/pdf' });
const mockHtmlToPdf = vi.fn(async () => mockPdfBlob);

vi.mock('../../src/services/converter/pdfLibHtmlRenderer.js', () => ({
  htmlToPdfViaPdfLib: (html, opts) => mockHtmlToPdf(html, opts),
}));

import { docxToPdf, __test__ as docxTest } from '../../src/services/converter/docxToPdf.js';

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
const LONG_HTML = `<h1>Позовна заява</h1><p class="align-justify">${LONG_TEXT}</p>`;

describe('docxToPdf — DOCX → PDF через mammoth.convertToHtml + pdfLibHtmlRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPdfBlob = new Blob(['%PDF-1.4 fake-pdf-from-pdflib'], { type: 'application/pdf' });
    mockConvertToHtml.mockResolvedValue({ value: LONG_HTML, messages: [] });
    mockExtractRawText.mockResolvedValue({ value: LONG_TEXT, messages: [] });
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

  it('викликає convertToHtml зі styleMap, convertImage, transformDocument', async () => {
    await docxToPdf(docxFile(), {});
    expect(mockConvertToHtml).toHaveBeenCalledOnce();
    const [opts, conf] = mockConvertToHtml.mock.calls[0];
    expect(opts).toEqual(expect.objectContaining({ arrayBuffer: expect.any(ArrayBuffer) }));
    expect(conf).toHaveProperty('styleMap');
    expect(Array.isArray(conf.styleMap)).toBe(true);
    expect(conf.styleMap.some((s) => s.includes('align-justify'))).toBe(true);
    expect(conf.styleMap.some((s) => s.includes('font-sans'))).toBe(true);
    expect(conf.styleMap.some((s) => s.includes('font-serif'))).toBe(true);
    expect(conf).toHaveProperty('convertImage');
    expect(conf).toHaveProperty('transformDocument');
    expect(typeof conf.transformDocument).toBe('function');
  });

  it('передає defaultFontFamily:serif у pdfLibHtmlRenderer (Word default = Times-like)', async () => {
    await docxToPdf(docxFile(), {});
    expect(mockHtmlToPdf).toHaveBeenCalledOnce();
    const [, opts] = mockHtmlToPdf.mock.calls[0];
    expect(opts).toEqual(expect.objectContaining({ defaultFontFamily: 'serif' }));
  });

  it('викликає extractRawText паралельно для .txt кеша', async () => {
    await docxToPdf(docxFile(), {});
    expect(mockExtractRawText).toHaveBeenCalledOnce();
  });

  it('передає згенерований HTML у htmlToPdfViaPdfLib', async () => {
    await docxToPdf(docxFile(), {});
    expect(mockHtmlToPdf).toHaveBeenCalledOnce();
    const [html] = mockHtmlToPdf.mock.calls[0];
    expect(html).toBe(LONG_HTML);
  });

  it('передає mammoth warnings (унікальні) у результат', async () => {
    mockConvertToHtml.mockResolvedValueOnce({
      value: LONG_HTML,
      messages: [
        { type: 'warning', message: 'Unrecognised numbering style: 1' },
        { type: 'info', message: 'Style applied' }, // не warning — ігноруємо
        { type: 'warning', message: 'Unrecognised numbering style: 1' }, // дубль — фільтрується
      ],
    });
    const result = await docxToPdf(docxFile(), {});
    const numberingWarnings = result.warnings.filter((w) => w.includes('Unrecognised numbering'));
    expect(numberingWarnings.length).toBe(1); // дубль відфільтровано
  });

  // ── Валідація вхідного файлу ─────────────────────────────────────────────

  it('кидає чесну помилку коли файл не має ZIP-сигнатури', async () => {
    await expect(docxToPdf(nonZipFile(), {})).rejects.toThrow(/не є валідним DOCX/);
    // mammoth НЕ викликаний — провалидовано до завантаження бібліотеки
    expect(mockConvertToHtml).not.toHaveBeenCalled();
    expect(mockExtractRawText).not.toHaveBeenCalled();
    expect(mockHtmlToPdf).not.toHaveBeenCalled();
  });

  it('кидає чесну помилку коли mammoth падає на пошкодженому DOCX', async () => {
    mockConvertToHtml.mockRejectedValueOnce(new Error('zip parse error'));
    await expect(docxToPdf(docxFile(), {})).rejects.toThrow(/може бути пошкоджений/);
    expect(mockHtmlToPdf).not.toHaveBeenCalled();
  });

  it('кидає чесну помилку коли DOCX містить менше MIN_TEXT_LENGTH символів', async () => {
    mockExtractRawText.mockResolvedValueOnce({ value: 'Привіт', messages: [] });
    await expect(docxToPdf(docxFile(), {})).rejects.toThrow(/не містить тексту/);
    expect(mockHtmlToPdf).not.toHaveBeenCalled();
  });

  it('кидає помилку коли DOCX взагалі порожній', async () => {
    mockExtractRawText.mockResolvedValueOnce({ value: '', messages: [] });
    await expect(docxToPdf(docxFile(), {})).rejects.toThrow(/не містить тексту/);
  });

  it('кидає помилку коли HTML рендерер повернув порожній blob', async () => {
    mockPdfBlob = new Blob([], { type: 'application/pdf' });
    await expect(docxToPdf(docxFile(), {})).rejects.toThrow(/порожній/);
  });

  it('кидає помилку якщо pdfLibHtmlRenderer падає (наприклад шрифт не завантажився)', async () => {
    mockHtmlToPdf.mockRejectedValueOnce(new Error('Font fetch failed'));
    await expect(docxToPdf(docxFile(), {})).rejects.toThrow(/Не вдалось згенерувати PDF/);
  });

  it('кидає помилку коли mammoth повернув порожній HTML', async () => {
    mockConvertToHtml.mockResolvedValueOnce({ value: '', messages: [] });
    await expect(docxToPdf(docxFile(), {})).rejects.toThrow(/порожній результат mammoth/);
  });
});

describe('docxToPdf.__test__ — transformDocument', () => {
  const { alignmentToStyleName, mapDocxFontFamily, makeTransformDocument } = docxTest;

  it('alignmentToStyleName: both/justify → AlignJustify', () => {
    expect(alignmentToStyleName('both')).toBe('AlignJustify');
    expect(alignmentToStyleName('justify')).toBe('AlignJustify');
    expect(alignmentToStyleName('distribute')).toBe('AlignJustify');
  });
  it('alignmentToStyleName: center → AlignCenter, right → AlignRight, left → AlignLeft', () => {
    expect(alignmentToStyleName('center')).toBe('AlignCenter');
    expect(alignmentToStyleName('right')).toBe('AlignRight');
    expect(alignmentToStyleName('end')).toBe('AlignRight');
    expect(alignmentToStyleName('left')).toBe('AlignLeft');
    expect(alignmentToStyleName('start')).toBe('AlignLeft');
  });
  it('alignmentToStyleName: невідоме → null', () => {
    expect(alignmentToStyleName('')).toBeNull();
    expect(alignmentToStyleName(null)).toBeNull();
    expect(alignmentToStyleName('unknown')).toBeNull();
  });

  it('mapDocxFontFamily: Times New Roman → serif', () => {
    expect(mapDocxFontFamily('Times New Roman')).toBe('serif');
    expect(mapDocxFontFamily('Cambria')).toBe('serif');
    expect(mapDocxFontFamily('Georgia')).toBe('serif');
  });
  it('mapDocxFontFamily: Arial/Calibri/Verdana → sans', () => {
    expect(mapDocxFontFamily('Arial')).toBe('sans');
    expect(mapDocxFontFamily('Calibri')).toBe('sans');
    expect(mapDocxFontFamily('Verdana')).toBe('sans');
  });
  it('mapDocxFontFamily: невідомий → null', () => {
    expect(mapDocxFontFamily(null)).toBeNull();
    expect(mapDocxFontFamily('')).toBeNull();
    expect(mapDocxFontFamily('Comic Sans')).toBeNull(); // у нас немає mapping
  });

  it('transformDocument: paragraph з alignment=both → styleName=AlignJustify', () => {
    const transform = makeTransformDocument();
    const doc = {
      type: 'document',
      children: [
        { type: 'paragraph', alignment: 'both', styleName: null, children: [] },
        { type: 'paragraph', alignment: 'center', styleName: null, children: [] },
        { type: 'paragraph', alignment: 'right', styleName: null, children: [] },
        { type: 'paragraph', alignment: null, styleName: null, children: [] },
      ],
    };
    const transformed = transform(doc);
    expect(transformed.children[0].styleName).toBe('AlignJustify');
    expect(transformed.children[1].styleName).toBe('AlignCenter');
    expect(transformed.children[2].styleName).toBe('AlignRight');
    expect(transformed.children[3].styleName).toBeNull();
  });

  it('transformDocument: НЕ перезаписує існуючий styleName (Heading тощо)', () => {
    const transform = makeTransformDocument();
    const doc = {
      type: 'document',
      children: [
        { type: 'paragraph', alignment: 'both', styleName: 'Heading 1', children: [] },
      ],
    };
    const transformed = transform(doc);
    expect(transformed.children[0].styleName).toBe('Heading 1'); // не перезаписане
  });

  it('transformDocument: run з font="Times New Roman" → styleName=FontSerif', () => {
    const transform = makeTransformDocument();
    const doc = {
      type: 'document',
      children: [
        {
          type: 'paragraph',
          alignment: null,
          styleName: null,
          children: [
            { type: 'run', font: 'Times New Roman', styleName: null, children: [] },
            { type: 'run', font: 'Arial', styleName: null, children: [] },
            { type: 'run', font: null, styleName: null, children: [] },
          ],
        },
      ],
    };
    const transformed = transform(doc);
    const runs = transformed.children[0].children;
    expect(runs[0].styleName).toBe('FontSerif');
    expect(runs[1].styleName).toBe('FontSans');
    expect(runs[2].styleName).toBeNull();
  });
});

