# TASK 3 — clean_text (Очищення тексту → Markdown), смуга C

**Дата:** 2026-05-31
**Тип:** новий спільний сервіс (вісь логіки) + винос існуючого UI-вибору (вісь інтерфейсу)
**Гілка розробки:** правило №1 CLAUDE.md за середовищем (remote → `claude/*`, фолд у `main` після підтвердження адвоката, бо це код+деплой)
**schemaVersion:** без bump (нові поля документа nullable — див. §SAAS, але перевірити правило #6)
**Базові документи:**
- `docs/consultations/consultation_clean_text_design.md` — SSOT продуктового наміру
- `docs/mermaid/flow_clean_text.md` — **узгоджений алгоритм** (5 діаграм, адвокат затвердив 2026-05-31)
- `docs/tasks/TASK_context_generator_unify.md` + `docs/reports/report_task_context_generator_unify.md` — патерн-зразок «спільний сервіс, DI, C7-логування»

---

## МЕТА

Перетворити сирий OCR-текст сканованого документа (`.txt`) на **гарний читабельний
Markdown** (`.md`) — абзаци, заголовки, жирний шрифт, таблиці, максимально близько
до оригіналу — **не змінюючи юридичний зміст** (краще лишити сміття, ніж зіпсувати
зміст; реальний кейс §6 design-файлу).

Зробити це **спільним сервісом з самого народження** (Rule of Three / правило #11),
що його кличуть 4 точки. Зокрема — **витягти** наявний inline-зачаток `aiCleanText`
з Document Processor у це спільне ядро (DP перестає мати власну копію).

Паралельно (інтерфейсна «нагрузка», не логіка очистки) — **винести механіку вибору
файлів** з `ArchiveView` у спільний компонент і застосувати її в реєстрі документів
для пакетної очистки і пакетного видалення.

---

## PHILOSOPHY CHECK

- **AI-first** — очистка доступна і через UI (4 кнопки), і через агента (новий ACTION,
  див. §AI-first). Voice-aware через текст-команду агенту.
- **Single Source of Truth / Rule of Three** — ОДНЕ ядро `cleanTextService.js`, 4
  споживачі. UI-вибір — ОДИН компонент, 3 споживачі.
- **Додавати, не переписувати** — `aiCleanText` переїжджає у ядро (DP стає тонким
  споживачем); `ArchiveView` рефакториться на спільний компонент (поведінка Архіву
  лишається ідентичною).
- **Однозначність (#11)** — ядро без React-стану (чиста логіка + DI); UI-стан у
  компонентах. Поле `textFormat` про формат тексту, окреме від `documentNature`/`status`.
- **Ембріон з повним ДНК** — C7-логування (ai_usage + time_entries), tenant-scoped
  через справу, з народження.
- **Тести разом з кодом** — unit на ядро (детермінований конденсатор + оркестрація),
  unit на спільний компонент вибору, інтеграція на DP-консолідацію і новий ACTION.

---

## ЕКСПЕРТНА АВТОНОМІЯ

Код звірений на момент написання (рядки могли зсунутись — **перечитуй перед зміною**).
Сам вирішуєш (фіксуй у звіті):
- Точну форму ядра (DI-шви, що чисте, що приймає callbacks) — дзеркаль `contextGenerator`.
- Точну форму спільного компонента вибору (props, де живе `selectedIds`-стан).
- Деталі конденсатора (евристика заголовок/абзац за геометрією).

Знахідки «по дорозі» → `docs/bugs/bugs_found_during_clean_text.md` + `tracking_debt.md`.
**НЕ виправляти попутні баги в коді** — лише фіксувати.

---

## СКОУП (перевірено по коду — критично)

Очистка працює **ВИКЛЮЧНО** для `documentNature==='scanned'`:
- скани (PDF/фото через Document AI) — мають `.layout.json` (геометрія);
- фото, склеєні→PDF у Document Processor — мають `mergeLayout`.

**`documentNature==='searchable'` (DOCX, HTML, PDF з текстовим шаром) — ПОВНІСТЮ
ПОЗА ФУНКЦІЄЮ.** Кнопка неактивна / цикл пропускає. Причина (по коду):
- `.layout.json` створює ТІЛЬКИ Document AI; `pdfjsLocal` за дизайном не дає
  `pageStructure` (`ocr/pdfjsLocal.js:8`);
- у searchable вже чистий цифровий текст з джерела (не OCR-сміття) — чистити нема чого,
  AI-поліш = марна трата токенів.

| Формат | documentNature | `.layout.json` | Очистка |
|--------|---------------|----------------|---------|
| Скан PDF/фото (Document AI) | `scanned` | ✅ | ✅ повний гібрид |
| Фото склеєні→PDF (DP) | `scanned` | ✅ | ✅ |
| DOCX / HTML / текстовий PDF | `searchable` | ❌ | ❌ ігнор |

---

## ДВІ ОСІ ЦІЄЇ СЕСІЇ (не плутати)

**Вісь A — логіка очистки** (ядро `cleanTextService.js`): 4 точки виклику.
**Вісь B — інтерфейс вибору файлів** (спільний компонент з `ArchiveView`): 3 точки.

Осі незалежні: видалення/вибір файлів НЕ стосується алгоритму очистки — це
інтерфейсна нагрузка, об'єднана в сесію бо зручно (раз робимо мультивибір для
очистки — той самий вибір дає і пакетне видалення).

---

## ВІСЬ A — ЯДРО `cleanTextService.js`

### Поточний стан (звірено з кодом)

| Що | Файл:рядок | Стан |
|----|-----------|------|
| WIP-чернетка конденсатора | `src/services/cleanTextService.js` (на робочій гілці, НЕ в main) | **ЗЛАМАНА**: імпортує `LAYOUT_BLOCK_TYPES`/`isNoiseBlock` з `ocrService.js` — таких експортів НЕМАЄ; очікує вигаданий формат `{type,text}` замість реального Google-shape |
| WIP-тест | `tests/unit/cleanTextService.test.js` (робоча гілка) | 34 кейси під вигаданий формат — адаптувати |
| inline AI-очисник (DP-зачаток) | `DocumentPipelineContext.jsx:105-116` (`aiCleanText`) | робочий, Haiku, прибитий до DP — **ПЕРЕНЕСТИ в ядро** |
| виклик у DP-пайплайні | `extractV3.js:42-92` (`createExtractV3`, deps `cleanText`+`cleanForReading`) | викликає `aiCleanText` через DI |
| тумблер DP | `DocumentProcessorV2/index.jsx:49,745` (`cleanForReading:true`) | робочий |
| real layout shape | `ocr/documentAi.js:222-226` | сторінка = Google-page + `_text`; зберігаються `paragraphs/blocks/tables/layout/dimension/_text`; стрипляться лише `image/tokens` |
| усталений reader layout | `documentPipeline/pageMarkers.js:80-128` | **дзеркало для конденсатора**: `_text` + `boundingPoly` посторінково |

### Форма ядра (дзеркало `contextGenerator`)

```js
// src/services/cleanTextService.js
export const CLEAN_TEXT_SERVICE_VERSION = "2.0";

// КРОК 1 — конденсатор (детермінований, 0 токенів AI). Pure.
// Вхід — РЕАЛЬНИЙ Document AI pageStructure (масив Google-pages з _text),
// АБО layout.json shape { pages:[{ _text, blocks/paragraphs, tables, dimension }] }.
// Читає ПОСТОРІНКОВО через page._text (offset'и в глобальний .txt ненадійні на
// сканах >25 стор. — documentAi.js:428-435 перебазовує лише pageNumber).
// Структуру (заголовок/абзац/список/таблиця) виводить з геометрії boundingPoly
// + розміру блоку. Дзеркалить pageMarkers.js (можливо перевикористовує
// orderedBlocks/blockBox — винести у спільний layoutGeometry-хелпер якщо треба).
export function layoutToMarkdownDraft(pageStructure, options = {}) { ... } // → string (чернетка)

// КРОК 2+3 — оркестрація (DI). Без React-стану.
export async function cleanDocument({
  document,            // { id (driveId), name, documentNature, subFolders, ... }
  caseData,            // для caseId/tenant/категорії білінгу
  apiKey,
  onProgress = () => {},
  aiUsageSink = null,
  // DI-шви (дефолти — реальні імпорти; тести стабують):
  fetchLayout,         // (doc) → pageStructure|null  (Drive .layout.json loader)
  fetchRawText,        // (doc) → string|null         (Drive .txt loader, fallback)
  callAI,              // (draft, {fileName}) → { markdown, attentionNotes[] }
  saveMarkdown,        // (doc, md) → driveId         (запис <basename>_<id>.md у 02)
  moveRawTxtToArchive, // (doc) → void                (.txt → 02_ОБРОБЛЕНІ/_raw_txt/)
  deleteLayout,        // (doc) → void                (видалити .layout.json назавжди)
  updateDocumentMeta,  // (doc, fields) → void        (через executeAction update_document)
  resolveModel, logAiUsage, activityTracker,
} = {}) {
  // 0. СКОУП-ГАРД: documentNature!=='scanned' → { ok:false, skipped:true, reason:'not_scanned' }
  // 1. fetchLayout → є? КРОК 1 конденсатор → draft. Немає (старий скан)? fetchRawText → draft (плоский).
  //    Немає ні layout ні txt → { ok:false, error:'NO_SOURCE' }.
  // 2. apiKey є? callAI(draft) → { markdown, attentionNotes }. C7-лог (див. нижче).
  //    apiKey нема / AI кинув / порожньо → markdown = draft (deterministic-only), warning.
  // 3. saveMarkdown(.md) → moveRawTxtToArchive(.txt) → deleteLayout(.layout.json)
  //    → updateDocumentMeta({ textFormat:'md', cleanedAt, attentionNotes }).
  // → { ok:true, markdown, attentionNotes, warning, stats }
}
```

### КРОК 2 — AI-поліш: консервативний промпт (§6 design)

Промпт **жорстко** забороняє міняти зміст:
- НЕ виправляти цитати, суми, дати, імена, формулювання — навіть якщо здається помилкою;
- форматувати: заголовки, жирний, абзаци, відступи, списки, таблиці — близько до оригіналу;
- що привернуло увагу (можлива розбіжність) → у `attentionNotes[]` БЕЗ зміни тексту
  (як «звернути увагу» в нарізці);
- повернути JSON `{ markdown, attentionNotes:[{page?, note}] }` (depth-counter парсинг,
  як ACTION_JSON — НЕ regex; CLAUDE.md «ACTION_JSON парсинг»).

Перенести й узагальнити наявний промпт з `aiCleanText` (`DocumentPipelineContext.jsx:108`),
посиливши консервативність і додавши `attentionNotes`.

### C7 — логування (один шлях на всіх споживачів)

Дзеркаль `contextGenerator` (`:588-601`):
```js
const model = resolveModel('textCleaner');   // НОВИЙ agentType (див. §AI USAGE)
logAiUsage({ agentType:'text_cleaner', model, inputTokens, outputTokens,
  context:{ caseId, module:MODULES.CASE_DOSSIER, operation:'clean_text', documentId } }, aiUsageSink);
activityTracker.report('agent_call', { caseId, module:MODULES.CASE_DOSSIER,
  category: categoryForCase(caseId), metadata:{ agentType:'text_cleaner', operation:'clean_text', documentId } });
```
Білінг-нюанс — див. §BILLING (DP-шлях vs кнопка адвоката).

### Долі артефактів (КРОК 3)

| Артефакт | Після очистки | Реалізація |
|----------|---------------|------------|
| `<basename>_<id>.md` | **створюється** у 02_ОБРОБЛЕНІ | новий `ocrService.writeMarkdownArtifact` АБО `saveMarkdown` через driveService |
| `<basename>_<id>.txt` | **переміщається** у `02_ОБРОБЛЕНІ/_raw_txt/` | новий хелпер (Drive: створити підпапку latin-safe, перемістити) |
| `<basename>_<id>.layout.json` | **видаляється назавжди** | `deleteDriveFile` (паливо відпрацювало) |
| метадані документа | `textFormat:'md'`, `cleanedAt`, `attentionNotes` | `update_document` ACTION |

---

## ВІСЬ A — 4 ТОЧКИ ВИКЛИКУ

### 1. Document Processor (консолідація)
- **Видалити** inline `aiCleanText` з `DocumentPipelineContext.jsx`; натомість DI
  `cleanText` показує на ядро `cleanTextService` (тонка обгортка — DP передає текст,
  ядро КРОК 2 полірує). DP вже має текст+layout у пайплайні — передає їх у ядро.
- Тумблер «Очистити для читання» лишається; поведінка ідентична, але через спільне ядро.
- **Один шлях логування** — DP більше не дублює, тягне з ядра.

### 2. Кнопка «Очистити тексти» в Огляді (retroactive, N документів)
- Поряд зі «Створити контекст» (`CaseDossier` Огляд).
- Сканує документи справи; **фільтр**: тільки `scanned` з сирим текстом (`textFormat!=='md'`).
- Пропускає `searchable` і вже-`.md`.
- Цикл `cleanDocument` по черзі, прогрес «Чищу N з M» (дорого — N AI-викликів).
- ResultCard: очищено N, пропущено M, помилок K, згруповані `attentionNotes`.

### 3. Кнопка «Очистити документ» у Viewer
- На панелі DocumentViewer (header/footer), коли відкрито scanned-документ.
- Один `cleanDocument`. Після — viewer показує свіжий `.md`.

### 4. Мультивибір у реєстрі → «Очистити вибрані»
- Через спільний компонент вибору (Вісь B).
- Фільтр scanned; для вже-`.md` — перепит «Перезапустити очистку?» (так → reclean, ні → skip).

---

## ВІСЬ B — СПІЛЬНИЙ КОМПОНЕНТ ВИБОРУ ФАЙЛІВ

### Поточний стан (звірено)
`ArchiveView.jsx` (178 рядків) має чисту механіку вибору: props `selectedIds` (Set),
`onSelectAll`, `onToggleSelected` + батч-панель (зверху bulk, знизу toolbar при виборі);
стан `selectedArchivedIds` живе в `CaseDossier:895`. Картка-вибір — `<Checkbox>` з UI.

### Завдання
- **Винести** механіку вибору у спільний компонент (напр. `components/CaseDossier/
  FileSelectionList` або `components/shared/SelectableList`) — рендер списку з чекбоксами,
  select-all (з indeterminate), батч-панель дій. Дії (відновити/видалити/очистити) —
  через props-слоти (бо різні в Архіві vs реєстрі).
- **CSS уніфікувати** — спільний клас, тягнеться з одного місця (не дублювати
  `archive-view__*` / `archive-card__*`).
- **3 точки:**
  1. **Архів** — рефактор `ArchiveView` на спільний компонент (поведінка ІДЕНТИЧНА:
     відновити/видалити обрані/всі).
  2. **Реєстр → очистити вибрані** (Вісь A точка 4).
  3. **Реєстр → видалити вибрані** (нижче).

### Реєстр: режим вибору + дві батч-дії
- У реєстрі матеріалів (`CaseDossier`, дерево/список документів) — увімкнути режим
  вибору (чекбокси, select-all) через спільний компонент.
- Батч-панель: **«Очистити вибрані»** (Вісь A) + **«Видалити вибрані»**.

### Пакетне видалення (інтерфейсна нагрузка)
Зараз видалення — по одному (`DeleteDocumentModal`, `deleteOcrCacheForDocument`).
Стає 1/кілька/всі. **Повне видалення** кожного (вже є логіка — переюзати):
- файл у `01_ОРИГІНАЛИ` на Drive (`deleteDriveFile`);
- `.txt` + `.layout.json` (`deleteOcrCacheForDocument` — `driveService.js:505`);
- `.md` якщо очищений (додати у `deleteOcrCacheForDocument` або поряд);
- `_raw_txt/` копія якщо є;
- метадані документа з реєстру (через `delete_document` ACTION).
Підтвердження перед видаленням (батч-діалог із кількістю).

---

## VIEWER — ЧИТАННЯ `.md` (перевірено: зараз читає лише `.txt`)

`DocumentViewerContent.jsx:191` бере текст через `ocrService.getCachedText(file)` —
а той шукає `<basename>_<id>.txt` (`ocrService.js:51,99`). Після очистки тексту в `.txt`
вже немає (переміщений), є `.md`.

**Завдання:** навчити viewer (і будь-кого, хто читає текст документа) брати
**`.md` якщо є, інакше `.txt`**. Реалізація — новий `ocrService.getCleanOrRawText(file)`
(спершу шукає `.md`, далі `.txt`) АБО розширити `getCachedText`. Перевірити інших
читачів тексту: `contextGenerator` (бере документи+`extractTextBatch`, не `.txt` напряму —
ймовірно не торкається, АЛЕ звірити), агент досьє.

> #11-застереження: якщо розширюєш `getCachedText` новим сенсом («.md або .txt») —
> пауза. Можливо чистіше нове ім'я `getCleanOrRawText`, а `getCachedText` лишити «лише .txt».

---

## AI-FIRST — ACTION для агента (дублювання інтерфейсів)

Очистка має бути доступна агенту, не лише UI (DEVELOPMENT_PHILOSOPHY §6):
- Новий ACTION `clean_document_text({ caseId, documentId })` у `actionsRegistry.js`.
- Handler кличе `cleanDocument` (те саме ядро).
- PERMISSIONS: `dossier_agent` отримує `clean_document_text`. (DP вже діє через свій шлях.)
- Агент досьє у промпті: «можеш очистити текст документа — `clean_document_text`».
- Так адвокат може голосом/текстом: «очисти оцей документ» / «почисти всі тексти справи».

---

## SAAS IMPLICATIONS

### Поля документа (канонічна схема)
- `textFormat`: `'txt' | 'md'` — формат збереженого тексту в 02_ОБРОБЛЕНІ. Default `'txt'`.
  > Один сенс (#11): «у якому форматі лежить витягнутий текст документа». НЕ плутати з
  > `documentNature` (природа файла) і `status` (lifecycle).
- `cleanedAt`: ISO timestamp останньої очистки, nullable.
- `attentionNotes`: масив `[{page?, note}]` — що AI помітив, nullable. **Важке поле** —
  розглянути зберігання в `documents_extended.json` (а не в registry), як tags/annotations.
- **Перевірити правило #6:** додавання полів у канонічну схему = bump schemaVersion +
  міграція. Якщо `textFormat`/`cleanedAt` йдуть у канонічну `cases[].documents[]` —
  потрібен **schemaVersion 10** + `migrateToVersion10` (ідемпотентна, default `textFormat='txt'`
  усім наявним) + бекап `_backups/`. Узгодити з адвокатом ПЕРЕД реалізацією (це structural).
  `attentionNotes` як extended-поле bump не потребує.

### Permissions / Tenant
- Новий ACTION `clean_document_text` через `executeAction` (повна перевірка доступу).
- tenant-scoped через справу (документ у справі). Без нових перевірок.

---

## BILLING IMPLICATIONS

- Очистка — AI-виклик. Категорія `case_work` (billable) коли її **запускає адвокат**
  (кнопки Огляд/Viewer/реєстр, ACTION агента).
- **DP-шлях** (тумблер у процесі обробки пакета) — автоматичне продовження обробки.
  Дзеркаль рішення `contextGenerator` (звіт §2: DP-естафета НЕ репортить окремо
  `context_regenerated`): токени в `ai_usage[]` пишуться завжди (через `aiUsageSink`),
  але `activityTracker.report` як окрему дію адвоката DP-шлях не дублює.
  → У ядрі: прапор `billAsUserAction` (default true для кнопок; DP передає false).
  > Один сенс (#11): «чи нараховувати цей виклик як окрему оплачувану дію адвоката».
- Точка інструментації: `clean_text` operation у `ai_usage[]` (оператор SaaS бачить токени).

## AI USAGE IMPLICATIONS
- **agentType:** новий `textCleaner` у `SYSTEM_DEFAULTS` (`modelResolver.js`) →
  `'claude-haiku-4-5-20251001'` (очистка — масова дешева операція, Haiku як DP-зачаток).
- `logAiUsage` context: `{ caseId, module:'case_dossier', operation:'clean_text', documentId }`.
- JSON-промпт (не Tool Use) — як `contextGenerator`.

---

## ACCEPTANCE

**Ядро (Вісь A):**
- [ ] `cleanTextService.js` переписано: `layoutToMarkdownDraft` читає РЕАЛЬНИЙ Google-shape
      посторінково через `_text`+геометрія (не вигаданий `{type,text}`, не offset'и).
- [ ] WIP-чернетка полагоджена (відсутні імпорти `LAYOUT_BLOCK_TYPES`/`isNoiseBlock`
      прибрано/замінено); тест адаптовано під реальний shape.
- [ ] `cleanDocument` оркестрація з DI; скоуп-гард `scanned`; fallback layout→txt; AI-поліш
      з `attentionNotes`; долі артефактів (.md / .txt→_raw_txt/ / delete layout / meta).
- [ ] AI-поліш консервативний (не міняє зміст), JSON depth-counter парсинг, `attentionNotes`.
- [ ] C7-логування (agentType `text_cleaner`) один шлях; `billAsUserAction` прапор.

**4 точки (Вісь A):**
- [ ] DP: inline `aiCleanText` ВИДАЛЕНО, DP кличе ядро; тумблер працює ідентично; один лог.
- [ ] Огляд: кнопка «Очистити тексти», фільтр scanned+сирий, прогрес N/M, ResultCard.
- [ ] Viewer: кнопка «Очистити документ» для scanned; після — показує `.md`.
- [ ] Реєстр: «Очистити вибрані» через спільний компонент; перепит для вже-.md.

**Viewer/читачі:**
- [ ] viewer показує `.md` якщо є (новий `getCleanOrRawText` або розширення); інші читачі звірені.

**Вісь B (UI-вибір):**
- [ ] Спільний компонент вибору винесено з `ArchiveView`; CSS уніфіковано (один шлях).
- [ ] Архів рефакторено на нього — поведінка ІДЕНТИЧНА.
- [ ] Реєстр: режим вибору + «Очистити вибрані» + «Видалити вибрані» (повне видалення).

**AI-first / SaaS:**
- [ ] ACTION `clean_document_text` + PERMISSIONS `dossier_agent`; агент у промпті.
- [ ] `textFormat`/`cleanedAt` — рішення про schemaVersion 10 узгоджено (структурне, #6);
      `attentionNotes` в extended.

**Загальне:**
- [ ] Нові unit: конденсатор (реальний shape, таблиці, шум, посторінково), оркестрація
      (скоуп-гард, fallback, артефакти, C7 через spy), спільний компонент вибору.
- [ ] Нові інтеграційні: DP-консолідація (тумблер через ядро), ACTION `clean_document_text`,
      пакетне видалення.
- [ ] `npm test` зелений (число зросте), `npm run build` success.
- [ ] CLAUDE.md — варіант C (запис у `recommended_task_claude_md_audit.md`) або A (оновити
      розділ канонічної схеми якщо schemaVersion 10).

---

## ЩО НЕ РОБИТИ

- ❌ Очищати `searchable` (DOCX/HTML/текстовий PDF) — поза скоупом.
- ❌ Тягнути `.layout.json` для searchable (його там і немає).
- ❌ Читати offset'и абзаців у глобальний `.txt` (ламається на сканах >25 стор.) —
      тільки `_text` посторінково.
- ❌ Лишати дубль AI-очистки в DP — переносимо в ядро повністю.
- ❌ Дублювати CSS/механіку вибору — спільний компонент.
- ❌ AI міняти зміст документа (консервативність — головне правило).
- ❌ Чіпати `DpImageMergeEditor`, `ImageMergePanel/`, `App.jsx` (смуги A/B).
- ❌ Кирилиця в `q=` Drive API (#8) для нових Drive-запитів (`_raw_txt/` — latin-safe ім'я).
- ❌ Додавати поля в канонічну схему без bump+міграції (#6) — узгодити schemaVersion 10.
- ❌ re-OCR одного документа за сумнівом (§5 design) — наступний крок, борг.

---

## ТЕСТИ

- **Unit `tests/unit/cleanTextService.test.js`** (адаптувати наявний): конденсатор на
  РЕАЛЬНОМУ Google-shape (`_text`+`blocks`+`boundingPoly`), таблиці→GFM, шум-блоки,
  посторінкова склейка; оркестрація `cleanDocument` (скоуп-гард searchable, fallback
  layout→txt, відсутність джерела, AI-помилка→draft, артефакти через spy, C7-лог spy,
  `billAsUserAction`).
- **Unit спільного компонента вибору** — select-all/indeterminate, toggle, батч-дії.
- **Integration:** DP-консолідація (тумблер `cleanForReading` → ядро, один лог, не дубль);
  ACTION `clean_document_text` (PERMISSIONS, виклик ядра); пакетне видалення (повне
  прибирання артефактів+метаданих).
- Існуючі тести `ArchiveView`/DP/Viewer — лишаються зелені (поведінка Архіву ідентична).
- `npm test` зелений перед коммітом/push.

---

## ЗВІТ

`docs/reports/report_task3_clean_text.md`:
1. Форма ядра (сигнатура `cleanDocument`, DI, конденсатор на реальному shape).
2. Як прибрано дубль DP (inline `aiCleanText` → ядро).
3. Спільний компонент вибору (форма, 3 точки, як уніфіковано CSS).
4. Рішення schemaVersion (10 чи extended-only) + міграція якщо була.
5. C7-логування + `billAsUserAction` (DP vs кнопка).
6. Viewer `.md`-читання (новий хелпер / розширення).
7. Числа тестів до/після, build.
8. Побічні знахідки → bugs/ + tracking_debt.
9. Як перевірити (4 точки очистки + пакетне видалення + Архів-ідентичність).
10. Git commit confirmation.

Оновити `ARCHITECTURE_HISTORY.md`. Якщо schemaVersion 10 — оновити CLAUDE.md розділ
канонічної схеми + правило #6 ланцюг.

---

## ПЕРЕВІРКА АДВОКАТОМ (після merge + deploy)

1. Скан-документ → Viewer → «Очистити документ» → бачить гарний `.md` (абзаци/заголовки),
   зміст не змінено; `.layout.json` зник, `.txt` у `_raw_txt/`.
2. DOCX/HTML → кнопка очистки неактивна / пропускається (поза скоупом).
3. Огляд → «Очистити тексти» → прогрес N/M, чистить лише сирі скани, `.md` пропускає.
4. Реєстр → вибір кількох → «Очистити вибрані» (перепит на вже-.md) і «Видалити вибрані»
   (повне видалення).
5. DP з тумблером «Очистити для читання» → нові скани одразу як `.md` (через спільне ядро).
6. Архів → вибір/відновлення/видалення працює ЯК РАНІШЕ (рефактор непомітний).
7. Агент досьє: «очисти цей документ» → виконує (`clean_document_text`).
8. `attentionNotes` показуються там, де результат (ResultCard / Viewer).

Якщо щось зламано — `git revert`, повідомити.

---

## ГОТОВНІСТЬ

- [x] Алгоритм узгоджено (5 діаграм `flow_clean_text.md`, адвокат 2026-05-31).
- [x] Скоуп `scanned`-only перевірено по коду; searchable поза функцією.
- [x] Дослідження offset'ів: Варіант B (посторінково `_text`+геометрія), дзеркало `pageMarkers.js`.
- [x] Дві осі розділено (логіка очистки / UI-вибір).
- [x] Доля артефактів: .md створ. / .txt→_raw_txt/ / .layout.json видал.
- [ ] schemaVersion 10 (textFormat/cleanedAt) — узгодити з адвокатом ПЕРЕД реалізацією.

**Кінець TASK 3.**
