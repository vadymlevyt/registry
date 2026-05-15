# Мікро-TASK 5.1.1 — DOCX/TXT/MD/HTML/Excel через iframe + фікс додавання DOCX

**Дата:** 2026-05-10
**Гілка:** main

---

## 1. Що знайдено про блокування DOCX

**Точна точка:** `src/services/ocrService.js:120-138`, функція `pickProviderName(file)`.

Для DOCX `mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document'` вона послідовно перевіряє:
- `application/pdf` — ні
- `image/*` — ні
- google-apps.document, text/plain, text/markdown, text/html, application/xhtml+xml — ні
- розширення `.txt`/`.md`/`.html`/`.htm` — ні

Жодна гілка не спрацьовує → повертає `null`. Далі у `extractText`:
```js
const initial = pickProviderName(file);
if (!initial) {
  const err = new Error(`Немає провайдера для ${file.mimeType || file.name}`);
  err.code = 'UNSUPPORTED';
  throw err;
}
```
Кидає `UNSUPPORTED`. Pipeline у `CaseDossier:onSubmit` ловить помилку і показує `toast.warning('Документ додано, але не вдалось розпізнати текст')`.

**Документ ДОДАЄТЬСЯ у реєстр.** Але адвокат відкриває його у Viewer — і бачить порожній стан «Текст для цього документа ще не розпізнано» бо `getCachedText` нічого не знаходить у `02_ОБРОБЛЕНІ`. Звідси відчуття «DOCX не додаються».

**Виправлення:** для inline-renderable форматів пропускаємо OCR крок (Drive рендерить оригінал нативно, текстова копія не критична), а Viewer показує iframe Drive. Адвокат бачить документ з форматуванням і виділення текст працює нативно.

---

## 2. Які файли і рядки змінено

| Файл | Зміни |
|------|-------|
| `src/utils/documentTypes.js` | **Новий** (~80 рядків). Експортує `isInlineRenderable(document)` — чиста функція, яка перевіряє mimeType + extension fallback. Списки OFFICE_MIMES, WEB_TEXT_MIMES, OFFICE_EXTS, WEB_TEXT_EXTS. |
| `src/components/DocumentViewer/index.jsx` | Імпорт `isInlineRenderable`. Замінено вузький `isSearchablePdf` на широкий `inlineRenderable`. Логіка: `showModeToggle = !inlineRenderable && isScanned`, `effectiveMode = inlineRenderable ? 'scan' : (isScanned ? mode : 'text')`. |
| `src/services/ocrService.js` | Додано експорт `hasOcrSupport(file)` — чи є провайдер. Реалізація: `pickProviderName(file) !== null`. |
| `src/components/CaseDossier/index.jsx` | Pipeline `onSubmit` (рядок ~2899): перед запуском OCR перевіряємо `ocrService.hasOcrSupport(ocrFile)`. Якщо ні — `toast.success('Документ додано')` і вихід без warning. Не блокує pipeline. |
| `tests/integration/documentViewer-workflow.test.jsx` | Тест перейменовано `searchable документ — режим text` → `DOCX (inline-renderable) — iframe Drive, перемикача немає`. Додано assertion що iframe **присутній**. |
| `tests/unit/documentTypes.test.js` | **Новий**. 14 тестів для `isInlineRenderable` (PDF/scan/image/Office/OpenDocument/HTML/text/Google formats/folder/originalName priority/unknown). |

---

## 3. Список усіх типів inline-renderable

| Категорія | mimeType / Extension |
|-----------|----------------------|
| **PDF (searchable)** | `application/pdf` + `documentNature='searchable'`, `*.pdf` + searchable |
| **MS Office нові** | `.docx`, `.xlsx`, `.pptx` + відповідні OOXML mime |
| **MS Office легасі** | `.doc` (`application/msword`), `.xls` (`application/vnd.ms-excel`), `.ppt` (`application/vnd.ms-powerpoint`) |
| **OpenDocument** | `.odt`, `.ods`, `.odp` + `application/vnd.oasis.opendocument.*` |
| **Web** | `.html`, `.htm`, `.xhtml`, `.xht` + `text/html`, `application/xhtml+xml` |
| **Текст** | `.txt`, `.md`, `.markdown`, `.rtf`, `.csv`, `.tsv` + `text/plain`, `text/markdown`, `application/rtf`, `text/rtf`, `text/csv`, `text/tab-separated-values` |
| **Google native** | `application/vnd.google-apps.document`, `application/vnd.google-apps.spreadsheet`, `application/vnd.google-apps.presentation` |

**НЕ inline-renderable** (потребують перемикача Скан/Текст):
- PDF з `documentNature='scanned'`
- Зображення (`image/*`): JPG, PNG, HEIC, WEBP, GIF, TIFF
- Google folders (`application/vnd.google-apps.folder`)
- Невідомі формати (відео, бінарні)

---

## 4. Інструкція адвокату для тестування

### А — PDF searchable (Рішення суду, Ухвала)
1. Відкрий документ.
2. **Очікувано:** iframe Drive з оригіналом, **без перемикача**. Як після мт5.1.

### Б — DOCX (нова Позовна заява або тестовий .docx)
1. Через «+ Додати документ» вибери .docx файл.
2. Заповни поля, натисни «Додати документ».
3. **Очікувано:** toast `Документ додано` (без warning про «не вдалось розпізнати»).
4. Відкрий доданий документ у списку.
5. **Очікувано:** iframe Drive показує DOCX як Google Docs preview з форматуванням, **без перемикача**.
6. Виділи текст — працює нативно через Drive viewer.

### В — HTML файл з електронного суду (стара ухвала з ЄСІТС)
1. Через «+ Додати документ» вибери .html файл.
2. **Очікувано:** документ додано (для HTML провайдер є — pdfjsLocal обробляє HTML, тому буде «Документ додано і розпізнано»).
3. Відкрий: iframe Drive з форматованим HTML, **без перемикача**.
4. Виділи текст — нативне виділення.

### Г — XLSX (тестова таблиця)
1. Через «+ Додати документ» вибери .xlsx файл.
2. **Очікувано:** toast `Документ додано` (XLSX не має OCR провайдера — пропускаємо OCR).
3. Відкрий: iframe Drive з Google Sheets preview, **без перемикача**.

### Д — PDF scanned (Адвокатський запит, Довідка садок)
1. Відкрий сканований PDF.
2. **Очікувано:** перемикач Скан/Текст видимий. Поведінка без змін.

### Е — JPG (РНОКПП, скриншот)
1. Відкрий image документ.
2. **Очікувано:** перемикач видимий, Скан = `<img>`, Текст = плашка. Поведінка без змін.

---

## 5. Що НЕ зроблено і чому

- **Не переписано `extractText`/`pickProviderName`** — pickProviderName повертає null для DOCX як і раніше. Зміна тільки в pipeline (skipping OCR через `hasOcrSupport` check). Якщо у майбутньому додамо mammoth-провайдер для DOCX, нічого не треба буде міняти у Viewer.
- **Не додано mammoth для DOCX → текст у 02_ОБРОБЛЕНІ.** Drive iframe показує оригінал з форматуванням — для перегляду адвокату не потрібно. Коли агенту знадобиться текст з DOCX, додамо провайдер окремо. Поки що CRITICAL — не блокувати додавання документа.
- **Не змінено формат 02_ОБРОБЛЕНІ.** Залишається .txt як і було.
- **Не зроблено layout.json HTML рендер** — це майбутній великий мікро-TASK (5.2 або 5.3 за пропозицією з консультаційного звіту 5).
- **Не зроблено маркер/нотатки** — окремий мікро-TASK у майбутньому.
- **Footer кнопки, AddDocumentModal pipeline (Drive picker маркер), класифікація documentNature** — не зачеплені.

---

## 6. Перевірка перед комітом

- `npm test` → **436 passed (36 test files)** — додано 14 тестів `isInlineRenderable`.
- `npm run build` → clean (Vite 6, ~13s).
- `git diff` — 1 новий util файл, 1 новий test файл, 4 зміни (Viewer index, ocrService, CaseDossier, тест integration).
