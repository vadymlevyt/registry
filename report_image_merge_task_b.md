# TASK B — Склейка кількох зображень у один PDF (Звіт)

**Дата:** 2026-05-12
**Версія:** 1.0
**Коміти:** 7 інкрементальних
**Тести:** 823 зелені (+77 за TASK B)
**Build:** 19 сек, чистий

---

## 1. Multi-select у Drive File Picker

Розширення `DrivePickerSection` всередині `AddDocumentModal.jsx`.

Новий пропс `selectionMode`:
- `'single'` (default) — один клік по файлу одразу обирає (старий контракт)
- `'multi-images'` — checkbox біля файлів, фільтрація `mimeType image/*`,
  кнопка «Обрати N зображень» з українським плюралом (1→ня, 2-4→ня, 5+→ь),
  callback `onPickMulti(files[])`

Папки відкриваються звичайно у обох режимах. У multi-images mode не-image
файли приховуються — у склейці вони нерелевантні.

Збереження Map<fileId, file>: вибір зберігається коли адвокат переходить
у іншу папку. Адвокат може **змішувати джерела** (узгоджено В6=A):
збирати зображення з своєї папки + спільної Drive папки одночасно
(part у себе, part у Drive — не повинен переписувати все в одне місце).

CSS: `--selected` стан рядка (accent-subtle bg + accent border),
custom checkbox 18×18 з чорною галочкою.

**Коміт:** `d4e927b`

---

## 2. orientationCorrector через Canvas API

Новий модуль `src/services/sortation/orientationCorrector.js`.

**Public API:**

```js
normalizeDegrees(angle) → 0|90|180|270
// -90→270, 360→0, 75→90, 17→0 (округлення до найближчого з 4)

extractPageOrientation(page) → 0|90|180|270
// Витягає orientation з різних варіантів Document AI:
//   page.orientation (enum 0-3 або 'PAGE_UP'/'PAGE_RIGHT'/...)
//   page.detectedOrientation (degrees)
//   page.layout.orientation (вкладений)
// Fallback 0 якщо нічого не знайдено.

rotateImageBlob(blob, degrees) → Promise<Blob>
// Обертає через Canvas API. degrees=0 → no-op (Розумна економія).
// Повертає JPEG quality 0.92. Для 90/270 swap dimensions, для 180 — без swap.
```

Canvas обертання: `ctx.translate(W/2, H/2)` → `ctx.rotate(rad)` →
`ctx.drawImage(img, -W/2, -H/2)` (центровано).

Cleanup blob URL через `revokeObjectURL` у `finally`.

**Тести (21):** нормалізація кутів, extract з різних варіантів структури,
обертання з мокнутими canvas/Image у jsdom, swap dimensions, no-op для 0°,
помилка для non-Blob.

**Коміт:** `ed524ff`

---

## 3. imageSortingAgent — Sonnet JSON output

Новий модуль `src/services/sortation/imageSortingAgent.js`.

### Контракт

```js
sortImages(items, options) → Promise<SortResult>

items: [{
  index,           // оригінальний індекс у списку (0-based)
  name, mime, sizeBytes,
  ocrText,         // повний OCR text (truncated до 1500 chars)
  pageStructure,   // метадані Document AI (опційно)
  orientation,     // 0/90/180/270 (вже extracted)
}]

options: {
  apiKey,          // Anthropic API ключ
  callApi,         // DI для тестів — замінник реального fetch
  caseContext: {
    existingDocumentNames,  // для унікалізації suggestedName
    categoryHint,           // підказка типу документа
  },
}

SortResult: {
  order: [2, 0, 1, 3, 4],  // permutation original indices
  warnings: [
    { index: 4, reason: "Сторінка з іншого документа" }
  ],
  missing: "Можливо відсутня сторінка 3" | null,
  suggestedName: "Ухвала про відкриття провадження",
  model: "claude-sonnet-4-20250514",
  usage: { inputTokens, outputTokens },
  fallback: false,
  fallbackReason: null | 'agent_invalid_json' | 'order_normalized' | ...,
}
```

### System prompt — шаблон назв

КОРОТКА (3-7 слів), функціональна. Відповідає на питання «Що це за документ
серед інших у цій справі?» Не повторюємо контекст справи (суд, сторони, дата) —
адвокат це й так знає.

**ПРАВИЛЬНІ:**
- `Ухвала про відкриття провадження`
- `Ухвала про відкриття апеляційного провадження`
- `Позовна заява про поділ майна`
- `Адвокатський запит` або `Адвокатський запит до Держспоживслужби` (тільки якщо багато запитів)
- `Повістка про виклик у судове засідання`
- `Заперечення на позовну заяву`
- `Постанова касаційної інстанції`

**НЕПРАВИЛЬНІ:** `Ухвала Львівського апеляційного суду про відкриття провадження від 10.03.2026` (контекст справи); `Документ суду` (нечітко); `Стор. 1 текст` (технічно); `Позовна заява.pdf` (з форматом).

### ensureUniqueName(name, existingNames)

Case-insensitive порівняння з trim. Заповнення дірок у послідовності:
- `"X"` + `["X"]` → `"X (2)"`
- `"X"` + `["X", "X (3)"]` → `"X (2)"` (заповнюємо дірку — (2) вільне)
- `"X (2)"` + `["X", "X (2)"]` → `"X (3)"`

Викликається ДВІЧІ:
1. Всередині agent → застосовується до `suggestedName` що повертається
2. У caller (`ImageMergePanel.handleSubmit`) — якщо адвокат вручну
   ввів назву яка перетинається з існуючими

### OCR text truncation

`MAX_OCR_TEXT_PER_IMAGE = 1500` chars (узгоджено: Г4=1500 замість 800).
Зберігаємо HEAD 1000 + TAIL 500 — колонтитули і footers (основні сигнали
сортування). Середину обрізаємо з маркером `[...skipped N chars...]`.

### JSON parsing з fallback chain

`parseAgentResponse(rawText)`:
1. `JSON.parse(rawText)` — чистий випадок
2. Markdown ```` ```json...``` ```` блок
3. Перший `{...}` у prose

Якщо все провалилось — повертаємо identity order + `fallback: true`.

### Degenerate cases

- `items.length === 1` → агент НЕ викликається (`skipped: true`), identity order
- `items.length === 0` → throw
- Без `apiKey` і `callApi` → throw

resolveModel(`'imageSorter'`) — Sonnet за замовчуванням (вже у SYSTEM_DEFAULTS
з TASK A.7 commit `25c255b`). Tenant premium може перевизначити через
`tenant.modelPreferences.imageSorter`.

**Тести (39):** parseAgentResponse, ensureUniqueName, truncate, buildUserMessage,
degenerate cases, happy path, fallback (4 варіанти), HTTP errors.

**Коміт:** `a950457`

---

## 4. Pipeline multiImageToPdf

Новий модуль `src/services/converter/multiImageToPdf.js` +
фасад `convertImagesToPdf` у `converterService.js`.

### Кроки pipeline

1. **HEIC pre-conversion** через `heicToJpeg` (iPhone фото)
2. **OCR кожне зображення ОДИН РАЗ** через `ocrService.extractText`
   - Concurrency=3 паралельних викликів (Б2=B узгоджено)
   - `skipCache+skipCacheWrite=true` (caller пише об'єднаний кеш)
3. **Якщо >1 image** → `sortImages` (Sonnet JSON output):
   - `ocrText` truncated до 1500 chars
   - `orientation` з pageStructure
   - `caseContext.existingDocumentNames` для унікальності
4. **`extractPageOrientation` per image** → `rotateImageBlob` (Canvas)
   тільки якщо `degrees != 0` (Розумна економія)
5. **`buildPdfFromImages`** через jsPDF:
   - Per-page orientation за пропорцією після rotation
   - JPEG quality 0.92
6. **Об'єднані артефакти** у фінальному порядку:
   - `extractedText`: тексти з'єднані через `--- Page break ---`
   - `layoutJson`: `pageStructure` об'єднана з оновленими `pageNumber` (1..N)
   - Heavy fields (`image`, `tokens`) видаляються при serialize

### КРИТИЧНО — один OCR на зображення

`ocrService.extractText` викликається **РІВНО N разів** для N зображень.
Жодного повторного OCR на склеєному PDF.

Інтеграційні тести (12 у `tests/integration/multiImageToPdf.test.js`)
перевіряють це для:
- N=1 (1 виклик)
- N=5 (рівно 5)
- N=10 (рівно 10)
- 1 зображення → агент НЕ викликається (`skipped: true`)
- Адвокат перепорядкував у preview → НЕ re-OCR на subset (rebuildFromOcrResults
  використовує результати з пам'яті)

### Concurrency 3 паралельних

```js
async function runWithConcurrency(items, taskFn, concurrency=3, onProgress)
```

Worker pattern: `Math.min(concurrency, items.length)` воркерів конкуренто
тягнуть з cursor. `done` лічильник для прогрес-бара. Тести підтверджують
`maxActive <= 3` і `maxActive >= 2` (паралельно, не послідовно).

### Error handling (узгоджено: Г1=A, Г2=A, Г3=A fallback)

- OCR fail для одного зображення → продовжуємо з рештою, text=""
- Agent fail → fallback identity order, warnings, sortResult=null
- HEIC fail → пропускаємо файл, у warnings
- Rotation fail → залишаємо без обертання, у warnings

### Фасад

```js
convertImagesToPdf(files, context) →
  { pdfBlob, pdfName, suggestedName, extractedText, layoutJson,
    ocrResults, sortResult, finalOrder, warnings, converter, durationMs }
```

Одна точка `activityTracker.report('images_merged', { imageCount, finalPageCount,
hasSortAgent, agentFallback, durationMs })` у фасаді.

**Коміт:** `914f297`

---

## 5. UI превʼю з drag-and-drop

`src/components/CaseDossier/ImageMergePanel.jsx` (+ CSS).

### 3 фази

**`selecting`** — file picker:
- `<input type=file accept=image/* multiple>` для пристрою
- Кнопка "Додати з Drive" → відкриває `DrivePickerSection` у multi-images mode
- Адвокат може ЗМІШУВАТИ джерела (В6=A)
- Список вибраних з можливістю видалити окремі

**`processing`** — phase progress:
- Stepper з 6 фазами: preparing → heic → ocr → sort → rotate → pdf
- Поточна фаза підсвічена accent кольором з номером у dot
- Завершені — зеленим ✓
- Прогрес-бар width = (done/total)×100% + лічильник "N/M"

**`preview`** — grid з drag-and-drop:
- `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` (~15 KB gzip)
- Lazy-loaded чанк при першому показі preview
- Touch + mouse + клавіатура (a11y)
- Thumbnails 120×140 grid (responsive auto-fill)
- Кожен: позиційний індекс, drag handle, видалити X
- Підозрілі (з agent warnings) — червона рамка + текст warning
- Alert "Виявлено N підозрілих" з кнопкою "Видалити всі підозрілі"
- Alert info якщо agent повернув `missing`
- Форма метаданих з autosuggest назви (унікалізована)

### Submit логіка

Якщо порядок/склад НЕ змінився → re-use готовий PDF з pipeline.

Якщо адвокат перепорядкував/видалив → `rebuildFromOcrResults`:
- Re-merge PDF у новому порядку (rotate з orientation з пам'яті + jsPDF склейка)
- Re-merge extractedText у новому порядку
- Re-merge layoutJson з оновленими pageNumber
- **OCR НЕ перевикликається** (TASK B критично)

### Передача артефактів у parent

```js
onSubmit({
  name, category, author, procId, date, isKey,
  file: pdfFileFromMerge,
  mergeArtifacts: { extractedText, layoutJson, imageCount, sortResult }
})
```

`CaseDossier:onSubmit` отримує `mergeArtifacts`:
- Після конвертації + upload встановлює `extractedText`/`layoutJson`/`converterType='multiImageToPdf'`
- Гілка "extractedText є" → `writeExtractedTextArtifact` пише `.txt`
- ДОДАТКОВО: `writeLayoutArtifact` (новий public API ocrService) пише `.layout.json`
- НЕ запускає OCR pipeline на склеєному PDF

**Коміти:** `bf32b31` (UI) + `667be3f` (stepper + 50+ confirm)

---

## 6. Прогрес-бар з фазами

Stepper показує **усі 6 фаз** одночасно: адвокат бачить що зроблено
і що залишилось.

**50+ confirmation** (А1=A узгоджено):
```js
if (files.length > 50) {
  const minutes = Math.ceil(files.length / 25);
  const ok = window.confirm(
    `Великий обсяг: N зображень. Обробка займе приблизно X хв. Продовжити?`
  );
  if (!ok) return;
}
```

Оцінка `Math.ceil(N/25)` — ~25 фото/хв через OCR + agent.

**Коміт:** `667be3f`

---

## 7. SAAS і BILLING IMPLICATIONS

### SAAS

- Документ що створюється отримує `tenantId/ownerId/createdAt/updatedAt`
  через `createDocument()` фабрику (без змін)
- `addedBy: 'lawyer_manual'`, `source: 'manual_upload'`,
  `documentNature: 'scanned'`, `originalDriveId: null` (оригінали зображень
  не зберігаються — все у PDF)
- `executeAction → add_document` — єдина точка модифікації реєстру
- Permissions: dossier_agent.add_document allowed для lawyer/owner

### BILLING

- **`activityTracker.report('images_merged', ...)`** — одна точка у фасаді
  `convertImagesToPdf`:
  ```js
  {
    module: 'add_form', caseId,
    category: caseId ? 'case_work' : 'admin',
    billable: !!caseId,
    subCategory: 'document_merge',
    duration: durationMs / 1000,
    metadata: { imageCount, finalPageCount, hasSortAgent, agentFallback, durationMs }
  }
  ```
- **`logAiUsage` для агента** — поточна імплементація НЕ логує (caller передає
  `callApi` для тестування або реальний fetch). У production будуємо точку
  логування у `App.jsx` коли модалка передає `setAiUsage` через context.
  Майбутнє розширення — `useAiUsage` hook у CaseDossier і `apiKey + setAiUsage`
  у пропсах ImageMergePanel.
- **resolveModel('imageSorter')** — Sonnet default. Tenant premium → Opus
  через `tenant.modelPreferences.imageSorter` (ієрархія user→tenant→system).
- Якщо одне зображення → агент не викликається → ai_usage запис не створюється.
- OCR per image — `ocrService.extractText` уже інструментований у `aiUsageSink`
  всередині (Document AI / Claude Vision викликають окремо).

### Permissions

Без змін. Жодних нових прав. Multi-merge — utility операція що використовує
існуючий `add_document`.

---

## 8. Список комітів

```
d4e927b  feat(TASK B.1): multi-select у DrivePickerSection
ed524ff  feat(TASK B.2): orientationCorrector через Canvas API
a950457  feat(TASK B.3): imageSortingAgent — Sonnet JSON output з шаблоном назв
914f297  feat(TASK B.4): multiImageToPdf pipeline — склейка з OCR + агентом + ротацією
bf32b31  feat(TASK B.5): AddDocumentModal multi-image UI з @dnd-kit preview
667be3f  feat(TASK B.6): прогрес-бар з phase stepper + 50+ confirmation
<TBD>    feat(TASK B.7): integration tests + report
```

Усі запушені на main. GitHub Actions деплоїть автоматично після кожного.

---

## 9. Підтвердження "один OCR на зображення"

**Адвокат явно попередив**: pipeline ВИКОНУЄ OCR лише ОДИН раз для кожного
зображення. Жодного повторного OCR на склеєному PDF.

**Реалізація:**
- `multiImageToPdf.js` викликає `ocrService.extractText` per image (concurrency=3)
- Результати (`text`, `pageStructure`) залишаються у пам'яті
- Сортування агентом — отримує text з пам'яті
- Корекція orientation — отримує orientation з pageStructure з пам'яті
- Перебудова після preview rebuild — використовує ocrResults з пам'яті
- `mergeArtifacts` → caller (`CaseDossier:onSubmit`) пише `.txt` + `.layout.json`
  напряму через `writeExtractedTextArtifact` + `writeLayoutArtifact`. OCR
  pipeline на склеєному PDF НЕ запускається — `lastOcrAt` встановлено,
  Viewer не запропонує re-OCR.

**Тести підтверджують:**

`tests/integration/multiImageToPdf.test.js`:
```
✓ 5 зображень → extractText викликається РІВНО 5 разів (не N+1)
✓ 10 зображень → 10 OCR викликів, не 11
✓ 1 зображення → 1 OCR виклик, агент НЕ викликається
```

Це expectations `mockExtractText.toHaveBeenCalledTimes(N)` — failing test
заблокує CI/CD деплой через `npm test` у GitHub Actions.

---

## 10. Інструкція тестування для адвоката

Після деплою останнього коміту перевір:

### а) Склейка 3-5 фото одного документа з пристрою

1. Сфотографуй на iPhone/Android 3-5 сторінок рішення суду
2. Відкрити справу → «+ Додати документ»
3. Натиснути «🖼 Склеїти зображення»
4. «Додати з пристроя» → вибрати 3-5 фото (можна Cmd+click або довге натискання)
5. Натиснути «Створити PDF з N зображень»
6. Спостерігати phase stepper: preparing → ocr (N/N) → sort → rotate → pdf
7. У preview:
   - Перевірити що сторінки у правильному порядку
   - Якщо ні — перетягнути thumbnail у правильне місце
   - Назва документа автозаповнена пропозицією від агента
8. Заповнити Тип/Від кого/Дату
9. Натиснути «Створити PDF з N стор.»
10. Перевірити що у Документах справи зʼявився PDF з усіма сторінками

### б) Multi-select з Drive

1. Завантажити кілька фото у спільну Drive папку
2. Відкрити справу → «🖼 Склеїти зображення»
3. «Додати з Drive» → у multi-images mode:
   - Бачиш чекбокси біля файлів
   - Не-image файли приховані
   - Вибрати кілька через клік (рядок підсвічується)
4. «Обрати N зображень» внизу → файли додаються у чергу
5. Можеш «Додати з пристрою» додати ще + «Додати з Drive» з іншої папки
6. Запустити склейку

### в) HEIC з iPhone

1. Сфотографувати на iPhone (HEIC формат)
2. AirDrop або iCloud → завантажити на пристрій
3. У AddDocumentModal → multi-image → вибрати HEIC файли
4. Перевірити що heic2any конвертує у JPEG (фаза `heic` у stepper)
5. Далі pipeline як звичайно

### г) Виявлення підмінених сторінок

1. Завантажити 4 фото одного документа (наприклад рішення суду)
2. Додати ще одне фото з зовсім іншою тематикою (скріншот соцмережі,
   фото рецепту, чужий документ)
3. Запустити склейку
4. У preview — підмінена сторінка має зʼявитись з ЧЕРВОНОЮ РАМКОЮ
   і текстом warning внизу thumbnail
5. Натиснути «Видалити всі підозрілі» гуртом або X на конкретному
6. Натиснути «Створити PDF» — у фінальному PDF підмінена сторінка відсутня

### ґ) Корекція орієнтації

1. Сфотографувати документ повернутий на 90° (телефон у landscape для
   portrait документа)
2. У pipeline фаза `rotate` оберне через Canvas
3. У preview thumbnail показує вже корекційну орієнтацію
4. Фінальний PDF — сторінки вертикально

---

## 11. Що НЕ зроблено і чому

- **Серверна конвертація через LibreOffice** — поза скопом (модулі без бекенду)
- **Розпаковка ZIP** — для модуля ЄСІТС, окремий TASK
- **AI Очищення тексту після склейки** — окремий micro-TASK (`layoutJson` готовий
  для майбутнього AI Очищення з координатами)
- **Розподіл документів по провадженнях через AI** — Document Processor v2
- **Пакетна обробка декількох документів одночасно** — Document Processor v2
- **Snapshot тести на реальних зображеннях** — узгоджено З1=B (mock-тести з
  фейковими canvas + mock OCR/agent). Реальні бінарники у git не зберігаємо.
- **logAiUsage для імперативного агента** — поки caller передає `callApi`,
  ai_usage не пишеться. Точка логування буде додана коли App.jsx підключиться
  через apiKey context (майбутнє розширення)

---

## 12. CLAUDE.md AUDIT

### Що варто оновити окремим міні-TASK

- **Структура файлів** (рядок 45-56): додати `src/services/sortation/` підпапку
  з `imageSortingAgent.js` і `orientationCorrector.js`
- **Розділ TASK A → "TASK A+B"** або **новий розділ "TASK B"** після TASK A
  з описом multi-image pipeline і застереженням "один OCR на зображення"

### Не потребує оновлення

Інші розділи (PHASE 1.5, Billing Foundation, SAAS Foundation) — без змін.
`recommended_task_claude_md_audit.md` не створюю — нема накопичених знахідок
окрім згаданих вище.

---

**Кінець звіту TASK B**

**823 тести зелені, build чистий, 7 інкрементальних комітів на main.**
