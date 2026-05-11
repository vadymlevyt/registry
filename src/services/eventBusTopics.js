// ── EVENT BUS TOPICS ─────────────────────────────────────────────────────────
// Константи топіків які використовують модулі системи через eventBus.
//
// Кожен модуль публікує/підписується тільки на свої топіки. Топіки інших
// модулів — точка спостереження, не маніпуляції.
//
// На етапі TASK 0.2 — інфраструктура. Реальна публікація з'являється коли
// модуль ЄСІТС почне отримувати реальні дані з кабінету.

// Модуль «Електронний суд» — ЄСІТС
export const ECITS_DOCUMENTS_RECEIVED = 'ecits.documents_received';
export const ECITS_HEARING_SCHEDULED = 'ecits.hearing_scheduled';
export const ECITS_CASE_STATUS_CHANGED = 'ecits.case_status_changed';
export const ECITS_SUBMISSION_COMPLETED = 'ecits.submission_completed';

export const ECITS_TOPICS = Object.freeze([
  ECITS_DOCUMENTS_RECEIVED,
  ECITS_HEARING_SCHEDULED,
  ECITS_CASE_STATUS_CHANGED,
  ECITS_SUBMISSION_COMPLETED,
]);
