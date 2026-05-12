// ── DOCX → PDF ───────────────────────────────────────────────────────────────
// Конвертує DOCX файл у PDF Blob з ЗБЕРЕЖЕННЯМ ФОРМАТУВАННЯ через
// mammoth.convertToHtml + pdfLibHtmlRenderer.
//
// Pipeline:
//   1. Прочитати file як ArrayBuffer
//   2. validateDocxSignature (ZIP PK\\x03\\x04)
//   3. Паралельно:
//      - mammoth.convertToHtml({ arrayBuffer }, {
//          styleMap, convertImage, transformDocument
//        })
//        — transformDocument проставляє styleName на абзацах і run'ах за
//          alignment / font, щоб styleMap зміг вибрати потрібний клас CSS.
//        — styleMap прописує p.align-* (вирівнювання) і span.font-*
//          (родина шрифту). pdfLibHtmlRenderer розпізнає ці класи у DOM.
//        — convertImage embed'ить картинки як data: URI з base64.
//      - mammoth.extractRawText → plain-текст для .txt кешу
//   4. pdfLibHtmlRenderer.htmlToPdfViaPdfLib(html) → searchable PDF
//
// ── Чому transformDocument ──────────────────────────────────────────────────
// За замовчуванням mammoth НЕ виводить alignment у HTML. Документація styleMap
// підтримує тільки p[style-name=...] / p.styleId / r matchers — НЕ
// p[alignment=...] (це наш помилковий синтаксис попередньо ламав justify).
// Правильний шлях — transformDocument: змінюємо документ перед HTML-конвертацією,
// додаючи синтетичні styleName 'AlignJustify' / 'FontSans' / 'FontSerif'.
// Далі styleMap їх легально матчить як p[style-name='...'].

import { htmlToPdfViaPdfLib } from './pdfLibHtmlRenderer.js';

const MIN_TEXT_LENGTH = 50;

// styleMap — пишеться як ПЛАСКИЙ масив рядків. Порядок важливий: специфічніше
// раніше. align-* на абзацах, font-* як inline <span> навколо runs.
const MAMMOTH_STYLE_MAP = [
  // Word alignment → клас на <p>
  "p[style-name='AlignJustify'] => p.align-justify:fresh",
  "p[style-name='AlignCenter']  => p.align-center:fresh",
  "p[style-name='AlignRight']   => p.align-right:fresh",
  "p[style-name='AlignLeft']    => p.align-left:fresh",
  // Word font-family → клас на <span> (inline)
  "r[style-name='FontSans']  => span.font-sans",
  "r[style-name='FontSerif'] => span.font-serif",
];

// Map font name → 'serif' | 'sans' | null (невідомі залишаємо як null —
// pdfLibHtmlRenderer успадкує default 'serif').
function mapDocxFontFamily(fontName) {
  if (!fontName || typeof fontName !== 'string') return null;
  const name = fontName.toLowerCase();
  const serif = ['times new roman', 'times', 'cambria', 'georgia', 'palatino', 'liberation serif', 'serif'];
  const sans = ['arial', 'helvetica', 'verdana', 'tahoma', 'calibri', 'liberation sans', 'segoe ui', 'roboto', 'open sans', 'sans-serif'];
  if (serif.some((s) => name === s || name.startsWith(s))) return 'serif';
  if (sans.some((s) => name === s || name.startsWith(s))) return 'sans';
  return null;
}

// Map mammoth alignment value → styleName for styleMap matching.
// Word alignment values з OOXML: 'left'|'right'|'center'|'both' (justify) і
// рідкісніше 'start'|'end'|'distribute'. 'both' — це justify у Word XML.
function alignmentToStyleName(alignment) {
  switch ((alignment || '').toLowerCase()) {
    case 'left':
    case 'start':
      return 'AlignLeft';
    case 'right':
    case 'end':
      return 'AlignRight';
    case 'center':
    case 'centre':
      return 'AlignCenter';
    case 'both':
    case 'justify':
    case 'distribute':
      return 'AlignJustify';
    default:
      return null;
  }
}

// transformDocument: рекурсивно обходить mammoth document model.
// Для абзаців з alignment — встановлює styleName (якщо ще не задано).
// Для runs з font — встановлює styleName 'FontSans'/'FontSerif'.
// Не перетирає styleName що вже існує (наприклад 'Heading 1' з Word styles).
function makeTransformDocument() {
  function transformElement(element) {
    if (!element) return element;

    if (element.children) {
      const children = element.children.map(transformElement);
      element = { ...element, children };
    }

    if (element.type === 'paragraph') {
      // Не торкаємось paragraphs з вже встановленим styleName (Heading 1 тощо).
      if (!element.styleName) {
        const styleName = alignmentToStyleName(element.alignment);
        if (styleName) {
          element = { ...element, styleName };
        }
      }
    } else if (element.type === 'run') {
      if (!element.styleName && element.font) {
        const family = mapDocxFontFamily(element.font);
        if (family === 'sans') element = { ...element, styleName: 'FontSans' };
        else if (family === 'serif') element = { ...element, styleName: 'FontSerif' };
      }
    }

    return element;
  }
  return transformElement;
}

export async function docxToPdf(file, _context = {}) {
  const warnings = [];

  const arrayBuffer = await readAsArrayBuffer(file);

  if (!hasDocxSignature(arrayBuffer)) {
    throw new Error('Файл не є валідним DOCX. Можливо це старий .doc формат або файл пошкоджений.');
  }

  const mammothModule = await import('mammoth/mammoth.browser.js');
  const mammoth = mammothModule.default || mammothModule;

  let htmlResult, rawTextResult;
  try {
    const convertImageOpts = mammoth.images && mammoth.images.imgElement
      ? {
          convertImage: mammoth.images.imgElement((image) =>
            image.read('base64').then((b64) => ({
              src: `data:${image.contentType};base64,${b64}`,
            }))
          ),
        }
      : {};
    [htmlResult, rawTextResult] = await Promise.all([
      mammoth.convertToHtml(
        { arrayBuffer },
        {
          styleMap: MAMMOTH_STYLE_MAP,
          transformDocument: makeTransformDocument(),
          ...convertImageOpts,
        }
      ),
      mammoth.extractRawText({ arrayBuffer }),
    ]);
  } catch (e) {
    throw new Error(`Не вдалось прочитати DOCX. Файл може бути пошкоджений: ${e?.message || e}`);
  }

  const html = htmlResult?.value || '';
  const extractedText = (rawTextResult?.value || '').trim();
  const mammothMessages = [
    ...(htmlResult?.messages || []),
    ...(rawTextResult?.messages || []),
  ];

  if (extractedText.length < MIN_TEXT_LENGTH) {
    throw new Error(
      `DOCX не містить тексту (${extractedText.length} символів). Якщо документ — сканований, додайте його як зображення.`
    );
  }

  if (!html) {
    throw new Error('DOCX не вдалось конвертувати у HTML для рендеру (порожній результат mammoth).');
  }

  const seen = new Set();
  for (const msg of mammothMessages) {
    if (msg?.type === 'warning' && msg?.message && !seen.has(msg.message)) {
      seen.add(msg.message);
      warnings.push(`mammoth: ${msg.message}`);
    }
  }

  let pdfBlob;
  try {
    // DOCX за замовчуванням — Times-like (Word default). Передаємо serif як
    // дефолт, але run-level font-* класи перекривають.
    pdfBlob = await htmlToPdfViaPdfLib(html, { defaultFontFamily: 'serif' });
  } catch (e) {
    throw new Error(`Не вдалось згенерувати PDF: ${e?.message || e}`);
  }

  if (!(pdfBlob instanceof Blob) || pdfBlob.size === 0) {
    throw new Error('PDF generation повернула порожній результат');
  }

  return { pdfBlob, extractedText, warnings };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function hasDocxSignature(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength < 4) return false;
  const view = new Uint8Array(arrayBuffer, 0, 4);
  return view[0] === 0x50 && view[1] === 0x4b && view[2] === 0x03 && view[3] === 0x04;
}

function readAsArrayBuffer(file) {
  if (file instanceof ArrayBuffer) return Promise.resolve(file);
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

// Експорт для тестів
export const __test__ = {
  alignmentToStyleName,
  mapDocxFontFamily,
  makeTransformDocument,
  MAMMOTH_STYLE_MAP,
};
