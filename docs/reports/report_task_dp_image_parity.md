# Звіт — TASK DP image-merge parity fixes (Сесія 2, зона image editor)

**Дата:** 2026-05-30
**Гілка:** `claude/dp-image-merge-parity-V5CeX` (remote execution; зведення в `main` після підтвердження адвоката)
**Базова специфікація:** `docs/tasks/TASK_dp_image_parity.md` (оновлена 88321b5 після аудиту виконавця)
**Зона:** image-merge editor (`DpImageMergeEditor` / `ImageEditor/*` / `PreviewView`) — НЕ контекст
**schemaVersion:** без bump

---

## 1. Що зроблено (три фікси)

### #1 — Дублі + сортування в DP через СПІЛЬНУ обгортку

**Аудит виявив хибну передумову спеки.** Спека спершу припускала, що дублі вже є
з `sortResult` у DP-флоу. Це було **не так**: DP image-flow робив
`prepareImagesForMerge` (HEIC+OCR+orientation, **без** сортування) →
`groupImagesIntoDocuments` (тільки межі документів). **`sortImages` у DP не
викликався взагалі** — отже DP не лише не показував дублі, а й **не сортував**
сторінки всередині документа. Передумову винесено на рішення адвоката — обрано
**Варіант А (спільний сервіс)**, спеку оновлено (commit 88321b5).

**Реалізація:**

- **НОВЕ `src/services/imageDocument/sortImageDocument.js`** — спільна обгортка
  над `sortImages`: приймає фото однієї логічної одиниці (документа/батча),
  повертає `{order, duplicates, suggestedName, warnings, ...}` або `null`
  (fallback). Усередині: hard timeout (90с, як було у `multiImageToPdf`) +
  C7-логування, **гейтоване** `billing`-контекстом (ai_usage через `aiUsageSink`
  + `activityTracker.report('agent_call')`).
- **Модалка перемкнена:** `multiImageToPdf.convertImagesToPdf` тепер кличе
  обгортку замість прямого `sortImages`. Модалка **НЕ передає** `billing` →
  жодного нового логування → поведінка **ІДЕНТИЧНА** (білінг модалки лишається
  `images_merged` у `converterService`). Контракт/результат незмінні.
- **DP кличе обгортку per-group (>1 фото):** у `startImageMergeProcessing`
  після `groupImagesIntoDocuments` — для кожної групи з ≥2 фото викликаємо
  `sortImageDocument` → отримуємо `order` (сортування сторінок усередині
  документа) + `duplicates`. Передаємо `billing: {caseId, module, aiUsageSink}` →
  нові виклики народжуються з C7-логуванням. Групи з 1 фото — не кличемо.
- **Прокидання в editor:** дублі (global indices) усіх груп зібрано в
  `initialDuplicates` і передано у `DpImageMergeEditor`. Editor обчислює
  `duplicateMembership` (дзеркало `PreviewView:119`), малює **жовту рамку**/
  **зелений рекомендований** (Thumbnail/RenderItem це вже вміють), банер
  «Знайдено N груп дублікатів» + «Залишити рекомендовані», на рекомендованому
  thumbnail — «Залишити цей, видалити інші». «Це не дублікати»
  (`onDismissDuplicateGroup`) теж прокинуто (handler реальний).
- **`aiUsageSink` прокинуто** з `CaseDossier` у `DocumentProcessorV2` →
  попутно закрито латентну C7-діру і для `groupImagesIntoDocuments` (раніше
  sink не передавався → ai_usage grouper'а не логувалось).

### #9 — Контроль обрізки в DP (банер «Не обрізати жодну»)

DP уже мав per-thumb ✂️ (`handleToggleCropDisabled`) і `cropProposals` (edge
detection у фоні), але **не мав банера**. Додано банер як у `PreviewView:322-336`:
«Обрізку буде застосовано до N стор… **Не обрізати жодну**»
(`handleDisableAllCrops` — дзеркало `ImageMergePanel:547`) + `activeCropCount`.
Фінальна збірка PDF (`rebuildFromOcrResults`) **незмінна** → однакова обрізка
дає однаковий PDF що модалка.

### #4 — Overlay: попап поверх chrome досьє

`PreviewPopup` (спільний) тепер рендериться через **`createPortal(document.body)`**.
У DP-контексті попап був замкнений у локальному stacking context → chrome досьє
налазив поверх. Portal виносить overlay на рівень body → `position:fixed` +
`z-index:1000` (ImageMergePanel.css) перекриває весь chrome. Спільний фікс —
працює в обох; модалці не шкодить (той самий full-screen fixed overlay).
React-події (Esc/←/→/R з window-listener батька) спливають крізь portal.

---

## 2. Правило «Спільний рендер UI» (DEVELOPMENT_PHILOSOPHY) — як дотримано

- #1/#9 — НЕ дубльовано в DP: sort+dedup — **спільна** `sortImageDocument`
  (обидва споживачі тягнуть один шлях, Rule of Three готовий до 3-го);
  duplicate-бейджі/crop-стани малює спільний `Thumbnail`/`RenderItem`; банери
  використовують спільні `image-merge-panel__alert*` класи.
- #4 — фікс у спільному `PreviewPopup`, один portal для обох споживачів.
- Модалка `ImageMergePanel`/`PreviewView` — поведінка ІДЕНТИЧНА (тести зелені).

---

## 3. AI USAGE / BILLING (оновлено — А свідомо додає виклики)

- DP тепер робить `sortImages`-виклики per-group (>1 фото) — раніше не робив
  узагалі. Для ухвали 7 фото / 2-3 групи = 2-3 дешеві Sonnet-виклики.
- Логуються через обгортку: `logAiUsageViaSink({agentType:'image_sorter', …})`
  (ai_usage[], токени) + `activityTracker.report('agent_call', …)`
  (time_entries[], час), категорія `case_work`. Паралельні структури, без
  дублювання полів. Усе в try/catch.
- Модалка: `billing` не передається → без нового логування → ІДЕНТИЧНО.
- `resolveModel('imageSorter')` → Sonnet (існуючий agentType, без змін).

---

## 4. Тести і build

- **Baseline:** 124 файли / **1642 passed**.
- **Після TASK:** 126 файлів / **1653 passed** (+11 нових, 0 failing).
  - `tests/unit/sortImageDocument.test.js` (+7): forwarding, <2→null,
    timeout→null, fail→null, billing-гейтинг (sink/activity).
  - `tests/unit/DpImageMergeEditorParity.test.jsx` (+4): #1 банер+бейджі+
    «Залишити рекомендовані» прибирає не-рекомендоване; #9 банер
    «Не обрізати жодну» + клік вимикає всі обрізки.
- **Регресія модалки** (зелена, не зламана): `multiImageToPdf.test.js` (15),
  `ImageMergePanel.test.jsx` (5), `imageSortingAgent.test.js` — «N викликів OCR»
  інваріант тримається.
- **Регресія DP:** `DpImageMergeEditor.test.jsx`, `dp-image-merge-multidoc`,
  `dp-image-merge-failure`, `dp-image-merge-context-event` — зелені.
- **Build:** `npm run build` — success (exit 0, ~22с). Лише відомий
  «chunk > 500 kB» warning (heavy lazy bundles), не регрес.

---

## 5. Зачеплені файли

### Створено
- `src/services/imageDocument/sortImageDocument.js`
- `tests/unit/sortImageDocument.test.js`
- `tests/unit/DpImageMergeEditorParity.test.jsx`
- `docs/reports/report_task_dp_image_parity.md` (цей файл)

### Відредаговано
- `src/services/converter/multiImageToPdf.js` — модалка → спільна обгортка.
- `src/components/DocumentProcessorV2/index.jsx` — per-group sort+dedup,
  `aiUsageSink` prop, `initialDuplicates` у editor.
- `src/components/DocumentProcessorV2/DpImageMergeEditor.jsx` — `initialDuplicates`,
  `duplicateMembership`, dedup-handlers, банери #1+#9, прокидання в grid/popup.
- `src/components/CaseDossier/index.jsx` — `aiUsageSink={setAiUsage}` у DP.
- `src/components/ImageEditor/PreviewPopup.jsx` — `createPortal(document.body)`.
- `ARCHITECTURE_HISTORY.md`, `docs/bugs/bugs_found_during_dp_testing.md` — статуси.

---

## 6. Як перевірити (адвокатом, після деплою)

1. DP → склейка фото з дублями → дублі в **жовтій рамці**, рекомендований
   **зеленим**, можна «Залишити цей»/«Залишити рекомендовані» (як модалка).
2. DP → сторінки всередині документа **відсортовані** (раніше — у порядку завантаження).
3. DP → є банер «**Не обрізати жодну**»; per-thumb ✂️ працює; без чіпання —
   обрізка як у модалці.
4. DP → тап на фото → попап **поверх**, меню досьє не налазить.
5. Модалка «Склеїти зображення» — усе як раніше (ІДЕНТИЧНО).

Якщо щось зламано — `git revert <commit>`, повідомити.

---

## 7. Git commits (гілка)

1. `feat(image-merge) #1: спільна обгортка sortImageDocument + модалка перемкнена`
2. `feat(dp) #1+#9: дублі + контроль обрізки в DpImageMergeEditor (паритет з модалкою)`
3. `fix(image-merge) #4: PreviewPopup через portal у document.body`
4. `docs: TASK DP image parity — звіт, статуси #1/#9/#4, ARCHITECTURE_HISTORY`

Push у `main` — ПІСЛЯ підтвердження адвоката (зміни коду → CI + деплой GitHub
Pages). Перед push: `git pull --rebase origin main`. Один деплой у кінці.

**Кінець звіту TASK DP image-merge parity fixes.**
