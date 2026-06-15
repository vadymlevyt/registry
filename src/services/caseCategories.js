// ── CASE CATEGORY DISPLAY — ОДНЕ ДЖЕРЕЛО НАЗВ (правило #11) ───────────────────
// Один сенс цього модуля: «як людиночитно показати машинний enum case.category».
// НЕ enum-валідатор (canonical enum — caseSchema.js) і НЕ envelope-мапа
// (ENVELOPE_TO_CASE_CATEGORY — scenarioProcessor.js). Усі точки UI що показують
// категорію тягнуть звідси, щоб назви не розповзалися по компонентах.
//
// `admin` (legacy storage-ім'я адмінсуду) ≡ `administrative` (envelope-ім'я) —
// обидва показуються як «Адміністративна». `administrative_offense`
// (адмінправопорушення) — ІНША юрисдикція, не плутати з `admin`.
// `military` свідомо ВІДСУТНЯ: військові справи юридично адміністративні
// (мігруються military→admin у normalizeCases). Невідоме/null → «Не визначено».

export const CATEGORY_LABELS = Object.freeze({
  civil: 'Цивільна',
  criminal: 'Кримінальна',
  administrative: 'Адміністративна',
  admin: 'Адміністративна',
  commercial: 'Господарська',
  administrative_offense: 'Справа про адміністративне правопорушення',
});

// Короткі підписи для тісних місць (бейдж картки, фільтр-таб). Для більшості
// категорій збігаються з повними; коротшає лише задовге адмінправопорушення.
export const CATEGORY_LABELS_SHORT = Object.freeze({
  ...CATEGORY_LABELS,
  administrative_offense: 'Адмінправопорушення',
});

export const UNKNOWN_CATEGORY_LABEL = 'Не визначено';

/**
 * Людиночитна назва категорії.
 * @param {string|null|undefined} category
 * @param {{ short?: boolean }} [opts] — short:true для тісних бейджів/табів.
 * @returns {string} назва або «Не визначено» для null/невідомого.
 */
export function categoryLabel(category, opts = {}) {
  if (category == null || category === '') return UNKNOWN_CATEGORY_LABEL;
  const map = opts.short ? CATEGORY_LABELS_SHORT : CATEGORY_LABELS;
  return map[category] || UNKNOWN_CATEGORY_LABEL;
}

// Опції для селектора створення/редагування справи (значення → повна назва).
// `admin` — наше storage-значення для адмінсуду (≡ administrative).
export const CATEGORY_SELECT_OPTIONS = Object.freeze([
  { value: 'civil', label: 'Цивільна' },
  { value: 'criminal', label: 'Кримінальна' },
  { value: 'admin', label: 'Адміністративна' },
  { value: 'commercial', label: 'Господарська' },
  { value: 'administrative_offense', label: 'Справа про адміністративне правопорушення' },
]);

// Значення для фільтр-табів реєстру ('all' додається в UI окремо).
export const CATEGORY_FILTER_VALUES = Object.freeze([
  'civil', 'criminal', 'admin', 'commercial', 'administrative_offense',
]);

/**
 * Лінива нормалізація legacy-категорії: 'military' → 'admin' (TASK §3).
 * Військові справи юридично адміністративні — окрема категорія прибрана.
 * Ідемпотентна: 'admin'/'civil'/null повертаються незмінними. Викликається
 * у normalizeCases (App.jsx) на завантаженні справ.
 */
export function normalizeCategoryValue(category) {
  return category === 'military' ? 'admin' : category;
}
