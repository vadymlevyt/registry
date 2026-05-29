# Звіт — TASK 1B: image_merge_unify, N-документна склейка фото в DP

**Дата:** 2026-05-29
**Гілка:** `main` (десктоп Claude Code → CLAUDE.md §«ГІЛКИ» каже працювати прямо в main)
**Базова специфікація:** `docs/tasks/TASK_image_merge_unify.md` ПІД-TASK 1B
**Попередні сесії:** TASK 1A — `report_task_image_merge_unify_1A.md`; TASK 1C — `report_task_image_merge_unify_1C.md`
**Тип:** велика продуктова функція (Вісь A) + закриття C7 (Вісь B) + видалення `allImagesRoute` як мертвий код (наслідок Осі C)
**schemaVersion:** без bump

---

## 1. Серце TASK 1B — що тепер вміє DP

Адвокат у `Робота з документами` закидає 10 фото (HEIC/JPEG/PNG). Без 1B
streamingExecutor падав на «No PDF header found» бо жене кожен файл через
PDF-OCR ДО вибору сценарію.

**1B виправляє:** `DocumentProcessorV2.startProcessing` робить
**детермінований вибір сценарію НА ВХОДІ**:

- **all-image (toggle skipPdfSlicing=false) → DP image-merge editor** (НЕ
  `pipeline.run`). Локальний під-флоу: `prepareImagesForMerge` →
  `imageDocumentGrouper` (Haiku) → N візуальних груп → drag фото між
  групами → crop/rotate/dedup → «Виконати» → N окремих PDF у справі через
  `executeAction('document_processor_agent','add_documents',…)`.
- **all-image (toggle ON) → звичайний pipeline** per-file (toggle каже
  «не груповати»).
- **мікс photo+PDF → акуратний toast + борг #27** (свідома межа scope 1B).
- **all-PDF / mix без фото → звичайний pipeline.run** як раніше.

Модалка `🖼 Склеїти зображення` у CaseDossier — не зачіпається, працює як
раніше.

---

## 2. Що зроблено по осях

### Вісь A — продукт

**N-документна склейка фото в DP.** Адвокат-диригент локально для
image-merge: пропозиція AI → правка → виконання. Не переробляємо
CONFIRM-стадію для нарізки (це Фаза 5 окремий TASK).

**Зачеплені файли:**
- `src/services/imageDocument/prepareImagesForMerge.js` (НОВЕ) — спільна
  phase-1 pre-assembly (HEIC+OCR+orientation), без sort, без PDF.
- `src/services/converter/multiImageToPdf.js` (рефакторинг) — тепер
  тонший: prepareImagesForMerge → sortImages → buildPdfFromImages. Контракт
  `convertImagesToPdf` незмінний — модалка не зачіпається.
- `src/services/sortation/imageDocumentGrouper.js` (НОВЕ) — Haiku агент межі
  ДОКУМЕНТІВ між фото. JSON output, depth-counter парсер, fallback.
- `src/services/modelResolver.js` — додано `imageDocumentGrouper:
  'claude-haiku-4-5-20251001'` у `SYSTEM_DEFAULTS`.
- `src/components/DocumentProcessorV2/DpImageMergeEditor.jsx` (НОВЕ) —
  N-doc editor у Zone 3. Multi-container @dnd-kit (drag фото між групами).
  Reuse атомарних `ImageEditor/`: `Thumbnail`, `RenderItem`, `PreviewPopup`,
  `CropperHost`, `ContextMenu`.
- `src/components/DocumentProcessorV2/index.jsx` — wire: `isAllImagesInput`
  детектор + `startImageMergeProcessing` + `handleImageMergeSubmit` (per
  group: `rebuildFromOcrResults` → `uploadBytesToDrive` →
  `createDocument` → `add_documents`).
- `src/components/DocumentProcessorV2/styles.css` — мінімальний CSS для
  editor (`.dp-image-merge-editor__*`).

### Вісь B — закриття C7 для нового агента

`imageDocumentGrouper` має **обов'язкове білінгове логування з народження**:
- `logAiUsageViaSink({agentType:'image_document_grouper', model,
  inputTokens, outputTokens, context:{caseId, module:'document_processor',
  operation:'image_document_grouping'}}, aiUsageSink)`
- `activityTracker.report('agent_call', {caseId, module, category,
  metadata:{agentType, operation}})`

Паралельні структури (ai_usage[] для оператора SaaS, time_entries[] для
адвоката) — БЕЗ дублювання полів. Усе в try/catch (білінг не валить
роботу адвоката). Закриває **C7 для нового агента** (DEVELOPMENT_
PHILOSOPHY §«ПРАВИЛО НАРОДЖЕННЯ МОДУЛЯ»).

### Видалення `allImagesRoute` як мертвий код (наслідок 1B)

Адвокат явно інструктував у handoff: «зверни увагу на розділ «ДОЛЯ 1C»:
allImagesRoute видаляєш як мертвий код». Логіка:

- DP тепер перехоплює all-image вхід ДО `pipeline.run`.
- `allImagesRoute` у `triageStage.js` ставав недосяжний (триаж бачив
  все-image тільки якщо хтось обходив DP).
- Видалено: функція `allImagesRoute` + її гілка у `createTriageStage` +
  блок `describe('1C.1 allImagesRoute')` у `triageStage.test.js`.

**`trivialImagePlan` (1-image legacy) лишається** — fallback на випадок
коли `ecitsInboxWatcher` або інший шлях надішле одне зображення повз DP.

**Зворотній відкат у двох інтеграційних тестах:** `mix-signal.pdf`
workaround з `dp-image-merge-failure.test.js` і assertion `d1.pdf` у
`dp-persist-routes.test.js` (обидва доданих 1C для боротьби з
allImagesRoute) — повернуто до pre-1C форми. Тести знов чіткі: AI Triage
повертає очікувані документи напряму.

---

## 3. Рішення в межах експертної автономії

### 3.1 Спільний pre-assembly — Path A (чистий винос)

**Точка узгодження з адвокатом перед кодом** (як прямо вимагала спека):
питав між трьома варіантами розподілу OCR+sort+orientation. Адвокат обрав
**Path A — чистий винос з обмеженнями:**

> A — чистий винос. Обов'язково behavior-preserving для модалки:
> - prepareImagesForMerge кладеш у services/imageDocument/ (там же, де
>   pdfRebuild з 1A).
> - Повертає ЛИШЕ pre-assembly артефакти: normalizedFiles, ocrResults,
>   detectedOrientations. Сортування і збірку PDF лишаєш у ХВОСТАХ
>   кожного споживача.
> - Білінг images_merged лишається в convertImagesToPdf (модалка). DP НЕ
>   кличе convertImagesToPdf → подвійного логування не буде. DP логує
>   свій imageDocumentGrouper.

Реалізовано точно за вказівкою. Прогон existing multiImageToPdf і
ImageMergePanel тестів ПІСЛЯ виносу — **20 → 20 passed**, behavior
preserved.

### 3.2 Multi-container drag (DpImageMergeEditor)

SortableGrid модалки — single-container DnD «1 батч = 1 документ». Для DP
потрібно N контейнерів (груп) з drag МІЖ ними. Розглянуто три підходи:

**Обрано:** ОДИН `DndContext`, N `SortableContext` (по одному на групу),
items ID кодує containerId+origIdx: `g::<docId>::p::<origIdx>`. У
`onDragEnd` парсимо обидва ID → визначаємо source/target групи. Reuse
атомарного `RenderItem` через локальний `DpSortableItem`.

**Не зробив (борг #28):** drop на ПОРОЖНІЙ container (между групами / у
new empty group через «Додати порожню групу») — потребує `useDroppable`
per group + `DragOverlay`. MVP 1B вимагає drag на existing item.
`ItemIdDecode` вже резервує `g::<docId>::container` ID для майбутньої
імплементації.

### 3.3 Mix photo+PDF — toast + борг

Спека прямо: «акуратний toast без краху + борг у tracking_debt.md. Це
межа scope з акуратною поведінкою, не латка». Реалізовано:

```js
toast.warning('Мікс фото + PDF: оберіть або тільки фото, або тільки PDF', {
  description: 'Інтерактивна склейка фото у DP працює лише для чистих
                наборів фото. PDF-нарізку запускайте окремо.',
});
```

Борг #27 у tracking_debt.md з тригером «реальні скарги адвоката > 2 разів».

### 3.4 imageDocumentGrouper — ОКРЕМИЙ агент, не розширення imageSortingAgent

Як прямо рекомендує спека (правило #11). Грунт:
- `imageSortingAgent` — сортує сторінки В МЕЖАХ одного документа + dedup.
- `imageDocumentGrouper` — межі МІЖ документами.

Два різні наміри, два різні промпти, два різні API виклики. Розширення
SortingAgent двома полями (`order` + `groups`) було б класичне порушення
#11.

### 3.5 PERSIST через add_documents (атомарно)

Один виклик `executeAction('document_processor_agent','add_documents',
{caseId, documents: N})` замість N окремих `add_document`. Перевага:
- атомарна валідація — або всі додаються або жоден (`add_documents`
  ACTION перевіряє кожен документ перед `setCases`).
- одна точка авдиту, не N.
- consistency: usedNames Set росте у фронті, передається у
  `ensureUniqueName` для уникнення колізій назв між групами однієї
  сесії.

### 3.6 Декларація orientation у DP — без застосування

Phase 1 (`prepareImagesForMerge`) лише ВИЗНАЧАЄ `detectedOrientations`
(EXIF → Document AI → aspect heuristic), не застосовує. Модалка
застосовує ДО збірки 1 PDF; DP застосовує per-group у
`rebuildFromOcrResults` на «Виконати». Це і є «хвости різні» з директиви
адвоката.

---

## 4. Точні шляхи імпортів

### DP image-merge orchestrator (новий код):

```js
// src/components/DocumentProcessorV2/index.jsx
import { isImageFile } from '../ImageEditor/constants.js';
import { prepareImagesForMerge } from '../../services/imageDocument/prepareImagesForMerge.js';
import { groupImagesIntoDocuments } from '../../services/sortation/imageDocumentGrouper.js';
import { rebuildFromOcrResults } from '../../services/imageDocument/pdfRebuild.js';
import { createDocument } from '../../services/documentFactory.js';
import { ensureUniqueName } from '../../services/sortation/imageSortingAgent.js';
import { findOrCreateFolder, uploadBytesToDrive } from '../../services/driveService.js';
import * as ocrService from '../../services/ocrService.js';
```

### DP image-merge editor:

```js
// src/components/DocumentProcessorV2/DpImageMergeEditor.jsx
import { CATEGORY_OPTIONS, AUTHOR_OPTIONS } from '../ImageEditor/constants.js';
import { PreviewPopup } from '../ImageEditor/PreviewPopup.jsx';
import { ContextMenu } from '../ImageEditor/ContextMenu.jsx';
import { RenderItem } from '../ImageEditor/RenderItem.jsx';
import { detectDocumentEdges } from '../../services/sortation/edgeDetection.js';
```

### Pre-assembly (новий спільний шар):

```js
// src/services/converter/multiImageToPdf.js — після рефакторингу
import { prepareImagesForMerge } from '../imageDocument/prepareImagesForMerge.js';
import { sortImages, ensureUniqueName } from '../sortation/imageSortingAgent.js';
import { extractPageOrientation, rotateImageBlob } from '../sortation/orientationCorrector.js';
```

Жодного імпорту з `DocumentProcessorV2/` назад у `ImageEditor/` чи в
`services/imageDocument/` — coupling односторонній (specific → shared).

---

## 5. Стан тестів і build

### Тести

- **Baseline (після 1C):** 119 файлів / **1593 passed**.
- **Після 1B:** 120 файлів / **1615 passed**.
- **Дельта:** +22 нових / +1 файл, 0 failing.

**Нові:**
- `tests/unit/imageDocumentGrouper.test.js` — +21 тестів (parseAgentResponse
  3 форми, validateGroups 6 кейсів, групування 9 кейсів — успіх / fallback
  / білінг через aiUsageSink і activityTracker).
- `tests/integration/dp-image-merge-multidoc.test.js` — +4 тестів (3 групи
  → 3 документи через add_documents; fallback single-group;
  PERMISSIONS для document_processor_agent дозволено; dossier_agent
  заборонено).

**Оновлено (без зміни числа passed, лише форма):**
- `tests/unit/triageStage.test.js` — describe «1C.1 allImagesRoute»
  замінено на «all-image fallback (без allImagesRoute, 1B)» з 2 тестами
  (було 4). Тест «skipPdfSlicing=false + усі image → allImagesRoute
  виграє» видалено (allImagesRoute більше не існує).
- `tests/integration/dp-image-merge-failure.test.js` — `mix-signal.pdf`
  workaround з обох тестів видалено (1C додавав його для defeat
  allImagesRoute; з 1B він не потрібен — AI Triage stub повертає
  очікувані документи напряму).
- `tests/integration/dp-persist-routes.test.js` — assertion `d1.pdf`
  → `Договір.pdf` (1C змінював через allImagesRoute, 1B повертає назад).

**Поточний baseline для майбутніх TASK:** 1615 passed, 120 files.

### Build

- `npm run build` — **success**, exit 0, ~17s.
- Без warnings/errors крім вже-відомого «chunk > 500 kB» (heavy lazy
  bundles — heic2any, mammoth, fontkit, jspdf). Це не регрес — той самий
  warning як у 1A/1C.

---

## 6. Зачеплені файли (точний список)

### Створено (4 файли):
- `src/services/imageDocument/prepareImagesForMerge.js`
- `src/services/sortation/imageDocumentGrouper.js`
- `src/components/DocumentProcessorV2/DpImageMergeEditor.jsx`
- `tests/unit/imageDocumentGrouper.test.js`
- `tests/integration/dp-image-merge-multidoc.test.js`
- `docs/reports/report_task_image_merge_unify_1B.md` (цей файл)

### Відредаговано (8 файлів):
- `src/services/converter/multiImageToPdf.js` — refactor (винос
  HEIC+OCR+orientation у prepareImagesForMerge; контракт незмінний).
- `src/services/modelResolver.js` — додано `imageDocumentGrouper:
  'claude-haiku-4-5-20251001'` у SYSTEM_DEFAULTS.
- `src/services/documentPipeline/stages/triageStage.js` — видалено
  функцію `allImagesRoute` і її гілку у `createTriageStage`. Оновлено
  доку про порядок гейтів.
- `src/components/DocumentProcessorV2/index.jsx` — wire: imports +
  state imageMerge + isAllImagesInput/hasAnyImage/hasAnyNonImage +
  startImageMergeProcessing + handleImageMergeSubmit + cancelImageMerge +
  гілка `if (imageMerge) return <Editor>` у render + інтеграція у
  startProcessing.
- `src/components/DocumentProcessorV2/styles.css` — CSS для editor
  (`.dp-image-merge-editor__*`).
- `tests/unit/triageStage.test.js` — describe «1C.1 allImagesRoute»
  замінено + видалено один тест skipPdfSlicing який тестував allImagesRoute.
- `tests/integration/dp-image-merge-failure.test.js` — видалено
  `mix-signal.pdf` workaround з обох тестів (план stub скорочений).
- `tests/integration/dp-persist-routes.test.js` — assertion `d1.pdf`
  → `Договір.pdf`.
- `tracking_debt.md` — додано борги #27 (mix mode) і #28 (cross-group
  drag на empty container).
- `ARCHITECTURE_HISTORY.md` — додано запис «TASK 1 image_merge_unify»
  з трьома фазами + список звітів у покажчик.
- `docs/consultations/consultation_combined_roadmap_dp_and_refactoring.md`
  — позначено `TASK_1: image_merge_unify ✓ ЗАВЕРШЕНО 2026-05-29`.

---

## 7. Acceptance 1B (усі ✅)

- [x] `imageDocumentGrouper.js` створено, повертає групи, **логує AI
      usage** (закриває C7 для нового агента).
- [x] `resolveModel('imageDocumentGrouper')` → Haiku, agentType у
      SYSTEM_DEFAULTS.
- [x] DP: закинув N фото → бачить N запропонованих груп у Zone 3 editor.
- [x] Drag фото між групами, crop/rotate/dedup, rename, type — працюють
      (reuse ImageEditor; cross-group drag на existing item; empty-
      container drop — борг #28).
- [x] «Виконати» створює N окремих PDF у справі (через add_documents).
- [x] PERSIST для image-merge — ТІЛЬКИ після «Виконати» (не autoConfirm).
- [x] Нарізка PDF (інші маршрути) — поведінка НЕ змінена (autoConfirm
      лишається).
- [x] Нові тести: `imageDocumentGrouper.test.js` (21 тест включаючи
      білінгове логування), DP N-doc flow інтеграційний (4 тести).
- [x] `npm test` зелений (1615 passed), `npm run build` success.
- [x] `allImagesRoute` видалено як мертвий код (директива адвоката
      «ДОЛЯ 1C»).

---

## 8. Перевірка адвокатом (після merge + deploy)

1. Справа → «Робота з документами» (DP).
2. Закинути 6-10 фото з телефону (HEIC/JPEG/PNG) що складають 2-3 документи.
3. Натиснути «Розпочати обробку» → AI Triage НЕ ганявся (швидко); editor
   зʼявляється з N запропонованими групами.
4. Перетягнути фото між групами (drag на existing thumbnail цільової
   групи), обернути ↻, обрізати у попапі (тап на ✂️), перейменувати
   групу, обрати тип, провадження, дату.
5. Натиснути «Виконати: створити N документів» → у матеріалах справи
   з'являються N окремих PDF з .txt у 02_ОБРОБЛЕНІ.
6. Окремо: закинути 3 PDF + увімкнути «Просто додати файли» (toggle з
   1C) → кожен PDF = 1 документ, AI Triage пропущено.
7. Окремо: модалка «🖼 Склеїти зображення» у CaseDossier — як раніше.
8. Окремо: мікс photo+PDF → акуратний toast warning, не крах.

Якщо щось зламано — `git revert <commit>`, повідомити з описом.

---

## 9. Поза скоупом 1B → tracking_debt.md і майбутні TASK

**Борги додано у `tracking_debt.md`:**

- **#27** Мікс photo+PDF у DP image-merge: свідома межа UX. Тригер —
  реальні скарги адвоката > 2 разів. Окремий TASK «DP image-merge mix
  mode».
- **#28** Cross-group drag тільки на existing item (not empty container
  drop-zone). Тригер — наступне редагування DpImageMergeEditor по суті
  або окремий UX-cleanup. Потрібно `useDroppable` per group + DragOverlay.

**Не зачеплено (свідомо, як спека прямо вказала):**

- ❌ Переробка CONFIRM-стадії диригента для нарізки PDF (Фаза 5).
- ❌ Tool use migration для grouper (Фаза 3, C1).
- ❌ Уніфікація AddDocumentModal з DP pipeline (C4 — Фаза 4).
- ❌ Виносити `CATEGORY_OPTIONS`/`AUTHOR_OPTIONS` у documentSchema.js
  (борг #25 з 1A).
- ❌ CSS-префікс `image-merge-panel__` → `image-editor__` (борг #26 з 1A).
- ❌ Bump schemaVersion / зміна структури registry_data.json.

---

## 10. Git commit

Один atomic коміт на гілці `main` зі скоупом 1B (prepareImagesForMerge +
imageDocumentGrouper + DpImageMergeEditor + wire у DocumentProcessorV2 +
видалення allImagesRoute + reverted 1C workarounds у двох інтеграційних
тестах + тести + борг + звіт + ARCHITECTURE_HISTORY + roadmap mark).

**Push у `main` — ПІСЛЯ підтвердження адвоката** (CLAUDE.md §«ГІЛКИ»
правило для змін коду на десктопі: підтвердження ОДНИМ реченням ПЕРЕД
push). Перед push: `git pull --rebase origin main` (адвокат повідомив що
дочекалися два докові коміти).

**Кінець звіту TASK 1B (image_merge_unify).**
