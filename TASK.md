# TASK — Архітектура ACTIONS + PERMISSIONS
# Legal BMS | АБ Левицького
# Дата: 19.04.2026
# Версія: 1.0

---

## КРОК 0 — ПРОЧИТАТИ ПЕРЕД ПОЧАТКОМ

```bash
cat LESSONS.md
cat CLAUDE.md
```

Прочитати уважно. Не починати поки не прочитав.

---

## ЩО РОБИМО І НАВІЩО

Зараз обробники розкидані по трьох місцях: `sendChat()` в App.jsx, Dashboard/index.jsx, окремі функції App.jsx. Є дублювання, немає перевірки повноважень, немає логування.

Реалізуємо єдиний реєстр дій ACTIONS + матрицю повноважень PERMISSIONS + єдину функцію виконання `executeAction`. Після цього кожен агент звертається тільки через `executeAction` — ніяких прямих викликів.

Принцип: архіваріус. Хочеш щось змінити в даних — йди через нього.

---

## КРОК 1 — АНАЛІЗ ПОТОЧНОГО КОДУ

Перед будь-якими змінами:

```bash
grep -n "setCases\|setNotes\|setCalendarEvents" src/App.jsx | head -50
grep -n "handleEventAdd\|handleEventUpdate\|handleEventDelete" src/components/Dashboard/index.jsx
grep -n "saveNoteToStorage\|addNote\|deleteNote\|updateNote" src/App.jsx
```

Записати де що знаходиться. Не змінювати поки не зрозуміло де все лежить.

---

## КРОК 2 — СТРУКТУРА ДАНИХ: registry_data.json

### 2А. Додати глобальні поля

```json
{
  "version": "4.0",
  "userId": "vadym",
  ...
}
```

### 2Б. Оновити структуру справи (cases[])

Кожна справа отримує нові поля:

```json
{
  "id": "case_001",
  "userId": "vadym",
  "createdAt": "2026-04-19T10:00:00",
  "updatedAt": "2026-04-19T10:00:00",
  ...існуючі поля...
}
```

### 2В. hearing_date і hearing_time → hearings[]

БУЛО:
```json
{
  "hearing_date": "2026-04-15",
  "hearing_time": "10:00"
}
```

СТАЛО:
```json
{
  "hearings": [
    {
      "id": "hrg_001",
      "date": "2026-04-15",
      "time": "10:00",
      "duration": 120,
      "status": "scheduled",
      "type": null
    }
  ]
}
```

⚠ Міграція: для кожної справи де є `hearing_date` — створити перший елемент `hearings[]` з цими даними. Старі поля `hearing_date` і `hearing_time` — видалити після міграції.

### 2Г. deadline і deadline_type → deadlines[]

БУЛО:
```json
{
  "deadline": "2026-04-20",
  "deadline_type": "hearing"
}
```

СТАЛО:
```json
{
  "deadlines": [
    {
      "id": "dl_001",
      "name": "Подати відзив",
      "date": "2026-04-20"
    }
  ]
}
```

⚠ Міграція: для кожної справи де є `deadline` — створити перший елемент `deadlines[]`. Старі поля — видалити після міграції.

### 2Д. Додати timeLog[]

```json
{
  "timeLog": []
}
```

Поки порожній масив. Структура одного запису:
```json
{
  "id": "tl_001",
  "userId": "vadym",
  "caseId": "case_001",
  "date": "2026-04-19",
  "duration": 45,
  "description": "Підготовка до засідання",
  "type": "billable",
  "source": "manual",
  "createdAt": "2026-04-19T10:30:00"
}
```

### 2Е. calendarEvents[] — прибрати reminder

З `calendarEvents[]` видалити всі події типу `reminder`. Залишити тільки `hearing` посилання:
```json
{
  "type": "hearing",
  "caseId": "case_001",
  "hearingId": "hrg_001"
}
```

### 2Є. notes[] — додати нові поля

Кожна нотатка отримує:
```json
{
  "id": "note_001",
  "userId": "vadym",
  "category": "general",
  "text": "...",
  "date": null,
  "time": null,
  "duration": null,
  "caseId": null,
  "createdAt": "2026-04-19T10:00:00",
  "updatedAt": "2026-04-19T10:00:00"
}
```

---

## КРОК 3 — РЕАЛІЗАЦІЯ ACTIONS в App.jsx

Додати в App.jsx після всіх існуючих функцій єдиний об'єкт ACTIONS:

```javascript
const ACTIONS = {

  // ГРУПА 1 — Справи
  create_case: ({ fields }) => {
    const newCase = {
      id: `case_${Date.now()}`,
      userId: 'vadym',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      hearings: [],
      deadlines: [],
      ...fields
    };
    setCases(prev => [...prev, newCase]);
    return { success: true, caseId: newCase.id };
  },

  close_case: ({ caseId }) => {
    setCases(prev => prev.map(c =>
      c.id === caseId
        ? { ...c, status: 'closed', updatedAt: new Date().toISOString() }
        : c
    ));
    return { success: true };
  },

  restore_case: ({ caseId }) => {
    setCases(prev => prev.map(c =>
      c.id === caseId
        ? { ...c, status: 'active', updatedAt: new Date().toISOString() }
        : c
    ));
    return { success: true };
  },

  // destroy_case — НЕ додавати в ACTIONS. Тільки через UI.

  update_case_field: ({ caseId, field, value }) => {
    const allowedFields = [
      'name', 'client', 'court', 'case_no', 'category',
      'next_action', 'notes', 'judge', 'status'
    ];
    if (!allowedFields.includes(field)) {
      return { error: `Поле "${field}" не дозволено змінювати через агента` };
    }
    setCases(prev => prev.map(c =>
      c.id === caseId
        ? { ...c, [field]: value, updatedAt: new Date().toISOString() }
        : c
    ));
    return { success: true };
  },

  add_deadline: ({ caseId, name, date }) => {
    const deadline = {
      id: `dl_${Date.now()}`,
      name,
      date
    };
    setCases(prev => prev.map(c =>
      c.id === caseId
        ? { ...c, deadlines: [...(c.deadlines || []), deadline], updatedAt: new Date().toISOString() }
        : c
    ));
    return { success: true, deadlineId: deadline.id };
  },

  update_deadline: ({ caseId, deadlineId, name, date }) => {
    setCases(prev => prev.map(c =>
      c.id === caseId
        ? {
            ...c,
            deadlines: (c.deadlines || []).map(d =>
              d.id === deadlineId ? { ...d, name, date } : d
            ),
            updatedAt: new Date().toISOString()
          }
        : c
    ));
    return { success: true };
  },

  delete_deadline: ({ caseId, deadlineId }) => {
    setCases(prev => prev.map(c =>
      c.id === caseId
        ? {
            ...c,
            deadlines: (c.deadlines || []).filter(d => d.id !== deadlineId),
            updatedAt: new Date().toISOString()
          }
        : c
    ));
    return { success: true };
  },

  // ГРУПА 2 — Засідання
  add_hearing: ({ caseId, date, time, duration = 120, type = null }) => {
    const hearing = {
      id: `hrg_${Date.now()}`,
      date,
      time,
      duration,
      status: 'scheduled',
      type
    };
    setCases(prev => prev.map(c =>
      c.id === caseId
        ? { ...c, hearings: [...(c.hearings || []), hearing], updatedAt: new Date().toISOString() }
        : c
    ));
    return { success: true, hearingId: hearing.id };
  },

  update_hearing: ({ caseId, hearingId, date, time, duration, type }) => {
    setCases(prev => prev.map(c =>
      c.id === caseId
        ? {
            ...c,
            hearings: (c.hearings || []).map(h =>
              h.id === hearingId
                ? { ...h, date, time, duration: duration ?? h.duration, type: type ?? h.type }
                : h
            ),
            updatedAt: new Date().toISOString()
          }
        : c
    ));
    return { success: true };
  },

  delete_hearing: ({ caseId, hearingId }) => {
    setCases(prev => prev.map(c =>
      c.id === caseId
        ? {
            ...c,
            hearings: (c.hearings || []).filter(h => h.id !== hearingId),
            updatedAt: new Date().toISOString()
          }
        : c
    ));
    return { success: true };
  },

  // ГРУПА 3 — Нотатки
  add_note: ({ text, category = 'general', date = null, time = null, duration = null, caseId = null }) => {
    const note = {
      id: `note_${Date.now()}`,
      userId: 'vadym',
      category,
      text,
      date,
      time,
      duration,
      caseId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    setNotes(prev => [note, ...prev]);
    return { success: true, noteId: note.id };
  },

  update_note: ({ noteId, text, date, time, duration }) => {
    setNotes(prev => prev.map(n =>
      n.id === noteId
        ? { ...n, text, date: date ?? n.date, time: time ?? n.time, duration: duration ?? n.duration, updatedAt: new Date().toISOString() }
        : n
    ));
    return { success: true };
  },

  delete_note: ({ noteId }) => {
    setNotes(prev => prev.filter(n => n.id !== noteId));
    // також видалити з pinnedNoteIds всіх справ
    setCases(prev => prev.map(c => ({
      ...c,
      pinnedNoteIds: (c.pinnedNoteIds || []).filter(id => id !== noteId)
    })));
    return { success: true };
  },

  pin_note: ({ noteId, caseId }) => {
    setCases(prev => prev.map(c =>
      c.id === caseId
        ? { ...c, pinnedNoteIds: [...new Set([...(c.pinnedNoteIds || []), noteId])] }
        : c
    ));
    return { success: true };
  },

  unpin_note: ({ noteId, caseId }) => {
    setCases(prev => prev.map(c =>
      c.id === caseId
        ? { ...c, pinnedNoteIds: (c.pinnedNoteIds || []).filter(id => id !== noteId) }
        : c
    ));
    return { success: true };
  },

  // ГРУПА 4 — Час / Сесія
  add_time_entry: ({ caseId = null, date, duration, description, type = 'billable', source = 'manual' }) => {
    const entry = {
      id: `tl_${Date.now()}`,
      userId: 'vadym',
      caseId,
      date,
      duration,
      description,
      type,
      source,
      createdAt: new Date().toISOString()
    };
    setTimeLog(prev => [entry, ...prev]);
    return { success: true };
  },

  track_session_start: ({ caseId = null, sessionId }) => {
    // Заглушка — реалізувати пізніше
    console.log(`Session started: ${sessionId}, case: ${caseId}`);
    return { success: true };
  },

  track_session_end: ({ sessionId }) => {
    // Заглушка — реалізувати пізніше
    console.log(`Session ended: ${sessionId}`);
    return { success: true };
  },
};
```

---

## КРОК 4 — МАТРИЦЯ PERMISSIONS в App.jsx

```javascript
const PERMISSIONS = {
  qi_agent: [
    'create_case', 'close_case', 'restore_case',
    'update_case_field',
    'add_deadline', 'update_deadline',
    'add_hearing', 'update_hearing',
    'add_note',
    'add_time_entry',
  ],

  dashboard_agent: [
    'add_hearing', 'update_hearing',
    'add_note',
  ],

  dossier_agent: [
    'create_case', 'close_case', 'restore_case',
    'update_case_field',
    'add_deadline', 'update_deadline', 'delete_deadline',
    'add_hearing', 'update_hearing', 'delete_hearing',
    'add_note', 'update_note', 'delete_note',
    'pin_note', 'unpin_note',
    'add_time_entry',
    'track_session_start', 'track_session_end',
  ],

  main_agent: [
    'create_case', 'close_case', 'restore_case',
    'update_case_field',
    'add_deadline', 'update_deadline', 'delete_deadline',
    'add_hearing', 'update_hearing', 'delete_hearing',
    'add_note', 'update_note', 'delete_note',
    'pin_note', 'unpin_note',
    'add_time_entry',
    'track_session_start', 'track_session_end',
  ],

  // destroy_case — жоден агент. Тільки UI.
};
```

---

## КРОК 5 — executeAction в App.jsx

```javascript
const logAction = ({ agentId, action, params, userId }) => {
  const entry = {
    ts: new Date().toISOString(),
    userId,
    agentId,
    action,
    caseId: params?.caseId || null,
  };
  // зберігати в localStorage для майбутнього аналізу
  try {
    const log = JSON.parse(localStorage.getItem('levytskyi_action_log') || '[]');
    log.unshift(entry);
    // зберігати останні 500 записів
    localStorage.setItem('levytskyi_action_log', JSON.stringify(log.slice(0, 500)));
  } catch (e) {
    console.warn('logAction error:', e);
  }
};

const executeAction = (agentId, action, params, userId = 'vadym') => {
  // Перевірка повноважень
  const allowed = PERMISSIONS[agentId] || [];
  if (!allowed.includes(action)) {
    console.warn(`executeAction: агент "${agentId}" не має права на "${action}"`);
    return { error: `Немає повноважень: ${action}` };
  }

  // Перевірка чи дія існує
  if (!ACTIONS[action]) {
    console.warn(`executeAction: дія "${action}" не знайдена в реєстрі`);
    return { error: `Невідома дія: ${action}` };
  }

  // Логування
  logAction({ agentId, action, params, userId });

  // Виконання
  try {
    const result = ACTIONS[action](params);
    // Після будь-якої зміни — перебудувати календар дашборду
    rebuildCalendarView();
    return result;
  } catch (e) {
    console.error(`executeAction error [${action}]:`, e);
    return { error: e.message };
  }
};
```

---

## КРОК 6 — rebuildCalendarView в App.jsx

```javascript
const rebuildCalendarView = () => {
  // Збирає всі події для відображення в календарі з трьох джерел
  // Викликається автоматично після кожної executeAction
  // Результат зберігається в стані для дашборду

  const events = [];

  // Джерело 1 — засідання (сині слоти)
  cases.forEach(c => {
    (c.hearings || []).forEach(h => {
      if (h.status === 'scheduled') {
        events.push({
          type: 'hearing',
          caseId: c.id,
          caseName: c.name,
          hearingId: h.id,
          date: h.date,
          time: h.time,
          duration: h.duration || 120,
          color: 'blue'
        });
      }
    });
  });

  // Джерело 2 — дедлайни (червоні позначки без слоту)
  cases.forEach(c => {
    (c.deadlines || []).forEach(d => {
      events.push({
        type: 'deadline',
        caseId: c.id,
        caseName: c.name,
        deadlineId: d.id,
        date: d.date,
        time: null,
        duration: null,
        title: d.name,
        color: 'red'
      });
    });
  });

  // Джерело 3 — нотатки з датою (жовті слоти)
  notes.forEach(n => {
    if (n.date) {
      events.push({
        type: 'note',
        noteId: n.id,
        caseId: n.caseId || null,
        caseName: n.caseId ? cases.find(c => c.id === n.caseId)?.name : null,
        date: n.date,
        time: n.time || null,
        duration: n.duration || (n.time ? 120 : null),
        title: n.text.slice(0, 60),
        color: 'yellow'
      });
    }
  });

  // Сортувати по даті
  events.sort((a, b) => new Date(a.date) - new Date(b.date));

  setCalendarEvents(events);
};
```

⚠ Додати `calendarEvents` і `setCalendarEvents` в useState якщо ще немає:
```javascript
const [calendarEvents, setCalendarEvents] = useState([]);
```

---

## КРОК 7 — СТАН timeLog в App.jsx

```javascript
const [timeLog, setTimeLog] = useState(() => {
  try {
    return JSON.parse(localStorage.getItem('levytskyi_timelog') || '[]');
  } catch { return []; }
});

// Зберігати при змінах
useEffect(() => {
  localStorage.setItem('levytskyi_timelog', JSON.stringify(timeLog));
}, [timeLog]);
```

---

## КРОК 8 — ЗАМІНИТИ СТАРІ ВИКЛИКИ

Після реалізації ACTIONS + executeAction — замінити всі прямі виклики в агентах.

### В sendChat() QI — замінити:

| Було | Стало |
|---|---|
| `setCases(prev => ...)` для hearing_date | `executeAction('qi_agent', 'add_hearing', {...})` |
| `setCases(prev => ...)` для deadline | `executeAction('qi_agent', 'update_deadline', {...})` |
| `setCases(prev => ...)` для update_case_field | `executeAction('qi_agent', 'update_case_field', {...})` |
| `setCases(prev => ...)` для create_case | `executeAction('qi_agent', 'create_case', {...})` |
| `setCases(prev => ...)` для close_case | `executeAction('qi_agent', 'close_case', {...})` |
| `setNotes(...)` для save_note | `executeAction('qi_agent', 'add_note', {...})` |

### В Dashboard/index.jsx — замінити:

| Було | Стало |
|---|---|
| `handleEventAdd` | `executeAction('dashboard_agent', 'add_hearing', {...})` або `add_note` |
| `handleEventUpdate` | `executeAction('dashboard_agent', 'update_hearing', {...})` |

### Видалити дублі:

- `saveNoteToStorage` — видалити, замінити на `executeAction('...', 'add_note', ...)`
- `handleEventAdd/Update/Delete` в Dashboard — видалити після заміни
- `addCalendarEvent/updateCalendarEvent/deleteCalendarEvent` в App.jsx — видалити після заміни

---

## КРОК 9 — GETTERS для дашборду

Додати допоміжні функції для швидкого доступу:

```javascript
// Наступне засідання справи
const getNextHearing = (caseItem) => {
  const today = new Date().toISOString().split('T')[0];
  return (caseItem.hearings || [])
    .filter(h => h.status === 'scheduled' && h.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
};

// Найближчий дедлайн справи
const getNextDeadline = (caseItem) => {
  const today = new Date().toISOString().split('T')[0];
  return (caseItem.deadlines || [])
    .filter(d => d.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
};
```

---

## КРОК 10 — ПЕРЕВІРКА

Після реалізації перевірити:

1. QI: сказати "Додай засідання Брановський 25 квітня 11:00" → засідання з'явилось в `hearings[]` і в календарі дашборду
2. QI: "Встанови дедлайн Рубан 30 квітня подати відзив" → дедлайн в `deadlines[]` і позначка в календарі
3. QI: "Закрити справу Манолюк" → статус closed
4. QI: "Відновити справу Манолюк" → статус active
5. Дашборд агент: "Засідання Конах перенеси на 2 травня" → оновилось в `hearings[]`
6. Консоль: перевірити `localStorage.getItem('levytskyi_action_log')` → там є записи
7. Спроба з неіснуючим агентом → помилка "Немає повноважень"

---

## ВАЖЛИВІ ПРАВИЛА

- `destroy_case` — НЕ додавати в ACTIONS і НЕ в PERMISSIONS. Тільки через UI реєстру.
- Не чіпати існуючий UI — тільки логіку обробників
- Всі зміни тільки в main гілці
- Після кожного кроку — git commit з описом
- Якщо щось зламалось — git reset до попереднього коміту, не латати поверх

---

## ПОРЯДОК ВИКОНАННЯ

```
1. Прочитати LESSONS.md і CLAUDE.md
2. Аналіз поточного коду (Крок 1)
3. Міграція registry_data.json (Крок 2) + git commit
4. Додати ACTIONS (Крок 3) + git commit
5. Додати PERMISSIONS (Крок 4) + git commit
6. Додати executeAction (Крок 5) + git commit
7. Додати rebuildCalendarView (Крок 6) + git commit
8. Додати timeLog стан (Крок 7) + git commit
9. Замінити старі виклики (Крок 8) + git commit
10. Додати getters (Крок 9) + git commit
11. Перевірка (Крок 10)
12. git push → деплой → фінальна перевірка на сайті
```
