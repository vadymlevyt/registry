# Звіт мікро-TASK 3 — AddDocumentModal pipeline + documentNature + перемикач Скан/Текст

**Дата:** 2026-05-09
**Виконавець:** Claude Code (Opus 4.7, 1M context)
**Статус:** Завершено. 422/422 тестів зелені.
**Передумова:** Мікро-TASK 1, 2, 2.1, 2.2 виконано — `writeCache` реально пише, кеш читається миттєво.

---

## Що зроблено

У `CaseDossier` додано до `AddDocumentModal.onSubmit` повноцінний pipeline створення документа: завантаження на Drive → правильна початкова `documentNature` за File API → запис документа в реєстр (модалка одразу закривається) → OCR через `ocrService.extractText` → корекція `documentNature` за провайдером який реально витяг текст → проставлення `lastOcrAt`. Pipeline запускається **після** `add_document` (документ з'являється в реєстрі моментально), а OCR і корекція природи відбуваються в фоновому режимі з персистентним toast «Розпізнаю текст...» який потім замінюється на success/warning. Перемикач Скан/Текст у Viewer тепер показується для всіх sканованих документів (PDF + зображення) автоматично — нічого у Viewer не змінювалось, бо причина невідображення була не в його логіці, а в тому що в реєстрі завжди записувалось `documentNature: 'searchable'`.

---

## ЧАСТИНА 1 — діагностика поточної поведінки AddDocumentModal щодо documentNature

### Що відбувалось до фіксу

В `CaseDossier.AddDocumentModal.onSubmit` (рядки 2826-2841) виклик `createDocument({...})` **НЕ передавав поле `documentNature`**. Подивись:

```js
const doc = createDocument({
  procId, name, icon, date, category, author, isKey,
  driveId, driveUrl, size, originalName,
  folder: '01_ОРИГІНАЛИ',
  addedBy: 'lawyer_manual',
  namingStatus: 'manual',
  // ↑ documentNature НЕ передавався
});
```

Тоді фабрика `documentFactory.createDocument` (рядок 34) бере значення з `metadata.documentNature || detectNature(metadata)`. Друга гілка — функція-евристика `detectNature` (рядки 119-132):

```js
function detectNature(metadata) {
  if (metadata.documentNature) return metadata.documentNature;          // не передано
  if (metadata.fromOCR || metadata.ocrProvider) return 'scanned';      // не передано
  const ext = String(metadata.originalName || metadata.name || '')
    .toLowerCase().split('.').pop();
  if (['docx', 'doc', 'html', 'htm', 'txt', 'md', 'rtf'].includes(ext)) return 'searchable';
  return 'searchable';   // ← все інше (PDF, JPG, PNG, HEIC) йшло сюди
}
```

**`detectNature` має два відомих недоліки:**

1. **Не перевіряє mimeType взагалі** — навіть якщо файл явно `image/jpeg`, ця функція цього не бачить.
2. **Список SEARCHABLE_EXT не включає image-розширення** — `jpg`, `png`, `heic` всі провалюються до `return 'searchable'` як для невідомого типу.

### Реальні значення в реєстрі для документів доданих через AddDocumentModal до фіксу

| Тип файлу | Що писалось у `documentNature` | Що мало б бути |
|-----------|-------------------------------|----------------|
| Текстовий PDF (`*.pdf`, mime `application/pdf`) | `'searchable'` (правильно) | `'searchable'` |
| Сканований PDF | `'searchable'` ❌ | `'scanned'` |
| Зображення JPG/PNG | `'searchable'` ❌ | `'scanned'` |
| HEIC (після конверсії в JPG) | `'searchable'` ❌ | `'scanned'` |
| DOCX, DOC | `'searchable'` (правильно) | `'searchable'` |
| TXT, HTML, MD | `'searchable'` (правильно) | `'searchable'` |

Тобто **усі сканування і всі зображення** додавались з невірним `'searchable'`. Перевірити можна так: відкрити `registry_data.json` через Drive, знайти case → documents → шукати документ доданий через «+ Додати документ» з оригінальним іменем `*.jpg` або `*.png` — поле `documentNature` буде `'searchable'`, хоча мало б бути `'scanned'`.

### Чому фабрику не виправляли «глобально»

`documentFactory.createDocument` викликають кілька точок (DocumentProcessor пакетна обробка, DocumentProcessor split PDF, drag-n-drop, AddDocumentModal, INITIAL_CASES seed). Зміна евристики `detectNature` потенційно змінює поведінку всіх цих точок одночасно. **Принцип однозначності з DEVELOPMENT_PHILOSOPHY** — не нашаровуй сенсів на існуюче ім'я: краще явно передати `documentNature` у викликаючому коді там де є точна інформація (File API), ніж робити фабричну евристику «розумнішою» в декількох вимірах одразу. Тому фікс — у точці виклику.

---

## Які файли і рядки змінено

| Файл | Рядки | Зміна |
|------|-------|-------|
| `src/components/CaseDossier/index.jsx` | 7 | Додано імпорт `inferNatureFromFile, defaultNatureForUI` з `services/detectDocumentNature.js` |
| `src/components/CaseDossier/index.jsx` | ~2811-2913 | Переписано `onSubmit` AddDocumentModal: додано pipeline (initialNature по File API → createDocument з explicit documentNature → add_document → OCR → корекція природи + lastOcrAt через update_document → toast по результату) |

Жодних інших змін у коді. Зокрема:

- **`documentFactory.js` не чіпали** — його евристика `detectNature` лишається як є, для callers які не мають точної інформації про природу.
- **`DocumentViewer/index.jsx` не чіпали** — його логіка `effectiveNature = document?.documentNature || inferred` була правильна, проблему створював лише вхідний `documentNature` з реєстру.
- **`detectDocumentNature.js` не чіпали** — використовується as-is.

---

## ЧАСТИНА 3 — причина невідображення перемикача і як виправлено

### Логіка показу перемикача в DocumentViewer (рядки 42-44)

```js
const inferred = inferNatureFromFile(document) || defaultNatureForUI(document);
const effectiveNature = document?.documentNature || inferred;
const isScanned = effectiveNature === 'scanned';
// showModeToggle={isScanned}  — у DocumentViewerHeader
```

`document?.documentNature` має пріоритет через `||`. Коли в реєстрі `documentNature: 'searchable'` — це truthy, OR одразу замикається, `effectiveNature='searchable'`, `isScanned=false`, **перемикач прихований**.

### Чому жоден inferНатуре fallback не врятував

Для зображення JPG доданого через AddDocumentModal:
- `document.mimeType` — **не зберігається у канонічній схемі** (немає такого поля), тому `inferNatureFromFile({mimeType: undefined, originalName: 'photo.jpg'})` дивиться лише на extension → повертає `'scanned'`.
- Але це не виконується, бо `document.documentNature='searchable'` вже truthy і OR замикається до того.

Логіка Viewer спирається на те що **реєстр містить правильний `documentNature`**. Якщо там `searchable` — Viewer довіряє і ховає перемикач. Це правильна поведінка для джерела істини.

### Як виправлено

Не змінено нічого у Viewer. Pipeline тепер пише в реєстр **правильний** `documentNature`:

| Тип файлу | initialNature (за File API) | Після OCR |
|-----------|------------------------------|-----------|
| Зображення JPG/PNG/HEIC | `'scanned'` (через `inferNatureFromFile` за mimeType `image/*`) | стає `'scanned'` (provider documentAi) |
| Сканований PDF | `'scanned'` (через `defaultNatureForUI` PDF→scanned) | лишається `'scanned'` (provider documentAi/claudeVision) |
| Текстовий PDF | `'scanned'` (через `defaultNatureForUI` — безпечний дефолт) | **корегується на `'searchable'`** (provider pdfjsLocal витягнув текстовий шар) |
| DOCX, TXT | `'searchable'` (через `inferNatureFromFile` SEARCHABLE_EXT) | лишається `'searchable'` (provider pdfjsLocal) |

Корекція природи відбувається через `update_document` з полем `documentNature`. Якщо `finalNature !== initialNature` — пишемо нове значення; якщо однакові — не пишемо (економія записів на Drive).

**Невелика інтермедіа для текстового PDF:** упродовж 1-3 секунд (поки OCR біжить) документ показується в Viewer з `documentNature='scanned'`, перемикач видимий, scan-режим показує iframe. Після OCR `documentNature` стає `'searchable'`, перемикач зникає, режим автоматично перемикається на text. Адвокат побачить це як «спочатку був перемикач, потім зник» — нормальне переходне явище для пайплайну.

---

## Результат тестів

```
Test Files  35 passed (35)
     Tests  422 passed (422)
  Duration  34.24s
```

Тести не змінювались. Жоден існуючий тест не закладав поведінку «AddDocumentModal не передає documentNature» або «без OCR pipeline» — всі 422 пройшли без коригувань.

---

## Інструкція адвокату для перевірки

### Сценарій 1 — додавання текстового PDF

1. У досьє справи натисни **«+ Додати документ»** → обери PDF з текстовим шаром (більшість документів з ЄСІТС).
2. Заповни обов'язкові поля → натисни «Додати документ».
3. **Очікувано:** модалка одразу закривається, справа знизу синій toast **«Документ додано. Розпізнаю текст...»**.
4. Через 2-5 секунд toast замінюється на зелений **«Документ додано і розпізнано»**.
5. Відкрий доданий документ → Viewer одразу показує текст у режимі Текст (без перемикача).
6. На Drive у `01_ОРИГІНАЛИ` справи має бути сам PDF, у `02_ОБРОБЛЕНІ` — файл `<basename>_<driveId>.txt` з OCR-результатом.

### Сценарій 2 — додавання сканованого PDF

1. Те саме, але обери сканований PDF (фотокопія паперового документа).
2. Toast «Розпізнаю текст...» триває довше — 10-30 секунд (Document AI обробляє сторінки).
3. Замінюється на зелений «Документ додано і розпізнано».
4. Відкрий документ → Viewer показує **перемикач [🖼 Скан] [📝 Текст]** зверху.
5. Скан показує PDF preview через Drive iframe, Текст — OCR-результат.
6. На Drive у `02_ОБРОБЛЕНІ` — файл `*.txt` з OCR.

### Сценарій 3 — додавання зображення (JPG / PNG)

1. Те саме, але обери `.jpg` або `.png` (фото документа з телефону, скріншот).
2. Toast «Розпізнаю текст...» — 3-10 секунд.
3. Замінюється на зелений «Документ додано і розпізнано».
4. Відкрий документ → перемикач **[🖼 Скан] [📝 Текст]** видимий. Скан показує саму картинку (`<img>` з Drive thumbnail), Текст — OCR.

### Сценарій 4 — HEIC файл (iPhone)

Те саме що сценарій 3 — HEIC автоматично конвертується в JPG через `prepareFile` → далі стандартний шлях зображення.

### Сценарій 5 — додавання без файлу (тільки метадані)

1. Натисни «+ Додати документ» але не прикріплюй файл.
2. Заповни метадані → «Додати документ».
3. **Очікувано:** одразу зелений toast «Документ додано» (без OCR pipeline бо немає файлу).

### Сценарій 6 — Drive недоступний

1. Якщо Drive токен прострочений або відключений → upload фейлиться.
2. Toast «Не вдалось завантажити на Drive» (червоний) показується одразу.
3. Документ все одно додається в реєстр (без `driveId`), але без OCR.
4. Toast «Документ додано» (зелений) — без рядка про розпізнавання.

### Сценарій 7 — OCR помилка (UNSUPPORTED, наприклад ZIP-PDF з ЄСІТС)

1. Файл завантажується на Drive успішно, документ створюється.
2. OCR провайдери всі впадуть з UNSUPPORTED.
3. **Очікувано:** жовтий toast **«Документ додано, але не вдалось розпізнати текст»** з описом причини («Формат файлу не підтримується (можливо, ZIP-PDF з ЄСІТС)»).
4. Документ є в реєстрі без `lastOcrAt`. Адвокат може потім натиснути «Розпізнати зараз» у Viewer (хоча для ZIP-PDF це не допоможе — потрібен ручний експорт).

---

## Що НЕ зроблено і чому

1. **Глобальна правка `documentFactory.detectNature`.** Поза скопом і потенційно небезпечна — змінює поведінку всіх callers одночасно (DocumentProcessor, drag-n-drop, INITIAL_CASES). Принцип однозначності каже передати точне значення в точці виклику де є інформація, не «робити фабрику розумнішою». Якщо колись захочемо очистити фабрику — окремий міні-TASK з тестами для кожного caller.

2. **Перевірка legacy-документів у реєстрі.** Адвокат має старі документи з невірним `documentNature='searchable'` для зображень/сканів. Pipeline застосовується тільки для **нових** додавань. Стара база залишається з некоректними значеннями. Виправити можна через Viewer — він має `useEffect` який ре-fetch'ить через `inferNatureFromFile` для документів без `documentNature`, але для документів з `'searchable'` цей хук не спрацьовує (значення вже є). Окремий міні-TASK «backfill documentNature» через одноразовий скан реєстру можна зробити, але користь невелика — адвокат і так може натиснути «Розпізнати зараз» на старому документі.

3. **Прогрес-бар для довгого OCR.** Зараз — toast.info з персистентним статусом «Розпізнаю текст...». Для документів на 50+ сторінок це може тривати хвилину і користувач не бачить прогресу всередині. Окремий TASK покращення UX білінгу.

4. **Переміщення копії в `02_ОБРОБЛЕНІ` крім txt-кеша.** Зараз pipeline записує `*.txt` через `ocrService.writeCache`, але оригінал фізично лишається в `01_ОРИГІНАЛИ`. Семантично правильно: оригінал недоторкано в `01_`, текстова копія в `02_`. Це працює як задумано.

---

## Коміт

```bash
git add src/components/CaseDossier/index.jsx report_micro_task_3_addmodal_pipeline.md
git commit -m "fix: micro-TASK 3 — AddDocumentModal OCR pipeline + correct documentNature (restores Скан/Текст toggle for new uploads)"
git push origin main
```

---

**Кінець звіту мікро-TASK 3.**
