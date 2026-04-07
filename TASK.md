# TASK.md — Досьє під-сесія 2Б
# Дата: 07.04.2026
# Гілка: main

## МЕТА

Чотири речі:
1. Повернути нотатки в вкладку Огляд
2. Файл при "+ Документ" — завантажити на Drive + viewer показує реальний файл
3. Drop zone в Огляді — завантаження файлів
4. Базові файлові операції: конвертація HEIC/JPEG→PDF, стиснення

---

## КРОК 0 — ДІАГНОСТИКА

```bash
grep -n "notes\|levytskyi_notes\|pinnedNote\|notesExpanded" src/components/CaseDossier/index.jsx | head -20
grep -n "driveConnected\|drive_token\|uploadFile\|createFile" src/App.jsx | head -20
grep -n "driveFolderId\|driveFolder" src/App.jsx | head -10
```

---

## КРОК 1 — ПОВЕРНУТИ НОТАТКИ В ОГЛЯД

В src/components/CaseDossier/index.jsx знайти функцію renderOverview().
Нотатки були там раніше але зникли. Відновити блок після секції "Провадження".

Логіка нотаток:
- Читати з localStorage('levytskyi_notes')
- Фільтрувати по caseId або caseName
- Сортувати по даті (нові зверху)
- Показувати закріплену або першу нотатку
- Кнопка "∨ ще N" розгортає всі

```jsx
// Додати в тіло компонента (після useState блоку):
const notes = JSON.parse(localStorage.getItem('levytskyi_notes') || '[]')
  .filter(n => n.caseId === caseData.id || n.caseName === caseData.name)
  .sort((a, b) => new Date(b.ts) - new Date(a.ts));
const pinnedNote = notes.find(n => n.pinned) || notes[0];

// Додати useState:
const [notesExpanded, setNotesExpanded] = useState(false);
```

Блок нотаток в renderOverview() після блоку проваджень:

```jsx
{/* Нотатки */}
<div style={{
  background: '#1a1d27', border: '1px solid #2e3148',
  borderRadius: 10, padding: 16, marginBottom: 16
}}>
  <div style={{
    display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 10
  }}>
    <div style={{
      fontSize: 10, color: '#5a6080',
      textTransform: 'uppercase', letterSpacing: '.06em'
    }}>Нотатки по справі</div>
    <div style={{ display: 'flex', gap: 6 }}>
      {notes.length > 1 && (
        <button
          onClick={() => setNotesExpanded(!notesExpanded)}
          style={{
            background: 'none', border: '1px solid #2e3148',
            color: '#9aa0b8', padding: '3px 8px',
            borderRadius: 5, cursor: 'pointer', fontSize: 11
          }}
        >
          {notesExpanded ? '∧ Згорнути' : `∨ ще ${notes.length - 1}`}
        </button>
      )}
      <button
        onClick={addNote}
        style={{
          background: 'none', border: '1px solid #2e3148',
          color: '#9aa0b8', padding: '3px 8px',
          borderRadius: 5, cursor: 'pointer', fontSize: 11
        }}
      >+ Додати</button>
    </div>
  </div>

  {notes.length === 0 ? (
    <div style={{ fontSize: 12, color: '#3a3f58' }}>Нотаток поки немає</div>
  ) : (notesExpanded ? notes : [pinnedNote]).filter(Boolean).map(note => (
    <div key={note.id} style={{
      padding: '8px 10px', background: '#222536',
      borderRadius: 7, marginBottom: 6,
      fontSize: 12, color: '#9aa0b8', lineHeight: 1.6
    }}>
      {note.pinned && (
        <span style={{ fontSize: 9, color: '#4f7cff', marginRight: 6 }}>📌</span>
      )}
      {String(note.text || '')}
      <div style={{ fontSize: 10, color: '#3a3f58', marginTop: 4 }}>
        {new Date(note.ts).toLocaleDateString('uk-UA')}
      </div>
    </div>
  ))}
</div>
```

Переконатись що функція addNote існує в компоненті:
```jsx
function addNote() {
  const text = prompt('Нова нотатка:');
  if (!text) return;
  const all = JSON.parse(localStorage.getItem('levytskyi_notes') || '[]');
  all.push({
    id: Date.now(),
    text,
    category: 'case',
    caseId: caseData.id,
    caseName: caseData.name,
    source: 'manual',
    ts: new Date().toISOString()
  });
  localStorage.setItem('levytskyi_notes', JSON.stringify(all));
}
```

---

## КРОК 2 — ФАЙЛ ПРИ "+ ДОКУМЕНТ"

### 2.1 Додати поле файлу в модалку документа

В модалці "+ Документ" після поля "Ключовий документ" додати:

```jsx
<div>
  <div style={{ fontSize: 11, color: '#5a6080', marginBottom: 4 }}>
    Файл (необов'язково)
  </div>
  <input
    type="file"
    accept=".pdf,.jpg,.jpeg,.png,.heic,.doc,.docx"
    onChange={e => setNewDoc(d => ({ ...d, file: e.target.files[0] || null }))}
    style={{
      width: '100%', background: '#222536',
      border: '1px solid #2e3148', color: '#9aa0b8',
      padding: '6px 10px', borderRadius: 6, fontSize: 11
    }}
  />
</div>
```

Додати file в початковий стан:
```jsx
const [newDoc, setNewDoc] = useState({
  name: '', date: '', category: 'court_act',
  author: 'court', procId: '', tags: [], file: null
});
```

### 2.2 Завантаження файлу на Drive при збереженні документа

Знайти функцію збереження документа (onClick кнопки "Додати документ").
Перед додаванням в documents[] — завантажити файл на Drive якщо є:

```jsx
onClick={async () => {
  if (!newDoc.name.trim()) return;

  let driveId = null;

  // Завантажити файл на Drive якщо є
  if (newDoc.file && driveConnected) {
    try {
      driveId = await uploadFileToDrive(newDoc.file, caseData);
    } catch (err) {
      console.error('Drive upload error:', err);
      // Продовжити без Drive — зберегти метадані
    }
  }

  const ICONS = {
    court_act: '📋', pleading: '📄', motion: '📝',
    evidence: '📎', correspondence: '✉️', other: '📁'
  };

  const doc = {
    id: Date.now(),
    procId: newDoc.procId || proceedings[0]?.id || 'proc_main',
    name: newDoc.name.trim(),
    icon: ICONS[newDoc.category] || '📄',
    date: newDoc.date.trim() || new Date().toLocaleDateString('uk-UA'),
    category: newDoc.category,
    author: newDoc.author,
    tags: newDoc.tags,
    driveId,           // ID файлу на Drive або null
    driveUrl: driveId ? `https://drive.google.com/file/d/${driveId}/view` : null,
    notes: ''
  };

  const updated = [...(caseData.documents || []), doc];
  updateCase && updateCase(caseData.id, 'documents', updated);
  setDocModalOpen(false);
  setNewDoc({ name: '', date: '', category: 'court_act', author: 'court', procId: '', tags: [], file: null });
}}
```

### 2.3 Функція uploadFileToDrive

Додати в src/components/CaseDossier/index.jsx або в App.jsx:

```jsx
async function uploadFileToDrive(file, caseData) {
  const token = localStorage.getItem('levytskyi_drive_token');
  if (!token) throw new Error('No Drive token');

  // Знайти або створити папку справи
  // Спочатку шукаємо існуючу папку
  const folderName = `${caseData.name}_${caseData.case_no || caseData.id}`;

  // Метадані файлу
  const metadata = {
    name: file.name,
    // Якщо є folderId справи — кладемо туди
    ...(caseData.driveFolderId ? { parents: [caseData.driveFolderId] } : {})
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: form
    }
  );

  if (!response.ok) throw new Error(`Drive upload failed: ${response.status}`);

  const data = await response.json();
  return data.id; // driveId файлу
}
```

### 2.4 Viewer — показати реальний файл з Drive

В renderMaterials() знайти де рендериться viewer (права панель).
Якщо у вибраного документа є driveId — показати посилання на файл:

```jsx
{selectedDoc.driveId ? (
  <div style={{ padding: 20 }}>
    <div style={{
      background: '#1a1d27', border: '1px solid #2e3148',
      borderRadius: 10, padding: 24, maxWidth: 680, margin: '0 auto'
    }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, textAlign: 'center', marginBottom: 16 }}>
        {selectedDoc.name}
      </h3>

      {/* Embed Google Drive viewer */}
      <iframe
        src={`https://drive.google.com/file/d/${selectedDoc.driveId}/preview`}
        style={{
          width: '100%', height: 500,
          border: 'none', borderRadius: 8
        }}
        allow="autoplay"
        title={selectedDoc.name}
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'center' }}>
        <a
          href={`https://drive.google.com/file/d/${selectedDoc.driveId}/view`}
          target="_blank"
          rel="noreferrer"
          style={{
            background: '#4f7cff', color: '#fff',
            padding: '6px 14px', borderRadius: 6,
            fontSize: 12, textDecoration: 'none'
          }}
        >Відкрити в Drive</a>
        <a
          href={`https://drive.google.com/uc?export=download&id=${selectedDoc.driveId}`}
          style={{
            background: '#222536', color: '#9aa0b8',
            border: '1px solid #2e3148',
            padding: '6px 14px', borderRadius: 6,
            fontSize: 12, textDecoration: 'none'
          }}
        >Завантажити</a>
      </div>
    </div>
  </div>
) : (
  // Існуючий placeholder якщо файлу немає
  <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
    <div style={{
      background: '#1a1d27', border: '1px solid #2e3148',
      borderRadius: 10, padding: 24, maxWidth: 680,
      margin: '0 auto', lineHeight: 1.8
    }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, textAlign: 'center', marginBottom: 4 }}>
        {selectedDoc.name}
      </h3>
      <div style={{ fontSize: 11, color: '#5a6080', textAlign: 'center', marginBottom: 16 }}>
        {selectedDoc.date}
      </div>
      {selectedDoc.notes && (
        <div style={{
          background: 'rgba(231,76,60,.08)', border: '1px solid rgba(231,76,60,.3)',
          padding: '8px 12px', borderRadius: 6, marginBottom: 12,
          fontSize: 11, color: '#e74c3c'
        }}>{selectedDoc.notes}</div>
      )}
      <p style={{ fontSize: 13, color: '#9aa0b8' }}>
        Для перегляду повного тексту прикріпіть файл з Google Drive.
      </p>
    </div>
  </div>
)}
```

---

## КРОК 3 — DROP ZONE В ОГЛЯДІ

В renderOverview() знайти блок завантаження файлів (зона з іконкою 📎).
Оновити щоб підтримував drag-and-drop і показував чергу:

```jsx
const [dropQueue, setDropQueue] = useState([]);
const [isDragOver, setIsDragOver] = useState(false);

// Drop zone
<div
  onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
  onDragLeave={() => setIsDragOver(false)}
  onDrop={e => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    setDropQueue(prev => [...prev, ...files.map(f => ({ file: f, status: 'pending' }))]);
  }}
  onClick={() => document.getElementById('dossierDropInput').click()}
  style={{
    background: isDragOver ? 'rgba(79,124,255,.05)' : '#1a1d27',
    border: `2px dashed ${isDragOver ? '#4f7cff' : '#2e3148'}`,
    borderRadius: 10, padding: 20, textAlign: 'center',
    cursor: 'pointer', transition: 'all .2s', marginBottom: 12
  }}
>
  <div style={{ fontSize: 28, marginBottom: 8, opacity: .4 }}>📎</div>
  <div style={{ fontSize: 13, fontWeight: 600, color: '#9aa0b8', marginBottom: 4 }}>
    {isDragOver ? 'Відпустіть файли' : 'Перетягніть або натисніть'}
  </div>
  <div style={{ fontSize: 11, color: '#5a6080' }}>
    PDF, JPEG, PNG, HEIC, Word — будь-яка кількість
  </div>
  <input
    id="dossierDropInput"
    type="file"
    multiple
    accept=".pdf,.jpg,.jpeg,.png,.heic,.doc,.docx"
    style={{ display: 'none' }}
    onChange={e => {
      const files = Array.from(e.target.files);
      setDropQueue(prev => [...prev, ...files.map(f => ({ file: f, status: 'pending' }))]);
    }}
  />
</div>

{/* Черга файлів */}
{dropQueue.length > 0 && (
  <div style={{
    background: '#1a1d27', border: '1px solid #2e3148',
    borderRadius: 8, overflow: 'hidden', marginBottom: 12
  }}>
    {dropQueue.map((item, i) => (
      <div key={i} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', borderBottom: '1px solid #2e3148'
      }}>
        <span style={{ fontSize: 13 }}>
          {item.file.name.match(/\.(jpg|jpeg|png|heic)$/i) ? '🖼' : '📄'}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 11, fontWeight: 500,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
          }}>{item.file.name}</div>
          <div style={{ fontSize: 10, color: '#5a6080' }}>
            {(item.file.size / 1024 / 1024).toFixed(1)} МБ
          </div>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 600,
          color: item.status === 'done' ? '#2ecc71' :
                 item.status === 'error' ? '#e74c3c' : '#9aa0b8'
        }}>
          {item.status === 'done' ? '✓' :
           item.status === 'error' ? '✗' : '⏳'}
        </span>
      </div>
    ))}
    <div style={{ padding: 8, display: 'flex', gap: 6 }}>
      <button
        onClick={() => setDropQueue([])}
        style={{
          flex: 1, background: 'none', border: '1px solid #2e3148',
          color: '#9aa0b8', padding: '5px', borderRadius: 5,
          cursor: 'pointer', fontSize: 11
        }}
      >Очистити</button>
      <button
        onClick={async () => {
          // Завантажити кожен файл на Drive
          for (let i = 0; i < dropQueue.length; i++) {
            setDropQueue(prev => prev.map((item, idx) =>
              idx === i ? { ...item, status: 'uploading' } : item
            ));
            try {
              if (driveConnected) {
                await uploadFileToDrive(dropQueue[i].file, caseData);
              }
              setDropQueue(prev => prev.map((item, idx) =>
                idx === i ? { ...item, status: 'done' } : item
              ));
            } catch {
              setDropQueue(prev => prev.map((item, idx) =>
                idx === i ? { ...item, status: 'error' } : item
              ));
            }
          }
        }}
        style={{
          flex: 2, background: '#4f7cff', border: 'none',
          color: '#fff', padding: '5px', borderRadius: 5,
          cursor: 'pointer', fontSize: 11, fontWeight: 600
        }}
      >▶ Завантажити на Drive</button>
    </div>
  </div>
)}
```

---

## КРОК 4 — КОНВЕРТАЦІЯ HEIC → PDF (базова)

При завантаженні HEIC файлу через drop zone або форму документа —
автоматично конвертувати через heic2any якщо бібліотека є:

```bash
grep -n "heic2any\|heic" src/App.jsx | head -10
```

Якщо heic2any вже є — додати конвертацію перед uploadFileToDrive:

```jsx
async function prepareFile(file) {
  // Конвертувати HEIC в JPEG
  if (file.name.match(/\.heic$/i) || file.type === 'image/heic') {
    try {
      const heic2any = (await import('heic2any')).default;
      const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
      return new File([blob], file.name.replace(/\.heic$/i, '.jpg'), { type: 'image/jpeg' });
    } catch (err) {
      console.error('HEIC conversion failed:', err);
      return file; // повернути оригінал якщо не вдалось
    }
  }
  return file;
}
```

Викликати перед uploadFileToDrive:
```jsx
const preparedFile = await prepareFile(newDoc.file);
driveId = await uploadFileToDrive(preparedFile, caseData);
```

---

## КРОК 5 — ЗБІРКА І ДЕПЛОЙ

```bash
npm run build
git add -A && git commit -m "feat: restore notes, file upload to Drive, drop zone, HEIC conversion" && git push origin main
```

---

## КРИТЕРІЇ ЗАВЕРШЕННЯ

- [ ] Нотатки показуються в Огляді (закріплена + розгортаються)
- [ ] Кнопка "+ Додати" в нотатках працює
- [ ] Форма "+ Документ" має поле файлу
- [ ] Файл завантажується на Drive при збереженні документа
- [ ] Документ з driveId показує iframe viewer з Drive
- [ ] Документ без driveId показує placeholder
- [ ] Drop zone в Огляді приймає файли drag-and-drop і через кнопку
- [ ] Черга файлів показує назву, розмір, статус
- [ ] Кнопка "▶ Завантажити на Drive" завантажує файли з черги
- [ ] HEIC конвертується в JPEG перед завантаженням
- [ ] npm run build без помилок
