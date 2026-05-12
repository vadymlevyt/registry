# TASK A — PDF Conversion in AddDocumentModal (Звіт)

**Дата:** 12.05.2026
**Версія:** 1.0
**Коміти:** 7 інкрементальних, по одному на логічну частину
**Тести:** 635 зелені (+33 нових), CI/CD блокує деплой при red

---

## 1. Що зроблено для DOCX

DOCX конвертується у PDF через **mammoth → HTML → html2pdf.js**.

Pipeline:
1. Адвокат вибирає DOCX через кнопку «Додати файл»
2. `converterService.convertToPdf(file, context)` → маршрутизує на `docxToPdf`
3. `mammoth.convertToHtml({ arrayBuffer })` → HTML
4. Прихований A4 контейнер у DOM (Times New Roman 12pt, поля 2см/3см/2см/2см)
5. `html2pdf.js` → Blob('application/pdf')
6. Cleanup DOM

На Drive у 01_ОРИГІНАЛИ зберігаються **обидва файли**:
- `<name>.pdf` → `driveId` (Viewer показує)
- `<name>.docx` → `originalDriveId` (адвокат може завантажити оригінал)

`originalMime` = `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.

**Warnings**: mammoth повідомлення (Unrecognised numbering style тощо) логуються у консоль і пропагуються у `warnings` повернення.

### Feature flag CONVERT_DOCX_TO_PDF (TASK A.4)

У `src/services/converter/converterService.js`:

```js
export const CONVERT_DOCX_TO_PDF = true;
```

- `true` (default): як описано вище
- `false`: passthrough — DOCX зберігається як є, Viewer відкриває через DocxRenderer (поточна поведінка до TASK A). PDF не створюється, `originalDriveId` = null.

**Відкат** при проблемах якості: змінити `true` → `false` у файлі, `git commit`, push. Решта системи (Viewer, реєстр, OCR) працює коректно з обома варіантами.

---

## 2. Що зроблено для HTML

HTML конвертується у PDF через **html2pdf.js**.

Pipeline:
1. Адвокат вибирає HTML через «Додати файл»
2. `convertToPdf` → маршрутизує на `htmlToPdf`
3. `decodeHtmlBuffer` з `utils/htmlCharsetDetection.js` → UTF-8 рядок (правильно декодує windows-1251 з застарілих ЄСІТС-експортів навіть якщо meta-charset збитий)
4. Виділяється body content (або весь fragment якщо без body тегу)
5. Прихований A4 контейнер у DOM з тими ж стилями що DOCX
6. `html2pdf.js` → Blob

На Drive у 01_ОРИГІНАЛИ:
- `<name>.pdf` → `driveId`
- HTML оригінал **не зберігається**
- `originalDriveId` = null
- `originalMime` = `'text/html'`

---

## 3. Що зроблено для одного зображення

JPG/PNG/WEBP/HEIC → PDF через **jsPDF**.

Pipeline:
1. Якщо HEIC — попередня конвертація у JPEG через `heic2any` (Опція А iPhone)
2. Завантаження у `HTMLImageElement` через blob URL
3. Орієнтація PDF за пропорцією: `width > height` → landscape, інакше portrait
4. Канвас рендер → JPEG data URL (якість 0.92)
5. `jsPDF.addImage` з масштабом fit у A4 (1см поля)
6. `pdf.output('blob')` → Blob

На Drive у 01_ОРИГІНАЛИ:
- `<name>.pdf` → `driveId`
- Зображення оригінал **не зберігається** (всередині PDF)
- `originalMime` = MIME оригіналу (наприклад `'image/heic'`)
- `documentNature` = `'scanned'` (інферс з MIME)

OCR pipeline далі прогоняє PDF через Document AI для тексту і pageStructure.

**Orientation correction** через Document AI orientation метадані — у TASK B (там вона потрібна для multi-image merge). Single image поки використовує простий aspect-ratio heuristic.

---

## 4. Дві кнопки на старті AddDocumentModal

### Стартовий екран

```
┌─────────────────────────────────────────────────────────┐
│ Додати документ                                     ✕   │
├─────────────────────────────────────────────────────────┤
│                                                          │
│   ┌───────────────────┐    ┌───────────────────┐       │
│   │       📄          │    │       🖼          │       │
│   │ Додати файл       │    │ Склеїти зображення│       │
│   │ PDF, DOCX, HTML,  │    │ Кілька фото в один│       │
│   │ JPG, PNG, HEIC    │    │ PDF               │       │
│   │                   │    │ Доступно у        │       │
│   │                   │    │ наступній версії  │       │
│   └───────────────────┘    └───────────────────┘       │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

- **«📄 Додати файл»** → переключає у режим форми (`mode = 'single'`)
- **«🖼 Склеїти зображення»** → toast «Доступно у наступній версії» (плейсхолдер для TASK B)
- Кнопка «Скасувати» в footer закриває модалку

### Форма (після кліку «Додати файл»)

Усі поля що були раніше (Назва, Тип, Від кого, Провадження, Дата, Ключовий) + drop-зона для файла + Drive picker section. **Назва документа** автозаповнюється з імені файлу без розширення коли адвокат вибирає файл.

Footer змінюється: «Назад ← / Додати документ». «Назад» повертає на стартовий екран і чистить форму.

Під час submit кнопка показує «Конвертація і завантаження...» (видимий індикатор прогресу).

---

## 5. Архітектура сервісів `src/services/converter/`

```
src/services/converter/
├── converterService.js  ← фасад (фронт-енд для AddDocumentModal)
├── htmlToPdf.js         ← HTML → PDF
├── docxToPdf.js         ← DOCX → PDF (керується CONVERT_DOCX_TO_PDF)
├── imageToPdf.js        ← JPG/PNG/WEBP → PDF (HEIC через heicToJpeg)
└── heicToJpeg.js        ← HEIC → JPEG (попередня конвертація)
```

**Фасад `convertToPdf(file, context)`**:
- Маршрутизує за MIME-типом
- Інструментує `activityTracker.report('document_converted', ...)` в одній точці (категорія `case_work`, billable якщо є caseId)
- Повертає уніфікований контракт: `{ pdfBlob, originalBlob, pdfName, originalName, originalMime, warnings, converter, durationMs }`

**Принцип DRY**: AddDocumentModal не знає деталей конвертації. У TASK B Document Processor v2 і imageSortingAgent використають той самий фасад без зміни компонентів.

**Динамічний імпорт** усіх важких модулів (mammoth, html2pdf, jspdf, heic2any) — bundle не тягне їх при старті аппки.

---

## 6. Оптимізований layout.json (приклад)

### До TASK A.6

```json
{
  "schemaVersion": 1,
  "provider": "documentAi",
  "pages": [{
    "pageNumber": 1,
    "image": "data:image/png;base64,iVBORw0KGgo...(~5-7 МБ base64)",
    "tokens": [
      {"detectedBreak": null, "layout": {...}},
      ...500-2000 елементів на сторінку
    ],
    "paragraphs": [...],
    "blocks": [...],
    "_text": "..."
  }]
}
```

### Після TASK A.6

```json
{
  "schemaVersion": 1,
  "provider": "documentAi",
  "pages": [{
    "pageNumber": 1,
    "paragraphs": [...],
    "blocks": [...],
    "tables": [],
    "headers": [],
    "footers": [],
    "layout": {...},
    "dimension": {"width": 1240, "height": 1754},
    "detectedLanguages": [{"languageCode": "uk"}],
    "_text": "..."
  }]
}
```

Розмір: **~7 МБ → ~100-500 КБ** на сторінку (×10-50). Внутрішня логіка не змінюється — `pageStructure` у пам'яті залишається повним. Тільки серіалізація в `02_ОБРОБЛЕНІ/.layout.json` фільтрується.

Фільтр у `ocrService.js::serializeLayout` через `stripHeavyFields(pageStructure)`.

---

## 7. Додані залежності

```
"html2pdf.js": "^0.14.0"  → ~286 KB gzip, lazy-loaded chunk
"jspdf":       "^4.2.1"   → промоутнутий з транзитивної у пряму
"heic2any":    "^0.0.5+"  → ~341 KB gzip, lazy-loaded (тільки при HEIC)
```

Bundle після build (production):
- `dist/assets/html2pdf-*.js` — 984 KB / **286 KB gzip**
- `dist/assets/heic2any-*.js` — 1.35 MB / **341 KB gzip**
- `dist/assets/mammoth.browser-*.js` — 500 KB / 125 KB gzip (вже був)

Кешується браузером після першої конвертації.

**Уразливості**: `npm audit` показує 3 уразливості в транзитивних залежностях (postcss, vite, @xmldom/xmldom) які прийшли з новими пакетами. Не критичні, виправляться через `npm audit fix` коли адвокат вирішить це безпечно.

---

## 8. UI з прогрес-баром

Простий двостадійний індикатор:
1. Submit натиснуто → кнопка «Додати документ» disable і показує **«Конвертація і завантаження...»**
2. Після завершення submit → модалка закривається, toast `«Документ додано»`
3. Якщо паралельно запустився OCR pipeline (для зображень/сканів) — окремий persistent toast `«Розпізнавання...»`

Повноцінний прогрес-бар з фазами («Конвертація...», «Завантаження на Drive...», «OCR...») — у TASK B де великі обʼєми (склейка 50-200 зображень) і час обробки 1-2 хвилини виправдовують детальний прогрес.

---

## 9. Як працює feature flag CONVERT_DOCX_TO_PDF

**Місце:** `src/services/converter/converterService.js`, рядок 50:

```js
export const CONVERT_DOCX_TO_PDF = true;
```

### Як відкотити DOCX конвертацію

1. Змінити `true` → `false` у файлі
2. `git add src/services/converter/converterService.js`
3. `git commit -m "rollback: disable DOCX→PDF conversion"`
4. `git push origin main`
5. GitHub Actions деплоїть. Усі нові DOCX додаються як є, Viewer показує через DocxRenderer.

### Що залишається працювати

- Існуючі документи з `driveId` (PDF) і `originalDriveId` (DOCX) — обидва файли на Drive, нічого не псується
- Існуючі тести (635 зелені) — обидва шляхи покриті
- Реєстр (`registry_data.json`) — поля `originalDriveId` і `originalMime` залишаються присутніми як null для нових документів

### Тести feature flag

`tests/unit/converterService.test.js`:
- Перевіряє що `CONVERT_DOCX_TO_PDF` експортується як константа
- Перевіряє default = `true` (не може мовчазно стати `false` через випадковий мерж)

---

## 10. SAAS IMPLICATIONS

### Поля сутностей — повний ДНК

Кожен новий запис документа має:
- `tenantId`, `userId` — успадковуються через `executeAction → add_document` (як і раніше)
- `createdAt`, `updatedAt` — через `createDocument()` фабрику
- `addedBy` — `'lawyer_manual'` (новий тип addedBy не потрібен — точка створення та сама)
- `source` — `'manual_upload'` (TASK 0.2 додав це поле)
- `originalDriveId`, `originalMime` — нові nullable поля

### Permissions

Конвертація — utility функція без даних реєстру, не потребує власних permissions. Реальна модифікація реєстру (`add_document`) проходить через існуючий `executeAction` з ACL `dossier_agent.add_document`. Жодних нових прав.

### Tenant isolation

`converterService.convertToPdf` отримує `context.caseId` — використовується тільки для `activityTracker.report` атрибуції. tenantId підтягується автоматично з `tenantService.getCurrentTenant()`. Жодного hardcoded шляху чи глобального state.

### Multi-user

Коли в команді справи кілька юристів:
- Кожен викликає `add_document` зі своїм `userId` (з `getCurrentUser()`)
- Activity tracker логує `document_converted` events з персональним userId
- На рівні Drive — обмеження доступу до Drive файлів через `caseAccess[]` (заглушка зараз, активується у TASK Multi-user Activation)

---

## 11. BILLING IMPLICATIONS

### Точки інструментації

Одна точка у фасаді `converterService.makeResult`:

```js
activityTracker.report('document_converted', {
  module: 'add_form',  // або caller передає інший
  caseId: context?.caseId || null,
  category: context?.caseId ? 'case_work' : 'admin',
  billable: !!context?.caseId,
  subCategory: 'document_conversion',
  duration: Math.round(durationMs / 1000),
  metadata: { converter, originalMime, operation, durationMs }
});
```

Категорії:
- `case_work` коли є caseId → billable + visibleToClient default
- `admin` коли caseId === null → non-billable

`passthrough` (PDF без конвертації) **не репортує** — це не конвертація, не варта окремого time_entry.

### resolveModel

`SYSTEM_DEFAULTS.imageSorter = 'claude-sonnet-4-20250514'` — закладено для TASK B. Tenant pricing tier зможе перевизначити через `tenant.modelPreferences.imageSorter`.

### logAiUsage

У TASK A AI не викликається (вся конвертація локальна — mammoth/html2pdf/jspdf — браузерні бібліотеки). `logAiUsage` точок немає. Вони зʼявляться у TASK B (imageSortingAgent з Sonnet).

### CRM-зріз

`time_entries[].action = 'document_converted'` — зʼявиться в хронології досьє коли буде Billing UI. Видимий клієнту? `visibleToClient` за дефолтом category — для `case_work` так. Окрема думка: конвертація сама по собі — допоміжна дія, не варто показувати клієнту як окремий пункт. Це питання для UI білінгу — поки `visibleToClient` залишається на дефолті категорії.

---

## 12. CLAUDE.md AUDIT

### Оновлено в межах TASK A

- **Структура файлів** (рядок 45-56): додано `src/services/converter/` підпапку
- **documentSchema коментар** (рядок 46): «18 + 6» → «23 + 6» полів v5
- **Новий розділ** «TASK A — КОНВЕРТАЦІЯ ФОРМАТІВ У PDF В AddDocumentModal» між TASK 0.3 (recon) і розділом «АРХІТЕКТУРНЕ ПРАВИЛО». Містить: принцип, нові поля, provider pattern таблицю, feature flag, UI flow, оптимізацію layout.json, resolveModel, залежності, заборонене.

### Не оновлено (поза scope)

Не виявлено інших розділів CLAUDE.md які потребують термінового оновлення через TASK A. `recommended_task_claude_md_audit.md` не створював — нема накопичених знахідок.

---

## 13. Список комітів

```
43e84df  TASK A.1: converter service architecture
363dc4b  TASK A.2: HTML → PDF conversion
0d4eb81  TASK A.3: Image → PDF conversion
616ca6e  TASK A.4: DOCX → PDF conversion with feature flag
106bee2  TASK A.5: Two-button start screen for AddDocumentModal
14787ee  TASK A.6: Strip heavy fields from layout.json (image, tokens)
25c255b  TASK A.7: New proceeding placeholder + imageSorter SYSTEM_DEFAULT
```

Усі запушені на main. GitHub Actions деплоїть автоматично після кожного.

---

## 14. Інструкція адвокату для тестування

Після того як GitHub Actions деплоїть останній коміт (`25c255b`) на https://vadymlevyt.github.io/registry/:

### а) Додавання DOCX (Позовна заява Кісельової)

1. Відкрити справу Кісельової → вкладка «Документи» → «+ Додати документ»
2. На стартовому екрані модалки натиснути **«📄 Додати файл»**
3. Вибрати файл Позовна заява Кісельової.docx з пристрою
4. Перевірити що поле «Назва документа» автозаповнилося як `«Позовна заява Кісельової»`
5. Заповнити Тип (Заява по суті), Від кого (Наш), Дату
6. Натиснути «Додати документ»
7. Через 2-3 секунди модалка закривається. Перевірити:
   - У 01_ОРИГІНАЛИ на Drive є `Позовна заява Кісельової.pdf` (відкривається у Viewer)
   - У 01_ОРИГІНАЛИ на Drive є `Позовна заява Кісельової.docx` (адвокат може завантажити оригінал)
   - У реєстрі документ показується з PDF

### б) Додавання HTML (стара ухвала з ЄСІТС)

1. Завантажити ухвалу з ЄСІТС як HTML (вони часто Windows-1251)
2. «+ Додати документ» → «📄 Додати файл» → вибрати HTML
3. Назва = імʼя файлу без розширення
4. Натиснути «Додати документ»
5. Перевірити:
   - У 01_ОРИГІНАЛИ на Drive є тільки `<name>.pdf`
   - HTML оригінал НЕ збережений (це ОК)
   - Українські літери конвертовані коректно (`decodeHtmlBuffer` обробив windows-1251)

### в) Додавання PDF — без змін

1. Завантажити будь-який Рішення суду.pdf з пристрою
2. «+ Додати документ» → «📄 Додати файл» → вибрати PDF
3. Перевірити що:
   - PDF на Drive зберігся як є (passthrough)
   - Один файл у 01_ОРИГІНАЛИ (без дублікату)
   - OCR pipeline запустився як зазвичай

### г) Додавання одного зображення (РНОКПП)

1. Сфотографувати РНОКПП на телефон (JPG або HEIC)
2. «+ Додати документ» → «📄 Додати файл» → вибрати фото
3. Перевірити:
   - У 01_ОРИГІНАЛИ є `<name>.pdf` (з вашим фото всередині A4 сторінки)
   - Фото оригінал НЕ збережено
   - OCR pipeline розпізнав текст (Прізвище, ІПН тощо)

### д) Перерозпізнавання сканованого документа (перевірка layout.json)

1. Відкрити вже існуючий сканований документ (наприклад Брановський)
2. У Viewer натиснути «Перерозпізнати» (або через агент: «розпізнай документ ще раз»)
3. Після завершення OCR — відкрити Drive Web → знайти файл `<basename>_<driveId>.layout.json` у 02_ОБРОБЛЕНІ
4. Перевірити розмір файлу: має бути сильно менший (раніше 5-7 МБ на сторінку, тепер 100-500 КБ)
5. Відкрити вміст — там немає полів `image` і `tokens`, є `paragraphs`, `blocks`, `layout`, `_text`

---

## 15. Як відкотити DOCX конвертацію

Якщо тестування покаже неприйнятну якість конвертованих DOCX:

1. Відкрити `src/services/converter/converterService.js`
2. Замінити `export const CONVERT_DOCX_TO_PDF = true;` → `false;`
3. `git add src/services/converter/converterService.js`
4. `git commit -m "rollback: disable DOCX→PDF conversion until quality improves"`
5. `git push origin main`
6. GitHub Actions деплоїть автоматично через ~2-3 хвилини

Після відкату:
- Усі нові DOCX додаються як є (passthrough)
- `originalDriveId` для нових DOCX = null
- Viewer відкриває через існуючий DocxRenderer (mammoth локально)
- Усі попередньо створені DOCX (з PDF поряд) працюють як раніше — `driveId` все ще вказує на PDF

---

## 16. Що НЕ зроблено (TASK B перелік)

**Не реалізовано у TASK A:**

1. **Склейка кількох зображень у один PDF** — кнопка «Склеїти зображення» поки що показує плейсхолдер
2. **imageSortingAgent** — семантичне сортування через Sonnet з виявленням підмінених сторінок (модельний слот `imageSorter` у `modelResolver.SYSTEM_DEFAULTS` уже закладений)
3. **Multi-select у Drive File Picker** — режим `selectionMode = 'multi-images'`
4. **Превʼю після агента з drag-and-drop** — підозрілі сторінки червоною рамкою, видалення гуртом
5. **Корекція орієнтації через Document AI orientation** — для multi-image (single image поки використовує aspect ratio)
6. **Прогрес-бар з фазами** — «OCR... Сортування... Корекція орієнтації... Створення PDF... Upload...»
7. **Попередження при 50+ зображеннях** — UX для великих обʼємів
8. **AI Очищення тексту через перемикач у Viewer** — окремий micro-TASK після Document Processor v2

**Поза скопом обох TASK A і TASK B:**

- Серверна конвертація через Puppeteer/LibreOffice (для майбутньої SaaS версії)
- Document Processor v2 повністю (окрема велика робота)
- Створення провадження через ProceedingForm (повноцінне) — модалка «Структура справи»
- Зміна Viewer
- Маркер і нотатки через pdfjs annotations
- Розподіл документів по провадженнях у пакетному режимі

---

**Кінець звіту TASK A**
**635 тестів зелені, build чистий, 7 інкрементальних комітів на main.**
