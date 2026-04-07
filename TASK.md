# TASK.md — Досьє агент: фікси + пам'ять
# Дата: 07.04.2026
# Гілка: main

## КРИТИЧНЕ ПРАВИЛО
Після успішного npm run build — ЗАВЖДИ без запитань:
git add -A && git commit -m "feat: dossier agent memory, QI draggable, agent button fixes" && git push origin main

---

## МЕТА

1. Кнопка "🤖 Агент" — повернути на всі вкладки, toggle відкрити/сховати
2. Кнопка QI і кнопка Агента не накладаються
3. Кнопка QI — рухома (drag по екрану)
4. Пам'ять агента — зберігається між сесіями в agentHistory[] справи
5. Кнопка "Нова розмова" — очищає тільки по явному натисканню

---

## КРОК 0 — ДІАГНОСТИКА

```bash
grep -n "agentOpen\|agentMessages\|agentHistory\|Агент" src/components/CaseDossier/index.jsx | head -20
grep -n "showQI\|QuickInput\|floating\|drag.*QI\|QI.*drag" src/App.jsx | head -20
```

---

## КРОК 1 — КНОПКА АГЕНТА НА ВСІХ ВКЛАДКАХ

### 1.1 Знайти де рендерується шапка досьє

```bash
grep -n "шапка\|header\|hdr\|← Реєстр" src/components/CaseDossier/index.jsx | head -10
```

### 1.2 Кнопка Агента в шапці — toggle

Кнопка має бути в шапці поруч з "← Реєстр".
Вона відкриває і закриває панель агента на БУДЬ-ЯКІЙ вкладці:

```jsx
<button
  onClick={() => setAgentOpen(prev => !prev)}
  style={{
    background: agentOpen ? '#4f7cff' : 'none',
    color: agentOpen ? '#fff' : '#9aa0b8',
    border: '1px solid',
    borderColor: agentOpen ? '#4f7cff' : '#2e3148',
    padding: '6px 14px', borderRadius: 7,
    cursor: 'pointer', fontSize: 12, fontWeight: 500,
    transition: 'all .2s'
  }}
>
  {agentOpen ? '🤖 Сховати агента' : '🤖 Агент'}
</button>
```

### 1.3 Початковий стан агента

На вкладці Огляд — агент відкритий одразу.
На інших вкладках — закритий, відкривається кнопкою.

```jsx
// Змінити useState:
const [agentOpen, setAgentOpen] = useState(activeTab === 'overview');

// АБО useEffect при зміні вкладки:
// НЕ скидати agentOpen при зміні вкладки — хай залишається як є
// Тільки при першому відкритті досьє — відкрити на Огляді
const [agentOpen, setAgentOpen] = useState(true); // відкритий одразу
```

---

## КРОК 2 — КНОПКА QI НЕ НАКЛАДАЄТЬСЯ З АГЕНТОМ

### Проблема

Floating кнопка QI (⚡ внизу екрана) накладається на панель агента досьє.

### Рішення — рухома кнопка QI

В App.jsx знайти floating кнопку QI і зробити її draggable:

```bash
grep -n "floating\|fab\|fixed.*bottom\|bottom.*right\|Quick.*button\|QI.*btn" src/App.jsx | head -20
```

Замінити статичну кнопку на рухому:

```jsx
// Додати state для позиції кнопки QI:
const [qiBtnPos, setQiBtnPos] = useState({ x: null, y: null });
const qiDragRef = useRef(false);
const qiStartRef = useRef({ x: 0, y: 0, btnX: 0, btnY: 0 });

// Визначити позицію: якщо не переміщували — дефолтна (правий нижній кут)
const qiBtnStyle = qiBtnPos.x !== null ? {
  position: 'fixed',
  left: qiBtnPos.x,
  top: qiBtnPos.y,
  zIndex: 1000
} : {
  position: 'fixed',
  right: 20,
  bottom: 20,
  zIndex: 1000
};
```

Додати drag handlers на кнопку QI:

```jsx
<button
  style={{
    ...qiBtnStyle,
    width: 48, height: 48, borderRadius: '50%',
    background: '#4f7cff', border: 'none', color: '#fff',
    cursor: qiDragRef.current ? 'grabbing' : 'grab',
    fontSize: 20, boxShadow: '0 4px 20px rgba(79,124,255,.4)',
    touchAction: 'none'
  }}
  onMouseDown={e => {
    qiDragRef.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    qiStartRef.current = {
      x: e.clientX, y: e.clientY,
      btnX: rect.left, btnY: rect.top
    };
    e.preventDefault();
  }}
  onTouchStart={e => {
    qiDragRef.current = true;
    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    qiStartRef.current = {
      x: touch.clientX, y: touch.clientY,
      btnX: rect.left, btnY: rect.top
    };
  }}
  onClick={e => {
    // Клік тільки якщо не перетягували
    if (!qiDragRef.current) setShowQI(true);
  }}
>
  ⚡
</button>
```

Додати глобальні listeners для drag:

```jsx
useEffect(() => {
  function onMove(e) {
    if (!qiDragRef.current) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const dx = clientX - qiStartRef.current.x;
    const dy = clientY - qiStartRef.current.y;
    const newX = Math.max(0, Math.min(window.innerWidth - 48, qiStartRef.current.btnX + dx));
    const newY = Math.max(0, Math.min(window.innerHeight - 48, qiStartRef.current.btnY + dy));
    setQiBtnPos({ x: newX, y: newY });
  }

  function onUp() {
    // Якщо майже не рухалась — це клік
    setTimeout(() => { qiDragRef.current = false; }, 50);
  }

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('touchend', onUp);

  return () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('touchend', onUp);
  };
}, []);
```

---

## КРОК 3 — ПАМ'ЯТЬ АГЕНТА МІЖ СЕСІЯМИ

### Концепція

Агент пам'ятає розмову між сесіями через `agentHistory[]` в об'єкті справи.
При відкритті досьє — завантажує останні N повідомлень.
Очищається тільки кнопкою "Нова розмова".

### 3.1 Завантаження історії при відкритті

В компоненті CaseDossier при ініціалізації:

```jsx
// Завантажити збережену історію з справи
const [agentMessages, setAgentMessages] = useState(() => {
  const history = caseData.agentHistory || [];
  // Показати останні 20 повідомлень
  return history.slice(-20);
});
```

### 3.2 Збереження після кожного повідомлення

Після отримання відповіді від агента — зберегти в справі:

```jsx
// Після setAgentMessages(prev => [...prev, { role: 'assistant', content: reply }]):
const updatedHistory = [...agentMessages, 
  { role: 'user', content: userMsg },
  { role: 'assistant', content: reply, ts: new Date().toISOString() }
];

// Зберегти в справу (останні 50 повідомлень)
const trimmed = updatedHistory.slice(-50);
updateCase && updateCase(caseData.id, 'agentHistory', trimmed);
```

### 3.3 Передавати збережену історію в API

При відправці запиту до Claude API — включати збережену історію як контекст:

```jsx
// В sendAgentMessage():
const historyForAPI = agentMessages
  .filter(m => m.role === 'user' || m.role === 'assistant')
  .slice(-10) // останні 10 для контексту (економія токенів)
  .map(m => ({ role: m.role, content: m.content }));

const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      ...historyForAPI,
      { role: 'user', content: userMsg }
    ]
  })
});
```

### 3.4 Кнопка "Нова розмова"

Замінити кнопку "Очистити" на "Нова розмова":

```jsx
<button
  onClick={() => {
    if (window.confirm('Почати нову розмову? Поточна історія буде очищена.')) {
      setAgentMessages([]);
      updateCase && updateCase(caseData.id, 'agentHistory', []);
    }
  }}
  style={{
    background: 'none', border: 'none',
    color: '#5a6080', cursor: 'pointer',
    fontSize: 11, padding: '2px 6px',
    borderRadius: 4
  }}
>+ Нова розмова</button>
```

### 3.5 Показувати дату в повідомленнях

Для повідомлень з попередніх сесій показувати дату:

```jsx
{agentMessages.map((msg, i) => {
  // Показати дату якщо це перше повідомлення або новий день
  const showDate = msg.ts && (i === 0 ||
    new Date(msg.ts).toDateString() !==
    new Date(agentMessages[i-1]?.ts).toDateString()
  );

  return (
    <div key={i}>
      {showDate && (
        <div style={{
          textAlign: 'center', fontSize: 10,
          color: '#3a3f58', margin: '8px 0'
        }}>
          {new Date(msg.ts).toLocaleDateString('uk-UA')}
        </div>
      )}
      <div style={{
        padding: '8px 10px', borderRadius: 8,
        fontSize: 12, lineHeight: 1.6,
        maxWidth: '90%',
        alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
        background: msg.role === 'user'
          ? 'rgba(79,124,255,.2)' : '#222536',
        color: '#e8eaf0'
      }}>
        {msg.content}
      </div>
    </div>
  );
})}
```

---

## КРОК 4 — ЗБІРКА І ДЕПЛОЙ

```bash
npm run build 2>&1 | tail -5
git add -A && git commit -m "feat: dossier agent memory persistent, QI draggable button, agent toggle all tabs" && git push origin main
```

---

## КРИТЕРІЇ ЗАВЕРШЕННЯ

- [ ] Кнопка "🤖 Агент" є в шапці досьє на всіх вкладках
- [ ] Кнопка toggle — натиснув ще раз → агент зникає
- [ ] Текст кнопки змінюється: "🤖 Агент" / "🤖 Сховати агента"
- [ ] На вкладці Огляд агент відкритий одразу
- [ ] Кнопка QI можна перетягувати по екрану
- [ ] Кнопка QI і панель агента не накладаються
- [ ] Після закриття і повторного відкриття досьє — повідомлення агента збереглись
- [ ] Кнопка "Нова розмова" з підтвердженням очищає все
- [ ] Дати між повідомленнями різних сесій
- [ ] npm run build без помилок
