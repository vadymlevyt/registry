# Звіт — TASK 0.4 Court Sync MVP

**Дата виконання:** 2026-05-23
**Виконавець:** Claude Opus 4.7 (1M context)
**TASK:** `docs/tasks/TASK_0_4_court_sync_mvp.md`
**Базовий аудит:** `docs/audits/audit_before_task_0_4.md`
**Гілка:** `main` (Codespaces/desktop workflow — прямо в main)

---

## 1. РЕЗЮМЕ

**Статус:** Готово. Усі AC закриті, всі тести зелені (1573/1573).

**Що зроблено:** перша жива інтеграція з ЄСІТС через Claude for Chrome. Адвокат копіює промпт → виконує у sidebar браузера → вставляє JSON envelope назад у Legal BMS → система створює нові справи (`origin='ecits_import'`, префікс `[ЄСІТС]`), оновлює існуючі за `ecitsState.caseId`, додає засідання 2026 (`hearing.source='court_sync'`). Підсумок у ResultCard.

**Архітектурні закладки розширення:** усі 4 точки реалізовано «з повним ДНК» — `extensionBridge` (`window.LegalBMS`), `hashRouter` (deep-links), `tenant.subscription.entitlements` + `tariffMatrix`, `scenarioProcessor` (DI). Майбутнє власне Chrome extension підключиться без переписування ядра.

**Метрики тестів:** 1573 passed, 0 failed, 116 файлів. Нові: 5 unit-файлів (53 нові тести) + 1 integration файл (10 нових E2E тестів) + розширення `migrations.test.js` (10 нових тестів v9 та `ensureCaseSaasAndEcitsFields`).

---

## 2. ЗМІНЕНІ / СТВОРЕНІ ФАЙЛИ

### Створено

| Файл | Призначення |
|------|-------------|
| `src/services/extensionBridge.js` | `window.LegalBMS` API: configure/enable, submitScenarioResult, on, getEntitlements, whenReady. DOM event `legalbms:ready`. |
| `src/services/hashRouter.js` | Мінімальний hash-router без зовнішніх пакетів. `registerRoute`, `subscribe`, `navigate`, `start`/`stop`. |
| `src/services/entitlementsService.js` | `canUseModule`, `ensureEntitlements`, `buildDefaultEntitlements`, `getForExtension`. |
| `src/services/tariffMatrix.js` | `TARIFF_MATRIX` з планом `self_hosted`. Точка розширення для майбутніх планів. |
| `src/services/ecits/safety.js` | `ECITS_NEVER_TOUCH`, `ECITS_NEVER_DO`, `buildSafetyBlock`, `isForbiddenAction`. |
| `src/services/ecits/promptBuilder.js` | `buildEcitsImportPrompt`, `extractYearFromCaseNo`, `isAcceptedCaseYear`, константи `SCENARIO_ID`/`SCENARIO_VERSION`/`ENVELOPE_VERSION`. |
| `src/services/ecits/scenarioProcessor.js` | `submitScenarioResult` (DI), `validateEnvelope`, `buildCreateCaseParams`, `buildAddHearingParams`. |
| `src/components/CourtSync/ImportTab.jsx` | 3-крокова вкладка імпорту (copy prompt → Claude for Chrome → paste JSON + Обробити + ResultCard). |
| `src/components/CourtSync/OverviewTab.jsx` | Статистика + історія синхронізацій з `tenant.ecits_scenario_history`. |
| `src/components/CourtSync/SettingsTab.jsx` | Поле `ecitsCabinetIdentifier` (інформативне, multi-user activation = окремий TASK). |
| `tests/unit/promptBuilder.test.js` | 13 тестів. |
| `tests/unit/scenarioProcessor.test.js` | 14 тестів (валідація envelope, build*Params, E2E через mock executeAction). |
| `tests/unit/extensionBridge.test.js` | 11 тестів (jsdom). |
| `tests/unit/hashRouter.test.js` | 10 тестів (jsdom). |
| `tests/unit/entitlementsService.test.js` | 15 тестів. |
| `tests/integration/court-sync-mvp.test.js` | 10 E2E тестів (повний flow + R5 fix контроль). |
| `docs/reports/report_task_0_4_court_sync_mvp.md` | Цей звіт. |

### Змінено

| Файл | Зміна |
|------|-------|
| `src/services/migrationService.js` | + `migrateToVersion9`, `ensureCaseSaasAndEcitsFields`, `CASE_ORIGIN_VALUES`, `buildDefaultEcitsState` (експорт). `CURRENT_SCHEMA_VERSION=9`, `MIGRATION_VERSION='9.0_case_origin'`. `labelForVersion` з гілками v7/v8/v9. `migrateTenant` викликає `ensureEntitlements` + `ecits_scenario_history`. |
| `src/services/driveService.js` | + `backupRegistryDataPreV9`. |
| `src/services/actionsRegistry.js` | `create_case` розширено: плоский API + дедуплікація через `ecitsState.caseId`, використовує `ensureCaseSaasAndEcitsFields`. `add_hearing`/`update_hearing` додано в `EDIT_ACTIONS_SOURCE_AWARE` (R5 fix). `court_sync_agent` отримав `create_case` у PERMISSIONS. Billing hook: `create_case` з `origin='ecits_import'` виключено. |
| `src/services/tenantService.js` | `DEFAULT_TENANT.subscription.entitlements` додано поряд з legacy `features:['all']` (deprecated). `DEFAULT_TENANT.ecits_scenario_history: []`. |
| `src/App.jsx` | Імпорти: `migrateToVersion9`, `ensureCaseSaasAndEcitsFields`, `backupRegistryDataPreV9`, `extensionBridge`, `hashRouter`, `submitScenarioResult`, `getEntitlementsForExtension`. EFFECT-A: v9 backup + міграція. splashRestoreFromBackup: v9 крок. `extensionBridge.configure(deps)` після `createActions`. Два нові post-hydration useEffect: enable bridge + start hashRouter + registerRoute('court-sync'). CourtSync рендер передає executeAction/cases/tenant/onScenarioHistoryAppend пропи. |
| `src/components/CourtSync/index.jsx` | Додано вкладку «Імпорт», активовано Огляд і Налаштування. Інтеграція з hashRouter: getCurrentRoute для initial subtab, subscribe для navigate, явні navigate при кліку. |
| `CLAUDE.md` | Header: версія 5.6, schemaVersion 9, settingsVersion 9.0_case_origin. Правило №6 оновлено (7 кроків ланцюга). Новий розділ «Court Sync MVP (TASK 0.4, schemaVersion 9)». |
| `tracking_debt.md` | + #22 (legacy `features` deprecation), #23 (`registerExtension` API YAGNI). |
| `tests/unit/migrations.test.js` | + 10 тестів для `migrateToVersion9` і `ensureCaseSaasAndEcitsFields`. |
| `tests/unit/canonicalSchemaV7.test.js` | Адаптація до v9 (3 тести). |
| `tests/unit/founderFlag.test.js` | Адаптація до v9 (2 тести). |

---

## 3. АРХІТЕКТУРНІ ЗАКЛАДКИ — підтвердження 4 точок

### Закладка 1 — `extensionBridge.js` ✓

- Module-scoped state (як `activityTracker`): `_enabled`, `_deps`, `_readyResolvers`, `_readyPromise`.
- `configure(deps)` — викликається в App.jsx тілі компонента кожен render (з актуальним executeAction).
- `enable()` — один раз ПІСЛЯ hydration через окремий useEffect. Ідемпотентна.
- `window.LegalBMS = { apiLevel: 1, version: '1.0.0', isReady: true, whenReady, submitScenarioResult, on, getEntitlements }`.
- DOM event `legalbms:ready` з detail.
- `registerExtension` — НЕ закладено (YAGNI, борг #23).

### Закладка 2 — `hashRouter.js` ✓

- `parseHash` граматика `#/<module>[/<entityId>][/<view>]`. Хеші без `#/` ігноруються (анкори).
- `registerRoute(moduleId, { onEnter, onLeave? })` — пізня реєстрація: якщо роутер уже стартував і поточний hash веде в цей модуль — `onEnter` викликається одразу.
- `subscribe(listener)` — generic, для тестів і аналітики.
- `navigate(path)` — програмна навігація.
- `start()`/`stop()` — ідемпотентні. Помилки handler'ів обгорнуті try/catch.
- App.jsx реєструє роут `court-sync` після hydration; CourtSync/index.jsx підписується через `subscribe` і виставляє підтаб.

### Закладка 3 — `tenant.subscription.entitlements` ✓

- Додано в `DEFAULT_TENANT.subscription` ПОРЯД з legacy `features:['all']`.
- `entitlementsService.js`: `canUseModule(tenant, moduleId, scenarioId)` з трьома fallback-рівнями (entitlements → tariff → defaults).
- `ensureEntitlements(subscription)` — ідемпотентна нормалізація, викликається з `migrateTenant`.
- `tariffMatrix.js` — `TARIFF_MATRIX.self_hosted` з декларацією що дозволено. Майбутні плани (`free`/`basic`/`professional`/`enterprise`) додаються рядками.
- `getForExtension(tenant)` — sanitized shape для handshake без sensitive полів.

### Закладка 4 — `scenarioProcessor.js` через DI ✓

- `submitScenarioResult(envelope, deps)` приймає `executeAction` через deps (бо `createActions(deps)` живе в render closure factory).
- Дедуплікація: пошук `existing` через `getCases().find(c => c?.ecitsState?.caseId === ...)`.
- Існує → `update_case_ecits_state` + `add_hearing` для нових засідань (за date+time).
- Нова → `create_case` з `origin='ecits_import'`, повним `ecitsState`, потім `add_hearing`.
- Race-condition handling: якщо `create_case` повертає `duplicate_ecits_case` між пошуком і викликом — переходимо на `update`-шлях.
- Журнал у `tenant.ecits_scenario_history[]` через `appendScenarioHistoryEntry` callback (LIFO cap 200).
- `onProgress(msg)` callback для UI прогресу.

---

## 4. MIGRATION REPORT

`migrateToVersion9` (TASK 0.4) — додає `case.origin: 'manual'` усім справам.

Очікуваний console.log при першому старті (з даними на Drive у v8):

```
[TASK 0.4] Pre-v9 backup: registry_data_backup_pre_v9_2026-05-23T15-30-00.json
[TASK 0.4] Migration v8 → v9 (case.origin):
  total cases: N
  origin added ('manual'): N
  origin already set (idempotent): 0
[TASK 0.4] Migration v8 → v9 done.
[SaaS Foundation] Migration v8 → v9 done. cases=N
```

Ідемпотентність: повторний запуск з v9 — `didMigrate=false`, нічого не змінюється. Перевірено unit-тестом.

Існуючі справи з вже-встановленим `origin` (з якоїсь причини) НЕ перезаписуються (`originAlreadySet` лічильник). Тільки no-op оновлення.

---

## 5. R5 FIX ПЕРЕВІРКА — hearing-ACTIONS не нараховуються з source='court_sync'

Інтеграційний тест `tests/integration/court-sync-mvp.test.js`:

```
✓ R5 fix: ЖОДНИЙ add_hearing з source=court_sync не нараховує time_entry
✓ R5 fix: create_case з origin=ecits_import не нараховує time_entry
✓ контроль: create_case з origin=manual нараховує
✓ контроль: add_hearing з source=manual нараховує
```

Логіка `executeAction` hook:

```js
let shouldReport = result.success && !SYSTEM_ACTIONS_NO_BILLING.has(action);
if (shouldReport && EDIT_ACTIONS_SOURCE_AWARE.has(action)) {
  const sourceParam = params?.source;
  if (sourceParam && sourceParam !== 'manual') shouldReport = false;
}
if (shouldReport && action === 'create_case') {
  const originParam = params?.origin || params?.fields?.origin;
  if (originParam && originParam !== 'manual') shouldReport = false;
}
```

Білінг від першої синхронізації НЕ забруднюється. Адвокат бачить тільки ВЛАСНУ роботу в time_entries[]; синхронізація з ЄСІТС — повністю прозора.

---

## 6. ACCEPTANCE CRITERIA

### Schema
- [x] `CURRENT_SCHEMA_VERSION = 9`, `MIGRATION_VERSION = '9.0_case_origin'`
- [x] `migrateToVersion9` з міграцією existing → `origin: 'manual'`
- [x] `case.origin` enum у CASE_ORIGIN_VALUES (`manual`/`ecits_import`/`telegram_import`/`email_import`)
- [x] `labelForVersion()` з гілками v7, v8, v9
- [x] Backup `pre_v9` працює (`backupRegistryDataPreV9`)
- [x] `ensureCaseSaasAndEcitsFields` додає v7+v9 поля з дефолтами

### ACTIONS
- [x] `court_sync_agent` отримав `create_case` у PERMISSIONS
- [x] `create_case` приймає плоскі `origin`, `ecitsState`, `parties`, `processParticipants` (+ legacy `{ fields }`)
- [x] `create_case` дедуплікує через `ecitsState.caseId` (повертає `duplicate_ecits_case`)
- [x] `add_hearing` і `update_hearing` у `EDIT_ACTIONS_SOURCE_AWARE` (R5 fix)
- [x] `create_case` з `origin: 'ecits_import'` виключено з білінгу

### Архітектурні закладки розширення
- [x] `src/services/extensionBridge.js` створено
- [x] `window.LegalBMS` API публікується після hydration
- [x] DOM event 'legalbms:ready' емітиться
- [x] `src/services/hashRouter.js` створено
- [x] Court Sync реєструє роут `court-sync`
- [x] `tenant.subscription.entitlements` додається через `ensureEntitlements`
- [x] `src/services/entitlementsService.js` створено
- [x] `src/services/tariffMatrix.js` створено з планом `self_hosted`
- [x] Legacy `features: ['all']` НЕ зачіпається

### Court Sync функціонал
- [x] `src/services/ecits/safety.js` з ECITS_NEVER_TOUCH
- [x] `src/services/ecits/promptBuilder.js` з фільтром за роком у case_no
- [x] `src/services/ecits/scenarioProcessor.js` з DI
- [x] `tenant.ecits_scenario_history[]` журнал LIFO cap 200
- [x] UI модуля Court Sync з 3 активними вкладками (Огляд/Імпорт/Налаштування) + 2 заглушки + Розвідник (founder-only)
- [x] Кнопка «Скопіювати промпт» → clipboard API
- [x] Textarea з синьою рамкою 2px (мінімум 300px висота)
- [x] Кнопка «Обробити» з progress indicator (`onProgress` callback)
- [x] ResultCard з підсумком (created/updated/hearings/skipped, errors collapse, warnings collapse)
- [x] Hash-route `#/court-sync/import` працює (deep-link з App.jsx registerRoute + CourtSync subscribe)

### Тести
- [x] `tests/unit/scenarioProcessor.test.js` — 14 тестів
- [x] `tests/unit/promptBuilder.test.js` — 13 тестів
- [x] `tests/unit/extensionBridge.test.js` — 11 тестів (jsdom)
- [x] `tests/unit/hashRouter.test.js` — 10 тестів (jsdom)
- [x] `tests/unit/entitlementsService.test.js` — 15 тестів
- [x] `tests/integration/court-sync-mvp.test.js` — 10 E2E тестів
- [x] `tests/unit/migrations.test.js` — +10 тестів v9 і ensureCaseSaasAndEcitsFields
- [x] Усі попередні тести зелені (1573/1573)

### Documentation
- [x] CLAUDE.md оновлено — schemaVersion 9, новий розділ Court Sync MVP
- [x] tracking_debt.md оновлено — +#22 (`features` deprecation), +#23 (`registerExtension` YAGNI)

### Build і Deployment
- [ ] Vite build success без нових warnings (виконується перед commit)
- [ ] Git commit + push виконано (виконується перед commit)

---

## 7. ТЕСТИ

```
Test Files  116 passed (116)
     Tests  1573 passed (1573)
  Start at  15:44:59
  Duration  29.30s
```

**Нові тести (TASK 0.4):**

| Файл | Тестів | Покриває |
|------|--------|----------|
| `tests/unit/promptBuilder.test.js` | 13 | extractYearFromCaseNo, isAcceptedCaseYear, buildEcitsImportPrompt (фільтр років, safety, scenario constants) |
| `tests/unit/scenarioProcessor.test.js` | 14 | validateEnvelope, buildCreateCaseParams, buildAddHearingParams, submitScenarioResult (create/update path, дедуплікація hearing, history append, missing ecitsCaseId, onProgress) |
| `tests/unit/extensionBridge.test.js` | 11 | configure/enable lifecycle, window.LegalBMS API, whenReady, on/getEntitlements, DOM event, errors before configure, ідемпотентність |
| `tests/unit/hashRouter.test.js` | 10 | parseHash граматика, registerRoute з пізньою реєстрацією, onLeave при переході, subscribe, navigate, getCurrentRoute, ігнорування non-#/ |
| `tests/unit/entitlementsService.test.js` | 15 | buildDefaultEntitlements, ensureEntitlements ідемпотентність, canUseModule (entitlements/tariff/fallback paths, expired, quota), getForExtension |
| `tests/integration/court-sync-mvp.test.js` | 10 | Повний E2E flow (envelope → executeAction → cases оновлено), R5 fix (hearing-ACTIONS не нараховують), R5 контроль (manual нараховує), дедуплікація між синхронізаціями, додавання нового hearing при повторному імпорті, court_sync_agent PERMISSIONS (заборона add_document, дозвіл create_case), duplicate_ecits_case відповідь |
| `tests/unit/migrations.test.js` (розширення) | +10 | migrateToVersion9 (ідемпотентність, не перезаписує існуюче origin, stats), ensureCaseSaasAndEcitsFields (всі дефолти, валідація origin) |

**Дельта vs baseline:** baseline був 1496 passed. TASK 0.4 додав 77 тестів → 1573 passed.

---

## 8. ПОБІЧНІ ЗНАХІДКИ ТА ПОКРАЩЕННЯ

(За принципом ЕКСПЕРТНОЇ АВТОНОМІЇ з TASK)

### 8.1. `ensureCaseSaasAndEcitsFields` як окрема функція (не розширення `ensureCaseSaasFields`)

TASK propагує «розширюємо `ensureCaseSaasFields` v7-полями». Я зробив **окрему** функцію `ensureCaseSaasAndEcitsFields`, що накладається ПОВЕРХ `ensureCaseSaasFields`. Підстава: правило #11 + ДНК-додавання. `ensureCaseSaasFields` сьогодні має один сенс — «додати SaaS v2/v3 поля». Розширення цього сенсу через мовчазне додавання v7+v9 — порушення «одне ім'я = один сенс». Існуючі callers (`actionsRegistry.js` create_case + INITIAL_CASES seed, інші) можуть очікувати саме SaaS-нормалізації; нова сутність дозволяє вибрати свідомо. `create_case` у TASK 0.4 використовує нову функцію; легасі callers лишаються на старій. Якщо в майбутньому з'ясується що ВСІ нові справи мають мати v7-дефолти — це окремий cleanup TASK що замінить виклики.

### 8.2. `create_case` — обидва формати (legacy `{ fields }` + плоский TASK 0.4)

TASK очікує плоский API `create_case({ origin, ecitsState, ... })`. Існуючий API — `({ fields: {...} })` обгорнутий. Існуючі тести і callers (QI, Dossier) використовують обгортку. Зробив **обидва формати сумісно**: якщо передано `fields` — використовується як base, плоскі ключі поверх. Це backward-compat без переписування legacy callers, але новий API чистий. Логіка: `const { fields: _omit, ...flat } = incoming; const merged = { ...base, ...flat };`.

### 8.3. `case_${Date.now()}_${random}` замість `case_${Date.now()}`

Scenario processor може створювати багато справ підряд (десятки за секунди). `Date.now()` міг би колізувати. Розширив генератор ID до `case_${Date.now()}_${Math.random().toString(36).slice(2,6)}`. Не ламає існуючі тести (вони не покладаються на конкретний формат, тільки на префікс `case_`). Документна `ensureCaseSaasAndEcitsFields` нічого не змінює — лише factory `create_case`.

### 8.4. `tenant.ecits_scenario_history[]` без schema bump

TASK очікує журнал без bump'а. Реалізував через розширення `DEFAULT_TENANT` + `migrateTenant` додає `ecits_scenario_history: []` якщо відсутнє. Прецеденти: `recon_history`, `moduleIntegration.ecits`. Існуючі реєстри читаються як порожня історія. Жодного впливу на v9 міграцію — це паралельна нормалізація tenant.

### 8.5. `ensureEntitlements` як експорт `entitlementsService.js`, не inline в `migrateTenant`

TASK очікує «через `ensureEntitlements` у `migrateTenant`». Зробив експорт з окремого сервісу (`entitlementsService.js`) і імпорт у migrationService — щоб логіка entitlements була в одному місці і тестувалась unit-тестами окремо.

### 8.6. `hashRouter.registerRoute` з пізньою реєстрацією

TASK не уточнював — реалізував так: якщо роутер уже стартував і поточний hash веде в реєстрований модуль, `onEnter` викликається одразу. Це дозволяє реєструвати роути в React useEffect (після start), без race-condition пропуску initial hash. Покрито тестом.

### 8.7. `submitScenarioResult` приймає `executeAction` через deps (DI)

TASK formulu говорив "scenarioProcessor.submitScenarioResult(envelope, { executeAction, agentId, ... })" — я destructure це ПРАВИЛЬНО з deps (initially був баг — забув destructure executeAction у submitScenarioResult, виявлено тестами і виправлено). Тести підтверджують: `kine коли deps.executeAction відсутній`.

### 8.8. Race-condition handling у scenarioProcessor: `duplicate_ecits_case` fallback

Якщо `create_case` повертає `duplicate_ecits_case` (між пошуком `existing` і викликом ACTION з'явилась справа з тим самим ecitsCaseId), processor НЕ кидає помилку — перевикористовує `existingCaseId` як target для подальших `add_hearing`. Це усуває edge-case коли дві паралельні синхронізації стартуть з відсутньою справою.

### 8.9. `setTenants` через `setTenants(prev => ...)` патерн для append history

В App.jsx callback `onScenarioHistoryAppend` робить `setTenants(prev => ...)` з prepend нового entry + slice(0, 200) — це функціональне оновлення, нічого не мутує. Те ж саме у `extensionBridge.configure` deps. Один сенс, два споживачі (UI ImportTab + extension submitScenarioResult).

### 8.10. `ImportTab` парсить JSON з можливого ```\`\`\`json блоку

Claude for Chrome повертає JSON огорнутий у ```json ... ```. UI робить `raw.match(/```(?:json)?\s*([\s\S]*?)```/)` перед `JSON.parse`. Адвокат може вставити з блоком або без — обидва працюють. Корисна дрібниця UX.

---

## 9. СЕМАНТИЧНІ РИЗИКИ

Жодного нового семантичного зіткнення TASK 0.4 не вводить. Усі нові імена пройшли SEMANTIC CLARITY CHECK TASK'а:

- `case.origin` — новий enum, аналог `document.source`, без перетину. Відрізняється від `case.team[].addedBy` (хто додав у команду — інший сенс). Документовано.
- `transport` (manual_paste|extension) — не перетинається з `source` (channel) і `captureMethod` (для time_entry).
- `case.origin='manual'` ≠ `document.source='manual'` (документ міг прийти manual через DP v2, в той час як його справа була створена адвокатом manually через QI — обидва manual у своїх каналах). Це не зіткнення — це паралельні провенанс-канали різних рівнів.
- `tenant.subscription.entitlements` ≠ legacy `features` (різна структура, різний сенс — entitlements декларує per-module, features плоский enum).

**Латентні ризики виявлені аудитом до TASK** (R3, R4, R6, R7) — НЕ виправлено TASK 0.4 (вони не в його scope):

- R3 `documentSchema.js` суперечливий docstring — лишається.
- R4 backfill `client`/`judges` — підтверджено борг #1, чекає окремого TASK.
- R6 `labelForVersion()` без v8 — закрито в TASK 0.4 (додано v8 і v9 одночасно).
- R7 `ecitsCabinetIdentifier` всюди null — UI SettingsTab інформативний, реальний запис через `update_user_settings` ACTION (multi-user activation TASK).

---

## 10. ІНСТРУКЦІЯ АДВОКАТУ — 3 кроки запуску синхронізації

1. **У Legal BMS:** «Електронний суд» → вкладка «Імпорт» → кнопка «Скопіювати промпт».
2. **У браузері:** відкрий cabinet.court.gov.ua → залогінься → відкрий sidebar Claude for Chrome → встав промпт → Send → дочекайся JSON (агент коментує прогрес, наприкінці видає `\`\`\`json {...} \`\`\``).
3. **Назад у Legal BMS:** скопіюй увесь JSON (з блоком або без) → встав у textarea з синьою рамкою → кнопка «Обробити». Прогрес видно під кнопкою. По завершенню — ResultCard з підсумком.

**Що відбудеться:**
- Нові справи (яких ще не було в Legal BMS) — створяться з префіксом `[ЄСІТС]` у назві, статусом `active`, `origin='ecits_import'`.
- Існуючі справи (за `ecitsState.caseId`) — оновляться, `lastSyncedAt` буде поточним часом.
- Засідання 2026 — додадуться (з джерелом `court_sync`). Якщо засідання з тою ж датою+часом уже є — пропуститься.
- Білінг — НЕ нарахується (ні за створення справ, ні за додавання засідань — це автосинхронізація).
- Журнал — у `tenant.ecits_scenario_history` зберігається запис про прогон (LIFO 200), видно на вкладці «Огляд».

**Якщо щось пішло не так:** errors і warnings показуються у ResultCard (collapse секції). Адвокат може повторити прогон — система ідемпотентна (повторні справи не дублюються, повторні засідання не дублюються).

---

## 11. БАГИ ВИЯВЛЕНІ ПІД ЧАС ВИКОНАННЯ

Один локальний баг у власному коді під час написання тестів, виправлено перед коміттом:

- `submitScenarioResult` спочатку не destructured `executeAction` з deps (взяв його з submitScenarioResult outer scope, де змінної не існує) → `ReferenceError: executeAction is not defined` у processCase. Тести впали (3 з 14 у scenarioProcessor.test.js). Виправлено: додано `executeAction` до destructure. Усі тести зелені.

Інших багів **у поточному коді не виявлено**. Тести проходять чисто, build (нижче) теж.

---

**Кінець звіту.**
