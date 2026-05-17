# Звіт — TASK DP-1: Pipeline-архітектура Document Processor v2

**Дата:** 17.05.2026
**Гілка розробки:** `claude/new-session-zh7qi`
**Тип:** Великий архітектурний TASK (тонкий диригент-фасад + інтеграція AddDocumentModal)
**Статус:** виконано, чекає підтвердження адвоката на push у `main` (правило #1 — код-зміна)

---

## 1. Baseline (§2 handoff — фактичний прогін ДО будь-якої зміни)

Залежності в контейнері не були встановлені (`vitest: not found`) → `npm install`,
потім baseline на незмінному коді гілки (числа з виводу, не з пам'яті):

| Метрика | Baseline (до) | Після DP-1 |
|---|---|---|
| `npm test` — Test Files | **66 passed (66)** | **68 passed (68)** |
| `npm test` — Tests | **1101 passed (1101)** | **1120 passed (1120)** |
| `npm run build` | **✓ зелений** (лише пре-існуючі chunk-size warnings) | **✓ зелений** (ті самі warnings) |
| `src/services/*.js` файлів | **53** | **54** (+`documentPipeline.js`) |

Кількість тестів **зросла** (+19: 17 unit + 2 integration), не зменшилась — acceptance §9 виконано.

---

## 2. Mini-аудит (§3) — фактичний стан після TASK 1–5

- **`actionsRegistry.js`** — `createActions(deps) → {ACTIONS,PERMISSIONS,executeAction}` (рядок 82). `add_document`(723, dossier_agent), `add_documents`(753, document_processor_agent атомарний), `update_document_source`(1444), `update_processing_context`(1126). `document_processor_agent` allowlist: `add_documents/update_processing_context/update_document_source/batch_update`. `metadata_extractor_agent: []` (DISABLED). Контракт `executeAction` незмінний.
- **`eventBusTopics.js`** — `DOCUMENT_INGESTED`/`DOCUMENT_BATCH_PROCESSED` присутні (TASK 3, без publisher'ів). `DOCUMENT_TOPICS` frozen. DP-1 стає **першим publisher'ом** (як і передбачав handoff).
- **`eventBus.js`** — `publish` no-op якщо немає підписників (нуль підписників у репо → emit-стадія behavior-neutral).
- **`converterService.convertToPdf`** — контракт `{pdfBlob,originalBlob,pdfName,originalName,originalMime,extractedText,warnings,converter,durationMs}`; PDF passthrough; інструментація `document_converted` одна точка у фасаді.
- **`documentFactory.createDocument`** — єдина точка; `normalizeSource('manual_upload'→'manual')` safety-net.
- **`documentBoundary/`** — чистий сервіс `detectBoundaries`/`splitByBoundaries` (TASK 1 salvage), без executeAction/Drive — готовий слот DP-2.
- **`ocrService`** — `extractText`/`writeExtractedTextArtifact`/`writeLayoutArtifact`/`hasOcrSupport` (post-persist збагачення).
- **`dp_v2_functionality_reference.md`** — **ВІДСУТНІЙ** у репозиторії і в проектних файлах сесії (handoff §1 це передбачав). Функціонал НЕ вигадувався; розділ 9 «обробка помилок як принцип» з тіла TASK закладено у контракт стадії дослівно.

**Точки створення документа сьогодні (звірено в коді, рядки зсунулись від CLAUDE.md):**
- `AddDocumentModal` onSubmit у `CaseDossier/index.jsx` (був ~2839) — **база DP v2**, ланцюг: source-resolve → `convertToPdf` → `uploadFileLocal` → (DOCX originalBlob) → `createDocument` → `onExecuteAction('dossier_agent','add_document')` → post-persist OCR (`writeExtractedTextArtifact` / `runOcrWithRetryUI`).
- **drag-n-drop drop-queue** (`CaseDossier` ~2175–2283) — `prepareFile` → `uploadFileLocal` → `createDocument` → `add_document` (без convert, без OCR).
- Стара inline-модалка `{false && (...)}` (~2842+) — мертвий no-op, з власним коментарем «буде видалена окремим cleanup TASK» (НЕ drop-queue, поза scope DP-1).
- `INITIAL_CASES` seed — `App.jsx`, через `createDocument({addedBy:'system'})`, decoupled.

---

## 3. Структура `documentPipeline.js` — кістяк стадій і точки розширення

Патерни: **Pipes-and-Filters** (стадія = фільтр `ctx→ctx'`) + **Mediator** (диригент лише впорядковує) + **DI** (усе через `deps`, як `createActions`). **Sequence config**, НЕ plugin registry (за `discussion_dp_v2_philosophy_response.md` §Q6.3 — для соло-додатку registry = speculative generality).

`DEFAULT_STAGE_ORDER` (іменовані точки розширення DP-2..6, OCP):

| Стадія | DP-1 | Майбутнє |
|---|---|---|
| `intake` | real (валідація job/files) | — |
| `convert` | real (`converterService`; passthrough якщо вже на Drive / Drive-picker; merge-PDF як PDF) | — |
| `detectBoundaries` | **заглушка passthrough** | **DP-2** (розріз склеєного PDF; `documentBoundary/` готовий) |
| `classify` | **заглушка passthrough** | **DP-2** (category/author/nature класифікація) |
| `extract` | **заглушка passthrough** | **DP-3** (OCR/семантичний витяг — семантика) |
| `proposeMetadata` | **заглушка passthrough** | **DP-4** (реальні decisions адвокату) |
| `confirm` | **заглушка auto-pass** | **DP-4** (UI-гейт підтвердження) |
| `persist` | real (upload + `createDocument` + `executeAction add_document`) | DP-4 batch (`add_documents`) |
| `emit` | real (`DOCUMENT_INGESTED`/`DOCUMENT_BATCH_PROCESSED`) | підписники (Dashboard/billing) |

Розширення: `deps.stageOverrides[ім'я]` підставляє реальну реалізацію стадії **без зміни диригента**; `deps.stageFlags[ім'я]=false` вимикає стадію (sacrificial architecture, як `CONVERT_DOCX_TO_PDF` — дешевий обріз). Фабрика `createDocumentPipeline(deps)` — НЕ глобальний сінглтон (як TASK 5).

---

## 4. Контракт стадії (повний інтерфейс — наскрізна вимога розділу 9 TASK)

`async run(ctx, deps) → StageResult`:

```
StageResult = {
  ok: boolean,
  ctx?: PipelineContext,          // стадія сама трансформує (pipes-filters);
                                  //   зберігає накопичувачі через ...ctx
  decisions?: Decision[],         // накопичуються, НЕ зупиняють pipeline
                                  //   (вкладка Підтвердження DP-4)
  error?: { code, message,
            file_skipped?,        // файл провалився, run без документа
            fatal?,               // pipeline стоп, стан resumable (DP-5/6)
            retriable?, stage?, fileId? }   // вкладка Помилки DP-4
}
```

**4 категорії результату** (закладено у `classifyDisposition` — ЄДИНА політика диригента, визначена ДО коду):
1. `ok:true` → продовжуємо
2. `ok:true, decisions:[…]` → питання адвокату накопичуються, pipeline йде далі
3. `ok:false, error.file_skipped` → run завершено без документа (DP-1 single-file); batch-продовження решти = розширення DP-4 (контракт готовий)
4. `ok:false, error.fatal` → стоп, `resumable:true`, job-стан для resume DP-5/6

**Інваріант:** `ok:false` без `fatal|file_skipped` трактується як **fatal** (юрсистема: краще зупинитись ніж тихо створити неповний документ). Диригент **нуль domain-if** — класифікує лише форму результату, не домен.

Підсумок `run()`: `{ ok, jobId, documents[], decisions[], errors[], events[], files[], stoppedAt, resumable, job }`.

---

## 5. Hooks для metadataSidecar і Metadata Extractor

- **`metadataSidecar`** (активовний слот): `deps.writeMetadataSidecar({caseId,caseData,documentId,fields})` — точка запису extended-метаданих через `documentsExtended.js`. DP-1: викликається **тільки** якщо caller дав `writeMetadataSidecar` І стадія поклала `item.extendedMetadata`. AddDocumentModal сьогодні extended-полів не пише → слот **no-op** (behavior-preserving). `pipe.hooks.metadataSidecar.enabled` відбиває стан.
- **`metadataExtractor`** (DISABLED слот): gate `deps.enableMetadataExtractor === true` — у DP-1 **ніколи** не виставляється (канал `metadataExtractor/` вимкнений, `metadata_extractor_agent` allowlist порожній). Іменована точка входу для майбутньої активації окремим TASK; диригент її не викликає. `pipe.hooks.metadataExtractor.enabled === false`. Тест доводить: переданий spy НЕ викликається.

---

## 6. Інтеграція AddDocumentModal — який ланцюг був / став

**Було (inline у `CaseDossier` onSubmit):** source-resolve → `convertToPdf`(catch→toast+throw) → `uploadFileLocal`(catch→toast+throw) → DOCX originalBlob upload(non-fatal toast) → warnings → `createDocument({source:'manual_upload'})` → `onExecuteAction('dossier_agent','add_document')`(або `updateCase` fallback) → post-persist OCR (extractedText artifact / `hasOcrSupport` / `runOcrWithRetryUI`).

**Стало:** детермінований core (**intake→convert→[заглушки]→persist→emit**) проходить через `createDocumentPipeline(deps).run(...)`. Помилки диригента **мапляться на ТІ САМІ toast'и** (`CONVERT_FAILED`→«Не вдалось обробити файл», `UPLOAD_FAILED`→«Не вдалось завантажити файл на Drive», `PERSIST_FAILED`→«Не вдалось додати документ»; `ORIGINAL_UPLOAD_FAILED`/suspicious-warning toasts збережено). Post-persist OCR-збагачення (UI-coupled: toasts, `systemConfirm`, Claude Vision-діалог) **лишається в CaseDossier**, живиться з виходу pipeline — DP-3/DP-4 територія, дослівно той самий ланцюг.

**Behavior-preserving:** користувацький досвід без регресій — вибрав файл → конвертація → додання; помилка convert → toast, модаль відкрита, документ НЕ створюється, на Drive нічого (TASK A контракт). `emit` (нові топіки) без підписників = невидимо для адвоката.

DI-seam **`buildDocumentMetadata`**: доменна евристика nature/icon/source лишилась у шарі що вже володіє `detectDocumentNature` (CaseDossier) — ін'єктується у persist-стадію; **диригент і стадія domain-free**. DP-2 `classify`-стадія візьме це на себе без зміни диригента.

---

## 7. Файли створені / видалені / модифіковані

**Створено (3):**
- `src/services/documentPipeline.js` — тонкий диригент (фабрика, контракт, 9 іменованих стадій, 2 хук-слоти, єдина політика).
- `tests/unit/documentPipeline.test.js` — 17 тестів (контракт, 4 категорії, OCP, хуки, DI, no-domain-if).
- `tests/integration/documentPipeline.test.js` — 2 тести через **справжній** `createActions` (поверх `_actionsTestSetup`, нуль дублювання ACTION-логіки).

**Видалено (drag-n-drop drop-queue — рішення адвоката, scope DP-1):**
- `src/components/CaseDossier/index.jsx`: рядки **2175–2283** — `{/* Drop zone */}` div (`onDragOver/onDragLeave/onDrop`, hidden `#dossierDropInput`) + `{/* Черга файлів */}` блок (queue render, «Очистити», «▶ Завантажити на Drive» з циклом `add_document`).
- State `const [dropQueue,setDropQueue]` і `const [isDragOver,setIsDragOver]` (колишні 438–439).
- Orphaned lucide-імпорти `Paperclip, Image` (використовувались лише drop-queue).
- Результат: перетягування файлу в Матеріали — нічого не відбувається (немає `onDrop`).

**Модифіковано (1):** `src/components/CaseDossier/index.jsx` — +4 service-імпорти (pipeline/eventBus/topics/getCurrentUser); onSubmit `AddDocumentModal` переписано на pipeline + behavior-preserving мапінг + post-persist OCR.

`prepareFile` (CaseDossier ~1525) **НЕ чіпав** — тепер лексично референсований лише мертвим `{false &&}` блоком старої inline-модалки, який має **власний** запланований cleanup TASK (поза scope DP-1; розширювати = scope creep у відкладене). Зафіксовано в `tracking_debt.md`.

---

## 8. Тести — baseline / після / нові

| | Baseline | Після |
|--|--|--|
| Test Files | 66 | **68** (+2) |
| Tests | 1101 | **1120** (+19) |
| `npm run build` | ✓ | ✓ (ті самі пре-існуючі chunk warnings) |

**Нові unit (17):** DEFAULT_STAGE_ORDER/STAGE frozen; stageOverrides замінює заглушку без зміни диригента; stageFlags вимикає стадію; 4 категорії результату (ok / ok+decisions / file_skipped / fatal); ok:false-без-прапорів→fatal інваріант; STAGE_THREW; intake NO_FILES; DI (convert/upload/factory/persist; Drive-source passthrough; buildDocumentMetadata; PERSIST_FAILED); хуки (metadataSidecar умовний виклик, metadataExtractor DISABLED не викликається); no-domain-if (різні типи файлу = той самий шлях).
**Нові integration (2):** документ реально лягає у `cases[].documents` через справжній `executeAction add_document`; дублікат id → реальний ACTION відмовляє → `PERSIST_FAILED` fatal, дубль не додано.
`drag-n-drop.test.js` лишився зеленим — тестує `add_document` ACTION-контракт через harness (НЕ UI-компонент), видалення drop-queue його не торкається. Назва файлу тепер історична — зафіксовано в `tracking_debt.md` (не перейменовував: green, тестує валідний ACTION-контракт, перейменування = ризик без потреби).

---

## 9. Відхилення від handoff (експертна автономія, з поясненнями)

1. **Drop-queue ВИДАЛЕНО повністю (не «інтегровано через pipeline»).** Handoff §4 казав «потік з модалі/drop-queue переводиться на pipeline». Поставив адвокату питання ДО виконання (drop-queue без convert/OCR → інтеграція через convert-стадію = регресія DOCX→PDF). **Рішення адвоката:** drop-queue — legacy, припиняє існування; в системі лишаються 2 точки (DP v2 + AddDocumentModal). Виконано за прямою вказівкою. **Вплив на DP-2..6:** позитивний — одна точка ingest спрощує диригент-проводку; контракт стадій незмінний.
2. **`source: 'manual'` замість legacy `'manual_upload'`** у новому pipeline-шляху. Audit §7.2 + CLAUDE.md ЗАБОРОНЕНО «legacy у новому коді»; factory нормалізує **обидва однаково** → персистоване значення ідентичне (byte-for-byte той самий документ). Прибрано прапорець-борг у переписаному коді. **Вплив:** нуль на DP-2..6 (канонічне значення).
3. **`buildDocumentMetadata` як ін'єктований DI-seam** (не в handoff явно). Доменна евристика nature/icon (залежить від `detectDocumentNature`, що вже у CaseDossier) лишена у UI-шарі й ін'єктована — інакше диригент/стадія отримали б domain-if (порушення інваріанта). **Краще:** behavior-preserving (логіка не переписувалась), диригент чистий, DP-2 `classify` природно це перебере. **Вплив:** іменована точка для DP-2.
4. **Post-persist OCR лишився в CaseDossier** (не в стадії `extract`). OCR AddDocumentModal — UI-coupled (toasts/`systemConfirm`/Claude Vision-діалог) і відбувається ПІСЛЯ persist. Перенесення у диригент вимагало б UI-deps або domain-if. Стадія `extract` — DP-3 заглушка (handoff §5 прямо: OCR-семантика = DP-3). **Вплив:** `extract` лишається чистою точкою DP-3; поточний OCR не регресує.
5. **Стара inline-модалка `{false &&}` + `prepareFile` НЕ чіпав.** Має власний документований cleanup TASK; чистити = scope creep у свідомо відкладене (DEVELOPMENT_PHILOSOPHY: чистимо лише те що активує цей TASK). Зафіксовано.

Сумнівних рішень поза scope, які потребували б зупинки, більше не було (drop-queue — спитав ДО, отримав вказівку).

---

## 10. Що свідомо лишено для DP-2/3/4/5/6 (точки розширення з прив'язкою)

| Фаза | Точка | Стан DP-1 |
|---|---|---|
| **DP-2** | `stageOverrides.detectBoundaries` | заглушка; `documentBoundary/` (TASK 1) готовий до підключення; clamp-рішення — `tracking_debt #5` |
| **DP-2** | `stageOverrides.classify` + `buildDocumentMetadata` | заглушка; DI-seam готовий |
| **DP-3** | `stageOverrides.extract` (OCR/семантика) | заглушка passthrough; resume — за зразком `ocr/resumeStore.js` (майбутнє) |
| **DP-4** | `stageOverrides.proposeMetadata` / `confirm` + `decisions[]`/`errors[]` накопичувачі | заглушки auto-pass; контракт decisions/errors готовий під вкладки Підтвердження/Помилки |
| **DP-4** | batch (`add_documents`, per-file `file_skipped`-продовження) | контракт готовий; DP-1 single-file (skip завершує run) |
| **DP-5/6** | `resumable`/`stoppedAt`/`job` у підсумку | проставляються; сам resume-store — майбутнє |
| **майбутнє** | `metadataSidecar` хук | слот, no-op у DP-1 |
| **окремий TASK** | `metadataExtractor` хук | DISABLED слот, диригент не викликає |
| **підписники** | `DOCUMENT_INGESTED`/`DOCUMENT_BATCH_PROCESSED` | DP-1 публікує (перший publisher); підписників нема |

---

## 11. Acceptance criteria (§9) — статус

| # | Критерій | Статус |
|---|----------|--------|
| 1 | `documentPipeline.js` тонкий диригент (Pipes-Filters+Mediator+DI), без domain-if, іменовані точки DP-2..6 + хук-слоти metadataSidecar/MetadataExtractor (слот, не активований) | ✅ |
| 2 | Контракти стадій визначені; стадії — стабільні passthrough/заглушки (доменна логіка НЕ реалізована) | ✅ |
| 3 | AddDocumentModal-флоу інтегрований на pipeline; ingest без регресій (PDF / DOCX-searchable / image-OCR / convert-error→toast, документ не створюється) | ✅ (behavior-preserving мапінг; drop-queue видалено per рішення адвоката) |
| 4 | Юніт-тести на контракти/диригент у `tests/unit/`; інтеграційні у `tests/integration/` поверх справжнього `createActions` (без дублювання) | ✅ (17 + 2) |
| 5 | `npm test` — не менше за baseline, усі зелені | ✅ 1120 ≥ 1101; 68 ≥ 66 |
| 6 | `npm run build` — зелений, без нових warnings-блокерів | ✅ (ті самі пре-існуючі chunk-size) |
| 7 | Звіт `report_task_dp1_pipeline.md` | ✅ (цей файл) |
| 8 | Зведення показано адвокату; push у main лише після підтвердження | ⏳ очікує підтвердження (§7) |

---

## 12. tracking_debt — побічні знахідки (НЕ виправляти у DP-1)

Додано записи (детально в `tracking_debt.md`):
- **#9** `prepareFile` (CaseDossier) тепер референсований лише мертвим `{false &&}` блоком старої inline-модалки. Тригер: коли спрацює окремий cleanup TASK старої модалки (її власний коментар) — прибрати `prepareFile` тим же комітом.
- **#10** `tests/integration/drag-n-drop.test.js` — назва історична після видалення drop-queue UI; тестує валідний `add_document` ACTION-контракт (⚠-маркер при null criticals), лишається зеленим. Тригер: наступне редагування цього тесту по суті — перейменувати у `add_document_minimal_metadata.test.js`.

Знахідки audit §7 / `tracking_debt #4–#8` — не в scope DP-1, не чіпав.

---

## 13. Підтвердження

- **Behavior-preserving для AddDocumentModal:** так. Конвертація, upload, DOCX-original, warnings, всі toast'и, post-persist OCR (extractedText artifact / `hasOcrSupport` / `runOcrWithRetryUI` / Claude Vision-діалог) — дослівно той самий ланцюг, живиться з виходу pipeline. Помилка convert → той самий toast, модаль відкрита, документ не створюється. `emit` нових топіків без підписників — невидимо.
- **executeAction контракт незмінний:** так. Pipeline персистить ВИКЛЮЧНО через ін'єктований `persistDocument` → `executeAction('dossier_agent','add_document')` (або `updateCase` fallback як було). Жодної модифікації даних повз шар. Сигнатура/pipeline `executeAction` не чіпались.
- **Тонкий диригент без domain-if:** так. `documentPipeline.js` не містить жодної гілки за типом документа/судом/форматом. ЄДИНА політика — `classifyDisposition` (форма результату, не домен). Доменні рішення — у стадіях / ін'єктованому `buildDocumentMetadata` / `converterService` / `sourcePolicy`. Тест `no-domain-if` це фіксує.

---

**DP-1 — фундамент закладено. DP-2/3/4/5/6 додаються як `stageOverrides[ім'я]` без зміни диригента.**
