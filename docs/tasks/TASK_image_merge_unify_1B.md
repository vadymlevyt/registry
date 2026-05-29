# TASK 1B — image_merge_unify: N-документна склейка фото в DP (окремий сценарій на вході)

**Дата:** 2026-05-29
**Тип:** продуктова функція DP (Вісь A) + закриття передіснуючої діри інжесту фото + C7
**Гілка розробки:** окрема `claude/*` сесії-виконавця
**Базові документи:**
- `docs/tasks/TASK_image_merge_unify.md` — материнська спека (ПІД-TASK 1B); цей файл її **уточнює і розширює** після виявленої root-cause
- `docs/reports/report_task_image_merge_unify_1A.md` — винос reusable у `components/ImageEditor/` + `services/imageDocument/`
- `docs/reports/report_task_image_merge_unify_1C.md` — deterministicRoute + toggle (див. розділ «ДОЛЯ 1C»)
- `docs/consultations/consultation_dp_product_vision.md` §4.1 — Cheap before Expensive, три ітерації
- `docs/consultations/dp_reuse_and_canonical_patterns_discussion.md` — reuse модалки
**schemaVersion:** без bump

---

## МЕТА

Адвокат закидає N фото в DP (8 фото = 3 документи: паспорт + договір + квитанція).
DP має: розпізнати фото → AI запропонувати **групи (= документи)** → адвокат **править
план** (перетягує фото між групами, обертає, обрізає, прибирає дублі, перейменовує,
ставить тип) → «Виконати» → **N окремих PDF** у справі. Це завершує **Ітерацію 1** для
image-merge: людина-диригент над AI-пропозицією.

Зараз цього немає, і гірше — **фото в DP падають** (`EXECUTOR_THREW: No PDF header
found`). 1B це лагодить **правильно**, не латкою.

---

## ROOT-CAUSE (обов'язково зрозуміти перед роботою)

Чому 8 фото падають у поточному DP:

`streamingExecutor.run` (`src/services/documentPipeline/streamingExecutor.js:178-221`)
ганяє **кожен** файл через **єдиний PDF-OCR-цикл**: вантажить байти як `orig_*.pdf` з
mime `application/pdf` (рядок 190), кличе `streamFile` → `chunkManager.planChunks` →
Worker `pdfInfo(buffer)`. Для JPEG/PNG/HEIC `pdfInfo` кидає «No PDF header found».

Цей OCR-крок іде **до** диригента (до `convertStage` і `triageStage`). Тому:
- `convertStage` (`documentPipeline.js:146`) **уміє** конвертувати фото→PDF, але до
  нього виконання не доходить — крах раніше. До того ж streamingExecutor позначає файли
  `isDriveSource:true`, і `convertStage` для них бере passthrough-гілку.
- **`allImagesRoute` з 1C (triageStage) для реальних фото НЕДОСЯЖНА** — triage іде після
  OCR-краху. 1C.1 для фото — фактично мертвий код.

**Висновок:** інжест DP **не розгалужений за сценарієм** — він завжди PDF-OCR. Сценарій
«склейка фото» існує лише на рівні плану (`route=image_merge`), але не на рівні інжесту.

Правильне рішення (модель адвоката): **вибір сценарію детермінованою логікою на ВХОДІ
DP**, ще до PDF-OCR. Якщо всі файли — зображення → окремий image-конвеєр (як у модалці
`ImageMergePanel`, але з різницею: >1 файл + AI-розкладка по N документах), що **обходить**
`streamingExecutor` PDF-OCR повністю.

---

## PHILOSOPHY CHECK

- **Cheap before Expensive (§4.1):** вибір «це image-сценарій» — детермінований
  (`file.type.startsWith('image/')`, нуль токенів) на вході. AI (Haiku grouper) працює
  ВСЕРЕДИНІ сценарію для розкладки по документах, не НАД.
- **AI-first / диригент:** адвокат бачить AI-пропозицію груп і править ДО виконання
  (§4 візії). Точка для агента (DOC_PROCESSOR_TOOLS) — майбутнє, не зараз.
- **Здоровий організм / Rule of Three:** image-конвеєр будується на вже-винесених
  `components/ImageEditor/` (1A) і сервісах sortation/converter — третій споживач
  активує спільне. Не дублюємо логіку модалки.
- **Додавати, не переписувати:** модалка `ImageMergePanel` лишається недоторканою;
  DP отримує **паралельний** flow на тих самих сервісах.
- **Однозначність (#11):** новий агент `imageDocumentGrouper` — окрема відповідальність
  від `imageSortingAgent` (межі документів vs порядок сторінок усередині).

---

## ЕКСПЕРТНА АВТОНОМІЯ

Код звірений на момент написання, рядки могли зсунутись — **перечитуй перед зміною**.

Сам вирішуєш (фіксуй у звіті):
- Точну форму image-ingest сервісу (новий `services/imageDocument/ingestImages.js` vs
  декомпозиція `multiImageToPdf`). Рекомендація — новий сервіс на тих самих
  під-сервісах (heicToJpeg, ocrService, sortImages, orientationCorrector), щоб не
  чіпати behavior-preserving модалку.
- Структуру UI-компонента workspace (новий `components/DocumentProcessorV2/ImageMergeWorkspace.jsx`
  чи аналог), які саме ImageEditor-частини reuse.
- Промпт `imageDocumentGrouper`.

Узгодь питанням ПЕРЕД реалізацією:
- Будь-яка зміна контракту `ImageMergePanel` (модалка) — заборонено.
- Зміна схеми документа / ACTIONS / registry_data.json.
- Обробка **міксу** (фото + PDF разом) інакше ніж описано в «МЕЖІ SCOPE».

Знахідки «по дорозі» → `docs/bugs/bugs_found_during_image_merge_unify.md` + `tracking_debt.md`.

---

## SEMANTIC CLARITY CHECK (#11)

**`imageDocumentGrouper`** (новий сервіс):
> AI-агент (Haiku), що з масиву розпізнаних фото повертає групи
> `[{ pages:[imgIndex...], type, suggestedName }]` — пропозицію, які фото складають
> ОКРЕМИЙ документ. Відповідає ТІЛЬКИ за межі між документами. Порядок сторінок
> усередині — `imageSortingAgent`. Дублі — `imageSortingAgent` dedup.

Не нашаровувати на `imageSortingAgent` (інший намір — нове ім'я).

**Сценарій (scenario) на вході DP** — детермінований вибір конвеєра за типами файлів,
НЕ маршрут (`route`) у плані. `route=image_merge` лишається тим, чим був (зібрати фото
в PDF). N документів = N викликів image_merge-збірки, не новий route.

---

## ГОЛОВНИЙ ПРИНЦИП 1B (директива адвоката)

**1B = повна копія image-конвеєра модалки + ДОДАНА мультидокументність. Нічого не
винаходити, нічого не дублювати, нарізку PDF НЕ чіпати.**

Модалка `ImageMergePanel` уже робить весь image-конвеєр: HEIC→JPEG → OCR кожного фото
→ сортування → orientation → preview-workspace (drag/crop/rotate через `ImageEditor`,
1A) → `rebuildFromOcrResults` → один документ. DP бере **той самий конвеєр на тих самих
сервісах** і додає **рівно одну річ** — розкладку фото по **N документах** (замість
одного): AI-`imageDocumentGrouper` + N-груповий workspace + `rebuildFromOcrResults` per
група. Усе інше — буквально reuse.

**OCR — спільний (підтверджено):** усі модулі тягнуть `services/ocrService.js` (фасад
planka Picatinny — DocumentViewer, RecognizeTextModal, CaseDossier, multiImageToPdf,
imageSortingAgent, DocumentPipelineContext). DP image-flow тягне **той самий**
`ocrService.extractText` per фото, як модалка (`multiImageToPdf.js:156`). **Нового OCR
НЕ створювати.**

**Нарізку PDF (slicing / pipeline.run) НЕ латати.** Вона лишається як є — там буде
окрема робота пізніше (Фаза 5). Image-сценарій просто **обходить** її стороною.

---

## АРХІТЕКТУРА РІШЕННЯ

```
DP startProcessing (DocumentProcessorV2/index.jsx)
        │
        │  ДЕТЕРМІНОВАНИЙ ВИБІР СЦЕНАРІЮ (на вході, нуль AI):
        ▼
   усі файли image/* ?
        │
   ТАК ─┤───────────────────────────────────┐ НІ (усі PDF / DOCX / мікс)
        ▼                                    ▼
  IMAGE-СЦЕНАРІЙ (НОВЕ, повз PDF-OCR)   pipeline.run (існуючий PDF flow,
   1. ingestImages:                      streamingExecutor + диригент) —
      HEIC→JPEG, OCR кожне фото,          НЕ ЗАЧІПАЄТЬСЯ
      sortImages, orientation
   2. imageDocumentGrouper (Haiku)
      → groups [{pages,type,name}]
   3. UI workspace (Зона 3, reuse
      ImageEditor): N груп, drag між
      групами, crop/rotate/dedup,
      rename, type
   4. «Виконати»:
      для кожної групи →
        rebuildFromOcrResults(orderedIndices=group.pages)
        → PDF → createDocument
        → add_documents
```

**Пауза для правки плану — природна:** image-сценарій зупиняється на кроці 3 (workspace)
і чекає «Виконати». Persist (крок 4) — тільки після кліку. Це **локально для image**,
БЕЗ переробки CONFIRM-стадії диригента (та лишається Фаза 5 для нарізки PDF).

---

## СКЛАДОВІ

### 1B.1 — Вибір сценарію на вході + image ingest (reuse модалкового конвеєра)
**Файли:** `DocumentProcessorV2/index.jsx` (startProcessing); reuse
`multiImageToPdf.js` під-сервісів через спільну точку.

- `startProcessing`: детермінована перевірка — чи всі вибрані файли `image/*`
  (helper `isImageFile` з `ImageEditor/constants.js`). Якщо так → image-flow
  (НЕ `pipeline.run`).
- Image ingest = **ті самі кроки, що модалка** (HEIC→JPEG → `ocrService.extractText`
  per фото → `sortImages` → orientation). Єдина відмінність від `convertImagesToPdf` —
  **не збирати в один фінальний PDF** (бо потрібно N документів): зупиняємось після
  ocrResults/sort, далі групуємо.
- **Реалізація reuse, не дубль:** `multiImageToPdf.convertImagesToPdf` уже містить ці
  кроки інлайн. Винеси їх у спільну функцію, яку викличуть **обидва** споживачі —
  модалка (через `convertImagesToPdf`, що далі робить single-PDF assembly) і DP image-flow
  (що далі робить grouping + per-group rebuild). Тобто **спільний pre-assembly конвеєр**
  + два хвости (single vs multi). НЕ копіювати OCR/sort код у DP — це порушило б «спільний
  OCR» і Rule of Three. Якщо чистий винос ризикує behavior модалки — узгодь зі мною
  ПЕРЕД (модалка має лишитись ідентичною).
- Повертає `{ normalizedFiles, ocrResults, finalOrder, detectedOrientations, warnings }`.

### 1B.2 — imageDocumentGrouper (Haiku, AI usage logged — C7)
**Файл:** `src/services/sortation/imageDocumentGrouper.js`.

- Вхід: `ocrResults` (+ порядок з `finalOrder`).
- Вихід: `{ groups: [{ documentId, pages:[imgIndex...], type, suggestedName }], warnings }`.
- Модель: Haiku через `resolveModel('imageDocumentGrouper')` — додати agentType у
  `modelResolver.SYSTEM_DEFAULTS` (§4.1 візії: групування фото → Haiku).
- **Обов'язково логувати AI usage** (закриває C7): `logAiUsageViaSink({...})` +
  `activityTracker.report('agent_call', {...})`, context `{caseId, module:
  'document_processor', operation:'image_document_grouping'}`. НЕ дублювати поля між
  `ai_usage[]` і `time_entries[]`.
- Тільки межі між документами (#11).

### 1B.3 — DP image-merge workspace UI (Зона 3, reuse ImageEditor)
**Файл:** новий `src/components/DocumentProcessorV2/ImageMergeWorkspace.jsx` (або аналог).

- N візуально розділених груп = N документів. Кожна — `SortableGrid` (reuse
  `ImageEditor/grid/`).
- `Thumbnail` (reuse, HEIC-aware) на кожне фото; badges повороту/дублю/crop.
- **Перетягування фото між групами** — нова орекстрація «1 батч = N документів»
  (стан `Map<imgIndex,{groupId,...}>`; моделі `userRotation`/`cropOverrides` адаптувати
  з модалки на per-group).
- Тап по фото → `PreviewPopup` (reuse): crop/rotate/випрямлення.
- Дії над групою: додати/видалити групу, перейменувати документ, тип (`CATEGORY_OPTIONS`),
  видалити дубль.
- Кнопка «Виконати».

### 1B.4 — Persist на «Виконати»
**Файл:** image-flow orchestration (DP).

- Для кожної групи: `rebuildFromOcrResults({ orderedIndices: group.pages, realFiles,
  ocrResults, detectedOrientations, userRotation, cropOverrides, ... })`
  (`services/imageDocument/pdfRebuild.js`, 1A) → `{ pdfBlob, extractedText, layoutJson }`.
- Завантажити PDF у `01_ОРИГІНАЛИ`, `.txt` у `02_ОБРОБЛЕНІ` (для фото OCR реальний —
  `.txt` потрібен), `createDocument()` (documentFactory), `executeAction(
  'document_processor_agent', 'add_documents', { caseId, documents })`. PERMISSIONS уже
  дозволяють (`actionsRegistry.js:1629`). `addedBy:'user'`, `source:'manual'`.
- Прогрес «Створюю документ k з N», тоді результат у Зоні 3 (як зараз).

---

## ДОЛЯ 1C (важливо — прибрати мертве, не латати)

- **`allImagesRoute` (triageStage, 1C.1)** — для реальних фото недосяжна (крах в OCR
  раніше). Після 1B image-сценарій вибирається на вході → triage для all-images не
  викликається взагалі. **Видалити `allImagesRoute` і його unit-тести** як мертвий код
  (правило: не лишати код після return / недосяжні гілки). Зафіксувати у звіті.
- **`skipPdfSlicing` toggle (1C.2)** — лишається для PDF-наборів (його сенс — не різати
  PDF). АЛЕ: при toggle ON image-сценарій на вході має пріоритет так само (всі фото →
  image-flow). У image-flow toggle ON означає **кожне фото = окремий документ** (без
  AI-групування); OFF → `imageDocumentGrouper` групує. Реалізувати цю розгалуженість у
  image-flow, не в triage.
- **warning-fix (1C.3)** — лишається як є (корисний).

---

## МЕЖІ SCOPE

**1B РОБИТЬ:** all-images сценарій повністю (головний кейс — N фото → N документів).

**1B НЕ РОБИТЬ (out of scope, але без краху):**
- **Мікс фото + не-фото в одному наборі** — НЕ обробляти змішано в 1B. На вході, якщо
  набір змішаний (є і image, і PDF) → показати акуратний toast («Поки що додавайте фото
  і PDF окремими запусками»), НЕ запускати, НЕ падати. Це **межа scope з акуратною
  поведінкою**, не латка-обхід — мікс-конвеєр окремий TASK (занести у `tracking_debt.md`
  з тригером «після 1B»).
- Tool use (C1), AddModal уніфікація (C4), DrivePicker (TASK 4), contextGenerator (TASK 2),
  cleanText винос (TASK 3) — інші TASK'и.
- CONFIRM-стадія диригента для **нарізки PDF** — Фаза 5.
- bump schemaVersion / зміна схеми / нові ACTIONS.

---

## SAAS IMPLICATIONS

- Поля: нових немає. Документи через `createDocument()` (повна SaaS-схема успадковується).
- Permissions: нових ACTIONS немає; `add_documents` уже дозволено `document_processor_agent`.
  `imageDocumentGrouper` — аналітичний AI, не ACTION (не змінює дані).
- Tenant isolation: документи прив'язані до `caseData` (tenant-scoped). Без змін.
- Multi-user: групи — pre-persist пропозиція, team/доступ не зачіпає.

## BILLING IMPLICATIONS

- Нова точка: `imageDocumentGrouper` → `activityTracker.report('agent_call', ...)` (час) +
  `logAiUsageViaSink` (токени). Категорія `case_work` (billable, factor 1.0).
- Існуючий `images_merged` (через convertImagesToPdf у модалці) — не зачіпаємо; DP image-flow
  логує власні точки (OCR/sort вже інструментовані на рівні сервісів — перевірити, не дублювати).
- Master timer: без змін.

## AI USAGE IMPLICATIONS

- Нові виклики: `imageDocumentGrouper` (Haiku). `sortImages` (Sonnet) — існуючий, reuse.
- `resolveModel`: новий agentType `imageDocumentGrouper` → Haiku у `SYSTEM_DEFAULTS`.
- logAiUsage context: `{caseId, module:'document_processor', operation:'image_document_grouping'}`.
  **Закриває C7** для нового агента (логування з народження).
- Tool Use vs JSON: звичайний JSON-промпт-агент (як `imageSortingAgent`), НЕ tool use
  (C1 — окрема фаза).

---

## ACCEPTANCE

- [ ] DP визначає image-сценарій на ВХОДІ (всі файли image/*) детерміновано, БЕЗ AI
- [ ] N фото більше НЕ падають (`No PDF header found` зник) — обходять PDF-OCR
- [ ] `ingestImages` — HEIC→JPEG + OCR кожне фото + sort + orientation, повертає ocrResults/order
- [ ] `imageDocumentGrouper` (Haiku) повертає групи, **логує AI usage** (C7),
      agentType у SYSTEM_DEFAULTS
- [ ] Зона 3: N груп, drag фото між групами, crop/rotate/dedup, rename, type (reuse ImageEditor)
- [ ] «Виконати» → N окремих PDF у справі (через add_documents), `.txt` у 02_ОБРОБЛЕНІ
- [ ] persist ТІЛЬКИ після «Виконати» (пауза-правка для image, локально)
- [ ] toggle ON + усі фото → кожне фото окремий документ (без групування); OFF → grouper
- [ ] мікс фото+PDF → акуратний toast, без краху, без обробки (scope-межа + борг)
- [ ] `allImagesRoute` (1C.1) + його тести видалені як мертвий код; зафіксовано у звіті
- [ ] модалка «Склеїти зображення» — поведінка ІДЕНТИЧНА (не зачеплена)
- [ ] PDF-flow (нарізка, add_as_is, skipPdfSlicing для PDF) — НЕ зачеплений
- [ ] нові тести: ingestImages, imageDocumentGrouper (групування + логування), entry
      scenario selection, persist N-doc, мікс-guard. Усі зелені
- [ ] `npm test` зелений, `npm run build` success

---

## ЩО НЕ РОБИТИ

- ❌ Латати streamingExecutor щоб він «терпів» фото — фото мають **обходити** PDF-OCR,
  а не проходити крізь нього.
- ❌ Чіпати контракт/поведінку модалки `ImageMergePanel`.
- ❌ Обробляти мікс фото+PDF змішано (scope-межа — toast + борг).
- ❌ Лишати мертву `allImagesRoute` «про всяк випадок».
- ❌ Переробляти CONFIRM диригента для нарізки PDF (Фаза 5).
- ❌ Дублювати логіку модалкового image-pipeline — reuse під-сервіси.
- ❌ Кирилиця в `q=` Drive API (#8).
- ❌ Виправляти «попутні» баги — у bugs-файл.

---

## ТЕСТИ

- Нові unit: `ingestImages` (N викликів OCR, порядок), `imageDocumentGrouper`
  (групи + AI usage logged), entry scenario selection (all-images vs mix vs all-pdf).
- Нові integration: image-flow N-doc end-to-end (фото → N add_documents), мікс-guard.
- Видалити тести `allImagesRoute` (код видалено).
- Жоден існуючий тест не падає (особливо модалкові: ImageMergePanel, multiImageToPdf,
  imageMergeRenderer). `npm test` зелений перед push.

---

## ЗВІТ

`docs/reports/report_task_image_merge_unify_1B.md`:
1. Архітектура image-сценарію (вибір на вході, обхід PDF-OCR) — діаграма потоку.
2. Нові файли/сервіси, reuse-точки ImageEditor/imageDocument.
3. Рішення в межах автономії (форма ingestImages, структура workspace, промпт grouper).
4. Доля `allImagesRoute` (видалено + які тести).
5. Числа тестів до/після, зелені + build.
6. Побічні знахідки → bugs/ + tracking_debt (зокрема мікс-конвеєр як наступний).
7. Опис нового DP image-flow для перевірки адвокатом.
8. Git commit confirmation.

Оновити `ARCHITECTURE_HISTORY.md` (TASK 1 завершено), позначити ✓ TASK_1 у
`consultation_combined_roadmap_dp_and_refactoring.md`.

---

## ПЕРЕВІРКА АДВОКАТОМ (після merge + deploy)

1. Справа → «Робота з документами» → закинути 8 фото (2-3 документи), HEIC/JPEG.
2. Обробка йде (без `No PDF header found`), AI пропонує **кілька груп**.
3. Перетягнути фото між групами, обернути, обрізати, перейменувати, тип.
4. «Виконати» → у матеріалах **N окремих PDF** з `.txt`.
5. Toggle «Просто додати файли» ON + фото → кожне фото окремий документ.
6. Мікс фото+PDF → акуратне повідомлення, без падіння.
7. Модалка «Склеїти зображення» — працює як раніше.
8. PDF-нарізка (без фото) — як раніше.

Якщо щось зламано — `git revert`, повідомити.

---

## ГОТОВНІСТЬ

- [x] Root-cause фото-краху встановлено (streamingExecutor PDF-OCR до сценарію)
- [x] Reuse-точки звірено (convertImagesToPdf, ingest під-сервіси, rebuildFromOcrResults, ImageEditor 1A)
- [x] Архітектура: вибір сценарію на вході, обхід PDF-OCR — не латка
- [x] Доля 1C визначена (allImagesRoute видалити, toggle/warning лишити)
- [ ] Затвердження адвоката → передача сесії-виконавцю

**Кінець TASK 1B.**
