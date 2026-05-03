# TASK — Діагностика і фікс: дорога не відображається в слотах
# Legal BMS | АБ Левицького | 2026-05-03

Прочитай CLAUDE.md і LESSONS.md перед початком.
Моделі — брати з CLAUDE.md. Працюємо в гілці main.

---

## ЕТАП 1 — ДІАГНОСТИКА (нічого не змінювати)

### 1А — Перевір як зберігається дорога

```bash
grep -n "travel\|category.*travel\|add_note.*travel" src/components/Dashboard/index.jsx | head -20
grep -n "travel\|category.*travel" src/App.jsx | head -20
```

Знайди де при збереженні засідання з travelMinutes викликається збереження дороги.
Відповідь на питання:
1. Через що зберігається — `onExecuteAction('add_note', ...)` чи напряму в стан?
2. З якими параметрами — чи є `date`, `time`, `duration`, `category: 'travel'`?
3. Куди потрапляє — в `cases[].notes[]` чи в загальний `notes[]`?

### 1Б — Перевір getAllEvents

```bash
grep -n "getAllEvents\|travel\|category" src/components/Dashboard/index.jsx | head -30
```

Знайди функцію `getAllEvents` і відповідь на питання:
1. Чи є обробка нотаток з `category === 'travel'`?
2. Звідки беруться нотатки — з `cases[].notes[]` чи з окремого стану?
3. Чи travel події потрапляють в масив що повертається?

### 1В — Перевір рендер слотів

```bash
grep -n "travel\|type.*travel\|getEventStyle.*travel" src/components/Dashboard/index.jsx | head -20
```

Знайди де рендеруються слоти і відповідь на питання:
1. Чи є обробка `event.type === 'travel'` в рендері слоту?
2. Чи є `travel` в функції `getEventStyle` або аналогічній?
3. Чи фільтруються якось події перед рендером (можливо travel відфільтровується)?

### 1Г — Виведи звіт в термінал

```
=== ДІАГНОСТИКА: ДОРОГА В СЛОТАХ ===
Збереження дороги: [через що і куди]
travel в getAllEvents: [є/немає]
travel в рендері слотів: [є/немає]
Ймовірна причина: [що саме не працює]
===
```

---

## ЕТАП 2 — ФІКС (на основі діагностики)

На основі знайденої причини виправити ланцюжок:

**Якщо дорога не зберігається з правильними параметрами:**
Переконатись що при збереженні засідання з travelMinutes викликається:
```js
onExecuteAction('dashboard_agent', 'add_note', {
  text: '🚗 Дорога туди',
  date: selectedDay,
  time: calcTravelStart(modalStartTime, travelMinutes), // час початку дороги
  duration: travelMinutes / 2,
  caseId: modalCaseId || null,
  category: 'travel'
});
onExecuteAction('dashboard_agent', 'add_note', {
  text: '🚗 Дорога назад',
  date: selectedDay,
  time: modalEndTime, // час кінця засідання = початок дороги назад
  duration: travelMinutes / 2,
  caseId: modalCaseId || null,
  category: 'travel'
});
```

**Якщо travel не потрапляє в getAllEvents:**
Додати обробку в getAllEvents:
```js
// Нотатки з date (включаючи travel)
const allNotes = [
  ...cases.flatMap(c => (c.notes || []).map(n => ({ ...n, caseName: c.name, isSuspended: c.status === 'suspended' }))),
  ...(generalNotes || [])
];

allNotes.filter(n => n.date).forEach(n => {
  events.push({
    id: n.id,
    type: n.category === 'travel' ? 'travel' : 'note',
    title: n.text,
    date: n.date,
    time: n.time || null,
    duration: n.duration || 60,
    caseId: n.caseId || null,
    caseName: n.caseName || null,
    isSuspended: n.isSuspended || false
  });
});
```

**Якщо travel не рендериться в слотах:**
Переконатись що `getEventStyle` має travel:
```js
const EVENT_COLORS = {
  hearing:  { bg:'rgba(79,124,255,0.15)',  border:'#4f7cff', text:'var(--text)' },
  deadline: { bg:'rgba(243,156,18,0.15)', border:'#f39c12', text:'var(--text)' },
  note:     { bg:'rgba(46,204,113,0.15)', border:'#2ecc71', text:'var(--text)' },
  travel:   { bg:'rgba(155,89,182,0.15)', border:'#9b59b6', text:'#9b59b6'    },
};
```

І в рендері слоту travel обробляється як основний блок (поряд з hearing):
```js
const main = slotEvents.find(e => e.type === 'hearing' || e.type === 'travel');
```

```bash
npm run build
```

---

## ФІНАЛЬНА ПЕРЕВІРКА

```bash
npm run build
git add -A
git commit -m "fix: travel blocks display in day panel slots"
git push origin main
```

Перевірити:
1. Додати засідання з дорогою 2 год
2. В слотах з'являються два пурпурних блоки до і після засідання
3. Клік на блок дороги → попап тільки для читання
