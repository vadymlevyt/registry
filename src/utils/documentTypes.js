// ── DOCUMENT TYPES — інлайн-рендер у Viewer ────────────────────────────────
//
// `isInlineRenderable(document)` — чи може Drive iframe preview показати
// документ як форматований оригінал з нативним виділенням тексту. Якщо так —
// Viewer пропускає Текст-плашку і перемикач Скан/Текст: адвокат бачить
// оригінал, виділяє і копіює прямо у Drive viewer.
//
// Принцип:
//   - PDF з documentNature='searchable' — інлайн-рендер.
//   - PDF з documentNature='scanned' (текстового шару немає) — НЕ інлайн:
//     для нього потрібна окрема Текст-плашка з OCR-результатом, бо на
//     зображенні неможливо виділяти.
//   - Зображення (image/*) — НЕ інлайн: те саме, потрібна Текст-плашка.
//   - Office (DOCX, XLSX, PPTX, …), OpenDocument, HTML/TXT/MD/RTF/CSV,
//     Google Docs/Sheets/Slides — інлайн (Drive рендерить нативно).
//
// Розширення: для нового типу — додати в OFFICE_*, WEB_*, GOOGLE_* sets або
// в шлях ext-перевірки. Інша логіка не змінюється.

const FOLDER_MIME = 'application/vnd.google-apps.folder';

const OFFICE_MIMES = new Set([
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
]);

const WEB_TEXT_MIMES = new Set([
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  'text/markdown',
  'application/rtf',
  'text/rtf',
  'text/csv',
  'text/tab-separated-values',
]);

const OFFICE_EXTS = new Set([
  'doc', 'docx',
  'xls', 'xlsx',
  'ppt', 'pptx',
  'odt', 'ods', 'odp',
]);

const WEB_TEXT_EXTS = new Set([
  'html', 'htm', 'xhtml', 'xht',
  'txt', 'md', 'markdown',
  'rtf',
  'csv', 'tsv',
]);

function getExtension(name) {
  if (!name) return '';
  const m = /\.([^.]+)$/.exec(String(name).toLowerCase());
  return m ? m[1] : '';
}

/**
 * @param {object} document — з полями mimeType, name, originalName, documentNature
 * @returns {boolean}
 */
export function isInlineRenderable(document) {
  if (!document) return false;
  const mime = (document.mimeType || '').toLowerCase();
  const lname = (document.originalName || document.name || '').toLowerCase();
  const ext = getExtension(lname);

  // Не плутати документи з папками (на випадок якщо колись в Drive picker
  // через _isDriveSource потрапить запис папки).
  if (mime === FOLDER_MIME) return false;

  // Зображення — НЕ інлайн. Скан-режим показує <img>, текст-режим — плашку.
  if (mime.startsWith('image/')) return false;

  // PDF — інлайн ТІЛЬКИ для searchable. Scanned PDF потребує текстової
  // плашки бо на зображенні виділення неможливе.
  const isPdf = mime === 'application/pdf' || ext === 'pdf';
  if (isPdf) {
    return document.documentNature === 'searchable';
  }

  // Google native (Docs/Sheets/Slides/Drawings/…) — Drive рендерить нативно.
  if (mime.startsWith('application/vnd.google-apps.')) return true;

  // Office і OpenDocument — Drive має вбудований preview.
  if (OFFICE_MIMES.has(mime)) return true;
  if (OFFICE_EXTS.has(ext)) return true;

  // Web/text формати — Drive показує як текст із форматуванням.
  if (WEB_TEXT_MIMES.has(mime)) return true;
  if (WEB_TEXT_EXTS.has(ext)) return true;

  return false;
}
