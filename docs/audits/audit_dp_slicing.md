# АУДИТ DP · СЦЕНАРІЙ 1 — НАРІЗКА сканованих PDF (+ §3.5-C боундарі-якість)

**Дата:** 2026-06-15
**Виконавець:** окрема read-only аудит-сесія (Part 1 з повного аудиту DP)
**Скоуп:** Сценарій 1 (slicing scanned PDFs) + §3.5-C діагностика якості пошуку меж.
**Базова спека:** `docs/tasks/TASK_dp_full_audit.md` (§2 карта, §3.1.1, §3.5-A, §3.5-C, §4, §6.1).

## 1. Методологія

Read-only. **Жоден рядок коду не змінено** — створено лише цей `.md`. Кожне
твердження про реальний стан звірене з кодом і має доказ `file:line`. §2 карта
спеки трактувалась як ГІПОТЕЗА (§1.2-bis): де код суперечить — істина в коді,
розбіжність винесена окремим рядком. Інші 3 сценарії (склейка/просто-додати/ZIP)
— поза скоупом (інші аудитори); тут судимо станції **лише на slice-шляху**.

Словник вироків: код — «живий / дрімає-приберегти / мертве-видалити»; станції —
«жива / passthrough / мертва».

---

## 2. ЗВІРЕНА КАРТА ПОТОКУ НАРІЗКИ (§2 verification, station-by-station)

Вхідна точка slice-шляху: `DocumentProcessorV2/index.jsx:787` `pipeline.run(input, …)`
→ `DocumentPipelineContext.jsx:272` `executor.run(input)` →
`streamingExecutor.js:222 run()` / `:245 runGuarded()`.

| # | §2 крок | Реальна поведінка (доказ) | Вердикт |
|---|---------|---------------------------|---------|
| 0 | ВВІД + тумблер режиму + опц. стиснення | Маршрутизація в `startProcessing` `DocumentProcessorV2/index.jsx:702-734`; slice-гілка — `:787`. Стиснення ПЕРЕД нарізкою: `streamingExecutor.js:285-298` (`compressBuffer`+`shouldCompress`, best-effort, збій НЕ валить). | ✅ підтверджено |
| 1 | оригінал → `_temp/<caseId>_<jobId>/orig_*.pdf`, RAM геть | `streamingExecutor.js:300-316`: `uploadBytes(tempFolderId, 'orig_<fileId>.pdf', …)`; `ab = null` (`:316`). Папка `_temp/<caseId>_<jobId>/` — `jobState.js:24 TEMP_ROOT='_temp'` + `_jobFolderId`. | ✅ підтверджено |
| 2 | чанкування (верхній рівень) у tmp, адаптивний ~25 стор., межі 5-40 | План: `chunkManager.js:35 planChunks` → `memoryMonitor.adviseChunkPages`. Дефолт 25 (`memoryMonitor.js:21`), межі MIN=5/MAX=40 (`:22-23`). Матеріалізація у tmp: `chunkManager.js:56 materializeChunk` → `chunk_<fileId>_NNN.pdf` (`:68`). **Розбіжність деталі:** §2 каже «під розмір файлу (~40 МБ)» — точно: ціль 40МБ на чанк (`memoryMonitor.js:69 pagesFor40MB`). | ✅ підтверджено |
| 2-низ | НИЖНІЙ рівень: Document AI ще ріже по 15 стор. / 40 МБ | `documentAi.js:44 DOC_AI_PAGES_PER_REQUEST=15`, `:49 DOC_AI_MB_PER_REQUEST=40`; внутрішня нарізка `:361`. | ✅ підтверджено |
| 3 | читання Document AI чанк-за-чанком → текст+лайаут; resume після кожного чанка; strip image/tokens при збереженні | OCR одного чанка: `streamingExecutor.js:164-202`; `processChunk` ін'єктований = ocrService (Provider). Resume: `jobStore.saveState(state)` після кожного чанка `:200`. Лайаут per-page `_text`: `documentAi.js:222-225` (`extractPageText`). **Strip image/tokens** — НЕ у Document AI, а при записі layout у 02: `DocumentPipelineContext.jsx:207-221` (`writeLayoutArtifact` сама робить strip). | ✅ підтверджено |
| 4 | збірка: усі чанки → один текст файла + посторінковий лайаут | `streamingExecutor.js:204 mergeText` (Worker) + `layout = layout.concat(res.layout)` (`:198`); повертає `{text, layoutJson:{schemaVersion:1, pages}, pageCount}` (`:215`). | ✅ підтверджено |
| 5 | ПАСПОРТ — детермінований, 0 токенів, ДВА профілі щільності, ЖОРСТКИЙ поріг | `pageMarkers.js:355 resolveBoundaryText` → `buildCompactTriagePassport` (`:307`). Два профілі: `RICH_PASSPORT_OPTS` (`:381`) vs стартовий мінімум `{}` (`:387 passportOptsForBudget`). **ПОРІГ = 70, НЕ 70 «адаптивний»** — `RICH_PASSPORT_MAX_PAGES_DEFAULT=70` (`pageMarkers.js:368`). §2 каже «70 стор.» — ✅, але §2 каже профілі «майже повний текст» vs «3 перші + 2 останні рядки» — деталі див. §4 (rich = head/tail 10 рядків×1500 симв., НЕ «повний»). | ⚠ розбіжність деталі (значення rich) |
| 6 | пошук меж (Triage) — єдиний AI-крок (Haiku); план з .route; запобіжник «≥70 + весь том = СТОП» | Слот `DETECT_BOUNDARIES` = `createTriageStage` (`DocumentPipelineContext.jsx:175`). AI-хід `aiTriage` (`:103`) → `analyzeTriageViaToolUse.js:49` (Haiku через `callAgent agentType:'qiParserDocument'` `:57`). Запобіжник: `triageStage.js:171 isDegeneratePlan` + `:337` halt `triage_whole_volume`. **Розбіжність:** §6 називає це «єдиний AI-крок» — на slice-шляху ВІРНО (CLASSIFY/PROPOSE_METADATA — мертві passthrough, див. §3). | ✅ підтверджено |
| 7 | підготовка тексту (тонкий крок), НЕ чистить | `extractV3.js:42` — лишає сирий OCR `textFormat:'txt'`, очистки НЕМА (`:50`, шапка `:14-20`). | ✅ підтверджено |
| 8 | підтвердження — АВТОМАТИЧНЕ, екрану правки ще немає | `confirmBoundaries.js:22 autoConfirm` дефолт true; slice-виклик передає `autoConfirm:true` (`DocumentProcessorV2/index.jsx:789`). UI правки відсутній. | ✅ підтверджено |
| 9 | різ+збереження на КОЖЕН документ: PDF→01, лайаут→02, фрагменти→03, .txt НЕ пишемо | `splitDocumentsV3.js:211`. Precut джерела один раз (`:169-193`), `buildDocumentPdf` (`:199`), `uploadFile`→01 (`:361`), `persistDocument`→executeAction (`:390`), `writeProcessedArtifacts`→02 (`:396`/`:666`). Фрагменти→03 `saveFragments` (`:493`). **.txt пишемо ЛИШЕ коли layout відсутній** (`:672-680`) — для scanned (є layout) `.txt` НЕ пишемо. | ✅ підтверджено |
| 10 | прибирання: успіх→tmp видаляємо; збій→лишаємо (resume); авто-GC старих tmp НЕМА | Успіх: `streamingExecutor.js:422 clearState`. Збій: `:430-436` (`resumable:true`, tmp лишається). **Авто-GC старих осиротілих tmp — ВІДСУТНІЙ**: `jobState.js:147 clearState` чистить ЛИШЕ конкретну job-папку; жодного сканера старих `_temp/*`. | ✅ підтверджено (борг реальний) |

**Підсумок звірки §2:** карта **в основному точна**. Дві розбіжності-деталі:
(а) крок 5 — rich-профіль НЕ «майже повний текст», а head/tail по 10 рядків /
1500 симв. кожен край (`pageMarkers.js:381-385`); (б) крок 2 — strip image/tokens
живе не в OCR, а у write-точці 02. Жодного структурного спростування карти.

---

## 3. СТАНЦІЇ ДИРИГЕНТА — ВИРОК ПО-ШЛЯХОВО (slice-шлях, §3.5-A)

Порядок диригента: `documentPipeline.js:96-106`. На slice-шляху Provider
перекриває 4 слоти (`DocumentPipelineContext.jsx:166-228`); решта — дефолти.

| Стадія | Вердикт на slice-шляху | Доказ |
|--------|------------------------|-------|
| INTAKE | жива (нормалізація job+files) | дефолт диригента `documentPipeline.js:83` |
| CONVERT | **passthrough** на цьому шляху | файли вже PDF у `_temp` (`isDriveSource:true` `streamingExecutor.js:324`); convert обнуляє текст для Drive-source. (На «просто додати»/device — жива; це інший шлях.) |
| DETECT_BOUNDARIES | **жива** — Smart Triage (Haiku) | override `createTriageStage` `DocumentPipelineContext.jsx:175`; AI `analyzeTriageViaToolUse.js:49` |
| CLASSIFY | **мертва passthrough** на slice | НЕ перекрита Provider'ом (немає `classify:` у `buildPipelineDeps:169-228`) → дефолтна заглушка диригента. Категорія виводиться не тут, а у persist (`splitDocumentsV3.js:53 resolveCategory` з `doc.type`). |
| EXTRACT | жива-тонка (постобробка тексту) | override `createExtractV3` (`:183`); НЕ чистить, лишає `txt` (`extractV3.js:50`) |
| PROPOSE_METADATA | **мертва passthrough** на slice | НЕ перекрита Provider'ом; метадані будуються у persist (`splitDocumentsV3.js:386 buildMeta/defaultBuildMetadata`) |
| CONFIRM | жива (auto-confirm) | override `createConfirmBoundaries` (`:189`), `autoConfirm:true` |
| PERSIST | **жива — ядро різу** | override `createSplitDocumentsV3` (`:190`); реальний split+upload+persist |
| EMIT | жива (eventBus) | дефолт; `DOCUMENT_INGESTED/BATCH_PROCESSED` (`:233`) |

**Висновок:** на slice-шляху по-справжньому працюють **DETECT_BOUNDARIES(Triage) →
CONFIRM → PERSIST(split)**; EXTRACT — тонка постобробка; CONVERT, CLASSIFY,
PROPOSE_METADATA — passthrough/мертві саме НА ЦЬОМУ ШЛЯХУ.

---

## 4. §3.5-C БОУНДАРІ-ЯКІСТЬ — ДІАГНОСТИКА

### 4.1 Поріг щільності паспорта — ЖОРСТКИЙ, N=70

- **Поріг:** `pageMarkers.js:368 RICH_PASSPORT_MAX_PAGES_DEFAULT = 70`. Не плавний:
  `passportOptsForBudget(pageCount)` (`:386-388`) — тернарний `pageCount <= richMaxPages() ? RICH : {}`.
- **rich (≤70 стор.):** `RICH_PASSPORT_OPTS` (`:381-385`) — `headLines:10, tailLines:10,
  headChars:1500, tailChars:1500, fullTextIfNoSignal:true, ambiguousMaxChars:1200`.
- **thin (>70 стор.):** `{}` → `COMPACT_DEFAULTS` (`:203-210`) — `headLines:3, tailLines:2,
  headChars:400, tailChars:200`.
- **Квантований обрив на сторінку:** rich тримає до 10 перших + 10 останніх рядків
  (по ≤1500 симв. край) — фактично майже все тіло короткої OCR-сторінки. thin
  падає до 3 перших + 2 останніх рядків (≤400 / ≤200 симв.). Між краями `⟨…⟩`
  (`pageMarkers.js:294`). Обрив РІЗКИЙ: 71-а сторінка тома → ~5-7× менше тексту/стор.
- **Override-хук:** `_setRichPassportMaxPages` (`:374`) — тільки тести/майбутня
  tenant-калібровка, не UI.
- **Симетрія порогів:** той самий 70 продубльований у `triageStage.js:157
  DEGENERATE_MIN_PAGES=70` з коментарем-нагадуванням про ручну синхронізацію
  (`:153-156`) — **ризик дрейфу: два незалежні літерали 70, не спільна константа**.
  Тест на симетрію згаданий у коментарі (`tests/unit/triageStage.test.js`).

### 4.2 Утилізація контекстного вікна паспортом — ВІКНО НЕ ВУЗЬКЕ МІСЦЕ (гіпотеза підтверджена)

Модель Triage — Haiku 4.5 (`modelResolver.js:15`), вікно 200K токенів.
Груба оцінка input через thin-профіль (>70 стор.):
- дайджест сигналів ~30-80 симв. + краї ≤600 симв. ≈ **~150-250 токенів/стор.**
  (узгоджується з коментарем `pageMarkers.js:196` «~200-280 ток/стор.»).
- **250 стор. × ~250 ток ≈ 62 500 токенів** — ~31% вікна Haiku.
- rich-профіль (≤70 стор.): до ~3000 симв./стор. ≈ ~900-1000 ток × 70 ≈ ~65-70K
  токенів — теж ~33% вікна.

**Вердикт гіпотези §3.5-C:** ПІДТВЕРДЖЕНО — навіть на 250-стор. томі thin-паспорт
займає ~⅓ вікна; **запас на щільніший паспорт є**. Реальний обмежувач — НЕ розмір
вікна, а **емпірична деградація якості Haiku** на rich-паспорті у 70-100 стор.
(саме тому поріг знижено зі 100 до 70 — `pageMarkers.js:363-368`). Тобто бар'єр —
здатність моделі тримати межі, а не токен-бюджет. Це підстава для A4 (адаптивний
паспорт + можливо сильніша модель), а не для звуження паспорта.

### 4.3 isDegeneratePlan — точна умова + що ПРОПУСКАЄ

`triageStage.js:171-197`. Спрацьовує ⇔ ВСІ умови:
1. план має **рівно 1 документ** (`:172 plan.documents.length !== 1`);
2. його route ∈ `{add_as_is, slice}` (`:174 DEGENERATE_ELIGIBLE_ROUTES`, `:162`);
3. фрагменти покривають **100% сторінок усіх живих файлів** (`:185-195` — `byFile.size
   === liveFiles.length` І `covered.size >= pc` для кожного);
4. сумарний обсяг **≥70 стор.** (`:177-178 totalPages < DEGENERATE_MIN_PAGES`).

**Що НЕ ловить (підтверджено):**
- ✅ підтверджено: ловить ЛИШЕ «рівно 1 документ = 100% при ≥70». **НЕ ловить
  «підозріло мало документів на великий том»** — план з 2-3 документами на 250-стор.
  том (явне недосегментування) проходить як валідний, бо `documents.length !== 1`
  (`:172`) одразу повертає false.
- НЕ ловить degenerate на томі <70 стор. (поріг `:178`).
- НЕ ловить route `image_merge/fragment_reconstruct/to_fragments/discard` навіть
  при 1×100% (`:162` — це дизайн route, не провал).
- НЕ ловить «1 документ покриває 90%» (потрібно повне покриття, `:194`).

Це **найслабше місце якості пошуку меж**: «занадто грубий план, але не рівно 1» —
сліпа зона. Фундамент для A4.

### 4.4 Резолв моделі Triage — Sonnet/Opus НЕ ДОСЯЖНИЙ для великих томів через дефолт

- agentType = `'qiParserDocument'` (`analyzeTriageViaToolUse.js:57`).
- `resolveModel('qiParserDocument')` (`modelResolver.js:61`): user → tenant →
  `SYSTEM_DEFAULTS['qiParserDocument']` = **`claude-haiku-4-5-20251001`** (`:15`).
- **Чи досяжний Sonnet/Opus для великих томів?** ЛИШЕ через ієрархію
  `user.preferences.modelPreferences.qiParserDocument` або
  `tenant.modelPreferences.qiParserDocument` (`modelResolver.js:63-68`). **НЕМАЄ
  жодної логіки, що підвищує модель за обсягом тома** — `analyzeTriageViaToolUse.js`
  не передає override, обсяг не впливає на вибір моделі. У дефолтному self-hosted
  tenant (`modelPreferences` = null × 9, CLAUDE.md) Triage **завжди Haiku**,
  незалежно від 50 чи 250 сторінок. `max_tokens` росте до 16000 (`:63`), модель — ні.

**Висновок:** на великому томі система впирається у стелю Haiku без автоматичного
ескейлу — прямий вхід для A4 (per-volume вибір моделі).

---

## 5. РЕАЛЬНЕ vs ДОКУМЕНТОВАНЕ (розбіжності, кожна — окремий рядок)

1. **«Зниклий детектор опису тому» — ПІДТВЕРДЖЕНО ВІДСУТНІЙ.** grep по
   `опис тому|volumeDescription|registryDescription|описовий|реєстр документів|detectVolume`
   у `src/` — **0 збігів**. Жодного коду, що окремо детектує реєстр/опис тому
   (титульний аркуш-перелік документів). §2 крок 5/6 такого детектора не містить —
   паспорт дає лише per-page структурні сигнали (`pageMarkers.js:234 compactDigest`),
   а не семантику «це опис тому». Розбіжність роадмапу («нібито є») з кодом —
   підтверджена: **відсутній**.
2. **rich-профіль ≠ «майже повний текст».** §2 крок 5 описує щільний профіль як
   «майже повний текст сторінок». Реально це head/tail по 10 рядків / 1500 симв.
   (`pageMarkers.js:381`), тіло між краями викидається крім коротких сторінок
   (`fullTextIfNoSignal`). На довгій сторінці rich теж обрізає.
3. **Поріг «70» — два незалежні літерали, не одна константа.** `pageMarkers.js:368`
   і `triageStage.js:157` тримають 70 окремо, синхронізація — ручна (коментар
   `:153-156`). Документація (CLAUDE.md правило #11 «одна цифра — один сенс»)
   формально порушена; код тримається на коментарі-нагадуванні.
4. **«Triage = єдиний AI-крок» — вірно на slice-шляху, але CLASSIFY/PROPOSE_METADATA
   існують у диригенті як заглушки** (`documentPipeline.js:86,88`) — не мертвий
   код взагалі, а passthrough саме на цьому шляху (§3). Категорія/метадані
   виводяться у persist, не окремими AI-стадіями.
5. **Старі покоління пошуку меж — у коді, але мертві на live-шляху** (див. §9 /
   leanness): `analyzeBoundariesViaToolUse` (`documentBoundary/analyzeViaToolUse.js`),
   `createDetectBoundariesV2/V3` — **жодного live-імпорту** (підтверджено grep:
   імпортуються тільки у тестах). Live-слот = `createTriageStage`.

---

## 6. ЗОВНІШНІ ЗАЛЕЖНОСТІ + РЕЖИМИ ВІДМОВИ (slice-шлях)

**Drive** (через `drivePort`, OAuth з клієнта):
- upload оригіналу: `streamingExecutor.js:303` → збій `UPLOAD_FAILED`,
  `resumable:true`, tmp лишається (`:304-308`).
- quota-гард ПЕРЕД роботою: `:251-258` (`freeSpaceVerdict`); <1ГБ → `DRIVE_FULL` blocked.
- 401 Drive: не спец-обробляється у executor — летить як throw → catch `:437`
  → `EXECUTOR_THREW`, resumable. (Document AI 401/403 → `AUTH` `documentAi.js:67`.)

**Document AI** (`processChunk` → ocrService → documentAi):
- класифікація помилок `documentAi.js:65 classifyError`: NETWORK(retry 3×,
  backoff 1/3/9с `:54-55`), AUTH/QUOTA/UNSUPPORTED (без retry).
- resume per-15-стор-чанк через `resumeStore` (`:337,438`); partial error
  зберігає state (`:415`).
- збій чанка летить у `streamFile` → `diag.log('chunk_ocr_error')` (`:171`) →
  throw → `runGuarded` catch → stoppedAt, resumable.
- «Файл більший за 40 МБ» (`:299`) UNSUPPORTED — НЕ retry; типовий збій роздутого
  чанка (тому стиснення ПЕРЕД нарізкою критичне, `streamingExecutor.js:285`).

**Anthropic / Triage** (`callAgent` → `analyzeTriageViaToolUse`):
- немає API-ключа → `aiTriage` throw (`DocumentPipelineContext.jsx:105`) →
  `triageStage` catch `:323` → **НЕ фатально**, passthrough → fallback persist
  (гілка B), 02 НЕ пишеться (DIAG decision `:329`).
- не-JSON відповідь → throw (`analyzeTriageViaToolUse.js:87`) → той самий catch.
- degenerate plan → halt `triage_whole_volume` (`triageStage.js:344`) — свідомий
  СТОП, не помилка.

**tmp-сміття:** успіх → `clearState` чистить (`:422`); будь-який збій/cancel/halt →
tmp ЛИШАЄТЬСЯ для resume. **Осиротілі tmp (старі незавершені job) не чистяться
ніколи** — авто-GC відсутній (§2 крок 10). Кирилиця в `q=` не використовується:
папки `_temp` латиницею (`jobState.js:16`), пошук через `listFolder` без cyrillic
filter (`drivePort.js:42`) — правило #8 дотримано.

**Resumable:** усі гілки ok:false повертають `resumable:true`
(`streamingExecutor.js:307,436,454,473`); `resume()` `:502` піднімає state.

---

## 7. ТОЧКИ БІЛІНГУ / AI у slice-шляху

- **Єдина AI-точка slice-шляху — Triage**, через `callAgent`
  (`analyzeTriageViaToolUse.js:57`). callAgent сам пише облік РІВНО ОДИН раз
  (`callAgent.js:169-192`): `ai_usage` (мітка `document_parser` через
  `AGENT_USAGE_LABELS.qiParserDocument` `:47`) + `activityTracker('agent_call')`.
  Ручний логер з analyzeTriageViaToolUse ПРИБРАНО (шапка `:11-14`) — **подвійного
  обліку НЕМАЄ** на slice-шляху.
- Document AI (OCR) — **не AI-білінг у нашому сенсі**: не йде через callAgent/ai_usage
  (це Google-витрати, не Anthropic-токени). Жодного `ai_usage` запису для OCR —
  очікувано.
- `billAsUserAction` дефолт true для Triage (slice — дія адвоката, не автофон) —
  `callAgent.js:96`, виклик не передає false → списується час адвоката. Коректно.
- **Дубль-облік не виявлено** на slice-шляху.

---

## 8. ПОКРИТТЯ ТЕСТАМИ (slice-шлях)

Покривають slice-ядро (`tests/`):
- `tests/unit/triageStage.test.js` (390 рядків) — degenerate, overlap-dedup, routes, skipPdfSlicing.
- `tests/unit/pageMarkers.test.js` (409) — паспорт, rich/thin поріг, edgeText.
- `tests/integration/triage_degenerate_plan.test.js` (158) — halt whole-volume.
- `tests/integration/streamingExecutor.test.js` — chunk-OCR оркестрація.
- `tests/unit/splitDocumentsV3*.test.js` (×3, ~926) — split, routes, documentNature.
- `tests/unit/chunkManager.test.js`, `memoryMonitor.test.js`,
  `analyzeTriageViaToolUse.test.js` (мокає global fetch), `triagePrompt.test.js`.
- `tests/integration/document-processor.test.js`, `documentPipeline.test.js`.

**НЕ покрито / слабко:**
- Реальний Document AI ніколи не викликається — `processChunk` завжди детермінований
  стаб. **Уся OCR-якість + chunk-розмір на реальних томах — лише моки** (§3.5-F
  пріоритет e2e).
- **Якість пошуку меж на справжньому томі 200-250 стор.** — нема golden-фікстури
  з реальним паспортом → реальним планом. Тести перевіряють форму, не точність меж.
- isDegeneratePlan «мало документів на великий том» — не тестовано (бо такої логіки нема).
- resume після реального збою Drive/OCR посеред 250-стор. тома — лише юніт-форма.

**Golden-фікстури можливі:** збережений `layoutJson` реального тома (з `_text` +
boundingPoly) → детермінований вхід для `buildCompactTriagePassport` + (мок-)Triage
→ заасертити план. Це найдешевший шлях зафіксувати regressions якості паспорта.

---

## 9. ПРОГАЛИНИ / ВІДКРИТІ ПИТАННЯ (для консолідованого звіту, Task 2)

1. **Авто-GC осиротілих `_temp/*`** відсутній (`jobState.js:147` чистить лише свою
   job). Накопичення сміття на Drive адвоката — реальний борг (C6).
2. **isDegeneratePlan сліпий до «мало документів».** Найбільша діра якості меж —
   потребує A4 (детектор недосегментування за щільністю/обсягом).
3. **Triage прибитий до Haiku** без ескейлу за обсягом — A4 (per-volume модель).
4. **Поріг 70 — два літерали** (`pageMarkers.js:368` + `triageStage.js:157`),
   ризик дрейфу; кандидат на спільну константу (cleanup-спека).
5. **rich-профіль не «повний текст»** на довгих сторінках — A4 адаптивний паспорт
   має враховувати, що навіть rich обрізає тіло.
6. **Триаж-passthrough тихо валить 02.** Нема ключа / triage кинув / 0 документів
   → fallback persist гілка B, артефакти 02 НЕ пишуться (`triageStage.js:307,329,334`;
   `splitDocumentsV3.js:399`). Видимо лише через DIAG-decisions — адвокат бачить
   «оброблено», але без layout у 02. Потребує явного UI-сигналу.
7. **Старі покоління меж** (`analyzeViaToolUse`, `detectBoundariesV2/V3`) — мертві
   на live-шляху, тримаються лише тестами → кандидати на видалення (leanness-аудит §3.4).

---

**Кінець — audit_dp_slicing.md (Сценарій 1 + §3.5-C).**
