# ЗАВДАННЯ: Dashboard v2

## Що робити

Створити новий Dashboard як окремий компонент і підключити в App.jsx.

---

## КРОК 0 — Підготовка

Прочитай:
- `CLAUDE.md`
- `src/App.jsx` — знайди:
  - де рендериться поточний дашборд (шукай `tab === 'dashboard'` або `activeTab === 'dashboard'`)
  - константу `SONNET_CHAT_PROMPT`
  - функції: `buildSystemContext`, `findCaseForAction`, `formatDate`, `daysUntil`
  - як підключений `driveService`

Перевір гілку: `git branch` — має бути `main`.

---

## КРОК 1 — Створи `src/components/Dashboard/index.jsx`

### Props
```js
{ cases, setCases }
```

### Стан компонента
```js
const [curMonth, setCurMonth] = useState(new Date());
const [selectedDay, setSelectedDay] = useState(todayStr()); // 'YYYY-MM-DD'
const [calView, setCalView] = useState('month'); // 'month' | 'week'
const [agentInput, setAgentInput] = useState('');
const [agentResponse, setAgentResponse] = useState('');
const [agentLoading, setAgentLoading] = useState(false);
const [modalOpen, setModalOpen] = useState(false);
const [modalTime, setModalTime] = useState('10:00');
const [calendarEvents, setCalendarEvents] = useState([]);
const [expandedGroups, setExpandedGroups] = useState({});
```

При монтуванні завантажити з localStorage:
```js
useEffect(() => {
  const saved = localStorage.getItem('levytskyi_calendar_events');
  if (saved) setCalendarEvents(JSON.parse(saved));
}, []);
```

Зберігати при змінах:
```js
useEffect(() => {
  localStorage.setItem('levytskyi_calendar_events', JSON.stringify(calendarEvents));
}, [calendarEvents]);
```

### Допоміжні функції всередині компонента

```js
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysUntil(dateStr) {
  const diff = Math.ceil((new Date(dateStr) - new Date().setHours(0,0,0,0)) / 86400000);
  return diff;
}

function getAllEvents() {
  const events = [];
  cases.forEach(c => {
    if (c.hearing_date) {
      events.push({
        id: "h_" + c.id,
        type: "hearing",
        title: c.name,
        date: c.hearing_date,
        time: c.hearing_time || null,
        court: c.court || null,
        duration: 120,
        caseId: c.id
      });
    }
    if (c.deadline) {
      events.push({
        id: "d_" + c.id,
        type: "deadline",
        title: c.name,
        date: c.deadline,
        time: null,
        label: c.deadline_type || "дедлайн",
        caseId: c.id
      });
    }
  });
  return [...events, ...calendarEvents];
}

function getEventsForDay(dateStr) {
  return getAllEvents().filter(e => e.date === dateStr);
}

function checkConflicts(dateStr) {
  const hearings = getEventsForDay(dateStr).filter(e => e.type === "hearing" && e.time);
  if (hearings.length < 2) return [];
  return hearings;
}

function formatDayTitle(dateStr) {
  const d = new Date(dateStr);
  const months = ["січня","лютого","березня","квітня","травня","червня","липня","серпня","вересня","жовтня","листопада","грудня"];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}
```

---

## LAYOUT

```jsx
<div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
  <ActivityFeed />        {/* flex:1, border-right */}
  <Calendar />            {/* flex:2, border-right */}
  <DayPanel />            {/* flex:1 */}
</div>
```

---

## ACTIVITY FEED

```jsx
// Заголовок
<div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center" }}>
  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".06em" }}>
    Стрічка подій
  </span>
  <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
    <span style={{ fontSize: 11, color: "var(--text3)" }}>
      Горять: <b style={{ color: "var(--red, #e74c3c)" }}>{hotCount}</b>
    </span>
    <span style={{ fontSize: 11, color: "var(--text3)" }}>
      Справ: <b style={{ color: "var(--text)" }}>{cases.length}</b>
    </span>
  </div>
</div>
```

### Логіка груп

Взяти `getAllEvents()`, відфільтрувати де `date` існує, відсортувати за датою.

```js
const allEvents = getAllEvents().filter(e => e.date);
const hotCount = allEvents.filter(e => daysUntil(e.date) <= 1 && daysUntil(e.date) >= 0).length;

const group1 = allEvents.filter(e => { const d = daysUntil(e.date); return d >= 0 && d <= 1; });
const group2 = allEvents.filter(e => { const d = daysUntil(e.date); return d > 1 && d <= 7; });
const group3 = allEvents.filter(e => { const d = daysUntil(e.date); return d > 7 && d <= 30; });
```

### Елемент стрічки

```jsx
function FeedItem({ event, urgency }) {
  const d = daysUntil(event.date);
  const icon = event.type === "hearing" ? "⚖️" : event.type === "deadline" ? "⏰" : "📅";
  
  const borderColor = urgency === "urgent" ? "#e74c3c"
    : urgency === "warn" ? "#f39c12"
    : "#5a6080";
  
  const badgeText = d === 0 ? "сьогодні" : d === 1 ? "завтра" : `${d} днів`;
  const badgeBg = d <= 0 ? "rgba(231,76,60,.2)" : d <= 1 ? "rgba(243,156,18,.2)" : "rgba(79,124,255,.2)";
  const badgeColor = d <= 0 ? "#e74c3c" : d <= 1 ? "#f39c12" : "#4f7cff";
  
  return (
    <div
      onClick={() => setSelectedDay(event.date)}
      style={{
        background: "var(--surface, #1a1d27)",
        border: "1px solid var(--border, #2e3148)",
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: 8,
        padding: "8px 10px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 8
      }}
    >
      <span style={{ fontSize: 15 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {event.title}
          </span>
          <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 600, background: badgeBg, color: badgeColor, whiteSpace: "nowrap" }}>
            {badgeText}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "var(--text2, #9aa0b8)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {event.court || event.label || ""}
        </div>
      </div>
    </div>
  );
}
```

### Група з розгортанням

Показувати перші 5 елементів. Якщо більше — кнопка "ще N →".

```jsx
function FeedGroup({ title, events, urgency, groupKey }) {
  if (!events.length) return null;
  const expanded = expandedGroups[groupKey];
  const visible = expanded ? events : events.slice(0, 5);
  const rest = events.length - 5;
  
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text3, #5a6080)", textTransform: "uppercase", letterSpacing: ".06em", padding: "6px 2px 3px" }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {visible.map(e => <FeedItem key={e.id} event={e} urgency={urgency} />)}
      </div>
      {!expanded && rest > 0 && (
        <div
          onClick={() => setExpandedGroups(prev => ({ ...prev, [groupKey]: true }))}
          style={{ textAlign: "center", fontSize: 11, color: "var(--accent, #4f7cff)", padding: 5, cursor: "pointer" }}
        >
          ще {rest} →
        </div>
      )}
    </div>
  );
}
```

---

## CALENDAR

### Навігація

```jsx
<div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
  <button onClick={prevMonth} style={navBtnStyle}>←</button>
  <h2 style={{ fontSize: 13, fontWeight: 600, flex: 1, textAlign: "center" }}>
    {MONTHS_UK[curMonth.getMonth()]} {curMonth.getFullYear()}
  </h2>
  <button onClick={nextMonth} style={navBtnStyle}>→</button>
  <div style={{ display: "flex", background: "var(--surface2, #222536)", borderRadius: 5, padding: 2 }}>
    <button onClick={() => setCalView("month")} style={{ ...vBtnStyle, ...(calView === "month" ? vBtnActive : {}) }}>Місяць</button>
    <button onClick={() => setCalView("week")} style={{ ...vBtnStyle, ...(calView === "week" ? vBtnActive : {}) }}>Тиждень</button>
  </div>
</div>
```

```js
const MONTHS_UK = ["Січень","Лютий","Березень","Квітень","Травень","Червень","Липень","Серпень","Вересень","Жовтень","Листопад","Грудень"];
const WDAYS = ["Пн","Вт","Ср","Чт","Пт","Сб","Нд"];
```

### Місячна сітка

```js
function buildMonthGrid(year, month) {
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const start = firstDay === 0 ? 6 : firstDay - 1; // перетворити на Пн=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();
  
  const cells = [];
  for (let i = 0; i < 42; i++) {
    let day, m = month, y = year, other = false;
    const cd = i - start + 1;
    if (cd <= 0) { day = daysInPrev + cd; m = month - 1; other = true; }
    else if (cd > daysInMonth) { day = cd - daysInMonth; m = month + 1; other = true; }
    else { day = cd; }
    if (m < 0) { m = 11; y = year - 1; }
    if (m > 11) { m = 0; y = year + 1; }
    const dateStr = `${y}-${String(m+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    cells.push({ day, dateStr, other });
  }
  return cells;
}
```

Для кожної комірки:

```jsx
const cells = buildMonthGrid(curMonth.getFullYear(), curMonth.getMonth());
const today = todayStr();

cells.map(cell => {
  const events = getEventsForDay(cell.dateStr);
  const hearings = events.filter(e => e.type === "hearing");
  const deadlines = events.filter(e => e.type === "deadline");
  const conflict = hearings.length > 1;
  const isToday = cell.dateStr === today;
  const isSelected = cell.dateStr === selectedDay;
  
  // Стиль комірки
  let borderColor = "var(--border, #2e3148)";
  if (conflict) borderColor = "#e74c3c";
  else if (isSelected) borderColor = "var(--accent, #4f7cff)";
  else if (isToday) borderColor = "var(--accent, #4f7cff)";
  
  let bg = "var(--surface, #1a1d27)";
  if (isSelected) bg = "rgba(79,124,255,.15)";
  else if (isToday) bg = "rgba(79,124,255,.08)";
  
  return (
    <div
      key={cell.dateStr}
      onClick={() => !cell.other && setSelectedDay(cell.dateStr)}
      style={{
        background: bg,
        border: `1px solid ${borderColor}`,
        borderRadius: 6,
        padding: "3px 2px",
        cursor: cell.other ? "default" : "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 1,
        minHeight: 46,
        opacity: cell.other ? 0.3 : 1
      }}
    >
      <span style={{ fontSize: 12, fontWeight: isToday ? 700 : 500, color: isToday ? "var(--accent, #4f7cff)" : "inherit" }}>
        {cell.day}
      </span>
      <div style={{ display: "flex", gap: 1, flexWrap: "wrap", justifyContent: "center" }}>
        {hearings.slice(0,3).map((_, i) => (
          <div key={i} style={{ width: 4, height: 4, borderRadius: "50%", background: "#4f7cff" }} />
        ))}
        {deadlines.slice(0,2).map((_, i) => (
          <div key={i} style={{ width: 4, height: 4, borderRadius: "50%", background: "#f39c12" }} />
        ))}
      </div>
      {conflict && <span style={{ fontSize: 8 }}>⚠️</span>}
    </div>
  );
})
```

Сітка: `display: grid, gridTemplateColumns: "repeat(7, 1fr)", gap: 2`

### Тижневий вигляд

```js
function getWeekDays(selectedDay) {
  const d = new Date(selectedDay);
  const dow = d.getDay() === 0 ? 6 : d.getDay() - 1; // Пн=0
  const start = new Date(d);
  start.setDate(d.getDate() - dow);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return day.toISOString().slice(0, 10);
  });
}
```

Сітка: 8 колонок (перша — час, решта 7 днів), рядки — години 08-19.

Заголовок тижня: `WDAYS[i]` + число, при кліку → setSelectedDay.

---

## DAY PANEL

```jsx
const dayEvents = getEventsForDay(selectedDay);
const conflicts = checkConflicts(selectedDay);
const hearingCount = dayEvents.filter(e => e.type === "hearing").length;
const deadlineCount = dayEvents.filter(e => e.type === "deadline").length;

const parts = [];
if (hearingCount) parts.push(`${hearingCount} засідань`);
if (deadlineCount) parts.push(`${deadlineCount} дедлайн${deadlineCount > 1 ? "и" : ""}`);
const subtitle = parts.length ? (conflicts.length ? parts.join(" · ") + " · накладка!" : parts.join(" · ")) : "Вільний день";
```

### Агент

```jsx
async function handleAgentSend() {
  if (!agentInput.trim() || agentLoading) return;
  setAgentLoading(true);
  setAgentResponse("⏳ Аналізую...");
  
  try {
    const apiKey = localStorage.getItem("claude_api_key");
    if (!apiKey) { setAgentResponse("❌ API ключ не налаштований"); setAgentLoading(false); return; }
    
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20251022",
        max_tokens: 500,
        system: `${SONNET_CHAT_PROMPT}\n\nОбраний день: ${selectedDay} (${formatDayTitle(selectedDay)})\nПоточні події дня: ${JSON.stringify(dayEvents)}\nСправи системи: ${buildSystemContext(cases)}`,
        messages: [{ role: "user", content: agentInput }]
      })
    });
    
    const data = await response.json();
    const text = data.content?.[0]?.text || "Не вдалося отримати відповідь";
    setAgentResponse(text);
  } catch (e) {
    setAgentResponse("❌ Помилка: " + e.message);
  }
  
  setAgentInput("");
  setAgentLoading(false);
}
```

### Слоти

```jsx
const HOURS = [8,9,10,11,12,13,14,15,16,17,18,19];

HOURS.map(h => {
  const timeStr = String(h).padStart(2,"0") + ":00";
  const event = dayEvents.find(e => e.time && e.time.startsWith(String(h).padStart(2,"0")));
  const isConflict = event && conflicts.find(c => c.id === event.id);
  
  return (
    <div key={h} style={{ display: "flex", gap: 5, marginBottom: 2, alignItems: "flex-start" }}>
      <span style={{ fontSize: 10, color: "var(--text3, #5a6080)", width: 30, flexShrink: 0, paddingTop: 5 }}>
        {timeStr}
      </span>
      {event ? (
        <div style={{
          flex: 1,
          borderRadius: 5,
          border: `1px solid ${isConflict ? "#e74c3c" : event.type === "hearing" ? "#4f7cff" : "#f39c12"}`,
          background: isConflict ? "rgba(231,76,60,.1)" : event.type === "hearing" ? "rgba(79,124,255,.1)" : "rgba(243,156,18,.1)",
          padding: "3px 7px",
          fontSize: 11
        }}>
          <div style={{ fontWeight: 600 }}>{event.title}</div>
          {(event.court || event.duration) && (
            <div style={{ fontSize: 10, color: "var(--text3, #5a6080)" }}>
              {[event.court, event.duration ? event.duration + " хв" : null].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      ) : (
        <div
          onClick={() => { setModalTime(timeStr); setModalOpen(true); }}
          style={{
            flex: 1,
            minHeight: 26,
            borderRadius: 5,
            border: "1px dashed var(--border, #2e3148)",
            padding: "3px 7px",
            cursor: "pointer",
            fontSize: 11,
            color: "var(--text3, #5a6080)"
          }}
        >
          + {timeStr}
        </div>
      )}
    </div>
  );
})
```

---

## МОДАЛКА

```jsx
function saveEvent(title, time, type, court) {
  if (!title.trim()) return;
  
  // Перевірка накладок
  const existingHearings = getEventsForDay(selectedDay).filter(e => e.type === "hearing" && e.time);
  if (type === "hearing" && existingHearings.length > 0) {
    const ok = window.confirm("В цей день вже є засідання. Зберегти попри накладку?");
    if (!ok) return;
  }
  
  const newEvent = {
    id: Date.now(),
    title: title.trim(),
    date: selectedDay,
    time,
    duration: 120,
    type,
    court: court.trim() || null,
    notes: ""
  };
  
  setCalendarEvents(prev => [...prev, newEvent]);
  setModalOpen(false);
}
```

---

## КРОК 2 — Підключення в App.jsx

```js
import Dashboard from "./components/Dashboard";
```

Знайти де рендериться старий дашборд і замінити:
```jsx
{activeTab === "dashboard" && (
  <Dashboard cases={cases} setCases={setCases} />
)}
```

Якщо `SONNET_CHAT_PROMPT` і `buildSystemContext` не можна імпортувати — передати як props:
```jsx
<Dashboard
  cases={cases}
  setCases={setCases}
  sonnetPrompt={SONNET_CHAT_PROMPT}
  buildSystemContext={buildSystemContext}
/>
```

---

## КРОК 3 — Збірка і деплой

```bash
npm run build
git add -A
git commit -m "feat: Dashboard v2 — Activity Feed + Calendar + Day Panel + Agent"
git push origin main
```

Якщо помилки при build — виправити перед push.

---

## ВАЖЛИВО

- Завжди в гілці `main`
- Апострофи в українських рядках → подвійні лапки або template literals: `"Вільний день"` не `'Вільний день'`
- Не чіпати інші вкладки (Справи, Quick Input тощо)
- CSS змінні вже є в App.css — використовувати їх, не хардкодити кольори
- Модель для агента: `claude-sonnet-4-5-20251022`
