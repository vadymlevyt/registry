// @vitest-environment jsdom
//
// Юніт-тести htmlToPdf — конвертація HTML файла у PDF Blob з валідацією
// бінарних сигнатур і екстракцією plain-тексту через container.innerText.
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

function binaryFile(bytes, name = 'doc.html') {
  return new File([new Uint8Array(bytes)], name, { type: 'text/html' });
}

// jsdom innerText може повертати порожнє — підмінюємо на textContent fallback,
// але для надійних тестів напряму встановлюємо innerText на елементі через
// Object.defineProperty у beforeEach (jsdom default — undefined).
function patchInnerText() {
  if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText')) {
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      get() {
        return this.textContent;
      },
      configurable: true,
    });
  }
}

// Текст довший за MIN_TEXT_LENGTH (30). Заголовок ухвали або позовної заяви.
const LONG_TEXT = 'Ухвала про відкриття провадження у справі №910/2024';

describe('htmlToPdf — конвертація HTML → PDF', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOutputResult = new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' });
    patchInnerText();
  });

  it('повертає pdfBlob, extractedText і warnings у контракті', async () => {
    const file = htmlFile(`<html><body><p>${LONG_TEXT}</p></body></html>`);
    const result = await htmlToPdf(file, {});
    expect(result).toHaveProperty('pdfBlob');
    expect(result).toHaveProperty('extractedText');
    expect(result).toHaveProperty('warnings');
    expect(result.pdfBlob).toBeInstanceOf(Blob);
    expect(result.pdfBlob.type).toBe('application/pdf');
    expect(result.extractedText).toContain('Ухвала');
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('видаляє тимчасовий контейнер з DOM після конвертації (cleanup)', async () => {
    const beforeCount = document.body.children.length;
    const file = htmlFile(`<html><body>${LONG_TEXT}</body></html>`);
    await htmlToPdf(file, {});
    expect(document.body.children.length).toBe(beforeCount);
  });

  it('кидає помилку коли html2pdf повернув порожній Blob', async () => {
    mockOutputResult = new Blob([], { type: 'application/pdf' });
    const file = htmlFile(`<html><body>${LONG_TEXT}</body></html>`);
    await expect(htmlToPdf(file, {})).rejects.toThrow(/порожній/);
  });

  it('використовує body content якщо HTML повний документ', async () => {
    const file = htmlFile(`<html><head><title>T</title></head><body><p>${LONG_TEXT}</p></body></html>`);
    const result = await htmlToPdf(file, {});
    expect(result.pdfBlob).toBeInstanceOf(Blob);
    expect(result.extractedText).toContain('Ухвала');
  });

  it('використовує fragment HTML як є (без body тегу)', async () => {
    const file = htmlFile(`<p>${LONG_TEXT} (фрагмент)</p>`);
    const result = await htmlToPdf(file, {});
    expect(result.pdfBlob).toBeInstanceOf(Blob);
  });

  it('викликає html2pdf chain через .from().set().outputPdf("blob")', async () => {
    const html2pdfModule = await import('html2pdf.js');
    const chain = html2pdfModule.default();
    const file = htmlFile(`<p>${LONG_TEXT}</p>`);
    await htmlToPdf(file, {});
    expect(chain.from).toHaveBeenCalled();
    expect(chain.set).toHaveBeenCalled();
    expect(chain.outputPdf).toHaveBeenCalledWith('blob');
  });

  // ── Валідація вхідного файлу ─────────────────────────────────────────────

  it('кидає чесну помилку для PNG з .html розширенням', async () => {
    // PNG signature: 89 50 4E 47
    const file = binaryFile([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    await expect(htmlToPdf(file, {})).rejects.toThrow(/не є валідним HTML.*PNG/);
  });

  it('кидає чесну помилку для PDF з .html розширенням', async () => {
    // PDF signature: 25 50 44 46 ("%PDF")
    const file = binaryFile([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    await expect(htmlToPdf(file, {})).rejects.toThrow(/не є валідним HTML.*PDF/);
  });

  it('кидає чесну помилку для DOCX/ZIP з .html розширенням', async () => {
    // ZIP signature: 50 4B 03 04
    const file = binaryFile([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
    await expect(htmlToPdf(file, {})).rejects.toThrow(/не є валідним HTML.*ZIP/);
  });

  it('кидає помилку коли HTML порожній (нуль символів)', async () => {
    const file = htmlFile('');
    await expect(htmlToPdf(file, {})).rejects.toThrow(/порожній/);
  });

  it('кидає помилку коли HTML містить менше MIN_TEXT_LENGTH символів тексту', async () => {
    const file = htmlFile('<html><body><p>Привіт</p></body></html>');
    await expect(htmlToPdf(file, {})).rejects.toThrow(/не містить тексту/);
  });
});
