# Звіт — TASK 0.1 Founder Flag

**Дата:** 2026-05-10
**Schema:** v5 → v6 (`6.0_founder_flag`)
**Статус:** ✅ виконано

---

## Архітектурна корекція

TASK очікував `schemaVersion 4 → 5` з міткою `5.0_founder_flag`. Але `schemaVersion 5` уже зайнятий канонічною схемою документів (`5.0_canonical_documents` через `migrations/v4ToV5.js`). За погодженням з адвокатом — bump до **v6** з міткою **`6.0_founder_flag`**, щоб не порушити правило №11 про однозначність версій.

`migrationService.js` тепер виглядає так:

| Константа | Значення | Призначення |
|---|---|---|
| `BASE_CHAIN_VERSION` | 4 | Таргет, до якого піднімає `migrateRegistry` (базовий ланцюг v1→v4) |
| `BASE_CHAIN_LABEL` | `'4.0_billing_foundation'` | Мітка базового ланцюга |
| `CURRENT_SCHEMA_VERSION` | 6 | Найвища досяжна версія повного ланцюга |
| `MIGRATION_VERSION` | `'6.0_founder_flag'` | Мітка повного ланцюга |

Повний ланцюг: `migrateRegistry` (→ v4) → `migrateRegistryV4toV5` (→ v5) → `migrateToVersion6` (→ v6).

---

## Перелік змінених файлів

| Файл | Зміни |
|------|-------|
| `src/services/tenantService.js` | Додано `DEFAULT_USER.isFounder = true`; новий експорт `isCurrentUserFounder()` |
| `src/services/migrationService.js` | `CURRENT_SCHEMA_VERSION = 6`, `MIGRATION_VERSION = '6.0_founder_flag'`, нові `BASE_CHAIN_VERSION`/`BASE_CHAIN_LABEL`; нова функція `migrateToVersion6`; `migrateRegistry` тепер таргетить базовий ланцюг (v4); хелпер `labelForVersion` для коректного fallback settingsVersion |
| `src/services/driveService.js` | Новий експорт `backupRegistryDataPreV6` |
| `src/App.jsx` | Імпорт `migrateToVersion6` і `backupRegistryDataPreV6`; pre_v6 бекап + виклик міграції в EFFECT-A після v4→v5; також у `splashRestoreFromBackup` |
| `tests/unit/founderFlag.test.js` | Новий файл — 16 тестів (предикат, інтеграція з DEFAULT_USER, міграція, константи) |
| `CLAUDE.md` | Шапка оновлена до v6; правило №6 (schemaVersion); новий розділ «TASK 0.1 — FOUNDER FLAG v6.0» |

**Заплановано в TASK і не виконано (свідомо):**
- Не додано UI перемикач Practice/Founder
- Не створено `packageDefinitions.js`, `isEntitled()`, `tenant.accountTier`
- Не торкалися `tenant.subscription` (інші поля)

Розташування тестів: створено в `tests/unit/founderFlag.test.js` (відповідає конвенції CLAUDE.md секції «ТЕСТУВАННЯ»), а не в `src/services/__tests__/founderFlag.test.js` як було сформульовано в TASK. Вся test-інфраструктура проекту живе в `tests/`.

---

## Підтвердження міграції

### Сценарії, протестовані юніт-тестами

**migrateToVersion6 з v5 → v6:**
```js
const reg = { schemaVersion: 5, users: [{ userId: 'vadym' }, { userId: 'olena' }] };
const { registry, didMigrate, fromVersion, toVersion } = migrateToVersion6(reg);
// didMigrate === true
// fromVersion === 5, toVersion === 6
// registry.schemaVersion === 6
// registry.settingsVersion === '6.0_founder_flag'
// registry.users[0].isFounder === true   (vadym)
// registry.users[1].isFounder === false  (olena)
```

**Ідемпотентність:**
```js
const reg = { schemaVersion: 6, users: [{ userId: 'vadym', isFounder: true }] };
const res = migrateToVersion6(reg);
// res.didMigrate === false
// res.registry === reg (referential equality)
```

### Орієнтовний console.log при першому запуску

```
[TASK 0.1] Pre-v6 backup: registry_data_backup_pre_v6_2026-05-10T12-34-56.json
[TASK 0.1] Migration v5 → v6 done. isFounder проставлено.
```

---

## Результат тестів

```
 Test Files  37 passed (37)
      Tests  452 passed (452)
   Duration  37.98s
```

`tests/unit/founderFlag.test.js`: 16 тестів — усі зелені.
`npm run build`: чистий, без помилок.

---

## Знайдені побічні ефекти

Жодних побічних багів не знайдено. `bugs_found_during_task_0_1.md` не створено.

Дрібний side-effect: `migrateRegistry` тепер фіксує `toVersion` на `BASE_CHAIN_VERSION` (v4) замість `CURRENT_SCHEMA_VERSION`. Це коректна поведінка — `migrateRegistry` сам по собі не доводить до v6, фінальну версію встановлюють наступні кроки оркестрації. Жоден існуючий caller `toVersion` з результату `migrateRegistry` для логіки не використовував.

---

## Acceptance criteria

- ✅ users[].isFounder існує в схемі (DEFAULT_USER) і дефолт false для нових
- ✅ Хелпер isCurrentUserFounder() працює коректно у всіх 4 кейсах (true / false / undefined / null)
- ✅ Schema version 6
- ✅ Бекап перед міграцією створюється (`backupRegistryDataPreV6` + flag `levytskyi_pre_v6_backup_done`)
- ✅ Міграція проставляє vadym.isFounder = true, всім іншим false
- ✅ Тести зелені (452/452)
- ✅ CLAUDE.md оновлено
- ✅ Vite build чистий
- ✅ Існуючий функціонал не зламано (37/37 test files passed)
