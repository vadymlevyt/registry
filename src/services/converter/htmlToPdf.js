// ── HTML → PDF ───────────────────────────────────────────────────────────────
// Конвертує HTML файл (від ЄСІТС, з email, з браузера) у PDF Blob і одночасно
// витягує plain-текст для запису в кеш OCR (.txt у 02_ОБРОБЛЕНІ).
//
// Pipeline:
//   1. Прочитати file як ArrayBuffer
//   2. validateHtmlBytes — перші байти НЕ мають бути бінарною сигнатурою
//      (PNG/JPEG/PDF тощо). Якщо так — THROW «не є валідним HTML».
//   3. detectCharset + decodeHtmlBuffer → UTF-8 рядок (utils/htmlCharsetDetection.js
//      обробляє ЄСІТС-варіант windows-1251 з некоректним meta-charset)
//   4. Створити прихований A4-контейнер у DOM з декодованим HTML.
//      Витягти extractedText через container.innerText (браузер сам обробляє
//      whitespace collapsing, <br> переноси, видимість).
//      Якщо текст коротший за MIN_TEXT_LENGTH — THROW «порожній».
//   5. html2pdf.js → Blob('application/pdf')
//   6. Cleanup DOM, повернути { pdfBlob, extractedText, warnings }
//
// Контракт результату:
//   { pdfBlob: Blob, extractedText: string, warnings: string[] }
//
// `extractedText` — plain-текст з innerText. CaseDossier записує його у
// 02_ОБРОБЛЕНІ як .txt БЕЗ виклику Document AI. Текст у HTML вже структурований
// і присутній — OCR на render-PDF дасть гірший результат.

import { decodeHtmlBuffer } from '../../utils/htmlCharsetDetection.js';

// Мінімальна довжина значущого тексту. 30 символів — це приблизно один заголовок
// або коротке речення. Менше — або порожній шаблон, або файл без текстового
// вмісту. Поріг трохи нижчий ніж для DOCX (50): HTML часто буває фрагментом
// (наприклад одна короткА ухвала з ЄСІТС).
const MIN_TEXT_LENGTH = 30;

// Поріг розміру PDF — див. docxToPdf.js MIN_PDF_SIZE_BYTES.
const MIN_PDF_SIZE_BYTES = 5 * 1024;

// Бінарні сигнатури які ТОЧНО не HTML (перші 4-8 байти). Якщо файл починається
// з однієї з них — адвокат випадково перейменував не-HTML файл або вибрав не
// той файл. Кидаємо чесну помилку до того як html2pdf вичерпає 30 секунд на
// рендер «PDF з пікселями".
const BINARY_SIGNATURES = [
  { name: 'PNG', bytes: [0x89, 0x50, 0x4e, 0x47] },     // ‰PNG
  { name: 'JPEG', bytes: [0xff, 0xd8, 0xff] },           // JPEG SOI
  { name: 'GIF', bytes: [0x47, 0x49, 0x46, 0x38] },      // GIF8
  { name: 'PDF', bytes: [0x25, 0x50, 0x44, 0x46] },      // %PDF
  { name: 'ZIP', bytes: [0x50, 0x4b, 0x03, 0x04] },      // PK (ZIP, DOCX, XLSX, ...)
  { name: 'WEBP', bytes: [0x52, 0x49, 0x46, 0x46] },     // RIFF
];

const A4_CSS = `
  font-family: 'Times New Roman', Times, serif;
  font-size: 12pt;
  line-height: 1.4;
  color: #000;
  background: #fff;
  width: 210mm;
  min-height: 297mm;
  padding: 20mm 20mm 20mm 30mm;
  box-sizing: border-box;
`;

const HTML2PDF_OPTIONS = {
  margin: 0,
  image: { type: 'jpeg', quality: 0.95 },
  html2canvas: { scale: 2, useCORS: true, logging: false },
  jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
  pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
};

export async function htmlToPdf(file, _context = {}) {
  const warnings = [];

  // 1. ArrayBuffer
  const arrayBuffer = await readAsArrayBuffer(file);

  // 2. Валідація сигнатури. HTML — текстовий формат, бінарних сигнатур не має.
  const binaryMatch = detectBinarySignature(arrayBuffer);
  if (binaryMatch) {
    throw new Error(`Файл не є валідним HTML (виявлено сигнатуру ${binaryMatch}). Можливо адвокат випадково вибрав не той файл.`);
  }

  // 3. Декодувати HTML з правильним charset (UTF-8 / windows-1251 / cp1251)
  const decoded = decodeHtmlBuffer(arrayBuffer, file?.type || 'text/html');
  if (decoded.charset !== 'utf-8' && decoded.charset !== 'UTF-8') {
    warnings.push(`HTML декодовано як ${decoded.charset}`);
  }

  if (!decoded.text || decoded.text.trim().length === 0) {
    throw new Error('HTML файл порожній.');
  }

  // 4. Створити контейнер off-screen через position:absolute + left:-10000px.
  // Без opacity/visibility/display:none — html2canvas з opacity:0 рендерить
  // прозорий canvas і PDF виходить порожнім (див. docxToPdf.js коментар).
  const container = document.createElement('div');
  container.setAttribute('style', `
    position: absolute;
    top: 0;
    left: -10000px;
    ${A4_CSS}
  `);

  // Витягуємо body content якщо це повний HTML документ — щоб не дублювати
  // CSS і структуру. Якщо це фрагмент — використовуємо як є.
  const bodyMatch = decoded.text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  container.innerHTML = bodyMatch ? bodyMatch[1] : decoded.text;

  document.body.appendChild(container);

  try {
    // 4.1 Витягнути plain-текст. innerText кращий ніж textContent: він
    // враховує whitespace collapse, <br> переноси, ігнорує display:none.
    // У jsdom innerText може бути undefined — fallback на textContent.
    const extractedText = (container.innerText || container.textContent || '').trim();

    if (extractedText.length < MIN_TEXT_LENGTH) {
      throw new Error(
        `HTML не містить тексту (${extractedText.length} символів). Якщо документ — сканований, додайте його як зображення.`
      );
    }

    // 4.1 Дати browser порахувати layout перед html2canvas (див. docxToPdf.js).
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));

    // 5. html2pdf конвертація. Динамічний імпорт — щоб бандл не тягнув
    // html2pdf при старті аппки, тільки при першій конвертації.
    const html2pdfModule = await import('html2pdf.js');
    const html2pdf = html2pdfModule.default || html2pdfModule;

    const pdfBlob = await html2pdf()
      .from(container)
      .set(HTML2PDF_OPTIONS)
      .outputPdf('blob');

    if (!(pdfBlob instanceof Blob) || pdfBlob.size === 0) {
      throw new Error('html2pdf повернув порожній PDF');
    }

    if (pdfBlob.size < MIN_PDF_SIZE_BYTES) {
      throw new Error(
        `Конвертація HTML не вдалась — PDF занадто малий (${Math.round(pdfBlob.size / 1024)} КБ). Можливо вміст порожній або має нерендериться браузером.`
      );
    }

    return { pdfBlob, extractedText, warnings };
  } finally {
    // 6. Cleanup — завжди видаляємо контейнер, навіть при помилці
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function detectBinarySignature(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength < 4) return null;
  const view = new Uint8Array(arrayBuffer, 0, 8);
  for (const sig of BINARY_SIGNATURES) {
    let match = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (view[i] !== sig.bytes[i]) {
        match = false;
        break;
      }
    }
    if (match) return sig.name;
  }
  return null;
}

function readAsArrayBuffer(file) {
  // file може бути File, Blob, або ArrayBuffer (у тестах)
  if (file instanceof ArrayBuffer) return Promise.resolve(file);
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
