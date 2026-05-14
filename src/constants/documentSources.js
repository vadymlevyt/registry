// ── DOCUMENT SOURCES ─────────────────────────────────────────────────────────
// Можливі значення поля document.source — канал ПОХОДЖЕННЯ файлу.
// НЕ плутати з document.addedBy (actor — хто/що зробило акт додавання запису).
// Розділено в TASK 0.3.4 (правило #11 — одне ім'я, один сенс).
//
// TASK 0.3.5 v7: переіменовано enum значень (manual_upload→manual, ecits→court_sync),
// додано metadata_extractor і unknown. Повна міграція legacy значень — у migrateToVersion7.
//
// Валідація enum НЕ enforce'иться (поле nullable у схемі) — це
// довідник для UI і для майбутніх фільтрів/звітів.
// Backward-compat: legacy константи DOCUMENT_SOURCE_MANUAL_UPLOAD / DOCUMENT_SOURCE_ECITS
// видалено в TASK 0.3.5. Якщо десь у коді ще залишилось старе значення —
// migrateToVersion7 переоновить існуючі документи, нові точки створення мають
// використовувати тільки нові константи.

export const DOCUMENT_SOURCE_MANUAL = 'manual';
export const DOCUMENT_SOURCE_COURT_SYNC = 'court_sync';
export const DOCUMENT_SOURCE_METADATA_EXTRACTOR = 'metadata_extractor';
export const DOCUMENT_SOURCE_TELEGRAM = 'telegram';
export const DOCUMENT_SOURCE_EMAIL = 'email';
export const DOCUMENT_SOURCE_UNKNOWN = 'unknown';

export const DOCUMENT_SOURCES = Object.freeze([
  DOCUMENT_SOURCE_MANUAL,
  DOCUMENT_SOURCE_COURT_SYNC,
  DOCUMENT_SOURCE_METADATA_EXTRACTOR,
  DOCUMENT_SOURCE_TELEGRAM,
  DOCUMENT_SOURCE_EMAIL,
  DOCUMENT_SOURCE_UNKNOWN,
]);

// Людські назви для UI (наприклад, чіп біля документа в досьє).
export const DOCUMENT_SOURCE_LABELS = Object.freeze({
  [DOCUMENT_SOURCE_MANUAL]: 'Завантажено вручну',
  [DOCUMENT_SOURCE_COURT_SYNC]: 'Електронний суд',
  [DOCUMENT_SOURCE_METADATA_EXTRACTOR]: 'Парсинг (не-ЄСІТС)',
  [DOCUMENT_SOURCE_TELEGRAM]: 'Telegram',
  [DOCUMENT_SOURCE_EMAIL]: 'Email',
  [DOCUMENT_SOURCE_UNKNOWN]: 'Невідомо',
});

export function isValidDocumentSource(value) {
  return value === null || DOCUMENT_SOURCES.includes(value);
}
