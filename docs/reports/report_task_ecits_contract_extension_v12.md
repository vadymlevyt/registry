# Report — TASK ECITS Contract Extension v12

**Базова спека:** `docs/tasks/TASK_ecits_contract_extension_v12.md`
**Дата:** 2026-06-09
**Виконавець:** Claude Opus 4.7 (1M)
**Гілка реалізації:** `main` (десктоп Claude Code → push прямо у main, після підтвердження адвоката)
**Статус:** Реалізація завершена, повний test-suite зелений (2092/2092).

---

## 1. Що зроблено (по 5 змінах + робастність)

Усі п'ять змін реалізовані **адитивно, зворотно сумісно** — старі envelope
лишаються валідними, нові поля nullable/default, версії envelope не бампилися
(envelopeVersion=1, scenarioVersion=1).

### Зміна 1 — Ролі (множинність + словник 11 значень)

- `scenarioProcessor.js`: експорт `ADVOCATE_ROLE_VALUES` (11 канонічних
  значень: `plaintiff_rep, defendant_rep, third_party_rep, applicant_rep,
  victim_rep, appellant_rep, interested_party_rep, defender, appellant,
  advocate, representative_unspecified`).
- `resolveAdvocateRoles(ecitsCase)` — повертає `{advocateRole, advocateRoles[], unknownRoles[]}`.
  Якщо є тільки `advocateRole` — `advocateRoles=[role]`. Якщо є масив — як є.
  Невідомі ролі НЕ валять імпорт (потрапляють у `result.warnings`).
- `buildCreateCaseParams` пише `advocateRole` і `advocateRoles[]` **top-level**
  на справі (не в ecitsState — стабільний атрибут справи, AI-first).
- `caseSchema.js`: нові поля `advocateRole`, `advocateRoles[]` додано до
  `CANONICAL_CASE_FIELDS` з описом сенсу і посиланням на словник.
- `ensureCaseSaasAndEcitsFields` гарантує дефолти (`advocateRole=null`,
  `advocateRoles=[]` або `[advocateRole]`) для нових справ.

### Зміна 2 — Категорії (+commercial, +administrative_offense, +null)

- `scenarioProcessor.js`: експорт `ENVELOPE_CATEGORY_VALUES` (6 значень,
  включно з null) і **мапи `ENVELOPE_TO_CASE_CATEGORY`**:
  - `administrative` → `admin` (звести два імена одного сенсу — правило #11).
  - `administrative_offense` → лишається (інша юрисдикція ≠ `admin`!).
  - `commercial`, `civil`, `criminal` — як є.
  - невідоме → `null` + warning із case_no.
- `resolveCaseCategory(ecitsCase)` — мапа без винятків, повертає `{category, warning}`.
- `caseSchema.js`: `category` тепер `nullable`, enum розширено `commercial`,
  `administrative_offense`, `null`; `military` лишається legacy.

### Зміна 3 — likelyNotMine + опт-ін пікер

- `scenarioProcessor.submitScenarioResult` **партиціонує** `data.cases`:
  - `auto` (likelyNotMine !== true) → обробляються звичайно;
  - `deferred` (likelyNotMine === true) → НЕ обробляються, кладуться у
    `result.pendingReview` (повними об'єктами).
- `skipped` не змінюється для likelyNotMine — окрема корзина.
- Експорт `processDeferredCases(ecitsCases, deps)` — та сама `processCase`-петля
  (винесена як спільна `runCases` для DRY, правило #11).
- ImportTab отримав секцію **«Можливо не ваші — оберіть, які додати»**:
  опт-ін (нічого не обрано за замовчуванням), кнопки «Додати обрані» /
  «Відхилити всі». Виклик `processDeferredCases` мерджить результат у
  показаний підсумок без повторного скрейпінгу.

### Зміна 4 — Дати справи зі списку кабінету

- Envelope несе `firstDocumentDate` / `lastDocumentDate` **пласко** (top-level
  per ecitsCase). Legal BMS мапить їх у `ecitsState.{firstDocumentDate, lastDocumentDate}`
  у `buildCreateCaseParams` (провенанс: знімок ЄСІТС, не плутати з `documents[]`).
- `buildDefaultEcitsState` (migrationService.js) розширено двома датами =`null`.
- `migrateToVersion12` дотягує дві дати у `ecitsState` усіх існуючих справ,
  не перетираючи вже виставлені значення.
- `caseSchema.js`: опис двох дат у `ecitsState.schema` доданий з поясненням
  семантики (правило #11).

### Зміна 5 — Робастність envelope (§11)

- `normalizeEnvelope(raw)` — новий чистий хелпер. Викликається ПЕРШИМ у
  `submitScenarioResult`, ПЕРЕД `validateEnvelope`:
  - обгортка `data` якщо її нема, але `cases` на top-level (тип помилки чату);
  - дефолти `envelopeVersion / scenarioId / scenarioVersion` якщо відсутні;
  - `data.warnings` — кожен елемент coerce до **рядка**
    (об'єкт `{case_no, message}` → `"<case_no>: <message>"`); **це прямо усуває
    React error #31**;
  - `data.skipped` — нормалізація до `{case_no, reason}` (рядки);
  - `data.cases` — гарантується масив.
  - кожна правка пише рядок у `result.warnings`.
- `validateEnvelope` лишається строгим, але повідомлення мають підказку про
  очікувану форму (`{ envelopeVersion, scenarioId, data: { cases } }`).
- `ImportTab` має `coerceToString` — гарантує що `warnings`/`skipped`/`errors`
  рендеряться як рядки навіть якщо прийшли об'єктами (defence in depth).
- `buildEnvelopeSkeleton()` + експортовані константи (`ENVELOPE_VERSION`,
  `SCENARIO_ID`, `SCENARIO_VERSION`, `ADVOCATE_ROLE_VALUES`,
  `ENVELOPE_CATEGORY_VALUES`) — єдине джерело контракту для дзеркалення у
  розширення (анти-розсинхрон).
- **Golden-fixture** `tests/fixtures/ecits_envelope_2026-06-09.json` —
  представницький envelope, що вкриває ВСІ нові поля (ролі-масив, нові
  категорії, null-категорія, likelyNotMine, дати) + два skipped зі сторінки
  фільтра. Тест `court-sync-mvp.test.js` проганяє його через
  normalize→validate→submitScenarioResult, перевіряє 0 ручних правок і 0
  втрат даних. Реальний 50-справ envelope замінить файл у тому ж тесті.

---

## 2. Файли під зміну

| Файл | Зміна |
|------|-------|
| `src/services/ecits/scenarioProcessor.js` | Повне переписування: словники-константи, `normalizeEnvelope`, `validateEnvelope` з підказками, `resolveAdvocateRoles`, `resolveCaseCategory`, `buildCreateCaseParams` (повертає `{params, warnings}`), `buildEnvelopeSkeleton`, спільна `runCases` (DRY), партиціонування `likelyNotMine`, `result.pendingReview`, експорт `processDeferredCases`. |
| `src/schemas/caseSchema.js` | `category` nullable +commercial +administrative_offense; нові top-level `advocateRole`, `advocateRoles[]`; опис `ecitsState.firstDocumentDate/lastDocumentDate`; `CURRENT_CASE_SCHEMA_VERSION = 12`. |
| `src/services/migrationService.js` | `CURRENT_SCHEMA_VERSION=12`, `MIGRATION_VERSION='12.0_ecits_roles_dates'`; `migrateToVersion12` (ідемпотентна, з прапором + console-логом); `buildDefaultEcitsState` +дві дати; `ensureCaseSaasAndEcitsFields` +дефолти v12 (ролі + дати), без перетирання виставлених. `labelForVersion` оновлено. |
| `src/services/driveService.js` | Новий `backupRegistryDataPreV12(token, payload)` — бекап у `_backups/` поза ротацією. |
| `src/App.jsx` | Імпорт `migrateToVersion12` і `backupRegistryDataPreV12`. EFFECT-A: pre-v12 бекап (із прапором `levytskyi_pre_v12_backup_done` проти повтору) + `migrateToVersion12` після `migrateToVersion11`. `splashRestoreFromBackup` теж дотягує v12. |
| `src/components/CourtSync/ImportTab.jsx` | Пікер `PendingReviewPicker` (опт-ін), `togglePending`, `handleAddSelectedDeferred` (виклик `processDeferredCases` + мердж результату), `handleDismissDeferred`. `ResultCard` показує метрику «Можливо не ваші» якщо є pendingReview. `coerceToString` на warnings/errors. |
| `src/services/ecits/promptBuilder.js` | (Track A — вторинне) Шаблон envelope оновлено новим словником ролей (11), розширеним enum категорій, полями `advocateRoles[]`, `likelyNotMine`, `firstDocumentDate/lastDocumentDate`. Інструкція для `representative_unspecified` + `likelyNotMine=true` замість `skipped`. Версії envelope лишаються 1/1. |
| `CLAUDE.md` | Версія `5.9`, дата `09.06.2026`, schemaVersion `12`, settingsVersion `12.0_ecits_roles_dates`. Рядок про ланцюг міграцій оновлений: дев'ять → десять кроків, додано `migrateToVersion12`. |

---

## 3. Тести

| Файл | Що додано |
|------|-----------|
| `tests/unit/scenarioProcessor.test.js` | Оновлено існуючі (нова форма `buildCreateCaseParams.return = {params, warnings}`). Нові describe: контракт-константи (3 теста), `resolveAdvocateRoles` (5), `resolveCaseCategory` (5), дати → ecitsState (2), партиціонування `likelyNotMine` + `processDeferredCases` (5), `normalizeEnvelope` (5). Усього +25 кейсів. |
| `tests/unit/migrations.test.js` | Новий блок `migrateToVersion12` (12 тестів): ідемпотентність, дефолти на старих справах із/без ecitsState, fallback `advocateRoles=[advocateRole]`, не перетирання, lastMigration, `ensureCaseSaasAndEcitsFields` для нових справ. Оновлено старі асерти таргета (v11→v12). |
| `tests/integration/court-sync-mvp.test.js` | Новий describe `TASK v12 — Court Sync MVP з розширеним контрактом` (7 тестів): наскрізний імпорт нового envelope (ролі multi, дати, нові категорії, мапа administrative→admin), `processDeferredCases` для відкладеної справи, зворотна сумісність старого envelope. + **golden-fixture тест**. |
| `tests/unit/ImportTabPendingReview.test.jsx` | НОВИЙ файл, 4 теста: пікер рендериться при `pendingReview.length > 0`, опт-ін поведінка (disabled-кнопка без галочок), мердж після `processDeferredCases`, захист рендеру об'єктів у warnings/errors. |
| `tests/fixtures/ecits_envelope_2026-06-09.json` | Новий golden fixture (9 справ): покриває всі 11 ролей у різних комбінаціях, всі 6 категорій + null, обидві дати з реалістичними значеннями, одну `likelyNotMine=true` справу, skipped зі сторінки фільтра. Реальний 50-case envelope замінить його у тому ж тесті без зміни коду. |
| Оновлено таргет-асерти (`canonicalSchemaV7.test.js`, `founderFlag.test.js`) | З `CURRENT_SCHEMA_VERSION=11` → `12`, з `11.0_text_variants` → `12.0_ecits_roles_dates`, `CURRENT_CASE_SCHEMA_VERSION=7` → `12`. |

**`npm test`** : `Test Files 164 passed (164)`, `Tests 2092 passed (2092)`.
CI-блокування зеленим.

---

## 4. SAAS / BILLING / SEMANTIC CLARITY — відповідність §9 спеки

### SAAS IMPLICATIONS
- Нові case-поля (advocateRole/advocateRoles + дві дати у ecitsState) —
  без власного `tenantId` (успадковують від справи), без дублювання userId.
- Пікер «Можливо не ваші» — той самий ImportTab, без нового UI ролей чи
  користувачів.
- `processDeferredCases` працює через те саме `executeAction` →
  permission-шов лишається активним.

### BILLING IMPLICATIONS
- `processDeferredCases` ганяє `create_case` з `origin='ecits_import'` →
  білінг автоматично виключає (hook у actionsRegistry.js). Пікер — дія
  адвоката, але створення лишається системним імпортом.
- `add_hearing` з `source='court_sync'` — теж не нараховується (R5 fix
  лишається активним).
- Нових точок інструментації немає.

### SEMANTIC CLARITY CHECK (правило #11)
Кожне нове ім'я — один сенс:
- **Ролі — top-level** (`case.advocateRole/advocateRoles`), бо стабільний
  атрибут справи; не в `ecitsState` (transient sync-стан).
- **Дати кабінету — `ecitsState.{firstDocumentDate,lastDocumentDate}`**
  (знімок ЄСІТС), не top-level — щоб не зіткнутися сенсом із `case.documents[]`.
- **`likelyNotMine` — envelope-only**, на справу не зберігається (import-time
  тріаж, не атрибут справи).
- **`administrative` → `admin`** через мапу (звести два імені одного сенсу).
- **`administrative_offense` ≠ `administrative`** — різні юрисдикції, окремі
  значення (адмінсуд vs адмінправопорушення).

---

## 5. Що навмисно НЕ зроблено (закладки / межі)

- **BUG-1 (read-after-write / заморожений `getCases`)** — не виправляв (окремий
  FIX-TASK). Прод-семантика тестів збережена.
- **`window.LegalBMS.getCasesList()`** — не реалізовано (§10 спеки —
  лише архітектурна закладка).
- **Бамп `envelopeVersion`/`scenarioVersion`** — НЕ зроблено (адитивні зміни).
- **Семантика `case.team[]`** — не чіпав.
- **Активація `metadata_extractor_agent`** — не активував.
- **Перейменування `client`/`judges`** — лишається у `tracking_debt`.
- **`window.LegalBMS.getCasesList()`** — лише закладка, не реалізую.

---

## 6. Критерій готовності

- ✅ Усі 5 змін реалізовані адитивно, зворотно сумісно.
- ✅ `npm test` повністю зелений (2092/2092).
- ✅ Міграція 12 ідемпотентна, з бекапом `registry_data_backup_pre_v12_*.json`
  у `_backups/`, із прапором `levytskyi_pre_v12_backup_done`.
- ✅ Старий envelope лишається валідним (інтеграційний тест зворотної
  сумісності зелений).
- ✅ Новий envelope (golden fixture) проходить наскрізь без ручного
  перепакування і без втрат — нормалізаційних попереджень нема для канонічного
  envelope.
- ✅ Реальний 50-справ envelope замінить fixture у тому ж тесті без зміни
  коду — все що для цього треба, це покласти новий файл за тим самим шляхом.

---

## 7. Очікую від адвоката

Перед push у `main` — коротке (одне речення) підтвердження. Це зміни КОДУ
(тригерять CI + деплой GitHub Pages), правило #1 вимагає підтвердження.

Після підтвердження: `git push origin main` (fast-forward на чистій трі).
