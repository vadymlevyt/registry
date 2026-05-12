// @vitest-environment jsdom
//
// Юніт-тести htmlToPdf — конвертація HTML файла у PDF Blob.
// html2pdf.js мокаємо: jsdom не має canvas/PDF — тільки контракт перевіряємо.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock html2pdf.js ──────────────────────────────────────────────────────
// Контракт chain: html2pdf().from(el).set(opts).outputPdf('blob') → Promise<Blob>
let mockOutputResult = new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' });

vi.mock('html2pdf.js', () => {
  const chain = {
    from: vi.fn(() => chain),
    set: vi.fn(() => chain),
    outputPdf: vi.fn(() => Promise.resolve(mockOutputResult)),
  };
  return { default: () => chain };
});

import { htmlToPdf } from '../../src/services/converter/htmlToPdf.js';

function htmlFile(content, name = 'doc.html') {
  const buffer = new TextEncoder().encode(content).buffer;
  return new File([buffer], name, { type: 'text/html' });
}

describe('htmlToPdf — конвертація HTML → PDF', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOutputResult = new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' });
  });

  it('повертає pdfBlob і warnings у контракті', async () => {
    const file = htmlFile('<html><body>Тест</body></html>');
    const result = await htmlToPdf(file, {});
    expect(result).toHaveProperty('pdfBlob');
    expect(result).toHaveProperty('warnings');
    expect(result.pdfBlob).toBeInstanceOf(Blob);
    expect(result.pdfBlob.type).toBe('application/pdf');
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('видаляє тимчасовий контейнер з DOM після конвертації (cleanup)', async () => {
    const beforeCount = document.body.children.length;
    const file = htmlFile('<html><body>X</body></html>');
    await htmlToPdf(file, {});
    expect(document.body.children.length).toBe(beforeCount);
  });

  it('кидає помилку коли html2pdf повернув порожній Blob', async () => {
    mockOutputResult = new Blob([], { type: 'application/pdf' });
    const file = htmlFile('<html><body>X</body></html>');
    await expect(htmlToPdf(file, {})).rejects.toThrow(/порожній/);
  });

  it('використовує body content якщо HTML повний документ', async () => {
    const file = htmlFile('<html><head><title>T</title></head><body><p>BODY-ONLY</p></body></html>');
    const result = await htmlToPdf(file, {});
    expect(result.pdfBlob).toBeInstanceOf(Blob);
  });

  it('використовує fragment HTML як є (без body тегу)', async () => {
    const file = htmlFile('<p>Просто параграф</p>');
    const result = await htmlToPdf(file, {});
    expect(result.pdfBlob).toBeInstanceOf(Blob);
  });

  it('викликає html2pdf chain через .from().set().outputPdf("blob")', async () => {
    const html2pdfModule = await import('html2pdf.js');
    const chain = html2pdfModule.default();
    const file = htmlFile('<p>X</p>');
    await htmlToPdf(file, {});
    expect(chain.from).toHaveBeenCalled();
    expect(chain.set).toHaveBeenCalled();
    expect(chain.outputPdf).toHaveBeenCalledWith('blob');
  });
});
