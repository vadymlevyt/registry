// Юніт-тести для детекції кодування HTML (мікро-TASK 5.2).
import { describe, it, expect } from 'vitest';
import {
  detectCharset,
  decodeHtmlBuffer,
  extractEcitsMetaPairs,
  prepareHtmlForIframe,
} from '../../src/utils/htmlCharsetDetection.js';

function bytes(arr) {
  return new Uint8Array(arr).buffer;
}

function ascii(str) {
  return new TextEncoder().encode(str).buffer;
}

describe('detectCharset — BOM', () => {
  it('UTF-8 BOM (EF BB BF) → utf-8 high', () => {
    const buf = bytes([0xEF, 0xBB, 0xBF, 0x68, 0x69]);
    const r = detectCharset(buf, '');
    expect(r.charset).toBe('utf-8');
    expect(r.confidence).toBe('high');
    expect(r.source).toBe('bom');
  });

  it('UTF-16 BE BOM (FE FF) → utf-16be high', () => {
    const buf = bytes([0xFE, 0xFF, 0x00, 0x68]);
    const r = detectCharset(buf, '');
    expect(r.charset).toBe('utf-16be');
    expect(r.confidence).toBe('high');
  });

  it('UTF-16 LE BOM (FF FE) → utf-16le high', () => {
    const buf = bytes([0xFF, 0xFE, 0x68, 0x00]);
    const r = detectCharset(buf, '');
    expect(r.charset).toBe('utf-16le');
    expect(r.confidence).toBe('high');
  });
});

describe('detectCharset — Content-Type header', () => {
  it("'text/html; charset=windows-1251' → windows-1251 medium", () => {
    const buf = ascii('<html><body>Привіт</body></html>');
    const r = detectCharset(buf, 'text/html; charset=windows-1251');
    expect(r.charset).toBe('windows-1251');
    expect(r.confidence).toBe('medium');
    expect(r.source).toBe('http-header');
  });

  it('charset з лапками знімаються', () => {
    const buf = ascii('<html></html>');
    const r = detectCharset(buf, 'text/html; charset="windows-1252"');
    expect(r.charset).toBe('windows-1252');
  });

  it('cp1251 → нормалізація → windows-1251', () => {
    const buf = ascii('<html></html>');
    const r = detectCharset(buf, 'text/html; charset=cp1251');
    expect(r.charset).toBe('windows-1251');
  });
});

describe('detectCharset — meta tags', () => {
  it("<meta charset='utf-8'> → utf-8 medium meta-charset", () => {
    const buf = ascii('<html><head><meta charset="utf-8"></head></html>');
    const r = detectCharset(buf, '');
    expect(r.charset).toBe('utf-8');
    expect(r.confidence).toBe('medium');
    expect(r.source).toBe('meta-charset');
  });

  it('<meta http-equiv Content-Type charset=windows-1251> → windows-1251', () => {
    const html =
      '<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1251"></head></html>';
    const r = detectCharset(ascii(html), '');
    expect(r.charset).toBe('windows-1251');
    expect(r.source).toBe('meta-http-equiv');
  });

  it('Content-Type header має пріоритет над meta-tag', () => {
    const buf = ascii('<html><head><meta charset="utf-8"></head></html>');
    const r = detectCharset(buf, 'text/html; charset=windows-1251');
    expect(r.charset).toBe('windows-1251');
    expect(r.source).toBe('http-header');
  });
});

describe('detectCharset — fallback', () => {
  it('без BOM, без header, без meta → utf-8 low default', () => {
    const buf = ascii('<html><body>Hello</body></html>');
    const r = detectCharset(buf, '');
    expect(r.charset).toBe('utf-8');
    expect(r.confidence).toBe('low');
    expect(r.source).toBe('default');
  });
});

describe('decodeHtmlBuffer', () => {
  it('UTF-8 BOM + кирилиця → правильний текст', () => {
    const utf8Bytes = new TextEncoder().encode('Привіт, світе!');
    const withBom = new Uint8Array(3 + utf8Bytes.length);
    withBom[0] = 0xEF; withBom[1] = 0xBB; withBom[2] = 0xBF;
    withBom.set(utf8Bytes, 3);
    const r = decodeHtmlBuffer(withBom.buffer, '');
    expect(r.text).toContain('Привіт, світе!');
    expect(r.charset).toBe('utf-8');
    expect(r.fallbackUsed).toBe(false);
  });

  it('Windows-1251 кирилиця через Content-Type', () => {
    // 'Привіт' у windows-1251: П=CF р=F0 и=E8 в=E2 і=B3 т=F2
    const buf = bytes([0xCF, 0xF0, 0xE8, 0xE2, 0xB3, 0xF2]);
    const r = decodeHtmlBuffer(buf, 'text/html; charset=windows-1251');
    expect(r.text).toBe('Привіт');
    expect(r.charset).toBe('windows-1251');
  });
});

describe('prepareHtmlForIframe', () => {
  it('видаляє <meta charset="windows-1251">', () => {
    const html = '<html><head><meta charset="windows-1251"><title>X</title></head><body>Текст</body></html>';
    const out = prepareHtmlForIframe(html);
    expect(out).not.toMatch(/charset\s*=\s*["']?windows-1251/i);
    expect(out).toMatch(/<meta charset="utf-8">/);
  });

  it('видаляє <meta http-equiv="Content-Type" content="...; charset=windows-1251">', () => {
    const html = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1251"></head><body>X</body></html>';
    const out = prepareHtmlForIframe(html);
    expect(out).not.toMatch(/http-equiv/i);
    expect(out).not.toMatch(/windows-1251/i);
    expect(out).toMatch(/<meta charset="utf-8">/);
  });

  it("додає <head> якщо його немає", () => {
    const html = '<html><body>Просто текст</body></html>';
    const out = prepareHtmlForIframe(html);
    expect(out).toMatch(/<head><meta charset="utf-8">.*<\/head>/s);
    expect(out).toMatch(/Просто текст/);
  });

  it('інжектить стилі у <head>', () => {
    const html = '<html><head></head><body>X</body></html>';
    const out = prepareHtmlForIframe(html, 'body { color: black; }');
    expect(out).toMatch(/<style>body \{ color: black; \}<\/style>/);
  });

  it('зберігає вміст body', () => {
    const html = '<html><head><meta charset="windows-1251"></head><body><h1>Заголовок</h1><p>Текст ухвали</p></body></html>';
    const out = prepareHtmlForIframe(html);
    expect(out).toMatch(/Заголовок/);
    expect(out).toMatch(/Текст ухвали/);
  });

  it('null/empty input — повертає як є', () => {
    expect(prepareHtmlForIframe(null)).toBe(null);
    expect(prepareHtmlForIframe('')).toBe('');
    expect(prepareHtmlForIframe(undefined)).toBe(undefined);
  });

  it('кілька meta-charset тегів — всі видаляються', () => {
    const html = '<head><meta charset="windows-1251"><meta charset="koi8-u"></head><body>X</body>';
    const out = prepareHtmlForIframe(html);
    const matches = out.match(/<meta charset/gi) || [];
    // має лишитися рівно один — наш свіжий utf-8
    expect(matches).toHaveLength(1);
    expect(out).toMatch(/<meta charset="utf-8">/);
  });
});

describe('extractEcitsMetaPairs', () => {
  it('витягує meta name/content пари з ЄСІТС-формату', () => {
    const html = `
      <html><head>
        <meta name="judges" content="Іванов І. І.">
        <meta name="sides" content="Позивач vs Відповідач">
        <meta name="case_no" content="757/123/24">
      </head><body></body></html>
    `;
    const pairs = extractEcitsMetaPairs(html);
    expect(pairs).toHaveLength(3);
    expect(pairs[0]).toEqual({ name: 'judges', content: 'Іванов І. І.' });
    expect(pairs[2].content).toBe('757/123/24');
  });

  it('пропускає стандартні meta (viewport, charset, robots)', () => {
    const html = `
      <html><head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width">
        <meta name="robots" content="noindex">
        <meta name="case_no" content="42">
      </head></html>
    `;
    const pairs = extractEcitsMetaPairs(html);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].name).toBe('case_no');
  });

  it('повертає [] на null/undefined', () => {
    expect(extractEcitsMetaPairs(null)).toEqual([]);
    expect(extractEcitsMetaPairs(undefined)).toEqual([]);
  });
});
