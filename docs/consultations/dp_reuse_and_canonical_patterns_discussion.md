# Обговорення: Document Processor — reuse коду і канонічні патерни

**Дата:** 28.05.2026
**Тип:** збірка двох відповідей з чату (не TASK, не для деплою)
**Контекст:** після завершення Фази 1 roadmap (ImageMergePanel split)

Цей файл — стенограма двох послідовних відповідей у розмові про
**можливість Document Processor v2 використовувати функціонал
ImageMergePanel** і про **канонічні патерни code reuse** у сучасних
системах.

---

# Частина 1 — Чи може DP v2 використовувати функції ImageMergePanel після split'у

**Питання адвоката (стисло):** Чи можуть DP v2 і модалка використовувати
одні і ті самі функції? Якщо DP v2 потрібно склеїти фотографії — чи може
він просто викликати готовий код з ImageMergePanel замість дублювати
функціонал?

---

Так, **це і була одна з причин зробити split.** Розкладу по полицях що
тепер реально можна перевикористати, що вже шарилося ще до сплиту, і що
залишиться писати нового у DP v2.

## Що зараз можна перевикористати ПРЯМО з нашого split'у

Після фази 1 у `ImageMergePanel/` лежать **чисті компоненти і функції**
які DP v2 може імпортувати без жодних змін:

### Чиста логіка (нуль React, нуль контексту)

| Файл | Що робить | Чи зможе DP v2 викликати |
|---|---|---|
| **`pdfRebuild.js`** — `rebuildFromOcrResults({orderedIndices, realFiles, ocrResults, userRotation, cropOverrides, cropProposals, cropDisabled, cropAppliedSet, processedBlobs})` | Збирає фінальний PDF з впорядкованих фото + застосовує всі обертання і обрізки | **Так, ідеально.** Це чиста async-функція. DP v2 викликає її **N разів** — по разу на кожен документ з різними `orderedIndices` |
| **`geometry.js`** — `rotateRectCW`, `rotateRectCCW` | Конверсія crop-rect між raw і rotated coord space | **Так.** Чисті функції без залежностей |
| **`constants.js`** — `CATEGORY_OPTIONS`, `AUTHOR_OPTIONS`, `MAX_IMAGES_WARN`, `PHASES`, `isImageFile` | Довідники типів, лейблів, ліміти | **Так.** Хоча правдоподібно `CATEGORY_OPTIONS`/`AUTHOR_OPTIONS` колись варто винести у `schemas/documentSchema.js` — там вони канонічно живуть |

### UI-компоненти (React, але props-based, без захованого state)

| Компонент | Що робить | Як DP v2 його використає |
|---|---|---|
| **`PreviewPopup`** | Повноекранний crop editor з pinch-zoom, slider випрямлення, ↻ | Адвокат у DP v2 може тапнути по фото в групі документа → той самий попап. Той самий UX |
| **`CropperHost`** | Lazy-load react-advanced-cropper + view-only гілка | Низькорівневий примітив. DP v2 використає або через PreviewPopup, або напряму у власному UI |
| **`Thumbnail`** | Картка зі мініатюрою + badges (rotation, duplicate, crop) | DP v2 показує grid фото з тими самими badges |
| **`SortableGrid`/`DndGrid`/`SortableItem`** | Drag-and-drop grid через @dnd-kit | DP v2 може показати **кілька груп** — одну на документ — кожна з власним sortable grid |
| **`ContextMenu`** | Right-click меню | Дрібне, можна реюзати |

## Що **вже** шарилося до нашого split'у (на сервісному рівні)

Тут архітектура від самого початку була правильна — це **planka Picatinny**
з `DEVELOPMENT_PHILOSOPHY.md`. Ці сервіси не належать ImageMergePanel —
вони живуть у `src/services/`:

| Сервіс | Що робить | Хто використовує |
|---|---|---|
| **`services/converter/converterService.js`** — `convertImagesToPdf(files, options)` | Повний pipeline: OCR + sortImages + orientation + edges + PDF | ImageMergePanel вже + DP v2 буде |
| **`services/sortation/imageSortingAgent.js`** — `sortImages()`, `ensureUniqueName()` | AI-агент порядку сторінок + детекція дублікатів | ImageMergePanel вже + DP v2 буде |
| **`services/sortation/edgeDetection.js`** — `detectDocumentEdges()` | AI визначає bounding box документа на фото | ImageMergePanel вже + DP v2 буде |
| **`services/sortation/imageRenderer.js`** — `computeRenderedBlob()` | Уніфікований renderer: blob + auto rotation + user rotation + crop | ImageMergePanel вже + DP v2 буде |
| **`services/ocr/*`** — Document AI / Claude Vision | OCR провайдери | DP v2 уже використовує |

## Сценарій DP v2 «10 фото → 3 документи»

Розкладу як це б зібралося з уже наявних шматків:

```
1. Адвокат через DP v2 завантажує 10 фото (Drive + локальні, JPG/HEIC/PNG)
   → REUSE: services/driveAuth.driveRequest для Drive файлів
   → REUSE: services/converter/heicToJpeg для HEIC

2. DP v2 проганяє пайплайн OCR + сортування
   → REUSE: services/converter/converterService.convertImagesToPdf
            (АБО розпаковує його на окремі стадії — OCR / sort / edges)

3. НОВЕ: класифікатор меж документів
   На цьому етапі знадобиться окремий AI-агент який бачить
   ocrResults[0..9] і повертає groups:
     [{pages:[0,1], type:'identification'}, {pages:[2,3,4], ...}, {pages:[5..9], ...}]
   Це — нова логіка, її ImageMergePanel не має (бо ImageMergePanel
   це завжди один документ).

4. Адвокат бачить preview з 3 групами (візуально розділені рядки)
   → REUSE: SortableGrid три рази (по одному на документ)
   → REUSE: Thumbnail для кожної картки
   → REUSE: PreviewPopup при тапі на фото

5. Адвокат коригує групування (перетягує фото з групи в групу),
   обрізку, повороти
   → REUSE: state-моделі cropOverrides/userRotation з ImageMergePanel
            (потрібно адаптувати — не Map<idx,...>, а Map<idx,{docId,...}>)

6. DP v2 збирає 3 PDF
   → REUSE: pdfRebuild.rebuildFromOcrResults викликається 3 рази
            з orderedIndices=[0,1] / [2,3,4] / [5,6,7,8,9]

7. NEW: text cleaning (опція)
   → НОВЕ: services/textCleaner.js — Haiku-чистка ocrResults тексту
            ImageMergePanel цього не має

8. DP v2 створює 3 документи у реєстрі
   → REUSE: services/documentFactory.createDocument()
   → REUSE: executeAction('add_documents', {...})

9. Файли в правильні папки
   → REUSE: services/driveService.* (uploadFileLocal та інше)
```

## Чого ще не вистачає для повного reuse

Це чесний список — щоб ти бачив що *НЕ* буде «магічно з коробки»:

**1. State management — нова орекстрація.** ImageMergePanel тримає state
в `index.jsx` за моделлю «один батч = один документ». DP v2 потребує
«один батч = N документів». Це нова логіка координатора — не просто
винос ImageMergePanel.

**2. UI многодокументного preview.** ImageMergePanel показує один grid.
DP v2 потребує N grids (по одному на документ) з можливістю перетягувати
фото між ними. UI новий, але **компоненти Thumbnail/SortableItem
всередині кожного gridу — старі**.

**3. Класифікатор меж документів.** ImageMergePanel сортує 1 документ.
DP v2 потребує AI що каже «це 3 окремі документи». Новий агент, нові
prompts.

**4. Кращий tools-set (text cleaning, page splitting існуючого PDF).**
Окремі фічі поза скоупом ImageMergePanel.

## Архітектурна порада на майбутнє (правило #12 + здоровий організм)

**Коли DP v2 почне реально використовувати ці компоненти** — буде
природний момент рознести reusable частини у спільне місце:

```
src/
├── components/
│   ├── ImageEditor/             ← НОВА папка коли активується reuse
│   │   ├── PreviewPopup.jsx     ← переїхав з ImageMergePanel/
│   │   ├── CropperHost.jsx      ← переїхав
│   │   ├── Thumbnail.jsx        ← переїхав
│   │   ├── grid/                ← переїхало
│   │   └── geometry.js          ← переїхало
│   └── CaseDossier/
│       └── ImageMergePanel/
│           ├── index.jsx        ← імпортує з ../../ImageEditor/
│           ├── PreviewView.jsx  ← тонший, тільки orchestrator
│           └── (специфічне)
└── services/
    └── imageDocument/           ← НОВА папка
        └── pdfRebuild.js        ← переїхав з ImageMergePanel/
```

**Але — НЕ робити цей переїзд зараз превентивно.** Чому:

- YAGNI / золота середина (DEVELOPMENT_PHILOSOPHY.md)
- Доки DP v2 не використовує — не знаємо точно який інтерфейс йому потрібен
- Якщо переїхати наперед і вгадати неправильно — все одно перероблятиметься
- Імпорт з `'../CaseDossier/ImageMergePanel/PreviewPopup'` працює як
  тимчасова міра і не блокує нічого

**Тригер:** TASK Document Processor v2 image-merge pipeline. Коли він
активується, **першим кроком** того TASK буде винос потрібних компонентів
у `components/ImageEditor/` і `services/imageDocument/`. Тоді обидва
модулі (CaseDossier і DP v2) імпортують зі спільного місця.

## Конкретна відповідь на твоє питання

> «чи може він викликати цей функціонал з вже готових файлів і на виході
> склеювати більше одного документу»

**Так, може.** Але правильна послідовність дій така:

1. **Зараз (сьогодні)** — DP v2 може імпортувати `rebuildFromOcrResults`
   з `'../CaseDossier/ImageMergePanel/pdfRebuild'` і викликати її N разів.
   Це працює, але імпортувати один модуль з нутрощів іншого — некрасиво.

2. **Коли DP v2 реально починає робити image-merge** — створюється окрема
   фаза рефакторингу (можна включити в roadmap як «Фаза 1.5: переїзд
   reusable частин у спільну папку перед DP v2 image-merge»). Виносимо
   `PreviewPopup` / `CropperHost` / `Thumbnail` / `pdfRebuild` у
   `components/ImageEditor/` і `services/imageDocument/`. ImageMergePanel
   оновлює імпорти. DP v2 теж імпортує звідти.

3. **Бонус від split'у яку ми вже зробили:** усі ці виноси тепер дешеві.
   Без split'у це треба було б спочатку розрізати моноліт 2822 рядки
   (Фаза 1), потім розрізувати reusable. Тепер після split'у — другий
   розріз стає простим переміщенням файлів.

Тобто **наша Фаза 1 — це фундамент** який пізніше стає платформою для
reuse. Сам по собі він не дає reuse «з коробки», але робить його дешевим.

---

# Частина 2 — Канонічні патерни code reuse у сучасних системах

**Питання адвоката (стисло):** Як це все вирішується у нормальному
сучасному коді достатньо складних систем? Чи нормально що різні модулі
викликають одну і ту саму функцію? Чи є ієрархія модулів (DP як
«потужніший» / модалка як «простіший»)? Якщо DP v2 і модалка дублюють
функції — як це централізувати?

---

Розкладу — теоретично і практично з реального коду.

## Теоретичний кістяк

**Так, це канонічна правильна практика.** Має навіть кілька назв:

- **DRY** (Don't Repeat Yourself) — фундаментальний принцип з 1999,
  Pragmatic Programmer
- **Single Source of Truth** — кожне знання має одне канонічне місце
- **Layered Architecture** / **Clean Architecture** (Uncle Bob Martin) —
  бізнес-логіка внизу, UI зверху, залежність тече ВНИЗ
- **Service Layer pattern** — Martin Fowler, «Patterns of Enterprise
  Application Architecture»

**Ключове правило:** код живе там де **сенс**, не там де **зручно
поточному viewer'у**.

### Щодо ієрархії — твоя інтуїція майже правильна, але не зовсім

> «документ процесор у нас самий крутий і потужний інструмент то мали би
> бути там ці файли»

Це **природна** думка, але вона веде до плутанини. У зрілих системах
**немає ієрархії модулів**. DP v2 і AddDocumentModal — це **рівноправні
брати-споживачі**. Обидва тягнуть з третього місця — **сервісного шару**.

```
        Сервіси / UI-примітиви (shared)
       ↗                              ↖
     імпорт                        імпорт
     ↗                                  ↖
AddDocumentModal                     DP v2
(простий шлях,                      (комплексний,
 1 файл)                             N файлів)
```

Не:
```
DP v2 (потужніший)
   ↑ викликає
AddDocumentModal (простіший)
```

Друга схема ламається коли:
- Модуль X хоче ту саму функцію (ні AddDocumentModal, ні DP не «знають»
  про X)
- DP видаляється → AddDocumentModal зламаний
- Модулі стають **зв'язаними** один з одним (coupling) — змінюєш DP →
  ламаєш Modal

**Інженерне правило:** код залежить НИЖЧЕ (від абстракцій), не ВБІК (від
сусіднього модуля).

### Як це виглядає на практиці

```
src/
├── services/                  ← БІЗНЕС-ЛОГІКА (низ — стабільний шар)
│   ├── converter/
│   ├── sortation/
│   ├── ocr/
│   ├── driveService.js
│   └── documentFactory.js
│
├── components/
│   ├── UI/                    ← UI-ПРИМІТИВИ (Button, Input, Modal)
│   ├── ImageEditor/           ← SHARED UI-домен (PreviewPopup, CropperHost)
│   │
│   └── (FEATURES — рівноправні брати, тягнуть з services + UI)
│       ├── CaseDossier/
│       │   └── ImageMergePanel/   ← імпорт з services + ImageEditor
│       └── DocumentProcessorV2/   ← імпорт з services + ImageEditor
```

Той самий `CropperHost` живе у `components/ImageEditor/`, не у
`ImageMergePanel/`. Обидва модулі імпортують зі спільного.

### Один важливий нюанс — **Rule of Three**

Перш ніж винести у спільне, **інженерна дисципліна каже** дочекатись
**третього випадку використання**. Кент Бек називав це «**Rule of Three**»:

1. **Перший випадок** — пиши як треба, не думай про reuse
2. **Другий випадок** — поки що скопіюй, познач у tracking_debt
3. **Третій випадок** — тепер вже точно ясно ЯКИЙ інтерфейс потрібен
   трьом → виноси у спільне

Чому не на другому? Бо у двох випадків легко вгадати неправильно —
реальний третій випадок виявить що твоя абстракція не лягає. Винесеш
зарано → переробляти.

Це повністю узгоджено з нашим **принципом золотої середини** і **здорового
організму** з `DEVELOPMENT_PHILOSOPHY.md`.

## Тепер аудит реального коду

Подивився що зараз імпортує DP v2 і що — модалка. Розкладу на 4 категорії.

### ✅ Вже добре shared у `services/` (так і має бути)

Обидва модулі **вже** тягнуть з тих самих сервісів:

| Сервіс | DP v2 | AddDocumentModal | ImageMergePanel | Стан |
|---|---|---|---|---|
| `services/toast.js` | ✓ | ✓ | ✓ | shared, правильно |
| `services/driveAuth.js` (`driveRequest`) | ✓ | ✓ | ✓ (lazy) | shared, правильно |
| `services/driveService.js` (`findOrCreateFolder`, `uploadBytesToDrive`, `readDriveFileBytes`) | ✓ | через converterService | через converterService | shared, правильно |
| `services/documentFactory.js` (`createDocument`) | ✓ | ✓ | через converterService | shared, правильно |
| `services/ocrService.js` | ✓ | через converterService | через convertImagesToPdf | shared, правильно |
| `services/converter/converterService.js` | (опосередковано) | `convertToPdf` для single | `convertImagesToPdf` для batch | **той самий фасад, дві входи** ✓ |
| `services/tenantService.js` | ✓ | — | — | shared |
| `components/UI/*` (Button, Modal, etc.) | ✓ | ✓ | ✓ | shared |
| `components/UI/icons.js` (`ICON_SIZE`) | ✓ | ✓ | ✓ | shared |

**Це той самий patterns який ти описуєш.** Сервіси — єдине джерело,
споживачі імпортують напряму. **Архітектура цього проекту вже зроблена
правильно** на сервісному рівні.

### ⚠️ Дублікація-кандидат №1: DrivePicker

| Файл | Розмір | Призначення |
|---|---|---|
| `DocumentProcessorV2/DrivePicker.jsx` | окремо | Drive folder picker для DP v2 |
| `AddDocumentModal.jsx:398-1039` (`DrivePickerSection`) | всередині | Drive folder picker для модалки |

Обидва роблять **одне і те саме** — навігація по Drive папкам з вибором
файлів. Це **те що ми відмітили у roadmap §8** — реальна духовна
дублікація.

**Канонічне рішення:** винести у `components/UI/DrivePicker/` (як
SortableGrid, CropperHost можна теж там). Обидва модулі тягнуть звідти.

**Коли:** при виконанні Фази 2 roadmap (split AddDocumentModal — там і
виявиться спільність).

### ⚠️ Дублікація-кандидат №2: Image-merge компоненти (потенційна, не зараз)

Поки DP v2 НЕ робить image-merge — дублікації немає. Але **коли почне** —
у нас вже є все потрібне в `ImageMergePanel/`:

| Шматок | Де живе зараз | Куди має переїхати при reuse |
|---|---|---|
| `pdfRebuild.js` (чистий PDF assembler) | `ImageMergePanel/pdfRebuild.js` | `services/imageDocument/pdfRebuild.js` |
| `geometry.js` (rotateRect) | `ImageMergePanel/geometry.js` | `services/imageDocument/geometry.js` |
| `PreviewPopup.jsx` (crop editor) | `ImageMergePanel/PreviewPopup.jsx` | `components/ImageEditor/PreviewPopup.jsx` |
| `CropperHost.jsx` | `ImageMergePanel/CropperHost.jsx` | `components/ImageEditor/CropperHost.jsx` |
| `Thumbnail.jsx` | `ImageMergePanel/Thumbnail.jsx` | `components/ImageEditor/Thumbnail.jsx` |
| `grid/*` (drag-and-drop) | `ImageMergePanel/grid/*` | `components/ImageEditor/grid/*` |
| `constants.js` (CATEGORY_OPTIONS) | `ImageMergePanel/constants.js` | `schemas/documentSchema.js` (вже там подібне!) |

Це **запланований переїзд**. Тригер — коли DP v2 реально починає робити
image-merge. До того моменту ці файли живуть у `ImageMergePanel/` і це
нормально (rule of three не виконано).

### ✅ Зони де дублікації НЕМАЄ і не буде

- **OCR pipeline** — DP v2 робить **складніший** OCR (chunking, retry,
  layout extraction) через `ocrService.js`. Модалка для одного файлу —
  простіший виклик через `convertToPdf`. Це не дублікація, це різні рівні
  складності над тим самим `ocrService`.
- **Document creation** — обидва викликають `createDocument()` з
  documentFactory. Це shared singleton — правильно.
- **Drive upload** — обидва через `driveService`. Shared.

## Конкретні рекомендації

### Що робити прямо зараз — нічого

DP v2 і модалка зараз не дублюють жодного значущого блоку. Сервіси чисто
shared. UI primitives shared. Все добре. **Не чіпати** — це порушує
принцип здорового організму (не переписуй те що активно не активується
новим TASK).

### Що додати у roadmap

Запропоную нову **Фазу 1.5** в
`consultation_large_files_refactoring_roadmap.md` з тригером — **«перед
TASK DP v2 image-merge»**. Зміст:

1. Створити `components/ImageEditor/` (порожня поки)
2. Створити `services/imageDocument/` (порожня поки)
3. Переїзд відбувається **разом з** TASK DP v2 image-merge (один TASK,
   два кроки)

Це і є канонічна форма: **підготувати ДНК-папки заздалегідь, заповнити
коли активується реальний споживач.**

### Що зробити окремо — DrivePicker

Це справді існуюча дублікація. Помітив у roadmap §8 (Фаза 2 —
AddDocumentModal split). Там при виносі побачимо чи можна звести два у
`components/UI/DrivePicker/`. **Це окремий під-TASK Фази 2**, не зараз.

## Резюме голосом

Твоя інтуїція правильна. Сучасний грамотний код **організований так**:
бізнес-логіка у сервісах, UI-примітиви у спільній бібліотеці, окремі
модулі — рівноправні споживачі. Ніякої ієрархії «потужний модуль» /
«простий модуль» — обидва тягнуть з третього місця.

У нашому коді **сервісний шар вже зроблений правильно** — DP v2, модалка
і ImageMergePanel шарять converterService, ocrService, driveService,
documentFactory, всі UI-примітиви. Те що ми зробили split ImageMergePanel
— це **підготовка** до коли інший модуль захоче ці компоненти.

**Реальних дублікацій сьогодні дві:**
1. DrivePicker — є в обох місцях, треба звести при Фазі 2 roadmap
2. Image-merge компоненти — поки не дублюються, але переїдуть у спільне
   коли DP v2 почне image-merge

**Правило коли виносити у спільне** — Rule of Three: побачив **третій**
реальний випадок використання → точно час виносити. На другому — копія +
позначка в tracking_debt.

---

**Кінець збірки**
