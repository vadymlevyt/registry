# TASK: Спільний стан + повноваження агента дашборду

## Контекст
Два завдання в одному запуску. Разом вони роблять дашборд повноцінним стільником
і готують архітектуру для всіх наступних модулів (Notebook, CaseDossier).

---

## ЧАСТИНА 1 — Спільний стан App.jsx

### Крок 1 — Аудит updateCase

Знайди всі місця в App.jsx де відбувається пряма зміна `cases` через `setCases`.
Переконайся що всі вони йдуть через єдину функцію `updateCase(caseId, field, value)`.

Функція має виглядати так:
```js
const updateCase = (caseId, field, value) => {
  setCases(prev => prev.map(c =>
    c.id === caseId ? { ...c, [field]: value } : c
  ));
  // після оновлення стану — зберегти в Drive (викликати існуючу функцію sync)
};
```

Якщо є розкидані `setCases(...)` напряму в UI-обробниках — замінити на `updateCase`.
Логіку агента (sendChat, ACTION_JSON парсинг) не чіпати — вона вже правильна.

---

### Крок 2 — Підняти calendarEvents з Dashboard в App.jsx

#### 2а. В App.jsx додати стан:
```js
const [calendarEvents, setCalendarEvents] = useState([]);
```

#### 2б. Додати функції управління подіями:
```js
const addCalendarEvent = (event) => {
  setCalendarEvents(prev => [...prev, { ...event, id: Date.now().toString() }]);
  // зберегти в localStorage під ключем 'levytskyi_calendar_events'
};

const updateCalendarEvent = (eventId, updates) => {
  setCalendarEvents(prev => prev.map(e =>
    e.id === eventId ? { ...e, ...updates } : e
  ));
};

const deleteCalendarEvent = (eventId) => {
  setCalendarEvents(prev => prev.filter(e => e.id !== eventId));
};
```

#### 2в. Завантажувати події при старті:
Поряд з існуючим завантаженням cases — додати:
```js
const saved = localStorage.getItem('levytskyi_calendar_events');
if (saved) setCalendarEvents(JSON.parse(saved));
```

#### 2г. Передати в Dashboard через props — включаючи updateCase:
```jsx
<Dashboard
  cases={cases}
  calendarEvents={calendarEvents}
  onUpdateCase={updateCase}
  onAddEvent={addCalendarEvent}
  onUpdateEvent={updateCalendarEvent}
  onDeleteEvent={deleteCalendarEvent}
/>
```

#### 2д. В Dashboard/index.jsx:
- Прибрати локальний `useState` для calendarEvents
- Отримувати через props: `function Dashboard({ cases, calendarEvents, onUpdateCase, onAddEvent, onUpdateEvent, onDeleteEvent })`
- Замінити всі `setCalendarEvents(...)` на виклики відповідних props-функцій
- Вся інша логіка і UI Dashboard залишаються без змін

---

### Крок 3 — Додати notes[] як спільний стан

#### 3а. В App.jsx додати стан:
```js
const [notes, setNotes] = useState([]);
```

#### 3б. Додати функції:
```js
const addNote = (note) => {
  const newNote = {
    id: Date.now().toString(),
    text: note.text,
    category: note.category || 'general', // case | content | system | general
    caseId: note.caseId || null,
    createdAt: new Date().toISOString(),
  };
  setNotes(prev => {
    const updated = [...prev, newNote];
    localStorage.setItem('levytskyi_notes', JSON.stringify(updated));
    return updated;
  });
};

const deleteNote = (noteId) => {
  setNotes(prev => {
    const updated = prev.filter(n => n.id !== noteId);
    localStorage.setItem('levytskyi_notes', JSON.stringify(updated));
    return updated;
  });
};
```

#### 3в. Завантажувати нотатки при старті:
```js
const savedNotes = localStorage.getItem('levytskyi_notes');
if (savedNotes) setNotes(JSON.parse(savedNotes));
```

---

### Крок 4 — Оновити CLAUDE.md

Додати в кінець файлу CLAUDE.md:

```markdown
## АРХІТЕКТУРНЕ ПРАВИЛО — СПІЛЬНИЙ СТАН

Єдине джерело правди для всіх модулів — App.jsx.

НЕ можна:
- Тримати cases[], notes[], calendarEvents[] всередині компонента
- Викликати setCases() напряму з компонента
- Дублювати дані між модулями

МОЖНА і ТРЕБА:
- Отримувати дані через props
- Змінювати дані через функції що прийшли через props
- Тримати всередині компонента тільки UI-стан (активна вкладка, текст в полі)

Функції зміни спільних даних живуть ТІЛЬКИ в App.jsx:
- updateCase(caseId, field, value)
- addNote(note) / deleteNote(noteId)
- addCalendarEvent(event) / updateCalendarEvent(id, updates) / deleteCalendarEvent(id)
```

---

## ЧАСТИНА 2 — Повноваження агента дашборду

### Крок 5 — ACTION_JSON в агенті дашборду

Агент дашборду зараз читає дані але не може їх змінювати. Треба додати йому
підтримку ACTION_JSON команд — за тим самим принципом що в головному QI.

#### 5а. В системному промпті агента дашборду додати:

Після основного тексту промпту додати блок:

```
Якщо користувач просить змінити дату засідання, час, дедлайн або інше поле справи —
відповідай текстом І додавай в кінці ACTION_JSON блок.

Формат ACTION_JSON:
ACTION_JSON: {"action": "update_hearing", "case_name": "назва справи", "hearing_date": "YYYY-MM-DD", "hearing_time": "HH:MM"}
ACTION_JSON: {"action": "update_deadline", "case_name": "назва справи", "deadline": "YYYY-MM-DD"}
ACTION_JSON: {"action": "navigate_calendar", "direction": "prev" | "next"}
ACTION_JSON: {"action": "navigate_week", "direction": "prev" | "next"}

Правила:
- case_name має точно співпадати з назвою справи зі списку
- hearing_date і deadline завжди у форматі YYYY-MM-DD
- hearing_time у форматі HH:MM (24-годинний)
- Якщо не можеш визначити справу або дату — запитай уточнення ОДИН РАЗ, не більше
- Не ухиляйся від виконання — або виконуй або чітко кажи що не вистачає даних
```

#### 5б. В Dashboard/index.jsx додати обробку ACTION_JSON:

Після отримання відповіді від агента — парсити ACTION_JSON тим самим методом
що використовується в головному QI (depth counter, не regex):

```js
const idx = responseText.indexOf('ACTION_JSON:');
if (idx !== -1) {
  const start = responseText.indexOf('{', idx);
  let depth = 0, end = -1;
  for (let i = start; i < responseText.length; i++) {
    if (responseText[i] === '{') depth++;
    else if (responseText[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end !== -1) {
    const action = JSON.parse(responseText.slice(start, end + 1));
    handleDashboardAction(action);
  }
}
```

#### 5в. Додати функцію handleDashboardAction в Dashboard/index.jsx:

```js
const handleDashboardAction = (action) => {
  const findCase = (name) => cases.find(c =>
    c.name === name ||
    c.name.toLowerCase().includes(name.toLowerCase()) ||
    c.client?.toLowerCase().includes(name.toLowerCase())
  );

  switch (action.action) {
    case 'update_hearing': {
      const c = findCase(action.case_name);
      if (!c) return;
      if (action.hearing_date) onUpdateCase(c.id, 'hearing_date', action.hearing_date);
      if (action.hearing_time) onUpdateCase(c.id, 'hearing_time', action.hearing_time);
      break;
    }
    case 'update_deadline': {
      const c = findCase(action.case_name);
      if (!c) return;
      if (action.deadline) onUpdateCase(c.id, 'deadline', action.deadline);
      break;
    }
    case 'navigate_calendar': {
      // викликати існуючу функцію навігації місячного календаря
      if (action.direction === 'prev') handlePrevMonth();
      if (action.direction === 'next') handleNextMonth();
      break;
    }
    case 'navigate_week': {
      // викликати існуючу функцію навігації тижневого календаря
      if (action.direction === 'prev') handlePrevWeek();
      if (action.direction === 'next') handleNextWeek();
      break;
    }
  }
};
```

Назви функцій навігації (handlePrevMonth і т.д.) — взяти з існуючого коду Dashboard,
не вигадувати нові.

---

## Перевірка після виконання

- [ ] Dashboard працює як раніше — Activity Feed, обидва календарі, Day Panel, drag
- [ ] Події в Day Panel зберігаються після перезавантаження сторінки
- [ ] Агент дашборду: «Перенеси засідання Бабенко на 20 квітня» — дата змінюється в картці
- [ ] Агент дашборду: «Наступний тиждень» — календар перегортається
- [ ] Агент дашборду: «Наступний місяць» — місячний календар перегортається
- [ ] В App.jsx є notes[] стан і функції addNote / deleteNote
- [ ] В CLAUDE.md з'явився блок про архітектурне правило
- [ ] Немає помилок в консолі браузера після деплою
- [ ] Сайт не показує білу сторінку

## Важливо
Не чіпати логіку головного QI і його агента — тільки Dashboard.
Не перейменовувати існуючі функції — тільки додавати або уніфіковувати.
Після виконання:
git add -A && git commit -m "Shared state + dashboard agent actions" && git push origin main
