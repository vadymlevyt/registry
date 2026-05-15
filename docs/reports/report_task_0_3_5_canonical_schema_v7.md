# REPORT — TASK 0.3.5: Canonical Schema v7 для ЄСІТС-інтеграції

**Дата виконання:** 2026-05-14
**Виконавець:** Claude Code Opus 4.7
**Статус:** ✅ Виконано
**Час виконання:** ~3 години

---

## РЕЗЮМЕ

Підготовлено канонічну схему системи до прийому даних з ЄСІТС-кабінету і інших каналів (Telegram, email, ручне введення, парсинг). Обидва канали (Court Sync і Metadata Extractor) пишуть у ту саму схему через ті самі ACTIONS — споживачі не розрізняють.

**Schema:** 6.5 → 7 (`'7.0_ecits_canonical'`)
**Тести:** 1073 / 1073 зелені (1018 попередніх + 55 нових для v7)
**Build:** Vite success, 13.67s, без нових warnings
**Файли:** 14 змінено + 6 створено (~1000 рядків нового коду)

---

## ЗМІНЕНІ ФАЙЛИ

### Source — створено (5)

| Файл | Призначення |
|------|-------------|
| `src/schemas/caseSchema.js` | Описова схема справи (canonical_case_fields + canonical_proceeding_fields). Документує team[] як internal bureau, processParticipants[] як процесуальні учасники. |
| `src/schemas/hearingSchema.js` | Описова схема засідання з v7 полями. Хелпер `isSystemSourced()`. |
| `src/services/sourcePolicy.js` | `SOURCE_PRIORITY`, `canOverwrite()`, `buildAlternativeSourceRecord()`, `hashData()`. |
| `src/services/metadataExtractor/README.md` | Папка-ембріон з повним описом (60+ рядків): призначення, зони відповідальності Court Sync vs Metadata Extractor, тригери активації, контракт ACTIONS, пріоритетизація. |
| `tests/unit/canonicalSchemaV7.test.js` | 55 нових тестів: schema, migration, sourcePolicy, schemas, eventBusTopics. |

### Source — модифіковано (10)

| Файл | Зміна |
|------|-------|
| `src/schemas/documentSchema.js` | `source` enum переписано (`manual_upload→manual`, `ecits→court_sync`, +`metadata_extractor`/`unknown`). Додано 5 нових полів: `sourceConfidence`, `extractedAt`, `ecitsSource`, `movementCard`, `alternativeSources`. Загалом 28 полів. |
| `src/constants/documentSources.js` | Повна заміна enum констант на v7 (6 каналів замість 4). |
| `src/services/documentFactory.js` | Додано `normalizeSource()` з fallback на `'unknown'` + warning. v7 поля з безпечними дефолтами у `createDocument()`. |
| `src/services/migrationService.js` | `CURRENT_SCHEMA_VERSION = 7`, `MIGRATION_VERSION = '7.0_ecits_canonical'`, `labelForVersion(7)`, нова функція `migrateToVersion7` (270 рядків зі stats counters і console.log звітом по 6 категоріях source migration). |
| `src/services/driveService.js` | Нова функція `backupRegistryDataPreV7` за патерном попередніх. |
| `src/services/eventBusTopics.js` | +8 топіків: 2 sync події (`ecits.sync_completed`, `ecits.case_state_updated`) + 6 edit-подій (parties, team, processParticipants, composition, movementCard, alternativeSource). `V7_EDIT_TOPICS` frozen array. |
| `src/services/tenantService.js` | `DEFAULT_USER` отримав `ecitsCabinetIdentifier: null` для multi-user dedupe в Court Sync. |
| `src/App.jsx` | Імпорти оновлено (eventBus, eventBusTopics, sourcePolicy). `add_hearing`/`update_hearing` розширено backward-compat. **8 нових ACTIONS** (mark_synced_from_ecits, update_case_ecits_state, 6 edit). 2 нові PERMISSIONS ролі (court_sync_agent active, metadata_extractor_agent disabled). `SYSTEM_ACTIONS_NO_BILLING` Set + `EDIT_ACTIONS_SOURCE_AWARE` Set винесено як константи. activityTracker-hook оновлено: системні ACTIONS і edit-ACTIONS з не-manual source НЕ нараховуються. EFFECT-A + splashRestoreFromBackup викликають `migrateToVersion7`. |

### Tests — модифіковано (4)

| Файл | Зміна |
|------|-------|
| `tests/unit/documentSchema.test.js` | 23 → 28 полів. Тест на v7 поля. |
| `tests/unit/documentFactory.test.js` | Source default `'manual'`. Тест normalizeSource. v7 поля з дефолтами. |
| `tests/unit/courtSyncInfrastructure.test.js` | Нові source enum значення. ECITS_TOPICS 4 → 6. |
| `tests/unit/founderFlag.test.js` | `CURRENT_SCHEMA_VERSION = 7`, `MIGRATION_VERSION = '7.0_ecits_canonical'`. |
| `tests/integration/_actionsHarness.js` | Додано 8 нових ACTIONS (спрощені реалізації для harness) + 2 нові ролі PERMISSIONS. |

### Documentation — модифіковано (1)

| Файл | Зміна |
|------|-------|
| `CLAUDE.md` | Шапка → schemaVersion 7, settingsVersion '7.0_ecits_canonical', версія 5.4. Правило #6 → ланцюг до v7. **Новий розділ "TASK 0.3.5 — CANONICAL SCHEMA V7 ДЛЯ ЄСІТС"** (~70 рядків): принцип, розширення схеми, source-policy, 8 нових ACTIONS, 2 нові PERMISSIONS ролі, billing виключення, AI-First дзеркало, tracking debt, заборонено. |

---

## НОВІ ACTIONS — СИГНАТУРИ

### Sync операції

```js
mark_synced_from_ecits({
  caseId,                       // обов'язково
  status,                       // 'synced' | 'partial' | 'failed', default 'synced'
  failureReason,                // string | null
  durationMs,                   // number | null
  documentsCount,               // number, default 0
  hearingsCount,                // number, default 0
})
// → { success, syncedAt }
// Інкрементує syncMetrics counters, публікує ECITS_SYNC_COMPLETED.

update_case_ecits_state({
  caseId,                       // обов'язково
  patch,                        // Partial<case.ecitsState>
  source,                       // обов'язково
})
// → { success, overwriteSkipped }
// Мерджить patch з canOverwrite-перевіркою. Публікує ECITS_CASE_STATE_UPDATED.
```

### Edit-ACTIONS (R1 AI-first дзеркало)

```js
update_parties({ caseId, parties, source })
// Replace-all процесуальних сторін.

update_team({ caseId, team })
// Replace-all internal bureau team. БЕЗ source (internal action).

update_process_participants({ caseId, participants, source })
// Replace-all процесуальних учасників (не внутрішня команда).

update_proceeding_composition({ caseId, proceedingId, composition, source })
// Оновлює composition конкретного провадження.

update_document_movement_card({ caseId, documentId, movementCard, source })
// Записує картку руху документа.

update_alternative_sources({ caseId, documentId, alternativeSource })
// Append до document.alternativeSources[]. dataHash будується автоматично.
```

Усі публікують відповідну подію в eventBus з `tenantId` у payload.

---

## МІГРАЦІЯ V6.5 → V7

### Логіка `migrateDocumentSource`

| Old value | New value | Лічильник у stats |
|-----------|-----------|-------------------|
| `manual_upload` | `manual` | `manual_upload_to_manual` |
| `ecits` | `court_sync` | `ecits_to_court_sync` |
| `manual` / `court_sync` / `metadata_extractor` | без зміни | `<value>_unchanged` |
| `telegram` / `email` | без зміни | `keep_telegram` / `keep_email` |
| `null` / `undefined` | `manual` | `null_to_manual` |
| невідоме | `unknown` | `unknown_other` (з console.warn) |

### Console.log приклад

```
[TASK 0.3.5] Pre-v7 backup: registry_data_backup_pre_v7_<ts>.json
[TASK 0.3.5] Starting v6.5 → v7 migration: canonical schema for ECITS...
[TASK 0.3.5] Migration done:
  Documents updated: 47
  Source enum migration:
    manual_upload → manual: 23
    ecits → court_sync: 0
    null/undefined → manual: 12
    telegram kept: 0
    email kept: 0
    unknown → 'unknown' (fallback): 0
  Cases updated: 20
  Hearings updated: 15
  Proceedings updated: 2
  Users updated: 1
[TASK 0.3.5] Migration v6.5 → v7 done.
```

### Бекап

- Файл: `_backups/registry_data_backup_pre_v7_<timestamp>.json` на Drive
- Прапор: `localStorage.getItem('levytskyi_pre_v7_backup_done')`
- Поведінка: одноразовий, помилка не блокує міграцію (warning у консоль)

---

## SOURCE POLICY — пріоритетизація

```
manual               (100) — адвокат вручну, не перезаписується автоматично
court_sync           (80)  — primary канал з ЄСІТС
metadata_extractor   (60)  — primary для не-ЄСІТС
telegram, email      (50)  — прямі канали
unknown              (10)  — невідомо, найнижчий
```

`update_case_ecits_state` використовує `canOverwrite(existingSource, newSource)` для рішення про перезапис. Якщо новий має нижчий пріоритет — перезапис не відбувається (логуємо у консоль).

---

## BILLING — виключення системних дій

`SYSTEM_ACTIONS_NO_BILLING` Set:
- `track_session_start`, `track_session_end`, `batch_update` (попередні)
- `mark_synced_from_ecits`, `update_case_ecits_state` (нові, системні)

`EDIT_ACTIONS_SOURCE_AWARE` Set — нараховуються тільки якщо `source === 'manual'`:
- `update_parties`, `update_team`, `update_process_participants`
- `update_proceeding_composition`, `update_document_movement_card`, `update_alternative_sources`

Викликані з `court_sync` або `metadata_extractor` — НЕ нараховуються (автосинхронізація).

---

## ACCEPTANCE CRITERIA — ПЕРЕВІРКА

### Schema
- ✅ `CURRENT_SCHEMA_VERSION = 7`, `MIGRATION_VERSION = '7.0_ecits_canonical'`
- ✅ `migrateToVersion7(registry)` функція створена
- ✅ `src/schemas/caseSchema.js` створено
- ✅ `src/schemas/hearingSchema.js` створено
- ✅ `documentSchema.js` розширено 5 новими полями (28 загалом)
- ✅ `src/services/sourcePolicy.js` створено з canOverwrite

### ACTIONS
- ✅ `add_hearing` і `update_hearing` приймають source/sourceConfidence/ecitsContext/assignedTo/attendedBy (backward compatible, warning якщо source не передано)
- ✅ `mark_synced_from_ecits` працює і інкрементує syncMetrics
- ✅ `update_case_ecits_state` мерджить patch з canOverwrite
- ✅ 6 edit-ACTIONS реалізовано
- ✅ Кожен ACTION публікує відповідну подію у eventBus з tenantId

### PERMISSIONS
- ✅ `court_sync_agent` defined з 10 ACTIONS у allowlist
- ✅ `metadata_extractor_agent` defined але порожній allowlist (disabled)
- ✅ Жоден з двох не може destroy_case, add/update/delete_document

### Migration
- ✅ Backup `pre_v7` функція створена в driveService.js
- ✅ localStorage прапор `levytskyi_pre_v7_backup_done` запобігає повторному
- ✅ App.jsx EFFECT-A викликає migrateToVersion7 після migrateToVersion6_5
- ✅ splashRestoreFromBackup теж викликає migrateToVersion7
- ✅ Source enum migration з console звітом
- ✅ Всі cases отримують ecitsState з default never
- ✅ Всі users отримують ecitsCabinetIdentifier: null

### Billing
- ✅ `SYSTEM_ACTIONS_NO_BILLING` Set винесено як константу
- ✅ mark_synced_from_ecits НЕ нараховується
- ✅ update_case_ecits_state НЕ нараховується
- ✅ Edit-ACTIONS з source !== 'manual' НЕ нараховуються
- ✅ Edit-ACTIONS з source === 'manual' нараховуються нормально

### Embryo
- ✅ Папка `src/services/metadataExtractor/` створена з README.md (60+ рядків)

### Tests
- ✅ `tests/unit/canonicalSchemaV7.test.js` створено з 55 тестами
- ✅ `documentSchema.test.js` оновлено (28 полів)
- ✅ `documentFactory.test.js` оновлено (нові enum + normalize)
- ✅ `courtSyncInfrastructure.test.js` оновлено (6 source values, 6 ECITS_TOPICS)
- ✅ `founderFlag.test.js` оновлено (version 7)
- ✅ `_actionsHarness.js` має нові ACTIONS і ролі
- ✅ Усі попередні тести зелені (1073/1073)

### Documentation
- ✅ CLAUDE.md оновлено — шапка v7, правило #6, новий розділ TASK 0.3.5
- ✅ Tracking debt задокументований (deprecated client/judges/timeLog)

### Build
- ✅ Vite build success в 13.67s без нових warnings
- ⏳ Git commit + push — буде наступним кроком

---

## SEMANTIC CLARITY CHECK — РЕЗУЛЬТАТ

```
// ЄСІТС-синхронізація:
hearing = { source: 'court_sync', sourceConfidence: 'high', ecitsContext: {...}, ... }

// Metadata Extractor (майбутнє):
hearing = { source: 'metadata_extractor', sourceConfidence: 'medium', ecitsContext: null, ... }

// Адвокат вручну:
hearing = { source: 'manual', sourceConfidence: 'high', ecitsContext: null, ... }
```

Жодного перекриття таксономій. Жодного дублювання структур. Правило #11 виконано.

---

## ПОБІЧНІ ЗНАХІДКИ

1. **Тест `courtSyncInfrastructure.test.js:106`** очікував ECITS_TOPICS.toHaveLength(4). Я розширив масив до 6 (додано 2 sync події). Оновлено тест.

Інших побічних знахідок не виявлено.

---

## ГОТОВНІСТЬ ДО TASK 0.4

Канонічна схема v7 готова до реалізації TASK 0.4 (синхронізація засідань через Claude for Chrome):
- `add_hearing` приймає source='court_sync' з ecitsContext
- `mark_synced_from_ecits` інкрементує metrics
- `update_case_ecits_state` оновлює стан справи в ЄСІТС
- eventBus публікує події для майбутнього UI
- Всі ACTIONS виключені з білінгу як системні

---

**Кінець report.**
