# TASK — Дорога в слотах + відображення накладок
# Legal BMS | АБ Левицького | 2026-05-03

Прочитай CLAUDE.md і LESSONS.md перед початком.
Моделі — брати з CLAUDE.md. Працюємо в гілці main.

---

## ПІДХІД

Перед змінами — прочитай існуючий код рендеру слотів.
Після кожного блоку — `npm run build`.
Не чіпай те що працює.

---

## БЛОК 1 — Picker часу на дорогу: кнопки замість поля вводу

Знайти в модалці засідання блок "🚗 Додати час на дорогу".
Замінити числове поле вводу на кнопки:

```jsx
<div style={{ display:'flex', gap:4, flexWrap:'wrap', marginTop:6 }}>
  {[60, 120, 180, 240, 300, 360].map(min => (
    <button
      key={min}
      onClick={() => setTravelMinutes(travelMinutes === min ? 0 : min)}
      style={{
        padding:'4px 10px', borderRadius:5, border:'none', cursor:'pointer',
        fontSize:11,
        background: travelMinutes === min
          ? 'rgba(155,89,182,0.3)'
          : 'var(--surface2,#222536)',
        color: travelMinutes === min ? '#9b59b6' : 'var(--text2,#9aa0b8)',
        fontWeight: travelMinutes === min ? 600 : 400
      }}>
      {min/60} год
    </button>
  ))}
</div>
```

Повторний клік на вибрану кнопку — скасовує вибір (travelMinutes = 0).

Preview під кнопками (якщо travelMinutes > 0 і є час початку і кінця):
```jsx
{travelMinutes > 0 && modalStartTime && modalEndTime && (
  <div style={{ fontSize:10, color:'#9b59b6', marginTop:4 }}>
    🚗 Туди: {calcTravelStart(modalStartTime, travelMinutes)}–{modalStartTime}
    {' · '}
    Назад: {modalEndTime}–{calcTravelEnd(modalEndTime, travelMinutes)}
  </div>
)}
```

```js
function calcTravelStart(startTime, totalMin) {
  const toMin = t => { const [h,m] = t.split(':').map(Number); return h*60+m; };
  const fromMin = m => `${String(Math.floor(Math.max(0,m)/60)).padStart(2,'0')}:${String(Math.max(0,m)%60).padStart(2,'0')}`;
  return fromMin(toMin(startTime) - totalMin/2);
}
function calcTravelEnd(endTime, totalMin) {
  const toMin = t => { const [h,m] = t.split(':').map(Number); return h*60+m; };
  const fromMin = m => `${String(Math.floor(Math.min(1439,m)/60)).padStart(2,'0')}:${String(Math.min(1439,m)%60).padStart(2,'0')}`;
  return fromMin(toMin(endTime) + totalMin/2);
}
```

Обмеження: не виходити за межі доби (00:00–23:59).

```bash
npm run build
```

---

## БЛОК 2 — Відображення дороги в слотах

### 2А — Діагностика

Знайди в `src/components/Dashboard/index.jsx` де рендеруються слоти Day Panel.
Перевір:
- Чи є обробка `event.category === 'travel'`
- Чи застосовуються кольори `#9b59b6` для travel подій
- Чи travel події взагалі потрапляють в `getAllEvents()`

### 2Б — Додати travel в getAllEvents якщо немає

Travel нотатки зберігаються як `category: 'travel'` в `notes[]` справи або в загальному масиві.
Переконатись що `getAllEvents()` їх підхоплює:

```js
// В getAllEvents при обробці нотаток:
(c.notes || []).filter(n => n.date).forEach(n => {
  events.push({
    id: n.id,
    type: n.category === 'travel' ? 'travel' : 'note',
    title: n.text,
    date: n.date,
    time: n.time || null,
    duration: n.duration || 60,
    caseId: c.id,
    caseName: c.name,
    isSuspended: c.status === 'suspended'
  });
});
```

### 2В — Рендер слотів: пріоритети і бокова смужка

Знайди де рендеруються події в слоті (SlotsColumn або аналог).

**Логіка групування подій в одному слоті:**

```js
function groupSlotEvents(slotEvents) {
  const hearing = slotEvents.find(e => e.type === 'hearing');
  const travel = slotEvents.find(e => e.type === 'travel');
  const notes = slotEvents.filter(e => e.type === 'note');

  // Основний блок — засідання або дорога (пріоритет: hearing > travel)
  const main = hearing || travel || null;
  // Бокові — нотатки (і засідання якщо є дорога як main, але це не буває)
  const side = notes;

  return { main, side };
}
```

**JSX слоту:**

```jsx
const { main, side } = groupSlotEvents(slotEvents);
const hasSide = side.length > 0;

<div style={{ display:'flex', gap:2, height:'100%' }}>

  {/* Основний блок */}
  {main && (
    <div
      onClick={(e) => { e.stopPropagation(); handleEventClick(main, e); }}
      style={{
        flex: hasSide ? '0 0 78%' : '1',
        background: getEventStyle(main.type, main.isSuspended).bg,
        border: `1px solid ${getEventStyle(main.type, main.isSuspended).border}`,
        borderRadius: 4,
        padding: '2px 6px',
        fontSize: 9,
        overflow: 'hidden',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 3
      }}>
      <span>{main.type === 'hearing' ? '⚖️' : '🚗'}</span>
      <span style={{
        color: getEventStyle(main.type, main.isSuspended).text,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
      }}>
        {main.title}
        {main.type === 'hearing' && main.caseName && ` · ${main.caseName}`}
      </span>
    </div>
  )}

  {/* Бокові нотатки */}
  {hasSide && (
    <div style={{ flex: '0 0 20%', display:'flex', flexDirection:'column', gap:1 }}>
      {side.slice(0, 3).map((note, i) => (
        <div
          key={i}
          onClick={(e) => { e.stopPropagation(); openNotePopup(note, e); }}
          style={{
            flex: 1,
            background: getEventStyle('note', note.isSuspended).bg,
            border: `1px solid ${getEventStyle('note', note.isSuspended).border}`,
            borderRadius: 3,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 8,
            overflow: 'hidden'
          }}
          title={note.title}>
          📝
        </div>
      ))}
      {side.length > 3 && (
        <div style={{ fontSize:7, color:'#2ecc71', textAlign:'center' }}>
          +{side.length - 3}
        </div>
      )}
    </div>
  )}

  {/* Порожній слот */}
  {!main && !hasSide && (
    <div
      onClick={() => openModalWithTime(slotTime)}
      style={{
        flex: 1,
        border: '1px dashed #2e3148',
        borderRadius: 4,
        cursor: 'pointer',
        opacity: 0.4
      }}
    />
  )}

</div>
```

### 2Г — Попап для travel (тільки читання)

При кліку на travel блок → попап як для дедлайну (тільки перегляд, без редагування):

```jsx
// В handleEventClick:
if (event.type === 'travel') {
  setTravelPopup({
    text: event.title,
    time: event.time,
    duration: event.duration,
    date: event.date,
    anchorRect: e.currentTarget.getBoundingClientRect()
  });
  return;
}
```

Додати стан: `const [travelPopup, setTravelPopup] = useState(null)`

Попап аналогічний до deadlinePopup — пурпурна рамка, тільки читання:
```jsx
{travelPopup && (
  <>
    <div onClick={() => setTravelPopup(null)} style={{ position:'fixed', inset:0, zIndex:299 }} />
    <div style={{
      position:'fixed',
      top: Math.min(travelPopup.anchorRect.top, window.innerHeight - 120),
      left: travelPopup.anchorRect.right + 8 + 220 > window.innerWidth
        ? travelPopup.anchorRect.left - 228
        : travelPopup.anchorRect.right + 8,
      width: 220, zIndex: 300,
      background: 'var(--surface,#1a1d27)',
      border: '1px solid rgba(155,89,182,0.4)',
      borderRadius: 8, padding: 12,
      boxShadow: '0 4px 24px rgba(0,0,0,0.5)'
    }}>
      <div style={{ fontSize:12, color:'#9b59b6', fontWeight:600, marginBottom:4 }}>
        🚗 {travelPopup.text}
      </div>
      <div style={{ fontSize:11, color:'var(--text3,#5a6080)' }}>
        {travelPopup.time} · {travelPopup.duration} хв
      </div>
    </div>
  </>
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
git commit -m "feat: travel picker buttons, travel blocks in slots, side notes, travel popup"
git push origin main
```

Перевірити:
1. Модалка: кнопки [1 год][2 год][3 год][4 год][5 год][6 год] замість поля вводу
2. Preview показує час дороги туди і назад
3. Дорога відображається пурпурним блоком в слотах
4. Нотатка в той самий час що і дорога/засідання → вузька смужка 20% збоку
5. Клік на дорогу → попап тільки для читання
6. Клік на нотатку збоку → notePopup з повним текстом
