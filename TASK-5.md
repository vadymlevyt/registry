# TASK — Дизайн фікси Day Panel
# Legal BMS | АБ Левицького | 2026-05-03

Прочитай CLAUDE.md і LESSONS.md перед початком.
Моделі — брати з CLAUDE.md. Працюємо в гілці main.

---

## ПІДХІД

Перед кожним блоком — читай існуючий код і розумій структуру.
Після кожного блоку — `npm run build`.
Не чіпай те що працює. Мінімальні зміни.

---

## БЛОК 1 — Фірмова модалка підтвердження замість window.confirm

Зараз `window.confirm(...)` викликає браузерне вікно. Замінити на фірмовий компонент.

Додати стан:
```js
const [confirmDialog, setConfirmDialog] = useState(null);
// { message, onConfirm }
```

JSX модалки підтвердження (додати в кінець JSX Dashboard, перед закриваючим div):
```jsx
{confirmDialog && (
  <>
    <div
      onClick={() => setConfirmDialog(null)}
      style={{ position:'fixed', inset:0, zIndex:499, background:'rgba(0,0,0,0.5)' }}
    />
    <div style={{
      position:'fixed', top:'50%', left:'50%',
      transform:'translate(-50%,-50%)',
      zIndex:500, width:280,
      background:'var(--surface,#1a1d27)',
      border:'1px solid var(--border,#2e3148)',
      borderRadius:10, padding:20,
      boxShadow:'0 8px 32px rgba(0,0,0,0.6)'
    }}>
      <div style={{ fontSize:13, color:'var(--text,#e8eaf0)', marginBottom:16, lineHeight:1.5 }}>
        {confirmDialog.message}
      </div>
      <div style={{ display:'flex', gap:8 }}>
        <button
          onClick={() => setConfirmDialog(null)}
          style={{
            flex:1, padding:'8px', borderRadius:6, border:'none',
            background:'var(--surface2,#222536)', color:'var(--text2,#9aa0b8)',
            fontSize:12, cursor:'pointer'
          }}>
          Скасувати
        </button>
        <button
          onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}
          style={{
            flex:1, padding:'8px', borderRadius:6, border:'none',
            background:'rgba(231,76,60,0.2)', color:'#e74c3c',
            fontSize:12, cursor:'pointer', fontWeight:600
          }}>
          Видалити
        </button>
      </div>
    </div>
  </>
)}
```

Замінити всі `window.confirm('Видалити...')` на:
```js
setConfirmDialog({
  message: 'Видалити цю нотатку?', // або відповідний текст
  onConfirm: () => {
    // логіка видалення
  }
});
```

Знайти всі місця де є `window.confirm` в Dashboard/index.jsx і замінити.

```bash
npm run build
```

---

## БЛОК 2 — Фірмовий time picker: сітка плиток

Замінити `<input type="time">` на кастомний компонент — сітка кнопок з часом.

Додати компонент `TimePicker` всередині Dashboard:
```jsx
function TimePicker({ value, onChange, label }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position:'relative' }}>
      {label && (
        <div style={{ fontSize:10, color:'var(--text3,#5a6080)', marginBottom:3 }}>
          {label}
        </div>
      )}
      <div
        onClick={() => setOpen(!open)}
        style={{
          padding:'6px 10px', borderRadius:5, cursor:'pointer',
          background:'var(--surface2,#222536)', color:'var(--text,#e8eaf0)',
          border:'1px solid var(--border,#2e3148)', fontSize:12,
          display:'flex', justifyContent:'space-between', alignItems:'center',
          minWidth:70
        }}>
        <span>{value || '—'}</span>
        <span style={{ opacity:0.4, fontSize:10 }}>▾</span>
      </div>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position:'fixed', inset:0, zIndex:398 }}
          />
          <div style={{
            position:'absolute', top:'100%', left:0, zIndex:399,
            background:'var(--surface,#1a1d27)',
            border:'1px solid var(--border,#2e3148)',
            borderRadius:8, padding:8, marginTop:4,
            display:'grid', gridTemplateColumns:'repeat(4, 1fr)',
            gap:4, width:220,
            boxShadow:'0 4px 20px rgba(0,0,0,0.5)'
          }}>
            {SLOTS.map(slot => (
              <button
                key={slot}
                onClick={() => { onChange(slot); setOpen(false); }}
                style={{
                  padding:'6px 2px', borderRadius:5, border:'none',
                  background: value === slot
                    ? 'var(--accent,#4f7cff)'
                    : 'var(--surface2,#222536)',
                  color: value === slot ? '#fff' : 'var(--text,#e8eaf0)',
                  fontSize:11, cursor:'pointer', textAlign:'center'
                }}>
                {slot}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

Замінити всі `<input type="time">` і `<select>` для часу в модалці на `<TimePicker>`:
```jsx
<TimePicker
  value={modalStartTime}
  onChange={setModalStartTime}
  label="ПОЧАТОК"
/>
<TimePicker
  value={modalEndTime}
  onChange={setModalEndTime}
  label="КІНЕЦЬ"
/>
```

```bash
npm run build
```

---

## БЛОК 3 — Кольори рамок відповідають крапкам календаря

Знайти де визначаються кольори для типів подій в слотах.
Переконатись що кольори точно відповідають:

```js
const EVENT_COLORS = {
  hearing:  { border:'#4f7cff', bg:'rgba(79,124,255,0.12)',  text:'#4f7cff'  }, // синій
  deadline: { border:'#f39c12', bg:'rgba(243,156,18,0.12)', text:'#f39c12'  }, // помаранчевий
  note:     { border:'#2ecc71', bg:'rgba(46,204,113,0.12)', text:'#2ecc71'  }, // зелений
  travel:   { border:'#5a6080', bg:'rgba(90,96,128,0.12)',  text:'#9aa0b8'  }, // сірий
};
```

Застосувати ці кольори до:
- Блоків в часових слотах
- Блоків в секції "БЕЗ ЧАСУ"
- Крапок в місячній сітці (перевірити що вже відповідають, якщо ні — виправити)

```bash
npm run build
```

---

## БЛОК 4 — Підписи в блоках: тип + справа

Кожен блок в слоті і в "БЕЗ ЧАСУ" має показувати:
- Рядок 1: іконка типу + назва справи (або "Загальна")
- Рядок 2: текст/назва події (ellipsis)

```jsx
function EventBlock({ event, onClick, style }) {
  const colors = EVENT_COLORS[event.type] || EVENT_COLORS.note;
  const icon = event.type === 'hearing' ? '⚖️'
    : event.type === 'deadline' ? '⏰'
    : event.type === 'travel' ? '🚗'
    : '📝';
  const typeLabel = event.type === 'hearing' ? 'Засідання'
    : event.type === 'deadline' ? 'Дедлайн'
    : 'Нотатка';

  return (
    <div
      onClick={onClick}
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 5,
        padding: '3px 6px',
        cursor: 'pointer',
        overflow: 'hidden',
        ...style
      }}>
      {/* Рядок 1: тип + справа */}
      <div style={{
        display:'flex', alignItems:'center', gap:3,
        fontSize:9, color:colors.text, marginBottom:1
      }}>
        <span>{icon}</span>
        <span style={{ fontWeight:600 }}>{typeLabel}</span>
        {event.caseName && (
          <>
            <span style={{ opacity:0.5 }}>·</span>
            <span style={{ opacity:0.8, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
              {event.caseName}
            </span>
          </>
        )}
      </div>
      {/* Рядок 2: текст події */}
      <div style={{
        fontSize:10, color:'var(--text,#e8eaf0)',
        whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'
      }}>
        {event.title || event.text}
      </div>
    </div>
  );
}
```

Переконатись що `event.caseName` передається в `getAllEvents()` — якщо ні, додати:
```js
cases.forEach(c => {
  (c.hearings || []).filter(isValidHearing).forEach(h => {
    events.push({ ..., caseName: c.name, ... });
  });
  (c.deadlines || []).forEach(d => {
    events.push({ ..., caseName: c.name, ... });
  });
  (c.notes || []).filter(n => n.date).forEach(n => {
    events.push({ ..., caseName: c.name, ... });
  });
});
```

```bash
npm run build
```

---

## БЛОК 5 — Динамічний заголовок секції "БЕЗ ЧАСУ"

Знайти заголовок секції "БЕЗ ЧАСУ" в JSX Day Panel.

Замінити на динамічний:
```js
const eventsWithoutTime = getEventsWithoutTime(selectedDay);
const hasNotes = eventsWithoutTime.some(e => e.type === 'note');
const hasDeadlines = eventsWithoutTime.some(e => e.type === 'deadline');

const sectionTitle = [
  hasNotes && 'Нотатки',
  hasDeadlines && 'Дедлайни'
].filter(Boolean).join(' · ');
```

```jsx
{/* Показувати секцію тільки якщо є хоча б одна подія */}
{eventsWithoutTime.length > 0 && (
  <div>
    <div style={{ fontSize:10, color:'var(--text3,#5a6080)', padding:'4px 0 3px',
      textTransform:'uppercase', letterSpacing:'.06em' }}>
      {sectionTitle}
    </div>
    {/* список подій */}
  </div>
)}
```

```bash
npm run build
```

---

## ФІНАЛЬНА ПЕРЕВІРКА

```bash
npm run build
git add -A
git commit -m "feat: custom confirm dialog, time picker grid, event colors, labels, dynamic section title"
git push origin main
```

Перевірити:
1. Кнопка "Видалити" → фірмова модалка підтвердження, не браузерна
2. Вибір часу → сітка плиток 08:00-19:00, не системний picker
3. Кольори рамок: синій=засідання, помаранчевий=дедлайн, зелений=нотатка
4. Кожен блок показує іконку + тип + назву справи
5. "БЕЗ ЧАСУ" → динамічний заголовок "Нотатки", "Дедлайни" або "Нотатки · Дедлайни"
6. Якщо в секції нічого немає — вона не відображається
