# TASK.md — Фікс Google Picker 403 на GitHub Pages
Дата: 08.04.2026

## ПРОБЛЕМА

Google Picker показує 403 на GitHub Pages через Content Security Policy.
Picker намагається завантажити iframe з accounts.google.com але CSP блокує.

---

## КРОК 0 — ПРОЧИТАТИ LESSONS.md
```bash
cat LESSONS.md
```

---

## КРОК 1 — ДІАГНОСТИКА

```bash
# Знайти поточну реалізацію openFolderPicker
grep -n "openFolderPicker\|gapi\|picker\|PickerBuilder" src/components/CaseDossier/index.jsx | head -20

# Перевірити index.html на CSP заголовки
grep -n "Content-Security-Policy\|gapi\|picker" index.html
```

---

## КРОК 2 — ЗАМІНИТИ PICKER НА DRIVE FILE BROWSER

Замість Google Picker API використати власний простий браузер папок
через Google Drive API v3 який вже підключений і працює.

### Логіка:

```jsx
// Стан для браузера папок
const [folderBrowser, setFolderBrowser] = useState(null);
// { isOpen: bool, currentFolderId: string, currentFolderName: string, items: [] }

// Відкрити браузер папок
const openFolderBrowser = async () => {
  const token = localStorage.getItem('levytskyi_drive_token');
  if (!token) { showMsg('❌ Підключіть Google Drive'); return; }

  setFolderBrowser({ isOpen: true, currentFolderId: 'root', currentFolderName: 'Мій диск', items: [], loading: true });
  await loadFolderContents('root', 'Мій диск', token);
};

// Завантажити вміст папки
const loadFolderContents = async (folderId, folderName, token) => {
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q='${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)&orderBy=name`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    setFolderBrowser(prev => ({
      ...prev,
      currentFolderId: folderId,
      currentFolderName: folderName,
      items: data.files || [],
      loading: false,
    }));
  } catch (e) {
    showMsg('❌ Помилка завантаження папок');
  }
};

// Вибрати папку
const selectFolder = (folder) => {
  const token = localStorage.getItem('levytskyi_drive_token');
  const storageData = {
    driveFolderId: folder.id,
    driveFolderName: folder.name,
    localFolderPath: null,
    lastSyncAt: new Date().toISOString(),
  };
  updateCase(caseData.id, 'storage', storageData);
  setStorageState(storageData);
  setFolderBrowser(null);
  showMsg(`✅ Папку вибрано: ${folder.name}`);
};
```

### UI браузера папок (модальне вікно в стилі системи):

```jsx
{folderBrowser?.isOpen && (
  <div style={{
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.7)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }}>
    <div style={{
      background: '#1a1d2e', borderRadius: 12, padding: 24,
      width: '90%', maxWidth: 500, maxHeight: '70vh',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      {/* Заголовок */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#fff', fontSize: 16, fontWeight: 600 }}>
          📁 {folderBrowser.currentFolderName}
        </span>
        <button onClick={() => setFolderBrowser(null)}
          style={{ background: 'none', border: 'none', color: '#aaa', fontSize: 20, cursor: 'pointer' }}>
          ✕
        </button>
      </div>

      {/* Кнопка "Вибрати цю папку" */}
      <button
        onClick={() => selectFolder({ id: folderBrowser.currentFolderId, name: folderBrowser.currentFolderName })}
        style={{
          background: '#1a4a8a', color: '#fff', border: 'none',
          borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontSize: 13,
        }}
      >
        ✅ Вибрати цю папку: {folderBrowser.currentFolderName}
      </button>

      {/* Список підпапок */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {folderBrowser.loading ? (
          <span style={{ color: '#aaa', padding: 8 }}>⏳ Завантаження...</span>
        ) : folderBrowser.items.length === 0 ? (
          <span style={{ color: '#aaa', padding: 8 }}>Немає підпапок</span>
        ) : folderBrowser.items.map(item => (
          <button
            key={item.id}
            onClick={() => {
              const token = localStorage.getItem('levytskyi_drive_token');
              setFolderBrowser(prev => ({ ...prev, loading: true }));
              loadFolderContents(item.id, item.name, token);
            }}
            style={{
              background: '#0d0f1a', border: '1px solid #2a2d3e',
              borderRadius: 6, padding: '8px 12px', color: '#ccc',
              cursor: 'pointer', textAlign: 'left', fontSize: 13,
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            📁 {item.name}
          </button>
        ))}
      </div>

      {/* Посилання "Мій диск" для повернення в корінь */}
      {folderBrowser.currentFolderId !== 'root' && (
        <button
          onClick={() => {
            const token = localStorage.getItem('levytskyi_drive_token');
            loadFolderContents('root', 'Мій диск', token);
          }}
          style={{ background: 'none', border: 'none', color: '#4a9eff', cursor: 'pointer', fontSize: 12 }}
        >
          ← Мій диск
        </button>
      )}
    </div>
  </div>
)}
```

### Кнопка "Змінити" → openFolderBrowser:
```jsx
<button onClick={openFolderBrowser}>✏️ Змінити папку</button>
```

---

## КРОК 3 — ПРИБРАТИ СТАРИЙ PICKER

```bash
# Знайти і видалити весь код пов'язаний з gapi/Picker
grep -n "gapi\|PickerBuilder\|PICKER_API_KEY\|google.picker" src/components/CaseDossier/index.jsx | head -20
```

Видалити: константу PICKER_API_KEY, функцію openFolderPicker, будь-який код що використовує window.gapi.

Також прибрати скрипт gapi з index.html якщо є:
```bash
grep -n "apis.google.com/js/api" index.html
```

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "fix: replace Google Picker with built-in folder browser using Drive API" && git push origin main
```

## ЧЕКЛІСТ

- [ ] Кнопка "Змінити папку" відкриває власне модальне вікно в стилі системи
- [ ] Показує список папок з Google Drive
- [ ] Можна переходити в підпапки
- [ ] Кнопка "Вибрати цю папку" зберігає вибір
- [ ] Кнопка "← Мій диск" повертає в корінь
- [ ] Немає жодного gapi або Picker коду
- [ ] Немає 403 помилки

## ПІСЛЯ ВИКОНАННЯ — ДОПИСАТИ В LESSONS.md

```
### [2026-04-08] Google Picker API — не використовувати на GitHub Pages
Google Picker показує 403 через Content Security Policy на статичних хостингах.
Рішення: власний браузер папок через Drive API v3 (files.list з mimeType folder).
Drive API вже підключений і працює — використовувати його замість Picker.
```
