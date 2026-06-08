# TASK 4 — Спільний інгест файлів + один DrivePicker + DP «просто додати» + режим «без OCR»

**Дата:** 2026-06-04
**Осі:** A (продуктова — DP-сценарій «просто додати») + B (хаос — C4 ingest-unify) + C (рефактор — §8 DrivePicker).
**Місце в карті:** Фаза 4. **Залежність:** TASK 1 (image_merge_unify, виконано — патерн виносу спільного доведено).
**Гілка:** правило №1 CLAUDE.md (remote → `claude/*`; фолд після підтвердження адвоката — **код+деплой**).
**schemaVersion:** можливий **bump v12** (див. §schemaVersion) — підтвердити на етапі D.
**PHILOSOPHY:** прочитати `CLAUDE.md` + `DEVELOPMENT_PHILOSOPHY.md` перед стартом.

> **Розширення scope проти ROADMAP Частина II.** Початковий блок TASK 4 у ROADMAP обмежувався C4+§8 і прямо лишав «керований OCR» на потім. **Рішення власника 2026-06-04:** режим «без OCR» (через Claude Vision метадані) і DP-сценарій «просто додати» входять у ЦЕЙ таск — бо це одне питання (додавання файлів), і дробити його на кілька спек недоцільно. Ця спека — єдине джерело; ROADMAP §Фаза 4 / Частина II оновити по завершенні.

---

## СУТЬ

«Додати файли в систему» — це **одне питання** з кількома входами (модалка, DP-нарізка, DP-склейка, DP-просто-додати, у майбутньому ZIP). Зараз воно реалізоване **двома паралельними шляхами обробки** і **двома копіями DrivePicker'а**, а чистого «додати готові файли без обробки» в DP **нема**. Зводимо труби в один сервіс, пікери — в один компонент, додаємо DP-сценарій «просто додати» і режим «без OCR».

**Для адвоката:** поведінка наявних шляхів не змінюється (внутрішнє зведення, тести фіксують); з'являються дві нові можливості — «просто додати комбо файлів через DP» і тумблер «без OCR».

## ПРИНЦИП (тонкі оркестратори, спільні сервіси)

Усе, що працює >1 разу → у спільний сервіс; керуючі файли (`index.jsx`, `AddDocumentModal.jsx`, `DP/index.jsx`) лишаються **тонкими оркестраторами** — лише дротують спільне.

## БУДІВЕЛЬНІ БЛОКИ — що Є / що НОВЕ

| Блок | Стан | Дія в таску |
|---|---|---|
| `converterService.convertToPdf` (HTML/DOCX/image/HEIC→PDF) | ✅ є | переюз як є |
| Стиснення: реальний рушій `processFile` у стенді `public/lab/pdf-recompress.html` | стенд ✅ / у застосунку ⬜ | перенести як є у спільний сервіс (етап E); НЕ `compressPdf` (слабкий re-save) |
| `downscaleImage` (~2400px, авто у `prepareImagesForMerge` крок 1.5) | ✅ є | переюз як є |
| `streamingExecutor` (пачковий конвеєр: RAM-чанки/resume/нарізка) | ✅ є | основа `ingest.js` |
| `claudeVision.js` (рендер сторінок + виклик Claude) | ✅ є (фолбек OCR) | основа режиму «без OCR» (етап D) |
| `ingest.js` — одна труба додавання | ◀ НОВЕ | етап A |
| спільний `DrivePicker` | ◀ дедуп 2 копій | етапи B (винос) + B2 (злиття) |
| DP-сценарій «просто додати» | ◀ НОВЕ | етап C |
| `ocrMode` (full / без-OCR) | ◀ НОВЕ | етап D |

## РЕЖИМИ OCR (два, не три)

- **`full`** — Document AI повний OCR + артефакти у `02_ОБРОБЛЕНІ` (`.txt`/лейаут за наявною політикою clean_text V2 — поважати `getDocumentText`, **не відроджувати `.txt` коли є лейаут**) → пошук/контекст/агент.
- **«без OCR» (`none`/light)** — **Claude Vision читає перші 1-2 сторінки → заповнює метадані**; файл лежить **тільки в `01_ОРИГІНАЛИ`**, артефактів у `02` НЕ створюється, рендериться у в'ювері (гортати можна). Пізніше через в'ювер — «Розпізнати» (повний) або (Фаза 5) — на нарізку.

`metadata` (частковий OCR через Document AI) як окремий третій режим **НЕ робимо** — Vision-по-2-сторінках і є його чесна форма.

### Повна відмова від `.txt` (закриває §7.1) — наскрізна вимога

Інгест **не пише `.txt` ніде**. Підстава (звірено з кодом): конвертер DOC/HTML іде через `pdfLibHtmlRenderer.htmlToPdfViaPdfLib` → **searchable PDF** (текстовий шар у самому PDF), а scanned уже лишає лише layout (V2-A2). Отже:
- **scanned** → лише `.layout` (вже так);
- **searchable PDF** (просто додали) → текст із текстового шару PDF **на вимогу** через `ocrService.extractText`/`getDocumentText`;
- **DOC/HTML** → конвертер дає searchable PDF → те саме (едж «DOCX/HTML — `.txt` єдине сховище» з §7.1 **зникає**).

**Точка верифікації:** перед прибиранням write-точки `.txt` переконатися, що `getDocumentText`/`extractText` для searchable дістають текст із **текстового шару PDF** (pdfjsLocal), а не з фізичного `.txt`; жоден споживач (contextGenerator helper-first, агент, в'ювер) не залежить від наявності `.txt`. Старі `.txt` на Drive **лишаються** (backward-compat: `getDocumentText` читає layout→`.txt`→екстракт); разова міграція старих `.txt` — **опційно, окремо** (поза цим таском).

### Vision-метадані (перші 1-2 стор. → проти канонічної схеми)

Промт повертає JSON; усі поля — **пропозиції, адвокат може поправити** (недетермінованість):

| Поле | Джерело з 2 стор. |
|---|---|
| `date` | дата документа (зазвичай 1-ша стор.) |
| `category` | тип (pleading/motion/court_act/evidence/contract/correspondence/identification/other) |
| `author` | ours/opponent/court/third_party (наш↔опонент підтверджує адвокат) |
| `name` | запропонована назва із заголовка |
| gist (1-2 речення «про що») | у **extended** `extractedTextSummary` — НЕ вижимка-для-контексту, НЕ юр-зміст |

Механічно (без Vision): `documentNature` (наявність текстового шару), `pageCount`, `size`.

Модель — Haiku 4.5 (зір). Додати agentType (напр. `metadataExtractor`) у `modelResolver.SYSTEM_DEFAULTS` (як `textCleaner`/`textDigest`).

## ФАЙЛОВА СТРУКТУРА — до → після (з рядками; «після» — оцінки)

**ДО:**
```
CaseDossier/AddDocumentModal.jsx ..... 1039  (UI ~320 + DrivePicker-сімейство ~570 + add-логіка)
CaseDossier/index.jsx ................ 3002  (runOcrWithRetryUI ~130 + 2 виклики — ДУБЛЬ-шлях)
DocumentProcessorV2/index.jsx ........ 978   (uses pipeline.run; skipPdfSlicing лише пропуск нарізки, не «just add»)
DocumentProcessorV2/DrivePicker.jsx .. 148   (ДРУГА копія пікера)
documentPipeline/streamingExecutor.js  486
contexts/DocumentPipelineContext.jsx . 356
```

**ПІСЛЯ (цілі):**
```
services/documentPipeline/
  ingest.js .......................... ≈150  НОВЕ: ingestFiles({files, ocrMode, compress, onProgress}) — кличуть модалка+DP
  streamingExecutor.js ............... ≈510  (+гілка ocrMode/compress)
components/DrivePicker/ ............... НОВА спільна тека (дедуп: 570+148 → ~350):
  index.jsx, SourceSwitcher, Breadcrumb, DriveList, DriveListItem, helpers
CaseDossier/AddDocumentModal.jsx ..... ≈320  (UI; кличе ingest + спільний DrivePicker; +тумблери)
CaseDossier/index.jsx ................ ≈2870 (−~130: runOcrWithRetryUI видалено)
DocumentProcessorV2/index.jsx ........ ≈990  (+сценарій «просто додати»; кличе спільні ingest+picker)
DocumentProcessorV2/DrivePicker.jsx .. видалено (злито у components/DrivePicker/)
```
Дедуп: DrivePicker −~370 рядків; `runOcrWithRetryUI` −~130. `AddDocumentModal` 1039→~320.

## ЕТАПИ (один процес; 🔹 = пауза на перевірку перед продовженням)

**A — `ingest.js` (труба в одну).** Фасад `ingestFiles({files, ocrMode:'full', compress:false, onProgress})` поверх `streamingExecutor`; DP переведено на нього (без зміни поведінки). 🔹

**B — винос DrivePicker.** `DrivePickerSection`+`SourceSwitcher`+`Breadcrumb`+`DriveList`+`DriveListItem` з `AddDocumentModal.jsx` → `components/DrivePicker/`. Модалка худне до ~320. (behavior-preserving)

**B2 — злиття пікерів.** `DocumentProcessorV2/DrivePicker.jsx` зведено у той самий `components/DrivePicker/`; обидва (модалка, DP) споживають один; старий файл видалено. **Підхід:** спільне ядро = ОБ'ЄДНАННЯ можливостей (breadcrumb-навігація — багатша за DP-stack, 3 джерела); зовнішня оболонка — проп `presentation: 'inline' | 'modal'` (тонка обгортка над ядром: DP→`modal`, модалка→`inline`); мультивибір — окремий проп `multiFilter: 'images' | 'all'` (модалка→`images`, DP→`all`), а НЕ хардкод «лише зображення». API: `DrivePicker({ presentation, selectionMode, multiFilter, sources, onPick/onPickMulti })`. 🔹

**C (+ дубль-шлях CaseDossier).** На цьому етапі також перевести на `ingestFiles` решту add-callers: `CaseDossier/index.jsx` `pipeline.run`(~2764) + `runOcrWithRetryUI` (щоб зник дубль-шлях, мета C4). **Засторога Claude Vision-фолбеку:** стрім-шлях зараз тільки Document AI, а `runOcrWithRetryUI` міг мати Vision-фолбек — НЕ втрачати його тихо (регресія resilience). Або внести Vision-фолбек у стрім-шлях (краще — Vision усе одно заходить у трубу на D), або свідомо задокументувати відмову. Тепер сам сценарій: розширити **наявний** шлях, а НЕ вводити новий перемикач (правило #11): тумблер уже є — `settings.skipPdfSlicing`, мітка **«Просто додати файли»**, опис «кожен PDF — окремий документ, без AI-нарізки» (`DocumentProcessorV2/index.jsx:787`). Маршрутизація сценаріїв уже детермінована на вході (`~552`): all-image → склейка (авто, фото не ріжуть); PDF/комбо + тумблер ВИМК → нарізка (Triage); тумблер УВІМК → просто додати. Етап C **розширює цей УВІМК-шлях** на: усі типи (HTML/DOC → `converterService`, фото → image-флоу з downscale, PDF searchable — як є, scanned — за `ocrMode`) і **будь-яку комбінацію** файлів за раз. Кожен файл = один документ, без нарізки. Намір «різати/додати» з файлу НЕ виводиться — це явний вибір адвоката (тумблер); опційно — розумний дефолт тумблера по `pageCount` (великий → пропонувати нарізку, малий → просто додати; адвокат перемикає). 🔹

**D — `ocrMode` + «без OCR».** Розетка `ocrMode` у `ingest.js`: `full` (поточна поведінка) + «без OCR» (Vision 2 стор. → метадані, файл лише в `01`, без артефактів). Тумблер у модалці і DP. 🔹

**E — тумблер «стиснути перед обробкою» (ОСТАННІЙ).** Деталі — `docs/consultations/admin_context_compression_wiring.md` + `docs/tasks/TASK_file_tools_compression_doctrine.md`.

> 🚨 **НЕ `compressionService.compressPdf`** — він СЛАБКИЙ (pdf-lib re-save, 1-2%). Реальний рушій — у стенді `public/lab/pdf-recompress.html` (функція `processFile(file, longEdge, quality)`: pdf.js render кожної стор. → JPEG → **pdf-lib `embedJpg`+`addPage`+`drawImage`** → `save`).

Кроки:
1. **Перенести `processFile` ЯК Є** у спільний параметричний сервіс (напр. `services/compression/imageCompressor.js`): єдина адаптація — CDN-бібліотеки стенда → npm `pdfjs-dist`+`pdf-lib` (вже в застосунку), логіка байт-у-байт та сама. Константа `COMPRESSION_PRESETS` = Слабкий ~2200/0.8 · **Середній 1800/0.7 (стандарт)** · Сильний ~1600/0.65 (підлога 1400/0.6; weak/strong — попередні значення). `standaloneCompressor`/`CompressFilesModal` перевести на цей сервіс (слабкий `compressPdf` як «стиснення» прибрати).
2. **`scanned-guard` + pass-through** — ОДНА детекція по системі (та сама, що `documentNature`/scanned): стискаємо лише **скановані PDF (на основі зображень) + зображення**; усе інше (HTML/DOC/текст-PDF) **проходить як є**; пайплайн НЕ падає/не зупиняється; чесний тост «стискаються лише скановані PDF/зображення».
3. **Дротувати `compress`-опцію** (закладена на A, інертна) у трубі — стиснення ПЕРЕД обробкою (нарізкою/додаванням), **фіксований Середній**. **pdf-lib-перебудова (per-page resources) КРИТИЧНА** — інакше нарізка (`copyPages`) тягне всі зображення в кожен чанк → >40 МБ → падіння (доктрина §3.2). Тобто стиснення на вході існує і для того, щоб потім нарізалось.
   - **🛡 ГАРД «стиснення ніколи не збільшує розмір»** (рушій зі стенда цього НЕ має — завжди рендерить до 1800px, проти апскейлу лише `MAX_SCALE=6`, тож помірно-малу сторінку ЗБІЛЬШИВ би): після стиснення порівняти `outBytes` vs `inBytes`; якщо результат **не менший** (файл/зображення вже ≤ цілі — «вже мале/вже стиснуте») → **віддати ОРИГІНАЛ незмінним** (pass-through). На рівні файлу — обов'язково; посторінково — бажано. Стиснення = «зменши або лиши як є», НІКОЛИ не «роздуй».
4. **Тумблери «стиснути»** у **DP** (`compressAll` ~53/909 — під'єднати) **і в модалці** single-add — обидва лише виставляють `compress:true` (дешево, бо труба спільна). Батч-рівень (як «без OCR»); per-файл → борг #56.
5. **Прогноз розміру** — у списку файлів коли тумблер УВІМК: стиснути **семпл перших 1-2 стор.** → екстраполяція × `pageCount` → показати «→ ~X МБ» (+ сума пакету). `processFile` уже віддає `outBytes`. (Останній крок; оцінка з `~`.)

**Межі E (ПОЗА):** вкладка «Інструменти» з UI-пікером 3 пресетів (§7.4) — лише UI поверх **готового** сервісу, потім; одиночне зображення→PDF (`converter/imageToPdf` 0.92, прогалина); per-файл вибір (#56); склейку НЕ чіпати (downscale є); борг #40. 🔹

Кожен етап: behavior-preserving (крім нових можливостей D/E), тести зелені перед наступним.

## МЕЖІ — що НЕ робимо / відкладено (з тригерами)

- **НЕ зливати UI модалки і DP** — модалка лишається легкою (один файл швидко); DP багатий. Спільна лише логіка (ingest) + пікер.
- **DocumentList** (вибір *наявних* документів: реєстр/архів/контекст) — **інша тема (керувати наявним, не додавати)** → §7.3, не сюди.
- **ZIP-розпак** — майбутній вхід, переюзує `ingest`. Тригер: коли візьмемось за zip.
- **Нарізка / повторний OCR ВЖЕ доданого файлу** (том, доданий «без OCR», потім на повний OCR/нарізку) — шов «Розпізнати» у в'ювері вже є; повноцінний запуск на нарізку наявного документа → **Фаза 5** (проміжний екран нарізки).
- **Позначення «том»** (debt #52) — не тут.
- **`metadata`-режим через Document AI partial** — не робимо (Vision і є його форма).
- НЕ відроджувати `.txt` для сканів (поважати `getDocumentText` / clean_text V2).
- НЕ міняти `CONVERT_DOCX_TO_PDF` через UI; НЕ викликати Document AI на конвертованому з DOCX/HTML PDF (він searchable).

## SAAS IMPLICATIONS
- `ingest.js` — tenant-agnostic сервіс; усі створення документів — через `createDocument()` (tenantId/ownerId з контексту), як зараз. Жодних нових сутностей без tenantId.
- Vision-метадані пишуться у ті самі канонічні поля документа (не нова структура).
- `ocrMode` — не tenant-залежний прапор; це режим обробки на додаванні.

## BILLING IMPLICATIONS
- **Не загубити інструментацію** при переході з `runOcrWithRetryUI` на `ingest.js`: `activityTracker.report` (час) + `logAiUsage`/`ai_usage` (токени) на всіх AI-викликах (Document AI, Vision).
- Режим «без OCR» = Vision-виклик на 1-2 стор. → логувати як `ai_usage` (agentType `metadataExtractor`, дешево).
- Стиснення — CPU-операція, не AI → без `ai_usage`.
- DP «просто додати» з `ocrMode:full` нараховується як звичайна обробка; «без OCR» — лише дешевий Vision.

## schemaVersion / міграція
- Метадані «без OCR» лягають у **наявні** канонічні поля (`date`/`category`/`author`/`name`) + extended `extractedTextSummary` — **без bump**.
- **Підтвердити на етапі D:** чи треба маркер рівня OCR (напр. `ocrLevel: 'none'|'full'` або вивід з відсутності артефактів). Якщо НОВЕ поле → **bump v12** + ідемпотентна міграція (default `'full'` для існуючих) + бекап (правило #6). Якщо виводиться з наявних даних — без bump. Рішення зафіксувати у звіті.

## ТЕСТИ (по етапах)
- A: одиночне додавання через `ingest.js` дає той самий результат, що `runOcrWithRetryUI` (артефакти, метадані).
- B/B2: пікер працює в модалці і DP (browse/pick single+multi); поведінка та сама; старого файлу нема.
- C: DP «просто додати» — комбо PDF/HTML/DOC/image → кожен у PDF, без нарізки; артефакти коректні (HTML/DOC searchable, scanned PDF за ocrMode).
- D: «без OCR» — файл у `01` без артефактів у `02`; Vision повертає метадані; рендер у в'ювері; білінг (ai_usage) не загублено.
- E: «стиснути» — PDF меншає, нарізка не ламається; зображення downscale.
- `.txt`: інгест НЕ створює `.txt` (scanned/searchable/DOC/HTML); `getDocumentText`/`extractText` дають текст searchable з PDF на вимогу; старі `.txt` читаються (backward-compat); жоден споживач не зламався.
- Інтеграційні: `createDocument`/`executeAction`-контракт незмінний; білінг-інструментація присутня.

## ДЖЕРЕЛА В РЕПО
- `docs/ROADMAP.md` — §Фаза 4, §7.1 (артефакти `.txt`/лейаут/`getDocumentText`), §7.2 (керований OCR — тут частково реалізується «без OCR»).
- `docs/consultations/consultation_large_files_refactoring_roadmap.md` — §8 (мокап спліту AddModal 1039→330+компоненти).
- `docs/diagnostics/diagnostic_dpv2_call_trace_and_chaos.md` — точка C4 (два паралельні шляхи).
- `docs/consultations/handoff_2026-06-04_artifacts_reorg_context_ocr.md` — реальність артефактів (поважати).

## СТАРТОВІ ТОЧКИ В КОДІ (виконавець гляне сам)
- `src/components/CaseDossier/AddDocumentModal.jsx` — модалка + inline DrivePicker (`DrivePickerSection`~398, `SourceSwitcher`~734, `Breadcrumb`~782, `DriveList`~829, `DriveListItem`~895); режими `MODE_SINGLE`/`MODE_MERGE`.
- `src/components/CaseDossier/index.jsx` — `runOcrWithRetryUI`~482 (~130 рядків, 2 виклики: 2326, 2898).
- `src/services/documentPipeline/streamingExecutor.js` — `run`/`streamFile` (вхід для 1 файлу перевірити).
- `src/contexts/DocumentPipelineContext.jsx` — wiring (`skipPdfSlicing`~186).
- `src/components/DocumentProcessorV2/index.jsx` — `skipPdfSlicing`~57/787, image-merge sub-flow~250.
- `src/components/DocumentProcessorV2/DrivePicker.jsx` (148) — друга копія пікера.
- `src/services/converter/converterService.js` — `convertToPdf`.
- `src/services/compressionService.js` — `compressPdf`; `src/services/imageDocument/downscaleImage.js` — `downscaleImage`.
- `src/services/ocr/claudeVision.js` — рендер сторінок + виклик Claude (цикл має `startPage` → обмежити до 1-2).
- `src/services/modelResolver.js` — `SYSTEM_DEFAULTS` (додати `metadataExtractor`→Haiku).

## ЗДАЧА СЕСІЇ-ВИКОНАВЦЯ
Спека (ця) → код на гілці по етапах (паузи на 🔹) → тести зелені на кожному етапі → `npm run build` success → перед `main`: зведення змін + підтвердження адвоката (код+деплой, правило №1). Звіт `docs/reports/report_task_4_ingest_drivepicker_unify.md`; оновити ROADMAP §Фаза 4/Частина II (зняти позначки з коду).

**Кінець TASK 4.**
