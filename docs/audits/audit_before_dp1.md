# AUDIT — Готовність системи до Document Processor v2 / DP-1

**Дата:** 2026-05-15
**Тип:** read-only аудит перед написанням TASK DP-1 (нічого не змінювалось)
**Гілка:** `claude/complete-file-task-Rl6so`
**Останній коміт:** `aa4a925` — TASK 0.3.5: canonical schema v7 for ECITS integration
**Поточний `schemaVersion`:** `7` (`migrationService.js:65`), `MIGRATION_VERSION = '7.0_ecits_canonical'` (`migrationService.js:66`)
**Окремий лічильник доку-схеми:** `documentSchema.js:234` `CURRENT_SCHEMA_VERSION = 5` (НЕ бампився у v7 — навмисно, гейтить лише v4→v5 ідемпотентно)

**Прочитано перед аудитом:**
- `report_task_0_3_4_addedby_cleanup.md`, `report_task_0_3_5_canonical_schema_v7.md` (точка відліку — на них посилаюсь, не переписую)
- Власні попередні аудити ЄСІТС: `audit_before_task_0_3_5.md`, `audit_review_task_0_3_5_draft.md` (стиль і рівень деталізації)
- `CLAUDE.md` v5.4, `DEVELOPMENT_PHILOSOPHY.md` v1.0

**Файлу `roadmap_dp_v2_detailed.md` у репозиторії немає** — орієнтувався на опис фаз DP-1…DP-6 у TASK.

---

## 1. РЕЗЮМЕ

Схема даних v7 **готова** прийняти DP v2 — `documents[]` має всі 28 канонічних полів, source-policy існує, `add_documents` атомарний, фабрика документів єдина. Але між «схема готова» і «pipeline можна зібрати з готових сервісів» є **критичний розрив**, який треба підняти ДО написання TASK DP-1.

**Червоні прапори:**

1. **Поточний DocumentProcessor повністю обходить шар ACTIONS.** Він пише `documents[]` через сирий проп `updateCase` (`App.jsx:4522`, голий `setCases` без валідації/аудиту/білінгу/eventBus/`updatedAt`), не через `add_documents`. Дозвіл `document_processor_agent → add_documents` зараз **аспіраційний** — компонент його не використовує. Це і є головна мета DP-1, але масштаб виправлення більший ніж «фасад поверх існуючого».

2. **Премиса TASK «DP-1 збирає вже існуючі підмодулі» — частково хибна.** Три заявлені стадії pipeline **не існують як сервіси**: розпакування архівів (.zip/.7z/.rar), фільтрація .p7s/.sig, стиснення. Стиснення живе **inline** у компоненті (`DocumentProcessor:143 compressPDF`), семантична нарізка — теж inline (`DocumentProcessor:155 analyzePDFWithDocumentBlock`, сирий fetch, не Tool Use). Жодного split-tool у `toolDefinitions.js`; `DOCUMENT_PROCESSOR_AGENT_TOOLS = []`.

3. **`source` не є first-class параметром документних ACTIONS, і його не можна виправити через агента.** `update_document` allowlist явно виключає `source`/`sourceConfidence`/`extractedAt`/`ecitsSource`. AI-first дзеркало для документного `source` відсутнє (порушення R1 для DP-каналу).

Що **дійсно зріле і збирається без переробки**: конвертація (`converterService`), OCR з resumeStore і чанкінгом (`ocrService` + `ocr/*`), артефакти (`writeExtractedTextArtifact/writeLayoutArtifact`), Tool Use раннер (`toolUseRunner` — production-grade, лишається лише визначити tools).

**Висновок:** система готова до DP-1 **архітектурно** (схема, ACTIONS-механіка, фабрика), але DP-1 не можна сформулювати як «тонкий фасад над готовим». Це **витяг inline-логіки з компонента в сервіси + новий split-tool + усунення ACTION-обходу**. TASK DP-1 має це явно визнати в scope, інакше буде написаний із застарілим уявленням «все є, треба лише склеїти».

> ⚠️ Тести `1073/1073` перевірити в цьому середовищі **неможливо** — `node_modules`/`vitest` відсутні (`npm test` → `sh: 1: vitest: not found`). Це read-only аудит, жоден файл коду не зачеплений, тож набір тестів не порушений. Зелений статус 1073/1073 підтверджено у `report_task_0_3_5` після останнього коміту `aa4a925`.

---

## 2. АКТУАЛЬНА СХЕМА DOCUMENTS[]

Джерело: `src/schemas/documentSchema.js` (`CANONICAL_DOCUMENT_FIELDS`), фабрика `src/services/documentFactory.js`. **28 канонічних полів** (легкі, у `registry_data.json`) + **7 extended** (`EXTENDED_DOCUMENT_FIELDS`, lazy-load `.metadata/documents_extended.json`).

| # | Поле | Тип | Required | Nullable | Default (фабрика) | enum / формат | Звідки заповнюється |
|---|------|-----|----------|----------|-------------------|---------------|---------------------|
| 1 | `id` | string | ✅ | ні | `doc_<ts>_<rand>` | — | factory `generateDocumentId()` |
| 2 | `name` | string | ✅ | ні | `originalName \|\| 'Без назви'` | — | точка створення |
| 3 | `originalName` | string | ні | так | `null` | — | точка створення |
| 4 | `category` | string | ✅ | ✅ | `null` → ⚠ | pleading/motion/court_act/evidence/contract/correspondence/identification/other/null | точка / агент / `update_document` |
| 5 | `author` | string | ✅ | ✅ | `null` → ⚠ | ours/opponent/court/third_party/null | точка / агент. v4→v5 нормалізує `opp`→`opponent` |
| 6 | `documentNature` | string | ✅ | ні | `detectNature()` | searchable/scanned | factory `detectNature` / OCR-гілка коригує |
| 7 | `namingStatus` | string | ✅ | ні | `'pending'` | auto/manual/pending | точка створення |
| 8 | `isKey` | boolean | ✅ | ні | `false` | — | точка / агент |
| 9 | `procId` | string | ✅ | ✅ | `null` → ⚠ | посилання на `case.proceedings[].id` | точка (часто `proceedings[0]?.id \|\| 'proc_main'`) |
| 10 | `driveId` | string | ✅ | ✅ | `null` | — | upload результат |
| 11 | `driveUrl` | string | ні | так | `null` | — | derived з driveId |
| 12 | `folder` | string | ✅ | ні | `'01_ОРИГІНАЛИ'` | 00_INBOX_СПРАВИ/01_ОРИГІНАЛИ/02_ОБРОБЛЕНІ/03_ФРАГМЕНТИ/04_ПОЗИЦІЯ/05_ЗОВНІШНІ | точка створення |
| 13 | `pageCount` | number | ні | — | `null` | — | OCR / split |
| 14 | `size` | number | ✅ | ні | `0` | байти | точка створення |
| 15 | `icon` | string | ✅ | ні | `pickIcon()` `📄` | емодзі | factory за category |
| 16 | `date` | string | ні | — | `null` | YYYY-MM-DD | точка / агент |
| 17 | `addedAt` | string | ✅ | ні | `now` ISO | datetime | factory |
| 18 | `updatedAt` | string | ✅ | ні | `now` ISO | datetime | factory / ACTION |
| 19 | `addedBy` | string | ✅ | ні | `'user'` | **user/agent/system** (v6.5, normalizeAddedBy) | точка створення (actor) |
| 20 | `status` | string | ✅ | ні | `'active'` | active/archived | точка / `update_document` / `delete_document(archive)` |
| 21 | `source` | string | ні | ✅ | `'manual'` (normalizeSource) | **manual/court_sync/metadata_extractor/telegram/email/unknown/null** (v7) | точка створення; **НЕ редагується через ACTION** |
| 22 | `sourceConfidence` | string | ні | ✅ | `'high'` | high/medium/low/null | точка / синхронізація |
| 23 | `extractedAt` | string | ні | ✅ | `null` | datetime | синхронізації (court_sync/metadata_extractor) |
| 24 | `ecitsSource` | object | ні | ✅ | `null` | `{ecitsDocumentId, ecitsNotificationId, notificationType, cabinetUrl, receivedThroughCabinet, receivedAlsoThroughCabinet}` | Court Sync |
| 25 | `movementCard` | object | ні | ✅ | `null` | `{state, dnzs, documentDate, deliveries[], attachments[]}` | ACTION `update_document_movement_card` |
| 26 | `alternativeSources` | array | ні | — | `[]` | `[{source, sourceConfidence, receivedAt, dataHash}]` | ACTION `update_alternative_sources` (append) |
| 27 | `originalDriveId` | string | ні | ✅ | `null` | — | DOCX→PDF (TASK A) |
| 28 | `originalMime` | string | ні | ✅ | `null` | — | конвертер (TASK A) |

**Extended (7):** `documentId`, `tags[]`, `notes`, `annotations[]`, `processingHistory[]`, `extractedTextSummary`, `customFields{}`. `processingHistory` — заздалегідь закладений «грунт» для подій OCR/нарізки/cleanup із посиланнями на `ai_usage` (CLAUDE.md Phase 1.5). **Зараз ніхто його не пише** — DP v2 має стати першим писачем.

**Validation rules** (`documentFactory.validateDocument`): required+не-nullable → значення не `undefined/null/''`; required+nullable → поле присутнє (може бути `null`); type-check string/number/boolean; enum-check. `needsReview(doc)` = хоч одне з `procId/category/author === null` → маркер ⚠ (`CRITICAL_FIELDS_FOR_WARNING`).

**Що DP v2 має заповнювати при `add_document(s)`:**
- Обов'язково валідні: `id, name, documentNature, namingStatus, isKey, folder, size, icon, addedAt, updatedAt, addedBy, status` + присутні (хай `null`) `category, author, procId, driveId`.
- DP-специфічні: `source` (для DP — `'manual'`, бо файли через UI/адвоката; явно, а не дефолтом), `sourceConfidence`, `pageCount` (з OCR), `documentNature` (детектований після OCR-гілки), `originalDriveId/originalMime` (якщо конвертація DOCX).
- НЕ заповнюються DP: `ecitsSource, movementCard` (це Court Sync); `alternativeSources` (тільки append через ACTION).

**Розбіжність документації (→ розділ 11):** шапка `documentSchema.js:4-8` досі каже «18 ЛЕГКИХ + 6 ВАЖКИХ», CLAUDE.md дерево файлів — «(23 + 6 полів) v5». Реально 28 + 7. Коментар застарів на два TASK; це довговий борг документації, не код.

---

## 3. КОНТРАКТ ACTIONS ДЛЯ DP V2

`ACTIONS` і `PERMISSIONS` — **closure-локальні в `App()`** (App.jsx:4758–6122 / 6125–6207), **не експортуються**. Доступ лише через проп `executeAction`/`onExecuteAction`, що передається у компоненти. Інтеграційні тести дублюють логіку в `tests/integration/_actionsHarness.js` (визнаний борг — запланований ActionsRegistry refactor). **Це структурний факт №1 для DP-1: фасад або тягне `executeAction` пропом униз, або потребує винесення реєстру.**

### `add_document` — App.jsx:5380
`async ({ caseId, document })`. Required: `caseId`, `document`. `validateDocument(document)` → invalid: fail. Дублікат за `document.id` → fail. Один документ, один `setCases` (append + `case.updatedAt`). `source` **не параметр** — він всередині `document` (виставляє `createDocument()`). eventBus: **ні**. Audited: **так** (`AUDIT_ACTIONS`). Білінг: так. ⚠ Дедуп проти **stale-closure `cases`** (не `setCases(prev=>)`), на відміну від `update_document`.

### `add_documents` — App.jsx:5410
`async ({ caseId, documents })`. **Атомарний all-or-nothing**: спершу валідація всього масиву, потім перевірка дублікатів усіх id, лише тоді один `setCases` (bulk append + `updatedAt`). Це **єдиний справді атомарний bulk-шлях** — цільовий для «атомарного запису DP-1». eventBus: ні. Audited: так. Той самий stale-closure caveat для дедупу.

### `update_document` — App.jsx:5463
`async ({ caseId, documentId, fields })`. **Allowlist полів**: `name, category, author, documentNature, namingStatus, isKey, procId, driveUrl, folder, pageCount, date, icon, status, lastOcrAt`. Решта → reject. **`source/sourceConfidence/extractedAt/ecitsSource/movementCard/alternativeSources/driveId/addedBy/addedAt/id` НЕ оновлювані** через цей ACTION. Захищений від in-flight stale-closure (функціональний `setCases(prev=>)`, hoisted `outcome`, ре-валідація злитого doc). eventBus: ні. Audited: так.

### `delete_document` — App.jsx:5532
`async ({ caseId, documentId, mode='full' })`. **UI-ONLY** (`UI_ONLY_ACTIONS`): вимагає `params._fromUI === true`, інакше reject; жодна агент-роль не має. `archive` → лише `status:'archived'`; `registry_only` → видалення + чистка extended; `full` → + best-effort Drive delete (driveId/originalDriveId/OCR-кеш, кожен в ізольованому try/catch). Не атомарний по Drive. Audited: так.

### `update_processing_context` — App.jsx:5783
`async ({ caseId, context })`. Required: `caseId`, `context` з не-null `processedAt, documentsCount, summary`. Повна заміна `case.lastProcessingContext` + `updatedAt`. **Єдиний писач `lastProcessingContext`.** `source` не приймає. eventBus: **ні**. Audited: ні. Білінг: так. Доступний `dossier_agent` і `document_processor_agent`.

### v7 ACTIONS (контекст для DP — заповнення з не-UI каналів)
| ACTION | Підпис | `source` обов'язк.? | Атомарність | eventBus |
|---|---|---|---|---|
| `update_document_movement_card` | `({caseId, documentId, movementCard, source})` | ✅ | sync, double-lookup | `DOCUMENT_MOVEMENT_CARD_UPDATED` |
| `update_alternative_sources` | `({caseId, documentId, alternativeSource})` | ні (`alternativeSource.source`) | sync, **append** | `DOCUMENT_ALTERNATIVE_SOURCE_ADDED` |
| `mark_synced_from_ecits` | `({caseId, status, durationMs, documentsCount, hearingsCount})` | ні | sync, інкремент `syncMetrics` | `ECITS_SYNC_COMPLETED` |
| `update_case_ecits_state` | `({caseId, patch, source})` | ✅ | merge з `canOverwrite` | `ECITS_CASE_STATE_UPDATED` |

`update_case_ecits_state` повертає `success:true` навіть коли `overwriteSkipped:true` — **caller мусить перевіряти `overwriteSkipped`** (→ розділ 11).

### PERMISSIONS (повні allowlists)
- **`document_processor_agent`**: `['add_documents', 'update_processing_context', 'batch_update']` — рівно те, що DP-1 потребує, але **зараз не використовується** (див. розділ 6).
- **`court_sync_agent`** (active): `add_hearing, update_hearing, mark_synced_from_ecits, update_case_ecits_state, update_parties, update_team, update_process_participants, update_proceeding_composition, update_document_movement_card, update_alternative_sources`. Заборонено: `destroy_case, add_document, update_document, delete_document, create_case`.
- **`metadata_extractor_agent`**: `[]` — defined, DISABLED.
- Інші: `qi_agent` (включає `add_document, update_document`), `dossier_agent` (включає `add_document, update_document, update_processing_context`), `dashboard_agent`.

### executeAction flow (App.jsx:6214–6324)
identity → UI-only-gate **АБО** `PERMISSIONS[agentId].includes(action)` → `ACTIONS[action]` існує? → `checkTenantAccess` (active) → `checkRolePermission` (stub true для bureau_owner) → `checkCaseAccess` (active, лише якщо `params.caseId`) → `await ACTIONS[action](params)` у try/catch → `shouldAudit` → activityTracker білінг-хук → return raw result. **`executeAction` сам не зберігає** — персист робить `useEffect` на `[cases]` (Drive sync), який тригериться `setCases` усередині кожного handler.

**Білінг-skip:** `SYSTEM_ACTIONS_NO_BILLING` = `{track_session_start, track_session_end, batch_update, mark_synced_from_ecits, update_case_ecits_state}`. `EDIT_ACTIONS_SOURCE_AWARE` (6 v7 edit) — skip лише якщо `params.source && !== 'manual'`. Документні `add_document(s)`/`update_document`/`update_processing_context` **нараховуються** (не виключені).

---

## 4. SOURCE POLICY І ЯК DP V2 ЇЇ ВИКОРИСТОВУЄ

`src/services/sourcePolicy.js` (86 рядків): `SOURCE_PRIORITY` (frozen) `manual:100 > court_sync:80 > metadata_extractor:60 > telegram/email:50 > unknown:10`; `canOverwrite(existing, new)` (немає existing → true; інакше `priority(new) > priority(existing)`); `buildAlternativeSourceRecord(source, conf, data)` → `{source, sourceConfidence, receivedAt, dataHash}`; `hashData()` — простий не-крипто 32-bit hex.

**Хто викликає зараз:** лише `update_case_ecits_state` (через `_lastSource` у `ecitsState`) і `update_alternative_sources` (`buildAlternativeSourceRecord`). **`documents[]` source-policy НЕ застосовується** — `add_document(s)` не звіряє `canOverwrite`, `update_document` навіть не може торкатися `source`. Тобто для документів source-policy зараз — мертвий код стосовно реального дедупу/конфлікту.

**Гіпотеза — як DP v2 має використовувати (рекомендація):**

DP-1 — канал `source: 'manual'` (адвокат через UI/Drive). manual має найвищий пріоритет, тож конфлікти DP↔court_sync вирішуються тривіально (manual не перезаписується автоматично; court_sync не перезаписує manual). **Реальна потреба source-policy для DP-1 мінімальна** — вона стає критичною на DP-5/Court Sync, не зараз.

Найкращий варіант: **DP-1 НЕ вбудовує canOverwrite у кожен add_document.** Замість цього:
1. `documentPipeline.js` при дедуплікації (той самий файл уже у справі — за `ecitsDocumentId`/hash/ім'я) **звертається до `sourcePolicy.canOverwrite`** як до чистої функції, щоб вирішити: створити новий запис, оновити, чи лише `update_alternative_sources` (append аудит).
2. Сам запис іде через `add_documents` (atomic) — ACTION лишається «дурним» писачем, політика — у фасаді.

Обґрунтування: правило #11 + DEVELOPMENT_PHILOSOPHY «functions — одна дія». ACTION має писати, фасад — вирішувати. Вшивати policy в ACTION = два сенси на `add_documents` (запис + арбітраж). Це окремий шар у `documentPipeline.js`, не зміна ACTIONS.

---

## 5. METADATA EXTRACTOR EMBRYO

`src/services/metadataExtractor/README.md` (90 рядків) — повний текст наведено нижче дослівно (це папка-ембріон, інфраструктура без реалізації):

> **Metadata Extractor — основний канал для не-ЄСІТС джерел.** Системний шар який витягує структуровані дані (сторони, реквізити, дати, метадані документів) з усіх каналів окрім офіційного ЄСІТС-кабінету. **Це не fallback.** Це основний канал для більшості життєвого циклу справи. Court Sync — спеціалізований канал для вузького періоду коли справа у ЄСІТС.
>
> **Зони відповідальності:** Court Sync — primary для ЄСІТС-кабінету; Metadata Extractor — primary для всіх інших каналів. Обидва пишуть у ту саму канонічну схему через ті самі ACTIONS (з різним `source`). Споживачі не розрізняють.
>
> **Стан зараз (травень 2026):** папка-ембріон. Інфраструктура з TASK 0.3.5: канонічна схема з source-полями; generic ACTIONS приймають `source` (`add_hearing, update_parties, update_process_participants, update_proceeding_composition, update_document_movement_card, update_alternative_sources`); роль `metadata_extractor_agent` defined але `enabled:false` (порожній allowlist); `sourcePolicy.js`. Реальна реалізація — окремий стратегічний TASK. Тригери активації: адвокат регулярно отримує документи поза кабінетом; робота з планшета/телефону без Chrome; перехід у SaaS; ЄСІТС ламає Court Sync; архівна міграція.
>
> **Контракт даних:** усі канали Metadata Extractor пишуть через ті самі ACTIONS що Court Sync (`add_hearing/update_hearing/update_parties/update_process_participants/update_proceeding_composition/update_document_movement_card/update_alternative_sources/update_case_ecits_state` — всі з `source:'metadata_extractor'`). **Майбутні ACTIONS (НЕ в 0.3.5):** `add_timeline_event` (TASK 0.7), `update_case_dnzs` (після DP v2 — парсинг довідки про набрання законної сили).

**Контракт для виклику з DP v2:** README не прописує прямого виклику Metadata Extractor з DP v2 — він описує **спільний контракт ACTIONS**, а не функціональний інтерфейс. Ключове для DP-1: Phase 1 Metadata Extractor (точка входу «Записати без файлу» → документ з `source:'manual'`) фізично закладається у **DP-4**, не DP-1. У DP-1 достатньо **спроектувати hook як точку розширення**, не реалізовувати інтерфейс.

**Де у pipeline логічно вставити hook:** після стадії «класифікація файлів», перед «конвертація» — там, де pipeline вирішує «це файл чи нотатка-без-файлу». DP-1 має заклавши **єдину точку входу `documentPipeline.ingest(input, ctx)`** де `input` може бути file-batch АБО (майбутнє DP-4) текстова/голосова нотатка. Зараз — лише сигнатура з гілкою-заглушкою `if (input.kind === 'note') throw NotImplemented('DP-4')`, не повний інтерфейс. Це відповідає DEVELOPMENT_PHILOSOPHY «інтеграція з сервісом → заклади інтерфейс/заглушку, реалізацію відклади».

---

## 6. ТОЧКИ СТВОРЕННЯ ДОКУМЕНТА — ПЕРЕЛІК І СТАН

Усі точки створюють об'єкт через `createDocument()` (єдина фабрика — добре). Різниця — як **персистять** і чи готові до v7.

| # | Точка | Файл:рядки | source переданий | Персист | Через ACTION? | v7-готовність |
|---|-------|-----------|------------------|---------|---------------|---------------|
| 1 | **DP основна обробка** | `DocumentProcessor:808–826` | ❌ (фабрика→`manual`) | `updateCase(id,"documents",[...])` | **НІ — обхід** | addedBy `user`, namingStatus `auto`. Без `source` явно, без `updatedAt` на case, без валідації/аудиту/білінгу/eventBus |
| 2 | **DP split PDF** | `DocumentProcessor:956–969` | ❌ (фабрика→`manual`) | `updateCase(id,"documents",[...])` | **НІ — обхід** | + **driveId НЕ захоплюється**: split-PDF завантажуються на Drive (`:938–952`) але response id не пишеться в doc → `driveId:null` (втрата лінкування, → розділ 11). pageCount є, size відсутній |
| 3 | **CaseDossier старий inline-модаль** | `CaseDossier:2920–2951` | ❌ (фабрика→`manual`) | `updateCase(id,"documents",updated)` | **НІ — обхід** | addedBy `user`, namingStatus `manual`. Legacy шлях |
| 4 | **CaseDossier drag-n-drop черга** | `CaseDossier:2241–2278` | ❌ (фабрика→`manual`) | `onExecuteAction('dossier_agent','add_document',…)` | **ТАК** ✅ | category/author/procId=`null` (свідомо ⚠). Один `add_document` на файл — **не атомарно** для пакета |
| 5 | **CaseDossier AddDocumentModal** | `CaseDossier:3099–3130` | ⚠ `'manual_upload'` (legacy v6.5) | `onExecuteAction('dossier_agent','add_document',…)`, fallback `updateCase` | **ТАК** ✅ (fallback — НІ) | Передає **застаріле** `source:'manual_upload'`; фабрика `normalizeSource` мапить у `'manual'`, тож працює, але call-site застарів на TASK 0.3.5 (→ розділ 11) |
| 6 | INITIAL_CASES seed (Брановський) | `App.jsx:~100` | — | у масиві | n/a | addedBy `system` (виправлено в 0.3.4) |
| 7 | Історична міграція | `migrations/v4ToV5.js:136–157` | — (default addedBy `system`) | реєстр | n/a | OK |

**Де DocumentProcessor отримує дані:** проп `updateCase` (НЕ `onExecuteAction`) — `DocumentProcessor({ caseData, cases, updateCase, onCreateCase, onNavigateToDossier, apiKey, driveFolderId, driveToken, setAiUsage })`. Монтується з `CaseDossier:2715`, не з App.jsx напряму.

**Висновок розділу:** 3 з 5 активних точок (DP×2, старий модаль) **обходять ACTIONS повністю** через сирий `updateCase`. `update_case_field` не використовується (він і так блокує `documents` allowlist'ом — `App.jsx:4799`). Drag-n-drop і AddDocumentModal — взірець правильного шляху (`add_document` через `executeAction`), але **не атомарні** для пакета (по одному документу). Жодна точка не виставляє `source` явно — усі покладаються на дефолт фабрики; для DP це слід зробити явним (правило #11 — дефолт мовчазно несе сенс).

**Де-факто pipeline AddDocumentModal** (`CaseDossier:2966–3209`), який DP-1 має консолідувати: `convertToPdf` (try/catch, помилка → модаль відкрита, документ не створюється) → upload → `createDocument` → `add_document` → гілка А (extractedText DOCX/HTML: `writeExtractedTextArtifact` .txt + опц. `writeLayoutArtifact` + `update_document(lastOcrAt)`, OCR пропускається) / гілка Б (`!hasOcrSupport`: стоп) / гілка В (PDF/image: `runOcrWithRetryUI` → `update_document(documentNature,lastOcrAt)`). Це найповніший наявний приклад; DP-1 має зробити це сервісом, а не логікою компонента.

---

## 7. ІНТЕГРАЦІЙНА КАРТИНА

**EventBus** (`eventBus.js` — простий in-memory pub/sub, помилки handler'ів ізольовані; `eventBusTopics.js` — 14 топіків). DP v2 **зараз не має жодного топіка для подій документів**: `add_document(s)/update_document/delete_document/update_processing_context` **не публікують нічого**. Опубліковані лише 8 v7-топіків (ECITS group + 6 edit). **Архітектурний пробіл:** модуль, що хотів би реагувати на ingestion документів (Activity Feed дашборду, search index, агент досьє через `lastProcessingContext`), сигналу не має. DP-1 — природна точка завести `document.ingested` / `document.batch_processed` топіки (закласти константи, публікувати з фасаду/ACTION).

**activityTracker / time_entries:** `report(eventType, ctx)` пише в `time_entries[]` через sink (вимкнено до hydration — `_enabled`). DocumentProcessor вже інструментований **inline** (НЕ через executeAction-хук): `docproc_batch_started:323`, `docproc_ocr_processed:474`, `docproc_split_proposed:528`, split/`docproc_batch_completed:723`, `agent_call:248/455/627`. Категорія через `categoryForCase(caseId)`. Оскільки DP обходить `executeAction`, **білінг-хук executeAction для DP не спрацьовує** — DP покладається лише на власні inline-report. Після DP-1 (через `add_documents`) додасться **другий** білінг-сигнал від executeAction-хука → ризик подвійного нарахування за ту саму обробку (→ розділ 9, питання). `add_documents` — НЕ в `SYSTEM_ACTIONS_NO_BILLING`, тож нараховується.

**ai_usage:** `logAiUsage`(React) / `logAiUsageViaSink`(не-React). DocumentProcessor логує через `logAiUsageViaSink`+`setAiUsage` (`:241`) і `logAiUsage` (`:448/620`), модель — `resolveModel('documentProcessor')`. `MODEL_PRICING` має `claude-opus-4-7`. Інфраструктура готова; DP-1 має зберегти ці точки при винесенні в сервіс (передати `setAiUsage` у фасад).

**Multi-user готовність:** `tenantId/userId` проставляються автоматично в `time_entries` (activityTracker) і `ai_usage` (aiUsageService) через `getCurrentTenant/getCurrentUser` (заглушки → DEFAULT). Документи **не несуть `tenantId/userId` на рівні запису** — успадковують від справи (`case.tenantId/ownerId`), що відповідає правилу «не дублювати tenantId у вкладених». `ecitsSource.receivedThroughCabinet.userId` і `user.ecitsCabinetIdentifier` — закладені для multi-user dedupe Court Sync, DP-1 їх не чіпає. eventBus payload несе `tenantId` (SaaS-готовність).

---

## 8. ГОТОВНІСТЬ СЕРВІСНОГО ШАРУ

| Стадія DP-1 | Сервіс | Стан |
|---|---|---|
| Класифікація файлів | `detectDocumentNature.js`, `converterService.canConvert` | ⚠ Частково — лише scanned/searchable + MIME-тріаж. **Немає** класифікатора «архів/підпис/документ» |
| Розпакування архівів | — | ❌ **Не існує.** ZIP-PDF лише детектується і **відхиляється** як `UNSUPPORTED` (`documentAi.js:282`). `.p7s/.asic/.zip` згадані лише в icon-map і UNSUPPORTED-списку DP |
| Фільтрація .p7s/.sig | — | ❌ **Не існує** |
| Конвертація | `converterService.convertToPdf` / `convertImagesToPdf` | ✅ Зрілий planka-фасад. Два контракти (single vs multi-image — DP-1 має гілкувати). Помилки кидаються наверх (by design) |
| Стиснення | — (inline `DocumentProcessor:143 compressPDF`) | ❌ **Не сервіс.** pdf-lib re-save inline у компоненті; треба винести |
| OCR + resumeStore | `ocrService.js` (top-level, **не** `ocr/ocrService.js`) + `ocr/*` | ✅ Зрілий. Чанкінг 15 стор, retry 3× backoff, resumeStore (in-memory, keyed by driveId), cascade-правила, cache `<basename>_<driveId>.txt` |
| Семантична нарізка (Tool Use) | `toolUseRunner.js` (раннер) | ⚠ Раннер production-grade (DI `callAnthropicAPI`/`executeAction`, retry, maxTurns). **АЛЕ:** немає split-tool у `toolDefinitions.js`; `DOCUMENT_PROCESSOR_AGENT_TOOLS=[]`. Реальна нарізка зараз — inline `analyzePDFWithDocumentBlock` (`DocumentProcessor:155`, сирий fetch, JSON-промпт, **не Tool Use**) |
| Збереження артефактів | `ocrService.writeExtractedTextArtifact/writeLayoutArtifact` | ✅ Готово (вимагає Drive `file` з `subFolders` + `id`) |
| Атомарний запис | `add_documents` ACTION | ✅ Готово (див. розділ 3) |

**Edge cases у провайдерах:** `documentAi` — ZIP-PDF→UNSUPPORTED (не unpack), >20MB/>15 стор→чанкінг, partial NETWORK→`makePartialError(partial:true)`, per-chunk resume checkpoint. `claudeVision` — fallback тільки через forceProvider, без retry, без pageStructure, `options.startPage` для resume-after-documentAi. `pdfjsLocal` — UNSUPPORTED якщо скан (<200 chars/page) → тригерить documentAi. `resumeStore` — **lost on reload** (свідомо, in-memory), keyed by driveId → in-memory blob з синтетичним id не resumable. `sortation/*` (imageSortingAgent — Sonnet JSON свідомо НЕ Tool Use; orientationCorrector — детермінований каскад) wired лише в `multiImageToPdf` (multi-image шлях), не в single-file `convertToPdf`.

**`multiImageToPdf.js`** — найближчий до багатостадійного pipeline приклад (HEIC→OCR conc.3→sort→orientation→jsPDF→merged text/layout), сильний референс-патерн для архітектури DP-1.

---

## 9. РИЗИКИ І ВІДКРИТІ ПИТАННЯ

### Р1. Premise scope: DP-1 ≠ «тонкий фасад над готовим»
Три стадії (архіви, .p7s/.sig, стиснення) не мають сервісів; нарізка — inline без Tool Use; немає split-tool. **Питання до адмін-Клода:** чи DP-1 (за принципом «розширюваний фасад, точки розширення для DP-2…DP-6») реалізує **тільки** скелет фасаду + наявні стадії (convert/OCR/save/atomic-write) + усунення обходу, а архіви/.p7s/стиснення/нарізку лишає **named extension points зі заглушками** для DP-2/DP-3? Чи DP-1 одразу витягує inline `compressPDF`/`analyzePDFWithDocumentBlock` у сервіси? Це визначає обсяг у рази. Моя рекомендація: скелет + наявне + заглушки (YAGNI/Делта), але рішення — за адмін-Клодом.

### Р2. Усунення ACTION-обходу — більше ніж рефактор персисту
`updateCase` (App.jsx:4522) — сирий `setCases`. Заміна на `add_documents` міняє семантику: з'являється валідація (документи DP мусять пройти `validateDocument` — чи всі поля валідні на момент batch-create до OCR?), аудит (кожен batch → запис у `auditLog` — очікувано?), білінг-хук executeAction. **Питання:** `add_documents` дедуп проти **stale-closure `cases`** (не `setCases(prev=>)`) — `update_document` спеціально хардився проти цього, `add_documents` ні. DP-1 видає послідовні add'и після `await OCR` (секунди) — той самий in-flight stale-closure ризик, що описаний у `update_document:5483`. Чи DP-1 робить **один** `add_documents` наприкінці (після всього pipeline), чи інкрементально? Рекомендація: один атомарний `add_documents` у кінці; але тоді проміжний прогрес/відновлення (resumeStore) треба тримати поза реєстром.

### Р3. Подвійний білінг
DP інструментований inline (`docproc_batch_*`, `agent_call`). Після переходу на `add_documents` додасться білінг-хук `executeAction` (`add_documents` НЕ в `SYSTEM_ACTIONS_NO_BILLING`). Дві time_entries за одну обробку. **Питання:** додати `add_documents` у `SYSTEM_ACTIONS_NO_BILLING` коли викликається з DP-pipeline (але тоді manual drag-n-drop теж перестане нараховуватись — конфлікт), чи прибрати inline-report DP і покластися на хук, чи розрізняти за context? Це семантичне зіткнення `add_documents` (дія адвоката vs системна обробка) — правило #11.

### Р4. Семантичне зіткнення `source` (правило #11)
`source` як ім'я живе у ≥4 непов'язаних таксономіях: `document.source` (канал файлу), `note.source` (`CaseDossier:1329 'manual'`, `App.jsx:4567`), `time_entry.source` (`timer/manual/agent/import/legacy/instrumentation`), `parties[].source`/`hearing.source`. Кожен scoped до своєї сутності — формально правило #11 не порушене (один сенс **у межах сутності**). Але DP-1 вводить `documentPipeline` що торкається документів **і** time_entries **і** (майбутнє) нотаток — у одному фасаді три різні `source`. **Питання/прапор:** зафіксувати в TASK DP-1 «SEMANTIC CLARITY CHECK» що фасад не плутає ці три, і не вводити `pipeline.source` як п'ятий сенс.

### Р5. AI-first дзеркало для `document.source` відсутнє
`update_document` allowlist виключає `source/sourceConfidence/extractedAt`. Адвокат **не може** через діалог з агентом сказати «познач що цей документ насправді з телеграму» — немає ACTION. v7 закрив дзеркало для parties/team/composition/movementCard/alternativeSources, але **не для базового `source`/`sourceConfidence` документа**. Порушення R1 (AI-FIRST, DEVELOPMENT_PHILOSOPHY) саме для DP-каналу. **Питання:** чи DP-1 (або preparatory cleanup) додає `update_document_source({caseId, documentId, source, sourceConfidence})` edit-ACTION з source-policy (canOverwrite) + eventBus, за патерном v7 edit-ACTIONS? Рекомендую — так, це невеликий preparatory ACTION, який закриває дірку до того, як DP-1 почне масово створювати документи з source.

### Р6. Тестове покриття для безпеки DP-1
Існує `tests/integration/document-processor.test.js`, `tests/integration/_actionsHarness.js`. Але harness **вручну дублює** ACTIONS — при DP-1 (новий фасад + можливо новий ACTION) harness треба синхронізувати вручну (борг). **Питання:** чи DP-1 — слушний момент зробити ActionsRegistry refactor (винести `ACTIONS`/`PERMISSIONS` з `App()` closure у `src/services/actionsRegistry.js` як factory з DI), щоб `documentPipeline.js` і тести імпортували реєстр напряму? Це усуває structural-факт-№1 (closure-locked ACTIONS) і прибирає harness-борг. Великий, але DP-1 без нього тягне `executeAction` пропом крізь 3 рівні компонентів.

**Окремо для обговорення ДО DP-1 (мінімум 3, як вимагає TASK): Р1 (scope), Р2 (атомарність/stale-closure), Р3 (подвійний білінг), Р5 (AI-first дірка source), Р6 (ActionsRegistry).**

---

## 10. ПРОПОЗИЦІЇ ДЛЯ DP-1 (варіанти, не нав'язую)

Спільне для всіх: `src/services/documentPipeline.js` — **розширюваний фасад** з named stages, кожна стадія — функція з єдиною відповідальністю; невідсутні стадії DP-2…DP-6 — `extension points` із заглушкою `throw NotImplemented`. Запис — через `executeAction('document_processor_agent','add_documents',…)` (усуває обхід). Логи — `ai_usage` + activityTracker (одна стратегія, див. Р3).

### Варіант A — «Тонкий фасад + наявне, решта заглушки» (YAGNI / Делта)
DP-1 реалізує лише: classify(lite: scanned/searchable+MIME) → convert (`converterService`) → OCR (`ocrService`+resumeStore) → save artifacts → **atomic** `add_documents` → `update_processing_context`. Стадії `unpackArchive/filterSignatures/compress/semanticSplit` — named noop/заглушки з чіткими сигнатурами + TODO-тригер «DP-2/DP-3». Inline `compressPDF`/`analyzePDFWithDocumentBlock` поки **лишаються в DocumentProcessor**; фасад їх не тягне.
- **+** Найменший scope, швидко, не ламає DocumentProcessor (паралельне існування), 80% сьогодні.
- **−** DocumentProcessor продовжує обхід ACTIONS поки не переведений; дві кодові гілки тимчасово; «нарізка» не у фасаді (DP-3 робитиме великий рефактор).

### Варіант B — «Фасад + витяг inline-сервісів» (повне ДНК стадій)
Як A, **плюс** одразу витягти `compressPDF`→`src/services/converter/compressionService.js` і `analyzePDFWithDocumentBlock`→`src/services/documentBoundary/` + визначити `analyze_document_boundaries` tool у `toolDefinitions.js` (раннер вже готовий). DocumentProcessor переписується на фасад одразу.
- **+** Один шлях, нарізка одразу через Tool Use (закладає DP-3 інфраструктурно), усуває обхід повністю, чисте ДНК.
- **−** Великий scope (≈ DP-1+DP-3 частково), ризик зачепити стабільний DocumentProcessor, суперечить «DP-1 не реалізує DP-2…DP-6».

### Варіант C — «Preparatory cleanup → потім фасад» (AUDIT→CLEANUP→РОЗШИРЕННЯ)
Спершу окремий micro-TASK: (1) ActionsRegistry refactor (Р6), (2) `update_document_source` edit-ACTION (Р5), (3) рішення білінгу (Р3), (4) eventBus-топіки документів. **Потім** DP-1 = Варіант A на чистій базі.
- **+** Відповідає робочому процесу CLAUDE.md (cleanup перед розширенням при семантичних зіткненнях — Р4/Р5 саме такі), DP-1 стає справді тонким, тести/harness спрощуються.
- **−** Два TASK замість одного, відкладений старт DP-1.

**Моя рекомендація для адмін-Клода:** **C для блокерів Р5/Р6, далі A.** Р5 (AI-first дірка) і Р6 (closure-locked ACTIONS + harness-борг) — це саме «семантичне/структурне зіткнення яке варто впорядкувати ПЕРЕД розширенням» (DEVELOPMENT_PHILOSOPHY: цикл AUDIT→CLEANUP→AUDIT→РОЗШИРЕННЯ). B зливає DP-1 і DP-3 — суперечить принципу «DP-1 закладає точки розширення, не реалізує». Але остаточний баланс scope — рішення адмін-Клода і засновника.

---

## 11. ДРІБНІ ЗНАХІДКИ

Не виправлено (read-only аудит). Кожна — кандидат на окремий micro-TASK.

1. **`CaseDossier:3117`** — AddDocumentModal передає `source: 'manual_upload'` (legacy v6.5). Фабрика `normalizeSource` мапить у `'manual'`, тож працює, але call-site застарів на TASK 0.3.5. Сигнал для ревізії точки створення (як і застерігає CLAUDE.md розділ 0.3.5 «нові точки мають використовувати тільки нові константи»).

2. **`DocumentProcessor:938–969` (split PDF)** — нарізані PDF завантажуються на Drive (`driveRequest` POST `:948`), але **response `id` не захоплюється**; `createDocument` на `:956` не отримує `driveId` → документ створюється з `driveId:null`. Втрата лінкування split-документа з його файлом на Drive. Функціональний баг, не косметика.

3. **`documentSchema.js:4-8`** — шапка-коментар каже «18 ЛЕГКИХ полів … 6 ВАЖКИХ». Реально 28 канонічних + 7 extended. Коментар застарів на TASK A / 0.3.5. (CLAUDE.md дерево файлів «documentSchema.js — (23 + 6 полів) v5» — той самий борг; це для `recommended_task_claude_md_audit.md`, не код.)

4. **`update_case_ecits_state`** повертає `success:true` навіть коли `overwriteSkipped:true`. Caller, що не перевіряє `overwriteSkipped`, вважатиме що дані записані. Семантично `success` тут несе два сенси (ACTION виконався AND/OR дані записані) — потенційне правило-#11-зіткнення на майбутнє (зараз лише `update_case_ecits_state`, але DP-5/Court Sync масштабує).

5. **`EDIT_ACTIONS_SOURCE_AWARE` містить `update_team`**, але `update_team` не приймає `source` → source-aware skip-гілка для нього ніколи не спрацьовує (завжди нараховується). Поведінка співпадає з коментарем, але членство у Set вводить в оману (skip-логіка інертна). Косметика/ясність.

6. **DP точки створення (#1,#2,#3) не виставляють `source` явно** — покладаються на дефолт фабрики `'manual'`. Правило #11 «дефолт мовчазно несе сенс»: для каналу походження краще явний `source:'manual'` на call-site, особливо коли DP-1 формалізує канал. (Не баг — стиль/ясність, але доречно зафіксувати у TASK DP-1.)

7. **`document_processor_agent` PERMISSIONS** (`add_documents, update_processing_context, batch_update`) — повністю **аспіраційний**: жоден з трьох не викликається реальним DocumentProcessor (він на `updateCase`). Не баг сам по собі (це і є мета DP-1), але формально дозвіл існує без споживача — варто згадати в TASK як «активувати, не створювати».

---

**Кінець audit_before_dp1.md**

Звіт описує стан після коміту `aa4a925`. Жоден файл коду не змінювався. Перед DP-1 рекомендую обговорити Р1, Р2, Р3, Р5, Р6 (розділ 9) з адміністративним Клодом і засновником.
