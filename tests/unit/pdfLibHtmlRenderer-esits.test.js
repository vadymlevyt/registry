// @vitest-environment jsdom
//
// Snapshot тести pdfLibHtmlRenderer на реальних HTML-документах з ЄСІТС.
//
// Файли у test_files/esits_samples/ — реальні зразки від адвоката. Тести
// читають Windows-1251 байти, декодують у UTF-8, рендерять у PDF і
// перевіряють що:
//   - PDF згенерований успішно (не порожній, валідний PDF header)
//   - Парсер не падає на специфіках ЄСІТС-HTML (rvts/rvps класи, атрибути
//     без лапок, META, conditional comments, &nbsp; тощо)
//   - Герб (data: URI) визначається у блоках як image type
//   - CSS правила з <style> впливають на стилі елементів
//
// Tests захищають від регресій коли в майбутньому хтось зачепить парсер.
// Adding new sample to test_files/esits_samples/ — додаткові тести при потребі.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const fontsDir = join(process.cwd(), 'public/fonts');
const fonts = {
  'LiberationSans-Regular.ttf': readFileSync(join(fontsDir, 'LiberationSans-Regular.ttf')),
  'LiberationSans-Bold.ttf': readFileSync(join(fontsDir, 'LiberationSans-Bold.ttf')),
  'LiberationSans-Italic.ttf': readFileSync(join(fontsDir, 'LiberationSans-Italic.ttf')),
  'LiberationSans-BoldItalic.ttf': readFileSync(join(fontsDir, 'LiberationSans-BoldItalic.ttf')),
  'LiberationSerif-Regular.ttf': readFileSync(join(fontsDir, 'LiberationSerif-Regular.ttf')),
  'LiberationSerif-Bold.ttf': readFileSync(join(fontsDir, 'LiberationSerif-Bold.ttf')),
  'LiberationSerif-Italic.ttf': readFileSync(join(fontsDir, 'LiberationSerif-Italic.ttf')),
  'LiberationSerif-BoldItalic.ttf': readFileSync(join(fontsDir, 'LiberationSerif-BoldItalic.ttf')),
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (typeof url !== 'string') return new Response('', { status: 404 });
    for (const name of Object.keys(fonts)) {
      if (url.endsWith(name)) return new Response(fonts[name], { status: 200 });
    }
    return new Response('', { status: 404 });
  }));
});

import { htmlToPdfViaPdfLib, __test__ } from '../../src/services/converter/pdfLibHtmlRenderer.js';

const SAMPLES_DIR = join(process.cwd(), 'test_files/esits_samples');

// Читає файл як UTF-8 рядок з конвертацією з Windows-1251 байтів.
// (Production code робить це через decodeHtmlBuffer в htmlToPdf.js — тут
// дублюємо мінімум щоб тест-кейс був ізольований від цього шару.)
function readEsitsHtml(filename) {
  const buf = readFileSync(join(SAMPLES_DIR, filename));
  const decoder = new TextDecoder('windows-1251');
  return decoder.decode(buf);
}

describe('pdfLibHtmlRenderer — ЄСІТС реальні зразки', () => {
  it('Ухвала.html — герб + центрований заголовок + justify + bold-підпис', async () => {
    const html = readEsitsHtml('Ухвала.html');

    // Sanity: правильно прочитався Windows-1251 (кирилиця присутня).
    // ЄСІТС friendly-print заголовок з пробілами між літерами: "У Х В А Л А"
    expect(html).toMatch(/У\s*Х\s*В\s*А\s*Л\s*А/);
    expect(html).toContain('class=rvts15');
    expect(html).toContain('class=rvps7'); // justify paragraph

    // Sanity: герб як inline data URI у <p>
    expect(html).toMatch(/<p[^>]*class=rvps3[^>]*><img/);
    expect(html).toContain('data:image/png;base64,');

    // Render → PDF
    const blob = await htmlToPdfViaPdfLib(html, { defaultFontFamily: 'serif' });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(10 * 1024); // 10+ KB — реальний PDF з контентом

    // Перевірити %PDF- header
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const header = String.fromCharCode(...bytes.slice(0, 5));
    expect(header).toBe('%PDF-');
  });

  it('Ухвала про відкриття апеляційного провадження — герб у <p class=rvps2>', async () => {
    const html = readEsitsHtml('Ухвала про відкриття апеляційного провадження.html');
    const blob = await htmlToPdfViaPdfLib(html, { defaultFontFamily: 'serif' });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(10 * 1024);
  });

  it('Ухвала про залишення без розгляду (2-о) — складна шапка з порожніми span', async () => {
    const html = readEsitsHtml('Ухвала про залишення заяви окремого провадження без розгляду (індекс «2-о»).html');
    const blob = await htmlToPdfViaPdfLib(html, { defaultFontFamily: 'serif' });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(10 * 1024);
  });

  it('Судова повістка — таблиця з border + valign=top без лапок', async () => {
    const html = readEsitsHtml('Судова повістка про виклик в суд.html');
    expect(html).toContain('<table border=1');

    const blob = await htmlToPdfViaPdfLib(html, { defaultFontFamily: 'serif' });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(5 * 1024);
  });

  it('Фіксація автоматизованого розподілу справ — багато rvps стилів', async () => {
    const html = readEsitsHtml('Фіксація автоматизованого розподілу справ.html');
    const blob = await htmlToPdfViaPdfLib(html, { defaultFontFamily: 'serif' });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(5 * 1024);
  });

  it('dnzs_1005_23150916.html — спрощений документ (заголовок 18pt)', async () => {
    const html = readEsitsHtml('dnzs_1005_23150916.html');
    expect(html).toContain('font-size: 18pt');

    const blob = await htmlToPdfViaPdfLib(html, { defaultFontFamily: 'serif' });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(2 * 1024);
  });

  it('Протокол судового засідання ВКЗ2 — modern UTF-8 HTML5 Bootstrap', async () => {
    // Цей файл — UTF-8 (не Windows-1251 як інші), читаємо інакше
    const buf = readFileSync(join(SAMPLES_DIR, 'Протокол судового засідання підсистеми ВКЗ2.html'));
    const html = new TextDecoder('utf-8').decode(buf);

    const blob = await htmlToPdfViaPdfLib(html);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(5 * 1024);
  });
});

describe('pdfLibHtmlRenderer — структурні перевірки на ЄСІТС зразку', () => {
  it('герб з <p class=rvps3> розпізнається як окремий image block', () => {
    const html = readEsitsHtml('Ухвала.html');
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const stylesheet = __test__.collectStyleSheet(doc);

    const blocks = [];
    const initStyle = __test__.defaultStyle();
    initStyle.fontFamily = 'serif';
    const seenImages = new Set();
    for (const child of doc.body.childNodes) {
      __test__.walkDom(child, initStyle, blocks, stylesheet, seenImages);
    }

    // Має бути принаймні один image block
    const imageBlocks = blocks.filter((b) => b.type === 'image');
    expect(imageBlocks.length).toBeGreaterThanOrEqual(1);

    // Image block має src з data:image/png;base64,
    expect(imageBlocks[0].src).toMatch(/^data:image\/png;base64,/);

    // І ширину/висоту з атрибутів width=54 height=73 (px → pt: ×0.75)
    expect(imageBlocks[0].width).toBeCloseTo(54 * 0.75, 1);
    expect(imageBlocks[0].height).toBeCloseTo(73 * 0.75, 1);
  });

  it('rvps7 (justify) клас на параграфах призводить до align=justify у стилі', () => {
    const html = readEsitsHtml('Ухвала.html');
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const stylesheet = __test__.collectStyleSheet(doc);

    // Знаходимо <p class=rvps7> у документі і перевіряємо що стилі дають justify
    const p = doc.querySelector('p.rvps7');
    expect(p).not.toBeNull();

    const initStyle = __test__.defaultStyle();
    const s = __test__.styleForElement(p, initStyle, stylesheet);
    expect(s.align).toBe('justify');
  });

  it('span.rvts15 (bold) клас впливає на bold через CSS rule', () => {
    const html = readEsitsHtml('Ухвала.html');
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const stylesheet = __test__.collectStyleSheet(doc);

    const span = doc.querySelector('span.rvts15');
    expect(span).not.toBeNull();

    const initStyle = __test__.defaultStyle();
    const s = __test__.styleForElement(span, initStyle, stylesheet);
    expect(s.bold).toBe(true);
  });

  it('META теги витягаються через doc.querySelectorAll (для майбутнього модуля ЄСІТС)', () => {
    const html = readEsitsHtml('Ухвала.html');
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // META теги залишаються в DOM навіть якщо renderer їх пропускає
    const metas = doc.querySelectorAll('meta[name]');
    expect(metas.length).toBeGreaterThan(10);

    // Знайти ключові поля для майбутнього автоімпорту справ
    const getMeta = (name) => {
      for (const m of metas) {
        if ((m.getAttribute('name') || '').toUpperCase() === name) return m.getAttribute('content');
      }
      return null;
    };
    expect(getMeta('CAUSENUM')).toBeTruthy(); // номер справи
    expect(getMeta('COURTNAME')).toBeTruthy(); // назва суду
    expect(getMeta('DOCDATE')).toBeTruthy();   // дата документа
    expect(getMeta('DOCTYPE')).toBeTruthy();   // тип документа
  });
});

describe('pdfLibHtmlRenderer.__test__.parseImgLength', () => {
  it('integer без юніту = px → pt (×0.75)', () => {
    expect(__test__.parseImgLength('54')).toBeCloseTo(40.5, 2);
    expect(__test__.parseImgLength('73')).toBeCloseTo(54.75, 2);
  });
  it('з юнітом — як parseLength', () => {
    expect(__test__.parseImgLength('14pt')).toBe(14);
    expect(__test__.parseImgLength('20px')).toBeCloseTo(15, 2);
  });
  it('невалідний → fallback', () => {
    expect(__test__.parseImgLength('xyz', 99)).toBe(99);
    expect(__test__.parseImgLength(null, 0)).toBe(0);
  });
});

describe('pdfLibHtmlRenderer.__test__.splitParagraphByImages', () => {
  it('параграф з тільки img — створює тільки image block (без порожнього paragraph)', () => {
    const html = '<p><img src="data:image/png;base64,AAAA"></p>';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const p = doc.querySelector('p');
    const blocks = [];
    const style = __test__.defaultStyle();
    __test__.splitParagraphByImages(p, style, blocks, [], new Set());
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('image');
  });

  it('параграф з текстом+img+текстом — три блоки [paragraph, image, paragraph]', () => {
    const html = '<p>Перед <img src="data:image/png;base64,AAAA"> після</p>';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const p = doc.querySelector('p');
    const blocks = [];
    const style = __test__.defaultStyle();
    __test__.splitParagraphByImages(p, style, blocks, [], new Set());
    expect(blocks).toHaveLength(3);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[1].type).toBe('image');
    expect(blocks[2].type).toBe('paragraph');
  });

  it('параграф з img + порожніми span (як у ЄСІТС) — тільки image block', () => {
    const html = '<p><img src="data:image/png;base64,AAAA"><span> </span><span></span></p>';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const p = doc.querySelector('p');
    const blocks = [];
    const style = __test__.defaultStyle();
    __test__.splitParagraphByImages(p, style, blocks, [], new Set());
    // Image block обов'язково. Trailing whitespace-only paragraph не створюється.
    expect(blocks.filter((b) => b.type === 'image')).toHaveLength(1);
    const textBlocks = blocks.filter((b) => b.type === 'paragraph');
    expect(textBlocks).toHaveLength(0);
  });

  it('дедуплікація — другий img з тим самим src пропускається', () => {
    const src = 'data:image/png;base64,AAAA';
    const html = `<p><img src="${src}"></p><p><img src="${src}"></p>`;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const ps = doc.querySelectorAll('p');
    const blocks = [];
    const style = __test__.defaultStyle();
    const seen = new Set();
    for (const p of ps) {
      __test__.splitParagraphByImages(p, style, blocks, [], seen);
    }
    const imageBlocks = blocks.filter((b) => b.type === 'image');
    expect(imageBlocks).toHaveLength(1);
  });
});
