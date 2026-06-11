# REPORT — Durability: Result «успіх» лише після підтвердженого персисту (submit-ack)

**TASK:** `docs/tasks/TASK_submit_persist_ack.md`
**Дата:** 2026-06-11
**Гілка:** `feat/submit-persist-ack` (від `origin/main` 3bc6ded — свіжий main з representedParties)
**Статус:** реалізовано повністю, `npm test` зелений (170 файлів / 2186 тестів), `npm run build` проходить.

---

## 1. Що зроблено

Обрано **рекомендований варіант спеки — «await next persist ack»** (НЕ flush):
жодних нових live-ref'ів для масивів, нуль подвійних записів — переюзовується
наявний save-useEffect.

### 2a. App.jsx — механізм підтвердження персисту

- `pendingPersistAcksRef` (useRef([])) — список резолверів, що чекають завершення
  НАСТУПНОГО `writeRegistry`.
- `awaitPersistAck(): Promise<{ok, status?, reason?}>` — пушить резолвер, повертає проміс.
- `settlePersistAcks(ack)` — резолвить УСІХ очікувачів і скидає список.
- save-useEffect:
  - `.then(res => …)` ПІСЛЯ наявної обробки статусів →
    `settlePersistAcks({ ok: !!res?.ok, status: res?.status, reason: res?.reason })`
    (успіх І провал — guard_blocked / creation_not_allowed / file_missing /
    http_error — обидва чесно);
  - `.catch(e)` → `settlePersistAcks({ ok:false, reason: e?.message || 'network' })`.
- Форма ack 1:1 збігається з контрактом `driveService.writeRegistry` →
  `{ ok, status, reason? }` (guard_blocked несе reason guard'а).

Чому без нових ref'ів працює: save-useEffect будує registry з пост-commit стану
(вже з даними імпорту); history-append завжди змінює `tenants` → effect
гарантовано спрацьовує після сабміту.

### 2b. scenarioProcessor.submitScenarioResult — persisted/persistError

- Нові опційні deps: `awaitPersistAck`, `persistAckTimeoutMs` (override таймауту
  для тестів; default — експортований `PERSIST_ACK_TIMEOUT_MS = 20000`).
- Після обробки і ПІСЛЯ history-append (порядок перевірено тестом):
  `ack = await Promise.race([awaitPersistAck(), timeout])`;
  `result.persisted = !!ack?.ok`;
  `result.persistError = ack?.ok ? null : (ack?.reason || 'persist_timeout')`.
- Таймаут-таймер чиститься (clearTimeout) — нема висячого таймера.
- `awaitPersistAck` кинув → `persisted:false` з причиною, сабміт НЕ падає
  (обробка вже виконана — Result чесний).
- БЕЗ `awaitPersistAck` (старі/тестові callers) → `persisted:true,
  persistError:null` — backward, поведінка до TASK.
- `persisted` — один сенс (#11, коментар на місці): «дані ЦЬОГО сабміту
  підтверджено збереженими на Drive».

### App.jsx — wiring обох шляхів

- `extensionBridge.configure({ submitScenarioResult: … })` — deps отримали
  `awaitPersistAck` → Result реле несе persisted (розширення показує успіх лише
  при true; контракт задокументовано в extensionBridge.js біля методу).
- `<CourtSync awaitPersistAck={awaitPersistAck} …>` → `CourtSync/index.jsx`
  прокидає проп у `<ImportTab>` → ImportTab передає у deps submitScenarioResult.

### 2c. UI — ImportTab ResultCard

- `persisted:true` (або legacy-result без поля — backward) →
  рядок «✓ Збережено на Drive» (CheckCircle2 + success-колір).
- `persisted:false` → «⚠ НЕ збережено: <persistError> — повторіть»
  (AlertTriangle + error-колір).
- Зелений «успіх»-вигляд секції (`isSuccessLook`) — лише коли НЕМАЄ помилок
  І `persisted !== false`; інакше warning-стиль і warning-іконка.

## 2. Межі — дотримано

- Дедуп / контракт envelope / v12 / delete-persist / race-фікс /
  representedParties — НЕ зачеплені (submitScenarioResult: лише deps-розширення
  і блок persisted перед return; processCase не чіпався).
- Подвійного запису немає: await-ack нічого не пише, лише чекає наявний save.
- `processDeferredCases` (пікер «Можливо не ваші») — поза scope спеки §2b
  (вона визначає зміну лише для submitScenarioResult); мердж deferred-результату
  зберігає `persisted` первинного сабміту. Якщо адвокат захоче ack і для
  deferred-шляху — окремий мікро-TASK.
- Нюанс спеки §3 «імпорт нічого не змінив → ack може не прийти»: страхує
  таймаут (20с → чесний `persisted:false, 'persist_timeout'`). Settle є лише
  у .then/.catch writeRegistry, точно за спекою — skip-гілки effect'а
  (Drive не підключено / не hydrated / нема токена) теж накриваються таймаутом.

## 3. SAAS IMPLICATIONS

- Нових сутностей/полів даних немає — `persisted/persistError` живуть лише в
  runtime-Result (не зберігаються в registry; history-entry не змінювався).
- Механізм ack — per-session, tenant-нейтральний; у multi-user кожна сесія має
  власний save-цикл і власні очікувачі.

## 4. BILLING IMPLICATIONS

- Нуль нових точок інструментації: очікування персисту — системна механіка,
  не активність адвоката; time_entries/ai_usage не зачеплені.

## 5. Тести (нові)

- `tests/unit/scenarioProcessor.test.js` (+6):
  `{ok:true}` → persisted true/persistError null; `{ok:false, reason:'guard_blocked'}` →
  false/'guard_blocked'; без awaitPersistAck → true (backward); таймаут
  (persistAckTimeoutMs:50, ack ніколи) → false/'persist_timeout'; reject ack →
  false/причина без падіння сабміту; порядок history-append → ack-реєстрація.
- `tests/unit/ImportTabPersistAck.test.jsx` (5, jsdom): «Збережено на Drive» при
  true; «НЕ збережено: guard_blocked — повторіть» при false; persist_timeout
  показується; ImportTab прокидає awaitPersistAck у deps; legacy-result без
  поля → backward «збережено».

`npm test`: **170 файлів / 2186 тестів — зелено.** `npm run build` — проходить.

## 6. Файли

| Файл | Зміна |
|------|-------|
| `src/App.jsx` | pendingPersistAcksRef + awaitPersistAck/settlePersistAcks; settle у .then/.catch writeRegistry; wiring у extensionBridge.configure і CourtSync |
| `src/services/ecits/scenarioProcessor.js` | deps awaitPersistAck/persistAckTimeoutMs; PERSIST_ACK_TIMEOUT_MS; блок persisted/persistError |
| `src/components/CourtSync/index.jsx` | проп awaitPersistAck → ImportTab |
| `src/components/CourtSync/ImportTab.jsx` | deps.awaitPersistAck; ResultCard статус персисту |
| `src/services/extensionBridge.js` | док-контракт реле (persisted) |
| `tests/…` | +6 unit scenarioProcessor, +5 ImportTabPersistAck |

## 7. Здача

Гілка: **`feat/submit-persist-ack`** — запушена, НЕ змержена в main.
Очікує: адмін-звірка діфа зі спекою → одне-реченнєве «ок» адвоката → FF у main.
