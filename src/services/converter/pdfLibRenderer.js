// ── PDF-LIB RENDERER ────────────────────────────────────────────────────────
// Конвертує plain-текст у PDF через pdf-lib. Заміна html2pdf.js маршруту
// який давав порожній PDF на планшеті (html2canvas рендерить порожній canvas
// з off-screen контейнером і mm-одиницями ширини у мобільному viewport).
//
// Принцип:
//   - Pure JS, без DOM/canvas — повністю контрольовано
//   - Текст у PDF — SELECTABLE (виділяється, копіюється, шукається у Viewer)
//   - Custom TTF з кирилицею (LiberationSans-Regular з pdfjs-dist) embed'иться
//     у документ через @pdf-lib/fontkit
//   - A4 layout: 20mm top/bottom/right, 30mm left (стандарт ділового документа)
//
// Trade-off: втрачаємо форматування Word (жирний, italic, заголовки). Адвокат
// бачить ВЕСЬ текст у Viewer, для точного формату оригінал DOCX лежить поряд
// як originalDriveId — адвокат може завантажити і відкрити у Word.
//
// Шрифт LiberationSans-Regular.ttf (~140 КБ) — у public/fonts/. Vite копіює
// у dist, доступний за `${BASE_URL}fonts/...`. Lazy-fetch при першому виклику,
// in-memory cache на час сесії.

import { PDFDocument, rgb } from 'pdf-lib';

// A4 у points (PDF-stand): 72 pt/inch, 25.4 mm/inch. A4 = 210mm × 297mm.
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MM_TO_PT = 72 / 25.4;

const DEFAULT_OPTIONS = {
  fontSize: 12,
  lineHeight: 1.4, // multiplier від fontSize
  marginTop: 20 * MM_TO_PT,
  marginBottom: 20 * MM_TO_PT,
  marginLeft: 30 * MM_TO_PT,
  marginRight: 20 * MM_TO_PT,
  paragraphSpacing: 6, // pt додаткового простору між абзацами
};

// In-memory cache TTF байт. Lazy-fetch один раз за сесію. Bundle vite не тягне
// шрифт у головний chunk — він окремий static asset у public/.
let fontBytesPromise = null;

function getFontUrl() {
  // import.meta.env.BASE_URL = '/registry/' у production, '/' у dev.
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
  return `${base}fonts/LiberationSans-Regular.ttf`;
}

async function loadFontBytes() {
  if (fontBytesPromise) return fontBytesPromise;
  fontBytesPromise = (async () => {
    const url = getFontUrl();
    const res = await fetch(url);
    if (!res.ok) {
      // Скидаємо promise щоб наступний виклик міг спробувати знову
      fontBytesPromise = null;
      throw new Error(`Не вдалось завантажити шрифт ${url} (HTTP ${res.status})`);
    }
    return new Uint8Array(await res.arrayBuffer());
  })();
  return fontBytesPromise;
}

/**
 * Розбиває довгий рядок на масив рядків що влізають у ширину сторінки.
 * Word-wrap за словами; якщо одне слово ширше за рядок — розбиває посимвольно.
 */
function wrapLine(text, font, fontSize, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(candidate, fontSize);
    if (width <= maxWidth) {
      current = candidate;
      continue;
    }
    // Не влізає. Якщо current є — закриваємо рядок, починаємо новий зі словом.
    if (current) {
      lines.push(current);
      current = '';
    }
    // word сам по собі може бути ширше за maxWidth — розбиваємо посимвольно.
    if (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
      let chunk = '';
      for (const ch of word) {
        const next = chunk + ch;
        if (font.widthOfTextAtSize(next, fontSize) > maxWidth) {
          if (chunk) lines.push(chunk);
          chunk = ch;
        } else {
          chunk = next;
        }
      }
      current = chunk;
    } else {
      current = word;
    }
  }
  if (current) lines.push(current);
  // Якщо input був порожній — порожній рядок збережемо (для розділювача абзаців).
  if (lines.length === 0) lines.push('');
  return lines;
}

/**
 * Генерує PDF Blob з plain-тексту через pdf-lib.
 *
 * Один сенс: "взяти текст, повернути PDF Blob з ним як selectable text". Не
 * намагається відтворити форматування — це не render Word'а, а зрозумілий
 * resemblance: абзаци розділені порожнім рядком, ліве вирівнювання, A4 поля
 * за ДСТУ для процесуальних документів.
 *
 * @param {string} text — plain-текст (з mammoth.extractRawText або innerText)
 * @param {object} options — { fontSize, lineHeight, margin* } для перевизначення
 * @returns {Promise<Blob>} PDF Blob типу application/pdf
 */
export async function textToPdf(text, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Lazy-load fontkit і шрифт паралельно з створенням документа.
  const [fontkitModule, fontBytes] = await Promise.all([
    import('@pdf-lib/fontkit'),
    loadFontBytes(),
  ]);
  const fontkit = fontkitModule.default || fontkitModule;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(fontBytes);

  const pageWidth = A4_WIDTH;
  const pageHeight = A4_HEIGHT;
  const contentWidth = pageWidth - opts.marginLeft - opts.marginRight;
  const lineHeightPt = opts.fontSize * opts.lineHeight;
  const usableHeight = pageHeight - opts.marginTop - opts.marginBottom;

  // 1. Розбиваємо текст на абзаци (порожній рядок — розділювач) і кожен абзац
  //    на wrapped lines що влізають у contentWidth.
  const paragraphs = text.split(/\r?\n\r?\n+/).map((p) => p.trim()).filter((p) => p.length > 0);
  // Якщо документ — один великий блок без подвійних newline — використовуємо
  // одинарні переноси як межі абзаців (fallback).
  const paragraphsToUse = paragraphs.length > 1
    ? paragraphs
    : text.split(/\r?\n+/).map((p) => p.trim()).filter((p) => p.length > 0);

  // 2. Розгортаємо у послідовність "render-операцій": кожна або wrapped рядок
  //    тексту, або порожній пробіл між абзацами.
  const renderOps = []; // { type: 'line'|'paragraph_break', text? }
  for (let i = 0; i < paragraphsToUse.length; i++) {
    const para = paragraphsToUse[i];
    const wrapped = wrapLine(para, font, opts.fontSize, contentWidth);
    for (const line of wrapped) {
      renderOps.push({ type: 'line', text: line });
    }
    if (i < paragraphsToUse.length - 1) {
      renderOps.push({ type: 'paragraph_break' });
    }
  }

  // 3. Розкладаємо операції по сторінках за висотою. Створюємо нову сторінку
  //    коли поточна yCursor виходить за нижню межу.
  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let yCursor = pageHeight - opts.marginTop;
  const minY = opts.marginBottom;
  const color = rgb(0, 0, 0);

  for (const op of renderOps) {
    if (op.type === 'line') {
      if (yCursor - lineHeightPt < minY) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        yCursor = pageHeight - opts.marginTop;
      }
      page.drawText(op.text, {
        x: opts.marginLeft,
        // pdf-lib baseline — drawText малює baseline тексту на y. Зміщуємо вниз
        // на висоту шрифту щоб top-edge тексту був на yCursor.
        y: yCursor - opts.fontSize,
        size: opts.fontSize,
        font,
        color,
      });
      yCursor -= lineHeightPt;
    } else {
      // paragraph_break — додатковий пробіл між абзацами
      yCursor -= opts.paragraphSpacing;
    }
  }

  // Якщо документ був порожній — додаємо порожню сторінку щоб не повернути PDF
  // без вмісту. Це edge case (caller вже валідує MIN_TEXT_LENGTH).
  if (pdfDoc.getPageCount() === 0) {
    pdfDoc.addPage([pageWidth, pageHeight]);
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes], { type: 'application/pdf' });
}

// Експорт для тестів — дозволяє перевірити логіку wrap'у без full PDF generation.
export const __test__ = { wrapLine };
