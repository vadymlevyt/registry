# DIAGNOSTIC_DASHBOARD.md — діагностика дашборду v2

Файли: `src/components/Dashboard/index.jsx` (1527 рядків), `src/App.jsx` (4066 рядків).
Дата: 2026-05-02. Без правок коду — тільки звіт.

---

## 1. Застарілі поля

### У `src/components/Dashboard/index.jsx`
Сам код Dashboard **уже не читає** `c.hearing_date`, `c.hearing_time`, `c.deadline`, `c.deadline_type`. Перевірено: жодного звертання до `c.hearing_*` чи `c.deadline*` немає. Хелпер `_getNextHearing` (рядок 251) та `getAllEvents` (рядок 481) ходять виключно по `c.hearings[]` і `c.deadlines[]`. ✅

Однак у dashboard-агенті `hearing_date` / `hearing_time` лишаються як **імена параметрів ACTION_JSON** (це нормально, це контракт між моделлю і UI):
- рядок 313, 316, 319 — описи ACTION_JSON у системному промпті
- рядок 330–331 — формат YYYY-MM-DD / HH:MM
- рядки 672, 676–677, 685–689, 692, 700–701 — мапінг `action.hearing_date → params.date` всередині `handleDashboardAction`

→ заміна не потрібна, це контрактні ключі моделі, а не поля справи.

### Реальні застарілі сліди — у `src/App.jsx` (поза дашбордом)
Це не входить у скоуп таску, але впливає на дані які отримує Dashboard:
- рядок 80–118 — `INITIAL_CASES` усе ще містять `deadline:d(N), deadline_type:'…'` як плоскі поля поряд з `hearings:mkHearing(...)`. Тобто стартові справи ще не повністю мігровані на `deadlines[]`.
- рядок 191 — коментар `// Сумісний доступ до дати дедлайну (для поступової міграції з c.deadline)`
- рядок 363 — `map[dl.date]` працює, але в інших місцях App.jsx, ймовірно, є fallback читання `c.deadline`.
- HAIKU/SONNET промпти у App.jsx (рядки 472–528, 522, 528, 661–668) досі містять `deadline_date`, `deadline_type`, `hearing_date`, `hearing_time` — це OK як ACTION_JSON-схема, але в HAIKU_SYSTEM_PROMPT все ще згадується `update_case_date` (легасі-alias) — рядок 526.

→ Висновок по розділу 1: **усередині Dashboard легасі-полів немає**. Залишки в `INITIAL_CASES` і промптах App.jsx — поза скоупом діагностики дашборду.

---

## 2. getAllEvents()

`Dashboard/index.jsx:481-511`

```js
function getAllEvents() {
  const events = [];
  cases.forEach(c => {
    (c.hearings || []).filter(h => h.status === 'scheduled').forEach(h => {
      events.push({ id:"h_"+c.id+"_"+h.id, type:"hearing", title:c.name, date:h.date, time:h.time||null, court:h.court||c.court||null, duration:120, caseId:c.id, hearingId:h.id });
    });
    (c.deadlines || []).forEach(dl => {
      events.push({ id:"d_"+c.id+"_"+dl.id, type:"deadline", title:c.name, date:dl.date, time:null, label:dl.name||"дедлайн", caseId:c.id, deadlineId:dl.id });
    });
  });
  return [...events, ...calendarEvents];
}
```

**Що робить:**
1. З `cases[].hearings[]` — тільки `status === 'scheduled'` (правильно, completed не показуємо в календарі)
2. З `cases[].deadlines[]` — усі дедлайни (тут немає фільтра по `date >= today`, але це норма для календаря — минулі видно)
3. З `calendarEvents` — усе як є

**Правильно агрегує?** Майже:
- Засідання й дедлайни читаються з `hearings[] / deadlines[]` ✓
- Третє джерело (нотатки з датою) приходить через `calendarEvents`, бо `rebuildCalendarView` в App.jsx наповнює `calendarEvents` ВИКЛЮЧНО нотатками-з-датою (App.jsx:3223-3242). Тобто архітектурно дашборд отримує нотатки опосередковано — не з prop `notes`, а через перетворення в App.jsx. **Працює, але тендітно** — варто передати `notes` напряму як prop і збирати ноти тут (бо так заявлено в спеці таску).
- Дублювання немає **поки що працює rebuildCalendarView**. Якщо хтось випадково додасть в `calendarEvents` ще й hearing/deadline (як це робить модалка через `onAddEvent`, див. розділ 4) — отримаємо дубль і подвійні слоти.

**Тип "note" немає кольору в SlotsColumn.colorsFor** (рядки 45–51). Фолбек — синій. Жовтий, якого вимагає спека для нотаток, не реалізований у слотах.

---

## 3. Накладки

### Місця де рахуються
- `findConflicts(cases, calendarEvents)` — `Dashboard/index.jsx:257-275`
- `checkConflicts(dateStr)` — `Dashboard/index.jsx:517-521`
- Місячний грид — `conflict = hearings.length > 1` рядок 1008
- Day Panel subtitle — рядки 654, 1194 через `conflicts.length`

### Логіка та проблеми

**Проблема А — `findConflicts` бере ТІЛЬКИ перше засідання справи**
рядок 259-264: `const nh = _getNextHearing(c); if (nh && nh.time) byDate[nh.date].push(...)`
Якщо у справи є дві `scheduled` hearings в один день — друге **взагалі не потрапляє** в byDate. Накладка двох засідань однієї справи в один день не побачиться.

**Проблема Б — `findConflicts` ще читає `calendarEvents` як hearings**
рядки 266-271: фолбек на `calendarEvents.filter(e.type === "hearing")`. Зараз `rebuildCalendarView` сюди нічого з типом hearing не кладе → блок мертвий. Але якщо раптом модалка через `onAddEvent` створить hearing — він зайде сюди і подвоїться (бо є і в `cases[].hearings[]`, і в `calendarEvents`).

**Проблема В — час перетину НЕ перевіряється**
Спека: «накладка = два hearings зі статусом scheduled де часи перетинаються».
`findConflicts`: `items.length > 1` (рядок 273) — будь-які два hearings в один день, навіть 09:00 і 17:00 → накладка.
`checkConflicts`: те саме — `hearings.length < 2` (рядок 519). Жоден з них не перевіряє інтервали `[time, time+duration]`.

**Проблема Г — місячний грид теж рахує по `length > 1`**
рядок 1008: `const conflict = hearings.length > 1` — крапка ⚠️ ставиться навіть коли два суди у різний час.

### Відображення
- Місячна сітка: рамка червона + ⚠️ (рядки 1013, 1051) — є
- Статистика під календарем: `allConflicts.length > 0` показує плашку (рядки 1141-1152) — є
- Day Panel subtitle: «накладка!» (рядок 654) — є
- SlotsColumn: `conflictIds = new Set(conflicts.map(c => c.id))` (рядок 39) і червона рамка (рядок 46) — але `findConflicts` повертає `items` без `id`, а map на рядку 39 робить `c.id` — отже `conflictIds` зазвичай порожній. **Червона рамка в слотах фактично не спрацьовує** для конфліктів між справами. Вона працює лише для Day Panel, де `checkConflicts` повертає сам `dayEvents` об'єкт із полем `id` — так, для одного дня в Day Panel працює.

Підсумок: визначення накладки **не відповідає спеці** (по часу не звіряється), а між-справний підрахунок ще й пропускає випадки з кількома hearings в одній справі.

---

## 4. Модалка

`Dashboard/index.jsx:1370-1524`. Один режим. Перемикач type: 3 кнопки — `hearing | deadline | event` (рядки 1394-1410).

**НЕМАЄ вибору справи.** Жодного селекта/автокомпліту по `cases[].name`.
Усе зберігається через `onAddEvent` → `addCalendarEvent` (App.jsx:3323-3329) → `setCalendarEvents([...prev, event])` + localStorage.

**Критична проблема — збережене стирається при першій же зміні `cases` або `notes`.**
`rebuildCalendarView` (App.jsx:3223-3242) при кожному виклику робить `setCalendarEvents(events)` де `events` — лише ноти-з-датою. Все, що додала модалка типу `hearing`/`deadline`/`event`, зноситься на наступному рендері справ або нотаток. localStorage теж не рятує — `rebuildCalendarView` не пише туди.

Тобто **модалка зараз не зберігає засідання у справу**. Натомість потрібно: при `modalType === "hearing"` після обрання справи викликати `onExecuteAction('dashboard_agent','add_hearing', { caseId, date, time, duration })`. Аналогічно для нотатки — `add_note`. Поле "event" взагалі не має місця в новій моделі (засідання/дедлайн/нотатка — все, окремих подій немає).

**Спека вимагає двох режимів модалки:**
- Засідання (з вибором справи)
- Нотатка (з прив'язкою до справи)

→ Зараз: один режим, без вибору справи, з мертвими типами `deadline`/`event`, зберігання через невідповідний канал.

---

## 5. Агент

`Dashboard/index.jsx:775-829`.

| Пункт | Стан |
|---|---|
| API ключ із localStorage | ✅ `localStorage.getItem("claude_api_key")` рядок 788 |
| chatHistory передається в API | ✅ `messages: newHistory` рядок 809, `slice(-10)` обрізає вікно — рядок 781 |
| Перевірка first user (як в LESSONS) | ❌ Немає — теоретично перше повідомлення в trimmed може бути assistant. Краш не буде (бо userMsg додається в кінець), але якщо API строго вимагає першим user — відмовить. |
| Голос Web Speech API | ✅ рядки 838-859, lang=`uk-UA` |
| Системний промпт згадує `hearings[]` | ✅ рядок 305 «Засідання існує ВИКЛЮЧНО всередині справи (hearings[])», список засідань будується через `_getNextHearing` |
| Системний промпт згадує `deadlines[]` | ✅ рядок 306, але контекст показує тільки **найближчий** дедлайн (рядок 284) |
| Формат команд | ACTION_JSON depth-counter парсер (рядки 750-773) ✅ — як прописано в CLAUDE.md |
| Передає через `onExecuteAction` | ✅ для hearings (`update_hearing/add_hearing/delete_hearing`) рядки 672-712 |
| Обмеження на дедлайни | ❌ Є гілка `case "update_deadline"` (рядки 717-726) яка робить `onUpdateCase(c.id, "deadlines", [...c.deadlines, newDl])` — **завжди ДОДАЄ новий**, не оновлює. Спека каже: дедлайни — read-only для дашборд-агента. PERMISSIONS у App.jsx (рядки 3784-3788) це підтверджує — `dashboard_agent` НЕ має `add/update/delete_deadline`. Тобто Dashboard **обходить** PERMISSIONS, ходячи через `onUpdateCase` напряму. |
| Модель | ❌ `claude-haiku-4-5-20251001` (рядок 806). За CLAUDE.md: чат — Sonnet, Haiku — лише аналіз документів. Це порушення критичного архітектурного правила. |
| `sonnetPrompt` / `buildSystemContext` props | ❌ Передаються в Dashboard (рядки 3893-3894), але не використовуються. Промпт будує локальна `buildDashboardContext(cases, calendarEvents)` (рядок 277). |
| `navigate_calendar` / `navigate_week` | Локально оброблені (рядки 727-744). Описано в системному промпті (рядки 325-326). Працюють. |
| `add_note` через ACTION_JSON | ❌ Опис є в промпті (рядок 322), але `handleDashboardAction` не має `case "add_note"`. Агент скаже «додаю», нічого не станеться. |

---

## 6. Props від App.jsx

`App.jsx:3886-3896`:
```jsx
<Dashboard
  cases={cases}
  calendarEvents={calendarEvents}
  onUpdateCase={updateCase}
  onAddEvent={addCalendarEvent}
  onUpdateEvent={updateCalendarEvent}
  onDeleteEvent={deleteCalendarEvent}
  sonnetPrompt={SONNET_CHAT_PROMPT}
  buildSystemContext={buildSystemContext}
  onExecuteAction={executeAction}
/>
```

**Що відсутнє за спекою:**
- `notes` — НЕ передається. Дашборд бачить нотатки лише через `calendarEvents` (після перетворення в App.jsx). Спека: «Dashboard отримує props: cases, notes, onExecuteAction».

**Зайве:**
- `onAddEvent / onUpdateEvent / onDeleteEvent` — це `calendarEvents` CRUD. У новій моделі дашборд не повинен ходити в `calendarEvents` напряму, бо це джерело wiped. Має бути `onExecuteAction` для всього.
- `onUpdateCase` — потрібен лише як милиця для update_deadline (порушує PERMISSIONS).
- `sonnetPrompt`, `buildSystemContext` — приходять, не використовуються.

---

## 7. rebuildCalendarView

`App.jsx:3220-3245`.

```js
const rebuildCalendarView = () => {
  const events = [];
  for (const cat of Object.keys(notes)) (notes[cat] || []).forEach(n => allNotes.push(n));
  allNotes.forEach(n => { if (n.date) events.push({ type:'note', noteId:n.id, ..., color:'yellow' }); });
  events.sort(...);
  setCalendarEvents(events);
};
useEffect(() => { rebuildCalendarView(); }, [cases, notes]);
```

- ✅ useEffect на `[cases, notes]` є
- ✅ Не дублює hearings/deadlines — бере тільки `notes[].date != null`
- ⚠️ Залежність на `cases` тут зайва — функція читає лише `notes` (cases не задіяні). Це не баг, але зайвий ребілд при кожній зміні cases.
- ❌ **Стирає все що було в `calendarEvents` раніше** — включаючи дані з модалки і з localStorage. Тобто `addCalendarEvent` з модалки переживає рівно до наступної зміни справ/нотаток.
- ❌ `setCalendarEvents(events)` не пише в localStorage (на відміну від `addCalendarEvent`/`updateCalendarEvent`/`deleteCalendarEvent` які пишуть). Розсинхрон стейту і LS.

---

## 8. Слоти

`Dashboard/index.jsx:9-23, 32-178`.

| Параметр | Значення | Спека |
|---|---|---|
| Крок | `SLOT_MIN = 30` (хв) | 30хв ✅ |
| Висота слоту | `SLOT_H = 28` px | спека «висота — скільки px?» — 28 |
| Діапазон | 08:00–19:00 (`SLOTS` рядки 9-14) | ✅ |
| Long press | ✅ 400мс — `pressTimerRef` рядок 63-67. Half-press 200мс — візуальна реакція рядок 62. |
| `dragActive` стан | ✅ `isDragging` у `useSlotDrag` (рядок 184), `isDraggingRef` (рядок 185), `stateRef` для async-доступу (рядок 186). |
| Миша | `onMouseDown` запускає drag одразу — рядок 84-108. Якщо клік без руху — drag від N до N → стрибне модалка одного слоту. Спека: «мишка: рух після кліку → drag». **Не відповідає** — drag стартує миттєво, не на «русі після кліку». Click → 1-слотовий drag → відкривається модалка. |
| Vibrate на long press | ✅ рядок 66 |

---

## 9. Невідомі баги

1. **Модалка зберігає в `calendarEvents`, який стирається** (див. 4 і 7). Найбільший практичний баг — користувач створює засідання і воно зникає.
2. **`update_deadline` обходить PERMISSIONS** (5).
3. **`add_note` зі стрічки агента не реалізований** — обіцяє, але не виконує (5).
4. **Накладки рахуються по `length > 1`, не по перетину часу** (3).
5. **`findConflicts` втрачає не-перші засідання справи** (3 — Проблема А).
6. **`conflictIds` для SlotsColumn у тижневому виді завжди порожній** — `findConflicts` повертає items без id (рядок 273-274), а SlotsColumn робить `c.id` (рядок 39). Червона рамка слотів спрацьовує лише в одноденному вигляді через `checkConflicts(selectedDay)`.
7. **Тип `note` не має кольору в `colorsFor`** — нотатки в слотах рендеряться синіми як hearings (рядки 45-51).
8. **Модалка має тип `event`** який ніяк не читається getAllEvents (бо там фільтри `type === "hearing"` / `"deadline"`) — після збереження не з'явиться у слотах.
9. **Модель агента — Haiku** (5). Має бути Sonnet.
10. **`sonnetPrompt`/`buildSystemContext` приходять і не використовуються** (5, 6).
11. **`rebuildCalendarView` має `cases` у deps зайве** (7).
12. **`saveEvent` для деяких типів не передає `endTime`/`duration` коректно** — насправді передає, але `onAddEvent` не валідує тип, а `getAllEvents` фільтрує по типу — тому подія `event` потрапляє в `calendarEvents`, проходить crawl, але SlotsColumn рендерить її через дефолтний колір `#4f7cff` (бо тип ≠ hearing/deadline/travel/note).
13. **`category === 'admin'`/'administrative' double-check** (рядок 559) — норм, але вказує що в даних змішані категорії.
14. **Модалка перевіряє накладку лише серед `existingHearings.filter(e.type === "hearing" && e.time)`** (рядок 897), але **не перевіряє перетин часу** з тим, що додає. Завжди питає підтвердження якщо є ХОЧ ОДНА hearing в день, навіть якщо нова на 18:00 а інша на 09:00.
15. **API ключ з фолбеком: повідомлення «Налаштуйте API ключ в Quick Input» (рядок 790)**, але немає шляху налаштування з самого дашборду — норм для архітектури QI, але користувач застрягне якщо не знає про QI.

---

## 10. Що працює правильно

- Стрічка подій (FeedGroup/FeedItem) — групи 0-1/2-7/8-30 днів, клік → `setSelectedDay(event.date)` → переходить на день. Розгортання «ще N» через `expandedGroups`. ✅
- Місячна навігація `goPrev/goNext`, перемикач Місяць/Тиждень. ✅
- Тижневий вид з 7 колонками SlotsColumn + 30хв сітка. ✅
- Day Panel: список «без часу», слоти, чат-агента, голосовий ввід. ✅
- ACTION_JSON depth-counter парсер. ✅
- Робота з `c.hearings[]` всередині `_getNextHearing`, `getAllEvents`, `findConflicts` (за винятком багу з не-першими hearings). ✅
- Стилі/зум/`navBtnStyle`/`vBtnStyle`. ✅
- Long-press логіка з vibration. ✅
- Бар-графік категорій під календарем. ✅
- Фолбек кольорів через CSS змінні (`var(--accent, #...)`). ✅
- Модалка — UX введення часу через `<input type="time" step="1800">`. ✅
- «Час на дорогу» — додає окремий `travel` event перед основним. ✅ (хоч і зберігається в той самий «зникальний» calendarEvents)
- Скрол чату вниз через `useEffect` + `chatScrollRef`. ✅
- Voice through Web Speech API з fallback повідомленням. ✅

---

## 11. Пріоритизований список фіксів

```
[КРИТИЧНО] Модалка зберігає засідання/нотатки в calendarEvents який rebuildCalendarView стирає
           — Dashboard/index.jsx:888-937 + App.jsx:3223-3245
           Перевести saveEvent на onExecuteAction('dashboard_agent','add_hearing'/'add_note', {...})

[КРИТИЧНО] Модалка не має вибору справи для засідання
           — Dashboard/index.jsx:1370-1524
           Додати селект cases[] коли modalType === "hearing"

[КРИТИЧНО] Модель чату Haiku замість Sonnet
           — Dashboard/index.jsx:806
           model: "claude-sonnet-4-20250514" або "claude-sonnet-4-6"

[КРИТИЧНО] update_deadline в дашборд-агенті обходить PERMISSIONS і просто додає дублі
           — Dashboard/index.jsx:717-726
           Видалити case цілком (дедлайни read-only) або перенести під update_deadline через onExecuteAction (але дашборд-агенту дозволу нема — отже видалити).

[ВАЖЛИВО]  add_note ACTION_JSON не реалізований у handleDashboardAction
           — Dashboard/index.jsx:657-748 (немає case "add_note") + промпт обіцяє рядок 322
           Додати case "add_note": викликати onExecuteAction('dashboard_agent','add_note',{ caseId, text, date }).

[ВАЖЛИВО]  Накладки рахуються по length>1, не по перетину часу
           — Dashboard/index.jsx:257-275, 517-521, 1008
           Реалізувати hasOverlap(a, b) по [start, start+duration].

[ВАЖЛИВО]  findConflicts втрачає не-перші scheduled hearings справи
           — Dashboard/index.jsx:259-264
           Замість _getNextHearing — ітерувати усі hearings зі status==='scheduled' і fillна byDate.

[ВАЖЛИВО]  rebuildCalendarView стирає все, не зберігає в localStorage
           — App.jsx:3223-3245
           Або: видалити calendarEvents як концепт (всі джерела збирати в getAllEvents),
           або: тримати окремий стейт notesEvents і не чіпати calendarEvents.

[ВАЖЛИВО]  Dashboard не отримує props.notes
           — App.jsx:3886-3896
           Додати notes={notes}, дашборд має сам збирати ноти-з-датою всередині getAllEvents.

[ВАЖЛИВО]  conflictIds порожній (items без id) — слоти не червоніють у тижні
           — Dashboard/index.jsx:39 vs 257-275
           У findConflicts повертати { date, ids:[caseId або hearingId] } і пробрасувати в SlotsColumn.

[ВАЖЛИВО]  Тип "note" немає кольору в colorsFor
           — Dashboard/index.jsx:45-51
           Додати if (type === "note") return { border:"#f1c40f", bg:"rgba(241,196,15,.18)" } (жовтий).

[ВАЖЛИВО]  Drag миші стартує миттєво, click створює 1-слотовий drag → відкриває модалку
           — Dashboard/index.jsx:84-108
           Замінити на пороговий старт: drag активувати лише після руху ≥4-5 px.

[КОСМЕТИКА] sonnetPrompt і buildSystemContext приходять у Dashboard, не використовуються
            — Dashboard/index.jsx:461 + App.jsx:3893-3894
            Прибрати з пропсів.

[КОСМЕТИКА] rebuildCalendarView має cases у deps зайве (читає лише notes)
            — App.jsx:3245
            useEffect(() => rebuildCalendarView(), [notes])

[КОСМЕТИКА] Модалка тип "event" не має місця в новій моделі
            — Dashboard/index.jsx:1394-1410
            Прибрати, лишити hearing | note.

[КОСМЕТИКА] Модалка завжди питає підтвердження якщо є хоч одна hearing в день
            — Dashboard/index.jsx:897-901
            Перевіряти перетин часу.

[КОСМЕТИКА] Перевірка історії на first==='user' для API
            — Dashboard/index.jsx:781-783, 809
            Додати firstUserIdx як у LESSONS.md (CaseDossier шаблон).
```

---
