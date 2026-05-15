# AUDIT — Уточнюючий зріз системи перед DP-1

**Дата:** 15.05.2026
**Тип:** Read-only аудит зрізу (заміщує `audit_before_dp1.md`)
**Рамка:** DP v2 — новий компонент з нуля; старий DocumentProcessor — salvage-and-decommission; база DP v2 — AddDocumentModal-флоу; DP v2 — тонкий диригент.
**Метод:** прямі читання критичних файлів + два паралельні Explore-зрізи. Кожен факт із `file:line`.
**Не дублює:** `discussion_dp_v2_philosophy_response.md` (термінологія, патерни, ризики — там), `CLAUDE.md`, `ARCHITECTURE_HISTORY.md`. Тут — фактичний стан коду станом на schemaVersion 7.

---

## 1. РЕЗЮМЕ

Система **готова** до 5 підготовчих TASK'ів. Архітектурний шар (`executeAction` → ACTIONS → PERMISSIONS) зрілий і єдиний; канонічна схема документа повна (28 полів v7); `documentFactory.createDocument` — справді єдина точка; ланцюг міграцій ідемпотентний з робочим шаблоном (`migrateToVersion7`). Старий DocumentProcessor **повністю ізольований** (2 посилання, обидва в `CaseDossier`), всередині нуль `executeAction` — decommission технічно чистий і зворотний.

**Жодного блокувального червоного прапора.** Жовті прапори (деталі — розділ 7, не виправляти): (1) `documentSchema.js` шапка-коментар застаріла («18+6» при фактичних 28); (2) `CaseDossier:3117` передає legacy `source:'manual_upload'` (рятує safety-net `normalizeSource`); (3) колізія `source` **ширша** за очікувану — три різні сенси (`document/hearing/parties`=канал, `time_entry`=спосіб фіксації, `note`=спосіб введення), TASK 2 покриває лише `time_entry`; (4) `update_document` ALLOWED-список НЕ містить `source`-полів — це й обґрунтовує потребу TASK 4; (5) doc-drift CLAUDE.md проти коду (`TIME_ENTRY_ACTIONS` не існує; `AUDIT_ACTIONS` ширший).

Найбільший ризик-вузол — **TASK 5 (ActionsRegistry refactor)**: справжній блокер DP-1, бо `executeAction` прокидається пропом і DP v2 інакше повторить гріх старого DP.

---

## 2. ЗРІЗ СХЕМИ ДАНИХ

### 2.1 `documents[]` — канонічна схема (`src/schemas/documentSchema.js`)

**Факт:** `CANONICAL_DOCUMENT_FIELDS` містить **28 полів** (шапка-коментар рядки 5-7 застаріло каже «18 легких + 6 важких» — stale, `caseSchema.js:46` коректно каже «28 полів v7»).

Повний перелік з типами/required/default/enum (`documentSchema.js:16-198`):

| Поле | type | required | nullable | default | enum |
|------|------|----------|----------|---------|------|
| `id` | string | ✓ | — | gen `doc_<ts>_<rand>` | — |
| `name` | string | ✓ | — | `originalName`\|'Без назви' | — |
| `originalName` | string | — | — | null | — |
| `category` | string | ✓ | ✓ | null | pleading\|motion\|court_act\|evidence\|contract\|correspondence\|identification\|other\|null |
| `author` | string | ✓ | ✓ | null | ours\|opponent\|court\|third_party\|null (legacy `opp`→`opponent` у v4→v5) |
| `documentNature` | string | ✓ | — | `detectNature()` | searchable\|scanned |
| `namingStatus` | string | ✓ | — | 'pending' | auto\|manual\|pending |
| `isKey` | boolean | ✓ | — | false | — |
| `procId` | string | ✓ | ✓ | null | — (FK на `case.proceedings[].id`) |
| `driveId` | string | ✓ | ✓ | null | — |
| `driveUrl` | string | — | — | null | — |
| `folder` | string | ✓ | — | '01_ОРИГІНАЛИ' | 00_INBOX_СПРАВИ\|01_ОРИГІНАЛИ\|02_ОБРОБЛЕНІ\|03_ФРАГМЕНТИ\|04_ПОЗИЦІЯ\|05_ЗОВНІШНІ |
| `pageCount` | number | — | — | null | — |
| `size` | number | ✓ | — | 0 | — |
| `icon` | string | ✓ | — | `pickIcon()` '📄' | — |
| `date` | string(date) | — | — | null | YYYY-MM-DD |
| `addedAt` | string(dt) | ✓ | — | now ISO | — |
| `updatedAt` | string(dt) | ✓ | — | now ISO | — |
| `addedBy` | string | ✓ | — | 'user' | user\|agent\|system (actor) |
| `status` | string | ✓ | — | 'active' | active\|archived |
| `source` | string | — | ✓ | 'manual' | manual\|court_sync\|metadata_extractor\|telegram\|email\|unknown\|null (канал) |
| `sourceConfidence` | string | — | ✓ | 'high' | high\|medium\|low\|null |
| `extractedAt` | string(dt) | — | ✓ | null | — |
| `ecitsSource` | object | — | ✓ | null | {ecitsDocumentId,ecitsNotificationId,notificationType,cabinetUrl,receivedThroughCabinet{userId,cabinetIdentifier},receivedAlsoThroughCabinet[]} |
| `movementCard` | object | — | ✓ | null | {state,dnzs,documentDate,infoDeliveryToECourt,fileDeliveryToECourt,deliveries[],attachments[]} |
| `alternativeSources` | array | — | — | [] | елемент {source,sourceConfidence,receivedAt,dataHash} |
| `originalDriveId` | string | — | ✓ | null | — |
| `originalMime` | string | — | ✓ | null | — |

**Required+nullable** (присутнє, може бути null): `category`, `author`, `procId`, `driveId`. **Маркер ⚠** (`CRITICAL_FIELDS_FOR_WARNING`, рядок 227) = `['procId','category','author']` — **`driveId` НЕ в списку ⚠** (required+nullable, але відсутність файлу не позначається попередженням; нюанс який CLAUDE.md-дайджест раніше згладжував).

**EXTENDED поля** (`.metadata/documents_extended.json`, lazy): `documentId, tags, notes, annotations, processingHistory, extractedTextSummary, customFields` (рядки 202-224).

`documentSchema.js:234` тримає власний `CURRENT_SCHEMA_VERSION = 5` (навмисно — це таргет кроку v4→v5; коментар 230-233 пояснює). Реальна повна версія реєстру — 7 (`migrationService.js:65`).

### 2.2 `caseSchema.js` (208 рядків) — v7 поля

Описова схема (не factory; case створюється через ACTIONS). Нові v7 (`caseSchema.js:81-140`): `ecitsState` (з `syncMetrics` counters; default `buildDefaultEcitsState()`), `parties[]` (елемент: role/fullName/code/position/source/sourceConfidence/extractedAt), `processParticipants[]` (role/caseRole/fullName/userId/isOurLawyer/representsParty/source/sourceConfidence/extractedAt). `proceedings[]` розширено `composition` ({presiding,reporter,members[]}, default null). **`team[]` НЕ чіпати** (рядки 62-73 — internal bureau permissions, окремо від `processParticipants[]`). Deprecated denormalized: `client`/`judge`/`timeLog` (`DEPRECATED_CASE_FIELDS`), `proceedings[].judges` (`DEPRECATED_PROCEEDING_FIELDS`) — backfill окремим TASK (не в обсязі підготовчих). `lastProcessingContext` (рядок 75-79) — `{processedAt,documentsCount,summary}`, оновлюється `update_processing_context` ACTION.

### 2.3 `hearingSchema.js` (109 рядків) — v7 поля

Нові v7 (`hearingSchema.js:31-87`): `source` (enum manual\|court_sync\|metadata_extractor\|unknown — **той самий сенс що document.source**, але вужчий enum), `sourceConfidence`, `extractedAt`, `ecitsContext` (object), `assignedTo` (userId\|null), `attendedBy[]`. Хелпер `isSystemSourced(hearing)` (рядок 107) — `source==='court_sync'||'metadata_extractor'` (для білінгу: system-sourced не нараховується). `add_hearing`/`update_hearing` приймають backward-compat.

### 2.4 `sourcePolicy.js` (86 рядків)

`SOURCE_PRIORITY` (Object.freeze, рядки 23-30): manual=100, court_sync=80, metadata_extractor=60, telegram=50, email=50, unknown=10. `canOverwrite(existingSource,newSource)` (45-51): `existing==null→true`; інакше `PRIORITY[new] > PRIORITY[existing]` (відсутній ключ→0). `buildAlternativeSourceRecord(source,conf,data)` (62-69) → `{source,sourceConfidence,receivedAt,dataHash}`. `hashData` (78-86) — простий не-крипто 32-bit hex. **Хто викликає `canOverwrite`:** `update_case_ecits_state` (App.jsx:5867, source-aware merge). Більше прямих споживачів не виявлено — інші source-aware ACTIONS збагачують записи `source`, але `canOverwrite` явно не зовуть (релевантно для TASK 4: новий ACTION має інтегрувати `canOverwrite` свідомо).

### 2.5 `documentFactory.js` (216 рядків) — єдина точка створення

`createDocument(metadata)` (45-103) повертає всі 28 полів з дефолтами. `id` = `metadata.id || doc_${Date.now()}_${rand36}` (14-18). `normalizeAddedBy` (33-40) — legacy map `lawyer_via_dp/lawyer_manual→user, ecits/migration→system`, невідоме→`user`+warn. `normalizeSource` (118-125) — legacy map `manual_upload→manual, ecits→court_sync`, невідоме→`unknown`+warn. `validateDocument` (129-170) — required/type/enum/nullable сверка. `needsReview` (173) / `getMissingCriticalFields` (179) — на `CRITICAL_FIELDS_FOR_WARNING`. `detectNature` (189-202): DOCX/HTML/TXT/MD/RTF→searchable, `fromOCR/ocrProvider`→scanned, **PDF default→searchable** (реальне детектування робиться вище старим DP — coupling, релевантно TASK 1/DP v2).

### 2.6 `migrationService.js` (824 рядки) — ланцюг

Константи: `BASE_CHAIN_VERSION=4` (65-72), `CURRENT_SCHEMA_VERSION=7`, `MIGRATION_VERSION='7.0_ecits_canonical'`. Кроки (оркеструються в App.jsx EFFECT-A): `migrateRegistry`(→v4, 284) → `migrateRegistryV4toV5`(окремий файл `migrations/v4ToV5.js`) → `migrateToVersion6`(389) → `migrateToVersion6_5`(471) → `migrateToVersion7`(619). Кожен ідемпотентний (`fromVersion>=N → didMigrate:false`), повертає `{registry,didMigrate,fromVersion,toVersion,stats}`. **Шаблон для TASK 2** — `migrateToVersion7` (619-766) + `migrateDocumentSource` (573-597, мапа+stats+fallback-warn). `buildDefaultEcitsState` (599-617). `ensureCaseSaasFields` (819). Ланцюг готовий до нового кроку — додавання функції + виклик в EFFECT-A + бекап + прапор (за тим самим патерном).

### 2.7 `eventBusTopics.js` (60 рядків)

12 топіків. Вхідні ЄСІТС (22-25): documents_received/hearing_scheduled/case_status_changed/submission_completed (ніхто не публікує, готові для TASK 0.4+). Sync (30-31): sync_completed/case_state_updated. v7 edit (36-41): case.parties_updated/team_updated/process_participants_updated/proceeding.composition_updated/document.movement_card_updated/document.alternative_source_added. Frozen-масиви `ECITS_TOPICS` (43-50), `V7_EDIT_TOPICS` (53-60). **НЕМАЄ** `document.ingested`/`document.batch_processed` — релевантно TASK 3. Документ-топіки наразі: `DOCUMENT_MOVEMENT_CARD_UPDATED`, `DOCUMENT_ALTERNATIVE_SOURCE_ADDED`, `ECITS_DOCUMENTS_RECEIVED`.

### 2.8 `tenantService.js` — multi-tenant готовність

`getCurrentTenant/getCurrentUser` — заглушки (завжди `ab_levytskyi`/`vadym`). `DEFAULT_USER.isFounder=true`, `ecitsCabinetIdentifier:null`. `isCurrentUserFounder()`. Структура SaaS-ready (subscription/limits/models — заглушки). Для DP v2: жодних змін не потрібно, але всі нові ACTIONS мають класти `tenantId` у payload подій (наявний патерн v7).

---

## 3. ЗРІЗ ACTIONS І PERMISSIONS

### 3.1 ACTIONS (`App.jsx:4758`, усі async якщо не вказано)

**Документні:**
- `add_document` (5380) `async({caseId,document})` — required обидва; `validateDocument` → `setCases` append; duplicate-check; audit ✓; не source-aware.
- `add_documents` (5410) `async({caseId,documents})` — **атомарна** валідація (all-or-none, 5420+), required непорожній масив; audit ✓. **Це ACTION для DP v2** (batch).
- `update_document` (5463) `async({caseId,documentId,fields})` — `ALLOWED_UPDATE_FIELDS` = `name,category,author,documentNature,namingStatus,isKey,procId,driveUrl,folder,pageCount,date,icon,status,lastOcrAt`. **НЕ дозволяє** `source,sourceConfidence,movementCard,alternativeSources,ecitsSource,extractedAt,driveId,addedBy,originalDriveId,originalMime`. functional `setCases` updater + re-validate; audit ✓.
- `delete_document` (5532) `async({caseId,documentId,mode='full'})` — mode `full|registry_only|archive`; full → `deleteExtendedForDocument` + Drive cleanup (driveId, originalDriveId, OCR cache); **UI_ONLY** (потребує `_fromUI`); audit ✓.
- `update_processing_context` (5783) `async({caseId,context})` — required context з `processedAt,documentsCount,summary` → `case.lastProcessingContext`; audit ✓. **Дозволено `document_processor_agent`**.

**ЄСІТС/v7 (усі sync, не async):** `mark_synced_from_ecits` (5812, NO_BILLING, no audit), `update_case_ecits_state` (5867, **source-aware через `canOverwrite`**, audit ✓), `update_parties`/`update_process_participants`/`update_proceeding_composition`/`update_document_movement_card` (source-aware enrich, no audit), `update_team` (5948, **без source**), `update_alternative_sources` (6052, читає source з об'єкта, publish eventBus). `batch_update` (6093, async, делегує `ACTIONS[op.action]`, перевіряє `PERMISSIONS[agentId]` по операції, NO_BILLING).

**Спец-сети** (`App.jsx:236-262`): `UI_ONLY_ACTIONS={delete_document,delete_proceeding}`; `SYSTEM_ACTIONS_NO_BILLING={track_session_start,track_session_end,batch_update,mark_synced_from_ecits,update_case_ecits_state}`; `EDIT_ACTIONS_SOURCE_AWARE={update_parties,update_team,update_process_participants,update_proceeding_composition,update_document_movement_card,update_alternative_sources}`. **`TIME_ENTRY_ACTIONS` НЕ існує в App.jsx** (CLAUDE.md-дайджест помилково його згадує — doc-drift, розділ 7). `AUDIT_ACTIONS` (`auditLogService.js:7`) ширший за CLAUDE.md-дайджест: додатково `restore_from_backup,add_document,add_documents,update_document,delete_document,add_proceeding,update_proceeding,delete_proceeding` (doc-drift).

### 3.2 PERMISSIONS (`App.jsx:6125`)

- `document_processor_agent` (6177-6181): **`['add_documents','update_processing_context','batch_update']`** — НЕ має `add_document` (single), `update_document`, `delete_document`. Готовність до DP v2: batch-канал є; для редагування source знадобиться TASK 4.
- `court_sync_agent` (6190-6196): `add_hearing,update_hearing,mark_synced_from_ecits,update_case_ecits_state,update_parties,update_team,update_process_participants,update_proceeding_composition,update_document_movement_card,update_alternative_sources` — enabled, для порівняння.
- `metadata_extractor_agent` (6203): **`[]`** — DISABLED порожнім allowlist. НЕ активувати.
- `dossier_agent` має `add_document,update_document,update_processing_context` але **НЕ** `delete_document` (UI_ONLY). `qi_agent` має `add_document,update_document`.

### 3.3 executeAction і його прокидання (вузол TASK 5)

`executeAction = async (agentId, action, params, userId)` (`App.jsx:6214`). 10-кроковий pipeline: UI-only gate (`_fromUI` bypass) → PERMISSIONS allowlist → ACTIONS lookup → `checkTenantAccess`(stub) → `checkRolePermission`(stub) → `checkCaseAccess`(active, якщо `params.caseId`) → `await ACTIONS[action](params)` → `shouldAudit`→`writeAudit` → billing (`SYSTEM_ACTIONS_NO_BILLING` skip; `EDIT_ACTIONS_SOURCE_AWARE` нараховує лише коли `params.source==='manual'`) → return. Catch → `{success:false,error}`.

**Прокидання пропом — рівно 2 компоненти:** `Dashboard` (`App.jsx:6617` `onExecuteAction={executeAction}`, сигнатура `Dashboard:1010`) і `CaseDossier` (`App.jsx:6712`, сигнатура `CaseDossier:424`). CaseDossier додатково загортає в context для ToolUseRunner (`CaseDossier:1629` `executeAction:(a,act,p)=>onExecuteAction(a,act,p)`). **Старий DocumentProcessor `executeAction` НЕ отримує** (props `DocumentProcessor:278` = `caseData,cases,updateCase,onCreateCase,onNavigateToDossier,apiKey,driveFolderId,driveToken,setAiUsage`) — це і є структурний обхід шару. `actionsRegistry.js` **не існує** (ACTIONS/PERMISSIONS лише inline в App.jsx). `_actionsHarness.js` дублює логіку вручну (CLAUDE.md ТЕСТУВАННЯ; `tracking_debt.md` #3).

---

## 4. ЗРІЗ ТОЧОК СТВОРЕННЯ ДОКУМЕНТА

Усі через `createDocument()`. Перелік (file:line, addedBy, source, шлях персистенції, v7-готовність):

| # | Точка | createDocument | addedBy | source | Персистенція | v7 |
|---|-------|----------------|---------|--------|--------------|-----|
| 1 | INITIAL_CASES Брановський (12 шт) | `App.jsx:124-135` | `system` | (не передано→factory `manual`) | inline seed | ✓ через factory; **decoupled від старого DP** |
| 2 | CaseDossier drop-queue | `CaseDossier:2253` | `user` | (не передано→`manual`) | `onExecuteAction('dossier_agent','add_document')` `:2267` | ✓ через шар |
| 3 | CaseDossier модаль reopen | `CaseDossier:2935` | `user` | — | (флоу як #4) | ✓ |
| 4 | **AddDocumentModal основний флоу** | `CaseDossier:3099` | `user` | **`'manual_upload'` (legacy!)** `:3117` | `onExecuteAction('dossier_agent','add_document')` `:3120`; fallback `updateCase` `:3129` якщо нема onExecuteAction | ✓ через шар; **база DP v2** |
| 5 | Старий DP `handleConfirm` | `DocumentProcessor:808` | `user` | (не передано) | **`updateCase()` `:826` — ОБХІД** | salvage |
| 6 | Старий DP `handleSplit` | `DocumentProcessor:956` | `user` | (не передано) | **`updateCase()` `:966` + `driveRequest` `:927/948` — ОБХІД** | salvage |
| 7 | Міграція v4→v5 | `migrations/v4ToV5.js` | `system` | — | реєстр | ✓ |

**AddDocumentModal детально (база DP v2):** `AddDocumentModal.jsx` — UI (двостадійний: старт MODE_SINGLE/MODE_MERGE; форма name/category/author/procId/date/isKey). Реальний pipeline у `CaseDossier onSubmit` (3095-3210): `convertToPdf(file,ctx)` `:3003` → `uploadFileLocal` `:3028` (+ originalDriveId якщо DOCX `:3037`) → гілка: DOCX/HTML `documentNature='searchable'`+skip OCR (`:3091`,`:3153-3187`) / PDF-image `runOcrWithRetryUI` (`:3198`) → `createDocument` `:3099` → `add_document` `:3120`. Це готовий референс «тонкого диригента через шар» — те що DP v2 узагальнює на batch.

**Старий DP детально (джерело трансплантації):** `DocumentProcessor:278` — props без `executeAction`. Внутрішнє: `splitPDFByDocuments` (108-141, pure pdf-lib copyPages по діапазонах), `compressPDF` (143-151, pure pdf-lib `save({useObjectStreams:true})`, catch→оригінал), `analyzePDFWithDocumentBlock` (155-264: base64 PDF → **прямий fetch** `api.anthropic.com` `:165-227` з промптом `:189-222`, `resolveModel('documentProcessor')` `:164`, `logAiUsageViaSink`+`activityTracker.report('agent_call',{agentType:'document_parser',operation:'parse_document'})` `:241-253`, JSON-clean+parse `:258-263`), `getMimeType` (266-276 — **ймовірно надлишкове**, `converterService` вже покриває MIME; перевірити при TASK 1, не трансплантувати наосліп), `handleConfirm` (saveFilesToStorage→`createDocument`→`updateCase` обхід), `handleSplit` (856-997: propose→`PDFDocument.copyPages`→Drive `02_ОБРОБЛЕНІ` через `driveRequest` обхід→`createDocument`→`updateCase` обхід; містить **propose→confirm-гейт** як UX-принцип).

**App.jsx EFFECT-A / splash restore:** документи там не створюються — лише прогін ланцюга міграцій над завантаженим реєстром (`migrateToVersion7` etc.). Не точка створення.

---

## 5. ЗРІЗ СЕРВІСНОГО ШАРУ

### 5.1 Існують (DP v2 переюзовує як є)

- **`converter/converterService.js`**: `convertToPdf(file,ctx)` (142, контракт `{pdfBlob,originalBlob,pdfName,originalName,originalMime,extractedText,warnings,converter,durationMs}`), `convertImagesToPdf` (275), `canConvert` (320). Прапор `CONVERT_DOCX_TO_PDF` (61, default true). Гілки PDF passthrough / HTML / DOCX(+originalBlob) / image / passthrough. Інструментація `document_converted` один раз (340). Edge: Android MIME-fallback (216-224), `IMAGE_EXT_TO_MIME` (72-89). **Готовий.**
- **`sortation/`**: `imageSortingAgent.sortImages(items,opts)` (353; `resolveModel('imageSorter')` 378; UA system-prompt 71-157; duplicates detection 450-487), `orientationCorrector` (`readExifOrientation`74, `resolveOrientation`210 каскад EXIF→docAi.transforms→blocks→page→uncertain, `rotateImageBlob`725). **Готовий, але залишковий ризик TASK B** (messenger-stripped EXIF; 90 vs 270 нерозрізнюване без контенту → `uncertain=true`+UI).
- **`ocrService.js`** + `ocr/`: `extractText` (217), `extractTextBatch` (381, concurrency), `writeExtractedTextArtifact` (191), `writeLayoutArtifact` (203), `serializeLayout`/`stripHeavyFields` (фільтр image~7МБ+tokens), `getCachedText`/`getResumeInfo`/`hasResumeState`. Провайдери `ocr/{documentAi,claudeVision,pdfjsLocal,providerMatrix,resumeStore}`. Retry+resume (271-376; partial→UI dialog, no cascade; auth/quota→break). **Готовий, resume-інфра — зразок для скасовуваності.**
- **`converter/multiImageToPdf.js`**: `convertImagesToPdf(files,opts)` (285) — HEIC→OCR×1→sort(>1, 90s timeout fallback)→orientation→jsPDF→merged text/layout. Принцип «**один OCR на зображення**» (19-30). Залишкові ризики TASK B документовані в коді. **Готовий, переюзовується existing.**
- **`toolUseRunner.js`**: `runToolUse({apiResponse,agentId,executeAction,context})` (94), `runMultiTurnConversation({callAnthropicAPI,initialMessages,tools,systemPrompt,context,maxTurns})` (202), `callAPIWithRetry` (333, maxRetries5). `DEFAULT_MAX_TURNS=10` (34). Викликає `await executeAction(agentId,toolName,params)` (133); ai_usage логування **щотурну** (243-259); auto-inject/lock caseId (108-127). **Production-ready — це і є транспорт для documentBoundary.**
- **`toolDefinitions.js`**: `ADD_DOCUMENT_TOOL` (46), `UPDATE_DOCUMENT_TOOL` (94), `DOSSIER_AGENT_TOOLS` (508-536), **`DOCUMENT_PROCESSOR_AGENT_TOOLS` — порожній placeholder (540)** для DP v2, `getToolsForAgent` (542-548). Закладка під DP v2 існує.

### 5.2 Створити — трансплантація (НЕ писати з нуля)

**`src/services/compressionService.js`** ← `compressPDF` (`DocumentProcessor/index.jsx:143-151`).
- **Дослівно копіюється:** тіло (8 рядків: `PDFDocument.load(buf,{updateMetadata:false})` → `doc.save({useObjectStreams:true})` → catch→повернути оригінал).
- **Загортається:** у named export `compressPdf(arrayBuffer): Promise<Uint8Array>`, без React/UI залежностей, чиста функція.
- **Паритет-тести:** (а) валідний PDF buffer → вихід ≤ вхід за байтами і валідний PDF (`PDFDocument.load` не кидає); (б) пошкоджений buffer → повертає вхід незмінним (catch-гілка); (в) ідемпотентність (повторний compress ≈ stable). Вхід — фіктура малого PDF у `tests/`.

**`src/services/documentBoundary/`** ← `splitPDFByDocuments` + промпт/JSON `analyzePDFWithDocumentBlock` + `handleSplit` гейт.
- **Дослівно:** механіка нарізки `splitPDFByDocuments` (108-141: `copyPages` по `startPage/endPage` діапазонах, `save({useObjectStreams:true})`, skip коли `startIdx>totalPages-1`) → `documentBoundary/splitPdf.js`. **Промпт** (189-222 — інституційне знання: інструкція пошуку меж + JSON-схема + типи court_cover/pleading/court_act/evidence/certificate/contract/other) → `documentBoundary/prompt.js` дослівно. JSON-clean+parse (258-263).
- **Переписується (бо змінює підхід/є патологією):** транспорт `analyzePDFWithDocumentBlock` прямий `fetch api.anthropic.com` (165-227) → через `toolUseRunner.callAPIWithRetry`/`runMultiTurnConversation`; зберегти `resolveModel('documentProcessor')` і білінг `logAiUsageViaSink`+`activityTracker.report('agent_call',{agentType:'document_parser',operation:'parse_document'})` (241-253). `handleSplit` (856-997): механіку copyPages — дослівно; Drive-запис `02_ОБРОБЛЕНІ` через `driveRequest` (927-952) — **переписати через стандартний шар**; `updateCase` (966) — **переписати через `executeAction('document_processor_agent','add_documents')`**.
- **propose→confirm:** `handleSplit` має нараізку лише після явної команди (857-877) + summary перед записом — **зберегти як принцип** (DP v2: межі пропонуються, адвокат підтверджує до запису; не авто-commit). Деталі філософії — `discussion_dp_v2_philosophy_response.md` §8.
- **Паритет-тести:** (а) splitPdf: PDF N стор. + ranges `[{startPage,endPage,name,type}]` → масив PDF з очікуваними pageCount; (б) межовий range (endPage>totalPages) → clamp як у 116/890; (в) start поза межами → skip (118/892); (г) prompt-модуль: рядок-снапшот промпту = legacy дослівно (regression-guard від ненавмисної зміни інституційного тексту).
- `getMimeType` (266-276) — **не трансплантувати без перевірки**: `converterService`/`IMAGE_EXT_TO_MIME` ймовірно покриває. Рішення — у TASK 1 Фаза A після grep-порівняння.

**Структура (опис, не проектування pipeline — це робота TASK DP-1):**
```
src/services/compressionService.js         // compressPdf()
src/services/documentBoundary/
  ├── index.js          // фасад: detectBoundaries(file,ctx) → propose; splitByBoundaries(file,ranges)
  ├── splitPdf.js        // ← splitPDFByDocuments дослівно
  ├── prompt.js          // ← промпт дослівно (institutional knowledge)
  └── analyzeViaToolUse.js // транспорт переписаний на toolUseRunner
```
Тести: `tests/unit/compressionService.test.js`, `tests/unit/documentBoundary.test.js` (паритет), без DOM.

---

## 6. КОНКРЕТНІ ПЛАНИ 5 ПІДГОТОВЧИХ TASK'ІВ

### TASK 1 — Salvage-and-decommission старого DocumentProcessor

**Блокує DP-1:** ні (але прибирає обхід шару і дві точки входу — #11). Один цілісний TASK, 3 фази.

**Фаза A — Salvage:**
- Створити `compressionService.js` ← `compressPDF` `DocumentProcessor:143-151` (дослівно тіло; export `compressPdf(arrayBuffer)`).
- Створити `documentBoundary/` ← `splitPDFByDocuments` `:108-141` (дослівно), промпт `:189-222` (дослівно у `prompt.js`), JSON-parse `:258-263`. Транспорт `analyzePDFWithDocumentBlock` `:155-264` **переписати** на `toolUseRunner` (зберегти `resolveModel('documentProcessor')` + білінг-інструментацію 241-253). `handleSplit` `:856-997` — механіка дослівно, Drive/`updateCase` обхід → через `executeAction`/стандартний шар; propose→confirm зберегти як принцип.
- `getMimeType` `:266-276`: grep-порівняти з `converter` перш ніж трансплантувати (ймовірно надлишкове).
- Паритет-тести (розділ 5.2) зелені.
- Окремі під-звіти про `compressionService` і `documentBoundary` (в межах одного TASK-звіту).

**Фаза B — Decommission (тільки після зелених паритет-тестів):**
- Видалити каталог `src/components/DocumentProcessor/` (єдиний файл `index.jsx`, 1204 р.).
- `CaseDossier/index.jsx`: видалити import `:2`, таб-запис `:2650` `{id:"docprocessor",icon:Wrench,label:"Робота з документами"}`, рендер-гард `:2714-2726`.
- `tests/integration/document-processor.test.js`: **лишити як є** — тестує `document_processor_agent` через `_actionsHarness`, **не** імпортує компонент, видалення не ламає (підтверджено: imports `createDocument`+`createHarness` лише). Файл лишається валідним для DP v2.
- `grep -rn "DocumentProcessor" src/ tests/` — підтвердити що лишились лише текстові згадки (`documentFactory.js` коментар, `toolDefinitions.js:55` рядок-опис, `migrations/v4ToV5.js:43` коментар, `caseSchema.js:78` `lastProcessingContext` опис) — НЕ код-залежності. Текстові згадки оновлювати **не обов'язково** в цьому TASK (зафіксувати у `tracking_debt.md` як косметичний слід).
- Заглушка таба **не потрібна** (видалений таб зникає; ErrorBoundary не задіяний).

**Фаза C — Версіонування:**
- Тег на pre-deletion коміт: `git tag pre-dp-v2-old-dp-removal <sha>` — стабільна ручка для звіряння під час DP v2.
- `CLAUDE.md` таблиця «Точки створення документа»: видалити 2 рядки (`DocumentProcessor:804-822`, `:955-963`); це тригер запису #2 у `tracking_debt.md`.

**INITIAL_CASES/Брановський:** підтверджено — `App.jsx:124-135` створює 12 seed-docs через `createDocument({addedBy:'system',namingStatus:'manual',folder:'01_ОРИГІНАЛИ'})`, **не торкається старого DP**. Лишаються як є.

**Acceptance:** усі тести зелені; паритет-тести підтверджують ту саму поведінку нових сервісів; `grep` показує нуль код-залежностей від `components/DocumentProcessor`; тег створено; CLAUDE.md-таблиця оновлена; `npm test` зелений; код-зміни → показати зведення, отримати підтвердження перед push у main (правило #1).

### TASK 2 — Rename `time_entry.source` → `time_entry.captureMethod`

**Блокує:** ні (знімає колізію #11 у точці злиття DP v2). **Файли:** структура time_entry визначена не схема-файлом (нема `timeEntrySchema.js`) — джерело істини розпорошене: `activityTracker.js` (де пишеться `source`), `timeEntriesQuery.js`, `timeEntriesArchiver.js`, можливі читання в UI білінгу/Dashboard, `_actionsHarness.js`/тести time-entry. **План:** (1) grep `\.source` і `source:` у контексті time_entry по `src/services/{activityTracker,timeEntriesQuery,timeEntriesArchiver,masterTimer,smartReturnHandler}.js` + Dashboard + тести → точний перелік; (2) механічний rename поля на запис **і** читання → `captureMethod`; (3) **міграція** `migrateToVersion8` (або окремий крок за патерном `migrateToVersion7`/`migrateDocumentSource`: ідемпотентна, `time_entries[].source`→`captureMethod`, бекап `_backups/`, прапор, stats) — врахувати **архівні** `_archives/time_entries_YYYY-MM.json` (rename має бути lazy-on-load, не ламати старі архіви: читач нормалізує `source`→`captureMethod` при `loadArchive`); (4) bump `CURRENT_SCHEMA_VERSION` 7→8 + EFFECT-A крок; (5) UI: де `source` показується адвокату в time-entry (Dashboard/activity) — оновити label; (6) `note.source` (CaseDossier:1329) **поза обсягом** — окремий запис у `tracking_debt.md`. **Acceptance:** жодного `time_entry...source` у коді (тільки `captureMethod`); міграція ідемпотентна + покрита тестом; старі архіви читаються; усі тести зелені.

### TASK 3 — eventBus document-топіки

**Блокує:** ні. **Файл:** `src/services/eventBusTopics.js` (після рядка 41). **Додати:** `DOCUMENT_INGESTED='document.ingested'`, `DOCUMENT_BATCH_PROCESSED='document.batch_processed'` (за іменуванням існуючих). Створити frozen-масив `DOCUMENT_TOPICS=Object.freeze([DOCUMENT_INGESTED,DOCUMENT_BATCH_PROCESSED,DOCUMENT_MOVEMENT_CARD_UPDATED,DOCUMENT_ALTERNATIVE_SOURCE_ADDED])` (паралельно `ECITS_TOPICS`/`V7_EDIT_TOPICS`). **Публікувати — НЕ зараз** (DP v2 у майбутньому, як вхідні ЄСІТС-топіки сьогодні no-publisher). **Слухачі — НЕ підключати** (готовність, не реалізація; майбутні: Dashboard Activity Feed, billing). Без bump schemaVersion (константи, не дані). **Acceptance:** топіки експортовані + у масиві; тест eventBusTopics (якщо є) бачить нові; нуль публікацій/підписок; усі тести зелені. Тривіальний адитивний TASK.

### TASK 4 — `update_document_source` ACTION

**Блокує:** потрібен DP v2 (AI-first дзеркало для `source` + conflict-провенанс). **Файли:** `App.jsx` ACTIONS (~біля `update_document` 5463), PERMISSIONS (6125+), `EDIT_ACTIONS_SOURCE_AWARE` (255), `toolDefinitions.js`, тести. **Підпис:** `update_document_source({caseId, documentId, source, sourceConfidence?, extractedAt?, alternativeSource?})` — sync, за патерном інших v7 source-aware ACTIONS (5918+). **Логіка:** знайти doc; інтегрувати `sourcePolicy.canOverwrite(existingDoc.source, source)` — якщо overwrite дозволено → оновити `source/sourceConfidence/extractedAt`; якщо НІ але дані прийшли → `buildAlternativeSourceRecord` → append у `alternativeSources[]` (НЕ перезапис; conflict-провенанс — `discussion_dp_v2_philosophy_response.md` §Питання2) + publish `DOCUMENT_ALTERNATIVE_SOURCE_ADDED`. **Чому окремий ACTION:** `update_document` `ALLOWED_UPDATE_FIELDS` (5463) свідомо **не містить** `source`-полів — пряме розширення того списку порушило б #11 (source має політику пріоритету, а не вільне редагування). **Permissions:** додати в `court_sync_agent`, `document_processor_agent`; у `EDIT_ACTIONS_SOURCE_AWARE` (білінг лише коли `source==='manual'`). **Тести:** canOverwrite-гілки (manual vs court_sync), alternativeSources append, permission gating. **Acceptance:** ACTION + permission + тести; інтеграція `canOverwrite` свідома; усі зелені.

### TASK 5 — ActionsRegistry refactor (БЛОКЕР DP-1)

**Найбільший, найризиковіший. Потребує mini-аудит перед самим refactor'ом** (ACTIONS — ~1300+ рядків inline 4758-6121; замикання над `cases/setCases/getCurrentUser/checkCaseAccess/...`). **Ціль:** винести ACTIONS+PERMISSIONS+спец-сети з `App.jsx` у `src/services/actionsRegistry.js` як **factory з deps injection**: `createActions({getCases,setCases,getCurrentUser,checkCaseAccess,writeAudit,activityTracker,...}) → {ACTIONS,PERMISSIONS,executeAction}`. **API:** `executeAction(agentId,action,params,userId)` лишається тією самою async-сигнатурою і pipeline (розділ 3.3) — міняється тільки **місце визначення**, не контракт. **Проп vs глобал:** `App.jsx` створює інстанс і **продовжує** прокидати `onExecuteAction` пропом у Dashboard/CaseDossier (НЕ робити глобальним сінглтоном — порушило б «спільний стан тільки в App.jsx»); виграш — DP v2 отримує `executeAction` з того самого джерела, не тягне власну логіку, і `_actionsHarness.js` **видаляється** (тести імпортують `createActions(deps)` напряму — закриває `tracking_debt.md` #3). **Регресії:** (1) усі наявні integration-тести (`actions.test.js`, `agent-workflow.test.js`, `drag-n-drop.test.js`, `document-processor.test.js`) мають пройти БЕЗ зміни асертів — лише джерело `createActions` змінюється з harness на реальний модуль; (2) functional-updater патерн `setCases(prev=>...)` (як у `update_document` 5463+) зберегти точно — деякі ACTIONS читають свіжий стан усередині updater; (3) closure-залежності (`cases.find` поза updater у деяких ECITS-ACTIONS) — мапнути в deps явно. **Порядок:** після TASK 1-4, безпосередньо перед DP-1, **не паралелити з DP-1**. **Acceptance:** `actionsRegistry.js` з factory; `executeAction` контракт незмінний; `_actionsHarness.js` видалено, тести імпортують `createActions`; усі тести зелені; нуль змін поведінки (порівняння до/після на тестах).

**Порядок виконання 5 TASK'ів:** 1 і (2,3) паралельно/в будь-якому порядку (незалежні, малі) → 4 (після 1, додає в чисту поверхню) → **5 останнім, окремо, блокер** → потім DP-1. Препараторний cleanup за AUDIT→CLEANUP→РОЗШИРЕННЯ: окрім переліченого — нічого додаткового перед DP v2 не потрібно (система чиста; знахідки розділу 7 не блокують).

---

## 7. ДРІБНІ ЗНАХІДКИ (не виправляти — фіксація)

1. **`documentSchema.js:5-7`** — шапка-коментар «18 ЛЕГКИХ + 6 ВАЖКИХ полів» застарів; фактично 28 канонічних. `caseSchema.js:46` коректний. Косметичний doc-drift.
2. **`CaseDossier:3117`** — передає legacy `source:'manual_upload'` у новий код; `documentFactory.normalizeSource` (108) рятує → `'manual'`. Формально суперечить «не повертати legacy у новий код» (CLAUDE.md ЗАБОРОНЕНО); функціонально коректно. Тривіальна правка (`'manual_upload'`→`'manual'`) — окремо, не в read-only.
3. **Колізія `source` (#11) ширша за дискусійну:** `document/hearing/parties/processParticipants.source`=канал походження; `time_entry.source`=спосіб фіксації; **`note.source`** (`CaseDossier:1329` `handleAddNote`, значення `'manual'`)=спосіб введення нотатки. TASK 2 покриває лише `time_entry`. `note.source` — окремий латентний конфлікт → `tracking_debt.md` (не розширювати обсяг TASK 2).
4. **`update_document` ALLOWED_UPDATE_FIELDS** (`App.jsx:5463`) не містить `source/sourceConfidence/movementCard/alternativeSources/ecitsSource/extractedAt/originalDriveId/originalMime/driveId/addedBy` — здебільшого by-design (source має політику; driveId/addedBy незмінні). Підтверджує необхідність окремого TASK 4 для source. Не баг — контекст для TASK 4.
5. **Doc-drift CLAUDE.md vs код:** (а) `TIME_ENTRY_ACTIONS` згадано в CLAUDE.md-дайджесті, але **в коді не існує** (ні App.jsx, ні permissionService за зрізом); (б) `AUDIT_ACTIONS` (`auditLogService.js:7`) ширший за дайджест (додатково `add_document/add_documents/update_document/delete_document/add_proceeding/update_proceeding/delete_proceeding/restore_from_backup`). Кандидат на синхронізацію CLAUDE.md окремим doc-TASK (не зараз).
6. **`documentFactory.detectNature:199-201`** — PDF default→`'searchable'`; реальне детектування текстового шару робить старий DP «вище за стеком». Після decommission ця відповідальність має явно перейти у DP v2-флоу/AddDocumentModal (`inferNatureFromFile`/`defaultNatureForUI` вже є в CaseDossier:3095). Не баг — coupling-нотатка для TASK 1/DP-1.
7. **`getMimeType` (`DocumentProcessor:266-276`)** ймовірно дублює MIME-логіку `converterService` (`IMAGE_EXT_TO_MIME`, `canConvert`). Перевірити при TASK 1 Фаза A; не трансплантувати без потреби (#11 — дві мапи MIME = два джерела істини).
8. **`update_team` (`App.jsx:5948`)** свідомо без `source` (internal bureau) — узгоджено з `caseSchema` team[] коментарем; але воно в `EDIT_ACTIONS_SOURCE_AWARE` (255) — білінг-гілка читає `params.source` якого нема → завжди skip (фактично коректно, але семантично «source-aware без source»; нотатка для майбутнього прибирання з сету, не баг).

---

## ОБМЕЖЕННЯ ЦЬОГО АУДИТУ

Не писав TASK DP-1, не проектував pipeline DP v2, не оцінював неіснуючі модулі (Metadata Extractor / Telegram / Email), не планував DP-2…6, не виправляв знахідки. Жодного зміненого файлу окрім цього звіту. Архітектурні рамки/терміни/ризики — у `discussion_dp_v2_philosophy_response.md` (посилання, не дубль).

*Кінець `audit_before_dp1_v2.md`.*
