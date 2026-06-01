# Звіт — TASK 3.1: clean_text ЯДРО + DP-консолідація + viewer .md + schemaVersion 10

**Дата:** 2026-06-01
**Фаза:** 1/3 (фундамент). Parent: `docs/tasks/TASK_3_clean_text.md`.
**Гілка:** `claude/clean-text-core-phase-3.1-YxOLP`
**Статус:** код завершено, `npm test` зелений (1799 тестів), `npm run build` success.

---

## Що зроблено (за acceptance 3.1)

### 3.1.1 — Ядро `src/services/cleanTextService.js` (написано з нуля)

WIP-чернетки на гілці не було (втрачена між сесіями) — ядро написано наново під
**реальний Document AI shape**, не під вигаданий `{type,text}`. Три експорти:

- **`layoutToMarkdownDraft(pageStructure, options)`** — КРОК 1, чиста функція, 0 токенів.
  Приймає РЕАЛЬНИЙ Document AI `pageStructure` (масив Google-pages з `_text`) АБО
  `.layout.json` shape (`{pages:[...]}`). Читає **ПОСТОРІНКОВО через `page._text`**
  (надійне завжди), структуру виводить з геометрії `boundingPoly.normalizedVertices`
  + наявності `page.tables`. Дзеркалить `pageMarkers.js` (`blockBox`/`orderedBlocks`/
  footer-евристика). Логіка конденсації з опису WIP збережена і адаптована:
  `normalizeInlineText` (зшивання дефісних переносів, злиття обгорнутих рядків у
  абзаци, схлопування пробілів), списки → GFM, шум (надрукований номер сторінки у
  футері) викидається, заголовок (короткий центрований топ-блок) → `##`.

- **`polishToMarkdown({...})`** — КРОК 2, AI-поліш (Haiku). Консервативний промпт
  (§6 design — НЕ міняти зміст), повертає JSON `{markdown, attentionNotes}`, парсинг
  **depth-counter** (з обробкою рядків/escape, НЕ regex). C7-логування. Fallback:
  нема ключа / AI кинув / не-JSON / порожнє → `markdown=draft` + warning (не падає).

- **`cleanDocument({...})`** — КРОК 3, оркестрація (DI, без React-стану). Скоуп-гард
  `documentNature!=='scanned'` → `{ok:false, skipped:true, reason:'not_scanned'}`;
  fetchLayout→КРОК1 / інакше fetchRawText→плоска чернетка / інакше `NO_SOURCE`;
  КРОК2; **долі артефактів** через DI-шви: `saveMarkdown` → `moveRawTxtToArchive`
  (.txt→`_raw_txt/`) → `deleteLayout` (тільки коли використано layout) →
  `updateDocumentMeta({textFormat:'md', cleanedAt, attentionNotes})`.

**Форма конденсатора — рішення виконавця (зафіксовано):** блок/таблиця
`layout.textAnchor.textSegments` індексують **текст чанка**, який НЕ зберігається у
`.layout.json` (`documentAi.extractPageText` — лишається тільки `page._text`). Тому
per-block/per-cell текст з offset'ів **нереконструйований** — конденсатор будує текст
з `_text`, а геометрію використовує як **структурні підказки** (заголовок/футер) і
**маркер наявності таблиці** (HTML-коментар-підказка). Фінальне форматування таблиць
— за AI-полішем (він бачить нормалізований текст + підказку). Це повністю узгоджено з
рішенням «Варіант B» у `flow_clean_text.md` (посторінково через `_text`, не offset'и).

**Геометрія-хелпери** (`blockBox`/`orderedBlocks`/footer) — локальна копія-дзеркало
`pageMarkers.js` (сервіс самодостатній; винос у спільний `layoutGeometry` — у
`tracking_debt.md`, бо торкатися робочого DP-пайплайна зараз = ризик гонки з
паралельною DP-сесією).

### 3.1.2 — DP-консолідація

- **Inline `aiCleanText` у `DocumentPipelineContext.jsx` ВИДАЛЕНО** (власний промпт +
  виклик). Замість нього — тонка обгортка (1:1 контракт `cleanText(text,{fileName})→
  string`), що делегує у `cleanTextService.polishToMarkdown` з `billAsUserAction:false`
  (DP — автопродовження, не окрема оплачувана дія адвоката, parent §C7). Тепер AI-промпт
  + парсинг + C7 живуть в ОДНОМУ місці (ядро), DP — перший реальний споживач.
- DI-контракт `extract:createExtractV3({cleanText})` незмінний; змінилось лише що під
  нього підставляють. Поведінка тумблера «Очистити для читання» ідентична.

### 3.1.3 — schemaVersion 10 (узгоджено з адвокатом ПЕРЕД кодом)

- `documentSchema.js`: `textFormat` (`'txt'|'md'`, required, default `'txt'`, НЕ nullable),
  `cleanedAt` (ISO|null). `attentionNotes` → `EXTENDED_DOCUMENT_FIELDS` (важке поле, bump
  не потребує). Один-реченнєвий коментар сенсу на місці (#11).
- `documentFactory.createDocument` проставляє `textFormat`/`cleanedAt`.
- `migrateToVersion10(registry)` — новий крок, ідемпотентний, кожному документу
  `textFormat='txt'`+`cleanedAt=null` якщо відсутні; `schemaVersion=10`,
  `settingsVersion='10.0_text_format'`. Експорти `CURRENT_SCHEMA_VERSION=10`,
  `MIGRATION_VERSION='10.0_text_format'`. `labelForVersion` оновлено.
- `driveService.backupRegistryDataPreV10` (дзеркало PreV9).
- `App.jsx` EFFECT-A: pre-v10 бекап (прапор `levytskyi_pre_v10_backup_done`) + виклик
  `migrateToVersion10` після v9; також у шляху відновлення з бекапу.

### 3.1.4 — viewer читає `.md`

- `ocrService.getCleanOrRawText(file)` — нове ім'я (НЕ розширюємо `getCachedText`
  подвійним сенсом, #11): спочатку `<basename>_<id>.md`, інакше `.txt`. Повертає
  `{text, format}`.
- `DocumentViewerContent.jsx` (режим Текст) → `getCleanOrRawText`; рендерить `.md`
  через новий `MarkdownRenderer.jsx` (легкий MD→HTML без npm-залежності: заголовки,
  жирний/курсив, код, списки, GFM-таблиці, hr, абзаци; ВЕСЬ текст екранується перед
  розміткою). `.txt` — як було (`<pre>`). Re-fetch також на зміну `document.cleanedAt`.
- **Інші читачі звірені:** `contextGenerator` бере документи через
  `ocrService.extractTextBatch` (OCR/кеш `.txt`, не `.md` напряму) — лишаємо як є
  (його джерело — самі документи, не текст-кеш; перемикання на `.md` — поза 3.1, борг).
  `DocumentViewerFooter` використовує `getCachedText` (сирий .txt для копіювання) —
  лишаємо (3.1 вимагає лише контент viewer'а).

---

## C7 + billAsUserAction (parent §C7)

- agentType `textCleaner` у `modelResolver.SYSTEM_DEFAULTS` → Haiku.
- `logAiUsage({agentType:'text_cleaner', context:{caseId, module, operation:'clean_text',
  documentId}})` — **завжди** (токени в `ai_usage[]`).
- `activityTracker.report('agent_call', ...)` — **лише при `billAsUserAction:true`**
  (кнопки/ACTION у 3.2). DP передає `false`. Один сенс прапора (#11).

---

## Тести (до/після)

База до TASK: **1753**. Після: **1799** (+46).

- **Unit `tests/unit/cleanTextService.test.js`** (новий, 28 кейсів): конденсатор на
  реальному shape (`_text` посторінково, заголовок з геометрії, дефіс-переноси,
  злиття абзаців, футер-шум, GFM-списки, таблиця-підказка, обидва shape входу);
  polishToMarkdown (нема ключа, JSON-парс, C7 agentType/operation, billAsUserAction
  true/false, AI кинув→draft, не-JSON→plain); cleanDocument (скоуп-гард, layout→
  артефакти у правильному порядку, txt-fallback без deleteLayout, NO_SOURCE,
  AI-помилка→draft але зберігає, billAsUserAction passthrough, NO_DOCUMENT).
- **Integration `tests/integration/clean-text-dp.test.js`** (новий, 3 кейси):
  `createExtractV3` + cleanText=обгортка над реальним `polishToMarkdown` → `processedText`
  md, `textFormat='md'`, ядро+callAI рівно раз, `logAiUsage` раз, `activityTracker` НЕ
  викликаний (DP). cleanForReading=false → txt без виклику. Ядро кинуло → сирий OCR +
  decision `text_clean_failed`.
- **Міграція `tests/unit/migrations.test.js`** (+6 кейсів): v9→v10 default `txt`/null,
  ідемпотентність, не затирає `md`, lastMigration.to=10, stats, справи без documents[].
- **Оновлено існуючі під bump:** `documentSchema.test.js` (28→30 канон, 7→8 extended,
  +textFormat/cleanedAt/attentionNotes), `canonicalSchemaV7.test.js` /
  `founderFlag.test.js` (v9→v10 константи + buildEmptyRegistry), `migrations.test.js`
  (v9-блок тепер звіряє таргет=v10), viewer-тести (+`getCleanOrRawText` у мок).

---

## Знахідки → bugs / debt

- **DP cleaned-MD не персиститься для нарізаних документів** (вже існуюча умова, НЕ
  регресія 3.1): `extractV3` рахує очищений текст, але `splitDocumentsV3`
  **свідомо** бере сирий per-page `_text` і пише `.txt` (рядки 552-555) — інтеграція
  clean+нарізка відкладена. Записано у `docs/bugs/bugs_found_during_clean_text_core.md`
  + `tracking_debt.md`. 3.1 НЕ розширює скоуп на це (parent заборона + паралельна
  DP-сесія).
- **Винос геометрії у спільний `layoutGeometry`** — `tracking_debt.md` (тригер: третій
  споживач geometry-хелперів).

---

## Як перевірити адвокатом (після deploy)

1. **DP з тумблером «Очистити для читання»** на новому скані → документ одразу `.md`
   (через спільне ядро). У viewer режим Текст показує гарний форматований Markdown.
2. **Viewer** відкриває такий документ → бачить заголовки/абзаци/списки; зміст не змінено.
3. **DOCX/HTML через DP** — НЕ чистяться (скоуп тільки scanned).
4. **Старі справи** відкриваються, міграція v10 пройшла тихо (`textFormat='txt'`
   проставлено всім; у консолі лог `[TASK 3.1] Migration ... → v10 done`).

---

## Git confirm

Це КОД → фолд у `main` ТІЛЬКИ після підтвердження адвоката (push у main тригерить
CI+деплой). Зведення: `git fetch origin main` → tmp-гілка від свіжого `origin/main`
→ перенести зміни → `npm test` зелений → `npm run build` success → чистий FF → показати
зведення → push після «ок».

**Кінець звіту TASK 3.1.**
