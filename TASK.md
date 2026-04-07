# TASK.md — Досьє під-сесія 2В
# Дата: 07.04.2026
# Гілка: main

## МЕТА

Чотири речі:
1. notes[] підняти в спільний стан App.jsx (Досьє і Notebook читають з одного місця)
2. Фікс: нова нотатка не перезаписує поле `notes` справи
3. Inline модалка для додавання нотатки замість prompt()
4. Закріплення нотатки (📌) — закріплена показується в полі "Нотатки до справи"

---

## ВАЖЛИВО — ДВА РІЗНИХ ПОЛЯ

Зараз в системі плутаються два різних місця:

**Поле `case.notes`** (рядок в моделі справи) — короткий опис справи.
Показується в картці реєстру і в блоці "ІНФОРМАЦІЯ ПРО СПРАВУ" в Огляді досьє.
Редагується inline як інші поля справи.
НЕ є списком нотаток.

**`levytskyi_notes[]`** (масив в localStorage/App.jsx) — список окремих нотаток.
Кожна нотатка: { id, text, caseId, caseName, category, source, ts, pinned }.
Показується в блоці "НОТАТКИ ПО СПРАВІ" в Огляді досьє і в Записній книжці.
НЕ перезаписує `case.notes`.

---

## КРОК 0 — ДІАГНОСТИКА

```bash
grep -n "levytskyi_notes\|notes\[\|saveNoteToStorage" src/App.jsx | head -30
grep -n "notes\|addNote\|onAddNote\|onUpdateNote" src/components/CaseDossier/index.jsx | head -20
grep -n "notes\|addNote\|onAddNote" src/components/Notebook/index.jsx | head -20
```

Зрозуміти:
- Де зараз зберігаються нотатки (localStorage чи useState в App.jsx)
- Чи є notes[] в спільному стані App.jsx
- Як Notebook отримує нотатки зараз

---

## КРОК 1 — notes[] В СПІЛЬНИЙ СТАН App.jsx

### 1.1 Додати state в App.jsx

```jsx
// Ініціалізація з localStorage
const [notes, setNotes] = useState(() => {
  try {
    return JSON.parse(localStorage.getItem('levytskyi_notes') || '[]');
  } catch {
    return [];
  }
});
```

### 1.2 Функції роботи з нотатками (живуть тільки в App.jsx)

```jsx
function addNote(noteData) {
  const note = {
    id: Date.now(),
    text: noteData.text || '',
    category: noteData.category || 'general',
    caseId: noteData.caseId || null,
    caseName: noteData.caseName || null,
    source: noteData.source || 'manual',
    pinned: noteData.pinned || false,
    ts: new Date().toISOString()
  };
  const updated = [...notes, note];
  setNotes(updated);
  localStorage.setItem('levytskyi_notes', JSON.stringify(updated));
  return note;
}

function updateNote(noteId, changes) {
  const updated = notes.map(n =>
    n.id === noteId ? { ...n, ...changes } : n
  );
  setNotes(updated);
  localStorage.setItem('levytskyi_notes', JSON.stringify(updated));
}

function deleteNote(noteId) {
  const updated = notes.filter(n => n.id !== noteId);
  setNotes(updated);
  localStorage.setItem('levytskyi_notes', JSON.stringify(updated));
}

function pinNote(noteId) {
  // Знімаємо закріплення з усіх нотаток цієї справи
  // і закріплюємо тільки вибрану
  const targetNote = notes.find(n => n.id === noteId);
  const updated = notes.map(n => {
    if (n.caseId === targetNote?.caseId || n.caseName === targetNote?.caseName) {
      return { ...n, pinned: n.id === noteId ? !n.pinned : false };
    }
    return n;
  });
  setNotes(updated);
  localStorage.setItem('levytskyi_notes', JSON.stringify(updated));
}
```

### 1.3 Передати в компоненти через props

```jsx
// CaseDossier:
{dossierCase && (
  <ErrorBoundary>
    <CaseDossier
      caseData={dossierCase}
      cases={cases}
      updateCase={updateCase}
      onClose={() => setDossierCase(null)}
      onSaveIdea={idea => setIdeas(prev => [...prev, idea])}
      notes={notes.filter(n =>
        n.caseId === dossierCase.id || n.caseName === dossierCase.name
      )}
      onAddNote={addNote}
      onUpdateNote={updateNote}
      onDeleteNote={deleteNote}
      onPinNote={pinNote}
    />
  </ErrorBoundary>
)}

// Notebook:
{tab === 'notebook' && (
  <ModuleErrorBoundary>
    <React.Suspense fallback={...}>
      <Notebook
        cases={cases}
        notes={notes}
        onAddNote={addNote}
        onUpdateNote={updateNote}
        onDeleteNote={deleteNote}
        onPinNote={pinNote}
      />
    </React.Suspense>
  </ModuleErrorBoundary>
)}
```

### 1.4 Видалити читання з localStorage в компонентах

В CaseDossier/index.jsx знайти і видалити:
```jsx
// ВИДАЛИТИ це:
const notes = JSON.parse(localStorage.getItem('levytskyi_notes') || '[]')
  .filter(...)
  .sort(...);
```

Замінити на використання props:
```jsx
// Нотатки приходять через props вже відфільтровані по справі
// props.notes — вже відфільтровані для цієї справи
const caseNotes = (props.notes || []).sort((a, b) =>
  new Date(b.ts) - new Date(a.ts)
);
const pinnedNote = caseNotes.find(n => n.pinned) || caseNotes[0];
```

---

## КРОК 2 — ФІКС: НОВА НОТАТКА НЕ ПЕРЕЗАПИСУЄ case.notes

### 2.1 Знайти де відбувається баг

```bash
grep -n "addNote\|saveNote\|notes.*case\|case.*notes" src/components/CaseDossier/index.jsx | head -20
```

Знайти місце де при додаванні нотатки оновлюється поле `case.notes`.
Це неправильно — `case.notes` і `levytskyi_notes[]` це різні речі.

### 2.2 Виправити функцію addNote в CaseDossier

Стара (неправильна) логіка:
```jsx
// НЕПРАВИЛЬНО — не робити так:
function addNote() {
  const text = prompt('...');
  updateCase(caseData.id, 'notes', text); // перезаписує поле справи!
}
```

Правильна логіка:
```jsx
// ПРАВИЛЬНО — додавати в масив нотаток:
function handleAddNote(text) {
  onAddNote({
    text,
    caseId: caseData.id,
    caseName: caseData.name,
    category: 'case',
    source: 'manual'
  });
}
```

### 2.3 Поле "Нотатки до справи" в Огляді

Поле `case.notes` в блоці "ІНФОРМАЦІЯ ПРО СПРАВУ" — це окремий рядок
що редагується inline як і інші поля (Суд, Номер справи тощо).
Воно залишається як є — короткий опис справи.

Блок "НОТАТКИ ПО СПРАВІ" — це окремий список нотаток з `levytskyi_notes[]`.
Ці два блоки незалежні і не впливають один на одного.

---

## КРОК 3 — INLINE МОДАЛКА ДЛЯ НОТАТКИ

Замінити prompt() на модалку. Додати state:

```jsx
const [noteModalOpen, setNoteModalOpen] = useState(false);
const [noteText, setNoteText] = useState('');
```

Кнопка "+ Додати" відкриває модалку:
```jsx
<button
  onClick={() => setNoteModalOpen(true)}
  style={{
    background: 'none', border: '1px solid #2e3148',
    color: '#9aa0b8', padding: '3px 8px',
    borderRadius: 5, cursor: 'pointer', fontSize: 11
  }}
>+ Додати</button>
```

Модалка нотатки:
```jsx
{noteModalOpen && (
  <div style={{
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 300
  }}>
    <div style={{
      background: '#1a1d27', border: '1px solid #2e3148',
      borderRadius: 12, padding: 20, width: 400
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
        + Нова нотатка
      </div>
      <div style={{ fontSize: 11, color: '#5a6080', marginBottom: 8 }}>
        Справа: {caseData.name}
      </div>
      <textarea
        value={noteText}
        onChange={e => setNoteText(e.target.value)}
        placeholder="Текст нотатки..."
        rows={5}
        style={{
          width: '100%', background: '#222536',
          border: '1px solid #2e3148', color: '#e8eaf0',
          padding: 10, borderRadius: 7, fontSize: 12,
          resize: 'vertical', outline: 'none',
          lineHeight: 1.6, boxSizing: 'border-box'
        }}
        autoFocus
      />
      <div style={{
        display: 'flex', gap: 8, marginTop: 12,
        justifyContent: 'flex-end'
      }}>
        <button
          onClick={() => { setNoteModalOpen(false); setNoteText(''); }}
          style={{
            background: 'none', border: '1px solid #2e3148',
            color: '#9aa0b8', padding: '5px 12px',
            borderRadius: 6, cursor: 'pointer', fontSize: 12
          }}
        >Скасувати</button>
        <button
          onClick={() => {
            if (!noteText.trim()) return;
            handleAddNote(noteText.trim());
            setNoteModalOpen(false);
            setNoteText('');
          }}
          style={{
            background: '#4f7cff', color: '#fff', border: 'none',
            padding: '5px 14px', borderRadius: 6,
            cursor: 'pointer', fontSize: 12
          }}
        >Зберегти</button>
      </div>
    </div>
  </div>
)}
```

---

## КРОК 4 — ЗАКРІПЛЕННЯ НОТАТКИ (📌)

### 4.1 Кнопка закріплення в картці нотатки

В блоці рендеру нотаток додати кнопку 📌 для кожної нотатки:

```jsx
{caseNotes.map(note => (
  <div key={note.id} style={{
    padding: '8px 10px', background: '#222536',
    borderRadius: 7, marginBottom: 6,
    fontSize: 12, color: '#9aa0b8', lineHeight: 1.6,
    position: 'relative'
  }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
      <div style={{ flex: 1 }}>
        {note.pinned && (
          <span style={{ fontSize: 9, color: '#4f7cff', marginRight: 6 }}>📌</span>
        )}
        {String(note.text || '')}
      </div>
      <button
        onClick={() => onPinNote(note.id)}
        title={note.pinned ? 'Зняти закріплення' : 'Закріпити'}
        style={{
          background: 'none', border: 'none',
          cursor: 'pointer', fontSize: 12,
          color: note.pinned ? '#4f7cff' : '#3a3f58',
          padding: '0 2px', flexShrink: 0
        }}
      >📌</button>
    </div>
    <div style={{ fontSize: 10, color: '#3a3f58', marginTop: 4 }}>
      {new Date(note.ts).toLocaleDateString('uk-UA')}
    </div>
  </div>
))}
```

### 4.2 Що показується в "Нотатки до справи"

Закріплена нотатка (pinned: true) показується першою в списку.
Якщо жодна не закріплена — показується остання додана.
Кнопка "∨ ще N" розгортає всі.

---

## КРОК 5 — ОНОВИТИ NOTEBOOK

В src/components/Notebook/index.jsx:

### 5.1 Замінити читання з localStorage на props

```bash
grep -n "localStorage\|levytskyi_notes\|useState.*notes" src/components/Notebook/index.jsx | head -20
```

Знайти де Notebook читає нотатки і замінити на:
```jsx
// Було:
const [notes, setNotes] = useState(() =>
  JSON.parse(localStorage.getItem('levytskyi_notes') || '[]')
);

// Стало — використовувати props:
// notes, onAddNote, onUpdateNote, onDeleteNote, onPinNote приходять через props
```

### 5.2 Редагування нотаток в Notebook

Notebook повинен вміти редагувати будь-яку нотатку незалежно звідки вона створена.
При редагуванні викликати onUpdateNote(noteId, { text: newText }).

```bash
grep -n "onEdit\|editNote\|updateNote\|onChange.*note" src/components/Notebook/index.jsx | head -10
```

Якщо редагування не реалізоване — додати inline редагування:
при кліку на нотатку textarea стає редагованою, по blur — onUpdateNote.

---

## КРОК 6 — ПЕРЕВІРИТИ saveNoteToStorage

```bash
grep -n "saveNoteToStorage" src/App.jsx | head -10
```

Якщо функція є — оновити щоб вона також оновлювала notes[] state:
```jsx
function saveNoteToStorage(text, resultPayload, caseId, caseName, source, category) {
  addNote({ text, caseId, caseName, source, category });
}
```

Або замінити всі виклики saveNoteToStorage на addNote.

---

## КРОК 7 — ЗБІРКА І ДЕПЛОЙ

```bash
npm run build
git add -A && git commit -m "feat: shared notes state, inline note modal, pin note, fix case.notes field" && git push origin main
```

---

## КРИТЕРІЇ ЗАВЕРШЕННЯ

- [ ] notes[] є в App.jsx state і синхронізується з localStorage
- [ ] addNote / updateNote / deleteNote / pinNote живуть тільки в App.jsx
- [ ] CaseDossier отримує notes через props і не читає localStorage напряму
- [ ] Notebook отримує notes через props і не читає localStorage напряму
- [ ] Нова нотатка в Досьє НЕ перезаписує поле case.notes
- [ ] case.notes в "ІНФОРМАЦІЯ ПРО СПРАВУ" редагується inline як раніше
- [ ] Блок "НОТАТКИ ПО СПРАВІ" показує список нотаток з notes[]
- [ ] Кнопка "+ Додати" відкриває inline модалку (не prompt)
- [ ] Textarea в модалці багаторядкова
- [ ] Кнопка 📌 закріплює нотатку
- [ ] Закріплена нотатка показується першою
- [ ] Нотатки створені в Досьє видно і редагуються в Notebook
- [ ] Нотатки створені в Notebook видно в Досьє
- [ ] npm run build без помилок
