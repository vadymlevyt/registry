# TASK — Фікси агентів v4 (на основі diagnostic_report_2.md)
# Legal BMS | АБ Левицького
# Дата: 26.04.2026

---

## КРОК 0 — ПРОЧИТАТИ ПЕРЕД ПОЧАТКОМ

```bash
cat CLAUDE.md
cat LESSONS.md
```

---

## ЩО РОБИМО

Чотири точкові правки на основі діагностики.
Рядки вказані точно — не шукати, змінювати конкретні місця.

---

## ФІКС 1 — rebuildCalendarView: stale closure + дублювання (App.jsx)

### 1А — Прибрати виклик з executeAction

Файл: `src/App.jsx`, рядок ~3607

ЗНАЙТИ:
```javascript
const result = ACTIONS[action](params);
console.log(`executeAction OK: ${action}`, params, result);
rebuildCalendarView();   // ← прибрати цей рядок
return result;
```

ЗАМІНИТИ НА:
```javascript
const result = ACTIONS[action](params);
console.log(`executeAction OK: ${action}`, params, result);
return result;
```

### 1Б — Додати useEffect замість прямого виклику

Файл: `src/App.jsx`, поряд з іншими useEffect (після useEffect для notes)

ДОДАТИ:
```javascript
// rebuildCalendarView — автоматично після оновлення cases або notes
useEffect(() => {
  rebuildCalendarView();
}, [cases, notes]);
```

### 1В — Прибрати hearings і deadlines з rebuildCalendarView

Файл: `src/App.jsx`, рядки ~3017–3057

`rebuildCalendarView` більше НЕ повинна читати `cases.hearings` і `cases.deadlines`
бо Dashboard вже бере їх напряму з `cases` prop.

Залишити тільки Джерело 3 — нотатки з датою:

```javascript
const rebuildCalendarView = () => {
  const events = [];

  // ТІЛЬКИ нотатки з датою (hearings і deadlines — Dashboard бере з cases напряму)
  const allNotes = [];
  for (const cat of Object.keys(notes)) {
    (notes[cat] || []).forEach(n => allNotes.push(n));
  }
  allNotes.forEach(n => {
    if (n.date) {
      events.push({
        type: 'note',
        noteId: n.id,
        caseId: n.caseId || null,
        caseName: n.caseId ? cases.find(c => c.id === n.caseId)?.name : null,
        date: n.date,
        time: n.time || null,
        duration: n.duration || (n.time ? 120 : null),
        title: (n.text || '').slice(0, 60),
        color: 'yellow'
      });
    }
  });

  events.sort((a, b) => new Date(a.date) - new Date(b.date));
  setCalendarEvents(events);
};
```

---

## ФІКС 2 — Промпти: онтологія засідань

### 2А — SONNET_CHAT_PROMPT (App.jsx ~рядок 553)

ДОДАТИ блок одразу після заголовку секції про засідання:

```
ОНТОЛОГІЯ ДАНИХ:
- Засідання (hearing) існує ВИКЛЮЧНО як елемент масиву hearings[] конкретної справи.
- Дедлайн (deadline) існує ВИКЛЮЧНО як елемент масиву deadlines[] конкретної справи.
- Окремих "вільних" засідань або дедлайнів у системі НЕ ІСНУЄ.
- Будь-яка дія над засіданням ОБОВ'ЯЗКОВО потребує caseId справи-власника.
- Якщо в команді справу не названо явно — визнач її одним з трьох способів і ТІЛЬКИ потім дій:
  1) шукай по даті в hearings[] усіх справ;
  2) шукай по прізвищу клієнта, суду, номеру справи;
  3) якщо неоднозначно — задай ОДНЕ уточнення "у якій справі — X чи Y?"
- Заборонено формулювання "засідання не прив'язане до справи".
```

ТАКОЖ замінити рядок ~542:
```
Execute intent immediately — do NOT ask for confirmation for adding/updating hearing dates
```
НА:
```
Execute intent immediately ONLY коли таблиця уточнень (нижче) не вимагає питання.
```

### 2Б — buildDashboardContext (Dashboard/index.jsx ~рядок 300)

ДОДАТИ блок на початку контексту:

```
ОНТОЛОГІЯ:
Засідання існує ВИКЛЮЧНО всередині справи (hearings[]). Окремих засідань немає.
Будь-яка дія над засіданням потребує case_name справи-власника.
Заборонено: "засідання не прив'язане до справи".
```

ЗАМІНИТИ рядок ~328:
```
Не ухиляйся від виконання — або виконуй або чітко кажи що не вистачає даних
```
НА:
```
Не ухиляйся від виконання — або виконуй або став ОДНЕ конкретне питання.
Заборонено: "не вистачає даних" без питання, "я не маю доступу".
```

---

## ФІКС 3 — Таблиця уточнень в промптах

### 3А — SONNET_CHAT_PROMPT (App.jsx)

ДОДАТИ після блоку ОНТОЛОГІЯ:

```
ПРАВИЛО УТОЧНЕНЬ (питай ТІЛЬКИ ці випадки, в інших — виконуй негайно):

add_hearing:
- Немає справи → "У якій справі?"
- Немає дати → "На яку дату?"
- Немає часу → НЕ питай. Додай без часу, скажи "час не вказано — уточни пізніше"

update_hearing (перенос):
- Немає справи → "У якій справі?"
- Є дата але немає часу → НЕ питай. Збережи попередній час.
  Скажи: "Перенесено на [дата], час [старий час] збережено. Інший час?"
- У справі кілька scheduled засідань → "Яке саме — [дата1] чи [дата2]?"
- Одне scheduled засідання → виконуй без питань

delete_hearing:
- Немає справи → "У якій справі?"
- Кілька scheduled → "Яке саме — [дата1] чи [дата2]?" НЕ обирай мовчки.
- Одне scheduled → виконуй без питань

add_deadline:
- Немає справи → "У якій справі?"
- Немає дати → "На яку дату?"

close_case / restore_case:
- Немає справи → "Яку саме справу?"

ФОРМАТ ПИТАННЯ — одне коротке речення. Поки чекаєш відповіді — не додавай ACTION_JSON.
ЗАБОРОНЕНО: мовчазний вибір першого варіанту коли їх кілька.
```

### 3Б — buildDashboardContext (Dashboard/index.jsx)

ДОДАТИ аналогічну таблицю для дій які дозволені dashboard_agent:
(add_hearing, update_hearing, delete_hearing, add_note, update_note, delete_note)

### 3В — buildAgentSystemPrompt (CaseDossier/index.jsx ~рядок 211)

ЗАМІНИТИ:
```
НЕ питай підтвердження для простих дій (видалити засідання, змінити дату).
```
НА:
```
НЕ питай підтвердження для простих дій якщо засідання одне.
Якщо в hearings[] кілька scheduled — став одне питання "яке саме — [дата1] чи [дата2]?"
```

ЗАМІНИТИ рядки ~221-222:
```
Для delete_hearing і delete_deadline — якщо hearingId/deadlineId не відомий,
взяти перший підходящий з контексту справи.
```
НА:
```
Для delete_hearing: якщо scheduled засідань рівно одне — беремо його без питань.
Якщо кілька scheduled — питаємо "яке саме — [дата1] чи [дата2]?"
Для delete_deadline: якщо дедлайн один — беремо без питань. Якщо кілька — питаємо.
```

---

## ФІКС 4 — CaseDossier: редаговані секції Засідання і Дедлайни

Файл: `src/components/CaseDossier/index.jsx`, рядки ~1138–1157

### 4А — Прибрати read-only рядки з таблиці полів

ЗНАЙТИ і ВИДАЛИТИ з масиву полів:
```javascript
{ label: "Дата засідання", field: "_hearing_date", ..., readOnly: true },
{ label: "Дедлайн", field: "_deadline", ..., readOnly: true }
```

### 4Б — Додати секцію Засідання після таблиці полів

```jsx
{/* СЕКЦІЯ ЗАСІДАННЯ */}
<div className="overview-section">
  <div className="section-header">
    <span>Засідання</span>
    <button
      className="btn-add-small"
      onClick={() => {
        const date = prompt('Дата засідання (YYYY-MM-DD):');
        const time = prompt('Час (HH:MM, або залиш порожнім):');
        if (date && onExecuteAction) {
          onExecuteAction('dossier_agent', 'add_hearing', {
            caseId: caseData.id, date, time: time || '', duration: 120
          });
        }
      }}
    >+ Додати</button>
  </div>

  {(caseData.hearings || [])
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(h => {
      const today = new Date().toISOString().split('T')[0];
      const isPast = h.date < today;
      return (
        <div key={h.id} className={`hearing-row ${isPast ? 'past' : 'upcoming'}`}>
          <input
            type="date"
            defaultValue={h.date}
            onBlur={e => {
              if (e.target.value && e.target.value !== h.date && onExecuteAction) {
                onExecuteAction('dossier_agent', 'update_hearing', {
                  caseId: caseData.id, hearingId: h.id,
                  date: e.target.value, time: h.time, duration: h.duration
                });
              }
            }}
          />
          <input
            type="time"
            defaultValue={h.time || ''}
            onBlur={e => {
              if (e.target.value !== (h.time || '') && onExecuteAction) {
                onExecuteAction('dossier_agent', 'update_hearing', {
                  caseId: caseData.id, hearingId: h.id,
                  date: h.date, time: e.target.value, duration: h.duration
                });
              }
            }}
          />
          <button
            className="btn-delete-small"
            onClick={() => {
              if (onExecuteAction) {
                onExecuteAction('dossier_agent', 'delete_hearing', {
                  caseId: caseData.id, hearingId: h.id
                });
              }
            }}
          >🗑</button>
        </div>
      );
    })
  }
  {(!caseData.hearings || caseData.hearings.length === 0) && (
    <div className="empty-hint">Засідань немає</div>
  )}
</div>
```

### 4В — Додати секцію Дедлайни після секції Засідання

```jsx
{/* СЕКЦІЯ ДЕДЛАЙНИ */}
<div className="overview-section">
  <div className="section-header">
    <span>Дедлайни</span>
    <button
      className="btn-add-small"
      onClick={() => {
        const name = prompt('Назва дедлайну:');
        const date = prompt('Дата (YYYY-MM-DD):');
        if (name && date && onExecuteAction) {
          onExecuteAction('dossier_agent', 'add_deadline', {
            caseId: caseData.id, name, date
          });
        }
      }}
    >+ Додати</button>
  </div>

  {(caseData.deadlines || [])
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => (
      <div key={d.id} className="deadline-row">
        <input
          type="text"
          defaultValue={d.name}
          onBlur={e => {
            if (e.target.value !== d.name && onExecuteAction) {
              onExecuteAction('dossier_agent', 'update_deadline', {
                caseId: caseData.id, deadlineId: d.id,
                name: e.target.value, date: d.date
              });
            }
          }}
        />
        <input
          type="date"
          defaultValue={d.date}
          onBlur={e => {
            if (e.target.value && e.target.value !== d.date && onExecuteAction) {
              onExecuteAction('dossier_agent', 'update_deadline', {
                caseId: caseData.id, deadlineId: d.id,
                name: d.name, date: e.target.value
              });
            }
          }}
        />
        <button
          className="btn-delete-small"
          onClick={() => {
            if (onExecuteAction) {
              onExecuteAction('dossier_agent', 'delete_deadline', {
                caseId: caseData.id, deadlineId: d.id
              });
            }
          }}
        >🗑</button>
      </div>
    ))
  }
  {(!caseData.deadlines || caseData.deadlines.length === 0) && (
    <div className="empty-hint">Дедлайнів немає</div>
  )}
</div>
```

### 4Г — Фікс category: зберігати канонічне значення

В рядку де `onBlur` для поля `category` — замінити щоб зберігався код а не label:

```javascript
// Знайти де обробляється blur для category і додати маппінг:
const CATEGORY_MAP = {
  'Цивільна': 'civil',
  'Кримінальна': 'criminal',
  'Адміністративна': 'administrative',
  'Військова': 'military',
};

// В onBlur:
const rawValue = e.target.innerText.trim();
const canonicalValue = CATEGORY_MAP[rawValue] || rawValue;
updateCase(caseData.id, 'category', canonicalValue);
```

---

## ПЕРЕВІРКА ПІСЛЯ ДЕПЛОЮ

### Тест 1 — rebuildCalendarView
```
Дашборд агент: "Перенеси засідання Янченко на 28 квітня"
Очікується: стара дата ОДРАЗУ зникла без F5. Нова з'явилась.
```

### Тест 2 — Онтологія
```
QI: "Перенеси засідання на 5 травня" (без назви справи)
Очікується: "У якій справі?" — одне питання. Не "засідання не прив'язане".
```

### Тест 3 — Уточнення часу
```
QI: "Перенеси засідання Брановського на 10 травня" (без часу)
Очікується: перенесено, час збережено зі старого засідання.
Відповідь: "Перенесено на 10 травня, час 10:00 збережено. Інший час?"
```

### Тест 4 — Кілька засідань
```
Якщо у справі два scheduled — QI: "Видали засідання по Манолюк"
Очікується: "Яке саме — 21 квітня чи 7 травня?"
```

### Тест 5 — Досьє: вручну змінити дедлайн
```
Відкрити досьє справи з дедлайном.
Клікнути на поле дати дедлайну — змінити — tabout.
Очікується: дата оновилась без перезавантаження.
```

### Тест 6 — Досьє: додати засідання вручну
```
Відкрити досьє. Натиснути "+ Додати" в секції Засідання.
Ввести дату і час.
Очікується: засідання з'явилось в списку і в календарі.
```

---

## ПОРЯДОК ВИКОНАННЯ

```
1. Фікс 1 — rebuildCalendarView (App.jsx) → git commit
2. Фікс 2 — Онтологія в промптах → git commit
3. Фікс 3 — Таблиця уточнень → git commit
4. Фікс 4 — CaseDossier UI (секції Засідання і Дедлайни) → git commit
5. git push → деплой → перевірка 6 тестів
```

Не чіпати: ACTIONS, PERMISSIONS, executeAction, parseAndExecuteDossierAction — вони правильні.
