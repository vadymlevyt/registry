# Звіт — Case UI: inline-edit у досьє + людські назви категорій + прибрати «військову» + per-case деталі Result

**TASK:** `docs/tasks/TASK_case_ui_and_result_polish.md`
**Гілка:** `feat/case-ui-polish` (від свіжого `origin/main`)
**Дата:** 2026-06-15
**Статус:** реалізовано, `npm test` зелений (2226 passed), `npm run build` OK.

---

## §1 — БАГ: inline-edit назви/клієнта у досьє (ПРІОРИТЕТ)

**Корінь підтверджено:** `InlineEditableText` був лише у `CaseModal`; клік по справі
відкриває `CaseDossier`, де назва була звичайним текстом (`{caseData.name}`).

**Фікс (`src/components/CaseDossier/index.jsx`):**
- У шапку досьє підключено `InlineEditableText` на **назву** (`allowEmpty={false}`) і
  додано рядок «Клієнт: » з `InlineEditableText` на **клієнта** (порожнє дозволено).
- Збереження — через наявний проп `onExecuteAction('qi_agent','update_case_field',
  {caseId, field, value})`. Ця дія вже ставить `nameSource:'manual'` (actionsRegistry.js),
  тож авто-оновлення з ЄСІТС ручну правку більше не перезапише.
- Працює для БУДЬ-ЯКОЇ справи (і `[ЄСІТС]`-автоназв, і заведених вручну).
- `CaseDossier` уже отримував `onExecuteAction` від App.jsx — новий проп не знадобився.
- `CaseModal`-варіант не чіпано.

**Примітка про кодування:** редактор зберігає кирилицю у JSX-атрибутах як `\uXXXX`.
У звичайному рядку-атрибуті (`="..."`) ці escapes НЕ інтерпретуються → атрибут показував
би літерали. Тому строкові значення атрибутів обгорнуто у вираз (`ariaLabel={"..."}`,
`placeholder={"..."}`) — там `\uXXXX` інтерпретується як JS string literal.

## §2 — Людські назви категорій (один експортований словник, правило #11)

Створено `src/services/caseCategories.js` — ЄДИНЕ джерело назв показу:
- `CATEGORY_LABELS` / `CATEGORY_LABELS_SHORT` + `categoryLabel(cat, {short})` →
  civil→Цивільна, criminal→Кримінальна, administrative/admin→Адміністративна,
  commercial→Господарська, administrative_offense→«Справа про адміністративне
  правопорушення» (short: «Адмінправопорушення»), null/невідоме→«Не визначено».
- `CATEGORY_SELECT_OPTIONS` (селектор create/edit), `CATEGORY_FILTER_VALUES` (фільтр-таби),
  `normalizeCategoryValue` (military→admin, див. §3).

**Застосовано у всіх точках показу:**
- App.jsx: `CAT_LABELS` видалено (CaseCard/CaseModal бейдж → short, поле «Категорія» → повна);
  `catMap` видалено (контекст агента → `categoryLabel`); фільтр-таби → `CATEGORY_FILTER_VALUES`+short.
- CaseDossier: локальний об'єкт `categoryLabel` замінено на `getCategoryLabel(caseData.category)`.

## §3 — Прибрати «Військову»

- `military` прибрано з: словника показу (caseCategories.js), селектора create/edit
  (App.jsx, тепер з `CATEGORY_SELECT_OPTIONS` — додано commercial + administrative_offense),
  фільтр-табів, enum `caseSchema.js` (з оновленим описом), reverse-мапи category у
  contentEditable-полі CaseDossier (додано commercial/administrative_offense), Dashboard
  (стат-плитка і сегмент «Військові» прибрані), агент-промпт `update_case_field` enum (App.jsx).
- **Міграція даних:** `normalizeCases` (App.jsx) ліниво нормалізує `military→admin` через
  `normalizeCategoryValue` (ідемпотентно, без bump схеми). `INITIAL_CASES` Корева/Конах
  переведено `military→admin`.

## §4 — Per-case деталі у Result

`src/services/ecits/scenarioProcessor.js`:
- `processCase` повертає `inc.detail = { case_no, action:'created'|'updated'|'skipped',
  changed: string[] }`; людиночитні мітки: «нова назва: …», «+N засідань», «оновлено
  ecitsState», «пропущено: <причина>». `maybeUpdateAutoIdentity` пише «нова назва: …» при
  авто-перейменуванні.
- `runCases` агрегує у `result.details[]` (cap 200, як history; деталь і для catch-гілки).
- `submitScenarioResult` і `processDeferredCases` ініціалізують `result.details = []`.

`src/components/CourtSync/ImportTab.jsx`:
- `ResultCard` під числами рендерить згортуваний `<details data-testid="result-details">`
  «Деталі по справах (N)» (case_no → дія + зміни). Адитивно: старий result без `details`
  не падає (блок не показується). `handleAddSelectedDeferred` мерджить `inc.details`.

## Підтверджено без коду
- §ПІБ: `buildCaseIdentity` join'ить `resolveRepresentedParties()` як є — без змін.

## Тести (нові)
- `tests/unit/caseCategories.test.js` — §2/§3: назви всіх enum + null, short, селектор/фільтр/
  enum без military, `normalizeCategoryValue`.
- `tests/unit/caseDossierInlineEdit.test.jsx` — §1: клік→input→Enter зберігає name/client
  через `update_case_field`; порожня назва не зберігається; працює для manual-справи.
- `tests/unit/scenarioProcessorDetails.test.js` — §4: action/changed для created/updated/
  skipped, агрегація `result.details`, `processDeferredCases`.
- `tests/unit/ImportTabResultDetails.test.jsx` — §4: рендер списку деталей; старий result
  без details не падає.
- `tests/setup.js` — додано guarded `DOMMatrix`-полифіл (jsdom+pdfjs) для рендеру CaseDossier.

## Свідомо НЕ чіпано (поза скоупом, нотатка для майбутнього)
- `src/App.css` `.cat-military`/`.badge-military` — мертві CSS-класи (жодна справа більше
  не має category=military). Косметичне прибирання — окремо.
- `contextGenerator.js` `CASE_TYPE_LABELS.military` — мапа для AI-прози (інша
  репрезентація, не UI-показ); запис military став мертвим. Не містить
  `administrative_offense` — окремий дрібний борг.

## Перевірки
- `npm test` — 175 файлів, 2226 тестів, усі зелені.
- `npm run build` — OK.
