# Звіт мікро-TASK 5.2-fix2

**Дата:** 2026-05-10
**Гілка:** main
**Тести:** 481 passed (38 test files), 5 нових тестів додано
**Build:** чистий (vite v6.4.1, 2380 modules)

---

## 1. Що зроблено для кожної з чотирьох проблем

### Проблема 1 — PDF searchable виділення тексту

Без архітектурної переробки. Полагоджена синхронізація canvas+textLayer і додано блокування Android long-press menu на canvas.

**Корінь системного меню Android:** canvas трактується браузером як зображення → long-tap викликає системне меню «Поділитись/Друк». Текстовий шар поверх canvas прозорий, але між span'ами тапи проходили крізь нього на canvas.

**Корінь зміщення/проміжків між рядками:** ми задавали inline `style.width/height` на textLayer контейнері перед `TextLayer.render()`. Новий API pdfjs (5.x) сам встановлює CSS-variables `--scale-factor` / `--total-scale-factor` через style.setProperty, і inline width/height плутають масштабування span'ів через `transform: scaleX()`.

**Корінь системного меню для tap-and-hold:** наш CSS `.pdf-page__text-layer` дублював і перевизначав властивості з офіційного `pdf_viewer.css` (`overflow`, `opacity`, `line-height`, `position`, `inset`) — це «майже» збігалось але не точно, тому транформ з span'ів (relative to textLayer) ламався.

### Проблема 2 — HTML Windows-1251 ромбіки

Додано content-based heuristic у `decodeHtmlBuffer`: якщо первинна детекція не «high» confidence (немає BOM або meta-charset бреше), і UTF-8 декод дав багато `�` replacement chars — пробуємо повторно декодувати як `windows-1251`. Якщо результат містить достатньо кириличних літер і менше replacement chars — обираємо cp1251.

Не торкає шлях коли BOM знайдено (high confidence) або charset вже windows-1251.

### Проблема 3 — DOCX justify не зберігається

mammoth втрачав `paragraph.alignment` при дефолтній конвертації. Додано `styleMap` опцію що мапить `p[alignment='justify'/'center'/'right'/'left']` → CSS-класи `align-justify`, `align-center` тощо. CSS застосовує `text-align` за класом.

`.docx-content` отримав default `text-align: justify` — більшість юридичних документів justified навіть якщо mammoth не зберіг alignment. `.docx-content * { ... !important }` обмежено тільки `color` і `background-color` — раніше воно перебивало все включно з font-family і вирівнюванням.

### Проблема 4 — DOCX/HTML візуальне розділення сторінок

DOCX: контент обгорнуто у структуру `.docx-page` (білий аркуш A4 794×1123px з тінню) усередині `.document-viewer__content--docx` (сірий фон як стіл).

HTML: `prepareHtmlForIframe` отримав опцію `wrapPage`. Коли true — обгортає вміст body у `<div class="html-page">`. iframe styles (`IFRAME_THEME_STYLE`) малюють той же білий A4 аркуш на сірому фоні.

PDF лишився як був (там і так посторінковий рендер, і так є тінь і білий аркуш — проблема 4 його не зачіпає).

---

## 2. Файли і рядки

| Файл | Зміни |
|------|-------|
| `src/components/DocumentViewer/PdfRenderer.jsx` | Видалено inline `textContainer.style.width/height` (рядки 246-247) |
| `src/components/DocumentViewer/DocxRenderer.jsx` | Додано `MAMMOTH_STYLE_MAP` константу; передано як `styleMap` опцію в `mammoth.convertToHtml`; обгортка контенту в `.docx-page` |
| `src/components/DocumentViewer/HtmlRenderer.jsx` | `IFRAME_THEME_STYLE` розширено для page-layout (сірий фон body, білий `.html-page` з тінню); виклик `prepareHtmlForIframe` з `{ wrapPage: true }` |
| `src/components/DocumentViewer/DocumentViewer.css` | `.pdf-page` — прибрано `overflow:hidden`, додано `touch-action: pan-y`, `user-select: text`; `.pdf-page__canvas` — `pointer-events: none` (блок Android system menu); `.pdf-page__text-layer` — обмежено лише `user-select` (не дублюємо pdf_viewer.css); додано `::selection` стилі; `.docx-content *` — `!important` тільки на color/background-color; додано `.align-*` класи; додано `.docx-page` — A4 з тінню; `.document-viewer__content--docx` — сірий фон |
| `src/utils/htmlCharsetDetection.js` | Додано константи `REPLACEMENT_RATIO_THRESHOLD`, `MIN_CYRILLIC_AFTER_CP1251`, `SAMPLE_LENGTH`; функції `countReplacementChars`, `countCyrillicChars`, `shouldTryCp1251Fallback`; розширено `decodeHtmlBuffer` content-heuristic; додано опцію `wrapPage` у `prepareHtmlForIframe` |
| `tests/unit/htmlCharsetDetection.test.js` | +5 нових тестів: ЄСІТС cp1251 без declaration, heuristic не псує ASCII, heuristic не змінює BOM-впевнений UTF-8, wrapPage обгортка, wrapPage off, wrapPage без body |

---

## 3. PDF — точна причина і виправлення

### Причини

**3.1.** Системне Android меню при long-tap. Canvas — це `<canvas>` елемент який Chromium трактує як image. Long-tap на image відкриває native context menu («Поділитись/Друк/Зберегти зображення»). Тапи між span'ами textLayer проходили крізь прозорий шар на canvas.

**3.2.** Зміщення тексту вгору і проміжки між рядками. Новий `TextLayer` API pdfjs 5.x обчислює позиції span'ів від `viewport`, потім встановлює CSS-variables (`--scale-factor`, `--total-scale-factor`, `--font-height`, `--scale-x`) на span'ах для масштабування шрифту через `transform: rotate() scaleX() scale()`. Якщо контейнер має inline `style.width/height` — це створює конфлікт з expected layout (pdfjs очікує що `inset:0` і виміри батька керують розміром, а не inline width).

**3.3.** Стрибки виділення при русі. Наш CSS дублював властивості з `pdf_viewer.css` (`position`, `inset`, `opacity`, `overflow`, `line-height`) на тому ж класі `.textLayer`. Через специфічність селектора `.pdf-page__text-layer` (один клас) vs `.textLayer` (один клас) браузер обирає той що пізніше у каскаді. Залежно від порядку завантаження CSS-файлів — нестабільна поведінка. Виділення «стрибало» бо span coords обчислені під одну геометрію контейнера, а DOM рендерив іншу.

**3.4.** Виділення «вилазить за межі Viewer». `.pdf-page` мало `overflow: hidden` — на мобільному при tap-and-drag за межі сторінки caret виділення обрізався. Native scroll behaviour Chromium цього не любить.

### Виправлення

```jsx
// PdfRenderer.jsx — НЕ задаємо inline розміри textLayer
textContainer.innerHTML = '';
// (видалено: textContainer.style.width/height)
textLayer = new pdfjsLib.TextLayer({ textContentSource, container, viewport });
await textLayer.render();
```

```css
/* DocumentViewer.css */
.pdf-page {
  /* НЕ overflow: hidden */
  user-select: text;
  -webkit-user-select: text;
  touch-action: pan-y;             /* дозволити вертикальний скрол + native виділення */
  -webkit-touch-callout: default;
}

.pdf-page__canvas {
  pointer-events: none;            /* canvas не реагує на тап → нема Android menu */
  -webkit-touch-callout: none;
  user-select: none;
}

/* НЕ переоголошуємо position/inset/overflow/line-height/transform-origin —
   це робить pdf_viewer.css на класі .textLayer */
.pdf-page__text-layer {
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}

.pdf-page__text-layer ::selection { background: rgba(0, 100, 200, 0.35); }
```

`pdfjsLib.TextLayer` (новий API в 5.x) уже використовується — не перейшли на застарілий `renderTextLayer` бо він видалений з 5.x.

---

## 4. CP1251 heuristic — алгоритм

```
                  detectCharset (BOM → header → meta → default UTF-8)
                          │
                          ▼
                    декодуємо primary
                          │
                          ▼
            ┌─────────────────────────────────┐
            │ Якщо confidence==='high'        │ → повертаємо primary
            │ АБО charset==='windows-1251'    │
            └────────────┬────────────────────┘
                         │ ні
                         ▼
              рахуємо replacements (�)
                         │
                         ▼
        ┌───────────────────────────────────────────┐
        │ Якщо replacementRatio > 0.5%              │ → пробуємо cp1251
        │ (порог: 1 на 200 символів)                │
        └────────────┬──────────────────────────────┘
                     │
                     ▼
              декодуємо як cp1251
                     │
                     ▼
        ┌─────────────────────────────────────────┐
        │ cp1251Cyrillic >= 30                    │ → повертаємо cp1251
        │ AND cp1251Replacements < utfReplacements │   { source: 'content-heuristic' }
        └─────────────────────────────────────────┘
                     │ ні
                     ▼
                 лишаємо primary
```

### Приклад до/після

ЄСІТС файл без BOM, без `Content-Type` header, без `<meta charset>`. Тіло — байти cp1251 для тексту «УХВАЛА Іменем України».

| Крок | До (попередня логіка) | Після (з heuristic) |
|------|----------------------|---------------------|
| `detectCharset` | utf-8, low, default | utf-8, low, default |
| Декодування utf-8 | `Ó�ÂÀ�À ²ìåíåì Óê�à¿íè` (replacement chars) | `Ó�ÂÀ�À ...` |
| Heuristic check | — | replacement ratio > 0.5% → пробуємо cp1251 |
| Декодування cp1251 | — | `УХВАЛА Іменем України` |
| Повертаємо | `Ó�ÂÀ�À` (ромбіки) | `УХВАЛА Іменем України` (правильно) |

Параметри heuristic:
- `REPLACEMENT_RATIO_THRESHOLD = 0.005` (0.5%)
- `MIN_CYRILLIC_AFTER_CP1251 = 30`
- `SAMPLE_LENGTH = 4000` (перші 4 KB для статистики)

---

## 5. DOCX — justify і docx-page структура

### Justify збереження

mammoth styleMap:
```js
const MAMMOTH_STYLE_MAP = [
  "p[alignment='justify'] => p.align-justify:fresh",
  "p[alignment='center']  => p.align-center:fresh",
  "p[alignment='right']   => p.align-right:fresh",
  "p[alignment='left']    => p.align-left:fresh",
];

await mammoth.convertToHtml({ arrayBuffer }, { styleMap: MAMMOTH_STYLE_MAP });
```

CSS:
```css
.docx-content { text-align: justify; }              /* default */
.docx-content .align-justify { text-align: justify; }
.docx-content .align-left    { text-align: left; }
.docx-content .align-right   { text-align: right; }
.docx-content .align-center  { text-align: center; }
```

`* !important` тепер тільки на колір — не перебиває text-align з .align-* класів і не псує font-family inheritance.

### Структура до/після

**До:**
```html
<div class="document-viewer__content document-viewer__content--docx">
  <div class="docx-content">
    <p>Текст</p>
  </div>
</div>
```
Контент на повну ширину з `padding: var(--space-5)`, фон `white` суцільний, без візуального аркуша.

**Після:**
```html
<div class="document-viewer__content document-viewer__content--docx">  <!-- сірий фон #e8e8ec -->
  <div class="docx-page">                                              <!-- білий A4 794×1123 з тінню -->
    <div class="docx-content">
      <p class="align-justify">Текст</p>
    </div>
  </div>
</div>
```

Виглядає як аркуш паперу що лежить на сірому столі.

---

## 6. HTML — html-page структура

`prepareHtmlForIframe` тепер приймає `{ wrapPage: true }`. Коли true, обгортає вміст body:

```html
<!-- До -->
<body><h1>Заголовок</h1><p>Текст</p></body>

<!-- Після (wrapPage:true) -->
<body><div class="html-page"><h1>Заголовок</h1><p>Текст</p></div></body>
```

`IFRAME_THEME_STYLE` інжектує:
```css
html, body { background: #e8e8ec; padding: 30px 16px; }   /* сірий фон стола */
.html-page {
  background: white;
  max-width: 794px;        /* A4 ширина при 96 DPI */
  margin: 0 auto;
  padding: 60px 80px;      /* стандартні поля Word */
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  min-height: 1123px;      /* A4 висота */
}
```

`HtmlRenderer.jsx` викликає `prepareHtmlForIframe(decoded.text, IFRAME_THEME_STYLE, { wrapPage: true })`.

ЄСІТС META-режим (коли body порожній) **не зачіпається** — там окрема таблиця `.html-ecits` що не йде через iframe.

---

## 7. Сценарії тестування для адвоката

### а) PDF searchable — рішення суду

1. Відкрити будь-яке рішення суду (PDF searchable) у досьє справи.
2. Tap-and-hold на тексті → має з'явитись native textselection toolbar (без «Поділитись/Друк/Viber»).
3. Drag від однієї літери до іншої через 2-3 рядки — виділення має:
   - точно покривати текст без зміщення вгору/вниз
   - не мати вертикальних проміжків між смугами рядків (або мати такі ж дрібні як у Drive)
   - плавно рухатись без стрибків з пів-слова на абзац
4. Виділення між колонками/рядками — caret рухається в межах сторінки, не вилазить.

Бенчмарк: PDF в самому Drive напряму. Має бути не гірше.

### б) HTML Windows-1251 — стара ухвала з ЄСІТС

1. Відкрити стару ухвалу з ЄСІТС у HTML форматі (де раніше були ромбіки).
2. Має з'явитись правильний кириличний текст «УХВАЛА Іменем України...».
3. Якщо на якомусь файлі досі ромбіки — це означає що heuristic не спрацював (replacement ratio нижче порогу). Повідомити: «такий-то файл, після фіксу досі ромбіки» — переглянемо параметри.

### в) DOCX justify — позовна заява

1. Відкрити позовну заяву (DOCX) з justified параграфами.
2. Текст має бути вирівняний по обох краях (justify), а не лівому.
3. Параграфи з center/right alignment у Word теж мають бути правильно вирівняні.

### г) DOCX як аркуш

1. Відкрити будь-який DOCX.
2. Має виглядати як білий аркуш на сірому фоні з тінню.
3. Поля білого аркуша — стандартні Word (60px зверху/знизу, 80px з боків).
4. Короткий документ (1 параграф) — все одно займає весь A4 аркуш (через min-height: 1123px).

### д) HTML як аркуш

1. Відкрити будь-який HTML файл (стара ухвала з ЄСІТС, рішення з реєстру).
2. Має виглядати як білий аркуш на сірому фоні з тінню (як DOCX).
3. ЄСІТС META-режим (де реальні дані у meta-тегах) — таблиця ключ-значення лишається як було, без аркуша.

---

## 8. Що НЕ зроблено і чому

- **Не переробили PdfRenderer на чистий HTML.** Архітектурна консультація `consultation_pdf_html_approach.md` показала що це втратить герби, печатки, підписи, таблиці — критично для адвокатської роботи.

- **Не зробили iframe pdfjs viewer fallback.** Поточний фікс канвас+textLayer має дати потрібний UX. Якщо адвокат тестує і виділення все одно поганьше за Drive — окремий TASK запасного варіанту.

- **Не реалізували розрив сторінок усередині DOCX/HTML.** mammoth не дає реальних page breaks для automatic розривів. Реалізація через JS-вимірювання висоти та вставку візуальних розривів — складна (потрібен `useLayoutEffect` + ResizeObserver + перерахунок при ширині), для початку обмежились одним великим аркушем висотою min A4. Якщо адвокат скаже «потрібні окремі аркуші всередині документа» — окремий TASK.

- **Не міняли логіку вибору рендеру у `DocumentViewerContent.jsx`** (поза скопом за ТЗ).

- **Не змінювали footer кнопки, scanned PDF, JPG/PNG, AddDocumentModal pipeline, 02_ОБРОБЛЕНІ, класифікацію documentNature** (поза скопом за ТЗ).

- **Не додавали маркер/нотатки** (поза скопом).

- **Не додавали нові залежності** — все через існуючі pdfjs-dist 5.6.205 (TextLayer API), mammoth styleMap, TextDecoder.
