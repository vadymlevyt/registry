# TASK.md — Фікс кнопки 📌 і пам'ять агента
# Дата: 10.04.2026
# Гілка: main

## КРИТИЧНЕ ПРАВИЛО
Після успішного npm run build — ЗАВЖДИ без запитань:
```bash
git add -A && git commit -m "fix: pin button isPinned logic, restore agent memory" && git push origin main
```

---

## КРОК 0 — ДІАГНОСТИКА

```bash
cat LESSONS.md
grep -n "isPinned\|pinnedIds\|pinnedNoteIds" src/components/CaseDossier/index.jsx | head -20
grep -n "isPinned\|pinnedIds\|pinnedNoteIds" src/components/Notebook/index.jsx | head -20
grep -n "agentHistory\|agentMessages\|agent_history" src/components/CaseDossier/index.jsx | head -20
grep -n "agentHistory\|agent_history" src/App.jsx | head -10
```

---

## БАГ 1 — Кнопка 📌 інвертована

### Проблема
Стилі кнопки 📌 ПРАВИЛЬНІ (перевірено 5+ разів):
```jsx
transform: isPinned ? 'rotate(0deg)' : 'rotate(-45deg)'
opacity: isPinned ? 1 : 0.4
color: isPinned ? '#e53935' : '#666'
```

Але на екрані все НАВПАКИ:
- Прикріплена нотатка → тьмяна + нахилена (має бути яскрава + вертикальна)
- Відкріплена нотатка → яскрава + вертикальна (має бути тьмяна + нахилена)

alert показує: `pinnedIds=[]` (порожній масив) але кнопка яскрава — значить isPinned повертає true коли має бути false.

### ЗАБОРОНЕНО
НЕ міняти стилі (transform, opacity, color). Вони вже правильні.

### Діагностика — ОБОВ'ЯЗКОВО перед фіксом
```bash
sed -n '380,400p' src/components/CaseDossier/index.jsx
sed -n '970,1000p' src/components/CaseDossier/index.jsx
sed -n '300,320p' src/components/Notebook/index.jsx
sed -n '335,355p' src/components/Notebook/index.jsx
```

Подивитись:
1. Як обчислюється pinnedIds — чи це `caseData.pinnedNoteIds` з PROPS, чи з локального state?
2. Як обчислюється isPinned — функція чи вираз?
3. Чи використовується isPinned саме в тому місці де рендериться кнопка?
4. Чи немає іншої копії кнопки 📌 з захардкодженим стилем?

### Можливі причини і рішення

**Причина А — closure/stale data:**
isPinned обчислюється на початку рендеру і не оновлюється коли pinnedNoteIds змінюється.

Рішення: НЕ використовувати функцію isPinned. Обчислювати inline в JSX:
```jsx
{(() => {
  const pinned = (caseData.pinnedNoteIds || []).includes(String(note.id));
  return (
    <button
      onClick={() => onPinNote(note.id, caseData.id)}
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 16, padding: '2px 4px',
        transform: pinned ? 'rotate(0deg)' : 'rotate(-45deg)',
        opacity: pinned ? 1 : 0.4,
        color: pinned ? '#e53935' : '#666',
        transition: 'transform 0.2s, opacity 0.2s, color 0.2s'
      }}
    >📌</button>
  );
})()}
```

**Причина Б — caseData не оновлюється в CaseDossier:**
CaseDossier копіює caseData в локальний state і працює з копією.

Діагностика:
```bash
grep -n "useState.*caseData\|setCaseData\|localCase\|setLocalCase" src/components/CaseDossier/index.jsx | head -10
```

Якщо є локальний state — видалити, використовувати props.caseData напряму.

**Причина В — pinNote в App.jsx не тригерить ре-рендер CaseDossier:**

Діагностика:
```bash
grep -n "pinNote\|onPinNote" src/App.jsx | head -15
grep -n "pinNote\|onPinNote" src/components/CaseDossier/index.jsx | head -10
```

Перевірити що pinNote з App.jsx передається як prop і що setCases створює НОВИЙ об'єкт (не мутує існуючий).

### Тест після фіксу
1. Відкрити досьє з нотатками
2. Натиснути 📌 на відкріпленій нотатці → має стати вертикальною + яскравою + червоною ОДРАЗУ
3. Натиснути 📌 на прикріпленій → має стати нахиленою + тьмяною + сірою ОДРАЗУ
4. Без F5! Зміна одразу при кліку.
5. Перевірити те саме в Записній книжці.

---

## БАГ 2 — Пам'ять агента між сесіями

### Проблема
Агент каже: "немає пам'яті між сесіями", "чистий аркуш".
Раніше працювало — зламалось після реструктуризації даних (TASK архітектура даних v3, 08.04.2026).

### Діагностика — ОБОВ'ЯЗКОВО
```bash
# Чи є agentHistory в даних:
grep -n "agentHistory" src/components/CaseDossier/index.jsx | head -10
grep -n "agentHistory" src/App.jsx | head -10

# Чи передається історія в API:
grep -B5 -A30 "fetch.*anthropic\|api\.anthropic" src/components/CaseDossier/index.jsx | head -50

# Чи є agent_history в нормалізації:
grep -n "agentHistory\|agent_history" src/App.jsx | head -10
```

### Що перевірити
1. Чи agentHistory ще існує в об'єкті справи, чи видалений при реструктуризації?
2. Чи agentMessages ініціалізується з caseData.agentHistory при відкритті досьє?
3. Чи після відповіді агента зберігається через updateCase?
4. Чи messages[] в API fetch включає збережену історію?

### Рішення — варіант А (швидкий, тимчасовий)

Повернути agentHistory в об'єкт справи поки не реалізований agent_history.json:

**Крок 1 — Ініціалізація:**
```jsx
const [agentMessages, setAgentMessages] = useState(() => {
  const history = caseData.agentHistory || [];
  return history.slice(-20);
});
```

**Крок 2 — Збереження після кожної відповіді:**
Після отримання відповіді від API:
```jsx
const newHistory = [
  ...agentMessages,
  { role: 'user', content: userMsg, ts: new Date().toISOString() },
  { role: 'assistant', content: reply, ts: new Date().toISOString() }
].slice(-50);

setAgentMessages(newHistory);
updateCase && updateCase(caseData.id, 'agentHistory', newHistory);
```

**Крок 3 — Передавати історію в API:**
Знайти fetch до api.anthropic.com. В body.messages ДОДАТИ збережену історію:

```jsx
// Підготувати історію:
const historyForAPI = agentMessages
  .filter(m => m.role === 'user' || m.role === 'assistant')
  .slice(-10)
  .map(m => ({ role: m.role, content: m.content }));

// API вимагає першим role: 'user'
const firstUserIdx = historyForAPI.findIndex(m => m.role === 'user');
const cleanHistory = firstUserIdx >= 0 ? historyForAPI.slice(firstUserIdx) : [];

// В fetch body:
messages: [
  ...cleanHistory,
  { role: 'user', content: userMessage }
]
```

**Крок 4 — normalizeCase:**
Переконатись що normalizeCase() в App.jsx НЕ видаляє agentHistory:
```bash
grep -A20 "normalizeCase\|function normalize" src/App.jsx | head -30
```

Якщо normalizeCase видаляє agentHistory або не включає його — ДОДАТИ:
```jsx
function normalizeCase(c) {
  return {
    ...c,
    agentHistory: c.agentHistory || [],
    // інші поля...
  };
}
```

### Тест після фіксу
1. Відкрити досьє справи Брановського
2. Написати агенту: "Мене звати Вадим, запам'ятай це"
3. Закрити досьє (← Реєстр)
4. Відкрити досьє знову
5. Написати: "Як мене звати?"
6. Агент має відповісти "Вадим"

---

## КРОК ФІНАЛЬНИЙ — видалити всі debug alert

```bash
grep -n "alert(" src/components/CaseDossier/index.jsx src/components/Notebook/index.jsx | head -10
```

Видалити ВСІ тимчасові alert з кнопки 📌 і з інших місць.

---

## ЗБІРКА І ДЕПЛОЙ

```bash
npm run build 2>&1 | tail -5
git add -A && git commit -m "fix: pin button isPinned logic, restore agent memory" && git push origin main
```

---

## КРИТЕРІЇ ЗАВЕРШЕННЯ

- [ ] 📌 ПРИКРІПЛЕНА = яскрава (opacity 1) + вертикальна (0deg) + червона (#e53935)
- [ ] 📌 ВІДКРІПЛЕНА = тьмяна (opacity 0.4) + нахилена (-45deg) + сіра (#666)
- [ ] Зміна ОДРАЗУ при кліку без F5
- [ ] Працює однаково в Досьє і Записній книжці
- [ ] Всі тимчасові alert видалені
- [ ] Агент пам'ятає розмову після закриття і повторного відкриття досьє
- [ ] Збережена історія передається в API messages[]
- [ ] normalizeCase НЕ видаляє agentHistory
- [ ] npm run build без помилок
- [ ] git push origin main виконано
