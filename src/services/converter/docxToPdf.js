// ── DOCX → PDF ───────────────────────────────────────────────────────────────
// Конвертує DOCX файл у PDF Blob через mammoth.extractRawText + pdf-lib.
//
// Pipeline:
//   1. Прочитати file як ArrayBuffer
//   2. validateDocxSignature — перші байти ZIP (PK\x03\x04). DOCX — це ZIP.
//      Якщо ні — THROW «не є валідним DOCX».
//   3. mammoth.extractRawText({ arrayBuffer }) → plain text.
//      Якщо помилка mammoth (битий ZIP, не-DOCX вміст) — THROW з чесним
//      повідомленням адвокату.
//      Якщо текст коротший за MIN_TEXT_LENGTH — THROW «порожній або без тексту».
//   4. pdfLibRenderer.textToPdf(text) → PDF Blob з selectable text і
//      embed'нутим LiberationSans (Cyrillic support).
//   5. Повернути { pdfBlob, extractedText, warnings }
//
// Чому pdf-lib замість html2pdf.js: html2pdf.js на планшеті/мобільному viewport
// видавав порожні PDF — html2canvas не міг рендерити off-screen контейнер з
// mm-одиницями ширини. pdf-lib — pure JS PDF generation, не залежить від
// DOM/canvas, повністю контрольовано. Текст у PDF — selectable у Viewer.
//
// Trade-off: pdf-lib не відтворює форматування Word (жирний, italic, заголовки,
// таблиці, списки з нумерацією). Адвокат бачить весь текст без декорацій.
// Для точного формату оригінал DOCX лежить поряд як originalDriveId — можна
// завантажити з Drive і відкрити у Word.
//
// Feature flag CONVERT_DOCX_TO_PDF керується у converterService.js. Якщо false —
// converterService повертає passthrough і ця функція не викликається.

import { textToPdf } from './pdfLibRenderer.js';

// Мінімальна довжина значущого тексту. 50 символів — це приблизно одне коротке
// речення. Менше — або порожній шаблон, або документ без текстового вмісту
// (тільки зображення/таблиці без OCR-а). У таких випадках адвокат має додавати
// файл як зображення, а не як DOCX.
const MIN_TEXT_LENGTH = 50;

export async function docxToPdf(file, _context = {}) {
  const warnings = [];

  // 1. ArrayBuffer
  const arrayBuffer = await readAsArrayBuffer(file);

  // 2. ZIP-сигнатура. DOCX — це zip-архів з [Content_Types].xml + word/*.xml.
  // Якщо перші 4 байти не PK\x03\x04 — це точно не DOCX (можливо .doc, txt
  // з .docx розширенням, або пошкоджений файл).
  if (!hasDocxSignature(arrayBuffer)) {
    throw new Error('Файл не є валідним DOCX. Можливо це старий .doc формат або файл пошкоджений.');
  }

  // 3. mammoth.extractRawText — повний текст документа з абзацами через \n\n.
  const mammothModule = await import('mammoth');
  const mammoth = mammothModule.default || mammothModule;

  let rawTextResult;
  try {
    rawTextResult = await mammoth.extractRawText({ arrayBuffer });
  } catch (e) {
    // Mammoth кидає при пошкодженому ZIP, не-DOCX вмісті, нечитабельних
    // потоках. Не показуємо адвокату технічну ZIP-помилку — даємо чесне
    // повідомлення про файл.
    throw new Error(`Не вдалось прочитати DOCX. Файл може бути пошкоджений: ${e?.message || e}`);
  }

  const extractedText = (rawTextResult?.value || '').trim();
  const mammothMessages = rawTextResult?.messages || [];

  if (extractedText.length < MIN_TEXT_LENGTH) {
    throw new Error(
      `DOCX не містить тексту (${extractedText.length} символів). Якщо документ — сканований, додайте його як зображення.`
    );
  }

  // mammoth warnings (numbering, styles) — переносимо у наш результат
  for (const msg of mammothMessages) {
    if (msg?.type === 'warning' && msg?.message) {
      warnings.push(`mammoth: ${msg.message}`);
    }
  }

  // 4. PDF generation через pdf-lib. Завантажує LiberationSans (~140 КБ) один
  // раз за сесію — потім bytes у in-memory cache.
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

// ZIP local file header signature: 0x50 0x4B 0x03 0x04 ("PK\x03\x04").
// Усі DOCX починаються з цієї сигнатури. Інші ZIP-варіанти (порожній архів
// 0x50 0x4B 0x05 0x06, або spanning 0x50 0x4B 0x07 0x08) для DOCX не зустрічаються.
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
