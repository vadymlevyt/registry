# Звіт — TASK 4: спільний інгест + DrivePicker + «просто додати» + без-OCR

**Спека:** `docs/tasks/TASK_4_ingest_drivepicker_unify.md`
**Гілка:** `claude/task-4-ingest-drivepicker-Nv5S3`
**Статус:** у роботі (по етапах, з 🔹-паузами на ревʼю власника)

---

## Чек-ліст етапів

- [x] **A — `ingest.js` (труба в одну).** Фасад `ingestFiles(input, options)` поверх Context-`run`; DP переведено на нього (behavior-preserving). 🔹 _(зведено в main)_
- [x] **B — винос DrivePicker** з `AddDocumentModal.jsx` → `components/DrivePicker/` (behavior-preserving). _(зведено в main)_
- [x] **B2 — злиття пікерів** (`DocumentProcessorV2/DrivePicker.jsx` → спільний; старий файл видалено). 🔹
- [x] **C — DP «просто додати» на всі типи + комбо; усунення дубль-шляху CaseDossier; Vision-фолбек збережено.** 🔹
- [x] **D — `ocrMode` + «без OCR»** (Vision 2 стор. → метадані). 🔹
- [x] **E — стиснення: реальний downscale-рушій зі стенда + дротування + тумблери + прогноз.** 🔹 _(ця сесія — чекає на ревʼю)_

---

## Етап A — `ingest.js` (труба в одну)

**Зроблено:**
- Новий `src/services/documentPipeline/ingest.js` — чиста фабрика `createIngest({ runPipeline }) → { ingestFiles }`. Тонкий оркестратор: нормалізує вхід, валідує (`NO_FILES` на порожньому), застосовує дефолти `ocrMode:'full'` / `compress:false` і делегує у `runPipeline(input, options)`. Жодної бізнес-логіки OCR/нарізки — лише дротування.
- `DocumentPipelineContext.jsx` — вмонтовано `ingest` поверх того самого `run` (Context-обгортка над `executor.run`, що вже прокидає options у `runOptionsRef → buildPipelineDeps`). `ingestFiles` доданий у value хука `useDocumentPipeline()`.
- `DocumentProcessorV2/index.jsx` — `pipeline.run(input, options)` → `pipeline.ingestFiles(input, options)`. Опції ідентичні; `ocrMode`/`compress` дефолтяться у ingest і **інертні** (споживачі — D/E) → поведінка байт-у-байт та сама.

**Чому так (behavior-preserving):** `ocrMode`/`compress` поки лише присутні в опціях прогону, але `streamingExecutor`/`buildPipelineDeps` їх не читають. DP image-merge під-флоу (обходить `pipeline.run`) — **не зачеплено**.

**НЕ робив на етапі A** (свідомо, поза вузьким скоупом «DP переведено»): міграція модалки `AddDocumentModal` на ingest і видалення `runOcrWithRetryUI`. Стрім-шлях зараз тільки Document AI; пост-OCR retry + Claude Vision діалог потребують окремого рішення власника (винесено на наступні етапи / окрему паузу).

**Білінг:** не зачеплено — інструментація лишається у незмінному `streamingExecutor`/`buildPipelineDeps`. (Перенесення `runOcrWithRetryUI` з його `activityTracker`/`logAiUsage` — коли мігруватимемо модалку.)

**Тести:**
- Новий `tests/unit/ingest.test.js` (5): кидок без `runPipeline`; `NO_FILES` без виклику конвеєра; делегування + дефолти `full`/`false`; прокидання pipeline-налаштувань + явних `ocrMode`/`compress`; результат повертається без обгортання.
- Оновлено: `tests/unit/DocumentPipelineContext.test.jsx` (API містить `ingestFiles`), `tests/unit/DocumentProcessorV2.test.jsx` (ctx-мок), `tests/integration/dp4-ui*.test.jsx` ×3 (DP кличе `ingestFiles`).
- `npm test` — **1942 passed**. `npm run build` — **success**.

**schemaVersion:** без змін (етап A не торкається структур даних).

---

## Етап B — винос DrivePicker

**Зроблено:** inline DrivePicker-сімейство (~550 рядків) винесено зі `AddDocumentModal.jsx` у нову теку `src/components/DrivePicker/`:
- `index.jsx` (`DrivePickerSection` — оркестратор browse/breadcrumb/3 джерела), `SourceSwitcher.jsx`, `Breadcrumb.jsx`, `DriveList.jsx`, `DriveListItem.jsx`, `helpers.js` (`FOLDER_MIME`/`PAGE_LIMIT`/`filterForSelectionMode`/`multiPlural`), `styles.css`.
- CSS-блок drive-* перенесено зі `AddDocumentModal.css` у `DrivePicker/styles.css` **з тими самими іменами класів** (behavior-preserving; нейтралізація імен — на B2 при злитті).
- `AddDocumentModal.jsx` 1040 → **478 рядків**: лишилися лише модальні `StartButton`/`stripExtension`/`FileUploadZone` + сам компонент; обидва місця, де модалка вживає пікер (single-форма і merge-mode), тепер дротують імпортований `DrivePickerSection`. Прибрано осиротілі імпорти (`driveRequest`, `useCallback`, 7 lucide-іконок) і константи.

**Поведінка:** ідентична — той самий компонент, ті самі класи, ті самі пропси (`selectionMode` single/multi-images).

**Тести:** новий `tests/unit/DrivePicker.test.jsx` (4: browse/single-pick/multi-images select+confirm/closed); наявні `AddDocumentModal.test.jsx` Drive-visibility — зелені без змін (перевіряють пікер крізь модалку). `npm test` — **1946 passed**; `npm run build` — **success**.

**Дубль-шлях CaseDossier (нагадування власника):** міграцію `CaseDossier` `pipeline.run` (≈2764) + `runOcrWithRetryUI` на `ingestFiles` роблю на **етапі C** — там зʼявляється семантика «додати як є» (add_as_is/skipPdfSlicing), яка потрібна модалці (один документ без нарізки), і там же розберу долю Claude Vision-фолбеку (стрім-шлях зараз лише Document AI).

## Етап B2 — злиття пікерів (один спільний `DrivePicker`)

**Зроблено** (підхід зі спеки: спільне ядро = обʼєднання можливостей; presentation/multiFilter пропи):
- Друга копія `DocumentProcessorV2/DrivePicker.jsx` (148 рядків) **видалена**; DP тепер споживає той самий `components/DrivePicker/`.
- Єдиний `DrivePicker({ presentation, selectionMode, multiFilter, sources, onPick, onPickMulti, … })`:
  - `presentation: 'inline' | 'modal'` — тонка оболонка над спільним ядром (модалка→`inline` із toggle-секцією; DP→`modal` через `Modal` з Скасувати/Обрати у футері).
  - `selectionMode: 'single' | 'multi'` + `multiFilter: 'images' | 'all'` — розділено колишній хардкод `multi-images` (правило #11: `selectionMode`=скільки, `multiFilter`=які файли). Модалка-склейка → `multi/images`; DP → `multi/all`.
  - `sources` — обидва пікери дістають **усі 3 джерела** (Мій Drive / Поділилися / Спільні) + breadcrumb-навігацію (DP підвищився: був лише stack по Моєму Drive).
- Ядро віддає **сирі** Drive-обʼєкти (`{id,name,mimeType,size}`); споживач мапить сам. DP `addDriveFiles` адаптовано (raw→внутрішня форма `selected[]`), толерантно до обох форм. `ImageMergePanel.addDriveFiles` уже читає raw — без змін.
- `DrivePickerSection` лишено як inline-пресет-аліас (зворотна сумісність імпорту модалки).

**Поведінка:** модалка — без змін; DP — той самий результат вибору (мультивибір будь-яких файлів), плюс bonus breadcrumb/джерела.

**Тести:** `DrivePicker.test.jsx` розширено (multi/images, multi/all з сирими обʼєктами, presentation=modal діалог); `DocumentProcessorV2`/`AddDocumentModal` зелені. `npm test` — **1948 passed**; build — **success**.

**Борг (нотатка):** CSS-класи лишилися `add-document-modal__drive-*` (працюють в обох оболонках). Нейтралізація імен на `drive-picker__*` — косметика, винесено у `tracking_debt` (не блокує, не вимагалось B2).

## Етап C — «просто додати» на всі типи + одна труба (усунення дубль-шляху)

**Суть:** додано non-streaming труби `add_as_is` (кожен файл = один документ, без
нарізки, усі типи + будь-яка комбінація), і модалка `+ Додати документ` переведена
з власного `createDocumentPipeline` на спільний `ingestFiles` (C4 — дубль-шлях
усунено). all-PDF «просто додати» лишається на стрім-шляху — behavior-preserve.

**Маршрутизація труби (`ingest.js`, `INGEST_MODE`):**
- `mode:'slice'` (default) → `runPipeline` (streamingExecutor + AI Triage) — як було.
- `mode:'add_as_is'` → `runAddAsIs` (non-streaming per-file). `mode` маршрутизує і
  **НЕ тече далі** в опції прогону. Виклик add_as_is без `runAddAsIs` — кидає
  (не тихо в slice).

**`runAddAsIs` (DocumentPipelineContext):** non-streaming труба поверх спільного
диригента `createDocumentPipeline` (convert→detect(passthrough)→…→persist→emit).
Обробляє всі типи через `converterService` (HTML/DOCX→searchable PDF, фото→
imageToPdf, PDF→passthrough) і будь-яку комбінацію (диригент циклить per file).
DI-шви (модаль ін'єктує своє, DP лишає дефолт):
- `buildDocumentMetadata` — дефолт `defaultAddAsIsMetadata` (ім'я з файлу, nature
  виводиться, category/author/procId=null → маркер «потребує перегляду»). Модаль
  передає форму-білдер адвоката.
- `uploadFile` — дефолт `uploadToOriginals`; модаль передає `uploadFileLocal`
  (verify/ensureSubFolders — точна поведінка).
- `persistDocument` — дефолт `document_processor_agent/add_documents` (той самий
  шлях що стрім); модаль передає `dossier_agent/add_document` + updateCase-fallback.
- `deferOcr` — модаль ставить `true` (робить власний пост-OCR з Vision); DP лишає
  дефолтний `ocrEnrichAddAsIs`.

**DP «просто додати» (DocumentProcessorV2):** тумблер `skipPdfSlicing` («Просто
додати файли») — РОЗШИРЕНО наявний УВІМК-шлях (правило #11, не новий перемикач):
- all-image + toggle OFF → image-merge editor (склейка авто) — як було.
- toggle ON + будь-який НЕ-PDF / комбо → `add_as_is` (новий `buildAddAsIsInput`:
  матеріалізує device/Drive/INBOX у `File`; фото проходять `downscaleImage` ≤2400px
  перед конвертацією). Кожен файл = один документ.
- toggle ON + all-PDF → стрім-шлях (triage пропускає нарізку) — behavior-preserve.
- toggle OFF + мікс фото+PDF → toast підказує увімкнути «Просто додати» (раніше
  глухий reject; нарізка-мікс далі поза scope).

**Дубль-шлях CaseDossier (C4):** `CaseDossier/index.jsx` модаль `onSubmit` більше
НЕ будує приватний `createDocumentPipeline` — кличе `docPipeline.ingestFiles(input,
{ mode:'add_as_is', deferOcr:true, buildDocumentMetadata, uploadFile, persistDocument })`.
Імпорти `createDocumentPipeline`/`convertToPdf`/`getCurrentUser`/`DOCUMENT_INGESTED`
прибрано (мертві після міграції). Пост-OCR блок (гілки А/Б/В + `runOcrWithRetryUI`)
лишився в модалці незмінним. `runOcrWithRetryUI` (зокрема reprocess-кнопка
~2326) — НЕ чіпали (інший шов).

**Claude Vision-фолбек (засторога спеки):** ЗБЕРЕЖЕНО, не втрачено тихо.
- Модаль: `deferOcr:true` → `runAddAsIs` не OCR-ить сам; модаль робить власний
  пост-OCR через `runOcrWithRetryUI` з повним Vision-діалогом (NETWORK exhausted →
  systemConfirm → forceProvider:'claudeVision'). Resilience не змінилась.
- DP «просто додати»: `ocrEnrichAddAsIs` — best-effort Document AI (каскад
  pdfjsLocal→documentAi; searchable дешево через pdfjsLocal, не Document AI). Це
  **паритет з поточним стрім-«просто додати»**, який теж лише Document AI (Vision
  у стрім-шляху ніколи не було). Vision доступний пізніше через в'ювер
  «Розпізнати». Свідомо без Vision у DP-батчі (немає інтерактивного діалогу).

**Білінг:** не загублено. Конвертація інструментується у `converterService`
(`document_converted`) — одна точка, спільна. OCR: Document AI — не Anthropic-виклик
(`ai_usage` не застосовний); Claude Vision у модалці логує `ai_usage` всередині
`claudeVision`/ocrService (незмінено). `add_documents`/`add_document` проходять
через `executeAction` (audit/billing/permissions на місці).

**`.txt` / searchable:** у C поведінку не міняли (як етап A). Повна відмова від
`.txt` (наскрізна вимога спеки §7.1) винесена в окремий фоллов-ап — див. розділ
нижче.

**Межі (свідомо НЕ робив у C):** `ocrMode='none'`/Vision-метадані — етап D;
стиснення — етап E; нейтралізація CSS-класів пікера — borg; `.txt`-removal —
окремо. add_as_is комбо: збій конвертації одного файла зупиняє батч (single-file
семантика `createDocumentPipeline`; batch-continue — розширення поза C).

**Тести (нові/оновлені):**
- `tests/unit/ingest.test.js` (+3): маршрутизація mode add_as_is→runAddAsIs;
  slice(дефолт)→runPipeline; add_as_is без runAddAsIs кидає; `mode` не тече далі.
- `tests/unit/runAddAsIs.test.jsx` (новий, 2): persist через
  document_processor_agent/add_documents + дефолтні канонічні метадані
  (name/nature/folder/source); deferOcr пропускає OCR; комбо → N документів.
- `tests/integration/dp4-add-as-is.test.jsx` (новий, 2): toggle ON + DOCX →
  ingestFiles{mode:add_as_is} з raw-файлом + module/conversionContext; toggle ON +
  all-PDF → стрім-шлях (mode не виставляється).
- `npm test` — **1955 passed**; `npm run build` — **success**.

**schemaVersion:** без змін (C не торкається структур даних).

## Фоллов-ап — повна відмова від `.txt` (закриття §7.1)

**Принцип:** `.txt` — мертвий дубль. Прибрано **повністю** (і запис, і читання),
без legacy-милиць і перехідних етапів. Два типи документів — два джерела
ВІРНОГО тексту:
- **scanned** → `layout` (`page._text` із `.layout.json`);
- **searchable** → **текстовий шар самого PDF** на вимогу через нову
  `extractTextLayer` (pdfjsLocal, БЕЗ OCR / Document AI). DOC/HTML конвертуються
  у searchable PDF через `pdfLibHtmlRenderer` (`pdf-lib` `drawText` — реальний
  текстовий шар), тож текст живе в PDF — `.txt` зайвий.

**Точка верифікації (звірено з кодом):** `htmlToPdf`/`docxToPdf` →
`htmlToPdfViaPdfLib` (`pdf-lib` `page.drawText`) → searchable PDF з текстовим
шаром. `pdfjsLocal.extract` дістає цей шар. Жоден споживач не залежить від
фізичного `.txt`.

**Читання (`src/services/ocrService.js`):**
- Нова приватна `extractTextLayer(file)` — текст із текстового шару PDF за
  driveId (mimeType форсовано `application/pdf`), нічого не пише.
- `getDocumentText(doc, caseData)` — gating по `documentNature`: `scanned` →
  лише `layout` (скан без layout → `''`, нічого не лишаємо); `searchable` →
  `extractTextLayer`; невідома природа → layout, інакше текстовий шар.
- `getCleanOrRawText(file)` — digest `.md` → layout → `extractTextLayer`
  (`.txt` як джерело прибрано).
- `extractText` — прибрано `.txt`-кеш (і читання, і запис); `cacheWritten`
  завжди `false`; scanned кешується лише у `.layout.json`.
- Видалено мертвий `.txt`-машинерій: `checkCache`, `getCachedText`,
  `writeExtractedTextArtifact`, `archiveRawTxt`, `findOrCreateSubfolder`,
  `textCacheFileName`.

**Запис (усі точки додавання — `.txt` прибрано):**
- `DocumentPipelineContext`: `ocrEnrichAddAsIs` DOCX/HTML-гілка → early-return
  без запису; `writeText02`-dep більше НЕ ін'єктується (`splitDocumentsV3` гард
  `typeof writeText02==='function'` → no-op). scanned далі пише `layout`
  (`writeLayout02`) — не чіпали.
- `CaseDossier` модаль (гілка А DOCX/HTML): прибрано `.txt`-запис; layout
  фото-склейки лишається.
- `DocumentProcessorV2` image-merge: прибрано `.txt`-запис; layout лишається.
- Хибний warning «не вдалось зберегти кеш» на «Розпізнати» прибрано (searchable
  → текст у PDF, не збій кеша).

**Старі скани лише з `.txt` без layout:** для них свідомо нічого не лишаємо —
`getDocumentText` поверне `''`, адвокат перевидалить/додасть (як домовлено).
Старі `.txt`-файли на Drive не видаляються кодом (поза скоупом), але повністю
ігноруються логікою. Окрему перевірку наявних таких сканів виконати по даних
Drive (registry_data.json) не можна з пісочниці — перевіряється на місці.

**Тести:**
- `tests/unit/getDocumentText.test.js` — переписано: searchable → текстовий шар
  (`extractTextLayer`); старий `.txt` без layout/шару → `''`/`null` (`.txt` НЕ
  джерело); pdfjsLocal-мок керований.
- `tests/unit/ocrService.test.js` — `extractText`: searchable → нічого не
  пишемо (було «тільки .txt»); claudeVision без pageStructure → без `.txt`;
  блок `writeExtractedTextArtifact` видалено.
- `npm test` — **1952 passed (156 files)**; `npm run build` — **success**.

## Етап D — `ocrMode` + «без OCR» (Vision-метадані)

**Суть:** режим «без OCR» (`ocrMode:'none'`) у шляху ДОДАВАННЯ (`add_as_is` /
модалка single-add). Файл лягає ТІЛЬКИ в `01_ОРИГІНАЛИ`, артефактів у `02` НЕ
створюється; Claude Vision читає перші 1-2 сторінки → ПРОПОНУЄ метадані
(`date/category/author/name` + `gist`); рендер у в'ювері; повне «Розпізнати» —
пізніше у в'ювері. До НАРІЗКИ (`slice`) НЕ застосовується — там OCR обов'язковий
для меж.

**Реалізація (переюз, не дублювання):**
- `modelResolver.SYSTEM_DEFAULTS.metadataExtractor` → Haiku 4.5 (зір; cheap-
  before-expensive). Точка ієрархії user→tenant→system як `textCleaner`/`textDigest`.
- `ocr/claudeVision.js` ПЕРЕЮЗАНО: render+виклик винесено у спільний
  `renderFileToImages(file, options, maxPages)` (повний OCR — без ліміту; «без
  OCR» — `maxPages=2`). Новий метод `extractMetadata` поверх НАЯВНОЇ інфри
  виклику/білінгу (НЕ заводимо ще один прямий fetch — борг #55 не роздуваємо).
  Промт + парсинг — чистий модуль `ocr/visionMetadataParse.js`
  (`METADATA_PROMPT`/`parseMetadataJson`, depth-counter, нормалізація enum/
  порожніх → null), щоб тестувати без pdfjs/DOM.
- `ocrService.extractMetadata` (фасад) + `ocrService.canVisionMetadata` (гард
  PDF/image; XLSX/PPTX → нема що читати).
- Спільний оркестратор `src/services/documentMetadata.js`
  `enrichDocumentWithVisionMetadata({...})` — extract → apply. **ОДИН код для
  модалки і DP** (правило #11). Пропозиції лише у ПОРОЖНІ канонічні поля
  (не затираємо адвоката); `name` — лише якщо `namingStatus:'auto'`; `gist` →
  extended `extractedTextSummary`. **НЕ ставить `lastOcrAt`** (повного OCR не
  було — критично для виводу рівня OCR, див. schema нижче). DI-шви
  (`extractMetadata`/`setExtended`) для юніт-тесту без мережі/Drive. Best-effort.

**Маршрутизація `ocrMode`:**
- Розетка з етапу A: `ingest.js` `OCR_MODE = {FULL,NONE}`; `ingestFiles` прокидає
  `ocrMode` у прогін (вже було, тепер споживається).
- **DP «просто додати»** (`DocumentProcessorV2`): новий тумблер «Без розпізнавання
  тексту» (`skipOcr`) поряд з «Просто додати файли», `disabled` поки `skipPdfSlicing`
  OFF (дійсний ЛИШЕ у `add_as_is` — нарізка завжди з повним OCR). `startProcessing`
  виставляє `options.ocrMode:'none'` лише коли `useAddAsIs && skipOcr`.
  `runAddAsIs` (deferOcr=false) пост-persist: `ocrMode==='none'` →
  `metadataEnrichAddAsIs` (Vision-метадані, без 02), інакше → `ocrEnrichAddAsIs`
  (повний OCR — як було).
- **Модалка single-add** (`AddDocumentModal` + `CaseDossier.onSubmit`): тумблер
  «Без розпізнавання тексту» → payload `ocrMode`. `ingestFiles({mode:'add_as_is',
  ocrMode, deferOcr:true})` — runAddAsIs не OCR-ить (deferOcr), модалка робить
  власний пост-крок: `ocrMode==='none'` → той самий `enrichDocumentWithVisionMetadata`
  (gilki А/Б/В + `runOcrWithRetryUI` пропускаються); інакше — повний OCR з
  Vision-фолбеком (як було).

**Білінг (не загублено):** `claudeVision.extractMetadata` логує `ai_usage`
(agentType `metadata_extractor`, дешевий Vision 1-2 стор., `max_tokens:1024`) +
`activityTracker.report('agent_call', kind:'metadata_vision')` — той самий шов що
повний OCR. Метадані пишуться через `update_document` (executeAction →
audit/billing/permissions); `gist` через `documentsExtended`.

**Межі D (свідомо НЕ робив):** позначення «том» (#52) — окремо; нарізка/повторний
повний OCR доданого «без OCR» — шов «Розпізнати» у в'ювері вже є (Фаза 5 — екран
нарізки наявного); E (стиснення) — наступний етап.

**Тести (нові/оновлені):**
- `tests/unit/visionMetadata.test.js` (5): `parseMetadataJson` — валідний JSON;
  JSON в обгортці (depth-counter); невалідний enum→null; "null"/порожні→null;
  сміття→усі null.
- `tests/unit/documentMetadata.test.js` (6): заповнює лише порожні поля + name(auto)
  + gist→extended, **НІКОЛИ lastOcrAt**; не затирає задане адвокатом; частковий
  fill; XLSX→`unsupported` (нічого не кличе); збій extract→best-effort `ok:false`;
  no_target. **Нічого в 02 не пише** (функція не має такої спроможності — лише
  `update_document`+`setExtended`).
- `tests/integration/dp4-add-as-is.test.jsx` (+1): toggle «Просто додати» + «без
  OCR» + DOCX → `options.ocrMode:'none'`.
- `npm test` — **1964 passed (158 files)**; `npm run build` — **success**.

## schemaVersion / міграція (рішення етапу D)

**РІШЕННЯ: без bump (лишаємось v11).** Маркер рівня OCR окремим полем
(`ocrLevel:'none'|'full'`) **НЕ заводимо** — рівень OCR **виводиться з наявних
даних**:
- метадані «без OCR» лягають у НАЯВНІ канонічні поля (`date/category/author/name`)
  + extended `extractedTextSummary` (gist) — без нової структури;
- «не розпізнано повністю» однозначно виводиться: `documentNature:'scanned'` +
  відсутній `.layout` у `02` + `lastOcrAt==null`. Тому Vision-метадані **свідомо
  НЕ ставлять `lastOcrAt`** (його ставить лише повний OCR) і **не пишуть нічого в
  `02`** — стан лишається «потребує повного OCR», в'ювер пропонує «Розпізнати»;
- searchable (DOCX/HTML/текстовий PDF) текст і так дістається з текстового шару
  PDF на вимогу (`getDocumentText`/`extractTextLayer`, фоллов-ап §7.1) — для них
  поняття «без OCR» не змінює доступність тексту.

Додавати поле = розширення схеми без потреби (порушення принципу мінімалізму +
правило #11: окреме поле мусило б нести єдиний сенс, якого тут нема — він
повністю покривається наявними сигналами). Якщо згодом знадобиться **UI-бейдж**
«лише метадані / без OCR» у реєстрі (§7.3 DocumentList — поза D), це кандидат на
v12 разом із позначенням «том» (#52); зафіксовано як відкладене, не зроблено тихо.

Фоллов-ап `.txt` — без зміни схеми (метадані не торкаються).

## Борг #54 — оцінка (Vision у трубі)

#54 пропонує підняти Claude Vision-**фолбек** у спільний шлях і прибрати
`runOcrWithRetryUI`. **Оцінка на D: лишаємо #54 ВІДКРИТИМ — поза scope D.**

D завів у трубу Vision **як окремий продукт** (метадані «без OCR»,
`extractMetadata`), а НЕ як фолбек повного OCR. Це різні наміри (правило #11):
- `extractMetadata` — 1-2 стор., JSON-метадані, модель `metadataExtractor`, БЕЗ
  тексту/layout/02;
- Vision-**фолбек** (`runOcrWithRetryUI`) — ПОВНИЙ OCR-текст усіх сторінок з
  resume (`startPage`) після вичерпання `documentAi`, інтерактивний `systemConfirm`
  («дорожче/повільніше — продовжити?»), запис layout у 02.

Підняти фолбек у стрім/`add_as_is`-шлях без втрати поведінки нетривіально:
інтерактивний діалог згоди — модаль-специфічний UX; стрім-батч (DP) інтерактиву
не має. Тобто D **не дає** дешевого способу прибрати `runOcrWithRetryUI` —
зробити це акуратно = окремий рефактор OCR-провайдера (узгоджується з #55
«agent-runner unify», де call-sites зводяться під `callAgent`). **Бонус від D
для #54:** `renderFileToImages` тепер спільний → майбутній уніфікований Vision-
шлях має готову render-цеглину. Поточний паритет прийнятний; запис #54 уточнено
(не закрито).

## Етап E — стиснення (реальний downscale-рушій)

**🚨 Головний ризик уникнено:** прикручено **реальний рушій зі стенда**
(`processFile`: render→JPEG→pdf-lib-перебудова), **НЕ** `compressionService.compressPdf`
(слабкий re-save 1-2%). Останній лишився недоторканим (legacy worker-op
`pipelineWorker.OPS.compressPdf` ніким не кликаний — орфан, занотовано як борг),
але **жодна функція стиснення для адвоката через нього більше не йде**.

**Зроблено (5 кроків спеки):**

1. **Рушій → спільний параметричний сервіс.** Новий
   `src/services/compression/imageCompressor.js` — `processFile` перенесено
   **байт-у-байт** (рендер кожної стор. через pdf.js → canvas нормалізовано по
   стелі пікселів довгої сторони → JPEG `toBlob` → pdf-lib `embedJpg`+`addPage`+
   `drawImage` → `save({useObjectStreams})`). Єдина адаптація: CDN-бібліотеки
   стенда → npm `pdfjs-dist`+`pdf-lib` (pdfjs **lazy-import** — top-level тягне
   DOMMatrix, недоступний у Node-тестах; той самий module-singleton, що App.jsx,
   worker уже налаштований). Константа `COMPRESSION_PRESETS` = Слабкий 2200/0.8 ·
   **Середній 1800/0.7 (стандарт, дефолт)** · Сильний 1600/0.65. `standaloneCompressor`
   і `CompressFilesModal` переведено на цей рушій (через DI `compressEngine` —
   тестованість у Node; дефолт = реальний `compressPdfBuffer`); слабкий
   `compressPdf` як «стиснення» прибрано.
2. **scanned-guard + pass-through (одна детекція).** `isCompressibleNature()` —
   file-level guard (детермінований, дзеркало `documentNature`/`detectDocumentNature`);
   `compressPdfBuffer` має вшитий deep-guard по 1-й стор. (текст <50 симв. →
   scanned; той самий поріг що `detectNatureFromPdf`). Searchable PDF / не-PDF →
   **pass-through** (`skipped:true`, bytes = вхід незмінним). Пайплайн НЕ падає.
   Чесні тости/підписи: `CompressFilesModal` («стискаються лише скановані PDF…»,
   рядок звіту «текстовий — не стиснуто»), описи тумблерів DP і модалки.
3. **Дротування `compress` у трубі (фіксований Середній).**
   - **Streaming (slice):** `streamingExecutor.run` стискає `ab` **ПЕРЕД** uploadу
     в `_temp`/нарізкою — інжекти `compressBuffer`/`shouldCompress` з Context.
     **pdf-lib-перебудова критична (§3.2):** кожна стор. дістає власні ресурси →
     `copyPages` ріже пропорційно; без цього чанк ≈ весь файл → Document AI >40 МБ.
     Стиснення на вході існує і ДЛЯ ТОГО, щоб потім нарізалось. Best-effort: збій
     рушія НЕ валить обробку (оригінал іде далі), діаг-логи `compressed`/
     `compress_skipped`/`compress_error`.
   - **add_as_is:** `runAddAsIs` обгортає `uploadFile` хелпером `maybeCompressFile`
     (ЄДИНА точка — стискаємо файл перед завантаженням; DOCX-оригінал поряд і
     текстові PDF проходять як є через guard). Best-effort.
4. **Тумблери «стиснути».** DP `settings.compressAll` (~54/909) під'єднано →
   `compress: settings.compressAll === true` у опціях `ingestFiles`. Модалка
   single-add — новий тумблер «Стиснути перед додаванням» (state `compress`) →
   `compress` у payload → CaseDossier прокидає в `ingestFiles`. Обидва лише
   виставляють `compress:true` (труба спільна). Батч-рівень.
5. **Прогноз розміру.** `estimateCompressedSize()` стискає **семпл перших 1-2
   стор.** → екстраполяція × `pageCount` (×1.02 структурний оверхед). У DP-списку
   коли тумблер УВІМК: «→ ~X МБ» поряд з поточним розміром (device-PDF; Drive-source
   нема блоба → борг #40) + сума пакета «Орієнтовно після стиснення: ~X (зараз Y)».
   Оцінка з «~». Browser-only (canvas) — best-effort, у тесті без canvas тихо без
   естимату.

**Білінг:** стиснення — CPU-операція в браузері, без Anthropic/Document AI → НЕ
білиться (`ai_usage` не пишемо). Білиться вже сам OCR-крок (як і раніше).

**Дані/архітектура:** документи лише через `createDocument`; дані через
`executeAction`; pdf-lib (НЕ jsPDF); `.txt` НЕ відроджено. Рушій ОДИН (Rule of
Three): standalone + DP-slice + DP/модалка-add_as_is тягнуть з
`compression/imageCompressor.js`, без дублів.

**Тести (зелені):** `tests/unit/imageCompressor.test.js` (пресети/resolvePreset/
scanned-guard — 12), `standaloneCompressor.test.js` оновлено (DI-стаб рушія, +
searchable pass-through), `streamingExecutor.test.js` (+3: compress кличеться/НЕ
кличеться/збій best-effort), `ingest.test.js` (compress прокидання — без змін, уже
покривало). Повний прогон **1985 passed**; `npm run build` — success. Реальний
обсяг стиснення тести не ловлять (canvas браузерний) — фінальна перевірка адвоката
на пристрої.

**Межі E (НЕ зроблено, занотовано):** вкладка «Інструменти» з UI-пікером 3
пресетів (§7.4 — лише UI поверх готового параметричного рушія); одиночне
зображення→PDF (`converter/imageToPdf` 0.92, без downscale — прогалина);
per-файл вибір стискати/ні (#56); склейка (#40, downscale уже є); орфан
worker-op `compressPdf` (re-save) — кандидат на прибирання окремо.

## ROADMAP — позначки

_Знімаються по завершенні (§Фаза 4 / §7.1 / §7.2 / вісь C; «без OCR» §7.2 —
готово в коді, познач після фолду D у main)._
