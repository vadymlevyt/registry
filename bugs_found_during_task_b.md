# Знайдені баги під час TASK B (склейка зображень у PDF)

**Дата:** 2026-05-12
**Виконавець:** Claude Code Opus 4.7 (1M context)
**Скоуп:** проблеми зафіксовано і **виправлено** під час тестування адвокатом на сайті.
**Коміти:** `349e046`, `78e6d3b`.

---

## 1. Drive picker відсутній у обох режимах AddDocumentModal

**Серйозність:** висока (UX-блокер — адвокат не міг додати файл з Drive).
**Виявлено:** адвокат при тестуванні TASK B.
**Виправлено у:** `349e046`.

### Симптом

У модалці «Додати документ» кнопки / секції вибору файлу з Google Drive
не було ні у `📄 Додати файл` (single mode), ні у `🖼 Склеїти зображення`
(merge mode). Адвокат бачив лише device file picker. Раніше у TASK A
кнопка з Drive працювала.

### Корінь проблеми

Render-гейт DrivePickerSection у `AddDocumentModal.jsx` був:

```jsx
const driveFolderId = caseData?.storage?.subFolders?.['01_ОРИГІНАЛИ'];
{driveFolderId && !state.file && <DrivePickerSection ... />}
```

Тобто picker показувався **тільки якщо у каси вже створена підпапка
`01_ОРИГІНАЛИ` на Drive**. Для свіжих справ і справ де структура
папок ще не була створена цей гейт відсікав picker повністю.

Те саме у merge mode:
```jsx
onOpenDrivePicker={driveFolderId ? () => setMergeDrivePickerOpen(true) : null}
```

### Виправлення

1. CaseDossier передає `driveConnected` prop'ом у AddDocumentModal.
2. Гейт переписано з `driveFolderId &&` на `driveConnected &&`.
3. `initialFolderId` падає на `'root'` коли case-папка ще не створена —
   DrivePickerSection все одно дозволяє навігувати по всьому Drive
   через breadcrumb. Сам файл з Drive приймається з будь-якого
   місця, не лише з 01_ОРИГІНАЛИ справи.

### Чому це не було виявлено раніше

Smoke-тести `ImageMergePanel.test.jsx` перевіряли тільки те що кнопка
«Додати з Drive» рендериться коли prop `onOpenDrivePicker` переданий
(і ховається коли null). Не покривали реальний потік де parent
вирішує `null` чи функція на основі caseData.

### Тести-регресія

`AddDocumentModal.test.jsx` — 5 нових кейсів видимості Drive picker:
single/merge × `driveConnected=true/false` + випадок коли case вже має
01_ОРИГІНАЛИ підпапку.

---

## 2. OCR pipeline ігнорував `file.localBlob` — device файли неможливо було OCR'нути

**Серйозність:** середня (pipeline не падав, але втрачав текст для агента
сортування і витрачав мережевий round-trip на 404).
**Виявлено:** під час аналізу зависання pipeline'у.
**Виправлено у:** `349e046`.

### Симптом

При склейці device-файлів (адвокат вибрав фото з пристрою) OCR
повертав порожній текст. Агент сортування отримував `ocrText: ''`
для всіх зображень — якість сортування деградувала, агент догадувався
тільки за іменами файлів.

### Корінь проблеми

`multiImageToPdf.ocrOneImage` для device файлів будував `ocrFile`
з фейковим id `local_<timestamp>_<rand>` і полем `localBlob: file`.
Усі три OCR провайдери (`documentAi.js`, `claudeVision.js`,
`pdfjsLocal.js`) НЕ перевіряли `file.localBlob` — одразу викликали
`driveRequest('/files/local_xxx?alt=media')` → Drive повертає 404
→ `throw makeError('NETWORK', ...)`. Pipeline ловив помилку
і продовжував з порожнім text.

Коментар у multiImageToPdf обіцяв: «ocrService витягне через
FileReader / Document AI» — але цієї логіки ніде не було.

### Виправлення

У `documentAi.extract` і `claudeVision.extract` додано preflight:

```js
let arrayBuffer;
if (file.localBlob instanceof Blob) {
  arrayBuffer = await file.localBlob.arrayBuffer();
} else {
  const dl = await driveRequest(`.../files/${file.id}?alt=media`);
  ...
  arrayBuffer = await dl.arrayBuffer();
}
```

Один сенс: «джерело байт — або in-memory Blob, або Drive download
за id». Без розширення інших полів — той самий результат, два чесних
джерела.

### Тести-регресія

`ocrDocumentAiRetry.test.js` — кейс `localBlob source`: `documentAi.extract`
читає байти з localBlob і НЕ викликає driveRequest для download.

---

## 3. КОРЕНЕВИЙ БАГ: preview зникала після завершення pipeline'у

**Серйозність:** критична (TASK B повністю не працював end-to-end).
**Виявлено:** адвокат при повторному тестуванні після виправлень №1 і №2.
**Виправлено у:** `78e6d3b`.

### Симптом

Адвокат вибирав 2 фото, натискав «Створити PDF». Прогрес-бар
послідовно проходив усі фази: preparing → heic → ocr → sort →
rotate → pdf (всі ставали зеленими). На фазі pdf модалка «зникала»
— насправді ImageMergePanel розмонтовувався і повертався стартовий
екран AddDocumentModal з двома кнопками. Preview не відкривався,
документ не створювався, без toast'у з помилкою.

### Корінь проблеми

`AddDocumentModal.jsx` мав `useEffect` що скидав весь state модалки
(включно з `mode`) на стартовий екран:

```jsx
useEffect(() => {
  if (isOpen) {
    setState(initialState(caseData));
    ...
    setMode(null);
  }
}, [isOpen, caseData]);
```

`caseData` у deps. Але CaseDossier передає:

```jsx
caseData={{ ...caseData, proceedings }}
```

Spread створює **новий обʼєкт-референс на КОЖНОМУ рендері** CaseDossier.

Ланцюг що ламав preview:

1. `convertImagesToPdf` завершується успішно — повертає валідний `pdfBlob`
   і `finalOrder`.
2. `converterService.convertImagesToPdf` у самому кінці робить
   `reportActivity('images_merged', ...)`.
3. `activityTracker.sink` (налаштований у `App.jsx:3733`) робить
   `setTimeEntries(prev => [...prev, entry])` + `setBillingMeta(...)`.
4. App.jsx ре-рендерить → CaseDossier ре-рендерить.
5. Свіжий `{ ...caseData, proceedings }` спред → у AddDocumentModal
   новий `caseData` референс.
6. useEffect deps `caseData` спрацьовує → `setMode(null)` mid-preview.
7. ImageMergePanel розмонтовується → blob URLs очищаються →
   стартовий екран замість preview.

Адвокат бачив це як «модалка зникла» — насправді merge view замінився
стартовими кнопками.

### Чому це не відкрилось у тестах раніше

Smoke-тести ImageMergePanel і AddDocumentModal перевіряли:
- рендер initial state кожного mode окремо
- кліки по кнопках
- submit-форму

Жоден тест НЕ перевіряв сценарій «parent ре-рендерить модалку
з новим caseData референсом під час того як ImageMergePanel у
mid-flight pipeline». Це тонкий React lifecycle сценарій який
покривається лише цілеспрямованим тестом з `rerender()`.

### Виправлення

useEffect deps — лише `[isOpen]`. Reset потрібен ТІЛЬКИ при
переході false→true (відкритті модалки), не на parent re-renders.
`caseData` читається у closure через `initialState(caseData)` —
це коректна одноразова ініціалізація при відкритті.

```jsx
// caseData свідомо виключено — інакше будь-яке оновлення case
// з parent'а (включно з activityTracker.report → setTimeEntries
// у App.jsx наприкінці успішного pipeline'у convertImagesToPdf)
// триггерить спред {...caseData} в CaseDossier і скидає всю
// модалку на стартовий екран, mid-merge.
// eslint-disable-next-line react-hooks/exhaustive-deps
useEffect(() => {
  if (isOpen) {
    setState(initialState(caseData));
    ...
    setMode(null);
  }
}, [isOpen]);
```

### Тести-регресія

`AddDocumentModal.test.jsx` — 2 нові регресійні кейси через `rerender()`:

1. **mode НЕ скидається** коли parent ре-рендерить з новим caseData
   обʼєктом. Симуляція: `rerender(<...caseData={{ ...CASE }} ...>)`
   після переходу у merge mode. Очікування: merge view лишається.

2. **mode скидається** коли isOpen false → true (свіже відкриття).
   Симуляція: rerender з isOpen=false потім isOpen=true. Очікування:
   стартовий екран з кнопками.

---

## Урок для майбутніх TASK

### Принцип однозначності (CLAUDE.md правило №11)

Кожен useEffect має один сенс. Цей useEffect мав ДВА сенси:
1. «Ініціалізувати state при відкритті модалки» (правильне намір).
2. «Ре-ініціалізувати state коли caseData змінився» (ненавмисний).

Другий сенс ніхто не закладав свідомо — він з'явився механічно
з ESLint rule `react-hooks/exhaustive-deps`. Coupling із spread'ом
у parent'і зробив його активним і шкідливим.

**Перевірка для майбутнього**: коли у useEffect deps попадає
обʼєкт що приходить з props — спитати «чи парент гарантує
референс-стабільність?». Якщо ні (особливо при spread'ах) —
це або баг очікує своєї години, або deps треба звужувати, або
парент-prop треба меморизувати.

### React Strict Mode дзеркало

Strict Mode подвоює виклики useEffect у dev. Якби adv тестував
у dev build з React Strict Mode, баг проявився б одразу — кожен
рендер парент'а викликав би скид модалки двічі. У production build
це проявилось лише наприкінці pipeline'у через каскад
`reportActivity → setTimeEntries → re-render → spread → reset`.

### Контракти між sink і UI

`activityTracker.sink` робить `setTimeEntries` — це state-update що
каскадить через все дерево App.jsx. Будь-який useEffect що залежить
від парент-обʼєктів (особливо spread'ів) може спрацювати з цього
каскаду. Це сильний аргумент за **деривацію** замість spread:

```jsx
// замість:
caseData={{ ...caseData, proceedings }}

// краще:
caseData={caseData}
proceedings={proceedings}
```

Окремий prop'ом — без зміни референсу caseData при ре-рендерах
батьків. Це окремий рефакторинг (поза TASK B), додано до
`recommended_task_claude_md_audit.md` як кандидат на майбутній TASK.

---

**Кінець звіту**
