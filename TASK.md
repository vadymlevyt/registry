# ПОТОЧНЕ ЗАВДАННЯ

Прочитай CLAUDE.md перед початком.
Працюємо в гілці main. Після змін — npm run build, потім git push.

---

## Завдання — Drag-виділення часових слотів

### Слоти

Слоти — годинні (08:00, 09:00 ... 19:00).
Висота кожного слоту — мінімум 36px щоб зручно тапати пальцем.

---

### Drag-виділення (мишка і палець)

**Стан:**
```js
const [dragStart, setDragStart] = useState(null);
const [dragEnd, setDragEnd] = useState(null);
const [isDragging, setIsDragging] = useState(false);
```

**На кожному слоті** — атрибут `data-hour={hour}` (число, наприклад 10):
```js
onMouseDown={() => startDrag(hour)}
onMouseEnter={() => isDragging && updateDrag(hour)}
onMouseUp={() => endDrag()}
onTouchStart={(e) => { e.preventDefault(); startDrag(hour); }}
onTouchMove={(e) => { e.preventDefault(); handleTouchMove(e); }}
onTouchEnd={() => endDrag()}
```

**Контейнер слотів:** `style={{ touchAction: 'none', userSelect: 'none' }}`

**Функції:**
```js
function startDrag(hour) {
  setDragStart(hour); setDragEnd(hour); setIsDragging(true);
}
function updateDrag(hour) {
  if (isDragging) setDragEnd(hour);
}
function handleTouchMove(e) {
  const touch = e.touches[0];
  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  const h = el?.closest('[data-hour]')?.dataset?.hour;
  if (h) updateDrag(parseInt(h));
}
function endDrag() {
  if (dragStart !== null && dragEnd !== null) {
    const s = Math.min(dragStart, dragEnd);
    const e = Math.max(dragStart, dragEnd) + 1;
    openModalWithRange(
      String(s).padStart(2,'0') + ':00',
      String(e).padStart(2,'0') + ':00'
    );
  }
  setIsDragging(false); setDragStart(null); setDragEnd(null);
}
```

**Підсвітка під час drag:**
Слоти між dragStart і dragEnd — синій фон `rgba(79,124,255,0.25)` поки тягнеш.

---

### Модалка після виділення

Поля:
- Час початку — `<input type="time" step="1800">` (крок 30 хв), заповнено з drag
- Час кінця — `<input type="time" step="1800">`, заповнено з drag
- Назва події (required)
- Тип: засідання / дедлайн / подія
- Суд (необов'язково)
- Кнопка "🚗 Додати час на дорогу" → розгортає поле "Хвилин на дорогу" (input number, крок 30)

**При збереженні:**
1. Основна подія: від startTime до endTime, колір за типом
2. Якщо вказано час на дорогу N хв → окрема подія 'travel':
   - час: (startTime - N хвилин) до startTime
   - колір сірий #5a6080, підпис "🚗 Дорога"
   - зберігати в тому ж localStorage 'levytskyi_calendar_events'

---

### Відображення подій в слотах

Подія займає висоту пропорційно тривалості.
Рахувати: `height = (endHour - startHour) * 36px`.
Використати `position: absolute` всередині відносного контейнера або просто `gridRow: span N`.

Простий варіант: показувати подію тільки в першому слоті але з висотою на N годин:
```js
style={{ height: duration * 36, zIndex: 1, position: 'relative' }}
```

Підпис всередині блоку: "Назва · 10:00—12:00"

---

### Де застосувати

1. Day Panel (права колонка)
2. Тижневий вигляд (кожна колонка дня)

Винести логіку drag в хук `useSlotDrag()` щоб не дублювати.

---

## Після виконання

npm run build
git add -A
git commit -m "feat: drag time selection + 30min input step + travel time block"
git push origin main
