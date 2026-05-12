// ── PDF-LIB HTML RENDERER ────────────────────────────────────────────────────
// Конвертує HTML (від mammoth.convertToHtml або декодованого HTML-файлу) у PDF
// Blob через pdf-lib. Зберігає форматування з HTML: заголовки, жирний/курсив/
// підкреслення, вирівнювання, списки, таблиці, зображення, гіперпосилання,
// font-family (serif/sans) routing.
//
// Принцип: PDF — це наш єдиний формат відображення. Mozilla pdfjs у Viewer
// підтримує highlight/нотатки тільки на searchable PDF. pdf-lib генерує саме
// searchable PDF з виділюваним текстом.
//
// ── ЩО ВРАХОВАНО ────────────────────────────────────────────────────────────
// Блок-рівень:
//   h1-h6  → крупніший шрифт + bold + відступи зверху/знизу
//   p, div → абзац з вирівнюванням (left/right/center/justify), text-indent,
//            margin-left/right
//   ul/ol  → списки з маркерами/нумерацією, вкладені списки з відступом
//   table  → проста таблиця, colspan/rowspan, page-break per row
//   img    → embed (PNG/JPG/base64 data: URI), fit у ширину контенту
//   hr     → горизонтальна лінія
//   blockquote → відступ зліва + курсив
//   pre    → переноси збережені рядок-у-рядок
//
// Inline-рівень:
//   b/strong, i/em, u/ins, s/strike/del → жирний/курсив/підкреслення/strike
//   sub/sup → зменшений шрифт + baseline shift
//   a[href] → синій + підкреслення + клік-анотація у PDF
//   span    → носій inline-стилів
//   font[face|size|color] → legacy HTML4 (часто у ЄСІТС-документах)
//
// Legacy теги (Word "save as HTML"):
//   <center>      → блок з align=center
//   <font>        → inline runs з face/size/color
//   <p align="…"> → атрибут align (legacy) застосовується до h*/div/p/td
//
// CSS:
//   - inline style="..." (повний набір властивостей нижче)
//   - <style> блоки у <head> або по тілу — мінімальний CSS-парсер, селектори:
//     tag, .class, tag.class, * (всі), кома-розділені списки
//   - mso-* властивості ігноруємо (Word-internal)
//
// Властивості що парсимо:
//   text-align, font-weight, font-style, text-decoration, font-size, color,
//   background-color, margin-left, margin-right, padding-left, text-indent,
//   line-height, font-family, width, vertical-align, display (none — пропускаємо).
//
// font-family routing:
//   "Times New Roman", "Times", "Serif", "Cambria", "Georgia" → LiberationSerif
//   "Arial", "Helvetica", "Verdana", "Tahoma", "Sans-Serif", "Calibri" → LiberationSans
//   default для DOCX/HTML — LiberationSerif (Word default = Times-like).
//
// ── ЧОГО НЕ ВИРІШУЄМО ──────────────────────────────────────────────────────
// SVG/GIF/WEBP зображення (pdf-lib embed'ить тільки PNG/JPG), складні layout
// (float/flex/grid), <font face> з рідкісними родинами (fallback на serif),
// зовнішні таблиці стилів (link rel=stylesheet — ЄСІТС не використовує).
// Складна верстка тяжіє до PDF/Print від Word — оригінал DOCX лежить поряд
// як originalDriveId.

import { PDFDocument, rgb, PDFName, PDFString, PDFArray } from 'pdf-lib';

// ── A4 + одиниці ───────────────────────────────────────────────────────────
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MM_TO_PT = 72 / 25.4;

const DEFAULT_MARGINS = {
  top: 20 * MM_TO_PT,
  bottom: 20 * MM_TO_PT,
  left: 30 * MM_TO_PT,
  right: 20 * MM_TO_PT,
};

const BASE_FONT_SIZE = 12;
const BASE_LINE_HEIGHT = 1.4;

const HEADING_SCALE = { h1: 1.8, h2: 1.5, h3: 1.3, h4: 1.15, h5: 1.05, h6: 1.0 };
const HEADING_SPACING_BEFORE = 8;
const HEADING_SPACING_AFTER = 4;
const PARAGRAPH_SPACING = 4;
const LIST_INDENT = 18;
const LIST_BULLET_GAP = 6;
const BLOCKQUOTE_INDENT = 24;

const LINK_COLOR = { r: 0.0, g: 0.36, b: 0.65 };

// HTML4 <font size="1..7"> → pt. Карта орієнтовно за Word.
const FONT_SIZE_LEGACY = { '1': 8, '2': 10, '3': 12, '4': 14, '5': 18, '6': 24, '7': 36 };

// font-family → family routing. Перший match — переможець. Ключі lowercase.
const FONT_FAMILY_MAP = [
  { match: ['times new roman', 'times', 'serif', 'cambria', 'georgia', 'liberation serif', 'pt serif'], family: 'serif' },
  { match: ['arial', 'helvetica', 'verdana', 'tahoma', 'sans-serif', 'sans', 'calibri', 'liberation sans', 'segoe ui', 'roboto', 'open sans'], family: 'sans' },
];

// ── Шрифти ─────────────────────────────────────────────────────────────────
// 8 варіантів: serif/sans × Regular/Bold/Italic/BoldItalic. Lazy-fetch у
// in-memory cache. Bundle головного chunk'у не тягне ці байти.

let fontBytesCachePromise = null;

function getFontUrl(filename) {
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
  return `${base}fonts/${filename}`;
}

async function fetchFontBytes(filename) {
  const url = getFontUrl(filename);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Не вдалось завантажити шрифт ${url} (HTTP ${res.status})`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function loadAllFontBytes() {
  if (fontBytesCachePromise) return fontBytesCachePromise;
  fontBytesCachePromise = (async () => {
    const [sansR, sansB, sansI, sansBI, serifR, serifB, serifI, serifBI] = await Promise.all([
      fetchFontBytes('LiberationSans-Regular.ttf'),
      fetchFontBytes('LiberationSans-Bold.ttf'),
      fetchFontBytes('LiberationSans-Italic.ttf'),
      fetchFontBytes('LiberationSans-BoldItalic.ttf'),
      fetchFontBytes('LiberationSerif-Regular.ttf'),
      fetchFontBytes('LiberationSerif-Bold.ttf'),
      fetchFontBytes('LiberationSerif-Italic.ttf'),
      fetchFontBytes('LiberationSerif-BoldItalic.ttf'),
    ]);
    return {
      sans: { regular: sansR, bold: sansB, italic: sansI, boldItalic: sansBI },
      serif: { regular: serifR, bold: serifB, italic: serifI, boldItalic: serifBI },
    };
  })().catch((e) => {
    fontBytesCachePromise = null;
    throw e;
  });
  return fontBytesCachePromise;
}

// ── Стилі ──────────────────────────────────────────────────────────────────
function defaultStyle() {
  return {
    fontSize: BASE_FONT_SIZE,
    lineHeight: BASE_LINE_HEIGHT,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    color: { r: 0, g: 0, b: 0 },
    bgColor: null,
    align: null,             // null означає "не задано" — успадковуємо з parent
    marginLeft: 0,
    marginRight: 0,
    textIndent: 0,
    subscript: false,
    superscript: false,
    linkHref: null,
    listLevel: 0,
    fontFamily: 'serif',     // дефолт для адвокатських документів (Word default)
  };
}

function cloneStyle(s) {
  return { ...s, color: { ...s.color }, bgColor: s.bgColor ? { ...s.bgColor } : null };
}

// Парсинг inline CSS у словник {prop: value}.
function parseInlineStyle(text) {
  if (!text) return {};
  const out = {};
  for (const decl of text.split(';')) {
    const idx = decl.indexOf(':');
    if (idx <= 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim();
    if (prop && value) out[prop] = value;
  }
  return out;
}

function parseLength(value, fallback = 0, base = BASE_FONT_SIZE) {
  if (value == null) return fallback;
  if (typeof value === 'number') return value;
  const s = String(value).trim();
  if (!s) return fallback;
  const m = s.match(/^(-?\d*\.?\d+)\s*([a-z%]*)$/i);
  if (!m) return fallback;
  const n = parseFloat(m[1]);
  const unit = (m[2] || '').toLowerCase();
  switch (unit) {
    case '':
    case 'pt': return n;
    case 'px': return n * 0.75;
    case 'pc': return n * 12;
    case 'em':
    case 'rem': return n * base;
    case '%': return n / 100 * base;
    case 'mm': return n * MM_TO_PT;
    case 'cm': return n * MM_TO_PT * 10;
    case 'in': return n * 72;
    default: return fallback;
  }
}

const COLOR_KEYWORDS = {
  black: [0, 0, 0], white: [1, 1, 1], red: [1, 0, 0], green: [0, 0.5, 0],
  blue: [0, 0, 1], yellow: [1, 1, 0], gray: [0.5, 0.5, 0.5], grey: [0.5, 0.5, 0.5],
  silver: [0.75, 0.75, 0.75], maroon: [0.5, 0, 0], navy: [0, 0, 0.5],
  purple: [0.5, 0, 0.5], olive: [0.5, 0.5, 0], teal: [0, 0.5, 0.5],
  orange: [1, 0.647, 0],
};

function parseColor(value) {
  if (!value || typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (!v || v === 'transparent' || v === 'inherit' || v === 'currentcolor' || v === 'auto' || v === 'windowtext') return null;
  if (COLOR_KEYWORDS[v]) {
    const [r, g, b] = COLOR_KEYWORDS[v];
    return { r, g, b };
  }
  let m = v.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    const c = m[1];
    return {
      r: parseInt(c[0] + c[0], 16) / 255,
      g: parseInt(c[1] + c[1], 16) / 255,
      b: parseInt(c[2] + c[2], 16) / 255,
    };
  }
  m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    return {
      r: parseInt(m[1].slice(0, 2), 16) / 255,
      g: parseInt(m[1].slice(2, 4), 16) / 255,
      b: parseInt(m[1].slice(4, 6), 16) / 255,
    };
  }
  m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(',').map((p) => p.trim());
    if (parts.length >= 3) {
      const r = parseInt(parts[0], 10);
      const g = parseInt(parts[1], 10);
      const b = parseInt(parts[2], 10);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        return { r: r / 255, g: g / 255, b: b / 255 };
      }
    }
  }
  return null;
}

function mapFontFamily(value) {
  if (!value) return null;
  // CSS font-family може мати кілька варіантів через кому. Беремо перший.
  const list = value.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '').toLowerCase()).filter(Boolean);
  for (const name of list) {
    for (const entry of FONT_FAMILY_MAP) {
      for (const match of entry.match) {
        if (name === match) return entry.family;
      }
    }
  }
  // Невідома родина — повертаємо null щоб успадкувати з parent.
  return null;
}

// ── CSS блок-парсер ────────────────────────────────────────────────────────
// Мінімальний CSS-парсер що читає `<style>` блоки. Підтримує:
//   - tag-селектори: p { ... }
//   - class-селектори: .MsoNormal { ... }
//   - tag.class: p.MsoNormal { ... }
//   - * { ... } (всі елементи)
//   - кома-розділені списки: p, td { ... }
// Не підтримує: descendant combinators, pseudo-classes, attribute selectors.
// При застосуванні: правила .class перекривають правила tag; inline style
// перекриває все. Для адвокатських Word-HTML цього достатньо.

function parseStyleBlock(cssText) {
  // Видаляємо CSS-коментарі /* ... */
  const clean = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  // Простий regex: селектор { декларації }
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(clean)) !== null) {
    const selectors = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    const decls = parseInlineStyle(m[2]);
    if (Object.keys(decls).length === 0) continue;
    for (const selector of selectors) {
      // Селектор може бути "p", ".MsoNormal", "p.MsoNormal", "*"
      const sel = selector.trim().toLowerCase();
      // Пропускаємо складні селектори (з пробілами, [], :, >, +, ~)
      if (/[\s\[\]:>+~]/.test(sel)) continue;
      let tag = null, cls = null;
      if (sel === '*') {
        tag = '*';
      } else if (sel.startsWith('.')) {
        cls = sel.slice(1);
      } else if (sel.includes('.')) {
        const parts = sel.split('.');
        tag = parts[0] || null;
        cls = parts[1] || null;
      } else {
        tag = sel;
      }
      rules.push({ tag, cls, decls });
    }
  }
  return rules;
}

// Знайти і об'єднати всі правила з усіх <style> блоків в документі.
function collectStyleSheet(doc) {
  const rules = [];
  if (!doc) return rules;
  const styles = doc.getElementsByTagName ? doc.getElementsByTagName('style') : [];
  for (let i = 0; i < styles.length; i++) {
    const text = styles[i].textContent || '';
    if (!text) continue;
    rules.push(...parseStyleBlock(text));
  }
  return rules;
}

// Знаходить правила що матчаться для елемента: за tag, за class, або *.
// Повертає об'єднаний словник декларацій (у порядку специфічності).
function getStylesheetDeclsForElement(el, stylesheet) {
  if (!stylesheet || stylesheet.length === 0) return {};
  const tag = (el.tagName || '').toLowerCase();
  const classAttr = el.getAttribute ? (el.getAttribute('class') || '') : '';
  const classes = classAttr.split(/\s+/).map((s) => s.toLowerCase()).filter(Boolean);

  const universal = {};
  const byTag = {};
  const byClass = {};
  const byTagClass = {};

  for (const rule of stylesheet) {
    if (rule.tag === '*' && !rule.cls) {
      Object.assign(universal, rule.decls);
    } else if (rule.tag && !rule.cls) {
      if (rule.tag === tag) Object.assign(byTag, rule.decls);
    } else if (!rule.tag && rule.cls) {
      if (classes.includes(rule.cls)) Object.assign(byClass, rule.decls);
    } else if (rule.tag && rule.cls) {
      if (rule.tag === tag && classes.includes(rule.cls)) Object.assign(byTagClass, rule.decls);
    }
  }

  // Порядок специфічності: universal < tag < class < tag.class < inline (inline застосовуємо окремо).
  return { ...universal, ...byTag, ...byClass, ...byTagClass };
}

// Застосувати словник декларацій до style-об'єкта (mutator). Спільний код
// для inline style="..." і stylesheet declarations.
function applyDeclsToStyle(s, decls, parentStyle) {
  if (!decls || typeof decls !== 'object') return;

  if (decls['display'] === 'none') {
    s._hidden = true;
  }
  if (decls['text-align']) {
    const a = decls['text-align'].toLowerCase();
    if (['left', 'right', 'center', 'justify'].includes(a)) s.align = a;
  }
  if (decls['font-weight']) {
    const w = decls['font-weight'].toLowerCase();
    const wn = parseInt(w, 10);
    if (w === 'bold' || w === 'bolder' || (!isNaN(wn) && wn >= 600)) s.bold = true;
    else if (w === 'normal' || w === 'lighter' || (!isNaN(wn) && wn < 600 && wn > 0)) s.bold = false;
  }
  if (decls['font-style']) {
    const fs = decls['font-style'].toLowerCase();
    if (fs === 'italic' || fs === 'oblique') s.italic = true;
    else if (fs === 'normal') s.italic = false;
  }
  if (decls['text-decoration'] || decls['text-decoration-line']) {
    const td = (decls['text-decoration'] || decls['text-decoration-line']).toLowerCase();
    if (td.includes('underline')) s.underline = true;
    if (td.includes('line-through')) s.strike = true;
    if (td.includes('none')) { s.underline = false; s.strike = false; }
  }
  if (decls['font-size']) {
    const fontSize = parseLength(decls['font-size'], s.fontSize, parentStyle ? parentStyle.fontSize : s.fontSize);
    if (fontSize > 0) s.fontSize = fontSize;
  }
  if (decls['line-height']) {
    const lh = decls['line-height'];
    const num = parseFloat(lh);
    if (!isNaN(num)) {
      if (/^[\d.]+$/.test(lh.trim())) s.lineHeight = num;
      else {
        const abs = parseLength(lh, 0, s.fontSize);
        if (abs > 0) s.lineHeight = abs / s.fontSize;
      }
    }
  }
  const color = parseColor(decls['color']);
  if (color) s.color = color;
  const bg = parseColor(decls['background-color'] || decls['background']);
  if (bg) s.bgColor = bg;
  if (decls['margin-left']) {
    const ml = parseLength(decls['margin-left'], 0, s.fontSize);
    s.marginLeft = (parentStyle?.marginLeft || 0) + ml;
  }
  if (decls['margin-right']) {
    const mr = parseLength(decls['margin-right'], 0, s.fontSize);
    s.marginRight = (parentStyle?.marginRight || 0) + mr;
  }
  if (decls['padding-left']) {
    const pl = parseLength(decls['padding-left'], 0, s.fontSize);
    s.marginLeft = (s.marginLeft || 0) + pl;
  }
  if (decls['text-indent']) {
    s.textIndent = parseLength(decls['text-indent'], 0, s.fontSize);
  }
  if (decls['font-family']) {
    const family = mapFontFamily(decls['font-family']);
    if (family) s.fontFamily = family;
  }
}

// Перенесення стилів елемента у клон поточного стилю.
function styleForElement(el, parentStyle, stylesheet = null) {
  const s = cloneStyle(parentStyle);
  const tag = el.tagName ? el.tagName.toLowerCase() : '';

  // 1. Дефолти за тегом
  switch (tag) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      s.fontSize = BASE_FONT_SIZE * HEADING_SCALE[tag];
      s.bold = true;
      break;
    case 'b': case 'strong':
      s.bold = true;
      break;
    case 'i': case 'em': case 'cite': case 'var':
      s.italic = true;
      break;
    case 'u': case 'ins':
      s.underline = true;
      break;
    case 's': case 'strike': case 'del':
      s.strike = true;
      break;
    case 'sub':
      s.subscript = true;
      s.fontSize = parentStyle.fontSize * 0.75;
      break;
    case 'sup':
      s.superscript = true;
      s.fontSize = parentStyle.fontSize * 0.75;
      break;
    case 'center':
      s.align = 'center';
      break;
    case 'a': {
      const href = el.getAttribute && el.getAttribute('href');
      if (href) {
        s.linkHref = href;
        s.color = { ...LINK_COLOR };
        s.underline = true;
      }
      break;
    }
    case 'blockquote':
      s.italic = true;
      s.marginLeft = (parentStyle.marginLeft || 0) + BLOCKQUOTE_INDENT;
      break;
    case 'th':
      s.bold = true;
      break;
    case 'code': case 'tt': case 'kbd': case 'samp':
      // Моно-простір нема, але це рідко зустрічається — лишаємо як serif.
      break;
    case 'font': {
      // HTML4 legacy
      const face = el.getAttribute && el.getAttribute('face');
      if (face) {
        const family = mapFontFamily(face);
        if (family) s.fontFamily = family;
      }
      const size = el.getAttribute && el.getAttribute('size');
      if (size) {
        // size може бути "1"-"7" або "+1"/"-1"
        if (size.startsWith('+') || size.startsWith('-')) {
          const delta = parseInt(size, 10);
          if (!isNaN(delta)) s.fontSize = Math.max(6, s.fontSize + delta * 2);
        } else if (FONT_SIZE_LEGACY[size]) {
          s.fontSize = FONT_SIZE_LEGACY[size];
        }
      }
      const color = el.getAttribute && parseColor(el.getAttribute('color'));
      if (color) s.color = color;
      break;
    }
    default:
      break;
  }

  // 2. CSS зі <style> блоку (tag, class, tag.class, *)
  if (stylesheet) {
    const decls = getStylesheetDeclsForElement(el, stylesheet);
    applyDeclsToStyle(s, decls, parentStyle);
  }

  // 3. Class-маркери від mammoth styleMap (.align-*, .font-*)
  const cls = el.className && typeof el.className === 'string' ? el.className : '';
  if (cls) {
    if (cls.includes('align-justify')) s.align = 'justify';
    else if (cls.includes('align-center')) s.align = 'center';
    else if (cls.includes('align-right')) s.align = 'right';
    else if (cls.includes('align-left')) s.align = 'left';
    if (cls.includes('font-sans')) s.fontFamily = 'sans';
    else if (cls.includes('font-serif')) s.fontFamily = 'serif';
  }

  // 4. Legacy HTML атрибут align="..." на p/h*/div/td/table/tr/th
  const alignAttr = el.getAttribute && el.getAttribute('align');
  if (alignAttr) {
    const a = alignAttr.toLowerCase();
    if (['left', 'right', 'center', 'justify'].includes(a)) s.align = a;
  }

  // 5. Inline style="..." — найвища специфічність
  const inlineDecls = el.getAttribute && parseInlineStyle(el.getAttribute('style'));
  if (inlineDecls && Object.keys(inlineDecls).length > 0) {
    applyDeclsToStyle(s, inlineDecls, parentStyle);
  }

  return s;
}

// ── DOM walker → blocks ────────────────────────────────────────────────────
const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'img', 'hr', 'blockquote', 'pre', 'figure', 'figcaption', 'center',
]);

function isBlock(node) {
  return node && node.nodeType === 1 && BLOCK_TAGS.has(node.tagName.toLowerCase());
}

// Теги які повністю пропускаємо при рендері.
// Office-specific: <xml>, <w:wordDocument>, <o:*> (Office Open), <m:*> (OfficeMath),
// <st1:*>, <st2:*> (Smart Tags) — ЄСІТС/Word дають це сміття.
const SKIP_TAGS = new Set([
  'script', 'style', 'noscript', 'meta', 'link', 'head', 'title',
  'xml', 'w:wordDocument', 'o:p', 'o:smarttagtype', 'o:OfficeDocumentSettings',
]);

function isOfficeSkipTag(tag) {
  if (SKIP_TAGS.has(tag)) return true;
  if (tag.startsWith('o:')) return true;
  if (tag.startsWith('w:')) return true;
  if (tag.startsWith('m:')) return true;
  if (tag.startsWith('st1:') || tag.startsWith('st2:')) return true;
  return false;
}

// VML (Vector Markup Language) — Word legacy формат для зображень у "save as HTML".
// Герб у ЄСІТС часто загорнутий у <v:shape><v:imagedata src="data:image/..."/></v:shape>
// (всередині <!--[if gte vml 1]>...<![endif]--> conditional comment або поза ним).
// Шукаємо <v:imagedata> у DOM і витягуємо src/o:href.
function findVmlImagedataSrc(node) {
  if (!node || node.nodeType !== 1) return null;
  const tag = node.tagName ? node.tagName.toLowerCase() : '';
  if (tag === 'v:imagedata' || tag === 'imagedata' || tag.endsWith(':imagedata')) {
    return node.getAttribute('src') || node.getAttribute('r:id') || node.getAttribute('o:href') || null;
  }
  for (const child of node.childNodes) {
    const r = findVmlImagedataSrc(child);
    if (r) return r;
  }
  return null;
}

function collectInlineRuns(node, style, runs, stylesheet) {
  if (!node) return;
  if (node.nodeType === 3) {
    const raw = node.nodeValue || '';
    const collapsed = raw.replace(/\s+/g, ' ');
    if (collapsed === '' || collapsed === ' ') {
      if (runs.length > 0 && !runs[runs.length - 1].forceBreak && !runs[runs.length - 1].text?.endsWith(' ')) {
        runs.push({ text: ' ', style: cloneStyle(style) });
      }
      return;
    }
    runs.push({ text: collapsed, style: cloneStyle(style) });
    return;
  }
  if (node.nodeType !== 1) return;
  const tag = node.tagName.toLowerCase();

  if (isOfficeSkipTag(tag)) return;

  if (tag === 'br') {
    runs.push({ forceBreak: true, style: cloneStyle(style) });
    return;
  }

  if (tag === 'img') {
    const src = node.getAttribute('src');
    if (src) {
      runs.push({
        type: 'image',
        src,
        style: cloneStyle(style),
        width: parseLength(node.getAttribute('width'), null),
        height: parseLength(node.getAttribute('height'), null),
      });
    }
    return;
  }

  const childStyle = styleForElement(node, style, stylesheet);
  if (childStyle._hidden) return;

  const children = node.childNodes;
  for (let i = 0; i < children.length; i++) {
    collectInlineRuns(children[i], childStyle, runs, stylesheet);
  }
}

// HTML4 `<img width=54 height=73>` — integer без юніту = px. Окремий від
// parseLength (який трактує '' як pt бо CSS так робить).
function parseImgLength(value, fallback = null) {
  if (value == null) return fallback;
  const s = String(value).trim();
  if (!s) return fallback;
  if (/^\d+$/.test(s)) return parseInt(s, 10) * 0.75; // px → pt
  return parseLength(s, fallback);
}

// Розбити параграф на блоки нарізкою по <img>. Inline-img у paragraph рендер
// не обробляє (drawLine ігнорує image segments). Натомість виносимо img у
// окремий image block, текст до/після стає окремим paragraph.
//
// Особливість: для ЄСІТС-ухвал параграф з гербом часто містить тільки img
// + порожні span'и. Не створюємо paragraph для порожнього/whitespace-only text.
function splitParagraphByImages(node, style, blocks, stylesheet, seenImageSrcs) {
  let accumRuns = [];

  function hasNonEmptyContent(runs) {
    for (const r of runs) {
      if (r.forceBreak) continue;
      if (typeof r.text === 'string' && r.text.trim().length > 0) return true;
    }
    return false;
  }

  function flushText() {
    if (accumRuns.length === 0) return;
    if (hasNonEmptyContent(accumRuns)) {
      blocks.push({ type: 'paragraph', runs: accumRuns, style });
    }
    accumRuns = [];
  }

  function visit(n, currentStyle) {
    if (!n) return;
    if (n.nodeType === 3) {
      const raw = n.nodeValue || '';
      const collapsed = raw.replace(/\s+/g, ' ');
      if (collapsed === '' || collapsed === ' ') {
        if (accumRuns.length > 0) {
          const last = accumRuns[accumRuns.length - 1];
          if (!last.forceBreak && (!last.text || !last.text.endsWith(' '))) {
            accumRuns.push({ text: ' ', style: cloneStyle(currentStyle) });
          }
        }
        return;
      }
      accumRuns.push({ text: collapsed, style: cloneStyle(currentStyle) });
      return;
    }
    if (n.nodeType !== 1) return;
    const t = n.tagName.toLowerCase();
    if (isOfficeSkipTag(t)) return;

    if (t === 'br') {
      accumRuns.push({ forceBreak: true, style: cloneStyle(currentStyle) });
      return;
    }
    if (t === 'img') {
      const src = n.getAttribute('src');
      if (src && !seenImageSrcs.has(src)) {
        seenImageSrcs.add(src);
        flushText();
        const w = parseImgLength(n.getAttribute('width'), null);
        const h = parseImgLength(n.getAttribute('height'), null);
        const align = style.align || 'left';
        blocks.push({ type: 'image', src, width: w, height: h, align, style });
      }
      return;
    }
    if (t.startsWith('v:') || t === 'shape' || t === 'imagedata' || t === 'rect') {
      const src = findVmlImagedataSrc(n);
      if (src && !seenImageSrcs.has(src)) {
        seenImageSrcs.add(src);
        flushText();
        const align = style.align || 'left';
        blocks.push({ type: 'image', src, width: null, height: null, align, style });
      }
      return;
    }

    const childStyle = styleForElement(n, currentStyle, stylesheet);
    if (childStyle._hidden) return;
    for (const child of n.childNodes) {
      visit(child, childStyle);
    }
  }

  for (const child of node.childNodes) {
    visit(child, style);
  }
  flushText();
}

function walkDom(node, parentStyle, blocks, stylesheet = null, seenImageSrcs = null) {
  if (!seenImageSrcs) seenImageSrcs = new Set();
  if (!node) return;
  if (node.nodeType !== 1) {
    if (node.nodeType === 3) {
      const text = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (text) {
        blocks.push({
          type: 'paragraph',
          runs: [{ text, style: cloneStyle(parentStyle) }],
          style: cloneStyle(parentStyle),
        });
      }
    }
    return;
  }

  const tag = node.tagName.toLowerCase();
  if (isOfficeSkipTag(tag)) return;

  const style = styleForElement(node, parentStyle, stylesheet);
  if (style._hidden) return;

  if (tag === 'hr') {
    blocks.push({ type: 'hr', style });
    return;
  }

  if (tag === 'img') {
    const src = node.getAttribute('src');
    if (src && !seenImageSrcs.has(src)) {
      seenImageSrcs.add(src);
      const align = style.align || 'left';
      const w = parseImgLength(node.getAttribute('width'), null);
      const h = parseImgLength(node.getAttribute('height'), null);
      blocks.push({ type: 'image', src, width: w, height: h, align, style });
    }
    return;
  }

  // VML (Word legacy): <v:shape>, <v:rect>, <v:imagedata> — Word "save as HTML"
  // використовує VML для зображень. Герб у ЄСІТС-ухвалах часто тут.
  // Не дублюємо src який вже бачили (Word дублює: VML + <img> fallback).
  if (tag.startsWith('v:') || tag === 'shape' || tag === 'imagedata' || tag === 'rect') {
    const src = findVmlImagedataSrc(node);
    if (src && !seenImageSrcs.has(src)) {
      seenImageSrcs.add(src);
      const align = style.align || 'left';
      blocks.push({ type: 'image', src, width: null, height: null, align, style });
    }
    return;
  }

  if (/^h[1-6]$/.test(tag)) {
    const runs = [];
    collectInlineRuns(node, style, runs, stylesheet);
    if (runs.length > 0) {
      blocks.push({ type: 'heading', level: parseInt(tag[1], 10), runs, style });
    }
    return;
  }

  if (tag === 'p' || tag === 'center') {
    // ВАЖЛИВО: параграф може містити <img> (герб у ЄСІТС-ухвалах: <p class=rvps3>
    // <img src="data:image/png;base64,..."></p>). Якщо просто збирати runs —
    // image потрапить як inline-run, який drawLine ігнорує (малює тільки
    // word/space). Тому розбиваємо параграф на послідовність блоків:
    // [текст до img] [image block] [текст після img] ...
    splitParagraphByImages(node, style, blocks, stylesheet, seenImageSrcs);
    return;
  }

  if (tag === 'ul' || tag === 'ol') {
    const ordered = tag === 'ol';
    const items = [];
    let n = 1;
    for (const child of node.children) {
      if (child.tagName.toLowerCase() !== 'li') continue;
      const itemStyle = styleForElement(child, style, stylesheet);
      itemStyle.listLevel = (parentStyle.listLevel || 0) + 1;
      const runs = [];
      const sublistBlocks = [];
      for (const grand of child.childNodes) {
        if (grand.nodeType === 1 && (grand.tagName.toLowerCase() === 'ul' || grand.tagName.toLowerCase() === 'ol')) {
          walkDom(grand, itemStyle, sublistBlocks, stylesheet, seenImageSrcs);
        } else {
          collectInlineRuns(grand, itemStyle, runs, stylesheet);
        }
      }
      const marker = ordered ? `${n}.` : '•';
      items.push({ runs, style: itemStyle, marker, sublist: sublistBlocks });
      n++;
    }
    if (items.length > 0) {
      blocks.push({ type: 'list', ordered, items, style });
    }
    return;
  }

  if (tag === 'table') {
    const rows = [];
    function collectRows(parent) {
      for (const child of parent.children) {
        const t = child.tagName.toLowerCase();
        if (t === 'tr') {
          const cells = [];
          for (const cell of child.children) {
            const ct = cell.tagName.toLowerCase();
            if (ct !== 'td' && ct !== 'th') continue;
            const cellStyle = styleForElement(cell, style, stylesheet);
            const cellBlocks = [];
            let hasBlockChild = false;
            for (const grand of cell.childNodes) {
              if (isBlock(grand)) { hasBlockChild = true; break; }
            }
            if (hasBlockChild) {
              for (const grand of cell.childNodes) {
                walkDom(grand, cellStyle, cellBlocks, stylesheet, seenImageSrcs);
              }
            } else {
              const runs = [];
              collectInlineRuns(cell, cellStyle, runs, stylesheet);
              if (runs.length > 0) {
                cellBlocks.push({ type: 'paragraph', runs, style: cellStyle });
              }
            }
            const inline = parseInlineStyle(cell.getAttribute('style') || '');
            const widthAttr = cell.getAttribute('width');
            const widthRaw = inline['width'] || widthAttr;
            cells.push({
              blocks: cellBlocks,
              style: cellStyle,
              colspan: parseInt(cell.getAttribute('colspan') || '1', 10) || 1,
              rowspan: parseInt(cell.getAttribute('rowspan') || '1', 10) || 1,
              widthHint: widthRaw || null,
            });
          }
          if (cells.length > 0) rows.push(cells);
        } else if (t === 'thead' || t === 'tbody' || t === 'tfoot') {
          collectRows(child);
        }
      }
    }
    collectRows(node);
    if (rows.length > 0) {
      let columns = 0;
      for (const row of rows) {
        let count = 0;
        for (const c of row) count += c.colspan || 1;
        if (count > columns) columns = count;
      }
      blocks.push({ type: 'table', rows, columns, style });
    }
    return;
  }

  if (tag === 'blockquote') {
    for (const child of node.childNodes) {
      walkDom(child, style, blocks, stylesheet, seenImageSrcs);
    }
    return;
  }

  if (tag === 'pre') {
    const text = node.textContent || '';
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (line.length === 0) {
        blocks.push({ type: 'spacer', height: style.fontSize * style.lineHeight, style });
      } else {
        blocks.push({
          type: 'paragraph',
          runs: [{ text: line, style: cloneStyle(style) }],
          style,
          preformatted: true,
        });
      }
    }
    return;
  }

  if (tag === 'figure' || tag === 'figcaption' || tag === 'section' || tag === 'article'
      || tag === 'header' || tag === 'footer' || tag === 'main' || tag === 'aside'
      || tag === 'div') {
    let hasBlockChild = false;
    for (const child of node.childNodes) {
      if (isBlock(child)) { hasBlockChild = true; break; }
    }
    if (hasBlockChild) {
      for (const child of node.childNodes) {
        walkDom(child, style, blocks, stylesheet, seenImageSrcs);
      }
    } else {
      const runs = [];
      collectInlineRuns(node, style, runs, stylesheet);
      if (runs.length > 0) {
        blocks.push({ type: 'paragraph', runs, style });
      }
    }
    return;
  }

  for (const child of node.childNodes) {
    walkDom(child, style, blocks, stylesheet, seenImageSrcs);
  }
}

// ── Текстовий layout ──────────────────────────────────────────────────────

function pickFont(style, fonts) {
  const family = (style.fontFamily === 'sans') ? 'sans' : 'serif';
  const set = fonts[family] || fonts.serif;
  if (style.bold && style.italic) return set.boldItalic;
  if (style.bold) return set.bold;
  if (style.italic) return set.italic;
  return set.regular;
}

function measureRun(text, style, fonts) {
  if (!text) return 0;
  const font = pickFont(style, fonts);
  return font.widthOfTextAtSize(text, style.fontSize);
}

function flattenRunsToSegments(runs, fonts, maxWidth) {
  const segments = [];
  for (const run of runs) {
    if (run.forceBreak) {
      segments.push({ type: 'break' });
      continue;
    }
    if (run.type === 'image') {
      segments.push({ type: 'image', src: run.src, style: run.style, width: run.width, height: run.height });
      continue;
    }
    if (!run.text) continue;
    const parts = run.text.split(/(\s+)/);
    for (const part of parts) {
      if (part === '') continue;
      if (/^\s+$/.test(part)) {
        segments.push({ type: 'space', text: ' ', style: run.style, width: measureRun(' ', run.style, fonts) });
      } else {
        segments.push({ type: 'word', text: part, style: run.style, width: measureRun(part, run.style, fonts) });
      }
    }
  }
  return segments;
}

function layoutLines(segments, fonts, maxWidth) {
  const lines = [];
  let cur = [];
  let curWidth = 0;

  function pushLine(forced = false) {
    lines.push({ segments: cur, forced });
    cur = [];
    curWidth = 0;
  }

  function appendSeg(seg) {
    cur.push(seg);
    curWidth += seg.width || 0;
  }

  function trySplitLongWord(seg) {
    const { text, style } = seg;
    let chunk = '';
    for (const ch of text) {
      const candidate = chunk + ch;
      const w = measureRun(candidate, style, fonts);
      if (w > maxWidth && chunk.length > 0) {
        const part = { type: 'word', text: chunk, style, width: measureRun(chunk, style, fonts) };
        if (cur.length > 0 && curWidth + part.width > maxWidth) pushLine();
        appendSeg(part);
        pushLine();
        chunk = ch;
      } else {
        chunk = candidate;
      }
    }
    if (chunk.length > 0) {
      const part = { type: 'word', text: chunk, style, width: measureRun(chunk, style, fonts) };
      appendSeg(part);
    }
  }

  for (const seg of segments) {
    if (seg.type === 'break') {
      pushLine(true);
      continue;
    }
    if (seg.type === 'space') {
      if (cur.length === 0) continue;
      if (curWidth + seg.width > maxWidth) {
        pushLine();
      } else {
        appendSeg(seg);
      }
      continue;
    }
    if (seg.type === 'image') {
      pushLine();
      cur = [seg];
      curWidth = seg.width || 0;
      pushLine();
      continue;
    }
    if (seg.width <= maxWidth) {
      if (curWidth + seg.width > maxWidth) pushLine();
      appendSeg(seg);
    } else {
      if (cur.length > 0) pushLine();
      trySplitLongWord(seg);
    }
  }
  if (cur.length > 0) pushLine(true);
  if (lines.length === 0) lines.push({ segments: [], forced: true });
  return lines;
}

// ── Render ─────────────────────────────────────────────────────────────────

function createRenderContext(pdfDoc, fonts, opts) {
  const pageWidth = opts.pageWidth || A4_WIDTH;
  const pageHeight = opts.pageHeight || A4_HEIGHT;
  const margins = { ...DEFAULT_MARGINS, ...(opts.margins || {}) };
  const ctx = {
    pdfDoc,
    fonts,
    pageWidth,
    pageHeight,
    margins,
    page: null,
    yCursor: 0,
    contentLeft: margins.left,
    contentRight: pageWidth - margins.right,
    minY: margins.bottom,
    embeddedImages: new Map(),
  };
  newPage(ctx);
  return ctx;
}

function newPage(ctx) {
  ctx.page = ctx.pdfDoc.addPage([ctx.pageWidth, ctx.pageHeight]);
  ctx.yCursor = ctx.pageHeight - ctx.margins.top;
}

function drawLine(ctx, line, opts) {
  const { contentLeft, contentRight, page, fonts } = ctx;
  const { align, isLastLine, marginLeft, marginRight, textIndent, lineHeight, baseFontSize } = opts;

  const usableLeft = contentLeft + (marginLeft || 0) + (textIndent || 0);
  const usableRight = contentRight - (marginRight || 0);
  const usableWidth = usableRight - usableLeft;

  const segs = [...line.segments];
  while (segs.length > 0 && segs[segs.length - 1].type === 'space') segs.pop();
  if (segs.length === 0) return baseFontSize * lineHeight;

  const wordSegs = segs.filter((s) => s.type === 'word');
  const spaceSegs = segs.filter((s) => s.type === 'space');
  const totalWordsWidth = wordSegs.reduce((acc, s) => acc + s.width, 0);
  const totalSpaceWidth = spaceSegs.reduce((acc, s) => acc + s.width, 0);
  const totalWidth = totalWordsWidth + totalSpaceWidth;

  let x = usableLeft;
  let extraSpacePerGap = 0;

  if (align === 'right') x = usableRight - totalWidth;
  else if (align === 'center') x = usableLeft + (usableWidth - totalWidth) / 2;
  else if (align === 'justify' && !isLastLine && !line.forced && spaceSegs.length > 0) {
    const remaining = usableWidth - totalWidth;
    if (remaining > 0) extraSpacePerGap = remaining / spaceSegs.length;
  }
  if (x < usableLeft) x = usableLeft;

  const baselineY = ctx.yCursor - baseFontSize;

  let lineHeightActual = baseFontSize * lineHeight;

  for (const seg of segs) {
    if (seg.type === 'space') {
      x += seg.width + extraSpacePerGap;
      continue;
    }
    if (seg.type === 'word') {
      const font = pickFont(seg.style, fonts);
      const size = seg.style.fontSize;
      let segBaseline = baselineY;
      if (seg.style.superscript) segBaseline += size * 0.4;
      else if (seg.style.subscript) segBaseline -= size * 0.2;

      if (size * lineHeight > lineHeightActual) lineHeightActual = size * lineHeight;

      if (seg.style.bgColor) {
        const bg = seg.style.bgColor;
        page.drawRectangle({
          x,
          y: segBaseline - size * 0.15,
          width: seg.width,
          height: size * 1.15,
          color: rgb(bg.r, bg.g, bg.b),
        });
      }

      page.drawText(seg.text, {
        x,
        y: segBaseline,
        size,
        font,
        color: rgb(seg.style.color.r, seg.style.color.g, seg.style.color.b),
      });

      if (seg.style.underline) {
        const uy = segBaseline - size * 0.12;
        page.drawLine({
          start: { x, y: uy },
          end: { x: x + seg.width, y: uy },
          thickness: Math.max(0.5, size * 0.06),
          color: rgb(seg.style.color.r, seg.style.color.g, seg.style.color.b),
        });
      }
      if (seg.style.strike) {
        const sy = segBaseline + size * 0.3;
        page.drawLine({
          start: { x, y: sy },
          end: { x: x + seg.width, y: sy },
          thickness: Math.max(0.5, size * 0.06),
          color: rgb(seg.style.color.r, seg.style.color.g, seg.style.color.b),
        });
      }

      if (seg.style.linkHref) {
        try {
          addLinkAnnotation(ctx, seg.style.linkHref, {
            x,
            y: segBaseline - size * 0.15,
            width: seg.width,
            height: size * 1.15,
          });
        } catch {
          /* annotation помилка не блокує рендер */
        }
      }

      x += seg.width;
    }
  }

  return lineHeightActual;
}

function addLinkAnnotation(ctx, href, rect) {
  const { pdfDoc, page } = ctx;
  const linkDict = pdfDoc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
    Border: [0, 0, 0],
    A: {
      Type: 'Action',
      S: 'URI',
      URI: PDFString.of(href),
    },
  });
  const ref = pdfDoc.context.register(linkDict);
  const existing = page.node.get(PDFName.of('Annots'));
  if (existing instanceof PDFArray) {
    existing.push(ref);
  } else {
    page.node.set(PDFName.of('Annots'), pdfDoc.context.obj([ref]));
  }
}

// ── Image embed ────────────────────────────────────────────────────────────

async function embedDataUrlImage(ctx, src) {
  if (!src || typeof src !== 'string') return null;
  if (ctx.embeddedImages.has(src)) return ctx.embeddedImages.get(src);

  const m = src.match(/^data:(image\/[a-z+\-]+);base64,(.+)$/i);
  if (!m) {
    ctx.embeddedImages.set(src, null);
    return null;
  }
  const mime = m[1].toLowerCase();
  const base64 = m[2];
  let bytes;
  try {
    const bin = atob(base64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    ctx.embeddedImages.set(src, null);
    return null;
  }
  let embedded = null;
  try {
    if (mime.includes('png')) embedded = await ctx.pdfDoc.embedPng(bytes);
    else if (mime.includes('jpeg') || mime.includes('jpg')) embedded = await ctx.pdfDoc.embedJpg(bytes);
    else {
      // Невідомий формат — пробуємо PNG (часто base64 з невірним MIME)
      try { embedded = await ctx.pdfDoc.embedPng(bytes); }
      catch {
        try { embedded = await ctx.pdfDoc.embedJpg(bytes); }
        catch { embedded = null; }
      }
    }
  } catch {
    embedded = null;
  }
  ctx.embeddedImages.set(src, embedded);
  return embedded;
}

async function renderImageBlock(ctx, block) {
  const { src, align, style } = block;
  const embedded = await embedDataUrlImage(ctx, src);
  if (!embedded) return;

  let drawW = block.width ? parseLength(block.width, 0, style.fontSize) : embedded.width * 0.75;
  let drawH = block.height ? parseLength(block.height, 0, style.fontSize) : embedded.height * 0.75;
  if (!drawW || !drawH) {
    drawW = embedded.width * 0.75;
    drawH = embedded.height * 0.75;
  }

  const usableLeft = ctx.contentLeft + (style.marginLeft || 0);
  const usableRight = ctx.contentRight - (style.marginRight || 0);
  const usableWidth = usableRight - usableLeft;

  if (drawW > usableWidth) {
    const k = usableWidth / drawW;
    drawW *= k;
    drawH *= k;
  }

  if (drawH > ctx.yCursor - ctx.minY) {
    newPage(ctx);
    if (drawH > ctx.yCursor - ctx.minY) {
      const k = (ctx.yCursor - ctx.minY) / drawH;
      drawW *= k;
      drawH *= k;
    }
  }

  let x = usableLeft;
  if (align === 'right') x = usableRight - drawW;
  else if (align === 'center') x = usableLeft + (usableWidth - drawW) / 2;

  ctx.page.drawImage(embedded, {
    x,
    y: ctx.yCursor - drawH,
    width: drawW,
    height: drawH,
  });
  ctx.yCursor -= drawH + PARAGRAPH_SPACING;
}

// ── Block renderers ────────────────────────────────────────────────────────

function renderParagraph(ctx, block) {
  const { runs, style } = block;
  const usableLeft = ctx.contentLeft + (style.marginLeft || 0);
  const usableRight = ctx.contentRight - (style.marginRight || 0);
  const usableWidth = Math.max(0, usableRight - usableLeft);

  const segments = flattenRunsToSegments(runs, ctx.fonts, usableWidth);
  const lines = layoutLines(segments, ctx.fonts, usableWidth - (style.textIndent || 0));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isLast = i === lines.length - 1;
    const lineHeightUsed = drawLine(ctx, line, {
      align: style.align || 'left',
      isLastLine: isLast,
      marginLeft: style.marginLeft,
      marginRight: style.marginRight,
      textIndent: i === 0 ? style.textIndent : 0,
      lineHeight: style.lineHeight,
      baseFontSize: style.fontSize,
    });
    ctx.yCursor -= lineHeightUsed;
    if (ctx.yCursor < ctx.minY && i < lines.length - 1) {
      newPage(ctx);
    }
  }
}

function renderHeading(ctx, block) {
  ctx.yCursor -= HEADING_SPACING_BEFORE;
  if (ctx.yCursor - block.style.fontSize * block.style.lineHeight < ctx.minY) {
    newPage(ctx);
  }
  renderParagraph(ctx, block);
  ctx.yCursor -= HEADING_SPACING_AFTER;
}

function renderList(ctx, block) {
  const { items, ordered, style } = block;
  const level = (style.listLevel || 0) + 1;
  const indent = LIST_INDENT * level;
  let counter = 1;

  for (const item of items) {
    const marker = ordered ? `${counter}.` : '•';
    const markerStyle = cloneStyle(item.style);
    const markerWidth = measureRun(marker, markerStyle, ctx.fonts);

    if (ctx.yCursor - item.style.fontSize * item.style.lineHeight < ctx.minY) {
      newPage(ctx);
    }

    const startY = ctx.yCursor;
    const markerX = ctx.contentLeft + (style.marginLeft || 0) + indent - markerWidth - LIST_BULLET_GAP;
    if (markerX >= ctx.contentLeft) {
      ctx.page.drawText(marker, {
        x: markerX,
        y: startY - item.style.fontSize,
        size: item.style.fontSize,
        font: pickFont(item.style, ctx.fonts),
        color: rgb(item.style.color.r, item.style.color.g, item.style.color.b),
      });
    }

    const itemBlock = {
      type: 'paragraph',
      runs: item.runs,
      style: { ...item.style, marginLeft: (item.style.marginLeft || 0) + indent },
    };
    renderParagraph(ctx, itemBlock);

    if (item.sublist && item.sublist.length > 0) {
      for (const sub of item.sublist) {
        if (sub.style) sub.style = { ...sub.style, listLevel: level };
        renderBlockSync(ctx, sub);
      }
    }
    counter++;
  }
}

function renderHr(ctx, _block) {
  const y = ctx.yCursor - 2;
  ctx.page.drawLine({
    start: { x: ctx.contentLeft, y },
    end: { x: ctx.contentRight, y },
    thickness: 0.5,
    color: rgb(0.6, 0.6, 0.6),
  });
  ctx.yCursor -= 8;
}

function renderSpacer(ctx, block) {
  ctx.yCursor -= block.height || (BASE_FONT_SIZE * BASE_LINE_HEIGHT);
}

function parseWidthHint(hint, totalWidth) {
  if (!hint) return null;
  const s = String(hint).trim();
  if (s.endsWith('%')) {
    const n = parseFloat(s);
    if (!isNaN(n)) return totalWidth * n / 100;
  }
  return parseLength(s, null);
}

function computeColumnWidths(rows, columns, totalWidth) {
  const hints = new Array(columns).fill(null);
  for (const row of rows) {
    let colIdx = 0;
    for (const cell of row) {
      if (cell.widthHint && hints[colIdx] == null) {
        const w = parseWidthHint(cell.widthHint, totalWidth);
        if (w) hints[colIdx] = w;
      }
      colIdx += cell.colspan || 1;
    }
  }
  const knownTotal = hints.reduce((a, b) => a + (b || 0), 0);
  const unknown = hints.filter((h) => h == null).length;
  const remainder = Math.max(0, totalWidth - knownTotal);
  const perUnknown = unknown > 0 ? remainder / unknown : 0;
  return hints.map((h) => (h == null ? perUnknown : h));
}

function measureCellHeight(ctx, cell, width) {
  let h = 4;
  for (const blk of cell.blocks) {
    if (blk.type === 'paragraph' || blk.type === 'heading') {
      const segs = flattenRunsToSegments(blk.runs, ctx.fonts, width - 8);
      const lines = layoutLines(segs, ctx.fonts, width - 8);
      let lh = 0;
      for (const line of lines) {
        let max = blk.style.fontSize * blk.style.lineHeight;
        for (const seg of line.segments) {
          if (seg.style && seg.style.fontSize * blk.style.lineHeight > max) {
            max = seg.style.fontSize * blk.style.lineHeight;
          }
        }
        lh += max;
      }
      h += lh + PARAGRAPH_SPACING;
    } else if (blk.type === 'spacer') {
      h += blk.height || BASE_FONT_SIZE * BASE_LINE_HEIGHT;
    }
  }
  return h + 4;
}

function renderTable(ctx, block) {
  const { rows, columns, style } = block;
  const usableLeft = ctx.contentLeft + (style.marginLeft || 0);
  const usableRight = ctx.contentRight - (style.marginRight || 0);
  const totalWidth = usableRight - usableLeft;
  const colWidths = computeColumnWidths(rows, columns, totalWidth);

  const cellPaddingX = 4;
  const cellPaddingY = 4;
  const borderColor = rgb(0.7, 0.7, 0.7);

  for (const row of rows) {
    let rowH = 0;
    let colIdx = 0;
    const cellMeta = [];
    for (const cell of row) {
      const span = cell.colspan || 1;
      let cellW = 0;
      for (let i = 0; i < span && colIdx + i < colWidths.length; i++) {
        cellW += colWidths[colIdx + i];
      }
      const innerW = Math.max(20, cellW - cellPaddingX * 2);
      const cellH = measureCellHeight(ctx, cell, innerW);
      cellMeta.push({ cell, x: usableLeft + sumUpTo(colWidths, colIdx), width: cellW, innerWidth: innerW, height: cellH });
      if (cellH > rowH) rowH = cellH;
      colIdx += span;
    }
    rowH = Math.max(rowH, 18);

    if (ctx.yCursor - rowH < ctx.minY) {
      newPage(ctx);
    }

    const rowTopY = ctx.yCursor;
    const rowBottomY = rowTopY - rowH;

    for (const meta of cellMeta) {
      ctx.page.drawRectangle({
        x: meta.x,
        y: rowBottomY,
        width: meta.width,
        height: rowH,
        borderColor,
        borderWidth: 0.5,
        color: meta.cell.style.bgColor
          ? rgb(meta.cell.style.bgColor.r, meta.cell.style.bgColor.g, meta.cell.style.bgColor.b)
          : undefined,
      });
      const subCtx = {
        ...ctx,
        contentLeft: meta.x + cellPaddingX,
        contentRight: meta.x + meta.width - cellPaddingX,
        yCursor: rowTopY - cellPaddingY,
        minY: rowBottomY + cellPaddingY,
      };
      for (const blk of meta.cell.blocks) {
        renderBlockSync(subCtx, blk);
      }
    }

    ctx.yCursor = rowBottomY;
  }
  ctx.yCursor -= PARAGRAPH_SPACING;
}

function sumUpTo(arr, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += arr[i] || 0;
  return s;
}

function renderBlockSync(ctx, block) {
  switch (block.type) {
    case 'paragraph':   renderParagraph(ctx, block); break;
    case 'heading':     renderHeading(ctx, block); break;
    case 'list':        renderList(ctx, block); break;
    case 'hr':          renderHr(ctx, block); break;
    case 'spacer':      renderSpacer(ctx, block); break;
    default: break;
  }
}

async function renderBlock(ctx, block) {
  switch (block.type) {
    case 'paragraph':   renderParagraph(ctx, block); break;
    case 'heading':     renderHeading(ctx, block); break;
    case 'list':        renderList(ctx, block); break;
    case 'table':       renderTable(ctx, block); break;
    case 'image':       await renderImageBlock(ctx, block); break;
    case 'hr':          renderHr(ctx, block); break;
    case 'spacer':      renderSpacer(ctx, block); break;
    default: break;
  }
  if (block.type === 'paragraph') ctx.yCursor -= PARAGRAPH_SPACING;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Конвертує HTML рядок у PDF Blob з збереженням форматування.
 *
 * @param {string} html — HTML вміст (від mammoth.convertToHtml або декодований HTML-файл)
 * @param {object} options — { pageWidth, pageHeight, margins, defaultFontFamily }
 *   defaultFontFamily: 'serif' (default) | 'sans'
 * @returns {Promise<Blob>} PDF Blob (application/pdf, selectable text)
 */
export async function htmlToPdfViaPdfLib(html, options = {}) {
  if (!html || typeof html !== 'string') {
    throw new Error('htmlToPdfViaPdfLib: html має бути непорожнім рядком');
  }

  // 1. Pre-process: розкриваємо MS Office conditional comments.
  // Word "save as HTML" загортає VML у <!--[if gte vml 1]>...<![endif]--> і
  // має дзеркальний fallback <!--[if !vml]>...<![endif]--> з <img>. DOMParser
  // не парсить це — VML і fallback img стають недосяжні. Розкриваємо обидва
  // блоки у видимий HTML щоб renderer їх побачив. Дублювання герба знімаємо
  // далі через imageSrcSeen у walkDom.
  const preprocessed = html
    .replace(/<!--\s*\[if [^\]]*\]\s*>/gi, '')
    .replace(/<!\s*\[if [^\]]*\]\s*>/gi, '')
    .replace(/<!\s*\[endif\]\s*-->/gi, '')
    .replace(/<!\s*\[endif\]\s*>/gi, '');

  // 2. Парсинг HTML
  const parser = new DOMParser();
  const wrappedHtml = /<html[\s>]/i.test(preprocessed) ? preprocessed : `<!doctype html><html><body>${preprocessed}</body></html>`;
  const doc = parser.parseFromString(wrappedHtml, 'text/html');
  const root = doc.body || doc.documentElement;
  if (!root) throw new Error('htmlToPdfViaPdfLib: не вдалось розпарсити HTML');

  // 2. Збір CSS правил з усіх <style> блоків (head + body)
  const stylesheet = collectStyleSheet(doc);

  // 3. Збір блоків. seenImageSrcs дедуплікує герб коли він зʼявляється і у VML
  // блоці, і у <img> fallback (Word conditional comments — обидва тепер видимі).
  const blocks = [];
  const initStyle = defaultStyle();
  if (options.defaultFontFamily === 'sans') initStyle.fontFamily = 'sans';
  const seenImageSrcs = new Set();
  for (const child of root.childNodes) {
    walkDom(child, initStyle, blocks, stylesheet, seenImageSrcs);
  }

  // 4. Підготовка pdf-lib документа з усіма 8 шрифтами
  const [fontkitModule, fontBytes] = await Promise.all([
    import('@pdf-lib/fontkit'),
    loadAllFontBytes(),
  ]);
  const fontkit = fontkitModule.default || fontkitModule;
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const fonts = {
    sans: {
      regular: await pdfDoc.embedFont(fontBytes.sans.regular, { subset: true }),
      bold: await pdfDoc.embedFont(fontBytes.sans.bold, { subset: true }),
      italic: await pdfDoc.embedFont(fontBytes.sans.italic, { subset: true }),
      boldItalic: await pdfDoc.embedFont(fontBytes.sans.boldItalic, { subset: true }),
    },
    serif: {
      regular: await pdfDoc.embedFont(fontBytes.serif.regular, { subset: true }),
      bold: await pdfDoc.embedFont(fontBytes.serif.bold, { subset: true }),
      italic: await pdfDoc.embedFont(fontBytes.serif.italic, { subset: true }),
      boldItalic: await pdfDoc.embedFont(fontBytes.serif.boldItalic, { subset: true }),
    },
  };

  // 5. Рендер
  const ctx = createRenderContext(pdfDoc, fonts, options);
  for (const block of blocks) {
    await renderBlock(ctx, block);
  }

  if (pdfDoc.getPageCount() === 0) {
    pdfDoc.addPage([ctx.pageWidth, ctx.pageHeight]);
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes], { type: 'application/pdf' });
}

// Експорт для тестів
export const __test__ = {
  parseInlineStyle,
  parseLength,
  parseImgLength,
  parseColor,
  parseStyleBlock,
  mapFontFamily,
  styleForElement,
  walkDom,
  splitParagraphByImages,
  layoutLines,
  flattenRunsToSegments,
  defaultStyle,
  collectStyleSheet,
  getStylesheetDeclsForElement,
  findVmlImagedataSrc,
};
