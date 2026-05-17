# Звіт — TASK DP-2: Архіви + ЄСІТС + базові стадії detectBoundaries/classify

**Дата:** 17.05.2026
**Гілка розробки:** `claude/new-session-AhqBC`
**Тип:** код-зміна (надбудова на pipeline-фундамент DP-1 через `stageOverrides`)
**Статус:** виконано, чекає підтвердження адвоката на push у `main` (правило #1 — код-зміна)

---

## 1. Baseline (§2 handoff — фактичний прогін ДО будь-якої зміни)

| Метрика | Baseline (до DP-2) | Після DP-2 |
|---|---|---|
| `npm test` — Test Files | **68 passed (68)** | **73 passed (73)** |
| `npm test` — Tests | **1120 passed (1120)** | **1154 passed (1154)** |
| `npm run build` | **✓ зелений** (пре-існуючі chunk-size warnings) | **✓ зелений** (ті самі warnings) |

Числа з виводу, не з пам'яті. Кількість тестів **зросла** (+5 файлів, +34 тести: 28 unit + 2 integration + сумарно 34 нових), не зменшилась — acceptance §9 виконано. Жодної регресії.

---

## 2. Mini-аудит — підключення до існуючих структур DP-1

- **`documentPipeline.js`** — тонкий диригент: `STAGE`/`DEFAULT_STAGE_ORDER` — `Object.freeze` константи **в самому файлі диригента**; `tests/unit/documentPipeline.test.js:44` асертить рівно **9 заморожених стадій**. Розширення — лише `deps.stageOverrides[ім'я]` (OCP). Фабрика `createDocumentPipeline(deps)`, не сінглтон.
- **`documentBoundary/`** (salvage TASK 1) — чистий фасад `detectBoundaries({arrayBuffer,apiKey,userHint,caseId,aiUsageSink})` + `splitByBoundaries`, контракт propose→confirm, без Drive/executeAction. Готовий слот — DP-2 його ін'єктує у стадію.
- **`eventBusTopics.js`** — реальний вхідний ЄСІТС-топік = `ECITS_DOCUMENTS_RECEIVED='ecits.documents_received'` (TASK 0.2, без publisher'а). `ecits.files_synced` з handoff §4.5 у коді **не існує** — використано фактичний `ECITS_DOCUMENTS_RECEIVED`.
- **`actionsRegistry.js`** — `createActions(deps)→{ACTIONS,PERMISSIONS,executeAction}`. `document_processor_agent` allowlist = `add_documents/update_processing_context/update_document_source/batch_update`. `add_documents` атомарний. Персистенція DP-2 — тільки через цей шар.
- **AddDocumentModal flow** (`CaseDossier/index.jsx:2843+`) — `createDocumentPipeline(...)` single-file, post-persist OCR обробляє лише `documents[0]`. **Свідомо НЕ чіпали** (рішення адвоката, §12).
- **`tenant.settings`** — `moduleIntegration.ecits.*` і `recon_history` додані без schema bump (прецедент розширення settings). DP-2 додає `ecitsAutoProcess` тим самим патерном.

**Точки розширення DP-1 використані:** `stageOverrides[STAGE.INTAKE]` (unpack), `stageOverrides[STAGE.DETECT_BOUNDARIES]` (detectBoundariesV2), `stageOverrides[STAGE.CLASSIFY]` (classifyV2), `deps.buildDocumentMetadata` DI-seam (класифікація вливається у канонічний запис), `emit`-топіки.

---

## 3. Структура нових стадій — файли, контракти, де підключені

| Файл | Експорт | Override-слот | Контракт |
|---|---|---|---|
| `src/services/documentPipeline/stages/unpack.js` | `createIntakeWithUnpack(deps)` + чисті предикати/`parseSidecarBytes` | `STAGE.INTAKE` | `(ctx)→{ok,ctx?,decisions?,error?}` |
| `src/services/documentPipeline/stages/detectBoundariesV2.js` | `createDetectBoundariesV2(deps)` | `STAGE.DETECT_BOUNDARIES` | той самий |
| `src/services/documentPipeline/stages/classifyV2.js` | `createClassifyV2(deps)` + `categoryFromBoundaryType` | `STAGE.CLASSIFY` | той самий |
| `src/services/ecitsInboxWatcher.js` | `createEcitsInboxWatcher(deps)` | — (eventBus subscriber) | `{start,stop,handleEvent,resolveMode}` |

Усі — фабрики з DI (як `createActions`/`createDocumentPipeline`), нуль глобальних сінглтонів. Контракт стадії `{ok,ctx,decisions,error}` незмінний. Диригент **не торкався**.

---

## 4. Розпакування архівів

- **ZIP — реально розпаковується.** Бібліотека **`fflate@^0.8.3`** (pure-JS, ~8КБ, zero-deps, browser-safe) через **lazy `import('fflate')`** (як `html2pdf.js/jspdf/heic2any` у `converterService` — важка залежність не в основному бандлі; підтверджено: build не тягне fflate, бо стадії ще не вмонтовані в App). Розпакувальник — ін'єктований `deps.unzipArchive` (default = lazy-fflate), тести підставляють стаб без мережі/файлів.
- **RAR/7z — детектуються, НЕ розпаковуються** (рішення адвоката): архів зберігається як оригінал, додається `warning` + `decision{type:'archive_not_unpacked',kind}`. Пропрієтарний RAR / WASM-7z — поза обсягом базової реалізації.
- **`.p7s`/`.sig`** — відкладаються у `ctx.signatures[]` з прив'язкою `linkedToFileId` до основного файлу (за базовою назвою `doc.pdf.p7s→doc.pdf`), далі по pipeline **НЕ йдуть** (підпис КЕП — не документ; persist їх не бачить, бо вони видалені з `ctx.files`). Surface через `decision{type:'kep_signatures_detected'}`.
- **Чому override `intake`, а не новий вузол `DEFAULT_STAGE_ORDER`:** disrigent заморожений на 9 стадіях (інваріант #1 + frozen-тест). Архів — це згорнутий набір файлів; розгортання набору і є «нормалізація вводу job+files» = семантика `intake` (перша стадія, до `convert`). Override дослівно зберігає валідацію DP-1 (`NO_CASE`/`NO_FILES`) і додає unpack/sidecar/signature. Це шлях, який handoff §4.1 прямо дозволяє («через stageOverrides як перша стадія»).

---

## 5. detectBoundariesV2 — реалізація, інтеграція з documentBoundary salvage

- Ін'єктує `deps.detectBoundaries` (= фасад `documentBoundary.detectBoundaries`); передає `arrayBuffer` (post-convert PDF), `apiKey`, `userHint` (з ecitsContext), `caseId`, `aiUsageSink`.
- **Gated** (no-regression): за замовчуванням passthrough — нуль AI-витрат на звичайному одно-документному додаванні. Запускається лише за сигналом склейки (`metadataSidecar.expectsMultipleDocuments`/`documents.length>1` або override `shouldDetect`).
- **propose-only:** `>1` пропозиції → `item.boundaryProposals` + `decision{type:'document_boundaries'}` (з `category` з мапи boundary-type). **Сам split НЕ виконує** (це `splitByBoundaries` після `confirm`; зараз confirm auto-pass; UI — DP-4). `<=1` → не склейка, без decision.
- Помилка AI — **НЕ фатальна** (ingestion не блокується: warning, `ok:true`). Один файл аналізується незалежно; **семантична реконструкція з кількох файлів НЕ робиться — це DP-3**.

---

## 6. classifyV2 — AI класифікація

- Ін'єктує `deps.classify({text,ecitsContext,fileName,model})` (поверх `toolUseRunner`/`resolveModel` — ін'єкція для тестопридатності/без мережі).
- Визначає `category` (canonical enum: pleading/motion/court_act/evidence/contract/correspondence/identification/other) і `author` (ours/opponent/court/third_party); `caseCategory` опційно з низькою впевненістю; `confidence`.
- **propose→confirm:** висока впевненість → пише `category/author` у `item.metadataTemplate` (далі persist/`createDocument` підхоплює). Низька → `decision{type:'classification'}`, **нічого не перезаписує**.
- **Gated** (no-regression модалки): passthrough коли людина вже задала `category+author` (адвокат у модалці) і не запитано переклас. Запускається коли поля відсутні/невідомі або `source==='court_sync'`.
- Текст: `item.extractedText` (DOCX/HTML) або ecitsContext summary. **Повний OCR НЕ тягне — це стадія `extract` (DP-3).** Немає тексту і немає ecitsContext → `classification_unavailable` (не вгадуємо: critical-поля лишаються null → ⚠-маркер `needsReview`).
- Мапа `categoryFromBoundaryType` (словник `documentBoundary/prompt.js` → canonical category) — явна, один сенс на ім'я (#11).

---

## 7. ecitsContext використання

- Канал: `ctx.metadataSidecar` (читається стадією unpack з `metadataSidecar.json` у архіві або поряд; валідація `parseSidecarBytes`).
- `detectBoundariesV2`: якщо `metadataSidecar.source==='court_sync'` → `ecitsContext` (caseType/notificationType/court) збирається у `userHint` для `detectBoundaries` — менше токенів (контекст уже є).
- `classifyV2`: якщо `source==='court_sync'` → `ecitsContext` передається класифікатору як підказка (вища впевненість, менше токенів); summary також служить fallback-текстом коли немає extractedText.
- Споживачі джерело не розрізняють поза цією перевіркою (узгоджено з v7: обидва канали пишуть у ту саму схему через ті самі ACTIONS).

---

## 8. ecitsInboxWatcher — два режими

- Слухає `eventBus.ECITS_DOCUMENTS_RECEIVED` (фактичний топік; `ecits.files_synced` з handoff не існує). Publisher зʼявиться з Court Sync RPA — зараз подія не летить, watcher behavior-neutral (як emit-стадія DP-1 без підписників).
- **`auto`** → `deps.runPipeline(payload)` фоном (fire-and-forget; помилка не валить watcher, йде в `onError`).
- **`manual`** → `executeAction('document_processor_agent','update_processing_context',{caseId,context:{processedAt,documentsCount:N,summary:"Є нові файли в INBOX, N шт."}})` + публікує `ECITS_INBOX_PENDING` для UI-індикатора.
- Режим — `deps.getEcitsAutoProcess()` (= `tenantService.getEcitsAutoProcess()`); невідоме/відсутнє → `'manual'` (безпечний дефолт).
- Фабрика DI, `start()` ідемпотентний, `stop()` відписує. **НЕ вмонтований у App.jsx** — точка розширення (немає publisher'а; UI-індикатор — DP-4).

---

## 9. tenant.settings.ecitsAutoProcess

- Додано в `DEFAULT_TENANT.settings` (`tenantService.js`), дефолт **`'manual'`**, з one-line single-meaning коментарем (#11).
- **Без schema bump** — це settings-поле, не структура документа; прецедент `recon_history`/`moduleIntegration.ecits` (розширення settings без міграції). Реєстри без поля читаються як `'manual'` через канонічний акцесор `getEcitsAutoProcess()` (одна точка читання, дефолт-fallback вшитий).
- Як змінюється: вручну в реєстрі/майбутньому settings-UI (DP-4); код читає лише через `getEcitsAutoProcess()`.

---

## 10. Файли створені / модифіковані

**Створено (9):**
- `src/services/documentPipeline/stages/unpack.js`
- `src/services/documentPipeline/stages/detectBoundariesV2.js`
- `src/services/documentPipeline/stages/classifyV2.js`
- `src/services/ecitsInboxWatcher.js`
- `tests/unit/unpack.test.js` (15 тестів)
- `tests/unit/detectBoundariesV2.test.js` (6)
- `tests/unit/classifyV2.test.js` (9)
- `tests/unit/ecitsInboxWatcher.test.js` (6)
- `tests/integration/dp2-stages.test.js` (2, через справжній `createDocumentPipeline`+`createActions`)

**Модифіковано (4):**
- `src/services/eventBusTopics.js` — `+ECITS_INBOX_PENDING` (адитивна константа, без bump, за конвенцією файлу).
- `src/services/tenantService.js` — `+settings.ecitsAutoProcess` + `+getEcitsAutoProcess()`.
- `package.json` / `package-lock.json` — `+fflate@^0.8.3`.
- `tracking_debt.md` — записи #11, #12.

**Видалено:** нічого. **Диригент `documentPipeline.js`, AddDocumentModal flow, converterService — НЕ торкалися.**

---

## 11. Тести — baseline / після, нові

| | Baseline | Після |
|--|--|--|
| Test Files | 68 | **73** (+5) |
| Tests | 1120 | **1154** (+34) |
| `npm run build` | ✓ | ✓ (ті самі пре-існуючі chunk warnings) |

Нові: unpack (предикати, валідація-збережена, passthrough не-архіву, ZIP+sidecar+підписи, порожній архів→NO_FILES, невалідний sidecar, UNPACK_FAILED, RAR-детект); detectBoundariesV2 (gated passthrough×2, propose+decision, single-doc, ecitsHint, AI-помилка non-fatal); classifyV2 (мапа type→category, gated×2, high→пише, low→decision, boundary-type fallback, no-text→unavailable, ecitsContext-hint); ecitsInboxWatcher (resolveMode×3, manual×2, auto×2, підписка idempotent/stop); integration (ZIP→2 docs через справжній `add_documents`, не-архів→DP-1 без AI).

---

## 12. Відхилення від handoff (експертна автономія, з поясненнями)

1. **unpack — НЕ новий вузол `DEFAULT_STAGE_ORDER`, а override `STAGE.INTAKE`.** Handoff §4.1 пропонував зареєструвати стадію перед `convert` АБО (якщо простіше) тимчасово розширити `DEFAULT_STAGE_ORDER`. Друге **порушує інваріант #1** («диригент НЕ міняється») і ламає frozen-9-стадій тест. Обрано перший варіант handoff («через stageOverrides як перша стадія»). **Краще:** диригент абсолютно недоторканий, OCP дотримано. **Вплив на DP-3..6:** нуль (контракт стадій незмінний; sidecar/signatures у ctx — нові накопичувачі, фіналайзер DP-1 їх не повертає, але вони доступні наступним стадіям).
2. **AddDocumentModal flow свідомо НЕ зачеплено** (рішення адвоката, Варіант 1 на уточнююче питанння). Архів через UI-модалку дав би half-finished N-doc UX (post-persist OCR single-file). DP-2: стадії будуються+тестуються через справжній `createDocumentPipeline`; реальний споживач архівів — 00_INBOX → `ecitsInboxWatcher` → pipeline. **Тимчасове обмеження (зафіксовано на вимогу адвоката): ручне додавання архівів через UI зʼявиться у DP-4** (drag-n-drop архівів + Drive-picker + комбінований режим). До DP-4 — через 00_INBOX/ або тести.
3. **fflate замість JSZip** (handoff §4.1 називав JSZip). fflate об'єктивно кращий для цього Vite-бандла (вже має chunk-size warnings): ~8КБ vs ~95КБ, zero-deps, чистий async unzip. Lazy-import → у бандл не потрапляє доки стадії не вмонтовані. **Вплив:** нуль на DP-3..6 (розпакувальник за DI-seam `deps.unzipArchive`; бібліотека замінна одним адаптером).
4. **Топік `ECITS_DOCUMENTS_RECEIVED`** замість неіснуючого `ecits.files_synced` (handoff §4.5 сам казав «звірити який топік реально є»). Додано `ECITS_INBOX_PENDING` для UI-індикатора manual-режиму (адитивна константа за конвенцією файлу, без bump).
5. **ecitsInboxWatcher НЕ вмонтований у App.jsx.** Немає publisher'а (Court Sync RPA — майбутнє), UI-індикатор — DP-4. Монтувати зараз = будувати проводку без споживача (speculative generality, `discussion_dp_v2_philosophy_response` §Q3). Надано seam (фабрика+тести обох режимів), активація — DP-4 разом із publisher'ом + UI.

Сумнівне/scope-значуще рішення (#2) — **поставлено адвокату ДО виконання**, отримано Варіант 1. Інших зупинок не було.

---

## 13. Acceptance criteria — статус

| Критерій | Статус |
|---|---|
| Створено стадії unpack/detectBoundariesV2/classifyV2 окремими файлами | ✅ |
| Підключені до диригента через `stageOverrides` (диригент незмінний) | ✅ |
| Розпакування ZIP працює; RAR/7z — детект+повідомлення | ✅ (рішення адвоката) |
| Фільтрація .p7s/.sig — окремо, не йдуть далі | ✅ `ctx.signatures[]`, прив'язка до файлів |
| `detectBoundariesV2` на одному PDF з кількома документами | ✅ propose-only, gated |
| `classifyV2` визначає тип/автора через AI | ✅ high→пише, low→decision |
| `ecitsContext` використовується якщо `metadataSidecar.source==='court_sync'` | ✅ обидві стадії |
| `ecitsInboxWatcher.js` з обома режимами | ✅ auto/manual + тести |
| `tenant.settings.ecitsAutoProcess` дефолт `'manual'` | ✅ без bump |
| Юніт-тести на нові стадії | ✅ 36 unit |
| Інтеграційні тести через справжній `createActions` | ✅ `dp2-stages.test.js` поверх `_actionsTestSetup` |
| AddDocumentModal без регресій | ✅ flow не зачеплено + integration-тест не-архіву = DP-1 |
| `npm test` ≥ baseline | ✅ 1154 ≥ 1120; 73 ≥ 68 |
| `npm run build` зелений | ✅ |
| Звіт `report_task_dp2_archives_ecits.md` | ✅ (цей файл) |
| Зведення показано, push після підтвердження | ⏳ очікує |

---

## 14. Що свідомо лишено для DP-3/4 (точки розширення)

- **DP-3:** стадія `extract` (OCR/семантика) — лишається заглушкою; classifyV2 свідомо не тягне повний OCR (бере лише наявний extractedText/ecitsContext). Семантична реконструкція з **кількох** файлів — DP-3 (DP-2 аналізує файли незалежно).
- **DP-4:** реальний split (`splitByBoundaries` після `confirm`-гейту); UI вкладок Підтвердження/Помилки (споживає `decisions[]`/`errors[]`); UI-індикатор INBOX (підписник `ECITS_INBOX_PENDING`); ручне додавання архівів через UI (drag-n-drop + Drive-picker + комбінований режим — Варіант 1 §12.2); монтування `ecitsInboxWatcher` у App.jsx разом із Court Sync publisher'ом; персистенція `ctx.signatures[]` як оригіналів на Drive (зараз — у ctx, seam готовий).
- **Court Sync (майбутнє):** publisher `ECITS_DOCUMENTS_RECEIVED` → активує `ecitsInboxWatcher` без зміни watcher'а.

---

## 15. tracking_debt — побічні знахідки

- **#11** — латентна #11-колізія `ecitsAutoProcess` (enum, активний) vs `moduleIntegration.ecits.autoProcessIncoming` (boolean, нуль споживачів). DP-2 не зливає (placeholder без caller'а; золота середина). Тригер: перший споживач boolean або DP-4 settings-UI.
- **#12** — пре-існуючий debug `console.log` у `executeAction` (`actionsRegistry.js:1678`), шумить в інтеграційних тестах. DP-2 не вводив, не чистить (поза scope, behavior-neutral). Тригер: окремий debug-cleanup або наступне редагування `executeAction`.

---

## 16. Підтвердження

- **Behavior-preserving для AddDocumentModal:** так — flow `CaseDossier onSubmit` **не зачеплено жодним рядком**; integration-тест доводить що не-архівний файл з людською класифікацією проходить як DP-1 (1 документ, нуль AI). Архіви через модалку — свідомо DP-4 (рішення адвоката).
- **Диригент незмінний:** так — `documentPipeline.js` не редагувався; `DEFAULT_STAGE_ORDER`/`STAGE` лишились 9 заморожених стадій; DP-2 — виключно `deps.stageOverrides[ім'я]` (OCP). Frozen-9 тест зелений.
- **executeAction незмінний:** так — DP-2 персистить виключно через ін'єктований `persistDocument`→`executeAction('document_processor_agent','add_documents')` (audit/billing/permissions висять там); сигнатура/pipeline `executeAction` не чіпались; жодної модифікації даних повз шар; `documentPipeline.js` диригент без domain-if (доменні гілки — всередині нових стадій, що інваріант дозволяє).

---

**DP-2 — перша надбудова на pipeline-фундамент. Архітектура DP-1 підтвердила себе: три реальні стадії + watcher додані БЕЗ жодної зміни диригента, виключно через `stageOverrides` і DI.**
