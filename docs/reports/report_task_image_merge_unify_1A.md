# Звіт — TASK 1A: image_merge_unify, винос reusable у спільне місце

**Дата:** 2026-05-29
**Гілка:** `claude/image-merge-unify-1A`
**Базова специфікація:** `docs/tasks/TASK_image_merge_unify.md` ПІД-TASK 1A
**Тип:** behavior-preserving винос файлів (Вісь C + C2 «винос reusable у спільне»)
**schemaVersion:** без bump

---

## 1. Що зроблено по осях

- **Вісь C — рефакторинг:** компоненти `PreviewPopup`, `CropperHost`,
  `Thumbnail`, `RenderItem`, `ContextMenu`, спільні константи і drag-and-drop
  `grid/*` перенесено з `src/components/CaseDossier/ImageMergePanel/` у нову
  спільну папку `src/components/ImageEditor/`. Чиста математика і чисті
  async-функції без React (`geometry.js`, `pdfRebuild.js`) — у нову папку
  `src/services/imageDocument/`.
- **Вісь B (C2 — винос клієнтів):** ImageEditor готовий для другого
  рівноправного споживача (DP image-merge у 1B). Жодного backwards-coupling
  ImageEditor → ImageMergePanel.
- **Вісь A (продукт):** не зачіпається в 1A. 1B/1C — окремі сесії.

Адвокат поведінкової різниці не побачить: модалка «🖼 Склеїти зображення»
працює ідентично попередньому стану.

---

## 2. Фінальна структура файлів

```
src/components/
├── CaseDossier/
│   ├── ImageMergePanel.css                — стилі (без переїзду; намерфейс
│   │                                         image-merge-panel__* — борг #26)
│   └── ImageMergePanel/                   — модалка (специфічне місце,
│       │                                     «1 батч = 1 документ»):
│       ├── index.jsx                      — forwardRef + handleSubmit
│       ├── PreviewView.jsx                — оркеструє grid/popup/form
│       ├── ProcessingView.jsx             — індикатор фази processing
│       ├── SingleFileWarning.jsx          — «1 файл — використайте Додати»
│       ├── tools/.gitkeep                 — ДНК-папки модалки (без змін)
│       ├── annotations/.gitkeep
│       ├── ai/.gitkeep
│       └── export/.gitkeep
└── ImageEditor/                           — НОВА: спільне reusable
    │                                         (модалка + майбутній DP):
    ├── ContextMenu.jsx                    — right-click меню
    ├── CropperHost.jsx                    — react-advanced-cropper (named export,
    │                                         споживається тестом)
    ├── PreviewPopup.jsx                   — full-screen crop editor
    ├── RenderItem.jsx                     — рендер картки grid
    ├── Thumbnail.jsx                      — мініатюра з HEIC-aware UX
    ├── constants.js                       — MAX_IMAGES_WARN, PHASES, isImageFile,
    │                                         CATEGORY_OPTIONS, AUTHOR_OPTIONS
    │                                         (CATEGORY/AUTHOR — борг #25)
    └── grid/                               — drag-and-drop (@dnd-kit)
        ├── DndGrid.jsx
        ├── SortableGrid.jsx
        └── SortableItem.jsx

src/services/
└── imageDocument/                          — НОВА: чисті сервіси без React
    ├── geometry.js                        — rotateRectCW / rotateRectCCW
    │                                         (чиста математика)
    └── pdfRebuild.js                      — rebuildFromOcrResults
                                              (async PDF assembly)
```

---

## 3. Рішення в межах експертної автономії

### 3.1 `geometry.js` — куди

Спека дала вибір: лишити в `ImageEditor/` поряд із споживачем (`PreviewPopup`)
або винести у `services/imageDocument/`. **Обрано `services/imageDocument/`**:

- `geometry.js` — чиста математика (cropping rectangles ↔ rotation), без React,
  без сайд-ефектів.
- `pdfRebuild.js` уже їде у `services/imageDocument/` як чиста async-функція →
  природне сусідство.
- Майбутній `imageDocumentGrouper` (1B) теж піде у `services/`. Геометрія
  belongs до сервісного шару (math), не до component-шару.

Імпорт-шлях зі споживача (`ImageEditor/PreviewPopup.jsx`):
```js
import { rotateRectCW, rotateRectCCW } from '../../services/imageDocument/geometry.js';
```

### 3.2 `RenderItem.jsx` — теж переїхав у ImageEditor/

Спека прямо перелічила: PreviewPopup, CropperHost, Thumbnail, ContextMenu,
geometry, grid/* — про `RenderItem` не сказано. Але `grid/SortableItem.jsx`
і `grid/SortableGrid.jsx` обидва імпортують `../RenderItem.jsx`, а `RenderItem`
імпортує `Thumbnail`. Якби `RenderItem` лишився в `ImageMergePanel/`, то
файли `ImageEditor/grid/*` тягнули б назад у модалку — це backwards-coupling
від спільного у специфічне, яке прямо заборонене у спеці («DP **НЕ** імпортує
з нутрощів модалки — це залежність вбік, заборонена»).

Аналіз показав: `RenderItem` — чистий UI без модалко-специфічних бізнес-полів
(тільки routing thumbnail у одиничному/групованому рендері). Тому **переніс
автономно** разом з grid/.

### 3.3 `CATEGORY_OPTIONS` / `AUTHOR_OPTIONS` — лишені в `ImageEditor/constants.js`

Спека прямо: «**в цьому TASK НЕ чіпати** ... лишити в `ImageEditor/constants.js`,
**занести борг** у `tracking_debt.md`». Виконано:
- Файл `src/components/ImageEditor/constants.js` містить два enum'и без змін.
- У шапці файлу — однорядковий коментар з посиланням на `schemas/documentSchema.js`
  як канонічний дім і tracking_debt.md як тригер.
- `tracking_debt.md` — новий запис **#25** з тригером (окремий backfill TASK
  класифікації документів АБО наступний TASK що редагує `documentSchema.js`).

### 3.4 `grid/` папка в ImageMergePanel/ — видалена

Папка `src/components/CaseDossier/ImageMergePanel/grid/` лишилась порожня
після переїзду 3 файлів. Видалено через `rmdir` (порожні каталоги git не
відстежує). ДНК-папки модалки `tools/ annotations/ ai/ export/` лишаються
з `.gitkeep` — це окрема історія для майбутніх специфічних розширень модалки.

### 3.5 CSS-префікс `image-merge-panel__*` — не зачеплено

CSS-файл `src/components/CaseDossier/ImageMergePanel.css` (~200 класів з
namespace'ом `image-merge-panel__`) лишився на місці. Підвантажується
`AddDocumentModal.jsx` глобально. Перенесені файли `ImageEditor/` продовжують
використовувати `image-merge-panel__*` класи — це працює, але семантично
конфлікт (reusable code з модалко-специфічним namespace'ом). Спека 1A —
«лише шляхи імпортів, не логіку», масовий перейменовуючий sweep по CSS поза
scope. Занесено борг **#26** в `tracking_debt.md` з тригером «TASK 1B
АБО окремий cosmetic-TASK».

---

## 4. Точні шляхи імпортів — як консьюмери тягнуть зі спільного місця

### ImageMergePanel (модалка) тягне:
```js
// src/components/CaseDossier/ImageMergePanel/index.jsx
import { MAX_IMAGES_WARN, isImageFile } from '../../ImageEditor/constants.js';
import { rebuildFromOcrResults } from '../../../services/imageDocument/pdfRebuild.js';

// src/components/CaseDossier/ImageMergePanel/PreviewView.jsx
import { CATEGORY_OPTIONS, AUTHOR_OPTIONS } from '../../ImageEditor/constants.js';
import { SortableGrid } from '../../ImageEditor/grid/SortableGrid.jsx';
import { PreviewPopup } from '../../ImageEditor/PreviewPopup.jsx';
import { ContextMenu } from '../../ImageEditor/ContextMenu.jsx';

// src/components/CaseDossier/ImageMergePanel/ProcessingView.jsx
import { PHASES } from '../../ImageEditor/constants.js';
```

### Тести тягнуть:
```js
// tests/unit/cropperHost.test.jsx
import { CropperHost } from '../../src/components/ImageEditor/CropperHost.jsx';

// tests/unit/ImageMergePanel.test.jsx (без змін — index.jsx лишився на місці)
import { ImageMergePanel } from '../../src/components/CaseDossier/ImageMergePanel/index.jsx';

// tests/integration/multiImageToPdf.test.js — не торкається (тестує сервіс)
// tests/unit/imageMergeRenderer.test.js — не торкається (тестує сервіс)
```

### Внутрішні імпорти всередині `ImageEditor/`:
```js
// ImageEditor/PreviewPopup.jsx
import { CropperHost } from './CropperHost.jsx';
import { rotateRectCW, rotateRectCCW } from '../../services/imageDocument/geometry.js';

// dynamic у PreviewPopup.jsx
const { computeRenderedBlob } = await import('../../services/sortation/imageRenderer.js');

// ImageEditor/grid/SortableItem.jsx, SortableGrid.jsx
import { RenderItem } from '../RenderItem.jsx';
```

### Внутрішні імпорти всередині `services/imageDocument/`:
```js
// pdfRebuild.js — dynamic
const { computeRenderedBlob } = await import('../sortation/imageRenderer.js');
const jspdfMod = await import('jspdf');
```

Жодного імпорту з `ImageEditor/` або `services/imageDocument/` назад у
`CaseDossier/ImageMergePanel/` — coupling односторонній (специфічне →
спільне), як вимагає DP-reuse правило.

---

## 5. Стан тестів і build

### Тести
- **Baseline (до 1A):** 118 файлів / **1581 passed**.
- **Після 1A:** 118 файлів / **1581 passed**.
- **Дельта:** 0. Жодного нового тесту, жодного перемикання `passed ↔ failed`
  (тести покривали той самий код у нових локаціях).
- Команда: `npm test` (Vitest 4.x, Node environment).

### Build
- `npm run build` — **success**, exit 0.
- Vite resolution для нових папок працює коректно (статичні і dynamic imports
  обидва покриті — перевірено через прогон тестів).
- Розміри бандлу не змінились (це не функціональна зміна).

---

## 6. Побічні знахідки

Файл `docs/bugs/bugs_found_during_image_merge_unify.md` НЕ створено — за весь
час виконання 1A не виявлено жодного «попутного» бага (behavior-preserving
винос файлів — найвужчий тип TASK'у, ризик мінімальний).

Tracking debt — два нові записи:
- **#25** — `CATEGORY_OPTIONS`/`AUTHOR_OPTIONS` дубль `ImageEditor/constants.js`
  vs канонічна `schemas/documentSchema.js`. Тригер: окремий backfill TASK
  класифікації АБО наступний TASK що редагує `documentSchema.js` по суті.
- **#26** — CSS-префікс `image-merge-panel__*` залишився модалко-специфічним
  у спільному `ImageEditor/`. Тригер: TASK 1B (N-doc склейка в DP) АБО окремий
  cosmetic-TASK.

---

## 7. Зачеплені файли (точний список)

**Створено (11 файлів):**
- `src/components/ImageEditor/ContextMenu.jsx`
- `src/components/ImageEditor/CropperHost.jsx`
- `src/components/ImageEditor/PreviewPopup.jsx`
- `src/components/ImageEditor/RenderItem.jsx`
- `src/components/ImageEditor/Thumbnail.jsx`
- `src/components/ImageEditor/constants.js`
- `src/components/ImageEditor/grid/DndGrid.jsx`
- `src/components/ImageEditor/grid/SortableGrid.jsx`
- `src/components/ImageEditor/grid/SortableItem.jsx`
- `src/services/imageDocument/geometry.js`
- `src/services/imageDocument/pdfRebuild.js`

**Відредаговано (вміст оновлено, файл на місці):**
- `src/components/CaseDossier/ImageMergePanel/index.jsx` — імпорти constants,
  pdfRebuild + оновлена шапка-доку про нову структуру.
- `src/components/CaseDossier/ImageMergePanel/PreviewView.jsx` — імпорти.
- `src/components/CaseDossier/ImageMergePanel/ProcessingView.jsx` — імпорт PHASES.
- `tests/unit/cropperHost.test.jsx` — шлях імпорту CropperHost.
- `tracking_debt.md` — записи #25 і #26.

**Видалено:**
- `src/components/CaseDossier/ImageMergePanel/grid/` — порожня папка після
  переїзду.

**Git перейменування:**
- 11 переїздів зроблено через `git mv` — git історія файлів збережена.

---

## 8. Що далі — для наступної сесії (1C)

Спека `TASK_image_merge_unify.md` рекомендує порядок виконання
**1A → 1C → 1B**:
- ✅ 1A: винос фундаменту (цей звіт).
- ⏭ 1C: `deterministicRoute` (всі файли — фото → image_merge без AI Triage) +
  тумблер `skipPdfSlicing` («Просто додати файли») у Зоні 2 DP + `.txt` для
  text-layer PDF у 02_ОБРОБЛЕНІ. Зачіпає `triageStage.js`, `splitDocumentsV3.js`,
  `DocumentProcessorV2/index.jsx`. Не тягне ImageEditor/.
- ⏭ 1B: серце TASK — N-документна склейка фото в DP. `imageDocumentGrouper`
  (Haiku, з обов'язковим `logAiUsageViaSink` — закриває C7), DP Zone 3 UI з
  reuse ImageEditor, пауза-для-правки плану локально для image-merge,
  виконання через `add_documents`. Спирається на ImageEditor (1A) і
  deterministicRoute (1C).

Передача чистого репо в `main`:
- Гілка `claude/image-merge-unify-1A` пушиться на origin. Перенос у main —
  **після підтвердження адвоката** (зміни коду, не лише докси). FF-only.

---

## 9. Acceptance 1A (всі ✅)

- [x] `components/ImageEditor/` і `services/imageDocument/` створені, файли перенесені
- [x] `ImageMergePanel` модалка працює ідентично (smoke-тести `ImageMergePanel.test.jsx`
      і `cropperHost.test.jsx` зелені, поведінка не змінена)
- [x] DP **ще не** використовує ImageEditor (це 1B) — імпорт-шлях готовий
- [x] `CropperHost` лишається named export; тест на нього оновлено на новий шлях
- [x] `npm test` = 1581 passed (без зміни числа — лише шляхи)
- [x] `npm run build` success
- [x] борг CATEGORY/AUTHOR_OPTIONS занесено в `tracking_debt.md` (#25)
- [x] борг CSS-префікса теж занесено (#26 — побічна знахідка)

---

## 10. Git commit

Один atomic коміт на гілці `claude/image-merge-unify-1A` зі скоупом 1A
(перенесення + правка імпортів + борг + звіт). Деталі — у `git log`.
