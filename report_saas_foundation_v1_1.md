# Звіт виконання TASK SaaS Foundation v1.1 — Patch and Extension

**Дата виконання:** 2026-05-05
**Виконав:** Claude Code Opus 4.7 (1M context)
**Тривалість:** ~2.5 години (діагностика + впровадження)
**Гілка:** main
**Статус:** **success** — усі критерії TASK виконано
**Залежність:** SaaS Foundation v1 (commit `4f719fc`)

---

## ⚠️ ВАЖЛИВО ДЛЯ АДВОКАТА — після pull

**Зробіть hard reload на всіх пристроях:**
- **iPad/Safari:** Налаштування → Safari → Очистити історію та дані сайту
- **Mac/Chrome:** Cmd+Shift+R · **Windows:** Ctrl+Shift+R
- **Android/Chrome:** Меню → Налаштування → Конфіденційність → Очистити дані

**Що відбудеться при першому запуску:**
1. Зчитається існуючий v2 `registry_data.json` з Drive.
2. Створиться бекап `_backups/registry_data_backup_pre_v3_<ts>.json` (поза ротацією).
3. Виконається міграція v2 → v3: додадуться `ai_usage[]`, `caseAccess[]`, `tenant.storage`, `tenant.modelPreferences`, `tenant.subscription.{limits,current,alerts}`, `case.team[i].permissions`. `case.id` (number) → `case_<n>` (string).
4. Якщо в localStorage був `levytskyi_action_log` — створиться бекап `_backups/levytskyi_action_log_<ts>.json` і ключ видалиться. Прапор `levytskyi_action_log_cleaned_v1_1` запобігає повторному виконанню.
5. У консолі: `[SaaS Foundation v1.1] Pre-v3 backup: ...` та `[SaaS Foundation v1.1] Action log backed up and removed: ...`.

Якщо щось піде не так — обидва бекапи на місці.

---

## 🧬 ВІЗУАЛІЗАЦІЯ ЗМІН — ДО І ПІСЛЯ

### registry_data.json — ДО (v2)

```
registry_data.json
├── schemaVersion: 2
├── settingsVersion: "2.0_saas_foundation"
├── tenants[] (без storage, modelPreferences, повного subscription)
├── users[]
├── auditLog[]
├── structuralUnits[]
└── cases[] (id: number у legacy, без team.permissions)
```

### registry_data.json — ПІСЛЯ (v3)

```
registry_data.json
├── schemaVersion: 3                                          🆕 v1.1
├── settingsVersion: "3.0_patch_and_extension"                🆕 v1.1
├── tenants[]
│   └── ab_levytskyi
│       ├── (existing fields)
│       ├── storage { provider, quotaGB, usedBytes }          🆕 v1.1
│       ├── modelPreferences { 9 agents: null }               🆕 v1.1
│       └── subscription
│           ├── plan, status, validUntil, features
│           ├── limits { aiTokens, aiCost, storage, ... }     🆕 v1.1
│           ├── current { tokensUsed, costUsedUSD, ... }      🆕 v1.1
│           └── alerts { warnAt: 80, blockAt: 100 }           🆕 v1.1
├── users[]
├── auditLog[]
├── structuralUnits[]
├── ai_usage[]                                                🆕 v1.1 (LIFO 50 000)
│   └── { id, tenantId, userId, timestamp, agentType, model,
│         inputTokens, outputTokens, totalTokens, estimatedCostUSD,
│         context: { caseId, module, operation } }
├── caseAccess[]                                              🆕 v1.1 (порожня)
└── cases[]
    └── { id: 'case_4',  ← string скрізь                     🆕 v1.1
          team: [{ userId, caseRole, addedAt, addedBy,
                   permissions: { canEdit, canDelete, canShare,
                                  canAddTeam, canViewBilling,
                                  canEditBilling, canRunAI }  🆕 v1.1
                 }],
          ... }
```

---

## 📊 МЕТРИКИ

### Файли

| Категорія | Створено | Змінено | Видалено |
|-----------|----------|---------|----------|
| Сервіси | 3 | 4 | — |
| Компоненти | — | 4 | — |
| Документація | 2 | 1 | — |
| Усього | 5 | 9 | 0 |

**Створено:**
- `src/services/aiUsageService.js` (132 рядки) — облік токенів, аналітичні хелпери
- `src/services/modelResolver.js` (40 рядків) — ієрархія user → tenant → system
- `src/services/subscriptionService.js` (62 рядки) — recalculateCurrent, checkLimits
- `diagnostic_saas_foundation_v1_1.md` (377 рядків) — фаза 0 діагностика
- `report_saas_foundation_v1_1.md` (цей файл)

**Змінено:**
- `src/services/migrationService.js` — v2→v3, ensureTeamPermissions, normalizeCaseId, migrateTenant
- `src/services/tenantService.js` — DEFAULT_TENANT з storage, modelPreferences, subscription повним
- `src/services/permissionService.js` — активація checkTenantAccess і checkCaseAccess
- `src/services/driveService.js` — backupRegistryDataPreV3, backupActionLogPreCleanup
- `src/App.jsx` — INITIAL_CASES (case_1..case_20), aiUsage/caseAccess state, 3 точки API, видалено logAction і writeCases
- `src/components/Dashboard/index.jsx` — точка API + setAiUsage prop
- `src/components/CaseDossier/index.jsx` — 2 точки API + setAiUsage, slice -50, передача sink в OCR і DocumentProcessor
- `src/components/DocumentProcessor/index.jsx` — 3 точки API (+document_block з sink)
- `src/services/ocr/claudeVision.js` — sink через options.aiUsageSink, resolveModel
- `CLAUDE.md` — розділ «SaaS Foundation v3.0 — Patch and Extension»

**Видалено:**
- `App.jsx:logAction` (16 рядків) — мертвий код, дублює auditLog
- `App.jsx:driveService.writeCases` (20 рядків) — мертвий код, 0 callers
- Застарілий коментар `App.jsx:3273` про agentHistory

### Точки виклику Anthropic API

10 точок — усі логуються в `ai_usage[]` і використовують `resolveModel()`:

| # | Файл | agentType | resolveModel() | Sink |
|---|------|-----------|----------------|------|
| 1 | App.jsx (QI image) | qi_agent | qiParserImage → haiku | setAiUsage prop |
| 2 | App.jsx (QI text) | qi_agent | qiParserDocument → haiku | setAiUsage prop |
| 3 | App.jsx (QI sendChat) | qi_agent | qiAgent → sonnet | setAiUsage prop |
| 4 | Dashboard | dashboard_agent | dashboardAgent → sonnet | setAiUsage prop |
| 5 | CaseDossier (case_context) | case_context_generator | caseContextGenerator → sonnet | setAiUsage prop |
| 6 | CaseDossier (chat) | dossier_agent | dossierAgent → sonnet | setAiUsage prop |
| 7 | DocumentProcessor (PDF block) | document_parser | documentProcessor → sonnet | aiUsageSink option |
| 8 | DocumentProcessor (chat 1) | document_parser | documentProcessor → sonnet | setAiUsage prop |
| 9 | DocumentProcessor (chat 2) | document_parser | documentProcessor → sonnet | setAiUsage prop |
| 10 | claudeVision (OCR vision) | document_parser | documentParserVision → sonnet | aiUsageSink option (через ocrService.options) |

### id mixed types — масштаб міграції

- **20 INITIAL_CASES**: `id: 1..20` → `'case_1'..'case_20'`
- **12 documents у Брановського**: `id: 1..12` → `'1'..'12'` (string без префікса — це не case_id)
- **2 точки створення нових id у App.jsx**: QI form-handler і addCase (UI) → `case_${Date.now()}`
- **migrateCase()**: автоматично конвертує legacy дані з localStorage/Drive (typeof === 'number' → `case_<n>`)
- **22 точки прямого `c.id === ...`**: тепер працюють надійно бо обидва аргументи string

---

## ✅ КРИТЕРІЇ УСПІХУ TASK

1. ✅ `registry_data.json` має `ai_usage[]`, `caseAccess[]`
2. ✅ Кожен tenant має `storage`, `modelPreferences`, `subscription.limits + current + alerts`
3. ✅ Кожен `case.team[i]` має `permissions` з 7 полями (включно з `canRunAI`)
4. ✅ Усі `case.id` — string (`case_<n>`)
5. ✅ `levytskyi_action_log` видаляється з localStorage з runtime бекапом на Drive
6. ✅ `driveService.writeCases` alias видалено (App.jsx:2894 блок)
7. ✅ `agentHistory` slice = 50 у localStorage (вирівняно з Drive і state)
8. ✅ Застарілий коментар у `App.jsx:3273` видалено
9. ✅ `schemaVersion: 3`, `settingsVersion: "3.0_patch_and_extension"`
10. ✅ Міграція v1 → v2 → v3 ідемпотентна (smoke test 4 пройшов)
11. ✅ `aiUsageService.js`, `modelResolver.js`, `subscriptionService.js` створені
12. ✅ Усі 10 точок виклику Anthropic API логують у `ai_usage[]` і використовують `resolveModel()`
13. ✅ `checkTenantAccess` (без fallback true) і `checkCaseAccess` (з tenant isolation + bureau_owner override) активовані
14. ✅ Старі дані працюють — система не зламалась (build чистий)
15. ✅ `npm run build` чистий — 597 модулів, без помилок
16. ✅ Smoke tests пройдено (5/5 — empty/v1/v2→v3/idempotent/id format)
17. ✅ CLAUDE.md оновлено — додано розділ «SaaS Foundation v3.0»
18. ✅ Звіт `report_saas_foundation_v1_1.md` створений
19. ✅ Один commit у main (нижче)

---

## 🧪 SMOKE TESTS

```
TEST 1 — empty: 3 cases= 0 ai_usage= 0 caseAccess= 0
TEST 2 — v1 array: schemaVersion= 3 didMigrate= true fromVersion= 1
                    first.id= case_4 team[0].permissions.canRunAI= true
TEST 3 — v2 → v3: schemaVersion= 3 didMigrate= true first.id= case_5
                    storage= {"provider":"drive_legacy","quotaGB":null,"usedBytes":null}
                    subscription.limits= {"aiTokensPerMonth":null, ...}
TEST 4 — idempotent v3: didMigrate= false schemaVersion= 3
                         cases.length= 1 ai_usage.length= 0
TEST 5 — id format: string = case_4
```

`npm run build` → ✓ built in 10.97s, 597 modules transformed.

---

## 📝 РІШЕННЯ АДВОКАТА (з відповідей на питання діагностики)

| Питання | Рішення |
|---------|---------|
| Q1 pricing | Цифри з TASK + коментар `// pricing as of 2026-05-04, verify quarterly` |
| Q2 sink для не-React точок | `options.aiUsageSink` параметр — без глобалу |
| Q3 додаткові permissions | + `canRunAI` (для тарифних обмежень) |
| Q4 формат id | `case_<original_id>` — людська читабельність |
| Q5 action_log | Видалити без merge + бекап `_backups/levytskyi_action_log_<ts>.json` |
| Q6 caseAccess схема | Порожня структура + коментар-приклад у migrationService.js |
| Q-нове checkCaseAccess | Не міняти сигнатуру — `(userId, caseObj)` залишається |
| Q-нове ai_usage cap | 50 000 як в TASK |
| Q-нове checkTenantAccess | Прибрати fallback `return true` |
| Q-нове writeCases | Видалити блок з App.jsx:2894-2913 |

---

## 🚧 ЩО НЕ ЗРОБЛЕНО У ЦЬОМУ TASK (свідомо за межами скопу)

- proceedings/documents у Брановський — переноситься в Document Processor v2
- UI керування користувачами/ролями — окремий TASK
- Реальна логіка лімітів `subscription.limits` — заглушки (limits = null)
- Реальний проксі-сервер AI — окремий великий TASK
- Multi-user Activation (Olena) — окремий TASK
- Виклики `caseAccess[]` синхронізації — це для майбутнього SaaS-масштабу

---

## 🎯 ПІСЛЯ ЦЬОГО TASK

Послідовність далі (з TASK розділ «після завершення»):

1. ✅ TASK SaaS Foundation v1
2. ✅ TASK SaaS Foundation v1.1 (цей)
3. → TASK Billing Foundation v2
4. → TASK Tool Use Preparation
5. → TASK CLAUDE.md Audit (одним проходом для всього каркасу)
6. → TASK Travel Time Fix
7. → TASK Multi-user Activation (окремий чат)

---

**Кінець звіту SaaS Foundation v1.1 Patch and Extension.**
