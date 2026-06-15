# AUDIT — DP СЦЕНАРІЙ 2: СКЛЕЙКА ФОТО (image merge)

**Дата:** 2026-06-15
**Тип:** read-only аудит (PART 1 повного аудиту DP, §3.1.2 TASK_dp_full_audit.md)
**Скоуп:** окремий самодостатній шлях DP «склейка фото» — НЕ через pdf-нарізку.
Від вводу (адвокат кидає N фото) до результату (M документів у справі).
**Метод (§1.2-bis):** кожне твердження звірене з кодом `file:line`. Де код суперечить
докам/карті — істина в коді, розбіжність окремим рядком (§6).

> **КЛЮЧОВА ДИЗ'ЮНКЦІЯ, ЯКА РОЗВ'ЯЗУЄ ПЛУТАНИНУ.** У коді існують ДВА різні «image
> merge» шляхи з різними виконавцями:
> 1. **DP image-merge editor** (ЦЕЙ аудит) — `startImageMergeProcessing`
>    (`DocumentProcessorV2/index.jsx:414`), обходить `pipeline.run`, веде у
>    `DpImageMergeEditor`, фінал через `rebuildFromOcrResults` (`pdfRebuild.js`).
>    Тригер: `isAllImagesInput() && !skipPdfSlicing` (`index.jsx:718`).
> 2. **Route `image_merge` всередині Triage/streaming** — `renderImageMergeToPdf`
>    (`sortation/imageMergeRenderer.js:33`), викликається з `persist`-стадії
>    `DocumentPipelineContext.jsx:199-202`, коли AI Triage вирішив склеїти фрагменти.
>    Це частина нарізкового шляху, НЕ цей сценарій.
>
> Цей звіт аудитує №1. №2 згадується лише там, де треба не сплутати.

---

## 1. ЗАГОЛОВОК / SCOPE / МЕТОДОЛОГІЯ

Шлях склейки фото в DP v2 — це гілка, яку додано TASK 1B `image_merge_unify`, щоб
обійти крах стрім-екзекутора на фото («No PDF header found» — коментар
`index.jsx:387-390`). Коли весь батч — зображення, DP перехоплює запуск ДО
`pipeline.run` і веде у власний N-документний редактор. PERSIST лише на «Виконати».

Усі `file:line` — від реального коду на гілці `claude/dp-full-audit-findings`.

---

## 2. КАРТА ПОТОКУ «СКЛЕЙКА ФОТО» — ВІД ВВОДУ ДО РЕЗУЛЬТАТУ

| # | Станція | Що робить (простими словами) | Файл:рядок | Вердикт |
|---|---------|------------------------------|-----------|---------|
| 0 | **Ввід** | Адвокат додає файли (device drag/picker або Drive picker). `selected[]` тримає device-файли (`file`) і Drive-файли (`driveId`). INBOX-файли — окремо. | `index.jsx:197-224` (addDeviceFiles/addDriveFiles) | ✅ |
| 1 | **Двері роутера** | `isAllImagesInput()` = всі `selected` — image AND `inboxSelected.length===0`. Якщо так і `!skipPdfSlicing` → `startImageMergeProcessing()`, `return`. | `index.jsx:391-398`, `718-721` | ✅ (з дірою — §3.5-B нижче) |
| 2 | **Матеріалізація у File[]** | device → `s.file`; drive → `driveRequest(.../?alt=media)` → blob → `File`. Drive-fail → toast + abort. | `index.jsx:426-445` | ✅ |
| 3 | **Phase 1 — prepareImagesForMerge** | HEIC→JPEG → downscale (≤maxDim) → **OCR кожного фото 1 раз** (Document AI через ocrService, concurrency 3) → orientation detection (EXIF→DocAI→aspect, БЕЗ застосування). Усі помилки не-фатальні. | `index.jsx:457-461`; `prepareImagesForMerge.js:202-327` | ✅ |
| 4 | **Phase 2 — grouper (Haiku)** | `groupImagesIntoDocuments` — AI межі МІЖ документами по OCR-тексту. Fallback при fail/невалідний JSON → один документ з усіх фото + toast. | `index.jsx:466-491`; `imageDocumentGrouper.js:274-380` | ✅ |
| 5 | **Phase 3 — per-group sort+dedupe** | Для кожної групи >1 фото — `sortImageDocument` (обгортка над `sortImages`, Sonnet): порядок сторінок + дублі. Fallback (null) → лишає порядок групи. | `index.jsx:506-557`; `sortImageDocument.js:51-120` | ✅ |
| 6 | **Редактор (адвокат-диригент)** | `DpImageMergeEditor`: N контейнерів, drag між групами, поворот/обрізка/дублі/назва/тип/дата/ключовий. Edge detection (детермінований, не AI) у фоні. PERSIST НЕ відбувається. | `index.jsx:866-886`; `DpImageMergeEditor.jsx` весь | ✅ |
| 7 | **«Виконати» — rebuild PDF** | На кожну групу `rebuildFromOcrResults`: orderedIndices → `computeRenderedBlob` (спільний рендер) → jsPDF → PDF blob + merged layout (page._text, без image/tokens). **OCR НЕ ПОВТОРЮЄТЬСЯ.** | `index.jsx:594-616`; `pdfRebuild.js:11-121` | ✅ |
| 8 | **Upload + 01/02** | PDF → `uploadBytesToDrive(01_ОРИГІНАЛИ)`. Layout → `ocrService.writeLayoutArtifact(02_ОБРОБЛЕНІ)` (best-effort). `.txt` НЕ пишеться (V2-A2). | `index.jsx:613-634` | ✅ |
| 9 | **createDocument + add_documents** | `createDocument({... addedBy:'user', source:'manual', documentNature:'scanned', folder:'01_ОРИГІНАЛИ'})` → `onExecuteAction('document_processor_agent','add_documents',{caseId,documents})`. | `index.jsx:636-669` | ✅ |
| 10 | **Подія контексту** | Вручну `eventBus.publish(DOCUMENT_BATCH_PROCESSED, …)` — бо обхід pipeline.run не емітить її автоматично. | `index.jsx:678-690` | ✅ |
| 11 | **Прибирання** | `setImageMerge(null)`, `setSelected([])`, `loadInbox()`. Жодних tmp на Drive (фото не лягають у `_temp` — все в пам'яті/blob). | `index.jsx:692-695` | ✅ |

**Підсумок результату:** N фото → M документів, кожен = PDF (01_ОРИГІНАЛИ) + layout
(02_ОБРОБЛЕНІ) + канонічний запис. БЕЗ tmp-теки, БЕЗ повторного OCR.

---

## 3. СТАНЦІЇ ДИРИГЕНТА — ВИРОК ПО-ШЛЯХОВО (§3.5-A)

**Критичний висновок:** на шляху склейки фото **диригент-стадії (convertStage /
triageStage / persistStage / streamingExecutor) НЕ беруть участі взагалі** — шлях
свідомо обходить `pipeline.run` (`index.jsx:389`, `718-721`). Тобто питання
«convertStage жива чи passthrough тут» некоректне: її на цьому шляху **немає в
графі викликів**.

| Стадія диригента | Стан НА ЦЬОМУ ШЛЯХУ | Доказ |
|------------------|---------------------|-------|
| `convertStage` | **відсутня** (не викликається; конвертацію HEIC робить prepareImagesForMerge сама) | `index.jsx:718-721` (обхід pipeline.run); HEIC у `prepareImagesForMerge.js:66-82` |
| `triageStage` (Smart Triage, Haiku) | **відсутня** — замість неї `imageDocumentGrouper` (інший агент, інший промпт) | `index.jsx:466-488` |
| `detectBoundariesV2/V3`, `analyzeViaToolUse` | **відсутні** (це покоління меж нарізки, не фото) | нема імпорту в `DocumentProcessorV2/index.jsx` |
| `persistStage` / `splitDocumentsV3` | **відсутня** — PERSIST робить `handleImageMergeSubmit` напряму (upload+add_documents) | `index.jsx:574-696` |
| `streamingExecutor.streamFile` | **відсутня** (саме її обхід — мета TASK 1B) | `index.jsx:387-390` |

Відповідно фото-шлях має **власну, паралельну оркестрацію** замість стадій-диригента.
Це окремий шлях, а не реюз диригента (на відміну від `renderImageMergeToPdf`, який
ЖИВЕ як виконавець route у persist-стадії нарізкового шляху — `DocumentPipelineContext.jsx:199`).

---

## 4. СПІЛЬНИЙ РЕНДЕР-ШЛЯХ (правило філософії §5 «Спільний рендер UI»)

**ВИКОРИСТОВУЄ спільний шлях — підтверджено.**

- Фінальна збірка PDF іде через **спільний** `computeRenderedBlob`
  (`pdfRebuild.js:53,79-82`) — той самий, що модалка `ImageMergePanel`
  (`ImageMergePanel/index.jsx:583`). Один файл `pdfRebuild.js` обслуговує обидва.
- Сітка редактора показує **запечені** blob'и через спільний хук `usePreviewUrls`
  (`DpImageMergeEditor.jsx:216-225`), який під капотом теж кличе `computeRenderedBlob`.
- Crop-state, displayItems, duplicate-membership — спільні модулі
  (`cropState.js`, `grid/displayItems.js`) — інлайн-копії видалено (борг #33),
  коментарі `cropState.js:18` фіксують «PreviewView == DpImageMergeEditor».
- Thumbnail/RenderItem/PreviewPopup/ContextMenu — реюз з `ImageEditor/`
  (`DpImageMergeEditor.jsx:37-54`).

**Регресія 2026-05-29 (crop показувався у попапі, але не в сітці DP) — ВИПРАВЛЕНА.**
Доказ: `DpImageMergeEditor.jsx:212-225` явно коментує «баг 2026-05-29 round 2: для
сітки Zone 3 показуємо ЗАПЕЧЕНІ baked blob'и так само як модалка … СПІЛЬНИЙ хук
usePreviewUrls». Тест `tests/unit/DpImageMergeEditor.test.jsx:74` («preview generation
(фікс багу обрізки у сітці)»). `previewUrls=null` (корінь регресії) більше не
встановлюється. **Concern філософії-правила знятий на цьому шляху.**

---

## 5. AI-ТОЧКИ В СКЛЕЙЦІ ФОТО

| AI-точка | Модель / resolveModel | Механізм виклику | Білінг (ai_usage + activityTracker) | Доказ |
|----------|----------------------|------------------|-------------------------------------|-------|
| **OCR кожного фото** | Document AI (ocrService, fallback claudeVision) | `ocrService.extractText` (провайдер-патерн) | OCR-білінг у самому ocrService; тут `skipCache:true, skipCacheWrite:true` | `prepareImagesForMerge.js:161-179` |
| **Grouper (межі документів)** | `imageDocumentGrouper` → **Haiku** (`claude-haiku-4-5-20251001`) | **РУЧНИЙ `fetch(ANTHROPIC_API_URL)`** — НЕ через `callAgent` | `logAiUsageViaSink('image_document_grouper')` + `activityTracker.report('agent_call')`, паралельно, у try/catch | `imageDocumentGrouper.js:237-260` (fetch); `296` (resolveModel); `314-342` (білінг); `modelResolver.js:36` |
| **Sort per-group (порядок+дублі)** | `imageSorter` → **Sonnet** (`claude-sonnet-4-20250514`) | **РУЧНИЙ `fetch`** в `imageSortingAgent.js:325` — НЕ через `callAgent` | через обгортку `sortImageDocument`: `logAiUsageViaSink('image_sorter')` + `activityTracker.report` лише коли `options.billing` передано (DP передає) | `sortImageDocument.js:89-117`; `imageSortingAgent.js:63,325-329`; `modelResolver.js:26` |
| **Edge detection (обрізка)** | — **НЕ AI** (детермінований brightness/variance/Sobel на canvas) | чистий JS, нуль токенів | нема білінгу (не AI) | `edgeDetection.js:47-194`. ⚠ Розбіжність: шапка `edgeDetection.js:5` каже «AI визначає межі» — насправді НЕ AI (§6). |

**B2-інвентар (§3.5-E):** ні grouper, ні sort **НЕ перенесені на `callAgent`** — обидва
роблять ручний `fetch` до Anthropic. `callAgent.js:50-51` вже має для них мапінг
(`imageSorter`, `imageDocumentGrouper`), але код їх **не використовує** → це робота B2.

**Подвійний облік:** не виявлено. `imageDocumentGrouper` логує один раз (грубо:
`logAiUsageViaSink` для токенів + `activityTracker` для часу — це паралельні структури,
не дубль). `sortImageDocument` логує лише коли `billing` переданий; DP передає
(`index.jsx:528-532`), модалка — ні (її білінг — `images_merged` у converterService).
**Однак** `add_documents` отримує ЩЕ й generic-білінг у executeAction-hook (не в
SYSTEM_ACTIONS_NO_BILLING / SOURCE_AWARE) — це облік акту додавання, окремий від
AI-обліку, тож не дубль.

---

## 6. РЕАЛЬНЕ vs ДОКУМЕНТОВАНЕ — РОЗБІЖНОСТІ (кожна окремим рядком)

1. **`edgeDetection.js:5-7` заявляє «AI визначає межі документа»** — насправді
   детермінований алгоритм (brightness→variance→Sobel projection, `edgeDetection.js:130-194`),
   жодного виклику моделі. Коментар вводить в оману («AI» хибне).
2. **Карта §2 baseline TASK каже «вірний текст з лайауту на вимогу, .txt не пишемо»**
   — на фото-шляху ПІДТВЕРДЖЕНО: `.txt` не пишеться, лише layout (`index.jsx:618-621`).
   Узгоджено з докою — не розбіжність, фіксую як підтвердження.
3. **CLAUDE.md / callAgent.js:50-51 натякають, що grouper/sorter ходять через callAgent**
   (мапінг є) — реально обидва роблять РУЧНИЙ `fetch` (`imageDocumentGrouper.js:238`,
   `imageSortingAgent.js:325`). Мапінг — заготовка B2, не активний шлях.
4. **`prepareImagesForMerge.js:32` контракт каже `normalizedFiles` = «pre-HEIC файли»**
   — насправді це POST-HEIC + POST-downscale файли (`prepareImagesForMerge.js:212,233`).
   Коментар застарів (downscale додано пізніше кроком 1.5).
5. **`imageDocumentGrouper.js:59` у SYSTEM_PROMPT — друкарська помилка «ipss фото»**
   («НЕ редагуєш ipss фото») — дрібниця, але потрапляє в промпт моделі.

---

## 7. ЗОВНІШНІ ЗАЛЕЖНОСТІ + РЕЖИМИ ВІДМОВИ

| Залежність | Де | Поведінка при відмові | Доказ |
|------------|-----|----------------------|-------|
| **Google Drive** (читання) | матеріалізація Drive-файлів | `!res.ok` → `toast.error` + abort усього прогону (НЕ часткова обробка) | `index.jsx:434-443` |
| **Google Drive** (запис PDF) | upload у 01_ОРИГІНАЛИ | помилка `uploadBytesToDrive`/`findOrCreateFolder` кидає → ловиться у `handleSubmitClick` try/catch → toast, документи не створюються | `index.jsx:586-615`; `DpImageMergeEditor.jsx:511-528` |
| **Google Drive** (запис layout 02) | `writeLayoutArtifact` | best-effort, у try/catch — `console.warn`, не блокує (PDF уже залитий) | `index.jsx:622-634` |
| **Document AI / OCR** | prepareImagesForMerge | OCR-fail одного фото → `text:''` + warning, решта продовжує | `prepareImagesForMerge.js:243-266` |
| **Anthropic (grouper)** | Phase 2 | fail/невалідний JSON → fallback один-документ + toast.info | `index.jsx:481-491`; `imageDocumentGrouper.js:344-371` |
| **Anthropic (sort)** | Phase 3 | timeout 90с або fail → `null` → лишає порядок групи, не валить | `sortImageDocument.js:63-82`; `index.jsx:536` |
| **HEIC convert** | Phase 1 | fail → маркер `_heicFailed`, фото пропускається в OCR/orientation, warning | `prepareImagesForMerge.js:73-76,244-245` |

**tmp garbage:** немає. Фото не лягають у `_temp` (на відміну від нарізки) — усе тримається
в пам'яті як File/Blob, тож «осиротілих tmp» на цьому шляху НЕ виникає.

**Resumability:** ВІДСУТНЯ. Жодного persisted state прогону. Якщо адвокат закрив вкладку
у редакторі до «Виконати» — уся pre-обробка (OCR/grouper/sort) втрачається, треба заново.
`imageMerge` — лише React state (`index.jsx:134`). Це свідомий компроміс (PERSIST лише
на «Виконати», коментар `DpImageMergeEditor.jsx:22-26`), але означає, що довга
OCR-обробка великого батчу не виживає reload.

**401 Drive:** оброблюється як `!res.ok` (generic toast), без спец-меседжа
«перепідключіть Drive» (правило #8 не застосоване точково тут) — `index.jsx:434`.

**ErrorBoundary / blank-page guard (правило #4):** `startImageMergeProcessing` повністю
в try/catch/finally (`index.jsx:423-567`); `handleImageMergeSubmit` — у `handleSubmitClick`
try/catch (`DpImageMergeEditor.jsx:511-528`). Async-гілки прикриті.

---

## 8. КАНОНІЧНА СХЕМА — ЩО ПИШЕТЬСЯ КУДИ

- **createDocument() використовується** — `index.jsx:636-655`. Єдина точка створення.
  Поля: `addedBy:'user'`, `source:'manual'`, `documentNature:'scanned'`,
  `folder:'01_ОРИГІНАЛИ'`, `originalMime:'application/pdf'`, `namingStatus` залежить від
  того, чи адвокат дав назву (`g.name ? 'manual' : 'auto'`).
- **addedBy↔source (правило #11):** комбінація `{addedBy:'user', source:'manual'}` —
  канонічна й однозначна (CLAUDE.md DISAMBIGUATION). ✅
- **Запис у Drive:**
  - `01_ОРИГІНАЛИ` ← склеєний PDF (`uploadBytesToDrive`, `index.jsx:615`).
  - `02_ОБРОБЛЕНІ` ← `.layout.json` через `writeLayoutArtifact` (`index.jsx:627`); image/tokens
    стрипляться всередині writeLayoutArtifact (`ocrService.js:350`).
  - `.txt` — НЕ пишеться (V2-A2; `index.jsx:618`). Вірний текст дістається з
    layout `page._text` на вимогу (`ocrService.getDocumentText`/`getCleanOrRawText`,
    `ocrService.js:283-297,255`).
  - `03_ФРАГМЕНТИ` / `.metadata/documents_extended.json` — на цьому шляху НЕ
    зачіпаються (немає «зайвих сторінок» — кожне фото йде в якусь групу;
    extended-поля не пишуться).
- **ACTION `add_documents`:** атомарна валідація через `validateDocument`, перевірка
  дублів id, `setCases` (`actionsRegistry.js:879-930`). У `AUDIT_ACTIONS`
  (`auditLogService.js:23`) → пише audit-лог. Дозвіл `document_processor_agent`
  має `add_documents` (`actionsRegistry.js:1868-1869`). ✅

---

## 9. ПОКРИТТЯ ТЕСТАМИ

**Є:**
- `tests/unit/DpImageMergeEditor.test.jsx` — preview generation (фікс crop-регресії), рендер.
- `tests/unit/DpImageMergeEditorParity.test.jsx` — дублі (#1), контроль обрізки (#9),
  групова рамка (#10), add-group/drop-ціль (#36/#28), «залишити рекомендовані» (#12).
- `tests/unit/imageDocumentGrouper.test.js` — grouper (validateGroups, fallback, білінг, parse).
- `tests/unit/sortImageDocument.test.js` — обгортка sort (timeout, fallback, білінг-контекст).
- `tests/unit/cropState.test.js` — спільні crop-стани (паритет з модалкою).
- `tests/integration/dp-image-merge-multidoc.test.js` — DnD-логіка (ДЗЕРКАЛО handleDragEnd,
  не реальний компонент — `:8-11`).
- `tests/integration/dp-image-merge-progress.test.jsx` — оверлей прогресу (моки prepare/group/sort).
- `tests/integration/dp-image-merge-context-event.test.jsx` — DOCUMENT_BATCH_PROCESSED
  (моки prepare/group/rebuild + мок самого DpImageMergeEditor).

**Чого НЕ покрито (пріоритет e2e — §3.5-F «перевірено лише моками»):**
1. **Наскрізний `handleImageMergeSubmit`** — rebuild→upload→add_documents — реальний
   Drive/OCR ніде не тестується наскрізно; інтеграційні тести мокають усі важкі частини
   (`dp-image-merge-context-event.test.jsx:15-56` мокає навіть редактор).
2. **`prepareImagesForMerge` реальний прогін** — HEIC/downscale/OCR/orientation тільки
   через `__test__` юніти, не наскрізно з реальним фото.
3. **`rebuildFromOcrResults` → PDF** — `computeRenderedBlob`+jsPDF не покриті на реальному blob.
4. **DnD у реальному компоненті** — multidoc тест працює на КОПІЇ логіки (`:11`), не на
   справжньому `DpImageMergeEditor` (дрейф-ризик: копія може розійтись з оригіналом).
5. **Двері роутера `isAllImagesInput`** і діра PDF+DOCX — без тесту (§10).

---

## 10. ПРОГАЛИНИ / ВІДКРИТІ ПИТАННЯ

1. **Двері роутера — INBOX-фото ігноруються (§3.5-B).** `isAllImagesInput` повертає
   false якщо є хоч один `inboxSelected` (`index.jsx:396`). Тобто склейка фото з
   00_INBOX справи **неможлива** — такі фото підуть у звичайний pipeline.run
   (нарізку/мікс), що для чистих фото = той самий крах, який 1B обходив. Заявлено як
   «mix scope боргу» (`index.jsx:393-396`), але це реальна функціональна діра:
   фото, заздалегідь покладені в INBOX, не склеюються.
2. **Діра PDF+DOCX (§3.5-B) — не на цьому шляху, але суміжна.** Завертання міксу
   спрацьовує лише на `hasAnyImage && hasAnyNonImage` (`index.jsx:727`). Суміш
   PDF+DOCX (без фото) воріт не має → піде у стрім-нарізку. До склейки фото прямо не
   стосується, але підтверджую умову для крос-звіту.
3. **Resumability відсутня** (див. §7) — довга OCR-обробка великого фото-батчу не
   виживає reload вкладки. Під SaaS/сервер — кандидат на server-side job.
4. **Серверна міграція (блокери):** усе browser-only — `URL.createObjectURL`/canvas
   (thumbnails, `DpImageMergeEditor.jsx:163`), `@dnd-kit` lazy (`:233`), jsPDF
   (`pdfRebuild.js:54`), canvas edge detection (`edgeDetection.js:81`), Drive-OAuth з
   клієнта, ручний `fetch` до Anthropic з ключем у localStorage (`getApiKey`,
   `index.jsx:44`). Уся фото-обробка — кандидат на переїзд на сервер.
5. **Подвійна назва «image merge»** (DP editor vs route-executor `imageMergeRenderer`)
   — джерело плутанини; не баг, але документація мала б їх явно розрізняти.
6. **Дрейф-ризик тесту DnD** (§9 п.4) — копія логіки в тесті замість реального компонента.

---

**Кінець audit_dp_image_merge.md**
