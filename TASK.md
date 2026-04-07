# TASK.md — Досьє під-сесія 2А
# Дата: 07.04.2026
# Гілка: main

## МЕТА

Три речі:
1. Кнопка "Відновити" для закритих справ в реєстрі
2. Форма "+ Провадження" в досьє
3. Форма "+ Документ" в досьє
Після цього адвокат може вручну наповнювати справу — дерево матеріалів стає живим.

---

## КРОК 0 — ДІАГНОСТИКА

```bash
grep -n "status.*closed\|Закрит\|restoreCase" src/App.jsx | head -10
grep -n "dossierCase\|CaseDossier\|proceedings\|documents" src/App.jsx | head -20
grep -n "updateCase" src/App.jsx | head -10
```

---

## КРОК 1 — КНОПКА "ВІДНОВИТИ" В РЕЄСТРІ

Знайти де рендеряться кнопки дій для закритих справ (після попереднього таску там вже є "Видалити назавжди").

Додати поруч кнопку "Відновити":

```jsx
function restoreCase(caseId) {
  setCases(prev => prev.map(c =>
    c.id === caseId ? { ...c, status: 'active' } : c
  ));
  saveToDrive();
}
```

Кнопка — зелена, тільки для status === 'closed':
```jsx
<button
  onClick={() => restoreCase(c.id)}
  style={{
    color: '#2ecc71',
    background: 'rgba(46,204,113,.1)',
    border: '1px solid rgba(46,204,113,.3)',
    padding: '4px 10px', borderRadius: 6,
    cursor: 'pointer', fontSize: 11
  }}
>
  Відновити
</button>
```

Після відновлення справа повертається в статус 'active' і з'являється в загальному списку.

---

## КРОК 2 — АВТОМАТИЧНЕ ПРОВАДЖЕННЯ В ДОСЬЄ

В компоненті src/components/CaseDossier/index.jsx знайти де визначається `proceedings`:

```jsx
const proceedings = caseData.proceedings || [];
```

Замінити на логіку автоматичного створення якщо порожній:

```jsx
const proceedings = (caseData.proceedings && caseData.proceedings.length > 0)
  ? caseData.proceedings
  : [{
      id: 'proc_main',
      type: 'first',
      title: 'Основне провадження',
      court: caseData.court || '',
      status: 'active',
      parentProcId: null,
      parentEventId: null
    }];
```

Це дає можливість одразу додавати документи навіть якщо провадження не налаштовані.

---

## КРОК 3 — ФОРМА "+ ПРОВАДЖЕННЯ"

### 3.1 State для модалки

В CaseDossier додати:
```jsx
const [procModalOpen, setProcModalOpen] = useState(false);
const [newProc, setNewProc] = useState({ title: '', court: '', type: 'appeal' });
```

### 3.2 Кнопка в правій колонці Огляду

Знайти де рендерується блок "Провадження" в renderOverview().
Після списку проваджень додати кнопку:
```jsx
<button
  onClick={() => setProcModalOpen(true)}
  style={{
    width: '100%', padding: '7px', background: 'none',
    border: '1px dashed #2e3148', borderRadius: 7,
    color: '#5a6080', cursor: 'pointer', fontSize: 12,
    marginTop: 6
  }}
>
  + Додати провадження
</button>
```

### 3.3 Модалка "+ Провадження"

```jsx
{procModalOpen && (
  <div style={{
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 300
  }}>
    <div style={{
      background: '#1a1d27', border: '1px solid #2e3148',
      borderRadius: 12, padding: 20, width: 360
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>
        + Нове провадження
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

        <div>
          <div style={{ fontSize: 11, color: '#5a6080', marginBottom: 4 }}>Тип</div>
          <select
            value={newProc.type}
            onChange={e => setNewProc(p => ({ ...p, type: e.target.value }))}
            style={{
              width: '100%', background: '#222536', border: '1px solid #2e3148',
              color: '#e8eaf0', padding: '7px 10px', borderRadius: 6, fontSize: 12
            }}
          >
            <option value="appeal">Апеляційне провадження</option>
            <option value="cassation">Касація</option>
            <option value="first">Перша інстанція (додаткова)</option>
          </select>
        </div>

        <div>
          <div style={{ fontSize: 11, color: '#5a6080', marginBottom: 4 }}>Назва</div>
          <input
            value={newProc.title}
            onChange={e => setNewProc(p => ({ ...p, title: e.target.value }))}
            placeholder="напр. Апеляція: ухвала 03.2024"
            style={{
              width: '100%', background: '#222536', border: '1px solid #2e3148',
              color: '#e8eaf0', padding: '7px 10px', borderRadius: 6,
              fontSize: 12, outline: 'none', boxSizing: 'border-box'
            }}
          />
        </div>

        <div>
          <div style={{ fontSize: 11, color: '#5a6080', marginBottom: 4 }}>Суд</div>
          <input
            value={newProc.court}
            onChange={e => setNewProc(p => ({ ...p, court: e.target.value }))}
            placeholder="напр. Київський апеляційний суд"
            style={{
              width: '100%', background: '#222536', border: '1px solid #2e3148',
              color: '#e8eaf0', padding: '7px 10px', borderRadius: 6,
              fontSize: 12, outline: 'none', boxSizing: 'border-box'
            }}
          />
        </div>

      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
        <button
          onClick={() => { setProcModalOpen(false); setNewProc({ title: '', court: '', type: 'appeal' }); }}
          style={{
            background: 'none', border: '1px solid #2e3148',
            color: '#9aa0b8', padding: '5px 12px', borderRadius: 6,
            cursor: 'pointer', fontSize: 12
          }}
        >Скасувати</button>
        <button
          onClick={() => {
            if (!newProc.title.trim()) return;
            const proc = {
              id: 'proc_' + Date.now(),
              type: newProc.type,
              title: newProc.title.trim(),
              court: newProc.court.trim(),
              status: 'active',
              parentProcId: 'proc_main',
              parentEventId: null
            };
            const updated = [...proceedings, proc];
            updateCase && updateCase(caseData.id, 'proceedings', updated);
            setProcModalOpen(false);
            setNewProc({ title: '', court: '', type: 'appeal' });
          }}
          style={{
            background: '#4f7cff', color: '#fff', border: 'none',
            padding: '5px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12
          }}
        >Додати</button>
      </div>
    </div>
  </div>
)}
```

---

## КРОК 4 — ФОРМА "+ ДОКУМЕНТ"

### 4.1 State для модалки

```jsx
const [docModalOpen, setDocModalOpen] = useState(false);
const [newDoc, setNewDoc] = useState({
  name: '', date: '', category: 'court_act',
  author: 'court', procId: '', tags: []
});
```

### 4.2 Кнопка у вкладці Матеріали

В renderMaterials() знайти де є кнопка "+ Додати" і замінити її щоб відкривала модалку:
```jsx
<button
  onClick={() => {
    setNewDoc(d => ({ ...d, procId: proceedings[0]?.id || 'proc_main' }));
    setDocModalOpen(true);
  }}
  style={{
    background: '#4f7cff', color: '#fff', border: 'none',
    padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12
  }}
>+ Додати</button>
```

### 4.3 Модалка "+ Документ"

```jsx
{docModalOpen && (
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
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>
        + Новий документ
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

        <div>
          <div style={{ fontSize: 11, color: '#5a6080', marginBottom: 4 }}>Назва *</div>
          <input
            value={newDoc.name}
            onChange={e => setNewDoc(d => ({ ...d, name: e.target.value }))}
            placeholder="напр. Ухвала про відкриття провадження"
            style={{
              width: '100%', background: '#222536', border: '1px solid #2e3148',
              color: '#e8eaf0', padding: '7px 10px', borderRadius: 6,
              fontSize: 12, outline: 'none', boxSizing: 'border-box'
            }}
            autoFocus
          />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: '#5a6080', marginBottom: 4 }}>Дата</div>
            <input
              value={newDoc.date}
              onChange={e => setNewDoc(d => ({ ...d, date: e.target.value }))}
              placeholder="напр. березень 2023"
              style={{
                width: '100%', background: '#222536', border: '1px solid #2e3148',
                color: '#e8eaf0', padding: '7px 10px', borderRadius: 6,
                fontSize: 12, outline: 'none', boxSizing: 'border-box'
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: '#5a6080', marginBottom: 4 }}>Провадження</div>
            <select
              value={newDoc.procId}
              onChange={e => setNewDoc(d => ({ ...d, procId: e.target.value }))}
              style={{
                width: '100%', background: '#222536', border: '1px solid #2e3148',
                color: '#e8eaf0', padding: '7px 10px', borderRadius: 6, fontSize: 12
              }}
            >
              {proceedings.map(p => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: '#5a6080', marginBottom: 4 }}>Тип</div>
            <select
              value={newDoc.category}
              onChange={e => setNewDoc(d => ({ ...d, category: e.target.value }))}
              style={{
                width: '100%', background: '#222536', border: '1px solid #2e3148',
                color: '#e8eaf0', padding: '7px 10px', borderRadius: 6, fontSize: 12
              }}
            >
              <option value="court_act">Судовий акт</option>
              <option value="pleading">Заява по суті</option>
              <option value="motion">Клопотання</option>
              <option value="evidence">Докази</option>
              <option value="correspondence">Листування</option>
              <option value="other">Інше</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: '#5a6080', marginBottom: 4 }}>Від кого</div>
            <select
              value={newDoc.author}
              onChange={e => setNewDoc(d => ({ ...d, author: e.target.value }))}
              style={{
                width: '100%', background: '#222536', border: '1px solid #2e3148',
                color: '#e8eaf0', padding: '7px 10px', borderRadius: 6, fontSize: 12
              }}
            >
              <option value="court">Суд</option>
              <option value="ours">Наш</option>
              <option value="opponent">Опонент</option>
            </select>
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, color: '#5a6080', marginBottom: 4 }}>
            Ключовий документ
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={newDoc.tags.includes('key')}
              onChange={e => setNewDoc(d => ({
                ...d,
                tags: e.target.checked
                  ? [...d.tags, 'key']
                  : d.tags.filter(t => t !== 'key')
              }))}
            />
            <span style={{ fontSize: 12, color: '#9aa0b8' }}>Позначити як ключовий</span>
          </label>
        </div>

      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
        <button
          onClick={() => {
            setDocModalOpen(false);
            setNewDoc({ name: '', date: '', category: 'court_act', author: 'court', procId: '', tags: [] });
          }}
          style={{
            background: 'none', border: '1px solid #2e3148',
            color: '#9aa0b8', padding: '5px 12px', borderRadius: 6,
            cursor: 'pointer', fontSize: 12
          }}
        >Скасувати</button>
        <button
          onClick={() => {
            if (!newDoc.name.trim()) return;
            const ICONS = {
              court_act: '📋', pleading: '📄',
              motion: '📝', evidence: '📎',
              correspondence: '✉️', other: '📁'
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
              driveId: null,
              notes: ''
            };
            const updated = [...(caseData.documents || []), doc];
            updateCase && updateCase(caseData.id, 'documents', updated);
            setDocModalOpen(false);
            setNewDoc({ name: '', date: '', category: 'court_act', author: 'court', procId: '', tags: [] });
          }}
          style={{
            background: '#4f7cff', color: '#fff', border: 'none',
            padding: '5px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12
          }}
        >Додати документ</button>
      </div>
    </div>
  </div>
)}
```

---

## КРОК 5 — ПЕРЕВІРИТИ updateCase В App.jsx

```bash
grep -n "function updateCase\|const updateCase" src/App.jsx | head -5
```

Функція має оновлювати будь-яке поле справи включно з масивами:
```jsx
function updateCase(caseId, field, value) {
  setCases(prev => prev.map(c =>
    c.id === caseId ? { ...c, [field]: value } : c
  ));
  saveToDrive();
}
```

Якщо saveToDrive не викликається після updateCase — додати.

---

## КРОК 6 — ЗБІРКА І ДЕПЛОЙ

```bash
npm run build
git add -A && git commit -m "feat: restore case, add proceeding and document forms in dossier" && git push origin main
```

---

## КРИТЕРІЇ ЗАВЕРШЕННЯ

- [ ] Кнопка "Відновити" є у закритих справах в реєстрі
- [ ] Після "Відновити" справа повертається в статус active
- [ ] В досьє якщо немає проваджень — "Основне провадження" створюється автоматично
- [ ] Кнопка "+ Додати провадження" в Огляді → модалка з 3 полями
- [ ] Нове провадження з'являється в списку проваджень і в дереві Матеріалів
- [ ] Кнопка "+ Додати" у Матеріалах → модалка документа
- [ ] Новий документ з'являється в дереві під правим провадженням
- [ ] Новий документ з'являється в реєстрі з правильними фільтрами
- [ ] Дані зберігаються через updateCase і потрапляють в Drive
- [ ] npm run build без помилок
