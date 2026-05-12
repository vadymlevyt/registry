// @vitest-environment jsdom
//
// Юніт-тести htmlToPdf — HTML → PDF через pdfLibHtmlRenderer.
// pdfLibHtmlRenderer.htmlToPdfViaPdfLib мокаємо щоб не fetch'ити шрифти у тестах.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock pdfLibHtmlRenderer ────────────────────────────────────────────────
let mockPdfBlob = new Blob(['%PDF-1.4 fake-pdf-from-pdflib'], { type: 'application/pdf' });
const mockHtmlToPdf = vi.fn(async () => mockPdfBlob);

vi.mock('../../src/services/converter/pdfLibHtmlRenderer.js', () => ({
  htmlToPdfViaPdfLib: (html, opts) => mockHtmlToPdf(html, opts),
}));

import { htmlToPdf } from '../../src/services/converter/htmlToPdf.js';

function htmlFile(content, name = 'doc.html') {
  const buffer = new TextEncoder().encode(content).buffer;
  return new File([buffer], name, { type: 'text/html' });
}

function binaryFile(bytes, name = 'doc.html') {
  return new File([new Uint8Array(bytes)], name, { type: 'text/html' });
}

// jsdom innerText може повертати порожнє — підмінюємо на textContent fallback.
function patchInnerText() {
  if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText')) {
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      get() { return this.textContent; },
      configurable: true,
    });
  }
}

// Текст довший за MIN_TEXT_LENGTH (30). Заголовок ухвали або позовної заяви.
const LONG_TEXT = 'Ухвала про відкриття провадження у справі №910/2024';

describe('htmlToPdf — HTML → PDF через pdfLibHtmlRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPdfBlob = new Blob(['%PDF-1.4 fake-pdf-from-pdflib'], { type: 'application/pdf' });
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

  it('передає body innerHTML (з тегами!) у htmlToPdfViaPdfLib', async () => {
    const file = htmlFile(`<html><body><h1>Заголовок</h1><p>${LONG_TEXT}</p></body></html>`);
    await htmlToPdf(file, {});
    expect(mockHtmlToPdf).toHaveBeenCalledOnce();
    const [html] = mockHtmlToPdf.mock.calls[0];
    // ВАЖЛИВО: передаємо HTML з тегами, не plain-текст
    expect(html).toContain('<h1>');
    expect(html).toContain('<p>');
    expect(html).toContain('Заголовок');
  });

  it('видаляє тимчасовий контейнер з DOM після конвертації (cleanup)', async () => {
    const beforeCount = document.body.children.length;
    const file = htmlFile(`<html><body>${LONG_TEXT}</body></html>`);
    await htmlToPdf(file, {});
    expect(document.body.children.length).toBe(beforeCount);
  });

  it('кидає помилку коли pdf-lib повернув порожній Blob', async () => {
    mockPdfBlob = new Blob([], { type: 'application/pdf' });
    const file = htmlFile(`<html><body>${LONG_TEXT}</body></html>`);
    await expect(htmlToPdf(file, {})).rejects.toThrow(/порожній/);
  });

  it('використовує body content якщо HTML повний документ', async () => {
    const file = htmlFile(`<html><head><title>T</title></head><body><p>${LONG_TEXT}</p></body></html>`);
    const result = await htmlToPdf(file, {});
    expect(result.pdfBlob).toBeInstanceOf(Blob);
    expect(result.extractedText).toContain('Ухвала');
    // <head> не передається в рендерер — тільки body
    const [html] = mockHtmlToPdf.mock.calls[0];
    expect(html).not.toContain('<title>');
  });

  it('використовує fragment HTML як є (без body тегу)', async () => {
    const file = htmlFile(`<p>${LONG_TEXT} (фрагмент)</p>`);
    const result = await htmlToPdf(file, {});
    expect(result.pdfBlob).toBeInstanceOf(Blob);
  });

  // ── Валідація вхідного файлу ─────────────────────────────────────────────

  it('кидає чесну помилку для PNG з .html розширенням', async () => {
    const file = binaryFile([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    await expect(htmlToPdf(file, {})).rejects.toThrow(/не є валідним HTML.*PNG/);
    expect(mockHtmlToPdf).not.toHaveBeenCalled();
  });

  it('кидає чесну помилку для PDF з .html розширенням', async () => {
    const file = binaryFile([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    await expect(htmlToPdf(file, {})).rejects.toThrow(/не є валідним HTML.*PDF/);
  });

  it('кидає чесну помилку для DOCX/ZIP з .html розширенням', async () => {
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
