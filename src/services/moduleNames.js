// ── MODULE NAMES ─────────────────────────────────────────────────────────────
// Єдине джерело правди для значень `module` в time_entries[] і логах.
// Усі — snake_case малими літерами.
//
// Не плутати з системою агентів (qi_agent, dashboard_agent) — це
// агентські id, інше поле. Тут — модуль/розділ системи з якого виконується дія.

export const MODULES = Object.freeze({
  // UI-модулі (top-level tabs)
  APP: 'app',
  DASHBOARD: 'dashboard',
  CASE_DOSSIER: 'case_dossier',
  NOTEBOOK: 'notebook',
  DOCUMENT_PROCESSOR: 'document_processor',
  QI: 'qi',

  // Системні / службові контексти
  SYSTEM: 'system',
  STARTUP: 'startup',
  EXECUTE_ACTION: 'execute_action',
  AGENT_ACTION: 'agent_action',
  EVENT_RESERVATION: 'event_reservation',
  SUBTIMER: 'subtimer',
  OFFLINE: 'offline',
  MANUAL: 'manual',
  LEGACY: 'legacy',

  // UI-форми (підгрупи app)
  ADD_FORM: 'add_form',
  UI: 'ui',
});

// Хелпер для динамічної логіки category/billable за caseId.
// caseId присутній → case_work + billable; інакше → admin.
export function categoryForCase(caseId, fallback = 'admin') {
  return caseId ? 'case_work' : fallback;
}
