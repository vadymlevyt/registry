// ── HTML → PDF ───────────────────────────────────────────────────────────────
// Конвертує HTML файл (від ЄСІТС, з email, з браузера) у PDF Blob з
// ЗБЕРЕЖЕННЯМ ФОРМАТУВАННЯ через pdfLibHtmlRenderer.
//
// Pipeline:
//   1. Прочитати file як ArrayBuffer
//   2. validateHtmlBytes — перші байти НЕ мають бути бінарною сигнатурою
//      (PNG/JPEG/PDF тощо). Якщо так — THROW «не є валідним HTML».
//   3. decodeHtmlBuffer → UTF-8 рядок (windows-1251 для ЄСІТС)
//   4. Перевірити що тексту достатньо. Витягаємо plain-текст через
//      тимчасовий DOM-контейнер для .txt-кеша і MIN_TEXT_LENGTH перевірки.
//   5. pdfLibHtmlRenderer.htmlToPdfViaPdfLib(html) — рендерить ПОВНИЙ HTML
//      з body тегу: заголовки, абзаци з вирівнюванням, b/i/u, таблиці,
//      зображення (герб гербом!), гіперпосилання.
//   6. Cleanup DOM, повернути { pdfBlob, extractedText, warnings }
//
// Контракт результату:
//   { pdfBlob: Blob, extractedText: string, warnings: string[] }
//
// Чому pdfLibHtmlRenderer а не innerText + textToPdf:
// Попередня версія (TASK A + 9768685) витягала тільки plain-текст і втрачала
// все форматування. ЄСІТС-ухвали з гербом ставали без герба, заголовки
// з'являлись як звичайні абзаци, виділення NORM прав втрачались. Новий
// рендерер парсить DOM повністю і передає у pdf-lib зі стилями.

import { decodeHtmlBuffer } from '../../utils/htmlCharsetDetection.js';
import { htmlToPdfViaPdfLib } from './pdfLibHtmlRenderer.js';

// Мінімальна довжина значущого тексту. 30 символів — це приблизно один заголовок
// або коротке речення. Менше — або порожній шаблон, або файл без текстового
// вмісту. Поріг трохи нижчий ніж для DOCX (50): HTML часто буває фрагментом
// (наприклад одна коротка ухвала з ЄСІТС).
const MIN_TEXT_LENGTH = 30;

// Бінарні сигнатури які ТОЧНО не HTML (перші 4-8 байти). Якщо файл починається
// з однієї з них — адвокат випадково перейменував не-HTML файл або вибрав не
// той файл. Кидаємо чесну помилку до того як рендер вичерпає час на парсинг.
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

  // 4. Виділяємо body content (або весь fragment якщо без body тегу) і витягаємо
  // plain-текст для .txt кешу. innerText дає структурований текст з переносами
  // на <br>/<p>. Контейнер тимчасово в DOM щоб layout-обчислення спрацювало.
  const container = document.createElement('div');
  container.setAttribute('style', 'position:absolute;left:-10000px;top:0');

  const bodyMatch = decoded.text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const innerHtml = bodyMatch ? bodyMatch[1] : decoded.text;
  container.innerHTML = innerHtml;
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

  // 5. PDF generation через pdfLibHtmlRenderer. Передаємо ВЕСЬ HTML (body
  // content або повний fragment) — рендерер сам обходить DOM, парсить inline
  // стилі, embed'ить base64 зображення (герб у data: URI) і генерує PDF з
  // selectable text.
  let pdfBlob;
  try {
    // ЄСІТС-HTML і будь-який інший Word-style HTML за замовчуванням Times-like
    // (serif). font-family у документі може це перекрити через CSS або
    // <font face="..."> — renderer обробить.
    pdfBlob = await htmlToPdfViaPdfLib(innerHtml, { defaultFontFamily: 'serif' });
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
  if (file instanceof ArrayBuffer) return Promise.resolve(file);
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
