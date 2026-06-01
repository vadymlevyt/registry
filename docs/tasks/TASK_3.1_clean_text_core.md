# TASK 3.1 — clean_text: ЯДРО + DP-консолідація + viewer .md + schemaVersion 10

**Дата:** 2026-05-31
**Фаза:** 1/3 (фундамент). Parent: `TASK_3_clean_text.md` (наскрізні рішення/скоуп/заборони).
**Тип:** новий спільний сервіс + консолідація DP-зачатка + structural migration
**Гілка:** правило №1 CLAUDE.md (remote → `claude/*`, фолд у main після підтвердження — код+деплой)
**schemaVersion:** **bump 9 → 10** (textFormat/cleanedAt) — узгодити з адвокатом на старті
**Mermaid (узгоджений алгоритм, адвокат 2026-05-31):** `docs/mermaid/flow_clean_text.md` —
для цієї фази релевантні: §«СКОУП — тільки scanned», §«Архітектура: одне ядро — чотири
точки виклику», §«Ядро: 3-кроковий гібрид (один виклик cleanDocument)», §«Як крок 1 читає
layout — ВИРІШЕНО», §«Долі артефактів». Усе там розписано і розмальовано — читати ПЕРЕД кодом.

---

## МЕТА ФАЗИ

Закласти **спільне ядро очистки** і довести що воно живе через **єдиного реального
споживача — Document Processor** (прибравши його inline-дубль `aiCleanText`). Навчити
viewer показувати `.md`. Без цієї фази решта (3.2 кнопки, 3.3 вибір) не мають на що спиратись.

**Видимий результат:** DP-тумблер «Очистити для читання» дає гарний `.md` через спільне
ядро (а не inline-копію); viewer показує цей `.md`.

---

## PHILOSOPHY CHECK

- **Single Source of Truth / Rule of Three** — ОДНЕ ядро; DP стає першим споживачем
  (інші — у 3.2/3.3). Дубль `aiCleanText` ліквідовано.
- **Додавати, не переписувати** — DP-пайплайн не переробляємо: лише DI `cleanText`
  показує на ядро замість inline.
- **Однозначність (#11)** — ядро без React-стану (чиста логіка + DI); `textFormat` —
  окреме поле з одним сенсом.
- **Ембріон з ДНК** — C7-логування з народження; schemaVersion+міграція правильно з першого разу.

---

## ПОТОЧНИЙ СТАН (звірено з кодом)

| Що | Файл:рядок | Стан |
|----|-----------|------|
| WIP-чернетка конденсатора | `src/services/cleanTextService.js` (робоча гілка, НЕ в main) | **ЗЛАМАНА**: імпорт `LAYOUT_BLOCK_TYPES`/`isNoiseBlock` з `ocrService.js` — НЕ існують; формат `{type,text}` вигаданий |
| WIP-тест | `tests/unit/cleanTextService.test.js` | 34 кейси під вигаданий формат — адаптувати |
| inline AI-очисник | `DocumentPipelineContext.jsx:105-116` (`aiCleanText`) | Haiku, прибитий до DP — **ПЕРЕНЕСТИ в ядро** |
| виклик у пайплайні | `extractV3.js:42-92` (`createExtractV3`, DI `cleanText`+`cleanForReading`) | викликає `aiCleanText` |
| тумблер | `DocumentProcessorV2/index.jsx:49,745` (`cleanForReading:true`) | робочий |
| real layout shape | `documentAi.js:222-226` | Google-page + `_text`; зберігаються `paragraphs/blocks/tables/layout/dimension/_text` |
| усталений reader | `documentPipeline/pageMarkers.js:80-128` | **дзеркало**: `_text`+`boundingPoly` посторінково |
| viewer читає текст | `DocumentViewerContent.jsx:191` (`getCachedText`) | шукає ЛИШЕ `.txt` (`ocrService.js:51,99`) |
| міграційний ланцюг | `migrationService.js` + `App.jsx` EFFECT-A | `migrateToVersion9` останній; додати v10 |
| бекап-хелпери | `driveService.js:222-276` (PreV7/V8/V9) | додати `backupRegistryDataPreV10` |

---

## СКЛАДОВІ

### 3.1.1 — Ядро `cleanTextService.js` (переписати WIP)

```js
export const CLEAN_TEXT_SERVICE_VERSION = "2.0";

// КРОК 1 — конденсатор (детермінований, 0 токенів). Pure.
// Вхід: РЕАЛЬНИЙ Document AI pageStructure (Google-pages з _text) АБО .layout.json shape.
// Читає ПОСТОРІНКОВО через page._text. Структуру (heading/paragraph/list/table) —
// з геометрії boundingPoly+розмір. Дзеркалить pageMarkers.js (перевикористати
// orderedBlocks/blockBox — або винести у layoutGeometry-хелпер).
export function layoutToMarkdownDraft(pageStructure, options = {}) { ... } // → string

// КРОК 2+3 — оркестрація (DI, без React-стану).
export async function cleanDocument({
  document, caseData, apiKey,
  onProgress = () => {}, aiUsageSink = null,
  billAsUserAction = true,                 // DP передає false (див. parent §C7)
  // DI-шви (дефолти — реальні; тести стабують):
  fetchLayout, fetchRawText, callAI, saveMarkdown,
  moveRawTxtToArchive, deleteLayout, updateDocumentMeta,
  resolveModel, logAiUsage, activityTracker,
} = {}) {
  // 0. СКОУП-ГАРД: documentNature!=='scanned' → {ok:false, skipped:true, reason:'not_scanned'}
  // 1. fetchLayout? → КРОК1 конденсатор → draft. Немає → fetchRawText → draft(плоский).
  //    Немає ні layout ні txt → {ok:false, error:'NO_SOURCE'}.
  // 2. apiKey? → callAI(draft) → {markdown, attentionNotes}. C7-лог (parent §C7).
  //    Нема ключа/AI кинув/порожньо → markdown=draft, warning.
  // 3. saveMarkdown(.md) → moveRawTxtToArchive(.txt) → deleteLayout(.layout.json)
  //    → updateDocumentMeta({textFormat:'md', cleanedAt, attentionNotes}).
  // → {ok:true, markdown, attentionNotes, warning, stats}
}
```

- **Конденсатор** читає реальний shape: для кожної сторінки `_text` + `blocks`/`paragraphs`
  з `boundingPoly`. Заголовок/абзац/список — евристика геометрія+розмір. Таблиці → GFM.
  Шум (колонтитули/номери) — викинути. **НЕ offset'и в глобальний текст.**
- Прибрати биті імпорти `LAYOUT_BLOCK_TYPES`/`isNoiseBlock`. Якщо треба константи блоків —
  визначити локально в сервісі або взяти з `pageMarkers` (звірити що там є).
- **КРОК 2 промпт** (перенести+посилити з `aiCleanText`): консервативний (§6 design —
  не міняти зміст), повертає JSON `{markdown, attentionNotes:[{page?,note}]}`, depth-counter
  парсинг (НЕ regex).

### 3.1.2 — DP-інтеграція = очистка ПОСТ-КРОКОМ на готових документах

> ⚠ **ПОПРАВКА 2026-06-01 (нова філософія адвоката).** Перша редакція 3.1 уже приземлилась
> (гілка `clean-text-core-phase-3.1-YxOLP`, `fd8d913`, у main НЕ зведено): ядро/схема/viewer —
> правильні, лишаються. Але DP-інтеграцію зроблено за **старою** моделлю (де-дубльовано
> `polishToMarkdown`, проте `extractV3` досі чистить текст **ДО** нарізки/склейки, in-memory,
> і результат не персиститься — борг #42). Це **переробити** під модель адвоката нижче.
> Блокер, через який виконавець відклав це (гонка з паралельною image-merge сесією), **знятий** —
> та сесія завершилась, `splitDocumentsV3.js` вільний.

**Модель адвоката (єдино правильна):** тумблер «Очистити для читання» — це НЕ очистка
до нарізки. Це **той самий виклик ядра `cleanDocument`, підключений ОСТАННІМ кроком** —
коли нарізка/склейка вже розклала **фінальні** документи (у 01_ОРИГІНАЛИ) і їхні
`.txt`+`.layout` (у 02_ОБРОБЛЕНІ). Тоді на кожному готовому документі запускається
`cleanDocument` → `.md`. Тумблер вмикається перед стартом і означає рівно «цей крок
підключено в кінці». Це буквально те саме, що зробила б кнопка 3.2 — просто автоматично.

**Чому так** (дзеркало рішення з §«ВІДОМА WIP» і flow §256): очистка розчиняє межі
сторінок; нарізка потребує точних меж. Тому очистка СТРОГО після нарізки/склейки, на вже
роз'єднаних документах. Конфлікту «не можу розрізати MD» не існує → **борг #16 (Варіант
1/2/3) і #42 розчиняються повністю.** Працює однаково для slice і для merge.

**Що зробити:**
1. **Прибрати** стару проводку очистки до нарізки: гілку `cleanForReading`+`cleanText`
   у `extractV3.js` (рядки ~58-64, 80-81 `processedText`/`textFormat='md'`) і обгортку
   `aiCleanText` у `DocumentPipelineContext.jsx`. Вона мертва (MD ніколи не персиститься —
   `writeProcessedArtifacts` завжди пише `format:'txt'`). `extractV3` лишає текст сирим.
2. **Додати пост-крок** після фіналізації документів у `splitDocumentsV3` (після
   `writeProcessedArtifacts`, коли `.txt`+`.layout` у 02 готові): якщо тумблер увімкнено —
   по кожному новоствореному `scanned`-документу викликати `cleanDocument(document, {
   billAsUserAction:false, ...Drive-шви })`. Це **той самий виклик**, що й кнопки 3.2.
3. **Drive-шви** `cleanDocument` (`fetchLayout`/`fetchRawText`/`saveMarkdown`/
   `moveRawTxtToArchive`/`deleteLayout`/`updateDocumentMeta`) реалізувати тут поверх
   `ocrService`/`driveService` — **їх же перевикористає 3.2** (кнопки стають тонкими).
   fetchLayout читає `.layout.json` з 02; saveMarkdown пише `<basename>_<id>.md` у 02;
   решта — долі артефактів (parent §«Долі артефактів»).
4. **C7/білінг:** `billAsUserAction:false` (автопродовження обробки, не окрема дія) —
   токени в `ai_usage[]` завжди, `activityTracker` як дію — ні. Один шлях логування.

> Скоуп-межа: пост-крок чистить лише `scanned`-документи (гард уже в ядрі). DOCX/HTML
> (searchable) DP пропускає. Якщо тумблер вимкнено — пост-крок не запускається, документи
> лишаються з `.txt` (як сьогодні).

### 3.1.3 — schemaVersion 10 (structural)
- Канонічна схема `documentSchema.js`: `textFormat` (`'txt'|'md'`, default `'txt'`, required+nullable?),
  `cleanedAt` (ISO|null). Один-реченнєвий коментар сенсу на місці (#11).
- `migrateToVersion10` (новий крок або в `migrationService.js`): усім наявним документам
  `textFormat='txt'`, `cleanedAt=null`. Ідемпотентна.
- `App.jsx` EFFECT-A: додати виклик після v9, власний прапор проти повтору.
- `driveService.backupRegistryDataPreV10` (дзеркало PreV9).
- Експортовані `CURRENT_SCHEMA_VERSION=10`, `MIGRATION_VERSION='10.0_text_format'`.
- `attentionNotes` → `documents_extended.json` (EXTENDED_DOCUMENT_FIELDS), bump НЕ потребує.
- Оновити CLAUDE.md розділ канонічної схеми + правило #6 ланцюг (варіант A).

### 3.1.4 — viewer читає `.md`
- Новий `ocrService.getCleanOrRawText(file)`: шукає `<basename>_<id>.md`, далі `.txt`.
  > #11: НЕ розширювати `getCachedText` подвійним сенсом — нове ім'я.
- `DocumentViewerContent.jsx:191` → `getCleanOrRawText`. Рендерити Markdown (перевірити
  чи є MD-рендерер; DOCX/HTML рендери є — глянути `DocxRenderer`/`HtmlRenderer`; для `.md`
  можливо потрібен легкий MD→HTML, або показ як форматований текст).
- Звірити інших читачів тексту: `contextGenerator` (бере документи+`extractTextBatch` —
  ймовірно не через `.txt` напряму, АЛЕ перевірити чи має брати `.md` коли є).

---

## SAAS / BILLING / AI USAGE (фаза 3.1)
- **SAAS:** schemaVersion 10 — див. 3.1.3. tenant-scoped через справу.
- **BILLING:** DP-шлях `billAsUserAction:false` (автопродовження, не окрема дія) — токени в
  `ai_usage[]`, без окремого `activityTracker` як дії. Parent §C7.
- **AI USAGE:** agentType `textCleaner` → Haiku. `logAiUsage` context operation `clean_text`.

---

## ACCEPTANCE (3.1)
- [ ] `cleanTextService.js` переписано: `layoutToMarkdownDraft` читає РЕАЛЬНИЙ Google-shape
      посторінково через `_text`+геометрія; биті імпорти прибрано.
- [ ] `cleanDocument` оркестрація з DI; скоуп-гард scanned; fallback layout→txt→AI;
      AI-поліш консервативний з `attentionNotes` (JSON depth-counter); долі артефактів.
- [ ] C7-лог (agentType `text_cleaner`) один шлях; `billAsUserAction` прапор.
- [ ] DP (нова модель): стара очистка-до-нарізки ПРИБРАНА (`extractV3` гілка `cleanForReading`
      + `aiCleanText`); очистка перенесена у ПОСТ-КРОК після `writeProcessedArtifacts` —
      по кожному готовому `scanned`-документу `cleanDocument(billAsUserAction:false)`; Drive-шви
      реалізовано (перевикористає 3.2); тумблер увімкнено → `.md` персиститься для slice І merge.
- [ ] Борги #16 (Варіант 1/2/3) і #42 (cleaned-MD не персиститься) у `tracking_debt.md`
      ПОЗНАЧЕНО вирішеними (пост-крок їх розчиняє); один лог.
- [ ] schemaVersion 10: поля в схемі, `migrateToVersion10` ідемпотентна, бекап PreV10,
      EFFECT-A виклик+прапор, CURRENT_SCHEMA_VERSION/MIGRATION_VERSION оновлено.
- [ ] `attentionNotes` у extended (не registry).
- [ ] viewer показує `.md` (новий `getCleanOrRawText`); інші читачі звірені.
- [ ] Тест `cleanTextService.test.js` адаптовано під реальний shape (конденсатор на
      `_text`+`blocks`+`boundingPoly`, таблиці GFM, шум, посторінкова склейка; оркестрація:
      скоуп-гард, fallback, NO_SOURCE, AI-помилка→draft, артефакти+C7 через spy, billAsUserAction).
- [ ] Інтеграція: DP пост-крок (`cleanForReading` увімкнено → нарізаний/склеєний документ
      отримує `.md` персистентно; вимкнено → лишається `.txt`; скоуп scanned; один лог).
- [ ] Міграційний тест: v9→v10 ідемпотентний, default `textFormat='txt'`.
- [ ] `npm test` зелений, `npm run build` success.
- [ ] CLAUDE.md оновлено (канонічна схема + #6 ланцюг до v10).

## ЩО НЕ РОБИТИ (3.1)
- Наскрізні заборони parent. Плюс:
- ❌ Кнопки Огляд/Viewer/реєстр — це 3.2/3.3, НЕ тут.
- ❌ ACTION `clean_document_text` — 3.2.
- ❌ UI-вибір / видалення — 3.3.
- ❌ НЕ лишати очистку до нарізки (стара модель). Очистка — СТРОГО пост-крок на готових
  документах. НЕ намагатись різати/конкатити почищений MD по сторінках (через це й був борг).
- ❌ НЕ міняти `writeProcessedArtifacts` логіку запису сирого `.txt`/`.layout` — пост-крок
  іде ПІСЛЯ неї і перетворює `.txt`→`.md` через `cleanDocument`, не замість неї.

## ТЕСТИ (3.1)
- Unit `cleanTextService.test.js` (адаптувати): конденсатор реальний shape + оркестрація (spy).
- Unit міграція v9→v10 (ідемпотентність, default).
- Integration DP-консолідація.
- Існуючі DP/viewer/migration — зелені.

## ЗВІТ
`docs/reports/report_task3.1_clean_text_core.md`: форма ядра+конденсатор; як прибрано дубль
DP; schemaVersion 10 (міграція/бекап); C7+billAsUserAction; viewer `.md`; тести до/після;
знахідки→bugs/+debt; як перевірити; git confirm. Оновити ARCHITECTURE_HISTORY + parent мапу.

## ПЕРЕВІРКА АДВОКАТОМ (після deploy)
1. DP з тумблером «Очистити для читання» → нові скани одразу `.md` (через спільне ядро).
2. Viewer відкриває цей документ → бачить гарний `.md`; зміст не змінено.
3. DOCX/HTML через DP — НЕ чистяться (скоуп scanned).
4. Старі справи відкриваються, міграція v10 пройшла тихо (textFormat проставлено).

## ГОТОВНІСТЬ
- [x] Скоуп scanned, гібрид, долі артефактів, C7 — у parent.
- [ ] schemaVersion 10 узгодити з адвокатом ПЕРЕД стартом (structural, #6).

**Кінець TASK 3.1.**
