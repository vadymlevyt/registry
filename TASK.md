# TASK — Фікси Dashboard v2
# Legal BMS | АБ Левицького | 2026-05-02

Прочитай CLAUDE.md і LESSONS.md перед початком.
Працюємо в гілці main.

---

## КРОК 0

```bash
cat CLAUDE.md
cat LESSONS.md
```

---

## БЛОК 1 — Аудит і валідація засідань без часу

### 1А — Знайти всі проблемні засідання

Прочитати всі справи з поточного стану (`cases` в App.jsx або registry_data.json).
Знайти всі hearings де є `date` але немає `time` (або `time` порожній рядок або null).

Вивести в консоль при завантаженні (тільки в dev режимі):
```js
// В App.jsx після завантаження cases:
cases.forEach(c => {
  (c.hearings || []).forEach(h => {
    if (h.date && !h.time) {
      console.warn(`[HEARING AUDIT] Справа "${c.name}" (${c.id}): засідання ${h.id} має дату ${h.date} але НЕ МАЄ ЧАСУ`);
    }
  });
});
```

### 1Б — Принцип валідного засідання

Засідання є валідним і відображається ТІЛЬКИ якщо має обидва поля: `date` І `time`.
Якщо хоча б одне відсутнє — ігнорувати скрізь.

Додати хелпер в `Dashboard/index.jsx`:
```js
const isValidHearing = h =>
  h.status === 'scheduled' &&
  h.date &&
  h.time &&
  h.time.trim() !== '';
```

Замінити всі місця де фільтруються hearings:
- `getAllEvents()` — замінити `h.status === 'scheduled'` на `isValidHearing(h)`
- `findConflicts()` — те саме
- `checkConflicts()` — те саме
- Контекст агента (`buildDashboardContext`) — те саме
- Слоти Day Panel і тижневого вигляду — те саме

---

## БЛОК 2 — Призупинені і закриті справи

### Логіка відображення:

**Активні (`status === 'active'`):**
- Повне відображення, стандартні кольори
- Синій — засідання, помаранчевий — дедлайни

**Призупинені (`status === 'suspended'`):**
- Відображаються в календарі і стрічці але іншим кольором
- Засідання і дедлайни — сіро-блакитний `#7f8fa6`
- Агент їх бачить і повідомляє: "засідання у призупиненій справі Квант"
- НЕ рахуються як накладка — виключити призупинені з `findConflicts()` і `checkConflicts()`

**Закриті (`status === 'closed'`):**
- НЕ відображаються в календарі, стрічці подій, слотах
- Агент їх НЕ бачить (не включати в контекст)
- Виключити з `getAllEvents()` і контексту агента

### Реалізація:

В `getAllEvents()`:
```js
cases.forEach(c => {
  if (c.status === 'closed') return; // закриті — пропустити повністю

  const color = c.status === 'suspended' ? '#7f8fa6' : null; // null = стандартний

  (c.hearings || []).filter(isValidHearing).forEach(h => {
    events.push({
      ...
      color, // передати колір
      isSuspended: c.status === 'suspended'
    });
  });

  (c.deadlines || []).forEach(dl => {
    events.push({
      ...
      color,
      isSuspended: c.status === 'suspended'
    });
  });
});
```

В `findConflicts()` — виключити призупинені:
```js
cases.forEach(c => {
  if (c.status !== 'active') return; // тільки активні рахуємо як накладки
  ...
});
```

В контексті агента — закриті не включати:
```js
const visibleCases = cases.filter(c => c.status !== 'closed');
```

В слотах — якщо `event.color` є → використати його замість стандартного.
В крапках місячної сітки — якщо `isSuspended` → сіро-блакитна крапка замість синьої/помаранчевої.

---

## БЛОК 3 — Модалка: UX фікси

### 3А — Перейменування і структура

- Заголовок модалки: "Нова подія — {дата}" → залишити
- Вкладка "Нотатка" — підзаголовок всередині: "Нова нотатка"
- Поле "Назва події" для нотатки → замінити на `<textarea>` з написом "Текст нотатки":
```jsx
{modalType === 'note' && (
  <textarea
    placeholder="Текст нотатки..."
    value={modalTitle}
    onChange={e => setModalTitle(e.target.value)}
    style={{
      width: '100%', minHeight: 80, padding: '8px',
      borderRadius: 5, border: '1px solid var(--border,#2e3148)',
      background: 'var(--surface2,#222536)', color: 'var(--text,#e8eaf0)',
      fontSize: 12, resize: 'vertical',
      whiteSpace: 'pre-wrap', wordBreak: 'break-word'
    }}
  />
)}
```

- Поле "Назва події" для засідання → залишити як однорядковий input (це назва/опис засідання, опційне)
- Поле "Суд / місце" → **видалити повністю**. Суд береться з картки справи автоматично.

### 3Б — Обов'язкові поля для засідання

Для `modalType === 'hearing'` обов'язкові: справа + час початку.
При спробі зберегти без них — підсвітити поля червоним і показати підказку.

```js
function saveEvent(...) {
  if (modalType === 'hearing') {
    let hasError = false;
    if (!modalCaseId) {
      setCaseIdError(true); // новий стан для підсвітки
      hasError = true;
    }
    if (!modalStartTime) {
      setTimeError(true);
      hasError = true;
    }
    if (hasError) return;
    ...
  }
}
```

Стиль поля з помилкою: `border: '1px solid #e74c3c'`
Скидати помилку при зміні поля.

---

## БЛОК 4 — Long press 600мс і скрол

### 4А — Змінити таймер з 400мс на 600мс

Файл: `src/components/Dashboard/index.jsx`.
Знайти всі місця де є `400` або `setTimeout` пов'язаний з drag/longpress.
Замінити на `600`.

Аналогічно half-press підсвітка — змінити з `200` на `300` (половина від 600).

### 4Б — Заборонити браузерне контекстне меню

На контейнері слотів додати:
```jsx
onContextMenu={e => e.preventDefault()}
```

### 4В — touchAction залежно від стану

```jsx
style={{
  touchAction: isDragging ? 'none' : 'pan-y',
  userSelect: 'none'
}}
```

`pan-y` дозволяє вертикальний скрол коли drag не активний.
`none` блокує скрол тільки під час виділення.

### 4Г — Простий тап НЕ відкриває модалку

Модалка відкривається ТІЛЬКИ після успішного drag (виділення хоча б одного слоту).
Якщо користувач натиснув і відпустив без руху (простий тап) — нічого не відбувається.

В `endDrag()`:
```js
function endDrag() {
  if (dragStart !== null && dragEnd !== null && dragStart !== dragEnd) {
    // є виділення більше одного слоту — відкрити модалку
    openModalWithRange(...);
  } else if (dragStart !== null && dragEnd !== null && dragStart === dragEnd) {
    // один слот — теж відкрити модалку (навмисний одиночний вибір після long press)
    openModalWithRange(...);
  }
  // якщо dragStart === null — це був простий тап, нічого не робити
  setIsDragging(false);
  setDragStart(null);
  setDragEnd(null);
}
```

---

## БЛОК 5 — Чат агента: textarea і висота

Файл: `src/components/Dashboard/index.jsx`.

### 5А — Поле вводу → textarea

Знайти `<input` для вводу команди агенту. Замінити на `<textarea>`:
```jsx
<textarea
  value={agentInput}
  onChange={e => setAgentInput(e.target.value)}
  onKeyDown={e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAgentSend(agentInput);
    }
  }}
  placeholder="Команда для агента... (напр. «додай засідання»)"
  rows={2}
  style={{
    flex: 1, padding: '6px 8px', borderRadius: 5,
    border: '1px solid var(--border,#2e3148)',
    background: 'var(--surface2,#222536)',
    color: 'var(--text,#e8eaf0)',
    fontSize: 11, resize: 'none',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    overflowWrap: 'break-word'
  }}
/>
```

Enter — надіслати, Shift+Enter — новий рядок.

### 5Б — Вікно історії чату

Збільшити висоту контейнера з повідомленнями до `240px`.

Кожне повідомлення:
```js
whiteSpace: 'pre-wrap',
wordBreak: 'break-word',
overflowWrap: 'break-word',
maxWidth: '90%'
```

### 5В — Аналогічно виправити в інших чатах системи

Перевірити і застосувати ті самі стилі в:
- `src/components/CaseDossier/index.jsx` — поле вводу агента
- Quick Input чат в `src/App.jsx`

---

## ПІСЛЯ ВИКОНАННЯ

```bash
npm run build
git add -A
git commit -m "fix: hearing validation, suspended cases, modal UX, long press 600ms, agent textarea"
git push origin main
```

Перевірити:
1. Квант — засідання без часу більше не показується як подія
2. Призупинена справа — засідання відображається сіро-блакитним, не рахується як накладка
3. Закрита справа — не відображається взагалі
4. Модалка — без справи і без часу не зберігає, підсвічує червоним
5. Скрол пальцем — не відкриває модалку
6. Long press 600мс → виділення слотів
7. Чат агента — textarea, текст переноситься
