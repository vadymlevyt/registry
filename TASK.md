# TASK.md — Фікс браузера папок Drive
Дата: 08.04.2026

## ПРОБЛЕМИ

1. Показує "Немає підпапок" на корені — запит не знаходить папки
2. Кнопка "Вибрати цю папку: Мій диск" — не можна вибрати корінь як папку справи
3. Немає навігації назад (breadcrumb)

---

## КРОК 0 — ПРОЧИТАТИ LESSONS.md
```bash
cat LESSONS.md
```

---

## КРОК 1 — ДІАГНОСТИКА

```bash
grep -n "loadFolderContents\|drive/v3/files\|folderBrowser" src/components/CaseDossier/index.jsx | head -20
```

---

## КРОК 2 — ВИПРАВИТИ ЗАПИТ ДО DRIVE API

Проблема: запит `'root' in parents` може не працювати на деяких акаунтах.
Треба використати `'root'` або отримати реальний ID кореневої папки.

```jsx
const loadFolderContents = async (folderId, folderName, token) => {
  setFolderBrowser(prev => ({ ...prev, loading: true }));
  try {
    // Для кореня використовувати спеціальний запит
    const parentQuery = folderId === 'root'
      ? `'root' in parents`
      : `'${folderId}' in parents`;

    const url = `https://www.googleapis.com/drive/v3/files` +
      `?q=${encodeURIComponent(`${parentQuery} and mimeType='application/vnd.google-apps.folder' and trashed=false`)}` +
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
    }));
  } catch (e) {
    showMsg('❌ Помилка завантаження папок: ' + e.message);
    setFolderBrowser(prev => ({ ...prev, loading: false }));
  }
};
```

---

## КРОК 3 — ДОДАТИ BREADCRUMB (навігація назад)

```jsx
// В стані folderBrowser додати history:
const [folderBrowser, setFolderBrowser] = useState(null);
// { isOpen, currentFolderId, currentFolderName, items, loading, history: [] }
// history: [{id, name}, ...] — стек відвіданих папок

// При відкритті:
setFolderBrowser({
  isOpen: true,
  currentFolderId: 'root',
  currentFolderName: 'Мій диск',
  items: [],
  loading: true,
  history: [], // порожній стек
});

// При переході в підпапку — додавати в history:
const navigateToFolder = (folder) => {
  const token = localStorage.getItem('levytskyi_drive_token');
  setFolderBrowser(prev => ({
    ...prev,
    history: [...prev.history, { id: prev.currentFolderId, name: prev.currentFolderName }],
    loading: true,
  }));
  loadFolderContents(folder.id, folder.name, token);
};

// Кнопка назад — брати останній з history:
const navigateBack = () => {
  const token = localStorage.getItem('levytskyi_drive_token');
  setFolderBrowser(prev => {
    const newHistory = [...prev.history];
    const parent = newHistory.pop();
    return { ...prev, history: newHistory, loading: true };
  });
  const parent = folderBrowser.history[folderBrowser.history.length - 1];
  if (parent) loadFolderContents(parent.id, parent.name, token);
};
```

---

## КРОК 4 — ОНОВИТИ UI БРАУЗЕРА

```jsx
{folderBrowser?.isOpen && (
  <div style={{
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.7)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }}>
    <div style={{
      background: '#1a1d2e', borderRadius: 12, padding: 20,
      width: '90%', maxWidth: 480, maxHeight: '75vh',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>

      {/* Заголовок + закрити */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#fff', fontSize: 15, fontWeight: 600 }}>
          Вибрати папку справи
        </span>
        <button onClick={() => setFolderBrowser(null)}
          style={{ background: 'none', border: 'none', color: '#aaa', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>
          ✕
        </button>
      </div>

      {/* Breadcrumb — поточний шлях */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        {folderBrowser.history.length > 0 && (
          <button onClick={navigateBack}
            style={{ background: 'none', border: 'none', color: '#4a9eff', cursor: 'pointer', fontSize: 12, padding: 0 }}>
            ←
          </button>
        )}
        {folderBrowser.history.map((h, i) => (
          <span key={h.id} style={{ color: '#666', fontSize: 12 }}>
            {h.name} /
          </span>
        ))}
        <span style={{ color: '#aaa', fontSize: 12, fontWeight: 600 }}>
          📁 {folderBrowser.currentFolderName}
        </span>
      </div>

      {/* Кнопка "Вибрати цю папку" — тільки якщо не корінь */}
      {folderBrowser.currentFolderId !== 'root' && (
        <button
          onClick={() => selectFolder({
            id: folderBrowser.currentFolderId,
            name: folderBrowser.currentFolderName
          })}
          style={{
            background: '#1a4a2a', color: '#4caf50',
            border: '1px solid #4caf50', borderRadius: 6,
            padding: '8px 16px', cursor: 'pointer', fontSize: 13,
          }}
        >
          ✅ Вибрати: {folderBrowser.currentFolderName}
        </button>
      )}

      {/* Список підпапок */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {folderBrowser.loading ? (
          <span style={{ color: '#aaa', padding: 12, textAlign: 'center' }}>⏳ Завантаження...</span>
        ) : folderBrowser.items.length === 0 ? (
          <span style={{ color: '#666', padding: 12, textAlign: 'center', fontSize: 13 }}>
            Немає підпапок — можна вибрати цю папку
          </span>
        ) : folderBrowser.items.map(item => (
          <button
            key={item.id}
            onClick={() => navigateToFolder(item)}
            style={{
              background: '#0d0f1a', border: '1px solid #2a2d3e',
              borderRadius: 6, padding: '10px 12px', color: '#ccc',
              cursor: 'pointer', textAlign: 'left', fontSize: 13,
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            📁 {item.name}
          </button>
        ))}
      </div>

    </div>
  </div>
)}
```

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "fix: folder browser navigation, breadcrumb, root folders visible" && git push origin main
```

## ЧЕКЛІСТ

- [ ] Відкривається браузер папок
- [ ] Показує папки з Мого диску (не "Немає підпапок")
- [ ] Натиснув папку → заходить в неї, показує підпапки
- [ ] Кнопка "← " повертає назад
- [ ] Breadcrumb показує шлях
- [ ] Кнопка "✅ Вибрати" є тільки коли не на корені
- [ ] Після вибору — назва папки з'являється в блоці Сховище
