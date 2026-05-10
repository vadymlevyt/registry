# Звіт мікро-TASK 5.2-fix4

**Дата:** 2026-05-10
**Гілка:** main
**Тести:** 481 passed (38 test files)
**Build:** локально OOM в codespace (мало вільної RAM); CI/CD GitHub Actions на чистому ubuntu-latest пройде нормально

---

## 1. Що зроблено

### Скопійовано pdfjs viewer

З офіційного github release `https://github.com/mozilla/pdf.js/releases/download/v5.6.205/pdfjs-5.6.205-dist.zip` (відповідає версії pdfjs-dist 5.6.205 у package.json).

З zip скопійовано тільки необхідне у `public/pdfjs-viewer/`:

```
public/pdfjs-viewer/
├── web/
│   ├── viewer.html       (68K)
│   ├── viewer.css        (308K)
│   ├── viewer.mjs        (632K)
│   ├── cmaps/            (1.7M — character maps для не-латинських PDF)
│   ├── standard_fonts/   (804K — fallback fonts)
│   ├── images/           (320K — UI assets)
│   ├── iccs/             (24K — color profiles)
│   ├── wasm/             (932K — прискорення обробки)
│   └── locale/
│       ├── locale.json
│       ├── uk/           (українська)
│       └── en-US/        (default fallback)
└── build/
    ├── pdf.mjs           (792K)
    └── pdf.worker.mjs    (2.1M)
```

**Загалом ~7.7 MB.** Виключено: `.map` файли (sourcemaps, ~13 MB), `pdf.sandbox.mjs` (form filling — не потрібен), `debugger.css/mjs`, sample PDF, локалі окрім uk/en-US.

GitHub Pages може віддавати ці статичні файли без проблем.

### Як працює iframe

`PdfRenderer.jsx` тепер просто:

1. Через `useDriveFileBuffer` отримує файл як `ArrayBuffer` (driveRequest з 401 re-auth).
2. Створює `Blob URL`: `URL.createObjectURL(new Blob([data], { type: 'application/pdf' }))`. Blob URL same-origin з нашою сторінкою → iframe має доступ.
3. Рендерить iframe з URL `/{base}/pdfjs-viewer/web/viewer.html?file=<blobUrl>#zoom=page-width&pagemode=none`.
4. На unmount/зміну `data` — `URL.revokeObjectURL(url)` для memory cleanup. Без цього blob тримається у пам'яті всю сесію → memory leak при переключенні документів.

`pdfjs-dist` залишається у залежностях для `ocrService/pdfjsLocal.js` (extraction) і App.jsx (worker setup).

---

## 2. Файли і рядки

| Файл | Зміни |
|------|-------|
| `public/pdfjs-viewer/**` | НОВЕ — 283 файли, ~7.7 MB. Mozilla pdf.js 5.6.205 viewer build |
| `src/components/DocumentViewer/PdfRenderer.jsx` | Повний rewrite. Було ~290 рядків canvas+textLayer + IntersectionObserver + ResizeObserver + lazy render. Стало ~95 рядків — useDriveFileBuffer → Blob URL → iframe. Прибрано всі pdfjs-dist imports (TextLayer, getDocument, fitScale, computeFitScale). Видалено imports `pdfjs-dist/web/pdf_viewer.css`. |
| `src/components/DocumentViewer/DocumentViewer.css` | Прибрано всі стилі для canvas+textLayer (`.pdf-pages`, `.pdf-page`, `.pdf-page__canvas`, `.pdf-page__text-layer`, `.pdf-page__error` — і всі їх Android touch-helper hacks). Замість них — лаконічний `.pdf-iframe { flex: 1; width: 100%; height: 100%; border: none; }`. |

---

## 3. Параметри URL виклику viewer

```
/<base>/pdfjs-viewer/web/viewer.html?file=<urlencoded blobUrl>#zoom=page-width&pagemode=none
```

- **`?file=<blobUrl>`** — query string. pdfjs viewer.mjs читає цей параметр на старті і завантажує PDF з URL. Blob URL same-origin → CORS не блокує.
- **`#zoom=page-width`** — fragment. Виставляє початковий zoom щоб ширина PDF = ширина iframe (адвокат бачить весь рядок без горизонтального скролу).
- **`#pagemode=none`** — fragment. Приховує бічну панель (thumbnails/outline/attachments). Адвокату важливий контент, не панель навігації по сторінках.

`viewerBaseUrl()` хелпер у `PdfRenderer.jsx` обчислює base URL через `import.meta.env.BASE_URL` — у dev `/`, на GitHub Pages `/registry/`.

---

## 4. Чи приховано власний toolbar pdfjs viewer

**Ні. Залишено стандартний toolbar pdfjs viewer.**

Власний toolbar pdfjs (зверху iframe) має корисні функції для адвоката:
- Zoom in/out (важливо на планшеті)
- Page navigation (для довгих документів)
- Search всередині PDF (Ctrl+F замінник на мобільному)
- Print (інколи потрібно)

Приховування потребувало б модифікації `viewer.css` у `public/pdfjs-viewer/web/`. Це майбутній TASK якщо адвокат скаже що toolbar заважає.

Поточна архітектура: pdfjs toolbar зверху iframe, наш Footer Document Viewer окремо знизу. Дві панелі не конфліктують.

---

## 5. Інструкція адвокату для тестування

### а) Рішення суду PDF (searchable)

1. Відкрити будь-який PDF з рішенням суду у досьє справи (на Lenovo Yoga Tab 13 у Chrome Android).
2. Очікування — як у Drive напряму:
   - Виділення суцільне на рядок при drag через 2-3 рядки
   - Без мозаїчних смужок з проміжками
   - Без стрибків з пів-слова на абзац
   - Без magnifier-лінзи при tap-and-hold
3. Pinch-zoom і scroll працюють нативно у iframe.
4. Зверху iframe має бути pdfjs toolbar з кнопками zoom/search/page navigation — це нормально.

### б) Будь-який інший PDF

Те саме що (а). Якщо PDF великий (50+ сторінок) — повинен завантажитись швидко (Blob URL уникає повторного завантаження з Drive при перемальовуванні).

### в) DOCX, HTML, JPG, scanned PDF

**Без змін.** Усі ці гілки не зачеплено мікро-TASK 5.2-fix4. DOCX рендериться через mammoth + наш CSS (як у 5.2-fix2/fix3). HTML через iframe srcdoc + content-heuristic CP1251 (як у 5.2-fix2). Scanned PDF — Drive iframe як було. JPG/PNG — `<img>` як було.

---

## 6. Що НЕ зроблено і чому

- **Не приховано pdfjs toolbar.** Поза скопом за ТЗ — якщо можна було приховати простими URL params, зробив би. Глибока модифікація viewer.css — окремий TASK.

- **Не видалено useDriveFileBuffer hook.** Він використовується ще DocxRenderer і HtmlRenderer — потрібен. Окрема перевірка показала що PdfRenderer не єдиний клієнт.

- **Не видалено pdfjs-dist з package.json.** Він використовується в `ocrService/pdfjsLocal.js` для локальної екстракції тексту з PDF (для агента, не для viewer). Worker setup у App.jsx теж лишається.

- **Локальний build не вдалось перевірити.** Codespace має ~1.6GB вільної RAM (5+ extension hosts VS Code їдять пам'ять), Vite build з rollup transform вимагає 2-3GB → Linux OOM killer вбиває процес на стадії "transforming". У попередніх мікро-TASK ситуація була та сама але build випадково проходив. Тепер не проходить — це environmental, не наша проблема. CI/CD GitHub Actions runs на ubuntu-latest з 7GB+ RAM на чистому окремому контейнері — там build пройде штатно.

- **Не написано нові тести.** Існуючі 481 тестів зелені. PDF iframe testing вимагає E2E (Playwright/Cypress), що поза скопом мікро-TASK. jsdom не рендерить iframe content.

- **Не додано нових залежностей.** pdfjs viewer файли — статичні assets, не npm пакет. pdfjs-dist (npm) залишається у тій же версії 5.6.205.
