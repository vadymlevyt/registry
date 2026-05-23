# TASK 0.4 — Court Sync MVP: Імпорт справ і синхронізація засідань з ЄСІТС

**Дата:** 2026-05-16
**Тип:** перший продакшн-сценарій модуля «Електронний суд»
**Базується на:**
- TASK 0.3.5 (canonical schema v7)
- 5 підготовчих TASK'ів для DP v2 (v7→v8, actionsRegistry.js factory)
- `audit_before_task_0_4.md` (поточний стан системи)
- `extension_architecture_recommendations.md` (4 архітектурні точки)

**Час виконання:** 4-5 днів Claude Code

---

## PHILOSOPHY CHECK — обов'язкове перечитування перед стартом

Цей TASK виконується за **сімома принципами архітектури** проекту (`DEVELOPMENT_PHILOSOPHY.md`):

1. Принцип здорового організму — нове додає чіткості, не плутає
2. Принцип ембріона з повним ДНК — SaaS + Multi-user + Billing закладено одразу
3. Правило #11 — одне ім'я = один сенс
4. Золота середина (Аристотель) — потрібно і достатньо, YAGNI
5. Додавати, не переписувати — нові розділи як глави в книзі
6. Provider pattern (планка Пікатіні) — фасад з провайдерами
7. Принцип паралельної розробки — не блокувати інші модулі (DP v2 продовжується)

---

## ЕКСПЕРТНА АВТОНОМІЯ

Ти бачиш код напряму, я (адмін-чат) бачу його тільки через звіти. Якщо при виконанні помічаєш що:

- Запропонований підхід можна зробити краще (інша структура файлів, кращі імена, чистіша інтеграція з існуючим патерном з 5 DP v2 TASK'ів)
- Є нюанс якого я не врахував (додаткові місця використання source, додаткові edge cases у промпті, нові поля які з'явилися після аудиту)
- Можна одночасно закрити дрібну дотичну проблему майже без додаткових зусиль (але тільки якщо це органічно у scope — не розповзайся)
- Назви функцій/файлів/полів не найкращі — запропонуй кращі
- Архітектурне рішення з `extension_architecture_recommendations.md` не оптимальне для поточного коду — застосуй краще, фіксуй у звіті

Все це **роби**, не питай. Фіксуй у звіті в розділі «Побічні знахідки та покращення». Це не порушення scope — це експертне виконання плану з оглядкою на реальний код.

Якщо знайдеш семантичне зіткнення (порушення правила #11) у поточному коді що зачіпає Court Sync — окремий розділ звіту «Семантичні ризики». НЕ виправляй (окремий cleanup TASK), але **зафіксуй**.

---

## КОНТЕКСТ

Перша жива інтеграція з ЄСІТС-кабінетом через Claude for Chrome. Canonical schema (v7→v8) готова приймати ЄСІТС-дані. `actionsRegistry.js` як factory pattern (TASK 5 DP v2) забезпечує чисту реєстрацію нових ACTIONS.

Цей TASK реалізує **мінімальний робочий MVP**:

1. Адвокат у Legal BMS → «Електронний суд» → «Імпорт» → копіює промпт
2. Вставляє в Claude for Chrome (sidebar браузера), тисне Send
3. Claude обходить кабінет, фільтрує справи за **роком у номері справи** (25 або 26), витягує засідання 2026 року
4. Повертає JSON у чат
5. Адвокат копіює JSON, вставляє у textarea в Legal BMS, тисне «Обробити»
6. Legal BMS створює нові справи (з префіксом `[ЄСІТС]`, `origin='ecits_import'`), додає засідання
7. Показує підсумок

Паралельно — закладається **повний ембріон** для майбутнього власного Chrome extension Legal BMS (Track B розробки). 4 архітектурні точки з extension_architecture_recommendations.md.

### Чого НЕ робимо у MVP

- НЕ співставляємо з тестовими справами (паралельне існування — у future_scenarios)
- НЕ робимо алгоритм матчингу за ознаками
- НЕ робимо ручне об'єднання (merge_cases)
- НЕ робимо dismissedMatches, syncDisabled, soft delete
- НЕ синхронізуємо документи з ЄСІТС (чекає на DP v2)
- НЕ парсимо склад суду, сторони, картки руху
- НЕ автоматизуємо передачу JSON (copy-paste у MVP)

Усе це → `future_scenarios_court_sync.md`.

---

## SEMANTIC CLARITY CHECK

| Новий концепт | Сенс | Конфлікти? |
|---|---|---|
| `case.origin` enum | Канал створення справи (`'manual'`, `'ecits_import'`) | НІ. Аналог `document.source` на рівні справи. |
| Префікс `[ЄСІТС]` у назві | Візуальний маркер походження | НІ. Тимчасова мітка. |
| Модуль "Електронний суд" UI | Точка входу синхронізації | НІ. Окрема навігація. |
| Сторінка `#/court-sync/import` | URL для майбутнього extension target | НІ. Нова hash-route інфраструктура. |
| `window.LegalBMS` global API | Контракт з майбутнім розширенням | НІ. Глобальний bridge. |
| `tenant.subscription.entitlements` | Майбутні tariff matrix дозволи | НІ. Поряд з legacy `features` (deprecated). |
| `ecitsExecutionService` фасад | Provider pattern для синхронізації | НІ. Аналог `ocrService.js`. |
| `tenant.ecits_scenario_history[]` | Журнал виконань сценаріїв | НІ. Аналог `recon_history[]`. |

Жодних зіткнень. **Транспорт ≠ source ≠ білінг:**
- `source: 'court_sync'` завжди для ЄСІТС-даних (незалежно від UI чи extension)
- `transport: 'manual_paste' | 'extension'` як окремі провенанс-метадані
- Білінг через source-aware гейт (R5 fix), а не через окрему гілку

---

## ВИПРАВЛЕННЯ З АУДИТУ

### R5 — Білінг неконтрольовано нараховуватиме hearing-ACTIONS (критично)

`add_hearing` і `update_hearing` НЕ входять у `EDIT_ACTIONS_SOURCE_AWARE` Set. Без R5 fix перша синхронізація забруднить весь білінг.

**Рішення:** додаємо обидва ACTIONS у `EDIT_ACTIONS_SOURCE_AWARE`. Існуюча логіка hook'а автоматично виключатиме виклики з `source: 'court_sync'`.

### R1 — `create_case` через `court_sync_agent` дає неповний шейп case

`ensureCaseSaasFields` додає лише SaaS v2/v3 поля. Нові ЄСІТС-справи матимуть `ecitsState: undefined`, `parties: undefined`. Споживачі (UI/дашборд) очікують канонічний дефолт.

**Рішення:** розширюємо `ensureCaseSaasFields` v7-полями. Це завершення TASK 0.3.5 яке пропустилось.

### R2 — schemaVersion drift v8 vs CLAUDE.md v7

CLAUDE.md оновлюється в межах TASK 0.4 з відображенням реального стану + Court Sync MVP розділ.

### Інші ризики (R3, R4, R6, R7) — у `tracking_debt.md` або не блокують

- R3 (`documentSchema.js` суперечливий docstring) → косметика
- R4 (`client`/`judges` backfill) → не зачіпаємо
- R6 (`labelForVersion()` без v8/v9) → виправляємо разом з bump v8→v9
- R7 (`ecitsCabinetIdentifier` всюди null) → MVP single-user

---

## SCHEMA BUMP v8 → v9

**Причина:** додаємо `case.origin` enum.

- `CURRENT_SCHEMA_VERSION = 9`
- `MIGRATION_VERSION = '9.0_case_origin'`
- `labelForVersion()` — додаємо гілки v7, v8, v9
- Створюється `migrateToVersion9(registry)`
- Всі існуючі справи отримують `origin: 'manual'`
- Backup pre_v9 на Drive (`registry_data_backup_pre_v9_<timestamp>.json`)
- localStorage flag `levytskyi_pre_v9_backup_done`

**`case.origin` enum:**
```js
case.origin: {
  type: 'string',
  enum: ['manual', 'ecits_import', 'telegram_import', 'email_import'],
  default: 'manual',
  description: 'Канал створення справи в Legal BMS. manual = адвокат вручну через UI/QI. ecits_import = автоімпорт з ЄСІТС через Court Sync.'
}
```

---

## АРХІТЕКТУРНІ ЗАКЛАДКИ ДЛЯ РОЗШИРЕННЯ (4 ТОЧКИ)

### Закладка 1 — `extensionBridge.js` за патерном activityTracker

**Файл:** `src/services/extensionBridge.js`

Module-scoped мутабельні референси (як `activityTracker`). Працює до hydration.

```js
let _enabled = false;
let _deps = null;
let _readyResolvers = [];
let _readyPromise = new Promise(resolve => {
  _readyResolvers.push(resolve);
});

const API_LEVEL = 1;
const VERSION = '1.0.0';

export function configure(deps) {
  _deps = deps;
}

export function enable() {
  if (_enabled) return;
  _enabled = true;

  if (typeof window !== 'undefined') {
    window.LegalBMS = {
      apiLevel: API_LEVEL,
      version: VERSION,
      isReady: true,
      whenReady: () => _readyPromise,

      submitScenarioResult: async (envelope) => {
        if (!_deps) throw new Error('LegalBMS not configured');
        return _deps.submitScenarioResult(envelope, { transport: 'extension' });
      },

      on: (event, handler) => {
        if (!_deps) throw new Error('LegalBMS not configured');
        return _deps.eventBus.subscribe(event, handler);
      },

      getEntitlements: () => {
        if (!_deps) throw new Error('LegalBMS not configured');
        return _deps.getEntitlementsForExtension();
      }
      // registerExtension — НЕ закладаємо у MVP (YAGNI, tracking_debt)
    };

    document.dispatchEvent(new CustomEvent('legalbms:ready', {
      detail: { apiLevel: API_LEVEL, version: VERSION }
    }));
  }

  _readyResolvers.forEach(resolve => resolve());
  _readyResolvers = [];
}

export function isEnabled() {
  return _enabled;
}
```

**Інтеграція в App.jsx:**
- `configure(deps)` викликається на кожному рендері з актуальними `executeAction`, `eventBus`, `getEntitlementsForExtension`
- `enable()` викликається **ОДИН раз ПІСЛЯ hydration з Drive** (не при монтуванні!). Інакше перші виклики розширення перетруться EFFECT-A.

### Закладка 2 — `hashRouter.js`

**Файл:** `src/services/hashRouter.js`

Мінімальний hash-router без зовнішніх пакетів. Граматика `#/<module>[/<entityId>][/<view>]`. Ігнорує хеші без префіксу `#/`.

Реалізація вже описана адмін-чатом. Підтабів Court Sync:
- `#/court-sync` → Огляд
- `#/court-sync/import` → Імпорт (target для extension)
- `#/court-sync/settings` → Налаштування

DP v2 і інші модулі додають свої записи через `registerRoute()` без переписування.

### Закладка 3 — `tenant.subscription.entitlements` ПОРЯД з `features`

`features: ['all']` — dead code, залишаємо, помічаємо як deprecated.

Додаємо `entitlements` структуру через `ensureEntitlements` у `migrateTenant`:

```js
tenant.subscription.entitlements = {
  ecits: {
    enabled: true,
    scenarios: { import_cases_and_hearings: true },
    trialMode: false,
    expiresAt: null,
    remainingUsages: null
  },
  documents: { enabled: true },
  canvas: { enabled: true }
};
```

Сервіс `entitlementsService.js` з функціями:
- `canUseModule(tenant, moduleId, scenarioId)` → `{ allowed, reason }`
- `getForExtension(tenant)` — спрощений шейп для handshake

`TARIFF_MATRIX` — окремий файл `src/services/tariffMatrix.js` зараз з планом `self_hosted`. Майбутні плани додаються рядками.

### Закладка 4 — `scenarioProcessor.js` через DI

**Файл:** `src/services/ecits/scenarioProcessor.js`

Спільна функція для UI («Обробити») і для майбутнього розширення. Через dependency injection бо `executeAction` живе у render closure factory `createActions(deps)`.

```js
export async function submitScenarioResult(envelope, deps) {
  const { executeAction, agentId = 'court_sync_agent', transport = 'manual_paste' } = deps;

  validateEnvelope(envelope);

  const scenarioRunId = `scn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  logScenarioStart(scenarioRunId, envelope, transport);

  const result = { casesCreated: 0, casesUpdated: 0, hearingsAdded: 0, skipped: 0, errors: [], warnings: envelope.data.warnings || [] };

  try {
    for (const ecitsCase of envelope.data.cases) {
      try {
        await processCase(ecitsCase, result, executeAction, agentId);
      } catch (err) {
        result.errors.push({ case_no: ecitsCase.case_no, message: err.message });
      }
    }
    logScenarioComplete(scenarioRunId, result, transport);
  } catch (err) {
    logScenarioFailed(scenarioRunId, err.message, transport);
    throw err;
  }

  return result;
}
```

**Логіка `processCase`:**
- Дедуплікація через `ecitsState.caseId` (шукаємо існуючу справу)
- Якщо існує → `update_case_ecits_state` + `add_hearing` для нових засідань
- Якщо нова → `create_case` з `origin: 'ecits_import'`, повним `ecitsState`, потім `add_hearing` для кожного засідання
- Кожен `add_hearing` приймає `source: 'court_sync'`, `ecitsContext` з proceedingNumber/cabinetUrl/noticeType

### Журнал виконань `tenant.ecits_scenario_history[]`

LIFO cap 200 записів. Дзеркало `recon_history`. БЕЗ schema bump.

```js
{
  scenarioRunId, scenarioId, scenarioVersion,
  transport,           // 'manual_paste' | 'extension'
  startedAt, completedAt,
  status,              // 'completed' | 'failed'
  tenantId, userId,
  result,              // { casesCreated, casesUpdated, hearingsAdded, skipped }
  errors
}
```

НЕ дублює `time_entries`, `ai_usage`, `auditLog`. Окремий потік провенансу для високого рівня.

---

## ACTIONS — розширення і виправлення

### `create_case` — розширюється опційними параметрами

```js
create_case({
  // Існуючі:
  name, case_no, court, category, status,
  // NEW v9 (опційні):
  origin, ecitsState, parties, processParticipants
})
```

Логіка handler'а:
- Дедуплікація через `params.ecitsState?.caseId` (якщо передано і вже існує → `{ success: false, existingCaseId }`)
- Стандартне створення через `ensureCaseSaasAndEcitsFields` з усіма дефолтами
- `origin` default `'manual'`

### PERMISSIONS — `court_sync_agent` отримує `create_case`

```js
PERMISSIONS.court_sync_agent = [
  'create_case',                    // NEW
  'add_hearing',
  'update_hearing',
  'mark_synced_from_ecits',
  'update_case_ecits_state',
  // (та інші з TASK 0.3.5)
];
```

### `EDIT_ACTIONS_SOURCE_AWARE` — R5 fix

```js
EDIT_ACTIONS_SOURCE_AWARE = new Set([
  // (існуючі з TASK 0.3.5)
  // NEW:
  'add_hearing',
  'update_hearing'
]);
```

### Виключення `create_case` з білінгу коли `origin: 'ecits_import'`

У activityTracker-hook:
```js
if (action === 'create_case' && params.origin === 'ecits_import') {
  return;  // НЕ нараховуємо
}
```

---

## ECITS_NEVER_TOUCH — безпекові межі

**Файл:** `src/services/ecits/safety.js`

```js
export const ECITS_NEVER_TOUCH = [
  'НАДАТИ ЗГОДУ', 'ОСКАРЖИТИ', 'СТВОРИТИ ЗАЯВУ', 'ВІДКЛАСТИ',
  'ВИДАЛИТИ', 'ВИДАЛИТИ ВСЕ', 'НАДІСЛАТИ', 'ПІДТВЕРДИТИ',
  'СПЛАТИТИ', 'ЗБЕРЕГТИ', 'ЗМІНИТИ'
];

export const ECITS_NEVER_DO = [
  'javascript_tool без явного дозволу',
  'створення Google Documents',
  'доступ до файлової системи поза браузером',
  'OAuth токени Drive API',
  'посилання за межі cabinet.court.gov.ua',
  'скачування файлів у MVP',
  'натискання посилань на папки з ключем КЕП'
];

export function buildSafetyBlock() {
  return `КАТЕГОРИЧНО НЕ НАТИСКАЙ:
${ECITS_NEVER_TOUCH.map(k => `- ${k}`).join('\n')}

КАТЕГОРИЧНО НЕ РОБИ:
${ECITS_NEVER_DO.map(d => `- ${d}`).join('\n')}

ПРИ БЛОКУВАННІ: доповідай, не шукай обхідні шляхи.`;
}
```

---

## ПРОМПТ ДЛЯ CLAUDE FOR CHROME

**Файл:** `src/services/ecits/promptBuilder.js`

Ключові частини промпту:

### Фільтр справ — за роком у номері справи

Номер справи має формат `NNN/NNNNN/NN-X` (наприклад `450/2275/25`). Цифри після ДРУГОГО слешу = РІК справи.

```
- 450/2275/25 → рік 25 → беремо
- 359/12899/25 → рік 25 → беремо
- 367/4744/26 → рік 26 → беремо
- 761/15469/20-ц → рік 20 → ПРОПУСКАЄМО
- 570/3101/24 → рік 24 → ПРОПУСКАЄМО
```

Беремо ТІЛЬКИ справи де рік 25 або 26.

### Логіка пошуку засідань

```
Зайди у справу, дивись хронологію документів (документи від суду).
Йди по хронології ВПЕРЕД. Для кожного документа про засідання
(повістка, внесення дат слухання):
- Витягни дату засідання, час, зал, провадження
- Якщо ця дата 2026 року УЖЕ зустрічалась → ПРОПУСТИ (дублікат повістки)
- Якщо нова → додай у список

ПРИКЛАД:
- Документ #1: повістка на 1 квітня → додай
- Документ #2: повістка на 1 квітня → пропусти (вже є)
- Документ #3: повістка на 7 квітня → додай
- Документ #4: повістка на 7 квітня → пропусти (вже є)

БЕРИ ТІЛЬКИ засідання за 2026 рік. Минулі і майбутні в межах року.
Засідання інших років — пропусти.
```

### Витягнуті поля справи

- `ecitsCaseId` — 32-hex з URL `/cases/case=...`
- `case_no` — з заголовка
- `court` — повна назва суду
- `category` — за літерою після слешу (ц=civil, к=criminal, а=administrative, г/м=civil)
- `advocateRole` — "представник позивача/відповідача/третьої особи" або "захисник"
- `primaryParty` — основна сторона за роллю адвоката, формат "Прізвище І.П." (для юросіб — повна назва)
- `cabinetUrl` — посилання назад на справу в кабінеті

### Витягнуті поля засідання

- `date`, `time`, `court`, `hearingRoom`
- `proceedingNumber`
- `cabinetUrl` — посилання на повістку
- `noticeType` — тип документа звідки витягли дату

### Структура envelope

```json
{
  "envelopeVersion": 1,
  "scenarioId": "ecits_import_cases_and_hearings",
  "scenarioVersion": 1,
  "producedAt": "ISO-datetime",
  "producedBy": {
    "provider": "claude_for_chrome",
    "providerVersion": "sonnet-4.6"
  },
  "data": {
    "ecitsAdvocate": { "fullName": "...", "cabinetIdentifier": "..." },
    "stats": { "totalCasesInCabinet": N, "filtered": M, "withHearings2026": K },
    "cases": [
      {
        "ecitsCaseId": "32-hex",
        "case_no": "450/2275/25",
        "court": "...",
        "category": "civil|criminal|administrative",
        "advocateRole": "plaintiff_rep|defendant_rep|...",
        "primaryParty": "Бабенко О.І.",
        "primaryPartyFullName": "Бабенко Олена Іванівна",
        "cabinetUrl": "...",
        "hearings": [
          {
            "date": "2026-05-25",
            "time": "08:50",
            "court": "...",
            "hearingRoom": "336",
            "proceedingNumber": "6-392/26",
            "cabinetUrl": "...",
            "noticeType": "Судова повістка про виклик в суд"
          }
        ]
      }
    ],
    "warnings": [],
    "skipped": [{ "case_no": "...", "reason": "..." }]
  }
}
```

---

## UI — Модуль «Електронний суд»

Базується на існуючій структурі `src/components/CourtSync/`.

### Вкладка "Імпорт"

Три кроки:
1. Кнопка «📋 Скопіювати промпт» → clipboard API
2. Інструкція "Відкрийте Claude for Chrome, вставте промпт, дочекайтесь результату"
3. Textarea для JSON (помітна синя рамка, мінімум 300px висота) + кнопка «Обробити»

При натисканні «Обробити»:
- Парсинг envelope
- Виклик `scenarioProcessor.submitScenarioResult(envelope, { executeAction, agentId, transport: 'manual_paste', onProgress })`
- Progress indicator під час обробки
- ResultCard з підсумком (created, updated, hearings, errors)
- Кнопки "Перейти до реєстру" / "Відкрити календар"

### Вкладка "Огляд"

Базова статистика з `tenant.ecits_scenario_history`:
- Синхронізовано справ всього
- Остання синхронізація
- Кнопка "Імпортувати з ЄСІТС" → переходить на вкладку Імпорт

### Вкладка "Налаштування"

Мінімум:
- Поле `ecitsCabinetIdentifier` (РНОКПП або email для multi-user майбутнього)

---

## ACCEPTANCE CRITERIA

### Schema
- [ ] `CURRENT_SCHEMA_VERSION = 9`, `MIGRATION_VERSION = '9.0_case_origin'`
- [ ] `migrateToVersion9` з міграцією existing → `origin: 'manual'`
- [ ] `case.origin` enum в схемі
- [ ] `labelForVersion()` з гілками v7, v8, v9
- [ ] Backup `pre_v9` працює
- [ ] `ensureCaseSaasAndEcitsFields` додає v7+v9 поля з дефолтами

### ACTIONS
- [ ] `court_sync_agent` отримав `create_case` у PERMISSIONS
- [ ] `create_case` приймає `origin`, `ecitsState`, `parties`, `processParticipants`
- [ ] `create_case` дедуплікує через `ecitsState.caseId`
- [ ] `add_hearing` і `update_hearing` у `EDIT_ACTIONS_SOURCE_AWARE` (R5 fix)
- [ ] `create_case` з `origin: 'ecits_import'` виключено з білінгу

### Архітектурні закладки розширення
- [ ] `src/services/extensionBridge.js` створено
- [ ] `window.LegalBMS` API публікується після hydration
- [ ] DOM event 'legalbms:ready' емітиться
- [ ] `src/services/hashRouter.js` створено
- [ ] Court Sync реєструє роут `court-sync`
- [ ] `tenant.subscription.entitlements` додається через `ensureEntitlements`
- [ ] `src/services/entitlementsService.js` створено
- [ ] `src/services/tariffMatrix.js` створено з планом `self_hosted`
- [ ] Legacy `features: ['all']` НЕ зачіпається

### Court Sync функціонал
- [ ] `src/services/ecits/safety.js` з ECITS_NEVER_TOUCH
- [ ] `src/services/ecits/promptBuilder.js` з фільтром за роком у case_no
- [ ] `src/services/ecits/scenarioProcessor.js` з DI
- [ ] `tenant.ecits_scenario_history[]` журнал LIFO cap 200
- [ ] UI модуля Court Sync з 3 вкладками
- [ ] Кнопка "Скопіювати промпт" → clipboard
- [ ] Textarea з синьою рамкою
- [ ] Кнопка "Обробити" з progress indicator
- [ ] ResultCard з підсумком
- [ ] Hash-route `#/court-sync/import` працює

### Тести
- [ ] `tests/unit/scenarioProcessor.test.js` — ~15 тестів
- [ ] `tests/unit/promptBuilder.test.js` — ~8 тестів
- [ ] `tests/unit/extensionBridge.test.js` — ~10 тестів
- [ ] `tests/unit/hashRouter.test.js` — ~8 тестів
- [ ] `tests/unit/entitlementsService.test.js` — ~10 тестів
- [ ] `tests/integration/court-sync-mvp.test.js` — повний flow
- [ ] `_actionsHarness.js` оновлено
- [ ] Усі попередні тести зелені

### Documentation
- [ ] CLAUDE.md оновлено — schemaVersion 9, новий розділ Court Sync MVP
- [ ] tracking_debt.md оновлено — `features` deprecation, `registerExtension` майбутнє

### Build і Deployment
- [ ] Vite build success без нових warnings
- [ ] Git commit + push виконано

---

## ЩО НЕ РОБИТИ

- НЕ синхронізувати документи з ЄСІТС (DP v2 не готовий)
- НЕ парсити склад суду, сторони, картки руху (TASK 0.6)
- НЕ робити алгоритм матчингу (future_scenarios)
- НЕ робити merge_cases (future_scenarios)
- НЕ робити dismissedMatches, syncDisabled (future_scenarios)
- НЕ робити автоматичну передачу даних з Claude for Chrome
- НЕ міняти legacy `features` поле
- НЕ реалізовувати `registerExtension` API (YAGNI)
- НЕ переписувати DP v2 — додаємо поряд

---

## SAAS IMPLICATIONS

- `tenant.subscription.entitlements.ecits` — окремий тариф per-tenant у майбутньому
- `tenant.ecits_scenario_history[]` — окремий журнал per-tenant
- Всі ACTIONS отримують tenantId стандартним патерном
- eventBus події з tenantId у payload

Майбутні тарифи додаються в `tariffMatrix.js`:
- `free` (trial Court Sync 14 днів)
- `basic` (без Court Sync)
- `professional` (повний)
- `enterprise`

---

## MULTI-USER IMPLICATIONS

- `case.ecitsState.lastSyncedBy` — userId (заповнюється коли multi-user активний)
- `user.ecitsCabinetIdentifier` — у MVP single-user, заповнюється при необхідності
- Multi-source dedupe через `ecitsCaseId` — однаковий незалежно через чий кабінет
- `document.ecitsSource.receivedThroughCabinet` / `receivedAlsoThroughCabinet[]` — структури готові

---

## BILLING IMPLICATIONS

**R5 fix:**
- `add_hearing` + `update_hearing` в `EDIT_ACTIONS_SOURCE_AWARE`
- Виклики з `source: 'court_sync'` НЕ нараховуються
- Виклики з `source: 'manual'` нараховуються нормально

**`create_case` з `origin: 'ecits_import'`:**
- НЕ нараховується (додаткова перевірка у hook'у)

**Принцип:** "Транспорт ≠ source ≠ білінг". Все що приходить з ЄСІТС → автоматично не нараховується. Один прапорець, існуючий механізм.

`tenant.ecits_scenario_history` — окремий журнал високого рівня, не дублює `time_entries`.

---

## AI USAGE IMPLICATIONS

Цей TASK НЕ викликає AI-моделей через наш API. Claude for Chrome — окрема Max-підписка адвоката, окремий продукт Anthropic.

`ai_usage[]` НЕ пишеться для Court Sync операцій через Claude for Chrome.

Майбутнє: коли власне розширення матиме внутрішні AI-операції (інтерпретація складних повідомлень), `ai_usage` буде писатись через стандартний механізм.

---

## ЗВІТ ПІСЛЯ ВИКОНАННЯ

Створи `report_task_0_4_court_sync_mvp.md`:

1. РЕЗЮМЕ — статус, час, метрики тестів
2. ЗМІНЕНІ/СТВОРЕНІ ФАЙЛИ — повний список
3. АРХІТЕКТУРНІ ЗАКЛАДКИ — підтвердження 4 точок
4. MIGRATION REPORT — console.log виводу v8 → v9
5. R5 FIX ПЕРЕВІРКА — hearing-ACTIONS не нараховуються при source='court_sync'
6. ACCEPTANCE CRITERIA — чек-лист з ✅
7. ТЕСТИ — кількість, npm test output
8. ПОБІЧНІ ЗНАХІДКИ ТА ПОКРАЩЕННЯ — все що зловив за принципом ЕКСПЕРТНОЇ АВТОНОМІЇ
9. СЕМАНТИЧНІ РИЗИКИ — якщо знайдено зіткнення
10. ІНСТРУКЦІЯ АДВОКАТУ — 3 кроки запуску синхронізації
11. БАГИ ВИЯВЛЕНІ — окремий bugs_found_during_task_0_4.md якщо є

---

## ПІСЛЯ COMMIT І PUSH

```bash
git add -A
git commit -m "TASK 0.4: Court Sync MVP — import cases and sync hearings from ECITS

- Schema v8 → v9 with case.origin enum
- court_sync_agent gets create_case permission
- R5 fix: add_hearing/update_hearing in EDIT_ACTIONS_SOURCE_AWARE
- R1 fix: ensureCaseSaasAndEcitsFields includes v7+v9 defaults
- Extension architecture embryo: extensionBridge, hashRouter,
  entitlements, scenarioProcessor with DI
- ECITS_NEVER_TOUCH safety constants
- Court Sync UI with import tab"
git push origin main
```

---

**Кінець TASK 0.4.**

**Після виконання — перша жива інтеграція з ЄСІТС. Архітектура готова до Track B (власне розширення) без переписування.**
