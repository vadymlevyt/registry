# report — micro-TASK 4.1: Drive picker pipeline fix

**Дата:** 2026-05-09
**Версія:** 1.0
**Тестів:** 422/422 зелені

---

## 1. Що знайдено в Частині 1 — стан до фіксу

**У `AddDocumentModal` НЕ було Drive picker гілки взагалі.** Тільки нативний HTML `<input type="file">` (FileUploadZone). На Android system file picker ОПЦІОНАЛЬНО показує Drive як одне з джерел — тоді Android **локально кешує** файл з Drive і віддає його як звичайний `File` об'єкт у input.

Подальший pipeline (`CaseDossier:onSubmit`, рядки 2829–2840 до фіксу) сприймав цей файл як локальний:

```js
prepared = await prepareFile(file);
driveId = await uploadFileLocal(prepared, caseData);
```

Тобто **намагався перезавантажити** файл у нашу Drive-папку 01_ОРИГІНАЛИ. Якщо `uploadFileLocal` падав (мережа, токен, content URI що недоступний для повторного reading на Android) — `catch` логував error і `driveId` лишався `null`. Документ все одно додавався в реєстр з `driveId: null` — і це саме той стан що адвокат бачив у документі #8 "Адвокатський запит держспоживслужба":

```
driveId: NULL
documentNature: scanned (дефолт без OCR)
lastOcrAt: NULL
size: 1464170 (тільки бо Android передав File-метаданi)
originalName: "запит держпродспоживслужба .pdf"
```

`hasOcrTarget = !!fileForInfer && !!driveId && !!subFolders?.['02_ОБРОБЛЕНІ']` — `driveId=null` вимикав OCR pipeline. Документ-зомбі.

**Висновок:** дві гілки (file picker / Drive picker) у задачі формально були однією — пристрій-лише. Drive picker як осмислений сценарій був відсутній.

---

## 2. Які файли і рядки змінено

| Файл | Зміни |
|------|-------|
| `src/components/CaseDossier/AddDocumentModal.jsx` | +88/-2: state для Drive picker, `loadDriveFiles()`, `handleDrivePick()`, `<DrivePickerSection>` UI під FileUploadZone. Рендериться **тільки** коли `caseData.storage.subFolders['01_ОРИГІНАЛИ']` є — інакше не виводиться (захист від тестів і legacy справ без Drive-папки). |
| `src/components/CaseDossier/AddDocumentModal.css` | +93: стилі для `.add-document-modal__drive-section/-toggle/-list/-item/-empty/-retry`. Сумісно з існуючим dark-token дизайном. |
| `src/components/CaseDossier/index.jsx` | +13/-2: гілка у `onSubmit` рядки 2832–2851. Якщо `file._isDriveSource && file._driveId` — `driveId = file._driveId`, **пропускаємо** `prepareFile` і `uploadFileLocal`. Інакше — стара гілка без жодних змін. |

**File picker гілка не зачеплена.** Перевірив: рядки 2842–2851 (нова умова `else if`) повністю зберігають оригінальну поведінку для `file && driveConnected && !file._isDriveSource`.

---

## 3. Як працює тепер pipeline для Drive picker гілки

1. Адвокат відкриває "Додати документ" → бачить дропзону + нову секцію `[> ☁ Або вибрати файл вже на Drive (з папки 01_ОРИГІНАЛИ)]`.
2. Натискає на toggle — секція розкривається, асинхронно вантажиться список з `01_ОРИГІНАЛИ` через `driveRequest` (`q='<folderId>' in parents and trashed=false`, `fields=files(id,name,mimeType,size,createdTime)`, `orderBy=createdTime desc`).
3. Бачить файли. Натискає на потрібний → `handleDrivePick` записує в `state.file` маркер `{ _isDriveSource: true, _driveId, name, size, type }`.
4. FileUploadZone відображає його так само як обраний з пристрою (бо marker має `.name` і `.size`).
5. Адвокат заповнює інші поля → "Додати документ".
6. `onSubmit` визначає гілку:
   - `file._isDriveSource = true` → `driveId = file._driveId`, **uploadFileLocal пропущено** (немає дубліката на Drive).
   - `prepared` лишається `null`.
7. `fileForInfer = prepared || file` = маркер. `inferNatureFromFile({ mimeType: marker.type, originalName: marker.name })` обчислює `initialNature` (image/* → scanned, pdf → scanned за дефолтом).
8. `createDocument({ ...driveId, originalName: marker.name, size: marker.size, ... })` — реєстровий запис з реальним `driveId`.
9. `add_document` через `executeAction`.
10. `hasOcrTarget = true` (всі 3 умови — driveId, fileForInfer, subFolders['02_ОБРОБЛЕНІ']).
11. `ocrService.extractText({ id: driveId, name, mimeType, subFolders })` — OCR провайдери (`pdfjsLocal`, `documentAi`, `claudeVision`) **самі завантажують байти з Drive по id** через `driveRequest(.../files/${id}?alt=media)`. Жодного локального Blob fetch у onSubmit не потрібно.
12. Копія тексту з'являється в `02_ОБРОБЛЕНІ` (через `writeCache` всередині `extractText`).
13. Корекція `documentNature` + `lastOcrAt` через `update_document` (така сама логіка як у file picker гілці після micro-TASK 4: pdfjsLocal → 'searchable', інше → 'scanned').

**Замість того щоб витягувати Blob у `onSubmit` через `gapi.client.drive.files.get` як описано у TASK кроці 2 — використано **той самий шлях** що для file picker:** ocrService приймає файл-дескриптор з `id`, провайдери самі знають як читати з Drive. Це уникає дублікату коду (Blob fetch уже є в `pdfjsLocal:51`, `documentAi`, `claudeVision`) і повністю переюзовує існуючу OCR інфраструктуру.

---

## 4. Інструкція адвокату — як перевірити

1. Відкрити справу де є Drive-папка з кількома файлами в 01_ОРИГІНАЛИ (наприклад, нова справа де щось завантажено вручну через Drive UI).
2. Видалити документ #8 "Адвокатський запит держспоживслужба" з реєстру Кісельової (Trash button у Viewer).
3. Натиснути "+ Додати документ".
4. Заповнити Назва, Тип, Від кого.
5. **НЕ натискати дропзону.** Натиснути секцію `[> ☁ Або вибрати файл вже на Drive (з папки 01_ОРИГІНАЛИ)]` нижче.
6. Зачекати 1-2 сек поки список вантажиться. Знайти "запит держпродспоживслужба .pdf".
7. Натиснути на файл → бачите file card з його іменем і розміром.
8. Натиснути "Додати документ".
9. Очікуваний результат:
   - Toast "Документ додано. Розпізнаю текст..." з'являється
   - Через 5-30 сек — toast "Документ додано і розпізнано"
   - У реєстрі: `driveId="1...РЕАЛЬНИЙ_ID..."`, `lastOcrAt="2026-05-09T..."`, `documentNature="scanned"` (або "searchable" якщо PDF з текстовим шаром)
   - У Drive-папці 02_ОБРОБЛЕНІ з'являється файл `запит_держпродспоживслужба__<id>.txt`
10. У Viewer — кнопка "Перерозпізнати" з'являється для scanned, текст відкривається у режимі Текст.

**Якщо щось не так** — у звіті розділ "Що НЕ зроблено" (нижче).

---

## 5. Що НЕ зроблено і чому

### 5.1. Google Drive Picker UI (повноцінний `google.picker.PickerBuilder`)

TASK у пункті 1 згадує "Drive picker callback повертає driveId і метадані файла". Класична реалізація — Google Picker API (`https://apis.google.com/js/api.js` + `gapi.load('picker', ...)`). Не використано бо:

- Picker API вимагає `developerKey` (Google Cloud API key) — у системі немає (`grep VITE_, GOOGLE_API_KEY, developerKey` — нічого).
- Інтеграція Picker — окрема значна робота (~1 день, нові залежності, OAuth scope перевірки).
- Користувач сказав "**мінімальний фікс важливіший за елегантний рефакторинг**".

**Альтернатива що зроблена:** простий список файлів з case's `01_ОРИГІНАЛИ` через існуючий `driveRequest`. Покриває **головний use case**: адвокат завантажив файл вручну в папку справи на Drive, і хоче його зв'язати з реєстром.

**Обмеження:** не можна вибрати файл з довільного місця Drive, тільки з `01_ОРИГІНАЛИ` поточної справи. Якщо адвокату це потрібно — окремий мікро-TASK на Picker з `developerKey`.

### 5.2. Backfill для документа #8

TASK явно сказав "НЕ роби backfill для існуючого документа #8 — адвокат сам видалить і додасть наново після фіксу". Не робив.

### 5.3. Ніяких змін у extractText, ocrService, DocumentViewer

Згідно зі скоупом TASK ("Поза скопом").

### 5.4. Safe-area / Android gesture overlap

Окремий майбутній мікро-TASK 4.2 (`diagnostic_safe_area_consultation.md`).

### 5.5. Об'єднання гілок

TASK дозволяв об'єднати дві гілки в один pipeline якщо без ризику регресії. Розмірковував — після фіксу різниця між гілками обмежена 4-ма рядками в `onSubmit`:

```js
if (file?._isDriveSource && file?._driveId) {
  driveId = file._driveId;
} else if (file && driveConnected) {
  prepared = await prepareFile(file);
  driveId = await uploadFileLocal(prepared, caseData);
}
```

Подальший pipeline (createDocument, add_document, OCR, update_document) — **уже спільний** для обох гілок. Об'єднання у "ще одну функцію" нічого не виграє: гілки різні бо мають різну природу (File з пристрою vs Drive ref). Маркер `_isDriveSource` достатньо явний.

---

## Тести

```
Test Files  35 passed (35)
Tests       422 passed (422)
```

`tests/unit/AddDocumentModal.test.jsx` — 5 тестів зелені. CASE у тестах не має `storage.subFolders` → Drive picker секція не рендериться → тести не зачеплено.

Не додавав окремий unit-тест для DrivePickerSection бо:
- Логіка `loadDriveFiles` вимагає мока `driveRequest` (мережевий шар) — додав би 30+ рядків harness'у заради 1 тесту.
- Інтеграційний тест з реальним Drive — неможливий у CI (нема токену).
- Поведінка `handleDrivePick` (формування marker) — детерміністична, перевіряється під час реального використання.

**Рекомендую** окремо: тест маркера у `_actionsHarness.js` коли там додаватимуть симуляцію source-aware add_document.

---

## Що тепер може зламати file picker

**Нічого** — гілка `else if (file && driveConnected)` повторює оригінальну логіку 1-в-1. Перевірив diff:

```diff
- if (file && driveConnected) {
+ if (file?._isDriveSource && file?._driveId) {
+   driveId = file._driveId;
+ } else if (file && driveConnected) {
    try {
      prepared = await prepareFile(file);
      driveId = await uploadFileLocal(prepared, caseData);
    } catch (err) { ... }
  }
```

Старий шлях активний для всіх файлів які НЕ марковані `_isDriveSource` — тобто всіх реальних `File` об'єктів з input/drag-n-drop.
