// ── REGISTRY WRITE-GUARD ─────────────────────────────────────────────────────
// Чиста (без I/O) перевірка: чи безпечно перезаписати registry_data.json на Drive,
// чи новий payload підозріло "схуднув" — ознака втрати даних при race condition
// або записі з недогідрейченого/застарілого стану.
//
// Контекст народження: ai_usage[] на живому Drive було тихо затерто до 1 запису —
// сесія зберегла порожній in-memory масив поверх повної історії. cases[] мав
// свій shrink-guard і вцілів; ai_usage/auditLog/users/tenants — НЕ мали, і
// постраждали б так само. Цей модуль — спільна сітка безпеки для всіх них.
//
// ── ПОЛІТИКА ПО ПОЛЯХ (кожне поле — один намір, правило #11) ─────────────────
//   cases        — може зменшитись рівно на 1 (закриття/видалення справи).
//                  Блок лише при падінні більш ніж на 1 (< prev - 1).
//                  Для свідомого видалення кількох справ — UI/ACTION має
//                  ПЕРЕД записом сигналізувати `expectIntentionalCasesShrink(n)`,
//                  guard разово дозволить дозвіл prev-(1+n) і скине сигнал.
//   ai_usage     — монотонний: тільки росте, LIFO-cap 50000 тримає стелю
//                  (стабільно, не худне). Будь-яке значуще падіння = втрата.
//   auditLog     — append-only критичні дії; та сама монотонна політика.
//   users        — критичний дрібний масив; ніколи не порожніє осмислено.
//   tenants      — те саме.
//   time_entries — СВІДОМО НЕ guard'имо: легітимно худне 1-го числа (місячна
//                  ротація у _archives/ лишає тільки поточний місяць). Наївний
//                  shrink-guard тут хибно заблокував би нормальний запис.
//
// «Значуще падіння» для монотонних логів = колапс до порожнього АБО падіння
// значущої історії (>= GUARD_MIN_HISTORY) більш ніж удвічі. Поріг відсікає
// дрібні історії, де судити про «колапс» рано (мала втрата — мала шкода),
// і не реагує на нормальний ріст чи стабільну LIFO-стелю.

export const GUARD_MIN_HISTORY = 20;

export function arrLen(x) {
  return Array.isArray(x) ? x.length : 0;
}

// Монотонні логи — захист від колапсу значущої історії.
const MONOTONIC_LOG_FIELDS = ['ai_usage', 'auditLog'];
// Критичні дрібні масиви — захист лише від повного спорожнення.
const CRITICAL_SMALL_FIELDS = ['users', 'tenants'];

// ── ONE-SHOT СИГНАЛ «свідомий shrink cases» ──────────────────────────────────
// TASK case_delete_persist: випадкове затирання cases[] зі старої localStorage
// уже траплялось у реальній експлуатації — guard ловить shrink > 1 і блокує
// запис (захист працює). Але навмисне видалення КІЛЬКОХ справ одним заходом
// (UI/агент) теж зачіпало це правило — write блокувався як guard_blocked,
// видалення не доїжджало до Drive і поверталось після reload.
//
// Розв'язка: caller, що ЗНАЄ скільки справ він зараз видаляє, разово сигналізує
// guard'у `expectIntentionalCasesShrink(n)`. Перший виклик `evaluateRegistryWriteGuard`
// розширює дозвіл до prev-(1+n) і ОДРАЗУ скидає сигнал (one-shot). Наступний
// несигналізований запис знов працює за дефолтом (−1). Інші поля
// (ai_usage/auditLog/users/tenants) сигналом НЕ зачіпаються — їх інваріант
// окремий і не торкається свідомого видалення справ.
let _expectedCasesShrink = 0;

export function expectIntentionalCasesShrink(n) {
  const k = Number(n);
  if (!Number.isFinite(k) || k <= 0) return;
  // Якщо вже стояв сигнал (наприклад, caller подвоїв виклик) — беремо більший,
  // щоб дозвіл покривав фактичний намір. Скидається все одно на першому записі.
  _expectedCasesShrink = Math.max(_expectedCasesShrink, Math.floor(k));
}

// Тестовий хелпер — повне обнулення стану модуля між тестами (vitest reloadable).
// Прод-код цього не викликає.
export function __resetWriteGuardState() {
  _expectedCasesShrink = 0;
}

// Видимий getter (для тестів і діагностики) — не вживати у проді як гарантію.
export function __peekExpectedCasesShrink() {
  return _expectedCasesShrink;
}

// Повертає reason (string) якщо запис треба ЗАБЛОКУВАТИ, інакше null.
// prev — лічильники з останнього успішного read/write: { cases, ai_usage,
// auditLog, users, tenants }. Відсутній/0 prev означає «нема з чим порівнювати»
// (свіжий старт) → не блокуємо.
export function evaluateRegistryWriteGuard(registry, prev = {}) {
  // cases — спец-семантика: дозволено −1 (закриття/видалення однієї справи).
  // ONE-SHOT-сигнал розширює до −(1+n) для свідомого видалення кількох справ.
  // Скидаємо сигнал ОДРАЗУ, незалежно від того, дозволив він запис чи ні —
  // саме «один запис на один намір» (правило #11: один сенс, не накопичується).
  const casesNew = arrLen(registry?.cases);
  const casesPrev = prev.cases || 0;
  const allowedShrink = 1 + _expectedCasesShrink;
  _expectedCasesShrink = 0;
  if (casesPrev > 0 && casesNew < casesPrev - allowedShrink) {
    return 'cases_count_decreased';
  }

  // Монотонні логи: колапс до нуля або падіння значущої історії більш ніж удвічі.
  for (const field of MONOTONIC_LOG_FIELDS) {
    const cur = arrLen(registry?.[field]);
    const p = prev[field] || 0;
    if (p <= 0) continue;
    if (cur === 0) return `${field}_emptied`;
    if (p >= GUARD_MIN_HISTORY && cur < Math.floor(p / 2)) return `${field}_collapsed`;
  }

  // Критичні дрібні масиви: лише захист від повного спорожнення.
  for (const field of CRITICAL_SMALL_FIELDS) {
    const cur = arrLen(registry?.[field]);
    const p = prev[field] || 0;
    if (p > 0 && cur === 0) return `${field}_emptied`;
  }

  // time_entries — свідомо поза guard'ом (місячна ротація).
  return null;
}
