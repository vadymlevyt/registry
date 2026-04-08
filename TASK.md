# TASK.md — Перевірка структури папок в блоці Сховище
Дата: 08.04.2026

## СУТЬ

Після вибору або зміни папки — перевірити чи є стандартні підпапки.
Показати статус і кнопку створити якщо структури немає.

---

## КРОК 0 — ПРОЧИТАТИ LESSONS.md
```bash
cat LESSONS.md
```

---

## КРОК 1 — ДІАГНОСТИКА

```bash
grep -n "selectFolder\|storageState\|СХОВИЩЕ\|hasFolder\|структур" src/components/CaseDossier/index.jsx | head -20
```

---

## КРОК 2 — ФУНКЦІЯ ПЕРЕВІРКИ СТРУКТУРИ

```jsx
const REQUIRED_SUBFOLDERS = [
  '01_ОРИГІНАЛИ',
  '02_ОБРОБЛЕНІ',
  '03_ФРАГМЕНТИ',
  '04_ПОЗИЦІЯ',
];

// Перевірити чи є стандартні підпапки в папці справи
const checkFolderStructure = async (folderId, token) => {
  try {
    const url = `https://www.googleapis.com/drive/v3/files` +
      `?q=${encodeURIComponent(`'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`)}` +
      `&fields=files(id,name)&pageSize=20`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    const existingNames = (data.files || []).map(f => f.name);

    const missing = REQUIRED_SUBFOLDERS.filter(name => !existingNames.includes(name));
    return {
      hasStructure: missing.length === 0,
      missing,
    };
  } catch (e) {
    return { hasStructure: false, missing: REQUIRED_SUBFOLDERS };
  }
};
```

---

## КРОК 3 — STATE ДЛЯ СТАТУСУ СТРУКТУРИ

```jsx
const [structureStatus, setStructureStatus] = useState(null);
// null | { hasStructure: bool, missing: [] }
```

---

## КРОК 4 — ПЕРЕВІРЯТИ ПІСЛЯ ВИБОРУ ПАПКИ

В функції selectFolder — після збереження папки одразу перевірити структуру:

```jsx
const selectFolder = async (folder) => {
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

  // Одразу перевірити структуру
  setStructureStatus(null); // loading
  const status = await checkFolderStructure(folder.id, token);
  setStructureStatus(status);
};
```

---

## КРОК 5 — ПЕРЕВІРЯТИ ПРИ ВІДКРИТТІ ДОСЬЄ

В useEffect при завантаженні компонента:

```jsx
useEffect(() => {
  const folderId = caseData.storage?.driveFolderId;
  if (!folderId) return;

  const token = localStorage.getItem('levytskyi_drive_token');
  if (!token) return;

  checkFolderStructure(folderId, token).then(setStructureStatus);
}, [caseData.storage?.driveFolderId]);
```

---

## КРОК 6 — UI СТАТУСУ СТРУКТУРИ

Додати під рядком з назвою папки в блоці Сховище:

```jsx
{storageState?.driveFolderId && (
  <div style={{ marginTop: 6, fontSize: 12 }}>
    {structureStatus === null && (
      <span style={{ color: '#666' }}>⏳ Перевірка структури...</span>
    )}
    {structureStatus?.hasStructure === true && (
      <span style={{ color: '#4caf50' }}>✅ Структура папок є</span>
    )}
    {structureStatus?.hasStructure === false && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#f5a623' }}>
          ⚠️ Немає структури папок
        </span>
        <button
          onClick={handleCreateDriveStructure}
          disabled={creatingStructure}
          style={{
            background: '#1a3a1a',
            border: '1px solid #4caf50',
            borderRadius: 4,
            padding: '2px 8px',
            color: '#4caf50',
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          {creatingStructure ? '⏳' : '📁 Створити'}
        </button>
      </div>
    )}
  </div>
)}
```

---

## КРОК 7 — ОНОВИТИ СТАТУС ПІСЛЯ СТВОРЕННЯ СТРУКТУРИ

В handleCreateDriveStructure після успіху:

```jsx
// Після createCaseStructure і updateCase:
setStructureStatus({ hasStructure: true, missing: [] });
```

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "feat: check folder structure status, show create button if missing" && git push origin main
```

## ЧЕКЛІСТ

- [ ] Відкрив досьє з папкою → одразу перевіряє структуру
- [ ] Є структура → "✅ Структура папок є"
- [ ] Немає структури → "⚠️ Немає структури" + кнопка "📁 Створити"
- [ ] Вибрав нову папку → одразу показує статус нової папки
- [ ] Після "Створити" → статус змінюється на "✅"

## ПІСЛЯ ВИКОНАННЯ — ДОПИСАТИ В LESSONS.md

```
### [2026-04-08] Перевірка структури папок Drive
REQUIRED_SUBFOLDERS = ['01_ОРИГІНАЛИ', '02_ОБРОБЛЕНІ', '03_ФРАГМЕНТИ', '04_ПОЗИЦІЯ']
Перевіряти при відкритті досьє і після зміни папки.
Запит: files.list з mimeType=folder і folderId in parents.
```
