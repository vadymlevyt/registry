// ── PDF-LIB HTML RENDERER ────────────────────────────────────────────────────
// Конвертує HTML (від mammoth.convertToHtml або декодованого HTML-файлу) у PDF
// Blob через pdf-lib. На відміну від pdfLibRenderer.textToPdf — зберігає
// форматування з HTML: заголовки, жирний/курсив/підкреслення, вирівнювання,
// списки, таблиці, зображення, гіперпосилання.
//
// Принцип: PDF — це наш єдиний формат відображення. Mozilla pdfjs у Viewer
// підтримує highlight/нотатки тільки на searchable PDF. pdf-lib генерує саме
// searchable PDF з виділюваним текстом, тому конвертовані DOCX/HTML отримають
// ті самі інструменти анотацій що звичайні PDF.
//
// ── ЧОМУ НЕ html2pdf.js ─────────────────────────────────────────────────────
// html2pdf.js на планшеті/мобільному viewport видавав порожній PDF (html2canvas
// + mm-юніти + off-screen). pdf-lib працює без DOM/canvas і повністю
// контрольовано. До того ж html2pdf робить raster — текст НЕ виділяється у
// pdfjs анотаціях; pdf-lib робить selectable text.
//
// ── ЩО ВРАХОВАНО ────────────────────────────────────────────────────────────
// Блок-рівень:
//   h1-h6  → крупніший шрифт + bold + відступи зверху/знизу
//   p      → абзац з вирівнюванням (left/right/center/justify), text-indent,
//            margin-left/right
//   ul/ol  → списки з маркерами/нумерацією, вкладені списки з відступом
//   table  → проста таблиця з рівними або заданими ширинами колонок,
//            page-break коли рядок не влазить
//   img    → embed (PNG/JPG/base64 data: URI), fit у ширину контенту
//   hr     → горизонтальна лінія
//   br     → перенос рядка всередині абзацу
//   blockquote → відступ зліва + курсив
//   pre    → монопростір (опускаємось до Regular але зберігаємо переноси)
//   div    → прозорий контейнер (стилі успадковуються вниз)
//
// Inline-рівень:
//   b/strong   → жирний
//   i/em       → курсив
//   u          → підкреслення
//   sub/sup    → зменшений шрифт + baseline shift
//   a[href]    → синій + підкреслення + клік-анотація у PDF
//   span       → носій inline-стилів (font-weight, font-style, text-decoration,
//                color, background-color, font-size)
//
// CSS inline (з style="..."):
//   text-align, font-weight, font-style, text-decoration, font-size, color,
//   background-color, margin-left, margin-right, text-indent, line-height,
//   width (для таблиць і колонок).
//
// ── ЧОГО НЕМАЄ ──────────────────────────────────────────────────────────────
// Складний CSS (зовнішні таблиці стилів, media queries, flex/grid), вкладені
// таблиці більше 1 рівня, плавання (float), розширений типографічний контроль,
// колоночна верстка. Для адвокатських документів — це не потрібно. Складна
// верстка тяжіє до PDF/Print від Word — а оригінал DOCX лежить поряд як
// originalDriveId і завжди доступний для завантаження.

import { PDFDocument, rgb, PDFName, PDFString, PDFArray, PDFDict } from 'pdf-lib';

// ── A4 + одиниці ───────────────────────────────────────────────────────────
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MM_TO_PT = 72 / 25.4;

// Поля сторінки за ДСТУ для ділових документів.
const DEFAULT_MARGINS = {
  top: 20 * MM_TO_PT,
  bottom: 20 * MM_TO_PT,
  left: 30 * MM_TO_PT,
  right: 20 * MM_TO_PT,
};

// Базовий шрифт. 12pt — стандарт для ділового документа.
const BASE_FONT_SIZE = 12;
const BASE_LINE_HEIGHT = 1.4;

// Розміри заголовків (наближено до Word default). Розрахунок: pt = BASE * scale.
const HEADING_SCALE = { h1: 1.8, h2: 1.5, h3: 1.3, h4: 1.15, h5: 1.05, h6: 1.0 };
const HEADING_SPACING_BEFORE = 8; // pt
const HEADING_SPACING_AFTER = 4;  // pt
const PARAGRAPH_SPACING = 4;      // pt між абзацами
const LIST_INDENT = 18;           // pt відступ кожного рівня списку
const LIST_BULLET_GAP = 6;        // pt між маркером і текстом
const BLOCKQUOTE_INDENT = 24;     // pt відступ цитати

// Колір гіперпосилання (Word-style hyperlink blue).
const LINK_COLOR = { r: 0.0, g: 0.36, b: 0.65 };

// ── Шрифти ─────────────────────────────────────────────────────────────────
// 4 варіанти LiberationSans з повною підтримкою кирилиці. Lazy-fetch у
// in-memory cache. Bundle головного chunk'у не тягне ці байти — Vite копіює
// public/fonts/* у dist і браузер тягне at-runtime один раз за сесію.

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
    const [regular, bold, italic, boldItalic] = await Promise.all([
      fetchFontBytes('LiberationSans-Regular.ttf'),
      fetchFontBytes('LiberationSans-Bold.ttf'),
      fetchFontBytes('LiberationSans-Italic.ttf'),
      fetchFontBytes('LiberationSans-BoldItalic.ttf'),
    ]);
    return { regular, bold, italic, boldItalic };
  })().catch((e) => {
    fontBytesCachePromise = null; // дозволити повторну спробу
    throw e;
  });
  return fontBytesCachePromise;
}

// ── Стилі ──────────────────────────────────────────────────────────────────
// "style" — нормалізована структура яка тримає тільки те що ми вміємо рендерити.
// Прохід по DOM каскадно успадковує stale значення; нові атрибути перекривають.

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
    align: 'left',            // left | right | center | justify
    marginLeft: 0,            // pt додатковий лівий зсув
    marginRight: 0,           // pt додатковий правий зсув
    textIndent: 0,            // pt відступ першого рядка
    subscript: false,
    superscript: false,
    linkHref: null,
    listLevel: 0,             // для вкладених списків
  };
}

function cloneStyle(s) {
  return { ...s, color: { ...s.color }, bgColor: s.bgColor ? { ...s.bgColor } : null };
}

// Парсинг inline CSS у словник {prop: value}. Простий і толерантний до помилок.
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

// Парсинг розмірів у pt. Підтримує px, pt, em, %, mm, cm — найрозповсюдженіші.
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
    case 'px': return n * 0.75;                  // 96 dpi -> 72 pt: px*0.75
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

// Парсинг кольору (hex, rgb(), rgba(), keyword). Повертає {r,g,b} у [0,1] або null.
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
  if (!v || v === 'transparent' || v === 'inherit' || v === 'currentcolor') return null;
  if (COLOR_KEYWORDS[v]) {
    const [r, g, b] = COLOR_KEYWORDS[v];
    return { r, g, b };
  }
  // #rgb / #rrggbb
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

// Перенесення стилів елемента у клон поточного стилю. Обчислюється з:
// 1) дефолтів тегу (h1 → fontSize+bold, b/strong → bold і т.д.)
// 2) class-маркерів від mammoth styleMap (.align-justify, .align-center, ...)
// 3) inline style="..." атрибута
// Кожен наступний крок перекриває попередній.
function styleForElement(el, parentStyle) {
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
    case 'i': case 'em':
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
    default:
      break;
  }

  // 2. Class-маркери від mammoth styleMap
  const cls = el.className && typeof el.className === 'string' ? el.className : '';
  if (cls) {
    if (cls.includes('align-justify')) s.align = 'justify';
    else if (cls.includes('align-center')) s.align = 'center';
    else if (cls.includes('align-right')) s.align = 'right';
    else if (cls.includes('align-left')) s.align = 'left';
  }

  // 3. Атрибут align (legacy HTML — використовується у деяких ЄСІТС ухвалах)
  const alignAttr = el.getAttribute && el.getAttribute('align');
  if (alignAttr) {
    const a = alignAttr.toLowerCase();
    if (['left', 'right', 'center', 'justify'].includes(a)) s.align = a;
  }

  // 4. inline style="..." — перекриває попереднє
  const inline = el.getAttribute && parseInlineStyle(el.getAttribute('style'));
  if (inline) {
    if (inline['text-align']) {
      const a = inline['text-align'].toLowerCase();
      if (['left', 'right', 'center', 'justify'].includes(a)) s.align = a;
    }
    if (inline['font-weight']) {
      const w = inline['font-weight'].toLowerCase();
      const wn = parseInt(w, 10);
      if (w === 'bold' || w === 'bolder' || (!isNaN(wn) && wn >= 600)) s.bold = true;
      else if (w === 'normal' || w === 'lighter' || (!isNaN(wn) && wn < 600)) s.bold = false;
    }
    if (inline['font-style']) {
      const fs = inline['font-style'].toLowerCase();
      if (fs === 'italic' || fs === 'oblique') s.italic = true;
      else if (fs === 'normal') s.italic = false;
    }
    if (inline['text-decoration'] || inline['text-decoration-line']) {
      const td = (inline['text-decoration'] || inline['text-decoration-line']).toLowerCase();
      if (td.includes('underline')) s.underline = true;
      if (td.includes('line-through')) s.strike = true;
      if (td.includes('none')) { s.underline = false; s.strike = false; }
    }
    if (inline['font-size']) {
      const fontSize = parseLength(inline['font-size'], s.fontSize, parentStyle.fontSize);
      if (fontSize > 0) s.fontSize = fontSize;
    }
    if (inline['line-height']) {
      const lh = inline['line-height'];
      const num = parseFloat(lh);
      if (!isNaN(num)) {
        // Числове значення без юніту — multiplier; з юнітом — абсолютне.
        if (/^[\d.]+$/.test(lh.trim())) s.lineHeight = num;
        else {
          const abs = parseLength(lh, 0, s.fontSize);
          if (abs > 0) s.lineHeight = abs / s.fontSize;
        }
      }
    }
    const color = parseColor(inline['color']);
    if (color) s.color = color;
    const bg = parseColor(inline['background-color'] || inline['background']);
    if (bg) s.bgColor = bg;
    if (inline['margin-left']) {
      const ml = parseLength(inline['margin-left'], 0, s.fontSize);
      s.marginLeft = (parentStyle.marginLeft || 0) + ml;
    }
    if (inline['margin-right']) {
      const mr = parseLength(inline['margin-right'], 0, s.fontSize);
      s.marginRight = (parentStyle.marginRight || 0) + mr;
    }
    if (inline['padding-left']) {
      const pl = parseLength(inline['padding-left'], 0, s.fontSize);
      s.marginLeft = (s.marginLeft || 0) + pl;
    }
    if (inline['text-indent']) {
      s.textIndent = parseLength(inline['text-indent'], 0, s.fontSize);
    }
  }

  return s;
}

// ── DOM walker → blocks ────────────────────────────────────────────────────
// Прохід дерева у плоский список блоків.
// Block types:
//   { type: 'paragraph', runs, style }
//   { type: 'heading',   runs, style, level }
//   { type: 'list',      ordered, items: [{ runs, style, sublist?, marker? }] }
//   { type: 'table',     rows, columns, style }
//   { type: 'image',     src, width, height, align }
//   { type: 'hr' }
//   { type: 'spacer',    height }
//
// Run: { text, style }

const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'img', 'hr', 'blockquote', 'pre', 'figure', 'figcaption',
]);

function isBlock(node) {
  return node && node.nodeType === 1 && BLOCK_TAGS.has(node.tagName.toLowerCase());
}

function collectInlineRuns(node, style, runs) {
  if (!node) return;
  if (node.nodeType === 3) {
    // Текстовий вузол. Колапс послідовних пробілів — як у HTML за замовчуванням.
    const raw = node.nodeValue || '';
    const collapsed = raw.replace(/\s+/g, ' ');
    if (collapsed === '' || collapsed === ' ') {
      // Зберігаємо одинарний пробіл як run щоб не злити слова з різних inline
      if (runs.length > 0 && !runs[runs.length - 1].text.endsWith(' ')) {
        runs.push({ text: ' ', style: cloneStyle(style) });
      }
      return;
    }
    runs.push({ text: collapsed, style: cloneStyle(style) });
    return;
  }
  if (node.nodeType !== 1) return;
  const tag = node.tagName.toLowerCase();

  // <br> — явний перенос рядка
  if (tag === 'br') {
    runs.push({ text: '\n', style: cloneStyle(style), forceBreak: true });
    return;
  }

  // <img> inline — менш типово для адвокатських документів. Якщо така inline-картинка,
  // обробляємо як окремий "img-inline" run; рендерер вирівнює baseline.
  if (tag === 'img') {
    const src = node.getAttribute('src');
    if (src) {
      runs.push({ type: 'image', src, style: cloneStyle(style), width: parseLength(node.getAttribute('width'), null), height: parseLength(node.getAttribute('height'), null) });
    }
    return;
  }

  // Inline блок з власними стилями. Рекурсивно у дітей.
  const childStyle = styleForElement(node, style);
  const children = node.childNodes;
  for (let i = 0; i < children.length; i++) {
    collectInlineRuns(children[i], childStyle, runs);
  }
}

function walkDom(node, parentStyle, blocks, ctx = {}) {
  if (!node) return;
  if (node.nodeType !== 1) {
    // Текст на верхньому рівні — обернути у paragraph
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
  const style = styleForElement(node, parentStyle);

  if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'meta' || tag === 'link' || tag === 'head') {
    return;
  }

  if (tag === 'hr') {
    blocks.push({ type: 'hr', style });
    return;
  }

  if (tag === 'img') {
    const src = node.getAttribute('src');
    if (src) {
      const align = style.align || 'left';
      const w = parseLength(node.getAttribute('width'), null);
      const h = parseLength(node.getAttribute('height'), null);
      blocks.push({ type: 'image', src, width: w, height: h, align, style });
    }
    return;
  }

  if (/^h[1-6]$/.test(tag)) {
    const runs = [];
    collectInlineRuns(node, style, runs);
    if (runs.length > 0) {
      blocks.push({ type: 'heading', level: parseInt(tag[1], 10), runs, style });
    }
    return;
  }

  if (tag === 'p') {
    const runs = [];
    collectInlineRuns(node, style, runs);
    if (runs.length > 0) {
      blocks.push({ type: 'paragraph', runs, style });
    } else {
      // Порожній абзац — невеликий пропуск (Word робить такі для розділювача).
      blocks.push({ type: 'spacer', height: style.fontSize * style.lineHeight, style });
    }
    return;
  }

  if (tag === 'ul' || tag === 'ol') {
    const ordered = tag === 'ol';
    const items = [];
    let n = 1;
    for (const child of node.children) {
      if (child.tagName.toLowerCase() !== 'li') continue;
      const itemStyle = styleForElement(child, style);
      itemStyle.listLevel = (parentStyle.listLevel || 0) + 1;
      // Розділяємо li на inline-runs і nested-списки.
      const runs = [];
      const sublistBlocks = [];
      for (const grand of child.childNodes) {
        if (grand.nodeType === 1 && (grand.tagName.toLowerCase() === 'ul' || grand.tagName.toLowerCase() === 'ol')) {
          walkDom(grand, itemStyle, sublistBlocks);
        } else {
          collectInlineRuns(grand, itemStyle, runs);
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
    // Збираємо всі <tr> з thead/tbody/tfoot/самої таблиці.
    function collectRows(parent) {
      for (const child of parent.children) {
        const t = child.tagName.toLowerCase();
        if (t === 'tr') {
          const cells = [];
          for (const cell of child.children) {
            const ct = cell.tagName.toLowerCase();
            if (ct !== 'td' && ct !== 'th') continue;
            const cellStyle = styleForElement(cell, style);
            if (ct === 'th') cellStyle.bold = true;
            const cellBlocks = [];
            // Комірка може містити параграфи, списки, навіть вкладені таблиці.
            // Якщо містить лише текст — рендеримо як один абзац.
            let hasBlockChild = false;
            for (const grand of cell.childNodes) {
              if (isBlock(grand)) { hasBlockChild = true; break; }
            }
            if (hasBlockChild) {
              for (const grand of cell.childNodes) {
                walkDom(grand, cellStyle, cellBlocks);
              }
            } else {
              const runs = [];
              collectInlineRuns(cell, cellStyle, runs);
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
      // Кількість колонок — максимум серед рядків (з урахуванням colspan).
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
    // Внутрішні блоки з успадкованими стилями (italic + indent).
    for (const child of node.childNodes) {
      walkDom(child, style, blocks);
    }
    return;
  }

  if (tag === 'pre') {
    // Зберігаємо переноси як є — кожен рядок як окремий paragraph без wrap.
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
    // Контейнер — спускаємось у дітей. Якщо немає блокових нащадків і є text —
    // обертаємо в paragraph.
    let hasBlockChild = false;
    for (const child of node.childNodes) {
      if (isBlock(child)) { hasBlockChild = true; break; }
    }
    if (hasBlockChild) {
      for (const child of node.childNodes) {
        walkDom(child, style, blocks);
      }
    } else {
      const runs = [];
      collectInlineRuns(node, style, runs);
      if (runs.length > 0) {
        blocks.push({ type: 'paragraph', runs, style });
      }
    }
    return;
  }

  // Інші теги (html, body…) — глибше.
  for (const child of node.childNodes) {
    walkDom(child, style, blocks);
  }
}

// ── Текстовий layout: розбиття runs на рядки з word-wrap ────────────────────
//
// Алгоритм: послідовно йдемо по runs, всередині runs по словах (split на
// whitespace зі збереженням пробілів). Накопичуємо у поточному рядку. Коли
// додаткове слово/run-сегмент не влазить — закриваємо рядок, починаємо новий.
//
// Кожен rendered line — масив "сегментів" {text, style, isSpace, width}. Width
// рахується через відповідний font.widthOfTextAtSize.

function pickFont(style, fonts) {
  if (style.bold && style.italic) return fonts.boldItalic;
  if (style.bold) return fonts.bold;
  if (style.italic) return fonts.italic;
  return fonts.regular;
}

function measureRun(text, style, fonts) {
  if (!text) return 0;
  const font = pickFont(style, fonts);
  return font.widthOfTextAtSize(text, style.fontSize);
}

// Тонші пробіли при justify не використовуємо — у pdf-lib drawText розпорядки
// слів виконуємо вручну (малюємо кожне слово окремо). Так зберігаємо тип-якість.

function flattenRunsToSegments(runs, fonts, maxWidth) {
  // Сегмент = одне слово АБО пробіл АБО форсований break. Кожен сегмент має style.
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
    // Розбиваємо на токени: збагачено-нормалізований текст:
    //   - послідовності пробілів збираємо в один пробіл-сегмент
    //   - між пробілами — слова, які можемо переносити
    const parts = run.text.split(/(\s+)/);
    for (const part of parts) {
      if (part === '') continue;
      if (/^\s+$/.test(part)) {
        segments.push({ type: 'space', text: ' ', style: run.style, width: measureRun(' ', run.style, fonts) });
      } else {
        // Слово може бути довшим за рядок — розіб'ємо посимвольно у layout.
        segments.push({ type: 'word', text: part, style: run.style, width: measureRun(part, run.style, fonts) });
      }
    }
  }
  return segments;
}

// Бере сегменти і розкладає у lines, кожен line — масив сегментів які
// помістились. Розриває довге слово посимвольно при потребі.
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
    // Слово ширше за maxWidth — розбити посимвольно.
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
      // Пробіл на початку рядка — пропускаємо.
      if (cur.length === 0) continue;
      // Пробіл у кінці допустимий; зайве урізаємо при рендері.
      if (curWidth + seg.width > maxWidth) {
        pushLine();
      } else {
        appendSeg(seg);
      }
      continue;
    }
    if (seg.type === 'image') {
      // Inline image — для рідкісного випадку рахуємо як вузький елемент.
      // У TODO: масштабувати по style.fontSize. Поки лишаємо як break + block рендер.
      pushLine();
      cur = [seg];
      curWidth = seg.width || 0;
      pushLine();
      continue;
    }
    // word
    if (seg.width <= maxWidth) {
      if (curWidth + seg.width > maxWidth) pushLine();
      appendSeg(seg);
    } else {
      // Перевищує — розбити.
      if (cur.length > 0) pushLine();
      trySplitLongWord(seg);
    }
  }
  if (cur.length > 0) pushLine(true);
  if (lines.length === 0) lines.push({ segments: [], forced: true });
  return lines;
}

// ── Render ─────────────────────────────────────────────────────────────────
// Контекст рендеру — pdfDoc + поточна сторінка + yCursor + fonts + опції.

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
    embeddedImages: new Map(), // src → embedded ref
  };
  newPage(ctx);
  return ctx;
}

function newPage(ctx) {
  ctx.page = ctx.pdfDoc.addPage([ctx.pageWidth, ctx.pageHeight]);
  ctx.yCursor = ctx.pageHeight - ctx.margins.top;
}

function ensureSpace(ctx, needed) {
  if (ctx.yCursor - needed < ctx.minY) {
    newPage(ctx);
    return true;
  }
  return false;
}

// Малюємо рядок з сегментами на сторінці. Повертає висоту яку зайняв рядок.
function drawLine(ctx, line, opts) {
  const { contentLeft, contentRight, page, fonts } = ctx;
  const { align, isLastLine, marginLeft, marginRight, textIndent, lineHeight, baseFontSize } = opts;

  const usableLeft = contentLeft + (marginLeft || 0) + (textIndent || 0);
  const usableRight = contentRight - (marginRight || 0);
  const usableWidth = usableRight - usableLeft;

  // Визначаємо фактичну ширину рядка (без trailing space сегментів).
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

  // baseline для drawText — y координата нижньої межі шрифту. У pdf-lib y =
  // baseline (не top-edge). Зміщуємо вниз на висоту шрифту щоб top-edge був на yCursor.
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
      // Baseline shift для sub/sup
      let segBaseline = baselineY;
      if (seg.style.superscript) segBaseline += size * 0.4;
      else if (seg.style.subscript) segBaseline -= size * 0.2;

      // Tracking найбільшого fontSize у рядку для динамічної висоти
      if (size * lineHeight > lineHeightActual) lineHeightActual = size * lineHeight;

      // Background color
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

      // Underline
      if (seg.style.underline) {
        const uy = segBaseline - size * 0.12;
        page.drawLine({
          start: { x, y: uy },
          end: { x: x + seg.width, y: uy },
          thickness: Math.max(0.5, size * 0.06),
          color: rgb(seg.style.color.r, seg.style.color.g, seg.style.color.b),
        });
      }
      // Strikethrough
      if (seg.style.strike) {
        const sy = segBaseline + size * 0.3;
        page.drawLine({
          start: { x, y: sy },
          end: { x: x + seg.width, y: sy },
          thickness: Math.max(0.5, size * 0.06),
          color: rgb(seg.style.color.r, seg.style.color.g, seg.style.color.b),
        });
      }

      // Link annotation
      if (seg.style.linkHref) {
        try {
          addLinkAnnotation(ctx, seg.style.linkHref, {
            x,
            y: segBaseline - size * 0.15,
            width: seg.width,
            height: size * 1.15,
          });
        } catch {
          /* annotation помилка не має блокувати рендер тексту */
        }
      }

      x += seg.width;
    }
  }

  return lineHeightActual;
}

function addLinkAnnotation(ctx, href, rect) {
  // pdf-lib не має прямого API для link annotations; будуємо PDFDict вручну.
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

// ── Image helpers ──────────────────────────────────────────────────────────

async function embedDataUrlImage(ctx, src) {
  if (!src || typeof src !== 'string') return null;
  if (ctx.embeddedImages.has(src)) return ctx.embeddedImages.get(src);

  const m = src.match(/^data:(image\/[a-z+\-]+);base64,(.+)$/i);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const base64 = m[2];
  let bytes;
  try {
    const bin = atob(base64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return null;
  }
  let embedded;
  try {
    if (mime.includes('png')) embedded = await ctx.pdfDoc.embedPng(bytes);
    else if (mime.includes('jpeg') || mime.includes('jpg')) embedded = await ctx.pdfDoc.embedJpg(bytes);
    else {
      // pdf-lib не embed'ить SVG/GIF/WEBP напряму. Пробуємо PNG як fallback.
      try { embedded = await ctx.pdfDoc.embedPng(bytes); }
      catch { embedded = null; }
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
  if (!embedded) return; // тихо пропускаємо непідтримуване зображення

  // Розмір: hint з атрибутів width/height у px, або власні розміри картинки.
  let drawW = block.width ? parseLength(block.width, 0, style.fontSize) : embedded.width * 0.75;
  let drawH = block.height ? parseLength(block.height, 0, style.fontSize) : embedded.height * 0.75;
  if (!drawW || !drawH) {
    drawW = embedded.width * 0.75;
    drawH = embedded.height * 0.75;
  }

  const usableLeft = ctx.contentLeft + (style.marginLeft || 0);
  const usableRight = ctx.contentRight - (style.marginRight || 0);
  const usableWidth = usableRight - usableLeft;

  // Якщо ширше за content — масштабуємо щоб помістилось
  if (drawW > usableWidth) {
    const k = usableWidth / drawW;
    drawW *= k;
    drawH *= k;
  }

  // Page break якщо не вміщається повністю на поточній сторінці
  if (drawH > ctx.yCursor - ctx.minY) {
    newPage(ctx);
    if (drawH > ctx.yCursor - ctx.minY) {
      // навіть на пустій сторінці не вміщається — масштабуємо
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
  // Текстова частина без textIndent — wrap до usableWidth.
  // textIndent застосовуємо лише до першого рядка, тому віднімаємо від ширини
  // першого рядка вручну.
  const lines = layoutLines(segments, ctx.fonts, usableWidth - (style.textIndent || 0));
  // ВАЖЛИВО: layoutLines повертає лінії під ширину з врахуванням індента.
  // Першу лінію відсуваємо на textIndent; решта без індента — але це означає
  // що далі їх ширина може бути не максимальною. У типових документах textIndent
  // = 0 або невеликий — обмеження прийнятне. Для точнішого результату передаємо
  // повну ширину і інденд застосовуємо у drawLine для першої лінії — це і є
  // поточна поведінка.

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isLast = i === lines.length - 1;
    const lineHeightUsed = drawLine(ctx, line, {
      align: style.align,
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
  // Trailing space перед заголовком
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
    // Маркер
    const marker = ordered ? `${counter}.` : '•';
    const markerStyle = cloneStyle(item.style);
    const markerWidth = measureRun(marker, markerStyle, ctx.fonts);

    // Перевірка page break
    if (ctx.yCursor - item.style.fontSize * item.style.lineHeight < ctx.minY) {
      newPage(ctx);
    }

    // Малюємо маркер на baseline першого рядка тексту, плюс рендеримо runs з відступом
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

    // Текст пункту: тимчасово зсуваємо contentLeft на indent
    const itemBlock = {
      type: 'paragraph',
      runs: item.runs,
      style: { ...item.style, marginLeft: (item.style.marginLeft || 0) + indent },
    };
    renderParagraph(ctx, itemBlock);

    // Вкладений список (sublist)
    if (item.sublist && item.sublist.length > 0) {
      for (const sub of item.sublist) {
        // Підняти listLevel у style блоку — переробляємо стилі
        if (sub.style) sub.style = { ...sub.style, listLevel: level };
        renderBlock(ctx, sub);
      }
    }
    counter++;
  }
}

function renderHr(ctx, block) {
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

// ── Table rendering ────────────────────────────────────────────────────────
// Прості таблиці: рівні колонки якщо немає width hint; row-by-row рендер з
// page-break коли рядок не влазить.

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
  // Шукаємо явні width у першому рядку (typical Word-style).
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
  // Розподіляємо: відомі ширини беремо, невідомі — порівну ділять залишок.
  const knownTotal = hints.reduce((a, b) => a + (b || 0), 0);
  const unknown = hints.filter((h) => h == null).length;
  const remainder = Math.max(0, totalWidth - knownTotal);
  const perUnknown = unknown > 0 ? remainder / unknown : 0;
  return hints.map((h) => (h == null ? perUnknown : h));
}

function measureCellHeight(ctx, cell, width) {
  // Спрощено: для текстових блоків рахуємо як сума висот рядків.
  let h = 4; // padding top
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
  return h + 4; // padding bottom
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
    // Розрахунок висоти рядка
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

    // Page break якщо рядок не влазить
    if (ctx.yCursor - rowH < ctx.minY) {
      newPage(ctx);
    }

    const rowTopY = ctx.yCursor;
    const rowBottomY = rowTopY - rowH;

    // Малюємо комірки
    for (const meta of cellMeta) {
      // Border
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
      // Вміст комірки — окремий sub-context з обмеженою шириною
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

// Sync-варіант renderBlock без async (для cells — там не embed'имо нові
// зображення з data URLs у комірках для простоти; підтримуємо paragraph/heading/list/hr/spacer).
function renderBlockSync(ctx, block) {
  switch (block.type) {
    case 'paragraph':   renderParagraph(ctx, block); break;
    case 'heading':     renderHeading(ctx, block); break;
    case 'list':        renderList(ctx, block); break;
    case 'hr':          renderHr(ctx, block); break;
    case 'spacer':      renderSpacer(ctx, block); break;
    // image, table — не рендеримо всередині комірок (нечасто потрібно)
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
  // Невеликий paragraph-spacing між блоками
  if (block.type === 'paragraph') ctx.yCursor -= PARAGRAPH_SPACING;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Конвертує HTML рядок у PDF Blob з збереженням форматування.
 *
 * @param {string} html — HTML вміст (від mammoth.convertToHtml або декодований HTML-файл)
 * @param {object} options — { pageWidth, pageHeight, margins }
 * @returns {Promise<Blob>} PDF Blob (application/pdf, selectable text)
 */
export async function htmlToPdfViaPdfLib(html, options = {}) {
  if (!html || typeof html !== 'string') {
    throw new Error('htmlToPdfViaPdfLib: html має бути непорожнім рядком');
  }

  // 1. Парсинг HTML
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const root = doc.body || doc.documentElement;
  if (!root) throw new Error('htmlToPdfViaPdfLib: не вдалось розпарсити HTML');

  // 2. Збір блоків
  const blocks = [];
  const initStyle = defaultStyle();
  for (const child of root.childNodes) {
    walkDom(child, initStyle, blocks);
  }

  // 3. Підготовка pdf-lib документа з усіма шрифтами
  const [fontkitModule, fontBytes] = await Promise.all([
    import('@pdf-lib/fontkit'),
    loadAllFontBytes(),
  ]);
  const fontkit = fontkitModule.default || fontkitModule;
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const fonts = {
    regular: await pdfDoc.embedFont(fontBytes.regular, { subset: true }),
    bold: await pdfDoc.embedFont(fontBytes.bold, { subset: true }),
    italic: await pdfDoc.embedFont(fontBytes.italic, { subset: true }),
    boldItalic: await pdfDoc.embedFont(fontBytes.boldItalic, { subset: true }),
  };

  // 4. Рендер блоків
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
  parseColor,
  styleForElement,
  walkDom,
  layoutLines,
  flattenRunsToSegments,
  defaultStyle,
};
