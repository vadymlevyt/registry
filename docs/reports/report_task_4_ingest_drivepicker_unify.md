# Звіт — TASK 4: спільний інгест + DrivePicker + «просто додати» + без-OCR

**Спека:** `docs/tasks/TASK_4_ingest_drivepicker_unify.md`
**Гілка:** `claude/task-4-ingest-drivepicker-Nv5S3`
**Статус:** у роботі (по етапах, з 🔹-паузами на ревʼю власника)

---

## Чек-ліст етапів

- [x] **A — `ingest.js` (труба в одну).** Фасад `ingestFiles(input, options)` поверх Context-`run`; DP переведено на нього (behavior-preserving). 🔹 _(зведено в main)_
- [x] **B — винос DrivePicker** з `AddDocumentModal.jsx` → `components/DrivePicker/` (behavior-preserving). _(зведено в main)_
- [x] **B2 — злиття пікерів** (`DocumentProcessorV2/DrivePicker.jsx` → спільний; старий файл видалено). 🔹
- [ ] **C — DP-сценарій «просто додати»** (комбо готових файлів без нарізки). 🔹
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

## schemaVersion / міграція (рішення — на етапі D)

_Заповнюється на етапі D._

## ROADMAP — позначки

_Знімаються по завершенні (§Фаза 4 / §7.1 / §7.2 / вісь C)._
