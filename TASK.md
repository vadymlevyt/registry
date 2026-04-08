# TASK.md — Drive інфраструктура: папка справи + INBOX
Дата: 08.04.2026

## СУТЬ ЗАВДАННЯ

Реалізувати фундамент для роботи з файлами:
1. Розширити Drive scope для запису файлів і створення папок
2. Додати storage поле до об'єкту справи
3. Функції роботи з Drive папками
4. Кнопка "Створити структуру" в досьє
5. Глобальний 00_INBOX на Drive

---

## КРОК 0 — ПРОЧИТАТИ LESSONS.md

```bash
cat LESSONS.md
```

---

## КРОК 1 — ДІАГНОСТИКА

```bash
# Знайти поточний OAuth scope
grep -n "scope\|drive\.file\|oauth\|token" src/App.jsx | head -20

# Знайти де зберігається токен
grep -n "levytskyi_drive_token\|drive_token" src/App.jsx | head -10

# Перевірити структуру об'єкту справи
grep -n "driveFolderId\|storage\|driveFolder" src/App.jsx | head -10
```

Показати результати перед змінами.

---

## КРОК 2 — РОЗШИРИТИ OAUTH SCOPE

Знайти де визначається scope і замінити:

```js
// БУЛО:
'https://www.googleapis.com/auth/drive.file'

// СТАЛО:
'https://www.googleapis.com/auth/drive'
```

Після зміни scope — при наступній авторизації користувач побачить
новий запит дозволу від Google. Це нормально — один раз.

Щоб примусити повторну авторизацію — очистити збережений токен.
Додати кнопку "🔄 Оновити дозволи Drive" в налаштуваннях:
```js
localStorage.removeItem('levytskyi_drive_token');
window.location.reload();
```

---

## КРОК 3 — ДОДАТИ STORAGE ДО МОДЕЛІ СПРАВИ

В updateCase і в початковому стані справи додати поле storage:

```js
// Дефолтне значення для нової справи:
storage: {
  driveFolderId: null,      // ID папки справи на Google Drive
  driveFolderName: null,    // назва папки для відображення
  localFolderPath: null,    // локальна папка (тільки десктоп)
  lastSyncAt: null,         // час останньої синхронізації
}
```

---

## КРОК 4 — DRIVE СЕРВІС

Створити src/services/driveService.js:

```js
// Стандартна структура папок справи
const CASE_FOLDER_STRUCTURE = [
  '01_ОРИГІНАЛИ',
  '02_ОБРОБЛЕНІ',
  '03_ФРАГМЕНТИ',
  '04_ПОЗИЦІЯ',
  '05_ЗОВНІШНІ',
];

// Знайти або створити папку на Drive
async function findOrCreateFolder(name, parentId, token) {
  const q = parentId
    ? `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    : `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();

  if (data.files && data.files.length > 0) {
    return data.files[0]; // вже існує
  }

  // Створити нову
  const body = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    ...(parentId && { parents: [parentId] }),
  };
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return createRes.json();
}

// Створити повну структуру папок для справи
async function createCaseStructure(caseName, token) {
  // 1. Знайти або створити кореневу папку активних справ
  const rootFolder = await findOrCreateFolder('01_АКТИВНІ_СПРАВИ', null, token);

  // 2. Знайти або створити глобальний INBOX
  await findOrCreateFolder('00_INBOX', null, token);

  // 3. Створити папку справи
  const caseFolder = await findOrCreateFolder(caseName, rootFolder.id, token);

  // 4. Створити підпапки
  const subFolders = {};
  for (const name of CASE_FOLDER_STRUCTURE) {
    const folder = await findOrCreateFolder(name, caseFolder.id, token);
    subFolders[name] = folder.id;
  }

  return {
    caseFolderId: caseFolder.id,
    caseFolderName: caseName,
    subFolders,
  };
}

// Завантажити файл на Drive
async function uploadFileToDrive(fileName, fileBlob, parentFolderId, token) {
  const metadata = {
    name: fileName,
    parents: [parentFolderId],
  };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', fileBlob);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }
  );
  return res.json();
}

// Отримати список файлів у папці
async function listFolderFiles(folderId, token) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q='${folderId}' in parents and trashed=false&fields=files(id,name,mimeType,size,modifiedTime)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return data.files || [];
}

export {
  findOrCreateFolder,
  createCaseStructure,
  uploadFileToDrive,
  listFolderFiles,
};
```

---

## КРОК 5 — КНОПКА "СТВОРИТИ СТРУКТУРУ" В ДОСЬЄ

В CaseDossier/index.jsx — в шапці або в вкладці Огляд:

```jsx
const handleCreateDriveStructure = async () => {
  const token = localStorage.getItem('levytskyi_drive_token');
  if (!token) {
    alert('Підключіть Google Drive');
    return;
  }

  setCreatingStructure(true);
  try {
    const caseName = `${caseData.name}_${caseData.case_no || caseData.id}`;
    const { caseFolderId, caseFolderName } = await createCaseStructure(caseName, token);

    // Зберегти в об'єкті справи
    updateCase(caseData.id, 'storage', {
      ...caseData.storage,
      driveFolderId: caseFolderId,
      driveFolderName: caseFolderName,
    });

    alert(`✅ Структуру створено: ${caseFolderName}`);
  } catch (e) {
    alert(`❌ Помилка: ${e.message}`);
  } finally {
    setCreatingStructure(false);
  }
};

// В UI:
{!caseData.storage?.driveFolderId ? (
  <button onClick={handleCreateDriveStructure} disabled={creatingStructure}>
    {creatingStructure ? '⏳ Створюю...' : '📁 Створити структуру на Drive'}
  </button>
) : (
  <span>
    ☁️ Drive: {caseData.storage.driveFolderName}
    <button onClick={() => window.open(`https://drive.google.com/drive/folders/${caseData.storage.driveFolderId}`)}>
      🔗
    </button>
  </span>
)}
```

---

## КРОК 6 — ЗМІНА ПАПКИ СПРАВИ

В налаштуваннях досьє — можливість змінити папку:

```jsx
const handleChangeDriveFolder = async () => {
  // Запитати новий folderId (через Google Picker або вручну)
  const newFolderId = prompt('Введіть ID папки Google Drive:');
  if (!newFolderId) return;

  updateCase(caseData.id, 'storage', {
    ...caseData.storage,
    driveFolderId: newFolderId,
    driveFolderName: 'Вибрана папка',
  });
};
```

Примітка: Google Picker API — повноцінний вибір папки — додати пізніше.
Поки що через ручне введення ID або посилання.

---

## КРОК 7 — ПОКАЗАТИ STORAGE СТАТУС В ДОСЬЄ

В шапці досьє або вкладці Огляд — індикатор підключеного сховища:

```jsx
const storageStatus = () => {
  const s = caseData.storage;
  if (!s?.driveFolderId) return '⚠️ Папку не підключено';
  return `☁️ ${s.driveFolderName || 'Drive папка підключена'}`;
};
```

---

## ПОРЯДОК ВИКОНАННЯ

1. Діагностика (показати результати grep)
2. Змінити OAuth scope на `drive`
3. Додати storage поле до моделі справи
4. Створити src/services/driveService.js
5. Додати кнопку і логіку в CaseDossier
6. Показати storage статус в шапці

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "feat: drive infrastructure - case folder structure, storage field" && git push origin main
```

---

## ЧЕКЛІСТ ПІСЛЯ ДЕПЛОЮ

- [ ] Drive scope оновлено (при авторизації запитує нові дозволи)
- [ ] В досьє є кнопка "📁 Створити структуру на Drive"
- [ ] Після натискання — папки з'являються на Google Drive
- [ ] Структура: 01_ОРИГІНАЛИ / 02_ОБРОБЛЕНІ / 03_ФРАГМЕНТИ / 04_ПОЗИЦІЯ / 05_ЗОВНІШНІ
- [ ] Глобальна папка 00_INBOX створена на Drive
- [ ] В шапці досьє видно статус підключеної папки
- [ ] Посилання на папку відкриває Drive

---

## ПІСЛЯ ВИКОНАННЯ — ДОПИСАТИ В LESSONS.md

```
### [2026-04-08] Drive інфраструктура — scope і структура папок
OAuth scope: drive (не drive.file) — для створення папок і запису файлів.
Після зміни scope — очистити токен: localStorage.removeItem('levytskyi_drive_token')
Структура справи: 01_ОРИГІНАЛИ / 02_ОБРОБЛЕНІ / 03_ФРАГМЕНТИ / 04_ПОЗИЦІЯ / 05_ЗОВНІШНІ
Глобальний 00_INBOX — один для всіх справ, очищається після обробки.
storage поле в об'єкті справи: driveFolderId, driveFolderName, localFolderPath, lastSyncAt
findOrCreateFolder — завжди перевіряти чи існує перед створенням.
```
