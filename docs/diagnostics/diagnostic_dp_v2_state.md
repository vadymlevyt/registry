# DP v2 — Honest State Audit (read-only діагностика)

**Дата:** 2026-05-22
**Стан main:** HEAD `122f670` · `122f670` (TASK файл цього аудиту) поверх
`8f738c1` (ФД-FIX-T2 ToC timeout захист) → `bc7f4bf` (ФД-Z звіт TASK ToC) →
`6ab7132` (ФД-I інтеграційні тести).
**Метод:** read-only аналіз коду + наявних тестів. БЕЗ прогонів на
реальних даних. БЕЗ виправлень. Усі знахідки — як ризик у звіті, не як
зміна коду. `git diff` чистий.

---

## 1. Зведена таблиця

| # | Функція | Статус | Тест | Ризик |
|---|---------|--------|------|-------|
| Ф-1  | Нарізка single PDF | 🟡 | Provider-int (mock) + юніт | Реальна якість — лише ~85-93% (Брановський) і ~35% (Нестеренко 273pp); ToC покриває том з реєстром, без реєстру — Гілка B (D1+D2.5) ще не валідована адвокатом на новому реальному томі |
| Ф-2  | ZIP розпак + .p7s/.sig фільтр | 🟠 | dp2-stages інтеграція + unit | **`createIntakeWithUnpack` визначено в `unpack.js`, але ніде в `src/` НЕ ІМПОРТУЄТЬСЯ** — `DocumentPipelineContext.jsx` не підключає INTAKE override → у live Provider ZIP проходить як один не-розпакований файл. Тест dp2-stages запускає диригент напряму, обходить Provider |
| Ф-3  | **ЗМІШАНИЙ ВХІД (PDF+ZIP+image)** | 🟠 | **немає** | **Нема жодного інтеграційного тесту що ін'єктує одночасно ZIP+PDF+image** через streamingExecutor; за 3 тижні (B1-B3, ToC) цей шлях не торкався тестами; multi-file route таблиця через unpack→triage→persist не покрита |
| Ф-4  | Фрагменти одного документа в кількох PDF | 🟡 | Provider-int + unit | `fragment_reconstruct` route у `splitDocumentsV3` + `multiFileReconstructor` покритий; реальної справи з cross-file склейкою адвокат не запускав; propose+confirm UI Зони 3 для цього маршруту НЕ реалізовано (autoConfirm:true завжди) |
| Ф-5  | Фото → image_merge у PDF | 🟠 | Provider-int seam (без canvas) + юніт sortation | UI правок у DP v2 нема (`ImageMergePanel` живе лише в `AddDocumentModal` → пакетна обробка через image_merge йде без можливості правити порядок/поворот/кроп перед confirm); HEIC pre-step відкладено (борг #17) |
| Ф-6  | DOCX/HTML/RTF/ODT → PDF | 🟠 | юніт converter | DOCX/HTML — реалізовані; **RTF/ODT — НЕ підтримуються коду converterService.js**, хоча dropzone-hint у DP v2 каже «RTF, ODT». Невідомий формат → passthrough без warning у UI |
| Ф-7  | `organizeByProceedings` | 🔴 | немає | Тумблер default true, ніде в pipeline не читається |
| Ф-8  | `integrityCheck` | 🔴 | немає | Default true, ніде в pipeline не читається |
| Ф-9  | `cleanForReading` | 🟠 | юніт extractV3 | Реалізовано в `extractV3.js`; але `splitDocumentsV3.sliceProcessedArtifacts` свідомо НЕ застосовує чистку до нарізаних (борг #16). Тумблер ефекту НЕМАЄ на slice-шляху — лише на add_as_is single-doc fallback |
| Ф-10 | `generateSummary` | 🔴 | немає | Default true, ніде в pipeline не читається |
| Ф-11 | `compressAll` | 🔴 | немає | Default false, ніде в pipeline не читається |
| Ф-12 | `suggestDeadlines` | 🔴 | немає | Default false, ніде в pipeline не читається |
| Ф-13 | `updateCaseContext` | 🔴 | немає | Default true, ніде в pipeline не читається; `contextGenerator.js` файла не існує |
| Ф-14 | `fillCaseCard` | 🔴 | немає | Default false, ніде в pipeline не читається |
| Ф-15 | «Розпізнати текст» модалка | 🟡 | немає інтеграційного | Реалізовано через `ocrService.extractText({skipCache:true})`; адвокат не тестував у моїй пам'яті; «Зберегти у справу» створює canonical doc через `add_documents` ACTION |
| Ф-16 | «Стиснути файл(и)» модалка | 🟡 | юніт compress | Реалізовано через `standaloneCompressor` → `compressionService.compressPdf`; кнопки «Email», «Messenger» — disabled у UI з title «Буде доступно у майбутньому»; адвокат не тестував у моїй пам'яті |
| Ф-17 | TXT відповідає своєму PDF (page-precise) | 🟡 | dp-text-slice інтеграція + юніт | G1 (`sliceProcessedArtifacts`) реалізовано; адвокат BUG після G1 виправлено за звітом, але **повторне підтвердження саме на 02_ОБРОБЛЕНІ/.txt** у звітах не зафіксовано (бачив тільки що перемикач Скан/Текст працює) |
| Ф-18 | Дублікати усунені (metadata heuristic) | 🟡 | юніт splitDocumentsV3 G3 | `findDuplicate` за name+pageCount/size; адвокат бачив decision «новий варіант» на Брановському; контент-хешу немає (борг #14) |
| Ф-19 | Перемикач Скан/Текст у в'юері | 🟢 | юніт DocumentViewerFooter + footer-labels | B2-фікс `inferDocumentNatureFromSource`: layoutJson.pages → 'scanned'; адвокат підтвердив що працює (звіт B2 20.05.2026) |
| Ф-20 | Прогрес-стадії явні | 🟢 | юніт stageLabels + Provider-int dp-stage-progress | 10 стадій з людськими підписами; адвокат бачив 4 явні стадії; reportProgress пише stageLabel у jobProgressStore |
| Ф-21 | Прогрес-індикація у повноекранному режимі | 🟡 | юніт ProgressFullScreen + dp4-ui | Реалізовано (job.ratio + sub-bar для PERSIST); подвійна риска під час нарізки — UI-cosmetic (борг #18); регресія не виявлена в коді |
| Ф-22 | Resume після збою (UI) | 🟠 | юніт jobState + streamingExecutor | Backend є (`hasResumableJob`, `loadState`, `clearState`); **у `DocumentPipelineContext.jsx` mount-функції НЕМАЄ виклику `checkResumable` чи `hasResumableJob` для сканування Drive і пропозиції адвокату «Продовжити»**; `resume()` функцію проброшено у value Provider, але ніде у DocumentProcessorV2 чи інших UI компонентах вона не викликається |
| Ф-23 | ECITS UI | 🔴 | юніт courtSyncInfrastructure | Усі 4 підвкладки (Огляд/Журнал/Налаштування/Розбіжності) — `PlaceholderPanel` з текстом «У розробці»; `ecitsService.triggerSync()` → `{success:false, message:'У розробці'}`; `getLastSyncTime()` → null; `updateSettings()` повертає merged об'єкт **без персистенції** (TODO коментар) |
| Ф-24 | Гілки і стан main | — | — | Див. §5 |
| Ф-25 | Активні tracking_debt записи | — | — | Див. §5 |

---

## 2. Деталі по кожній функції

### Ф-1 — Нарізка single PDF
**Статус:** 🟡 — Provider-integration mock-тест зелений, реальна якість
підтверджена лише на двох справах: Брановський (~85-93%) і Нестеренко
(~35%, але це до ToC TASK; реальний прогін Нестеренко ПІСЛЯ ToC адвокат
ще НЕ робив).
**Точки реалізації:**
- `src/services/documentPipeline/stages/triageStage.js:175-308` (єдина
  точка AI-нарізки, override DETECT_BOUNDARIES)
- `src/services/documentPipeline/stages/splitDocumentsV3.js:121-434`
  (PERSIST: route disptch + slice)
- `src/services/documentBoundary/triagePrompt.js` (категорії сигналів
  СИЛЬНІ/АНТИ/ДОРАДЧІ/МЕТА — ФД-D3)
- `src/services/documentBoundary/tocDetector.js:1-…` (детектор реєстру —
  препроцесор, спрацьовує для single PDF, не-image, pageCount≥10)
- `src/services/documentPipeline/pageMarkers.js` (компактний дайджест +
  сигнали ФД-D1+D2+D2.5)
**Тип тесту:** Provider-integration mock у
`tests/integration/dp-toc-detector.test.js`,
`tests/integration/dp-enriched-digest.test.js`,
`tests/integration/dp-branovsky-quality.test.js` + юніт
`tests/unit/triageStage.test.js`, `tests/unit/tocDetector.test.js`,
`tests/unit/triagePrompt.test.js`. Усі — через справжній `streamingExecutor`
з застабленим `fetch`.
**Ризик:** mock-тести підтверджують ЛИШЕ що промпт містить очікувані
сигнали і що план Triage → ВСІ N документів створюються. Якість самого AI
(Haiku) на новому реальному томі без реєстру — невідома. Гілка B (D1+D2.5
сигнали без реєстру) на 273-pp Нестеренку **НЕ перепрогнана** після
закриття боргу #19.
**Кроки для адвоката на планшеті:**
1. Відкрий справу Брановського у CaseDossier → вкладка «Робота з
   документами» (DP v2).
2. Зони 1: натисни «Вибрати файли» → завантаж той самий 65-стор. PDF
   Брановського що раніше давав 93%.
3. Натисни «Розпочати обробку».
4. Очікувано: ~24 документи у Зоні 3 → «Дерево»; перемикач Скан/Текст у
   v'юері кожного документа.
5. Якщо отримав <20 документів АБО pipeline впав АБО ToC помилково
   спрацював на 65-pp справі без реєстру (повідомлення «Реєстр
   матеріалів у томі: …») — баг, фіксуй з номером і подачі.
6. Окремо: візьми НОВУ справу з реєстром на 1-3 сторінках (кримінальний/
   адмін том ≥30 стор.) → запусти DP v2 → переконайся що з'явилось
   повідомлення «Реєстр матеріалів у томі: N документів». Якщо реєстр є
   фізично, але повідомлення нема — ToC детектор не зловив; якщо реєстру
   нема, а повідомлення є — хибне спрацювання, фіксуй.

### Ф-2 — ZIP розпакування + .p7s/.sig фільтр
**Статус:** 🟠 — реалізація `createIntakeWithUnpack` існує і покрита
тестами, **але НЕ підключена до Provider'а** (`grep createIntakeWithUnpack
src/` дає матчі ТІЛЬКИ у самому файлі unpack.js). У живому Provider'і
INTAKE override відсутній → ZIP-вхід ймовірно проходить як один не-
розпакований файл через дефолтний intakeStage диригента.
**Точки реалізації:**
- `src/services/documentPipeline/stages/unpack.js:158-320`
  (`createIntakeWithUnpack`: ZIP через fflate lazy-import, .p7s/.sig →
  `ctx.signatures[]`, metadataSidecar.json → `ctx.metadataSidecar`)
- `src/services/documentPipeline/stages/unpack.js:181-194` — RAR/7z **не**
  розпаковуються, зберігаються як оригінал + warning decision
- `src/contexts/DocumentPipelineContext.jsx:192-203` — Provider ін'єктує
  `createIntakeWithUnpack` через streamingExecutor НЕ напряму; перевірив:
  у Provider tree-shaped buildPipelineDeps **немає override для INTAKE**;
  unpack тригериться лише через dp2-stages тестовий шлях (через
  `createDocumentPipeline` напряму, не через `streamingExecutor`)
**Тип тесту:** інтеграція в `tests/integration/dp2-stages.test.js`
(через справжній `createDocumentPipeline`, але БЕЗ streamingExecutor +
buildPipelineDeps Provider'а) + юніт `tests/unit/unpack.test.js`.
**Ризик:** **подивись ще раз** — `DocumentPipelineContext.jsx` НЕ ін'єктує
`createIntakeWithUnpack` у `stageOverrides` (я бачу лише
detectBoundaries/extract/confirm/persist). Тобто у живому Provider'і
INTAKE override = дефолтний `intakeStage` диригента (валідація caseId/files
без розпаку). **Реальна обробка ZIP через DP v2 у Provider'і може взагалі
НЕ працювати** — це конкретний ризик. Перевір рядки 192-260
`DocumentPipelineContext.jsx`. Тест `dp2-stages` запускає диригент сам,
обходить Provider — тому тест зелений, але production-шлях не покритий.
**Кроки для адвоката на планшеті:**
1. Створи тестову справу. Заархівуй у ZIP 2-3 PDF + один .p7s файл
   (підпис).
2. У DP v2 натисни «Вибрати файли» → обери цей ZIP.
3. Натисни «Розпочати обробку».
4. Очікувано: 2-3 документи у Зоні 3 «Дерево»; .p7s не з'явився як
   документ.
5. **Якщо ZIP залишився одним файлом** (без розпаку) АБО pipeline впав
   на ZIP — баг (підтверджує ризик вище: Provider не підключив unpack).
6. Якщо .p7s з'явився як окремий «документ» — теж баг (фільтр не
   спрацював).

### Ф-3 — **ЗМІШАНИЙ ВХІД** ⭐ ГОЛОВНИЙ СЦЕНАРІЙ
**Статус:** 🟠 — нема жодного інтеграційного тесту що ін'єктує
PDF+ZIP+image одночасно через `streamingExecutor.run(input)`.
**Точки реалізації:** повний pipeline INTAKE → CONVERT → Triage (AI вирішує
route per документ) → split. Має лягати на:
- `streamingExecutor.run` — приймає `input.files` як масив будь-яких mime
- `createIntakeWithUnpack` — розгортає ZIP
- `convertToPdf` — конвертує не-PDF (image/DOCX/HTML)
- `createTriageStage` — будує per-документний план з .route
- `createSplitDocumentsV3` — диспетчер за route
**Тип тесту:** **немає Provider-int тесту mixed-input**. dp-persist-routes
покриває кожен route ОКРЕМО (add_as_is, slice, image_merge,
fragment_reconstruct, to_fragments, discard) — на окремих наборах файлів,
не одночасно. dp2-stages запускає тільки ZIP. dp-toc-detector — single
PDF. dp-enriched-digest — single PDF.
**Ризик:** Найвищий. За 3 тижні (B1-B3 + Phase B revert + ToC TASK) цей
шлях не торкався, кожен fix міг його зламати непомітно. Конкретні
ризики:
1. INTAKE override (див. Ф-2) ймовірно не підключений у Provider →
   будь-який ZIP проходить як один «непідтримуваний файл» через
   converterService passthrough.
2. Triage отримує паспорти для гетерогенних артефактів (PDF з OCR +
   image без OCR + конвертований DOCX) — невідомо як AI Haiku поводиться
   на такому міксі.
3. PERSIST диспетч за route мав би коректно обробити кілька route у
   одному job, але це покрите тільки тестами на ОДНОРІДНІ набори.
**Кроки для адвоката на планшеті:**
1. Підготуй три файли одночасно: основний PDF справи (10-30 стор.), один
   ZIP з 2-3 PDF, 2-3 фото з пристрою (jpg/png/heic).
2. У DP v2 → Зона 1: «Вибрати файли» → обери ВСІ три типи разом.
3. Натисни «Розпочати обробку».
4. Очікувано (по специфікації): N документів у Зоні 3, з різними
   route-ами (slice для основного PDF, add_as_is для PDF з ZIP,
   image_merge для фото).
5. Якщо ZIP не розпакувався (з'явився один документ-архів) — баг
   INTAKE; якщо фото не склеїлось у PDF — баг image_merge або converter;
   якщо pipeline впав з помилкою — баг диспетчу.
6. ПЕРЕД цим запусти Ф-2 окремо щоб ізолювати чи проблема в ZIP саме у
   міксі чи й у самому ZIP.

### Ф-4 — Фрагменти одного документа в кількох PDF
**Статус:** 🟡 — Provider-integration тест існує для одного сценарію,
адвокат у моїй пам'яті це не запускав вживу; propose+confirm UI для
цього маршруту не реалізовано.
**Точки реалізації:**
- `src/services/documentBoundary/multiFileReconstructor.js:28-180`
  (`buildReconstructionPrompt`, `mergeFileResult`, `reconstructAcrossFiles`,
  `openTails` для multi-turn)
- `src/services/documentBoundary/triagePrompt.js` — route
  `fragment_reconstruct` у переліку маршрутів
- `src/services/documentPipeline/stages/splitDocumentsV3.js:230-352`
  (диспетчер: для route `fragment_reconstruct` викликає `buildDocumentPdf`
  → mergePdf через worker)
**Тип тесту:** Provider-int
`tests/integration/dp-persist-routes.test.js:116-122` + юніт
`tests/unit/multiFileReconstructor.test.js`,
`tests/integration/dp-triage.test.js:127`.
**Ризик:** TASK_smart_triage §рішення-2 явно вимагає
«fragment_reconstruct ЗАВЖДИ через propose+confirm» (адвокат вручну
підтверджує склейку), але `DocumentPipelineContext.jsx:210` встановлює
`autoConfirm: opt.autoConfirm !== false`, а
`DocumentProcessorV2/index.jsx:195` передає `autoConfirm: true`. Тобто
fragment_reconstruct виконується АВТОМАТИЧНО, без можливості адвоката
переглянути план. Це порушення явного рішення (борг не зафіксовано в
tracking_debt — нове відкриття цього аудиту).
**Кроки для адвоката на планшеті:**
1. Підготуй один логічний документ розділений на 2 PDF (наприклад
   «Висновок експерта частина 1.pdf» 1-3 стор. + «Висновок експерта
   частина 2.pdf» 1-2 стор.).
2. У DP v2 → Зона 1: завантаж обидва файли разом.
3. Натисни «Розпочати обробку».
4. Очікувано (по специфікації): план показує 1 склеєний документ
   «Висновок експерта» з двома фрагментами; адвокат вручну підтверджує.
5. Реально (по моєму прочитанню коду): pipeline сам прийняв план і
   склеїв БЕЗ підтвердження. Якщо побачив документ але НЕ було жодного
   проміжного підтвердження — це і є описаний ризик (autoConfirm:true).
6. Якщо склейка пройшла фізично некоректно (порушений порядок,
   дубльовані сторінки, пропуски) — баг або у Triage, або у `buildDocumentPdf`.

### Ф-5 — Фото JPG/PNG/HEIC → image_merge у PDF
**Статус:** 🟠 — реалізовано на рівні pipeline через image_merge route,
АЛЕ UI правок порядку/повороту/обрізки у DP v2 нема. ImageMergePanel
живе тільки в AddDocumentModal (CaseDossier).
**Точки реалізації:**
- `src/services/documentPipeline/stages/triageStage.js` — детермінований
  тривіал (1 image, 1 page) → route image_merge без AI;
  AI також може призначити image_merge при наборі фото
- `src/services/documentPipeline/stages/splitDocumentsV3.js:254-282` —
  диспетч викликає `mergeImagesToPdf` ін'єктор (Provider)
- `src/services/sortation/imageMergeRenderer.js` — композиція через worker
- `src/services/sortation/imageSortingAgent.js`, `orientationCorrector.js`,
  `cropHelper.js`, `edgeDetection.js` — повна машинерія
- `src/components/CaseDossier/ImageMergePanel.jsx:79-…` — UI правок
  існує, **використовується ТІЛЬКИ в AddDocumentModal**
- `src/services/converter/heicToJpeg.js` — HEIC pre-step (доступний у
  converterService, не в image_merge маршруті)
**Тип тесту:** Provider-int `tests/integration/dp-persist-routes.test.js`
test «image_merge → mergeImagesToPdf seam» (моки canvas, перевіряє seam) +
`tests/integration/dp-image-merge-failure.test.js` (B3 graceful skip);
юніт `tests/unit/multiImageToPdf.test.js`, `imageMergeRenderer.test.js`,
`imageSortingAgent.test.js`, `orientationCorrector.test.js`,
`cropHelper.test.js`, `edgeDetection.test.js`, `heicToJpeg.test.js`.
**Ризик:**
1. У DP v2 fast-path фото→image_merge йде без можливості адвоката
   переглянути порядок/поворот/кроп — це порушення TASK_smart_triage §7
   «propose→confirm UI у Зоні 3».
2. HEIC pre-step (борг #17) не вшитий у image_merge гілку — конкретно,
   `splitDocumentsV3.js` рядки 257-265 формують `images[]` з raw bytes
   і mime як є; якщо HEIC не декодується через canvas — graceful skip
   (B3), документ просто зникає без warning у Зоні 3 «Питання».
3. Реального тесту image_merge на iPad/Safari адвокат не робив (декіль-
   ка декодерів image відрізняються).
**Кроки для адвоката на планшеті:**
1. Зроби 3-4 фото одного документа на телефон (постанова, паспорт
   тощо — щоб АДВОКАТ знав що це ОДИН документ).
2. У DP v2 → Зона 1: завантаж усі фото разом.
3. Натисни «Розпочати обробку».
4. Очікувано: один PDF документ у Зоні 3 «Дерево» що містить N
   сторінок-фото (склеєних з твоїх знімків).
5. **Якщо адвокат хотів змінити порядок або обрізати** — НЕМАЄ UI в DP
   v2 для цього. Це не баг — це обмеження (відсутня фіча propose+confirm
   для image_merge).
6. Якщо хоч одне HEIC фото зникло без сліду — це борг #17 graceful skip.
7. Якщо фото склеїлись у НЕправильному порядку — це imageSortingAgent
   (AI) помилився; повторна обробка може дати інший результат.

### Ф-6 — Конвертація DOCX/HTML/RTF/ODT → PDF
**Статус:** 🟠 — DOCX/HTML/image реалізовано, **RTF і ODT не
підтримуються**, хоча dropzone-hint у DP v2 каже «RTF, ODT».
**Точки реалізації:**
- `src/services/converter/converterService.js:142-263` — фасад;
  `isHtml`/`isDocx`/`isImage`/`isPdf` гілки; невідомий формат →
  passthrough з warning
- `src/services/converter/htmlToPdf.js`, `docxToPdf.js`, `imageToPdf.js`,
  `heicToJpeg.js`, `multiImageToPdf.js`, `pdfLibHtmlRenderer.js`
- `src/components/DocumentProcessorV2/index.jsx:292` —
  dpv2-dropzone-hint каже «PDF, JPG, PNG, HEIC, DOCX, XLSX, PPTX, RTF,
  ODT, TXT, MD, ZIO, RAR, 7z»
**Тип тесту:** юніт `tests/unit/converterService.test.js`,
`htmlToPdf.test.js`, `docxToPdf.test.js`, `imageToPdf.test.js`,
`heicToJpeg.test.js`, `pdfLibHtmlRenderer.test.js`, +
`tests/integration/documentViewer-workflow.test.jsx` (для відображення).
**Ризик:**
1. Адвокат завантажує `.rtf` або `.odt` → pipeline йде по гілці 5
   (`converterService.js:251-263`) → passthrough як невідомий файл +
   warning «Тип ... не конвертується — залишаємо як є». DP v2 у Зоні 3
   це не показує адвокату — він побачить документ у Дереві АЛЕ
   текстовий шар буде відсутній (Document AI не зможе витягти текст з
   RTF/ODT через PDF API).
2. XLSX/PPTX/TXT/MD у dropzone-hint, але теж не конвертуються (так само
   passthrough). Особливо XLSX/PPTX — критично, бо адвокат їх очікує.
**Кроки для адвоката на планшеті:**
1. Підготуй один RTF файл (legacy формат, інколи зустрічається в
   старих документах).
2. У DP v2 завантаж тільки цей файл → «Розпочати обробку».
3. Очікувано (по rectangular-hint): конвертація у PDF + витяг тексту.
4. Реально (по коду): passthrough, у в'юері документ показано як є,
   текст недоступний для копіювання, перемикача Скан/Текст немає.
5. Якщо побачив warning у Зоні 3 «Питання» що RTF не конвертовано —
   значить попередження є у decisions[]; якщо ні — UI це проковтнув.
6. Повтори те саме з .docx — має конвертуватись з витягом тексту через
   mammoth (НЕ через Document AI).

### Ф-7 — `organizeByProceedings` (розкласти по провадженнях)
**Статус:** 🔴 — заглушка.
**Точки реалізації:** `src/components/DocumentProcessorV2/index.jsx:31`
default true; `:354` Toggle. **Більше ніде в коді не читається** (grep
`organizeByProceedings`).
**Тип тесту:** немає.
**Ризик:** Адвокат вмикає/вимикає, ефекту нема. Документи незалежно від
тумблера зберігаються у те саме `procId` що проставляється
`buildDocumentMetadata` (typically `proc_main`).
**Кроки для адвоката на планшеті:**
1. У Зоні 2 вимкни «Розкласти по провадженнях».
2. Запусти обробку 10 документів.
3. Спостерігай: документи мають з'явитися «розкладеними» по існуючих
   проваджень справи (якщо у справі їх кілька).
4. Реально: всі лягають в одне provадження. Перемикач не має ефекту.

### Ф-8 — `integrityCheck` (перевірка цілісності)
**Статус:** 🔴 — заглушка.
**Точки реалізації:** `index.jsx:32` default true; `:355` Toggle. Ніде
не читається.
**Тип тесту:** немає.
**Ризик:** Адвокат думає що проводиться перевірка цілісності файла
перед обробкою (md5? страж побитих PDF?) — її нема. Зламаний PDF піде
у pipeline і впаде на etapі OCR з технічною помилкою.
**Кроки для адвоката на планшеті:**
1. Спробуй завантажити явно битий PDF (відкрий PDF, видали байти в
   середині, збережи).
2. Очікувано: попередження «Файл пошкоджений» ДО обробки.
3. Реально: pipeline стартує, валиться на OCR з технічною помилкою у
   Зоні 3 «Помилки».

### Ф-9 — `cleanForReading` (Haiku-чистка)
**Статус:** 🟠 — частково реалізовано (тільки для add_as_is fallback),
для slice/нарізаних свідомо НЕ застосовується.
**Точки реалізації:**
- `src/services/documentPipeline/stages/extractV3.js:43-77` — викликає
  `cleanText` ін'єктор за умови `stageDeps.cleanForReading === true`
- `src/contexts/DocumentPipelineContext.jsx:205` —
  `cleanForReading: opt.cleanForReading === true` пробрасується з UI
- `src/contexts/DocumentPipelineContext.jsx:116-127` — `aiCleanText`
  через Haiku, prompt каже «не міняти зміст, лише прибрати OCR-сміття»
- `src/services/documentPipeline/stages/splitDocumentsV3.js:546-555` —
  коментар: «Чистка для читання … СВІДОМО НЕ застосовується до зрізаних»
  (борг #16)
**Тип тесту:** юніт `tests/unit/dp3Stages.test.js` (extractV3
cleanForReading).
**Ризик:** Адвокат вмикає тумблер очікуючи що ВСІ документи будуть
очищені від OCR-сміття. Реально це працює тільки коли PDF не нарізається
(тобто add_as_is). При нарізці (95% реальних кейсів) — нарізані .txt у
02_ОБРОБЛЕНІ зберігаються СИРИМИ (per-page raw з documentAi).
**Кроки для адвоката на планшеті:**
1. Увімкни «Очистити для читання» у Зоні 2.
2. Запусти обробку 65-стор. PDF Брановського (раніше було ~24 документи).
3. Відкрий любий нарізаний документ → перемикач Текст.
4. Очікувано: текст без OCR-сміття (без артефактів сканування).
5. Реально: текст з сирим OCR (зі сміттям) — як до фіксу. Тумблер не
   спрацював для нарізаних.
6. Тепер запусти ОКРЕМИЙ 1-стор. PDF (Triage не ріже) → у нього текст
   має бути очищений. Якщо різниці нема — фікс взагалі не працює.

### Ф-10 — `generateSummary` (короткий зміст)
**Статус:** 🔴 — заглушка.
**Точки реалізації:** `index.jsx:34` default true; `:360` Toggle. Ніде
не читається.
**Тип тесту:** немає.
**Ризик:** Адвокат думає що буде згенерований короткий зміст кожного
документа (для швидкого огляду в дереві). Не генерується.
**Кроки для адвоката на планшеті:**
1. Увімкни тумблер. Запусти обробку.
2. У Зоні 3 «Дерево» очікувано: короткий опис під назвою кожного
   документа.
3. Реально: лише `category` («document», «pleading» тощо).

### Ф-11 — `compressAll` (стиснути всі файли)
**Статус:** 🔴 — заглушка.
**Точки реалізації:** `index.jsx:35` default false; `:364` Toggle. Ніде
не читається. (Окрема «Стиснути файл(и)» модалка Ф-16 реалізована, але
це окрема фіча.)
**Тип тесту:** немає.
**Ризик:** Адвокат вмикає очікуючи що нарізані PDF будуть стиснені.
Не стиснуться. Брановський (нарізаний з 21МБ→24 файли) — кожен
збережеться без compressPdf.
**Кроки для адвоката на планшеті:**
1. Увімкни «Стиснути всі файли пакета». Запусти 65-стор. Брановського.
2. Очікувано: на Drive 01_ОРИГІНАЛИ — стиснені PDF (значно менші ніж
   фрагменти оригіналу).
3. Реально: розміри ті самі що сирі нарізки (порядок ~0.5-2 МБ кожен).

### Ф-12 — `suggestDeadlines` (запропонувати дедлайни)
**Статус:** 🔴 — заглушка.
**Точки реалізації:** `index.jsx:36` default false; `:365` Toggle. Ніде
не читається.
**Тип тесту:** немає.
**Ризик:** Адвокат очікує що з постанови про відкриття провадження AI
витягне строки і запропонує їх додати у вкладку «Дедлайни» досьє. Цього
нема.
**Кроки для адвоката на планшеті:**
1. Увімкни тумблер. Запусти обробку документа з явними строками
   («відповідь подати в 10 днів» тощо).
2. Очікувано: у Зоні 3 «Питання» або окремій секції — список знайдених
   дедлайнів з кнопкою «Додати».
3. Реально: нічого.

### Ф-13 — `updateCaseContext` (оновити case_context.md)
**Статус:** 🔴 — заглушка.
**Точки реалізації:** `index.jsx:37` default true; `:366` Toggle. Ніде
не читається. `src/services/contextGenerator.js` файла **не існує**.
**Тип тесту:** немає.
**Ризик:** Тумблер created з прицілом на Context Generator з DP v2
roadmap, але Context Generator відкладено на пізніший TASK. UI зберігся.
**Кроки для адвоката на планшеті:**
1. Увімкни тумблер. Запусти обробку.
2. Очікувано: у папці справи з'явиться/оновиться файл `case_context.md`
   з резюме всіх документів.
3. Реально: файла нема.

### Ф-14 — `fillCaseCard` (заповнити картку справи)
**Статус:** 🔴 — заглушка.
**Точки реалізації:** `index.jsx:38` default false; `:367` Toggle. Ніде
не читається.
**Тип тесту:** немає.
**Ризик:** Очікується що з документів витягнуться поля для картки справи
(суддя, номер справи, сторони, суд) і запропонуються адвокату для
підтвердження. Цього нема.
**Кроки для адвоката на планшеті:**
1. Створи порожню справу (без поля «Суд», «Суддя», «Номер»). Завантаж
   позов і ухвалу про відкриття провадження.
2. Увімкни тумблер. Запусти обробку.
3. Очікувано: пропозиція заповнити поля справи з витягнутих даних.
4. Реально: поля порожні залишаються.

### Ф-15 — «Розпізнати текст» модалка
**Статус:** 🟡 — реалізовано, інтеграційного тесту немає, адвокат не
тестував у моїй пам'яті.
**Точки реалізації:**
- `src/components/DocumentProcessorV2/index.jsx:268-270` — кнопка
  «Розпізнати текст»
- `src/components/DocumentProcessorV2/modals/RecognizeTextModal.jsx:1-138`
  — модалка: вибір одного файла → `ocrService.extractText({skipCache:true})`
  → перегляд тексту → 4 опції: «Закрити», «Скопіювати», «На пристрій
  (.txt)», «Зберегти у справу»
- `src/services/ocrService.js:256` — `skipCache` керує читанням
**Тип тесту:** немає інтеграційного. Юніт ocrService покритий
`tests/unit/ocrService.test.js`, але саме модалка — ні.
**Ризик:**
1. `extractText` асинхронний без UI timeout — якщо OCR довго (Document AI
   на великому PDF) — модалка висне без зворотного зв'язку (тільки
   «Розпізнавання…» текст).
2. «Зберегти у справу» створює canonical doc з `category: null`,
   `documentNature: 'searchable'` (бо це .txt), `addedBy: 'user'`,
   `source: 'manual'`. Це коректно через `createDocument`.
3. Помилка OCR показується через `toast.error` + `localizeOcrError` —
   адвокат бачить локалізоване повідомлення.
**Кроки для адвоката на планшеті:**
1. У DP v2 натисни «Розпізнати текст» (правий верхній).
2. Вибери ОДИН PDF (можна великий, 5-10 стор. скан).
3. Очікувано: за 10-30 с з'являється текст; нижче кнопки 4 опцій.
4. Натисни «Скопіювати» → вставити в інший застосунок → текст
   присутній.
5. Натисни «Зберегти у справу» → перевірити в досьє у вкладці
   «Матеріали»: з'явився новий .txt документ у 01_ОРИГІНАЛИ.
6. Якщо модалка зависла на «Розпізнавання…» >2 хв — баг (нема UI
   timeout).

### Ф-16 — «Стиснути файл(и)» модалка
**Статус:** 🟡 — реалізовано, юніт-тести compressionService/
standaloneCompressor є; інтеграційного тесту самої модалки немає; адвокат
не тестував у моїй пам'яті.
**Точки реалізації:**
- `src/components/DocumentProcessorV2/index.jsx:271-273` — кнопка
- `src/components/DocumentProcessorV2/modals/CompressFilesModal.jsx:1-110`
  — модалка
- `src/services/standaloneCompressor.js:22-…` — фабрика DI
- `src/services/compressionService.js` — `compressPdf` (re-save через
  pdf-lib)
- 4 опції збереження у модалці: «Drive (01_ОРИГІНАЛИ)», «На пристрій
  (downloads)», «Надіслати email» (disabled), «Надіслати в messenger»
  (disabled)
**Тип тесту:** юніт `tests/unit/compressionService.test.js`,
`tests/unit/standaloneCompressor.test.js`.
**Ризик:**
1. Email/messenger — disabled у UI з title «Буде доступно у майбутньому»
   (хоча tooltip говорить про «майбутнє», це навмисно: TASK не
   реалізовано). Це нормально, але UI не плутає адвоката.
2. Drive opt використовує `caseData?.storage?.driveFolderId` для
   parentId, шукає/створює `01_ОРИГІНАЛИ`. Якщо адвокат відкрив модалку
   з DP v2 у контексті справи — папка є; якщо без справи (теоретично) —
   може помилитись (модалка передає caseData).
3. Локальне завантаження робить `Blob` + `<a download>` — стандартно;
   на iPad/Safari може поведінкою відрізнятись (новий tab замість
   завантаження).
**Кроки для адвоката на планшеті:**
1. У DP v2 натисни «Стиснути файл(и)».
2. Вибери 2-3 PDF (краще великі — 5-20 МБ).
3. Натисни «На пристрій (downloads)».
4. Очікувано: 2-3 файли збереглися у downloads, кожен помітно менший.
5. Перевір розмір у відчуттях — якщо стиснуто <10% — фікс не дає
   ефекту (compressPdf re-save мінімізує накладні).
6. Натисни «У поточну справу (01_ОРИГІНАЛИ)» з обраним файлом → у
   досьє з'явиться той самий файл стиснений.
7. Email/messenger — пересвідчись що кнопки disabled (а не що
   натискаються і нічого не роблять).

### Ф-17 — TXT відповідає своєму PDF (page-precise)
**Статус:** 🟡 — реалізовано, інтеграційний тест існує, реальне
підтвердження після G1 у звітах не явне на 02_ОБРОБЛЕНІ/.txt.
**Точки реалізації:**
- `src/services/documentPipeline/stages/splitDocumentsV3.js:556-585`
  (`sliceProcessedArtifacts`) — ріже layout per-page по [startPage,
  endPage] кожного фрагмента
- `src/services/documentPipeline/stages/splitDocumentsV3.js:587-609`
  (`writeProcessedArtifacts`) — пише `.txt` і `.layout.json` через
  `writeText02` і `writeLayout02` ін'єктори
- `src/contexts/DocumentPipelineContext.jsx:224-246` —
  ін'єкції викликають `ocrService.writeExtractedTextArtifact` та
  `ocrService.writeLayoutArtifact`
- `src/services/documentPipeline/pageMarkers.js` — `isPagedLayout` страж
**Тип тесту:** Provider-int `tests/integration/dp-text-slice.test.js` +
юніт `tests/unit/splitDocumentsV3.test.js`, `splitDocumentsV3-routes.test.js`.
**Ризик:**
1. Резюме `report_smart_triage_bugfix.md` каже що G1 виправлено, але
   я не бачив у звітах рядка про підтвердження адвокатом на планшеті
   що `.txt` саме одного документа містить ТІЛЬКИ його сторінки (а не
   увесь файл як раніше). Тільки що перемикач Скан/Текст у v'юері
   тепер показує правильний текст — це непрямо.
2. Fallback (неповний layout — resume після збою) → пише весь текст
   файла з decision `text_slice_fallback`. Як часто це спрацьовує на
   реальному Drive — невідомо.
**Кроки для адвоката на планшеті:**
1. Запусти обробку 65-стор. Брановського у DP v2.
2. Дочекайся завершення → у досьє відкрий будь-який нарізаний документ.
3. Переключи v'юер у режим Текст.
4. Очікувано: текст ТІЛЬКИ цього документа (наприклад «Позовна заява»
   1-8 стор. — лише її текст).
5. Реально (за G1): має бути коректно. Якщо побачив текст іншого
   документа або змішаний — G1 не спрацював на цьому документі.
6. Перевір на Drive прямо: `02_ОБРОБЛЕНІ/<doc_name>_<driveId>.txt` —
   зміст відповідає назві файла.

### Ф-18 — Дублікати усунені (metadata heuristic)
**Статус:** 🟡 — реалізовано і працює; адвокат бачив на Брановському;
контент-хешу нема (борг #14).
**Точки реалізації:**
- `src/services/documentPipeline/stages/splitDocumentsV3.js:77-90`
  (`findDuplicate`: norm name + pageCount fallback size ±5%)
- `:303-310` — виклик перед upload з `registryView()` (актуальний
  список з вже-в-цьому-job)
- decision types: `duplicate_skipped` (exact), `duplicate_review` (variant)
**Тип тесту:** юніт `tests/unit/splitDocumentsV3.test.js` (G3 bug 1),
`tests/integration/dp-persist-routes.test.js` (G3 bug 1 кейс).
**Ризик:** Хибно-позитивний дедуп якщо два РІЗНІ документи мають однакову
назву АБО близький розмір/pageCount. Адвокат бачив це на Брановському
(decision «новий варіант»). Сам факт що ми використовуємо назву+pageCount
для дедупу — свідоме рішення (адвокат відмовився від контент-хешу через
schemaVersion bump). Реальний борг #14.
**Кроки для адвоката на планшеті:**
1. Завантаж той самий PDF Брановського ДВІЧІ підряд (без видалення
   після першого прогону).
2. Очікувано (за G3): другий прогон побачить 24 документи як «exact
   duplicates», нічого нового не з'явиться у досьє.
3. Реально (за кодом): decisions[] містить N×`duplicate_skipped` записів
   у Зоні 3 «Питання» / «Потребує уваги».
4. Якщо нові копії з'явились — дедуп не спрацював.
5. Окремо: завантаж два РІЗНИХ документи з однаковою назвою (наприклад
   «Постанова.pdf» з різних справ) — переконайся що другий не
   проковтнувся як дублікат першого (відомий ризик).

### Ф-19 — Перемикач Скан/Текст у в'юері
**Статус:** 🟢 — реалізовано і підтверджено адвокатом (звіт B2,
20.05.2026).
**Точки реалізації:**
- `src/services/documentPipeline/stages/splitDocumentsV3.js:56-64`
  (`inferDocumentNatureFromSource`: layoutJson.pages → 'scanned')
- `src/services/documentFactory.js` (`detectNature` fallback)
- `src/components/DocumentViewer/DocumentViewerFooter.jsx:22`
  (`isScanned = document.documentNature === 'scanned'`)
- `src/components/DocumentViewer/DocumentViewerHeader.jsx:35` (показує
  `ScanTextToggle` лише коли `showModeToggle`)
- `src/components/DocumentViewer/index.jsx:60-70`
  (`showModeToggle = !inlineRenderable && isScanned`)
**Тип тесту:** юніт `tests/unit/DocumentViewer.test.jsx`,
`DocumentViewerFooter.test.jsx`, `ScanTextToggle.test.jsx`,
`documentViewer-labels.test.js`; інтеграція
`tests/integration/documentViewer-workflow.test.jsx`.
**Ризик:** мінімальний — фікс конкретний, тести покривають як унікальні
case'и (scanned/searchable/inlineRenderable), так і real-world workflow.
**Кроки для адвоката на планшеті:**
1. Відкрий нарізаний документ Брановського (зі скана).
2. У футері — перемикач Скан/Текст (показано тільки для scanned).
3. Натисни Текст → з'явиться витягнутий OCR-текст.
4. Натисни Скан → знов PDF.
5. Відкрий searchable PDF (HTML-конвертований документ або текстовий
   PDF) — перемикача НЕ має бути.
6. Якщо перемикач зник на нарізаному скані — баг (повернення B2-фікса).

### Ф-20 — Прогрес-стадії явні (не «processing»)
**Статус:** 🟢 — реалізовано, підтверджено адвокатом (4 явні стадії у
модалці).
**Точки реалізації:**
- `src/services/documentPipeline/stageLabels.js:15-26` — 10 фрозен-міток
  (ocr/intake/convert/detectBoundaries/classify/extract/proposeMetadata/
  confirm/persist/emit)
- `src/services/documentPipeline/streamingExecutor.js` — push
  `stageLabel` у `jobProgressStore`
- `src/components/DocumentProcessorV2/ProgressFullScreen.jsx:26` —
  `const stage = job.stageLabel || job.stage || 'Обробка'`
**Тип тесту:** юніт `tests/unit/stageLabels.test.js` +
`tests/integration/dp-stage-progress.test.js` (Provider-int).
**Ризик:** Object.freeze на STAGE_LABELS — модифікація потребує
свідомого редагування. Регресія малоймовірна, але якщо назву стадії
диригент випадково перейменує без оновлення мапи — UI покаже технічну
назву.
**Кроки для адвоката на планшеті:**
1. Запусти обробку 65-стор. PDF Брановського.
2. Спостерігай у модалці прогресу: повинні з'являтися підписи
   «Розпізнавання тексту», «Аналіз структури документів»,
   «Розкладання документів», «Завершення» (різні стадії в часі).
3. Якщо побачив «processing» або «persist» англійською — регресія
   stageLabels.

### Ф-21 — Прогрес-індикація у повноекранному режимі
**Статус:** 🟡 — реалізовано, є відомий косметичний борг #18 (подвійна
риска), регресій не виявлено.
**Точки реалізації:**
- `src/components/DocumentProcessorV2/GlobalProgressScreen.jsx:1-33`
  (керування з контексту Provider)
- `src/components/DocumentProcessorV2/ProgressFullScreen.jsx:51-72` —
  головний bar (ratio) + sub-bar для PERSIST (subTotal/subDone)
- `src/services/documentPipeline/jobProgressStore.js` — стор прогресу
  з push-source (executor) + Drive-poll fallback
**Тип тесту:** юніт `tests/unit/JobProgressTopbar.test.jsx`,
`tests/unit/jobProgressStore.test.js`; інтеграція
`tests/integration/dp4-ui.test.jsx`.
**Ризик:**
1. Борг #18 (подвійна риска під час нарізки) — UI cosmetic, видимий.
2. Якщо `jobProgressStore` втратить push (наприклад executor оновився а
   subscribe сорвався) — fallback на Drive-poll, але адвокат побачить
   «застиглий» прогрес-бар поки не оновиться (5с інтервал).
**Кроки для адвоката на планшеті:**
1. Запусти обробку великого тома (Брановський, Нестеренко).
2. Спостерігай за прогрес-баром: рухається повільно але невпинно.
3. Залиш планшет на 30 секунд → переключись назад → бар не «застряг»
   на одному значенні без оновлення.
4. Під час PERSIST стадії (близько кінця) — є тонкий додатковий бар
   («Документ N з M»). Це борг #18 — нормальна поведінка.
5. Згорни у топбар → розгорни → стан коректно зберігся.

### Ф-22 — Resume після збою (підключено до UI?)
**Статус:** 🟠 — backend є і покритий тестами; **UI integration
відсутня** (нема виклику `checkResumable` чи `hasResumableJob` при
mount Provider'а).
**Точки реалізації backend:**
- `src/services/documentPipeline/jobState.js:1-170` —
  `createJobStateStore`: `saveState`, `loadState`, `clearState`,
  `hasResumableJob(caseId, jobId)`
- `src/services/documentPipeline/streamingExecutor.js:354-364` —
  `resume(input)` і `checkResumable(caseId, jobId)`
- `src/services/documentPipeline/jobProgressStore.js:9-…` —
  `attachDrivePolling` (поллінг _temp на Drive)
**UI integration:**
- `src/contexts/DocumentPipelineContext.jsx:285-289` — `resume`
  експортовано у value Provider
- `src/contexts/DocumentPipelineContext.jsx:343-346` — `attachDrivePolling`
  активовано при mount
- **AЛЕ:** ніде в `DocumentProcessorV2/index.jsx` чи
  `DocumentPipelineContext.jsx` НЕ викликається `executor.checkResumable`
  або `_jobStore.hasResumableJob` при mount для **списку справ**, щоб
  запропонувати адвокату «Продовжити обробку для справи X?».
- `attachDrivePolling` сама собою НЕ ініціює UI-діалог — вона лише
  оновлює `jobProgressStore` якщо знаходить активні job_state.
**Тип тесту:** юніт `tests/unit/jobState.test.js`,
`tests/unit/streamingExecutor.test.js` (resume логіка). UI тестів resume
немає (`dp4-ui.test.jsx` тільки мокає `resume: vi.fn()`).
**Ризик:** TASK_smart_triage §8 явно: «Resume у UI — інфра є…
бракує: DocumentPipelineProvider при mount сканує Drive на незавершені
job_state і пропонує "Продовжити обробку?"». Це не реалізовано.
Сценарій: адвокат запустив обробку → планшет заснув → pipeline впав →
адвокат відкриває справу → нічого не пропонується продовжити. _temp
залишається на Drive як орфан.
**Кроки для адвоката на планшеті:**
1. Запусти обробку 65-стор. Брановського у DP v2.
2. На середині процесу (видно по прогрес-бару, ~40%) ПРИМУСОВО закрий
   браузер / переключи на іншу вкладку на 5+ хвилин.
3. Поверніся у Legal BMS → відкрий ту саму справу.
4. Очікувано (по специфікації): діалог «Продовжити обробку, що була
   перервана?».
5. Реально: нічого не з'являється; адвокат має руками запустити нову
   обробку, на Drive у `_temp/<caseId>_<jobId>/` залишаються артефакти.
6. Перевір: `_temp/<caseId>_<jobId>/job_state.json` на Drive — статус
   «running» хоча job фактично мертвий.

### Ф-23 — ECITS UI
**Статус:** 🔴 — усі підвкладки заглушки за дизайном (так і планувалось
у TASK 0.2 «інфраструктурний скелет»).
**Точки реалізації:**
- `src/components/CourtSync/index.jsx:1-196` — модуль; 4 підвкладки
  (overview/log/settings/discrepancies) рендерять `PlaceholderPanel`
  з текстом «У розробці»
- `src/components/CourtSync/setup/ClaudeForChromeSetup.jsx` — інструкція
  встановлення розширення (для founder Розвідник)
- `src/components/CourtSync/Reconnaissance/index.jsx:1-…` — Розвідник
  (founder-only), запуск read-only сценаріїв через Claude for Chrome
- `src/services/ecitsService.js:1-…` — фасад-заглушки:
  - `triggerSync()` → `{success: false, message: 'У розробці'}`
  - `getLastSyncTime()` → null
  - `getSyncReport()` → mock-структура з note «Синхронізації ще не
    виконувались»
  - `getSettings()` → дефолти або з tenant.settings.moduleIntegration.ecits
  - `updateSettings(patch)` → **повертає merged об'єкт БЕЗ персистенції**
    (TODO коментар)
  - Reconnaissance API (getReconScenarios, registerReconRun тощо) —
    реальне (історія в localStorage + tenant.recon_history[])
- `src/components/ECITSBanner/index.jsx` — банер з кількістю нових
  надходжень з ЄСІТС (підписаний на eventBus `ECITS_INBOX_PENDING`)
- `src/services/ecitsInboxWatcher.js` — watcher 00_INBOX_СПРАВИ на Drive
**Тип тесту:** юніт `tests/unit/courtSyncInfrastructure.test.js`,
`tests/unit/ecitsInboxWatcher.test.js`, `tests/unit/ecitsReconnaissance.test.js`,
`tests/unit/ECITSBanner.test.jsx`.
**Ризик:** Кожна підвкладка — навмисно заглушка. Адвокат бачить
«У розробці» і знає що це поки нема. Розвідник для founder — реально
працює (історія, експорт артефактів на Drive). `updateSettings` НЕ
персистує — якщо адвокат думатиме що змінив налаштування ЄСІТС, це
залишиться лише в пам'яті preview.
**Кроки для адвоката на планшеті:**
1. Відкрий вкладку «Електронний суд» (між «Книжкою» і «Новою справою»).
2. Очікувано: усі підвкладки показують «У розробці» — це нормально.
3. Якщо ти founder (vadym): з'явиться додаткова вкладка «Розвідник» —
   відкрий, переглянь сценарії, спробуй запустити (потребує Claude for
   Chrome). Це **реально працює**.
4. У підвкладці «Налаштування» (ECITS) ймовірно є тумблери — якщо
   натиснеш, нічого не збережеться (TODO у updateSettings).

### Ф-24 — Що в main, що на окремих гілках
**Стан main:** HEAD `122f670` — TASK файл аудиту. Попередні значущі
коміти на main:
- `8f738c1` ФД-FIX-T2: захист від зависання tocDetector (TOC_API_OPTIONS +
  Promise.race страховка)
- `bc7f4bf` ФД-Z: звіт TASK ToC + закрито борги #19, #21
- `6ab7132` ФД-I: інтеграційні тести dp-enriched-digest +
  dp-branovsky-quality
- `135b86c` ФД-D3: оновити triagePrompt — категорії сигналів
- `bd3263e` ФД-D2.5: семантична безперервність + дефекти-зміна
- `8f1ed8d` ФД-D2: table-coverage + ЯКІР-ДОКУМЕНТА + внутрішня нумерація
- `0d3c165` ФД-T2: tocDetector → препроцесор у triageStage
- `51ea758` ФД-T1: tocDetector — детектор+парсер реєстру

**Гілки на origin (не змержені структурно у main):**
- `claude/optimize-dp-pipeline-phase-b-Sw2NH` — Phase B (P1-P4 perf,
  HEAD `7491b92`) — **відкочена в main** через P1 регресію (passthrough
  на реальному Provider'і); гілка збережена для пост-mortem + forward-fix.
  Усі коміти гілки технічно є в історії main через revert-ланцюг, але
  HEAD гілки не = HEAD main.
- `claude/dp-v2-honest-audit-BU2ZY` — поточна гілка цього аудиту.

**Решта (`~46 гілок claude/*`)** — це історичні гілки попередніх TASK
(fix-*, add-*, smart-triage-implementation, toc-parser-enriched-digest).
Коміти їх змержено в main, гілки на origin лишаються як артефакти.
`smart-triage-implementation-yFm9o` і `toc-parser-enriched-digest-ccuCK`
— нещодавні TASK гілки, повністю в main.

### Ф-25 — Активні tracking_debt записи
Активні (поточний стан tracking_debt.md):

| # | Що | Тригер | Спрацював? |
|---|---|---|---|
| 1 | Backfill `case.client` (string) і `proceeding.judges` із `parties[]`/`composition` | Коли Court Sync почне писати `parties[]`/`composition` і UI має показувати з них | НІ — Court Sync не активований |
| 2 | Перевірка повноти дайджесту CLAUDE.md після виносу історії | Наступний schema bump (v7→v8+) | НІ |
| 4 | Косметичні згадки видаленого `DocumentProcessor` у `documentFactory.js`, `toolDefinitions.js`, `migrations/v4ToV5.js`, `caseSchema.js` | Наступне редагування цих файлів по суті | Частково (деякі файли могли торкатись) |
| 5 | Розбіжність clamp-логіки splitPdf vs handleSplit | Коли DP v2 підключатиме `documentBoundary` свідомо | НІ — splitPdf лишається досл. salvage |
| 6 | Doc-drift `time_entry capture-method` enum: документація ≠ код | Окремий doc-sync TASK | НІ |
| 7 | Мертвий рядок `const tenant = getCurrentTenant ? null : null;` у `ACTIONS.add_time_entry` | Перший fail-репорт або підключення реального caller'а | НІ — `add_time_entry` не у hot path |
| 8 | Неконсистентність `update_case_field` повертає `{error}` без `success:false` | Окремий normalization TASK | НІ |
| 9 | `prepareFile` dead code підтримує dead-code `{false && (…)}` | Cleanup-TASK старої inline-модалки CaseDossier | НІ |
| 10 | Назва `tests/integration/drag-n-drop.test.js` історична після видалення drop-queue UI | Наступне редагування файла по суті | НІ |
| 11 | Латентна #11-колізія `ecitsAutoProcess` (enum) vs `autoProcessIncoming` (boolean) | Коли `autoProcessIncoming` отримає першого реального споживача АБО settings-UI ЄСІТС | **Так, частково — settings UI підвкладка існує як placeholder.** Конвергенція ще не зроблена |
| 12 | Debug `console.log("executeAction OK: ...", params, result)` у `actionsRegistry.js:1678` | Окремий debug-cleanup | НІ |
| 13 | `DocumentPipelineProvider`: executor `useMemo` пересоздається щорендер App | Профілювання продуктивності АБО окремий TASK | НІ — behavior-neutral |
| 14 | Дедуп документів — metadata-евристика (name+pageCount), не контент-хеш | Наступний schemaVersion bump | НІ |
| 15 | Перемикач PDF↔Текст у в'юері CaseDossier — TXT існує, UI не показує | G1 (page-precise TXT) — **тригер спрацював у Smart Triage BUGFIX** | **ТАК — тригер спрацював, але UI кнопки досі немає у в'юері CaseDossier** (окремо від Ф-19 — це ОКРЕМА фіча, інший виклик) |
| 16 | Інтеграція `cleanForReading` зі slice — для нарізаних чистка не застосовується | Після підтвердження сирого slicing на Брановському | **Так, тригер спрацював** — рішення Варіант 1/2/3 ще не прийнято |
| 17 | HEIC pre-step перед image_merge | ≥2 випадки `image_merge_failed` на HEIC/PDF image-only | НІ — поки один кейс (паспорт громадянина Брановського) |
| 18 | Подвійна риска прогрес-бару у `GlobalProgressScreen.jsx` | Наступне редагування файла або UI-cleanup | НІ |
| 20 | **Phase B forward-fix** — P1 регресія, гілка `phase-b-Sw2NH` збережена для діагностики | Коли потрібна додаткова швидкість на 200-250pp томах + є час на Provider-int тест 25-doc | НІ — Phase A швидкість прийнятна |

Закриті свіжо (не активні): #3 (rename), #19 (D1 збагачений дайджест —
закрито 2026-05-22), #21 (ToC детектор — закрито 2026-05-22).

---

## 3. Окремо: жовті і помаранчеві

**🟡 Жовті** — реалізовано, тільки юніт-тести АБО Provider-mock, без
реального підтвердження адвоката на планшеті:
- Ф-1 (нарізка single PDF — реально валідовано на 2 справах ~85-93% і
  35%; для Гілки B без реєстру нового підтвердження після ToC немає)
- Ф-4 (fragment_reconstruct — Provider-int є, реальної справи з cross-
  file склейкою не запускали)
- Ф-15 (Розпізнати текст модалка — нема інтеграційного тесту, адвокат
  не тестував)
- Ф-16 (Стиснути файл(и) модалка — нема інтеграційного тесту, адвокат
  не тестував)
- Ф-17 (TXT page-precise — є dp-text-slice тест, але реальне
  підтвердження адвокатом ТІЛЬКИ непрямо через перемикач Скан/Текст)
- Ф-18 (дублікати — є тест, адвокат бачив decision; risk хибно-позитив
  на однакових назвах різних документів)
- Ф-21 (прогрес-індикація — реалізовано, борг #18 косметика)

**🟠 Помаранчеві** — реалізовано, конкретний ризик зламано:
- Ф-2 (ZIP розпак) — `createIntakeWithUnpack` НЕ ІМПОРТУЄТЬСЯ Provider'ом
  → у production INTAKE override відсутній; ZIP-вхід проходить як один
  не-розпакований файл
- Ф-3 (ЗМІШАНИЙ ВХІД) — **немає інтеграційного тесту; той самий
  кореневий ризик що Ф-2** (Provider не підключив unpack) → мікс
  PDF+ZIP+image у production не розпакує ZIP
- Ф-5 (image_merge у DP v2) — нема UI правок (порядок/поворот/кроп) до
  confirm; ImageMergePanel живе лише в AddDocumentModal
- Ф-6 (RTF/ODT/XLSX/PPTX) — у dropzone-hint анонсовано, реально
  passthrough без warning у UI
- Ф-9 (`cleanForReading`) — реалізовано тільки для add_as_is fallback,
  для slice (95% реальних кейсів) тумблер не має ефекту (борг #16)
- Ф-22 (Resume у UI) — backend готовий, **UI integration відсутня**;
  після збою адвокат не отримує діалог «Продовжити обробку»

---

## 4. Пріоритет перевірки для адвоката

Впорядковано від найважливішого до другорядного:

1. **Ф-3 (ЗМІШАНИЙ ВХІД)** — головний сценарій реальної роботи
   (PDF+ZIP+фото одночасно). Найвищий ризик за 3 тижні без тестів +
   ризик що Provider не підключив unpack.
2. **Ф-2 (ZIP розпак)** — окремо від Ф-3, щоб ізолювати чи проблема в
   ZIP сама по собі чи лише в міксі. Висока ймовірність що **Provider
   взагалі НЕ розпаковує ZIP** (відсутній override INTAKE).
3. **Ф-1 (нарізка single PDF без реєстру)** — після закриття боргу #19
   (Гілка B сигнали) реального прогону на новому томі НЕ було.
4. **Ф-15 («Розпізнати текст»)** — adverse: модалка може зависнути на
   великому файлі без UI timeout.
5. **Ф-16 («Стиснути файл(и)»)** — кнопки Drive/Download реальні;
   email/messenger явно disabled.
6. **Ф-17 (TXT page-precise)** — перевірити на конкретному документі що
   `.txt` відповідає його PDF.
7. **Тумблери Зони 2:**
   - Ф-9 `cleanForReading` — реалізовано частково (тільки fallback).
   - Ф-7, Ф-8, Ф-10, Ф-13, Ф-14, Ф-11, Ф-12 — заглушки, перевірити що
     адвокат розуміє: вмикання нічого не робить, треба прибрати з UI
     або пометити «У розробці» (окреме рішення, не цей TASK).
8. **Ф-22 (Resume у UI)** — окрема історія, перевірити що після збою
   нічого не пропонується продовжити (підтвердження ризику).
9. **Ф-4 (fragment_reconstruct)** — перевірити що склейка з 2 PDF
   працює і що автоматично, без propose+confirm (підтвердження
   ризику).
10. **Ф-5 (image_merge)** — тест на iPad з HEIC фото.
11. **Ф-6 (RTF/ODT)** — підтвердити що ці формати реально не
    конвертуються.
12. **Ф-19, Ф-20** — sanity check після Phase A (мають працювати).
13. **Ф-23 (ECITS)** — sanity check що підвкладки в дозвіленому
    «У розробці» стані.

---

## 5. Стан гілок і боргів

### Гілки на origin (не змержені в main, або з застрягшими комітами)

- `claude/optimize-dp-pipeline-phase-b-Sw2NH` HEAD `7491b92` — Phase B
  пост-mortem (P1 регресія, відкочено в main). Збережена для діагностики
  + forward-fix.
- `claude/dp-v2-honest-audit-BU2ZY` — поточна гілка цього аудиту.

Інші ~46 `claude/*` гілок — історичні артефакти попередніх TASK, коміти
змержено в main, гілки на origin не очищені.

### Активні tracking_debt записи

Див. Ф-25 вище — 17 активних записів (#1, #2, #4, #5, #6, #7, #8, #9,
#10, #11, #12, #13, #14, #15, #16, #17, #18, #20). Тригери спрацювали
де-факто для #11 (частково), #15, #16, #20 (Phase B — спрацював через
поспішну Provider-валідацію без 25-doc integration тесту). Решта —
тригери ще не настали.

---

## 6. ЧЕСНИЙ ПІДСУМОК — на скільки % DP v2 РЕАЛЬНО готовий

### Розподіл по 25 функціях

- Зелених (🟢): **2** (Ф-19, Ф-20)
- Жовтих (🟡): **7** (Ф-1, Ф-4, Ф-15, Ф-16, Ф-17, Ф-18, Ф-21)
- Помаранчевих (🟠): **6** (Ф-2, Ф-3, Ф-5, Ф-6, Ф-9, Ф-22)
- Червоних (🔴): **8** (Ф-7, Ф-8, Ф-10, Ф-11, Ф-12, Ф-13, Ф-14, Ф-23)
- Інформаційних (без статусу): **2** (Ф-24, Ф-25)

### Чесна оцінка готовності до щоденного використання адвокатом

**~30-40%.**

Архітектурно — pipeline побудований правильно, всі основні стадії на
місці, диригент заморожений, Triage є, persist є, дедуп є, page-precise
TXT є, прогрес-індикація є, перемикач Скан/Текст у в'юері працює.

АЛЕ для **щоденної** роботи адвоката критично важать:
1. **Змішаний вхід** (Ф-3) — не покритий тестами і ймовірно ЗЛАМАНИЙ у
   Provider'і (unpack не підключено в stageOverrides). Це означає що
   найпоширеніший сценарій («кинь усе разом») реально не працює.
2. **8 тумблерів Зони 2 з 8 фактично 1 реалізований** (cleanForReading,
   і той — частково). Адвокат бачить 8 опцій, реально 7 з них
   нічого не роблять.
3. **Resume** — після першого ж збою на планшеті адвокат не отримає
   діалог продовження, _temp на Drive засмічується орфанами.
4. **Якість на томах без реєстру (як Брановський 65 стор.)** — ~85-93%
   на одній справі. На нову справу без реєстру **гарантій нема** — тест
   на новому реальному томі після закриття #19 не проведено.
5. **propose→confirm UI Зони 3** — заявлено в TASK_smart_triage, не
   реалізовано (autoConfirm:true завжди); адвокат не може правити план
   до нарізки, не може правити image_merge порядок/поворот/кроп.

### Топ-3 ризики які блокують щоденне використання

1. **Ф-3 (ЗМІШАНИЙ ВХІД) + Ф-2 (ZIP розпак у Provider)** — нема
   інтеграційного тесту mixed-input; конкретний підозрюваний ризик:
   `DocumentPipelineContext.jsx:192-260` ін'єктує лише detectBoundaries/
   extract/confirm/persist override; INTAKE override (createIntakeWithUnpack)
   відсутній → ZIP у живому Provider'і **скоріше за все** проходить як
   один непідтримуваний файл. Це блокер найпоширенішого сценарію роботи.
2. **Ф-9 `cleanForReading` на slice + 6 заглушкових тумблерів
   (Ф-7/8/10/11/12/13/14)** — адвокат не довіряє UI бо тумблери
   нічого не роблять. Це не корекційний баг, а проблема довіри: коли
   тумблер ефекту немає, важче розуміти що **реально** працює.
3. **Ф-22 (Resume у UI)** — після першого ж серйозного збою на
   планшеті (флап мережі / зачинення вкладки на iPad / OOM) адвокат
   губить роботу і не знає що з нею стало. _temp орфани на Drive теж
   проблема (місце).

Інші помітні ризики (поза топ-3 але важливі для розуміння):
- Ф-4 (fragment_reconstruct без propose+confirm) — потенційно адвокат
  не зрозуміє чому DP склеїв «не ті» фрагменти.
- Ф-5 (image_merge без UI правок у DP v2) — повторне Phase B-style
  очікування «має ж бути як в AddDocumentModal».
- Ф-1 на томі без реєстру — після #19 закриття треба прогнати реальний
  Нестеренко або інший >100-pp том БЕЗ реєстру; ризик повторення 35%
  у Гілці B не виключений.

---

**Кінець аудиту.** Без рекомендацій що виправляти — це не план. Адвокат
+ автор спеки самі визначать пріоритети.
