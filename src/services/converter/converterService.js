// ── CONVERTER SERVICE FACADE ─────────────────────────────────────────────────
// Універсальний фасад "планки Пікатіні" для конвертації файлів різних форматів
// у PDF. Споживач (AddDocumentModal, у майбутньому Document Processor v2)
// викликає тільки цей фасад — converterService.convertToPdf(file, context) —
// фасад обирає правильний конвертер за MIME-типом і повертає уніфікований
// контракт.
//
// Принцип Single Source of Truth: вся логіка конвертації — у цих модулях.
// Жодного дублювання в компонентах. Майбутній Document Processor v2 і
// TASK B (склейка зображень) використовують той самий сервіс.
//
// ── Контракт результату ─────────────────────────────────────────────────────
//   { pdfBlob, originalBlob, pdfName, originalName, originalMime, extractedText,
//     warnings, converter, durationMs }
//
//   pdfBlob       — Blob PDF (application/pdf). Завжди заповнений при успіху.
//   originalBlob  — Blob оригіналу (DOCX). null якщо оригінал не зберігається
//                   (HTML, зображення). Зберігається поряд як originalDriveId.
//   pdfName       — імʼя для PDF файлу (без розширення додасться .pdf).
//   originalName  — оригінальне імʼя файлу (з розширенням).
//   originalMime  — MIME оригіналу (для запису у doc.originalMime).
//   extractedText — plain-текст витягнутий конвертером БЕЗ Document AI. Заповнений
//                   для docxToPdf (mammoth.extractRawText) і htmlToPdf
//                   (container.innerText). null для passthrough/image — для них
//                   текст витягується через OCR pipeline.
//   warnings      — попередження конвертації (масив рядків).
//   converter     — назва конвертера ('htmlToPdf' | 'docxToPdf' | 'imageToPdf'
//                                     | 'passthrough').
//   durationMs    — час конвертації у мс.
//
// ── Що з extractedText робить caller ────────────────────────────────────────
// Якщо `extractedText` непорожній — caller (AddDocumentModal onSubmit у
// CaseDossier) записує його у 02_ОБРОБЛЕНІ як .txt напряму через
// ocrService.writeExtractedTextArtifact і ПРОПУСКАЄ runOcrWithRetryUI. Document AI
// для DOCX/HTML не викликається — текст уже витягнуто з джерела, render-PDF
// дав би гірший OCR. Це економить токени Document AI і прискорює додавання.
//
// ── SAAS і Multi-user готовність ────────────────────────────────────────────
// Конвертація — pure utility, не торкається даних реєстру. Але приймає context
// { caseId, module, operation } для activityTracker.report і logAiUsage у
// підгрупах (зокрема image_sorter у майбутньому TASK B). tenantId/userId
// підтягуються автоматично в activityTracker з tenantService.getCurrentUser/Tenant.
//
// ── Billing інтеграція ──────────────────────────────────────────────────────
// Кожна конвертація → activityTracker.report('document_converted', {
//   module: 'add_document_modal', caseId, category: 'case_work', billable: true,
//   metadata: { converter, originalMime, durationMs }
// }). Точка інструментації одна — у фасаді, не дублюється в кожному модулі.
//
// ── Feature flag CONVERT_DOCX_TO_PDF ────────────────────────────────────────
// Якщо false — DOCX повертається як passthrough (без конвертації). Дозволяє
// швидко відкотити поведінку якщо якість html2pdf.js для складних DOCX
// виявиться неприйнятною. Решта системи (Viewer через DocxRenderer) працює.

import { MODULES } from '../moduleNames.js';
import { report as reportActivity } from '../activityTracker.js';

// Feature flag — керує конвертацією DOCX. Експортується щоб тести могли
// перевіряти обидва значення без mock. UI не змінює його на льоту —
// зміна потребує редагування файлу і деплою.
export const CONVERT_DOCX_TO_PDF = true;

// ── Detection helpers ───────────────────────────────────────────────────────

const MIME_HTML = ['text/html', 'application/xhtml+xml'];
const MIME_DOCX = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
];

function isImage(mime) {
  return typeof mime === 'string' && mime.startsWith('image/');
}

function isHtml(mime, name) {
  if (MIME_HTML.includes(mime)) return true;
  if (!mime && typeof name === 'string') {
    return /\.(html|htm)$/i.test(name);
  }
  return false;
}

function isDocx(mime, name) {
  if (MIME_DOCX.includes(mime)) return true;
  if (!mime && typeof name === 'string') {
    return /\.docx$/i.test(name);
  }
  return false;
}

function isPdf(mime, name) {
  if (mime === 'application/pdf') return true;
  if (!mime && typeof name === 'string') {
    return /\.pdf$/i.test(name);
  }
  return false;
}

function baseName(name) {
  if (!name) return 'document';
  return name.replace(/\.[^.]+$/, '');
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Конвертувати файл у PDF. Якщо файл вже PDF — повертає passthrough.
 *
 * @param {File|Blob} file — файл з пристрою або Drive
 * @param {object} context — { caseId, module, operation } для трекерів
 * @returns {Promise<ConversionResult>}
 */
export async function convertToPdf(file, context = {}) {
  const t0 = Date.now();
  const name = file?.name || context?.fileName || 'document';
  const mime = file?.type || context?.mimeType || '';

  // 1. PDF — passthrough, без конвертації
  if (isPdf(mime, name)) {
    return makeResult({
      pdfBlob: file,
      originalBlob: null,
      pdfName: baseName(name),
      originalName: name,
      originalMime: 'application/pdf',
      extractedText: null,
      warnings: [],
      converter: 'passthrough',
      durationMs: Date.now() - t0,
      context,
    });
  }

  // 2. HTML → PDF
  if (isHtml(mime, name)) {
    const { htmlToPdf } = await import('./htmlToPdf.js');
    const result = await htmlToPdf(file, context);
    return makeResult({
      pdfBlob: result.pdfBlob,
      originalBlob: null, // HTML оригінал не зберігаємо
      pdfName: baseName(name),
      originalName: name,
      originalMime: 'text/html',
      extractedText: result.extractedText || null,
      warnings: result.warnings || [],
      converter: 'htmlToPdf',
      durationMs: Date.now() - t0,
      context,
    });
  }

  // 3. DOCX → PDF (з feature flag)
  if (isDocx(mime, name)) {
    if (!CONVERT_DOCX_TO_PDF) {
      // Feature flag вимкнено — passthrough як було раніше (Viewer через DocxRenderer).
      return makeResult({
        pdfBlob: file,
        originalBlob: null,
        pdfName: baseName(name),
        originalName: name,
        originalMime: mime || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extractedText: null,
        warnings: ['CONVERT_DOCX_TO_PDF вимкнено — DOCX залишається як є'],
        converter: 'passthrough',
        durationMs: Date.now() - t0,
        context,
      });
    }
    const { docxToPdf } = await import('./docxToPdf.js');
    const result = await docxToPdf(file, context);
    return makeResult({
      pdfBlob: result.pdfBlob,
      originalBlob: file, // DOCX зберігаємо поряд як originalDriveId
      pdfName: baseName(name),
      originalName: name,
      originalMime: mime || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extractedText: result.extractedText || null,
      warnings: result.warnings || [],
      converter: 'docxToPdf',
      durationMs: Date.now() - t0,
      context,
    });
  }

  // 4. Зображення → PDF (HEIC → JPEG → PDF або JPG/PNG → PDF)
  if (isImage(mime) || /\.(jpe?g|png|heic|webp)$/i.test(name)) {
    const { imageToPdf } = await import('./imageToPdf.js');
    const result = await imageToPdf(file, context);
    return makeResult({
      pdfBlob: result.pdfBlob,
      originalBlob: null, // зображення-оригінал не зберігаємо (всередині PDF)
      pdfName: baseName(name),
      originalName: name,
      originalMime: mime || 'image/jpeg',
      extractedText: null, // OCR pipeline витягне текст пізніше
      warnings: result.warnings || [],
      converter: 'imageToPdf',
      durationMs: Date.now() - t0,
      context,
    });
  }

  // 5. Невідомий формат — passthrough (Viewer покаже через Drive iframe)
  return makeResult({
    pdfBlob: file,
    originalBlob: null,
    pdfName: baseName(name),
    originalName: name,
    originalMime: mime || 'application/octet-stream',
    extractedText: null,
    warnings: [`Тип ${mime || 'невідомий'} не конвертується — залишаємо як є`],
    converter: 'passthrough',
    durationMs: Date.now() - t0,
    context,
  });
}

/**
 * Перевірити чи файл підтримується для конвертації у PDF.
 * Не запускає реальну конвертацію — лише класифікує тип.
 */
export function canConvert(file) {
  const name = file?.name || '';
  const mime = file?.type || '';
  return (
    isPdf(mime, name) ||
    isHtml(mime, name) ||
    isDocx(mime, name) ||
    isImage(mime) ||
    /\.(jpe?g|png|heic|webp)$/i.test(name)
  );
}

// ── Internal ────────────────────────────────────────────────────────────────

function makeResult(fields) {
  const { context, converter, originalMime, durationMs, ...rest } = fields;
  // Інструментація — одна точка у фасаді. Дублювати в кожному модулі не треба.
  // category 'case_work' коли є caseId, інакше 'admin'.
  // passthrough НЕ репортуємо — це не конвертація, а pass-through.
  if (converter !== 'passthrough') {
    try {
      reportActivity('document_converted', {
        module: context?.module || MODULES.ADD_FORM,
        caseId: context?.caseId || null,
        category: context?.caseId ? 'case_work' : 'admin',
        billable: !!context?.caseId,
        subCategory: 'document_conversion',
        duration: Math.round(durationMs / 1000),
        metadata: {
          converter,
          originalMime,
          operation: context?.operation || 'convert_to_pdf',
          durationMs,
        },
      });
    } catch (e) {
      // Падіння трекера не блокує конвертацію
      console.warn('[converterService] activityTracker.report failed:', e?.message);
    }
  }
  return { ...rest, converter, originalMime, durationMs };
}
