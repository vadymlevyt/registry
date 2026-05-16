# AUDIT — Стан системи перед TASK 0.4 (Court Sync MVP)

**Тип:** read-only зріз. Жодного коду не змінено. Знахідки фіксуються тут, виправлення — окремими TASK.
**Дата:** 2026-05-16
**Базова точка:** TASK 0.3.5 (canonical schema v7). Після неї пройшла серія підготовчих TASK для DP v2.
**HEAD:** `985de03` (TASK 5: extract ACTIONS/PERMISSIONS/executeAction to actionsRegistry.js)

> ⚠️ Найважливіше з першого рядка: **schemaVersion у коді = 8**, не 7 (CLAUDE.md ще каже 7 — застаріло). ACTIONS більше не в App.jsx — вони в `src/services/actionsRegistry.js`. Деталі нижче.

Хронологія TASK після 0.3.5 (з git):

| Commit | TASK | Суть |
|--------|------|------|
| `aa4a925` | 0.3.5 | canonical schema v7 для ЄСІТС |
| `b3b847f` | 1 (A) | salvage `compressionService` + `documentBoundary/` зі старого DP |
| `bd9e3bd` | 1 (B/C) | decommission старого DocumentProcessor + versioning |
| `d726d52` | 3 | +2 document-lifecycle eventBus топіки (без publisher'ів) |
| `7198109` | 2 | rename `time_entry.source` → `time_entry.captureMethod`, міграція **v7→v8** |
| `497b580` | 4 | +ACTION `update_document_source` |
| `985de03` | 5 | винос ACTIONS/PERMISSIONS/executeAction → `actionsRegistry.js` (factory) |

---

## 1. ACTIONS

### 1. Де живе реєстр (п.1)

**Більше НЕ в App.jsx.** TASK 5 виніс усе у `src/services/actionsRegistry.js` як factory `createActions(deps)`:

```js
// src/services/actionsRegistry.js:82
export function createActions(deps) {
  const { getCases, setCases, setNotes, setTimeEntries, saveNotesToLS,
          writeAudit, checkTenantAccess, checkRolePermission, checkCaseAccess,
          activityTracker, eventBus, deleteDriveFile,
          deleteOcrCacheForDocument, deleteExtendedForDocument } = deps;
  const ACTIONS = { ... };       // :101
  const PERMISSIONS = { ... };   // :1534
  const executeAction = async (agentId, action, params, userId) => { ... }; // :1625
  return { ACTIONS, PERMISSIONS, executeAction };
}
```

App.jsx інстанціює factory **кожен render** (не сінглтон), прокидає реальні deps:

```js
// src/App.jsx:4743
const { executeAction } = createActions({
  getCases: () => cases, setCases, setNotes, setTimeEntries, saveNotesToLS,
  writeAudit, checkTenantAccess, checkRolePermission, checkCaseAccess,
  activityTracker, eventBus, deleteDriveFile,
  deleteOcrCacheForDocument, deleteExtendedForDocument,
});
```

Чисті залежності (`validateDocument`, `canOverwrite`, `getTimeStandard`, eventBus-топіки, `MODULES`) — прямі `import` у actionsRegistry.js. Стан/сайд-ефекти/permission-заглушки — через `deps`. Тести підставляють ізольовані deps через `tests/integration/_actionsTestSetup.js`.

### 2. Реєстрація нового ACTION (п.2)

Запис у літерал `ACTIONS` всередині `createActions`. Приклад дослівно (`actionsRegistry.js:1210`):

```js
update_case_ecits_state: ({ caseId, patch, source }) => {
  if (!caseId) return { success: false, error: "caseId обов'язковий" };
  if (!patch || typeof patch !== 'object') return { success: false, error: "patch обов'язковий (object)" };
  if (!source) return { success: false, error: "source обов'язковий" };
  const userId = getCurrentUser().userId;
  const tenantId = getCurrentUser().tenantId;
  const timestamp = new Date().toISOString();
  let found = false; let overwriteSkipped = false;
  setCases(prev => prev.map(c => {
    if (c.id !== caseId) return c;
    found = true;
    const existingState = c.ecitsState || {};
    const existingSource = existingState._lastSource;
    if (existingSource && !canOverwrite(existingSource, source)) {
      overwriteSkipped = true; return c;
    }
    return { ...c, ecitsState: { ...existingState, ...patch, _lastSource: source }, updatedAt: timestamp };
  }));
  if (!found) return { success: false, error: `Справу ${caseId} не знайдено` };
  try { eventBus.publish(ECITS_CASE_STATE_UPDATED, { caseId, tenantId, userId,
        fieldsChanged: Object.keys(patch), source, timestamp, overwriteSkipped }); }
  catch (e) { console.warn('[update_case_ecits_state] eventBus publish failed:', e); }
  return { success: true, overwriteSkipped };
},
```

Конвенції: handler синхронний або `async`; повертає `{success:true,...}` / `{success:false,error}`; `caseId` шукається через `getCases().find(...)` (НЕ голий `cases`); мутації — функціональний `setCases(prev => ...)`; eventBus-publish обгорнутий у try/catch.

Нову роль додають у `PERMISSIONS` (той самий файл, :1534). UI-only дії — у `UI_ONLY_ACTIONS` Set (:35).

### 3. Виклик ACTION (п.3)

Сигнатура **незмінна**: `await executeAction(agentId, action, params, [userId])` — async. 10-кроковий pipeline (`actionsRegistry.js:1625`):

0. `UI_ONLY_ACTIONS` → вимагає `params._fromUI`, інакше відмова; `_fromUI` минає allowlist (tenant/case checks лишаються).
1. `PERMISSIONS[agentId]` allowlist.
2. `ACTIONS[action]` існує.
3. `checkTenantAccess(effectiveUserId, tenantId)`.
4. `checkRolePermission(globalRole, action)`.
5. `checkCaseAccess(effectiveUserId, caseObj)` якщо `params.caseId`.
6. `await ACTIONS[action](params)`.
7. `shouldAudit(action)` → `writeAudit(...)`.
8. billing-hook → `activityTracker.report(...)` (з виключеннями, див. §5).
9. повернення `result`; усе в try/catch (`{success:false,error:e.message}`).

### 4. Стан ACTIONS з TASK 0.3.5 (п.4)

Усі присутні, дослівно перенесені TASK 5 (behavior-preserving):

- **`create_case`** (`:103`): `({ fields }) → ensureCaseSaasFields({ id:'case_'+Date.now(), userId:'vadym', createdAt, updatedAt, hearings:[], deadlines:[], timeLog:[], pinnedNoteIds:[], agentHistory:[], ...fields })`. ⚠️ **`ensureCaseSaasFields` = `migrateCase`, додає лише SaaS v2/v3 поля (tenantId/ownerId/team/shareType/externalAccess). НЕ додає v7 ЄСІТС-поля** (`ecitsState`, `parties`, `processParticipants`) — див. СЕМАНТИЧНІ РИЗИКИ R1.
- **`add_hearing`** (`:201`): приймає `caseId, date, time, duration=120, type=null, source, sourceConfidence, ecitsContext, assignedTo, attendedBy`. `source` не передано → fallback `'manual'` + `console.warn`. `isSystemSourced = source∈{court_sync,metadata_extractor}` → `extractedAt=now`, інакше `null`. Дефолти: `sourceConfidence='high'`, `ecitsContext=null`, `assignedTo=null`, `attendedBy=[]`. Повертає `{success,hearingId}`.
- **`update_hearing`** (`:242`): `caseId, hearingId, date, time, duration, type, source, sourceConfidence, ecitsContext, assignedTo, attendedBy`. Без `hearingId` → ціль = найближче майбутнє `scheduled`. v7-поля оновлюються тільки якщо передані. `isSystemUpdate` → оновлює `extractedAt`.
- **`mark_synced_from_ecits`** (`:1155`): `caseId, status='synced', failureReason=null, durationMs=null, documentsCount=0, hearingsCount=0`. Інкрементує `ecitsState.syncMetrics` лічильники, ставить `lastSyncedAt/By`, `syncStatus`. Читає `c.ecitsState?.syncMetrics || {дефолт}` (defensive). Публікує `ECITS_SYNC_COMPLETED`. **НЕ** в audit, **в** `SYSTEM_ACTIONS_NO_BILLING`.
- **`update_case_ecits_state`** (`:1210`): `caseId, patch, source` (усі required). Merge `patch` у `ecitsState` через `canOverwrite(existingState._lastSource, source)`; нижчий пріоритет → `overwriteSkipped`, дані не чіпаються. Публікує `ECITS_CASE_STATE_UPDATED`. **В** `SYSTEM_ACTIONS_NO_BILLING`.

Плюс 6 edit-ACTIONS R1 (AI-first дзеркало, `:1261-1433`): `update_parties`, `update_team` (без `source`), `update_process_participants`, `update_proceeding_composition`, `update_document_movement_card`, `update_alternative_sources` — усі replace-all, `source` required (крім team), enrichment `source/sourceConfidence/extractedAt` на елементах, eventBus-publish. + `update_document_source` (`:1444`, TASK 4) — змінює `source/sourceConfidence/extractedAt` з `canOverwrite`; при забороні перезапису і наявному `alternativeSource` → append у `alternativeSources[]`.

### 5. Нові ACTIONS від DP v2 що перетинаються з Court Sync (п.5)

Phase 1.5 (документи/провадження) — присутні в реєстрі:

| ACTION | Рядок | Опис |
|--------|-------|------|
| `add_document` | :723 | один документ; `validateDocument`, перевірка дубля id |
| `add_documents` | :753 | пакет; атомарна валідація (усі або жоден) |
| `update_document` | :806 | allowlist полів; **`source` свідомо НЕ в allowlist** (міняється тільки через `update_document_source`) |
| `delete_document` | :875 | `mode: full\|registry_only\|archive`; UI-only |
| `add_proceeding` | :978 | id/title/type required; перевірка циклів parentProcId |
| `update_proceeding` | :1028 | allowlist; тип не редагується |
| `delete_proceeding` | :1081 | UI-only; забороняє якщо є діти; documents.procId→null |
| `update_processing_context` | :1126 | пише `case.lastProcessingContext` |

Перетин з Court Sync: жоден. Court Sync пише hearings + v7-поля, **НЕ** документи (`court_sync_agent` не має `add_document`/`update_document`/`delete_document`). DP-документні ACTIONS і Court Sync-ACTIONS не конкурують за одні поля. `ALLOWED_UPDATE_FIELDS` у `update_document` (:813) свідомо не містить `source` — провенанс документа не перезаписується випадково.

---

## 2. PERMISSIONS

### 6-7. Матриця і реєстрація ролі (пп.6-7)

`const PERMISSIONS` у `actionsRegistry.js:1534` — об'єкт `agentId → string[]` дозволених ACTION. Нова роль = новий ключ:

```js
court_sync_agent: [
  'add_hearing', 'update_hearing',
  'mark_synced_from_ecits', 'update_case_ecits_state',
  'update_parties', 'update_team', 'update_process_participants',
  'update_proceeding_composition',
  'update_document_movement_card', 'update_alternative_sources',
  'update_document_source',
],
```

### 8. court_sync_agent (п.8)

**Існує** (`:1600`). Дозволено: `add_hearing`, `update_hearing`, `mark_synced_from_ecits`, `update_case_ecits_state`, `update_parties`, `update_team`, `update_process_participants`, `update_proceeding_composition`, `update_document_movement_card`, `update_alternative_sources`, `update_document_source` (11 дій).
**Заборонено** (відсутні в списку): `destroy_case`, `add_document`, `update_document`, `delete_document`, `create_case`. Тобто Court Sync **не створює справи** — тільки оновлює існуючі за `caseId`.

### 9. metadata_extractor_agent (п.9)

**Defined, DISABLED** (`:1614`): `metadata_extractor_agent: []` — порожній allowlist. Будь-який `executeAction` через цю роль → відмова на кроці 1 (`!allowed.includes(action)`). Зарезервоване ім'я, активація — окремий майбутній TASK. **НЕ активувати в 0.4.**

### 10. Перевірка permission (п.10)

`executeAction:1641-1648`:

```js
} else {
  const allowed = PERMISSIONS[agentId] || [];
  if (!allowed.includes(action)) {
    console.warn(`executeAction BLOCKED: ${agentId} → ${action}`);
    return { success: false, error: `Немає повноважень: ${action}` };
  }
}
```

Далі заглушки `checkTenantAccess`/`checkRolePermission`/`checkCaseAccess` (`permissionService.js`): `checkTenantAccess` = `u.userId===userId && u.tenantId===tenantId`; `checkRolePermission` = true для `bureau_owner`, true для решти (заглушка); `checkCaseAccess` = tenant isolation → bureau_owner override → ownerId → team membership → externalAccess(validUntil). `caseRole.permissions` поки НЕ enforced (для майбутньої гранулярності).

---

## 3. Schema (case / document / hearing)

### 11. Версії (п.11)

**Код:** `migrationService.js:71` → `CURRENT_SCHEMA_VERSION = 8`, `MIGRATION_VERSION = '8.0_time_entry_capture_method'`, `BASE_CHAIN_VERSION = 4`.
**CLAUDE.md:** ще каже `schemaVersion 7` / `"7.0_ecits_canonical"` — **застаріло** (див. R2).

Ланцюг у App.jsx EFFECT-A (кожен крок: pre-backup поза ротацією + прапор, ідемпотентний):
`migrateRegistry`(→4) → `migrateRegistryV4toV5` → `migrateToVersion6` → `migrateToVersion6_5` → `migrateToVersion7` → `migrateToVersion8`.

Описові schema-файли (TASK 0.3.5, нові): `src/schemas/caseSchema.js`, `documentSchema.js`, `hearingSchema.js`. ⚠️ `documentSchema.js` сам застарів: header «Phase 1.5», «18 ЛЕГКИХ полів», `export const CURRENT_SCHEMA_VERSION = 5` (:234), коментар про v4→v5 — тоді як фактично в ньому **28 полів v7** і caseSchema посилається на «canonical 28 полів v7». Див. R3.

### 12. case — поля (п.12)

**`ecitsState`** — присутнє. Додається ТІЛЬКИ `migrateToVersion7` (НЕ `ensureCaseSaasFields`). Дефолт `buildDefaultEcitsState()` (`migrationService.js:605`):

```js
{ caseId:null, filedAt:null, court:null, lastSyncedAt:null, lastSyncedBy:null,
  syncStatus:'never', failureReason:null,
  syncMetrics:{ totalSyncs:0, successfulSyncs:0, failedSyncs:0,
                documentsExtracted:0, hearingsExtracted:0, lastDurationMs:null } }
```
+ внутрішнє `_lastSource` (додає `update_case_ecits_state` для canOverwrite). `syncStatus` enum: `never|syncing|synced|partial|failed`.

**`parties[]`** — присутнє, default `[]`. Елемент: `{ role, fullName, code, position, source, sourceConfidence, extractedAt }`. `role`: `plaintiff|defendant|third_party|accused|victim|legal_representative`.

**`processParticipants[]`** — присутнє, default `[]`. Елемент: `{ role, caseRole, fullName, userId, isOurLawyer, representsParty, source, sourceConfidence, extractedAt }`. `userId=null` для зовнішніх. **Не несе permissions** (read-only довідка ≠ `team[]`).

**`team[]`** — SaaS v3, незмінне (v7 свідомо НЕ чіпало — «Варіант A»). Елемент: `{ userId, caseRole, addedAt, addedBy, permissions:{canEdit,canDelete,canShare,canAddTeam,canViewBilling,canEditBilling,canRunAI} }`. Дефолти permissions за `caseRole` — `ROLE_PERMISSION_DEFAULTS` (`migrationService.js:81`, ролі: owner/lead/co-lead/support/external). `ensureTeamPermissions` доповнює відсутні поля.

**`origin`** — **відсутнє.** Такого поля немає ні в caseSchema, ні в міграціях, ні в ACTIONS. Якщо TASK 0.4 його планував — це новий field, потребує bump v9 + міграція.

`proceedings[].composition` (v7): `{ presiding, reporter, members[] }` — default `null` після міграції.

### 13. document — поля (п.13)

Канонічна схема `documentSchema.js` (фактичні поля, не застарілий header):

**`source`** — присутнє, nullable, default `'manual'`. Enum: `['manual','court_sync','metadata_extractor','telegram','email','unknown',null]`. Довідник — `src/constants/documentSources.js` (`DOCUMENT_SOURCES`, `DOCUMENT_SOURCE_LABELS`, `isValidDocumentSource`). Legacy константи `*_MANUAL_UPLOAD`/`*_ECITS` видалено.
**`ecitsSource`** — присутнє, object|null, default `null`. Деталі ЄСІТС-походження (`{ ecitsDocumentId, ecitsNotificationId, notificationType, cabinetUrl, receivedThroughCabinet:{userId,cabinetIdentifier}, receivedAlsoThroughCabinet:[...] }`).
**`movementCard`** — присутнє, object|null, default `null`. Картка руху (`{ state, dnzs, documentDate, infoDeliveryToECourt, fileDeliveryToECourt, deliveries[], attachments[] }`).
+ `sourceConfidence`, `extractedAt`, `alternativeSources[]` (default `[]`), `originalDriveId`, `originalMime` (TASK A). `addedBy` (`user|agent|system`) — actor, **не плутати з `source`** (канал), розділення формалізовано TASK 0.3.4.

### 14. hearing — поля (п.14)

`hearingSchema.js` + `add_hearing`/`update_hearing` — усі v7-поля присутні:
**`source`** — enum `['manual','court_sync','metadata_extractor','unknown']`, default `'manual'`.
**`ecitsContext`** — object|null, default `null` (`{ ecitsNotificationId, notificationDocumentType, notifiedAt, deliveredToCabinetAt, emailSentAt, cabinetUrl }`).
**`assignedTo`** — string|null, default `null` (multi-user: відповідальний адвокат бюро).
**`attendedBy[]`** — default `[]` (userId присутніх).
Хелпер `isSystemSourced(hearing)` (`hearingSchema.js:107`) = `source∈{court_sync,metadata_extractor}`.

---

## 4. Event Bus

### 15-17. Файл, топіки, публікація (пп.15-17)

`src/services/eventBus.js` — in-memory pub/sub (`subscribe`/`publish`/`clear`/`subscriberCount`); помилки handler'ів ізольовані, не злітають вгору. Топіки — `src/services/eventBusTopics.js`.

ecits.* і суміжні топіки **зараз**:

| Константа | Значення | Publisher |
|-----------|----------|-----------|
| `ECITS_DOCUMENTS_RECEIVED` | `ecits.documents_received` | **немає** (інфра для 0.4+) |
| `ECITS_HEARING_SCHEDULED` | `ecits.hearing_scheduled` | **немає** |
| `ECITS_CASE_STATUS_CHANGED` | `ecits.case_status_changed` | **немає** |
| `ECITS_SUBMISSION_COMPLETED` | `ecits.submission_completed` | **немає** |
| `ECITS_SYNC_COMPLETED` | `ecits.sync_completed` | `mark_synced_from_ecits` |
| `ECITS_CASE_STATE_UPDATED` | `ecits.case_state_updated` | `update_case_ecits_state` |
| `CASE_PARTIES_UPDATED` | `case.parties_updated` | `update_parties` |
| `CASE_TEAM_UPDATED` | `case.team_updated` | `update_team` |
| `CASE_PROCESS_PARTICIPANTS_UPDATED` | `case.process_participants_updated` | `update_process_participants` |
| `PROCEEDING_COMPOSITION_UPDATED` | `proceeding.composition_updated` | `update_proceeding_composition` |
| `DOCUMENT_MOVEMENT_CARD_UPDATED` | `document.movement_card_updated` | `update_document_movement_card` |
| `DOCUMENT_ALTERNATIVE_SOURCE_ADDED` | `document.alternative_source_added` | `update_alternative_sources`, `update_document_source` |
| `DOCUMENT_INGESTED` | `document.ingested` | **немає** (TASK 3, для DP v2) |
| `DOCUMENT_BATCH_PROCESSED` | `document.batch_processed` | **немає** (TASK 3, для DP v2) |

Групи: `ECITS_TOPICS`, `V7_EDIT_TOPICS`, `DOCUMENT_TOPICS` (свідомий перетин movement_card/alternative_source — два зрізи однієї константи, не дубль сенсу). Підписників на ecits.* зараз НЕ зареєстровано ніде (топіки = інфраструктура констант). Публікація: `eventBus.publish(TOPIC, { caseId, tenantId, userId, ..., timestamp })` у try/catch (приклад — §1 п.2). **Усі payload несуть `tenantId`** (SaaS-готовність).

---

## 5. Billing Hook

### 18. Виключення системних ACTIONS (п.18)

Файл — `actionsRegistry.js`, два `Set` на верхньому рівні модуля:

```js
// :43
export const SYSTEM_ACTIONS_NO_BILLING = new Set([
  'track_session_start', 'track_session_end', 'batch_update',
  'mark_synced_from_ecits', 'update_case_ecits_state',
]);
// :54
export const EDIT_ACTIONS_SOURCE_AWARE = new Set([
  'update_parties', 'update_team', 'update_process_participants',
  'update_proceeding_composition', 'update_document_movement_card',
  'update_alternative_sources', 'update_document_source',
]);
```

Логіка hook у `executeAction:1703`:

```js
let shouldReport = result && (result.success || result.successCount) &&
                   !SYSTEM_ACTIONS_NO_BILLING.has(action);
if (shouldReport && EDIT_ACTIONS_SOURCE_AWARE.has(action)) {
  const sourceParam = params?.source;
  if (sourceParam && sourceParam !== 'manual') shouldReport = false; // автосинхронізація
}
if (shouldReport) {
  activityTracker.report(action, { type:'action', module:MODULES.EXECUTE_ACTION,
    caseId:hookCaseId, hearingId:..., duration:0,
    category:categoryForCase(hookCaseId), metadata:{ agentId, viaAgent:true } });
}
```

Тобто: `mark_synced_from_ecits`/`update_case_ecits_state` — ніколи не білляться. 6 edit-ACTIONS + `update_document_source` — білляться тільки якщо `params.source==='manual'` (адвокат вручну); з `court_sync`/`metadata_extractor` — ні. `update_team` у Set але не приймає `source` → завжди білляться (свідомо, internal). DP v2 нові виключення додав лише `batch_update` (у SYSTEM_ACTIONS_NO_BILLING) — більше нічого.

**`add_hearing`/`update_hearing` НЕ в жодному Set** → білляться завжди, незалежно від `source`. Це дірка для Court Sync — див. R5.

ai_usage: `aiUsageService.logAiUsage(params,setAiUsage)` / `logAiUsageViaSink(params,sink)` → React state `ai_usage[]`, LIFO 50000, `MODEL_PRICING` (haiku/sonnet/opus, verify quarterly). Court Sync через Claude for Chrome — окрема Max-підписка адвоката, **наш API не зачіпається, ai_usage не пишеться**. `ecitsService.js` коментує: майбутнє власне розширення з нашим API інструментуватиме `logAiUsage` + `activityTracker.report` category `system` — зараз заглушки білінгу не торкаються.

---

## 6. Модуль «Електронний суд»

### 19-20. Шлях і компоненти (пп.19-20)

`src/components/CourtSync/`:
- `index.jsx` — головний компонент, рендериться у App.jsx при `tab === 'courtsync'` через `React.lazy` + `ModuleErrorBoundary` + `Suspense`.
- `Reconnaissance/index.jsx` — підмодуль розвідки (founder-only).
- `setup/ClaudeForChromeSetup.jsx` — крок налаштування провайдера.

Вкладки: секція **ЄСІТС** (видима всім) — 4 підвкладки `Огляд/Журнал/Налаштування/Розбіжності`, усі = `PlaceholderPanel` «У розробці». Секція **Розвідник** (тільки `isCurrentUserFounder()===true`) — `Розвідка ЄСІТС` → `<Reconnaissance/>`. Перемикач секцій рендериться лише коли founder. Дизайн — design-токени, lucide-react (`Scale`, `Search`), без емодзі.

### 21. tenant.settings.moduleIntegration.ecits (п.21)

Поточна структура (`tenantService.js:94` DEFAULT_TENANT + `migrationService.js:212` `DEFAULT_ECITS_SETTINGS_FOR_TENANT` + `ecitsService.js:28` `DEFAULT_ECITS_SETTINGS`):

```js
{ autoSync:false, syncIntervalMinutes:null, casesToSync:'all',
  autoProcessIncoming:false, detectDeadlinesOnReceive:false,
  executionProvider:'claudeForChrome' }
```

Розширення без schema bump (`ensureModuleIntegration` мерджить дефолти). **Дефолт навмисно дубльований у 3 місцях** — синхронізувати вручну при зміні (зафіксовано в коментарях). `getSettings()` мерджить tenant поверх дефолтів. `updateSettings(patch)` зараз НЕ персистить (повертає preview; реальний запис — майбутній ACTION `update_tenant_settings`, ще не існує).

### 22. sourcePolicy.js (п.22)

**Існує** (`src/services/sourcePolicy.js`), повноцінний:
- `SOURCE_PRIORITY` (frozen): `manual:100, court_sync:80, metadata_extractor:60, telegram:50, email:50, unknown:10`.
- `canOverwrite(existing,new)` → `true` якщо `existing` null/undefined або `priority(new)>priority(existing)`. Невідомий source → priority 0.
- `buildAlternativeSourceRecord(source,conf,data)` → `{source,sourceConfidence,receivedAt,dataHash}`.
- `hashData(data)` — простий не-крипто 32-bit hash для аудиту дублів.
Використовується в `update_case_ecits_state`, `update_alternative_sources`, `update_document_source`.

### 23. metadataExtractor/ (п.23)

`src/services/metadataExtractor/` = **тільки `README.md`** (5.9 KB). Папка-ембріон: декларує що Metadata Extractor — primary канал для не-ЄСІТС (ширший за Court Sync), пише в ту саму схему через ті самі ACTIONS з `source:'metadata_extractor'`. Жодного коду. Майбутні відкладені ACTIONS (НЕ в 0.4): `add_timeline_event` (TASK 0.7), `update_case_dnzs` (після DP v2).

---

## 7. Точки інтеграції для розширення

### 24. Глобальний window.* API (п.24)

**Відсутній.** Немає `window.LegalBMS` чи будь-якого global bridge. Усі `window.*` у коді — тільки читання/слухачі (`SpeechRecognition`, `webkitSpeechRecognition`, `google`, `IdleDetector`, `innerWidth`, resize/mouse listeners). **Жодної точки через яку стороннє розширення могло б передати дані в SPA.** Якщо браузерне розширення Court Sync має «закидати» дані в застосунок — bridge доведеться спроєктувати з нуля (вікно `postMessage`, custom event, або window-namespace). Це архітектурне рішення для TASK 0.4 «з повним ДНК».

### 25. URL-роути (п.25)

**Відсутні.** Жодного router-пакета в `package.json` (нема react-router). Навігація — чистий React-стан: `const [tab, setTab] = useState('dashboard')` (`App.jsx:3500`), модуль рендериться за `tab === '...'`. Court Sync = `tab === 'courtsync'`. Нема hash-routing, нема `pushState`, **нема `/court-sync/import`**. Сторінка-target для розширення поки не існує — її треба проєктувати (наприклад deep-link через `location.hash`/query що виставляє `tab`, або винести роутинг).

### 26. tenant.subscription.entitlements (п.26)

**Поля `entitlements` НЕ існує.** Фактична структура `DEFAULT_TENANT.subscription` (`tenantService.js:54`):

```js
{ plan:'self_hosted', status:'active', validUntil:null, features:['all'],
  limits:{ aiTokensPerMonth:null, aiCostPerMonth:null, storageGB:null,
           teamMembers:null, casesActive:null },
  current:{ periodStart, periodEnd, tokensUsed:0, costUsedUSD:0,
            storageUsedGB:0, teamMembersCount:1, casesActiveCount:0 },
  alerts:{ warnAt:80, blockAt:100 } }
```

Найближче до «entitlements» — `features:['all']` (плоский масив). Якщо TASK 0.4 планував читати `subscription.entitlements.courtSync` (чи подібне) — такої точки нема; треба або додати поле (розширення tenant без schema bump, як `moduleIntegration`), або використовувати `moduleIntegration.ecits` як gate.

---

## 8. Застарілі елементи (п.27)

| Елемент | Стан | Замість |
|---------|------|---------|
| `case.client` (string) | DEPRECATED, UI ще читає | `parties[]` (backfill — tracking_debt #1) |
| `case.judge` (string) | DEPRECATED | `proceedings[].composition` |
| `case.timeLog[]` | DEPRECATED з v4, лишається порожнім | top-level `time_entries[]` |
| `proceeding.judges` (string) | DEPRECATED | `composition` |
| `time_entry.source` | **видалено**, переіменовано (v8) | `time_entry.captureMethod` |
| Старий `DocumentProcessor` компонент | **decommissioned** (TASK 1) | DP v2 (майбутній); є `DocumentViewer/` |
| `documentSchema.js:234 CURRENT_SCHEMA_VERSION=5` | застаріла константа (фактично v7/v8) | звіряти з `migrationService` |
| `DOCUMENT_SOURCE_MANUAL_UPLOAD`/`_ECITS` | видалено (0.3.5) | `manual`/`court_sync` |
| Косметичні згадки DocumentProcessor | у коментарях: `documentFactory.js:3,200`, `toolDefinitions.js:55`, `migrations/v4ToV5.js:43`, `caseSchema.js:78` | tracking_debt #4 |

Реєстри: `DEPRECATED_CASE_FIELDS=['client','judge','timeLog']`, `DEPRECATED_PROCEEDING_FIELDS=['judges']` (`caseSchema.js:184`).

Латентні баги (з `tracking_debt.md`, не Court Sync напряму, але в тому ж файлі ACTIONS):
- **#7**: `add_time_entry` має мертвий рядок `const tenant = getCurrentTenant ? null : null;` — `getCurrentTenant` НЕ імпортовано в `actionsRegistry.js` → ReferenceError при виклику, ловиться try/catch. `court_sync_agent` не має `add_time_entry`, тож прямого ризику для 0.4 нема.
- **#8**: `update_case_field` на забороненому полі повертає `{error}` БЕЗ `success:false` — неконсистентно з рештою. Нові ЄСІТС-ACTIONS усі повертають `{success:false,error}` коректно; просто тримати ту саму форму в 0.4.

---

## СЕМАНТИЧНІ РИЗИКИ ДЛЯ TASK 0.4

### R1 — `create_case` не закладає v7 ЄСІТС-поля (архітектурний, високий)

`ACTIONS.create_case` → `ensureCaseSaasFields` → `migrateCase` (`migrationService.js:121`). `migrateCase` додає SaaS v2/v3 (`tenantId/ownerId/team/shareType/externalAccess`), але **НЕ** `ecitsState`, `parties`, `processParticipants` — ці три додає лише `migrateToVersion7` (одноразова міграція наявних справ). Наслідок: будь-яка справа створена ПІСЛЯ v7-міграції через `create_case` має `ecitsState===undefined`, `parties===undefined`, `processParticipants===undefined`.

ЄСІТС-ACTIONS захищені defensively (`c.ecitsState || {}`, `c.ecitsState?.syncMetrics || {дефолт}`, replace-all для parties/participants) — **самі ACTIONS не впадуть**. Ризик у **споживачах**: UI/дашборд/звіти що очікують канонічний shape `buildDefaultEcitsState()` (наприклад `ecitsState.syncStatus === 'never'`) отримають `undefined` і мусять його обробляти. Court Sync MVP має або (а) спиратися лише на defensive-читання, або (б) нормалізувати справу при першому дотику (через `update_case_ecits_state` з повним дефолтним patch), або (в) розширити `ensureCaseSaasFields` v7-полями (потребує узгодження — це зміна семантики «SaaS fields»). Це треба вирішити в специфікації, не «по дорозі».

### R2 — schemaVersion drift: код v8, CLAUDE.md v7 (документаційний, високий)

`CURRENT_SCHEMA_VERSION=8`, `MIGRATION_VERSION='8.0_time_entry_capture_method'`. CLAUDE.md (header + правило #6 + дайджест) ще каже v7 / `7.0_ecits_canonical`. Якщо TASK 0.4 додає поле в схему — bump має бути **v8→v9**, не v7→v8, і нова міграція `migrateToVersion9` у ту саму послідовність EFFECT-A з власним pre-backup і прапором. Адмін-чат при написанні 0.4 мусить виходити з v8 як бази. (tracking_debt #2 прямо попереджає звірити дайджест при наступному bump.)

### R3 — `documentSchema.js` внутрішньо суперечливий (документаційний, середній)

Header каже «Phase 1.5 / 18 ЛЕГКИХ полів», `export const CURRENT_SCHEMA_VERSION = 5`, коментар про міграцію v4→v5 — а фактично файл описує 28 полів v7 (включно з `source/ecitsSource/movementCard/alternativeSources`), і `caseSchema.js:46` посилається на «canonical 28 полів v7». Хто читатиме `documentSchema.js` для 0.4 (а Court Sync пише `movementCard`/`source` документів через `update_document_movement_card`/`update_document_source`) — отримає суперечливий орієнтир версії. Не правити в 0.4 (read-only audit), але адмін-чату варто закласти doc-sync або хоча б не довіряти константі `=5`.

### R4 — backfill `client`/`judges` тригериться саме TASK 0.4 (планувальний, високий)

`tracking_debt.md #1`: «Коли реальний канал (Court Sync) почне писати `parties[]`/`composition` і UI треба показувати дані з них → окремий backfill TASK». Court Sync MVP — це і є той канал. Сценарій: ЄСІТС-sync заповнює `parties[]`/`proceedings[].composition`, але вся картка справи / списки досі рендерять `case.client` (string) і `proceeding.judges` (string), які Court Sync **не оновлює**. Адвокат побачить нові дані в `parties[]` структурно, але стара summary-стрічка в UI лишиться неактуальною → видима розбіжність. TASK 0.4 має свідомо обрати: (а) MVP пише лише `parties[]`, UI не змінюється, розбіжність прийнятна тимчасово; (б) 0.4 включає мінімальний backfill (parties→client summary) у scope. Рішення — в специфікації.

### R5 — `add_hearing`/`update_hearing` білляться навіть із `source:'court_sync'` (білінговий, високий)

`add_hearing`/`update_hearing` дозволені `court_sync_agent` і будуть основним механізмом синхронізації засідань з ЄСІТС. Але вони **не в `SYSTEM_ACTIONS_NO_BILLING` і не в `EDIT_ACTIONS_SOURCE_AWARE`**. Billing-hook (`executeAction:1703`) перевіряє ці два Set; для `add_hearing`/`update_hearing` `shouldReport` лишається `true` → `activityTracker.report('add_hearing', {category: case_work...})`. Тобто **кожне засідання, що Court Sync витягнув з кабінету, потрапить у time_entries[] як оплачувана робота адвоката `case_work`**, хоча це автосинхронізація, не робота. Це пряме порушення принципу «автосинхронізація не потрапляє в білінг» (той самий принцип, заради якого існує `SYSTEM_ACTIONS_NO_BILLING`/`EDIT_ACTIONS_SOURCE_AWARE`). Поточна source-aware логіка дивиться лише на `EDIT_ACTIONS_SOURCE_AWARE.has(action)` — а hearing-ACTIONS туди не входять, попри те що `add_hearing` приймає `source`. TASK 0.4 мусить це закрити (наприклад додати hearing-ACTIONS у source-aware гілку, або окремий механізм), інакше білінг забрудниться з першої ж синхронізації. **Це найгостріший семантичний/білінговий ризик 0.4.**

### R6 — `labelForVersion()` без v8-гілки (косметичний, низький)

`migrationService.js:231`: `if (version >= 7) return '7.0_ecits_canonical'` — для v8-реєстру що **втратив** `settingsVersion` (рідкісний fallback-шлях) повернеться помилковий лейбл `7.0_ecits_canonical`. Не впливає на дані (тільки label), але якщо 0.4 додасть v9 — варто додати гілки 8/9 одразу.

### R7 — multi-user dedupe готовий структурно, але `ecitsCabinetIdentifier` всюди null (готовність, середній)

`DEFAULT_USER.ecitsCabinetIdentifier = null` (`tenantService.js:142`); `migrateToVersion7` додає поле всім users ідемпотентно (null). UI для заповнення немає (свідомо — окремий TASK). Сценарій «кілька адвокатів одного бюро синхронізуються незалежно»: структурно передбачено (`ecitsSource.receivedThroughCabinet.{userId,cabinetIdentifier}`, `receivedAlsoThroughCabinet[]`, `hearing.assignedTo`, `processParticipants[].userId`), але **зараз один користувач (`vadym`, заглушки `getCurrentUser`)** і identifier порожній. Court Sync MVP де-факто single-user; multi-user dedupe-логіка не може спрацювати поки `ecitsCabinetIdentifier` не заповнюється. TASK 0.4 має або не покладатися на dedupe в MVP, або передбачити мінімальний шлях заповнення identifier.

---

## ЗАГАЛЬНИЙ ВИСНОВОК

**Найважливіші зміни архітектури після TASK 0.3.5.** Реєстр дій більше не в App.jsx — TASK 5 виніс `ACTIONS`/`PERMISSIONS`/`executeAction` у `src/services/actionsRegistry.js` як factory `createActions(deps)` з ін'єкцією залежностей; контракт `executeAction(agentId,action,params,[userId])` і 10-кроковий pipeline незмінні, але реєстрація нових ACTION/ролей для 0.4 робиться саме там. schemaVersion піднято до **8** (TASK 2: `time_entry.source`→`captureMethod`) — CLAUDE.md відстає на одну версію. Старий DocumentProcessor decommissioned (TASK 1), додано описові schema-файли (`caseSchema`/`hearingSchema`) і document-lifecycle eventBus-топіки без publisher'ів (TASK 3), `update_document_source` (TASK 4). Уся ЄСІТС-інфраструктура 0.3.5 на місці і консистентна між собою: `court_sync_agent` (11 дозволених дій), 2 sync- + 6 edit-ACTIONS, sourcePolicy, eventBus-топіки з `tenantId` у payload, canonical поля case/document/hearing з `source`-мітками, billing-виключення для sync/edit-ACTIONS.

**Ризики для написання TASK 0.4 (за пріоритетом):**

1. **R5 (білінг, найгостріший):** `add_hearing`/`update_hearing` НЕ виключені з activityTracker — синхронізовані з ЄСІТС засідання потраплять у `time_entries[]` як оплачуваний `case_work` з першої синхронізації. Source-aware гілка покриває лише `EDIT_ACTIONS_SOURCE_AWARE`, куди hearing-ACTIONS не входять. Потребує явного рішення в специфікації.
2. **R1 (multi-tenant/архітектура):** `create_case` не закладає `ecitsState/parties/processParticipants` (їх ставить лише одноразова v7-міграція) — нові справи мають `undefined`, що ламає споживачів які очікують канонічний дефолт. Court Sync MVP мусить обрати стратегію нормалізації.
3. **R4 (планування scope):** backfill `client`/`judges` тригериться саме цим TASK — UI читатиме застарілі denormalized summary поки Court Sync пише структуровані `parties[]`/`composition`. Рішення in/out of scope — у специфікацію.
4. **R2/R3 (документаційна чистота):** код на v8, CLAUDE.md і `documentSchema.js` кажуть v7/v5 — будь-який новий bump це v8→v9; адмін-чат має виходити з фактичного стану коду, не з CLAUDE.md.
5. **R7 (multi-user):** dedupe-структури готові, але `ecitsCabinetIdentifier` всюди null і немає UI/шляху заповнення — MVP фактично single-user; не покладатися на dedupe.

**ai_usage:** Court Sync через Claude for Chrome не торкається нашого API → `ai_usage[]` не пишеться; майбутнє власне розширення з нашим API має інструментуватися `logAiUsage` + `activityTracker.report(category:'system')`. **Інтеграційні точки для розширення відсутні:** немає глобального `window.*` API, немає URL-роутів (чистий `tab`-стан SPA), немає `subscription.entitlements`, немає `case.origin` — усі чотири доведеться проєктувати «з повним ДНК» якщо 0.4 їх потребує.
