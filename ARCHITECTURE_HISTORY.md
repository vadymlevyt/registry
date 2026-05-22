# ARCHITECTURE_HISTORY.md — Хронологія TASK'ів Legal BMS

Винесено з `CLAUDE.md` (TASK розвантаження, 2026-05-15) **дослівно, без втрати змісту**.
`CLAUDE.md` лишає консолідований операційний дайджест (розділ «КАНОНІЧНИЙ СТАН»);
тут — повний наратив, обґрунтування і покрокові міграції кожного етапу.

Філософія розробки — `DEVELOPMENT_PHILOSOPHY.md`. Інституційна пам'ять — `LESSONS.md`.

## Покажчик (хронологія → детальні звіти)

| Етап | schemaVersion | Звіти |
|------|---------------|-------|
| SaaS Foundation v2.0 / v3.0 | 2 → 3 | `report_saas_foundation.md`, `report_saas_foundation_v1_1.md`, `diagnostic_saas_foundation*.md`, `bugs_found_during_saas_foundation.md` |
| Billing Foundation v4.0 | 4 | `report_billing_foundation.md`, `diagnostic_billing_foundation.md` |
| Canonical Document Schema v5.0 | 5 | (наратив нижче; дотичні `diagnostic_document_lifecycle*.md`) |
| Founder Flag v6.0 | 6 | `report_task_0_1_founder_flag.md` |
| Модуль «Електронний суд» 0.2 / Recon 0.3 | 6 (без bump) | `report_task_0_2_court_sync_infrastructure.md`, `report_task_0_3_ecits_reconnaissance.md` |
| addedBy Semantic Cleanup v6.5 | 6 → 6.5 | `report_task_0_3_4_addedby_cleanup.md`, `TASK_0_3_4_addedby_cleanup.md` |
| Canonical Schema v7 (ЄСІТС) | 6.5 → 7 | `report_task_0_3_5_canonical_schema_v7.md`, `TASK_0_3_5_canonical_schema_v7.md`, `audit_before_task_0_3_5.md`, `audit_review_task_0_3_5_draft.md` |
| TASK A — конвертація форматів у PDF | без bump | `report_pdf_conversion_task_a.md`, `report_docx_html_format_analysis.md`, `consultation_pdf_*.md` |

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
- `addedBy`: user | agent | system (актор; з TASK 0.3.4 v6.5 — НЕ плутати з `source`)
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

| Точка | Файл | addedBy (з TASK 0.3.4 v6.5) |
|-------|------|------------------------------|
| DocumentProcessor основна обробка | `DocumentProcessor:804-822` | `user` |
| DocumentProcessor split PDF | `DocumentProcessor:955-963` | `user` |
| CaseDossier модаль "+ Додати документ" | `CaseDossier:2452-2486` | `user` |
| CaseDossier drag-n-drop drop queue | `CaseDossier:1940-2010` | `user` (через `executeAction` update_case_field — тимчасово, окремий ACTION у запланованому TASK) |
| INITIAL_CASES (seed Брановський) | `App.jsx:100-113` | `system` |

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

## TASK 0.3.4 — ADDEDBY SEMANTIC CLEANUP v6.5

**Дата:** 2026-05-14
**schemaVersion:** 6 → 6.5
**settingsVersion:** "6.5_addedby_cleanup"
**Тип:** точкова чистка перед TASK 0.3.5 (canonical schema bump v7 для ЄСІТС)

### Призначення

Розщеплення `document.addedBy` і `document.source` як двох незалежних полів за правилом #11 (DEVELOPMENT_PHILOSOPHY.md — одне ім'я, один сенс). До TASK 0.3.4 обидва поля містили значення `'ecits'`, що порушувало однозначність — агент не міг визначити "звідки документ".

### Зміни enum addedBy

Old (5 значень з перекриттям): `['lawyer_via_dp', 'lawyer_manual', 'agent', 'ecits', 'migration']`
New (3 значення без перекриття): `['user', 'agent', 'system']`

Маппінг при міграції:
- `lawyer_via_dp`, `lawyer_manual` → `user`
- `agent` → `agent` (без зміни)
- `ecits`, `migration` → `system`
- невідоме значення → `user` з warning у консоль

`documentFactory.createDocument` нормалізує legacy значення через `normalizeAddedBy()` — safety net якщо десь у коді ще залишилось старе значення.

### Number 6.5 як schemaVersion

Точкова чистка не претендує на повний bump v7. Number 6.5 (не string "6.5") працює правильно з `<` порівнянням у App.jsx EFFECT-A. Перевірено: жодне порівняння `=== 6`, жодне `Number.isInteger(schemaVersion)` у коді відсутнє.

### ADDEDBY VS SOURCE — DISAMBIGUATION

Два паралельні поля документа відповідають на РІЗНІ питання:

**`document.addedBy`** — ХТО/ЩО зробило акт додавання запису в систему (actor):
- `user` — адвокат чи помічник вручну (через UI або модалку)
- `agent` — AI-агент (QI, Dossier, DocumentProcessor)
- `system` — системна дія (міграція, автоматична синхронізація)

**`document.source`** — ЗВІДКИ прийшов файл (канал походження). Поки TASK 0.3.5 не пройшов:
- `manual_upload` — завантажено локально
- `ecits` — з ЄСІТС-кабінету (нормалізується на `court_sync` у TASK 0.3.5)
- `telegram` — з Telegram
- `email` — з email
- `null` — невідомо

Приклади однозначних комбінацій:
```
{ addedBy: 'system',  source: 'ecits' }         — система додала автоматично з ЄСІТС
{ addedBy: 'user',    source: 'manual_upload' } — адвокат завантажив локально
{ addedBy: 'agent',   source: 'telegram' }      — агент обробив документ з Telegram
{ addedBy: 'user',    source: 'email' }         — адвокат вручну зберіг з email
```

### Заборонено

- НЕ повертати legacy значення `lawyer_via_dp` / `lawyer_manual` / `ecits` / `migration` у новий код. `normalizeAddedBy` їх переведе, але це signal про необхідність ревізії точки створення документа.
- НЕ використовувати `addedBy` для перевірки "звідки прийшов файл" — для цього є `source`.
- НЕ розширювати `addedBy` enum без bump'у схеми — це signal про порушення правила #11.

---

## TASK 0.3.5 — CANONICAL SCHEMA V7 ДЛЯ ЄСІТС

**Дата:** 2026-05-14
**schemaVersion:** 6.5 → 7
**settingsVersion:** "7.0_ecits_canonical"
**Тип:** інфраструктурний — підготовка канонічної схеми до прийому даних з ЄСІТС-кабінету та інших каналів

### Принцип

Обидва канали (Court Sync через Claude for Chrome і Metadata Extractor для не-ЄСІТС каналів) пишуть у **ТУ САМУ канонічну схему** через **ТІ САМІ ACTIONS**. Споживачі (картка справи, дашборд, білінг, агенти) не розрізняють джерело — працюють зі стабільною схемою. `source`-мітка зберігається для аудиту і пріоритетизації при конфліктах.

### Розширення схеми

**document (+5 полів):** `sourceConfidence`, `extractedAt`, `ecitsSource`, `movementCard`, `alternativeSources`. `source` enum переіменовано: `manual_upload→manual`, `ecits→court_sync`, додано `metadata_extractor`/`unknown`.

**case (+3 поля):** `ecitsState` (з `syncMetrics` counters), `parties[]`, `processParticipants[]`. **`team[]` НЕ чіпаємо** — це internal bureau team з permissions (SaaS Foundation v3).

**proceeding (+1 поле):** `composition` (`{ presiding, reporter, members[] }`).

**hearing (+6 полів):** `source`, `sourceConfidence`, `extractedAt`, `ecitsContext`, `assignedTo`, `attendedBy[]`. `add_hearing` і `update_hearing` приймають їх backward-compat (warning якщо source не передано).

**user (+1 поле):** `ecitsCabinetIdentifier` (multi-user dedupe у Court Sync).

### Source-policy (sourcePolicy.js)

`SOURCE_PRIORITY`: `manual` (100) > `court_sync` (80) > `metadata_extractor` (60) > `telegram`/`email` (50) > `unknown` (10). `canOverwrite(existingSource, newSource)` повертає true якщо новий має вищий пріоритет. У майбутньому SaaS може стати tenant-scoped.

### Нові ACTIONS (8)

**Sync:**
- `mark_synced_from_ecits({caseId, status, durationMs, documentsCount, hearingsCount})` — інкрементує `syncMetrics`, публікує `ecits.sync_completed`
- `update_case_ecits_state({caseId, patch, source})` — мерджить patch з `canOverwrite`-перевіркою, публікує `ecits.case_state_updated`

**Edit (R1 AI-first дзеркало):**
- `update_parties({caseId, parties, source})` — replace-all
- `update_team({caseId, team})` — internal bureau, без source
- `update_process_participants({caseId, participants, source})` — replace-all
- `update_proceeding_composition({caseId, proceedingId, composition, source})`
- `update_document_movement_card({caseId, documentId, movementCard, source})`
- `update_alternative_sources({caseId, documentId, alternativeSource})` — append

Усі публікують відповідну подію в eventBus з `tenantId` у payload (multi-tenant SaaS-готовність).

### PERMISSIONS — дві нові ролі

- **`court_sync_agent`** — defined і enabled. Дозволено: `add_hearing`, `update_hearing`, всі 8 нових ACTIONS. Заборонено: `destroy_case`, `add_document`, `update_document`, `delete_document`, `create_case`.
- **`metadata_extractor_agent`** — defined але DISABLED через порожній allowlist `[]`. Активація — окремим TASK у майбутньому.

### Billing — нові ACTIONS не в білінг

`SYSTEM_ACTIONS_NO_BILLING` Set винесено з inline-list. Включає: `mark_synced_from_ecits`, `update_case_ecits_state`. Edit-ACTIONS (`EDIT_ACTIONS_SOURCE_AWARE`) — нараховуються тільки якщо `source === 'manual'` (адвокат через UI/агента редагує). Викликані з `court_sync` чи `metadata_extractor` — НЕ нараховуються (автосинхронізація не робота адвоката).

### AI-First дзеркало

6 нових edit-ACTIONS закривають AI-first порушення R1: всі нові v7 поля (parties, team, processParticipants, composition, movementCard, alternativeSources) мають ACTIONS для редагування. Адвокат може через діалог з агентом сказати "додай сторону", "познач склад суду", "запиши що той самий документ прийшов з телеграму" — все є.

### Tracking debt

Поля `case.client` (string) і `proceeding.judges` (string) залишаються як **denormalized summary** для UI рендерингу. Real source — `parties[]` і `composition`. Backfill — окремий майбутній TASK (читає parties, генерує summary). UI не змінюється поки backfill не зроблено.

### Заборонено

- НЕ створювати ACTIONS відкладені (`add_timeline_event`, `update_case_dnzs`) — це наступні TASK.
- НЕ активувати `metadata_extractor_agent` (тільки defined).
- НЕ міняти семантику `case.team[]` — це internal bureau, окрема структура від `processParticipants[]`.
- НЕ перейменовувати `client` / `judges` — denormalized залишається до окремого backfill TASK.
- НЕ використовувати `update_case_ecits_state.patch` для не-`ecitsState` полів (для них окремі ACTIONS).

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

## TASK A — КОНВЕРТАЦІЯ ФОРМАТІВ У PDF В AddDocumentModal

**Дата:** 2026-05-12
**Без bump schemaVersion** — додано nullable поля (за прецедентом `source`)

### Принцип

PDF — єдиний формат для відображення в системі. DOCX/HTML/зображення конвертуються у PDF при додаванні через AddDocumentModal. Pipeline: device file → converterService.convertToPdf → PDF Blob → upload у 01_ОРИГІНАЛИ.

### Розділення text-extracted (DOCX/HTML) і OCR-pipeline (PDF/image)

Документи бувають з готовим текстом (DOCX через mammoth, HTML через innerText) і без (скани/фото/неоднозначний PDF). Дві різні гілки після конвертації:

**DOCX/HTML — текст уже витягнуто конвертером:**
- `docxToPdf` валідує ZIP-сигнатуру (`PK\x03\x04`) і кидає чесну помилку для пошкодженого / не-DOCX файлу. Викликає `mammoth.extractRawText` + `mammoth.convertToHtml` паралельно. Якщо текст < 50 символів — кидає помилку «не містить тексту».
- `htmlToPdf` валідує перші байти на бінарні сигнатури (PNG/JPEG/PDF/ZIP/GIF/WEBP) і кидає помилку якщо файл — не HTML. Декодує charset, виділяє body, бере `container.innerText`. Якщо < 30 символів — помилка.
- Фасад прокидає `extractedText` у контракті результату.
- CaseDossier пише його у `02_ОБРОБЛЕНІ/<basename>_<driveId>.txt` через `ocrService.writeExtractedTextArtifact` і **пропускає** `runOcrWithRetryUI`. Document AI не викликається. `.layout.json` не пишеться (pageStructure у DOCX/HTML немає за визначенням).
- `documentNature = 'searchable'` встановлюється явно для цієї гілки.

**PDF/image — текст витягується OCR-pipeline як раніше:**
- pdfjsLocal → documentAi (для PDF), documentAi напряму (для зображень). `extractedText` у конвертації null.
- Document AI генерує `.txt` і `.layout.json` у 02_ОБРОБЛЕНІ.

### Помилки конвертації — модалка лишається відкритою

Якщо `convertToPdf` кидає (валідація провалена, mammoth впав, файл порожній), AddDocumentModal:
- Показує адвокату чесний `toast.error` з описом
- НЕ закриває модалку (адвокат бачить що файл потрібно замінити)
- НЕ створює документ у реєстрі
- НЕ пише файли на Drive

Той самий принцип для помилки `uploadFileLocal` для основного PDF — кидаємо наверх. Помилка завантаження `originalBlob` (DOCX поряд) — НЕ критична (PDF уже на Drive, документ створюється без `originalDriveId`, адвокат бачить warning toast).

### Канонічна схема — нові поля (23 загалом)

- `originalDriveId` — Drive ID оригіналу (DOCX) поряд з PDF. null для PDF/HTML/image.
- `originalMime` — MIME-тип оригіналу до конвертації.

Обидва nullable, default null. Старі документи отримують null автоматично.

### Provider Pattern для конвертації

`src/services/converter/` — фасад `converterService.convertToPdf(file, context)` маршрутизує за MIME-типом:

| Тип | Конвертер | Збереження |
|-----|-----------|------------|
| PDF | passthrough | як є у 01_ОРИГІНАЛИ |
| HTML | `htmlToPdf.js` (html2pdf.js + charset detection) | тільки PDF |
| DOCX | `docxToPdf.js` (mammoth → html2pdf.js) | PDF + DOCX як originalDriveId |
| image | `imageToPdf.js` (Canvas + jsPDF) | тільки PDF |
| HEIC | `heicToJpeg.js` → imageToPdf.js | тільки PDF |

Контракт результату: `{ pdfBlob, originalBlob, pdfName, originalName, originalMime, warnings, converter, durationMs }`.

### Feature flag CONVERT_DOCX_TO_PDF

У `src/services/converter/converterService.js`. Default `true`. Якщо `false` — DOCX залишається як є (Viewer через DocxRenderer + mammoth). Відкат при проблемах якості html2pdf.js без переписування коду.

### UI flow AddDocumentModal (TASK A.5)

Двостадійний:
1. **Стартовий екран** — дві кнопки: «📄 Додати файл» (single) і «🖼 Склеїти зображення» (плейсхолдер TASK B з повідомленням «Доступно у наступній версії»).
2. **Форма** — після кліку «Додати файл». Назва автозаповнюється з імені файлу без розширення. Кнопка «Назад» повертає на стартовий екран.

### Оптимізація layout.json (TASK A.6)

`ocrService.serializeLayout` фільтрує два поля з кожної сторінки Document AI перед записом у `.layout.json`:
- `image` (base64 PNG-рендер, ~5-7 МБ) — дублює оригінал у 01_ОРИГІНАЛИ
- `tokens` (координати окремих літер) — майбутні модулі працюють на рівні paragraphs/blocks

pageStructure у пам'яті залишається повним. Очікуване зменшення: ~7 МБ → ~100-500 КБ на сторінку.

### resolveModel для майбутнього TASK B

`modelResolver.SYSTEM_DEFAULTS.imageSorter = 'claude-sonnet-4-20250514'` — точка для імеджесортера у TASK B (склейка кількох зображень у один PDF з виявленням підмінених сторінок).

### Залежності додано

- `html2pdf.js` (~286 KB gzip, lazy-loaded chunk)
- `jspdf` (~ всередині html2pdf.js, тепер прямий dep)
- `heic2any` (~341 KB gzip, lazy-loaded — тільки при HEIC)

Усі через `import()` — bundle не тягне їх при старті аппки.

### Заборонено

- НЕ створювати документ обходом `converterService.convertToPdf` коли є можливість конвертації.
- НЕ зберігати HTML і зображення-оригінали поряд з PDF — тільки PDF (HTML/image оригінал «всередині» PDF).
- НЕ повертати TASK B логіку (склейка зображень) — це окремий TASK з агентом сортування.
- НЕ змінювати `CONVERT_DOCX_TO_PDF` через UI — це константа коду, зміна потребує деплою.
- НЕ викликати Document AI на конвертованому з DOCX/HTML PDF — текст уже витягнуто mammoth/innerText, OCR на render-PDF дав би гірший результат і даремну витрату токенів.
- НЕ продовжувати pipeline (`createDocument` + `add_document`) якщо `convertToPdf` кинув — модалка лишається відкритою, документ не створюється.

---

## SMART TRIAGE BUGFIX (G0–G6) — 2026-05-19

Після Ф0–Ф3 реальний прогон Брановського (1×65-стор. скан-PDF, 21МБ, ~46 хв)
виявив 7 знахідок. Ручний аудит коду (не тести) → фази зі STOP. Деталі —
`docs/reports/report_smart_triage_bugfix.md`.

### Корені (по коду)

- **bug 2** (TXT змішаний): `writeProcessedArtifacts` писав текст УСЬОГО
  файла у кожен зріз — текст не різався взагалі (PDF різався правильно).
- **bug 1** (дублі реєстру): `findDuplicate` бачив лише заморожений
  `ctx.job.caseData` (same-job повтори невидимі) + Triage над-сегментував
  ті самі сторінки кількома документами; дедуп лише за назвою.
- **bug 6/7** (прогрес фризнув / «Стадія: processing»): `reportProgress`
  лише в chunk-OCR + хардкод `stage:'processing'`; пост-OCR (Triage+PERSIST,
  30+ хв) прогрес не емітив.
- **bug 3** (46 хв): `buildDocumentPdf` слав повний 21МБ буфер у `splitPdf`
  окремо на кожен документ → pdf-lib re-parse ~25-30×.
- **bug 4**: generic-промпт Triage без українських судових патернів.

### Принцип фіксів

Диригент заморожений — розширення лише через `deps`-хуки (OCP):
`onStage`/`onStageEnd`/`onSubProgress` додані в наявний цикл диригента,
**STAGE/`DEFAULT_STAGE_ORDER`/Object.freeze незмінні, нова стадія НЕ
додавалась**. Схема документа без bump: `route`/план — транзит у `ctx`;
`stageLabel`/`subDone`/`timings` — transient UI-стор `jobProgressStore`
(як eventBus, поза App SSOT).

### Ключові зміни

- `src/services/documentPipeline/stageLabels.js` — НОВИЙ чистий примітив:
  технічна назва стадії → людський підпис (frozen).
- `documentPipeline.js` — `deps.onStage(name)` перед стадією +
  `deps.onStageEnd(name, ms)` після (ізольовані try/catch).
- `streamingExecutor.js` — інжектує onStage/onStageEnd/onSubProgress у
  pipeDeps (executor володіє прогресом, як `reportProgress`); OCR-фаза →
  «Розпізнавання тексту · блок X з Y».
- `splitDocumentsV3.js`:
  - **page-precise**: `sliceProcessedArtifacts` ріже `pages[..]._text` +
    layout по фрагментах документа; гейт `isPagedLayout` → інакше цілий
    текст + `text_slice_fallback` decision.
  - **same-job дедуп**: `registryView()` = знімок-реєстр ∪ `newDocuments`.
  - **G4 hot path**: `precutSources` — `splitPdf` ОДИН раз на джерело з
    усіма діапазонами (вихід по-діапазонно байт-еквівалентний).
- `triageStage.js` `normalizePlan` — `resolveOverlaps`: детермінований
  дедуп перекритих `[fileId,start..end]`, пріоритет route (реальний
  документ > службове > discard — анти-«тиха втрата»), `dedupDropped` у
  decision.
- `triagePrompt.js` — українські судові патерни (квитанція судового збору
  ЗАВЖДИ окремий документ; обкладинка→to_fragments; СКИДАННЯ-НУМЕРАЦІЇ =
  сильна межа). Структурний тест, НЕ snapshot `documentBoundary/prompt.js`.
- `ProgressFullScreen.jsx` — людський підпис + окремий тонкий під-бар.

### Тести / інваріанти

101 файл / 1349 зелених, build зелений. Кожен маршрут/фікс —
Provider-integration через справжній заморожений диригент (обмеження
§2.1). `documentBoundary/prompt.js`-снапшот не дрейфував.

### Поза скоупом → `tracking_debt.md`

Bug 5 (перемикач PDF/Текст у в'юері CaseDossier — окрема UI-задача);
інтеграція `cleanForReading` зі slice (Варіант 1/2/3 — відкладене рішення
адвоката, зараз slice бере сирий per-page `_text`). Орфан-PDF попередніх
спроб у `01_ОРИГІНАЛИ` — одноразове ручне прибирання перед наступним
прогоном (pipeline їх не імпортує — операційна нотатка у звіті, не борг).

---

## DP layout-leak + speed fixes (Phase A) — B1 / B2 / B3 (2026-05-20)

**Корінь з реальних даних:** форензичний аналіз `.layout.json` адвоката
(справа Брановського, тест на планшеті 17:14-17:28) показав файл 14 MB
замість очікуваних ~400 KB: `image` 80.7% + `tokens` 16.4% = 97% марного
баласту проходить strip. На 25 документів = **~350 МБ серіальних Drive
uploads** = 5-15 хв «висить на 100% майже готово» з тихим catch.

**Точна точка обходу:** `DocumentPipelineContext.jsx:219-227` робив
`JSON.stringify(layoutJson)` ПЕРЕД `ocrService.writeLayoutArtifact`, який
очікує **об'єкт** для проходу `STRIPPED_LAYOUT_FIELDS=['image','tokens']`.
На string strip не запрацював.

### Зроблено (Фаза A)

- **B1 — layout-strip leak** (комiт `2af822f`): `writeLayoutArtifact` тепер
  приймає тільки об'єкт і САМА робить strip+serialize; string-вхід
  відхиляється з warning. Прибрано `JSON.stringify` у Provider-injectorі.
  `CaseDossier:3025-3037` парсить `mergeLayoutJson` string у об'єкт.
- **B2 — `documentNature='scanned'` на нарізаних** (`8bc53b9`): нова
  `inferDocumentNatureFromSource` у `splitDocumentsV3` — якщо джерело має
  непорожній `layoutJson.pages` (OCR відбувся) → `documentNature:'scanned'`.
  Пробрасується через `metadataTemplate`. Пріоритети: explicit > layout
  signal > null fallback. Корінь зниклого перемикача Скан/Текст.
- **B3 — image_merge graceful failure** (`345f034`): throw у image_merge
  маршруті → `decisions.push({type:'image_merge_failed', documentName, message})`
  + `continue`. Більше НЕ валить інші документи. `splitDocumentsV3.js:266-280`.

### Тести / інваріанти

1392 / 1392 зелені (було 1374, +18 нових — 11 unit + 7 integration). Кожен
баг покрито Provider-integration тестом через справжній
`DocumentPipelineProvider` (інституційне обмеження TASK_smart_triage §2.1).
Компактний паспорт, моделі, Triage, OCR, диригент, схема — НЕ змінені.

### Підтверджено на реальних даних (Брановський, планшет, два прогони)

| Метрика | До | Після | Множник |
|---|---|---|---|
| Розмір `.layout.json` / стор. | ~1800 KB | ~37 KB | ×48 |
| Розмір файлу на 8 стор. | 14 MB | 300 KB | ×47 |
| Зависання «100% майже готово» | 5-15 хв | ~10 сек | — |
| End-to-end на 65 стор. → 25 docs | ~15-50 хв | **5-6 хв** | ×3-10 |
| Якість нарізки (за оцінкою адвоката) | — | 85-90% | — |

### Поза скоупом → `tracking_debt.md`

#17 HEIC→JPEG передобробка перед image_merge (тригер: ≥2 повторних
`image_merge_failed` на HEIC/PDF image-only). #18 Подвійна риска
прогрес-бару у `GlobalProgressScreen.jsx` (UI cosmetic, наступне суттєве
редагування файла). #19 Збагачений дайджест паспорта D1 (тригер: якщо
після Фази B + ФД-4 propose→confirm якість лишається <90%).

### Phase B — НЕ розпочата

Перформанс-оптимізації P1-P4 (паралельний PERSIST через `Promise.all`,
debounce registry-save, Drive API explicit timeout, jobState throttle) —
спека у тому ж файлі `TASK_dp_layout_leak_and_speed_fixes.md` §4. Для
великих 200-250-сторінкових томів з очисткою/стисненням майбутнього
функціоналу. Окрема сесія.

---

## DP layout-leak + speed fixes Phase B → REVERT (regression, 2026-05-20)

**Стан:** Phase B було реалізовано (гілка `claude/optimize-dp-pipeline-phase-b-Sw2NH`,
коміти `be5c944`/`5280fcd`/`fa3839e`/`eca8f9e`/`7491b92`), пройшло 1423/1423
тестів, запушено в main FF (`dd4569d..7491b92`), задеплоено на Pages.

**Регресія на планшеті адвоката:** нарізка пішла у passthrough — уся
65-сторінкова справа лягла одним документом, перемикач Скан/Текст
зник (`documentNature=null` бо нарізка не виконалась). Швидкість при цьому
дала виграш ×2 (2-3 хв замість 5-6).

**Revert:** 5 revert-комітів (`b6b8e62`/`2a70949`/`495ec56`/`de12853`/`88ddd09`)
повернули main на функціональний стан `dd4569d` (Phase A). Тести 1392/1392
зелені після revert (точне число до Phase B). Адвокат підтвердив прогон на
планшеті: нарізка повернулась, **якість виросла відносно попередніх
прогонів** (28 у плані → 26 у реєстрі; 1 — decision дедупу через
`findDuplicate`; 1 — ймовірно image_merge_failed graceful skip; 5 хв).

**Гілка Phase B збережена на origin** недоторкана (`7491b92`) — для
майбутнього forward-fix і пост-mortem діагностики.

### Гіпотеза кореня (поки не верифікована)

Найімовірніший винуватець — **P1** (єдиний з P1-P4, що суттєво змінив
логіку нарізки `splitDocumentsV3.js`). Дві окремі гіпотези, треба
розрізнити Provider-integration тестом з реалістичним 25-doc планом:

1. **Dedup-race у двофазному PERSIST.** P1 розбив plan-loop на CPU-prep
   серіально + Drive I/O паралельно, з новим `registryView() ∪ pendingInBatch`
   дедупом. Гіпотеза: дедуп помилково ловить нарізані документи як
   дублікати (можливо через спільні базові імена чи pageCount-збіг
   усередині одного джерела), CPU-prep скіпає усі, branch A повертає
   `ok:true` з 0 documents, нижче спрацьовує passthrough fallback.
2. **Зміна error-contract.** Старий код повертав `{ok:false, error}` з
   throw напряму → стадія FAIL → pipeline terminate. Новий код агрегує
   `stageError` через `runWithConcurrency` `__error` протокол, потім
   `if (stageError) return {ok:false, error}`. Можливо десь у тракті
   `stageError` не виставився при якомусь edge-case, branch A повернула
   `ok:true` без створених documents, pipeline продовжився до branch B.

### Чому 1423 тестів не зловили

Інституційне обмеження №1 батьківського TASK_smart_triage прямо
попереджало: «стадія в ізоляції зелена, реальний Provider тихо падає у
passthrough — точка зламу DP-4». Інтеграційний тест P1 (`tests/integration/
dp-persist-concurrency.test.js`) перевіряв concurrency-ліміт (пік ≤5
одночасних upload), але **не перевіряв якісно** «після Provider-DP run з
реалістичним 25-doc планом — усі 25 документів справді створені і не
зведені у passthrough». Forward-fix Phase B v2 ОБОВ'ЯЗКОВО має такий тест.

### Поза скоупом → `tracking_debt.md` #20

Phase B forward-fix (P1 dedup race / error-contract діагностика +
forward-fix + Provider-integration тест 25-doc плану). Тригер активації —
коли потрібна додаткова швидкість на великих томах і є час на діагностику
з реалістичним Provider-integration тестом.

---

## TASK ToC + Enriched Digest — DP якість нарізки на великих томах (2026-05-22)

**Спека:** `docs/tasks/TASK_dp_toc_and_enriched_digest.md`.
**Передумова:** `docs/diagnostics/diagnostic_dp_large_volume_test.md` —
реальний прогон на Нестеренко Том 1 (273 стор., крим. провадження) дав
**35% точність нарізки** (26/74), 48 реальних документів викинуто.
Брановський 65 стор. — ~85-90% (стабільно).
**Звіт:** `docs/reports/report_task_dp_toc_and_enriched_digest.md`.

### Корінь падіння якості (з діагностики)

1. **ФД-1.1 «адаптивна щільність»** вимикає тіло тексту на томах >100 стор.
   Triage отримує лише краї коротких документів — не розрізняє «продовження»
   від «початок нового».
2. **Сигнали з Document AI ВЖЕ збережені** у layout.json, але не доходять
   до Triage: `visualElements`, `imageQualityScores`, к-сть `blocks`,
   `detectedLanguages`, `tables[].boundingPoly` (table-coverage),
   `paragraphs[].layout.confidence`.
3. **Промпт Triage не знає про реєстр/опис матеріалів справи** —
   обов'язкова таблиця на перших сторінках більшості томів з готовим
   планом нарізки.

### ДВІ ГІЛКИ — рішення

**Гілка A — ToC детектор** (`src/services/documentBoundary/tocDetector.js`,
ФД-T1 + ФД-T2):

Препроцесор УСЕРЕДИНІ `triageStage` (НЕ нова стадія — обмеження №4):

```
files.length===1 + PDF + pageCount>=10 + layout
  → Крок 1: Haiku detect (перші ~5 стор. → isRegistry, registryPages, firstDocumentPage)
  → Крок 2: Haiku parse (registryPages → items[{n,name,startLeaf,endLeaf}])
  → Крок 3: validate (overlap, range_overflow, coverage ±5%, offset)
  → план route='slice' confirmed:true source:'toc_detector' → bypass AI Triage
```

Загальне правило (крим/цив/адмін): AI читає заголовок САМ (без жорсткого
keyword-списку); заголовок реєстру може варіюватись («Опис документів»,
«Реєстр матеріалів», «Перелік», «Зміст тома», «Опис вкладень» — невичерпно).

Зміщення нумерації: `firstDocumentPage` → `offset = fdp-1`; `null` →
fallback `offset = max(registryPages)` (стандартний випадок укр. практики).

Будь-яка помилка → `{isToc:false, reason}` без throw → fallback на AI
Triage з збагаченим дайджестом.

Білінг §12: дві операції `toc_detect` і `toc_parse` через
`logAiUsageViaSink` + `activityTracker.report` (`module:DOCUMENT_PROCESSOR`).
Чистий ефект: +1 Haiku-виклик коли реєстр знайдено, але результат
deterministic замість евристичного.

**Гілка B — Збагачений compactDigest** (`src/services/documentPipeline/pageMarkers.js`,
ФД-D1 + ФД-D2 + ФД-D2.5):

Розширення `compactDigest` 11 новими сигналами (5 з боргу #19 D1 +
6 з TASK ToC §4):

| Сигнал | Категорія | Джерело | Поведінка |
|--------|-----------|---------|-----------|
| `печатка/підпис:stamp` | ДОРАДЧИЙ | `visualElements[].type` | додає тег |
| `стрибок-якості:Δ0.XX` | ДОРАДЧИЙ | `qualityScore` delta vs prev | додає тег |
| `розріджена` | ДОРАДЧИЙ | <=2 blocks + <=200 chars _text | додає тег |
| `зміна-формату` / `зміна-орієнтації` | ДОРАДЧИЙ | dimension/orientation delta vs prev | додає тег |
| `зміна-мови:uk→en` | ДОРАДЧИЙ | detectedLanguages[0] delta | додає тег |
| `таблиця-домінює:XX%` | ДОРАДЧИЙ | tables[].boundingPoly ≥40% | додає тег + кандидат для ToC |
| `ЯКІР-ДОКУМЕНТА` | **СИЛЬНИЙ** | heading містить слово з UA_DOC_HEADERS (20 слів) | один з достатніх для межі |
| `док-стор:N/M` | ДОРАДЧИЙ | внутрішня нумерація «1 з 9» / «1/9» / «Page 1 of 9» / «-1-» | передає довжину документа |
| `ПОЧАТОК-ДОКУМЕНТА` | **СИЛЬНИЙ** | внутрішня нумерація current==1 | один з достатніх для межі |
| `КІНЕЦЬ-ДОКУМЕНТА` | **СИЛЬНИЙ** | внутрішня нумерація current==total | один з достатніх для межі |
| `продовження-абзацу` | **СИЛЬНИЙ-АНТИ** | prev tail БЕЗ крапки + next head з малої | НЕ ставити межу (експертна евристика) |
| `можливий-абзацний-розрив` | ДОРАДЧИЙ | prev tail з крапкою + next head з ВЕЛИКОЇ | слабкий сигнал на користь межі |
| `дефекти-зміна` | ДОРАДЧИЙ | detectedDefects[] змінився vs prev | сильніше за один qualityScore |
| `OCR-низька:0.XX` | МЕТА | avg paragraph.layout.confidence <0.7 | не сигнал межі — попередження |

UA_DOC_HEADERS (20 слів): ПОСТАНОВА, УХВАЛА, РІШЕННЯ, ВИРОК, ВИСНОВОК,
ПРОТОКОЛ, АКТ, ЗАЯВА, ПОЗОВНА, ДОВІДКА, СВІДОЦТВО, ДЕКЛАРАЦІЯ, ДОГОВІР,
ОРДЕР, КЛОПОТАННЯ, СКАРГА, ВИМОГА, ПОВІДОМЛЕННЯ, ВИТЯГ, ЛИСТ.

**Промпт Triage** (`src/services/documentBoundary/triagePrompt.js`,
ФД-D3) — інструктує зважувати сигнали РАЗОМ; категорії за силою:

- СИЛЬНІ (один достатній для висновку про межу): ПОЧАТОК-ДОКУМЕНТА,
  КІНЕЦЬ-ДОКУМЕНТА, СКИДАННЯ-НУМЕРАЦІЇ, ЯКІР-ДОКУМЕНТА.
- СИЛЬНІ-АНТИ (один достатній щоб НЕ ставити межу — поважай):
  продовження-абзацу.
- ДОРАДЧІ (одного недостатньо, шукай комбінацію 2+): печатка/підпис,
  стрибок-якості, дефекти-зміна, розріджена, зміна-формату/орієнтації/мови,
  док-стор:N/M, таблиця-домінює, можливий-абзацний-розрив.
- МЕТАІНФОРМАЦІЯ (НЕ сигнал межі — попередження): OCR-низька.

Старий `documentBoundary/prompt.js` (single-PDF slice snapshot) НЕ
зачеплений (обмеження №2 §13 батьківського TASK).

### Захист B1 — розширення STRIPPED_LAYOUT_FIELDS (ФД-D2.6)

Профілактично стрипати з .layout.json ще 3 важкі поля Document AI що не
використовуються ні Triage, ні очисткою, ні в'юером:

- `symbols` — per-character деталі (ще важчі за tokens).
- `detected_barcodes` — деталі баркодів.
- `transforms` — трансформаційні матриці.

Регрес-страж `tests/integration/dp-layout-size.test.js`: реалістичний
layout з усіма важкими полями + новими D1/D2 сигналами + 40 paragraphs/
блоків/dimension/visualElements — записаний `.layout.json` ≤100KB/стор.,
економія vs raw JSON.stringify ≥8×.

### Архітектура preservation (інституційні обмеження)

- **#1 Provider-integration тест якісної поведінки** — головна вимога.
  Реалізовано: `dp-toc-detector.test.js` (5 тестів, 30-doc реєстр),
  `dp-enriched-digest.test.js` (2 тести, 25-doc план через справжній
  Provider — той тип тесту що НЕ було для Phase B P1),
  `dp-branovsky-quality.test.js` (2 regression тести, 24-doc план з
  ground truth, ЯКОРІ + ПОЧАТКИ + КІНЦІ у паспорті).
- **#2 prompt.js snapshot** не дрейфує (підтверджено `git diff main`).
- **#4 Диригент заморожений** — ToC препроцесор УСЕРЕДИНІ triageStage,
  НЕ нова стадія. `DEFAULT_STAGE_ORDER` незмінний.
- **#5 Без зміни схеми** — ToC plan транзитний у `ctx.reconstructionPlan`,
  не персиститься, без bump schemaVersion / міграції / бекапу.
- **#11 Один сенс на ім'я** — `tocDetector` (читати готовий план з тома),
  `taблиця-домінює` (частка площі під таблицями), `ЯКІР-ДОКУМЕНТА` (новий
  документ за типовим заголовком), `продовження-абзацу` (анти-межа).
- **№7 Без активації metadata_extractor_agent**; **№10 SAAS і BILLING
  IMPLICATIONS** у звіті ФД-Z.

### Метрики (mock + baseline)

| Метрика | Baseline (diagnostic) | Після TASK ToC | Очікувано на реальному прогоні |
|---------|----------------------|----------------|-------------------------------|
| Брановський 65 стор. (без реєстру) — точність | ~85-93% | mock 100% (24/24) | ≥85% (paritет з baseline або кращим) |
| Нестеренко 273 стор. (з реєстром) — точність | **~35% (26/74)** | mock 30/30 → 100% коли реєстр знайдено | ≥80% (ціль) або ~100% якщо реєстр повний |
| AI calls на томах з реєстром | 1 Triage | 2 Haiku (toc_detect + toc_parse, без Triage) | Haiku ~1-3¢, deterministic план |
| AI calls на томах без реєстру | 1 Triage | 2 Haiku (toc_detect:false → Triage) | Один зайвий Haiku, але збагачений дайджест компенсує |
| Розмір .layout.json | ≤100KB/стор. (B1) | ≤100KB/стор. (страж укріплено) | без змін |
| Тестів | 1392/1392 | 1479/1479 | — |

### Поза скоупом → `tracking_debt.md`

Закриті борги:
- **#19** — Збагачений дайджест паспорта меж D1 + сильні сигнали D2/D2.5.
  Закритий цим TASK (commits 8f1ed8d, bd3263e).
- **#21** — Детектор реєстру/опису матеріалів справи. Закритий цим TASK
  (commits 51ea758, 0d3c165).

### Реальний прогон — STOP #2 (обов'язково перед FF у main)

Гілка `claude/toc-parser-enriched-digest-ccuCK` запушена; чистий FF у
main можливий тільки після підтвердження адвоката, що:
1. Брановський 65 стор. → точність ≥85% (паритет з baseline або краще).
2. Нестеренко Том 1 273 стор. → точність ≥80%, реєстр знайдено, ≥59/74
   документів (ідеально — точно 74 з реєстру).
3. Час обробки не виріс (Брановський ≤6 хв, Нестеренко ≤22 хв).
