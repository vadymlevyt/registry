# TASK.md — Фікс: Drive API не показує папки кореня
Дата: 08.04.2026

## ПРОБЛЕМА

Drive API з `'root' in parents` не повертає папки.
Треба спочатку отримати реальний ID кореневої папки через окремий запит.

---

## КРОК 0 — ПРОЧИТАТИ LESSONS.md
```bash
cat LESSONS.md
```

---

## КРОК 1 — ДІАГНОСТИКА

```bash
grep -n "loadFolderContents\|root.*parents\|drive/v3/files" src/components/CaseDossier/index.jsx | head -20
```

---

## КРОК 2 — ФІКС

### 2А. Отримати реальний ID кореня при відкритті браузера:

```jsx
const openFolderBrowser = async () => {
  const token = localStorage.getItem('levytskyi_drive_token');
  if (!token) { showMsg('❌ Підключіть Google Drive'); return; }

  setFolderBrowser({
    isOpen: true,
    currentFolderId: null,
    currentFolderName: 'Мій диск',
    items: [],
    loading: true,
    history: [],
  });

  try {
    // Отримати реальний ID кореневої папки
    const rootRes = await fetch(
      'https://www.googleapis.com/drive/v3/files/root?fields=id',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const rootData = await rootRes.json();
    const rootId = rootData.id;

    await loadFolderContents(rootId, 'Мій диск', token, []);
  } catch (e) {
    showMsg('❌ Помилка: ' + e.message);
  }
};
```

### 2Б. Оновити loadFolderContents — використовувати реальний ID:

```jsx
const loadFolderContents = async (folderId, folderName, token, history) => {
  try {
    const url = `https://www.googleapis.com/drive/v3/files` +
      `?q=${encodeURIComponent(`'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`)}` +
      `&fields=files(id,name)` +
      `&orderBy=name` +
      `&pageSize=100`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();

    setFolderBrowser(prev => ({
      ...prev,
      currentFolderId: folderId,
      currentFolderName: folderName,
      items: data.files || [],
      loading: false,
      history: history !== undefined ? history : prev.history,
    }));
  } catch (e) {
    showMsg('❌ Помилка: ' + e.message);
    setFolderBrowser(prev => ({ ...prev, loading: false }));
  }
};
```

### 2В. Навігація в підпапку:

```jsx
const navigateToFolder = (folder) => {
  const token = localStorage.getItem('levytskyi_drive_token');
  const newHistory = [
    ...(folderBrowser.history || []),
    { id: folderBrowser.currentFolderId, name: folderBrowser.currentFolderName }
  ];
  setFolderBrowser(prev => ({ ...prev, loading: true }));
  loadFolderContents(folder.id, folder.name, token, newHistory);
};
```

### 2Г. Навігація назад:

```jsx
const navigateBack = () => {
  const token = localStorage.getItem('levytskyi_drive_token');
  const history = [...(folderBrowser.history || [])];
  const parent = history.pop();
  if (parent) {
    loadFolderContents(parent.id, parent.name, token, history);
  }
};
```

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "fix: folder browser use real root ID from Drive API" && git push origin main
```

## ЧЕКЛІСТ

- [ ] Відкрив браузер → показує папки з кореня Мого диску
- [ ] Бачить 01_АКТИВНІ_СПРАВИ та інші папки
- [ ] Натиснув папку → заходить в неї
- [ ] Кнопка ← повертає назад
- [ ] Вибрав папку → назва в блоці Сховище

## ПІСЛЯ ВИКОНАННЯ — ДОПИСАТИ В LESSONS.md

```
### [2026-04-08] Drive API — root папка
'root' в запиті files.list не завжди працює.
Правильно: спочатку GET /drive/v3/files/root?fields=id
Отримати реальний ID → використовувати в запиті '${realRootId}' in parents
```
