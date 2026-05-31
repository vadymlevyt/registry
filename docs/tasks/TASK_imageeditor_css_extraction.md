# TASK — Завершити розділення image-editor: спільний компонент мусить володіти своїм CSS

**Тип:** рефакторинг presentation-шару (CSS co-location), без зміни даних/схеми/логіки
**Статус:** заплановано, окрема сесія
**Дата запису:** 2026-05-31
**Гілка:** працювати на своїй `claude/*` (harness видасть). Це **зміна коду** → перед
зведенням у `main` показати зведення і отримати однослівне підтвердження адвоката
(правило #1 CLAUDE.md). Тільки FF, тільки при зелених тестах.

---

## 🔴 ГОЛОВНЕ ПРАВИЛО ЦІЄЇ СЕСІЇ (читати першим)

Попередня сесія **двічі** латала симптом (рамку дублів), не помітивши, що
«спільний» компонент **насправді не самодостатній**, і **промовчала** про це.
Цього більше не має бути.

**Якщо під час роботи ти виявиш, що обраний підхід не дає істинного розділення
(наприклад: класи не можна перенести без поломки модалки; є приховані залежності
від порядку завантаження; компонент тягне стан з конкретного споживача) — ЗУПИНИСЬ,
напиши про це прямо в кінцевій відповіді, запропонуй правильний шлях. НЕ латай
навколо. Чесне «так не вийде, треба інакше» цінніше за тихий патч.**

Перед стартом обов'язково прочитати `CLAUDE.md` і `DEVELOPMENT_PHILOSOPHY.md`
(правило проєкту). Особливо принцип #11 (однозначність) і «ембріон з повним ДНК».

---

## КОНТЕКСТ І КОРІНЬ ПРОБЛЕМИ (встановлено в попередній сесії, з доказами)

Є дві в'юхи редактора зображень:
1. **Модалка** `Склеїти зображення` — `src/components/CaseDossier/ImageMergePanel/`
   (відкривається через `AddDocumentModal.jsx`). **Виглядає ПРАВИЛЬНО** — клітинки
   рівні, сітка охайна.
2. **Інлайн у досьє** вкладка `Робота з документами` → документ-процесор
   `src/components/DocumentProcessorV2/DpImageMergeEditor.jsx`. **Виглядає ЗЛАМАНО** —
   клітинки різної висоти, рамка дублів розкладена нерівно.

### Що вже спільне (зроблено правильно)
Логіка рендеру винесена в `src/components/ImageEditor/`:
`Thumbnail.jsx`, `RenderItem.jsx`, `grid/` (`DndGrid.jsx`, `SortableGrid.jsx`,
`SortableItem.jsx`), `PreviewPopup.jsx`, `ContextMenu.jsx`, `CropperHost.jsx`.
**Обидві** в'юхи рендерять картку через `RenderItem` → `Thumbnail`. Тобто JSX
справді спільний.

### Корінь проблеми (НЕ симптом, а причина)
**JSX винесли в `ImageEditor/`, а CSS — НІ.** Доведено:

- `git grep "import.*\.css" src/components/ImageEditor/` → **жодного власного CSS**
  (крім динамічного `react-advanced-cropper/dist/style.css` у `CropperHost.jsx`).
- Спільний `Thumbnail.jsx` малює `<img className="image-merge-panel__thumb-img">`
  (рядок ~74) — **позичає** ім'я класу.
- Усі візуальні правила (`.image-merge-panel__grid`, `__thumb`, `__thumb-img`
  **з `height:140px; object-fit:cover`** — саме це робить клітинки рівними,
  `__dup-group`, `__dup-group-body`, `__popup*`, `__ctxmenu*`, `__cropper*` тощо)
  визначені **ТІЛЬКИ** в `src/components/CaseDossier/ImageMergePanel.css`
  (196 правил `image-merge-panel__`, 1496 рядків).
- `ImageMergePanel.css` імпортується **ТІЛЬКИ** з боку модалки —
  `CaseDossier/AddDocumentModal.jsx:23 import './ImageMergePanel.css'`.
- `DocumentProcessorV2` імпортує **тільки свій** `styles.css`
  (`DocumentProcessorV2/index.jsx:38`), де правила висоти прев'ю/сітки **немає**.

**Висновок:** спільний компонент самодостатній **за формою (JSX), але не за стилем**.
Він покладається на те, що модалчин `ImageMergePanel.css` «випадково» присутній у
бандлі (через статичний import `AddDocumentModal`). Це крихка неявна зв'язка, а не
розділення. Метафора: винесли «руки» (компонент), а «одяг» (CSS) лишили в шафі
модалки. Документ-процесор бере руки, але одяг до них висить у чужій кімнаті, тому
домішує свій `styles.css` згори (`dp-image-merge-editor__group-grid` поряд з
`image-merge-panel__grid`) — «перелаштовує під себе».

### Що НЕ є причиною (щоб не повторювати чужу помилку)
- Це **НЕ** про `grid-column` рамки дублів — те вже виправлено в `4f245bf`
  (follow-up до #10 `154eb94`). НЕ відкочувати той фікс.
- Це **НЕ** про окрему «копію» розмітки — копії немає, JSX спільний. Проблема суто
  у **володінні CSS**.

---

## МЕТА

Довести екстракцію до кінця: **спільний візуальний CSS живе РАЗОМ зі спільним
компонентом у `ImageEditor/` і завантажується автоматично, хто б компонент не
рендерив.** Після цього модалка і документ-процесор рендерять **ідентично за
побудовою**, а не за збігом порядку завантаження. Витягнути модалку — DP-редактор
НЕ має втратити жодного розміру.

---

## ОБСЯГ: які класи спільні (переносити) vs модалчині (лишити)

### СПІЛЬНІ — реферясь зі спільних `ImageEditor/*` та/або `DpImageMergeEditor.jsx`.
**Перенести у новий спільний CSS.** Групи префіксів (повний список звірити grep'ом,
див. нижче):
- `image-merge-panel__grid`, `__grid--loading`
- `image-merge-panel__thumb` і ВСІ варіанти: `__thumb-img`, `__thumb-image-wrap`,
  `__thumb-placeholder`, `__thumb-pos`, `__thumb-handle`, `__thumb-actions`,
  `__thumb-action`, `__thumb-action--danger`, `__thumb-warning`,
  `__thumb-processed-badge`, `__thumb-orient-badge`, `__thumb-crop-badge`,
  `__thumb-crop-badge--disabled`, `__thumb-dup-badge`, `__thumb-dup-badge--recommended`,
  `__thumb-keep-dup`, `__thumb--warn`, `__thumb--processed`, `__thumb--in-group`,
  `__thumb--dup`, `__thumb--dup-recommended`, `__thumb--dup-other`, `__thumb--dragging`
- `image-merge-panel__dup-group`, `__dup-group--dragging`, `__dup-group-header`,
  `__dup-group-label`, `__dup-group-dismiss`, `__dup-group-body`
- `image-merge-panel__popup*` (усі: overlay, body, canvas, fitimg, topbar, topbtn,
  topcenter, toolbar, tools, tool, tool--active, tool--danger, nav, position, tag,
  tag--warn, tag--dup, straighten*, --full)
- `image-merge-panel__ctxmenu`, `__ctxmenu-item`, `__ctxmenu-item--danger`
- `image-merge-panel__cropper`, `__cropper-bg`
- `image-merge-panel__alert`, `__alerts`, `__alert--dup`, `__alert--crop`
  (реферясь з `DpImageMergeEditor.jsx`)
- `image-merge-panel__remove-suspicious`, `__remove-suspicious--dup`,
  `__remove-suspicious--crop` (реферясь з `DpImageMergeEditor.jsx`)

### МОДАЛЧИНІ — лишити в `ImageMergePanel.css`.
Хром самої модалки (оверлей діалогу, шапка, футер, dropzone, кнопки панелі тощо),
які реферясь **тільки** з `ImageMergePanel/index.jsx` та `ImageMergePanel/PreviewView.jsx`
і НЕ реферясь зі спільних `ImageEditor/*` чи `DpImageMergeEditor.jsx`.

### Як ТОЧНО розділити (обов'язковий крок, не на око):
1. Зібрати множину A — класи, що реферясь зі спільного шару і споживача-DP:
   ```
   git grep -ho "image-merge-panel__[a-z0-9-]*" -- src/components/ImageEditor/ \
     src/components/DocumentProcessorV2/DpImageMergeEditor.jsx | sort -u
   ```
2. Зібрати множину B — класи, що реферясь тільки з модалки:
   ```
   git grep -ho "image-merge-panel__[a-z0-9-]*" -- \
     src/components/CaseDossier/ImageMergePanel/ | sort -u
   ```
3. Перенести у спільний CSS правила для класів з A (і всіх їхніх `--модифікаторів`
   та дочірніх, навіть якщо самі модифікатори в JSX не згадані напряму).
   B \ A лишити в `ImageMergePanel.css`.
4. **Звірка повноти:** для КОЖНОГО класу з A переконатися, що його правило справді
   існувало і перенесене. Якщо клас реферясь у JSX, але правила в CSS НЕМАЄ
   (напр. деякі `__alert*`/`__remove-suspicious*` могли ніколи не мати стилю) —
   це **латентний баг**: зафіксувати у `docs/bugs/` і у фінальній відповіді, НЕ
   вигадувати стиль самостійно без погодження.

---

## РЕАЛІЗАЦІЯ (рекомендований підхід — мінімальний ризик)

1. Створити `src/components/ImageEditor/imageEditor.css`.
2. **Перенести** (вирізати з `ImageMergePanel.css`, вставити сюди) усі правила
   множини A. **Зберегти ідентичні селектори й імена** `image-merge-panel__*` —
   щоб НЕ чіпати className у жодному JSX (мінімум поверхні змін, нуль ризику
   для модалки). Перейменування класів — поза обсягом (окремий борг, якщо колись).
3. Імпортувати новий CSS з модуля, що **гарантовано в графі імпорту обох
   споживачів**: `import './imageEditor.css'` на початку `ImageEditor/Thumbnail.jsx`
   (його статично тягне `RenderItem.jsx`, який тягнуть обидві в'юхи). Один import
   покриває весь файл (включно з popup/ctxmenu/cropper-правилами), бо CSS-import
   працює на рівні графа модулів, не рендеру.
   - Альтернатива (якщо чистіше): import у `RenderItem.jsx`. Обрати одне, обґрунтувати.
4. `ImageMergePanel.css` лишається з модалчиним хромом (множина B). Модалка
   продовжує його імпортувати через `AddDocumentModal.jsx` — НЕ чіпати цей import.
5. **Додати сітці `align-items: start`** у правилі `.image-merge-panel__grid`
   (тепер у `imageEditor.css`): висока клітинка-рамка дублів (header + wrap-body)
   більше не розтягуватиме сусідні одиночні клітинки в тому ж рядку (default
   `stretch` — ймовірний залишковий ефект після `4f245bf`). Це і є остання
   причина «різної висоти» на скріні документ-процесора.
6. НЕ переносити динамічний `react-advanced-cropper/dist/style.css` — він уже
   правильно лінивий у `CropperHost.jsx`.

**Чому це «не винаходити велосипед»:** ми не пишемо нові стилі — переносимо наявні
туди, де живе спільний компонент, щоб одяг завжди йшов разом з руками.

---

## REPRODUCE-FIRST + ТЕСТИ (обов'язково, правило проєкту)

1. **Спершу тест, що падає на поточному стані.** Розширити/додати поряд з наявним
   `tests/unit/dpDuplicateFrameLayout.test.js` (він уже перевіряє layout рамки).
   Новий тест має стверджувати інваріант розділення, напр.:
   - спільні правила (`.image-merge-panel__thumb-img` з `height`, `.image-merge-panel__grid`)
     присутні у `src/components/ImageEditor/imageEditor.css`, а НЕ лишилися
     виключно в `ImageMergePanel.css`;
   - `Thumbnail.jsx` (або `RenderItem.jsx`) імпортує `imageEditor.css`;
   - (опційно) `.image-merge-panel__grid` містить `align-items: start`.
   Тест читає файли як текст (стиль наявного `dpDuplicateFrameLayout.test.js`) —
   DOM не потрібен.
2. Переконатися, що тест **червоний** до рефактора (бо правил у новому файлі ще нема).
3. Зробити рефактор → тест зелений.
4. `npm test` — **повністю зелений** (1666+ тестів). CI блокує деплой при red.
5. `npm run build` — успішний (Vite). Переконатися, що в зібраному бандлі CSS
   спільні правила присутні незалежно від модалки.

### Жива перевірка DOM (підтвердити, що візуально полагоджено)
Після білда відкрити документ-процесор (вкладка `Робота з документами`) на справі з
фото-сторінками **БЕЗ попереднього відкриття модалки `Склеїти зображення`** у тій
самій сесії (щоб виключити «CSS підвантажився через модалку»). Клітинки мають бути
рівні (висота прев'ю 140px / 220px на десктопі), рамка дублів — охайна, не розтягує
сусідів. Порівняти з модалкою — мають бути ідентичні.

---

## МЕЖІ / ЧОГО НЕ РОБИТИ

- НЕ перейменовувати `image-merge-panel__*` класи (поза обсягом; ризик великий,
  вигоди мало). Тільки перенесення правил.
- НЕ чіпати JSX-логіку, DnD, `selectRecommendedDuplicateRemovals` (#12),
  popup URL-revoke (#11), фікс `4f245bf`.
- НЕ чіпати `AddDocumentModal.jsx` import `ImageMergePanel.css`.
- НЕ змінювати схему даних, ACTIONS, PERMISSIONS, білінг — це presentation-only.
- НЕ вигадувати стилі для класів, у яких правила ніколи не було (зафіксувати як
  знахідку, не «домалювати»).
- НЕ розширювати обсяг на загальний рефактор `ImageMergePanel.css` — тільки
  перенесення множини A + `align-items`.

---

## SAAS / BILLING IMPLICATIONS

**Немає.** Це зміна виключно presentation-шару (co-location CSS). Не торкається
multi-tenant, даних, токенів, `time_entries`, `ai_usage`, схеми чи міграцій.
Секція присутня для відповідності правилу #10; вплив — нульовий. Єдиний
архітектурний виграш: спільний UI-компонент стає по-справжньому переюзовним
(важливо для майбутніх модулів, що рендеритимуть редактор зображень — «ембріон
з повним ДНК» на рівні presentation).

---

## РЕЗУЛЬТАТ (Definition of Done)

1. `src/components/ImageEditor/imageEditor.css` існує і містить усі спільні правила
   множини A; правила прибрані з `ImageMergePanel.css`.
2. Спільний CSS імпортується зі спільного компонента (`Thumbnail.jsx`/`RenderItem.jsx`).
3. `.image-merge-panel__grid` має `align-items: start`.
4. Новий/розширений тест у `tests/unit/` (reproduce-first), `npm test` зелений,
   `npm run build` успішний.
5. Жива перевірка: документ-процесор рендерить клітинки рівно, ідентично модалці,
   без попереднього відкриття модалки.
6. Звіт `docs/reports/report_imageeditor_css_extraction.md`: що перенесено, список
   класів A/B, будь-які латентні знахідки (класи без правил), скрін до/після.
7. Якщо в процесі виявлено, що підхід не дає істинного розділення — **чесний стоп**
   і пропозиція правильного шляху (див. головне правило вгорі).
