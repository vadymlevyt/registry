# TASK: ImageMergePanel split (Roadmap Фаза 1)

**Дата:** 28.05.2026
**Тип:** behavior-preserving винос компонентів з одного файлу у власні файли
**Гілка розробки:** `claude/architecture-review-bhnqo`
**Базовий документ:** `docs/consultations/consultation_large_files_refactoring_roadmap.md` §5
**schemaVersion:** без bump (це не зміна даних)

---

## Призначення

Розщепити `src/components/CaseDossier/ImageMergePanel.jsx` (2822 рядки,
14 внутрішніх компонентів + 4 хелпери) на власні файли у папці
`src/components/CaseDossier/ImageMergePanel/`.

**Behavior-preserving:** жодної зміни логіки, жодної зміни UI, жодної
зміни public API компонента. Адвокат не побачить різниці.

---

## Цільова структура

```
src/components/CaseDossier/
└── ImageMergePanel/                ← НОВА папка (заміняє ImageMergePanel.jsx)
    ├── index.jsx                   головний компонент + useImperativeHandle
    ├── PreviewView.jsx             оркестратор фази preview
    ├── PreviewPopup.jsx            повноекранний попап з pinch-zoom
    ├── RenderItem.jsx              тіло картки в grid
    ├── Thumbnail.jsx               мініатюра з HEIC-логікою
    ├── CropperHost.jsx             хост cropper'а (експортний)
    ├── ContextMenu.jsx             right-click меню
    ├── ProcessingView.jsx          індикатор фази processing
    ├── SingleFileWarning.jsx       модалка попередження
    ├── constants.js                CATEGORY_OPTIONS, AUTHOR_OPTIONS, MAX_IMAGES_WARN, PHASES, isImageFile
    ├── geometry.js                 rotateRectCW, rotateRectCCW
    ├── grid/                       drag-and-drop підпапка
    │   ├── SortableGrid.jsx
    │   ├── DndGrid.jsx
    │   └── SortableItem.jsx
    ├── tools/                      ← ПОРОЖНЯ ДНК-папка для майбутніх інструментів редагування
    │   └── .gitkeep
    ├── annotations/                ← ПОРОЖНЯ ДНК-папка для майбутніх анотацій
    │   └── .gitkeep
    ├── ai/                         ← ПОРОЖНЯ ДНК-папка для майбутніх AI-помічників
    │   └── .gitkeep
    └── export/                     ← ПОРОЖНЯ ДНК-папка для майбутніх експортних опцій
        └── .gitkeep
```

---

## Підхід — алгоритм

### Крок 1: Створити папку і скелет

1. `mkdir -p src/components/CaseDossier/ImageMergePanel/{grid,tools,annotations,ai,export}`
2. `touch` `.gitkeep` у `tools/`, `annotations/`, `ai/`, `export/`

### Крок 2: Виокремити константи

Створити `constants.js` з:
- `CATEGORY_OPTIONS`
- `AUTHOR_OPTIONS`
- `MAX_IMAGES_WARN`
- `PHASES` (зараз на рядку 872)
- `isImageFile` функція (зараз рядок 67)

### Крок 3: Виокремити геометрію

Створити `geometry.js` з:
- `rotateRectCW` (зараз рядок 2719)
- `rotateRectCCW` (зараз рядок 2745)

### Крок 4: Виокремити малі компоненти

У такому порядку (від листя до кореня):
1. `ContextMenu.jsx` — `ContextMenu` (рядки 2756-2788)
2. `SingleFileWarning.jsx` — `SingleFileWarning` (рядки 2789-2822)
3. `ProcessingView.jsx` — `ProcessingView` (рядки 881-930)
4. `Thumbnail.jsx` — `Thumbnail` (рядки 1880-2069)
5. `CropperHost.jsx` — `CropperHost` (рядки 2631-2718), **залишити export**
6. `RenderItem.jsx` — `RenderItem` (рядки 1657-1879)

### Крок 5: Виокремити drag-and-drop у підпапку

7. `grid/SortableItem.jsx` — `SortableItem` (рядки 1615-1656)
8. `grid/DndGrid.jsx` — `DndGrid` (рядки 1555-1614)
9. `grid/SortableGrid.jsx` — `SortableGrid` (рядки 1432-1554)

### Крок 6: Виокремити великі компоненти

10. `PreviewPopup.jsx` — `PreviewPopup` (рядки 2070-2630)
11. `PreviewView.jsx` — `PreviewView` (рядки 931-1431)

### Крок 7: index.jsx — головний компонент

12. `index.jsx` — `ImageMergePanel` (рядки 1-880 без імпортів які тепер
    непотрібні, + `export const ImageMergePanel = forwardRef(...)`)

### Крок 8: Імпорти

Кожен новий файл імпортує:
- React hooks і lucide-react з npm
- Локальні залежності: `import { ContextMenu } from './ContextMenu'`
- UI-компоненти: `import { Button } from '../../UI'`
- Сервіси: `import { toast } from '../../../services/toast'`

### Крок 9: Оновити імпорти споживачів

- `src/components/CaseDossier/index.jsx`: імпорт `import { ImageMergePanel } from './ImageMergePanel'` (без `.jsx` — Node module resolution знайде `index.jsx`)
- `tests/unit/cropperHost.test.jsx`: оновити шлях `'../../src/components/CaseDossier/ImageMergePanel/CropperHost'`
- `tests/unit/ImageMergePanel.test.jsx`: оновити шлях `'../../src/components/CaseDossier/ImageMergePanel'`
- `tests/integration/multiImageToPdf.test.js`: перевірити чи імпортує компонент чи сервіс — оновити якщо треба
- `tests/unit/imageMergeRenderer.test.js`: перевірити — це тест сервісу, ймовірно не торкається

### Крок 10: Видалити старий файл

- `rm src/components/CaseDossier/ImageMergePanel.jsx`

### Крок 11: Тести

- `npm test` — мусить бути 1581 passed (та сама цифра що зараз)
- Якщо червоні — виправити імпорти, не змінювати логіку

### Крок 12: Build

- `npm run build` — мусить пройти без помилок (Vite resolution для нової папки)

### Крок 13: Коміт

```
refactor: ImageMergePanel split into 12 files (Roadmap Фаза 1)

2822-line file → 12 React component files + 2 helpers (constants, geometry)
under src/components/CaseDossier/ImageMergePanel/.

Створено ДНК-папки tools/ annotations/ ai/ export/ під майбутні
розширення (порожні з .gitkeep).

Behavior-preserving — жодної зміни UI, API, поведінки.
Tests: 1581 passed (без змін).
Build: pass.

Деталі — docs/consultations/consultation_large_files_refactoring_roadmap.md §5.
```

---

## Тести — критерій успіху

**Перед TASK (baseline):**
```
Test Files  118 passed (118)
     Tests  1581 passed (1581)
```

**Після TASK:**
```
Test Files  118 passed (118)
     Tests  1581 passed (1581)
```

**Не допускається:** жоден тест змінює статус (passed → failed або
навпаки). Числа тестів не змінюються бо це не додавання нових тестів.

Якщо при виносі стає очевидно що якийсь компонент тепер легко покрити
unit-тестом — це **бонус**, окремий мікро-TASK після цього. Не входить
у scope.

---

## SAAS IMPLICATIONS

**Жодних** — це винос файлів без зміни даних чи логіки.

- Поля сутностей: не торкаються
- Permissions: не торкаються
- Tenant isolation: не торкається
- Multi-user behavior: не торкається

---

## BILLING IMPLICATIONS

**Жодних** — це не дія адвоката, не виклик AI, не зміна active state.

- Точки інструментації: не торкаються
- Категорії часу: не торкаються
- `activityTracker` виклики: не торкаються (ImageMergePanel не звітує
  у activityTracker, це робить CaseDossier через `executeAction`
  `add_document` після `onSubmit`)

---

## AI USAGE IMPLICATIONS

**Жодних** — це не виклик AI.

- `resolveModel(...)` не торкається
- `logAiUsage` не торкається
- Tool Use / JSON ACTIONS: не торкається

---

## Що НЕ робиться у TASK (out of scope)

- ❌ Зміна логіки склейки зображень
- ❌ Зміна public API ImageMergePanel компонента
- ❌ Зміна UI (адвокат побачить ідентичний інтерфейс)
- ❌ Виправлення «попутних» багів — якщо знайдено баг, занести у
  `docs/bugs/bugs_found_during_image_merge_panel_split.md` або
  `tracking_debt.md`
- ❌ Додавання нових тестів — той самий набір
- ❌ Додавання компонентів у `tools/` `annotations/` `ai/` `export/` —
  ці папки створюються порожніми як ДНК-закладки
- ❌ Видалення/злиття дублікату `DrivePicker` (це Фаза 2)
- ❌ Зміна правила в CLAUDE.md (це може бути окремий міні-TASK)

---

## Ризик і пом'якшення

**Ризик: мінімальний.** Фізичне переміщення з оновленням імпортів.

**Точки уваги:**

1. **forwardRef + useImperativeHandle** — переконатися що ref API
   зберігається. Параметри ref-методів не змінюються.

2. **`CropperHost` named export** — лишається `export function CropperHost`
   у новому файлі. Тести на нього імпортують напряму.

3. **HEIC lazy import** — `Thumbnail.jsx` робить `import('heic2any')`
   динамічно. Цей dynamic import має продовжити працювати після виносу
   (Vite автоматично хендлить).

4. **DnD kit залежності** — `SortableGrid` / `DndGrid` / `SortableItem`
   мають імпортувати `@dnd-kit/core` і `@dnd-kit/sortable` напряму у
   власних файлах.

5. **CSS-in-JS** — компонент використовує inline-стилі. Жоден стиль не
   міняється.

**План відкату:** якщо тести червоні після виносу і причина не
очевидна (>30 хв пошуку) — `git revert HEAD` і дослідити окремо.

---

## Перевірка адвокатом

Після merge у main і deploy:

1. Відкрити справу з документами-зображеннями
2. CaseDossier → Матеріали → «+ Додати документ» → «🖼 Склеїти зображення»
3. Завантажити 2-3 фото з телефону (HEIC або JPEG)
4. Перевірити що проходять усі 3 фази (selecting → processing → preview)
5. У preview: drag-and-drop, поворот, попап перегляду, crop
6. Натиснути «Створити PDF» → перевірити що PDF з'явився в Drive

Якщо хоч одна перевірка провалена — `git revert` коміту, повідомити.

---

## Готовність до виконання

- [x] Baseline тестів виміряно: 1581 passed
- [x] Структура цільових файлів узгоджена (roadmap §5)
- [x] Список internal compoнентів і рядків верифіковано (живі цифри з grep)
- [x] Гілка готова: `claude/architecture-review-bhnqo`
- [x] План кроків деталізовано (13 кроків вище)

**Старт виконання — після створення цього файлу.**
