# ПОТОЧНЕ ЗАВДАННЯ

Прочитай CLAUDE.md перед початком.
Працюємо в гілці main. Після змін — npm run build, потім git push.

---

## Блок А — Агент пам'ятає контекст розмови

**Проблема:** кожне повідомлення відправляється без історії — агент не пам'ятає попередніх повідомлень.

**Рішення:** додати стан chatHistory і передавати його в кожен запит.

```js
const [chatHistory, setChatHistory] = useState([]);

// При відправці:
async function handleAgentSend(text) {
  const userMsg = { role: "user", content: text };
  const newHistory = [...chatHistory, userMsg];
  
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    ...
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: buildDashboardContext(cases, calendarEvents),
      messages: newHistory  // ← вся історія, не одне повідомлення
    })
  });
  
  const assistantMsg = { role: "assistant", content: responseText };
  setChatHistory([...newHistory, assistantMsg]);
}
```

Обмеження: зберігати максимум останні 10 повідомлень (5 пар user/assistant).
Якщо більше — обрізати найстаріші але завжди залишати системний контекст.

---

## Блок Б — Збільшити вікно чату агента

Зараз відповідь агента показується в маленькому блоці — незручно читати.

**Що зробити:**
Область відповідей агента — збільшити до 150-180px висотою з overflow-y:auto.
Показувати всю історію розмови (як чат): повідомлення користувача справа, відповіді агента зліва.

Стиль повідомлень:
- Користувач: синій фон rgba(79,124,255,0.15), текст справа, 11px
- Агент: темний фон var(--surface2), текст зліва, 11px
- Відступи між повідомленнями: 4px
- Автоскрол донизу після кожної відповіді

---

## Блок В — Слоти по 30 хвилин

Замінити годинні слоти на півгодинні в Day Panel і тижневому вигляді.

```js
// Замість:
const HOURS = [8,9,10,11,12,13,14,15,16,17,18,19];

// Зробити:
const SLOTS = [
  '08:00','08:30','09:00','09:30','10:00','10:30',
  '11:00','11:30','12:00','12:30','13:00','13:30',
  '14:00','14:30','15:00','15:30','16:00','16:30',
  '17:00','17:30','18:00','18:30','19:00'
];
```

Висота одного слоту: 28px (щоб зручно тапати пальцем).
Підпис часу — тільки для цілих годин (08:00, 09:00...), півгодинні без підпису або маленький (08:30 → сірим 9px).

Перевірка події в слоті: event.time починається з цього часу.
Наприклад подія "11:30" → потрапляє в слот '11:30'.

---

## Блок Г — Long press для drag виділення

**Проблема:** виділення починається одразу при торканні — конфліктує зі скролом.

**Рішення:** виділення починається тільки після утримання 400мс (long press).
Якщо відпустив раніше — це скрол, виділення не починається.

```js
const longPressTimer = useRef(null);
const [dragActive, setDragActive] = useState(false);

function handleTouchStart(e, slotTime) {
  // Запустити таймер
  longPressTimer.current = setTimeout(() => {
    setDragActive(true);
    startDrag(slotTime);
    // Вібрація якщо доступна (тактильний відгук)
    if (navigator.vibrate) navigator.vibrate(50);
  }, 400);
}

function handleTouchMove(e) {
  if (!dragActive) {
    // Ще не активований — скасувати таймер, дати скролу працювати
    clearTimeout(longPressTimer.current);
    return;
  }
  // Активований — виділяти слоти
  e.preventDefault();
  const touch = e.touches[0];
  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  const slot = el?.closest('[data-slot]')?.dataset?.slot;
  if (slot) updateDrag(slot);
}

function handleTouchEnd() {
  clearTimeout(longPressTimer.current);
  if (dragActive) {
    setDragActive(false);
    endDrag();
  }
}
```

**На мишці (десктоп):**
```js
function handleMouseDown(e, slotTime) {
  // Миша — одразу починати drag при русі
  // Але відрізняти від простого кліку
  const startPos = { x: e.clientX, y: e.clientY };
  
  function handleMouseMove(e) {
    const moved = Math.abs(e.clientY - startPos.y) > 5;
    if (moved && !dragActive) {
      setDragActive(true);
      startDrag(slotTime);
    }
    if (dragActive) updateDrag(getSlotFromY(e.clientY));
  }
  
  function handleMouseUp() {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    if (dragActive) { setDragActive(false); endDrag(); }
  }
  
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
}
```

**Візуальний відгук під час long press:**
Слот під пальцем злегка підсвічується через 200мс (половина таймера) — показує що система "чує" натискання.

```js
const [pressedSlot, setPressedSlot] = useState(null);
// Через 200мс після touchstart → setPressedSlot(slotTime)
// Стиль: background rgba(79,124,255,0.1) — слабке підсвічення
// Через 400мс → повне виділення і drag починається
```

**Контейнер слотів:**
- touchAction: 'pan-y' в звичайному стані (дозволяє скрол)
- touchAction: 'none' тільки коли dragActive === true

---

## Після виконання

npm run build
git add -A
git commit -m "fix: agent chat history + larger chat window + 30min slots + long press drag"
git push origin main
