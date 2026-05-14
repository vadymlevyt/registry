// ── EVENT BUS TOPICS ─────────────────────────────────────────────────────────
// Константи топіків які використовують модулі системи через eventBus.
//
// Кожен модуль публікує/підписується тільки на свої топіки. Топіки інших
// модулів — точка спостереження, не маніпуляції.
//
// TASK 0.2 — інфраструктура (4 ECITS-вхідні топіки).
// TASK 0.3.5 v7 — додано 8 топіків що публікуються з нових ACTIONS:
//   • 2 для sync операцій (sync_completed, case_state_updated)
//   • 6 для edit-ACTIONS (parties, team, processParticipants, composition, movementCard, alternativeSource)
//
// Принцип однозначності (правило #11): окремі топіки для "вхідних" подій
// (документ прийшов з ЄСІТС, синхронізація відбулась) і "редагування полів"
// (parties оновлено, composition змінено). Не плутати.
//
// SaaS-готовність: payload подій містить tenantId — у multi-tenant SaaS
// підписники зможуть фільтрувати без зайвого lookup'у.

// ── Модуль «Електронний суд» — ЄСІТС вхідні події ─────────────────────────
// Публікуються коли інтеграція з кабінетом виявить нові дані.
// На цьому етапі (TASK 0.3.5) ніхто не публікує — топіки готові для TASK 0.4+.
export const ECITS_DOCUMENTS_RECEIVED = 'ecits.documents_received';
export const ECITS_HEARING_SCHEDULED = 'ecits.hearing_scheduled';
export const ECITS_CASE_STATUS_CHANGED = 'ecits.case_status_changed';
export const ECITS_SUBMISSION_COMPLETED = 'ecits.submission_completed';

// ── ECITS sync events (TASK 0.3.5 v7) ──────────────────────────────────────
// Публікуються з ACTIONS mark_synced_from_ecits / update_case_ecits_state.
// Підписники: майбутні Activity Feed на dashboard, Billing analytics, Notifications.
export const ECITS_SYNC_COMPLETED = 'ecits.sync_completed';
export const ECITS_CASE_STATE_UPDATED = 'ecits.case_state_updated';

// ── Case/proceeding/document edit events (TASK 0.3.5 v7) ───────────────────
// Публікуються з 6 нових edit-ACTIONS (R1 AI-first дзеркало).
// Підписники: майбутні UI auto-refresh, search index updates, audit dashboards.
export const CASE_PARTIES_UPDATED = 'case.parties_updated';
export const CASE_TEAM_UPDATED = 'case.team_updated';
export const CASE_PROCESS_PARTICIPANTS_UPDATED = 'case.process_participants_updated';
export const PROCEEDING_COMPOSITION_UPDATED = 'proceeding.composition_updated';
export const DOCUMENT_MOVEMENT_CARD_UPDATED = 'document.movement_card_updated';
export const DOCUMENT_ALTERNATIVE_SOURCE_ADDED = 'document.alternative_source_added';

export const ECITS_TOPICS = Object.freeze([
  ECITS_DOCUMENTS_RECEIVED,
  ECITS_HEARING_SCHEDULED,
  ECITS_CASE_STATUS_CHANGED,
  ECITS_SUBMISSION_COMPLETED,
  ECITS_SYNC_COMPLETED,
  ECITS_CASE_STATE_UPDATED,
]);

// Усі топіки v7 edit-подій — для тестів і документації.
export const V7_EDIT_TOPICS = Object.freeze([
  CASE_PARTIES_UPDATED,
  CASE_TEAM_UPDATED,
  CASE_PROCESS_PARTICIPANTS_UPDATED,
  PROCEEDING_COMPOSITION_UPDATED,
  DOCUMENT_MOVEMENT_CARD_UPDATED,
  DOCUMENT_ALTERNATIVE_SOURCE_ADDED,
]);
