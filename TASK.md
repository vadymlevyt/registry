# TASK.md — Досьє під-сесія 2Г
# Дата: 07.04.2026
# Гілка: main

## КРИТИЧНЕ ПРАВИЛО
Після успішного npm run build — ЗАВЖДИ виконати без запитань:
git add -A && git commit -m "feat: dossier agent split panel, QI z-index fix, notes pin fix" && git push origin main
Не питати підтвердження. Просто виконати.

---

## МЕТА

1. Агент досьє — реалізувати як split панель (кнопка "Агент" зараз не працює)
2. Огляд досьє — агент відкритий одразу при вході
3. QI z-index фікс — QI і головний агент поверх досьє завжди
4. 📌 в Записній книжці — додати кнопку закріплення
5. Поле "Нотатки до справи" — показувати текст закріплених нотаток
6. Рухома межа між деревом і viewer у вкладці Матеріали
7. Файли при додаванні документа — зафіксувати стан і що відбувається

---

## КРОК 0 — ДІАГНОСТИКА

```bash
# Перевірити стан кнопки Агент
grep -n "агент\|Агент\|agentOpen\|agentPanel\|toggleAgent" src/components/CaseDossier/index.jsx | head -20

# Перевірити z-index QI
grep -n "zIndex\|z-index\|showQI\|QuickInput" src/App.jsx | head -20

# Перевірити split панель в QI як референс
grep -n "split\|resiz\|isDragging\|isLandscape" src/App.jsx | head -20
```

---

## КРОК 1 — АГЕНТ ДОСЬЄ (split панель)

### 1.1 Додати state для агента

В src/components/CaseDossier/index.jsx додати:

```jsx
const [agentOpen, setAgentOpen] = useState(true); // відкритий одразу на Огляді
const [agentWidth, setAgentWidth] = useState(320); // ширина панелі агента
const [agentMessages, setAgentMessages] = useState([]);
const [agentInput, setAgentInput] = useState('');
const [agentLoading, setAgentLoading] = useState(false);
const agentDragRef = useRef(false);
```

### 1.2 Логіка відкриття агента

```jsx
// Агент відкритий одразу тільки на вкладці Огляд
// На інших вкладках — по кнопці
useEffect(() => {
  setAgentOpen(activeTab === 'overview');
}, [activeTab]);
```

### 1.3 Кнопка Агент в шапці

Знайти кнопку "🤖 Агент" в шапці і виправити onClick:
```jsx
<button
  onClick={() => setAgentOpen(prev => !prev)}
  style={{
    background: agentOpen ? '#4f7cff' : 'none',
    color: agentOpen ? '#fff' : '#9aa0b8',
    border: '1px solid',
    borderColor: agentOpen ? '#4f7cff' : '#2e3148',
    padding: '6px 14px', borderRadius: 7,
    cursor: 'pointer', fontSize: 12, fontWeight: 500
  }}
>
  🤖 Агент
</button>
```

### 1.4 Split layout з агентом

Замінити основний body (div з flex: 1) на split layout:

```jsx
<div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

  {/* Основний вміст вкладки */}
  <div style={{
    flex: 1, display: 'flex', flexDirection: 'column',
    minHeight: 0, overflow: 'hidden',
    minWidth: 0
  }}>
    {activeTab === 'overview' && renderOverview()}
    {activeTab === 'materials' && renderMaterials()}
    {['position', 'templates'].includes(activeTab) && renderPlaceholder(activeTab)}
  </div>

  {/* Рухома межа */}
  {agentOpen && (
    <div
      onMouseDown={() => { agentDragRef.current = true; }}
      onTouchStart={() => { agentDragRef.current = true; }}
      style={{
        width: 6, cursor: 'col-resize', flexShrink: 0,
        background: '#2e3148',
        transition: 'background .15s'
      }}
      onMouseEnter={e => e.currentTarget.style.background = '#4f7cff'}
      onMouseLeave={e => e.currentTarget.style.background = '#2e3148'}
    />
  )}

  {/* Панель агента */}
  {agentOpen && (
    <div style={{
      width: agentWidth, flexShrink: 0,
      borderLeft: '1px solid #2e3148',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden', background: '#1a1d27'
    }}>
      {renderAgentPanel()}
    </div>
  )}

</div>
```

### 1.5 Drag для межі агента

Додати useEffect для drag resize:

```jsx
useEffect(() => {
  function onMouseMove(e) {
    if (!agentDragRef.current) return;
    const containerWidth = window.innerWidth;
    const newWidth = containerWidth - e.clientX;
    if (newWidth > 200 && newWidth < containerWidth * 0.6) {
      setAgentWidth(newWidth);
    }
  }
  function onMouseUp() { agentDragRef.current = false; }
  function onTouchMove(e) {
    if (!agentDragRef.current) return;
    const touch = e.touches[0];
    const newWidth = window.innerWidth - touch.clientX;
    if (newWidth > 200 && newWidth < window.innerWidth * 0.6) {
      setAgentWidth(newWidth);
    }
  }

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('touchmove', onTouchMove);
  window.addEventListener('touchend', onMouseUp);

  return () => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onMouseUp);
  };
}, []);
```

### 1.6 renderAgentPanel — чат агента досьє

```jsx
function renderAgentPanel() {
  const apiKey = localStorage.getItem('claude_api_key');

  async function sendAgentMessage() {
    if (!agentInput.trim() || agentLoading) return;
    const userMsg = agentInput.trim();
    setAgentInput('');
    setAgentMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setAgentLoading(true);

    try {
      const systemPrompt = `Ти агент справи "${caseData.name}".
Знаєш про справу:
- Суд: ${caseData.court || 'не вказано'}
- Номер: ${caseData.case_no || 'не вказано'}
- Категорія: ${caseData.category || 'не вказано'}
- Статус: ${caseData.status || 'не вказано'}
- Провадження: ${JSON.stringify(caseData.proceedings || [])}
- Документів: ${(caseData.documents || []).length}
Відповідай українською. Допомагай з аналізом і тактикою по справі.`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: systemPrompt,
          messages: [
            ...agentMessages,
            { role: 'user', content: userMsg }
          ]
        })
      });

      const data = await response.json();
      const reply = data.content?.[0]?.text || 'Помилка відповіді';
      setAgentMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      setAgentMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Помилка з\'єднання з агентом.'
      }]);
    }
    setAgentLoading(false);
  }

  return (
    <>
      {/* Заголовок панелі */}
      <div style={{
        padding: '10px 12px', borderBottom: '1px solid #2e3148',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0
      }}>
        <span style={{ fontSize: 14 }}>🤖</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>Агент досьє</div>
          <div style={{ fontSize: 10, color: '#5a6080' }}>Sonnet · знає справу</div>
        </div>
        <button
          onClick={() => setAgentMessages([])}
          style={{
            background: 'none', border: 'none',
            color: '#5a6080', cursor: 'pointer', fontSize: 10
          }}
        >Очистити</button>
      </div>

      {/* Повідомлення */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: 10,
        display: 'flex', flexDirection: 'column', gap: 8
      }}>
        {agentMessages.length === 0 && (
          <div style={{ fontSize: 11, color: '#3a3f58', textAlign: 'center', marginTop: 20 }}>
            Запитайте про справу, тактику або документи
          </div>
        )}
        {agentMessages.map((msg, i) => (
          <div key={i} style={{
            padding: '8px 10px', borderRadius: 8, fontSize: 12,
            lineHeight: 1.6, maxWidth: '90%',
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            background: msg.role === 'user'
              ? 'rgba(79,124,255,.2)'
              : '#222536',
            color: '#e8eaf0'
          }}>
            {msg.content}
          </div>
        ))}
        {agentLoading && (
          <div style={{
            padding: '8px 10px', borderRadius: 8,
            background: '#222536', fontSize: 12, color: '#5a6080'
          }}>⏳ Думаю...</div>
        )}
      </div>

      {/* Поле вводу */}
      <div style={{
        padding: 8, borderTop: '1px solid #2e3148',
        display: 'flex', gap: 6, flexShrink: 0
      }}>
        <textarea
          value={agentInput}
          onChange={e => setAgentInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendAgentMessage();
            }
          }}
          placeholder="Запитати агента..."
          rows={2}
          style={{
            flex: 1, background: '#222536',
            border: '1px solid #2e3148', color: '#e8eaf0',
            padding: '6px 8px', borderRadius: 6,
            fontSize: 12, resize: 'none', outline: 'none',
            lineHeight: 1.5
          }}
        />
        <button
          onClick={sendAgentMessage}
          disabled={agentLoading || !agentInput.trim()}
          style={{
            background: '#4f7cff', border: 'none', color: '#fff',
            padding: '0 12px', borderRadius: 6,
            cursor: agentLoading ? 'default' : 'pointer',
            fontSize: 16, opacity: agentLoading ? 0.5 : 1
          }}
        >→</button>
      </div>
    </>
  );
}
```

---

## КРОК 2 — QI Z-INDEX ФІКс

### 2.1 Знайти z-index QuickInput

```bash
grep -n "zIndex\|QuickInput\|showQI" src/App.jsx | head -30
```

### 2.2 Переконатись що QI має найвищий z-index

QI і головний агент повинні бути поверх ВСЬОГО включно з досьє (z-index: 100).

В App.jsx де рендериться QuickInput — перевірити що wrapper має:
```jsx
style={{ zIndex: 1000 }} // більше ніж у CaseDossier (100)
```

В CaseDossier overlay:
```jsx
// Замінити z-index з 100 на нижчий щоб QI був поверх:
style={{ position: 'fixed', inset: 0, zIndex: 50, ... }}
```

Ієрархія z-index:
```
CaseDossier overlay:  z-index: 50
Модалки в досьє:      z-index: 60
QI панель:            z-index: 1000
Головний агент:       z-index: 1000
```

### 2.3 Поведінка при виклику QI поверх досьє

Коли QI відкривається поверх досьє — досьє з агентом стискається
у простір що залишився. Це відбувається автоматично якщо QI
використовує `position: fixed` з правильним z-index.
Досьє нічого спеціально робити не треба.

---

## КРОК 3 — РУХОМА МЕЖА У МАТЕРІАЛАХ

У renderMaterials() замінити статичну ліву панель на split з drag:

```jsx
function renderMaterials() {
  const [matWidth, setMatWidth] = useState(300);
  const matDragRef = useRef(false);

  // useEffect для drag (аналогічний агенту)
  useEffect(() => {
    function onMove(e) {
      if (!matDragRef.current) return;
      const newWidth = e.clientX;
      if (newWidth > 150 && newWidth < window.innerWidth * 0.5) {
        setMatWidth(newWidth);
      }
    }
    function onUp() { matDragRef.current = false; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      {/* Ліва панель — фіксована ширина з drag */}
      <div style={{
        width: matWidth, flexShrink: 0,
        borderRight: '1px solid #2e3148',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* існуючий вміст лівої панелі */}
      </div>

      {/* Рухома межа */}
      <div
        onMouseDown={() => { matDragRef.current = true; }}
        style={{
          width: 6, cursor: 'col-resize', flexShrink: 0,
          background: '#2e3148'
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#4f7cff'}
        onMouseLeave={e => e.currentTarget.style.background = '#2e3148'}
      />

      {/* Viewer */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* існуючий viewer */}
      </div>
    </div>
  );
}
```

---

## КРОК 4 — 📌 В ЗАПИСНІЙ КНИЖЦІ

```bash
grep -n "pinNote\|onPinNote\|pinned\|pin" src/components/Notebook/index.jsx | head -20
```

Знайти де рендеруються нотатки в Notebook і додати кнопку 📌:

```jsx
// В картці нотатки додати кнопку поруч з іншими діями:
<button
  onClick={() => onPinNote && onPinNote(note.id)}
  title={note.pinned ? 'Зняти закріплення' : 'Закріпити як основну'}
  style={{
    background: 'none', border: 'none',
    cursor: 'pointer', fontSize: 12,
    color: note.pinned ? '#4f7cff' : '#3a3f58',
    padding: '2px 4px'
  }}
>📌</button>
```

---

## КРОК 5 — ПОЛЕ "НОТАТКИ ДО СПРАВИ" — ТЕКСТ ЗАКРІПЛЕНИХ

В renderOverview() знайти блок "НОТАТКИ ПО СПРАВІ".

Поле `case.notes` в блоці "ІНФОРМАЦІЯ ПРО СПРАВУ" — окреме поле для ручного опису.
НЕ чіпати його автоматично.

Замість цього — в блоці "НОТАТКИ ПО СПРАВІ" показувати закріплені нотатки
окремо від списку, у вигляді зведеного тексту:

```jsx
{/* Закріплені нотатки — зведений текст */}
{caseNotes.filter(n => n.pinned).length > 0 && (
  <div style={{
    background: 'rgba(79,124,255,.06)',
    border: '1px solid rgba(79,124,255,.2)',
    borderRadius: 8, padding: '10px 12px', marginBottom: 10
  }}>
    <div style={{
      fontSize: 10, color: '#4f7cff',
      textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8
    }}>
      📌 Закріплені нотатки
    </div>
    {caseNotes.filter(n => n.pinned).map((note, i) => (
      <div key={note.id} style={{
        fontSize: 12, color: '#9aa0b8', lineHeight: 1.65,
        paddingTop: i > 0 ? 8 : 0,
        marginTop: i > 0 ? 8 : 0,
        borderTop: i > 0 ? '1px solid #2e3148' : 'none'
      }}>
        <div style={{ fontSize: 10, color: '#5a6080', marginBottom: 3 }}>
          {new Date(note.ts).toLocaleDateString('uk-UA')}
        </div>
        {String(note.text || '')}
      </div>
    ))}
  </div>
)}
```

---

## КРОК 6 — ФАЙЛИ ПРИ ДОДАВАННІ ДОКУМЕНТА (діагностика)

```bash
grep -n "uploadFileToDrive\|driveId\|driveUrl" src/components/CaseDossier/index.jsx | head -20
```

Перевірити чи функція uploadFileToDrive викликається і що повертає.
Додати console.log для діагностики:

```jsx
async function uploadFileToDrive(file, caseData) {
  console.log('uploadFileToDrive called:', file.name, file.size);
  const token = localStorage.getItem('levytskyi_drive_token');
  console.log('Drive token exists:', !!token);
  // ... решта функції
}
```

Якщо token відсутній або driveConnected false — показувати повідомлення:
"Файл збережено локально. Підключіть Google Drive для збереження в хмарі."

І зберігати документ без driveId — тільки метадані. Це нормальна поведінка
поки Drive не підключений.

---

## КРОК 7 — ЗБІРКА І ДЕПЛОЙ

```bash
npm run build 2>&1 | tail -20
git add -A && git commit -m "feat: dossier agent split panel, QI z-index fix, notes pin in notebook, resizable materials" && git push origin main
```

---

## КРИТЕРІЇ ЗАВЕРШЕННЯ

- [ ] Кнопка "🤖 Агент" в шапці досьє відкриває/закриває панель
- [ ] На вкладці Огляд агент відкритий одразу
- [ ] На інших вкладках агент закритий, відкривається кнопкою
- [ ] Панель агента справа з рухомою межею
- [ ] Агент відповідає (Sonnet API)
- [ ] QI відкривається поверх досьє (не ховається під ним)
- [ ] 📌 є в Записній книжці
- [ ] Закріплені нотатки показуються в блоці "Закріплені нотатки" в Огляді
- [ ] Кілька закріплених нотаток — текст іде один за одним з датами
- [ ] Рухома межа між деревом і viewer у вкладці Матеріали
- [ ] Документ без файлу зберігається нормально (тільки метадані)
- [ ] npm run build без помилок
