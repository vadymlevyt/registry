# TASK.md — Реалізація batch_update
# Legal BMS | АБ Левицького
# Дата: 02.05.2026
# Варіант: 1 — Композитна дія в ACTIONS

---

## КРОК 0 — ПРОЧИТАТИ LESSONS.md

```bash
cat LESSONS.md
```

---

## КОНТЕКСТ

Архітектура ACTIONS + PERMISSIONS + executeAction вже є і готова.
Не вистачає рівно чотирьох речей — додаємо їх по порядку.
Нічого існуючого не переписуємо.

Політика при помилці: best-effort.
Якщо одна операція в пакеті падає — інші виконуються.
Summary показує: "3 з 4 виконано".

---

## КРОК 1 — Додати batch_update в ACTIONS

Знайти кінець об'єкта ACTIONS:

```bash
grep -n "ACTIONS = {" src/App.jsx
```

Додати нову дію в кінці ACTIONS перед закриваючою дужкою:

```javascript
batch_update: async ({ operations, agentId }) => {
  const results = [];
  for (const op of operations) {
    try {
      if (!op.action || !ACTIONS[op.action]) {
        results.push({ action: op.action, ok: false, error: 'Невідома дія' });
        continue;
      }
      if (agentId && PERMISSIONS[agentId] && !PERMISSIONS[agentId].includes(op.action)) {
        results.push({ action: op.action, ok: false, error: 'Немає повноважень' });
        continue;
      }
      const result = await ACTIONS[op.action](op.params);
      results.push({ action: op.action, ok: true, result });
    } catch (err) {
      results.push({ action: op.action, ok: false, error: err.message });
    }
  }
  const successCount = results.filter(r => r.ok).length;
  return { success: successCount > 0, successCount, total: results.length, results };
},
```

---

## КРОК 2 — Додати batch_update в PERMISSIONS

Знайти масиви qi_agent і dashboard_agent:

```bash
grep -n "qi_agent\|dashboard_agent" src/App.jsx | head -10
```

Додати 'batch_update' в кінець масиву qi_agent і dashboard_agent.

---

## КРОК 3 — Додати обробник в sendChat

Знайти початок каскаду if-блоків в sendChat:

```bash
grep -n "recommended_actions\[0\]\|action ===" src/App.jsx | head -10
```

Додати ПЕРЕД існуючим каскадом if-блоків:

```javascript
// BATCH_UPDATE — обробляти до каскаду одиничних дій
if (action === 'batch_update') {
  const operations = actionResult.operations || [];
  if (operations.length === 0) {
    addMessage('assistant', 'Пакет порожній — немає операцій для виконання.');
    return;
  }

  // Резолвити case_name -> caseId для кожної операції
  const resolvedOps = operations.map(op => {
    const resolved = { action: op.action, params: { ...op } };
    if (op.case_name) {
      const found = cases.find(c =>
        extractShortName(c.name).toLowerCase() === op.case_name.toLowerCase() ||
        c.name.toLowerCase().includes(op.case_name.toLowerCase())
      );
      if (found) resolved.params.caseId = found.id;
    }
    return resolved;
  });

  const batchResult = await onExecuteAction('qi_agent', 'batch_update', {
    operations: resolvedOps,
    agentId: 'qi_agent'
  });

  const { successCount, total, results } = batchResult;
  const summary = results.map(r =>
    r.ok ? 'OK: ' + r.action : 'ПОМИЛКА: ' + r.action + ' — ' + r.error
  ).join('\n');

  addMessage('assistant',
    'Виконано ' + successCount + ' з ' + total + ' операцій:\n' + summary
  );
  return;
}
```

---

## КРОК 4 — Оновити SONNET_CHAT_PROMPT

Знайти SONNET_CHAT_PROMPT:

```bash
grep -n "SONNET_CHAT_PROMPT" src/App.jsx | head -5
```

Додати після існуючого опису одиничних дій:

```
ВАЖЛИВО: Якщо потрібно виконати 2 або більше дій в одній відповіді —
згенеруй ОДИН ACTION_JSON з batch_update:

ACTION_JSON: {
  "recommended_actions": ["batch_update"],
  "operations": [
    {"action": "delete_deadline", "case_name": "Брановський", "deadline_date": "2026-03-31"},
    {"action": "delete_hearing",  "case_name": "Брановський", "hearing_date":  "2026-03-31"},
    {"action": "delete_deadline", "case_name": "Корева",      "deadline_date": "2026-03-31"}
  ]
}

НЕ генеруй кілька окремих ACTION_JSON в одній відповіді.
НЕ використовуй batch_update для однієї дії — тільки для 2+.
```

---

## КРОК 5 — Перевірка після змін

```bash
grep -n "batch_update" src/App.jsx
```

Переконатись що є:
- в ACTIONS
- в qi_agent і dashboard_agent
- в sendChat (новий if-блок)
- в SONNET_CHAT_PROMPT

---

## ТЕСТОВА МАТРИЦЯ після деплою

Перевірити в браузері:

1. "Видали всі дедлайни на 31 березня"
   — одна кнопка — виконати — summary N з N

2. "Видали засідання і дедлайн по Брановському на 31 березня"
   — пакет з 2 операцій — summary

3. "Видали всі застарілі записи за березень"
   — агент формує пакет — виконати одним натисканням

4. Одинична дія досі працює:
   "Постав дедлайн Янченку 15 травня"
   — НЕ йде через batch_update

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "feat: batch_update — пакетне виконання дій агентом" && git push origin main
```

---

## ДОПИСАТИ В LESSONS.md ПІСЛЯ ВИКОНАННЯ

```
### [2026-05-02] batch_update
- Реалізовано як композитна дія в ACTIONS
- Політика: best-effort — падіння однієї op не зупиняє пакет
- Вкладена перевірка PERMISSIONS для кожної op в пакеті
- SONNET_CHAT_PROMPT: один пакет замість кількох ACTION_JSON
- Тестова матриця: 4 сценарії
```
