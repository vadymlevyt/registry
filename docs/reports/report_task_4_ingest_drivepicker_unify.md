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
- [ ] **D — `ocrMode` + «без OCR»** (Vision 2 стор. → метадані). 🔹
- [ ] **E — тумблер «стиснути перед обробкою».** 🔹

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

**`.txt` / searchable:** поведінку НЕ міняли в C (як і етап A). DOCX/HTML і далі
пишуть `.txt` (текст з конвертера); scanned — layout. Повна відмова від `.txt`
(наскрізна вимога спеки) — окремий шов, поза вузьким scope C (узгоджено з нотаткою
етапу A). Споживачі (`getDocumentText`) не змінювались.

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

## schemaVersion / міграція (рішення — на етапі D)

_Заповнюється на етапі D._

## ROADMAP — позначки

_Знімаються по завершенні (§Фаза 4 / §7.1 / §7.2 / вісь C)._
