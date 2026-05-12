// ── HTML → PDF ───────────────────────────────────────────────────────────────
// Конвертує HTML файл (від ЄСІТС, з email, з браузера) у PDF Blob через
// container.innerText (witring text витяг) + pdf-lib (PDF generation).
//
// Pipeline:
//   1. Прочитати file як ArrayBuffer
//   2. validateHtmlBytes — перші байти НЕ мають бути бінарною сигнатурою
//      (PNG/JPEG/PDF тощо). Якщо так — THROW «не є валідним HTML».
//   3. decodeHtmlBuffer → UTF-8 рядок (windows-1251 для ЄСІТС)
//   4. Створити прихований контейнер у DOM, container.innerText → text.
//      Якщо текст коротший за MIN_TEXT_LENGTH — THROW «порожній».
//   5. pdfLibRenderer.textToPdf(text) → PDF Blob
//   6. Cleanup DOM, повернути { pdfBlob, extractedText, warnings }
//
// Контракт результату:
//   { pdfBlob: Blob, extractedText: string, warnings: string[] }
//
// Чому pdf-lib: html2pdf.js на планшеті/мобільному viewport видавав порожні
// PDF — html2canvas не міг рендерити off-screen контейнер з mm-одиницями
// ширини. pdf-lib працює без DOM/canvas.

import { decodeHtmlBuffer } from '../../utils/htmlCharsetDetection.js';
import { textToPdf } from './pdfLibRenderer.js';

// Мінімальна довжина значущого тексту. 30 символів — це приблизно один заголовок
// або коротке речення. Менше — або порожній шаблон, або файл без текстового
// вмісту. Поріг трохи нижчий ніж для DOCX (50): HTML часто буває фрагментом
// (наприклад одна короткА ухвала з ЄСІТС).
const MIN_TEXT_LENGTH = 30;

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

  // 4. Витягнути plain-текст через тимчасовий контейнер. innerText дає
  // структурований текст з переносами на <br>, абзацами на <p>, etc.
  // У jsdom innerText може бути undefined — fallback на textContent.
  const container = document.createElement('div');
  // Off-screen positioning — щоб під час DOM-обчислення не моргнуло на екрані.
  container.setAttribute('style', 'position:absolute;left:-10000px;top:0');

  const bodyMatch = decoded.text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  container.innerHTML = bodyMatch ? bodyMatch[1] : decoded.text;
  document.body.appendChild(container);

  let extractedText;
  try {
    extractedText = (container.innerText || container.textContent || '').trim();
  } finally {
    if (container.parentNode) container.parentNode.removeChild(container);
  }

  if (extractedText.length < MIN_TEXT_LENGTH) {
    throw new Error(
      `HTML не містить тексту (${extractedText.length} символів). Якщо документ — сканований, додайте його як зображення.`
    );
  }

  // 5. PDF generation через pdf-lib
  let pdfBlob;
  try {
    pdfBlob = await textToPdf(extractedText);
  } catch (e) {
    throw new Error(`Не вдалось згенерувати PDF: ${e?.message || e}`);
  }

  if (!(pdfBlob instanceof Blob) || pdfBlob.size === 0) {
    throw new Error('PDF generation повернула порожній результат');
  }

  return { pdfBlob, extractedText, warnings };
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
