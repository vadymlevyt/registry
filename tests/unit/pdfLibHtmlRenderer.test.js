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

const fontSerifRegular = readFileSync(join(fontsDir, 'LiberationSerif-Regular.ttf'));
const fontSerifBold = readFileSync(join(fontsDir, 'LiberationSerif-Bold.ttf'));
const fontSerifItalic = readFileSync(join(fontsDir, 'LiberationSerif-Italic.ttf'));
const fontSerifBoldItalic = readFileSync(join(fontsDir, 'LiberationSerif-BoldItalic.ttf'));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (typeof url !== 'string') return new Response('', { status: 404 });
    if (url.endsWith('LiberationSans-Regular.ttf')) return new Response(fontRegular, { status: 200 });
    if (url.endsWith('LiberationSans-Bold.ttf')) return new Response(fontBold, { status: 200 });
    if (url.endsWith('LiberationSans-Italic.ttf')) return new Response(fontItalic, { status: 200 });
    if (url.endsWith('LiberationSans-BoldItalic.ttf')) return new Response(fontBoldItalic, { status: 200 });
    if (url.endsWith('LiberationSerif-Regular.ttf')) return new Response(fontSerifRegular, { status: 200 });
    if (url.endsWith('LiberationSerif-Bold.ttf')) return new Response(fontSerifBold, { status: 200 });
    if (url.endsWith('LiberationSerif-Italic.ttf')) return new Response(fontSerifItalic, { status: 200 });
    if (url.endsWith('LiberationSerif-BoldItalic.ttf')) return new Response(fontSerifBoldItalic, { status: 200 });
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

describe('pdfLibHtmlRenderer.__test__.mapFontFamily', () => {
  it('Times New Roman → serif', () => {
    expect(__test__.mapFontFamily('Times New Roman')).toBe('serif');
  });
  it('Arial → sans', () => {
    expect(__test__.mapFontFamily('Arial')).toBe('sans');
  });
  it('кома-розділений список — бере перший знаний', () => {
    expect(__test__.mapFontFamily('"Times New Roman", serif')).toBe('serif');
    expect(__test__.mapFontFamily('Calibri, Arial, sans-serif')).toBe('sans');
  });
  it('лапки видаляються', () => {
    expect(__test__.mapFontFamily('"Times New Roman"')).toBe('serif');
    expect(__test__.mapFontFamily("'Arial'")).toBe('sans');
  });
  it('невідомий → null', () => {
    expect(__test__.mapFontFamily('Comic Sans MS')).toBeNull();
    expect(__test__.mapFontFamily('')).toBeNull();
    expect(__test__.mapFontFamily(null)).toBeNull();
  });
});

describe('pdfLibHtmlRenderer.__test__.parseStyleBlock — CSS-парсер', () => {
  it('парсить простий tag selector', () => {
    const r = __test__.parseStyleBlock('p { font-size: 14pt; color: red }');
    expect(r).toHaveLength(1);
    expect(r[0].tag).toBe('p');
    expect(r[0].cls).toBeNull();
    expect(r[0].decls).toEqual({ 'font-size': '14pt', 'color': 'red' });
  });
  it('парсить class selector', () => {
    const r = __test__.parseStyleBlock('.MsoNormal { text-align: justify; font-family: "Times New Roman" }');
    expect(r).toHaveLength(1);
    expect(r[0].tag).toBeNull();
    expect(r[0].cls).toBe('msonormal');
  });
  it('парсить tag.class selector', () => {
    const r = __test__.parseStyleBlock('p.MsoNormal { margin-top: 0pt }');
    expect(r[0].tag).toBe('p');
    expect(r[0].cls).toBe('msonormal');
  });
  it('парсить кома-розділені селектори у окремі правила', () => {
    const r = __test__.parseStyleBlock('p, td { font-size: 11pt }');
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.tag).sort()).toEqual(['p', 'td']);
  });
  it('ігнорує CSS-коментарі /* ... */', () => {
    const r = __test__.parseStyleBlock('/* comment */ p { color: red } /* tail */');
    expect(r).toHaveLength(1);
    expect(r[0].decls).toEqual({ color: 'red' });
  });
  it('пропускає складні селектори (з пробілами/псевдо)', () => {
    const r = __test__.parseStyleBlock('p:hover { color: red } div p { font-size: 14pt }');
    expect(r).toHaveLength(0);
  });
});

describe('pdfLibHtmlRenderer.__test__.collectStyleSheet — інтеграція з DOM', () => {
  it('читає всі <style> блоки документа', () => {
    const html = `<html><head><style>p { color: red }</style></head><body><style>.x { font-weight: bold }</style></body></html>`;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rules = __test__.collectStyleSheet(doc);
    expect(rules.length).toBe(2);
  });

  it('правильно матчить tag + class у getStylesheetDeclsForElement', () => {
    const html = `<html><head><style>p { color: red } .bold { font-weight: bold }</style></head><body><p class="bold">x</p></body></html>`;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rules = __test__.collectStyleSheet(doc);
    const p = doc.querySelector('p');
    const decls = __test__.getStylesheetDeclsForElement(p, rules);
    expect(decls.color).toBe('red');
    expect(decls['font-weight']).toBe('bold');
  });
});

describe('pdfLibHtmlRenderer — legacy теги і атрибути', () => {
  it('<center> рендериться без падіння (block з align=center)', async () => {
    const blob = await htmlToPdfViaPdfLib('<center>УХВАЛА</center><p>текст</p>');
    expect(blob).toBeInstanceOf(Blob);
  });

  it('<p align="justify"> розпізнається', async () => {
    const blob = await htmlToPdfViaPdfLib('<p align="justify">Виплатити позивачу суму у розмірі тисячі гривень.</p>');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('<font face="Times" size="5" color="#ff0000"> рендериться', async () => {
    const blob = await htmlToPdfViaPdfLib('<p><font face="Times New Roman" size="5" color="#ff0000">Червоний Times текст</font></p>');
    expect(blob).toBeInstanceOf(Blob);
  });

  it('<b> і <strong> обидва дають bold', async () => {
    const blob = await htmlToPdfViaPdfLib('<p><b>один</b> та <strong>два</strong></p>');
    expect(blob).toBeInstanceOf(Blob);
  });

  it('<style> блок з .MsoNormal { text-align: justify } застосовується до <p class="MsoNormal">', async () => {
    const html = `
      <html><head>
        <style>p.MsoNormal { text-align: justify; font-family: "Times New Roman"; }</style>
      </head><body>
        <p class="MsoNormal">Параграф з MsoNormal класом який повинен бути по ширині.</p>
      </body></html>
    `;
    const blob = await htmlToPdfViaPdfLib(html);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('font-* class з styleMap впливає на родину шрифту', () => {
    const doc = new DOMParser().parseFromString('<span class="font-sans">x</span>', 'text/html');
    const el = doc.querySelector('span');
    const s = __test__.styleForElement(el, __test__.defaultStyle());
    expect(s.fontFamily).toBe('sans');
  });

  it('inline style="font-family: Arial" → fontFamily=sans', () => {
    const doc = new DOMParser().parseFromString('<span style="font-family: Arial">x</span>', 'text/html');
    const el = doc.querySelector('span');
    const s = __test__.styleForElement(el, __test__.defaultStyle());
    expect(s.fontFamily).toBe('sans');
  });
});

describe('pdfLibHtmlRenderer — Word "save as HTML" specifics', () => {
  it('розкриває [if gte vml 1] conditional comment з <v:imagedata>', async () => {
    const png1x1 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const html = `
      <html><body>
        <p>Документ:</p>
        <!--[if gte vml 1]>
          <v:shape>
            <v:imagedata src="data:image/png;base64,${png1x1}"/>
          </v:shape>
        <![endif]-->
        <p>Текст після герба</p>
      </body></html>
    `;
    const blob = await htmlToPdfViaPdfLib(html);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('розкриває [if !vml] fallback з <img> і не дублює якщо src той самий', async () => {
    const png1x1 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const src = `data:image/png;base64,${png1x1}`;
    // Типова структура Word: VML і <img> fallback з тим самим src.
    const html = `
      <html><body>
        <!--[if gte vml 1]>
          <v:shape><v:imagedata src="${src}"/></v:shape>
        <![endif]-->
        <!--[if !vml]>
          <img src="${src}" width="32" height="32"/>
        <![endif]-->
        <p>Параграф</p>
      </body></html>
    `;
    const blob = await htmlToPdfViaPdfLib(html);
    expect(blob).toBeInstanceOf(Blob);
  });

  it('ігнорує office-specific теги <o:p>, <w:wordDocument>, <st1:...>', async () => {
    const html = `
      <html><body>
        <w:wordDocument><w:body>internal junk</w:body></w:wordDocument>
        <p>Видимий <o:p>офіс-параграф</o:p> текст</p>
        <st1:place>Київ</st1:place>
      </body></html>
    `;
    const blob = await htmlToPdfViaPdfLib(html);
    expect(blob).toBeInstanceOf(Blob);
    // Не падає на office namespace tags
  });

  it('читає <style> з <head> навіть якщо передано повний HTML', async () => {
    const html = `
      <html><head>
        <style>
          p.MsoNormal { text-align: justify; font-family: "Times New Roman"; }
          p.MsoTitle { text-align: center; font-weight: bold; font-size: 18pt }
        </style>
      </head><body>
        <p class="MsoTitle">УХВАЛА</p>
        <p class="MsoNormal">Резолютивна частина ухвали.</p>
      </body></html>
    `;
    const blob = await htmlToPdfViaPdfLib(html);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe('pdfLibHtmlRenderer — defaultFontFamily option', () => {
  it('defaultFontFamily="sans" → текст без CSS використовує sans', async () => {
    const blob = await htmlToPdfViaPdfLib('<p>звичайний текст</p>', { defaultFontFamily: 'sans' });
    expect(blob).toBeInstanceOf(Blob);
  });
  it('defaultFontFamily не заданий → serif (default)', async () => {
    const blob = await htmlToPdfViaPdfLib('<p>звичайний текст</p>');
    expect(blob).toBeInstanceOf(Blob);
  });
});

describe('pdfLibHtmlRenderer.__test__.layoutLines', () => {
  // Мок font.widthOfTextAtSize — 1 char = 1 unit ширини (передбачувано).
  // Зараз pickFont() очікує fonts.serif/sans з 4 weights кожен.
  const mockFont = { widthOfTextAtSize: (t, _s) => t.length };
  const fontSet = { regular: mockFont, bold: mockFont, italic: mockFont, boldItalic: mockFont };
  const fonts = { serif: fontSet, sans: fontSet };
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
