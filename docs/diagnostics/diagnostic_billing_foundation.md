# Діагностика перед TASK Billing Foundation v2

**Дата:** 2026-05-05
**TASK:** Billing Foundation v2 — Internal Time Tracking Infrastructure
**Статус:** ⏸ ОЧІКУЄ ЗГОДИ АДВОКАТА — впровадження не починалось.

Перед запуском Фази 1 потрібен явний дозвіл («продовжуй»). Цей документ підтверджує готовність системи і фіксує план роботи.

---

## 1. Стан системи після SaaS Foundation v1.1

### schemaVersion і ключові константи

| Константа | Значення | Файл:рядок |
|---|---|---|
| `CURRENT_SCHEMA_VERSION` | `3` | `src/services/migrationService.js:27` |
| `MIGRATION_VERSION` | `'3.0_patch_and_extension'` | `src/services/migrationService.js:28` |

✅ Обидва відповідають вимогам v1.1.

### Сервіси SaaS Foundation — присутні

| Файл | Розмір | Статус |
|---|---|---|
| `src/services/aiUsageService.js` | 5 119 байт | ✅ повний — pricing, calculateCost, logAiUsage, logAiUsageViaSink, аналітичні хелпери |
| `src/services/modelResolver.js` | 1 665 байт | ✅ SYSTEM_DEFAULTS (9 типів агентів), resolveModel з ієрархією user→tenant→system |
| `src/services/subscriptionService.js` | 2 544 байт | ✅ recalculateCurrent, checkLimits |
| `src/services/permissionService.js` | 2 310 байт | ✅ заглушки активовані (тенант/case access реальні) |
| `src/services/auditLogService.js` | 2 255 байт | ✅ AUDIT_ACTIONS = 6 критичних дій |
| `src/services/tenantService.js` | 3 825 байт | ✅ DEFAULT_TENANT з storage/modelPreferences/subscription |
| `src/services/migrationService.js` | 10 048 байт | ✅ ROLE_PERMISSION_DEFAULTS, normalizeCaseId, normalizeDocumentIds |

### Структури в `buildEmptyRegistry()` (`migrationService.js:149-161`)

```
schemaVersion: 3
settingsVersion: '3.0_patch_and_extension'
tenants: [DEFAULT_TENANT]
users: [DEFAULT_USER]
auditLog: []
structuralUnits: []
ai_usage: []         ← v1.1
caseAccess: []        ← v1.1 (заглушка)
cases: []
```

### `tenant` (DEFAULT_TENANT, `tenantService.js:18-92`) — поля v1.1 присутні

- `storage: { provider: 'drive_legacy', quotaGB: null, usedBytes: null }` ✅
- `modelPreferences: { dossierAgent: null, qiAgent: null, ... 9 агентів }` ✅
- `subscription.limits: { aiTokensPerMonth, aiCostPerMonth, storageGB, teamMembers, casesActive }` (всі null) ✅
- `subscription.current: { periodStart, periodEnd, tokensUsed=0, costUsedUSD=0, storageUsedGB=0, teamMembersCount=1, casesActiveCount=0 }` ✅
- `subscription.alerts: { warnAt: 80, blockAt: 100 }` ✅

### `case.team[i].permissions` (migrationService.js:31-37)

ROLE_PERMISSION_DEFAULTS зашиті для 5 ролей: `owner`, `lead`, `co-lead`, `support`, `external`. Кожна має 7 полів дозволів включно з `canRunAI`. ✅

### `case.id` — нормалізовано до string

`migrateCase` → `normalizeCaseId` перетворює number → `case_<n>`. INITIAL_CASES (`App.jsx:85-125`) уже містить `case_1`..`case_20` як string. Документи всередині `case_4` (Брановський) — string id (`"1"`..`"12"`). ✅

### Виправлений архітектурний борг

| Пункт | Стан | Доказ |
|---|---|---|
| `driveService.writeCases` видалено | ✅ | `grep writeCases src/services/driveService.js` — лише `readCases` |
| `levytskyi_action_log` cleanup | ✅ | `App.jsx:3581-3602` — одноразовий бекап + видалення з прапором `levytskyi_action_log_cleaned_v1_1` |
| `agentHistory` slice -50 | ✅ | `CaseDossier/index.jsx:535,542,1295,1316,1325` — всюди `.slice(-50)` |

✅ **Всі вимоги SaaS v1.1 виконані. Можна стартувати Billing Foundation v2.**

---

## 2. `levytskyi_timelog` — старий механізм обліку часу

### Місцезнаходження в коді

- **State:** `App.jsx:3391-3396` — `useState(() => JSON.parse(localStorage.getItem('levytskyi_timelog') || '[]'))`
- **Persistence:** `App.jsx:3692-3695` — `useEffect` пише в localStorage при кожній зміні `timeLog`
- **Cleanup:** `src/main.jsx:9` — ключ у списку `clearAllLocalData()` ErrorBoundary
- **Запис:** `App.jsx:4327-4341` — `ACTIONS.add_time_entry` створює запис

### Структура запису (з `add_time_entry`)

```js
{
  id: 'tl_<timestamp>',
  userId: 'vadym',
  caseId: <case_id>|null,
  date: <YYYY-MM-DD>,
  duration: <minutes>,
  description: <text>,
  type: 'billable',           // дефолт
  source: 'manual',           // дефолт
  createdAt: <ISO>
}
```

### Стан зберігання

⚠️ **Тільки localStorage** — НЕ синхронізується з Drive і НЕ зберігається в registry_data.json. Тобто:
- Нові записи виникають коли агент виконує `add_time_entry`.
- При зміні пристрою/чищенні локального кешу — дані втрачаються.

### Q1 — питання до адвоката

> Чи є реальні записи в `levytskyi_timelog` (відкрити консоль браузера → `localStorage.getItem('levytskyi_timelog')`)?
>
> Якщо так — план міграції:
> - Імпортувати їх у новий `time_entries[]` (top-level в registry_data.json) при першому запуску v4.
> - Поля мапляться 1:1 + додаються `tenantId`, `category`, `billable`, `visibleToClient`, `module='legacy'`.
> - Старий `setTimeLog`/`localStorage.setItem('levytskyi_timelog')` зберігаємо як deprecated alias до видалення в наступному TASK.
>
> Якщо ні — просто видаляємо старий стан і ключ після створення `time_entries[]`.

---

## 3. `case.timeLog[]` — вкладений масив у справах

### Стан коду

- **Дефолт:** `normalizeCases` (`App.jsx:3270-3272`) додає `timeLog: []` якщо немає.
- **Міграція:** `migrationService.js:118-124` гарантує `createdBy` для існуючих записів.
- **Створення:** `case_4` в INITIAL_CASES створюється з полями proceedings/documents, але **БЕЗ** `timeLog` явно — нормалізується до `[]` через `normalizeCases`.
- **Запис:** ніде в коді не пишемо в `case.timeLog[]` — тільки в top-level `timeLog`. Тобто фактично завжди порожній.

### Q2 — питання до адвоката

> На Drive в `registry_data.json` `cases[i].timeLog[]` практично завжди порожній. План:
>
> a) **Не мігрувати** з `case.timeLog[]` (бо порожній). Поле залишається в normalize як `[]` для зворотної сумісності, але **deprecated** з v4. У TASK можна це окремо документувати.
>
> b) Якщо хоча б одна справа має записи в `case.timeLog[]` — мігрувати в top-level `time_entries[]` з зеркаленням `caseId`.
>
> Підтвердити (a) чи (b) перед стартом Фази 1.

---

## 4. Структура `hearings` — точки інтеграції автоматичного обліку (Теза 10)

### Поточні поля (з `mkHearing` `App.jsx:80-83`)

```js
{
  id: 'hrg_<ts>_<rand>',
  date: 'YYYY-MM-DD',
  time: 'HH:MM',           // дефолт '10:00'
  court: <string>,
  notes: <string>,
  status: 'scheduled'      // ('scheduled' | 'completed' | ...)
}
```

### Розширені поля з `ACTIONS.add_hearing` (`App.jsx:4144-4153`)

```js
{ ...minimum,
  duration: 120,           // хвилин — є дефолт 120
  type: <string>|null
}
```

### ❌ ВІДСУТНЄ для Тези 10

| Поле | Стан | План |
|---|---|---|
| `travelToMinutes` | НЕМАЄ | TASK Travel Time Fix (окремий, не в цьому TASK) |
| `travelFromMinutes` | НЕМАЄ | TASK Travel Time Fix |
| `status` варіанти `completed/postponed/cancelled` | Не використовуються | Активуються при роботі з ACTIONS.update_hearing — є `status` як параметр |
| Категорії причин відкладення | НЕМАЄ | Поза скоупом цього TASK |

### Висновок для Billing Foundation v2

- Автоматичний облік `hearing` буде використовувати:
  - `duration` із hearing (або дефолт 120 із `getTimeStandard('hearing_simple', { hearing })`)
  - **Стандарти часу**, а не реальні travelMinutes (бо їх немає до TASK Travel Time Fix)
- При завершенні `hearing.status='completed'` (через ACTIONS.update_hearing або новий хук) — генерується **3 time_entries**:
  1. `hearing_preparation` — за стандартом
  2. `travel` (туди + назад) — за стандартом за судом/містом
  3. `hearing_attendance` — `duration` hearing

### Q3 — питання до адвоката

> Зараз `hearing.status` майже не змінюється з `scheduled` на `completed/postponed`. Якщо запустимо автоматичний облік — потрібен момент тригера:
>
> a) **Кнопка «Засідання відбулось»** в Dashboard/CaseDossier — генерує time_entries для цього hearing.
>
> b) **Тиха автоматика по даті** — після hearing.date минув, статус автоматично `completed`, time_entries генеруються.
>
> c) **Тільки при ручному `update_hearing(status='completed')` через QI/чат**.
>
> У TASK закладено варіант (a)+(c). Підтверджуєш чи додаємо також (b)?

---

## 5. Інвентаризація точок інструментації

### Розміри файлів

| Файл | Рядки | hooks (useState/useEffect) |
|---|---|---|
| `src/App.jsx` | 4 715 | багато (включно з QI inline) |
| `src/components/Dashboard/index.jsx` | 2 684 | 35 |
| `src/components/CaseDossier/index.jsx` | 2 448 | 43 |
| `src/components/DocumentProcessor/index.jsx` | 1 143 | — |
| `src/components/Notebook/index.jsx` | 784 | — |

### Карта запланованих точок (фаза 2 TASK) — 25 точок

| Модуль | Точки | Опис |
|---|---|---|
| **Dashboard** | 5 | session start/end, hearing_viewed, drag_create, status_change, agent_message |
| **CaseDossier** | 6 | session start/end, tab_switched, document_viewed, agent_message, context_regenerated, deep_analysis |
| **QuickInput** (inline в App.jsx, `function QuickInput` line 1034) | 3 | document_uploaded, voice_input, action_executed |
| **Notebook** | 2 | note_created, note_edited |
| **DocumentProcessor** | 5 | batch_started, ocr_processed, split_proposed, split_confirmed, batch_completed |
| **App.jsx** | 4 (глобальні) | app_launched, module_navigation, case_created, case_closed |

✅ Точно 25 — як обіцяно в TASK.

### Хуки в `executeAction` (`App.jsx:4423`)

`executeAction` уже має 5 рівнів перевірок (allowlist → tenant → role → case → action). Додаємо 6-й крок: після успішного `result` викликаємо `activityTracker.report(action, params)` для значущих дій. Список значущих:

```
update_case_field, add_hearing, update_hearing, delete_hearing,
add_deadline, delete_deadline, add_note, pin_note, add_time_entry
```

Не значущі (не репортимо): `track_session_start/end` (бо вже мають свою логіку через activityTracker.startSession), і самі `_query` дії якщо будуть.

---

## 6. Розмір даних — оцінка реальна

### Поточний registry_data.json

З TASK: **~82 KB** (зараз). Це 20 справ × ~4 KB середньо + tenants/users/auditLog.

### Очікуваний приріст від time_entries

```
50-100 подій/день           × 30 днів = 1500-3000 записів/місяць
× 300-500 байт на запис    = 450 KB - 1.5 MB/місяць
```

### Місячна ротація — рятує

- На 1 число місяця активний `time_entries[]` тільки за поточний місяць.
- Архіви — окремі файли в `_archives/time_entries_YYYY-MM.json` на Drive.
- Реальний registry_data.json: **82 KB + 0.5-1.5 MB time_entries поточного місяця ≈ 1.5 MB**.

### Master timer — мізерний слід

`master_timer_state` — один об'єкт ~200 байт. Persistence кожні 60 секунд (не 1 секунду).

### Висновок

✅ Парсинг виживе. Drive sync — теж (1.5 MB файл — нормально). При перших ознаках росту >5 MB — переоцінюємо ротацію (тиждень замість місяця).

---

## 7. `ai_usage[]` — працює правильно

### 10 точок логування підтверджено

```
src/App.jsx:1314             → QI image parser (qi_agent, parse_document)
src/App.jsx:1440             → QI text parser (qi_agent, parse_document)
src/App.jsx:1706             → QI sendChat (qi_agent, chat)
src/components/Dashboard/index.jsx:1505           → dashboard_agent, chat
src/components/CaseDossier/index.jsx:860          → case_context_generator
src/components/CaseDossier/index.jsx:1305         → dossier_agent, chat
src/components/DocumentProcessor/index.jsx:238    → via Sink (document_parser, parse_document)
src/components/DocumentProcessor/index.jsx:429    → document_parser, chat
src/components/DocumentProcessor/index.jsx:580    → document_parser, chat
src/services/ocr/claudeVision.js:150              → via Sink (document_parser, parse_document)
```

✅ Всі 10 точок підтверджені.

### Інтеграція з `time_entries[]` (фаза 7 TASK)

Біля кожного `logAiUsage(...)` додаємо `activityTracker.report('agent_call', { caseId, module, agentType, duration: <session_duration_seconds>, category, billable })`.

⚠️ **Важливо:** не дублювати поля між структурами:
- `ai_usage[]` тримає **токени і вартість** (для оператора SaaS).
- `time_entries[]` тримає **тривалість і категорію часу** (для адвоката).

Дві різні задачі → дві паралельні структури.

---

## 8. Backup-стратегія

### Що вже існує (`src/services/driveService.js`)

| Функція | Рядки | Призначення | Лімит |
|---|---|---|---|
| `backupRegistryData` | 197-225 | Daily snapshot | 7 днів rolling |
| `backupRegistryDataPreSaas` | 140-156 | One-shot перед v2 | поза ротацією |
| `backupRegistryDataPreV3` | 159-175 | One-shot перед v3 | поза ротацією |
| `backupActionLogPreCleanup` | 178-193 | One-shot бекап legacy localStorage | поза ротацією |

### Додаємо в Billing Foundation v2

```js
// src/services/driveService.js (новий експорт)
export async function backupRegistryDataPreBilling(token, payload) {
  // Ім'я: registry_data_backup_pre_billing_<ts>.json
  // Шлях: _backups/ (поза 7-day ротацією)
}
```

Викликати в `App.jsx` один раз при першій v3 → v4 міграції з прапором `levytskyi_billing_backup_done_v4` в localStorage. Аналогічно `backupRegistryDataPreV3` (`App.jsx:3571`).

### Архіви time_entries — окрема папка

Не плутати з `_backups/`. Архіви місячної ротації:
- `_archives/time_entries_2026-04.json`
- `_archives/time_entries_2026-03.json`

Логіка створення `_archives` папки → новий хелпер у `driveService.js` за зразком `findOrCreateFolder('_backups', ...)`.

---

## 9. Питання до адвоката (зведено)

| # | Питання | Дефолт у TASK |
|---|---|---|
| **Q1** | Чи є реальні записи в `localStorage.levytskyi_timelog`? Імпортувати їх у `time_entries[]` чи проігнорувати? | Імпортувати якщо є, інакше тихо видалити старий ключ після першої v4 міграції. |
| **Q2** | Що робимо з `case.timeLog[]`? Залишаємо як deprecated порожнім чи мігруємо записи (якщо вони раптом є)? | Якщо порожній — deprecate, якщо є записи — мігрувати в top-level. |
| **Q3** | Тригер автоматичного обліку hearing: кнопка «Засідання відбулось» (a), тиха автоматика по даті (b), або тільки ручний (c)? | (a)+(c) у TASK. (b) — на твоє рішення. |
| **Q4** | Master timer — починати автоматично при старті системи (`autoStartMasterTimer: true` в user.preferences) чи лишити OFF за замовчуванням? | OFF за замовчуванням. UI дасть кнопку у Billing UI v1. |
| **Q5** | Categories для `category: 'admin'` (адміністративна робота, не billable). Що сюди потрапляє за замовчуванням? Чат з агентом dashboard? Перегляд календаря? | Чат dashboard → `case_work` якщо `caseId`, інакше `admin`. Перегляд календаря без дій → `admin`. |
| **Q6** | Idle Detection — 5 хвилин дефолт. Хочеш інше значення (3 хв? 10 хв?)? | 5 хв. Налаштовуємо в `user.preferences.idleTimeoutMinutes`. |

---

## 10. Адаптований план виконання — порядок з конкретними файлами

### Фаза 1 — базова інфраструктура (1 день)

**Створити:**
- `src/services/activityTracker.js` (центральна служба, ~250 рядків)
- `src/services/masterTimer.js` (state machine, ~150 рядків)
- `src/services/timeStandards.js` (~80 рядків)
- `src/services/timeEntriesArchiver.js` (заглушка, ~100 рядків)
- `src/services/timeEntriesQuery.js` (~150 рядків)

**Розширити:**
- `src/services/migrationService.js` — `migrateV3toV4`, `CURRENT_SCHEMA_VERSION = 4`, `MIGRATION_VERSION = '4.0_billing_foundation'`. Додати `time_entries: []`, `master_timer_state: {...}`, `billing_meta: {...}` у `buildEmptyRegistry()`.
- `src/services/tenantService.js` — `DEFAULT_TENANT.settings.timeStandards = {...}` (за замовчуванням з TASK).
- `src/services/driveService.js` — `backupRegistryDataPreBilling`, helper `findOrCreateFolder('_archives', ...)`.
- `src/App.jsx` — стейти `time_entries`, `masterTimerState`, `billingMeta`; persistence; `executeAction` хук на `activityTracker.report` після успішних дій; одноразовий backup `pre_billing` з прапором.

**Імпорт legacy timeLog** (за відповіддю Q1):
- При першому v3 → v4 запуску — якщо `localStorage.levytskyi_timelog` не порожній, прокидаємо записи в `time_entries[]` через `migrationService.importLegacyTimeLog()`. Прапор `levytskyi_timelog_imported_v4` в localStorage.

### Фаза 2 — інструментація (2 дні)

25 точок у 5 модулях + App.jsx. Один-два рядки на місце, обгорнуто в try/catch. Конкретні рядки — у TASK розділ Фаза 2.

### Фаза 3 — Master Timer (1 день)

Page Visibility + Idle Detection + cross-tab BroadcastChannel + persistence кожні 60 сек.

### Фаза 4 — стандарти + автоматичний hearing (1 день)

`getTimeStandard(activity, context)` з ієрархією user→tenant→system. Хуки `onHearingCreated/Completed/Postponed`.

### Фаза 5 — місячна ротація (1 день)

`shouldArchive`, `archivePreviousMonth`, `loadArchive` з кешем.

### Фаза 6 — Query API (1 день)

`getTimeEntries(query)`, `getSummary(query)`. Фільтри по date/case/user/tenant/category/billable.

### Фаза 7 — інтеграція з SaaS і ai_usage (півдня)

Біля кожного `logAiUsage` — додати `activityTracker.report('agent_call', ...)`. Розширити `subscriptionService.recalculateCurrent` параметром `timeEntries`. Додати TIME_ENTRY_ACTIONS в permission і AUDIT_ACTIONS (`time_entries_archived`, `time_entry_edited`, `time_entry_deleted`, `time_standards_changed`).

### Фаза 8 — документація і звіт (півдня)

`bugs_found_during_billing_foundation.md`, `recommended_task_claude_md_audit.md` (доповнення), `report_billing_foundation.md`.

---

## 11. ASCII-карта системи ДО / ПІСЛЯ

```
ДО (v3, поточний стан):
─────────────────────────────────────────────────────────
registry_data.json
├─ schemaVersion: 3
├─ settingsVersion: '3.0_patch_and_extension'
├─ tenants[]  (з storage, modelPreferences, subscription)
├─ users[]
├─ auditLog[]
├─ structuralUnits[]
├─ ai_usage[]            ← оператор-телеметрія
├─ caseAccess[]          ← заглушка
└─ cases[] (з team[].permissions)

services/
├─ aiUsageService.js
├─ modelResolver.js
├─ subscriptionService.js
├─ permissionService.js (активні tenant+case access)
├─ tenantService.js
├─ migrationService.js
└─ auditLogService.js

localStorage:
├─ levytskyi_timelog          ← legacy (не в Drive)
└─ levytskyi_action_log_cleaned_v1_1

ПІСЛЯ (v4, після TASK):
─────────────────────────────────────────────────────────
registry_data.json
├─ schemaVersion: 4
├─ settingsVersion: '4.0_billing_foundation'
├─ tenants[]   (+ settings.timeStandards)
├─ users[]
├─ auditLog[]
├─ structuralUnits[]
├─ ai_usage[]
├─ caseAccess[]
├─ cases[]
├─ time_entries[]         ← НОВЕ (місячна ротація)
├─ master_timer_state{}   ← НОВЕ
└─ billing_meta{}         ← НОВЕ

services/ (нові):
├─ activityTracker.js
├─ masterTimer.js
├─ timeStandards.js
├─ timeEntriesArchiver.js
└─ timeEntriesQuery.js

Drive:
├─ _backups/ (як було)
└─ _archives/                                ← НОВА папка
   ├─ time_entries_2026-05.json (на 1.06)
   ├─ time_entries_2026-06.json (на 1.07)
   └─ ...

localStorage:
├─ levytskyi_timelog                         ← deprecated, видаляється після імпорту
├─ levytskyi_billing_backup_done_v4         ← новий прапор
└─ levytskyi_timelog_imported_v4            ← новий прапор (якщо є legacy)
```

---

## 12. Критичні застереження

1. **schemaVersion bump** з 3 на 4 — ідемпотентний шлях:
   - Старе `registry.schemaVersion === 3` → `migrateV3toV4(registry)` додає `time_entries:[]`, `master_timer_state` дефолти, `billing_meta` дефолти, `tenant.settings.timeStandards`.
   - Якщо вже 4 → нічого не робимо, тільки догарантуємо нові поля.
   - Не зачіпати v1 → v2 → v3 шлях; він уже в `migrateRegistry`.

2. **Master timer state** не перезаписувати при reload без перевірки `lastActivityAt` (якщо більше 30 хв — скидаємо в `stopped`, інакше recovery).

3. **Cross-tab sync** через `BroadcastChannel('legalbms_master_timer')`. Без нього — race condition при двох вкладках.

4. **Try/catch навколо `activityTracker.report`** обов'язково. Звіт впав → лог у консоль, основна дія йде далі. Білінг не повинен блокувати юридичну роботу.

5. **`add_time_entry` ACTION залишається** — для ручного запису через QI/чат. Внутрішньо просто конвертується в `activityTracker.report('manual_entry', {...})` і додається в `time_entries[]` з `category: <вказаний>` і `metadata: { source: 'manual' }`.

6. **Не торкаємось UI** — `billing_ui_mode: 'off'` дефолт. Білінг тихо працює всередині. Видимий UI — окремий TASK Billing UI v1 через 6+ місяців.

---

## 13. Готовність — підсумок

| Перевірка | Статус |
|---|---|
| schemaVersion 3 і v1.1 виконано | ✅ |
| Усі сервіси v1.1 присутні | ✅ |
| ai_usage[] логування працює (10 точок) | ✅ |
| case.id всі string | ✅ |
| Архітектурний борг v1.1 виправлено | ✅ |
| Backup-функції є | ✅ (потрібен новий `backupRegistryDataPreBilling`) |
| Місцеcть `levytskyi_timelog` для імпорту | ✅ (питання Q1 адвокату) |
| Карта 25 точок інструментації узгоджена з кодом | ✅ |

✅ **Можна стартувати Фазу 1.** Чекаю згоди адвоката і відповіді на Q1-Q6.

---

## ⏸ ЗУПИНКА

Це Фаза 0. Впровадження не починалось. Жоден файл не змінений. Створено лише цей документ.

Для старту Фази 1 — напиши «продовжуй» (або з відповідями на Q1-Q6, якщо хочеш скоригувати дефолти).
