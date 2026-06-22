// Юніт-тест: pdfjsLocal класифікує stored PDF за mimeType, НЕ за розширенням
// імені. Регресія кореня "PDF у бінарному форматі" (case_context.md):
// документ, конвертований з ЄСІТС-HTML, має originalName="X.html", але driveId
// вказує на PDF; extractTextLayer кличе pdfjsLocal.extract з
// mimeType='application/pdf'. Раніше lname.endsWith('.html') перемагав → HTML-
// гілка → TextDecoder(win-1251) на байтах PDF → бінарне сміття. Фікс: явний
// application/pdf вимикає text/html-гілки за іменем.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]); // "%PDF-1.7\n"
const PDF_TEXT = ('ПОСТАНОВА іменем України у справі №450/2275/25 текст достатньої довжини '.repeat(8)).trim();

vi.mock('../../src/services/driveAuth.js', () => ({
  driveRequest: vi.fn(async (url) => {
    if (url.includes('alt=media')) {
      return { ok: true, status: 200, arrayBuffer: async () => PDF_BYTES.buffer };
    }
    return { ok: false, status: 404 };
  }),
}));

const getDocumentMock = vi.fn(() => ({
  promise: Promise.resolve({
    numPages: 1,
    getPage: async () => ({
      getTextContent: async () => ({ items: PDF_TEXT.split(' ').map((w) => ({ str: w + ' ' })) }),
    }),
  }),
}));

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: (...args) => getDocumentMock(...args),
}));

const pdfjsLocal = (await import('../../src/services/ocr/pdfjsLocal.js')).default;

beforeEach(() => getDocumentMock.mockClear());

describe('pdfjsLocal — mimeType пріоритетніший за розширення імені', () => {
  it('name="Постанова.html" + mimeType=application/pdf → PDF-гілка (НЕ бінарне сміття)', async () => {
    const res = await pdfjsLocal.extract({
      id: 'drv_postanova',
      name: 'Постанова.html',
      mimeType: 'application/pdf',
    });
    expect(getDocumentMock).toHaveBeenCalledTimes(1);   // пішов у PDF-гілку
    expect(res.text).toContain('ПОСТАНОВА');
    expect(res.text).not.toContain('%PDF');             // НЕ сирі байти
    expect(res.text).not.toMatch(/stream|FlateDecode/); // НЕ бінарщина
  });

  it('name="X.htm" + mimeType=application/pdf → PDF-гілка', async () => {
    const res = await pdfjsLocal.extract({ id: 'd', name: 'X.htm', mimeType: 'application/pdf' });
    expect(getDocumentMock).toHaveBeenCalledTimes(1);
    expect(res.text).toContain('ПОСТАНОВА');
  });

  it('name="X.txt" + mimeType=application/pdf → PDF-гілка (не text-гілка)', async () => {
    const res = await pdfjsLocal.extract({ id: 'd', name: 'X.txt', mimeType: 'application/pdf' });
    expect(getDocumentMock).toHaveBeenCalledTimes(1);
    expect(res.text).toContain('ПОСТАНОВА');
  });

  it('звичайний PDF name="scan.pdf" → PDF-гілка (без регресії)', async () => {
    const res = await pdfjsLocal.extract({ id: 'd', name: 'scan.pdf', mimeType: 'application/pdf' });
    expect(getDocumentMock).toHaveBeenCalledTimes(1);
    expect(res.text).toContain('ПОСТАНОВА');
  });
});
