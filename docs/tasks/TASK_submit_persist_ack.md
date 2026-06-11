# TASK — Durability: Result «успіх» лише після підтвердженого персисту (submit-ack)

**Тип:** спека для сесії-виконавця. Адмін-сесія НЕ реалізує сама.
**Статус:** очікує затвердження → виконавець.
**Дата:** 2026-06-11
**Підстава:** рішення адвоката 2026-06-11. Юридичні дані — потрібна гарантія
«точно збережено на Drive», а не «save-цикл запущено».

---

## 0. Вимога

> `submitScenarioResult` (і ручний шлях ImportTab, і реле `window.LegalBMS.
> submitScenarioResult`) повертає «успіх» ЛИШЕ після **підтвердженого запису на
> Drive**. Якщо персист не вдався — Result це **чесно** показує (не «успіх»).

## 1. Поточний стан (чому треба)

`submitScenarioResult` мутує стан через `executeAction` (setCases…) і **одразу
повертає Result** (`scenarioProcessor.js`). Реальний запис на Drive — окремий
**save-useEffect** у `App.jsx` (тригериться зміною стану `[cases, tenants, …]`,
`driveService.writeRegistry`). Тобто Result повертається **ДО** підтвердження
персисту. Для юр-даних це недостатньо.

## 2. Рішення — `persisted` у Result + очікування ack

**2a. Механізм підтвердження персисту (рекоменд. — «await next persist ack»):**
- `App.jsx` тримає список резолверів `pendingPersistAcks`. Хелпер
  `awaitPersistAck(): Promise<{ ok, status?, reason? }>` пушить резолвер і повертає
  проміс.
- save-useEffect: у `.then(res => …)` ПІСЛЯ `writeRegistry` — викликати
  `settlePersistAcks(res)`: резолвить усі очікувачі з `{ ok: !!res?.ok, status:
  res?.status, reason: res?.reason }` (і так само в `.catch` → `{ ok:false,
  reason:'network' }`). Скидати список після settle.
- Чому це працює без нових ref'ів: save-useEffect будує registry з ПОТОЧНОГО
  (пост-commit) стану, тобто пише вже оновлені імпортом дані; нам лишається
  дочекатись його завершення. Scenario-history append завжди змінює `tenants` →
  effect гарантовано спрацьовує після імпорту.
- (Альтернатива на розсуд: явний `flushRegistryToDrive()` що пише live-стан і
  повертає результат — але тоді потрібні live-ref'и для всіх змінних масивів;
  await-ack простіший і переюзовує наявний save. Обрати await-ack, якщо немає
  вагомої причини інакше.)

**2b. У `submitScenarioResult` (через deps, DI):** додати опційний
`deps.awaitPersistAck`. Після обробки:
```
let persisted = true, persistError = null;
if (typeof deps.awaitPersistAck === 'function') {
  const ack = await Promise.race([ deps.awaitPersistAck(), timeout(N сек) ]);
  persisted = !!ack?.ok;
  persistError = ack?.ok ? null : (ack?.reason || 'persist_timeout');
}
result.persisted = persisted;
result.persistError = persistError;
```
- Таймаут (напр. 20с) → `persisted:false, persistError:'persist_timeout'` (не
  висіти вічно).
- `App.jsx` підставляє `awaitPersistAck` і у `createActions`-шлях ImportTab, і у
  `extensionBridge.configure`.

**2c. UI/реле:**
- **ImportTab ResultCard:** показувати «✓ Збережено на Drive» коли `persisted`,
  або «⚠ НЕ збережено: <persistError> — повторіть» коли ні. Зелений «успіх»-вигляд
  — лише при `persisted:true`.
- **Реле (`window.LegalBMS.submitScenarioResult`):** повертає Result з `persisted`
  — розширення показує «успіх» лише коли `persisted:true`; інакше «не збережено,
  повторіть». (Дедуп ідемпотентний → повтор безпечний.)

## 3. Межі / нюанси

- Подвійний запис: явного flush немає (await-ack переюзовує наявний save), тож
  зайвого запису немає. Якщо обрали flush-варіант — стежити, щоб не писати двічі.
- Якщо імпорт НЕ змінив стан взагалі (0 створено/оновлено/засідань І немає
  history-append) — ack може не прийти; тоді `persisted:true` як «нема чого
  зберігати» (history-append зазвичай є, тож зазвичай ack приходить). Таймаут
  страхує.
- НЕ чіпати дедуп/контракт/v12/delete-persist. #11: `persisted` — один сенс
  «дані цього сабміту підтверджено на Drive».

## 4. Тести (обов'язково, `npm test` зелений)

- `submitScenarioResult` з `awaitPersistAck` що резолвить `{ok:true}` →
  `result.persisted===true`, `persistError===null`.
- `awaitPersistAck` резолвить `{ok:false, reason:'guard_blocked'}` →
  `persisted===false`, `persistError==='guard_blocked'`.
- без `awaitPersistAck` (старі/тестові callers) → `persisted===true` (backward).
- таймаут (ack не приходить) → `persisted===false, 'persist_timeout'`.
- ImportTab: рендерить «не збережено» коли `persisted:false`; «збережено» коли true.

## 5. Воркфлоу / здача

- НЕ пушити в main. Запуш СВОЮ гілку → адмін-звірка діфа → одне-реченнєве «ок»
  адвоката → FF. Звіт: `docs/reports/report_task_submit_persist_ack.md`.

Критерій готовності: Result містить `persisted`/`persistError`; «успіх» (UI/реле)
лише після підтвердженого writeRegistry; провал персисту чесно показано; таймаут
страхує; `npm test` зелений.
