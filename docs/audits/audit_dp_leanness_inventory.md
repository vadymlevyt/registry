# AUDIT — DP «СПИСОК НА СХУДНЕННЯ» (leanness inventory)

**TASK:** `docs/tasks/TASK_dp_full_audit.md` §3.4 (7 класів зайвого) + §3.5-G (#38 / #44)
**Дата:** 2026-06-15
**Тип:** read-only діагностика (жодного рядка коду не змінено)
**Хвиля:** WAVE 2, PART 1. Спирається на 4 сценарні звіти WAVE 1
(`audit_dp_slicing.md`, `audit_dp_image_merge.md`, `audit_dp_add_files.md`, `audit_dp_zip_ingest.md`).

---

## 0. МЕТОДОЛОГІЯ

**Словник вироків (строгий, §1.4 спеки):**
- **живий** — існує prod-caller (НЕ тест). Доказ — `file:line` місця виклику в проді.
- **дрімає-приберегти** — осиротілий у проді, АЛЕ є явний майбутній тригер активації.
- **мертве-видалити** — жоден prod-шлях не імпортує/не кличе; тримають лише тести
  (tests-only = кандидат на видалення).

**Grep-доказ prod-caller'а:** для кожного експорту виконано `grep -rn <symbol> src/ tests/`,
з відсіюванням (а) самого файлу-визначення, (б) тестів, (в) **коментарів** (критично — у DP
багато «імен у коментарях», що НЕ є викликами: напр. `detectBoundariesV3` згадано у
`DocumentPipelineContext.jsx:172` лише в коментарі «НЕ видалені», а не як виклик). Реальний
prod-caller = рантайм-`import` + використання, не текстовий збіг.

**Принцип §3.5-A (по-шляхово):** вирок про *станцію диригента* (CONVERT/CLASSIFY/...) залежить
від сценарію. Тут вироки по коду глобальні (файл/експорт або має prod-caller, або ні), а для
станцій-заглушок наведено явно, на якому шляху passthrough/мертва.

---

## 1. ІНВЕНТАР ЗА 7 КЛАСАМИ §3.4

### Клас 1 — Надлишкові покоління / суперседнуте

Пошук меж документів пережив ≥3 покоління; живе ОДНЕ. Живий слот `DETECT_BOUNDARIES` =
`createTriageStage` (`DocumentPipelineContext.jsx:175`) → `analyzeTriageViaToolUse.js`
(Haiku, паспорт-вхід, через `callAgent`). Решта поколінь — у коді, але мертві на live-шляху.

| Поколіннячко / файл | Експорт | Хто кличе в ПРОДІ (grep-доказ) | Вирок | Ризик видалення |
|---|---|---|---|---|
| `documentBoundary/analyzeViaToolUse.js` (83 р.) — СТАРИЙ Document-Block аналізатор (весь PDF як base64, дорогі image-токени, модель `documentProcessor`) | `analyzeBoundariesViaToolUse` | **ЖОДНОГО.** Імпортується ЛИШЕ фасадом `documentBoundary/index.js:19,23`. Інші 3 збіги (`callAgent.js:47,210`, `DocumentPipelineContext.jsx:102`) — **коментарі**. | **мертве-видалити** | Тести: немає прямих (фасад теж нічий). Низький ризик. |
| `documentBoundary/index.js` (42 р.) — фасад `detectBoundaries`/`analyzeBoundariesViaToolUse` | `detectBoundaries`, `analyzeBoundariesViaToolUse` | **ЖОДНОГО prod- АНІ test-імпорту з `index.js`.** `grep "from.*documentBoundary['\"]\|/index"` → порожньо. Тести й prod імпортують підфайли НАПРЯМУ (`splitPdf.js`, `triagePrompt.js`, `analyzeTriageViaToolUse.js`), не фасад. | **мертве-видалити** | Майже нульовий — фасад нікому. |
| `stages/detectBoundariesV2.js` (132 р.) | `createDetectBoundariesV2` | **ЖОДНОГО prod.** Лише `tests/unit/detectBoundariesV2.test.js:4`, `tests/integration/dp2-stages.test.js:11`. У живому Provider слот = `createTriageStage`, не V2. | **мертве-видалити** | Тримають 2 тест-файли → видалити з тестами разом. |
| `stages/detectBoundariesV3.js` (167 р.) | `createDetectBoundariesV3` | **ЖОДНОГО prod.** Лише `tests/unit/dp3Stages.test.js:4`. У `DocumentPipelineContext.jsx:172` ім'я — у коментарі «НЕ видалені — стануть виконавцями маршрутів». | **дрімає-приберегти** (м'яко) АБО **мертве-видалити** | Свідомо приберігся «виконавцем маршрутів Ф3»; АЛЕ Ф3-маршрути вже реалізовані ІНАКШЕ — у `splitDocumentsV3` інлайн (`route` add_as_is/image_merge/to_fragments, без V3). Тригер не настав і не настане в цій формі → схиляюсь до видалення. **Рішення власника.** |
| `documentBoundary/multiFileReconstructor.js` (176 р.) | `reconstructAcrossFiles` | **ЖОДНОГО prod-виклику.** Імпортується лише `detectBoundariesV3.js:21` (сам мертвий) + згадки в коментарях `triageStage.js:6`, `DocumentPipelineContext.jsx:172`. **Живий persist `splitDocumentsV3.js` НЕ кличе** (`grep -c reconstructAcrossFiles splitDocumentsV3.js` = **0**) — реконструкцію робить інлайн через `route`. | **мертве-видалити** (разом з V3) | Тест `tests/unit/multiFileReconstructor.test.js`. |
| `stages/triageStage.js` → `analyzeTriageViaToolUse.js` | `createTriageStage` / `analyzeTriageViaToolUse` | **ЖИВИЙ.** `DocumentPipelineContext.jsx:175`. Baseline. | **живий** | — |

> **Уточнення лідів WAVE-1:** `extractV3.js` (`createExtractV3`) і `confirmBoundaries.js`
> (`createConfirmBoundaries`) — **ЖИВІ**, не мертві: інжектяться у Provider
> (`DocumentPipelineContext.jsx:36-37` import, `:183` extract, `:189` confirm). НЕ кандидати.
> Суфікс `V3` тут — залишок іменування, не ознака смерті (Клас 6).

**Узагальнення (борг #66 закривається вироком):** кластер мертвих меж =
`analyzeViaToolUse.js` + `index.js`(фасад) + `detectBoundariesV2.js` + `detectBoundariesV3.js`
+ `multiFileReconstructor.js` ≈ **600 рядків** prod-коду + ~5 тест-файлів. Усі test-only.

---

### Клас 2 — Дублі та паралельні шляхи

| Знахідка | file:line | Grep-доказ | Вирок |
|---|---|---|---|
| **Два розпаки ZIP** (борг #57). Живий фронт-крок `addFiles/unpackArchivesFrontStep.js` vs осиротілий stage `createIntakeWithUnpack` (`stages/unpack.js:164`). | `unpackArchivesFrontStep.js` (живий) проти `unpack.js:164` | `createIntakeWithUnpack` prod-збіг лише в `unpackArchivesFrontStep.js:17` — це **коментар** «НЕ активує дрімаючий createIntakeWithUnpack». Реального виклику немає. | `createIntakeWithUnpack` + sidecar-логіка — **мертве-видалити (ЧАСТКОВО, див. Клас 3)**; фронт-крок — **живий** |
| **Дзеркало структури `analyzeTriageViaToolUse` ↔ `analyzeViaToolUse`** (B1 P2 `data.error` дрейф) | `analyzeTriageViaToolUse.js:3` («дзеркалить структуру») | Дрейф уже закрито централізацією в `callAgent.throwIfApiError`. Старий аналізатор мертвий (Клас 1) → джерело дрейфу зникає з його видаленням. | дрейф закрито; видалення старого усуває ризик |
| **Дві оркестрації persist:** диригент-`splitDocumentsV3` (slice/add-files) vs власна inline-оркестрація фото (`DocumentProcessorV2/index.jsx:574-696` — `handleImageMergeSubmit` робить upload+add_documents напряму, повз стадії) | `index.jsx:574-696` | Свідомий дизайн (image_merge обходить job-store, борг #38). НЕ дубль логіки — паралельні моделі. | **живий** (обидва), не зводити зараз |

---

### Клас 3 — Осиротілі функції/файли/експорти

| Експорт / файл | file:line | Grep prod-consumer | Вирок | Ризик |
|---|---|---|---|---|
| `createIntakeWithUnpack` (intake-stage з розпаком) | `stages/unpack.js:164` | НЕ кличеться (єдиний збіг — коментар). | **мертве-видалити** | Тести `unpack.test.js` + частина `dp2-stages.test.js`. Борг #57 (тригер СПРАЦЮВАВ 2026-06-09). |
| `isSidecarFile` | `stages/unpack.js:65` | `grep src/` (без self) → **NONE**. Tests-only. | **мертве-видалити** | Тести в `unpack.test.js`. |
| `parseSidecarBytes` | `stages/unpack.js:158` | `grep src/` (без self) → **NONE**. Tests-only. | **мертве-видалити** | Те саме. |
| **ЧАСТКОВЕ видалення `unpack.js`:** ЖИВІ предикати/розпак, що тягне фронт-крок: `isArchive`(45), `archiveKind`(50), `isSignatureFile`(60), `guessMime`(82), `entryToFile`(104), `defaultUnzipArchive`(123) | `unpackArchivesFrontStep.js:29-34` реально імпортує | ✅ всі 6 мають живий consumer. `isArchive` ще й у `CaseDossier/index.jsx`. | **живі** | НЕ чіпати — це і є межа часткового видалення (#57: винести чисте в `archiveCore.js`, прибрати stage+sidecar) |
| `createClassifyV2` (stage-factory класифікації) | `stages/classifyV2.js:81` | Імпортується лише `detectBoundariesV2.js` (сам мертвий) + тести (`classifyV2.test.js`, `dp2-stages.test.js`). | **мертве-видалити** | Іде разом з V2. |
| `categoryFromBoundaryType` (з того ж `classifyV2.js:38`) | `stages/classifyV2.js:38` | **ЖИВИЙ** — `splitDocumentsV3.js:22,55` (`resolveCategory`). | **живий** | ⚠ При видаленні `createClassifyV2` файл `classifyV2.js` НЕ видаляти цілком — `categoryFromBoundaryType` лишити (або винести). |
| `enrichDocumentWithVisionMetadata` (`documentMetadata.js:27`) + `metadataEnrichAddAsIs` | `documentMetadata.js:27` | Prod-споживачів НЕМАЄ: `DocumentPipelineContext.jsx:343` — **коментар** «metadataEnrichAddAsIs БІЛЬШЕ НЕ ВИКЛИКАЄТЬСЯ, рішення власника». Лише `tests/unit/documentMetadata.test.js`. Підтверджено звітом add_files (§6, рядки 70/293). | **дрімає-приберегти** | Свідоме рішення власника лишити заготовку «без OCR → Vision-метадані». Тригер: реактивація skipOcr-режиму як Vision-enrich. Тести тримають. |
| `ocrService.extractMetadata` → `claudeVision.extractMetadata` | `ocrService.js:430` | Викликається лише з `documentMetadata.js:48` (сам дрімає). Транзитивно осиротілий. | **дрімає-приберегти** (разом з enrich) | — |

---

### Клас 4 — Тіні-дефолти і недосяжні гілки

| Знахідка | file:line | Доказ | Вирок |
|---|---|---|---|
| **Тінь-дефолт `persistStage`** (повна реалізація upload+persist у диригенті) | `documentPipeline.js:208-355`, реєстр `:367` `[STAGE.PERSIST]: persistStage` | Єдиний prod-caller диригента — `DocumentPipelineContext.jsx:245` (`createPipeline`), що ЗАВЖДИ інжектить `persist: createSplitDocumentsV3` (`:190`). Інший шлях `ecitsInboxWatcher` теж будує з override (DP-2 stageOverrides). → дефолтний `persistStage` у проді **ніколи не виконується**. | **мертве-видалити** (спека §3.2 «видалити мертву станцію persistStage») — АЛЕ обережно: це stable-default диригента; його видалення = архітектурне рішення (диригент тоді вимагає обов'язковий override persist). **Рішення власника.** Ризик: 30+ unit-тестів `documentPipeline.test.js` ганяють диригента з дефолтами. |
| Passthrough-дефолти `DETECT_BOUNDARIES`/`CLASSIFY`/`EXTRACT`/`PROPOSE_METADATA`/`CONFIRM` | `documentPipeline.js:362-366` | Усі перекриті у Provider, КРІМ `CLASSIFY` і `PROPOSE_METADATA` — на slice-шляху лишаються `passthroughStage` (НЕ override). Це НЕ мертві дефолти, а **жива passthrough-поведінка** (категорія/метадані будуються у persist, не тут). Див. Клас 5. | **живі як passthrough** (slice); реальна заглушка-контракт |
| `classifyDisposition` гілка `else`-after-return | `documentPipeline.js:379-389` | Інваріант коректний (ok:false без fatal/skip → fatal). Не мертва. | **живий** |

---

### Клас 5 — Claim'и універсальності, що не реалізуються

| Знахідка | file:line | Доказ (хто передає інше за дефолт) | Вирок |
|---|---|---|---|
| **Станція CLASSIFY** — обіцяє «класифікація category/author/nature», на slice **порожня passthrough** | `documentPipeline.js:363` + `triageStage`/`splitDocumentsV3` | НЕ перекрита у `buildPipelineDeps` (`DocumentPipelineContext.jsx`). Категорія виводиться у persist (`splitDocumentsV3.js:53 resolveCategory`). | **passthrough на slice** (живий контракт, не мертвий код) |
| **Станція PROPOSE_METADATA** — те саме | `documentPipeline.js:365` | НЕ перекрита; метадані у persist (`splitDocumentsV3.js buildMeta/defaultBuildMetadata`). | **passthrough на slice** |
| **Гачок `onArchiveEntry`** — «для майбутнього HTML-метадата-екстрактора» | `unpackArchivesFrontStep.js:81-83,139-151` | Default `null`; `grep onArchiveEntry src/` (без self) → **ЖОДЕН caller не передає**. | **дрімає-приберегти** (claim універсальності; тригер — серверний HTML-метадата-екстрактор) |
| **`AGENT_USAGE_LABELS` ключі `imageSorter`/`imageDocumentGrouper`** — мапінг для callAgent | `callAgent.js:50-51` | Ці дві AI-точки кличуть **РУЧНИЙ `fetch(ANTHROPIC_API_URL)`** (`imageDocumentGrouper.js:238`, `imageSortingAgent.js:325`), НЕ `callAgent`. Тобто записи в мапі для callAgent-шляху, якого фото-агенти не використовують → **dead stub** у мапі. | **мертве-видалити (рядки мапи)** АБО **дрімає** (B2 мігрує фото-агенти на callAgent → стануть живими). Тригер: B2-міграція. |
| `skipPdfSlicing`, `autoConfirm` прапори | `triageStage.js`, `confirmBoundaries.js` | Реально передаються (`DocumentPipelineContext.jsx:181,189` — з `opt`). | **живі** |

---

### Клас 6 — Залишки після реверту/міграцій

| Знахідка | file:line | Деталь | Вирок |
|---|---|---|---|
| Суфікси `_V2`/`_V3` на ЖИВИХ файлах: `extractV3.js`, `splitDocumentsV3.js`, `DocumentProcessorV2/` | різні | Іменна спадщина; код живий. Перейменування — косметика, не схуднення. | **живий**, низький пріоритет rename (тільки якщо торкаємось) |
| Коментарі «НЕ видалені — стануть виконавцями маршрутів Ф3» біля V3/reconstruct | `DocumentPipelineContext.jsx:172`, `triageStage.js:6` | «Приберегли на майбутнє», але маршрути вже реалізовані інакше (inline у splitDocumentsV3). Коментар застарів. | мертвий контекст — прибрати разом з V3/reconstruct |
| `classifyV2.js` суфікс V2 при живому `categoryFromBoundaryType` | `classifyV2.js` | Файл напівживий (один export живий, інший мертвий). Назва вводить в оману. | при cleanup — лишити живий export, прибрати `createClassifyV2` |

---

### Клас 7 — Інструментація-дублі

| Знахідка | file:line | Доказ | Вирок |
|---|---|---|---|
| Фото-агенти: `logAiUsageViaSink` (токени) + `activityTracker.report('agent_call')` (час) — паралельно | `imageDocumentGrouper.js:314-342`, `sortImageDocument.js:89-117` | Це **НЕ дубль** — `ai_usage[]` (токени, оператору) і `time_entries[]` (час, адвокату) — дві окремі структури (CLAUDE.md «не дублювати поля»). Звіт image_merge §підтвердив. | **живий, не дубль** |
| Внутрішній `logAiUsage` у `toolUseRunner` (борг #62) | `toolUseRunner.js:~245` | На шляху `callAgent` приглушений (не передається sink). Чат-агенти досі покладаються. | **живий для чатів** (борг #62, тригер уже зафіксований) |
| Дубль-облік на slice / ZIP / add-files шляхах | — | Звіти WAVE-1: «дубль-облік не виявлено» (slice §229, zip §227). | чисто |

---

## 2. §3.5-G — БОРГИ #38 і #44

### #38 — ДВІ системи прогрес-індикації (підтверджено, обидві живі)

| Система | Файли | Prod-caller | Обслуговує |
|---|---|---|---|
| **job-based** (стадійна) | `DocumentProcessorV2/{GlobalProgressScreen,ProgressFullScreen,useJobProgress}.js`, `JobProgressTopbar/`, `contexts/DocumentPipelineContext.jsx`, `services/documentPipeline/{jobProgressStore,streamingExecutor,stageLabels}.js` | `App.jsx`, `DocumentProcessorV2/index.jsx`, `streamingExecutor.js` (всі grep-підтверджені, non-test) | **нарізку** / основний DP-пайплайн |
| **component-based** (фазна) | `ImageEditor/ProcessingProgress.jsx` | `CaseDossier/ImageMergePanel/ProcessingView.jsx`, `DocumentProcessorV2/{index.jsx,DpImageMergeEditor.jsx}` | **фото** (image-merge), що свідомо обходить job-store |

**Вирок:** **обидві живі**, кожна у своєму сценарії (стадії vs фази). НЕ дубль до видалення зараз —
борг #38 явно тримає це до TASK «комбо» (один агрегатор сегментів). **дрімає (звести в майбутньому)**,
канонічну систему обрати тоді (ймовірно job-based як природний агрегатор). Підтверджує гіпотезу спеки.

### #44 — застарілий `MODEL_PRICING` → `estimatedCostUSD` неточний (підтверджено)

`aiUsageService.js:12-16`:
```
'claude-haiku-4-5-20251001': { input: 0.80,  output: 4.00 }   // актуально $1 / $5
'claude-sonnet-4-20250514':  { input: 3.00,  output: 15.00 }  // ~ ок
'claude-opus-4-7':           { input: 15.00, output: 75.00 }  // Opus 4.8 тепер $5 / $25 (різко дешевше)
```
`calculateCost` (`:22`) множить на ці цифри → `estimatedCostUSD` (`:46`) у кожному `ai_usage[]`-записі
**хибний**. Додатково: ключ `claude-opus-4-7` не збігається з `claude-opus-4-8` (якщо `modelResolver`
почне віддавати 4.8) → впаде у `default {0,0}` → cost=0. **Вирок:** не зайвий код, а **застарілі дані** →
дрібний фікс-TASK (борг #44 живий). Впливає на SaaS-економіку (§3.5-H) — поточні оцінки занижені для
Haiku, завищені для Opus.

---

## 3. ПРІОРИТЕЗОВАНИЙ «СПИСОК НА СХУДНЕННЯ»

| # | Що | Дія | Зусилля | Ризик | Тести, що тримають |
|---|---|---|---|---|---|
| 1 | Кластер мертвих меж: `analyzeViaToolUse.js` + `documentBoundary/index.js`(фасад) + `detectBoundariesV2.js` + `createClassifyV2`(з classifyV2.js, лишити `categoryFromBoundaryType`) | **ЗНЕСТИ** (~470 р. + тести) | M | **Низький** (test-only, жоден prod-import) | `detectBoundariesV2.test.js`, `classifyV2.test.js`, `dp2-stages.test.js` |
| 2 | `detectBoundariesV3.js` + `multiFileReconstructor.js` (+ застарілі коментарі «виконавці маршрутів») | **ЗНЕСТИ** (~343 р.) — маршрути реалізовані inline у splitDocumentsV3, тригер «приберегти» не настане в цій формі | M | Низький-**середній** (формально «приберігся»; потрібне підтвердження власника) | `dp3Stages.test.js`, `multiFileReconstructor.test.js` |
| 3 | `createIntakeWithUnpack` + `isSidecarFile` + `parseSidecarBytes` (sidecar/signature-linking зі `stages/unpack.js`); ЖИВІ предикати → винести в `archiveCore.js` | **ЗНЕСТИ stage, ЗВЕСТИ ядро** (борг #57, тригер спрацював) | M | Низький (фронт-крок re-експортує предикати — single-source) | `unpack.test.js`, частина `dp2-stages.test.js` |
| 4 | `persistStage` дефолт (`documentPipeline.js:208-355`) — тінь, завжди перекрита | **ЗНЕСТИ або лишити stable-default** — рішення власника (архітектурний інваріант диригента) | S-M | **Середній** (30+ unit-тестів ганяють диригента з дефолтом) | `documentPipeline.test.js` |
| 5 | `AGENT_USAGE_LABELS` рядки `imageSorter`/`imageDocumentGrouper` (`callAgent.js:50-51`) — стуб для callAgent, якого фото не використовує | **ЛИШИТИ до B2** (стануть живими при міграції фото-агентів на callAgent) | XS | — | — |
| 6 | `enrichDocumentWithVisionMetadata` / `extractMetadata`-ланцюг (Vision-метадані без OCR) | **ЛИШИТИ (дрімає)** — свідома заготовка власника | — | — | `documentMetadata.test.js` |
| 7 | `onArchiveEntry` гачок | **ЛИШИТИ (дрімає)** — серверний HTML-екстрактор | — | — | `unpackArchivesFrontStep.test.js` |
| 8 | Дві системи прогресу (#38) | **ЛИШИТИ, звести при «комбо»-TASK** | L | — | — |
| 9 | `MODEL_PRICING` (#44) | **ОНОВИТИ дані** (не код-схуднення) — окремий фікс | XS | — | — |

**Сумарний потенціал чистого видалення (пп.1-3):** ≈ **800-900 рядків** prod-коду + ~6 тест-файлів,
з низьким ризиком — усе test-only на live-шляхах, доведено grep'ом.

---

## 4. ЩО ДОДАНО В tracking_debt.md

Дописано (append-only, не чіпаючи наявні записи) рядки-кандидати на видалення з тригером:
- **#67** — кластер мертвих меж (analyzeViaToolUse + facade index.js + detectBoundariesV2 + createClassifyV2).
- **#68** — detectBoundariesV3 + multiFileReconstructor (маршрути вже inline).
- **#69** — persistStage тінь-дефолт (рішення власника про stable-default диригента).
- **#70** — AGENT_USAGE_LABELS стуб imageSorter/imageDocumentGrouper (тригер B2).

Існуючі #57 (intake-unpack/sidecar), #62 (toolUseRunner ai_usage), #66 (стара лінія меж — закрита
вироком вище), #38, #44 — **не змінювались**; цей звіт виносить по них вирок, тригери в них уже були.

---

**Кінець — audit_dp_leanness_inventory.md**
