# report_task_ecits_existence_check_fix.md

**TASK:** Фікс гонки в `update_case_ecits_state` / `mark_synced_from_ecits` —
існування справи перевіряти СИНХРОННО через `getCases().find()` ДО `setCases`,
не через прапор всередині async updater'а.

**Дата:** 2026-06-10
**Гілка:** TBD — пушиться окремо (не в `main`).
**Звіт:** реалізація + контракт зміни.

---

## 1. Симптом і корінь

Симптом адвоката при реальному ЄСІТС-імпорті: недетерміновано падало
`update_case_ecits_state failed: Справу case_… не знайдено`, хоча справа в
`getCases()` була.

Корінь — патерн обох ACTIONS:

```js
let found = false;
setCases(prev => prev.map(c => {
  if (c.id !== caseId) return c;
  found = true;        // ← виставляється ВСЕРЕДИНІ updater'а
  return { ...c, ... };
}));
if (!found) return { success: false, error: '…не знайдено' };
//                ↑ читається СИНХРОННО одразу після setCases
```

React може батчити set-state'и — updater спрацьовує асинхронно, тому `found`
лишається `false` на момент return, хоча справа є. На стабі / у тестах це не
ловилось бо там `setCases` спрацьовував синхронно.

Фікс — мінімальний: існування читати з `getCases().find()` ДО `setCases`
(той самий патерн уже застосовано в `delete_deadline`, `add_document` тощо).
Прапор `found` усувається повністю.

`getCases` у App.jsx живий: `getCases: () => casesRef.current` (ref
оновлюється і в `setCasesWithRef`, і в пост-render useEffect — TASK
ecits_identity_by_caseno).

---

## 2. Зміни коду

### A. `update_case_ecits_state` (`src/services/actionsRegistry.js`)

- ДО setCases: `const targetCase = getCases().find(c => c.id === caseId);`
  → ранній return з `success:false, error:'Справу X не знайдено'` якщо нема.
- `overwriteSkipped` обчислюється з `targetCase.ecitsState._lastSource` СИНХРОННО.
- Якщо `overwriteSkipped` — `setCases` НЕ викликається взагалі (раніше
  updater повертав `return c` — семантично еквівалент: запис не змінюється).
- Якщо НЕ skipped — `setCases` застосовує мердж `{...existingState, ...patch, _lastSource:source}`.
- Подія `ECITS_CASE_STATE_UPDATED` публікується завжди (як раніше), з
  правильним `overwriteSkipped`.
- Семантика повернення незмінна: `{success:true, overwriteSkipped:bool}`.

### B. `mark_synced_from_ecits` (`src/services/actionsRegistry.js`)

- Ідентичний патерн: `getCases().find()` ДО setCases → ранній return при відсутності.
- `currentMetrics`/`nextMetrics` обчислюються з `targetCase.ecitsState?.syncMetrics`
  СИНХРОННО (до setCases).
- `setCases` лише застосовує patch (записує `lastSyncedAt`, `syncStatus`,
  `failureReason`, `syncMetrics: nextMetrics`, `updatedAt`).
- Подія `ECITS_SYNC_COMPLETED` публікується після, як раніше.
- Семантика повернення незмінна: `{success:true, syncedAt}`.

Жодних змін у:
- v12-контракті envelope, FIX-IDENTITY дедупі, `scenarioProcessor`, билінгу,
  PERMISSIONS, event payload-структурі.
- Поведінці інших ACTIONS.

---

## 3. Тести

Новий файл `tests/integration/ecits-existence-check-race.test.js` — **пін**
фіксу через **deferred setCases** (харнес НЕ виконує updater синхронно):

1. `update_case_ecits_state` на існуючий id → `{success:true, overwriteSkipped:false}`,
   updater уліг у pending queue (1 елемент).
2. `update_case_ecits_state` на неіснуючий id → `{success:false, error:/не знайдено/}`,
   `setCases` НЕ викликався.
3. `update_case_ecits_state` з нижчим source priority → `{success:true,
   overwriteSkipped:true}`, `setCases` НЕ викликався (оптимізація: skip означає
   жодних змін стану).
4. `mark_synced_from_ecits` на існуючий → `{success:true, syncedAt:…}`,
   updater у pending queue.
5. `mark_synced_from_ecits` на неіснуючий → `{success:false, error:/не знайдено/}`.

Старий код (з `let found = false;` всередині updater'а) на цих тестах **впав
би** — за умови deferred setCases прапор лишається false і ранній return видає
помилку. Це і є пін.

**Регрес-чеки:**
- `tests/integration/court-sync-mvp.test.js` — повний E2E flow Court Sync
  (синхронне `setCases` в харнесі) — зелений.
- `tests/unit/scenarioProcessor.test.js`, `tests/unit/canonicalSchemaV7.test.js`
  — зелені.
- **`npm test` повністю:** 165 test files, 2111 tests passed, 0 failed (54.35s).

---

## 4. C — відкладено в `tracking_debt.md` (#59)

Вторинне завдання спеки — «видалені ЄСІТС-справи переживають hard-reload» —
не відтворюється статичним аналізом коду `deleteCasePermanently`
(`App.jsx:4879`): синхронний `setCases(filter)` → `useEffect` на `[cases, ...]`
→ `driveService.writeRegistry`. Можливі гіпотези (guard блокує save,
повторний sync переписує без видаленої справи, race з hydration) потребують
runtime-телеметрії, якої зараз нема. Спека прямо дозволяє: «якщо швидко не
відтворюється — винеси в tracking_debt, НЕ блокуй A/B».

Запис #59 у `tracking_debt.md` з явним тригером: наступний реальний звіт
відтворення → runtime-лог послідовності delete→save.

---

## 5. Що НЕ зроблено (свідомо)

- Не змінено семантику A/B (patch, подія, overwriteSkipped, syncMetrics).
- Не зачеплено v12-контракт envelope, FIX-IDENTITY дедуп, `scenarioProcessor`.
- Не виправлено вторинне C — у tracking_debt.md #59.
- Не пушено в `main` — гілка пушиться окремо для адмін-звірки і FF після
  «ок» адвоката.

---

## 6. Файли

```
src/services/actionsRegistry.js                          — фікс A+B
tests/integration/ecits-existence-check-race.test.js     — пін race-регресії
tracking_debt.md                                          — +#59
docs/reports/report_task_ecits_existence_check_fix.md    — цей звіт
```

---

## 7. Передача

- Адмін-сесія: звірити діф, переконатись що A/B-фікси семантично еквівалентні
  старому коду (крім того, що раніше `found` був недетермінованим), що подія
  `overwriteSkipped` тепер коректна, що тести new покривають саме гонку.
- Адвокат: коротке «ок» → FF в `main` (тільки якщо тести зелені на гілці).

**Кінець звіту.**
