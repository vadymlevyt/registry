# Діагностика batch_update
# Legal BMS | АБ Левицького
# Дата: 2026-05-02
# Режим: ТІЛЬКИ ЧИТАННЯ. Нічого не виправлено.

---

## ЗВІТ ДІАГНОСТИКИ batch_update

### КРОК 1 — executeAction і ACTIONS
ОБИДВА Є.

- `ACTIONS = { ... }` — реєстр атомарних дій.
  `src/App.jsx:3357 … 3593`
  Зареєстровані дії (16):
  `create_case`, `close_case`, `restore_case`, `update_case_field`,
  `add_deadline`, `update_deadline`, `delete_deadline`,
  `add_hearing`, `update_hearing`, `delete_hearing`,
  `add_note`, `update_note`, `delete_note`, `pin_note`, `unpin_note`,
  `add_time_entry`, `track_session_start`, `track_session_end`.

- `executeAction(agentId, action, params, userId='vadym')` — єдина точка входу.
  `src/App.jsx:3645 … 3667`
  Перевіряє `PERMISSIONS` → виконує `ACTIONS[action](params)` → `logAction`.

### КРОК 2 — PERMISSIONS
Є. `src/App.jsx:3596 … 3624`.

- **qi_agent** (16 дій): `create_case`, `close_case`, `restore_case`,
  `update_case_field`, `add_deadline`, `update_deadline`, `delete_deadline`,
  `add_hearing`, `update_hearing`, `delete_hearing`, `add_note`, `update_note`,
  `delete_note`, `pin_note`, `unpin_note`, `add_time_entry`.
- **dashboard_agent** (6): `add/update/delete_hearing`, `add/update/delete_note`.
- **dossier_agent** (16) — найповніший, плюс `track_session_start/end`.

`batch_update` в списку **НЕМАЄ** для жодного агента.

### КРОК 3 — batch_update
**НЕМАЄ ніде.** `grep "batch_update\|batch"` по `src/App.jsx` → 0 збігів.
В `ACTIONS` обробника немає, в `sendChat` обробника немає,
в `SONNET_CHAT_PROMPT` і `HAIKU_SYSTEM_PROMPT` згадки немає.

### КРОК 4 — SONNET_CHAT_PROMPT (`src/App.jsx:505 … 651`)
Інструкції для пакетних дій **НЕМАЄ**. Промпт описує тільки одиничні дії:

```
ACTION_JSON: {"recommended_actions": ["action_id"], "extracted": {...}}
```

`recommended_actions` формально масив, але:
- всі приклади показують один елемент;
- поле `extracted` — ОДНЕ скалярне (`case_name`, `hearing_date` і т.д.);
- немає інструкції "коли потрібно зробити кілька дій — згенеруй масив"
  і немає схеми для пакета різнотипних operations.

`HAIKU_SYSTEM_PROMPT` (рядок 479) теж декларує масив,
але реальний потік теж бере перший елемент.

### КРОК 5 — Обробка ACTION_JSON в sendChat (`src/App.jsx:1560 … 1924`)
Парсер — depth counter (`{...}`), парсить РІВНО ОДИН JSON-блок.
Масив дій теоретично пройде (`recommended_actions` — масив),
але далі логіка зациклюється на першому елементі:

```js
// src/App.jsx:1610
const action = actionResult.recommended_actions[0];   // ← ВУЗЬКЕ МІСЦЕ
```

Далі — каскад `if (action === '...')` блоків (1611–1923).
Кожен виконує ОДНУ дію через `onExecuteAction` і робить `return`.
Виконати масив окремих різнотипних дій неможливо без правки.

Структура `extracted` — теж скалярна (один `case_name`, один `hearing_date`),
тож навіть якби loop існував — нема куди класти 5 різних `deadlineId/hearingId`.

### КРОК 6 — Рендер кнопок (`src/App.jsx:2148-2206`)
Два місця:

1. Картка аналізу (`analysisCard`) — рядок 2149:
   ```js
   (msg.analysisCard.recommended_actions || []).map(action => <button .../>)
   ```
   Кожна `action` — одна кнопка, `onClick → executeQiAction(action)`.

2. Чат-повідомлення (`msg.actionResult`) — рядок 2200:
   ```js
   msg.actionResult.recommended_actions.map(action => <button .../>)
   ```
   Аналогічно — по кнопці на дію.

Логіки об'єднання немає. Якщо агент згенерує 5 ACTION_JSON
у п'яти окремих повідомленнях — отримаємо 5 окремих карток
по 1 кнопці кожна. Якщо в одному ACTION_JSON буде масив з 5
`recommended_actions` — отримаємо 5 кнопок, але обробить `sendChat` тільки `[0]`.

### КРОК 7 — delete_deadline / delete_hearing
Однотипні.

- `ACTIONS[delete_deadline]`  `src/App.jsx:3435` — params `{ caseId, deadlineId }`
- `ACTIONS[delete_hearing]`   `src/App.jsx:3485` — params `{ caseId, hearingId }`
- виклик з sendChat:          `delete_deadline` 1858-1884; `delete_hearing` 1808-1838
- виклик з QI `executeQiAction`: для `delete_*` зараз НЕМАЄ окремого case
  (вона викликається лише через ACTION_JSON-розгалуження в sendChat).

Обидві:
- однакова сигнатура: `{ caseId, idСутності }`;
- повертають `{ success: true }`;
- не вимагають користувацьких підтверджень окрім тих, що в SONNET_CHAT_PROMPT.

Об'єднати в пакет легко — структурно сумісні.

---

## РЕКОМЕНДАЦІЇ

Архітектура УЖЕ готова до `batch_update` — є реєстр `ACTIONS`,
єдина `executeAction`, і матриця `PERMISSIONS`. Не вистачає:

- (а) обробника `batch_update` в `ACTIONS`, який ітерує підпункти;
- (б) дозволу `batch_update` в `PERMISSIONS` для `qi_agent` / `dashboard_agent`;
- (в) інструкції в `SONNET_CHAT_PROMPT` генерувати один пакет
  замість серії одиничних ACTION_JSON;
- (г) обробника в `sendChat` для `action === 'batch_update'`, який не
  проходить через існуючий каскад одиничних `if`-ів, а делегує всю
  роботу `executeAction(..., 'batch_update', ...)`.

Без зміни depth-парсера ACTION_JSON, без зміни поточних обробників
`delete_*/update_*`, без зміни UI кнопок (одна кнопка "Виконати пакет"
з'явиться сама, бо `recommended_actions = ["batch_update"]`).

---

## ВАРІАНТИ РЕАЛІЗАЦІЇ batch_update

### Варіант 1 — Композитна дія batch_update в ACTIONS

**Що змінюється:**
- `ACTIONS` — додати `batch_update: ({ operations }) => { ... }` в `src/App.jsx`
  поряд з іншими діями (~рядок 3592). Тіло — цикл по `operations`,
  кожен виклик через `ACTIONS[op.action](op.params)`, збирає `results[]`
  і повертає `{ success, results }`.
- `PERMISSIONS` — додати `'batch_update'` в `qi_agent` і `dashboard_agent`
  (3597-3621). Усередині `batch_update` робиться явна перевірка, що
  кожна вкладена `op.action` теж входить в `PERMISSIONS[agentId]` (інакше
  виходить дірка в безпеці — `qi_agent` через `batch_update` міг би
  викликати дію, якої не має сам).
- `sendChat` — окремий блок `if (action === 'batch_update') { ... }`
  перед існуючим каскадом (~1611), який бере `actionResult.operations`
  (новий формат), один раз кличе `onExecuteAction('qi_agent',
  'batch_update', { operations })` і виводить summary.
- `SONNET_CHAT_PROMPT` — секція:
  > "Якщо потрібно ≥2 дії в одній відповіді — згенеруй ОДИН ACTION_JSON
  > з `recommended_actions:["batch_update"]`, `operations:[
  >   {action:"delete_deadline", caseId, deadlineId},
  >   {action:"delete_hearing",  caseId, hearingId}, ...
  > ]`. Не генеруй кілька окремих ACTION_JSON в одній відповіді."

**Що не змінюється:**
- Існуючі ACTIONS-обробники (`delete_deadline`, `delete_hearing`, ...).
- depth-counter парсер ACTION_JSON.
- `executeAction` (вона і так дженерик-диспетчер).
- Рендер кнопок — одна кнопка "Виконати [N] дій".
- QI `executeQiAction` для одиничних дій.

**Ризики:**
- Якщо забути перевірку вкладених permission — дірка в безпеці.
- Якщо одна op в пакеті падає — треба чітко визначити: продовжувати
  далі чи переривати все. Без транзакції відкат неможливий
  (`setCases` послідовно мутує state). Рекомендований режим:
  best-effort з масивом `results: [{action, ok, error?}, ...]`.
- `agentHistory` і `logAction` треба писати ПО кожній op (інакше
  втрачається аналітика).

**Складність:** легко.

**Рекомендація:** ПІДХОДИТЬ. Це найбільш ідіоматичний для поточної
архітектури спосіб. Існуючий шар `PERMISSIONS+ACTIONS` саме для цього
створений — додаємо одну композитну дію.

---

### Варіант 2 — Цикл по recommended_actions без нової композитної дії

**Що змінюється:**
- `sendChat` (1609-1923) — замість `const action = recommended_actions[0]`
  обернути існуючий каскад `if`-блоків у `for (const action of
  actionResult.recommended_actions)`. Винести `extracted` з єдиного
  скалярного об'єкта в масив `operations[]` паралельний до
  `recommended_actions` (бо без операцій неможливо різні id передати).
- `SONNET_CHAT_PROMPT` — інструкція використовувати масив
  `recommended_actions` і паралельний `operations` (новий формат).
- Прибрати `return` з кожного `if`-блоку `sendChat` (~20 точок) —
  замінити на `continue`; інакше після першої дії функція виходить.
- `markDone` у виводі чату об'єднати в одне `✅ Виконано N дій:` summary.

**Що не змінюється:**
- `ACTIONS`, `executeAction`, `PERMISSIONS` — взагалі не чіпаємо.
- Рендер кнопок (одна на дію — стане N кнопок з ✓ після виконання).

**Ризики:**
- Висока. ~20 точок зміни в `sendChat` — велика дельта в гарячому
  файлі. Лесон 2026-04-06 прямо забороняє переписувати великі блоки
  без причини.
- Кожен `if`-блок зараз робить `setConversationHistory(prev => [...prev,
  {...}])` — у циклі це призведе до stale closure (`prev` читається
  з тієї ж замороженої копії React state). Потрібно акумулювати
  повідомлення в локальний масив і одним `setConversationHistory` в кінці.
- `await systemConfirm` всередині деяких блоків (`delete_case`) ламає
  лінійність циклу.
- Не з'являється "видима" дія `batch_update` — тяжче авторизувати/логувати
  пакети окремо від одиничних дій.

**Складність:** середньо-складно.

**Рекомендація:** НЕ ПІДХОДИТЬ. Більше ризику, менше архітектурного
порядку. Ідея правильна, але реалізація суперечить поточній моделі
"одна дія = один запис у `logAction`".

---

### Варіант 3 — execute_actions як generic-операція в executeAction

**Що змінюється:**
- `executeAction` (3645) — спецкейс перед PERMISSIONS-перевіркою:
  якщо `action === 'execute_actions'`, розгортає `params.list` і рекурсивно
  викликає `executeAction(agentId, item.action, item.params)` для кожного.
  Кожна вкладена дія сама проходить permission-перевірку через звичайну
  гілку. Це рятує від ризику "дірки" з варіанту 1.
- `PERMISSIONS` — додати `'execute_actions'` в `qi_agent` / `dashboard_agent`.
- `sendChat` — блок `if (action === 'execute_actions') { ... }` —
  відлік як у варіанті 1.
- `SONNET_CHAT_PROMPT` — як у варіанті 1, але назва дії `execute_actions`.

**Що не змінюється:**
- `ACTIONS`-обробники — взагалі не пишемо `execute_actions:` в `ACTIONS`,
  він живе у самій `executeAction` (рекурсивний диспетчер).
- depth-counter парсер.
- Рендер кнопок.

**Ризики:**
- Цикл на рівні `executeAction` трохи "розмиває" чисту модель
  "виконавець не знає про composition" — `executeAction` перестає бути
  чистим диспетчером.
- Рекурсія + `setCases` послідовно — той самий ризик stale closure при
  оновленні одного й того ж масиву `hearings/deadlines` всередині однієї
  справи. Краще робити одну дію → один `setCases` (як у варіанті 1
  через цикл, але кожен виклик `ACTIONS[op.action]` вже використовує
  `setCases(prev => ...)` — React батчить, це ок для оновлень різних
  справ і безпечно для оновлень однієї справи завдяки `prev`).

**Складність:** легко.

**Рекомендація:** ПІДХОДИТЬ як альтернатива варіанту 1. Краще для
безпеки (вкладена permission-перевірка автоматична), гірше для
чистоти моделі (диспетчер тепер знає про список). Між Варіантом 1
з явною перевіркою і Варіантом 3 — обидва коректні.

---

## ПІДСУМКОВА РЕКОМЕНДАЦІЯ

**Варіант 1 (`batch_update` в `ACTIONS`) як основний:**
- однорідно з усіма іншими діями;
- `PERMISSIONS`-матриця залишається людино-читаною (всі дозволені дії
  видно одним списком, включно з `batch_update`);
- `logAction` логує і пакет (`batch_update`), і кожну op — повна аудит-
  стежка;
- найменший радіус змін: +1 ACTION, +1 рядок у двох масивах
  PERMISSIONS, +1 if-блок в `sendChat` (~30 рядків), +5-10 рядків
  у `SONNET_CHAT_PROMPT`.

### Формат ACTION_JSON для нового пакета

```json
{
  "recommended_actions": ["batch_update"],
  "operations": [
    {"action": "delete_deadline", "case_name": "Брановський", "deadline_date": "2026-03-31"},
    {"action": "delete_hearing",  "case_name": "Брановський", "hearing_date":  "2026-03-31"}
  ]
}
```

В `sendChat` пакет резолвиться на `caseId/deadlineId/hearingId` через
`findCaseForAction` (вже є) перед `onExecuteAction('qi_agent',
'batch_update', { operations: [{action, caseId, params}, ...] })`.

### Тестова матриця після впровадження (мінімум)

1. Один deadline + одне hearing у одній справі однією датою.
2. 3 deadlines у трьох різних справах — пакет на 3 op.
3. Mixed: `delete_hearing` + `add_note` (різні групи).
4. Permission denial: пакет з op якої немає у `PERMISSIONS[qi_agent]`
   — пакет має або повертати помилку для конкретної op,
   або відмовляти весь пакет (вибрати політику).
5. Один з op падає (caseId не знайдено) — інші виконуються,
   summary показує `✅ N з M`.
