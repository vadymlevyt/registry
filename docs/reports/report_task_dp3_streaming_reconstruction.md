# Звіт — TASK DP-3: Streaming pipeline, семантична реконструкція, фонова обробка

**Дата:** 17.05.2026
**Гілка розробки:** `claude/new-session-4Gpvu`
**Тип:** Великий архітектурний TASK (streaming + Web Worker + resume + ETA + multi-file реконструкція + Topbar UI). Надбудова на pipeline-фундамент DP-1/DP-2 через `stageOverrides` + новий координатор `streamingExecutor`.
**Статус:** виконано, чекає підтвердження адвоката на push у `main` (правило #1 — код-зміна).

---

## 1. Baseline (§2 handoff — фактичний прогін ДО будь-якої зміни)

Залежності встановлено (`npm install`), потім baseline на незмінному коді гілки (числа з виводу, не з памʼяті):

| Метрика | Baseline (до DP-3) | Після DP-3 |
|---|---|---|
| `npm test` — Test Files | **73 passed (73)** | **86 passed (86)** |
| `npm test` — Tests | **1154 passed (1154)** | **1235 passed (1235)** |
| `npm run build` | **✓ зелений** (пре-існуючі chunk-size warnings) | **✓ зелений** (ті самі warnings) |

Кількість тестів **зросла** (+13 файлів, +81 тест), жодної регресії — acceptance §9 виконано.

---

## 2. Дослідження (що читав, що перевіряв, на чому базував рішення)

**Обовʼязкове читання (повне, у порядку §1 handoff):** `CLAUDE.md`, `DEVELOPMENT_PHILOSOPHY.md`, `docs/reports/report_task_dp1_pipeline.md`, `docs/reports/report_task_dp2_archives_ecits.md`, `docs/consultations/discussion_dp_v2_philosophy_response.md`.

**Власний аудит коду (фактичний стан, не з handoff):**
- `documentPipeline.js` — диригент: `STAGE`/`DEFAULT_STAGE_ORDER` `Object.freeze`, **9 заморожених стадій**, `tests/unit/documentPipeline.test.js:44` асертить порядок+frozen. Розширення лише `deps.stageOverrides[ім'я]`/`deps.stageFlags`. `makeContext` переносить ФІКСОВАНИЙ набір полів (НЕ `extractedText`); `convertStage` обнуляє `extractedText` для `isDriveSource`. Контракт `{ok,ctx,decisions,error}`, `classifyDisposition` — єдина політика.
- `documentBoundary/` (salvage TASK 1): `detectBoundaries` (propose-only, single-PDF), `splitByBoundaries` (pdf-lib, byte-точно legacy), `analyzeViaToolUse` (single-shot Document Block, не справжній multi-turn), `prompt.js` (snapshot-tested — не чіпав).
- `ocr/resumeStore.js` — in-memory `{driveId→ResumeState}`, свідомо без persistence. DP-3 розширює патерн на весь pipeline але **через Drive** (бо вартість втрати streaming-результату незрівнянна з OCR-чанком).
- `ocrService.js` — `extractText`/`writeExtractedTextArtifact`/`writeLayoutArtifact`, кеш у 02_ОБРОБЛЕНІ, `serializeLayout` стрипає image/tokens.
- `compressionService.compressPdf`, `documentBoundary/splitPdf` — чисті pdf-lib, переюзані Worker'ом (нуль дублювання).
- `driveService.js`/`driveAuth.js` — `driveRequest` (auto-refresh 401), multipart upload, `findOrCreateFolder` (латиниця для q=, правило #8). Quota (`about.get`) і binary read/write **не існували** — додано.
- `tenantService.js` — `DEFAULT_TENANT.settings` патерн (`ecitsAutoProcess` додано DP-2 без bump), акцесор `getEcitsAutoProcess()`. Дзеркалив для `splitterDatasetEnabled`.
- `vite.config.js` — `base:'/registry/'`, без worker-конфіга. Vite-нативний `new Worker(new URL('...',import.meta.url),{type:'module'})` емітить хешований chunk під `/registry/assets/` (статичний хостинг GitHub Pages віддає коректно).
- Тестові патерни: `_actionsTestSetup.createHarness` (тонкий адаптер над справжнім `createActions`), `dp2-stages.test.js` (real pipeline+actions).

**Перевірені бібліотеки/можливості:** pdf-lib `^1.17.1` `copyPages`/`getPageCount` працює у Worker; fflate (DP-2) не релевантний; `performance.memory` — Chrome-only (підтверджено через MDN-знання — Safari/iPad не має → fallback стратегія).

---

## 3. Архітектура streaming — як працює, компоненти, інтеграція

**Принцип:** диригент заморожений → DP-3 НЕ міняє `documentPipeline.js`. Streaming живе у **новому координаторі поза диригентом**, який ГОТУЄ дані (RAM-bounded chunk-OCR) і запускає справжній диригент з V3-стадіями через `stageOverrides`.

```
streamingExecutor.run(input)
  → free-space gate (drivePort.quota, §4.11)
  → makeInitialJobState → jobStore.saveState (resume точка)
  → для кожного файла:
       upload orig → _temp/<caseId>_<jobId>/  (RAM звільнено)
       chunkManager.planChunks (memory-aware: memoryMonitor)
       для кожного chunk: materialize→_temp → readBytes → processChunk(OCR)
                          → text у jobState → ЗАНУЛИТИ chunkBytes → saveState
                          → progress+ETA у jobProgressStore
       workerClient.mergeText → уніфікований текст файла
  → createDocumentPipeline(buildPipelineDeps({getStreamedText})).run(...)
       intake→convert(passthrough Drive-source)→detectBoundariesV3→classify→
       extractV3→proposeMetadata→confirmBoundaries→splitDocumentsV3→emit
  → успіх: jobStore.clearState (чистить _temp цілком) + finishJob(grace)
  → fatal/skip: лишаємо jobState (resumable), стоп з повідомленням
```

**Компоненти (нові файли):** `streamingExecutor.js` (координатор), `chunkManager.js` (memory-aware план + materialize у _temp), `jobState.js` (crash-safe resume на Drive), `memoryMonitor.js` (performance.memory + fallback), `workerClient.js` (DI Worker/in-process), `drivePort.js` (вузький Drive-фасад, Provider Pattern), `jobProgressStore.js` (transient-UI стор).

**Універсальність (§4.1):** один файл / пакет 2-5 / 30+ файлів — **той самий шлях**, різниця лише в обсязі. Доведено інтеграційним тестом (single-file і 3-file пакет через ту саму `exec.run`).

---

## 4. Web Worker — структура, що де, передача даних

`src/workers/pipelineWorker.js` — чистий CPU поза UI: `pdfInfo`/`splitPdf`/`mergePdf`/`compressPdf`/`mergeText`/`parseJson`. Логіку **НЕ дублює** — імпортує `compressionService.compressPdf`, `documentBoundary/splitPdf` (Worker і синхронний fallback дають біт-у-біт той самий результат).

**Межа Worker↔main:** Worker = чистий CPU; **жодного Drive I/O** (у воркері немає `localStorage`/`window.google` → OAuth-токен `driveAuth` недоступний). Координація + Drive — main thread (`streamingExecutor`).

`workerClient.js` — DI-seam: реальний Worker (браузер) АБО синхронний in-process (тести/Safari без Worker) за одним контрактом `runInWorker(op,payload,transfer?)`. Transfer ArrayBuffer **лише на ВИХОДІ** (великий результат). Виправлено баг: chunkManager НЕ transfer-ить джерело (переюзається між chunk'ами — у реальному Worker детач зламав би 2-й chunk).

**Vite-бандл (перевірено):** Worker-chunk емітиться коли executor вмонтований у app (DP-4, разом з UI-споживачем) — зараз tree-shaken як DP-2 ecitsInboxWatcher (немає споживача = speculative generality, `discussion §Q3`). Патерн `new Worker(new URL(...,import.meta.url),{type:'module'})` + `base:'/registry/'` — Vite-нативний, GitHub Pages статикою віддає коректно. **Технічної проблеми немає** (прапор не піднімаю).

---

## 5. Resume infrastructure — структура job_state, відновлення

`jobState.js`: `_temp/<caseId>_<jobId>/job_state.json` (латиниця в корені Drive як `_backups`/`_research`, правило #8). Стан: `files[]`(прогрес+originalDriveId), `chunks[]`(fileId/index/pageRange/driveId/status/text), `cursor`, `documents[]`, `reconstructionPlan`, `unusedPages[]`, `chunkDurationsMs[]`(ETA), `stoppedAt`, `status`.

**Crash-safety без atomic rename** (Drive не має): `saveState` пише НОВИЙ `job_state.json` → потім видаляє попередні. Падіння посеред save → старий стан цілий. `loadState` бере найсвіжіший, прибирає дублі; биткий JSON → null (з нуля безпечніше). `clearState` — весь `_temp/<job>/` (chunks+state).

**Відновлення:** `streamingExecutor.resume(input)` → `loadState` → `run(input,{resumeState})`. chunk зі `status==='done'` пропускається (нуль повторного OCR/Document AI білінгу). Доведено unit+integration: 2-й прогон після fatal — `processChunk` НЕ викликається повторно.

---

## 6. Семантична реконструкція multi-file — Tool Use multi-turn патерн

`documentBoundary/multiFileReconstructor.js`. **Tool Use multi-turn як накопичення** (не серверний stateful-діалог): AI бачить файли послідовно; після кожного — `openTails[]` (документ почався, міг продовжитись) і накопичений план; стан між викликами тримаємо МИ і передаємо у наступний виклик (`analyzeFile({openTails,...})`). Функціонально multi-turn (кілька ходів AI, контекст накопичується), але **детерміновано і тестопридатно** — узгоджено з філософією (нуль speculative generality, DI-транспорт, no auto-resolution → лише propose).

**Універсальність (§4.4):** жодних сценаріїв «PDF+JPEG»/«DOCX+ZIP» у коді. Після convert(DP-1)+OCR(executor) усе = `{text}`; реальний формат для реконструктора не існує. `mergeFileResult` — чиста функція накопичення (`continuesFromTail` дописує фрагмент у наявний документ, закриває хвіст). Вихід: `{documents:[{documentId,name,type,fragments:[{fileId,startPage,endPage}]}], unusedPages:[{fileId,pageRange,reason}]}`. Помилка AI на файлі — НЕ фатально (файл → unusedPages-кандидат). `detectBoundariesV3`: пакет→reconstruct; один файл→делегує DP-2-детектор, нормалізує у ТОЙ САМИЙ план (single-file НЕ регресує).

---

## 7. Topbar UI — структура, responsive, інтеграція

`src/components/JobProgressTopbar/index.jsx` (+`styles.css`). Підписаний на `jobProgressStore` — **сам джерело «показувати чи ні»** (нема jobs → `return null`). Слот у `App.jsx` між логотипом і «збережено» (один рядок додано, диригент App не чіпав). Прогрес-бар, %, ETA, назва, `[Розгорнути][Скасувати]`. Розгорнути → **заглушка-модалка** з тими ж даними + нота «повний екран DP-4». Responsive (CSS, не JS): ≤720px → 2 рядки (без обрізання тексту); ≤420px → компактна іконка-заглушка. НЕ floating (не заважає агенту досьє). Тільки наявні design-токени.

`jobProgressStore` — transient-UI стор (як eventBus, не App.jsx SSOT — не тримає cases/notes, лише ефемерний прогрес). Гібрид §4: push від executor (миттєво) + `attachDrivePolling` 5с fallback що **сам зупиняється** коли jobs порожні (нуль трафіку без потреби) і доганяє лише вперед (не відкочує push).

---

## 8. Custom Splitter dataset — що зберігається, як, дисклеймер

`datasetCollector.js` + `tenant.settings.splitterDatasetEnabled:false` (+`getSplitterDatasetEnabled()`, той самий патерн що `ecitsAutoProcess`, без schema bump). Gated: toggle false → no-op. true → append у `_datasets/splitter_training_data.json`: межі/типи документів, layout.json метадані, OCR-текст, thumbnails першої/останньої сторінки (лише коли `renderThumbnail` ін'єктовано — canvas браузерний; Node/тести без нього пишуть решту). **Без технічної анонімізації** (§9) — дисклеймер про адвокатську таємницю у UI: **текст для DP-4** (нижче). Sub-стадія `splitDocumentsV3` (після confirmed-плану). Не кидає (побічна користь).

**Текст дисклеймера для DP-4 UI** (поряд з toggle): *«Увімкнувши збір датасету, ви зберігаєте розпізнаний текст, межі і метадані документів цієї справи для майбутнього навчання власного спліттера. Дані містять зміст матеріалів справи. Відповідальність за дотримання адвокатської таємниці і правомірність використання цих даних несе адвокат. Технічної анонімізації не виконується.»*

---

## 9. Memory management — стратегії, fallback

`memoryMonitor.js`: `performance.memory` (Chrome) — БОНУС (як Idle Detection §9 білінгу), не основа. `adviseChunkPages` бере МІНІМУМ з: (1) ліміт за розміром файла (великий → менший chunk, ~≤40МБ/chunk); (2) ліміт за тиском купи (half-headroom; тиск ≥0.8 → MIN_CHUNK_PAGES). Завжди у `[MIN=5, MAX=40]`. **Fallback** (Safari/iPad/Node — API нема): лише (1), консервативно, працює всюди — `readMemory→null`, не панікуємо. **GC-дисципліна:** після кожного chunk явне `chunkBytes=null`; `hintGarbageCollection` (no-op без `--expose-gc` — чесно). Чому так: примусовий GC у браузері недоступний; реальне звільнення = занулення посилань + RAM тримає лише один chunk (фундамент масштабованості).

---

## 10. Файли створені / видалені / модифіковані

**Створено — сервіси (12):** `documentPipeline/streamingExecutor.js`, `chunkManager.js`, `jobState.js`, `memoryMonitor.js`, `workerClient.js`, `drivePort.js`, `jobProgressStore.js`; `documentPipeline/stages/detectBoundariesV3.js`, `confirmBoundaries.js`, `extractV3.js`, `splitDocumentsV3.js`; `documentBoundary/multiFileReconstructor.js`; `datasetCollector.js`, `standaloneCompressor.js`; `workers/pipelineWorker.js`.
**Створено — UI (2):** `components/JobProgressTopbar/index.jsx`, `styles.css`.
**Створено — тести (14):** unit `memoryMonitor`, `jobProgressStore`, `multiFileReconstructor`, `dp3Stages`, `jobState`, `pipelineWorker`, `chunkManager`, `splitDocumentsV3`, `datasetCollector`, `standaloneCompressor`, `streamingExecutor`, `JobProgressTopbar.jsx`; integration `dp3-streaming`; helpers `_pdfFixture.js`, `_memDrivePort.js`.
**Модифіковано (5):** `eventBusTopics.js` (+`DOCUMENT_FRAGMENT_SAVED`, +у `DOCUMENT_TOPICS`), `tenantService.js` (+`splitterDatasetEnabled`+акцесор), `driveService.js` (+`getDriveQuota`/`uploadBytesToDrive`/`readDriveFileBytes`/`listFolderWithModified`), `App.jsx` (+import+`<JobProgressTopbar/>` слот, 2 рядки), `tests/unit/canonicalSchemaV7.test.js` (DOCUMENT_TOPICS 4→5 — адитивний топік).
**Видалено:** нічого. **Диригент `documentPipeline.js`, `converterService`, `ocrService`, AddDocumentModal flow — НЕ торкалися.**

---

## 11. Тести — baseline / після, нові

| | Baseline | Після |
|--|--|--|
| Test Files | 73 | **86** (+13) |
| Tests | 1154 | **1235** (+81) |
| `npm run build` | ✓ | ✓ (ті самі пре-існуючі chunk warnings) |

Нові покривають: memory-aware chunk + fallback; Worker OPS на реальних pdf-lib PDF (split/merge/info/compress); workerClient in-process==Worker; jobState crash-safe round-trip+resume+битий стан; chunkManager суцільні діапазони+materialize у _temp; multi-turn накопичення відкритих хвостів; 4 V3 стадії (gated/propose-only/single-file-no-regress); splitDocumentsV3 (мультифайловий документ, PERSIST_FAILED fatal, fallback, saveFragments+подія, dataset gated); datasetCollector toggle; standaloneCompressor (drive/download/email-stub); streamingExecutor (free-space block, chunk-loop, resume skip, cleanup, cancel); Topbar (зʼявл/зник/розгорн/cancel); **integration через справжній диригент+createActions**: 60-стор PDF→1 док+_temp чисто, 3-файл пакет→2 логічні документи+фрагмент+подія, resume без повторного OCR, AddDocumentModal без регресій.

---

## 12. Відхилення від handoff (експертна автономія, з поясненнями)

1. **`split`/`saveFragments`/`cleanup` — НЕ нові вузли диригента, а sub-стадії існуючих** (§8 прямо дозволяє «sub-стадії існуючих»). Маппінг: `detectBoundaries`→detectBoundariesV3, `confirm`→confirmBoundaries, `extract`→extractV3, `persist`→splitDocumentsV3 (split+**saveFragments**+**datasetCollector** усередині), `cleanup`→`streamingExecutor` finalize (він володіє `_temp` lifecycle; диригентів `emit` лишається чистим). **Вплив:** диригент абсолютно недоторканий, frozen-9-тест зелений.
2. **OCR виконує `streamingExecutor` ДО pipeline, стадія `extract`=clean+формат** (не «зробити OCR»). Заморожений порядок ставить `extract` ПІСЛЯ `detectBoundaries`, але §4.4 вимагає OCR ДО реконструкції (AI бачить нормалізований текст). Нерозвʼязно якщо `extract`=OCR. Тому RAM-bounded chunk-OCR — у executor (його суть §4.1); `extractV3` = семантична постобробка тексту що вже є (clean Haiku + TXT/MD). Це «sub-стадія» (§8). **Вплив:** §4.4 виконано без зміни диригента; `extract` лишається чистою точкою.
3. **Потоковий текст у V3-стадії через DI-аксесор `getStreamedText`** (не через `ctx.files`). `makeContext` диригента переносить ФІКСОВАНИЙ набір полів (без `extractedText`), `convert` обнуляє його для Drive-source. Тягнути текст через ctx = міняти диригент. Рішення: executor володіє текстом → ін'єктує `buildPipelineDeps({getStreamedText})` (той самий патерн що `buildDocumentMetadata` DI-seam DP-1). **Вплив:** диригент чистий; не-streaming (AddDocumentModal) працює як було (`item.extractedText` fallback).
4. **Робоча копія оригіналу у `_temp/`, не `01_ОРИГІНАЛИ/`.** §4.1 каже «→01_ОРИГІНАЛИ», §5-таблиця — «оригінал адвоката НЕ зберігається; нарізані документи→01_ОРИГІНАЛИ». Суперечність у самому ТЗ. Обрано §5 (явна встановлена таблиця): робоча копія в `_temp` (RAM звільнено — дух §4.1), фінальні нарізані→`01_ОРИГІНАЛИ`, `_temp` чиститься на успіху. **Вплив:** §5 дотримано дослівно; диск не засмічується оригіналами.
5. **Drive-based resume, не in-memory як `ocr/resumeStore`.** handoff §4.3 каже «розширити патерн resumeStore». In-memory не переживає reload вкладки на планшеті — а це і є use case DP-3 (втрата годин роботи + Document AI грошей). Зберіг патерн (load/save/clear API, інваріант «є стан → не завершено»), але носій — Drive. **Вплив:** реальний resume після reload (доведено тестом).
6. **`compressAllFiles` — поле job-config, НЕ tenant.settings.** §4.10 «Поле у config pipeline». Тому це частина input pipeline (читається у DP-4 з UI), не дзеркало `ecitsAutoProcess`. `splitterDatasetEnabled` — tenant.settings (§4.8 прямо). Заклад: `compressAllFiles` приймається як опція; реальний прохід через compressionService на файл < технічного порогу — точка DP-4 UI (заклад не активований без UI-споживача, золота середина).

Сумнівних рішень що потребували б зупинки ДО реалізації — не було: суперечність §4.1/§5 і колізія frozen-order/OCR розвʼязані в межах §8 «sub-стадії» + §"експертна автономія" (чистіша інтеграція з патерном). Web Worker у Vite/GitHub Pages технічної проблеми не має (перевірено) — прапор §"коли підіймати" не застосовний.

---

## 13. Що свідомо лишено для DP-4/5/6 (точки розширення)

- **DP-4:** повноекранний прогрес-екран (зараз заглушка-модалка); UI вкладок Підтвердження/Помилки (споживає `decisions[]`); реальний `confirmBoundaries.autoConfirm:false` гейт з UI; toggle+дисклеймер `splitterDatasetEnabled`; UI «Стиснути файл(и)» (логіка `standaloneCompressor` готова); `compressAllFiles` UI; UI вибору «зберегти/видалити фрагменти/готові при скасуванні» (логіка `keepPartial`/`discardAll` готова); монтування `streamingExecutor` у App + `attachDrivePolling` + `ecitsInboxWatcher` (DP-2) → executor; canvas `renderThumbnail` для датасету.
- **Page-precise text slicing:** зараз 02_ОБРОБЛЕНІ текст береться з джерела першого фрагмента (80%-precise; точний по-сторінковий зріз тексту за layout-offset — DP-4, де є UI перевірки).
- **DP-5/6:** Telegram/Email/messenger цілі `standaloneCompressor` (заглушки `not_implemented`); якісне стиснення через iLovePDF (Provider Pattern, окремий TASK як TASK 1 salvage передбачав); SSE/WebSocket замість Drive-poll (один адаптер у `jobProgressStore`).
- **Court Sync (майбутнє):** publisher `ECITS_DOCUMENTS_RECEIVED` → `ecitsInboxWatcher` (DP-2) → `streamingExecutor.run` (auto-режим) без зміни executor.

---

## 14. Acceptance criteria (§9) — статус

| Критерій | Статус |
|---|---|
| streaming infra: streamingExecutor/chunkManager/jobState | ✅ (+memoryMonitor/workerClient/drivePort) |
| Pipeline на одному файлі == на пакеті (без штучних обмежень) | ✅ (integration single+3-file через ту саму run) |
| multiFileReconstructor — будь-яка комбінація через уніфіковану логіку | ✅ (після convert+OCR усе=text; нуль сценаріїв у коді) |
| Web Worker `pipelineWorker.js` створено+інтегровано | ✅ (DI workerClient; chunk emit при mount DP-4 як DP-2 watcher) |
| Семантична реконструкція multi-file Tool Use multi-turn | ✅ multiFileReconstructor + detectBoundariesV3 |
| Реальний split propose→confirm: confirmBoundaries, splitDocumentsV3 | ✅ |
| Стадія saveFragments → 03_ФРАГМЕНТИ + fragments_log.json + причини | ✅ (sub-стадія persist; +зведений лог +подія) |
| Повна extract: extractV3 OCR+cleanText+TXT/MD/layout | ✅ (OCR у executor §12.2; extractV3 clean+формат+layout) |
| Topbar UI: компонент+прогрес+ETA+responsive+App.jsx | ✅ |
| Custom dataset: datasetCollector + splitterDatasetEnabled | ✅ |
| Cleanup після успіху (chunks/_temp/job_state) | ✅ (streamingExecutor finalize §12.1) |
| Скасування «зберегти N / видалити все» (логіка готова, UI заглушка) | ✅ keepPartial/discardAll + prompt |
| `compressAllFiles` у config pipeline (поле є, UI DP-4) | ✅ (job-config §12.6) |
| Перевірка вільного місця Drive перед великим пакетом | ✅ getDriveQuota + freeSpaceVerdict (1ГБ блок / 5ГБ warning) |
| Standalone «Стиснути файл(и)»: standaloneCompressor (логіка, UI DP-4) | ✅ (email/messenger — заглушки) |
| ETA на основі історії chunks | ✅ estimateRemainingMs (null з порожньої історії — чесно) |
| Resume після збою — з останнього chunk | ✅ (unit+integration: нуль повторного OCR) |
| Memory monitoring performance.memory + fallback | ✅ |
| Юніт-тести нові компоненти/стадії | ✅ 13 unit-файлів |
| Інтеграційні: великий PDF, пакет, resume | ✅ dp3-streaming через справжній шар |
| AddDocumentModal без регресій | ✅ flow не зачеплено + integration-доказ |
| `npm test` ≥ baseline | ✅ 1235 ≥ 1154; 86 ≥ 73 |
| `npm run build` зелений | ✅ |
| Звіт | ✅ (цей файл) |
| Зведення показано; push після підтвердження | ⏳ очікує |

---

## 15. tracking_debt — побічні знахідки

- Пре-існуючий debug `console.log` у `executeAction` (`actionsRegistry.js`, tracking_debt #12 з DP-2) шумить у нових integration-тестах. DP-3 не вводив, не чистить (поза scope). Тригер незмінний.
- Page-precise text slicing для 02_ОБРОБЛЕНІ при мід-файлових межах — 80%-рішення у DP-3 (DELTA-принцип), точний зріз за layout-offset → DP-4 (де є UI перевірки). Внесено сюди як явний відкладений елемент.

---

## 16. Підтвердження

- **Behavior-preserving для AddDocumentModal:** так. Flow `CaseDossier onSubmit` **не зачеплено жодним рядком**; V3-стадії вмикає ЛИШЕ `streamingExecutor` (новий шлях), AddDocumentModal використовує диригент як у DP-1/DP-2. Integration-тест доводить: прямий pipeline без V3 = 1 документ, людська класифікація проходить.
- **Диригент незмінний:** так. `documentPipeline.js` не редагувався; `DEFAULT_STAGE_ORDER`/`STAGE` — 9 заморожених; frozen-9 тест зелений. DP-3 — виключно `deps.stageOverrides[ім'я]` + новий координатор ПОЗА диригентом (OCP).
- **executeAction незмінний:** так. Персистенція виключно через ін'єктований `persistDocument`→`executeAction('document_processor_agent','add_documents')` (audit/billing/permissions висять там); сигнатура/pipeline не чіпались; жодної модифікації даних повз шар.
- **Інваріант 9 frozen стадій:** збережено. Нові стадії — override існуючих імен; saveFragments/dataset — sub-стадії persist; cleanup — у координаторі. Диригент без domain-if.

---

**DP-3 — фундамент масштабованості закладено. 250-сторінковий том / 30-файловий пакет на планшеті: RAM тримає один chunk, Worker не морозить UI, resume переживає reload, реконструкція збирає документ розкиданий по файлах — усе БЕЗ зміни диригента DP-1, виключно через `stageOverrides` + координатор `streamingExecutor`.**
