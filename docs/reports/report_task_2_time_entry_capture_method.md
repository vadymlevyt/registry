# REPORT — TASK 2: time_entry.source → time_entry.captureMethod

**Дата:** 15.05.2026
**Тип:** рефакторинг імені поля + міграція даних (v7 → v8)
**Статус:** виконано, чекає підтвердження на push у main (правило #1 — код-зміна)

---

## ЩО ЗРОБЛЕНО

Поле `time_entry.source` перейменовано на `time_entry.captureMethod` у всіх write-сайтах + міграція v8 + lazy-on-load нормалізація архівів. Слово `source` у системі тепер однозначне — завжди «канал походження» (document/hearing/parties); спосіб фіксації часу — окреме ім'я `captureMethod` (правило #11). `document.source` / `hearing.source` / `note.source` не зачеплені.

**Інвентаризація (КРОК 1) виявила:** 4 write-сайти (не 3 — `importLegacyTimeLog` теж пише), **нуль read-сайтів** (ніде в коді не читається `time_entry.source` для логіки/UI/фільтрів — підтверджено grep по timeEntriesQuery/Archiver/masterTimer/smartReturnHandler/Dashboard/App.jsx).

## ФАЙЛИ МОДИФІКОВАНІ (з кількістю замін)

| Файл | Замін | Що саме |
|------|-------|---------|
| `src/services/activityTracker.js` | 2 | :130 `source:context.source\|\|'instrumentation'` → `captureMethod:context.captureMethod\|\|'instrumentation'` (центральний builder time_entry); :312 `source:'manual_assign'` → `captureMethod:'manual_assign'` (assignOfflinePeriod) |
| `src/App.jsx` | 4 | imports +`migrateToVersion8`,+`backupRegistryDataPreV8`; `add_time_entry` param `source='manual'`→`captureMethod='manual'` + entry `captureMethod:captureMethod\|\|'manual'`; EFFECT-A головний шлях +pre-v8 backup +`migrateToVersion8`; restore-шлях +`migrateToVersion8` |
| `src/services/migrationService.js` | — | header-коментар +schemaVersion 8; chain-коментар +`→ migrateToVersion8`; `CURRENT_SCHEMA_VERSION` 7→8; `MIGRATION_VERSION` →`'8.0_time_entry_capture_method'`; `importLegacyTimeLog` `source:'legacy_import'`→`captureMethod:'legacy_import'`; +`export function migrateToVersion8` |
| `src/services/driveService.js` | — | +`export async function backupRegistryDataPreV8` (дзеркало preV7) |
| `src/services/timeEntriesArchiver.js` | 2 | +`export function normalizeArchivedTimeEntries`; `loadArchive` загортає `JSON.parse(content)` у нормалізатор перед кешуванням |
| `tests/unit/migrations.test.js` | — | import +`migrateToVersion8`; +describe з 5 it (rename/ідемпотентність/без time_entries/noField) |
| `tests/unit/canonicalSchemaV7.test.js` | 3 it | застарілі асерції глобального таргета 7→8 (наслідок бампу, не девіація) |
| `tests/unit/founderFlag.test.js` | 2 it | те саме — глобальний таргет 7→8 |
| `tracking_debt.md` | +1 | запис #6 (enum doc-drift); #5 шлях звіту уточнено |

## ФАЙЛИ СТВОРЕНІ

- `tests/unit/timeEntriesArchiverNormalize.test.js` — 4 it на чисту функцію `normalizeArchivedTimeEntries`.
- `docs/reports/report_task_2_time_entry_capture_method.md` — цей звіт.

## ЗНАЧЕННЯ `captureMethod` ПІСЛЯ RENAME

Це rename **ПОЛЯ, не значень**. Значення лишаються ті що були (інвентаризація показала фактичні, а НЕ задокументований у CLAUDE.md перелік): `'instrumentation'` (дефолт центрального builder'а), `'manual_assign'` (offline-період), `'manual'` (дефолт `add_time_entry`), `'legacy_import'` (імпорт legacy timelog), + будь-яке що caller передасть через `context.captureMethod`. Задокументований enum `timer\|manual\|agent\|import\|legacy` — doc-drift, не відповідає коду → `tracking_debt.md` #6 (виправлення — окремий doc-sync TASK, CLAUDE.md у TASK 2 чіпати заборонено).

## LAZY-ON-LOAD ДЛЯ АРХІВІВ

Архівні файли `_archives/time_entries_YYYY-MM.json` **НЕ переписуються** міграцією. Чиста ідемпотентна `normalizeArchivedTimeEntries(entries)` у `timeEntriesArchiver.js`: для кожного запису — якщо є `captureMethod` лишає (і прибирає stray `source`); якщо є `source` без `captureMethod` → `{...rest, captureMethod: source}`; інакше без змін. `loadArchive` застосовує її одразу після `JSON.parse`, перед кешуванням — старі архіви читаються прозоро, нові пишуться вже з `captureMethod` (бо живі записи перейменовані). Тестовано напряму як чисту функцію (без моку Drive).

## ВІДХИЛЕННЯ ВІД ПЛАНУ (з поясненнями)

1. **4-й write-сайт `importLegacyTimeLog` (план перелічив 3 ймовірні файли).** Grep показав що `migrationService.importLegacyTimeLog` теж ставить `source:'legacy_import'` на time_entry. Перейменовано (`metadata.legacySource` — НЕ чіпав: це namespaced metadata самого legacy-запису, не неоднозначне поле). Без цього rename був би неповним.
2. **«Fallback-warn на невідоме значення source» — НЕ реалізовано, свідомо.** План просив warn на unknown value. Але (а) це rename ключа, не нормалізація значень; (б) задокументований enum — doc-drift, валідація проти нього зіпсувала б легітимні значення (`instrumentation`/`manual_assign`/…). Замість value-warn міграція логує осмислену статистику (renamed/already/noField). Зафіксовано як знахідку + `tracking_debt.md` #6.
3. **КРОК 5 (UI label) — пропущено, підтверджено.** Інвентаризація: `time_entry.source` ніде не читається для відображення (нуль read-сайтів). UI з цим label не існує — нічого оновлювати.
4. **Звіт у `docs/reports/`, не в корені.** Спека TASK 2 казала «у корені репозиторію» — застаріло після реорганізації документації (PR #44). CLAUDE.md v5.5 конвенція: жодних нових `.md` у корені, звіти → `docs/reports/`. Дотримано конвенції/прямої вказівки користувача, не застарілої спеки.
5. **`context.source` → `context.captureMethod` у activityTracker:130.** Перейменовано і ключ контексту-аргумента (не лише поле запису) для консистентності. Безпечно: grep підтвердив що **жоден caller не передає `context.source`** (поле завжди дефолтилось). Якщо десь пропущений caller — деградація до дефолту `'instrumentation'`, не падіння.
6. **5 існуючих тестів оновлено (canonicalSchemaV7/founderFlag).** Вони асертили глобальний таргет ланцюга `CURRENT_SCHEMA_VERSION===7`/`MIGRATION_VERSION`/`buildEmptyRegistry→v7`. TASK 2 легітимно бампить таргет до 8 — це **вимога спеки** («CURRENT_SCHEMA_VERSION=8», «усі тести проходять»), не девіація. Оновлено значення + мінімально лейбли (щоб не брехали). v7-крок-специфічні тести (`migrateToVersion7` поведінка) — НЕ чіпав, проходять.

Жодне рішення не виходить за scope; рамкові — винесені явно вище.

## ACCEPTANCE CRITERIA — СТАТУС

| Критерій | Статус |
|----------|--------|
| Жодного `time_entry...source` у коді (тільки captureMethod) | ✅ grep residue порожній |
| document.source / hearing.source / note.source не зачеплені | ✅ documentSchema/hearingSchema `source` цілі; CaseDossier:1328 `note.source:"manual"` ціле |
| Міграція ідемпотентна + покрита тестом | ✅ `migrateToVersion8` (fromVersion>=8 → no-op; запис-рівень ідемпотентний); 5 тестів |
| Старі архіви через lazy-on-load | ✅ `normalizeArchivedTimeEntries` у `loadArchive`; 4 тести; архіви не переписуються |
| Бекап `_backups/registry_data_backup_pre_v8_<ts>.json` | ✅ `backupRegistryDataPreV8` + flag `levytskyi_pre_v8_backup_done` у EFFECT-A |
| `CURRENT_SCHEMA_VERSION = 8` | ✅ migrationService.js:65 |
| `MIGRATION_VERSION` оновлено | ✅ `'8.0_time_entry_capture_method'` |
| Усі існуючі тести проходять | ✅ 1092/1092 |
| Нові тести (міграція + lazy-on-load) зелені | ✅ +9 (5 міграція, 4 нормалізатор) |
| `npm test` зелений | ✅ 65 files / 1092 tests |
| `npm run build` (CI parity) | ✅ build OK (попередження chunk-size — пре-існуюче) |
| Правило #1 | ⏳ зведення нижче, чекає підтвердження перед main |

## ТЕСТИ: ДО / ПІСЛЯ

| | До TASK 2 | Після |
|--|-----------|-------|
| Test files | 64 | 65 (+`timeEntriesArchiverNormalize.test.js`) |
| Tests | 1083 | **1092** (+9 нових; 5 існуючих оновлено in-place) |
| Статус | зелений | зелений; build OK |

## ЧИ БУВ UI З `source` LABEL

Ні. `time_entry.source` ніде не читалось (нуль read-сайтів у Dashboard/activity-views/query/archiver) — KROK 5 пропущено правомірно.

## ПОБІЧНІ ЗНАХІДКИ

1. **Enum doc-drift** (детально вище / `tracking_debt.md` #6): задокументований `timer\|manual\|agent\|import\|legacy` ≠ фактичні `instrumentation\|manual_assign\|manual\|legacy_import\|caller`. Не виправляв (CLAUDE.md поза scope) — окремий doc-sync TASK.
2. `split_time_entry` (App.jsx:5184) робить `{...orig}` spread — дочірні записи успадковують `captureMethod` батька автоматично (семантично коректно: спліт зберігає спосіб фіксації оригіналу). Жодної правки не потребувало.
3. Часотворчі ACTIONS `confirm_event`/`add_travel`/`start_external_work`/`track_session_*` НЕ ставлять `source` напряму — йдуть через `activityTracker.report` (рядок 130), тож rename там покриває їх автоматично. Перевірено.

## ПІДТВЕРДЖЕННЯ НЕЗАЧЕПЛЕНОСТІ

`document.source` (documentSchema.js), `hearing.source` (hearingSchema.js), `case.parties[].source`/`processParticipants[].source` (caseSchema.js), `note.source` (CaseDossier:1328, App.jsx note-creation) — **не зачеплені** (grep підтвердив `source` у схемах цілий; `note.source:"manual"` ціле). `EDIT_ACTIONS_SOURCE_AWARE` / `update_*` source-aware ACTIONS — не чіпав (це document/case origin-channel). `sourcePolicy`/`documentSources`/`ecitsSource`/`alternativeSources`/`sourceConfidence` — поза scope, незмінні. Жодних нових ACTIONS/permissions/eventBus-подій. CLAUDE.md не редагувався (тільки `tracking_debt.md` — живий довідник, дозволено конвенцією).
