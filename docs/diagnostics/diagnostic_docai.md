# Діагностика перед інтеграцією Google Document AI

Дата: 2026-04-26
Гілка: main
Скоуп: тільки аналіз. Жоден файл не змінено.

---

## 1. Поточне читання файлів у досьє

### Де
`src/components/CaseDossier/index.jsx`, функція `handleCreateContext` → внутрішня async-функція `readFileContent(file, accessToken)`.

### Як
Усе читання — клієнт-сайд у браузері (`pdfjs-dist`, `TextDecoder`). Жодного OCR. PDF-скани конвертуються в PNG і відправляються в Claude Vision як image-blocks.

Ключові рядки:

| Що | Файл:рядок |
|---|---|
| Імпорт pdfjs | `index.jsx:2` — `import * as pdfjsLib from 'pdfjs-dist'` |
| Початок функції | `index.jsx:400` — `async function readFileContent(file, accessToken)` |
| Google Doc → text/plain | `index.jsx:402–408` |
| Завантаження байтів з Drive | `index.jsx:411–415` (`/files/${file.id}?alt=media` → `arrayBuffer()`) |
| Перевірка ZIP-PDF (ЄСІТС) | `index.jsx:419–423` — кидає виняток, не обробляється |
| Витяг текстового шару | `index.jsx:425–433` — `pdf.getPage(i).getTextContent()` |
| Тип 1: текстовий PDF | `index.jsx:434–436` — якщо текст > 50 симв, повертає `{type:'text'}` |
| Тип 2: скан → PNG canvas | `index.jsx:438–450` — `canvas.toDataURL('image/png')` як base64 |
| Інші формати → UTF-8 | `index.jsx:454–458` |
| Цикл по всіх файлах | `index.jsx:466–484` |
| Виклик Claude API | `index.jsx:550–564` (`claude-sonnet-4-20250514`) |

### Обмеження (кількість і розмір)

| Параметр | Значення | Рядок |
|---|---|---|
| pageSize Drive listing | 100 файлів на папку | `index.jsx:360` |
| Текстових сторінок на PDF | `Math.min(pdf.numPages, 10)` | `index.jsx:428` |
| Скан-сторінок на PDF | `Math.min(pdf.numPages, 5)` | `index.jsx:440` |
| scale рендеру PNG | 1.5 | `index.jsx:443` |
| max_tokens Claude | 8192 | `index.jsx:560` |
| Slice text для не-PDF | `text.slice(0, 100000)` | `index.jsx:456` |
| ZIP-PDF з ЄСІТС | НЕ підтримується (throw) | `index.jsx:421–423` |

### Ризики поточного підходу
- Скан-PDF старший 5 сторінок → втрачаються сторінки 6+.
- Всі image-blocks летять в одному запиті до Claude → токени і ціна стрибають у разі багатьох сканів.
- pdfjs у браузері не дає реального OCR; «текстовий шар» сканованого PDF часто пустий — фолбек у vision відправляє по 5 PNG, що дорого і не дає індексованого тексту, який можна було б зберегти.
- Підписані PDF (ЄСІТС, p7s/asic) узагалі не читаються.

---

## 2. Drive-інтеграція в досьє

### Сервісний шар
`src/services/driveService.js` (238 рядків) і `src/services/driveAuth.js` (117 рядків — silent-refresh + єдиний `driveRequest` wrapper).

### Структура папок справи (фіксовано)
`driveService.js:11–17`:

```
01_АКТИВНІ_СПРАВИ/
  └─ <Case_Name>/
      ├─ 01_ОРИГІНАЛИ
      ├─ 02_ОБРОБЛЕНІ
      ├─ 03_ФРАГМЕНТИ
      ├─ 04_ПОЗИЦІЯ
      └─ 05_ЗОВНІШНІ
00_INBOX/        ← глобальний, на рівні Drive (не підпапка справи)
_backups/        ← registry_data_*.json, авторотація 7 копій
```

### Експортовані функції (driveService.js)

| Функція | Рядки | Призначення |
|---|---|---|
| `getFolderForDocument(category)` | 31–33 | Маппінг категорії → ім'я підпапки |
| `findOrCreateFolder(name, parentId, token)` | 35–62 | Знайти або створити папку |
| `createCaseStructure(caseName, token)` | 64–82 | Створює `01_АКТИВНІ_СПРАВИ`, `00_INBOX`, папку справи + 5 підпапок |
| `uploadFileToDrive(fileName, fileBlob, parentFolderId, token)` | 84–106 | Multipart upload, повертає `{id,name,webViewLink}` |
| `listFolderFiles(folderId, token)` | 108–115 | До 100 файлів |
| `backupRegistryData(token, casesData)` | 138–175 | Бекап в `_backups/`, ротація 7 |
| `getDriveFiles(folderId, token)` | 194–202 | Те саме що list, дублікат |
| `readDriveFile(fileId, token)` | 204–210 | `?alt=media` як text |
| `createDriveFile(folderId, fileName, content, token)` | 212–228 | Текстовий upload |
| `updateDriveFile(fileId, content, token)` | 230–238 | PATCH |
| `isDesktop()`, `selectLocalFolder()`, `saveFileLocally()` | 119–134, 177–190 | Desktop-only File System Access API |

### Як файли потрапляють у Drive у досьє

1. **Drag-and-drop у вкладці «Документи»** — `index.jsx:1517–1595`. Файли стають у `dropQueue`, далі кнопка «Завантажити на Drive» викликає `uploadFileLocal` (`index.jsx:828–845`) — кладе в `caseData.driveFolderId` (це root папки справи, **не** в `01_ОРИГІНАЛИ`).

2. **Модалка «+ Додати документ»** — `index.jsx:2086–2115`. Викликає той самий `uploadFileLocal` → теж у root, не в `01_ОРИГІНАЛИ`.

3. **Створення структури** — `index.jsx:651–673` через `handleCreateDriveStructure` → `createCaseStructure(caseName, token)` → пише `caseData.storage = {driveFolderId, driveFolderName, ...}`.

4. **DocumentProcessor (інша вкладка/модуль)** — `src/components/DocumentProcessor/index.jsx:575–627` — це єдине місце, де файли реально розкладаються по підпапках через `getFolderForDocument(category)` і `driveStructure.subFolders[folder]`. Класифікований PDF → `02_ОБРОБЛЕНІ`, некласифікований → `01_ОРИГІНАЛИ` (рядок 692). Тут також робиться `compressPDF` через `pdf-lib` (`index.jsx:663`).

### Знайдена невідповідність
Drag-and-drop і модалка в досьє кладуть файли в **root папки справи**, а не в `01_ОРИГІНАЛИ`. Підпапки створюються `createCaseStructure`, але `uploadFileLocal` (`CaseDossier/index.jsx:831–834`) використовує `cData.driveFolderId` без вибору підпапки. У `caseData.storage.subFolders` ID підпапок не зберігаються (тільки `driveFolderId` parent). Для OCR-флоу це треба виправити.

---

## 3. case_context.md

### Де формується
Один-єдиний шлях: `src/components/CaseDossier/index.jsx` → функція `handleCreateContext` (`index.jsx:254–637`). Тригер — кнопка в досьє.

### Що туди записується (system prompt)
Чисто текстовий Markdown від Claude Sonnet (`index.jsx:496–523`):

```
# Справа <name> <case_no>
Створено: YYYY-MM-DD
## Огляд справи
## Сторони і позиції
## Документи
## Ключові факти і докази
## Хронологія подій
## Слабкі місця
## Спостереження
```

### Як оновлюється

| Крок | Рядки |
|---|---|
| 1. Перевірка існуючого `case_context.md` | 273–298 (питає підтвердження `systemConfirm`) |
| 2. Шукає `02_ОБРОБЛЕНІ` (NFC-нормалізація) | 343–344 |
| 3. Фолбек на `01_ОРИГІНАЛИ` якщо порожньо | 383–386 |
| 4. Виключає `agent_history.json`, `case_context.md` | 365–368 |
| 5. Читає кожен файл (`readFileContent`) | 466–484 |
| 6. Запит до Claude Sonnet | 550–564 |
| 7. Архівування старого: copy → `archive/case_context_<date>.md`, потім DELETE | 583–599 |
| 8. Завантаження нового `case_context.md` | 602–607 (`uploadFileToDrive` в root папки справи) |
| 9. Перечитка локального стану `caseContext` | 626–629 |

### Завантаження для агента
`loadCaseContext` (`index.jsx:111–128`) — викликається при mount і на події `drive-token-refreshed`. Шукає `case_context.md` у root папки справи, читає через `readDriveFile`.

### Поточні слабкості
- Текст витягається в браузері без OCR — для сканованих PDF Claude отримує PNG, тобто **`case_context.md` створюється на vision-аналізі, а не на тексті**. Текст сканів не зберігається ніде.
- Немає інкрементного оновлення — кожен раз перечитуються всі файли і ллється повний промпт.
- `archive/case_context_<date>.md` — якщо створювати двічі за день, перезаписує однойменний файл (в коді не перевіряється колізія).

---

## 4. Архітектурна пропозиція для `src/services/ocrService.js`

### Розташування
`src/services/ocrService.js` поряд з `driveService.js` і `driveAuth.js`. Сервісний шар уже існує — туди логічно додати ще один сервіс. Жодного компонента це не зачіпає.

### Інтерфейс (мінімум)

```js
// src/services/ocrService.js

/**
 * Provider Pattern. Один публічний фасад, кілька providers під капотом.
 * Споживач (досьє, агенти) знає тільки про extractText / extractTextBatch.
 */

export async function extractText(file, options = {}) {
  // file: { name, mimeType, arrayBuffer | blob | driveFileId }
  // options: { provider?, signal?, onProgress? }
  // returns: { text, pages?, provider, durationMs, warnings: [] }
}

export async function extractTextBatch(files, options = {}) {
  // files: масив тих самих об'єктів
  // options: { provider?, concurrency?, onProgress?, signal? }
  // returns: масив { name, text, error?, provider, ... } у тому ж порядку
}

// Реєстрація провайдера — для майбутнього розширення
export function registerProvider(name, providerImpl) { ... }
export function setDefaultProvider(name) { ... }
```

### Внутрішня структура

```
src/services/
  ocrService.js              ← фасад, registry, batch logic, retries
  ocr/
    documentAi.js            ← Google Document AI (перший провайдер)
    claudeVision.js          ← Claude Vision як фолбек (вже є логіка в досьє)
    pdfjsLocal.js            ← локальний витяг текстового шару (для текстових PDF)
```

Кожен провайдер експортує однаковий контракт:
```js
export default {
  name: 'documentAi',
  canHandle(file) { return file.mimeType === 'application/pdf' || ...; },
  async extract(file, options) { return { text, pages, warnings }; }
}
```

Фасад `ocrService.extractText` сам вибирає провайдера: якщо PDF має текстовий шар > N симв — `pdfjsLocal`; інакше — `documentAi`; якщо `documentAi` повернув помилку (квота, нерозпізнаний формат) — фолбек на `claudeVision`. Логіка вибору живе в фасаді, не в споживачів.

### Підключення Google Document AI

**Параметри:**
- Project ID: `registry-ab-levytskyi`
- Processor ID: `2cc453e438078154`
- Region: `europe-west2`
- Endpoint: `https://eu-documentai.googleapis.com/v1/projects/registry-ab-levytskyi/locations/eu/processors/2cc453e438078154:process`

> Увага: `europe-west2` — це регіон Compute. У Document AI v1 локації кодуються як `eu` або `us` (мульти-регіон), або `eu-west2` для специфічних. Перед стартом треба підтвердити в Google Cloud Console який саме endpoint видається для процесора `2cc453e438078154` — там буде або `https://eu-documentai.googleapis.com` (multi-region EU), або `https://europe-west2-documentai.googleapis.com` (single region). Це потрібно з'ясувати до коду.

**Аутентифікація — критичне питання**

Document AI вимагає OAuth2 access token зі scope `https://www.googleapis.com/auth/cloud-platform`. Поточна авторизація (`driveAuth.js:10`) має тільки `https://www.googleapis.com/auth/drive`. Варіанти:

1. **Розширити scope GIS-токена** — `DRIVE_SCOPE` стає `'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/cloud-platform'`. Користувач один раз перепідтверджує, далі один токен працює і для Drive, і для Document AI. Найпростіший шлях; нікого нового додавати не треба, `driveRequest` залишається.
   - **Ризик**: GCP за замовчуванням не дозволяє довільному GIS-клієнту виходити на `cloud-platform` — потрібно перевірити OAuth consent screen у проекті `registry-ab-levytskyi`.
2. **Окремий serverless-проксі** (Cloud Function / Cloud Run) — браузер шле PDF на `/ocr`, проксі уже з service account іде в Document AI. Безпечніше, але додає інфру і не вписується в чисто статичний GitHub Pages.
3. **API key (без OAuth)** — Document AI цього не підтримує. Відкидаємо.

Рекомендація: **варіант 1** на першу інтеграцію. Пишемо в `ocrService.js`/`ocr/documentAi.js`, токен беремо з `getDriveToken()` (з тим самим silent-refresh), endpoint посилаємо як `Authorization: Bearer`.

**Тіло запиту (sync `:process`):**

```js
POST <endpoint>:process
Body: { rawDocument: { content: <base64-PDF>, mimeType: 'application/pdf' } }
```

Обмеження sync API: 30 сторінок або 20 МБ на запит. Більше — `batchProcess` через GCS, що вимагає bucket. На старті — sync, з falling-back на split PDF (вже маємо `pdf-lib` у `package.json`).

### Як зберегти можливість додати інший провайдер

- `ocrService.js` тримає `Map<name, provider>` і не імпортує конкретні провайдери як хардкод — лише реєструє при старті:
  ```js
  import documentAi from './ocr/documentAi.js';
  import claudeVision from './ocr/claudeVision.js';
  import pdfjsLocal from './ocr/pdfjsLocal.js';
  registerProvider('documentAi', documentAi);
  registerProvider('claudeVision', claudeVision);
  registerProvider('pdfjsLocal', pdfjsLocal);
  ```
- Споживач (досьє) ніколи не імпортує `ocr/*` напряму — тільки `extractText`/`extractTextBatch`.
- Додати нового провайдера = один новий файл у `ocr/` + `registerProvider`. Жодного коду в досьє чи DocumentProcessor чіпати не треба.
- Це той самий принцип «стільника», що описаний у `CLAUDE.md` для UI-модулів — автономний, loose coupling.

---

## 5. Перша задача end-to-end

### Цільовий флоу

```
[Користувач у досьє]
   │  drag-and-drop або «+ Додати документ»  [N файлів]
   ▼
[CaseDossier]
   │  prepareFile() — HEIC→JPEG конверсія
   ▼
[uploadFile → 01_ОРИГІНАЛИ на Drive]                     ← КРОК A
   │  (зараз льє у root, треба в subFolders['01_ОРИГІНАЛИ'])
   ▼
[ocrService.extractTextBatch(files)]                     ← КРОК B
   │  - pdfjsLocal якщо є текстовий шар
   │  - documentAi для сканів
   │  - claudeVision як fallback
   ▼
[Збереження тексту: <originalName>.txt у 02_ОБРОБЛЕНІ]   ← КРОК C
   ▼
[Агент Sonnet з усім текстом + метаданими справи]        ← КРОК D
   ▼
[case_context.md → root папки справи]                    ← КРОК E
```

### Що вже реалізовано

| Крок | Стан | Де |
|---|---|---|
| A — створення структури папок | ✅ повністю | `driveService.js:64–82`, `CaseDossier:651–673` |
| A — upload у Drive (root папки) | ✅ є, але не в `01_ОРИГІНАЛИ` | `CaseDossier:828–845`, `DocumentProcessor:601–611` (там у правильну підпапку) |
| B — extractText | ❌ немає сервісу | бракує `ocrService.js` |
| B — браузерний pdfjs (текстовий шар) | ✅ як inline-логіка | `CaseDossier:425–436` |
| B — Claude Vision | ✅ як inline-логіка | `CaseDossier:438–450, 530–540` |
| C — збереження `.txt` у `02_ОБРОБЛЕНІ` | ❌ немає | — |
| D — агент Sonnet з текстом | ✅ повністю | `CaseDossier:496–572` |
| E — `case_context.md` upload + архів | ✅ повністю | `CaseDossier:580–614` |

### Що треба додати

1. **`src/services/ocrService.js`** + `src/services/ocr/{documentAi,claudeVision,pdfjsLocal}.js`. Контракт у п.4.
2. **OAuth scope `cloud-platform`** у `driveAuth.js:10` — або підтвердити, що буде окремий токен.
3. **Функція upload у конкретну підпапку** — `CaseDossier:828–845` має брати ID `01_ОРИГІНАЛИ`, а не `caseData.driveFolderId`. Це означає: або зберігати `subFolders` у `caseData.storage` (зараз скидається після `createCaseStructure`), або щоразу шукати підпапку через `findOrCreateFolder`. Перше дешевше.
4. **Збереження витягнутого тексту** — нова функція в `driveService.js` або використати наявну `createDriveFile(folderId, fileName, content)` (`driveService.js:212–228`). Файл `<basename>.txt` у `02_ОБРОБЛЕНІ`.
5. **Перепис `handleCreateContext`** — замість inline-читання використовувати `extractTextBatch` і не запускати Claude Vision на кожен скан окремо. Спрощує і здешевлює.
6. **UI-індикатор прогресу** — `extractTextBatch` має `onProgress` callback, в досьє вже є `setContextMsg`.

### Найбільші ризики

| # | Ризик | Мітигація |
|---|---|---|
| 1 | Document AI scope недоступний у поточному GIS OAuth client (потрібен консент `cloud-platform`) | Перевірити в Cloud Console до коду; інакше — варіант з проксі |
| 2 | Sync API ліміт 30 стор / 20 МБ | Розбити PDF через `pdf-lib` перед відправкою; об'єднати текст після |
| 3 | Endpoint регіону невизначений (`eu` vs `europe-west2`) | Підтвердити URL у Cloud Console processor details |
| 4 | Браузерний CORS для `documentai.googleapis.com` | Google APIs зазвичай дозволяють CORS з `Authorization: Bearer`, але треба перевірити; якщо ні — обов'язковий проксі |
| 5 | Ціна: Document AI sync ≈ $1.50 / 1000 стор | Кешувати результат: якщо в `02_ОБРОБЛЕНІ` уже є `<basename>.txt` — не запускати OCR повторно |
| 6 | ZIP-PDF з ЄСІТС (`CaseDossier:421–423`) | Вийде поза скоупом першої ітерації — лишити кидати помилку |
| 7 | Підпапки після `createCaseStructure` втрачаються в state | Розширити `caseData.storage` полем `subFolders: {...}` |
| 8 | Зміна scope зламає існуючі сесії — користувачі побачать повторний consent | Очікувано і прийнятно; задокументувати в LESSONS.md |
| 9 | `CaseDossier:255–259` — guard `handleCreateContext.running` лежить на функції, після зміни на сервіс — стежити, щоб кнопка не дублювала виклик | Перенести guard у локальний state |

---

## Підсумок

Поточна реалізація — це **inline pdfjs + Claude Vision усередині `CaseDossier`**, без сервісного шару OCR і без Document AI. Для впровадження `ocrService.js` потрібно:

1. розширити OAuth scope на `cloud-platform`,
2. вивести читання файлів з `CaseDossier` у новий сервіс із Provider Pattern,
3. навчити досьє завантажувати оригінали в `01_ОРИГІНАЛИ` (зараз — у root),
4. зберігати витягнутий текст у `02_ОБРОБЛЕНІ` як `.txt` (інкрементальне джерело для майбутніх викликів `case_context.md`).

Структура папок, авторизація, upload-функції, агент Sonnet, архівування `case_context.md` — уже працюють і повторного винаходу не потребують.
