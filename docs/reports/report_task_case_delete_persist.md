# Report — TASK case_delete_persist

**Дата:** 2026-06-10
**Гілка:** `fix/case-delete-persist`
**Closes:** tracking_debt #59 («Видалені ЄСІТС-справи переживають hard-reload»)

---

## Корінь

Симптом адвоката (реальний імпорт 2026-06-10): свідомо видалені ЄСІТС-справи
поверталися після hard-reload. Доказовий розклад причин зі статичного
аналізу (вже не «не відтворюється», як було у #59):

1. **Guard блокував свідомий мульти-shrink.**
   `evaluateRegistryWriteGuard` дозволяв тільки `cases >= prev − 1` (захист від
   випадкового затирання cases[] зі старої localStorage — реальний інцидент,
   зберігаємо). Видалення кількох справ → новий запис на Drive мав
   `cases < prev − 1` → `guard_blocked` → save-effect виставляв
   `driveSyncStatus='error'` і Drive-файл лишався зі старим набором справ.
   Після reload Drive-копія перетирала локальний state — справи поверталися.

2. **`deleteCasePermanently` обходив `setCasesWithRef`.**
   Функція робила сирий `setCases(prev => filter)`. `casesRef.current`
   оновлювався тільки у `useEffect`-таку pass'ів. Within-session повторний
   ЄСІТС-імпорт через `scenarioProcessor` читає `getCases:()=>casesRef.current`
   — бачив щойно видалену справу і йшов гілкою `update_case_ecits_state`
   замість `create_case`. На вигляд це «не видалилась», хоча локально вже була
   знята.

3. **Чат-команда «видалити справу» (QuickInput) теж робила сирий setCases**
   (`App.jsx:2022`) — без каскаду, без tombstone, без guard-сигналу, без Drive
   cleanup'у. Сам розрив сценаріїв «UI delete» vs «agent delete».

---

## Що змінилось

### A. `expectIntentionalCasesShrink(n)` у `registryWriteGuard`

`src/services/registryWriteGuard.js` — **поведінкова зміна, без зміни API
для існуючих caller'ів**:

- Додано module-scoped `_expectedCasesShrink` (default 0).
- `expectIntentionalCasesShrink(n)` (export) — caller сигналізує очікуваний
  свідомий shrink. Бере max при повторному виклику (caller подвоїв — намір
  той самий, переможе більший).
- `evaluateRegistryWriteGuard` зчитує лічильник, скидає **одразу** (one-shot,
  правило #11: один намір — один запис), і дозволяє
  `cases >= prev − (1 + n)`.
- НЕ ослабляється: без сигналу далі блокує `< prev − 1`. Порожній/нульовий
  `cases` без сигналу — далі блок. Поля `ai_usage`/`auditLog`/`users`/
  `tenants` сигналом НЕ зачіпаються (інший інваріант).
- Додано `__resetWriteGuardState()` для `beforeEach` у тестах.

### B. `deleteCasePermanently` через `setCasesWithRef` + сигнал + каскад

`src/App.jsx:4879…` — повний rewrite функції:

1. Audit `pending → done/failed` (без змін).
2. Видалення Drive-папки справи (без змін; разом з нею зникає
   `.metadata/documents_extended.json` і `agent_history.json` цієї справи).
3. **Push tombstone у `deletedCases[]` ПЕРЕД зняттям** з `cases[]`:
   `{ caseId, case_no, name, deletedAt, deletedBy }`. localStorage
   `levytskyi_deleted_cases` оновлюється синхронно (щоб reload-під-час-видалення
   не втратив надгробок).
4. **`expectIntentionalCasesShrink(1)`** — споживається наступним save-effect'ом
   на Drive (один реальний випадок видалення = один запис).
5. **Каскад прибирання інертних кешів**:
   - Standalone-нотатки з `caseId` у `levytskyi_notes` bucket'ах
     (case.notes[] inline зникає разом зі справою).
   - `agent_history_<caseId>` у localStorage (швидкий шар 3-tier cache).
   - `caseAccess[]` записи цієї справи.
6. **`setCasesWithRef`** — синхронний апдейт `casesRef.current`. Within-session
   повторний імпорт через `scenarioProcessor` бачить справу як неіснуючу і
   йде гілкою `create_case`. Дедуп `duplicate_case_no` у `actionsRegistry`
   читає той же актуальний `getCases()`.
7. Закриття dossier-екрану / `setSelected(null)` — без змін.

Що **НЕ** видаляється (свідомо, як sources of truth для білінгу/аудиту):
`time_entries[]`, `ai_usage[]`, `auditLog[]`. Це інертні сироти; зрізи
«активних» виключають їх через `deletedCases[]`.

### B1. Чат-команда видалення в QuickInput → той самий шлях

`App.jsx:2005…` — гілка `action === 'delete_case'` для вже закритої справи
тепер кличе `onDeleteCasePermanently(matched)` (новий prop, проброшено з
App.jsx), а не сирий `setCases(filter)`. Один сенс «видалення справи назавжди»
— один шлях, незалежно від точки входу (CaseModal UI vs QI чат).

### C. `deletedCases[]` індекс + споживач-фільтр

- **Нове поле в реєстрі:** `deletedCases[]` (default `[]`, адитивне — росте,
  guard не зачіпає). Подорожує у save-об'єкті між App.jsx і
  `registry_data.json`. Гідрується при first-load і при restore-from-backup.
  `localStorage 'levytskyi_deleted_cases'` — швидкий шар.
- **schemaVersion НЕ змінюється:** поле адитивне, default `[]`, ніщо не
  валідує його присутність строго — як `caseAccess[]` додавали без bump'у.
- **`timeEntriesQuery.getTimeEntries`:** новий optional фільтр
  `query.excludeCaseIds`. Споживачі (білінг/звіти/дашборд — поки UI ще не
  активний; контракт існує) передаватимуть
  `excludeCaseIds: deletedCases.map(d => d.caseId)`. Без параметра контракт
  не змінений (no-op).

#### Що НЕ зроблено свідомо

- Зрізи дашборду / резюме білінгу ще не споживають `excludeCaseIds` —
  у проді UI білінгу немає. Контракт уже існує; інструментація — окремий
  TASK коли підіймуть Billing UI v1.
- **scenarioProcessor НЕ дивиться у `deletedCases[]`.** За правилом #11:
  надгробок — це факт «справа була і її видалили», а не **запрет на повторний
  імпорт**. Адвокат свідомо видалив; ЄСІТС присилає ту саму справу знов
  — це його вибір, чи перезаінстальовувати її. Спека прямо це формулює:
  «видалене → імпорт створює наново негайно без F5».

---

## Тести

`npm test`: **167 файлів, 2129 тестів — зелено**.

### Нові тести

- `tests/unit/registryWriteGuard.test.js` (+8): свідомий shrink з/без сигналу,
  one-shot скид, верхня межа `n`, повторний виклик бере max, нульовий/
  негативний `n` no-op, порожній cases без сигналу блок, сигнал не зачіпає
  ai_usage.
- `tests/unit/timeEntriesQuery.test.js` (новий, 7 тестів): `excludeCaseIds`
  виключає, не торкається null-caseId, поєднується з іншими фільтрами,
  `getSummary` бачить його, no-op без параметра.
- `tests/integration/case-delete-persist.test.js` (новий, 3 тести):
  - до видалення imp иде по `update_case_ecits_state` (sanity);
  - після `performDelete` повторний `submitScenarioResult` йде по
    `create_case` (casesCreated=1, casesUpdated=0) — корінь race закрито;
  - guard блокує несигналізований −3, дозволяє з сигналом, скидається після
    першого evaluate;
  - каскад прибирає standalone нотатки і пише tombstone.

### Регресії

Існуючі 156 файлів і ~2100 тестів — зелені. Зокрема `ecits-existence-check-race.test.js`
не зачеплений (race A/B виправлений у TASK ecits_existence_check_fix лишається
як є; C — це саме case-delete, тепер закритий тут).

---

## Межі дотримано

- Guard НЕ ослаблений для випадкового затирання: порожній/несигналізований
  shrink далі блокується.
- v12-контракт / FIX-IDENTITY / race-фікс / дедуп — без зміни.
- Правило #11: `deletedCases[]` — один сенс «надгробок», не плутати з
  `caseAccess`/`team`/`status='closed'`. Маркер централізовано в одному масиві,
  не дублюється прапором на кожному записі.
- Audit / time_entries / ai_usage — зберігаються (історія дій лишається).

## Файли

**Змінено:**
- `src/services/registryWriteGuard.js` — `expectIntentionalCasesShrink` + one-shot.
- `src/services/timeEntriesQuery.js` — `excludeCaseIds` у `applyFilters`.
- `src/App.jsx` — `deletedCases` state/hydrate/save; rewrite
  `deleteCasePermanently`; QuickInput chat-delete → `onDeleteCasePermanently`.
- `tests/unit/registryWriteGuard.test.js` — 8 нових тестів signal'у.
- `tracking_debt.md` — #59 RESOLVED.

**Нові:**
- `tests/unit/timeEntriesQuery.test.js`.
- `tests/integration/case-delete-persist.test.js`.
- `docs/reports/report_task_case_delete_persist.md` (цей файл).

## Воркфлоу

НЕ push у `main`. Push гілка `fix/case-delete-persist`. Адмін-сесія
звірить діф зі спекою; адвокат — одне «ок» → fast-forward у `main`.
