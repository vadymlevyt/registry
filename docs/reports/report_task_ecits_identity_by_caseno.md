# Звіт — TASK ecits_identity_by_caseno

**Дата:** 2026-06-09
**Гілка:** `claude/ecits-identity-by-caseno`
**Передумова:** Реальний 50-справ envelope заводив 0 справ — екстрактор повертає
`ecitsCaseId=null` (зі списку кабінету ЄСІТС код провадження не виставляється),
а scenarioProcessor скіпав усі такі кейси і дедуплікував по полю, якого
насправді не існує. v12-контракт (ролі/категорії/дати/`likelyNotMine`) при
цьому коректний.

**Скоуп:** Тільки ідентичність. v12-контракт недоторканий. Без bump'а
`schemaVersion`/`envelopeVersion` (це поведінка обробки, не структура даних).

---

## Що зроблено (чотири зчеплені зміни A/B/C/D)

### A. Дедуп по нормалізованому `case_no`

Новий спільний модуль `src/services/ecits/caseNoKey.js` з функцією
`normalizeCaseNoKey(caseNo)`:
- `trim()` оточуючих пробілів
- прибрати внутрішні пробіли
- `toLowerCase()` (для злиття `-Ц`/`-ц`)
- відкинути кінцевий суфікс-літеру(и) `-\p{L}+$` (Unicode — кирилиця і латинь)
- non-string / порожній → `null`

Використано у двох місцях замість дедупу за `ecitsState.caseId`:
- `src/services/ecits/scenarioProcessor.js` — пошук існуючої справи перед
  створенням
- `src/services/actionsRegistry.js` — `create_case` duplicate-перевірка
  (тепер повертає `{ error: 'duplicate_case_no', existingCaseId }`)

Існуюча справа, знайдена за нормалізованим `case_no`, отримує лише оновлення
`ecitsState` (`update_case_ecits_state`). `name`/`client`/`category`/`origin`
адвоката НЕ перезаписуються.

### B. Послаблений вхідний guard у `processCase`

Раніше: `if (!ecitsCase?.ecitsCaseId) → skip`. Реальний envelope мав `null`
для всіх 50 справ → блокувало повний імпорт.

Тепер: гейт посилається на `case_no` (ключ дедупу). Skip лише при відсутності
`case_no` із ясною помилкою `'missing case_no'`.

### C. Живий read-канал у App.jsx (`casesRef`)

Корінь раніше відомого бага «`Справу не знайдено`» (діагностика
2026-05-27 — `docs/diagnostics/report_diagnostic_ecits_state.md`): `getCases`
замикав immutable снапшот рендеру, а `setCases(prev=>…)` пише у живий
React-стейт. Within-run read-after-write зламано.

Зміни в `src/App.jsx`:
- `const casesRef = useRef(cases)`
- `useEffect(() => { casesRef.current = cases; }, [cases])` — пост-render
  catch-up.
- Новий `setCasesWithRef` — обгортка над `setCases`, що оновлює
  `casesRef.current` *у самому updater'і*, ще до того як React закомітить.
- Усі ACTIONS (через `createActions`) і extensionBridge тепер отримують
  `getCases: () => casesRef.current` і `setCases: setCasesWithRef`.
- `CourtSync`/`ImportTab` отримали новий проп `getCases` (живий ref);
  fallback на `cases` prop лишається для тестів зі снапшотом.

Семантика ACTIONS незмінна — лише джерело читання.

### D. Прибрано мертвий `ecitsCaseId`/`ecitsState.caseId` з активного коду

- `buildDefaultEcitsState` (`migrationService.js`) — більше не виставляє
  `caseId: null`. ecitsState-контейнер (lastSyncedAt/syncStatus/syncMetrics/
  firstDocumentDate/lastDocumentDate) лишається.
- `buildCreateCaseParams` (`scenarioProcessor.js`) — не пише
  `ecitsState.caseId`. Envelope-поле `ecitsCase.ecitsCaseId` приймається-
  але-ігнорується (не падати на існуючих витягувачах).
- Залишковий `caseId` у старих registry на Drive не читаємо; міграція-
  зачистка не потрібна (shallow-merge тихо лишає поле без шкоди).

---

## Файли

**Новий:**
- `src/services/ecits/caseNoKey.js` — спільний хелпер `normalizeCaseNoKey`

**Змінені:**
- `src/services/ecits/scenarioProcessor.js` — імпорт хелпера, dedup за
  `case_no`, guard за `case_no`, `buildCreateCaseParams` без
  `ecitsState.caseId`, нова гілка `duplicate_case_no` recovery.
- `src/services/actionsRegistry.js` — імпорт хелпера, `create_case` dedup
  за нормалізованим `case_no`, помилка `'duplicate_case_no'`.
- `src/services/migrationService.js` — `buildDefaultEcitsState` без поля
  `caseId`.
- `src/App.jsx` — `casesRef`, `setCasesWithRef`, `getCases: () =>
  casesRef.current` у createActions і `extensionBridge.configure`; проп
  `getCases` у `<CourtSync>`.
- `src/components/CourtSync/index.jsx` — приймає і прокидає проп `getCases`.
- `src/components/CourtSync/ImportTab.jsx` — `readCases = getCases || (() =>
  cases || [])`; обидві точки `submitScenarioResult`/`processDeferredCases`
  читають з живого `readCases`.
- `CLAUDE.md` — три рядки оновлено (Court Sync MVP сценарій, розширений
  `create_case`, scenarioProcessor — описують case_no-дедуп і живий
  read-канал).

**Тести:**
- `tests/unit/scenarioProcessor.test.js` — новий describe-блок для
  `normalizeCaseNoKey` (суфікс/пробіли/регістр/null/нерядок); змінені
  ассерти на `case_no`-дедуп; новий within-run dedup тест; новий
  `ecitsCaseId=null` НЕ skip; новий `case_no=null` → skip.
- `tests/integration/court-sync-mvp.test.js` — змінені існуючі ассерти
  (`duplicate_case_no` замість `duplicate_ecits_case`); три нових тести
  (envelope з `ecitsCaseId=null` заводить справи; повторний імпорт → 0
  нових; матч існуючої manual-справи без перезапису name/origin); тест
  read-after-write з immutable snapshot semantics, що відтворює прод
  React-патерн і доводить що within-run lookup бачить щойно створену справу.
- `tests/fixtures/ecits_envelope_2026-06-09.json` — всі 9 ecitsCaseId
  виставлено в `null` (як реальний envelope 2026-06-09). Структура
  v12-полів (ролі[], категорії, дати, likelyNotMine) недоторкана.

---

## Тести

```
npm test
Test Files  164 passed (164)
Tests       2106 passed (2106)
Duration    52.82s
```

Жодного нового red. Жоден існуючий тест не довелось відключати.

---

## Що НЕ зроблено (рамки спеки)

- v12-контракт envelope (ролі[]/категорії/дати/likelyNotMine/pendingReview) —
  недоторканий.
- `schemaVersion` НЕ бампнуто (поведінка обробки, не структура даних).
- `envelopeVersion` лишився 1.
- `case.team[]` — не чіпано.
- `getCasesList()` ACTION — не реалізовано (не в спеці).
- Міграція-зачистка legacy `ecitsState.caseId` — не зроблено (адмін-сесія
  вже додала борг #58; tracking_debt #58 не дублюємо).

---

## Очікуваний результат на реальному 50-справ envelope

Згідно спеки (адмін-сесія звірить Level-1): **36 створено / 14 pendingReview
/ 0 skipped / 0 помилок**.

Локально на golden fixture (9 кейсів, 8 auto + 1 likelyNotMine): 8 створено
/ 1 pendingReview / 0 skipped / 0 помилок — підтверджено інтеграційним
тестом `NEW: golden fixture (representative) проходить наскрізь`.
