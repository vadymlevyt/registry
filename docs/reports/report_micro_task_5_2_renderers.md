# Звіт — Мікро-TASK 5.2 Native renderers for PDF/DOCX/HTML

**Дата:** 2026-05-10
**Статус:** ✅ виконано
**Тести:** 468/468 ✓
**Build:** чистий ✓

---

## 1. Що зроблено

Замінено Drive `iframe /preview` (який блокує текстовий шар) на власні React-рендерери для трьох ключових форматів — PDF (searchable), DOCX і HTML — щоб адвокат міг нативно виділяти, копіювати і в майбутньому ставити маркер/нотатки. Drive iframe лишається тільки для scanned-PDF (де виділяти нічого) і як fallback для типів поза скопом TASK (XLSX, PPTX, RTF, TXT, MD, CSV).

## 2. Які залежності додано

**Жодних нових npm-залежностей не додано.** Архітектурне рішення — використати вже встановлений `pdfjs-dist@5.6.205` (worker сконфігуровано в `App.jsx`) і `mammoth@1.12.0` (вже стояв з попереднього TASK). Це уникає колізії версій pdfjs (між top-level 5.6.x і react-pdf nested 5.4.x) і не роздуває bundle на ~+200 KB.

> Примітка: на старті помилково встановили `react-pdf@10.4.1` (Варіант 1). Зразу видалили через `npm uninstall react-pdf` — Варіант 2 (власний wrapper) виявився кращим.

## 3. Файли

| Файл | Тип | Призначення |
|------|-----|-------------|
| `src/components/DocumentViewer/useDriveFileBuffer.js` | новий | Спільний хук — `driveRequest` + `arrayBuffer()` + `retry()` |
| `src/components/DocumentViewer/PdfRenderer.jsx` | новий | pdfjs-dist wrapper: canvas + textLayer per-сторінка, IntersectionObserver lazy, ResizeObserver fit-to-width |
| `src/components/DocumentViewer/DocxRenderer.jsx` | новий | mammoth.convertToHtml → `dangerouslySetInnerHTML` у `.docx-content` |
| `src/components/DocumentViewer/HtmlRenderer.jsx` | новий | charset detection → TextDecoder → iframe srcdoc + ЄСІТС META-table fallback |
| `src/utils/htmlCharsetDetection.js` | новий | `detectCharset`, `decodeHtmlBuffer`, `extractEcitsMetaPairs` |
| `src/components/DocumentViewer/DocumentViewer.css` | змінено | стилі `.pdf-pages`, `.pdf-page`, `.docx-content`, `.html-iframe`, `.html-ecits` |
| `src/components/DocumentViewer/DocumentViewerContent.jsx` | змінено | логіка вибору рендеру у `ScanContent` |
| `tests/unit/htmlCharsetDetection.test.js` | новий | 16 тестів детекції charset і ЄСІТС meta-pairs |
| `tests/unit/DocumentViewer.test.jsx` | змінено | searchable-PDF тест очікує власний рендерер замість iframe |
| `tests/integration/documentViewer-workflow.test.jsx` | змінено | DOCX тест очікує власний рендерер; новий тест для XLSX fallback |

## 4. Логіка вибору рендеру

```
┌─ DocumentViewerContent ────────────────────────────────────────────┐
│  mode='text' ?                                                      │
│    └─ TextContent (OCR-плашка) — без змін                          │
│  mode='scan' :                                                      │
│    ├─ no driveId  → "Файл не прикріплено"                          │
│    ├─ image/*     → <img src=Drive>                                │
│    ├─ documentNature === 'scanned' → Drive iframe (як було)        │
│    ├─ PDF (searchable, mime/ext)   → PdfRenderer                   │
│    ├─ DOCX (mime/ext)              → DocxRenderer                  │
│    ├─ HTML/XHTML (mime/ext)        → HtmlRenderer                  │
│    └─ ЯКЩО НІЧОГО З ВИЩЕ            → Drive iframe (fallback для   │
│                                       XLSX, PPTX, RTF, TXT, MD,     │
│                                       CSV, ODT, …)                  │
└────────────────────────────────────────────────────────────────────┘
```

`isInlineRenderable` у `index.jsx` лишається без змін — він вирішує **чи показувати перемикач Скан/Текст** (для inline-renderable не показуємо, бо текст вже є). Власний рендерер обирається в `DocumentViewerContent`.

## 5. Як працює детекція charset для HTML

`detectCharset(arrayBuffer, contentType)` у `src/utils/htmlCharsetDetection.js`:

```
1. BOM (high confidence):
   EF BB BF       → utf-8
   FE FF          → utf-16be
   FF FE          → utf-16le

2. HTTP Content-Type header (medium):
   "text/html; charset=windows-1251" → windows-1251
   (нормалізація: cp1251 → windows-1251, utf8 → utf-8)

3. Перші 4 KB як latin1 → парсимо <meta> теги по одному (medium):
   а) <meta charset="utf-8">                  → meta-charset
   б) <meta http-equiv="Content-Type"
            content="text/html; charset=…">   → meta-http-equiv
   Проходження по meta окремо запобігає сплутуванню форм
   (charset всередині content="" не сприймається як прямий атрибут).

4. Fallback: utf-8 (low)
```

**Приклад UTF-8:**
- Buffer: `EF BB BF D0 9F D1 80 D0 B8 D0 B2 D1 96 D1 82` ("Привіт" з BOM)
- detectCharset → `{charset: 'utf-8', confidence: 'high', source: 'bom'}`
- TextDecoder('utf-8').decode() → "Привіт"

**Приклад Windows-1251 (стара ухвала ЄСІТС):**
- Content-Type від Drive: `text/html; charset=windows-1251`
- Buffer (без BOM): `CF F0 E8 E2 B3 F2` ("Привіт" у CP-1251)
- detectCharset → `{charset: 'windows-1251', confidence: 'medium', source: 'http-header'}`
- TextDecoder('windows-1251').decode() → "Привіт"

**Приклад ЄСІТС META-only HTML:**
- `<meta name="judges" content="Іванов І.І.">`, `<meta name="case_no" content="757/123/24">`, body порожній
- Якщо `<body>` < 50 символів І `extractEcitsMetaPairs` знаходить ≥1 пару → показуємо таблицю ключ-значення замість iframe
- Інакше → стандартний iframe srcdoc з sandbox=allow-same-origin (без allow-scripts)

## 6. Інструкція адвокату для тестування

Після `git pull && npm install` (або просто новий чат на GitHub Pages деплоях), відкрити Viewer для шести сценаріїв:

| # | Файл | Очікувана поведінка |
|---|------|----------------------|
| а | **PDF searchable (Рішення суду)** | Сторінки рендеряться послідовно (lazy при скролі), виділення тексту тягне рамку, тап-і-тримай показує меню «Копіювати» (mobile). Перемикача Скан/Текст немає. |
| б | **DOCX (Позовна заява)** | Документ показано з форматуванням Word (заголовки, списки, таблиці). Виділення нативне з html. Перемикача немає. |
| в | **HTML з електронного суду в Windows-1251 (стара ухвала)** | Текст читабельний кирилицею (НЕ кракозябри). Рендериться у sandbox-iframe. Якщо це META-only формат ЄСІТС — показано таблицю ключ-значення з полями judges/sides/addresses. |
| г | **HTML звичайний UTF-8** | Рендериться у sandbox-iframe, форматування збережено, виділення працює. |
| д | **Scanned PDF (Адвокатський запит)** | БЕЗ ЗМІН — перемикач Скан/Текст. Скан = Drive iframe. Текст = OCR-плашка. |
| е | **JPG (РНОКПП)** | БЕЗ ЗМІН — перемикач. Скан = `<img>`. Текст = OCR-плашка. |

**Якщо щось не так:**
- PdfRenderer показує "Не вдалось рендерити PDF" з кнопкою "Спробувати знову" — ймовірно файл пошкоджено або токен Drive протух.
- DocxRenderer "Не вдалось рендерити DOCX" — файл може бути .doc (старий формат), mammoth такий не парсить. Поза скопом TASK.
- HtmlRenderer "Не вдалось декодувати документ" — рідкісний випадок; натиснути "Спробувати знову".

## 7. Edge cases НЕ покриті (і чому)

- **DOC (старий Word 97-2003)** — mammoth парсить тільки DOCX OOXML. На .doc empty state. Власний рендерер для .doc — поза скопом, можна вирішити окремим TASK через серверну конвертацію.
- **XLSX, PPTX, RTF, ODT** — Drive iframe як fallback. Власні рендерери — окремий TASK 5.2b якщо потрібно (sheetjs/pptx2html).
- **PDF з пошкодженою структурою** — pdfjs кидає помилку, показується empty state. .txt не використовується як fallback (свідоме архітектурне рішення).
- **PDF з paid-only шрифтом** — текстовий шар може зрендеритись як прямокутники. Це bug pdfjs, не нашого коду.
- **HTML з BOM + content-type charset різні** — пріоритет BOM (high), бо BOM в файлі надійніший за зовнішній заголовок.
- **HTML з ISO-8859-2 / KOI8-U** — детектиться але TextDecoder в усіх сучасних браузерах підтримує. Edge case з 90-х років — поза реальним використанням.
- **Авто-визначення кодування за частотами байт** (chardet-style) — НЕ реалізовано. Якщо файл прийшов без BOM/header/meta — fallback utf-8. Для українських старих файлів без явних маркерів адвокат побачить кракозябри. Поза скопом мікро-TASK.

## 8. Що НЕ зроблено і чому

- ❌ **layout.json збереження** — мікро-TASK 5.3 (наступний).
- ❌ **Копіювання оригіналів у 02_ОБРОБЛЕНІ** — мікро-TASK 5.4.
- ❌ **HTML overlay для сканованих** — мікро-TASK 5.5.
- ❌ **Маркер/нотатки** — мікро-TASK 5.6.
- ❌ **Власний рендер для XLSX/PPTX/RTF/TXT/MD/CSV** — поза скопом TASK 5.2; Drive iframe як fallback задовольняє.
- ❌ **Полная заміна Footer/Header** — TASK явно сказав «не переписувати повністю», лишено as-is.
- ❌ **Pipeline AddDocumentModal, класифікація `documentNature`, OCR-pipeline** — НЕ ЧІПАЛИ (строге виконання правил TASK).
- ❌ **Drive .txt як fallback для рендеру** — навмисно НЕ використовується. `.txt` у `02_ОБРОБЛЕНІ` лишається тільки для агента і пошуку. При помилці рендеру — empty state з кнопкою "Спробувати знову", без silent fallback.

## Acceptance criteria

- ✅ PDF searchable рендериться через pdfjs-dist з виділенням тексту
- ✅ DOCX рендериться через mammoth → HTML
- ✅ HTML декодується з підтримкою UTF-8 і Windows-1251 (BOM + Content-Type + meta-tag + fallback)
- ✅ Особливий випадок ЄСІТС META-only HTML — таблиця ключ-значення
- ✅ Scanned PDF / JPG — без змін
- ✅ Drive iframe як fallback для типів поза скопом
- ✅ Помилка рендеру → empty state з кнопкою retry, БЕЗ .txt fallback
- ✅ 468/468 тестів зелені (включно з 16 новими для charset detection)
- ✅ Vite build чистий
- ✅ Жоден існуючий функціонал не зламано
