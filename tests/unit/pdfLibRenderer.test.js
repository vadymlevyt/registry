// @vitest-environment jsdom
//
// Юніт-тести pdfLibRenderer — PDF generation через pdf-lib з custom font.
// Тестуємо word-wrap логіку (синхронно, без fetch) і базовий integration з
// pdf-lib (з реальним TTF з node_modules — fetch мокаємо).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Mock fetch для шрифту — повертаємо реальний TTF з public/fonts (Vite копіює
// з node_modules туди вручну). Тести бачать той самий байтовий вміст що
// production.
const fontPath = join(process.cwd(), 'public/fonts/LiberationSans-Regular.ttf');
const fontBytes = readFileSync(fontPath);

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (typeof url === 'string' && url.endsWith('LiberationSans-Regular.ttf')) {
      return new Response(fontBytes, { status: 200 });
    }
    return new Response('', { status: 404 });
  }));
});

import { textToPdf, __test__ } from '../../src/services/converter/pdfLibRenderer.js';

describe('pdfLibRenderer.textToPdf', () => {
  it('повертає валідний PDF Blob з ненульовим розміром', async () => {
    const text = 'Позовна заява про стягнення коштів. ' +
      'Я, Петренко Іван Іванович, звертаюсь до суду з позовом.';
    const blob = await textToPdf(text);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('кирилиця рендериться без падіння (LiberationSans підтримує Cyrillic)', async () => {
    const text = 'Іїєґ — це українські літери. «Лапки» і тире — теж.';
    const blob = await textToPdf(text);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(1024); // PDF з текстом ~5+ КБ
  });

  it('PDF починається з валідного header %PDF-', async () => {
    const blob = await textToPdf('Достатньо тексту щоб згенерувати PDF документ');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const header = String.fromCharCode(...bytes.slice(0, 5));
    expect(header).toBe('%PDF-');
  });

  it('довгий текст розбивається на кілька сторінок', async () => {
    // 200 повторів — точно більше за одну А4 сторінку
    const longText = ('Це довгий текст для тестування пагінації. ').repeat(200);
    const blob = await textToPdf(longText);
    // PDF з кількома сторінками значно більший за PDF з однією
    expect(blob.size).toBeGreaterThan(10 * 1024);
  });

  it('текст з \\n\\n розбивається на абзаци (рендер не падає)', async () => {
    const text = 'Перший абзац позовної заяви.\n\nДругий абзац з обґрунтуванням.\n\nТретій абзац з вимогами.';
    const blob = await textToPdf(text);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('кастомні margin/fontSize приймаються', async () => {
    const text = 'Тестовий текст для перевірки опцій рендеру.';
    const blob = await textToPdf(text, { fontSize: 14, marginLeft: 50 });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe('pdfLibRenderer.__test__.wrapLine — word-wrap логіка', () => {
  // Мок font.widthOfTextAtSize — поведінка "1 char = 1 unit ширини" для
  // передбачуваності тестів.
  const mockFont = {
    widthOfTextAtSize: (text, _size) => text.length,
  };

  it('коротка фраза влізає в один рядок', () => {
    const lines = __test__.wrapLine('Привіт світ', mockFont, 12, 100);
    expect(lines).toEqual(['Привіт світ']);
  });

  it('довга фраза розбивається за словами', () => {
    const text = 'Один два три чотири пʼять шість сім вісім дев\'ять десять';
    // ширина 20 → 'Один два три чотири' (19) влазить, далі 'пʼять шість...' тощо.
    const lines = __test__.wrapLine(text, mockFont, 12, 20);
    expect(lines.length).toBeGreaterThan(1);
    // Жоден рядок не перевищує ширину 20
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(20);
    }
  });

  it('одне дуже довге слово розбивається посимвольно', () => {
    const word = 'A'.repeat(50);
    const lines = __test__.wrapLine(word, mockFont, 12, 10);
    expect(lines.length).toBe(5);
    expect(lines.every((l) => l.length <= 10)).toBe(true);
  });

  it('порожній рядок повертає масив з одним порожнім елементом', () => {
    const lines = __test__.wrapLine('', mockFont, 12, 100);
    expect(lines).toEqual(['']);
  });
});
