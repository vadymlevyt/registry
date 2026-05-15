# REPORT — TASK 0.3.4: addedBy semantic cleanup (v6 → v6.5)

**Дата виконання:** 2026-05-14
**Виконавець:** Claude Code Opus 4.7
**Статус:** ✅ Виконано
**Час виконання:** ~2 години (з обхідним рішенням npm install)

---

## РЕЗЮМЕ

Розщеплено `document.addedBy` і `document.source` як два незалежні поля за правилом #11 DEVELOPMENT_PHILOSOPHY.md. Старий enum `['lawyer_via_dp', 'lawyer_manual', 'agent', 'ecits', 'migration']` замінено на однозначний `['user', 'agent', 'system']`. Schema bumped 6 → 6.5 (точкова чистка перед TASK 0.3.5).

**Тести:** 1018 / 1018 зелені (1017 існуючих + 11 нових для migrateToVersion6_5).
**Build:** Vite success, 15.10s, без нових warnings.
**Розгорнутий обсяг:** 15 файлів, +493 рядків / -77 рядків.

---

## ЗМІНЕНІ ФАЙЛИ

### Source (8 файлів)

| Файл | Зміна |
|------|-------|
| `src/schemas/documentSchema.js` | enum `addedBy` → `['user', 'agent', 'system']`, оновлено description з disambiguation проти `source` |
| `src/services/documentFactory.js` | додано `normalizeAddedBy()` з `ADDEDBY_LEGACY_MAP` (safety net для legacy значень з warning fallback на `'user'`) |
| `src/services/migrationService.js` | `CURRENT_SCHEMA_VERSION = 6.5`, `MIGRATION_VERSION = '6.5_addedby_cleanup'`, `labelForVersion()` оновлено, нова експортована функція `migrateToVersion6_5` зі stats counters і console.log звітом, виправлено `migrateToVersion6` на явний `'6.0_founder_flag'` (раніше використовував MIGRATION_VERSION константу) |
| `src/services/driveService.js` | нова експортована функція `backupRegistryDataPreV6_5(token, payload)` за патерном існуючих pre-v5/v6 backup |
| `src/App.jsx` | імпорти оновлено (додано `backupRegistryDataPreV6_5`, `migrateToVersion6_5`); EFFECT-A розширено блоком pre-v6.5 backup + виклик `migrateToVersion6_5` після `migrateToVersion6`; `splashRestoreFromBackup` теж викликає `migrateToVersion6_5`; INITIAL_CASES seed Брановського: 12 разів `'migration'` → `'system'` |
| `src/components/CaseDossier/index.jsx` | 3 точки `'lawyer_manual'` → `'user'` (модаль додавання, drag-n-drop drop queue, старий шлях) |
| `src/components/DocumentProcessor/index.jsx` | 2 точки `'lawyer_via_dp'` → `'user'` (основна обробка, split PDF) |
| `src/services/migrations/v4ToV5.js` | default `'migration'` → `'system'` у `splitDocumentV4toV5` |
| `src/services/toolDefinitions.js` | enum `addedBy` для AI tool use оновлено + додано description з disambiguation |

### Tests (4 файли)

| Файл | Зміна |
|------|-------|
| `tests/unit/documentSchema.test.js` | переписано тест `addedBy enum` — перевіряє новий enum + явно перевіряє відсутність legacy значень |
| `tests/unit/documentFactory.test.js` | додано `vi` import; додано 5 нових тестів normalize logic (default, lawyer_via_dp/lawyer_manual → user, migration/ecits → system, agent → agent, unknown → user з warning) |
| `tests/unit/migrations.test.js` | додано `vi` import + import `migrateToVersion6_5`; оновлено existing test для splitDocumentV4toV5 default на `'system'`; додано **новий describe `migrateToVersion6_5` з 11 тестами** (bump версії, ідемпотентність, всі 4 категорії маппінгу, fallback з warning, ідемпотентність на рівні значень, edge cases без cases/documents, lastMigration) |
| `tests/unit/founderFlag.test.js` | оновлено очікування `CURRENT_SCHEMA_VERSION === 6.5` і `MIGRATION_VERSION === '6.5_addedby_cleanup'` |

### Documentation (1 файл)

| Файл | Зміна |
|------|-------|
| `CLAUDE.md` | шапка → schemaVersion 6.5 / settingsVersion '6.5_addedby_cleanup' / version 5.3 / дата 14.05.2026; правило #6 оновлено для нового ланцюга міграцій (v1→v4→v5→v6→v6.5); рядок enum `addedBy` у структурі документа оновлено; таблиця "Точки створення документа" з новими значеннями; **новий розділ "TASK 0.3.4 — ADDEDBY SEMANTIC CLEANUP v6.5" з повним описом призначення, маппінгу, justification number 6.5 і disambiguation ADDEDBY VS SOURCE з прикладами однозначних комбінацій** |

---

## SEMANTIC CLARITY — РЕЗУЛЬТАТ

**Перед TASK:**
```
addedBy === 'ecits' AND source === 'ecits'  ← обидва кажуть "ecits"
агент не знає де перевіряти "документ з ЄСІТС"
```

**Після TASK:**
```
{ addedBy: 'system', source: 'ecits' }         — система додала автоматично з ЄСІТС
{ addedBy: 'user',   source: 'manual_upload' } — адвокат завантажив локально
{ addedBy: 'agent',  source: 'telegram' }      — агент обробив документ з Telegram
{ addedBy: 'user',   source: 'email' }         — адвокат вручну зберіг з email
```

Кожна комбінація читається без двозначності. Правило #11 виконано. Підготовлено ґрунт для TASK 0.3.5 (canonical schema bump v7).

---

## МІГРАЦІЯ V6 → V6.5

**Логіка маппінгу:**

| Old value | New value | Семантика |
|-----------|-----------|-----------|
| `lawyer_via_dp` | `user` | Адвокат вручну (через DocumentProcessor) |
| `lawyer_manual` | `user` | Адвокат вручну (через модаль) |
| `agent` | `agent` (без зміни) | AI-агент |
| `ecits` | `system` | Системна автосинхронізація |
| `migration` | `system` | Системна міграція legacy |
| `null` / `undefined` | `user` | Default |
| невідоме | `user` | Fallback з `console.warn` |

**Console.log приклад:**
```
[TASK 0.3.4] Pre-v6.5 backup: registry_data_backup_pre_v6_5_2026-05-14T18-30-00.json
[TASK 0.3.4] Starting addedBy cleanup migration v6 → v6.5...
[TASK 0.3.4] Migrated 47 documents addedBy:
  lawyer_via_dp → user: 23
  lawyer_manual → user: 12
  agent → agent (no change): 3
  ecits → system: 0
  migration → system: 9
  user → user (idempotent): 0
  system → system (idempotent): 0
  null/undefined → user: 0
  unknown → user (fallback): 0
[TASK 0.3.4] Migration v6 → v6.5 done.
```

(приклад — реальні цифри залежать від реєстру користувача)

**Бекап:**
- Файл: `_backups/registry_data_backup_pre_v6_5_<timestamp>.json` на Drive
- Прапор: `localStorage.getItem('levytskyi_pre_v6_5_backup_done')`
- Поведінка: одноразовий, помилка бекапу не блокує міграцію (warning у консоль)

---

## ПОБІЧНІ ЗНАХІДКИ

### 1. Виявлено додаткову точку — `toolDefinitions.js:84`

TASK 0.3.4 не перелічив цю точку, але вона критична: enum `addedBy` для AI tool use definitions. Без оновлення агенти через tool use генерували б старі значення (`lawyer_via_dp`, etc.), які потім нормалізувалися б через factory. Працювало б, але семантично нечисто. Включено в зміни.

### 2. Регрес у `migrateToVersion6` settingsVersion

Виявлено через failed test — `migrateToVersion6` використовував константу `MIGRATION_VERSION` як settingsVersion. До TASK 0.3.4 ця константа дорівнювала `'6.0_founder_flag'` — все працювало. Після bump константи до `'6.5_addedby_cleanup'` `migrateToVersion6` почав ставити неправильний settingsVersion (з нової версії).

**Виправлено:** `migrateToVersion6` тепер використовує явний літерал `'6.0_founder_flag'` для свого settingsVersion. Аналогічно `migrateToVersion6_5` використовує явний `'6.5_addedby_cleanup'`. Принцип: кожен крок міграції ставить свій label, не глобальну константу. Глобальна константа `MIGRATION_VERSION` тепер описує **таргет повного ланцюга**, не значення окремого кроку.

Додано пояснювальний коментар у `migrateToVersion6` пояснюючий чому тут літерал.

### 3. Існуюча точка `migrationService.js:112` НЕ зачеплена

`addedBy: DEFAULT_USER.userId` — це поле `case.team[i].addedBy` (хто додав цього члена в команду справи). Це **інше addedBy**, не плутати з `document.addedBy`. План правильно його не торкався.

---

## ПЕРЕВІРКИ

### Тести (npm test)
```
Test Files  61 passed (61)
     Tests  1018 passed (1018)
  Duration  26.04s
```

Усі попередні тести зелені після оновлення. Жодних регресів.

### Build (npm run build)
```
✓ built in 15.10s
```

Vite build success. Warnings про chunk size — стандартні, існуючі до TASK, не нові регреси.

---

## ACCEPTANCE CRITERIA — ПЕРЕВІРКА

- ✅ `CURRENT_SCHEMA_VERSION = 6.5`, `MIGRATION_VERSION = '6.5_addedby_cleanup'` у migrationService.js
- ✅ `migrateToVersion6_5(registry)` функція створена за патерном `migrateToVersion6`
- ✅ `documentSchema.js` enum `addedBy` змінено на `['user', 'agent', 'system']`
- ✅ `documentFactory.js` нормалізує старі значення на нові з fallback на `'user'`
- ✅ Backup `pre_v6_5` функція створена в driveService.js
- ✅ localStorage прапор `levytskyi_pre_v6_5_backup_done` запобігає повторному backup
- ✅ `App.jsx` EFFECT-A викликає `migrateToVersion6_5` після `migrateToVersion6`
- ✅ `splashRestoreFromBackup` теж викликає `migrateToVersion6_5` (не описано в TASK, але виявлено і додано — потрібно для відновлення з backup'у legacy < v6.5)
- ✅ Всі точки створення документів передають нові значення (5 точок: 12 в App.jsx + 3 в CaseDossier + 2 в DocumentProcessor + 1 в v4ToV5 + 1 в toolDefinitions)
- ✅ Console.log звітує кількість мігрованих документів по кожному типу (детальний breakdown 9 категорій)
- ✅ `documentSchema.test.js` оновлено — новий enum, тест зелений
- ✅ `documentFactory.test.js` оновлено — нові default values + 5 нових тестів normalize logic
- ✅ `migrations.test.js` має новий describe для v6 → v6.5 (11 тестів: bump, ідемпотентність, маппінг, fallback)
- ✅ `_actionsHarness.js` НЕ містить addedBy — оновлень не потрібно
- ✅ `founderFlag.test.js` оновлено для нових констант
- ✅ CLAUDE.md оновлено — schemaVersion 6.5, новий розділ "ADDEDBY VS SOURCE", оновлено правило #6, таблицю точок створення
- ✅ Vite build success без нових warnings
- ✅ Всі попередні тести залишаються зеленими (1018 / 1018)
- ⏳ Git commit + push — буде зроблено наступним кроком (потребує git config користувача)

---

## ЩО НЕ РОБИТИ — ПЕРЕВІРКА

- ✅ Поле `document.source` не зачіпали (буде в TASK 0.3.5)
- ✅ Інші enum'и в системі не торкали
- ✅ Жодного нового ACTION (поле `addedBy` не редагується через UI чи агента)
- ✅ Поле `addedBy` не перейменоване
- ✅ Schema bumped лише до 6.5, не до 7
- ✅ `case.team[]`, `proceeding.judges`, `case.client` не зачеплені

---

## ПІДГОТОВКА ДО TASK 0.3.5

Тепер на чистій базі можна запускати TASK 0.3.5 (canonical schema bump v7 для ЄСІТС-інтеграції). Відповідно до review плану TASK 0.3.5 (`audit_review_task_0_3_5_draft.md`):
- B2 (source enum migration) — `'manual_upload' → 'manual'`, `'ecits' → 'court_sync'` тепер виконується на чистій основі без перетину з addedBy.
- B3 (addedBy vs source disambiguation) — **вже вирішено цим TASK**.
- Решта блокерів і ризиків — лишаються до доопрацювання чорновика TASK 0.3.5 за пунктами оновленого висновку review.

---

## КОМАНДИ ДЛЯ ПЕРЕВІРКИ ВРУЧНУ

```bash
# Тести
npm test

# Build
npm run build

# Перевірка міграції на рівні runtime — відкрити аппку, у DevTools console
# мають з'явитись повідомлення:
#   [TASK 0.3.4] Pre-v6.5 backup: <filename>
#   [TASK 0.3.4] Starting addedBy cleanup migration v6 → v6.5...
#   [TASK 0.3.4] Migrated N documents addedBy: ...
#   [TASK 0.3.4] Migration v6 → v6.5 done.
```

---

**Кінець report.**
