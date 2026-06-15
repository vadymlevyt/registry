# АУДИТ DP · ІНВЕНТАР БЛОКЕРІВ СЕРВЕРНОЇ МІГРАЦІЇ (§1.3 + §3.2 «серверна міграція» + §6.6)

**Дата:** 2026-06-15
**Тип:** read-only інвентаризація (PART 1 повного аудиту DP, WAVE 2). Жоден рядок коду не змінено — створено лише цей `.md`.
**Скоуп:** §1.3 лінза («інвентаризувати блокери міграції для майбутнього планування — НЕ переписувати зараз») + §3.2 bullet «Серверна міграція (блокери)» + §6.6 deliverable.
**Будує на:** `diagnostic_dp_crosscutting.md`, `audit_dp_slicing.md`, `audit_dp_image_merge.md`, `audit_dp_add_files.md`, `audit_dp_zip_ingest.md` (WAVE 1). Не дублює — зводить browser-bound лінію і верифікує власним `file:line`.

## Методологія і лінза
Read-only. КОЖНЕ твердження звірене проти коду з `file:line` (§1.2-bis): немає висновку без `file:line`. Лінза §1.3 — це **карта блокерів** під майбутній SaaS на серверній архітектурі, а **НЕ** спека переписування і **НЕ** виправлення зараз. Кожен блокер: що це · `file:line` · чому browser-bound · серверний еквівалент. Складність переїзду — груба оцінка (низька/середня/висока) для планування черговості.

**Чому DP взагалі browser-bound сьогодні:** уся «важка» робота (PDF split/merge, рендер canvas, OCR-виклики, AI-агенти, конвертація форматів) виконується **у вкладці браузера адвоката**, з ключами/токенами в `localStorage`. Це осмислено для single-user self-hosted (наш `self_hosted` план, CLAUDE.md tariffMatrix), але під multi-tenant SaaS — це і функціональні (tab-lifecycle), і безпекові (ключі в клієнті) блокери.

---

## 1. ЗВЕДЕНА ТАБЛИЦЯ БЛОКЕРІВ

Складність: **Н** низька (чистий порт логіки) · **С** середня (Drive/мережа/контракт) · **В** висока (безпека/архітектура/стан).

| # | Блокер | file:line | Чому browser-bound | Сценарії (1-4) | Складн. | Серверний еквівалент |
|---|--------|-----------|--------------------|----------------|---------|----------------------|
| B1 | **Anthropic API-ключ у `localStorage` клієнта** (`claude_api_key`) | `App.jsx:1108,3259,5114`; `ocr/claudeVision.js:148,230`; `index.jsx:45` | секрет читається у браузері, шлеться напряму на api.anthropic.com з `anthropic-dangerous-direct-browser-access:true` | 1,2,(3-add-as-is не AI) | **В** | секрет у server-vault; усі Anthropic-виклики через backend-проксі; клієнт ключа не бачить |
| B2 | **Google Document AI токен з клієнта** (Drive OAuth Bearer, scope cloud-platform) | `ocr/documentAi.js:39,43,177`; `driveAuth.js:135` | прямий POST на `*-documentai.googleapis.com` з Bearer-токеном адвоката з браузера | 1,2,3(full) | **В** | server-side service account + DocAI на бекенді; клієнт шле байти, не токен |
| B3 | **Drive OAuth access-token у `localStorage`** (`levytskyi_drive_token`) | `driveAuth.js:11,16-21,131-141` | токен живе у браузері; всі Drive I/O DP з нього; ~1h TTL, silent re-auth | 1,2,3,4 | **В** | server тримає OAuth refresh-token per-tenant; Drive I/O на бекенді |
| B4 | **Web Worker split/merge PDF (pdf-lib)** | `documentPipeline/workerClient.js:24-28`; `workers/pipelineWorker.js:25,43-77` | `new Worker(new URL(...))` + pdf-lib у воркері — CPU у вкладці | 1 (split/merge), 2 (mergePdf) | **С** | server-side PDF-сервіс (pdf-lib/qpdf/pdfium у Node/контейнері); те саме API `splitPdf/mergePdf` |
| B5 | **Canvas-конвертація image→PDF (jsPDF + canvas)** | `converter/imageToPdf.js:155-199`; `converter/multiImageToPdf.js:85-130` | `document.createElement('canvas')`, `getContext('2d')`, `import('jspdf')` — DOM-only | 2,3,4 | **С** | server image→PDF (sharp+pdfkit / ImageMagick); без DOM |
| B6 | **HEIC→JPEG (heic2any)** | `converter/heicToJpeg.js:18-30` | `import('heic2any')` — WASM-декодер під браузер | 2,3,4 (iPhone HEIC) | **С** | server libheif/sharp HEIC decode |
| B7 | **DOCX→PDF (mammoth + pdf-lib рендерер)** | `converter/docxToPdf.js:123-146`; `converter/pdfLibHtmlRenderer.js:58,1579` | `import('mammoth/mammoth.browser.js')`; pdf-lib рендер HTML у браузері | 3,4 | **С** | server DOCX→PDF (LibreOffice headless / docx-сервіс) |
| B8 | **HTML→PDF (pdfLibHtmlRenderer)** | `converter/htmlToPdf.js:78`; `converter/pdfLibHtmlRenderer.js:58` | `document.createElement('div')` для DOM-парсингу + pdf-lib | 3,4 | **С** | server HTML→PDF (headless Chromium / wkhtmltopdf) |
| B9 | **Стиснення сканів (canvas render→JPEG→pdf-lib)** | `compression/imageCompressor.js:24,32,198-303`; `compressionService.js:10` | pdfjs-dist рендер у canvas + pdf-lib re-assemble — CPU+DOM у вкладці | 1,2,3 (опц. compress) | **С** | server compression pipeline (pdfium render + jpeg + pdf-lib) |
| B10 | **Фото-склейка рендер (canvas: crop/orient/edge/downscale/rebuild)** | `sortation/cropHelper.js:54-57`; `sortation/orientationCorrector.js:745-748`; `sortation/edgeDetection.js:78-81`; `imageDocument/downscaleImage.js:115-118`; `imageDocument/pdfRebuild.js:54,111-114` | усе через `<canvas>` 2d-context + jsPDF — DOM-only обробка зображень | 2 | **С** | server image-pipeline (sharp/OpenCV) + pdf assemble |
| B11 | **claudeVision OCR-fallback (canvas render PDF→base64)** | `ocr/claudeVision.js:118-121,148,172-174` | pdfjs render у canvas + ключ з localStorage + прямий fetch Anthropic | (dormant — поза default chain) | **С** | server Vision-проксі (але див. §4: на default-шляху не активний) |
| B12 | **OCR resume — лише in-memory Map (вмирає на reload/tab-close)** | `ocr/resumeStore.js:7,33-48` | свідомо без persistence; стан живе в RAM вкладки | 1,2,3 | **Н** | server-side job state (resume переживає сесію) — або лишити (дешевий re-OCR) |
| B13 | **jobProgressStore — in-memory Map прогресу job** | `documentPipeline/jobProgressStore.js:22,38-40` | snapshot прогресу у RAM вкладки; tab-close втрачає live-прогрес | 1 | **Н** | server job-queue зі статусом; клієнт поллить статус |
| B14 | **Resume лише для нарізки; склейка/додати/ZIP — React state** | `streamingExecutor.js:502`; `index.jsx:134` (склейка) | проміжний стан у React → reload до «Виконати» втрачає OCR/grouper/sort | 2 (3,4 per-file) | **С** | server job на всі сценарії, не лише нарізку |
| B15 | **3-tier agentHistory — два browser-tier (localStorage)** | `App.jsx:5038,5041` (`agent_history_<caseId>`); `App.jsx:3548-3549` (`case.agentHistory`) | tier-2 (localStorage) і дзеркало в registry прив'язані до браузера/реєстру; tier-3 (Drive) — нейтральний | суміжне до DP-агентів | **С** | server-кеш agentHistory; localStorage-tier зайвий під SaaS (multi-user) |
| B16 | **ZIP-розпак in-memory (fflate у клієнті)** | `addFiles/unpackArchivesFrontStep.js:117-126`; `stages/unpack.js:119` | розпак у RAM вкладки (lazy-import fflate) | 4 | **Н** | server unzip (логіка fflate портується без DOM) |

**Підсумок: 16 окремих browser-bound блокерів.** З них **3 безпекові-критичні (B1, B2, B3)** — це справжні SaaS-блокери (секрети в клієнті), решта — функціональні/архітектурні переїзди CPU-роботи і стану.

---

## 2. ДЕТАЛІЗАЦІЯ ПО КАТЕГОРІЯХ

### 2.1 Web Workers / pdf-lib у клієнті (B4, B5–B11 CPU)

**Worker seam.** `workerClient.js:24-28` спавнить реальний `new Worker(new URL('../../workers/pipelineWorker.js', import.meta.url), {type:'module'})`; fallback in-process для Node/тестів (`workerClient.js:64-73`). Воркер виконує `splitPdf`/`mergePdf`/`pdfInfo`/`mergeText` через **pdf-lib** (`pipelineWorker.js:25,43-77`). Споживачі:
- нарізка: `chunkManager.js:41,64` (`pdfInfo`, `splitPdf`), `splitDocumentsV3.js:189,207,527,555` (`splitPdf`/`mergePdf`), `streamingExecutor.js:204` (`mergeText`).
- склейка: `sortation/imageMergeRenderer.js:52` (`mergePdf`).
*Чому browser-bound:* `Worker` + pdf-lib працюють у вкладці; CPU споживається на пристрої адвоката. *Серверний еквівалент:* той самий контракт `runInWorker(op,payload)` за `drivePort`-патерном легко переадресовується на серверний PDF-сервіс — **DI seam уже є** (це знижує складність до С, не В).

**pdf-lib поза воркером** (теж CPU у вкладці, але прямі імпорти): `ocr/documentAi.js:38` (нарізка чанків перед DocAI), `documentBoundary/splitPdf.js:16`, `compression/imageCompressor.js:24`, `compressionService.js:10`, `converter/pdfLibHtmlRenderer.js:58`. Усі — кандидати на сервер разом із воркером.

**Конвертери (canvas + lazy-import браузерних бібліотек).** Фасад `converter/converterService.js` ліниво тягне: `imageToPdf.js:183` (`jspdf`), `multiImageToPdf.js:85` (`jspdf`), `docxToPdf.js:123` (`mammoth`), `heicToJpeg.js:18` (`heic2any`), `pdfLibHtmlRenderer.js:1579` (`@pdf-lib/fontkit`). Усі мають browser-only залежності (DOM canvas / WASM). Це B5–B8.

**Стиснення (B9).** `imageCompressor.js:32` `import('pdfjs-dist')` рендерить кожну сторінку в canvas (`:198-303`), JPEG, re-assemble pdf-lib. CDN→npm адаптація вже зроблена (`imageCompressor.js:18`), але рушій browser-only.

**Фото-склейка CPU (B10).** Цілий вузол canvas-обробки: `cropHelper.js:54`, `orientationCorrector.js:745`, `edgeDetection.js:78` (`willReadFrequently`), `downscaleImage.js:115`, `pdfRebuild.js:111`. Це найбільший CPU-кластер сценарію 2.

### 2.2 Drive-OAuth з клієнта (B3) + Document AI токен (B2)

**Токен у localStorage.** `driveAuth.js:11` `TOKEN_KEY='levytskyi_drive_token'`; `getDriveToken` (`:16-17`) читає з `localStorage`; `saveDriveToken` (`:20-21`) пише. `driveRequest` (`:131-141`) додає `Authorization: Bearer <t>`, на 401 робить silent re-auth через GIS і повторює раз (`driveAuth.js:3,141`). TTL ~1h (CLAUDE.md правило #8). *Усі 4 сценарії DP* ходять у Drive через цей токен.

**Document AI напряму з браузера (B2).** `documentAi.js:43` ендпоінт `https://europe-west2-documentai.googleapis.com/.../processors/2cc453e438078154:process`; виклик `driveRequest(DOC_AI_ENDPOINT, ...)` (`:177`) — **той самий клієнтський Bearer-токен** з cloud-platform scope (`documentAi.js:7`). Тобто OCR-провайдер шле байти документів прямо з вкладки на Google з токеном адвоката.

**401-поведінка (крос-лінк §5.4 crosscutting).** `driveAuth.js` має авто-refresh, але DP **не показує friendly «перепідключіть Drive»** на жодному сценарії (`diagnostic_dp_crosscutting.md §5.4`); 401 підіймається як generic error. Під SaaS Drive I/O переїде на сервер per-tenant, тож ця прогалина зникне разом з міграцією B3.

### 2.3 Document AI / Anthropic ключі з клієнта (B1, B2) — БЕЗПЕКОВИЙ HEADLINE

**Anthropic ключ — у `localStorage` (`claude_api_key`), читається в багатьох точках:**
- `App.jsx:1108` `const apiKey = localStorage.getItem('claude_api_key')`; UI зберігає `App.jsx:3259`; deps-провайдер `App.jsx:5114` `getApiKey:()=>localStorage.getItem('claude_api_key')`.
- DP-локально: `index.jsx:45` `localStorage.getItem('claude_api_key')`.
- OCR Vision: `claudeVision.js:148,230` `options.apiKey || localStorage.getItem('claude_api_key')`.

**Прямі fetch на api.anthropic.com з браузера з заголовком обходу CORS-захисту** `anthropic-dangerous-direct-browser-access:true`:
- `claudeVision.js:172-174,249-251` (OCR-fallback + extractMetadata).
- `sortation/imageDocumentGrouper.js:242-244` (Grouper, сценарій 2).
- `sortation/imageSortingAgent.js:329-331` (Sort, сценарій 2).
- `contextGenerator.js:582-586` (`https://api.anthropic.com/v1/messages`, `x-api-key`).
- Triage йде через `callAgent` (`analyzeTriageViaToolUse.js:49-66`), але `apiKey` все одно прокидається з того ж клієнтського джерела (`detectBoundariesV3.js:128` `stageDeps.getApiKey()`).

*Чому це SaaS-блокер:* у multi-tenant кожен клієнт у браузері володіє робочим Anthropic-ключем — це або спільний ключ оператора (витік = катастрофа), або per-tenant ключ у клієнті (все одно експонований у DevTools/розширеннях). Заголовок `anthropic-dangerous-direct-browser-access` сам по собі сигналізує антипатерн для prod-SaaS. **Серверний еквівалент: усі Anthropic-виклики через backend-проксі; клієнт ключа не бачить.** Те саме для DocAI (B2).

### 2.4 localStorage-кеші (B3, B12-store, B15, force-flag)

| Ключ localStorage | file:line | Призначення | Під SaaS |
|-------------------|-----------|-------------|----------|
| `claude_api_key` | `App.jsx:1108,3259`; `claudeVision.js:148` | Anthropic секрет | **видалити з клієнта** (B1) |
| `levytskyi_drive_token` | `driveAuth.js:11,17,21` | Drive OAuth access-token | **видалити з клієнта** (B3) |
| `agent_history_<caseId>` | `App.jsx:5038,5041` | tier-2 кеш історії агента | server-кеш (B15) |
| `ocr_force_provider` | `ocrService.js:45-46` | глобальний форс OCR-провайдера (feature flag) | server-config / per-tenant |

**OCR resume-store (B12) — НЕ localStorage:** `resumeStore.js:33` `const store = new Map()` — суто in-memory, свідомо без persistence (`resumeStore.js:7-14`). Вмирає на reload. Це tab-lifecycle стан, не localStorage-кеш, але теж browser-bound (див. §2.5).

### 2.5 agentHistory 3-tier (B15) — два browser-tier як концерн міграції

CLAUDE.md описує 3-tier: (1) `cases[i].agentHistory` у registry — `App.jsx:3548-3549`; (2) `localStorage.agent_history_<caseId>` — `App.jsx:5038,5041`; (3) Drive `agent_history.json` — головна персистентна копія. Під SaaS multi-user: **tier-2 (localStorage) стає проблемним** — він per-browser, не per-tenant, тож два користувачі одного tenant бачать різні швидкі кеші; tier-1 (registry-дзеркало) теж клієнто-орієнтований. Tier-3 (Drive) — нейтральний, переноситься як є. *Це суміжне до DP (історія агента досьє), не серцевина DP-потоку, але §3.2 явно називає його блокером — фіксую.*

### 2.6 In-memory / tab-lifecycle стан (B12, B13, B14)

- **jobProgressStore (B13):** `jobProgressStore.js:22` `const jobs = new Map()` — snapshot прогресу job у RAM; subscribe-модель (`:38-40`); `_resetForTests` (`:131-133`) скидає. Tab-close = втрата live-прогресу (job_state на Drive переживе, але UI-прогрес — ні).
- **OCR resumeStore (B12):** §2.4 — in-memory Map, reload = з нуля.
- **Resume асиметрія (B14):** `streamingExecutor.js:502` `resume()` піднімає `job_state.json` з Drive tmp — **лише нарізка** має durable resume. Склейка тримає проміжне у React state (`index.jsx:134`); reload до «Виконати» втрачає OCR/grouper/sort (`audit_dp_image_merge.md §7`). Додати/ZIP — per-file, без проміжного job.

**Контраст durable-vs-ephemeral:** `jobState.js:3-13` свідомо обрав **Drive** (не in-memory) для job_state нарізки — «переживає крах вкладки» (`jobState.js:5`). Тобто нарізка вже наполовину server-ready щодо стану (стан на Drive), тоді як прогрес (jobProgressStore) і OCR-resume лишились у RAM. Під SaaS усе це стає рядками server-side job-queue.

---

## 3. ЗВЕДЕНА ТАБЛИЦЯ БЛОКЕРІВ ПО СЦЕНАРІЯХ (хто чим зачеплений)

| Блокер | 1 Нарізка | 2 Склейка | 3 Додати | 4 ZIP |
|--------|:---------:|:---------:|:--------:|:-----:|
| B1 Anthropic ключ | ✅ Triage | ✅ Grouper+Sort | — (add-as-is не AI) | — |
| B2 DocAI токен | ✅ | ✅ (фото OCR) | ✅ (full) | ✅ (per-file full) |
| B3 Drive token | ✅ | ✅ | ✅ | ✅ |
| B4 Worker pdf-lib | ✅ split/merge | ✅ mergePdf | — | — |
| B5 image→PDF canvas | — | ✅ | ✅ | ✅ |
| B6 HEIC | — | ✅ | ✅ | ✅ |
| B7 DOCX | — | — | ✅ | ✅ |
| B8 HTML | — | — | ✅ | ✅ |
| B9 compress canvas | ✅ опц | ✅ опц | ✅ опц | — |
| B10 фото canvas | — | ✅ | — | — |
| B12 OCR resume RAM | ✅ | ✅ | ✅ | — |
| B13 jobProgress RAM | ✅ | — | — | — |
| B14 resume асиметрія | ✅ (має) | ✅ (нема) | per-file | per-file |
| B16 ZIP unzip | — | — | — | ✅ |

---

## 4. ЩО ВЖЕ СЕРВЕР-ГОТОВЕ / НЕЙТРАЛЬНЕ (порт «як є»)

Чисті детерміновані функції без DOM/мережі/секретів — переносяться на Node-сервер без змін:

- **Паспорт / pageMarkers** — детермінований конденсатор, 0 токенів, 0 DOM: `documentPipeline/pageMarkers.js` (дзеркало в `cleanTextService`). Чистий обхід layout-геометрії.
- **caseNoKey нормалізація** — `ecits/caseNoKey.js` (trim/lower/regex), чиста.
- **sourcePolicy** — `sourcePolicy.js` `SOURCE_PRIORITY`/`canOverwrite`, чиста.
- **documentFactory** — `createDocument`/`validateDocument`/`needsReview` (`documentFactory.js`) — чисті, лише будують об'єкт; ID через `Date.now()+rand` (детерміновано-достатньо).
- **серіалізація/strip layout** — `ocrService.js:143-166` `stripHeavyFields`/`serializeLayout` — чиста трансформація (викидає image/tokens), не DOM.
- **chunk-планувальник меж** — `memoryMonitor.js` пороги (DEFAULT_CHUNK_PAGES=25 тощо) — чиста арифметика (адаптивність під RAM браузера зникне на сервері, але алгоритм лишається).
- **worker-операції самі по собі** — `pipelineWorker.js` `handleMessage(op,payload)` (`:97`) уже **середовище-агностичний** (той самий код у Worker і in-process — `workerClient.js:64-73`); pdf-lib працює і в Node. Тобто **логіка split/merge портується як є**; browser-bound лише *спосіб запуску* (`new Worker`), не сам код. Це знижує B4 до середньої складності.
- **fflate unzip** — `unpack.js`/`unpackArchivesFrontStep.js` логіка (fflate працює в Node) — порт як є (B16 низька).
- **DI-seam'и (drivePort, workerClient, callApi, callAgent)** — `jobState.js:20-21`, `workerClient.js:33`, фабрики `createActions`/`createDocumentPipeline` — **архітектурно вже готові** під підміну клієнт→сервер реалізації. Це найцінніший актив: міграція = підставити server-impl у наявні порти, не переписувати споживачів.

**Висновок §4:** значна частина DP — чиста логіка за DI-портами. Browser-прив'язка зосереджена у **5 точках реалізації портів**: (a) спосіб спавну воркера, (b) Drive-токен у driveAuth, (c) DocAI/Anthropic ключі+fetch, (d) canvas-конвертери/рушії, (e) RAM-стан прогресу/resume. Решта переноситься без переписування завдяки DI.

---

## 5. ПОРЯДОК ПЕРЕЇЗДУ (рекомендація для планування — НЕ спека)

**Фундамент (спершу — безпека, без неї SaaS неможливий):**
1. **B1 + B2 + B3 (секрети на сервер).** Anthropic-проксі + DocAI service-account + Drive OAuth per-tenant на бекенді. Це розблоковує все інше і знімає головний SaaS-блокер. До цього кроку SaaS неможливий — клієнт не може тримати робочі ключі.

**Наступне (CPU-робота за вже наявними DI-портами):**
2. **B4 (worker→server PDF-сервіс).** Логіка вже середовище-агностична (`§4`); підставити server-impl у `workerClient`-контракт. Розблоковує нарізку (сц.1) і mergePdf склейки (сц.2).
3. **B5-B10 (конвертери + canvas-рушії на сервер).** Image→PDF, HEIC, DOCX, HTML, compress, фото-склейка. Більший обсяг, але кожен за фасадом `converterService`/`prepareImagesForMerge` — підміна реалізації.

**Стан і resume (після того, як робота на сервері):**
4. **B12+B13+B14 (server job-queue зі статусом і durable resume на всі сценарії).** Нарізка вже має durable job_state на Drive (`jobState.js`) — взірець; поширити на склейку/додати/ZIP; jobProgress і OCR-resume — у server-state. Клієнт поллить статус.
5. **B15 (agentHistory без localStorage-tier).** Під multi-user прибрати browser-tier, лишити server-кеш + Drive.

**Останнє (дрібне):**
6. **B16 (unzip на сервер)** — низька складність, можна разом із B5-B10.

*Логіка черговості:* безпека — передумова всього (1); потім робота переїжджає за DI-портами (2-3); стан/resume має сенс серверним лише коли робота вже серверна (4-5).

---

## 6. БЕЗПЕКОВІ НАСЛІДКИ (підтверджено `file:line`)

1. **Anthropic API-ключ у клієнтському `localStorage` (`claude_api_key`)** — `App.jsx:1108,3259,5114`; читається і шлеться напряму на api.anthropic.com з `anthropic-dangerous-direct-browser-access:true` (`claudeVision.js:172-174`, `imageDocumentGrouper.js:242-244`, `imageSortingAgent.js:329-331`, `contextGenerator.js:582-586`). **Це найбільший SaaS-блокер:** будь-який multi-tenant сценарій вимагає, щоб клієнт ключа не бачив. Сам заголовок `dangerous-direct-browser-access` — антипатерн для prod.
2. **Drive OAuth access-token у `localStorage` (`levytskyi_drive_token`)** — `driveAuth.js:11,17,21`. Токен з cloud-platform scope (Drive + Document AI) живе у браузері, доступний будь-якому скрипту/розширенню у вкладці. Під SaaS — server-side per-tenant.
3. **Document AI викликається з браузера тим самим Drive-токеном** — `documentAi.js:43,177`; `driveAuth.js:135`. Байти документів адвоката летять прямо з вкладки на Google. Сервер мав би бути проксі.
4. **Похідне:** оскільки ключі/токени в клієнті — у клієнта повний доступ до моделей і Drive-простору; немає server-side rate-limit/quota enforcement per-tenant (білінг-ліміти `subscription.limits` сьогодні не можуть бути примусовими, бо клієнт б'є API напряму). Це робить білінг-ліміти **порадчими, не примусовими** до серверної міграції — прямий наслідок B1/B2.

---

## 7. ПРОГАЛИНИ / ВІДКРИТІ ПИТАННЯ

1. **claudeVision (B11) — dormant, але код browser-bound:** поза default OCR-chain (`diagnostic_dp_crosscutting.md §3.1`, `providerMatrix.js:28-44`), активний лише через ручний forceProvider. `extractMetadata`-гілка взагалі **мертва** (`diagnostic_dp_crosscutting.md §4.2`). Питання планування: мігрувати чи спершу видалити (leanness) — не мігрувати мертве.
2. **Адаптивність chunk-розміру під RAM браузера** (`memoryMonitor.js`) на сервері втрачає сенс (сервер має іншу пам'ять) — потрібен інший підбір; логіка лишається, параметри переглянути.
3. **`anthropic-dangerous-direct-browser-access:true`** присутній у 4+ точках — після серверної міграції ці заголовки і прямі fetch зникають; інвентар точок (§2.3) — готовий чек-лист для видалення.
4. **agentHistory tier-2 (localStorage)** під multi-user — не лише міграція, а потенційний **функціональний баг** (два юзери одного tenant, різні кеші). Чи прибирати tier-2 повністю, чи робити server-shared — рішення власника.
5. **DocAI кост поза `ai_usage[]`** (`diagnostic_dp_crosscutting.md §10 п.10`) — після переїзду DocAI на сервер з'явиться природна точка інструментації витрат OCR per-tenant (зараз невидимі).
6. **Resume на сервері** (B14) — питання, чи durable resume взагалі потрібен на всі сценарії, чи дешевий re-run прийнятний (як свідомо обрано для OCR-resume, `resumeStore.js:7-14`). Рішення продуктове, не технічне.

---

**Кінець — audit_dp_server_migration_readiness.md (§1.3 + §3.2 + §6.6).** Read-only; код не змінювався. 16 browser-bound блокерів, 3 з них безпеково-критичні (B1/B2/B3).
