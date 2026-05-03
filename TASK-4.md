# TASK — Очищення даних + валідація засідань + фікси Day Panel
# Legal BMS | АБ Левицького | 2026-05-02

Прочитай CLAUDE.md і LESSONS.md перед початком.
Моделі — брати з CLAUDE.md. Працюємо в гілці main.

---

## ПІДХІД ДО ВИКОНАННЯ

Перед кожним блоком — читай існуючий код і розумій структуру.
Після кожного блоку — `npm run build` і перевір що нічого не зламалось.
Якщо пропоноване рішення конфліктує з існуючим кодом — адаптуй під реальну структуру, не переписуй те що працює.
Якщо щось вже реалізовано — не дублюй, тільки доповни.

---

## ЕТАП 1 — Очищення і валідація засідань

### Крок 1А — Діагностика даних

```bash
# Знайти всі засідання без часу в даних
node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('registry_data.json', 'utf8'));
const cases = data.cases || data;
let found = 0;
cases.forEach(c => {
  (c.hearings || []).forEach(h => {
    if (!h.time || h.time.trim() === '') {
      console.log('СПРАВА:', c.name, '| ID:', c.id, '| hearing:', h.id, '| date:', h.date);
      found++;
    }
  });
});
console.log('Всього засідань без часу:', found);
"
```

Переглянь результат. Зафіксуй скільки і в яких справах.

### Крок 1Б — Видалити засідання без часу з даних

```bash
node -e "
const fs = require('fs');
const path = 'registry_data.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
const cases = data.cases || data;
let removed = 0;
cases.forEach(c => {
  const before = (c.hearings || []).length;
  c.hearings = (c.hearings || []).filter(h => h.time && h.time.trim() !== '');
  removed += before - c.hearings.length;
});
const output = data.cases ? { ...data, cases } : cases;
fs.writeFileSync(path, JSON.stringify(output, null, 2));
console.log('Видалено засідань без часу:', removed);
"
```

Перевір результат — запусти Крок 1А ще раз, має показати 0.

### Крок 1В — Валідація в ACTIONS (App.jsx)

Знайди `add_hearing` і `update_hearing` в ACTIONS.
Додай перевірку на початку кожного:

```js
add_hearing: ({ caseId, date, time, duration }) => {
  if (!time || !time.trim()) {
    console.error('[VALIDATION] add_hearing відхилено: час обов\'язковий');
    return { success: false, error: 'Час засідання обов\'язковий' };
  }
  if (!date) {
    console.error('[VALIDATION] add_hearing відхилено: дата обов\'язкова');
    return { success: false, error: 'Дата засідання обов\'язкова' };
  }
  // існуюча логіка збереження без змін
},
```

Аналогічно для `update_hearing` — якщо передається `time: null` або порожній → відхилити.

### Крок 1Г — Валідація в UI (модалка засідання)

Знайди кнопку "Зберегти" в модалці.
Додай перевірку перед збереженням:

```js
function saveEvent(...) {
  if (modalType === 'hearing') {
    if (!modalStartTime) {
      // Підсвітити поле часу червоним
      setTimeError(true);
      return;
    }
    setTimeError(false);
    // далі існуюча логіка
  }
}
```

Додати стан: `const [timeError, setTimeError] = useState(false)`
Стиль поля часу при помилці: `border: timeError ? '1px solid #e74c3c' : '1px solid var(--border)'`

### Крок 1Д — Перевірка після Етапу 1

```bash
npm run build
```

Відкрий систему в браузері. Перевір:
- Засідання без часу не відображаються і не існують в даних
- Спробуй через агента додати засідання без часу — система має відмовити
- Модалка засідання — без часу кнопка зберігає але показує помилку

---

## ЕТАП 2 — Фікси Day Panel

### Крок 2А — Діагностика перед змінами

Прочитай `src/components/Dashboard/index.jsx` і знайди:
- де реалізований `notePopup` стан і попап нотатки
- які `case` вже є в `handleDashboardAction`
- де рендериться секція "БЕЗ ЧАСУ"
- як зараз парситься ACTION_JSON (один чи кілька)
- як рендеруються нотатки в слотах

Запиши що вже є і що потрібно додати. Не змінюй нічого на цьому кроці.

### Крок 2Б — Кнопка "Видалити" в попапі нотатки

Додай в існуючий попап нотатки кнопку "🗑️ Видалити" поряд з "✏️ Редагувати".

При кліку:
```js
if (window.confirm('Видалити цю нотатку?')) {
  onExecuteAction('dashboard_agent', 'delete_note', {
    noteId: notePopup.noteId,
    caseId: notePopup.caseId
  });
  setNotePopup(null);
}
```

`delete_note` в ACTIONS — якщо вже є, перевір чи шукає в `cases[].notes[]`. Якщо ні — доповни.
Якщо немає — додай:
```js
delete_note: ({ noteId, caseId }) => {
  setCases(prev => prev.map(c => ({
    ...c,
    notes: (c.notes || []).filter(n => n.id !== noteId)
  })));
  setNotes(prev => {
    const updated = { ...prev };
    for (const cat of Object.keys(updated)) {
      updated[cat] = (updated[cat] || []).filter(n => n.id !== noteId);
    }
    return updated;
  });
  return { success: true };
},
```

```bash
npm run build  # перевірити після цього кроку
```

### Крок 2В — Попап дедлайну (тільки читання)

Додай стан `deadlinePopup` і попап для дедлайнів — без кнопок дії.
Структура аналогічна до notePopup але:
- Жовтогарячий колір рамки `rgba(243,156,18,0.4)`
- Показує: назва дедлайну, дата, справа
- Внизу текст: "Дедлайни змінюються через Досьє або Quick Input"
- Без кнопок "Редагувати" і "Видалити"

При кліку на дедлайн в слоті або в "БЕЗ ЧАСУ" → відкривати цей попап.

```bash
npm run build
```

### Крок 2Г — Кнопка "Видалити засідання" в модалці

В модалці при `editingEvent?.hearingId` — додати кнопку знизу:
```jsx
{editingEvent?.hearingId && (
  <button onClick={() => {
    if (window.confirm('Видалити це засідання?')) {
      onExecuteAction('dashboard_agent', 'delete_hearing', {
        caseId: editingEvent.caseId,
        hearingId: editingEvent.hearingId
      });
      setModalOpen(false);
      setEditingEvent(null);
    }
  }} style={{
    width:'100%', padding:'6px', borderRadius:5, border:'none',
    background:'rgba(231,76,60,0.1)', color:'#e74c3c',
    fontSize:12, cursor:'pointer', marginTop:6
  }}>
    🗑️ Видалити засідання
  </button>
)}
```

```bash
npm run build
```

### Крок 2Д — Агент: групові команди і delete_note

В `handleDashboardAction` додай якщо немає:
```js
case 'delete_note':
  return onExecuteAction('dashboard_agent', 'delete_note', {
    noteId: action.noteId,
    caseId: action.caseId || null
  });
```

Знайди де парситься ACTION_JSON. Якщо парситься тільки перший — зміни на парсинг всіх:
```js
function parseAllActionJSON(text) {
  const actions = [];
  let searchFrom = 0;
  while (true) {
    const idx = text.indexOf('ACTION_JSON:', searchFrom);
    if (idx === -1) break;
    const start = text.indexOf('{', idx);
    if (start === -1) break;
    let depth = 0, end = -1;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end !== -1) {
      try { actions.push(JSON.parse(text.slice(start, end + 1))); } catch(e) {}
      searchFrom = end + 1;
    } else break;
  }
  return actions;
}
```

В системний промпт агента додай:
```
Видалити нотатку: ACTION_JSON: {"action":"delete_note","noteId":"...","caseId":"..."}
Видалити кілька — окремий ACTION_JSON для кожної:
ACTION_JSON: {"action":"delete_note","noteId":"id1","caseId":"..."}
ACTION_JSON: {"action":"delete_note","noteId":"id2","caseId":"..."}
Видалити засідання: ACTION_JSON: {"action":"delete_hearing","caseId":"...","hearingId":"..."}
```

В контексті агента для кожного засідання включати `hearingId` і для кожної нотатки — `noteId`.

```bash
npm run build
```

### Крок 2Е — Нотатки і дедлайни без часу: вгору Day Panel

Знайди секцію "БЕЗ ЧАСУ" в JSX Day Panel.
Перемісти її вгору — одразу під блоком агента, перед часовими слотами.

Нотатки без часу — при кліку відкривати notePopup (той самий попап з Редагувати і Видалити).
Дедлайни без часу — при кліку відкривати deadlinePopup (тільки читання).

```bash
npm run build
```

### Крок 2Є — Злитий блок для нотаток що перетинаються

Якщо кілька нотаток перетинаються по часу — показувати як один блок.
Реалізуй функцію `mergeNoteGroups(notes)` що групує нотатки за перетином інтервалів.

Відображення групи:
- Один жовтий блок від мінімального до максимального часу
- Всі нотатки підписані всередині
- Клік на конкретну нотатку → notePopup саме цієї нотатки

```bash
npm run build
```

---

## ФІНАЛЬНА ПЕРЕВІРКА

```bash
npm run build
git add -A
git commit -m "feat: hearing validation, note/deadline popups, delete buttons, batch agent commands"
git push origin main
```

Перевір в браузері:
1. Засідань без часу немає в системі
2. Спроба додати засідання без часу → система відмовляє
3. Попап нотатки: "Редагувати" + "Видалити"
4. Попап дедлайну: тільки читання
5. Модалка засідання в режимі edit: кнопка "Видалити засідання"
6. Агент виконує групові команди (видалити кілька нотаток за раз)
7. Нотатки без часу — вгорі Day Panel
8. Кілька нотаток що перетинаються → злитий блок, всі підписані
