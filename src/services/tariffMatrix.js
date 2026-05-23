// ── TARIFF MATRIX ────────────────────────────────────────────────────────────
// Декларативна матриця тарифних планів для майбутньої SaaS-комерціалізації.
// Один сенс (правило #11): "що дозволено на кожному плані". НЕ містить цін,
// НЕ містить limits — це окремі структури (subscription.limits).
//
// MVP TASK 0.4 закладає СТРУКТУРУ матриці з єдиним планом 'self_hosted' що
// відповідає поточному стану (АБ Левицького — все дозволено, нема обмежень).
// Майбутні плани (free / basic / professional / enterprise) додаються рядками
// без зміни форми shape — додавання, не переписування.
//
// Точка читання — entitlementsService.canUseModule(tenant, moduleId, scenarioId).
// Сам tenant зберігає entitlements у subscription.entitlements (per-tenant,
// може відхилятися від матриці — admin override). Матриця — fallback дефолт
// коли entitlements не передано.

/**
 * Матриця тарифних планів.
 *
 * Структура плану:
 *   modules: { [moduleId]: { enabled: bool, scenarios?: { [id]: bool }, trialMode?: bool } }
 *
 * Якщо `scenarios` відсутнє — усі сценарії модуля дозволено (коли enabled=true).
 * Якщо `trialMode: true` — є експіратор (читається з tenant.entitlements,
 * не з матриці), матриця лише декларує що план тимчасовий.
 */
export const TARIFF_MATRIX = Object.freeze({
  self_hosted: {
    label: 'Self-hosted (АБ Левицького)',
    description: 'Поточний план: усе дозволено, без обмежень. Дефолтний для seed-tenant.',
    modules: {
      ecits: { enabled: true, scenarios: { import_cases_and_hearings: true } },
      documents: { enabled: true },
      canvas: { enabled: true },
    },
  },
  // Майбутні плани додавати тут. Структура застиглого shape; UI білінгу і
  // ліцензійна логіка читатимуть TARIFF_MATRIX без зміни клієнтського коду.
  //
  // free: { ... },          // trial Court Sync 14 днів
  // basic: { ... },         // без Court Sync
  // professional: { ... },  // повний
  // enterprise: { ... },    // SLA, audit-export, BYOS
});

/**
 * Повертає список ідентифікаторів планів.
 * @returns {string[]}
 */
export function getAvailablePlans() {
  return Object.keys(TARIFF_MATRIX);
}

/**
 * Повертає декларацію тарифного плану. null якщо плану нема.
 * @param {string} planId
 * @returns {object|null}
 */
export function getPlan(planId) {
  return TARIFF_MATRIX[planId] || null;
}
