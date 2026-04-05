# ПОТОЧНЕ ЗАВДАННЯ

Прочитай CLAUDE.md перед початком.
Працюємо в гілці main. Після змін — npm run build, потім git push.

---

## Завдання — Повноцінний агент в Dashboard

### Контекст архітектури

Агент має три шари знань (зараз реалізуємо Шар 1, закладаємо структуру для 2 і 3):

```
// ШАР 1 (зараз): React стан — всі справи, дати, події
// ШАР 2 (майбутнє): Досьє — PositionPack, матеріали справи
// ШАР 3 (майбутнє): Google Drive — реальні документи справи
```

---

### Шар 1 — Системний промпт агента

Функція `buildDashboardContext(cases, calendarEvents)` формує контекст:

```js
function buildDashboardContext(cases, calendarEvents) {
  const today = new Date().toISOString().slice(0, 10);
  
  // Стиснений формат — кожна справа в одному рядку
  const casesText = cases.map(c => {
    const parts = [c.name];
    if (c.court) parts.push(c.court);
    if (c.hearing_date) parts.push(`засідання ${c.hearing_date}${c.hearing_time ? ' ' + c.hearing_time : ''}`);
    if (c.deadline) parts.push(`дедлайн ${c.deadline}${c.deadline_type ? ' (' + c.deadline_type + ')' : ''}`);
    if (c.status) parts.push(c.status);
    if (c.next_action) parts.push(`→ ${c.next_action}`);
    return parts.join(' | ');
  }).join('\n');

  // Кастомні події з localStorage
  const eventsText = calendarEvents.length
    ? calendarEvents.map(e => `${e.date} ${e.time || ''} ${e.title} (${e.type})`).join('\n')
    : 'немає';

  // Накладки
  const conflicts = findConflicts(cases, calendarEvents);
  const conflictsText = conflicts.length
    ? conflicts.map(c => `⚠️ ${c.date}: ${c.items.join(' і ')}`).join('\n')
    : 'немає';

  return `Ти — календарний асистент АБ Левицького.
Сьогодні: ${today}.
Твоя роль: відповідати на питання про розклад, справи, дедлайни. Керувати календарем (навігація, пошук подій). Змінювати дати засідань і дедлайнів якщо адвокат просить.

ВАЖЛИВО: Якщо адвокат просить змінити дату засідання — поверни JSON з командою:
{"action":"update_hearing","caseId":"...","hearing_date":"YYYY-MM-DD","hearing_time":"HH:MM"}

Якщо просить перегорнути календар:
{"action":"navigate_calendar","year":2026,"month":3}

Якщо просить показати тиждень:
{"action":"navigate_week","date":"YYYY-MM-DD"}

Інакше — відповідай текстом українською, коротко і по суті.

// ШАР 1 — Поточні дані системи:
СПРАВИ (${cases.length}):
${casesText}

ДОДАТКОВІ ПОДІЇ:
${eventsText}

НАКЛАДКИ:
${conflictsText}

// ШАР 2 — Досьє (не реалізовано, підключити коли буде модуль Досьє)
// ШАР 3 — Google Drive документи (не реалізовано, підключити через Drive API)`;
}
```

---

### Функція пошуку накладок

```js
function findConflicts(cases, calendarEvents) {
  const byDate = {};
  
  cases.forEach(c => {
    if (c.hearing_date && c.hearing_time) {
      if (!byDate[c.hearing_date]) byDate[c.hearing_date] = [];
      byDate[c.hearing_date].push({ name: c.name, time: c.hearing_time, id: c.id });
    }
  });
  
  calendarEvents.forEach(e => {
    if (e.date && e.time && e.type === 'hearing') {
      if (!byDate[e.date]) byDate[e.date] = [];
      byDate[e.date].push({ name: e.title, time: e.time });
    }
  });

  return Object.entries(byDate)
    .filter(([_, items]) => items.length > 1)
    .map(([date, items]) => ({ date, items: items.map(i => `${i.name} ${i.time}`) }));
}
```

---

### Обробка відповіді агента

Після отримання відповіді від Claude API — перевірити чи є JSON команда:

```js
async function handleAgentResponse(text, cases, setCases, setCurMonth, setSelectedDay) {
  // Спробувати знайти JSON в відповіді
  const jsonMatch = text.match(/\{[\s\S]*"action"[\s\S]*\}/);
  
  if (jsonMatch) {
    try {
      const cmd = JSON.parse(jsonMatch[0]);
      
      if (cmd.action === 'update_hearing') {
        // Оновити картку справи
        setCases(prev => prev.map(c =>
          c.id === cmd.caseId
            ? { ...c, hearing_date: cmd.hearing_date, hearing_time: cmd.hearing_time || c.hearing_time }
            : c
        ));
        // Зберегти в Google Drive (викликати driveService.save якщо доступний)
        return `✅ Дату засідання оновлено: ${cmd.hearing_date}${cmd.hearing_time ? ' о ' + cmd.hearing_time : ''}`;
      }
      
      if (cmd.action === 'navigate_calendar') {
        setCurMonth(new Date(cmd.year, cmd.month - 1, 1));
        return `📅 Календар перегорнуто на ${cmd.year}-${cmd.month}`;
      }
      
      if (cmd.action === 'navigate_week') {
        setSelectedDay(cmd.date);
        // Також перемкнути на тижневий вигляд
        return `📅 Показую тиждень з ${cmd.date}`;
      }
      
    } catch (e) {
      // JSON не розпарсився — показати як текст
    }
  }
  
  return text; // Звичайна текстова відповідь
}
```

---

### Голосовий ввід (Web Speech API)

Додати кнопку мікрофону поряд з полем вводу агента.
Скопіювати механізм з Quick Input (він вже реалізований там).

```js
function startVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setAgentResponse('❌ Голосовий ввід не підтримується в цьому браузері');
    return;
  }
  
  const recognition = new SpeechRecognition();
  recognition.lang = 'uk-UA';
  recognition.continuous = false;
  recognition.interimResults = false;
  
  recognition.onresult = (e) => {
    const text = e.results[0][0].transcript;
    setAgentInput(text);
    // Автоматично надіслати після розпізнавання
    handleAgentSend(text);
  };
  
  recognition.onerror = () => setAgentResponse('❌ Помилка розпізнавання голосу');
  recognition.start();
  setIsListening(true);
}
```

Стан: `const [isListening, setIsListening] = useState(false)`
Кнопка мікрофону: 🎤 (звичайний стан) / 🔴 (слухає)

---

### Виправлення "Failed to fetch"

Проблема: API ключ не передається в Dashboard компонент.

Рішення: читати з localStorage напряму в компоненті:
```js
const apiKey = localStorage.getItem('claude_api_key');
```

Модель агента: `claude-haiku-4-5-20251001` (швидка, дешева для коротких відповідей)

Якщо ключа немає → показати: "⚙️ Налаштуйте API ключ в Quick Input"

---

### UI агента

```
[Запитай про розклад, справи...    ] [🎤] [→]
[Відповідь агента тут              ]
```

- Поле вводу: flex:1, placeholder українською
- Кнопка мікрофону: 🎤 / 🔴 під час запису  
- Кнопка надіслати: →
- Відповідь: блок нижче, синій фон rgba(79,124,255,0.08), 11px
- Максимум 3 рядки відповіді, решта за скролом

---

### Накладки в панелі статистики

Додати в блок статистики під календарем (після рядка Активних/Призупинених):

```jsx
{conflicts.length > 0 && (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 8px',
    background: 'rgba(231,76,60,0.1)',
    border: '1px solid rgba(231,76,60,0.3)',
    borderRadius: 6,
    fontSize: 11,
    color: '#e74c3c',
    marginTop: 4
  }}>
    ⚠️ Накладки: {conflicts.length} — {conflicts.map(c => c.date).join(', ')}
  </div>
)}
```

`conflicts` = результат `findConflicts(cases, calendarEvents)` — рахується один раз при рендері.

---

## Після виконання

npm run build
git add -A
git commit -m "feat: dashboard agent — full context + voice + calendar commands + conflict alerts"
git push origin main
