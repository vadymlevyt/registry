# TASK: SaaS Foundation v1.1 — Patch and Extension

**Версія:** 1.1
**Дата створення:** 05.05.2026
**Тип:** доповнення до SaaS Foundation v1 (commit 4f719fc)
**Очікувана тривалість:** 7-10 годин роботи Claude Code (≈1 робочий день)
**Пріоритет:** ВИСОКИЙ — виконується перед Billing Foundation
**Залежності:** SaaS Foundation v1 (виконано 2026-05-04)
**Гілка:** main

---

## 🎯 КОНТЕКСТ І ПРИЧИНА TASK

SaaS Foundation v1 виконано якісно за 3 години замість прогнозованих 7-8. Структура tenants/users/auditLog/permissions заклала каркас multi-tenancy. Але після впровадження виявлено **дві групи речей які треба закрити**:

**Група 1 — Архітектурний борг знайдений Claude Code під час впровадження** (зафіксовано в `bugs_found_during_saas_foundation.md`):
- agentHistory у трьох джерелах
- levytskyi_action_log дублює auditLog
- id mixed types (number у старих справах, string у нових)
- driveService.writeCases deprecated alias
- proceedings/documents лише у Брановський

**Група 2 — Прогалини виявлені в архітектурному обговоренні** (з адмін-чату «CRM і Білінг»):
- Структура `ai_usage[]` для SaaS-телеметрії — оператор має бачити витрати кожного юриста на API
- Поле `tenant.storage` для майбутніх тарифних режимів
- `case.team[i].permissions` для гранулярного контролю доступу
- `caseAccess[]` денормалізована таблиця-індекс
- `tenant.modelPreferences` для тарифних пакетів з вибором моделі агента
- `tenant.subscription.limits + current` для обліку лімітів пакетів
- Активація заглушок `checkTenantAccess` і `checkCaseAccess`

Жодна з цих прогалин не блокує роботу системи — заглушки повертають true, дані пишуться. Але кожна створює **майбутній міграційний борг**: при першому ж дотику до тарифів/білінгу/multi-user довелось би знову робити структурну міграцію, оновлювати migrationService, переписувати ensureCaseSaasFields.

**Філософія «ембріон з повним ДНК»** вимагає закласти ці структури зараз, навіть якщо вони не використовуються.

Цей TASK — об'єднує обидві групи. Низькоризиковий, не зачіпає UI, тільки додає структури і виправляє знайдені борги.

---

## 🧬 ФІЛОСОФСЬКІ ПРИНЦИПИ ЦЬОГО TASK

(Філософію «ембріон з ДНК» вже закладено в CLAUDE.md після SaaS Foundation v1. Повторюємо ключове.)

1. **Не міняємо UI.** Поля додаємо в дані, заглушки в сервіси. Жодних нових кнопок чи налаштувань.
2. **Не активуємо логіку повністю.** Структури готові, поведінка ідентична поточній. Окремі заглушки (checkTenantAccess, checkCaseAccess) активуються мінімально.
3. **Кожне нове поле — у міграцію.** `migrationService.js` навчається додавати нові поля старим записам. Ідемпотентно.
4. **Кожна нова структура — в backup.** При наступному `backupRegistryData` ці поля автоматично потрапляють у бекап.
5. **Один архіваріус, одне джерело правди.** Якщо знаходиться дублювання даних — виправляємо. Якщо знаходиться застарілий код — викидаємо.

---

## ⚠️ ФАЗА 0 — ОБОВ'ЯЗКОВА ДІАГНОСТИКА ПЕРЕД ВПРОВАДЖЕННЯМ

Перед будь-якими змінами Claude Code зобов'язаний створити файл `diagnostic_saas_foundation_v1_1.md` і отримати згоду адвоката.

### Що перевірити в діагностиці

#### 1. Поточний стан після SaaS Foundation v1

```bash
cat src/services/migrationService.js
cat src/services/tenantService.js
cat src/services/auditLogService.js
cat src/services/permissionService.js
grep -n "schemaVersion" src/App.jsx
```

Зафіксувати:
- Поточний `schemaVersion` (має бути 2)
- Структуру `DEFAULT_TENANT` в tenantService
- Стан заглушок в permissionService

#### 2. Точки виклику Anthropic API

Знайти всі місця де викликається Anthropic API — для логування `ai_usage`:

```bash
grep -rn "api.anthropic.com\|anthropic.com/v1" src/
grep -rn "x-api-key" src/
grep -rn "claude-sonnet\|claude-haiku\|claude-opus" src/
```

Очікувано — щонайменше 5-7 місць (App.jsx sendChat, Dashboard agent, Dossier agent, Document Processor, CaseDossier handleCreateContext, Quick Input аналіз). Зафіксувати **повний список** з номерами рядків і моделями.

#### 3. Стан `levytskyi_action_log`

Перевірити:
- Чи існує в localStorage
- Які поля містить
- Чи дублюється з `auditLog` (з SaaS Foundation v1)
- Які записи можна перенести, які — викинути

#### 4. id mixed types — масштаб проблеми

```bash
grep -rn "case.id\|caseId" src/ | head -50
```

Перевірити:
- Скільки справ мають `id: <number>` vs `id: "<string>"`
- Де порівнюються (`===`, `==`)
- Чи є місця де порівняння може ламатись через mixed types

#### 5. driveService.writeCases — використання

```bash
grep -rn "writeCases" src/
```

Перевірити:
- Скільки місць ще викликає `writeCases`
- Чи всі вони можна замінити на `writeRegistry`
- Чи alias реально не потрібен

#### 6. Розмір поточного `registry_data.json`

Не критично, але корисно знати наскільки розростеться файл після додавання `ai_usage[]`. Якщо файл уже > 1 МБ — обговорити стратегію (можливо винести `ai_usage[]` в окремий файл `ai_usage_log.json` на Drive).

#### 7. Вирівнювання agentHistory (з diagnostic_agentHistory.md)

Підтвердити що:
- localStorage `agent_history_<id>` slice = 20 (треба = 50)
- Drive `agent_history.json` slice = 50 (правильно)
- React state slice = 50 (правильно)
- Застарілий коментар в App.jsx:3273 ще на місці

### Артефакт фази 0

`diagnostic_saas_foundation_v1_1.md` з:
1. Підтвердженням поточного `schemaVersion` (має бути 2)
2. Списком всіх точок виклику Anthropic API з рядками
3. Поточним станом `tenants[]`, `users[]`, заглушок
4. Аналізом `levytskyi_action_log` (що мерджити, що викидати)
5. Масштабом id mixed types (скільки справ потребують міграції)
6. Розміром `registry_data.json`
7. Стан agentHistory slice розмірів
8. Питаннями до адвоката (Q1, Q2, ...) — якщо щось неоднозначне

**Зупинка для згоди адвоката.** Не починати впровадження без явної команди «продовжуй».

---

## 📋 МЕТА TASK — ЩО САМЕ РОБИМО

### ЧАСТИНА А — Виправлення архітектурного боргу

**А1. Малий фікс agentHistory** (~7 хвилин)
- Вирівняти slice в localStorage з `-20` на `-50` (CaseDossier:533)
- Видалити застарілий коментар «тимчасово, поки немає agent_history.json» в App.jsx:3273
- Конфлікт з CLAUDE.md секцією «AGENT HISTORY» — НЕ виправляємо в коді, виправимо CLAUDE.md в окремому Audit TASK
- 3-tier pattern (Drive → localStorage → state) залишаємо як є — це нормальна архітектура

**А2. levytskyi_action_log → auditLog merge** (~30 хв)
- Прочитати дані з `levytskyi_action_log` в localStorage
- Перенести цінні записи в `auditLog[]` (з полями action, userId, timestamp)
- Видалити старий ключ з localStorage
- Видалити код який пише в `levytskyi_action_log`
- Зберегти бекап старих даних в `_backups/levytskyi_action_log_<ts>.json` перед видаленням

**А3. id mixed types → string скрізь** (~1-2 год)
- Міграція всіх існуючих `case.id` з number → string (формат `case_<originalNumber>` або UUID)
- Оновити всі hearings/deadlines/notes/timeLog де ID посилається на caseId
- Перевірити всі місця порівняння (`===`)
- Backward compat: при читанні старих даних — конвертувати в string при міграції

**А4. driveService.writeCases cleanup** (~30-60 хв)
- Знайти всі виклики `writeCases` в коді
- Замінити на `writeRegistry`
- Видалити alias `writeCases` з driveService.js
- Перевірити що нічого не зламалось

**А5. proceedings/documents — НЕ зараз** — переноситься в TASK Document Processor v2

### ЧАСТИНА Б — SaaS-телеметрія і структури

**Б1. ai_usage[] на верхньому рівні registry_data.json** (~1 год)

Структура:
```json
{
  "schemaVersion": 3,
  "settingsVersion": "3.0_telemetry_storage",
  ...
  "ai_usage": []
}
```

Запис ai_usage:
```json
{
  "id": "usage_<timestamp>_<random>",
  "tenantId": "ab_levytskyi",
  "userId": "vadym",
  "timestamp": "2026-05-05T14:32:18.234Z",
  "agentType": "qi_agent" | "dashboard_agent" | "dossier_agent" | "document_parser" | "case_context_generator" | "deep_analysis" | "other",
  "model": "claude-sonnet-4-20250514" | "claude-haiku-4-5-20251001" | "claude-opus-4-7" | ...,
  "inputTokens": 1247,
  "outputTokens": 384,
  "totalTokens": 1631,
  "estimatedCostUSD": 0.0034,
  "context": {
    "caseId": "case_47" | null,
    "module": "QI" | "Dashboard" | "Dossier" | "DocumentProcessor" | "Notebook" | null,
    "operation": "chat" | "parse_document" | "generate_context" | "analyze_position" | "other"
  }
}
```

LIFO ротація 50 000 записів через `slice(-50000)`. ~рік активної роботи при 100-200 викликах/день.

**Б2. aiUsageService.js + інтеграція в усі точки виклику** (~1-2 год)

Новий файл `src/services/aiUsageService.js`:

```javascript
import { getCurrentTenant, getCurrentUser } from './tenantService.js';

const MODEL_PRICING = {
  'claude-haiku-4-5-20251001':  { input: 0.80,  output: 4.00 },
  'claude-sonnet-4-20250514':   { input: 3.00,  output: 15.00 },
  'claude-opus-4-7':            { input: 15.00, output: 75.00 },
  default: { input: 0, output: 0 }
};

function calculateCost(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING.default;
  const cost = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
  return Number(cost.toFixed(6));
}

export function logAiUsage({
  agentType,
  model,
  inputTokens,
  outputTokens,
  context = {}
}, setAiUsage) {
  const tenant = getCurrentTenant();
  const user = getCurrentUser();
  
  const entry = {
    id: `usage_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    tenantId: tenant.id,
    userId: user.id,
    timestamp: new Date().toISOString(),
    agentType: agentType || 'other',
    model: model || 'unknown',
    inputTokens: inputTokens || 0,
    outputTokens: outputTokens || 0,
    totalTokens: (inputTokens || 0) + (outputTokens || 0),
    estimatedCostUSD: calculateCost(model, inputTokens || 0, outputTokens || 0),
    context: {
      caseId: context.caseId || null,
      module: context.module || null,
      operation: context.operation || 'other'
    }
  };
  
  setAiUsage(prev => [...prev, entry].slice(-50000));
  return entry;
}

// Аналітичні хелпери для майбутнього (без UI поки)
export function getUsageByPeriod(aiUsage, fromDate, toDate) { /* ... */ }
export function getUsageByModel(aiUsage, fromDate, toDate) { /* ... */ }
export function getUsageByCase(aiUsage, caseId, fromDate, toDate) { /* ... */ }
export function getUsageByUser(aiUsage, userId, fromDate, toDate) { /* ... */ }
export function getTotalCost(aiUsage, fromDate, toDate) { /* ... */ }
```

Інтегрувати `logAiUsage()` в усі точки виклику Anthropic API (з фази 0 діагностики). Anthropic API завжди повертає `usage.input_tokens` і `usage.output_tokens` — витягуємо звідти, не вираховуємо самостійно.

Правило: жоден API-виклик не залишається без логування. Try/catch навколо logAiUsage — якщо логування впало, основний flow не зупиняється.

**Б3. tenant.storage заглушка** (~15 хв)

Розширення tenant:
```json
{
  "storage": {
    "provider": "drive_legacy",
    "quotaGB": null,
    "usedBytes": null
  }
}
```

Можливі значення `provider`:
- `"drive_legacy"` — поточний режим (default)
- `"r2_managed"` — майбутній Standard tariff (Cloudflare R2)
- `"drive_byos"` — майбутній Premium tariff (Drive юриста)

`quotaGB` і `usedBytes` — null зараз. Заповняться коли активуємо тарифи.

**Б4. case.team[i].permissions з дефолтами по ролі** (~30 хв)

Розширення team-запису:
```json
{
  "userId": "vadym",
  "caseRole": "owner",
  "addedAt": "...",
  "addedBy": "vadym",
  "permissions": {
    "canEdit": true,
    "canDelete": true,
    "canShare": true,
    "canAddTeam": true,
    "canViewBilling": true,
    "canEditBilling": true
  }
}
```

Дефолти за роллю при міграції:

| caseRole | canEdit | canDelete | canShare | canAddTeam | canViewBilling | canEditBilling |
|----------|---------|-----------|----------|------------|----------------|----------------|
| owner    | true    | true      | true     | true       | true           | true           |
| lead     | true    | true      | true     | true       | false          | false          |
| co-lead  | true    | false     | true     | false      | false          | false          |
| support  | true    | false     | false    | false      | false          | false          |
| external | false   | false     | false    | false      | true           | false          |

Логіка `checkCaseAccess()` поки не звертається до permissions (мінімальна активація — тільки перевірка team[]). Поля готові на майбутнє.

**Б5. caseAccess[] індекс-таблиця** (~5 хв)

Додати на верхній рівень registry_data.json:
```json
{
  "caseAccess": []
}
```

**Тільки структура, без логіки синхронізації.** Активувати буде потрібно при появі багатьох tenants у SaaS — тоді додамо автосинхронізацію після кожної зміни team[]. Зараз — пуста заглушка.

### ЧАСТИНА В — Тарифні пакети і ліміти

**В1. tenant.modelPreferences (заглушка з null)** (~15 хв)

Розширення tenant:
```json
{
  "modelPreferences": {
    "dossierAgent": null,
    "qiAgent": null,
    "dashboardAgent": null,
    "documentProcessor": null,
    "deepAnalysis": null,
    "caseContextGenerator": null
  }
}
```

null = використовується system default.

**В2. modelResolver.js helper** (~30 хв)

Новий файл `src/services/modelResolver.js`:

```javascript
import { getCurrentTenant, getCurrentUser } from './tenantService.js';

const SYSTEM_DEFAULTS = {
  dossierAgent: 'claude-sonnet-4-20250514',
  qiAgent: 'claude-sonnet-4-20250514',
  dashboardAgent: 'claude-sonnet-4-20250514',
  documentProcessor: 'claude-haiku-4-5-20251001',
  deepAnalysis: 'claude-opus-4-7',
  caseContextGenerator: 'claude-sonnet-4-20250514'
};

export function resolveModel(agentType) {
  // Ієрархія: user.preferences → tenant.modelPreferences → SYSTEM_DEFAULTS
  
  const user = getCurrentUser();
  const userPref = user.preferences?.modelPreferences?.[agentType];
  if (userPref) return userPref;
  
  const tenant = getCurrentTenant();
  const tenantPref = tenant.modelPreferences?.[agentType];
  if (tenantPref) return tenantPref;
  
  return SYSTEM_DEFAULTS[agentType] || 'claude-sonnet-4-20250514';
}

export function getSystemDefaults() {
  return { ...SYSTEM_DEFAULTS };
}
```

В усіх точках виклику AI замінити hardcoded модель на `resolveModel(agentType)`. Це готовність до майбутніх тарифних пакетів де адвокат-Premium може обрати Opus замість Sonnet для агента досьє.

**В3. tenant.subscription.limits + current** (~30 хв)

Розширення tenant.subscription:

```json
{
  "subscription": {
    "plan": "owner",
    "status": "active",
    
    "limits": {
      "aiTokensPerMonth": null,
      "aiCostPerMonth": null,
      "storageGB": null,
      "teamMembers": null,
      "casesActive": null
    },
    
    "current": {
      "periodStart": "2026-05-01T00:00:00Z",
      "periodEnd": "2026-05-31T23:59:59Z",
      "tokensUsed": 0,
      "costUsedUSD": 0,
      "storageUsedGB": 0,
      "teamMembersCount": 1,
      "casesActiveCount": 0
    },
    
    "alerts": {
      "warnAt": 80,
      "blockAt": 100
    }
  }
}
```

**Розрахунок поточного використання** — окрема невелика функція в `subscriptionService.js`:

```javascript
export function recalculateCurrent(tenant, aiUsage, cases) {
  const periodStart = new Date(tenant.subscription.current.periodStart);
  const periodEnd = new Date(tenant.subscription.current.periodEnd);
  
  const periodEntries = aiUsage.filter(e => {
    const t = new Date(e.timestamp);
    return e.tenantId === tenant.id && t >= periodStart && t <= periodEnd;
  });
  
  return {
    ...tenant.subscription.current,
    tokensUsed: periodEntries.reduce((s, e) => s + e.totalTokens, 0),
    costUsedUSD: periodEntries.reduce((s, e) => s + e.estimatedCostUSD, 0),
    casesActiveCount: cases.filter(c => c.status === 'active' && c.tenantId === tenant.id).length
  };
}
```

Викликається при логіні і періодично (раз на годину) у фоні. **Заглушка зараз** — поки limits = null, перевірок немає. Активуємо коли підемо в платні плани.

**В4. Активна checkTenantAccess** (~10 хв)

Заміна заглушки в permissionService.js:

```javascript
// БУЛО:
export function checkTenantAccess(userId, tenantId) {
  return true;
}

// СТАЄ:
export function checkTenantAccess(userId, tenantId) {
  if (!userId || !tenantId) return false;
  const user = getUserById(userId);
  if (!user) return false;
  return user.tenantId === tenantId;
}
```

Активує реальну ізоляцію tenant'ів. Зараз нічого не змінює (один user, один tenant), але механізм живий.

**В5. Активна checkCaseAccess (мінімальна логіка)** (~30 хв)

Заміна заглушки в permissionService.js:

```javascript
// БУЛО:
export function checkCaseAccess(userId, caseId) {
  return true;
}

// СТАЄ:
export function checkCaseAccess(userId, caseId) {
  if (!userId || !caseId) return false;
  
  const case_ = getCaseById(caseId);
  if (!case_) return false;
  
  const user = getUserById(userId);
  if (!user) return false;
  
  // 1. Tenant isolation
  if (case_.tenantId !== user.tenantId) return false;
  
  // 2. Bureau owner — повний доступ до всіх справ свого tenant
  if (user.globalRole === 'bureau_owner') return true;
  
  // 3. Перевірка team[]
  const inTeam = case_.team?.some(m => m.userId === userId);
  if (inTeam) return true;
  
  // 4. External access (з обмеженням за часом)
  const inExternal = case_.externalAccess?.some(a => 
    a.userId === userId && 
    (!a.validUntil || new Date(a.validUntil) > new Date())
  );
  if (inExternal) return true;
  
  return false;
}
```

Поки що не використовує `team[i].permissions` — це для майбутньої гранулярності. Активує мінімальну ізоляцію за userId / tenantId / team membership.

### ЧАСТИНА Г — Малі знахідки адвоката

(Сюди адвокат додає те що він знайшов при перечитуванні результатів SaaS Foundation v1. Залишити секцію відкритою для його додавання перед запуском.)

```
Адвокатські знахідки які треба включити:
1. (зробити)
2. ...
3. ...
```

### ЧАСТИНА Д — Технічна обвʼязка

**Д1. Інкремент schemaVersion 2 → 3** — у migrationService

**Д2. Розширення migrationService для v2 → v3** (~1 год)

Додати функцію `migrateV2toV3`:

```javascript
function migrateV2toV3(data) {
  // 1. ai_usage[]
  if (!data.ai_usage) data.ai_usage = [];
  
  // 2. caseAccess[]
  if (!data.caseAccess) data.caseAccess = [];
  
  // 3. tenants[*].storage
  data.tenants = data.tenants.map(tenant => ({
    ...tenant,
    storage: tenant.storage || {
      provider: "drive_legacy",
      quotaGB: null,
      usedBytes: null
    },
    modelPreferences: tenant.modelPreferences || {
      dossierAgent: null,
      qiAgent: null,
      dashboardAgent: null,
      documentProcessor: null,
      deepAnalysis: null,
      caseContextGenerator: null
    },
    subscription: {
      ...(tenant.subscription || {}),
      limits: tenant.subscription?.limits || {
        aiTokensPerMonth: null,
        aiCostPerMonth: null,
        storageGB: null,
        teamMembers: null,
        casesActive: null
      },
      current: tenant.subscription?.current || {
        periodStart: getCurrentMonthStart(),
        periodEnd: getCurrentMonthEnd(),
        tokensUsed: 0,
        costUsedUSD: 0,
        storageUsedGB: 0,
        teamMembersCount: 1,
        casesActiveCount: 0
      },
      alerts: tenant.subscription?.alerts || {
        warnAt: 80,
        blockAt: 100
      }
    }
  }));
  
  // 4. case.team[i].permissions
  data.cases = data.cases.map(c => ({
    ...c,
    team: (c.team || []).map(member => ensureTeamPermissions(member))
  }));
  
  // 5. id mixed types → string
  data.cases = data.cases.map(c => ({
    ...c,
    id: typeof c.id === 'number' ? `case_${c.id}` : c.id
  }));
  
  // 6. Інкремент version
  data.schemaVersion = 3;
  data.settingsVersion = "3.0_patch_and_extension";
  
  return data;
}

function ensureTeamPermissions(member) {
  if (member.permissions) return member;
  
  const defaultsByRole = {
    owner:    { canEdit: true,  canDelete: true,  canShare: true,  canAddTeam: true,  canViewBilling: true,  canEditBilling: true },
    lead:     { canEdit: true,  canDelete: true,  canShare: true,  canAddTeam: true,  canViewBilling: false, canEditBilling: false },
    'co-lead':{ canEdit: true,  canDelete: false, canShare: true,  canAddTeam: false, canViewBilling: false, canEditBilling: false },
    support:  { canEdit: true,  canDelete: false, canShare: false, canAddTeam: false, canViewBilling: false, canEditBilling: false },
    external: { canEdit: false, canDelete: false, canShare: false, canAddTeam: false, canViewBilling: true,  canEditBilling: false }
  };
  
  const role = member.caseRole || 'support';
  return { ...member, permissions: defaultsByRole[role] || defaultsByRole.support };
}
```

**Ідемпотентність** обов'язкова. Повторні запуски не дублюють поля.

**Розширити `ensureCaseSaasFields`** — щоб нові справи отримували `team` з `permissions`, `id` як string.

**Д3. Backup pre_v3** (~15 хв)

За зразком SaaS Foundation v1 — створити одноразовий бекап перед першою міграцією:

```javascript
// driveService.js — нова функція
export async function backupRegistryDataPreV3(data) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `registry_data_backup_pre_v3_${ts}.json`;
  // Завантажити в _backups/
  // НЕ підпадає під ротацію (lifeForever)
}
```

Викликається в App.jsx один раз перед `migrateRegistry` коли `schemaVersion < 3`.

**Д4. Оновлення CLAUDE.md (мінімально)** (~30 хв)

Додати новий розділ під існуючими SaaS Foundation v2.0:

```markdown
## SaaS Foundation v3.0 — Patch and Extension

Дата: 2026-05-05
schemaVersion: 3

### Виправлений архітектурний борг

- agentHistory: вирівняно slice (50), застарілий коментар видалено
- levytskyi_action_log: змерджено в auditLog, видалено
- id mixed types: всі case.id тепер string ("case_<number>" або UUID)
- driveService.writeCases: видалено alias, скрізь writeRegistry

### Нові структури в registry_data.json

**ai_usage[]** — пасивний облік токенів AI на верхньому рівні. LIFO ротація 50 000 записів. Поля: tenantId, userId, timestamp, agentType, model, inputTokens, outputTokens, estimatedCostUSD, context (caseId, module, operation).

**caseAccess[]** — заглушка денормалізованого індексу для майбутнього SaaS-масштабу. Поки порожня, без логіки синхронізації.

### Розширення tenant

**tenant.storage** — provider (drive_legacy default), quotaGB, usedBytes. Готовність до тарифів R2/BYOS-Drive.

**tenant.modelPreferences** — null для всіх агентів. Готовність до тарифних пакетів з вибором моделі.

**tenant.subscription.limits + current + alerts** — структури обліку лімітів. Зараз limits = null (безлімітно для owner).

### Розширення case.team

**case.team[i].permissions** — 6 полів (canEdit, canDelete, canShare, canAddTeam, canViewBilling, canEditBilling). Дефолти призначаються по caseRole.

### Сервіси

- `aiUsageService.js` — logAiUsage, аналітичні хелпери
- `modelResolver.js` — resolveModel з ієрархією user → tenant → system
- `subscriptionService.js` (опційно) — recalculateCurrent

### Активовані заглушки

- `checkTenantAccess` — реальна перевірка user.tenantId === tenantId
- `checkCaseAccess` — мінімальна перевірка через tenant + team + externalAccess

### Принцип

Усі структури закладені, активної логіки мінімум. Дані збираються з запасом, ліміти не блокують. Готовність до моменту коли потрібно буде активувати реальний контроль.
```

**Не торкаємось інших застарілих розділів CLAUDE.md** — це робота окремого TASK CLAUDE.md Audit.

**Д5. Smoke tests** (~30 хв)

Після впровадження:

1. **Build:** `npm run build` має пройти без помилок
2. **Завантаження старого формату (масив):** взяти `registry_data_backup_pre_saas_<ts>.json`, підкласти на Drive як `registry_data.json` — має пройти ланцюжок v1 → v2 → v3 з обома бекапами (pre_saas і pre_v3)
3. **Завантаження v2 формату:** існуючий v2 → v3 з усіма новими полями
4. **Ідемпотентність:** перезавантажити v3 → лишається v3, без дублювань
5. **Реальний AI-виклик:** написати агенту в QI → перевірити що `aiUsage` отримав запис з правильними полями (агент, модель, токени, контекст)
6. **Drive sync:** hard reload, перевірити що ai_usage збережено
7. **Усі модулі працюють як раніше:** Дашборд, Реєстр, Досьє, QI, Записна книжка
8. **Tenant isolation:** штучно змінити user.tenantId на чужий → справи мають перестати завантажуватись

**Д6. Звіт + commit** (~30 хв)

Створити `report_saas_foundation_v1_1.md` за зразком `report_saas_foundation.md`:
- Візуалізація ДО/ПІСЛЯ
- Метрики (рядки коду, файли, час)
- Знайдені проблеми (якщо є)
- Критерії успіху

Один commit у main:
```
feat: SaaS Foundation v1.1 — patch and extension

- Виправлено архітектурний борг (agentHistory, levytskyi_action_log, id types, writeCases alias)
- ai_usage[] для пасивного обліку токенів (LIFO 50000)
- aiUsageService.js + інтеграція у всі точки виклику Anthropic API
- modelResolver.js з ієрархією user → tenant → system
- tenant.storage, tenant.modelPreferences, tenant.subscription заглушки
- case.team[i].permissions з дефолтами по ролі
- caseAccess[] заглушка для майбутнього SaaS-масштабу
- Активовано checkTenantAccess і checkCaseAccess (мінімальна логіка)
- migrationService: v2 → v3 ідемпотентна
- Backup pre_v3 (як pre_saas — поза ротацією)
- CLAUDE.md: розділ SaaS Foundation v3.0
```

---

## 🚨 ЩО НЕ РОБИМО В ЦЬОМУ TASK

- НЕ вирішуємо `proceedings/documents лише у Брановський` — переноситься в Document Processor v2
- НЕ активуємо реальну логіку лімітів `subscription.limits` — заглушки, ліміти null
- НЕ підключаємо реальний проксі-сервер для AI — окремий великий TASK
- НЕ міняємо UI — жодних нових кнопок, налаштувань, перемикачів
- НЕ змінюємо контентні промпти агентів (CASE_CONTEXT_CREATION_PROMPT, DOSSIER_AGENT_BASE_PROMPT, QI_DOCUMENT_ANALYSIS_PROMPT)
- НЕ робимо повний CLAUDE.md Audit — тільки додаємо розділ v3.0, інші розділи залишаються як є
- НЕ синхронізуємо `caseAccess[]` автоматично — це для майбутнього SaaS-масштабу
- НЕ закладаємо авторизацію другого користувача (Olena) — це окремий TASK Multi-user Activation в окремому чаті

---

## 🎯 SAAS IMPLICATIONS

Цей TASK закладає основу для трьох майбутніх архітектурних компонентів:

### 1. Білінг (Billing Foundation v2)

`ai_usage[]` — джерело SaaS-телеметрії. Окрема структура від `time_entries[]` з Billing Foundation. Дві структури — дві задачі:

- `ai_usage[]` — для тебе як SaaS-оператора (хто скільки токенів спалив, скільки коштує)
- `time_entries[]` — для адвоката як практика (час по справах для актів)

При кожному виклику API писатимемо в обидві структури — кожен запис малий.

### 2. Тарифні плани

`tenant.storage` + `tenant.modelPreferences` + `tenant.subscription.limits` — підготовка до моменту коли:
- Standard користувач (10 ГБ R2) і Premium з BYOS-Drive обираються через provider
- Premium може обрати Opus замість Sonnet для агента досьє
- Quota перевіряється централізовано через limits
- Перехід між тарифами — зміна полів без міграції

### 3. Multi-user permissions

`case.team[i].permissions` + активна `checkCaseAccess` + `caseAccess[]` — підготовка до Multi-user Activation TASK:

Коли в бюро з'явиться найманий адвокат (Olena):
- Її роль автоматично отримає правильні дефолти permissions
- Гранулярний контроль: можна дозволити редагувати справу, не міняти білінгові поля
- При SaaS-масштабі денормалізований caseAccess[] прискорить перевірки доступу

---

## 💰 BILLING IMPLICATIONS

Цей TASK — частина підготовки до повноцінного білінгу:

- **Кожен AI-виклик має вартість** в `ai_usage[i].estimatedCostUSD`
- **Можна агрегувати по справі** через `getUsageByCase()` → майбутня аналітика «AI-витрати на Брановського: $4.30 за квартал»
- **Можна агрегувати по користувачу** → майбутні ліміти за тарифом «Standard: $5/міс на AI, Premium: $20/міс»
- **Можна агрегувати по моделі** → оптимізація: «80% витрат — Sonnet, 15% — Haiku, 5% — Opus»
- **Тарифні пакети з вибором моделей** через modelPreferences

Pricing у `MODEL_PRICING` орієнтовний (станом на 04.05.2026). При зміні цін Anthropic — оновлюється в одному місці.

---

## 📦 ОЧІКУВАНІ АРТЕФАКТИ

### Створені файли

- `diagnostic_saas_foundation_v1_1.md` — діагностика перед впровадженням
- `progress_saas_foundation_v1_1.md` — прогрес роботи (опційно)
- `src/services/aiUsageService.js` — новий сервіс
- `src/services/modelResolver.js` — новий сервіс
- `src/services/subscriptionService.js` — опційно, тільки якщо recalculateCurrent окремим файлом
- `report_saas_foundation_v1_1.md` — фінальний звіт

### Змінені файли

- `src/services/migrationService.js` — додано migrateV2toV3, розширено ensureCaseSaasFields
- `src/services/tenantService.js` — DEFAULT_TENANT з усіма новими полями
- `src/services/permissionService.js` — активовано checkTenantAccess і checkCaseAccess
- `src/services/driveService.js` — видалено writeCases alias, додано backupRegistryDataPreV3
- `src/services/auditLogService.js` — можливо нові AUDIT_ACTIONS (наприклад action_log_merged)
- `src/App.jsx` — useState для aiUsage, інтеграція logAiUsage в усі AI-виклики, save/load aiUsage, виправлено id types при міграції, видалено застарілий коментар agentHistory
- `src/components/CaseDossier/index.jsx` — slice 50 у localStorage agentHistory, інтеграція logAiUsage у chat, resolveModel замість hardcoded
- Інші файли з точками виклику AI — інтеграція logAiUsage + resolveModel
- `CLAUDE.md` — розділ «SaaS Foundation v3.0 — Patch and Extension»

### Backup створений

- `_backups/registry_data_backup_pre_v3_<ts>.json` (поза ротацією)
- `_backups/levytskyi_action_log_<ts>.json` (одноразовий перед видаленням)

### НЕ створюємо

- Окремий файл `ai_usage_log.json` (зараз в registry_data.json, виносити окремо — для майбутнього TASK якщо файл стане великим)
- UI для перегляду витрат, моделей, лімітів (окремий TASK на основі цих даних)
- Real-time моніторинг (фонова задача — не для зараз)

---

## ✅ КРИТЕРІЇ УСПІХУ

1. ✅ `registry_data.json` має `ai_usage[]`, `caseAccess[]`
2. ✅ Кожен tenant має `storage`, `modelPreferences`, `subscription.limits + current + alerts`
3. ✅ Кожен case.team[i] має `permissions` з дефолтами по ролі
4. ✅ Усі case.id — string (не number)
5. ✅ `levytskyi_action_log` видалено з localStorage, цінні дані в auditLog
6. ✅ `driveService.writeCases` alias видалено, скрізь `writeRegistry`
7. ✅ agentHistory slice = 50 у localStorage (вирівняно з Drive і state)
8. ✅ Застарілий коментар у App.jsx:3273 видалено
9. ✅ `schemaVersion: 3`, `settingsVersion: "3.0_patch_and_extension"`
10. ✅ Міграція v1 → v2 → v3 ідемпотентна, з обома бекапами (pre_saas і pre_v3)
11. ✅ Файли `aiUsageService.js`, `modelResolver.js` створені
12. ✅ Усі точки виклику Anthropic API логують у `ai_usage[]` і використовують `resolveModel()`
13. ✅ `checkTenantAccess` і `checkCaseAccess` активовані з мінімальною логікою
14. ✅ Старі дані зберегли весь функціонал — система не зламалась
15. ✅ Vite build чистий
16. ✅ Усі smoke tests пройдено
17. ✅ CLAUDE.md оновлений (тільки розділ v3.0)
18. ✅ Звіт `report_saas_foundation_v1_1.md` створений
19. ✅ Один commit у main

---

## 🚧 МОЖЛИВІ РИЗИКИ І ОБХІДНІ ПУТИ

### Ризик 1: registry_data.json роздувається

`ai_usage[]` додає ~250 байт на кожен виклик AI. При 100 викликах/день — 25 КБ/день, 9 МБ/рік.

**Обхід:** LIFO ротація 50 000 записів (приблизно 1 рік активної роботи). Якщо стане великим — окремий TASK на винесення в `ai_usage_log.json` на Drive (як архіви time_entries в Billing Foundation).

### Ризик 2: Anthropic API не повертає usage в усіх кейсах

Деякі streaming-режими або помилкові запити можуть не мати `usage`.

**Обхід:** logAiUsage коректно обробляє відсутність — логується з 0 токенів і model 'unknown'. Краще ніж пропустити запис.

### Ризик 3: Міграція ламає ідемпотентність

Повторний запуск додає поля повторно — це баг.

**Обхід:** усі додавання через `if (!field) ...` перевірки. Smoke test 4 (повторне завантаження v3) це підтверджує.

### Ризик 4: Пропущена точка виклику AI

Claude Code знайшов 5 точок, реально 7 — дві не логуються.

**Обхід:** після впровадження зробити **тиждень спостереження** — переглянути `aiUsage` через тиждень, порівняти з очікуваним. Якщо є прогалина — допатчити.

### Ризик 5: id mixed types міграція ламає посилання

Деякі hearings/deadlines/notes посилаються на caseId як number, після міграції caseId стає string — посилання губляться.

**Обхід:** при міграції одночасно оновити всі **посилання** в hearings/deadlines/notes/timeLog. Перевірити в smoke test 7 (всі модулі працюють).

### Ризик 6: levytskyi_action_log merge втрачає дані

Старі записи можуть мати інший формат ніж очікуваний.

**Обхід:** перед видаленням створюємо повний бекап `_backups/levytskyi_action_log_<ts>.json`. Якщо щось пішло не так — можна відновити.

---

## 🤔 ПИТАННЯ ДЛЯ АДВОКАТА (на стадії діагностики)

Можуть виникнути в Claude Code під час діагностики:

**Q1.** Pricing моделей у `MODEL_PRICING` — використати саме ті цифри які в TASK, чи Claude Code підтягує актуальні з Anthropic документації?

**Q2.** Якщо знайдена точка виклику AI **не з фронтенду** (наприклад, в окремому скрипті) — логувати чи пропустити?

**Q3.** Чи додавати в `case.team[i].permissions` ще якісь поля (canCreateDocument, canDeleteDocument)?

**Q4.** id mixed types — формат строки. `case_<number>` чи `case_<UUID>`? Якщо case_<number> — гарантуємо що нові ID не конфліктують зі старими номерами?

**Q5.** `levytskyi_action_log` merge — які поля переносимо? Усі чи фільтруємо за певним критерієм?

**Q6.** `caseAccess[]` — структура запису якою має бути? Поки порожня, але може треба продумати схему наперед?

---

## 📅 ПОРЯДОК ВИКОНАННЯ

```
1. Прочитати CLAUDE.md, LESSONS.md, bugs_found_during_saas_foundation.md, 
   diagnostic_agentHistory.md (10 хв)

2. Фаза 0 — діагностика (45-60 хв)

3. Зупинка — згода адвоката

4. ЧАСТИНА А — Архітектурний борг (2-3 год):
   А1. agentHistory малий фікс (~7 хв)
   А2. levytskyi_action_log merge (~30 хв)
   А3. id mixed types (~1-2 год)
   А4. driveService.writeCases cleanup (~30-60 хв)

5. ЧАСТИНА Б — SaaS-телеметрія і структури (2-3 год):
   Б1. ai_usage[] (~1 год)
   Б2. aiUsageService.js + інтеграція (~1-2 год)
   Б3. tenant.storage (~15 хв)
   Б4. case.team[i].permissions (~30 хв)
   Б5. caseAccess[] (~5 хв)

6. ЧАСТИНА В — Тарифні пакети (1.5 год):
   В1. tenant.modelPreferences (~15 хв)
   В2. modelResolver.js (~30 хв)
   В3. tenant.subscription (~30 хв)
   В4. checkTenantAccess (~10 хв)
   В5. checkCaseAccess (~30 хв)

7. ЧАСТИНА Г — Знахідки адвоката (час залежить від кількості)

8. ЧАСТИНА Д — Технічна обвʼязка (2-3 год):
   Д1-Д3. migrationService + backup (~1.5 год)
   Д4. CLAUDE.md (~30 хв)
   Д5. Smoke tests (~30 хв)
   Д6. Звіт + commit (~30 хв)

ОРІЄНТОВНО: 7-10 робочих годин Claude Code (1 робочий день)
```

---

## 🎯 ПІСЛЯ ЗАВЕРШЕННЯ ЦЬОГО TASK

Послідовність далі:

```
1. ✅ TASK SaaS Foundation v1
2. 🔄 TASK SaaS Foundation v1.1 (цей)         ← ми тут
3.    TASK Billing Foundation v2              
       (структури time_entries, activityTracker, master timer,
        стандарти часу, місячна ротація, getTimeEntries API)
4.    TASK Tool Use Preparation
       (з урахуванням готового activityTracker і ai_usage)
5.    TASK CLAUDE.md Audit
       (одним проходом для всього нового каркасу:
        v2.0 SaaS, v3.0 Patch, v4.0 Billing, v5.0 Tool Use)
6.    TASK Travel Time Fix
       (перший модульний на повністю готовій архітектурі)
7.    TASK Multi-user Activation
       (окремий чат, окрема велика тема — підключення Olena)
8.    Інші модульні TASK...
```

---

**Кінець TASK SaaS Foundation v1.1 Patch and Extension**

Версія 1.1 — повна, готова до запуску. Очікую:
- Адвокат додає свої малі знахідки в Частину Г
- Запуск в Codespaces з Claude Code
