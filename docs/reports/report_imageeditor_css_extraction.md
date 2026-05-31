# Звіт — Завершення розділення image-editor: спільний компонент володіє своїм CSS

**TASK:** `docs/tasks/TASK_imageeditor_css_extraction.md`
**Тип:** рефакторинг presentation-шару (CSS co-location), без зміни даних/схеми/логіки
**Дата:** 2026-05-31
**Гілка:** `claude/image-editor-css-extraction-4TtGj`
**Статус:** виконано; тести зелені (1671/1671), білд успішний.

---

## Що зроблено (коротко)

«Руки» (спільний JSX редактора в `src/components/ImageEditor/*`) тепер мають свій
«одяг» (CSS) поруч. Спільні правила `image-merge-panel__*` перенесені з модалчиного
`CaseDossier/ImageMergePanel.css` у новий `ImageEditor/imageEditor.css`, який
імпортується зі спільного компонента `Thumbnail.jsx`. Тепер документ-процесор
(`DpImageMergeEditor`) рендерить ідентично модалці незалежно від того, чи відкривали
модалку «Склеїти зображення» — CSS іде у бандл разом з компонентом, а не «випадково»
через статичний import модалки.

Додано `align-items: start` у `.image-merge-panel__grid` — остання причина «різної
висоти»: висока клітинка-рамка дублів більше не розтягує сусідні одиночні клітинки
у тому ж рядку (default `stretch`).

---

## Чи дав підхід істинне розділення? ТАК.

Перевірено головне правило сесії (чесний стоп, якщо підхід не самодостатній).
Підхід **дає** істинне розділення, бо:

1. Граф імпорту обох споживачів **статично** проходить через `Thumbnail.jsx`:
   - Модалка: `AddDocumentModal` → `ImageMergePanel/index` → `PreviewView` →
     `ImageEditor/grid/SortableGrid` → `RenderItem` → `Thumbnail`.
   - DP: `DpImageMergeEditor` → `RenderItem` → `Thumbnail` (+ прямі `PreviewPopup`,
     `ContextMenu`).
   Один `import './imageEditor.css'` у `Thumbnail.jsx` покриває **весь** спільний CSS
   (включно з popup/cropper/ctxmenu) — CSS-import працює на рівні графа модулів, не
   рендеру. Vite включає його у бандл для обох споживачів (підтверджено grep'ом по
   зібраному `dist/assets/index-*.css`).
2. Класи `image-merge-panel__*` **не перейменовувались** (поза обсягом) — нуль змін
   у className будь-якого JSX, нуль ризику для модалки.
3. Жодних прихованих залежностей від порядку завантаження чи стану конкретного
   споживача в перенесених правилах не виявлено.

Тобто це не «латка навколо», а доведення екстракції до кінця.

---

## Розділення класів — множини A/B (на основі grep, не на око)

**Множина A (СПІЛЬНІ → перенесено у `imageEditor.css`)** — реферясь зі спільного
шару (`ImageEditor/*`) та/або документ-процесора (`DpImageMergeEditor.jsx`). 72 класи:

- `__grid`, `__grid--loading`
- `__thumb` і всі варіанти: `--warn`, `--dup`, `--dup-recommended`, `--dup-other`,
  `--in-group`, `--processed`, `--dragging`; `__thumb-img`, `__thumb-image-wrap`,
  `__thumb-placeholder`, `__thumb-pos`, `__thumb-handle`, `__thumb-actions`,
  `__thumb-action`, `__thumb-action--danger`, `__thumb-warning`,
  `__thumb-processed-badge`, `__thumb-orient-badge`, `__thumb-crop-badge`(+`--disabled`),
  `__thumb-dup-badge`(+`--recommended`), `__thumb-keep-dup`
- `__dup-group`(+`--dragging`), `__dup-group-header`, `__dup-group-label`,
  `__dup-group-dismiss`, `__dup-group-body`
- `__popup*` (overlay, body, canvas, fitimg, topbar, topbtn(+`--primary`),
  topbtn-label, topcenter, position, tag(+`--dup`/`--warn`), toolbar, tools,
  tool(+`--active`/`--danger`), nav, straighten(+input/label/value/reset/`--hidden`),
  `--full`, overlay--full)
- `__cropper`, `__cropper-bg`
- `__ctxmenu`, `__ctxmenu-item`(+`--danger`)
- `__alerts`, `__alert`, `__alert--dup`, `__alert--crop` (реферясь з DP)
- `__remove-suspicious`(+`--dup`/`--crop`) (реферясь з DP)

**Множина B (МОДАЛЧИНІ → лишилися в `ImageMergePanel.css`)** — реферясь тільки з
`ImageMergePanel/*`: `__selecting`, `__hint`, `__sources`, `__source-btn`, `__queue*`,
`__actions`, `__processing*`, `__phase-step*`/`__phase-stepper`, `__preview`, `__form`,
`__form-row`, `__sfw*`, `__debug-toggle`, `__alert--info`, `__alert--warn`,
`__alert--orient` (модалкові варіанти банера; база `__alert`/`__alerts` — у спільному).

Перевірка повноти: для кожного класу з A правило існувало й перенесене; жоден
спільний селектор не лишився визначеним у `ImageMergePanel.css` (підтверджено grep'ом
`\.image-merge-panel__<sel>[ {,:]` → 0). Залишкові згадки `__alert`/`__alerts` у
модалці — лише в коментарях, не правила.

---

## ЛАТЕНТНА ЗНАХІДКА — мертві CSS-класи (НЕ вигадував стилі, НЕ видаляв)

Кілька класів визначені в `ImageMergePanel.css`, але **не реферясь з жодного JSX**
(перевірено `grep -rl` по всьому `src` — 0 не-CSS файлів). Це залишки старого
inline-crop-frame та zoom-попапа перегляду, які замінені на `react-advanced-cropper`
(через `CropperHost`) і `popup-canvas`/`popup-topbar`:

- `__popup-header`, `__popup-close`
- `__popup-zoom-wrap`, `__popup-zoom-wrap--loading`, `__popup-zoom-content`
- `__popup-img` (база; descendant-правило `.popup-canvas .popup-img` теж мертве —
  лишене поряд з `popup-canvas` у спільному файлі)
- `__popup-hint`
- `__crop-frame`, `__crop-frame-body`, `__crop-handle` і всі `--nw/n/ne/e/se/s/sw/w`

**Рішення:** НЕ видаляти (поза обсягом цього TASK — лише перенесення правил, не
загальний рефактор/прибирання `ImageMergePanel.css`), НЕ вигадувати їм застосування.
Лишені в `ImageMergePanel.css` з коментарем-маркером `ОРФАН`. Рекомендація для
майбутнього cleanup-TASK: видалити ці правила (≈70 рядків мертвого CSS) разом з
дублікатом `__popup-tool--active` (див. нижче).

### Дубль `__popup-tool--active`
У вихідному `ImageMergePanel.css` клас `__popup-tool--active` мав **два** визначення
(синя заливка для toolbar-кнопки + світліша підсвітка активної рамки). Обидва
реферясь зі спільного `PreviewPopup.jsx`, тому обидва перенесені у `imageEditor.css`
**зі збереженням порядку** (друге перекриває перше у каскаді — поведінка не змінена).
Це теж кандидат на впорядкування у майбутньому cleanup (один клас — два сенси, сигнал
правила #11), але виходить за обсяг presentation-only переносу.

---

## Зміни у файлах

| Файл | Зміна |
|------|-------|
| `src/components/ImageEditor/imageEditor.css` | **новий** (1045 рядків) — спільні правила множини A + `align-items:start` у `__grid` |
| `src/components/CaseDossier/ImageMergePanel.css` | 1496→512 рядків; прибрані правила множини A; лишився модалковий хром (B) + орфани з маркерами |
| `src/components/ImageEditor/Thumbnail.jsx` | додано `import './imageEditor.css'` (з коментарем чому саме тут) |
| `tests/unit/imageEditorCssExtraction.test.js` | **новий** — інваріант розділення (reproduce-first) |
| `tests/unit/dpDuplicateFrameLayout.test.js` | еталон рамки дублів читається тепер зі спільного `imageEditor.css` (раніше з модалкового) |

---

## Тести / білд

- **Reproduce-first:** новий `imageEditorCssExtraction.test.js` читає
  `imageEditor.css` через `readFileSync` — до рефактора файлу не існувало →
  `readFileSync` кидав → тест червоний (перевірено емпірично: тимчасово сховав файл →
  Test Files 1 failed). Після рефактора — зелений.
- `npm test` — **1671 passed (130 файлів)**, 0 червоних (після rebase на свіжий main).
- `npm run build` — успішний (Vite). Зібраний `dist/assets/index-*.css` містить
  `__grid{…align-items:start}`, `__thumb-img{…height:140px;object-fit:cover}`,
  `__popup-canvas`, `__ctxmenu` — спільні правила у бандлі незалежно від модалки.

### Що перевіряє новий тест (інваріант розділення)
1. `Thumbnail.jsx` сам імпортує `imageEditor.css`.
2. Спільні селектори присутні у `imageEditor.css` і **прибрані** з `ImageMergePanel.css`
   (true separation, не копія).
3. `__thumb-img` має фіксовану `height:140px; object-fit:cover` (рівні клітинки).
4. `__grid` має `align-items:start`.
5. Модалковий хром (`__queue`, `__source-btn`, `__phase-stepper`, `__form`, `__sfw`)
   лишився у `ImageMergePanel.css` і НЕ протік у спільний файл.

---

## Жива перевірка DOM (інструкція для адвоката)

Після деплою відкрити документ-процесор (вкладка `Робота з документами`) на справі з
фото-сторінками **без** попереднього відкриття модалки «Склеїти зображення» у тій
самій сесії. Очікувано: клітинки рівні (прев'ю 140px / 220px на десктопі), рамка
дублів охайна і не розтягує сусідів; вигляд ідентичний модалці.

> Примітка: автоматичну живу DOM-перевірку в headless-середовищі не виконував
> (потрібен реальний браузер + дані справи з фото); інваріант зафіксовано юніт-тестом
> на рівні CSS-джерела + гарантією графа імпорту + grep'ом по зібраному бандлу.

---

## Definition of Done

| # | Критерій | Стан |
|---|----------|------|
| 1 | `imageEditor.css` існує, містить множину A; правила прибрані з `ImageMergePanel.css` | ✅ |
| 2 | Спільний CSS імпортується зі спільного компонента (`Thumbnail.jsx`) | ✅ |
| 3 | `.image-merge-panel__grid` має `align-items: start` | ✅ |
| 4 | Новий/розширений тест (reproduce-first), `npm test` зелений, `npm run build` успішний | ✅ |
| 5 | Жива перевірка — клітинки рівні, ідентично модалці | ⏳ інструкція надана (потрібен браузер) |
| 6 | Звіт зі списком A/B + латентні знахідки | ✅ (цей файл) |
| 7 | Чесний стоп, якщо підхід не дає розділення | n/a — підхід дав істинне розділення |
