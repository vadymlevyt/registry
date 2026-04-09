# TASK.md — Три фікси: контекстний файл + нотатки в досьє
Дата: 09.04.2026

## КРОК 0 — ПРОЧИТАТИ LESSONS.md
```bash
cat LESSONS.md
```

---

## КРОК 1 — ДІАГНОСТИКА

```bash
# Як зараз шукає файли для контексту
grep -n "createContext\|caseContext\|getFiles\|getPDF\|02_ОБРОБЛЕНІ\|driveFolderId" src/components/CaseDossier/index.jsx | head -30

# Як виглядає список нотаток в досьє
grep -n "editNote\|updateNote\|handleEdit\|note.*edit\|setEditingNote" src/components/CaseDossier/index.jsx | head -20

# Як реалізовано прикріплення в Notebook (еталон)
grep -n "isPinned\|pinNote\|rotate\|📌\|pinnedNoteIds" src/components/Notebook/index.jsx | head -20
```

Показати результати перед змінами.

---

## БАГ 1 — КОНТЕКСТНИЙ ФАЙЛ: ПРАВИЛЬНИЙ ПОШУК PDF

### Алгоритм:

```
1. Взяти caseData.storage.driveFolderId — це папка справи
   (зараз це папка в 01_АКТИВНІ_СПРАВИ, пізніше може бути інша)

2. Отримати ВСІ підпапки цієї папки БЕЗ фільтра по назві
   (кирилиця в Drive query ненадійна — шукати в JS)

3. Знайти 02_ОБРОБЛЕНІ в JS:
   folders.find(f => f.name === '02_ОБРОБЛЕНІ')

4. Якщо 02_ОБРОБЛЕНІ є і не порожня → брати PDF звідти

5. Якщо 02_ОБРОБЛЕНІ порожня або немає →
   знайти 01_ОРИГІНАЛИ → брати PDF звідти + попередити

6. Якщо обидві порожні → повідомити і зупинитись
```

### Функція пошуку PDF:

```js
const findPDFsForContext = async (caseFolderId, token) => {
  // Отримати всі підпапки без фільтра по назві
  const subRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?` +
    `q=${encodeURIComponent(
      `'${caseFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    )}&fields=files(id,name)&pageSize=20`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const subData = await subRes.json();
  const folders = subData.files || [];

  // Знайти потрібні папки в JS (не в query)
  const processed = folders.find(f => f.name === '02_ОБРОБЛЕНІ');
  const originals = folders.find(f => f.name === '01_ОРИГІНАЛИ');

  // Спробувати 02_ОБРОБЛЕНІ
  if (processed) {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?` +
      `q=${encodeURIComponent(
        `'${processed.id}' in parents and mimeType='application/pdf' and trashed=false`
      )}&fields=files(id,name,size)&pageSize=100&orderBy=name`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    if ((data.files || []).length > 0) {
      return { files: data.files, source: '02_ОБРОБЛЕНІ', warn: false };
    }
  }

  // Спробувати 01_ОРИГІНАЛИ
  if (originals) {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?` +
      `q=${encodeURIComponent(
        `'${originals.id}' in parents and mimeType='application/pdf' and trashed=false`
      )}&fields=files(id,name,size)&pageSize=100&orderBy=name`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    if ((data.files || []).length > 0) {
      return { files: data.files, source: '01_ОРИГІНАЛИ', warn: true };
    }
  }

  return { files: [], source: null, warn: false };
};
```

### Використання в handleCreateCaseContext:

```js
const handleCreateCaseContext = async () => {
  const token = localStorage.getItem('levytskyi_drive_token');
  const folderId = caseData?.storage?.driveFolderId;

  if (!token || !folderId) {
    showMsg('❌ Підключіть Drive і створіть папку справи');
    return;
  }

  showMsg('🔍 Шукаю документи...');

  const { files, source, warn } = await findPDFsForContext(folderId, token);

  if (files.length === 0) {
    showMsg('❌ PDF не знайдено. Нарізайте документи у вкладці "Робота з документами"');
    return;
  }

  if (warn) {
    showMsg(`⚠️ Читаю з 01_ОРИГІНАЛИ (${files.length} файлів). Рекомендую спочатку нарізати.`);
  } else {
    showMsg(`📄 Знайдено ${files.length} файлів в ${source}. Читаю...`);
  }

  // Далі — існуючий код завантаження і відправки в Claude
};
```

---

## БАГ 2 — РЕДАГУВАННЯ НОТАТОК В ДОСЬЄ

### Що треба:
- Кожна нотатка має кнопку ✏️ Редагувати
- При кліку — нотатка перетворюється в textarea
- Кнопки Зберегти / Скасувати
- Після збереження — оновлюється в notes{} і в pinnedNoteIds якщо прикріплена

### Стан:
```jsx
const [editingNoteId, setEditingNoteId] = useState(null);
const [editingNoteText, setEditingNoteText] = useState('');
```

### UI нотатки:
```jsx
{caseNotes.map(note => (
  <div key={note.id} style={{ background: '#1a1d2e', borderRadius: 8, padding: 12, marginBottom: 8 }}>
    {editingNoteId === note.id ? (
      // Режим редагування
      <>
        <textarea
          value={editingNoteText}
          onChange={e => setEditingNoteText(e.target.value)}
          style={{ width: '100%', minHeight: 80, background: '#0d0f1a', color: '#fff', border: '1px solid #4a9eff', borderRadius: 6, padding: 8, fontSize: 13 }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button onClick={() => handleSaveNote(note.id)} style={{ background: '#1a4a8a', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}>
            ✓ Зберегти
          </button>
          <button onClick={() => setEditingNoteId(null)} style={{ background: '#333', color: '#aaa', border: 'none', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}>
            Скасувати
          </button>
        </div>
      </>
    ) : (
      // Режим перегляду
      <>
        <div style={{ fontSize: 13, color: '#ccc', marginBottom: 6 }}>{note.text}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#555' }}>{note.ts?.split('T')[0]}</span>
          <button
            onClick={() => { setEditingNoteId(note.id); setEditingNoteText(note.text); }}
            style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 12 }}
          >
            ✏️
          </button>
          <button
            onClick={() => handleDeleteNote(note.id)}
            style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 12 }}
          >
            🗑️
          </button>
          {/* Кнопка прикріплення — точно як в Notebook */}
          <button
            onClick={() => {
              const isPinned = (caseData?.pinnedNoteIds || []).includes(note.id);
              isPinned ? onUnpinNote(note.id, caseData.id) : onPinNote(note.id, caseData.id);
            }}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 16,
              transform: (caseData?.pinnedNoteIds || []).includes(note.id) ? 'rotate(-45deg)' : 'none',
              transition: 'transform 0.2s, color 0.2s',
              color: (caseData?.pinnedNoteIds || []).includes(note.id) ? '#e53935' : '#666',
            }}
            title={(caseData?.pinnedNoteIds || []).includes(note.id) ? 'Відкріпити' : 'Прикріпити'}
          >
            📌
          </button>
        </div>
      </>
    )}
  </div>
))}
```

### Функція збереження:
```jsx
const handleSaveNote = (noteId) => {
  onUpdateNote(noteId, editingNoteText); // функція з App.jsx
  setEditingNoteId(null);
  setEditingNoteText('');
};
```

---

## БАГ 3 — ПРИКРІПЛЕННЯ В ДОСЬЄ БЕЗ F5

Якщо після БАГ 2 прикріплення все ще не оновлюється без F5:

```bash
# Перевірити чи є локальний state для pinnedNoteIds в CaseDossier
grep -n "useState.*pinned\|localPinned\|setPinned" src/components/CaseDossier/index.jsx
```

Якщо є — видалити локальний state.
Читати напряму з props: `caseData.pinnedNoteIds`
Тоді при зміні в App.jsx компонент автоматично перерендериться.

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "fix: context file finds PDFs in subfolders, note editing in dossier" && git push origin main
```

## ЧЕКЛІСТ

- [ ] "Створити контекст" → знаходить PDF в 02_ОБРОБЛЕНІ папки справи
- [ ] Якщо 02_ОБРОБЛЕНІ порожня → шукає в 01_ОРИГІНАЛИ + попереджає
- [ ] Якщо обидві порожні → чітке повідомлення що робити
- [ ] Нотатка в досьє → кнопка ✏️ → textarea → Зберегти/Скасувати
- [ ] Кнопка 📌 в досьє — та сама анімація і колір як в Notebook
- [ ] Прикріплення в досьє → оновлюється без F5

## ДОПИСАТИ В LESSONS.md

```
### [2026-04-09] Drive — НІКОЛИ не фільтрувати по кирилиці в query
Отримати всі підпапки без фільтра по назві.
Знайти потрібну в JS: folders.find(f => f.name === '02_ОБРОБЛЕНІ')
Це стосується будь-якого пошуку по назві з кирилицею в Drive API.

### [2026-04-09] Редагування нотаток — локальний state editingNoteId
useState(null) → при кліці встановити id → показати textarea → зберегти через onUpdateNote
```
