# CLAUDE.md — Legal BMS АБ Левицького

**Версія:** 5.2
**Останнє оновлення:** 10.05.2026
**Поточний schemaVersion:** 6
**Поточний settingsVersion:** "6.0_founder_flag"

---

## 🚨 ОБОВ'ЯЗКОВО ПЕРЕД БУДЬ-ЯКОЮ РОБОТОЮ

При старті будь-якого TASK Claude Code зобов'язаний:

1. Прочитати цей файл (CLAUDE.md) — архітектура системи
2. Прочитати DEVELOPMENT_PHILOSOPHY.md — філософія і принципи

**Без читання DEVELOPMENT_PHILOSOPHY.md TASK не починати.**

Філософські принципи мають вищий пріоритет за технічні деталі реалізації.

---

## ЩО ЦЕ ЗА ПРОЕКТ

Legal BMS — Legal Business Management System (кодова назва Registry v3) для адвокатського бюро Левицького. Спеціалізована операційна система для адвоката-практика з вбудованим AI.

**Стек:** React 18 + Vite 6 + ES modules
**Хостинг:** GitHub Pages — https://vadymlevyt.github.io/registry/
**Репо:** github.com/vadymlevyt/registry
**Розробка:** GitHub Codespaces (curly-space-zebra) + Claude Code Opus
**Drive:** registry_data.json в корені My Drive адвоката

### Структура файлів

```
registry/
├── index.html                  — entry-point (мінімальний)
├── src/
│   ├── App.jsx                 — головний компонент і state-orchestrator
│   ├── components/
│   │   ├── Dashboard/index.jsx — Activity Feed + календар + слоти
│   │   ├── CaseDossier/index.jsx — досьє справи з вкладками
│   │   ├── Notebook/index.jsx  — нотатки і записи
│   │   └── DocumentProcessor/  — пакетна обробка документів
│   ├── schemas/
│   │   └── documentSchema.js   — канонічна схема документа (18 + 6 полів) v5
│   └── services/
│       ├── driveAuth.js, driveService.js — Google Drive API
│       ├── ocrService.js + ocr/ — OCR провайдер-патерн (planka Picatinny)
│       │   ├── documentAi.js  — Document AI (основний)
│       │   ├── claudeVision.js — fallback
│       │   └── pdfjsLocal.js  — локальний для малих файлів
│       ├── documentFactory.js — createDocument(), validateDocument(), needsReview()
│       ├── documentsExtended.js — lazy-load для .metadata/documents_extended.json
│       ├── migrations/
│       │   └── v4ToV5.js       — canonical document schema migration
│       ├── tenantService.js, permissionService.js — SaaS Foundation
│       ├── auditLogService.js — критичні дії
│       ├── migrationService.js — schemaVersion і міграції (v1→v4)
│       ├── aiUsageService.js  — телеметрія токенів (для оператора SaaS)
│       ├── modelResolver.js   — ієрархія user → tenant → system
│       ├── subscriptionService.js — limits і current
│       ├── activityTracker.js — облік часу адвоката (для CRM)
│       ├── masterTimer.js     — state machine
│       ├── timeStandards.js   — стандарти за судами і категоріями
│       ├── smartReturnHandler.js — поведінка при поверненні
│       ├── timeEntriesArchiver.js — місячна ротація
│       ├── timeEntriesQuery.js — getTimeEntries API
│       └── moduleNames.js     — MODULES enum + categoryForCase()
├── LESSONS.md                  — інституційна пам'ять
├── CLAUDE.md                   — цей файл
└── DEVELOPMENT_PHILOSOPHY.md   — філософія розробки і ДНК-принципи
```

**Білд:** `npm run build` (Vite → dist/)
**Auto-deploy:** GitHub Actions при push на main

---

## КРИТИЧНІ ПРАВИЛА

### №1 — Гілки
Завжди працювати в гілці main. НЕ створювати окремі гілки.
Після змін: `git add -A && git commit -m "..." && git push origin main`

### №2 — textarea в QI
textarea в Quick Input ЗАВЖДИ має фіксовану `height: 120px`.
НЕ flex:1, НЕ min-height, НЕ height:100%.
Кнопки (Файл/Нотатка/Аналізувати) поза scrollable div з `flexShrink:0`.

### №3 — Merge конфлікти
При merge двох версій коду — НІКОЛИ не залишати обидва варіанти.
Перевіряти після merge:
- Немає дублікатів змінних
- Немає мертвого коду після return
- В catch блоках немає return який блокує fallback

### №4 — Blank page
Blank page = JS помилка яка не перехоплена.
При будь-якій зміні в async функціях — обгортати в try/catch.
Особливо: pdfjsLib, FileReader, fetch до API.

### №5 — Апострофи в українському тексті
Апостроф у словах (пам'ять, пов'язаний) в JS рядках в одинарних лапках — ламає синтаксис.
Весь україномовний текст — в подвійних лапках або шаблонних рядках.

### №6 — schemaVersion registry_data.json
Поточна версія: `schemaVersion: 6`.
При зміні структури:
- Інкрементувати schemaVersion
- Додати міграцію в `migrationService.js` (для базових структур) або окремий файл у `src/services/migrations/` (для специфічної логіки — як `v4ToV5.js`)
- Міграція має бути **ідемпотентною** (повторні запуски не ламають дані)
- Перед першою міграцією — обов'язковий бекап `registry_data_backup_pre_<name>_<ts>.json` у `_backups/` поза ротацією
- `migrationService.js` тримає `BASE_CHAIN_VERSION = 4` для `migrateRegistry` (базовий ланцюг v1→v4). Експортовані `CURRENT_SCHEMA_VERSION = 6` і `MIGRATION_VERSION = '6.0_founder_flag'` — це таргет повного ланцюга. Документна схема v5 — окремий крок через `migrateRegistryV4toV5`. Founder flag v6 — окремий крок через `migrateToVersion6`. Усі три послідовно викликаються в `App.jsx` EFFECT-A.

### №7 — executeAction async
`executeAction` — **async функція**. Усі callers що читають `.success`/`.error` — мусять `await`.
- Fire-and-forget виклики (без читання результату) безпечні
- Перед merge нових змін — перевірити що нові callers не читають Promise як sync-об'єкт

### №8 — Drive API і кирилиця
**НІКОЛИ** не використовувати кирилицю в параметрі `q=` Drive API — ненадійно.
Правильний патерн: отримати всі підпапки без фільтра, знайти потрібну в JavaScript.
OAuth токен Drive живе ~1 год → 401 = показати "перепідключіть Drive", не технічну помилку.

### №9 — Принцип "ембріон з повним ДНК"
Кожен новий модуль/функція проектується ОДРАЗУ з урахуванням SaaS + Multi-user + Billing.
**НЕ "потім додамо" — а одразу при народженні.**
Деталі — у файлі `DEVELOPMENT_PHILOSOPHY.md`.

### №10 — SAAS і BILLING IMPLICATIONS секції
Кожен новий TASK з суттєвими змінами повинен містити обов'язкові секції:
- **SAAS IMPLICATIONS** — як вписується в multi-tenant архітектуру
- **BILLING IMPLICATIONS** — точки інструментації, категорії time_entries

### №11 — Однозначність прапорців і полів
Кожен новий прапор / параметр / поле структури — **на місці оголошення** одне речення про єдиний сенс. Якщо сенс не вкладається в одне речення без «АБО» / «а також» / «інколи» — абстракція зібрана неправильно, розділи на дві сутності.

Перед розширенням існуючого імені новим сенсом (нова `&& flag` гілка в умові, нове значення в enum, нове поле в існуючу структуру) — **пауза**. Запитай: чи це справді той самий намір що поточний? Якщо ні — нове ім'я, не розширення.

Реальний кейс: `options.skipCache` керував і читанням, і записом OCR-кеша. Натискання «Розпізнати зараз» обходило старий кеш, але водночас блокувало запис нового — жовтий warning toast хоча Drive і код у нормі. Виправлено в мікро-TASK 2.2 розділенням умови запису від прапора читання.

Деталі — у `DEVELOPMENT_PHILOSOPHY.md` розділ «Однозначність».

---

## АРХІТЕКТУРА СИСТЕМИ

### Два основні system prompt

**HAIKU_SYSTEM_PROMPT** — для аналізу документів. Повертає ТІЛЬКИ JSON.
**SONNET_CHAT_PROMPT** — для чату. Повертає текст + ACTION_JSON.

Змішувати не можна — Haiku плутається і перестає повертати JSON.

### ACTIONS і PERMISSIONS — централізована архітектура

```js
// src/App.jsx
const ACTIONS = {
  update_case_field: { handler, audit: false },
  create_case: { handler, audit: true },
  destroy_case: { handler, audit: true, requireUI: true },
  add_hearing, update_hearing, delete_hearing,
  add_deadline, update_deadline, delete_deadline,
  add_note, update_note, delete_note, pin_note,
  add_time_entry, update_time_entry, cancel_time_entry,
  confirm_event, add_travel, cancel_travel,
  start_external_work, end_external_work,
  ... (19+ дій)
};

const PERMISSIONS = {
  qi_agent: ['create_case', 'add_note', 'add_hearing', ...],
  dashboard_agent: ['update_hearing', 'delete_note', ...],
  dossier_agent: ['add_note', 'update_note', 'add_deadline', ...],
  document_processor_agent: ['add_documents', 'update_processing_context', ...],
};
```

### Архітектура executeAction (архіваріус)

```
агент → executeAction(agentId, action, params)
              ↓
   1. Перевірка allowlist PERMISSIONS[agentId]
              ↓
   2. checkTenantAccess(userId, tenantId) — активна
              ↓
   3. checkRolePermission(userId, action) — заглушка (true для bureau_owner)
              ↓
   4. checkCaseAccess(userId, caseObj) — активна логіка
              ↓
   5. ACTIONS[action](params) — реальна логіка
              ↓
   6. shouldAudit(action) ? writeAuditLog : nothing
              ↓
   7. activityTracker.report() — billing інструментація
              ↓
   8. save до Drive (через useEffect)
```

`executeAction` — **async**. Усі callers мусять await якщо читають результат.

### ACTION_JSON парсинг — depth counter

```js
const idx = responseText.indexOf('ACTION_JSON:');
const start = responseText.indexOf('{', idx);
let depth = 0;
for (let i = start; i < responseText.length; i++) {
  if (responseText[i] === '{') depth++;
  else if (responseText[i] === '}') { depth--; if (depth === 0) { ... } }
}
```

Regex `[\s\S]*?` зупиняється на першій `}` — не використовувати для JSON.

### Моделі

- `claude-haiku-4-5-20251001` — аналіз документів (Haiku)
- `claude-sonnet-4-20250514` — чат-команди (Sonnet, default для агентів)
- `claude-opus-4-7` — глибокий аналіз (Opus, для tenant.modelPreferences Premium)

Усі виклики через `resolveModel(agentType)` (ієрархія user → tenant → system).

### findCaseForAction — пошук по 5 варіантах

1. Точний збіг імені
2. Базове ім'я без номера в дужках
3. По номеру справи case_no
4. Часткове співпадіння
5. По прізвищу в полі client

### handleFile — читання файлів

- Завжди використовувати `workingFile` (не `accessibleFile`, не `file` напряму)
- MIME fallback якщо немає розширення в імені
- Drive файли з хмари не читаються через `<input>` на Android — обмеження платформи

---

## СТРУКТУРА ДАНИХ

### Справа (Case)

```
{
  id (string: 'case_<n>' або 'case_<timestamp>'),
  name, client, category, status,
  court, case_no, judge, next_action,
  hearings: [{ id, date, time, duration, status, type, court?, notes? }],
  deadlines: [{ id, name, date }],
  notes: [{ id, text, category, ... }],
  pinnedNoteIds: [],
  timeLog: [],          // DEPRECATED since v4 — use top-level time_entries[]
  agentHistory: [],     // 3-tier cache (Drive → localStorage → state)
  documents: [{
    // 18 канонічних (легких) полів — у registry_data.json:
    id, name, originalName,
    category, author, documentNature, namingStatus, isKey,
    procId,
    driveId, driveUrl, folder,
    pageCount, size, icon,
    date, addedAt, updatedAt,
    addedBy, status
    // Важкі поля (tags, notes, annotations, processingHistory,
    // extractedTextSummary, customFields) — у .metadata/documents_extended.json
    // папки справи на Drive, lazy-load через documentsExtended.js
  }],
  storage: { driveFolderId, subFolders: { '01_ОРИГІНАЛИ': id, ... } },
  
  // SaaS v2 поля:
  tenantId, ownerId, createdAt, updatedAt,
  shareType (private | internal | external),
  externalAccess: [{ userId, validUntil, ... }],
  team: [{ userId, caseRole, addedAt, addedBy, permissions: {...} }]
}
```

### Notes (поза справою)

`localStorage 'levytskyi_notes'` — bucket-об'єкт:
```
{ cases: [], general: [], content: [], system: [], records: [] }
```

SaaS v2: кожна нота має `tenantId`, `createdBy`.

### Drive sync — registry_data.json v5

```json
{
  "schemaVersion": 5,
  "settingsVersion": "5.0_canonical_documents",

  "tenants": [...],
  "users": [...],
  "auditLog": [...],
  "structuralUnits": [],

  "cases": [...],             // documents[] у канонічній схемі (18 легких полів)

  "ai_usage": [...],          // SaaS телеметрія (LIFO 50000)
  "caseAccess": [],           // заглушка для майбутнього індексу

  "time_entries": [...],      // поточний місяць
  "master_timer_state": {...},
  "billing_meta": {...}
}
```

**Допоміжні файли на Drive (per case):**
```
<папка справи>/
├── 01_ОРИГІНАЛИ/           — оригінальні файли
├── 02_ОБРОБЛЕНІ/           — після нарізки/OCR
├── 03_ФРАГМЕНТИ/
├── 04_ПОЗИЦІЯ/
├── 05_ЗОВНІШНІ/
└── .metadata/
    └── documents_extended.json   — { documentId → { tags, notes, annotations,
                                       processingHistory, extractedTextSummary,
                                       customFields } }
```

`documents_extended.json` lazy-load через `documentsExtended.js` (in-memory кеш по `caseId`).

Старі формати автоматично мігруються через `migrationService.js`. Перед першою міграцією створюється бекап у `_backups/`.

### Структура time_entry

```json
{
  "id": "te_<ts>_<random>",
  "tenantId", "userId", "createdAt",
  "type": "session" | "action" | "hearing_attendance" | "travel" | ...,
  "module": "dashboard" | "case_dossier" | "qi" | ...,  // через MODULES enum
  "action": "tab_switched" | "agent_message" | ...,
  
  "caseId", "hearingId", "documentId",
  "duration", "startTime", "endTime",
  
  "category": "case_work" | "hearing_attendance" | "travel" | "admin" | "system" | "break" | "manual_entry",
  "subCategory", "billable", "visibleToClient", "billFactor",
  "status": "planned" | "active" | "needs_review" | "confirmed" | "auto_confirmed" | "user_corrected" | "cancelled" | "archived",
  
  "semanticGroup": "screen_active" | "screen_passive",
  "confidence": "high" | "medium" | "low" | "manual",
  "source": "timer" | "manual" | "agent" | "import" | "legacy",
  "exitedVia": "idle" | "visibility" | "manual" | "timeout" | "expected_offscreen" | "unexpected_screen_off",
  
  "parentEventId", "parentEventType", "direction",  // для travel
  
  "metadata": {...}
}
```

### Структура ai_usage

```json
{
  "id": "usage_<ts>_<random>",
  "tenantId", "userId", "timestamp",
  "agentType": "qi_agent" | "dashboard_agent" | "dossier_agent" | "document_parser" | "case_context_generator" | ...,
  "model", "inputTokens", "outputTokens", "totalTokens",
  "estimatedCostUSD",
  "context": { "caseId", "module", "operation" }
}
```

`time_entries[]` (для адвоката) і `ai_usage[]` (для оператора SaaS) — **ДВІ ОКРЕМІ структури з різними цілями**. Не дублювати.

---

## SAAS FOUNDATION v2.0 — БАЗА

### Типи tenants (фіксований enum)

- **solo** — адвокат-фізособа з помічником
- **bureau** — адвокатське бюро (наш поточний випадок: `ab_levytskyi`)
- **association** — адвокатське об'єднання (партнери з кластерами)
- **firm** — юридична фірма (багаторівнева ієрархія, практики)

### Глобальні ролі за типом tenant

**Solo:** solo_advocate, solo_assistant
**Bureau:** bureau_owner, bureau_lawyer, bureau_assistant
**Association:** association_partner, association_lawyer, association_assistant
**Firm:** firm_managing_partner, firm_partner, firm_counsel, firm_senior_associate, firm_associate, firm_junior_associate, firm_paralegal, firm_intern
**Cross-tenant:** external_collaborator

### Ролі в команді справи (caseRole)

- `lead` / `owner` — повний контроль
- `oversight` — read-only + може втручатися
- `team_member` / `co-lead` / `support` — робота
- `consulted` — read-only + коментує
- `external` — зовнішній адвокат з тимчасовим доступом

### Які дії пишуться в auditLog

ТІЛЬКИ критичні (`AUDIT_ACTIONS` в `auditLogService.js`):
- `create_case`, `close_case`, `restore_case`, `destroy_case`
- `delete_hearing`, `delete_deadline`
- `time_entries_archived`, `time_entry_edited`, `time_entry_deleted`, `time_standards_changed`

`update_*`, `add_note`, `pin_note`, `add_hearing`, `add_deadline`, `add_time_entry` — **НЕ пишемо**. Шум переважає користь.

### Сервіси SaaS Foundation

- `tenantService.js` — `getCurrentTenant()`, `getCurrentUser()`, DEFAULT_TENANT, DEFAULT_USER
- `permissionService.js` — `checkTenantAccess`, `checkRolePermission`, `checkCaseAccess`
- `auditLogService.js` — `AUDIT_ACTIONS`, `shouldAudit`, `writeAuditLog`, `updateAuditLogStatus`
- `migrationService.js` — `migrateRegistry`, `ensureCaseSaasFields`, `CURRENT_SCHEMA_VERSION`

### Поля справи — обов'язкові SaaS

Кожна справа в `cases[]` після міграції має:
- `tenantId` — приналежність до організації
- `ownerId` — провідний адвокат (= автор)
- `team[]` — `[{ userId, caseRole, addedAt, addedBy, permissions: {...} }]`
- `shareType` — `private` | `internal` | `external`
- `externalAccess[]` — для майбутніх крос-tenant доступів

Вкладені сутності (`hearings[]`, `deadlines[]`, `notes[]`) **не дублюють** `tenantId`, успадковують з parent. Але отримують `createdBy`.

### destroy_case — спеціальна процедура

Запис в auditLog **до** видалення зі статусом `pending`, після успіху → `done`, на помилку → `failed`. Гарантує що навіть втрачена мережа лишає слід.

### Заборонено

- НЕ додавати UI керування користувачами/ролями (окремий TASK)
- НЕ замінювати заглушки на реальну логіку без узгодження
- НЕ створювати нові сутності без `tenantId`
- НЕ обходити `executeAction` для модифікацій даних
- НЕ дублювати `tenantId` у вкладених сутностях справи

---

## SAAS FOUNDATION v3.0 — PATCH AND EXTENSION

**Дата:** 2026-05-05
**schemaVersion:** 3
**settingsVersion:** "3.0_patch_and_extension"

### Виправлений архітектурний борг

- **agentHistory:** localStorage slice вирівняно -20→-50, застарілий коментар у App.jsx видалено. 3-tier cache (Drive → localStorage → state) — це валідна архітектура.
- **levytskyi_action_log:** код `logAction` видалено, виклик з `executeAction` прибрано. Дані одноразово в `_backups/levytskyi_action_log_<ts>.json`. Прапор `levytskyi_action_log_cleaned_v1_1` запобігає повторному виконанню.
- **id mixed types:** усі `case.id` тепер string у форматі `case_<original_id>`. INITIAL_CASES → `case_1`..`case_20`. Документи Брановського: number → string. Точки створення (QuickInput, addCase) генерують `case_${Date.now()}`.
- **driveService.writeCases:** видалено мертвий блок з App.jsx:2894-2913.

### Нові структури

**`ai_usage[]`** — пасивний облік токенів AI на верхньому рівні. LIFO ротація 50 000 записів.
Поля: `id`, `tenantId`, `userId`, `timestamp`, `agentType`, `model`, `inputTokens`, `outputTokens`, `totalTokens`, `estimatedCostUSD`, `context: { caseId, module, operation }`.

**`caseAccess[]`** — заглушка денормалізованого індексу для майбутнього SaaS-масштабу. Очікувана схема (коментар у `migrationService.js`):
```
{ caseId, userId, tenantId, caseRole, addedAt, expiresAt, permissionsHash }
```
Активується в TASK Multi-user Activation.

### Розширення tenant

**`tenant.storage`** — `provider` (`drive_legacy` default, в майбутньому `r2_managed` / `drive_byos`), `quotaGB`, `usedBytes`. Готовність до тарифів.

**`tenant.modelPreferences`** — null для всіх 9 типів агентів. Готовність до тарифних пакетів (Premium може обрати Opus замість Sonnet для досьє-агента).

**`tenant.subscription.limits + current + alerts`** — структура обліку лімітів.
- `limits`: `aiTokensPerMonth`, `aiCostPerMonth`, `storageGB`, `teamMembers`, `casesActive` — null зараз.
- `current`: `periodStart`, `periodEnd`, `tokensUsed`, `costUsedUSD`, `storageUsedGB`, `teamMembersCount`, `casesActiveCount`, `hoursBilled`.
- `alerts`: `warnAt: 80`, `blockAt: 100` (відсотки).

### Розширення case.team

**`case.team[i].permissions`** — 7 полів: `canEdit`, `canDelete`, `canShare`, `canAddTeam`, `canViewBilling`, `canEditBilling`, `canRunAI`.

Дефолти за `caseRole`:

| caseRole | canEdit | canDelete | canShare | canAddTeam | canViewBilling | canEditBilling | canRunAI |
|----------|---------|-----------|----------|------------|----------------|----------------|----------|
| owner    | ✅      | ✅        | ✅       | ✅         | ✅             | ✅             | ✅       |
| lead     | ✅      | ✅        | ✅       | ✅         | ❌             | ❌             | ✅       |
| co-lead  | ✅      | ❌        | ✅       | ❌         | ❌             | ❌             | ✅       |
| support  | ✅      | ❌        | ❌       | ❌         | ❌             | ❌             | ✅       |
| external | ❌      | ❌        | ❌       | ❌         | ✅             | ❌             | ❌       |

`canRunAI` важливий для тарифних обмежень — бюро зможе обмежити використання AI окремими членами команди.

### Нові сервіси

- `aiUsageService.js` — `MODEL_PRICING` (haiku/sonnet/opus, pricing as of 2026-05-04, verify quarterly), `calculateCost`, `logAiUsage` (для React-точок), `logAiUsageViaSink` (для не-React точок типу claudeVision і analyzePDFWithDocumentBlock), аналітичні хелпери (`getUsageByPeriod/Model/Case/User`, `getTotalCost`).
- `modelResolver.js` — `SYSTEM_DEFAULTS` (9 типів агентів), `resolveModel(agentType)` з ієрархією user → tenant → system.
- `subscriptionService.js` — `recalculateCurrent(tenant, aiUsage, cases, timeEntries)`, `checkLimits(tenant)`. Поки limits = null, перевірок немає.

### Активовані заглушки

- **`checkTenantAccess(userId, tenantId)`** — реальна перевірка `u.userId === userId && u.tenantId === tenantId`.
- **`checkCaseAccess(userId, caseObj)`** — сигнатура збережена. Логіка:
  1. Tenant isolation: `caseObj.tenantId !== u.tenantId` → false
  2. `bureau_owner` → завжди true в межах свого tenant
  3. `caseObj.ownerId === userId` → true
  4. Team membership → true
  5. ExternalAccess з валідним `validUntil` → true

---

## BILLING FOUNDATION v4.0

### schemaVersion і константи

- `CURRENT_SCHEMA_VERSION = 4`
- `MIGRATION_VERSION = '4.0_billing_foundation'`

### Сервіси Billing Foundation

- **`activityTracker.js`** — центральна служба обліку часу.
  - `report(eventType, context)` — базовий звіт.
  - `startSession/endSession` — сесія в модулі.
  - `startSubtimer/endSubtimer` — категоризований субтаймер з `semanticGroup`.
  - `assignOfflinePeriod(period, category, caseId)` — retroactive запис.
  - Усі публічні методи в try/catch — падіння tracker не блокує юридичну роботу.
  
- **`masterTimer.js`** — state machine.
  - States: `stopped` | `active` | `paused` | `idle`
  - Page Visibility, Idle Detection (Chromium), BroadcastChannel cross-tab
  - Persist у `master_timer_state` кожні 60 сек
  - Recovery з 30-хв порогом
  - autoStart керується `user.preferences.autoStartMasterTimer.enabled`
  
- **`timeStandards.js`** — `getTimeStandard(activity, context)` — ієрархія user → tenant → system. ACTIVITY_CATEGORIES, EVENT_VARIANT_MATRIX.

- **`smartReturnHandler.js`** — `handleReturn(activeSubtimer, actualDuration, exitReason)` → `{ dialog, suggestion }`. // experimental — review after 1 month

- **`timeEntriesArchiver.js`** — `shouldArchive`, `splitForArchive`, `uploadArchive`, `loadArchive`, `checkAndArchive`.

- **`timeEntriesQuery.js`** — `getTimeEntries({ activeEntries, token, query })`, `getSummary`.

- **`moduleNames.js`** — MODULES enum (qi, dashboard, case_dossier, document_processor, notebook, app, execute_action, ...) + `categoryForCase(caseId)` хелпер.

### Категорії time_entry

- **case_work** — billable, visibleToClient, billFactor 1.0 (caseId є)
- **hearing_attendance** / **hearing_preparation** / **travel** — billable, visible, factor 1.0
- **client_communication** — billable, але visibleToClient: false, factor 0.5
- **admin** / **system** / **break** — non-billable
- **manual_entry** — категорія за вибором адвоката

### ACTIONS для білінгу

```
add_time_entry, update_time_entry, cancel_time_entry, delete_time_entry,
split_time_entry, assign_offline_period,
confirm_event(eventId, eventType, decision),
add_travel(parentEventId, parentEventType, direction, duration, options),
cancel_travel(travelEntryId, reason),
start_external_work(category, caseId, subCategory, plannedDuration, semanticGroup),
end_external_work, update_external_work,
track_session_start, track_session_end
```

### Двофазна модель події з резервуванням

1. При створенні hearing — резервується основний `time_entry` (status: `planned`).
2. travel — окрема категорія, додається явно через `add_travel`.
3. Підтвердження через `confirm_event(eventId, eventType, decision)` — узагальнений API.

Матриця варіантів для hearing: `completed`, `postponed_opponent`, `postponed_self`, `court_fault` (default factor 0.5/0.3 traveled/no_travel), `custom` (вільний текст + factor вручну).

Auto-confirm через 24-48-72 години без підтвердження адвокатом.

### Місячна ротація

- На 1 число місяця попередній місяць виноситься в `_archives/time_entries_YYYY-MM.json` на Drive.
- Активний registry тримає тільки поточний місяць.
- Перевірка через `shouldArchive(billing_meta)` у Drive load useEffect.

### Інструментація — 25 точок

- App.jsx (4): app_launched, module_navigation, case_created, case_closed
- Dashboard (5): session, hearing_viewed, event_drag_create, agent_message_dashboard, hearing_status (через executeAction)
- CaseDossier (6): session, case_opened, dossier_tab_switched, document_viewed, context_regenerated, agent_message_dossier
- QuickInput (3): qi_document_uploaded, qi_voice_input, qi_action_executed
- Notebook (2): note_created, note_edited
- DocumentProcessor (5): batch_started, ocr_processed, split_proposed, split_confirmed, batch_completed

Усі обгорнуто в try/catch.

### Інтеграція з ai_usage[]

10 точок виклику Anthropic API мають паралельний `activityTracker.report('agent_call', ...)`:
- `ai_usage[]` — токени/вартість для оператора SaaS
- `time_entries[]` — час/категорія для адвоката (CRM-зріз)

### Permissions для time_entries

- `TIME_ENTRY_ACTIONS` в `permissionService.js`
- `canViewTimeEntries(userId, targetUserId, tenantId)` — bureau_owner все, інші — свої
- `canEditTimeEntry(userId, entry)` — автор або bureau_owner

### Принцип варіабельності

ВСІ дефолти — стартові точки. У коді позначено `// experimental — review after 1 month`:
- ACTIVITY_CATEGORIES (зокрема client_communication factor 0.5)
- EVENT_VARIANT_MATRIX (court_fault traveled vs no_travel)
- Стандарти часу за судами/містами
- semanticGroup detection
- IDLE_TIMEOUT_MIN (5 хв)
- Місячна ротація (можлива тижнева/квартальна)

Через 1 місяць після впровадження — TASK переоцінки експериментальних фіч.

### Заборонено в Billing

- НЕ створювати UI білінгу (окремий TASK Billing UI v1 через 6+ міс)
- НЕ дублювати поля між `ai_usage[]` і `time_entries[]`
- НЕ робити `add_travel` автоматичним при створенні hearing — адвокат явно додає
- НЕ обходити `activityTracker.report` для значущих дій
- НЕ видаляти `case.timeLog[]` — DEPRECATED, але лишається порожнім

---

## PHASE 1.5 — CANONICAL DOCUMENT SCHEMA v5.0

**Дата:** 2026-05-08
**schemaVersion:** 5
**settingsVersion:** "5.0_canonical_documents"

### Принцип Single Source of Truth для документів

`cases[].documents[]` у `registry_data.json` — єдине джерело **легких** метаданих документів справи. **Важкі** поля винесені у `documents_extended.json` у `.metadata/` папки справи з lazy-load. Жодних паралельних `documents_index.json`.

### Канонічна схема документа — 18 легких полів

```
Ідентифікація:    id, name, originalName
Класифікація:     category, author, documentNature, namingStatus, isKey
Зв'язки:          procId
Drive:            driveId, driveUrl, folder
Розмір/формат:    pageCount, size, icon
Дати:             date, addedAt, updatedAt
Аудит:            addedBy
Стан:             status
```

**Required + nullable** (поле має бути присутнім, але може бути null → маркер ⚠ "потребує перегляду"):
- `category`, `author`, `procId`, `driveId`

**enum значення:**
- `category`: pleading | motion | court_act | evidence | contract | correspondence | identification | other | null
- `author`: ours | opponent | court | third_party | null
- `documentNature`: searchable | scanned
- `namingStatus`: auto | manual | pending
- `folder`: 00_INBOX_СПРАВИ | 01_ОРИГІНАЛИ | 02_ОБРОБЛЕНІ | 03_ФРАГМЕНТИ | 04_ПОЗИЦІЯ | 05_ЗОВНІШНІ
- `addedBy`: lawyer_via_dp | lawyer_manual | agent | ecits | migration
- `status`: active | archived

### Extended поля (lazy-load з .metadata/documents_extended.json)

```
documentId, tags, notes, annotations, processingHistory,
extractedTextSummary, customFields
```

`processingHistory` готує грунт під події OCR/нарізки/Haiku-cleanup з посиланнями на `ai_usage` (заповнюється у TASK Document Processor v2).

### Сервіси

- **`src/schemas/documentSchema.js`** — `CANONICAL_DOCUMENT_FIELDS` (18), `EXTENDED_DOCUMENT_FIELDS` (6+1), `CRITICAL_FIELDS_FOR_WARNING`, `CURRENT_SCHEMA_VERSION = 5`.

- **`src/services/documentFactory.js`** — єдина точка створення документа.
  - `createDocument(metadata)` — повертає валідний об'єкт з усіма канонічними полями і дефолтами. ID-генератор: `doc_${Date.now()}_${rand36}`.
  - `validateDocument(doc)` → `{ valid, errors[] }`.
  - `needsReview(doc)` → boolean (хоч одне з procId/category/author === null).
  - `getMissingCriticalFields(doc)` → ['провадження', 'тип', 'автор'].

- **`src/services/documentsExtended.js`** — Drive lazy-load.
  - `loadExtendedForCase(caseId, caseData)` — кеш по `caseId`.
  - `saveExtendedForCase(caseId, caseData, mapping)`.
  - `getExtendedForDocument`, `setExtendedForDocument`, `invalidateCache`.
  - `.metadata` і `documents_extended.json` латиниця → `q=` безпечне (правило #8).

- **`src/services/migrations/v4ToV5.js`** — `migrateRegistryV4toV5(registry)` → `{ registry, extendedByCase, didMigrate, fromVersion, toVersion }`. `splitDocumentV4toV5(oldDoc)` розщеплює legacy doc → canonical + extended. Ідемпотентна.

### Точки створення документа — об'єднані через createDocument()

| Точка | Файл | addedBy |
|-------|------|---------|
| DocumentProcessor основна обробка | `DocumentProcessor:804-822` | `lawyer_via_dp` |
| DocumentProcessor split PDF | `DocumentProcessor:955-963` | `lawyer_via_dp` |
| CaseDossier модаль "+ Додати документ" | `CaseDossier:2452-2486` | `lawyer_manual` |
| CaseDossier drag-n-drop drop queue | `CaseDossier:1940-2010` | `lawyer_manual` (через `executeAction` update_case_field — тимчасово, окремий ACTION у запланованому TASK) |
| INITIAL_CASES (seed Брановський) | `App.jsx:100-113` | `migration` |

### Міграція v4 → v5

1. `migrateRegistry(raw)` піднімає raw до v4 (базовий ланцюг у `migrationService.js`, `CURRENT_SCHEMA_VERSION = 4`).
2. Якщо `registry.schemaVersion < 5` → бекап `registry_data_backup_pre_v5_<ts>.json` через `backupRegistryDataPreV5` (один раз, прапор `levytskyi_pre_v5_backup_done`).
3. `migrateRegistryV4toV5(registry)` → canonical документи + `extendedByCase` мапа.
4. Після `setCases(...)` — цикл `saveExtendedForCase` для справ з непорожнім extended і реальним `storage.driveFolderId`. Справи без Drive-папки (seed) зберігають extended у memory до моменту створення папки.

### Заборонено

- НЕ створювати документ обходом `createDocument()` — це псує канонічну схему.
- НЕ дублювати важкі поля у `cases[].documents[]` (tags, annotations тощо) — вони у `.metadata/documents_extended.json`.
- НЕ використовувати кирилицю в `q=` Drive API при роботі з `.metadata/` (правило #8).
- НЕ додавати поля у канонічну схему без міграції — інкрементувати schemaVersion.

---

## TASK 0.1 — FOUNDER FLAG v6.0

**Дата:** 2026-05-10
**schemaVersion:** 6
**settingsVersion:** "6.0_founder_flag"

### Призначення

Прапорець `users[].isFounder` — глобальна позначка власника продукту. Не залежить від `tenantId`. Точка розширення для майбутніх founder-only модулів (Розвідник у «Електронному суді», Admin metrics, Dev tools, повна версія Content Hub).

Тільки одна людина в системі концептуально має `isFounder: true` (технічно не enforce'ується). У `DEFAULT_USER` (`vadym`) — `isFounder: true`. Решта користувачів за замовчуванням `false`.

### Хелпер

```js
import { isCurrentUserFounder } from './services/tenantService';

if (isCurrentUserFounder()) {
  // показати founder-only UI
}
```

Логіка: `getCurrentUser()?.isFounder === true`. Повертає `false` для null/undefined/без поля.

### Міграція v5 → v6

`migrateToVersion6(registry)` у `src/services/migrationService.js`:
- Проставляє `isFounder: false` усім існуючим users без поля
- Для `userId === 'vadym'` (засновник) проставляє `isFounder: true`
- Не торкається інших полів
- Ідемпотентна (повторні запуски — no-op коли schemaVersion вже 6)
- Не перезатирає вже встановлений boolean isFounder (edge case: розжалуваний vadym)

Викликається в `App.jsx` EFFECT-A послідовно після `migrateRegistryV4toV5`. Перед міграцією створюється `registry_data_backup_pre_v6_<ts>.json` у `_backups/` поза ротацією. Прапор `levytskyi_pre_v6_backup_done` запобігає повторному бекапу.

### Заборонено

- НЕ використовувати `isFounder` для перевірок tenant-доступу — це **глобальна** позначка, не tenant-scoped.
- НЕ зав'язувати білінгові ліміти на `isFounder` — це окрема відповідальність `tenant.subscription`.
- НЕ створювати UI для перемикання `isFounder` (наразі — тільки код / міграція).

---

## МОДУЛЬ ЕЛЕКТРОННИЙ СУД (TASK 0.2)

**Дата:** 2026-05-10
**Стан:** інфраструктурний скелет, без реального функціоналу

Вкладка «Електронний суд» (іконка `Scale` з lucide-react) між «Книжкою» і «Новою справою». Компонент: `src/components/CourtSync/index.jsx`.

### Структура

- **ЄСІТС** — видима всім. Підвкладки: Огляд, Журнал, Налаштування, Розбіжності. Всі — заглушки «У розробці».
- **Розвідник** — видима тільки коли `isCurrentUserFounder() === true`. Інструменти розвідки. Заглушка.

### Точки розширення

- `src/services/eventBus.js` — pub/sub для крос-модульної комунікації. Топіки в `eventBusTopics.js` (`ecits.documents_received`, `ecits.hearing_scheduled`, `ecits.case_status_changed`, `ecits.submission_completed`).
- `src/services/ecitsService.js` — EcitsAPI фасад (`triggerSync`, `getLastSyncTime`, `getSyncReport`, `getSettings`, `updateSettings`). Зараз — заглушки. Реальна RPA-інтеграція з cabinet.court.gov.ua через Computer Use (Claude for Chrome або власне розширення) — наступні TASK.
- `tenant.settings.moduleIntegration.ecits` — налаштування модуля (autoSync, syncIntervalMinutes, casesToSync, autoProcessIncoming, detectDeadlinesOnReceive, executionProvider). Tenant-scoped, переноситься між організаціями без міграції.
- `document.source` — універсальне nullable поле каналу надходження (`manual_upload | ecits | telegram | email | null`). Додано в канонічну схему (21 поле) **без schema bump** (nullable default null). Довідник у `src/constants/documentSources.js`.
- `driveService.getOrCreateResearchFolder(type, name)` — lazy-loading папок `_research/ecits/` і `_research/competitors/` (створюються лише при першому записі).

### Дизайн

Модуль використовує лише існуючі design-токени (`var(--color-*)`, `var(--text-*)`). Жодних власних стилів окрім layout flex/grid. Іконки — lucide-react через `components/UI/icons.js`. Жодних емодзі в інтерфейсі модуля.

### Recon-інфраструктура (TASK 0.3, 2026-05-10)

Read-only розвідка кабінету ЄСІТС через офіційне розширення Claude for Chrome (Опція А, BYOK). Адвокат-засновник копіює готовий промпт у вікно Claude for Chrome, той виконує план обходу і складає артефакти на Drive.

- **Сценарії** — `src/services/recon/scenarios/ecitsBasic.js`, реєстр `RECON_SCENARIOS`. Поки що один: `RECON_ecits_basic_v1` (5 етапів, ~10-15 хв).
- **API** — `ecitsService.getReconScenarios/getReconHistory/registerReconRun/markReconCompleted/exportReconForAnalysis/testProviderConnection`.
- **Зберігання** — артефакти на Drive у `_research/ecits/<reconId>/`, історія запусків у `localStorage('levytskyi_recon_history')` + поле `tenant.recon_history[]` (додано в `DEFAULT_TENANT` без schema bump за принципом «розширення без міграції»).
- **UI** — `src/components/CourtSync/Reconnaissance/index.jsx` (видима тільки founder'ам через `isCurrentUserFounder()`) + `setup/ClaudeForChromeSetup.jsx` (one-time walkthrough встановлення/входу). Прохід setup'у зберігається в `localStorage('levytskyi_claude_for_chrome_setup_done_v1')`.
- **Аналіз** — артефакти розпаковуються в окремому Claude-чаті адвоката; ця сторінка лише запускає і реєструє recon, не парсить результат.

Recon не публікує події в eventBus і не списує AI-токени з нашої сторони (виконується через підписку Claude for Chrome адвоката).

## АРХІТЕКТУРНЕ ПРАВИЛО — СПІЛЬНИЙ СТАН

Єдине джерело правди для всіх модулів — `App.jsx`.

**НЕ можна:**
- Тримати cases[], notes[], calendarEvents[] всередині компонента
- Викликати setCases() напряму з компонента
- Дублювати дані між модулями

**МОЖНА і ТРЕБА:**
- Отримувати дані через props
- Змінювати дані через функції з props
- Тримати в компоненті тільки UI-стан (активна вкладка, текст в полі)

Функції зміни спільних даних живуть **ТІЛЬКИ** в App.jsx:
- updateCase(caseId, field, value)
- addNote(note) / deleteNote(noteId)
- addCalendarEvent(event) / updateCalendarEvent(id, updates) / deleteCalendarEvent(id)

---

## AGENT HISTORY — 3-TIER CACHE PATTERN

Це **НЕ архітектурний борг**, а валідний 3-tier cache:

1. **`cases[i].agentHistory`** — резервний fallback в registry
2. **`localStorage.agent_history_<caseId>`** — швидкий кеш при старті
3. **`agent_history.json`** на Drive — головна персистентна копія

Логіка:
- Запис: пишеться в усі 3 одночасно
- Читання: каскад Drive → localStorage → registry
- Slice: 50 повідомлень у всіх трьох (раніше був баг — 20 в localStorage, виправлено)

Деталі — `diagnostic_agentHistory.md`.

---

## ERRORBOUNDARY — ПРИНЦИП СТІЛЬНИКА В КОДІ

Один клас в App.jsx. Обгортає кожен великий модуль при рендері.
Якщо модуль падає — решта системи працює.

```js
class ErrorBoundary extends React.Component {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return (
      <div style={{padding:20,color:"#e74c3c"}}>
        ⚠️ Модуль тимчасово недоступний
        <button onClick={()=>this.setState({hasError:false})}>Спробувати знову</button>
      </div>
    );
    return this.props.children;
  }
}
```

Використання: `<ErrorBoundary><CaseDossier .../></ErrorBoundary>`

---

## OCR — ПРОВАЙДЕР-ПАТЕРН (PLANKA PICATINNY)

`src/services/ocrService.js` — фасад. Один інтерфейс для всіх модулів які потребують OCR.

```
ocrService.js
  ↓ автоматично використовує:
ocr/documentAi.js (основний — процесор ab-levytskyi-ocr, europe-west2)
ocr/claudeVision.js (fallback)
ocr/pdfjsLocal.js (локальний для малих файлів)
```

**Document AI:**
- Project: registry-ab-levytskyi
- Processor: 2cc453e438078154
- Region: europe-west2
- Стабільно розпізнає українські судові документи
- Перевершує Claude Vision за стабільністю і швидкістю на великих файлах

**Як використовується:**
- Document Processor v2 (планується) — семантична нарізка
- Context Generator (вже є) — формування case_context.md
- Майбутні модулі — через той самий фасад

`pdf-lib` — локальна нарізка великих PDF на чанки по 25 стор перед Document AI.

---

## TOOL USE СТРАТЕГІЯ

### Поточний стан

Більшість агентів працюють через JSON ACTIONS:
- QI agent ✓ (стабільний, не чіпаємо)
- Dashboard agent ✓ (стабільний, не чіпаємо)
- Dossier agent в режимі чату ✓ (тільки спілкується)

### Міграція на tool use

Tool Use **НЕ окремий preparation TASK**. Закладається ВПЕРШЕ в TASK який його реально потребує — **Document Processor v2**.

```
src/services/
├── toolUseRunner.js       — універсальний раннер (НОВЕ)
└── toolDefinitions.js     — реєстр доступних tools (НОВЕ)
```

Перший модуль закладає інфраструктуру. Наступні переюзовують.

### На tool use:
- Document Processor v2 (запланований)
- Context Generator (інтегрований з Document Processor)
- Canvas-конструктор документів (запланований, нативно tool use)
- Майбутні модулі що цього потребують

### НЕ мігруємо:
- QI, Dashboard, Dossier-чат — працюють стабільно

---

## ТЕСТУВАННЯ

**Стек:** Vitest 4.x (test runner), Node environment.

### Команди

- `npm test` — повний прогон (для CI/CD).
- `npm run test:watch` — watch mode під час розробки.
- `npm run test:ui` — графічний UI у браузері (опційно).

### Структура

```
tests/
├── unit/                   — юніт-тести сервісів (чисті функції, без DOM)
│   ├── documentFactory.test.js
│   ├── documentSchema.test.js
│   ├── documentsExtended.test.js
│   ├── migrations.test.js
│   ├── toolDefinitions.test.js
│   └── toolUseRunner.test.js
└── integration/            — workflow-тести (executeAction + ACTIONS + PERMISSIONS)
    ├── _actionsHarness.js  — спільний harness (повторює логіку з App.jsx)
    ├── actions.test.js
    ├── drag-n-drop.test.js
    ├── agent-workflow.test.js
    └── document-processor.test.js
```

`tests/integration/_actionsHarness.js` — поки ACTIONS і PERMISSIONS живуть закритими в App.jsx, harness повторює мінімум логіки що тестується. Окремий TASK ActionsRegistry refactor винесе ACTIONS у `src/services/actionsRegistry.js` як factory з deps injection — тоді harness видаляється і тести імпортуватимуть `createActions(deps)` напряму. Поки що — синхронізація вручну: при зміні ACTIONS у App.jsx оновлювати harness.

### Правило для нових TASK

Кожен TASK з суттєвими змінами повинен:
1. Додати юніт-тести для нових сервісних функцій у `tests/unit/`.
2. Додати інтеграційні тести для нових workflow'ів у `tests/integration/` якщо торкається ACTIONS/PERMISSIONS.
3. Перед коммітом — `npm test` повністю зелений.

CI/CD блокує деплой якщо хоч один тест червоний.

### CI/CD

`.github/workflows/deploy.yml` має три послідовні job-и: `test → build → deploy`. Будь-який red test блокує build і deploy. Артефакти не публікуються поки тести не зелені.

---

## ПОТОЧНИЙ СТАН СИСТЕМИ

### Завершено

- ✅ Vite migration
- ✅ Модульна структура (Dashboard / CaseDossier / Notebook / DocumentProcessor)
- ✅ SaaS Foundation v1 (2026-05-04) — tenants/users/auditLog/permissions
- ✅ SaaS Foundation v1.1 Patch (2026-05-05) — schemaVersion 3, ai_usage, modelPreferences, subscriptions
- ✅ Billing Foundation v2 (2026-05-05) — schemaVersion 4, time_entries, master_timer, archives
- ✅ Document AI інтеграція
- ✅ Test Infrastructure (2026-05-08) — Vitest з 180+ тестами і CI блокуванням деплою при red тестах

### В роботі / спостереження

- 🔄 Спостереження за реальною роботою Billing Foundation (1-2 тижні)
- 🔄 Збір накопичених знахідок у `bugs_found_during_billing_foundation.md`

### Заплановано

- 🟡 TASK Document Processor v2 + Context Generator (з tool use, наступний великий)
- 🟡 TASK Canvas-конструктор документів (наступний модуль після DP v2)
- 🟡 TASK Multi-user Activation (окремий чат, для Олени-помічниці)
- 🟡 TASK Storage Migration (зміна директорії на Drive)
- 🟡 TASK ЄСІТС RPA інтеграція
- 🟡 TASK Telegram бот
- 🟡 TASK Billing UI v1 (через 6+ міс)
- 🟡 TASK AI Provider Abstraction (через 6-12 міс при SaaS-комерціалізації)

---

## LESSONS.md — ІНСТИТУЦІЙНА ПАМ'ЯТЬ

Файл `LESSONS.md` в корені репо містить уроки з попередніх сесій.

Звертатись ТІЛЬКИ коли:
- Перша спроба не дала результату
- Бачиш схожий симптом але не знаєш причину
- Збираєшся робити merge або переписувати великий блок
- Щось зникло після попереднього фіксу

Читати: `cat LESSONS.md`
**НЕ змінювати код на основі LESSONS.md без явного завдання в TASK.md.**

---

## DEVELOPMENT_PHILOSOPHY.md — ОБОВ'ЯЗКОВО ПРОЧИТАТИ

Окремий файл `DEVELOPMENT_PHILOSOPHY.md` містить:
- Принцип "ембріон з повним ДНК"
- Як проектувати нові модулі (SaaS + Multi-user + Billing з самого початку)
- Архітектурні шаблони (planka Picatinny, executeAction, провайдер-патерн)
- Філософію білінгу (13 тез)
- Стандарти TASK (SAAS і BILLING IMPLICATIONS секції)

**Читати при будь-якій новій розробці.**

---

**Кінець CLAUDE.md v5.0**
**Готово до оновлення Claude Code в окремому TASK.**
