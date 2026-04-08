# TASK.md — Drive запис + локальне сховище + Document Processor реальні дії
Дата: 08.04.2026

## АРХІТЕКТУРА СХОВИЩА

Платформа визначається автоматично:
- Десктоп Chrome → локальна папка (File System Access API) + Google Drive
- Планшет/мобільний → тільки Google Drive

```
const isDesktop = () => {
  return window.showDirectoryPicker !== undefined &&
    !(/Android|iPhone|iPad/i.test(navigator.userAgent));
};
```

---

## КРОК 0 — ПРОЧИТАТИ LESSONS.md

```bash
cat LESSONS.md
```

---

## КРОК 1 — ДІАГНОСТИКА ПОТОЧНОГО DRIVE СЕРВІСУ

```bash
# Знайти поточний Drive scope і функції
grep -n "scope\|drive\|DRIVE\|oauth\|token" src/App.jsx | head -20
grep -rn "scope\|drive" src/services/ | head -20

# Знайти handleConfirm в DocumentProcessor
grep -n "handleConfirm\|Підтвердити\|наступній версії" src/components/DocumentProcessor/index.jsx | head -20
```

Показати результати перед змінами.

---

## КРОК 2 — РОЗШИРИТИ DRIVE SCOPE

### 2А. Знайти де зараз визначається scope OAuth

```bash
grep -n "scope\|drive.file\|SCOPE" src/App.jsx | head -10
```

### 2Б. Змінити scope

Поточний scope дозволяє тільки файли створені системою:
```
https://www.googleapis.com/auth/drive.file
```

Новий scope — повний доступ для створення папок і завантаження будь-яких файлів:
```
https://www.googleapis.com/auth/drive
```

ВАЖЛИВО: після зміни scope — при наступній авторизації користувач побачить
новий запит дозволу від Google. Це нормально — один раз.

Також очистити збережений токен щоб примусити повторну авторизацію:
```jsx
// В UI — кнопка "Оновити дозволи Drive" або автоматично при помилці доступу
localStorage.removeItem('levytskyi_drive_token');
```

---

## КРОК 3 — DRIVE СЕРВІС: НОВІ ФУНКЦІЇ

Створити або розширити src/services/driveService.js:

### 3А. Створити структуру папок справи

```jsx
// Стандартна структура папок справи
const CASE_FOLDER_STRUCTURE = [
  '00_INBOX',
  '01_ОРИГІНАЛИ',
  '02_ОБРОБЛЕНІ',
  '03_ФРАГМЕНТИ',
  '04_ПОЗИЦІЯ',
  '05_ЗОВНІШНІ',
];

async function createCaseStructure(caseName, token) {
  // 1. Знайти або створити кореневу папку системи
  const rootFolder = await findOrCreateFolder('01_АКТИВНІ_СПРАВИ', null, token);

  // 2. Створити папку справи
  const caseFolder = await findOrCreateFolder(caseName, rootFolder.id, token);

  // 3. Створити всі підпапки
  const subFolders = {};
  for (const folderName of CASE_FOLDER_STRUCTURE) {
    const folder = await findOrCreateFolder(folderName, caseFolder.id, token);
    subFolders[folderName] = folder.id;
  }

  return { caseFolderId: caseFolder.id, subFolders };
}

async function findOrCreateFolder(name, parentId, token) {
  // Спробувати знайти існуючу папку
  const query = parentId
    ? `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    : `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const searchData = await searchRes.json();

  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0]; // папка вже існує
  }

  // Створити нову папку
  const metadata = {
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
    body: JSON.stringify(metadata),
  });

  return createRes.json();
}
```

### 3Б. Завантажити файл на Drive

```jsx
async function uploadFileToDrive(fileName, fileBlob, parentFolderId, token) {
  const metadata = {
    name: fileName,
    parents: [parentFolderId],
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', fileBlob);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }
  );

  return res.json(); // повертає { id, name, webViewLink }
}
```

### 3В. Визначити папку для документа

```jsx
// Маппінг типу документа → папка в структурі справи
function getFolderForDocument(doc) {
  const mapping = {
    'pleading': '02_ОБРОБЛЕНІ',      // позовні заяви, відзиви
    'court_act': '02_ОБРОБЛЕНІ',     // ухвали, постанови
    'evidence': '02_ОБРОБЛЕНІ',      // докази
    'correspondence': '02_ОБРОБЛЕНІ', // листування
    'motion': '02_ОБРОБЛЕНІ',        // клопотання
    'contract': '02_ОБРОБЛЕНІ',      // договори
    'fragment': '03_ФРАГМЕНТИ',      // неповні документи
    'position': '04_ПОЗИЦІЯ',        // матеріали позиції
    'original': '01_ОРИГІНАЛИ',      // оригінали (незмінні)
  };
  return mapping[doc.type] || '02_ОБРОБЛЕНІ';
}
```

---

## КРОК 4 — ЛОКАЛЬНЕ СХОВИЩЕ (ДЕСКТОП)

```jsx
// Перевірка платформи
const isDesktop = () => {
  return window.showDirectoryPicker !== undefined &&
    !(/Android|iPhone|iPad/i.test(navigator.userAgent));
};

// Вибір локальної папки (тільки десктоп)
async function selectLocalFolder() {
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    // Зберегти handle в sessionStorage для поточної сесії
    return dirHandle;
  } catch (e) {
    if (e.name === 'AbortError') return null; // користувач скасував
    throw e;
  }
}

// Зберегти файл локально
async function saveFileLocally(dirHandle, relativePath, fileBlob) {
  // relativePath: "02_ОБРОБЛЕНІ/Позовна_заява.pdf"
  const parts = relativePath.split('/');
  let currentDir = dirHandle;

  // Створити підпапки якщо потрібно
  for (let i = 0; i < parts.length - 1; i++) {
    currentDir = await currentDir.getDirectoryHandle(parts[i], { create: true });
  }

  // Записати файл
  const fileName = parts[parts.length - 1];
  const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(fileBlob);
  await writable.close();
}
```

---

## КРОК 5 — ОНОВИТИ handleConfirm В DOCUMENT PROCESSOR

Після підтвердження структури — реальні дії:

```jsx
const handleConfirm = async () => {
  setStatus('executing');
  addAgentMessage('⚙️ Виконую...');

  const token = localStorage.getItem('levytskyi_drive_token');
  const desktop = isDesktop();

  try {
    // 1. Нарізка PDF через pdf-lib (якщо потрібно)
    const processedFiles = await processFiles(confirmedStructure, originalFileBuffer);

    // 2. Визначити куди зберігати
    let localDirHandle = null;
    if (desktop) {
      // Запитати локальну папку або використати збережену
      localDirHandle = await selectLocalFolder();
    }

    // 3. Зберегти кожен файл
    const results = [];
    for (const file of processedFiles) {
      const folder = getFolderForDocument(file);
      const fileName = file.processedName;
      const fileBlob = new Blob([file.data], { type: 'application/pdf' });
      const result = { name: fileName, folder };

      // Drive (завжди якщо є токен)
      if (token) {
        // Переконатись що структура папок існує
        const { subFolders } = await createCaseStructure(
          `${caseData.name}_${caseData.case_no || ''}`,
          token
        );
        const folderId = subFolders[folder] || subFolders['02_ОБРОБЛЕНІ'];
        const driveFile = await uploadFileToDrive(fileName, fileBlob, folderId, token);
        result.driveId = driveFile.id;
        result.driveUrl = driveFile.webViewLink;
      }

      // Локально (тільки десктоп)
      if (localDirHandle) {
        await saveFileLocally(localDirHandle, `${folder}/${fileName}`, fileBlob);
        result.savedLocally = true;
      }

      results.push(result);
    }

    // 4. Зберегти в documents[] справи
    const newDocuments = results.map((r, i) => ({
      id: `doc_${Date.now()}_${i}`,
      name: r.name,
      folder: r.folder,
      driveId: r.driveId || null,
      driveUrl: r.driveUrl || null,
      savedLocally: r.savedLocally || false,
      compressedSize: processedFiles[i].compressedSize,
      originalSize: processedFiles[i].originalSize,
      status: 'ready',
      addedAt: new Date().toISOString(),
    }));

    updateCase(caseData.id, 'documents', [
      ...(caseData.documents || []),
      ...newDocuments,
    ]);

    // 5. Результат
    const summary = results.map(r =>
      `✅ ${r.name}\n   📁 ${r.folder}${r.driveUrl ? `\n   🔗 Drive` : ''}${r.savedLocally ? '\n   💾 Локально' : ''}`
    ).join('\n\n');

    addAgentMessage(`Готово! ${results.length} документів збережено:\n\n${summary}`);
    setStatus('done');

  } catch (error) {
    addAgentMessage(`❌ Помилка: ${error.message}`);
    setStatus('error');
  }
};
```

---

## КРОК 6 — UI ІНДИКАТОРИ ПЛАТФОРМИ

В Document Processor показувати куди буде збережено:

```jsx
// Вгорі компонента після завантаження файлів:
<div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
  Буде збережено:
  {token && ' ☁️ Google Drive'}
  {isDesktop() && ' 💾 Локальна папка'}
  {!token && !isDesktop() && ' ⚠️ Підключіть Google Drive'}
</div>
```

---

## ПОРЯДОК ВИКОНАННЯ

1. Діагностика поточного Drive сервісу
2. Розширити OAuth scope на `drive`
3. Додати функції в driveService: findOrCreateFolder, uploadFileToDrive
4. Додати локальне збереження (File System Access API)
5. Оновити handleConfirm з реальними діями
6. Додати UI індикатори платформи
7. Перевірити що Матеріали оновлюються після збереження

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "feat: drive write access, local storage, document processor real actions" && git push origin main
```

---

## ЧЕКЛІСТ ПІСЛЯ ДЕПЛОЮ

- [ ] Drive scope оновлено — при авторизації запитує нові дозволи
- [ ] Підтвердив структуру → файли з'явились на Google Drive в правильних папках
- [ ] На десктопі → є можливість вибрати локальну папку
- [ ] Документи з'явились у вкладці Матеріали з посиланнями на Drive
- [ ] При завантаженні нових документів в існуючу справу — папки вже є, просто додає файли
- [ ] При новій справі — створює повну структуру папок автоматично

---

## ПІСЛЯ ВИКОНАННЯ — ДОПИСАТИ В LESSONS.md

```
### [2026-04-08] Drive scope — drive замість drive.file
drive.file дозволяє тільки файли створені системою.
Для створення папок і завантаження довільних файлів потрібен scope: drive.
Після зміни scope — очистити токен: localStorage.removeItem('levytskyi_drive_token')
Користувач побачить новий запит дозволу від Google — це нормально.

### [2026-04-08] Локальне сховище — тільки десктоп Chrome
File System Access API (showDirectoryPicker) — працює тільки на десктопі.
На Android/iOS — тільки Google Drive.
Перевірка платформи: window.showDirectoryPicker !== undefined && !(/Android|iPhone|iPad/i.test(navigator.userAgent))
```
