# DIAGNOSTIC DP-4 — Повна діагностика і відновлення Document Processor v2

**Дата:** 18.05.2026
**Гілка:** `claude/new-session-jAKdQ`
**Тип:** Критична діагностика DP v2 + повний ручний аудит коду + виправлення
**Статус:** виконано, чекає підтвердження адвоката на push у `main` (правило #1 — код-зміна)

---

## 1. Baseline зафіксований (фактичний прогін ДО будь-якої зміни)

| Метрика | Baseline (до) | Після bugfix |
|---|---|---|
| `npm test` — Test Files | **90 passed (90)** | **90 passed (90)** |
| `npm test` — Tests | **1247 passed (1247)** | **1252 passed (1252)** |
| `npm run build` | **✓ зелений** (пре-існуючі chunk-size warnings) | **✓ зелений** (ті самі warnings) |

+5 тестів (4 splitDocumentsV3 + 1 detectBoundariesV3), 1 тест переписано (JobProgressTopbar — стара заглушка-модалка ВИДАЛЕНА), **нуль регресій**.

---

## 2. Повний ручний аудит — простежування потоків

Прочитано повністю: `CLAUDE.md`, `DEVELOPMENT_PHILOSOPHY.md`, звіти DP-1/2/3/4, `DocumentPipelineContext.jsx`, `documentPipeline.js`, `streamingExecutor.js`, всі V3-стадії, `multiFileReconstructor.js`, `documentBoundary/index.js`, `DocumentProcessorV2/*`, `JobProgressTopbar`, `CompressFilesModal`, `standaloneCompressor`, `actionsRegistry.add_documents`, `useDriveFileBuffer`, `ImageMergePanel.jsx` (через підагента), CSS.

### 2.1 Завантаження файлу → запуск → стадії → Drive → реєстр

`DocumentProcessorV2.startProcessing` → `buildRunInput()` → `pipeline.run(input, options)` (Provider) → `runOptionsRef=options` → `executor.run(input)`. streamingExecutor: оригінал → `_temp/<caseId>_<jobId>/orig_<fileId>.pdf` → chunk-OCR (`ocrChunkBytes`) → `buildPipelineDeps(accessors)` → `createDocumentPipeline(pipeDeps).run({files: pipelineFiles, driveId=_temp, isDriveSource:true})`. Стадії: intake→convert(passthrough Drive-source)→**detectBoundariesV3**→classify(passthrough)→**extractV3**→proposeMetadata→**confirmBoundaries**→**splitDocumentsV3(persist)**→emit. На успіху `jobStore.clearState` **видаляє `_temp/<job>/`**.

**Розрив ланцюга (Баг 1):** `detectBoundariesV3` — gate `shouldReconstruct` за замовчуванням `live.length > 1`. Справа Брановського — **один** 65-стор. PDF → `live.length === 1` → multi-file гілка пропущена. Single-file гілка вимагає `stageDeps.detectSingle` — **Provider його НЕ ін'єктує** (`createDetectBoundariesV3({analyzeFile, getStreamedText})`, без `detectSingle`). Стадія повертає `{ok:true}` (passthrough) → **немає `reconstructionPlan`** → `confirmBoundaries` нічого не підтверджує → `splitDocumentsV3` гілка B → **один документ цілком**. Ланцюг до нарізки розривається у gate detectBoundariesV3.

### 2.2 Відкриття документа у в'юері

`useDriveFileBuffer(driveId)` → `GET drive/v3/files/${driveId}?alt=media` → `!res.ok` → `throw HTTP ${status}`. **Баг 7:** у гілці B splitDocumentsV3 `let driveId = item.driveId` = driveId **робочої копії у `_temp`**. Документ персиститься з цим id. streamingExecutor на успіху `clearState` **видаляє `_temp/<job>/`** → файл за `driveId` зник → в'юер `HTTP 404`. Зв'язок Drive↔реєстр зламано саме тут (наслідок Бага 1 + гілка B не релокує у 01_ОРИГІНАЛИ).

### 2.3 Прогрес-екран і топбар

`JobProgressTopbar` (App, глобально) показувався завжди коли `jobProgressStore` має job. `DocumentProcessorV2` рендерив `ProgressFullScreen` (CSS `position:fixed; inset:0; rgba(0,0,0,.55)` — **модалка по центру**, не заміна робочої області) коли `(running||activeJob)&&!minimized`. **Баг 2:** обидва показувались одночасно. **Баг 3:** «Згорнути» → локальний `setMinimized(true)` (топбар лишався); клік топбару → `setExpanded(true)` → **власна заглушка-модалка DP-3** з нотою «DP-4» — назад до повного екрану DP не вело. Стани `minimized` (локальний DocumentProcessorV2) і `expanded` (локальний JobProgressTopbar) не знали один про одного.

### 2.4 AddDocumentModal flow (поворот, OCR, emoji)

`AddDocumentModal.jsx` не містить редактора фото — все у `ImageMergePanel.jsx` (`PreviewPopup`). **Баг 9:** `handleRotateInPopup` — гілка з cropper'ом ставить `popupRotationLockRef=true` (cropper анімує сам, 280мс); гілка без cropper'а (`cropApplied → !frameVisible → plain <img>`) **lock не ставила** → `displayUrl`-ефект регенерував baked-rotated blob і міняв `<img src>` → **стрибок без анімації**. «Інколи плавно» = рамка видима (cropper); «інколи стрибок» = crop застосовано (plain img). `.image-merge-panel__popup-fitimg` **не мав** `transition`. **Баг 8:** `CaseDossier/index.jsx:2868-2870,2891` — `'\U0001F4CB'`: великий `\U` НЕ є валідним JS-escape → рядок стає літералом `U0001F4CB` (рендериться як текст). Введено у DP-1 (commit 87da274), НЕ DP-4; звіт DP-1 «behavior-preserving» був помилковим у цьому пункті.

### 2.5 Швидкі функції DP (Розпізнати, Стиснути)

`RecognizeTextModal` — коректний (ocrService.extractText, готовий pipeline). **Баг 4:** `CompressFilesModal` — email/messenger були `disabled={files.length===0||busy}` + `onClick=run(...)` (клікались за наявності файлів, показували warning-toast) — НЕ відповідає §4.3 («disabled з tooltip»). drive/download функціональні, але всі 4 кнопки disabled доки не вибрано файли через «Вибрати PDF файли» — звідси «не реагують на клік».

---

## 3. Знайдені баги — повний перелік

| # | Категорія | Баг | Першопричина (файл:симптом) |
|---|---|---|---|
| 1 | А | PDF не нарізається | `detectBoundariesV3` gate `>1` + Provider не дав `detectSingle` → немає плану |
| 2 | А | Дублювання прогресу | топбар (App) + `ProgressFullScreen` (модалка center) одночасно |
| 3 | А | Згорнути→розгорнути не працює | локальні `minimized`/`expanded` не пов'язані; топбар відкривав власну DP-3 заглушку |
| 4 | А | Опції «Стиснути» не клікаються | email/messenger мали бути disabled+tooltip; усі кнопки disabled без вибраних файлів |
| 5 | А | Зайва секція у Зоні 2 | плейсхолдер «Оберіть файли для оцінки» читався як другий file-picker |
| 6 | А | Дублікати не перевіряються | `add_documents` дедуп лише за `document.id` (унікальний з factory) |
| 7 | А | Файли не у Drive (404) | `splitDocumentsV3` гілка B персистить `_temp` driveId → `clearState` видаляє → 404 |
| 8 | Б | `U0001F4CB` у назвах | `'\U...'` невалідний JS-escape → літерал тексту (4 рядки CaseDossier) |
| 9 | Б | Поворот фото без анімації | `ImageMergePanel` plain-img гілка: baked-blob swap, lock не ставився, нема CSS transition |
| **В1** | В (нове) | category=null у нарізаних | `splitDocumentsV3` читав лише `doc.category` (завжди null), ігнорував `doc.type` |
| **В2** | В (нове) | гілка B не релокує у streaming | узагальнення Бага 7: будь-який no-plan run у streaming → temp driveId |
| **В3** | В (нове) | `.popup-fitimg` без transition | вторинна причина Бага 9 |
| **В4** | В (нагляд) | executor recreate щорендер | `executeAction` prop новий щорендер App → `useMemo` executor пересоздається (behavior-neutral, tracking_debt) |

---

## 4. Першопричини (де ланцюг розривається)

- **Баг 1:** `src/services/documentPipeline/stages/detectBoundariesV3.js` — `shouldReconstruct` default `> 1`; `src/contexts/DocumentPipelineContext.jsx` — `createDetectBoundariesV3` без `detectSingle`. Один файл → жодна гілка → passthrough → нема `ctx.reconstructionPlan`.
- **Баг 7 / В2:** `splitDocumentsV3.js` гілка B `let driveId = item.driveId` (=_temp); `streamingExecutor.run` success → `jobStore.clearState` видаляє `_temp`.
- **Баги 2/3:** стан «згорнуто» розщеплений між `DocumentProcessorV2` (`minimized`) і `JobProgressTopbar` (`expanded`), джерела правди немає; топбар має власну DP-3 заглушку-модалку.
- **Баг 6:** `actionsRegistry.add_documents` — `existingIds = Set(documents.map(d=>d.id))`; `createDocument` генерує новий `id` щоразу → той самий файл двічі = два id = два записи.
- **Баг 8:** `'\U0001F4CB'` (capital `\U`) — не escape; JSX `{doc.icon}` рендерить літерал.
- **Баг 9:** `ImageMergePanel.jsx` `handleRotateInPopup` — lock тільки у cropper-гілці; plain-img гілка регенерувала baked blob (`displayUrl`-ефект, `applyUserRotation:true`); `.popup-fitimg` без `transition`.
- **В1:** `splitDocumentsV3` `metadataTemplate.category = doc.category` (план кладе `category:null`, а класифікація AI — у `doc.type`).

---

## 5. Виправлення — що змінено

| Баг | Зміна | Файл |
|---|---|---|
| 1 | Provider передає `shouldReconstruct: ctx=>live.length>=1` у `createDetectBoundariesV3` — реконструкція й для 1 файла (після OCR усе=текст, §4.4) | `DocumentPipelineContext.jsx` |
| 2,3 | Стан «згорнуто/розгорнуто» → `DocumentPipelineContext` (`progressMinimized`/`minimizeProgress`/`expandProgress`); новий `GlobalProgressScreen` (App, глобально); `JobProgressTopbar` показується ЛИШЕ коли `minimized`, клік→`expandProgress`, стара заглушка-модалка ВИДАЛЕНА; DocumentProcessorV2 більше не рендерить ProgressFullScreen локально; новий run→`expandProgress()`; overlay CSS → суцільний фон (не модалка) | `DocumentPipelineContext.jsx`, `GlobalProgressScreen.jsx` (new), `JobProgressTopbar/index.jsx`+css, `DocumentProcessorV2/index.jsx`, `styles.css`, `App.jsx`, `documentPipelineContextCore.js` (new — light context щоб не тягнути pdfjs у юніт-тести) |
| 4 | email/messenger → `disabled title="Буде доступно у майбутньому"`; прибрано unreachable not_implemented-тост | `CompressFilesModal.jsx` |
| 5 | Плейсхолдер «Оцінка часу та вартості зʼявиться після вибору файлів у Зоні 1» (не «Оберіть файли») | `DocumentProcessorV2/index.jsx` |
| 6 | `findDuplicate(caseData,name,pageCount,size)` metadata-евристика (рішення адвоката): точний дублікат (назва+pageCount/розмір) → пропуск + `duplicate_skipped`; варіант → додаємо + `duplicate_review`; обидва у вкладці «Потребує уваги» | `splitDocumentsV3.js`, `DocumentProcessorV2/index.jsx` |
| 7,В2 | Гілка B: байти з `_temp` (`sourceBytes`) → `uploadFile`→01_ОРИГІНАЛИ (персистентно), НЕ reuse temp driveId; гілка A вже коректна | `splitDocumentsV3.js` |
| 8 | `'\U0001F4CB'`→`"📋"` тощо (4 рядки) | `CaseDossier/index.jsx` |
| 9,В3 | plain-img гілка: lock ставиться і без cropper'а, обертання = CSS `transform: rotate(delta)` (нормалізований [-180,180]), blob НЕ регенерується; `bakedUserRotationRef` baseline; `.popup-fitimg` + `transition: transform .2s ease` | `ImageMergePanel.jsx`, `ImageMergePanel.css` |
| В1 | `resolveCategory(doc)` = `doc.category \|\| categoryFromBoundaryType(doc.type)`; `slicePageCount` з фрагментів у meta | `splitDocumentsV3.js` |

**Інваріанти збережено:** диригент `documentPipeline.js` НЕ змінено; контракт стадії `{ok,ctx,decisions,error}` НЕ змінено; 9 frozen стадій НЕ порушено (frozen-9 тест зелений); персистенція лише через `executeAction` (ін'єктований `persistDocument`); схема документа НЕ розширена (Баг 6 — евристика без поля/міграції, рішення адвоката).

---

## 6. Тести на реальному сценарії — справа Брановського

Один 65-стор. PDF → `streamingExecutor` chunk-OCR → `detectBoundariesV3` (тепер `shouldReconstruct>=1` → `reconstructAcrossFiles` на тексті) → план із N логічних документів → `confirmBoundaries` (autoConfirm) → `splitDocumentsV3` гілка A: кожен документ нарізається (`splitPdf` у Worker), завантажується у **01_ОРИГІНАЛИ** (персистентний driveId), `createDocument`+`add_documents`, category з `doc.type`, текст/layout у **02_ОБРОБЛЕНІ**, невикористані сторінки у **03_ФРАГМЕНТИ**. В'юер відкриває по персистентному driveId — **без 404**. Покрито юніт-тестами: `dp3Stages` (single-file+shouldReconstruct→план), `splitDocumentsV3` (гілка A category з type; гілка B перезалив; дедуп exact/variant). Інтеграційний `dp4-ui` зелений. *Реальний end-to-end на Drive потребує живого Drive/AI ключа — у середовищі недоступно; код-шлях простежено і покрито юнітами.*

---

## 7. AddDocumentModal regression check

`AddDocumentModal.jsx` onSubmit-flow (convert→upload→createDocument→add_document→post-persist OCR) **не зачеплено** жодним рядком. Виправлено лише Баг 8 (ICONS-мапа у `buildDocumentMetadata` — emoji-літерали замість зламаних escape; `correspondence:'✉️'` і так працював). Баг 9 — `ImageMergePanel` (склейка/поворот) — обертання тепер ЗАВЖДИ анімоване (cropper-гілка незмінна; plain-img гілка CSS-transform). `ImageMergePanel.test.jsx` (5) + `imageRenderer.test.js` (24) зелені. Лінія 2825 (`"📋"` — інша, ручна модалка) — коректні surrogate-pairs, не чіпано.

---

## 8. Регресії у інших модулях

- **JobProgressTopbar:** API змінено (видалено заглушку-модалку, додано `onExpand`/context-gating). Юніт-тест переписано під нову поведінку (6 тестів зелені). Поза Provider (тести) `ctx=null`→топбар показується (стара поведінка показу збережена).
- **Quick Input / Dashboard / Реєстр / Календар:** не зачеплені (зміни локалізовані у DP v2 / ImageMergePanel / CaseDossier ICONS / контекст пайплайну). Повний `npm test` 1252 зелених.
- **DocumentPipelineContext** розділено на light-core (`documentPipelineContextCore.js`) + Provider — реекспорт зберігає всі існуючі імпорти; тести `DocumentPipelineContext`/`DocumentProcessorV2`/`dp4-ui` зелені.

---

## 9. Файли створені / модифіковані

**Створено (3):** `src/contexts/documentPipelineContextCore.js`, `src/components/DocumentProcessorV2/GlobalProgressScreen.jsx`, `docs/diagnostics/diagnostic_dp4_bugfix.md`.

**Модифіковано (11):** `src/contexts/DocumentPipelineContext.jsx`, `src/services/documentPipeline/stages/splitDocumentsV3.js`, `src/components/DocumentProcessorV2/index.jsx`, `src/components/DocumentProcessorV2/styles.css`, `src/components/DocumentProcessorV2/modals/CompressFilesModal.jsx`, `src/components/JobProgressTopbar/index.jsx`, `src/components/JobProgressTopbar/styles.css`, `src/components/CaseDossier/index.jsx`, `src/components/CaseDossier/ImageMergePanel.jsx`, `src/components/CaseDossier/ImageMergePanel.css`, `src/App.jsx`.

**Тести (2):** `tests/unit/splitDocumentsV3.test.js` (+4), `tests/unit/dp3Stages.test.js` (+1); `tests/unit/JobProgressTopbar.test.jsx` (1 переписано).

**Видалено:** заглушка-модалка JobProgressTopbar (JSX+CSS); диригент / converterService / ocrService / streaming-інфра / AddDocumentModal onSubmit — НЕ торкалися.

---

## 10. Тести — baseline / після

Baseline **90 файлів / 1247 тестів** → після **90 / 1252** (+5, 1 переписано), 0 регресій. `npm run build` зелений (ті самі пре-існуючі chunk-size warnings).

---

## 11. Що навчилось (patterns не покриті тестами)

- **Поведінкові тести стадій не покривали інтеграцію Provider→executor→стадія.** `dp3Stages` тестує `createDetectBoundariesV3` з ВЛАСНИМИ stageDeps (включно з `detectSingle`/`shouldReconstruct`), тому «зелено». Але **Provider** ніколи не передавав `detectSingle`, і це не покривав жоден тест (Provider-тест мокає executor). Урок: для DI-Provider потрібен тест що перевіряє РЕАЛЬНІ deps які Provider ін'єктує у стадії, не лише стадію ізольовано. Додано `dp3Stages` тест саме під Provider-сценарій (single + shouldReconstruct).
- **«Behavior-preserving» без тесту реального рендеру.** Баг 8 (`\U` escape) пройшов DP-1 бо жоден тест не рендерив `doc.icon`. Зламані escape — клас помилок який ловить лише рендер-тест або lint на unicode.
- **Lifecycle ресурсу (temp→persist) не мав інтеграційного тесту.** Баг 7: `splitDocumentsV3` гілку B тестували ізольовано (uploadedFile), а streaming-реальність (driveId=_temp + подальший clearState) — ні. Додано тест гілки B з temp-driveId.
- **Розщеплений UI-стан між глобальним і локальним компонентом** (топбар у App, повний екран у вкладці) — джерело Бага 2/3; патерн «один сенс на прапор» (#11) застосовано через спільний контекст.

---

## 12. tracking_debt — нові записи

- **В4** — `DocumentPipelineProvider`: `executor` `useMemo` залежить від `executeAction` (новий референс щорендер App, бо `createActions` у тілі — TASK 5) → executor пересоздається щорендер. Behavior-neutral (in-flight run тримає старий замикання; `jobProgressStore` модульний; `cancelledRef`/`runOptionsRef` стабільні `useRef`). Тригер: профілювання продуктивності DP або міграція `executeAction` на стабільний референс.
- **Дедуп — евристика, не контент-хеш** (рішення адвоката). Тригер: наступний schemaVersion bump — додати `contentHash` у канонічну схему + міграцію, замінити `findDuplicate` на хеш-порівняння (точний дублікат → справжня автозаміна; варіант → інтерактивне «замінити/новий варіант» у DP-6).
- Page-precise text slicing 02_ОБРОБЛЕНІ — успадкований DP-3 борг, лишається.

---

## 13. Підтвердження

- **Інваріанти збережені:** диригент `documentPipeline.js` НЕ змінено; контракт стадії `{ok,ctx,decisions,error}` НЕ змінено; 9 frozen стадій (frozen-9 тест зелений); персистенція виключно через `executeAction`(`persistDocument`); CSS-токени (без inline у новому коді — окрім existing CaseDossier/ImageMergePanel спадщини).
- **Схема документа НЕ змінена** (Баг 6 — metadata-евристика без поля/bump/міграції, явне рішення адвоката).
- **executeAction НЕ змінено** (сигнатура/pipeline; `add_documents` не чіпано — дедуп у DP-4 шарі перед персистом).
- **Behavior-preserving AddDocumentModal:** onSubmit-flow не зачеплено; Баг 8/9 — відновлення регресій (emoji рендериться як emoji; поворот ЗАВЖДИ анімований).
- **Streaming-інфра DP-3 НЕ перероблялась** — Баг 1 виправлено АКТИВАЦІЄЮ через Provider (`shouldReconstruct`), Баг 7/В1 — поведінкові фікси у `splitDocumentsV3` (sub-стадія persist, контракт стадії незмінний), не зміна диригента/архітектури.
