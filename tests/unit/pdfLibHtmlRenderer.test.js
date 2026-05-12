// @vitest-environment jsdom
//
// Юніт-тести pdfLibHtmlRenderer — HTML → PDF через pdf-lib з 4 шрифтами.
// Тестуємо:
//   - парсинг inline CSS (parseInlineStyle, parseLength, parseColor)
//   - визначення стилю елемента з ієрархії (теги → класи → inline)
//   - walkDom: побудова дерева блоків з HTML
//   - layoutLines: word-wrap і обробка довгих слів
//   - інтеграція з реальним pdf-lib + TTF з public/fonts (з мок'нутим fetch).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const fontsDir = join(process.cwd(), 'public/fonts');
const fontRegular = readFileSync(join(fontsDir, 'LiberationSans-Regular.ttf'));
const fontBold = readFileSync(join(fontsDir, 'LiberationSans-Bold.ttf'));
const fontItalic = readFileSync(join(fontsDir, 'LiberationSans-Italic.ttf'));
const fontBoldItalic = readFileSync(join(fontsDir, 'LiberationSans-BoldItalic.ttf'));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (typeof url !== 'string') return new Response('', { status: 404 });
    if (url.endsWith('LiberationSans-Regular.ttf')) return new Response(fontRegular, { status: 200 });
    if (url.endsWith('LiberationSans-Bold.ttf')) return new Response(fontBold, { status: 200 });
    if (url.endsWith('LiberationSans-Italic.ttf')) return new Response(fontItalic, { status: 200 });
    if (url.endsWith('LiberationSans-BoldItalic.ttf')) return new Response(fontBoldItalic, { status: 200 });
    return new Response('', { status: 404 });
  }));
});

import { htmlToPdfViaPdfLib, __test__ } from '../../src/services/converter/pdfLibHtmlRenderer.js';

describe('pdfLibHtmlRenderer.htmlToPdfViaPdfLib — інтеграція з pdf-lib', () => {
  it('повертає валідний PDF Blob з ненульовим розміром для простого HTML', async () => {
    const html = '<p>Це короткий абзац з текстом для тестування.</p>';
    const blob = await htmlToPdfViaPdfLib(html);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('PDF починається з валідного header %PDF-', async () => {
    const blob = await htmlToPdfViaPdfLib('<p>Достатньо тексту щоб згенерувати PDF</p>');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const header = String.fromCharCode(...bytes.slice(0, 5));
    expect(header).toBe('%PDF-');
  });

  it('кирилиця рендериться без падіння (повна підтримка LiberationSans)', async () => {
    const html = '<p>Іїєґ — це українські літери. «Лапки» і тире — теж.</p>';
    const blob = await htmlToPdfViaPdfLib(html);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(1024);
  });

  it('заголовки h1-h6 рендеряться без падіння', async () => {
    const html = '<h1>Заголовок 1</h1><h2>Заголовок 2</h2><p>Текст абзацу.</p>';
    const blob = await htmlToPdfViaPdfLib(html);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('жирний/курсив/підкреслення рендериться без падіння', async () => {
    const html = '<p>Звичайний <b>жирний</b> <i>курсив</i> <u>підкреслений</u> текст.</p>';
    const blob = await htmlToPdfViaPdfLib(html);
    expect(blob).toBeInstanceOf(Blob);
  });

  it('вирівнювання justify/center/right через class рендериться', async () => {
    const html = `
      <p class="align-justify">Justify абзац з текстом.</p>
      <p class="align-center">Центрований абзац.</p>
      <p class="align-right">Праве вирівнювання абзацу.</p>
    `;
    const blob = await htmlToPdfViaPdfLib(html);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('вирівнювання через inline style="text-align:..." рендериться', async () => {
    const html = `
      <p style="text-align: center;">Центр inline</p>
      <p style="text-align: right;">Право inline</p>
    `;
    const blob = await htmlToPdfViaPdfLib(html);
    expect(blob).toBeInstanceOf(Blob);
  });

  it('списки ul/ol рендеряться з маркерами без падіння', async () => {
    const html = `
      <ul><li>Перший пункт</li><li>Другий пункт</li></ul>
      <ol><li>Перший</li><li>Другий</li></ol>
    `;
    const blob = await htmlToPdfViaPdfLib(html);
    expect(blob).toBeInstanceOf(Blob);
  });

  it('проста таблиця рендериться без падіння', async () => {
    const html = `
      <table>
        <tr><th>Колонка 1</th><th>Колонка 2</th></tr>
        <tr><td>A1</td><td>B1</td></tr>
        <tr><td>A2</td><td>B2</td></tr>
      </table>
    `;
    const blob = await htmlToPdfViaPdfLib(html);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('довгий HTML розбивається на кілька сторінок', async () => {
    const longBody = '<p>Це довгий абзац для тестування пагінації. Українська мова.</p>'.repeat(120);
    const blob = await htmlToPdfViaPdfLib(longBody);
    expect(blob.size).toBeGreaterThan(10 * 1024);
  });

  it('гіперпосилання a[href] рендериться (синім кольором + анотація)', async () => {
    const html = '<p>Дивіться <a href="https://example.com">тут</a> більше інформації про справу.</p>';
    const blob = await htmlToPdfViaPdfLib(html);
    expect(blob).toBeInstanceOf(Blob);
  });

  it('hr рендериться як горизонтальна лінія', async () => {
    const html = '<p>Перед лінією</p><hr><p>Після лінії</p>';
    const blob = await htmlToPdfViaPdfLib(html);
    expect(blob).toBeInstanceOf(Blob);
  });

  it('кидає помилку для порожнього або не-рядкового вводу', async () => {
    await expect(htmlToPdfViaPdfLib('')).rejects.toThrow();
    await expect(htmlToPdfViaPdfLib(null)).rejects.toThrow();
    await expect(htmlToPdfViaPdfLib(undefined)).rejects.toThrow();
  });

  it('embed PNG зображення з data: URI (герб у ЄСІТС-ухвалі)', async () => {
    // 1x1 transparent PNG для тесту embed-логіки
    const png1x1 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const html = `<p>Документ з гербом</p><img src="data:image/png;base64,${png1x1}" width="32" height="32"><p>Текст після зображення.</p>`;
    const blob = await htmlToPdfViaPdfLib(html);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe('pdfLibHtmlRenderer.__test__.parseInlineStyle', () => {
  it('парсить простий CSS у словник', () => {
    const r = __test__.parseInlineStyle('font-weight: bold; color: red; margin-left: 20px');
    expect(r).toEqual({ 'font-weight': 'bold', 'color': 'red', 'margin-left': '20px' });
  });
  it('повертає порожній обʼєкт для порожнього або undefined', () => {
    expect(__test__.parseInlineStyle('')).toEqual({});
    expect(__test__.parseInlineStyle(undefined)).toEqual({});
  });
  it('пропускає декларації без двокрапки', () => {
    expect(__test__.parseInlineStyle('font-weight bold; color: red')).toEqual({ color: 'red' });
  });
});

describe('pdfLibHtmlRenderer.__test__.parseLength', () => {
  it('повертає px у pt: 16px = 12pt', () => {
    expect(__test__.parseLength('16px')).toBeCloseTo(12, 2);
  });
  it('повертає pt напряму', () => {
    expect(__test__.parseLength('14pt')).toBe(14);
  });
  it('конвертує mm у pt', () => {
    expect(__test__.parseLength('10mm')).toBeCloseTo(28.346, 1);
  });
  it('em множиться на base', () => {
    expect(__test__.parseLength('2em', 0, 12)).toBe(24);
  });
  it('% від base', () => {
    expect(__test__.parseLength('150%', 0, 12)).toBe(18);
  });
  it('повертає fallback для невалідного вводу', () => {
    expect(__test__.parseLength('xyz', 99)).toBe(99);
    expect(__test__.parseLength(null, 5)).toBe(5);
  });
});

describe('pdfLibHtmlRenderer.__test__.parseColor', () => {
  it('парсить hex #RRGGBB', () => {
    const c = __test__.parseColor('#ff0000');
    expect(c.r).toBeCloseTo(1, 2);
    expect(c.g).toBeCloseTo(0, 2);
    expect(c.b).toBeCloseTo(0, 2);
  });
  it('парсить short hex #RGB', () => {
    const c = __test__.parseColor('#f00');
    expect(c.r).toBeCloseTo(1, 2);
    expect(c.g).toBeCloseTo(0, 2);
    expect(c.b).toBeCloseTo(0, 2);
  });
  it('парсить rgb(...)', () => {
    const c = __test__.parseColor('rgb(255, 128, 0)');
    expect(c.r).toBeCloseTo(1, 2);
    expect(c.g).toBeCloseTo(0.502, 2);
    expect(c.b).toBeCloseTo(0, 2);
  });
  it('парсить keyword', () => {
    const c = __test__.parseColor('red');
    expect(c.r).toBeCloseTo(1, 2);
    expect(c.g).toBeCloseTo(0, 2);
  });
  it('повертає null для невалідного', () => {
    expect(__test__.parseColor('not-a-color')).toBeNull();
    expect(__test__.parseColor('')).toBeNull();
    expect(__test__.parseColor('transparent')).toBeNull();
  });
});

describe('pdfLibHtmlRenderer.__test__.styleForElement', () => {
  function elFromHtml(html) {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    return doc.body.firstChild;
  }
  it('тег b → bold', () => {
    const el = elFromHtml('<b>x</b>');
    const s = __test__.styleForElement(el, __test__.defaultStyle());
    expect(s.bold).toBe(true);
  });
  it('тег i → italic', () => {
    const el = elFromHtml('<i>x</i>');
    const s = __test__.styleForElement(el, __test__.defaultStyle());
    expect(s.italic).toBe(true);
  });
  it('тег h2 → bold + збільшений fontSize', () => {
    const el = elFromHtml('<h2>x</h2>');
    const s = __test__.styleForElement(el, __test__.defaultStyle());
    expect(s.bold).toBe(true);
    expect(s.fontSize).toBeGreaterThan(__test__.defaultStyle().fontSize);
  });
  it('clas align-justify → align justify', () => {
    const el = elFromHtml('<p class="align-justify">x</p>');
    const s = __test__.styleForElement(el, __test__.defaultStyle());
    expect(s.align).toBe('justify');
  });
  it('inline style="text-align:right" → align right', () => {
    const el = elFromHtml('<p style="text-align:right">x</p>');
    const s = __test__.styleForElement(el, __test__.defaultStyle());
    expect(s.align).toBe('right');
  });
  it('inline font-weight:bold → bold', () => {
    const el = elFromHtml('<span style="font-weight:bold">x</span>');
    const s = __test__.styleForElement(el, __test__.defaultStyle());
    expect(s.bold).toBe(true);
  });
  it('a[href] → синій колір + underline + linkHref', () => {
    const el = elFromHtml('<a href="https://example.com">x</a>');
    const s = __test__.styleForElement(el, __test__.defaultStyle());
    expect(s.underline).toBe(true);
    expect(s.linkHref).toBe('https://example.com');
    expect(s.color.b).toBeGreaterThan(0.5);
  });
});

describe('pdfLibHtmlRenderer.__test__.layoutLines', () => {
  // Мок font.widthOfTextAtSize — 1 char = 1 unit ширини (передбачувано).
  const fonts = {
    regular: { widthOfTextAtSize: (t, _s) => t.length },
    bold: { widthOfTextAtSize: (t, _s) => t.length },
    italic: { widthOfTextAtSize: (t, _s) => t.length },
    boldItalic: { widthOfTextAtSize: (t, _s) => t.length },
  };
  function defaultStyle() { return __test__.defaultStyle(); }

  it('коротка фраза влізає в один рядок', () => {
    const segs = __test__.flattenRunsToSegments(
      [{ text: 'Привіт світ', style: defaultStyle() }],
      fonts, 100
    );
    const lines = __test__.layoutLines(segs, fonts, 100);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0].segments.some((s) => s.text === 'Привіт')).toBe(true);
  });

  it('довге слово розбивається посимвольно', () => {
    const word = 'A'.repeat(50);
    const segs = __test__.flattenRunsToSegments(
      [{ text: word, style: defaultStyle() }],
      fonts, 10
    );
    const lines = __test__.layoutLines(segs, fonts, 10);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      const lineText = line.segments.map((s) => s.text).join('');
      expect(lineText.length).toBeLessThanOrEqual(10);
    }
  });

  it('<br> створює форсований break', () => {
    const segs = __test__.flattenRunsToSegments(
      [
        { text: 'Перший', style: defaultStyle() },
        { forceBreak: true, style: defaultStyle() },
        { text: 'Другий', style: defaultStyle() },
      ],
      fonts, 100
    );
    const lines = __test__.layoutLines(segs, fonts, 100);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });
});
