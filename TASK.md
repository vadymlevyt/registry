# TASK.md — Сховище: миттєвий UI + повідомлення + Google Picker
Дата: 08.04.2026

## КРОК 0 — ПРОЧИТАТИ LESSONS.md
```bash
cat LESSONS.md
```

---

## КРОК 1 — ДІАГНОСТИКА

```bash
grep -n "handleCreate\|СХОВИЩЕ\|storage\|driveFolderId\|alert(\|prompt(" src/components/CaseDossier/index.jsx | head -30
grep -n "script\|gapi\|picker\|googleapis" index.html src/App.jsx | head -20
```

---

## КРОК 2 — МИТТЄВЕ ОНОВЛЕННЯ UI

Проблема: після updateCase() новий стан приходить в props не одразу — треба F5.

```jsx
// Додати в CaseDossier
const [storageState, setStorageState] = useState(caseData.storage || {});

useEffect(() => {
  setStorageState(caseData.storage || {});
}, [caseData.storage]);

// В handleCreateDriveStructure після успіху:
const storageData = {
  driveFolderId: caseFolderId,
  driveFolderName: caseFolderName,
  localFolderPath: null,
  lastSyncAt: new Date().toISOString(),
};
updateCase(caseData.id, 'storage', storageData);
setStorageState(storageData); // миттєве оновлення UI

// В рендері блоку Сховище і шапці — використовувати storageState:
const hasFolder = !!storageState?.driveFolderId;
const folderName = storageState?.driveFolderName;
const folderId = storageState?.driveFolderId;
```

---

## КРОК 3 — ЗАМІНИТИ alert() І prompt() НА ВНУТРІШНІ ПОВІДОМЛЕННЯ

```jsx
const [storageMsg, setStorageMsg] = useState('');

const showMsg = (text) => {
  setStorageMsg(text);
  setTimeout(() => setStorageMsg(''), 3000);
};

// Замінити:
// alert('Структуру створено...') → showMsg('✅ Структуру створено')
// alert('Помилка...') → showMsg('❌ ' + e.message)
// prompt('Введіть ID...') → прибрати (замінює Picker)

// Рендер під блоком Сховище:
{storageMsg && (
  <div style={{
    marginTop: 6, fontSize: 12,
    color: storageMsg.startsWith('✅') ? '#4caf50' : '#f44336',
  }}>
    {storageMsg}
  </div>
)}
```

---

## КРОК 4 — GOOGLE PICKER API

### 4А. Підключити в index.html перед </body>:
```html
<script src="https://apis.google.com/js/api.js"></script>
```

### 4Б. Picker API Key
Потрібен окремий API Key (не OAuth client ID).
Google Cloud Console → той самий проект → APIs & Services →
увімкнути "Google Picker API" → Credentials → Create API Key.
Вставити в код як константу PICKER_API_KEY.

Claude Code: залишити placeholder 'PICKER_API_KEY_HERE' — адвокат вставить вручну.

### 4В. Функція openFolderPicker:

```jsx
const PICKER_API_KEY = 'PICKER_API_KEY_HERE';

const openFolderPicker = () => {
  const token = localStorage.getItem('levytskyi_drive_token');
  if (!token) { showMsg('❌ Підключіть Google Drive'); return; }
  if (!window.gapi) { showMsg('❌ Picker API не завантажено'); return; }

  window.gapi.load('picker', () => {
    const foldersView = new window.google.picker.DocsView(
      window.google.picker.ViewId.FOLDERS
    )
      .setSelectFolderEnabled(true)
      .setIncludeFolders(true)
      .setMimeTypes('application/vnd.google-apps.folder');

    const sharedView = new window.google.picker.DocsView(
      window.google.picker.ViewId.FOLDERS
    )
      .setSelectFolderEnabled(true)
      .setIncludeFolders(true)
      .setMimeTypes('application/vnd.google-apps.folder')
      .setEnableDrives(true);

    const picker = new window.google.picker.PickerBuilder()
      .addView(foldersView)
      .addView(sharedView)
      .setOAuthToken(token)
      .setDeveloperKey(PICKER_API_KEY)
      .setTitle('Виберіть папку для справи')
      .setCallback((data) => {
        if (data.action === window.google.picker.Action.PICKED) {
          const folder = data.docs[0];
          const storageData = {
            driveFolderId: folder.id,
            driveFolderName: folder.name,
            localFolderPath: null,
            lastSyncAt: new Date().toISOString(),
          };
          updateCase(caseData.id, 'storage', storageData);
          setStorageState(storageData);
          showMsg(`✅ Папку вибрано: ${folder.name}`);
        }
      })
      .build();

    picker.setVisible(true);
  });
};
```

### 4Г. Кнопка "Змінити" → openFolderPicker:
```jsx
<button onClick={openFolderPicker}>✏️ Змінити папку</button>
```

---

## КРОК 5 — ШАПКА ДОСЬЄ

Знайти в шапці де рендериться "⚠️ Без папки" і замінити
caseData.storage на storageState:

```jsx
{storageState?.driveFolderId ? (
  <span
    onClick={() => window.open(`https://drive.google.com/drive/folders/${storageState.driveFolderId}`, '_blank')}
    style={{ cursor: 'pointer', color: '#4caf50', fontSize: 12 }}
  >
    ☁️ Drive
  </span>
) : (
  <span style={{ color: '#f5a623', fontSize: 12 }}>⚠️ Без папки</span>
)}
```

---

## ПОРЯДОК ВИКОНАННЯ

1. Діагностика
2. Додати storageState + useEffect
3. Замінити alert() і prompt()
4. Підключити gapi в index.html
5. Реалізувати openFolderPicker
6. Кнопка "Змінити" → openFolderPicker
7. Шапка читає storageState

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "feat: storage instant UI, internal messages, Google Picker folder select" && git push origin main
```

## ЧЕКЛІСТ

- [ ] Після "Створити структуру" — кнопка зникає одразу, з'являються "Відкрити" + "Змінити"
- [ ] В шапці "☁️ Drive" з'являється одразу без F5
- [ ] Немає alert() або prompt() в блоці Сховище
- [ ] Зелений/червоний текст замість браузерного вікна, зникає через 3 сек
- [ ] Кнопка "Змінити папку" відкриває Google Picker
- [ ] В Picker видно папки Мого диску і Спільних зі мною
- [ ] Вибрав папку → назва одразу в блоці Сховище і в шапці

## ПІСЛЯ ВИКОНАННЯ — ДОПИСАТИ В LESSONS.md

```
### [2026-04-08] Миттєвий UI після updateCase — локальний state
Додати useState що дзеркалить поле з props.
Оновлювати updateCase() і setLocalState() одночасно.
Синхронізувати через useEffect([caseData.поле]).

### [2026-04-08] Google Picker API
Потребує окремий API Key — публічний, можна в коді.
Скрипт: apis.google.com/js/api.js в index.html.
window.gapi.load('picker', callback) перед використанням.
ViewId.FOLDERS + setSelectFolderEnabled(true) для папок.
setEnableDrives(true) для спільних папок.
```
