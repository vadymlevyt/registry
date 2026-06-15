# ДІАГНОСТИКА DP · НАСКРІЗНІ ТЕМИ (§3.2 + §3.5-B/D/E/H)

**Дата:** 2026-06-15
**Тип:** read-only наскрізна діагностика (PART 1 повного аудиту DP, WAVE 2).
**Скоуп:** крос-куттінг через усі 4 сценарії DP — `docs/tasks/TASK_dp_full_audit.md`
§3.2 (tmp/Drive lifecycle · OCR провайдер-патерн · білінг/ai_usage · error handling ·
канонічна схема) + §3.5-B (вхідний роутер) + §3.5-D (гранулярність + участь у контексті) +
§3.5-E (B2-інвентар AI-точок) + §3.5-H (профіль вартості).
**Будує на:** `audit_dp_slicing.md`, `audit_dp_image_merge.md`, `audit_dp_add_files.md`,
`audit_dp_zip_ingest.md` (WAVE 1). Не дублює їх — зводить наскрізні лінії і верифікує
ліди власним `file:line`.

## Методологія
Read-only. **Жоден рядок коду не змінено** — створено лише цей `.md`. КОЖНЕ твердження
звірене проти коду з `file:line` (§1.2-bis). Де код суперечить докам/лідам — істина в
коді, розбіжність окремим рядком. Гілка `claude/dp-full-audit-findings`.
Словник вироків: код — «живий / дрімає-приберегти / мертве-видалити»; станції —
«жива / passthrough / мертва».

Гілка-факт: DP-модуль (`DocumentProcessorV2`) рендериться **всередині** `CaseDossier`
(`CaseDossier/index.jsx:2449`), а `CaseDossier` загорнутий у `<ErrorBoundary>`
(`App.jsx:5556`) → DP транзитивно під ErrorBoundary (деталь §5).

---

## 2. §3.2 TMP / DRIVE LIFECYCLE (через усі 4 сценарії)

### 2.1 Таблиця tmp/Drive по сценаріях

| Сценарій | tmp-теки/файли | Коли пишуться | Коли чистяться | Осиротілий tmp? |
|----------|----------------|---------------|----------------|-----------------|
| **1 Нарізка** | `_temp/<caseId>_<jobId>/orig_<fileId>.pdf` + `chunk_<fileId>_NNN.pdf` + `job_state.json` | оригінал: `streamingExecutor.js:300-316`; чанки: `chunkManager.js:56-68`; стан: `jobState.js` після кожного чанка | успіх → `clearState` (`streamingExecutor.js:422`); збій/cancel → лишається (resume) | **ТАК** — авто-GC відсутній (§2.2) |
| **2 Склейка фото** | НЕМАЄ tmp на Drive | — фото тримаються як File/Blob у RAM | N/A — нічого прибирати | НІ (немає tmp узагалі) |
| **3 Просто додати** | НЕМАЄ tmp-теки прогону; per-file прямий upload у 01 | `addFilesService.js:180` (`uploadFileToCaseFolder`) | N/A — без проміжної теки | НІ (per-file, не job) |
| **4 ZIP-інгест** | НЕМАЄ tmp; розпак чисто in-memory (fflate) | `unpackArchivesFrontStep.js:117-126` (in-memory) | N/A | НІ (фронт-крок Drive не чіпає, `audit_dp_zip_ingest.md §8`) |

**Ключовий висновок:** tmp на Drive створює **лише сценарій 1 (нарізка)**. Решта три
шляхи tmp-теку прогону не використовують узагалі. Тобто «осиротілий tmp» — це проблема
**виключно нарізки**.

### 2.2 Відсутність авто-GC (борг C6, підтверджено власним grep)

- `jobState.js:147 clearState(caseId, jobId)` видаляє ЛИШЕ конкретну job-папку
  `_temp/<caseId>_<jobId>/` (`jobState.js:145-147`).
- Жодного сканера/збирача старих `_temp/*`: grep по `_temp`/`TEMP_ROOT`/`clearState`
  у `jobState.js` дає тільки операції над **власною** папкою (`TEMP_ROOT='_temp'`
  `jobState.js:24`, `getOrCreateFolder(TEMP_ROOT, null)` `:101`). Немає `listFolder(TEMP_ROOT)`
  + ітерації по старих job для видалення.
- Наслідок: **кожен незавершений/скасований прогін нарізки лишає теку `_temp/<...>/`
  навічно** на Drive адвоката. Накопичення — реальний борг C6.
- **Вирок:** код live, але **бракує** GC-функції → це не «зайве» (нема що видаляти),
  а **прогалина** (треба ДОДАТИ авто-GC) — вхід для cleanup-спеки, не для leanness.

### 2.3 `_temp` — плоска структура (борг C6)

- `_temp/<caseId>_<jobId>/` — один плаский рівень тек прогонів під коренем `_temp`
  (`jobState.js:16,24`). Немає вкладеної ієрархії за датою/справою для зручного GC —
  тек прогонів стільки, скільки незавершених job, усі поряд. Це посилює 2.2 (GC мусив
  би парсити `<caseId>_<jobId>` імена).

### 2.4 Кирилиця в `q=` (правило #8) — ДОТРИМАНО скрізь у DP

Перевірено grep по DP Drive-викликах:
- `jobState.js:16-17` — явний коментар: caseId (`case_123`) і jobId латиницею → безпечні для `q=`.
- `driveService.js:36-38` — `q=` формується ТІЛЬКИ за parent + mimeType, фільтрація імен
  (кириличних) у JS. Те саме `:597-598` (видалення за parent, JS-фільтр).
- `drivePort.js` — немає прямих `q:`/`q=` з кирилицею (grep порожній; `listFolder` без
  cyrillic-фільтра, підтверджено `audit_dp_slicing.md §6`).
- **Жодного порушення правила #8 у жодному з 4 сценаріїв.** ✅

---

## 3. §3.2 OCR ПРОВАЙДЕР-ПАТЕРН (хто коли, fallback, кеш, imageless, strip)

### 3.1 Реєстрація і вибір ланцюга
- Фасад `ocrService.js` реєструє 3 провайдери: `documentAi` (`:38`), `claudeVision` (`:39`),
  `pdfjsLocal` (`:40`).
- Вибір ланцюга: `selectProviderChain(file)` (`ocrService.js:454`) з `providerMatrix.js`
  `FALLBACK_CHAINS_BY_MIME`.
- **Матриця замовника** (`providerMatrix.js` коментар + `FALLBACK_CHAINS_BY_MIME:78+`):
  - **PDF** → ланцюг `['pdfjsLocal', 'documentAi']` (`providerMatrix.js:88`): pdfjsLocal
    першим (дешево, локально) відсіває searchable PDF; немає текстового шару → UNSUPPORTED
    → fallback на documentAi (справжній OCR).
  - **image/** → `documentAi` (pdfjsLocal не вміє зображення).
  - text/html/google-doc → pdfjsLocal.
- **`claudeVision` СВІДОМО ВИКЛЮЧЕНИЙ з default chain** (`providerMatrix.js:28-44`): доступний
  лише через `options.forceProvider='claudeVision'` (явне підтвердження адвоката у CaseDossier
  Reprocess flow). Причини: морг-мережа давала silent fallback → даремні токени; якість
  непередбачувана; планшет з мобільним інтернетом.
- **Forced override:** `localStorage.getItem('ocr_force_provider')` (`ocrService.js:44-46`) —
  глобальний форс провайдера (feature flag, не UI-тумблер).

### 3.2 Хто з провайдерів працює в якому сценарії

| Сценарій | OCR-провайдер | Виклик-сайт |
|----------|---------------|-------------|
| **1 Нарізка** | Document AI (через `processChunk`=ocrService на чанках) | `streamingExecutor.js:167`; chunk-OCR |
| **2 Склейка фото** | Document AI (`ocrService.extractText` на кожному фото) | `prepareImagesForMerge.js:161-179` (skipCache:true) |
| **3 Просто додати** (ocrMode=full) | Document AI або pdfjsLocal (за ланцюгом; DOCX/HTML → текст уже є, OCR пропускається) | `DocumentPipelineContext.jsx:321`; DOCX-skip `:299-301` |
| **3 Просто додати** (ocrMode=none) | ЖОДЕН — нуль OCR/AI | `DocumentPipelineContext.jsx:342-343` |
| **4 ZIP** | той самий, що сценарій 3 (per-file через addFiles) | `addFilesService.js` per-file |

**claudeVision у проді DP не задіяний на жодному default-шляху** — лише як ручний
forceProvider (reprocess). Це робить його OCR-роль фактично **дрімаючою** на default DP-потоці.

### 3.3 Кеш OCR
- ocrService має кеш-шар (`ocrService.js:4` коментар «перевіряє кеш»; `options.skipCache`/
  `skipCacheWrite`). Склейка фото форсує `skipCache:true, skipCacheWrite:true`
  (`prepareImagesForMerge.js:161-179`) — фото не кешуються (одноразовий OCR на склейку).
- Правило #11-кейс (CLAUDE.md): `skipCache` колись керував і читанням, і записом —
  розділено в micro-TASK 2.2. Тут читання/запис керуються окремо (`skipCache` vs `skipCacheWrite`).

### 3.4 imageless mode + layout-strip (image/tokens)
- **Strip — єдиний шлях запису layout:** `serializeLayout` (`ocrService.js:161-166`)
  викидає важкі поля `STRIPPED_LAYOUT_FIELDS=['image','tokens']` (`:143`) через
  `stripHeavyFields` (`:145`). Економія ~7МБ/стор → ~400КБ (`:159`).
- Strip живе у **write-точці 02**, НЕ всередині Document AI: `writeLayoutArtifact`
  (`ocrService.js:335-361`) — «єдиний шлях запису layout-артефакту, strip є частиною
  контракту» (`:335-340`). Якщо caller передає вже-string → НЕ приймає (двозначність,
  `:340-341`).
- У пам'яті pageStructure повний (image/tokens є); викидаються лише при записі на Drive.
  Підтверджує карту §2 крок 3 (де strip живе при збереженні, а не в OCR — `audit_dp_slicing.md §2`).
- imageless mode: для no-layout провайдерів (pdfjsLocal на searchable, DOCX/HTML) layout
  відсутній → пишеться `.txt`, не `.layout.json` (`providerMatrix` матриця виконавця:
  pdfjsLocal pageStructure=✗). «Факт у відповіді, не декларація на провайдері»
  (`providerMatrix.js` коментар) — ocrService дивиться у фактичну відповідь.

---

## 4. §3.2 + §3.5-E БІЛІНГ / AI_USAGE — B2-ІНВЕНТАР (deliverable для боргу #55 Частина Б)

### 4.1 Повний перелік AI-точок DP і суміжних з класифікацією

Класи: **`callAgent`** (B1, авто-облік) / **прямий fetch** (= робота B2, ручний облік) /
**чат-агент** (свідомий виняток, не мігрується).

| # | AI-точка | Файл:рядок (виклик) | Модель / agentType | Механізм | Клас | Облік (ai_usage + activityTracker) |
|---|----------|---------------------|--------------------|----------|------|-------------------------------------|
| 1 | **Triage (пошук меж)** | `analyzeTriageViaToolUse.js:54-57` | Haiku / `qiParserDocument`→`document_parser` | **`callAgent`** | ✅ callAgent | callAgent один раз (`callAgent.js:171-192`); ручний логер прибрано (шапка `:6-10`) |
| 2 | **Grouper (межі фото-документів)** | `imageDocumentGrouper.js:238` | Haiku / `image_document_grouper` | **прямий fetch** | 🔴 B2 робота | manual `logAiUsageViaSink`+`activityTracker` (`:317-339`) |
| 3 | **Sort фото (порядок+дублі)** | `imageSortingAgent.js:325` | Sonnet / `image_sorter` | **прямий fetch** | 🔴 B2 робота | manual через обгортку `sortImageDocument` (лише коли передано `billing`) |
| 4 | **claudeVision OCR-fallback** | `claudeVision.js` (extract) | (resolveModel) / `documentParserVision`→`document_parser` | **прямий fetch** | 🔴 B2 робота | manual `logAiUsageViaSink`+`activityTracker` (`:201-212`) |
| 5 | **claudeVision extractMetadata** (skipOcr Vision) | `claudeVision.js:229` | / `metadata_extractor` | **прямий fetch** | 🔴 B2 робота, **АЛЕ DEAD** | manual (`:280-291`) — **жоден prod-caller не кличе** (§4.2) |
| 6 | **contextGenerator (case_context.md)** | `contextGenerator.js:582` | (resolveModel `ctxModel`) / `case_context_generator` | **прямий fetch** | 🔴 B2 робота | manual `logAiUsage`+`activityTracker` (`:606-619`) |
| 7 | **QI parser image** | `App.jsx:1339` | `qiParserImage` | **прямий fetch** | 🟡 чат-агент (виняток) | manual `logAiUsage` (`:1369`) |
| 8 | **QI parser document** | `App.jsx:1475` | `qiParserDocument` | **прямий fetch** | 🟡 чат-агент (виняток) | manual `logAiUsage` (`:1501`) |
| 9 | **QI chat agent** | `App.jsx:1755` | `qiAgent` | **прямий fetch** | 🟡 чат-агент (виняток) | manual `logAiUsage` (`:1776`) |
| 10 | **Dashboard agent** | `Dashboard/index.jsx:1491` | (resolveModel) | **прямий fetch** | 🟡 чат-агент (виняток) | manual `logAiUsage`+`activityTracker` (`:1516-1524`) |

**Headline counts (B2):**
- **На `callAgent` (мігровано B1):** **1** (Triage).
- **Прямий fetch = робота B2 (треба мігрувати):** **5** живих — Grouper, Sort, claudeVision-OCR,
  contextGenerator, (+ claudeVision-extractMetadata як 6-та, але вона МЕРТВА — мігрувати нема сенсу,
  спершу видалити).
- **Чат-агенти (свідомий виняток, НЕ мігрувати):** **4** — 3× QI (App.jsx), 1× Dashboard.

### 4.2 МЕРТВА AI-точка (підтверджено власним grep)
- `claudeVision.extractMetadata` (`claudeVision.js:229`) → фасад `ocrService.extractMetadata`
  (`:430-431`) → `documentMetadata.enrichDocumentWithVisionMetadata` (`documentMetadata.js:27`).
- **grep `enrichDocumentWithVisionMetadata` по src/ (без самого `documentMetadata.js` і тестів):
  ЖОДНОГО prod-споживача.** Лише означення + коментар у `ocrService.js:429`.
- У DP add-as-is `metadataEnrichAddAsIs` **прибрано рішенням власника** — коментар
  `DocumentPipelineContext.jsx:343` («metadataEnrichAddAsIs БІЛЬШЕ НЕ ВИКЛИКАЄТЬСЯ») і `:308`.
- **Вирок:** уся гілка Vision-метаданих (`extractMetadata`/`enrichDocumentWithVisionMetadata`)
  — **мертве-видалити** (тримається тільки тестами). claim CLAUDE.md/`index.jsx:66-68`
  «skipOcr → Vision читає 1-2 стор. → метадані» — **МЕРТВИЙ ОПИС**; skipOcr = нуль AI.

### 4.3 Дубль-облік — ПЕРЕВІРЕНО, не виявлено
- `ai_usage[]` (токени, оператор) і `activityTracker→time_entries[]` (час, адвокат) — це
  **ДВІ паралельні структури на одну подію**, не дубль (CLAUDE.md: не дублювати ПОЛЯ між ними).
  Кожна AI-точка пише обидві рівно раз. Це коректно, не подвоєння рахунку.
- Triage: callAgent свідомо НЕ передає `setAiUsage` у транспорт (Варіант А, `callAgent.js:18-24,
  137-155`) → внутрішній логер двигуна заглушений, ai_usage пишеться РІВНО ОДИН раз. Підтверджено
  `audit_dp_slicing.md §7`.
- Grouper/Sort/Vision/contextGenerator — кожен логує один раз (`imageDocumentGrouper.js:317-339`;
  `claudeVision.js:201-212,280-291`; `contextGenerator.js:606-619`). Подвоєння немає.
- **Маппінг у callAgent для фото-агентів — DEAD STUB:** `AGENT_USAGE_LABELS` має
  `imageSorter`/`imageDocumentGrouper` (`callAgent.js:50-51`), АЛЕ код фото-агентів callAgent
  не кличе (manual fetch). Маппінг — заготовка під B2, наразі неактивний. Підтверджує лід WAVE 1.
- `billAsUserAction`: default true (`callAgent.js:96`) — дія адвоката списує час. Для DP-фону
  передається false (документовано CLAUDE.md cleanTextService «DP передає false»). На AI-точках
  DP цього аудиту (Triage/Grouper/Sort) — дія адвоката, біллиться як user-action. Коректно.

---

## 5. §3.2 ERROR HANDLING (ErrorBoundary · try/catch · resume/cancel · 401)

### 5.1 ErrorBoundary на DP-модулі
- DP (`DocumentProcessorV2`) рендериться **всередині** `CaseDossier` (`CaseDossier/index.jsx:2449`).
- `CaseDossier` загорнутий у `<ErrorBoundary>` в App.jsx (`App.jsx:5556`).
- → **DP транзитивно під ErrorBoundary.** Немає **власної**, окремої ErrorBoundary навколо
  самого DP-компонента — якщо DP кине під час рендеру, впаде вся вкладка досьє (не лише DP-панель).
  Це функціональна деталь: гранулярність ErrorBoundary на рівні CaseDossier, не DP. Прийнятно,
  але під SaaS варто розглянути власну межу для DP.

### 5.2 try/catch у async (правило #4 blank page) — по сценаріях
- **Нарізка:** усі ok:false-гілки повертають `resumable:true` (`streamingExecutor.js:307,436,
  454,473`); зовнішній catch `:437` `EXECUTOR_THREW`. ✅ (`audit_dp_slicing.md §6`).
- **Склейка фото:** `startImageMergeProcessing` весь у try/catch/finally
  (`index.jsx:423-567`); submit у try/catch (`DpImageMergeEditor.jsx:511-528`). ✅.
- **Просто додати / ZIP:** `startProcessing` весь у try/catch/finally
  (`index.jsx:738,814-821`); per-file помилки локалізовані (CONVERT/UPLOAD/PERSIST_FAILED,
  batch-стійко). ✅ (`audit_dp_add_files.md §7`, `audit_dp_zip_ingest.md §7`).
- **Жодної неприкритої async-гілки в DP-потоці не виявлено.** Усі 4 сценарії правило #4 дотримують.

### 5.3 resume / cancel
- **Resume — ТІЛЬКИ нарізка:** `resume()` (`streamingExecutor.js:502`) піднімає `job_state.json`
  з tmp. Склейка/додати/ZIP — **resumability відсутня** (склейка: лише React state
  `index.jsx:134`; reload до «Виконати» втрачає OCR/grouper/sort — `audit_dp_image_merge.md §7`).
- **Cancel:** `res.cancelled` → `setCancelInfo` (`index.jsx:796-797`), tmp лишається для resume.

### 5.4 401 Drive — НЕМАЄ friendly-handling у DP (правило #8 друга частина)
- Нарізка: 401 не спец-обробляється → throw → `EXECUTOR_THREW` (`audit_dp_slicing.md §6`).
- Склейка: 401 як generic `!res.ok` toast, без «перепідключіть Drive» (`index.jsx:434`).
- Додати/ZIP: 401 підіймається як `UPLOAD_FAILED`/`CONVERT_FAILED`, generic message
  (`audit_dp_add_files.md §7`).
- **Жоден з 4 сценаріїв не показує дружнього «перепідключіть Drive»** при 401 (правило #8
  каже «401 = показати перепідключіть Drive»). Прогалина наскрізна — вхід для cleanup-спеки.

### 5.5 Помилки конвертації / OCR / Triage
- **Convert fail:** per-file `CONVERT_FAILED`, документ НЕ створюється, на Drive нічого
  (`addFilesService.js:136-141`).
- **OCR fail:** нарізка — throw у `streamFile` → stoppedAt, resumable
  (`documentAi.js:65 classifyError`: NETWORK retry 3×, AUTH/QUOTA без retry). Add-as-is OCR —
  best-effort console.warn, документ уже доданий (`DocumentPipelineContext.jsx:330-334`).
- **Triage fail:** НЕ фатально — catch → passthrough fallback persist, **02 layout НЕ
  пишеться** (тихо!) (`triageStage.js:323-334`; `audit_dp_slicing.md §6 п.6`). Лід WAVE 1
  «triage-passthrough тихо скіпає 02» — **підтверджено**: нема ключа / triage throw / 0 docs
  → fallback persist гілка B без artefacts у 02; адвокат бачить «оброблено» без layout.

---

## 6. §3.2 КАНОНІЧНА СХЕМА (createDocument · addedBy↔source · 01/02/03/.metadata)

### 6.1 Усі точки створення — через `createDocument()`?
| Сценарій | createDocument-сайт | addedBy | source |
|----------|---------------------|---------|--------|
| 1 Нарізка | `splitDocumentsV3.js` persist (через executeAction) | (з потоку) | (з потоку) |
| 2 Склейка | `index.jsx:636-655` | `user` | `manual` |
| 3 Додати | `addFilesService.js:211` (deps.createDocument) | `user` (`index.jsx:373`) | `manual` (`index.jsx:372`) |
| 4 ZIP | той самий, що 3 (addFiles) | `user` | `manual` |
| (ECITS-watcher, суміжне) | `DocumentPipelineContext.jsx:438-439` | `system` | `court_sync` |

- **Усі 4 DP-сценарії йдуть через `createDocument()`** — єдина фабрика (`documentFactory.createDocument`).
  Жодного обходу.

### 6.2 addedBy↔source — коректність (правило #11 disambiguation)
- Склейка/Додати/ZIP: `{addedBy:'user', source:'manual'}` — канонічна однозначна комбінація
  (CLAUDE.md DISAMBIGUATION). ✅
- **РОЗБІЖНІСТЬ (окремий рядок, лід WAVE 1 підтверджено):** **ZIP-вміст з ЄСІТС отримує
  `source:'manual'`/`addedBy:'user'`** (`index.jsx:372-373`), бо проходить через
  `buildAddAsIsInput`. Канал **ЄСІТС у `document.source` НЕ фіксується** — для адвоката це
  «вручну кинутий ZIP» (узгоджено логічно), але форензична інформація «звідки документ»
  втрачається. Sidecar-канал, що міг би це нести — у dormant stage (`audit_dp_zip_ingest.md §4.2,8`).

### 6.3 Легкі vs важкі поля; що пишеться куди
- **01_ОРИГІНАЛИ** ← PDF (всі сценарії): нарізка `splitDocumentsV3.js:361`; склейка
  `index.jsx:615`; додати `addFilesService.js:180`.
- **02_ОБРОБЛЕНІ** ← `.layout.json` (strip image/tokens) коли є layout: нарізка
  `DocumentPipelineContext.jsx:207-221`; склейка `index.jsx:627`; додати ocrMode=full
  `ocrService.js:527-534`. **`.txt`** пишеться ЛИШЕ коли layout відсутній (no-layout
  провайдери) — `splitDocumentsV3.js:672-680`.
- **03_ФРАГМЕНТИ** ← зайві сторінки: ТІЛЬКИ нарізка (`splitDocumentsV3.js:493 saveFragments`).
  Склейка/додати/ZIP фрагментів не створюють.
- **.metadata/documents_extended.json** ← важкі поля (tags/notes/attentionNotes): у DP-потоці
  на цих 4 сценаріях практично не зачіпається (склейка extended не пише — `audit_dp_image_merge.md §8`).
- Легкі поля документа — у `cases[].documents[]` (канонічна схема v11, 28 легких полів).

---

## 7. §3.5-B ВХІДНИЙ РОУТЕР / ДИСПЕТЧЕР (шов між 4 сценаріями)

Точка: `startProcessing` (`index.jsx:702-734`). Порядок дверей:

| # | Двері (умова) | Файл:рядок | Куди | Що ЛОВИТЬ | Що ПРОПУСКАЄ |
|---|---------------|-----------|------|-----------|--------------|
| A | `isAllImagesInput() && !skipPdfSlicing` | `index.jsx:718` | склейка фото | чистий device/drive батч ВСІ-фото | **INBOX-фото** (`isAllImagesInput` → false якщо `inboxSelected.length>0`, `index.jsx:396`) — фото з 00_INBOX склеїти НЕМОЖЛИВО |
| B | `skipPdfSlicing === true` (`useAddAsIs`) | `index.jsx:726` | addFiles (будь-який тип, вкл. ZIP) | усе при увімкненому тумблері | — (ловить усе) |
| C | `!useAddAsIs && hasAnyImage() && hasAnyNonImage()` | `index.jsx:727` | toast-завернути (#27) | мікс **З ФОТО** + не-фото при toggle OFF | **мікс PDF+DOCX (без фото)** — `hasAnyImage()` false → ворота не спрацьовують (§7.1) |
| D | else (`pipeline.run`) | `index.jsx:786-794` | стрім-нарізка | all-PDF / mix без фото | очікує лише PDF — не-PDF проривається (§7.1) |

### 7.1 ДІРА PDF+DOCX — ПІДТВЕРДЖЕНО (точна умова + наслідок)
- Завертання (двері C) спрацьовує ВИКЛЮЧНО на `hasAnyImage() && hasAnyNonImage()`
  (`index.jsx:727`). `hasAnyImage()` (`index.jsx:399-400`) повертає true лише якщо є хоча б
  одне **зображення**.
- **Суміш PDF+DOCX (без жодного фото):** `hasAnyImage()` = **false** → умова C = false →
  падає у двері D (`pipeline.run`, стрім-нарізка).
- Стрім-нарізка (`streamingExecutor.streamFile`) обробляє байти кожного файлу **як PDF**
  (chunk-OCR PDF — `streamingExecutor.js:167`, `documentAi`). DOCX/RTF — не PDF → **ймовірний
  злам** типу «No PDF header found» (той самий клас краху, що 1B обходив для фото —
  коментар `index.jsx:387-390`).
- **Точна умова дірки:** `settings.skipPdfSlicing === false` (toggle OFF) **AND** набір містить
  ≥1 не-PDF не-фото файл (DOCX/RTF/...) **AND** немає жодного фото → роутер пускає на slice,
  де не-PDF ламає chunk-OCR.
- **Наслідок:** адвокат при вимкненому «Просто додати» кидає PDF+DOCX → не отримує ні toast-
  підказки (вона лише для фото-міксу), ні коректної обробки DOCX → прогін падає/деградує.
  Обхід для адвоката: увімкнути «Просто додати» (двері B, де кожен файл конвертується своїм
  шляхом). Але роутер цього не підказує для PDF+DOCX (підказка C — тільки для фото).
- **Підтверджено суміжно:** ZIP-вміст цю діру НЕ зачіпає (розпак прив'язаний до `useAddAsIs`/
  двері B, де нарізки немає — `audit_dp_zip_ingest.md §5.3`). Діра реальна лише для **ручного
  drop** PDF+DOCX при toggle OFF.

### 7.2 Друга діра роутера — INBOX-фото (двері A)
- `isAllImagesInput` повертає false при будь-якому `inboxSelected` (`index.jsx:396`,
  коментар «mix scope боргу»). Тобто фото, заздалегідь покладені в 00_INBOX, **не йдуть у
  склейку** — вони підуть у `pipeline.run` (нарізку), що для чистих фото = той самий крах
  «No PDF header», який 1B обходив. Функціональна діра (`audit_dp_image_merge.md §10 п.1`).

---

## 8. §3.5-D ГРАНУЛЯРНІСТЬ + ПОЛЕ УЧАСТІ В КОНТЕКСТІ (готовність до A7 «важеля»)

### 8.1 Батч vs per-документ для ocrMode/compression
- **ВСЕ на рівні ВСЬОГО БАТЧУ, НЕ по документу:** `pipeline.addFiles(input, { ocrMode:
  settings.skipOcr?'none':'full', compress: settings.compressAll===true })`
  (`index.jsx:781-785`). Один `ocrMode`/`compress` на весь прогін (`addFilesService.js:296,323`).
- Те саме для нарізки: `compress: settings.compressAll===true` (`index.jsx:793`) — на весь том.
- **Немає per-document контролю** OCR/стиснення на жодному сценарії.

### 8.2 Персистентне поле «рівень участі в контексті» — ВІДСУТНЄ
- Канонічна схема має ЛИШЕ `isKey: boolean` (`documentSchema.js:52`) — бінарний «ключовий ⭐»,
  НЕ триступеневий рівень участі (повний/вижимка/не включати).
- grep по `documentSchema.js`: немає `contextLevel`/`participation`/жодного поля рівня участі.
- Рівень участі сьогодні = `isKey` (бінарний) + рантайм-інференс у contextGenerator. Стан
  розпізнавання частково є (`documentNature` + `lastOcrAt`).

### 8.3 Готовність до A7 / §7.3 «важіль» (ДВА ортогональні значення, правило #11)
- §7.3 «важіль» вимагає ДВА ОРТОГОНАЛЬНІ значення на документ: **(1) стан розпізнавання**
  (scanned/searchable + OCR-стан) + **(2) рівень участі в контексті** (full/digest/exclude).
- **(1) частково є** (`documentNature`/`lastOcrAt`). **(2) немає персистентного поля взагалі.**
- **Вирок готовності: НИЗЬКА.** A7 (екран правки) спершу мусить bump-нути схему (нове поле
  рівня участі + міграція, правило #6/#11). Сирий per-file матеріал для екрану є
  (`addFilesService.js:231-243`), але немає persisted-поля, яке екран міг би редагувати.
  Підтверджує `audit_dp_add_files.md §4`.

---

## 9. §3.5-H ПРОФІЛЬ ВАРТОСТІ ПО СЦЕНАРІЯХ (груба оцінка, не бенчмарк)

> **Застереження #44:** `aiUsageService.MODEL_PRICING` застарілий → `estimatedCostUSD` у
> `ai_usage[]` **хибний**. Оцінки нижче — порядок ТОКЕНІВ, не доларів (долари рахувати після
> оновлення MODEL_PRICING).

| Сценарій | AI-моделі (агенти) | Порядок токенів на типовий том | Примітки |
|----------|--------------------|--------------------------------|----------|
| **1 Нарізка** | Haiku (Triage, 1 виклик) | паспорт-input: thin >70 стор. ~150-250 ток/стор → 250 стор ≈ **~62K input**; rich ≤70 ≈ ~65-70K; output план ~1-4K | **+ Document AI** (Google, НЕ Anthropic-токени, поза ai_usage). Triage = ЄДИНИЙ Anthropic-виклик нарізки. `audit_dp_slicing.md §4.2` |
| **2 Склейка фото** | Haiku (Grouper, 1×) + Sonnet (Sort, per-group >1 фото) | Grouper input = OCR-текст усіх фото (~сотні-тисячі ток); Sort на кожну групу >1 фото — **множник за кількістю груп** (Sonnet дорожчий) | **+ Document AI OCR** на КОЖНЕ фото. Найдорожчий профіль за рахунок Sonnet×N-груп |
| **3 Просто додати** (full) | ЖОДНОГО Anthropic-агента | 0 Anthropic-токенів | лише Document AI OCR (Google). DOCX/HTML — 0 OCR взагалі (текст уже є) |
| **3 Просто додати** (none) | ЖОДНОГО | **0 AI** повністю | ні Anthropic, ні Document AI |
| **4 ZIP** | = сценарій 3 | = сценарій 3 (per-file) | розпак fflate = 0 токенів |

**Висновки під SaaS-економіку:**
- **Найдорожчий — склейка фото** (Haiku-grouper + Sonnet-sort помножений на кількість груп +
  Document AI на кожне фото).
- **Найдешевший — «просто додати без OCR»** (нуль AI).
- Нарізка — помірний фіксований Anthropic-кост (1 Haiku-виклик) + Document AI пропорційно сторінкам.
- Document AI (Google) — головний змінний кост у 3 з 4 сценаріїв, але **не в ai_usage[]**
  (бо не Anthropic). Для SaaS-калькуляції витрат його треба інструментувати ОКРЕМО — наразі
  OCR-кост невидимий у ai_usage.
- #44 робить будь-який доларовий висновок з поточного `estimatedCostUSD` ненадійним.

---

## 10. ПРОГАЛИНИ / ВІДКРИТІ ПИТАННЯ

1. **Авто-GC `_temp/*` відсутній** (`jobState.js:147` чистить лише свою job) — осиротілі теки
   нарізки накопичуються навічно. Борг C6. Потрібна нова GC-функція (cleanup-спека).
2. **5 живих AI-точок на прямому fetch** (Grouper, Sort, claudeVision-OCR, contextGenerator,
   +Dashboard як суміжна) — робота B2 (#55 Б). Маппінг у `callAgent.js:50-51` для фото-агентів —
   мертвий stub до B2.
3. **claudeVision.extractMetadata + enrichDocumentWithVisionMetadata — мертве-видалити** (нуль
   prod-callers). Спершу видалити, потім НЕ мігрувати на callAgent.
4. **Діра роутера PDF+DOCX** (toggle OFF, без фото) — не-PDF проривається на slice → ймовірний
   крах; роутер не підказує (підказка лише для фото-міксу). Точна умова §7.1.
5. **Діра роутера INBOX-фото** — фото з 00_INBOX не склеюються (`index.jsx:396`).
6. **Triage-passthrough тихо валить 02** — нема ключа/throw/0 docs → fallback persist без layout;
   адвокат бачить «оброблено». Потребує явного UI-сигналу.
7. **401 Drive — generic error** на всіх 4 сценаріях, без friendly «перепідключіть Drive»
   (правило #8 друга частина не застосована точково в DP).
8. **Немає персистентного поля рівня участі в контексті** — A7/«важіль» вимагатиме bump схеми.
9. **DP не має ВЛАСНОЇ ErrorBoundary** — лише транзитивна через CaseDossier; падіння DP при
   рендері валить усю вкладку досьє.
10. **OCR-кост (Document AI) поза `ai_usage[]`** — головний змінний кост 3/4 сценаріїв
    невидимий для SaaS-калькуляції; потребує окремої інструментації.

---

**Кінець — diagnostic_dp_crosscutting.md (§3.2 + §3.5-B/D/E/H).** Read-only; код не змінювався.
