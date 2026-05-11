// ── DOCUMENT SOURCES ─────────────────────────────────────────────────────────
// Можливі значення поля document.source — канал по якому документ потрапив
// у систему. Універсальне поле для всіх модулів отримання документів.
//
// Валідація enum НЕ enforce'иться (поле nullable, default null) — це
// довідник для UI і для майбутніх фільтрів/звітів.

export const DOCUMENT_SOURCE_MANUAL_UPLOAD = 'manual_upload';
export const DOCUMENT_SOURCE_ECITS = 'ecits';
export const DOCUMENT_SOURCE_TELEGRAM = 'telegram';
export const DOCUMENT_SOURCE_EMAIL = 'email';

export const DOCUMENT_SOURCES = Object.freeze([
  DOCUMENT_SOURCE_MANUAL_UPLOAD,
  DOCUMENT_SOURCE_ECITS,
  DOCUMENT_SOURCE_TELEGRAM,
  DOCUMENT_SOURCE_EMAIL,
]);

// Людські назви для UI (наприклад, чіп біля документа в досьє).
export const DOCUMENT_SOURCE_LABELS = Object.freeze({
  [DOCUMENT_SOURCE_MANUAL_UPLOAD]: 'Завантажено вручну',
  [DOCUMENT_SOURCE_ECITS]: 'Електронний суд',
  [DOCUMENT_SOURCE_TELEGRAM]: 'Telegram',
  [DOCUMENT_SOURCE_EMAIL]: 'Email',
});

export function isValidDocumentSource(value) {
  return value === null || DOCUMENT_SOURCES.includes(value);
}
