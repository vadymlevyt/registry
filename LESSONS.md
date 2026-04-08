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
