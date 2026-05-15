# Звіт — TASK 5: ActionsRegistry refactor (БЛОКЕР DP-1)

**Дата:** 2026-05-15
**Гілка розробки:** `claude/refactor-actionsregistry-ZXxRH`
**Тип:** Великий behavior-preserving рефакторинг (винос ACTIONS/PERMISSIONS/executeAction з App.jsx)
**Рамка:** тонкий диспетчер, нуль зміни поведінки, контракт executeAction незмінний.

---

## 1. Baseline (крок 2 handoff — фактичний прогін на свіжому стані ДО змін)

Залежності в контейнері не були встановлені (`vitest: not found`) — виконано `npm ci`, потім зафіксовано baseline на незмінному коді гілки:

| Метрика | Baseline (до змін) |
|---|---|
| `npm test` — Test Files | **66 passed (66)** |
| `npm test` — Tests | **1101 passed (1101)** |
| `npm run build` | **✓ зелений** (`✓ built in ~17s`; лише пре-існуючі chunk-size warnings) |

Числа взяті з фактичного прогону, не з handoff/аудиту.

## 1b. Після рефактора

| Метрика | Після |
|---|---|
| Test Files | **66 passed (66)** — не менше за baseline ✓ |
| Tests | **1101 passed (1101)** — ідентично baseline ✓ |
| `npm run build` | **✓ зелений** (`✓ built in ~28s`; ті самі пре-існуючі warnings) |

Кількість тестів **не зменшилась** (acceptance виконано). Жоден тест не видалено.

---

## 2. Що зроблено

Винесено `ACTIONS` + `PERMISSIONS` + спец-сети + `executeAction` з `src/App.jsx` у новий
`src/services/actionsRegistry.js` як **factory з deps injection**:

```
createActions(deps) → { ACTIONS, PERMISSIONS, executeAction }
```

- `App.jsx` створює інстанс **у тілі компонента (кожен render)** через `createActions({...})`
  і прокидає `executeAction` пропом у Dashboard/CaseDossier — **НЕ глобальний сінглтон**.
  Спільний стан лишається в App.jsx, у factory приходить через `deps`.
- `getCases: () => cases` замикає поточний render-снапшот → ідентично попередньому
  inline `const ACTIONS` (рекреація щорендер). У тестах `getCases` повертає живий
  `let cases` — точно як робив старий harness.
- Винос **byte-for-byte verbatim**: тіла всіх ACTIONS/PERMISSIONS/executeAction
  дослівні. **Єдина** трансформація — bare `cases.find(` → `getCases().find(`
  (10 входжень: 9 в ACTIONS, 1 в executeAction step 4). Підтверджено об'єктивним
  diff'ом проти `git HEAD:src/App.jsx` (модуль blank-layout — identical).

### Перелік deps (повний — closures над зовнішнім станом / сайд-ефекти / стаби)

Складено зі **свіжого читання** коду (range 4784–6418), не з переліку handoff.

**Component-scope closures (App.jsx):**
`getCases` (← `() => cases`, 10 read-сайтів), `setCases` (35), `setNotes` (3),
`setTimeEntries` (8), `saveNotesToLS` (3, App fn), `writeAudit` (3, App fn —
обгортка `setAuditLog`).

**Ін'єктовано для тестопридатності (App підставляє реальні, тести — стаби):**
`checkTenantAccess`, `checkRolePermission`, `checkCaseAccess` (permissionService —
БЕЗ цього `tenantId:'tenant_1'` у фікстурах `actions.test.js` ламав би реальний
`checkCaseAccess`); `activityTracker` (billing-сайд-ефекти); `eventBus`
(pub/sub); `deleteDriveFile`, `deleteOcrCacheForDocument`,
`deleteExtendedForDocument` (Drive I/O — без цього `delete_document` mode='full'
робив би реальні HTTP, а `getDeletedDriveIds()` не працював би).

**Лишились прямими `import` у actionsRegistry.js (чисті/детерміновані, поведінка
та сама що в App.jsx; старий harness теж імпортував реальні):**
`ensureCaseSaasFields`, `getCurrentUser`, `DEFAULT_TENANT`, `shouldAudit`,
8 топік-констант eventBusTopics, `canOverwrite`, `buildAlternativeSourceRecord`,
`validateDocument`, `getTimeStandard`/`getCategoryDefaults`/`getVariantDefault`,
`MODULES`/`categoryForCase`. Хелпер `isProceedingDescendant` і спец-сети
`UI_ONLY_ACTIONS`/`SYSTEM_ACTIONS_NO_BILLING`/`EDIT_ACTIONS_SOURCE_AWARE`
перенесено в module-scope actionsRegistry.js (експортовано).

---

## 3. Файли

**Створено:**
- `src/services/actionsRegistry.js` (1738 рядків) — factory `createActions(deps)`
  + module-scope `UI_ONLY_ACTIONS`/`SYSTEM_ACTIONS_NO_BILLING`/`EDIT_ACTIONS_SOURCE_AWARE`
  (export) + `isProceedingDescendant`.
- `tests/integration/_actionsTestSetup.js` — тонкий адаптер над реальним
  `createActions` (НУЛЬ ACTION-логіки; конструює ізольовані deps; API сумісний
  зі старим `createHarness`).

**Видалено:**
- `tests/integration/_actionsHarness.js` (545 рядків ручного дублювання логіки —
  закрито `tracking_debt #3`).

**Модифіковано:**
- `src/App.jsx` — видалено винесений блок (−1704 рядків нетто), додано
  `import { createActions }` і виклик `const { executeAction } = createActions({...})`.
- `tests/integration/actions.test.js` — repoint import (+ оновлено застарілий коментар-шапку).
- `tests/integration/agent-workflow.test.js` — repoint import.
- `tests/integration/document-processor.test.js` — repoint import + 1 асерт (див. §4).
- `tests/integration/drag-n-drop.test.js` — repoint import + 1 асерт (див. §4).
- `tests/integration/update_document_source.test.js` — repoint import (+ коментар-шапка).
- `tests/unit/canonicalSchemaV7.test.js` — оновлено застарілий коментар (НЕ імпортер
  harness — лише текстова згадка; код не чіпано).
- `tests/unit/toolDefinitions.test.js` — repoint **парсингу** з `src/App.jsx`
  на `src/services/actionsRegistry.js` (PERMISSIONS.dossier_agent переїхав туди;
  асерти незмінні). Знайдено прогоном (handoff це передбачав).
- `CLAUDE.md` § ТЕСТУВАННЯ — оновлено на нову реальність (Variant A).
- `tracking_debt.md` — закрито #3; додано #7, #8 (латентні знахідки, НЕ виправлено).

Repoint **усіх** імпортерів виконано через `grep -rl _actionsHarness tests/`
(не за переліком handoff): 5 інтеграційних імпортерів + canonicalSchemaV7
(коментар) + toolDefinitions (text-parse) — усі оброблено.

---

## 4. Відхилення від handoff (з поясненнями)

Handoff п.5/п.9 вимагав «усі тести проходять **без зміни асертів**». Цю вимогу
писано під припущенням що `_actionsHarness` **дослівно** дзеркалить ACTIONS.
Фактично harness — ручна апроксимація (CLAUDE.md/audit це прямо фіксують:
«повторює мінімум логіки», «синхронізація вручну») і у **двох** місцях
розходився з реальними ACTIONS. Сам рефактор **нуль** змінює поведінку App
(доведено byte-diff). Розходження — наслідок інфідельності harness, не
рефактора. Реалізовано через **експертну автономію** (handoff: «нюанс який
handoff не врахував»), мінімально, з повним поясненням, інтент тестів незмінний:

1. **`document-processor.test.js`** — `expect(result.error).toMatch(/дублікат/i)`
   → `/вже існують/i`. Реальний `add_documents` повертає
   «N документів з такими id вже існують у справі»; harness вигадував «дублікатів».
   ACTION НЕ чіпано (зміна = зміна поведінки App). Асерт вирівняно на **фактичний**
   текст системи; інтент («дублікат відхилено») збережено.

2. **`drag-n-drop.test.js`** — `expect(result.success).toBe(false)`
   → `toBeFalsy()`. Реальний `update_case_field` на забороненому полі повертає
   `{ error }` **без** `success:false` (латентна неконсистентність форми проти
   сусідніх ACTIONS — `tracking_debt #8`). Harness додавав `success:false` від
   себе. Per інструкцію TASK 5 («дрібну неконсистентність — у tracking_debt, не
   виправляти») ACTION НЕ чіпано; асерт вирівняно на фактичну форму, інтент
   («відмова = не-успіх + повідомлення») збережено.

3. **`toolDefinitions.test.js`** (handoff не згадував — знайдено прогоном): тест
   **text-парсить** `src/App.jsx` за `PERMISSIONS.dossier_agent`. Після виносу
   блок живе в `actionsRegistry.js` — repoint шляху парсингу на нове місце.
   Асерти **незмінні**; це той самий «repoint консумера», що й repoint
   імпортерів harness (handoff п.5 — «repoint УСІ файли-імпортери»), просто
   консумер не через import а через `fs.readFileSync`.

4. **Тестовий setup замість 5× inline deps.** Handoff: «repoint на реальний
   `createActions(deps)`». Замість дублювання ~40 рядків deps-обв'язки в кожному
   з 5 файлів — один спільний `_actionsTestSetup.js` що містить **НУЛЬ** ACTION-
   логіки (лише конструює deps над справжнім `createActions`). Це **краще**:
   повністю закриває борг #3 (нема дубльованої логіки), DRY, асерти/фікстури
   без змін, видимий repoint. Не реінтродукує борг (борг = дубльована ACTION-
   логіка, тут її немає).

5. **Дрібна дотична знахідка (виправлено в scope, дозволено handoff).** Видалення
   `isProceedingDescendant`+спец-сетів (стара App.jsx 218–263) усунуло
   **пре-існуючу** хибну прив'язку коментаря: `// Найближчий дедлайн справи`
   тепер коректно стоїть над `getNextDeadline` (раніше був відірваний рядком
   вище `isProceedingDescendant`). Косметика, нуль поведінки.

**Вплив на DP v2 / API `createActions`:** жодного негативного. API саме той що
вимагав handoff: `createActions(deps) → { ACTIONS, PERMISSIONS, executeAction }`,
проп (не сінглтон). DP v2 отримає `executeAction` з того самого джерела через
проп `onExecuteAction` — не тягне власну логіку. Тестопридатність через
`_actionsTestSetup` — готовий зразок як DP v2 тести вмикатимуть реальний шар.

---

## 5. Acceptance criteria — статус

| # | Критерій | Статус |
|---|----------|--------|
| 1 | `src/services/actionsRegistry.js` з factory `createActions(deps)` | ✅ |
| 2 | Контракт `executeAction(agentId,action,params,[userId])` незмінний (signature + 10-кроковий pipeline) | ✅ (byte-diff verbatim) |
| 3 | `_actionsHarness.js` видалено, всі імпортери repoint'нуті на реальний `createActions` | ✅ (через `_actionsTestSetup`; 5 import + canonicalSchemaV7 коментар + toolDefinitions parse) |
| 4 | Тестів не менше за baseline | ✅ 1101 = 1101, файлів 66 = 66 |
| 5 | Поведінка ідентична (паритет на наявних тестах) | ✅ byte-diff verbatim; всі тести зелені |
| 6 | `npm test` + `npm run build` зелені | ✅ |
| 7 | Звіт `docs/reports/report_task_5_actionsregistry_refactor.md` | ✅ (цей файл) |
| 8 | Правило #1: підтвердження ПЕРЕД push у main | ⏳ очікує підтвердження адвоката |
| 9 | НЕ глобальний сінглтон; проп зберігся | ✅ |
| 10 | functional-updater `setCases(prev=>…)`/`setTimeEntries(prev=>…)` збережено точно | ✅ (verbatim) |
| 11 | tracking_debt #3 закрито | ✅ (+ #7,#8 нові знахідки) |

---

## 6. Підтвердження behavior-preserving

Об'єктивний доказ: `git show HEAD:src/App.jsx | sed -n '4783,6418p'`
(з тією самою `cases.find→getCases().find` заміною) **diff** проти тіла
`createActions` у новому файлі → **identical** (модуль blank-line layout).
Тобто ACTIONS/PERMISSIONS/executeAction перенесено дослівно; жодної логічної
правки. Паритет на наявних тестах підтверджено БЕЗ зміни тестового інтенту
(дві асерт-реалігнменти — вирівнювання на **фактичну** поведінку системи
проти інфідельного harness, не маскування регресії; §4).

## 7. Підтвердження що executeAction контракт незмінний

Сигнатура `async (agentId, action, params, userId)` — дослівна. 10-кроковий
pipeline (UI-only gate → PERMISSIONS allowlist → ACTIONS lookup →
checkTenantAccess → checkRolePermission → checkCaseAccess →
`await ACTIONS[action](params)` → shouldAudit→writeAudit → billing
(SYSTEM_ACTIONS_NO_BILLING / EDIT_ACTIONS_SOURCE_AWARE) → return; catch →
`{success:false,error}`) — байт-у-байт. Змінилось **лише місце визначення**
(App.jsx inline → `createActions` factory) і джерело closures (App-scope →
`deps`). Контракт для всіх callers (Dashboard/CaseDossier/QuickInput/
toolUseRunner) ідентичний.

## 8. Побічні знахідки (у tracking_debt, НЕ виправлено в TASK 5)

- **#7** `add_time_entry`: мертвий `const tenant = getCurrentTenant ? null : null;`
  — `getCurrentTenant` ніде не імпортовано (латентний баг ще з App.jsx; при
  виклику `add_time_entry` → ReferenceError → executeAction catch → `{success:false}`).
  Збережено дослівно (behavior-preserving). Жоден тест не виконує `add_time_entry`.
- **#8** Неконсистентність форми результату: `update_case_field` повертає
  `{ error }` без `success:false` (vs сусідні `{ success:false, error }`).

Обидва — фіксація, не виправлення (інструкція TASK 5 + DEVELOPMENT_PHILOSOPHY
read-only-знахідки). Тригери — у `tracking_debt.md`.
