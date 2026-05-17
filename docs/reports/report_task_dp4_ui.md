# Звіт — TASK DP-4: UI Document Processor v2 (4 зони, фонова обробка, ECITS UI)

**Дата:** 17.05.2026
**Гілка розробки:** `claude/new-session-OyDXi`
**Тип:** Великий UI TASK (активація streaming-інфраструктури DP-3 + повний UI DP v2 + швидкі функції + ECITS 3 точки + Custom Splitter toggle).
**Статус:** виконано, чекає підтвердження адвоката на push у `main` (CLAUDE.md правило #1 — код-зміна).

---

## 1. Baseline зафіксований (фактичний прогін ДО будь-якої зміни)

`npm install` → потім baseline на незмінному коді гілки (числа з виводу):

| Метрика | Baseline (до DP-4) | Після DP-4 |
|---|---|---|
| `npm test` — Test Files | **86 passed (86)** | **90 passed (90)** |
| `npm test` — Tests | **1235 passed (1235)** | **1247 passed (1247)** |
| `npm run build` | **✓ зелений** (пре-існуючі chunk-size warnings) | **✓ зелений** (ті самі warnings) |

+4 тест-файли, +12 тестів, **нуль регресій** — acceptance §9 виконано.

---

## 2. Дослідження — на чому базував UI

**Обов'язкове читання (повне, у порядку handoff §1):** `CLAUDE.md`, `DEVELOPMENT_PHILOSOPHY.md`, `docs/reports/report_task_dp1_pipeline.md`, `report_task_dp2_archives_ecits.md`, `report_task_dp3_streaming_reconstruction.md`, `docs/consultations/discussion_dp_v2_philosophy_response.md`, `dossier_architecture_decisions.md`.

**Мокапи/довідники у проектних знаннях — ВІДСУТНІ:** `dossier_ui_mockups.md`, `dp_v2_functionality_reference.md`, `roadmap_full_2026-05-14.md` у репо немає (є лише `dossier_architecture_decisions.md`). Згідно handoff §1 («якщо файлів немає — зафіксуй у звіті і працюй з тим що тут описано») — UI реалізовано **строго за ASCII-мокапами і специфікацією у самому TASK DP-4** (Зони 1-4, перелік 8 перемикачів §274, структура вкладок Зони 3, header Варіант 1 §397, ECITS 3 точки §426-481).

**Код-аудит (фактичний стан):** streamingExecutor/jobProgressStore/jobState/chunkManager/workerClient/drivePort, V3-стадії (detectBoundariesV3/extractV3/confirmBoundaries/splitDocumentsV3), multiFileReconstructor, ecitsInboxWatcher, standaloneCompressor, datasetCollector, ocrService (documentAi `localBlob`), documentPipeline тонкий диригент, UI-бібліотека (`components/UI`), tokens.css, App.jsx/CaseDossier/Dashboard структура.

---

## 3. UI-аудит поточного стану

- **App.jsx (5250 ряд.):** НЕ має React Context Provider'ів (нема `TenantProvider`/`ActionsProvider` з handoff). DI = `createActions(deps)` у тілі (ряд. 4744) + прокидання `executeAction` пропом у Dashboard/CaseDossier/QI. `<JobProgressTopbar/>` слот ряд. 5012. Реєстр справ — inline `filteredCases.map → <CaseCard>` (~5093) у `<div style={{position:'relative'}}>`. Навігація — `tab` state.
- **CaseDossier (3141 ряд.):** вкладки `overview/materials/position/templates` (НЕ існує «Робота з документами»). `materials` = `renderMaterials()` + `AddDocumentModal` (single-file flow). Header ряд. 2548-2585, точка для банера — між header і вкладками. Heavily inline-styled. Drive picker — локальний `DrivePickerSection` усередині AddDocumentModal (НЕ експортований).
- **Dashboard (2705 ряд.):** props `{cases,calendarEvents,onExecuteAction,setAiUsage}`. 3-колонковий inline-layout. Нема ECITS-концепції.
- **`runOcrWithRetryUI`** — локальна функція у CaseDossier (ряд. 792), НЕ сервіс-хелпер.

---

## 4. Дизайн-аудит tokens.css

tokens.css повний (палітра, типографіка, spacing 4-64, радіуси, тіні, z-index). Нові класи **не вимагали нових токенів** — усе через наявні CSS-змінні. Додано лише **класи** (не токени) у двох `.css`:
- `src/components/DocumentProcessorV2/styles.css` — layout 4 зон, drop zone, toggle-групи, прогрес-екран, viewer (тільки `var(--*)`).
- `src/components/ECITSBanner/styles.css` — банер/бейдж реєстру/секція дашборду.

Alpha-кольори (rgba для м'яких фонів warning/accent) — за винятком `dossier_architecture_decisions.md` («Алфа-варіанти rgba поки немає color-mix() — окремий TASK»). Жодного нового `--color-*` без обговорення (правило дотримано). **Нуль inline-стилів** у новому коді.

---

## 5. Структура файлів (нові/модифіковані)

**Нові:**
- `src/contexts/DocumentPipelineContext.jsx` — Provider + `useDocumentPipeline()` + експорт контексту (тест-seam).
- `src/components/DocumentProcessorV2/`: `index.jsx` (оркестратор 4 зон), `styles.css`, `useJobProgress.js`, `ProgressFullScreen.jsx`, `DrivePicker.jsx`, `modals/RecognizeTextModal.jsx`, `modals/CompressFilesModal.jsx`, `modals/InboxConflictModal.jsx`, `modals/CancelDecisionModal.jsx`.
- `src/components/ECITSBanner/`: `index.jsx` (Точка 1), `RegistryBadge.jsx` (Точка 2), `DashboardSection.jsx` (Точка 3), `styles.css`.
- Тести: `tests/unit/DocumentPipelineContext.test.jsx`, `ECITSBanner.test.jsx`, `DocumentProcessorV2.test.jsx`, `tests/integration/dp4-ui.test.jsx`.

**Модифіковані:** `src/App.jsx` (+import, обгортка `<DocumentPipelineProvider>`, ECITS badge у реєстрі, `onOpenCase` у Dashboard), `src/components/CaseDossier/index.jsx` (+import DPv2/ECITSBanner, +вкладка `docwork`, +банер, +`Wrench`), `src/components/Dashboard/index.jsx` (+ECITS секція, +`onOpenCase`), `src/services/tenantService.js` (+`setSplitterDatasetEnabled`).

**Видалено:** нічого. **Диригент `documentPipeline.js`, streaming-інфра DP-3, AddDocumentModal flow, JobProgressTopbar — НЕ редаговані.**

---

## 6. Активація streaming у App.jsx

`DocumentPipelineProvider` тримає інстанс `createStreamingExecutor` (memo) з реальними deps:
- `drivePort=createDefaultDrivePort()`, `workerClient=createWorkerClient({})` (lazy Worker), `createPipeline=createDocumentPipeline`.
- `processChunk` → `ocrService.extractText({localBlob}, {forceProvider:'documentAi'})` (documentAi приймає localBlob — Drive-id чанку не потрібен).
- `buildPipelineDeps(accessors)` → V3 stageOverrides: `detectBoundariesV3({analyzeFile})`, `extractV3({cleanForReading,cleanText})`, `confirmBoundaries({autoConfirm})`, `splitDocumentsV3({uploadFile→01_ОРИГІНАЛИ, persistDocument→executeAction('document_processor_agent','add_documents'), writeText02/writeLayout02→ocrService, datasetCollector (gated getSplitterDatasetEnabled), eventBus/topics})`.
- `getActor` ← tenantService; `deleteDocument` ← executeAction (best-effort відкат).
- **Per-run опції 8 перемикачів** прокидаються через `runOptionsRef` який читає `buildPipelineDeps` — контракт `executor.run(input)` НЕ змінено (інфраструктуру не переробляли).

`ecitsInboxWatcher` створено і `.start()` у `useEffect` (eventBus + `ECITS_DOCUMENTS_RECEIVED/INBOX_PENDING` + `getEcitsAutoProcess` + `runPipeline`→`run` для auto). `jobProgressStore.attachDrivePolling` (loadState ← executor._jobStore). `ECITS_INBOX_PENDING` → React-стан `ecitsPending` (Map caseId→count) для 3 точок UI.

**Інваріант підтверджено:** при монтуванні — нуль сайд-ефектів (executor лише конструюється). Дефолт `ecitsAutoProcess='manual'` → watcher лише лічильники. Без UI-`run()` нічого не обробляється. Baseline тести зелені.

Монтаж у `App.jsx`: `<DocumentPipelineProvider executeAction={executeAction}>` обгортає весь `.app` рендер (executeAction приходить пропом — НЕ імпорт стану; диригент/шар незмінні).

---

## 7. Зона 1 (Вхідна)

Drop zone (HTML drag events) + прихований `<input type=file multiple>` + кнопка «Вибрати файли» + «З Google Drive» (компактний `DrivePicker` — окремий, бо `DrivePickerSection` AddDocumentModal не експортований і behavior-preserve) + список 00_INBOX_СПРАВИ (driveRequest, лише id у q= — правило #8, checkbox'и). Підтримувані формати у hint. Конфлікт INBOX (нові файли + непорожній INBOX) → `InboxConflictModal` 3 варіанти (фірмова Modal, не confirm).

---

## 8. Зона 2 (Налаштування)

8 перемикачів (`Toggle` з UI) у 3 групах + ВЛАСНА МОДЕЛЬ НАРІЗКИ:

| # | Перемикач | Дефолт |
|---|---|---|
|1|Розкласти по провадженнях|ВКЛ|
|2|Перевірка цілісності перед обробкою|ВКЛ|
|3|Очистити для читання (Haiku)|ВКЛ|
|4|Згенерувати короткий зміст|ВКЛ|
|5|Стиснути всі файли пакета|ВИМК|
|6|Запропонувати дедлайни з документів|ВИМК|
|7|Оновити case_context.md|ВКЛ|
|8|Заповнити картку справи з документів|ВИМК|

Оцінка: `~minMin-maxMin хвилин · ~$cost` (1 хв + 0.5-0.9 хв/файл; $0.05/файл). Кнопка «Розпочати обробку N документів» — активна лише при ≥1 файлі, `loading` під час run. Зараз executor реально споживає `cleanForReading` (extractV3), `autoConfirm`, `collectDataset`, `fragmentsCombined`; решта 6 прокидаються у `options` (forward-compatible — споживуть стадії DP-5/6 без зміни UI/диригента).

---

## 9. Зона 3 (Результат) — 3 вкладки (`Tabs` з UI)

- **Дерево:** заглушка-текст (повний інтерактив — DP-6) + плоский список `result.documents` (⭐ ключові, name, category).
- **Нарізка:** документи з типом/pageCount + `[Стиснути]` (відкриває CompressFilesModal) + `[Розділити]`/`[Об'єднати з…]` **disabled з tooltip «DP-6»** (не throwaway-заглушка — чесне «ще не активне»; інтерактивна нарізка явно DP-6 §332) + список `unusedPages` з причинами + нота «Фрагменти зберігаються у 03_ФРАГМЕНТИ».
- **Потребує уваги (badge):** розділ «Питання» (`decisions` типу text_clean_failed/document_split_skipped), розділ «Помилки» (`result.errors`), кнопка «Залишити на потім» коли є помилки. Усе з реальних даних run-результату.

---

## 10. Зона 4 (Прогрес)

`ProgressFullScreen` — overlay з токенів, підписаний на `jobProgressStore` через `useJobProgress` (фільтр по `caseId`). Реальні дані: case info, прогрес-бар, %, ETA (`formatEta`), done/total блоків, стадія, статус. «Згорнути» → `minimized` (топбар DP-3 далі показує). «Скасувати» → `pipeline.cancel()`; коли run повертає `cancelled` → `CancelDecisionModal` («зберегти N / видалити все» → `keepPartial`/`discardAll` готові з DP-3). Замінює DP-3 заглушку-модалку в межах вкладки DP (топбар DP-3 не переробляється — §554).

---

## 11. Швидкі функції (header, Варіант 1)

Кнопки у header поряд з `<Wrench/> Робота з документами`:
- **RecognizeTextModal:** один файл → `ocrService.extractText` (готовий pipeline, без повного DP) → viewer + `[Скопіювати]` `[На пристрій .txt]` `[Зберегти у справу як документ]` (upload .txt у 01_ОРИГІНАЛИ + `add_documents`) `[Закрити]`.
- **CompressFilesModal:** файли → готовий `standaloneCompressor` (DP-3) → цілі: поточна справа 01_ОРИГІНАЛИ / пристрій (реальні), email/messenger — **чесні заглушки DP-3** (`not_implemented`, warning-toast). По-файловий звіт before→after.

---

## 12. ECITS UI — 3 точки

Усі читають `DocumentPipelineContext.ecitsPending` (з `ECITS_INBOX_PENDING`, manual-режим watcher'а); рендеряться лише коли count>0 (нуль hardcoded):
- **Точка 1 — Банер** у CaseDossier між header і вкладками: «В INBOX N нових файлів від Court Sync» + `[Обробити]`/`[Дивитись список]` → вкладка `docwork`.
- **Точка 2 — Бейдж** `[✉ N]` на картці справи в Реєстрі (App.jsx, absolute у `position:relative` обгортці).
- **Точка 3 — Секція** Дашборду «Нові надходження з ЄСІТС» (список справ з INBOX, `[Обробити]` → `onOpenCase` → досьє).

---

## 13. Custom Splitter UI

Toggle «Накопичувати приклади нарізки…» у Зоні 2 (читає `getSplitterDatasetEnabled()`, пише новий `setSplitterDatasetEnabled()`), повний дисклеймер DP-3 §8 (адвокатська таємниця, відповідальність адвоката, без технічної анонімізації). Коли ВКЛ — `datasetCollector` ін'єктується у splitDocumentsV3 (gated). Лічильник — чесна нота (без Drive-читання на кожен рендер; точний `{datasetCount}` потребував би запиту до `_datasets` — свідомо не робимо заради продуктивності, зафіксовано §18).

---

## 14. Responsive поведінка

CSS-only (`@media`, НЕ JS):
- Десктоп/планшет landscape ≥1280px — 4 зони grid 2×2, повний layout.
- ≤1100px (планшет portrait) — зони у одну колонку послідовно.
- ≤480px — header quick-кнопки і banner-actions у повну ширину; UI-бібліотека вже має touch-таргети 44px / Modal 95vw (TASK 9).
Прогрес-екран — `max-width:95vw/90vh`, скрол. Бейдж/банер компактні.

---

## 15. Файли створені/видалені/модифіковані

Створено: 1 контекст, 9 файлів DocumentProcessorV2, 4 файли ECITSBanner, 4 тести (= 18). Модифіковано: 4 (`App.jsx`, `CaseDossier/index.jsx`, `Dashboard/index.jsx`, `tenantService.js`). Видалено: 0. Деталі — §5.

---

## 16. Тести

Baseline 86/1235 → після 90/1247 (+4 файли/+12 тестів, 0 регресій). Нові покривають: provider монтується без сайд-ефектів + повний API + `ECITS_INBOX_PENDING`→`ecitsPending`; 3 точки ECITS render-gating; DPv2 4 зони/8 перемикачів/дисклеймер/Start-gating; **інтеграція UI→pipeline** (вибір файлу → Start → `run(input,options)` з 8 перемикачами → документ у Зоні 3). `ocrService` мокнуто (pdfjs/DOMMatrix у jsdom) — патерн `multiImageToPdf.test.js`.

---

## 17. Відхилення від handoff (експертна автономія)

1. **Нема React Context Provider'ів** (`TenantProvider`/`ActionsProvider` з §4.1/§207 не існують). Резолюція: створено `DocumentPipelineProvider` як вимагає TASK; §8 «DI через React Context, нуль глобальних сінглтонів» дотримано; монтаж — обгорткою `.app` (executeAction пропом). Forced — інша резолюція суперечила б інваріантам.
2. **Нема вкладки «Робота з документами»** — є «Матеріали» (`renderMaterials`+AddDocumentModal, hard behavior-preserve §5). Резолюція: DP v2 — **нова** вкладка `docwork` (Wrench); «Матеріали» недоторкані. «Замінити» → «додати», бо названої поверхні не існує, а наявна — захищений single-file flow.
3. **Drive picker** — `DrivePickerSection` локальний у AddDocumentModal, не експортований; екстракція = редагування захищеного flow. Резолюція: окремий компактний `DrivePicker` (той самий driveRequest-патерн, лише id у q=).
4. **`processChunk`** — стрім-чанк приходить байтами (executor не передає driveId чанку). Резолюція: `ocrService` через `documentAi.localBlob` (підтримується кодом) — production-коректно, без переробки інфри.
5. **AI deps (`analyzeFile`/`cleanText`)** — через `callAPIWithRetry`+`claude_api_key` (патерн CaseDossier); V3-стадії вже трактують їх throw НЕ фатально → ingest не блокується без ключа/мережі (behavior-preserving).
6. **«Розділити/Об'єднати» у Нарізці** — `disabled` з tooltip «DP-6», не клікабельні заглушки (§332 прямо: інтерактивний tree — DP-6). Це чесний стан, не throwaway.

Сумнівних рішень що потребували б зупинки ДО реалізації — відхилення 1-2 мали єдину резолюцію диктовану інваріантами (preserve AddDocumentModal; §8 DI-Context), тому autonomous+документація, а не блок.

---

## 18. Що свідомо лишено для DP-5/DP-6

- **DP-5/6:** інтерактивне Дерево проваджень (ProceedingForm inline, drag-n-drop між провадженнями), реальні «Розділити/Об'єднати» у Нарізці, UI-гейт `confirmBoundaries.autoConfirm:false` (зараз DP-4 auto-confirm — pipeline доходить до результату; повний propose→confirm UI — DP-6).
- 6 з 8 перемикачів (organize/integrity/summary/deadlines/caseContext/caseCard) — прокинуті у `run options`, споживуть стадії DP-5/6 (заклад без переробки UI/диригента).
- Точний `{datasetCount}` лічильник датасету (потребує Drive-читання `_datasets` — продуктивність).
- Навігація «клік на топбар DP-3 → відкрити повний екран тієї справи» — топбар DP-3 не переробляється (§554); повний екран живе у вкладці DP, авто-показ при активному job справи. Глобальна навігація з топбару — окремий мінімальний заклад (опційний `onExpand` проп) лишено DP-5.
- Page-precise text slicing 02_ОБРОБЛЕНІ (успадковано з DP-3 tracking_debt).

---

## 19. Acceptance criteria — статус

| Критерій | Статус |
|---|---|
| streamingExecutor у App через React Context | ✅ DocumentPipelineProvider |
| ecitsInboxWatcher змонтований, слухає eventBus | ✅ |
| JobProgressTopbar показує реальний прогрес | ✅ (DP-3 незмінний, store push) |
| Зона 1 — drop/picker/Drive/INBOX | ✅ |
| Зона 2 — 8 перемикачів+дефолти+оцінка+Розпочати | ✅ |
| Зона 3 — 3 вкладки (Дерево заглушка/Нарізка/Увага×2) | ✅ |
| Зона 4 — повноекранний прогрес ↔ jobProgressStore | ✅ (замінює заглушку в межах DP) |
| Скасування з вибором (зберегти N/видалити все) | ✅ keepPartial/discardAll |
| Швидкі функції — Розпізнати/Стиснути модалки | ✅ (email/messenger = DP-3 stub) |
| ECITS Банер CaseDossier | ✅ |
| ECITS Індикатор Реєстру | ✅ |
| ECITS Секція Дашборду | ✅ |
| Custom Splitter toggle + дисклеймер | ✅ +setSplitterDatasetEnabled |
| CSS токени, нуль inline у новому коді | ✅ |
| Іконки lucide-react, без emoji-іконок | ✅ (⭐ — дозволений смисловий) |
| Responsive (CSS) десктоп/планшет/телефон | ✅ |
| AddDocumentModal без регресій | ✅ (не зачеплено + dp3 integration доказ) |
| Юніт-тести нові компоненти | ✅ 3 файли |
| Інтеграційні тести повний DP flow | ✅ dp4-ui |
| `npm test` ≥ baseline | ✅ 1247 ≥ 1235 |
| `npm run build` зелений | ✅ |
| Звіт | ✅ (цей файл) |
| Зведення показано; push після підтвердження | ⏳ очікує |

---

## 20. tracking_debt — побічні знахідки

- Точний `{datasetCount}` у Splitter UI потребує Drive-читання `_datasets/splitter_training_data.json` на кожен рендер — свідомо не зроблено (продуктивність); кандидат на легкий лічильник через подію `dataset_collected`.
- 6 «майбутніх» перебивачів Зони 2 прокидаються у `run options` як заклад — споживач (стадії DP-5/6) ще немає (як вхідні ЄСІТС-топіки сьогодні).
- Page-precise text slicing — успадкований DP-3 борг, лишається.
- Пре-існуючий debug `console.log` у `executeAction` (DP-2/DP-3 tracking_debt) — поза scope DP-4, не чіпали.

---

## 21. Підтвердження

- **Нуль inline-стилів** у новому коді — усе через класи з tokens.css (CaseDossier/Dashboard inline-стилі — їх власна спадщина, окремий Mobile-First TASK; банер/badge вставлені className-компонентами).
- **Нуль emoji-іконок** — усі дії lucide-react; `⭐` лишається дозволеним смисловим маркером (icons.js стандарт).
- **Behavior-preserving AddDocumentModal:** так — вкладка «Матеріали» і `onSubmit` flow не зачеплені жодним рядком; DP v2 — окрема вкладка.
- **Диригент `documentPipeline.js` незмінний:** так — лише `deps.stageOverrides` через існуючий `buildPipelineDeps`-seam DP-3; 9 frozen стадій недоторкані.
- **executeAction незмінний:** так — персистенція виключно через `executeAction('document_processor_agent','add_documents')`; нічого повз шар.
- **Streaming infrastructure НЕ переробляється:** так — DP-3 модулі (executor/jobState/chunkManager/worker/drivePort/V3-стадії/jobProgressStore/JobProgressTopbar) не редаговані; DP-4 лише **монтує** через Context і дає UI.
