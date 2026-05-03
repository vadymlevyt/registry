# TASK — Діагностика + фікси агента дашборду
# Legal BMS | АБ Левицького | 2026-05-03

Прочитай CLAUDE.md і LESSONS.md перед початком.
Моделі — брати з CLAUDE.md. Працюємо в гілці main.

---

## ЕТАП 1 — ДІАГНОСТИКА (нічого не змінювати)

### 1А — Прочитай актуальний код агента

```bash
grep -n "ACTION_JSON\|navigate_calendar\|navigate_week\|add_note\|update_note\|delete_note\|add_hearing\|update_hearing\|delete_hearing\|buildDashboardContext\|handleDashboardAction\|parseAllActionJSON\|parseActionJSON\|selectedDay\|chatHistory" src/components/Dashboard/index.jsx | head -80
```

Потім прочитай повністю:
- `buildDashboardContext` — системний промпт
- `handleDashboardAction` — всі case
- Функцію парсингу ACTION_JSON
- Де і як передається `selectedDay` в контекст агента

### 1Б — Перевір кожен сценарій по матриці повноважень

Для кожного пункту нижче — знайди чи є реалізація в коді і зафіксуй статус: ✅ є / ⚠️ частково / ❌ немає

**Навігація:**
- [ ] navigate_calendar (перейти на конкретний рік+місяць)
- [ ] navigate_week (перейти на конкретну дату і показати тиждень)
- [ ] Пошук найбільш насиченого дня і перехід туди

**Засідання:**
- [ ] add_hearing — з caseId, date, time, duration
- [ ] update_hearing — змінити date, time, duration
- [ ] delete_hearing — видалити конкретне

**Нотатки:**
- [ ] add_note — з date (обов'язково), time (опційно), caseId (опційно), text
- [ ] update_note — змінити text, date, time, caseId
- [ ] delete_note — видалити конкретну
- [ ] delete_notes_batch — видалити кілька за раз

**Заборонено (має відхиляти):**
- [ ] Зміна дедлайнів — агент відповідає що не може
- [ ] Зміна статусу справи — агент відповідає що не може
- [ ] Видалення справи — агент відповідає що не може

**Логіка нотаток:**
- [ ] Якщо дата не вказана → використовує selectedDay автоматично
- [ ] Після створення → перепитує тільки те чого не вистачає (час? справа?)
- [ ] Якщо все вказано → тільки підтверджує, не перепитує

**Кілька ACTION_JSON:**
- [ ] Парсер знаходить всі JSON в одній відповіді
- [ ] Виконує їх послідовно

### 1В — Перевір navigate_calendar баг

Знайди чому агент генерує "Наступний місяць" замість конкретного ACTION_JSON.
Перевір:
1. Чи є в промпті чіткий приклад navigate_calendar з роком і місяцем
2. Чи обробляється navigate_calendar в handleDashboardAction
3. Чи викликає setCurMonth з правильними параметрами

### 1Г — Зафіксуй результат діагностики

Виведи в термінал список:
```
=== ДІАГНОСТИКА АГЕНТА ДАШБОРДУ ===
НАВІГАЦІЯ:
  navigate_calendar: [статус] [рядок]
  navigate_week: [статус] [рядок]
  ...
ЗАСІДАННЯ:
  add_hearing: [статус] [рядок]
  ...
НОТАТКИ:
  add_note: [статус] [рядок]
  selectedDay в контексті: [так/ні]
  логіка перепитування: [є/немає]
  ...
ЗАБОРОНЕНО:
  дедлайни відхиляє: [так/ні]
  ...
ПАРСЕР:
  кілька ACTION_JSON: [так/ні]
===
```

---

## ЕТАП 2 — ФІКСИ (на основі діагностики)

### 2А — Виправити navigate_calendar

В `handleDashboardAction` переконатись що є:
```js
case 'navigate_calendar':
  setCurMonth(new Date(action.year, action.month - 1, 1));
  setSelectedDay(`${action.year}-${String(action.month).padStart(2,'0')}-01`);
  return { success: true };

case 'navigate_week':
  setSelectedDay(action.date);
  setCalView('week');
  return { success: true };
```

В системний промпт додати чіткі приклади:
```
Перейти на місяць: ACTION_JSON: {"action":"navigate_calendar","year":2026,"month":10}
Перейти на дату і показати тиждень: ACTION_JSON: {"action":"navigate_week","date":"2026-05-07"}

Якщо просять перейти на конкретний день — виконай ОБИ команди:
ACTION_JSON: {"action":"navigate_calendar","year":2026,"month":5}
ACTION_JSON: {"action":"navigate_week","date":"2026-05-07"}

НІКОЛИ не відповідай просто текстом "Наступний місяць" — завжди генеруй ACTION_JSON.
```

```bash
npm run build && echo "navigate fix OK"
```

### 2Б — Логіка нотаток: дата з selectedDay + розумне перепитування

В системний промпт оновити правила для нотаток:

```
ПРАВИЛА ДЛЯ НОТАТОК:
1. Нотатка в дашборді ЗАВЖДИ має дату.
2. Якщо користувач не назвав дату — використовуй selectedDay автоматично. Не питай дату.
3. Після створення нотатки — перепитуй ТІЛЬКИ те чого не вистачає:
   - Якщо не було часу → запитай: "Додати час?"
   - Якщо не було справи → запитай: "Прив'язати до справи?"
   - Якщо обидва відсутні → запитай обидва в одному повідомленні
   - Якщо все є → просто підтвердь, не перепитуй
4. Якщо користувач вказав справу — знайди її в списку справ за назвою і використай caseId.
5. selectedDay зараз: {selectedDay} — це дата яку бачить користувач в Day Panel.

Приклад повної команди:
"Нотатка по Брановському з 13:00 до 14:00: уточнити секретаря суду"
→ ACTION_JSON: {"action":"add_note","date":"{selectedDay}","time":"13:00","duration":60,"caseId":"[id Брановського]","text":"уточнити секретаря суду"}
→ Відповідь: "✅ Нотатку додано на {selectedDay} о 13:00 по справі Брановський"

Приклад неповної команди:
"Зроби нотатку"
→ ACTION_JSON: {"action":"add_note","date":"{selectedDay}","text":"..."}
→ Відповідь: "✅ Нотатку додано на {selectedDay}. Додати час або прив'язати до справи?"
```

### 2В — Загальний принцип: робити що можна, перепитувати решту

В системний промпт додати:
```
ЗАГАЛЬНИЙ ПРИНЦИП РОБОТИ:
Якщо команда неповна — виконай те що можеш з наявних даних, 
потім в одному повідомленні запитай що бракує.
Не блокуй виконання через відсутність опційних параметрів.
Обов'язкові параметри (без яких дія неможлива) — питай одразу.
Опційні параметри (час, справа для нотатки) — виконай без них, потім запитай.
```

### 2Г — Перевірити і виправити заборонені дії

В промпт додати явні заборони якщо їх немає:
```
ЗАБОРОНЕНО — відповідай що не можеш:
- Змінювати дедлайни: "Дедлайни змінюються через Досьє або Quick Input"
- Змінювати статус справи: "Статус справи змінюється через головний агент або картку справи"  
- Видаляти справи: "Видалення справи можливе тільки через реєстр справ"
```

Перевірити handleDashboardAction — якщо є case 'update_deadline' або подібні → видалити.

```bash
npm run build
```

### 2Д — Виправити парсер якщо не парсить кілька ACTION_JSON

Якщо діагностика показала що парсер знаходить тільки перший JSON — замінити на:

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
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end !== -1) {
      try { actions.push(JSON.parse(text.slice(start, end + 1))); } catch(e) {}
      searchFrom = end + 1;
    } else break;
  }
  return actions;
}
```

І після отримання відповіді від API:
```js
const actions = parseAllActionJSON(responseText);
for (const action of actions) {
  await handleDashboardAction(action);
}
```

```bash
npm run build
```

---

## ФІНАЛЬНА ПЕРЕВІРКА

```bash
npm run build
git add -A
git commit -m "fix: agent navigation, note logic with selectedDay, smart re-asking, batch JSON parser"
git push origin main
```

Перевірити в браузері:
1. "Перейди на жовтень" → календар перемикається на жовтень
2. "Знайди найбільш насичений день по Брановському і перейди туди" → правильна дата і місяць
3. "Зроби нотатку" → створює на selectedDay, питає час і справу
4. "Нотатка по Брановському з 13:00: текст" → створює без перепитувань
5. "Видали дедлайн" → відповідає що не може
6. "Видали всі нотатки по Брановському за 7 травня" → видаляє всі
