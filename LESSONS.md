# LESSONS.md — Інституційна пам'ять розробки
# Legal BMS | АБ Левицького

## ЯК КОРИСТУВАТИСЬ

ВАЖЛИВО: цей файл — довідник при діагностиці, НЕ інструкція до дії.
НЕ змінювати код на основі записів без явного завдання в TASK.md.

КОЛИ звертатись:
- Перша спроба вирішити проблему не дала результату
- Бачиш схожий симптом але не знаєш причину
- Збираєшся робити merge або переписувати великий блок коду
- Щось "злетіло" після попереднього фіксу

КОЛИ НЕ звертатись:
- Прості зміни стилів
- Новий функціонал з нуля
- Очевидні правки одного поля

ЯК ПОПОВНЮЄТЬСЯ:
- Тільки за явною командою в TASK.md
- НЕ дописувати самостійно

---

## УРОКИ

### [АРХІТЕКТУРНИЙ ПРИНЦИП] Universal Panel — найвищий пріоритет інтерфейсу

Це фундаментальний принцип для ВСІХ модулів системи.

Universal Panel (QI + Головний агент) — єдиний глобальний сайдбар.
Живе ТІЛЬКИ в App.jsx. Жоден модуль не містить його і не знає про нього.

ТОЧКА ВХОДУ: одна кругла кнопка ⚡ внизу праворуч (плаваюча, завжди видима).
Кнопка QI у верхньому хедері — ПРИБРАТИ. Залишити тільки круглу кнопку.

ПОВЕДІНКА при відкритті:
- Весь поточний вид (Дашборд / Реєстр / Досьє / будь-який модуль) поступається
  місцем як єдине ціле — зсувається вліво
- Модуль не знає що відбулось — він просто отримав менше ширини
- Universal Panel з'являється справа з рухомою межею

ВКЛАДКИ всередині панелі:
- [⚡ QI] — аналіз документів, введення даних
- [🤖 Агент] — головний агент (поки placeholder)
- Переключення без втрати контексту кожної вкладки

НОВИЙ МОДУЛЬ — чекліст:
□ Модуль НЕ містить QI і НЕ містить Universal Panel
□ Модуль НЕ має position:fixed (тільки App.jsx має fixed)
□ Модуль — flex child в App.jsx, займає весь простір що лишився після Universal Panel
□ Власні панелі модуля (агент, sidebar) — тільки всередині модуля, flex siblings
□ Рухома межа між власними панелями — тільки всередині модуля

---

### [2026-04-08] Реєстр і досьє — взаємовиключний рендер
Симптом: реєстр проступає під досьє
Причина: обидва рендеряться одночасно в App.jsx
Рішення: {!dossierCase && tab === 'cases' && ...} — всі вкладки ховаються коли відкрите досьє
Правило: будь-які два "повноекранні" види — завжди взаємовиключні через умову

---

### [2026-04-08] Universal Panel — глобальний сайдбар з двома вкладками
Universal Panel (QI + Головний агент) належить App.jsx — не будь-якому модулю.
Дві вкладки: [⚡ QI] і [🤖 Агент] — переключення без втрати контексту.
State в App.jsx: showUniversalPanel, universalTab: 'qi'|'agent', panelWidth.
CaseDossier і Дашборд не знають про Universal Panel — він рівнем вище.
При відкритті — весь поточний вид зсувається вліво.
CaseDossier НЕ має position:fixed — він flex child в App.jsx.
position:fixed має тільки кореневий контейнер App.jsx.

---

### [2026-04-08] CaseDossier — правильна flex структура
**Компонент:** src/components/CaseDossier/index.jsx
**Кореневий:** position:absolute (flex child в App.jsx main), overflow:hidden
**Шапка:** flexShrink:0, zIndex:200, position:relative
**Робочий рядок:** flex:1, overflow:hidden, minHeight:0 (КРИТИЧНО)
**Панелі (контент/агент/QI):** position:relative (НЕ absolute)
**Розділювач:** position:relative, zIndex:10
**Агент і QI рендеряться як flex siblings — НЕ як overlay**
**Модалки:** zIndex:300 (вище шапки з 200)

---

### [2026-04-08] Після resizable panels зникають кнопки і QI
**Компонент:** src/components/CaseDossier/index.jsx
**Симптом:** Кнопки шапки зникають або ховаються при скролі. QI не видно. Агент на всіх вкладках.
**Причина:** Resizable panels змінюють stacking context. position:relative або transform на контейнері перекриває елементи вище.
**Правило:** Кореневий контейнер: position:fixed, overflow:hidden. Шапка: position:sticky, zIndex:100. Resizable контейнер: zIndex:1.
**Після будь-яких змін layout — перевіряти чекліст:**
1. Кнопка "← Реєстр" видима
2. Кнопка "Сховати агента" видима і працює
3. QI відкривається і видно
4. Вкладки переключаються
5. На не-overview вкладках агент закритий

---

### [2026-04-07] Агент досьє не передає історію в API
**Компонент:** src/components/CaseDossier/index.jsx
**Симптом:** Агент каже "не пам'ятаю попередніх розмов" — переписка візуально є але в API не передається
**Причина:** У fetch до api.anthropic.com в messages[] — тільки поточне повідомлення
**Рішення:**
```js
const historyForAPI = agentMessages
  .filter(m => m.role === 'user' || m.role === 'assistant')
  .slice(-10)
  .map(m => ({ role: m.role, content: m.content }));
const firstUserIdx = historyForAPI.findIndex(m => m.role === 'user');
const cleanHistory = firstUserIdx >= 0 ? historyForAPI.slice(firstUserIdx) : [];
messages: [...cleanHistory, { role: 'user', content: userMessage }]
```
**Правило:** API вимагає першим role:'user'. Перевіряти при будь-яких змінах fetch.
**Діагностика:** grep -B5 -A30 "fetch.*anthropic" src/components/CaseDossier/index.jsx

---

### [2026-04-06] Merge конфлікт — два варіанти коду в одному файлі
**Симптом:** Дублікати змінних, мертвий код після return, blank page
**Діагностика:** grep -n "<<<<<<\|>>>>>>\|=======" src/components/CaseDossier/index.jsx
**Правило:** Ніколи не залишати обидва варіанти. Вибрати один. Перевіряти після кожного merge.

---

### [2026-04-05] textarea в QI виштовхує кнопки за екран
**Компонент:** QI в src/App.jsx
**Симптом:** Кнопки ховаються за межі екрану на планшеті
**Правило:** textarea ЗАВЖДИ height:120px фіксована. НЕ flex:1, НЕ min-height. Кнопки поза scrollable div з flexShrink:0.

---

### [2026-04-08] Реєстр і досьє — батько і дитина, не паралельні сторінки
**Архітектурний принцип:**
Реєстр (список) і Досьє (розгорнута картка) — НЕ паралельні види.
Досьє — це розгорнута картка справи. Батько і дитина.
Коли дитина (досьє) відкрита — батько (реєстр) не рендерується.

**Правило в коді App.jsx:**
НЕПРАВИЛЬНО:
  <Registry ... />
  {dossierCase && <CaseDossier ... />}

ПРАВИЛЬНО:
  {dossierCase
    ? <CaseDossier ... />
    : currentView === 'registry' && <Registry ... />
  }

**Загальне правило:**
Будь-які два повноекранні види — завжди взаємовиключні через тернарний оператор.

---

### [2026-04-05] Апостроф в українському тексті ламає JS
**Симптом:** Blank page без помилок
**Правило:** Весь україномовний текст — подвійні лапки або шаблонні рядки. Ніколи одинарні.

---

### [2026-04-05] Haiku плутається в чат-командах
**Правило:** Haiku — тільки аналіз документів і JSON. Sonnet — всі чат-команди і розмови з агентом. Не змішувати.

---

### [2026-04-08] Document Processor — реальні дії
Після підтвердження структури — updateCase() з новими documents[].
Матеріали оновлюються автоматично через props.
pdf-lib для нарізки і стиснення — npm install pdf-lib.
Стиснення завжди після будь-якої операції — без підтвердження.
Ніколи не писати "буде в наступній версії".

---

### [2026-04-08] Drive scope — drive замість drive.file
drive.file дозволяє тільки файли створені системою.
Для створення папок і завантаження довільних файлів потрібен scope: drive.
Після зміни scope — очистити токен: localStorage.removeItem('levytskyi_drive_token')
Користувач побачить новий запит дозволу від Google — це нормально.

---

### [2026-04-08] Локальне сховище — тільки десктоп Chrome
File System Access API (showDirectoryPicker) — працює тільки на десктопі.
На Android/iOS — тільки Google Drive.
Перевірка платформи: window.showDirectoryPicker !== undefined && !(/Android|iPhone|iPad/i.test(navigator.userAgent))

---

### [2026-04-08] Drive інфраструктура — scope і структура папок
OAuth scope: drive (не drive.file) — для створення папок і запису файлів.
Після зміни scope — очистити токен: localStorage.removeItem('levytskyi_drive_token')
Структура справи: 01_ОРИГІНАЛИ / 02_ОБРОБЛЕНІ / 03_ФРАГМЕНТИ / 04_ПОЗИЦІЯ / 05_ЗОВНІШНІ
Глобальний 00_INBOX — один для всіх справ, очищається після обробки.
storage поле в об'єкті справи: driveFolderId, driveFolderName, localFolderPath, lastSyncAt
findOrCreateFolder — завжди перевіряти чи існує перед створенням.

---

### [2026-04-08] Миттєвий UI після updateCase — локальний state
Додати useState що дзеркалить поле з props.
Оновлювати updateCase() і setLocalState() одночасно.
Синхронізувати через useEffect([caseData.поле]).

---

### [2026-04-08] Google Picker API — не використовувати на GitHub Pages
Google Picker показує 403 через Content Security Policy на статичних хостингах.
Рішення: власний браузер папок через Drive API v3 (files.list з mimeType folder).
Drive API вже підключений і працює — використовувати його замість Picker.

---

### [2026-04-08] PDF аналіз — document block замість pdfjs рендерингу
Один запит з document block дешевше і точніше ніж пакети зображень.
base64: btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
Формат: { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 }}
pdf-lib: PDFDocument.load() для page count, PDFDocument.create() + copyPages() для нарізки.
splitPDFByDocuments працює з startPage/endPage (1-indexed), конвертує в 0-indexed для copyPages.
Помилка 'Cannot read properties of undefined (reading node)' = неправильний імпорт pdf-lib.
Стиснення: PDFDocument.save({ useObjectStreams: true })
Запис на Drive: multipart upload в 02_ОБРОБЛЕНІ

---

### [2026-04-08] Drive API — root папка
'root' в запиті files.list не завжди працює.
Правильно: спочатку GET /drive/v3/files/root?fields=id
Отримати реальний ID → використовувати в запиті '${realRootId}' in parents

---

### [2026-04-08] Перевірка структури папок Drive
REQUIRED_SUBFOLDERS = ['01_ОРИГІНАЛИ', '02_ОБРОБЛЕНІ', '03_ФРАГМЕНТИ', '04_ПОЗИЦІЯ']
Перевіряти при відкритті досьє і після зміни папки.
Запит: files.list з mimeType=folder і folderId in parents.

---

### [2026-04-08] useRef для збереження файлів між рендерами
uploadedFile і splitPoints зберігати в useRef додатково до useState.
В async функціях читати з ref: uploadedFileRef.current
Closure в async функціях може захопити старе значення state — ref завжди актуальний.

---

### [2026-04-08] Drive підпапки — не фільтрувати по назві в запиті
Запит з name filter в q= ненадійний для кирилиці.
Правильно: отримати всі підпапки без фільтра, порівняти назви в JS.
q="'folderId' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"
потім: const missing = REQUIRED.filter(r => !names.includes(r))
handleCreateDriveStructure має розрізняти: папка є (створити підпапки) vs папки немає (створити все).

---

### [2026-04-08] handleConfirm — uploadedFile може бути null при виклику
Додати console.log на початку для діагностики.
Зберігати в useRef додатково до useState.
В handleSplit читати: const file = uploadedFileRef.current || uploadedFile.

---

### [2026-04-08] DocumentProcessor: onClick={sendChat} передає event як аргумент
onClick={sendChat} — React передає SyntheticEvent як перший аргумент.
Якщо sendChat(overrideText) перевіряє overrideText || chatInput — event truthy, .trim() падає.
Рішення: onClick={() => sendChat()} або typeof overrideText === "string" перевірка.

---

### [2026-04-08] Сховище — мінімальна логіка
Тільки два стани: немає папки (кнопка Створити) і є папка (назва + Відкрити).
Без перевірки підпапок, без статусів, без Змінити.
Додаткова логіка додається поступово після стабільної базової версії.

---

### [2026-04-08] DocumentProcessor — Drive через пропси
Передавати driveFolderId і driveToken як пропси з CaseDossier.
Не читати localStorage напряму всередині Document Processor.

---

### [2026-04-09] Архітектура даних v3 — ключові зміни
hearing_date/time → hearings[] масив об'єктів зі статусами
agentHistory[] → окремий agent_history.json в папці справи
pinnedNotes[] → pinnedNoteIds[] без дублювання тексту
calendarEvents: hearing → hearingId (без дати), reminder → власна дата
documents[] — метадані, не самі файли
Резервне копіювання: _backups/ на Drive, останні 7 копій

---

### [2026-04-09] Повноваження по нотатках
notes розділені по категоріях: cases, general, content, system, records
Кожен агент отримує тільки потрібні категорії
Основа для горизонтальних зв'язків між модулями в майбутньому

---

### [2026-04-09] institutional_memory — MD не JSON
Інтерфейс в Аналізі системи: перегляд, редагування, файл, оновити зараз
Кнопка В базу знань — локальне спостереження → глобальна пам'ять

---

### [2026-04-09] Drive — НІКОЛИ не фільтрувати по кирилиці в query
Отримати всі підпапки без фільтра по назві.
Знайти потрібну в JS: folders.find(f => f.name === '02_ОБРОБЛЕНІ')
Це стосується будь-якого пошуку по назві з кирилицею в Drive API.

---

### [2026-04-09] pinNote — setCases має бути СИНХРОННИМ
pinNote оновлює setCases ОДРАЗУ, Drive зберігає async через useEffect на [cases].
Якщо setCases не викликається — компонент не перерендерюється.

---

### [2026-04-09] Drive — шукати файли БЕЗ фільтра mimeType
Скановані PDF можуть мати різний MIME type на Drive.
Фільтр: trashed=false and mimeType != folder
Потім фільтрувати по розширенню .pdf в JS якщо потрібно.

---

### [2026-04-09] Редагування нотаток — локальний state editingNoteId
useState(null) — при кліці встановити id — показати textarea — зберегти через onUpdateNote

---

### [2026-04-09] isPinned — завжди обчислювати з props, не з локального state
const isPinned = (caseData?.pinnedNoteIds || []).includes(note.id);
Якщо є локальний useState для pinnedNoteIds — видалити.
Тільки тоді кнопка реагує одразу без F5.

---

### [2026-04-09] Кнопка 📌 — правильна логіка
НЕ прикріплена: rotate(-45deg) + color #666 (сіра нахилена)
Прикріплена: rotate(0deg) + color #e53935 (червона вертикальна)
isPinned = (caseData?.pinnedNoteIds || []).includes(note.id)
Виправити в ОБОХ файлах: Notebook і CaseDossier.

---

### [2026-04-09] Drive токен — перехоплювати 401
status 401 = токен протух, не баг коду.
Показати: "Токен Drive протух. Натисніть Підключити Drive."

---

### [2026-04-13] PDF файли — три типи, три підходи
Система має автоматично визначати тип PDF і обирати правильний підхід.
Це НЕ опціональна функція — без цього контекстний файл буде неповним.

ТИП 1 — Текстовий PDF (є текстовий шар):
pdfjs extractText → якщо text.length > 50 → передати як document block в Claude API

ТИП 2 — PDF скан (зображення всередині PDF, текстовий шар порожній):
pdfjs extractText → text.length < 50 → конвертувати кожну сторінку в PNG через canvas:
  page.render({canvasContext, viewport}) → canvas.toDataURL('image/png') → base64
Передати як image blocks в Claude API (максимум 5 сторінок на файл).

ТИП 3 — ZIP замаскований під PDF (файли з Електронного суду ЄСІТС):
zipfile.is_zipfile() перевірка → якщо ZIP → розпакувати → читати JPEG/TXT всередині
Правило: ЗАВЖДИ перевіряти is_zipfile() перед читанням будь-якого .pdf з ЄСІТС.

ПРАВИЛО: жоден файл не пропускається мовчки.
Якщо файл не вдалось прочитати — додати в контекст: "[Файл: назва — помилка читання: опис помилки]"

---

### [2026-04-11] QI точкові фікси
- update_deadline: deadline_date !== undefined замість truthy перевірки (дозволяє очищення)
- PDF Vision поріг: 20 → 50 символів (фільтрує артефакти сканів)
- extractShortName: одна функція на рівні модуля (було дублювання)
- SONNET_CHAT_PROMPT: прибрати navigate_calendar/week — це зона дашборду
- HAIKU_SYSTEM_PROMPT: прибрати save_to_drive — не реалізовано
- Принцип перевірки: агент звіряє з реєстром перед дією
