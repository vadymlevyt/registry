# Діагностика CLAUDE.md Audit

**Дата:** 2026-05-06
**Виконавець:** Claude Code Opus
**Контекст TASK:** інтеграція CLAUDE.md v5.0 + DEVELOPMENT_PHILOSOPHY.md

---

## Поточний стан репо

- Останні комміти:
  - `9b1ec40` fix: agent_call category and module consistency in time_entries
  - `5a18320` feat: Billing Foundation v2 — internal time tracking infrastructure
  - `94faf6c` feat: SaaS Foundation v1.1 — patch and extension
  - `5088c68` docs: вписати commit hash у report_saas_foundation.md
  - `4f719fc` feat: SaaS Foundation v1 — tenants, users, audit log, permissions service

- `migrationService.js`:
  - `CURRENT_SCHEMA_VERSION = 4` ✅
  - `MIGRATION_VERSION = '4.0_billing_foundation'` ✅

- `src/services/`: 16 сервісів + папка `ocr/` з 3 провайдерами
  - SaaS: tenantService, permissionService, auditLogService, migrationService
  - SaaS v3 patch: aiUsageService, modelResolver, subscriptionService
  - Billing: activityTracker, masterTimer, timeStandards, smartReturnHandler, timeEntriesArchiver, timeEntriesQuery, moduleNames
  - Інфра: driveAuth, driveService, ocrService
  - OCR: documentAi, claudeVision, pdfjsLocal

- `src/components/`: Dashboard, CaseDossier, Notebook, DocumentProcessor, **SystemModal.jsx** (5 одиниць)
- `src/App.jsx`: 5249 рядків
- ACTIONS: ~32 дії (рядок 4273)
- PERMISSIONS: 4 групи агентів (рядок 4883)

---

## Перевірка нового CLAUDE.md проти реального коду

### Розділ "Структура файлів" — ✅ збігається
Усі описані сервіси наявні. Імена файлів і їх розташування коректні.

**Дрібниця:** у переліку компонентів CLAUDE.md перелічує лише 4 (Dashboard, CaseDossier, Notebook, DocumentProcessor), але в `src/components/` також лежить `SystemModal.jsx`. Не критично — описаний як окремий top-level компонент в App.jsx.

### Розділ "Сервіси SaaS Foundation" — ✅
Усі чотири сервіси з описаними функціями наявні:
- `tenantService.js`: getCurrentTenant, getCurrentUser, DEFAULT_TENANT, DEFAULT_USER ✅
- `permissionService.js`: checkTenantAccess, checkRolePermission, checkCaseAccess ✅
- `auditLogService.js`: AUDIT_ACTIONS, shouldAudit, writeAuditLog, updateAuditLogStatus ✅
- `migrationService.js`: migrateRegistry, ensureCaseSaasFields, CURRENT_SCHEMA_VERSION ✅

### Розділ "Сервіси Billing Foundation" — ✅
Усі 7 сервісів наявні з очікуваними експортами:
- `activityTracker.js`: report, startSession/endSession, startSubtimer/endSubtimer, assignOfflinePeriod ✅
- `masterTimer.js`: state machine (start/pause/resume/stop/recover) ✅
- `timeStandards.js`, `smartReturnHandler.js`, `timeEntriesArchiver.js`, `timeEntriesQuery.js`, `moduleNames.js` ✅

### Розділ "Інструментація — 25 точок" — ⚠️ кількість більша
`grep -rn "activityTracker.report" src/` дає **35 точок** (без console.warn в самому activityTracker.js).

Розклад:
- App.jsx: 11 (з них 3 — `agent_call`, 1 — `executeAction` hook, 1 — `case_restored`)
- CaseDossier: 7 (з них 2 — `agent_call`)
- Dashboard: 4 (з них 1 — `agent_call`)
- Notebook: 2
- DocumentProcessor: 8 (з них 3 — `agent_call`)
- ocr/claudeVision: 1 — `agent_call`

Розшифровка узгоджується з CLAUDE.md: 25 базових + 10 `agent_call` (інтеграція з ai_usage[]) = 35.
Але число "25" у тексті CLAUDE.md може ввести в оману — не дублює `agent_call` рядки.

### Розділ "Точки виклику Anthropic API — 10 шт" — ✅
`grep -rn "api.anthropic.com" src/` = **10**. Точно як у CLAUDE.md.

### Розділ "ACTIONS і PERMISSIONS"
CLAUDE.md каже "19+ дій" — формально вірно. Реально в `ACTIONS = {}` зараз ~32 ключі. Рекомендується в майбутніх версіях документа замінити "19+" на актуальну цифру або «30+».

### moduleNames.js — ✅
MODULES enum + `categoryForCase()` присутні. Перелік ключів збігається з CLAUDE.md.

### Перехресні посилання — ✅
- `LESSONS.md` — існує (26122 байт)
- `DEVELOPMENT_PHILOSOPHY.md` — інтегровано (528 рядків)
- `recommended_task_claude_md_audit.md` — існує
- `bugs_found_during_billing_foundation.md` — **відсутній** (CLAUDE.md згадує його як "Збір накопичених знахідок"). Це не критично — файл буде створено, коли з'являться знахідки. Існує `bugs_found_during_saas_foundation.md` як шаблон.

---

## Знайдені невідповідності

Усі — **дрібні**, не блокують інтеграцію. Деталі — в `bugs_found_during_claude_md_audit.md`.

| # | Категорія | Опис | Серйозність |
|---|-----------|------|-------------|
| 1 | Структура файлів | `SystemModal.jsx` не згаданий | low |
| 2 | Інструментація | "25 точок" — насправді 35 (25 base + 10 agent_call) | low |
| 3 | ACTIONS | "19+" — реально ~32 | low |
| 4 | Cross-refs | `bugs_found_during_billing_foundation.md` згаданий, але відсутній (TASK на спостереження ще триває) | low |
| 5 | Інструментація | `case_restored` присутній в коді (App.jsx:4207), але не у списку 25 точок | low |

---

## Готовність

**Чи можна інтегрувати CLAUDE.md як є?** ✅ Так.
**Які пункти потребують уточнень/виправлень?** Жодних блокуючих. Знахідки задокументовано — у наступному оновленні CLAUDE.md (або окремому micro-TASK) можна підправити цифри.

Згідно з ФАЗА 3 крок 3.2, **не змінюємо CLAUDE.md** з власної ініціативи — фіксуємо у bugs_found.
