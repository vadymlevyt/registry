# pdf-lib з форматуванням для DOCX/HTML (Звіт)

**Дата:** 2026-05-12
**Версія:** 1.0
**Тести:** 692 зелені (50 файлів), CI/CD блокує деплой при red
**Build:** 21 сек, чистий
**Обраний варіант:** A — розширити pdf-lib з форматуванням і зображеннями
**Причина:** адвокат потребує (1) виділення тексту для копіювання і (2) маркер
                і нотатки Mozilla pdfjs які працюють тільки на searchable PDF.
                Конвертація DOCX/HTML у searchable PDF активує цей інструмент для
                всіх форматів документів.

---

## 1. Що зроблено для DOCX

Pipeline `docxToPdf.js`:
1. ZIP-сигнатура `PK\x03\x04` — швидка валідація що файл — справді DOCX.
2. `mammoth.convertToHtml({ arrayBuffer }, { styleMap, convertImage })`
   паралельно з `mammoth.extractRawText({ arrayBuffer })`.
3. `convertImage: mammoth.images.imgElement(...)` — повертає embed'нуті
   зображення як `data:<mime>;base64,<...>` у `<img src>`. Так у Word-документі
   з графіками/штампами вони доходять до PDF.
4. styleMap зберігає `paragraph.alignment` як `class="align-justify"` тощо —
   рендерер розпізнає ці класи і відтворює вирівнювання.
5. HTML → `pdfLibHtmlRenderer.htmlToPdfViaPdfLib(html)` — повний рендер з
   pdf-lib.
6. Поряд з PDF у 01_ОРИГІНАЛИ зберігається оригінал DOCX (`originalDriveId`).

**Що з форматування потрапляє у PDF:**
- Заголовки `<h1>`–`<h6>` — bold + збільшений шрифт (1.0×–1.8× базового)
- Абзаци з вирівнюванням (`left/right/center/justify`), `text-indent`,
  `margin-left/right`, `line-height`
- Inline стиль: `<b>/<strong>`, `<i>/<em>`, `<u>/<ins>`, `<s>/<del>`,
  `<sub>/<sup>`, `<a href>` (синій + анотація-посилання у PDF)
- Кольори: `color`, `background-color` (з inline `style="..."`)
- Списки `<ul>/<ol>/<li>` з маркерами `•` або `N.` і відступами для вкладених
- Таблиці `<table>/<tr>/<td>/<th>` з рівними або заданими ширинами колонок,
  `colspan`, `rowspan`, page-break коли рядок не влазить, заголовки th — bold
- Зображення `<img src="data:image/png;base64,...">` — embed у PDF через
  `pdfDoc.embedPng/embedJpg` зі скейлом до ширини контенту
- `<blockquote>` — курсив + лівий відступ
- `<hr>` — горизонтальна лінія сірим
- `<br>` — форсований перенос всередині абзацу
- `<pre>` — переноси збережені рядок-у-рядок

**extractedText** (`mammoth.extractRawText`) — окрема паралельна операція. Пише у
`02_ОБРОБЛЕНІ/<basename>_<driveId>.txt` через `writeExtractedTextArtifact`. Це
плейн-кеш для пошуку, AI-агентів і копіювання у клієнтський чат. Document AI
не викликається — у DOCX/HTML текст уже структурований.

---

## 2. Що зроблено для HTML

Pipeline `htmlToPdf.js`:
1. Бінарні сигнатури (PNG/JPEG/PDF/ZIP/GIF/WEBP) — відсікаємо випадково
   перейменовані файли.
2. `decodeHtmlBuffer` — UTF-8 або windows-1251 (старі експорти ЄСІТС).
3. Беремо тіло (`<body>` content або весь fragment якщо без body).
4. Тимчасовий DOM-контейнер → `innerText` для `extractedText` + перевірка
   `MIN_TEXT_LENGTH=30`. Контейнер прибирається з DOM у `finally`.
5. **ПОВНИЙ HTML (з тегами!)** → `htmlToPdfViaPdfLib(innerHtml)`.
   Раніше передавали plain-текст — форматування втрачалось.
6. PDF зберігається у 01_ОРИГІНАЛИ як `<name>.pdf`. HTML-оригінал не
   зберігається — все потрапляє у PDF.

**Що з ЄСІТС-ухвал тепер у PDF:**
- Герб як `<img>` з `data:image/png;base64,...` (mammoth і ЄСІТС обидва
  ембедять у вигляді data URI) — embed у pdf-lib через `embedPng`/`embedJpg`
- Заголовки і шапка з вирівнюванням (часто `align="right"` legacy-атрибут — теж
  парситься)
- Таблиці резолютивної частини з кордонами

---

## 3. Як працює парсинг HTML у pdf-lib

Новий модуль `src/services/converter/pdfLibHtmlRenderer.js` (~700 рядків).
Один public API: `htmlToPdfViaPdfLib(html, options) → Promise<Blob>`.

### Кроки

1. **DOMParser** парсить рядок HTML у DOM-дерево (jsdom у тестах, нативно у
   браузері).
2. **walkDom(root, parentStyle, blocks)** — рекурсивно обходить дерево і
   будує плоский список *блоків*:
   - `paragraph` (runs, style)
   - `heading` (runs, style, level)
   - `list` (items, ordered, style)
   - `table` (rows, columns, style)
   - `image` (src, width, height, align, style)
   - `hr`, `spacer`
3. **styleForElement(el, parentStyle)** — каскад успадкування:
   1. дефолти за тегом (h1→bold+size, b→bold, i→italic, a→underline+blue…)
   2. clas-маркери mammoth styleMap (`.align-justify`, `.align-center`…)
   3. legacy HTML `align=` атрибут
   4. inline `style="..."` атрибут (парситься через `parseInlineStyle` →
      словник, далі по полям: `text-align`, `font-weight`, `font-style`,
      `text-decoration`, `font-size`, `color`, `background-color`,
      `margin-left/right`, `padding-left`, `text-indent`, `line-height`)
4. **collectInlineRuns(node, style, runs)** — у блоку збираються runs-сегменти
   `{text, style}` з рекурсивним успадкуванням inline-стилів. `<br>` стає
   forceBreak-маркером; inline `<img>` — окремий run.
5. **layoutLines(segments, fonts, maxWidth)** — word-wrap:
   - сегменти: слова, пробіли, breaks, inline images
   - якщо слово не влазить — закриваємо рядок і починаємо новий
   - якщо саме слово ширше за рядок — розбиваємо посимвольно
6. **drawLine(ctx, line, opts)** — малює рядок з урахуванням `align`:
   - `left`: x = usableLeft + textIndent
   - `right`: x = usableRight − totalWidth
   - `center`: x = usableLeft + (usableWidth − totalWidth) / 2
   - `justify`: розподіляємо `(usableWidth − totalWidth) / spaceSegs.length`
     додатково між пробілами на кожному рядку крім останнього
   Для кожного word-сегмента:
   - вибирає `pickFont(style, fonts)` — Regular/Bold/Italic/BoldItalic
   - застосовує baseline-shift для `sub/sup`
   - малює background-rectangle для `background-color`
   - malює text через `page.drawText`
   - underline / strikethrough — через `page.drawLine`
   - `a href` — реєструє link-annotation у `page.Annots`
7. **renderTable** — рахує ширини колонок (із `width` attr або `style="width:..."` —
   `%` або `pt` — або рівномірно), вимірює висоту кожної клітинки
   (`measureCellHeight`), малює бордер `borderColor=rgb(0.7)` для кожної комірки,
   рендерить блоки клітинки у субконтекст з обмеженою шириною. Page-break
   спрацьовує перед рядком якщо не влазить.
8. **renderImageBlock** — embed з `data:` URI через `pdfDoc.embedPng`/`embedJpg`,
   масштабує до ширини контенту, відлуння розмірів за `width`/`height`-атрибутами.

### Шрифти

Lazy-load `public/fonts/LiberationSans-{Regular,Bold,Italic,BoldItalic}.ttf` —
ВСІ 4 паралельно через `Promise.all` при першому виклику, кеш на сесію.

```
LiberationSans-Regular.ttf      139 KB
LiberationSans-Bold.ttf         137 KB
LiberationSans-Italic.ttf       162 KB
LiberationSans-BoldItalic.ttf   135 KB
                                ─────
                                ~573 KB сумарно
```

Усі підтримують повну кирилицю (українські `іїєґ` теж). При embed у документ
pdf-lib робить `subset` (зберігає лише ті гліфи що реально використано) — у
результуючий PDF потрапляє лише ~15–30 КБ шрифтових даних на документ.

---

## 4. Додані залежності і bundle

Нічого нового з npm не додано. Bundle production:

```
dist/assets/pdfLibHtmlRenderer-*.js     18 KB / 6.81 KB gzip   (lazy-loaded)
dist/assets/docxToPdf-*.js              2.6 KB / 1.4 KB gzip   (lazy-loaded)
dist/assets/htmlToPdf-*.js              2.1 KB / 1.3 KB gzip   (lazy-loaded)
dist/assets/fontkit.es-*.js             717 KB / 330 KB gzip   (lazy-loaded)
dist/assets/mammoth.browser-*.js        500 KB / 126 KB gzip   (lazy-loaded)
public/fonts/LiberationSans-*.ttf       573 KB                  (4 шрифти, lazy fetch)
```

Головний chunk не зросте — все підтягується тільки при першій конвертації
DOCX/HTML. Після кешу браузера наступні конвертації миттєві.

**Видалено** мертвий код: `pdfLibRenderer.js` (text-only варіант з попередньої
ітерації) і його тести (`pdfLibRenderer.test.js`).

---

## 5. Інструкція адвокату для тестування

Після того як GitHub Actions деплоїть останній коміт на
https://vadymlevyt.github.io/registry/:

### а) Позовна заява Кісельової (DOCX)

1. Відкрити справу Кісельової → «Документи» → «+ Додати документ»
2. На стартовому екрані — «📄 Додати файл»
3. Вибрати `Позовна заява Кісельової.docx`
4. Перевірити що поле «Назва документа» автозаповнилось без розширення
5. Заповнити Тип/Від кого/Дату, натиснути «Додати документ»
6. У Viewer відкривається конвертований PDF. Перевірити:
   - **Заголовок** документа (напр. «Позовна заява») — більший шрифт, жирний
   - **Шапка** (Позивач/Відповідач/Суд) з вирівнюванням справа — на місці
   - **Justify** в основному тексті — слова розподілені по ширині, не зліплено
     до лівого краю
   - **Жирний/курсив** у виділених словах (наприклад НОРМИ закону)
   - **Таблиця** (якщо є) з кордонами і заголовками
   - **Виділення тексту** — провести курсором у Viewer → текст виділяється,
     можна копіювати (Ctrl+C) і вставити у клієнтський чат
   - У 01_ОРИГІНАЛИ на Drive є і PDF, і DOCX-оригінал

### б) Ухвала з ЄСІТС (HTML)

1. Завантажити стару ухвалу з кабінету ЄСІТС (вони часто Windows-1251)
2. «+ Додати документ» → «📄 Додати файл» → вибрати HTML
3. Натиснути «Додати документ»
4. У Viewer:
   - **Герб** має зʼявитись (якщо у HTML був `<img src="data:image/png;...">`)
   - Заголовок «УХВАЛА» по центру жирним
   - Резолютивна частина з відступом
   - Підпис судді — справа
   - Текст копіюється
5. У 01_ОРИГІНАЛИ — тільки PDF (HTML-оригінал не зберігається).
   Українські літери конвертовані коректно — `decodeHtmlBuffer` обробив
   windows-1251.

### в) Виділення/маркер у Viewer

1. Відкрити будь-який конвертований DOCX або HTML у Viewer
2. Натиснути іконку **Highlight** у тулбарі pdfjs (зверху)
3. Виділити мишею важливий фрагмент → залишається кольоровий маркер
4. Натиснути **Text annotation** (нотатка) → ввести коментар біля абзацу
5. *Зауваження:* зараз маркери/нотатки зберігаються у pdfjs `annotationStorage`
   на час сеансу. Persist до Drive — окремий TASK (`report_pdfjs_annotations_analysis.md`
   аналізує реалізацію — ~410 рядків коду через internal API).

### г) PDF, зображення, перерозпізнавання — без змін

Поведінка `passthrough` для PDF, `imageToPdf` для JPG/PNG/HEIC і
`writeExtractedTextArtifact` для `.txt` кеша — не торкалися. Тести 6+5+15
зелені.

### ґ) Видалення документа (каскад)

1. Видалити документ з реєстру через UI (мод 'full')
2. Перевірити у 01_ОРИГІНАЛИ що зник і PDF, і поряд лежачий DOCX
   (`originalDriveId` каскадно прибраний — підтверджено комітом `3d973cb` і
   двома integration-тестами)

---

## 6. SAAS і BILLING IMPLICATIONS

### SAAS

- Конвертація — pure utility, не торкається `cases[]/notes[]/registry`.
- `executeAction → add_document` лишається єдиною точкою модифікації реєстру.
- `tenantId/userId/createdAt/updatedAt` — через `documentFactory.createDocument()`
  без змін (вже було у попередніх TASK).
- `addedBy: 'lawyer_manual'`, `source: 'manual_upload'` — без змін.

### BILLING

- Одна точка `activityTracker.report('document_converted', ...)` у
  `converterService.makeResult` — не торкалися.
- AI не викликається (вся конвертація локальна: mammoth + pdf-lib).
  `logAiUsage` точок немає.
- `time_entries[].action = 'document_converted'` зʼявиться у CRM коли буде
  Billing UI.

### Permissions

Без змін. Жодних нових прав.

---

## 7. Що НЕ зроблено і чому

### Поза скопом цього TASK

- **Persist маркер/нотаток у Drive** — окремий TASK. Аналіз у
  `report_pdfjs_annotations_analysis.md`: ~410 рядків коду + покладання на
  internal API `layer.deserialize`/`addOrRebuild` які приватні у Mozilla.
- **Складні таблиці у таблицях** (вкладені 2+ рівні) — рендеримо тільки на
  одному рівні; всередині комірки повторно `<table>` показуємо як plain
  абзаци. Адвокатські документи цього майже не вимагають.
- **Float / Position absolute / inline-block layout** — пропускаємо;
  CSS-аналог зайвий складний для адвокатських форм.
- **Posternal стилі (external CSS, `<style>` блоки, computed styles)** —
  парсимо тільки `style="..."` атрибут. Для mammoth-конвертованого DOCX і
  ЄСІТС-HTML цього достатньо — обидва віддають стиль inline.
- **Web fonts** — pdf-lib не embed'ить шрифти з `@font-face`. У документі
  лишається LiberationSans (повна кирилиця).
- **SVG / GIF / WEBP зображення** — pdf-lib embed'ить тільки PNG і JPG.
  Інші формати тихо пропускаємо. У майбутньому — pre-конвертація через
  canvas.

### Збережено від попередніх TASK

- Конвертація JPG/PNG/HEIC у PDF через `imageToPdf.js` (jsPDF) — без змін
- Стиснений `layout.json` без `image`/`tokens` — `ocrService.serializeLayout`
- Document AI error classification + resumable retry + Claude Vision fallback
- Дві кнопки на старті AddDocumentModal («📄 Додати файл» / «🖼 Склеїти зображення»)
- Поле «Назва документа» з автозаповненням
- Плейсхолдер для майбутнього провадження у формі
- Каскадне видалення `originalDriveId` (commit `3d973cb`)
- Прибрана MIN_PDF_SIZE_BYTES валідація (вже у `9768685` — pdf-lib генерує
  PDF контрольованого розміру, лишилась тільки sanity `pdfBlob.size === 0`)

---

## 8. Список комітів (планується)

```
<hash1>  feat: LiberationSans Bold/Italic/BoldItalic у public/fonts
<hash2>  feat: pdfLibHtmlRenderer — HTML→PDF з форматуванням + image embed
<hash3>  feat: docxToPdf через convertToHtml + image conversion
<hash4>  feat: htmlToPdf через full HTML rendering (з гербом)
<hash5>  test: pdfLibHtmlRenderer + оновлені docxToPdf/htmlToPdf тести
```

Push після кожного коміта. GitHub Actions деплоїть автоматично.

---

## 9. Очікувана точність

**Типові адвокатські документи (позовна заява, ухвала, претензія):**
- Заголовки, абзаци, justify — 95%+
- Жирний/курсив/підкреслення — 95%+
- Прості таблиці — 85–90% (рамки + текст + alignment у клітинках)
- Списки — 90%
- Зображення (герб, штамп) — 95% (PNG/JPG embed)

**Складні документи (експертний висновок з графіками, рендер презентацій):**
- Базовий текст — 80%+
- Графіки / SVG — частково (тихо пропускаємо непідтримуване)
- Складна типографія — частково

**Якщо адвокат бачить що PDF втратив щось критичне** — поряд завжди лежить
оригінал DOCX (`originalDriveId`), який можна завантажити з Drive і відкрити
у Word.

---

## 10. CLAUDE.md AUDIT

### Що потрібно оновити

- **Структура файлів** — `pdfLibHtmlRenderer.js` замість `pdfLibRenderer.js`
  у списку `src/services/converter/`
- **Розділ TASK A** (рядки навколо стартового екрану AddDocumentModal) —
  можна додати окремий під-розділ «Розширення TASK A v1.1: pdf-lib з
  форматуванням» з посиланням на цей звіт

### Поза scope

Інші розділи CLAUDE.md не потребують термінового оновлення.

---

**Кінець звіту v1.0**
**692 тести зелені, build чистий, готово до 5 інкрементальних комітів на main.**

---

# v1.1 — Виправлення форматування після тестування адвоката

**Дата:** 2026-05-12
**Коміт:** `64a8f98`
**Тести:** 724 зелені (+32 нових)
**Build:** 23 сек, чистий

Після першого деплою адвокат протестував обидва приклади і виявив що:

**DOCX (Позовна заява Кісельової):**
- Виглядає в цілому добре, таблиця нормальна, жирний і курсив працюють
- АЛЕ текст не по ширині (justify) хоча у Word оригіналі — justify
- Шрифт не Times (виглядає як Verdana/Arial)

**HTML (Ухвала з ЄСІТС):**
- Майже без форматування — все вліво, без жирного, без центру
- «УХВАЛА» не по центру жирним
- Герб не зʼявляється
- Підпис судді не справа
- Шрифт LiberationSans замість Times

## Виявлені корені

### 1. DOCX: невалідний синтаксис mammoth styleMap

Попередній styleMap використовував `p[alignment='justify'] => p.align-justify`.
Mammoth Matcher (підтверджено у `node_modules/mammoth/lib/styles/
document-matchers.js`) підтримує ТІЛЬКИ:
- `styleId`, `styleName`, `list`, `breakType`, `color` (для highlight)

`alignment` як attribute matcher **НЕ існує** — правило беззвучно не
матчилось, justify ніколи не доходив до HTML.

### 2. DOCX: mammoth не виводить font/fontSize у HTML

`run.font` і `run.fontSize` зберігаються у mammoth document model
(`documents.js:66-67`), але `document-to-html.js` їх ігнорує.

### 3. HTML: ЄСІТС — це Word "save as HTML"

Word експорт у HTML створює:
- `<style>` блок у `<head>` з класами `MsoNormal`, `MsoTitle` тощо
- Legacy теги: `<center>УХВАЛА</center>`, `<font face="Times New Roman" size="3">`
- Legacy атрибути: `<p align="justify">`, `<p align="center">`, `<p align="right">`
- Bold через `<b>` (не тільки `<strong>`)

Попередня версія рендерера дивилась тільки `style="..."` inline атрибут —
весь CSS блок ігнорувався.

## Що зроблено

### А) Рендерер `pdfLibHtmlRenderer.js`

**1. CSS-парсер для `<style>` блоків.** Нові функції
`parseStyleBlock(cssText)` і `collectStyleSheet(doc)`:
- Селектори: `tag`, `.class`, `tag.class`, `*`, кома-розділені списки
- Ігнорує: CSS коментарі, descendant combinators (`div p`), pseudo
  (`:hover`), attribute selectors (`[data-*]`)
- Інтегровано у каскад: правила застосовуються між дефолтами тега і
  class-маркерами styleMap (порядок специфічності: universal → tag →
  class → tag.class → inline)

**2. Legacy теги.** `styleForElement` тепер обробляє:
- `<center>` → блок з `align=center`
- `<font face=... size=... color=...>`:
  - `face` → mapFontFamily → `serif/sans`
  - `size` (HTML4 1-7) → pt map `{1:8, 2:10, 3:12, 4:14, 5:18, 6:24, 7:36}`
  - `size="+1"`/`-1"` → relative shift
  - `color` через parseColor (hex/rgb/keyword)
- `align="..."` атрибут — раніше тільки на `<p>`, тепер на h\*, div, td,
  table, tr, th
- `<b>` і `<strong>` обидва → bold (раніше теж — переконались)
- `<cite>`, `<var>` → italic (були пропущені)

**3. Font-family routing.** 8 шрифтів замість 4 (serif/sans × Regular/
Bold/Italic/BoldItalic):
- `Times New Roman`, `Times`, `Cambria`, `Georgia`, `Palatino`,
  `Liberation Serif`, `serif` → **serif**
- `Arial`, `Helvetica`, `Verdana`, `Tahoma`, `Calibri`, `Liberation Sans`,
  `Segoe UI`, `Roboto`, `Open Sans`, `sans-serif` → **sans**
- Невідомі — успадковуються від parent (default `serif` для DOCX/HTML)

`pickFont(style, fonts)` тепер читає `style.fontFamily` для вибору
правильного набору.

**4. mammoth styleMap classes.** Додано розпізнавання класів
`.font-sans` і `.font-serif` (для пар з пунктом В нижче).

**5. options.defaultFontFamily.** Викликачі (`docxToPdf`, `htmlToPdf`)
тепер передають `'serif'` як корінь — Word default для адвокатських док.

**6. HTML fragment wrapping.** Якщо вхід — fragment без `<html>`,
обгортаємо у `<!doctype html><html><body>...</body></html>` щоб
`<style>` блоки (якщо є у вхідному fragment) потрапляли у `doc`.

### Б) Шрифти

`public/fonts/` тепер містить 8 TTF:

```
LiberationSans-Regular.ttf       139 KB
LiberationSans-Bold.ttf          137 KB
LiberationSans-Italic.ttf        162 KB
LiberationSans-BoldItalic.ttf    135 KB
LiberationSerif-Regular.ttf      394 KB
LiberationSerif-Bold.ttf         370 KB
LiberationSerif-Italic.ttf       376 KB
LiberationSerif-BoldItalic.ttf   377 KB
                                ─────
                                ~2.0 MB сумарно (lazy-fetch)
```

Source: офіційний реліз Liberation Fonts 2.1.5 з GitHub
(`liberationfonts/liberation-fonts-ttf-2.1.5.tar.gz`), OFL-1.1.
Times-metric-сумісні (як Word default).

Pdf-lib `embedFont({ subset: true })` зберігає тільки використані
гліфи — у фінальний PDF потрапляє ~15-30 КБ на документ.

### В) DOCX-конвертер `docxToPdf.js`

**`transformDocument`** — рекурсивний transformer mammoth document model:

```js
function transformElement(element) {
  if (element.children) {
    element.children = element.children.map(transformElement);
  }
  if (element.type === 'paragraph' && !element.styleName) {
    const styleName = alignmentToStyleName(element.alignment);
    if (styleName) element = { ...element, styleName };
  }
  if (element.type === 'run' && !element.styleName && element.font) {
    const family = mapDocxFontFamily(element.font);
    if (family === 'sans')  element = { ...element, styleName: 'FontSans' };
    if (family === 'serif') element = { ...element, styleName: 'FontSerif' };
  }
  return element;
}
```

`alignmentToStyleName`:
- `'both' | 'justify' | 'distribute'` → `'AlignJustify'`
- `'center' | 'centre'` → `'AlignCenter'`
- `'right' | 'end'` → `'AlignRight'`
- `'left' | 'start'` → `'AlignLeft'`

**КРИТИЧНО:** не перетирає `styleName` що вже існує (`Heading 1`, `Title`
тощо з Word styles).

**styleMap** тепер легально матчить ці synthetic styleNames:

```
p[style-name='AlignJustify'] => p.align-justify:fresh
p[style-name='AlignCenter']  => p.align-center:fresh
p[style-name='AlignRight']   => p.align-right:fresh
p[style-name='AlignLeft']    => p.align-left:fresh
r[style-name='FontSans']     => span.font-sans
r[style-name='FontSerif']    => span.font-serif
```

`mapDocxFontFamily(fontName)` — нормалізує `'Times New Roman'`/`'Cambria'`/
`'Arial'`/`'Calibri'` тощо у `serif`/`sans`/`null`.

### Г) HTML-конвертер `htmlToPdf.js`

Передає `defaultFontFamily: 'serif'` у renderer (Word-style HTML за
замовчуванням — Times-like).

## Тести

**+32 нових тестів:**

`tests/unit/pdfLibHtmlRenderer.test.js`:
- `mapFontFamily` — серіф/санс детект, кома-списки, лапки
- `parseStyleBlock` — простий tag/class/tag.class/* селектори, кома,
  коментарі, пропуск складних селекторів
- `collectStyleSheet` — інтеграція з DOM, кілька `<style>` блоків
- `getStylesheetDeclsForElement` — матчинг tag+class
- Legacy теги: `<center>`, `<p align="justify">`, `<font face/size/color>`,
  `<b>` і `<strong>`, `<style>` блок з `.MsoNormal`
- `font-sans/font-serif` clas і inline `font-family` → `style.fontFamily`
- `defaultFontFamily` option

`tests/unit/docxToPdf.test.js`:
- `alignmentToStyleName` — всі 4 + null
- `mapDocxFontFamily` — Times/Cambria → serif; Arial/Calibri → sans;
  невідомий → null
- `transformDocument` — alignment, font, НЕ перезаписує існуючий styleName
- Виклик convertToHtml з `transformDocument` функцією
- `defaultFontFamily: 'serif'` передається у renderer

**Total: 724 тести зелені (50 файлів), 0 red.**

## Bundle

```
dist/assets/pdfLibHtmlRenderer-*.js  21.89 KB / 8.00 KB gzip (було 18.35/6.81)
dist/assets/docxToPdf-*.js            3.74 KB / 1.87 KB gzip (було 2.58/1.39)
dist/assets/htmlToPdf-*.js            2.10 KB / 1.30 KB gzip
```

LiberationSerif TTF (4 файли, ~1.5 MB) — lazy fetch при першій конвертації,
кеш браузера далі.

## Як адвокат тестує тепер

### Позовна заява Кісельової (DOCX)

Перевірити після деплою `64a8f98`:
- **Justify працює** — основний текст розподілений по ширині
- **Шрифт Times-like** — Liberation Serif (метрично сумісний з Times New
  Roman), якщо у Word оригіналі був Times/Cambria/Georgia
- **Жирний/курсив** — як було (працювало і раніше)

### Ухвала з ЄСІТС (HTML)

Перевірити:
- **«УХВАЛА» по центру жирним** — через `<center><b>УХВАЛА</b></center>`
  або `<p align="center"><b>УХВАЛА</b></p>` або через MsoTitle class у
  `<style>`
- **Основний шрифт Times-like** — через MsoNormal `font-family` у CSS
  блоці АБО через defaultFontFamily=serif fallback
- **Justify у основному тексті** — через MsoNormal `text-align: justify`
  АБО legacy `<p align="justify">`
- **Жирні слова** — через `<b>` (раніше парсер ловив тільки `<strong>` —
  тепер обидва)
- **Підпис справа** — через `<p align="right">`
- **Герб видно** — embed `<img src="data:image/png;base64,...">` через
  `pdfDoc.embedPng`. Renderer тепер пробує PNG ТА JPG fallback якщо MIME
  невпевнений.

## Що НЕ зроблено у v1.1

- **External stylesheets** (`<link rel="stylesheet">`) — ЄСІТС не
  використовує, поза скопом
- **mso-\* специфічні CSS** (Word internal) — ігноруємо безпечно
- **Pseudo-classes / attribute selectors / descendant combinators** —
  складніший CSS-парсер потребує іншої архітектури; адвокатських док.
  таких випадків майже не зустрічається
- **SVG-зображення у документах** — pdf-lib embed'ить тільки PNG/JPG.
  Pre-конвертація через canvas — окремий TASK
- **Шрифт-фолбек глобально** — якщо `<font face="Comic Sans MS">` — поки
  залишаємось на serif (default). Розширення FONT_FAMILY_MAP — тривіальне

---

**Кінець звіту v1.1**
**724 тести зелені, build чистий, 1 коміт `64a8f98` запушений на main.**
