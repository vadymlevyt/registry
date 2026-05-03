# TASK — Фікс агента + дорога до/після засідання
# Legal BMS | АБ Левицького | 2026-05-03

Прочитай CLAUDE.md і LESSONS.md перед початком.
Моделі — брати з CLAUDE.md. Працюємо в гілці main.

---

## ПІДХІД

Перед змінами — прочитай існуючий код.
Після кожного блоку — `npm run build`.
Не чіпай те що працює.

---

## БЛОК 1 — Фікс агента: одна відповідь замість подвійної

### Проблема
Агент відповідає двічі: спочатку "✅ Додано" (до виконання дії), потім отримує помилку або SYSTEM повідомлення і відповідає ще раз. Це відбувається тому що відповідь генерується до результату дії.

### Діагностика
Знайди в `src/components/Dashboard/index.jsx`:
- `handleAgentSend` або аналогічну функцію
- Де генерується відповідь агента (fetch до API)
- Де виконуються ACTION_JSON
- Де додається `pendingSystemNote` або SYSTEM повідомлення

### Фікс: спочатку дії, потім відповідь

Правильний порядок в `handleAgentSend`:

```
1. Відправити повідомлення користувача в API → отримати відповідь агента
2. Розпарсити ACTION_JSON з відповіді
3. Виконати всі дії → зібрати результати
4. Якщо є помилки → додати їх в chatHistory як SYSTEM повідомлення
5. Якщо є помилки → відправити ще один запит до API з результатами
   щоб агент сформував фінальну відповідь з урахуванням помилок
6. Показати користувачу тільки фінальну відповідь
```

Спрощений варіант якщо крок 5 складний:
```js
// Після виконання дій:
const errors = actionResults.filter(r => !r.ok);
const successes = actionResults.filter(r => r.ok);

// Формувати одну фінальну відповідь:
let finalText = '';
if (errors.length > 0 && successes.length === 0) {
  // Тільки помилки — показати помилку
  finalText = errors.map(e => `❌ ${e.error}`).join('\n');
} else if (errors.length > 0 && successes.length > 0) {
  // Частково виконано
  finalText = [
    ...successes.map(s => `✅ ${s.message}`),
    ...errors.map(e => `❌ ${e.error}`)
  ].join('\n');
} else {
  // Все виконано — показати текст агента
  finalText = agentResponseText;
}

// Показати тільки finalText, не проміжні повідомлення
```

### Об'єднати дублюючі повідомлення про успіх

Якщо агент генерує два схожих повідомлення при успіху ("Засідання додано" і "Нове засідання у справі Янченко") — залишити тільки одне. Перевірити де формується друге і прибрати дублювання.

```bash
npm run build
```

---

## БЛОК 2 — Дорога до/після засідання

### Колір
Дорога — пурпурний: `#9b59b6`, фон `rgba(155,89,182,0.15)`
Рожевий `#e91e8c` — зарезервований, не використовувати зараз.

### Логіка розподілу часу

При збереженні засідання з вказаним `travelMinutes`:
- Ділити порівно: `halfTravel = Math.round(travelMinutes / 2)`
- Блок "Дорога туди": від `(startTime - halfTravel хв)` до `startTime`
- Блок "Дорога назад": від `endTime` до `(endTime + halfTravel хв)`

```js
function calcTravelBlocks(startTime, endTime, travelMinutes) {
  if (!travelMinutes || travelMinutes <= 0) return null;
  const toMin = t => { const [h,m] = t.split(':').map(Number); return h*60+m; };
  const fromMin = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;

  const half = Math.round(travelMinutes / 2);
  const startMin = toMin(startTime);
  const endMin = endTime ? toMin(endTime) : startMin + 120;

  return {
    before: {
      time: fromMin(Math.max(0, startMin - half)),
      duration: half,
      label: '🚗 Дорога туди'
    },
    after: {
      time: fromMin(endMin),
      duration: half,
      label: '🚗 Дорога назад'
    }
  };
}
```

### Збереження в ACTIONS

В `add_note` для travel — зберігати з `category: 'travel'` і полями `travelFor: hearingId`.

При збереженні засідання з travelMinutes — додатково викликати `add_note` двічі:
```js
// В saveEvent після add_hearing:
if (travelMinutes && travelMinutes > 0) {
  const travel = calcTravelBlocks(modalStartTime, modalEndTime, travelMinutes);
  if (travel) {
    onExecuteAction('dashboard_agent', 'add_note', {
      text: travel.before.label,
      date: selectedDay,
      time: travel.before.time,
      duration: travel.before.duration,
      caseId: modalCaseId,
      category: 'travel'
    });
    onExecuteAction('dashboard_agent', 'add_note', {
      text: travel.after.label,
      date: selectedDay,
      time: travel.after.time,
      duration: travel.after.duration,
      caseId: modalCaseId,
      category: 'travel'
    });
  }
}
```

### Відображення в слотах

Знайди `getEventStyle` або аналогічну функцію кольорів.
Додати `travel`:
```js
travel: {
  bg: 'rgba(155,89,182,0.15)',
  border: '#9b59b6',
  text: '#9b59b6',
  label: '#9b59b6'
}
```

Блок дороги в слоті:
- Пурпурний фон і рамка
- Іконка 🚗
- Текст "Дорога туди" або "Дорога назад"
- Висота пропорційна тривалості (як звичайна нотатка)
- При кліку — попап тільки для читання (як дедлайн, без редагування)

### Кнопка в модалці

Знайди блок "🚗 Додати час на дорогу" в модалці засідання.
Поточна логіка — один блок до засідання. Змінити на нову логіку — два блоки (до і після).

Підпис кнопки змінити: "🚗 Додати час на дорогу (ділиться порівну до і після)"

При введенні хвилин — показати preview:
```jsx
{travelMinutes > 0 && modalStartTime && (
  <div style={{ fontSize:10, color:'#9b59b6', marginTop:4 }}>
    Дорога туди: {fromMin(toMin(modalStartTime) - Math.round(travelMinutes/2))}–{modalStartTime}
    {' · '}
    Дорога назад: {modalEndTime}–{fromMin(toMin(modalEndTime||modalStartTime) + Math.round(travelMinutes/2))}
  </div>
)}
```

```bash
npm run build
```

---

## ФІНАЛЬНА ПЕРЕВІРКА

```bash
npm run build
git add -A
git commit -m "fix: agent single response, travel blocks before/after hearing in purple"
git push origin main
```

Перевірити:
1. "Додай засідання без часу" → одне повідомлення ❌ з поясненням
2. "Додай засідання о 10:00" → одне повідомлення ✅
3. При успіху — не дублює повідомлення
4. Засідання з дорогою 60 хв → два пурпурних блоки по 30 хв до і після
5. Клік на блок дороги → попап тільки для читання
6. Preview в модалці показує час дороги до і після
