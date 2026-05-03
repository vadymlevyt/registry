# TASK — Діагностика і фікс агента: засідання, валідація, chatHistory
# Legal BMS | АБ Левицького | 2026-05-03

Прочитай CLAUDE.md і LESSONS.md перед початком.
Моделі — брати з CLAUDE.md. Працюємо в гілці main.

---

## ЕТАП 1 — ДІАГНОСТИКА (нічого не змінювати)

### 1А — Перевір валідацію add_hearing в ACTIONS

```bash
grep -n "add_hearing\|time.*required\|validation\|success.*false\|error.*time" src/App.jsx | head -30
```

Знайди функцію `add_hearing` в ACTIONS і відповідь на питання:
1. Чи є перевірка що `time` обов'язковий?
2. Що повертає функція якщо `time` відсутній — `{ success: false, error: '...' }` чи нічого?
3. Чи повертає `add_hearing` взагалі якийсь результат при успіху?

### 1Б — Перевір handleDashboardAction

```bash
grep -n "handleDashboardAction\|onExecuteAction\|add_hearing\|result\|success\|error" src/components/Dashboard/index.jsx | head -40
```

Знайди `handleDashboardAction` і відповідь на питання:
1. Чи перевіряється результат `onExecuteAction` після виклику?
2. Чи повертається помилка назад в chatHistory якщо дія не виконана?
3. Агент отримує підтвердження що дія виконана чи просто генерує текст "✅ Додано"?

### 1В — Перевір chatHistory

```bash
grep -n "chatHistory\|messages.*newHistory\|newHistory\|setChatHistory" src/components/Dashboard/index.jsx | head -20
```

Знайди де формується запит до API і відповідь на питання:
1. Чи передається `chatHistory` в `messages` при кожному запиті?
2. Скільки повідомлень зберігається (обмеження)?
3. Чи додається відповідь агента в `chatHistory` після отримання?

### 1Г — Перевір що відбувається коли add_hearing не вдається

Знайди повний ланцюжок:
```
Агент генерує ACTION_JSON → parseAllActionJSON → handleDashboardAction → 
onExecuteAction → ACTIONS.add_hearing → повертає результат → ???
```

Чи є зворотній зв'язок від результату до агента? Якщо ні — це і є корінь проблеми.

### 1Д — Виведи діагностичний звіт в термінал

```
=== ДІАГНОСТИКА АГЕНТА: ЗАСІДАННЯ ===
add_hearing валідація time: [є/немає]
add_hearing повертає помилку: [так/ні - що саме повертає]
handleDashboardAction перевіряє result: [так/ні]
Помилка передається в chatHistory: [так/ні]
chatHistory передається в API: [так/ні]
Кількість повідомлень в history: [N]
Відповідь агента в history: [так/ні]
===
```

---

## ЕТАП 2 — ФІКСИ (на основі діагностики)

### 2А — Виправити зворотній зв'язок: результат дії → агент

Це головний фікс. Агент має знати чи виконалась дія.

В `handleAgentSend` після парсингу і виконання ACTION_JSON:

```js
// Виконати всі дії і зібрати результати
const actionResults = [];
for (const action of actions) {
  const result = await handleDashboardAction(action);
  actionResults.push({ action: action.action, result });
}

// Якщо є помилки — додати їх в chatHistory як system повідомлення
const errors = actionResults.filter(r => r.result?.success === false);
if (errors.length > 0) {
  const errorMsg = errors.map(e => 
    `SYSTEM: Дія "${e.action}" не виконана. Причина: ${e.result?.error || 'невідома помилка'}`
  ).join('\n');
  
  // Додати в history щоб агент бачив помилку в наступному повідомленні
  setChatHistory(prev => [...prev,
    { role: 'user', content: errorMsg },
    { role: 'assistant', content: `Не вдалося виконати: ${errors.map(e => e.result?.error).join(', ')}` }
  ]);
}
```

### 2Б — Переконатись що add_hearing повертає помилку

В ACTIONS (App.jsx) знайти `add_hearing`.
Якщо валідація є але не повертає помилку — виправити:

```js
add_hearing: ({ caseId, date, time, duration }) => {
  if (!time || !time.trim()) {
    return { success: false, error: 'Засідання без часу неможливе. Вкажіть час.' };
  }
  if (!date) {
    return { success: false, error: 'Вкажіть дату засідання.' };
  }
  if (!caseId) {
    return { success: false, error: 'Вкажіть справу для засідання.' };
  }
  // існуюча логіка збереження...
  return { success: true };
},
```

Аналогічно перевірити `update_hearing` — чи повертає помилку при відсутності часу.

### 2В — handleDashboardAction повертає результат

Переконатись що `handleDashboardAction` повертає результат `onExecuteAction`:

```js
async function handleDashboardAction(action) {
  switch(action.action) {
    case 'add_hearing':
      return await onExecuteAction('dashboard_agent', 'add_hearing', {
        caseId: action.caseId,
        date: action.date,
        time: action.time || null,
        duration: action.duration || 120
      });
    // інші case...
    default:
      return { success: false, error: `Невідома дія: ${action.action}` };
  }
}
```

### 2Г — Перевірити chatHistory

Якщо діагностика показала що chatHistory не передається або не зберігається — виправити.

Переконатись що при кожному запиті до API:
```js
const newHistory = [...chatHistory, { role: 'user', content: userMessage }];
// ...в API запиті:
messages: newHistory
// після відповіді:
setChatHistory([...newHistory, { role: 'assistant', content: responseText }]);
```

Максимум 10 пар (20 повідомлень) — обрізати найстаріші якщо більше.

---

## ПІСЛЯ ВИКОНАННЯ

```bash
npm run build
git add -A
git commit -m "fix: add_hearing validation feedback, action result to agent, chatHistory fix"
git push origin main
```

Перевірити:
1. "Додай засідання Янченко на 5 травня" (без часу) → агент відповідає що потрібен час
2. "Додай засідання Янченко на 5 травня о 10:00" → засідання реально з'являється в календарі
3. "Перенеси засідання Брановський на 9 травня о 11:30" → змінює і дату і час одночасно
4. Наступне повідомлення після помилки → агент пам'ятає контекст
