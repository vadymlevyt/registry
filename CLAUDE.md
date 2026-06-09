# CLAUDE.md — Legal BMS АБ Левицького

**Версія:** 5.9
**Останнє оновлення:** 09.06.2026
**Поточний schemaVersion:** 12
**Поточний settingsVersion:** "12.0_ecits_roles_dates"

---

## 🚨 ОБОВ'ЯЗКОВО ПЕРЕД БУДЬ-ЯКОЮ РОБОТОЮ

При старті будь-якого TASK Claude Code зобов'язаний:

1. Прочитати цей файл (CLAUDE.md) — архітектура системи
2. Прочитати DEVELOPMENT_PHILOSOPHY.md — філософія і принципи

**Без читання DEVELOPMENT_PHILOSOPHY.md TASK не починати.**

Філософські принципи мають вищий пріоритет за технічні деталі реалізації.

---

## ЩО ЦЕ ЗА ПРОЕКТ

Legal BMS — Legal Business Management System (кодова назва Registry v3) для адвокатського бюро Левицького. Спеціалізована операційна система для адвоката-практика з вбудованим AI.

**Стек:** React 18 + Vite 6 + ES modules
**Хостинг:** GitHub Pages — https://vadymlevyt.github.io/registry/
**Репо:** github.com/vadymlevyt/registry
**Розробка:** GitHub Codespaces (curly-space-zebra) + Claude Code Opus
**Drive:** registry_data.json в корені My Drive адвоката

### Структура файлів

```
registry/
├── index.html                  — entry-point (мінімальний)
├── src/
│   ├── App.jsx                 — головний компонент і state-orchestrator
│   ├── components/
│   │   ├── Dashboard/index.jsx — Activity Feed + календар + слоти
│   │   ├── CaseDossier/index.jsx — досьє справи з вкладками
│   │   ├── Notebook/index.jsx  — нотатки і записи
│   │   └── DocumentProcessor/  — пакетна обробка документів
│   ├── schemas/
│   │   └── documentSchema.js   — канонічна схема документа (23 + 6 полів) v5
│   └── services/
│       ├── driveAuth.js, driveService.js — Google Drive API
│       │   (uploadFileToCaseFolder — СПІЛЬНА точка заливки файлу у папку справи:
│       │    модалка+DP+майбутні; читає байти ПЕРЕД upload, правильний MIME)
│       ├── ocrService.js + ocr/ — OCR провайдер-патерн (planka Picatinny)
│       │   ├── documentAi.js  — Document AI (основний)
│       │   ├── claudeVision.js — fallback
│       │   └── pdfjsLocal.js  — локальний для малих файлів
│       ├── converter/         — конвертація форматів у PDF (TASK A)
│       │   ├── converterService.js — фасад (HTML/DOCX/image → PDF)
│       │   ├── htmlToPdf.js   — HTML → PDF через html2pdf.js
│       │   ├── docxToPdf.js   — DOCX → PDF (mammoth + html2pdf)
│       │   ├── imageToPdf.js  — JPG/PNG/HEIC/WEBP → PDF (jsPDF)
│       │   └── heicToJpeg.js  — HEIC → JPEG (heic2any pre-step)
│       ├── addFiles/addFilesService.js — СПІЛЬНИЙ сервіс «просто додати» (TASK 4 rework):
│       │                   createAddFiles(deps) — модалка і DP «просто додати»; нуль зв'язку з нарізкою
│       ├── compression/imageCompressor.js — рушій стиснення (зі стенда); compressFrontStep.js — фронт-крок
│       ├── documentFactory.js — createDocument(), validateDocument(), needsReview()
│       ├── documentsExtended.js — lazy-load для .metadata/documents_extended.json
│       ├── migrations/
│       │   └── v4ToV5.js       — canonical document schema migration
│       ├── tenantService.js, permissionService.js — SaaS Foundation
│       ├── auditLogService.js — критичні дії
│       ├── migrationService.js — schemaVersion і міграції (v1→v4)
│       ├── aiUsageService.js  — телеметрія токенів (для оператора SaaS)
│       ├── modelResolver.js   — ієрархія user → tenant → system
│       ├── subscriptionService.js — limits і current
│       ├── activityTracker.js — облік часу адвоката (для CRM)
│       ├── masterTimer.js     — state machine
│       ├── timeStandards.js   — стандарти за судами і категоріями
│       ├── smartReturnHandler.js — поведінка при поверненні
│       ├── timeEntriesArchiver.js — місячна ротація
│       ├── timeEntriesQuery.js — getTimeEntries API
│       └── moduleNames.js     — MODULES enum + categoryForCase()
├── CLAUDE.md                   — цей файл (root, читається на старті TASK)
├── DEVELOPMENT_PHILOSOPHY.md   — філософія розробки і ДНК-принципи (root)
├── LESSONS.md                  — інституційна пам'ять (root)
├── ARCHITECTURE_HISTORY.md     — хронологія TASK'ів, живий довідник (root)
├── tracking_debt.md            — реєстр відкладеного боргу, живий (root)
├── dossier_architecture_decisions.md — рішення по архітектурі досьє (root)
└── docs/                       — уся інша документація (звіти/аудити/...)
    ├── tasks/                  — TASK_*.md, micro_task_*.md (специфікації)
    ├── reports/                — report_*.md (звіти про завершення)
    ├── audits/                 — audit_*.md (аудити перед/після TASK)
    ├── diagnostics/            — diagnostic_*.md, DIAGNOSTIC_*.md
    ├── bugs/                   — bugs_found_during_*.md, discovered_issues_during_*.md
    └── consultations/          — consultation_*/questions_*/discussion_*/recommended_*.md
```

**Конвенція документації — куди писати нові `.md` (ОБОВ'ЯЗКОВО):**

У корені репо лишаються **тільки 6 канонічних файлів** (перелічені вище: `CLAUDE.md`,
`DEVELOPMENT_PHILOSOPHY.md`, `LESSONS.md`, `ARCHITECTURE_HISTORY.md`, `tracking_debt.md`,
`dossier_architecture_decisions.md`). **Жоден новий `.md` не створюється в корені.**

Будь-який новий документ у рамках TASK кладеться в `docs/<підпапка>/` за типом:

| Тип документа | Куди | Приклад імені |
|---------------|------|---------------|
| Специфікація TASK / micro-task | `docs/tasks/` | `TASK_<id>_<slug>.md` |
| Звіт про завершення TASK | `docs/reports/` | `report_task_<id>_<slug>.md` |
| Аудит до/після TASK | `docs/audits/` | `audit_before_<slug>.md` |
| Діагностика бага/симптому | `docs/diagnostics/` | `diagnostic_<slug>.md` |
| Знайдені баги / побічні знахідки | `docs/bugs/` | `bugs_found_during_<slug>.md`, `discovered_issues_during_<slug>.md` |
| Консультація / обговорення / питання | `docs/consultations/` | `consultation_<slug>.md`, `questions_<slug>.md` |

Якщо документ — оновлення живого довідника (`ARCHITECTURE_HISTORY.md`, `tracking_debt.md`),
редагуй наявний файл у корені, не створюй новий у `docs/`. Якщо тип не вкладається в
таблицю — обери найближчу підпапку, **не** клади в корінь.

**Білд:** `npm run build` (Vite → dist/)
**Auto-deploy:** GitHub Actions при push на main

---

## КРИТИЧНІ ПРАВИЛА

### №1 — Гілки
Воркфлоу залежить від середовища:

**Codespaces / десктоп Claude Code** — працювати прямо в `main`, окремих гілок не створювати.
Після змін: `git add -A && git commit -m "..." && git push origin main`

**Claude Code веб / планшет / телефон (remote execution)** — harness примусово видає
робочу гілку `claude/*` (прямий push у `main` із пісочниці неможливий). Розробка
і коміти — на цій гілці. Наприкінці задачі гілка зводиться в `main`:
- **Зміни тільки документації** (`*.md`) — автоматичний fast-forward + `git push origin HEAD:main`,
  **за умови** що це чистий FF і набір тестів зелений. Підтвердження не потрібне.
- **Зміни коду** — показати зведення змін у відповіді і отримати коротке (одне речення)
  підтвердження адвоката ПЕРЕД push у `main` (бо push у `main` тригерить CI + деплой
  GitHub Pages). Тільки FF, тільки при зелених тестах.
- Якщо не fast-forward (main розійшовся) — не примусово; розібрати розбіжність,
  не затирати.

### №2 — textarea в QI
textarea в Quick Input ЗАВЖДИ має фіксовану `height: 120px`.
НЕ flex:1, НЕ min-height, НЕ height:100%.
Кнопки (Файл/Нотатка/Аналізувати) поза scrollable div з `flexShrink:0`.

### №3 — Merge конфлікти
При merge двох версій коду — НІКОЛИ не залишати обидва варіанти.
Перевіряти після merge:
- Немає дублікатів змінних
- Немає мертвого коду після return
- В catch блоках немає return який блокує fallback

### №4 — Blank page
Blank page = JS помилка яка не перехоплена.
При будь-якій зміні в async функціях — обгортати в try/catch.
Особливо: pdfjsLib, FileReader, fetch до API.

### №5 — Апострофи в українському тексті
Апостроф у словах (пам'ять, пов'язаний) в JS рядках в одинарних лапках — ламає синтаксис.
Весь україномовний текст — в подвійних лапках або шаблонних рядках.

### №6 — schemaVersion registry_data.json
Поточна версія: `schemaVersion: 11`.
При зміні структури:
- Інкрементувати schemaVersion
- Додати міграцію в `migrationService.js` (для базових структур) або окремий файл у `src/services/migrations/` (для специфічної логіки — як `v4ToV5.js`)
- Міграція має бути **ідемпотентною** (повторні запуски не ламають дані)
- Перед першою міграцією — обов'язковий бекап `registry_data_backup_pre_<name>_<ts>.json` у `_backups/` поза ротацією
- `migrationService.js` тримає `BASE_CHAIN_VERSION = 4` для `migrateRegistry` (базовий ланцюг v1→v4). Експортовані `CURRENT_SCHEMA_VERSION = 12` і `MIGRATION_VERSION = '12.0_ecits_roles_dates'` — це таргет повного ланцюга. Документна схема v5 — окремий крок через `migrateRegistryV4toV5`. Founder flag v6 — `migrateToVersion6`. addedBy cleanup v6.5 — `migrateToVersion6_5`. ECITS canonical v7 — `migrateToVersion7`. time_entry.source→captureMethod v8 — `migrateToVersion8`. case.origin enum v9 (TASK 0.4) — `migrateToVersion9`. document.textFormat/cleanedAt v10 (TASK 3.1) — `migrateToVersion10`. document.variants v11 (TASK V2-A2) — `migrateToVersion11`. ECITS contract extension v12 (TASK v12 — case.advocateRole, case.advocateRoles[], ecitsState.firstDocumentDate/lastDocumentDate; адитивно, envelopeVersion лишається 1) — `migrateToVersion12`. Усі десять послідовно викликаються в `App.jsx` EFFECT-A (з власними бекапами і прапорами).

### №7 — executeAction async
`executeAction` — **async функція**. Усі callers що читають `.success`/`.error` — мусять `await`.
- Fire-and-forget виклики (без читання результату) безпечні
- Перед merge нових змін — перевірити що нові callers не читають Promise як sync-об'єкт

### №8 — Drive API і кирилиця
**НІКОЛИ** не використовувати кирилицю в параметрі `q=` Drive API — ненадійно.
Правильний патерн: отримати всі підпапки без фільтра, знайти потрібну в JavaScript.
OAuth токен Drive живе ~1 год → 401 = показати "перепідключіть Drive", не технічну помилку.

### №9 — Принцип "ембріон з повним ДНК"
Кожен новий модуль/функція проектується ОДРАЗУ з урахуванням SaaS + Multi-user + Billing.
**НЕ "потім додамо" — а одразу при народженні.**
Деталі — у файлі `DEVELOPMENT_PHILOSOPHY.md`.

### №10 — SAAS і BILLING IMPLICATIONS секції
Кожен новий TASK з суттєвими змінами повинен містити обов'язкові секції:
- **SAAS IMPLICATIONS** — як вписується в multi-tenant архітектуру
- **BILLING IMPLICATIONS** — точки інструментації, категорії time_entries

### №11 — Однозначність прапорців і полів
Кожен новий прапор / параметр / поле структури — **на місці оголошення** одне речення про єдиний сенс. Якщо сенс не вкладається в одне речення без «АБО» / «а також» / «інколи» — абстракція зібрана неправильно, розділи на дві сутності.

Перед розширенням існуючого імені новим сенсом (нова `&& flag` гілка в умові, нове значення в enum, нове поле в існуючу структуру) — **пауза**. Запитай: чи це справді той самий намір що поточний? Якщо ні — нове ім'я, не розширення.

Реальний кейс: `options.skipCache` керував і читанням, і записом OCR-кеша. Натискання «Розпізнати зараз» обходило старий кеш, але водночас блокувало запис нового — жовтий warning toast хоча Drive і код у нормі. Виправлено в мікро-TASK 2.2 розділенням умови запису від прапора читання.

Деталі — у `DEVELOPMENT_PHILOSOPHY.md` розділ «Однозначність».

---

## АРХІТЕКТУРА СИСТЕМИ

### Два основні system prompt

**HAIKU_SYSTEM_PROMPT** — для аналізу документів. Повертає ТІЛЬКИ JSON.
**SONNET_CHAT_PROMPT** — для чату. Повертає текст + ACTION_JSON.

Змішувати не можна — Haiku плутається і перестає повертати JSON.

### ACTIONS і PERMISSIONS — централізована архітектура

```js
// src/App.jsx
const ACTIONS = {
  update_case_field: { handler, audit: false },
  create_case: { handler, audit: true },
  destroy_case: { handler, audit: true, requireUI: true },
  add_hearing, update_hearing, delete_hearing,
  add_deadline, update_deadline, delete_deadline,
  add_note, update_note, delete_note, pin_note,
  add_time_entry, update_time_entry, cancel_time_entry,
  confirm_event, add_travel, cancel_travel,
  start_external_work, end_external_work,
  ... (19+ дій)
};

const PERMISSIONS = {
  qi_agent: ['create_case', 'add_note', 'add_hearing', ...],
  dashboard_agent: ['update_hearing', 'delete_note', ...],
  dossier_agent: ['add_note', 'update_note', 'add_deadline', ...],
  document_processor_agent: ['add_documents', 'update_processing_context', ...],
};
```

### Архітектура executeAction (архіваріус)

```
агент → executeAction(agentId, action, params)
              ↓
   1. Перевірка allowlist PERMISSIONS[agentId]
              ↓
   2. checkTenantAccess(userId, tenantId) — активна
              ↓
   3. checkRolePermission(userId, action) — заглушка (true для bureau_owner)
              ↓
   4. checkCaseAccess(userId, caseObj) — активна логіка
              ↓
   5. ACTIONS[action](params) — реальна логіка
              ↓
   6. shouldAudit(action) ? writeAuditLog : nothing
              ↓
   7. activityTracker.report() — billing інструментація
              ↓
   8. save до Drive (через useEffect)
```

`executeAction` — **async**. Усі callers мусять await якщо читають результат.

### ACTION_JSON парсинг — depth counter

```js
const idx = responseText.indexOf('ACTION_JSON:');
const start = responseText.indexOf('{', idx);
let depth = 0;
for (let i = start; i < responseText.length; i++) {
  if (responseText[i] === '{') depth++;
  else if (responseText[i] === '}') { depth--; if (depth === 0) { ... } }
}
```

Regex `[\s\S]*?` зупиняється на першій `}` — не використовувати для JSON.

### Моделі

- `claude-haiku-4-5-20251001` — аналіз документів (Haiku)
- `claude-sonnet-4-20250514` — чат-команди (Sonnet, default для агентів)
- `claude-opus-4-7` — глибокий аналіз (Opus, для tenant.modelPreferences Premium)

Усі виклики через `resolveModel(agentType)` (ієрархія user → tenant → system).

### findCaseForAction — пошук по 5 варіантах

1. Точний збіг імені
2. Базове ім'я без номера в дужках
3. По номеру справи case_no
4. Часткове співпадіння
5. По прізвищу в полі client

### handleFile — читання файлів

- Завжди використовувати `workingFile` (не `accessibleFile`, не `file` напряму)
- MIME fallback якщо немає розширення в імені
- Drive файли з хмари не читаються через `<input>` на Android — обмеження платформи

---

## СТРУКТУРА ДАНИХ

### Справа (Case)

```
{
  id (string: 'case_<n>' або 'case_<timestamp>'),
  name, client, category, status,
  court, case_no, judge, next_action,
  hearings: [{ id, date, time, duration, status, type, court?, notes? }],
  deadlines: [{ id, name, date }],
  notes: [{ id, text, category, ... }],
  pinnedNoteIds: [],
  timeLog: [],          // DEPRECATED since v4 — use top-level time_entries[]
  agentHistory: [],     // 3-tier cache (Drive → localStorage → state)
  documents: [{
    // 18 канонічних (легких) полів — у registry_data.json:
    id, name, originalName,
    category, author, documentNature, namingStatus, isKey,
    procId,
    driveId, driveUrl, folder,
    pageCount, size, icon,
    date, addedAt, updatedAt,
    addedBy, status
    // Важкі поля (tags, notes, annotations, processingHistory,
    // extractedTextSummary, customFields) — у .metadata/documents_extended.json
    // папки справи на Drive, lazy-load через documentsExtended.js
  }],
  storage: { driveFolderId, subFolders: { '01_ОРИГІНАЛИ': id, ... } },
  
  // SaaS v2 поля:
  tenantId, ownerId, createdAt, updatedAt,
  shareType (private | internal | external),
  externalAccess: [{ userId, validUntil, ... }],
  team: [{ userId, caseRole, addedAt, addedBy, permissions: {...} }]
}
```

### Notes (поза справою)

`localStorage 'levytskyi_notes'` — bucket-об'єкт:
```
{ cases: [], general: [], content: [], system: [], records: [] }
```

SaaS v2: кожна нота має `tenantId`, `createdBy`.

### Drive sync — registry_data.json v5

```json
{
  "schemaVersion": 5,
  "settingsVersion": "5.0_canonical_documents",

  "tenants": [...],
  "users": [...],
  "auditLog": [...],
  "structuralUnits": [],

  "cases": [...],             // documents[] у канонічній схемі (18 легких полів)

  "ai_usage": [...],          // SaaS телеметрія (LIFO 50000)
  "caseAccess": [],           // заглушка для майбутнього індексу

  "time_entries": [...],      // поточний місяць
  "master_timer_state": {...},
  "billing_meta": {...}
}
```

**Допоміжні файли на Drive (per case):**
```
<папка справи>/
├── 01_ОРИГІНАЛИ/           — оригінальні файли
├── 02_ОБРОБЛЕНІ/           — після нарізки/OCR
├── 03_ФРАГМЕНТИ/
├── 04_ПОЗИЦІЯ/
├── 05_ЗОВНІШНІ/
└── .metadata/
    └── documents_extended.json   — { documentId → { tags, notes, annotations,
                                       processingHistory, extractedTextSummary,
                                       customFields } }
```

`documents_extended.json` lazy-load через `documentsExtended.js` (in-memory кеш по `caseId`).

Старі формати автоматично мігруються через `migrationService.js`. Перед першою міграцією створюється бекап у `_backups/`.

### Структура time_entry

```json
{
  "id": "te_<ts>_<random>",
  "tenantId", "userId", "createdAt",
  "type": "session" | "action" | "hearing_attendance" | "travel" | ...,
  "module": "dashboard" | "case_dossier" | "qi" | ...,  // через MODULES enum
  "action": "tab_switched" | "agent_message" | ...,
  
  "caseId", "hearingId", "documentId",
  "duration", "startTime", "endTime",
  
  "category": "case_work" | "hearing_attendance" | "travel" | "admin" | "system" | "break" | "manual_entry",
  "subCategory", "billable", "visibleToClient", "billFactor",
  "status": "planned" | "active" | "needs_review" | "confirmed" | "auto_confirmed" | "user_corrected" | "cancelled" | "archived",
  
  "semanticGroup": "screen_active" | "screen_passive",
  "confidence": "high" | "medium" | "low" | "manual",
  "source": "timer" | "manual" | "agent" | "import" | "legacy",
  "exitedVia": "idle" | "visibility" | "manual" | "timeout" | "expected_offscreen" | "unexpected_screen_off",
  
  "parentEventId", "parentEventType", "direction",  // для travel
  
  "metadata": {...}
}
```

### Структура ai_usage

```json
{
  "id": "usage_<ts>_<random>",
  "tenantId", "userId", "timestamp",
  "agentType": "qi_agent" | "dashboard_agent" | "dossier_agent" | "document_parser" | "case_context_generator" | ...,
  "model", "inputTokens", "outputTokens", "totalTokens",
  "estimatedCostUSD",
  "context": { "caseId", "module", "operation" }
}
```

`time_entries[]` (для адвоката) і `ai_usage[]` (для оператора SaaS) — **ДВІ ОКРЕМІ структури з різними цілями**. Не дублювати.

---

## КАНОНІЧНИЙ СТАН — КОНСОЛІДОВАНИЙ ОПЕРАЦІЙНИЙ ДОВІДНИК

Це чинний контракт системи (станом на schemaVersion 7). **Повна історія, обґрунтування і покрокові міграції кожного пункту** — у `ARCHITECTURE_HISTORY.md` (хронологія TASK'ів, у корені) і у відповідних `docs/reports/*.md` / `docs/audits/*.md`. Тут — тільки те, що зобов'язує на старті будь-якого TASK.

### SaaS Foundation (v2 база + v3 розширення)

**tenant types (фіксований enum):** `solo` | `bureau` (наш `ab_levytskyi`) | `association` | `firm`. Cross-tenant: `external_collaborator`.

**Глобальні ролі за типом:** Solo: solo_advocate/solo_assistant. Bureau: bureau_owner/bureau_lawyer/bureau_assistant. Association: association_partner/lawyer/assistant. Firm: firm_managing_partner/partner/counsel/senior_associate/associate/junior_associate/paralegal/intern.

**caseRole (роль у команді справи):** `lead`/`owner` (повний контроль), `oversight` (read-only + втручання), `team_member`/`co-lead`/`support` (робота), `consulted` (read-only + коментує), `external` (тимчасовий доступ).

**Обов'язкові SaaS-поля кожної справи:** `tenantId`, `ownerId`, `team[]` (`[{userId, caseRole, addedAt, addedBy, permissions:{...}}]`), `shareType` (`private|internal|external`), `externalAccess[]`. Вкладені сутності (`hearings/deadlines/notes`) **не дублюють** `tenantId` (успадковують з parent), але отримують `createdBy`.

**`case.team[i].permissions` — 7 полів, дефолти за caseRole:**

| caseRole | canEdit | canDelete | canShare | canAddTeam | canViewBilling | canEditBilling | canRunAI |
|----------|---------|-----------|----------|------------|----------------|----------------|----------|
| owner    | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| lead     | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| co-lead  | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| support  | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| external | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |

`canRunAI` — точка тарифного обмеження AI по членах команди.

**AUDIT_ACTIONS (тільки критичні, `auditLogService.js`):** `create_case`, `close_case`, `restore_case`, `destroy_case`, `delete_hearing`, `delete_deadline`, `time_entries_archived`, `time_entry_edited`, `time_entry_deleted`, `time_standards_changed`. **НЕ пишемо:** `update_*`, `add_note`, `pin_note`, `add_hearing`, `add_deadline`, `add_time_entry` (шум переважає користь). `destroy_case` — запис `pending` ДО видалення → `done`/`failed`.

**Активні перевірки доступу (`permissionService.js`):** `checkTenantAccess` = `u.userId===userId && u.tenantId===tenantId`. `checkCaseAccess`: (1) tenant isolation; (2) bureau_owner → true в своєму tenant; (3) ownerId===userId; (4) team membership; (5) externalAccess з валідним validUntil. `checkRolePermission` — заглушка (true для bureau_owner).

**tenant readiness:** `tenant.storage` (provider `drive_legacy` default), `tenant.modelPreferences` (null × 9 агентів), `tenant.subscription.{limits(null)|current|alerts(warnAt:80,blockAt:100)}`. `caseAccess[]` — заглушка індексу `{caseId,userId,tenantId,caseRole,addedAt,expiresAt,permissionsHash}` (активується у Multi-user Activation). `ai_usage[]` — LIFO 50000 (структура — див. СТРУКТУРА ДАНИХ).

**Сервіси:** `tenantService`, `permissionService`, `auditLogService`, `aiUsageService` (`MODEL_PRICING` haiku/sonnet/opus — verify quarterly), `modelResolver` (`resolveModel(agentType)`, ієрархія user→tenant→system), `subscriptionService` (`recalculateCurrent`, `checkLimits`).

### Billing Foundation (v4)

**schemaVersion ланцюг:** `BASE_CHAIN_VERSION=4` (базовий ланцюг v1→v4 у `migrationService.js`). Експортовані `CURRENT_SCHEMA_VERSION=7`, `MIGRATION_VERSION='7.0_ecits_canonical'` — таргет повного ланцюга. Кроки в `App.jsx` EFFECT-A послідовно: `migrateRegistry`(→v4) → `migrateRegistryV4toV5` → `migrateToVersion6` → `migrateToVersion6_5` → `migrateToVersion7`. Кожен — власний бекап у `_backups/` поза ротацією + прапор проти повтору. Усі ідемпотентні.

**Категорії time_entry:** `case_work` (billable, visible, factor 1.0), `hearing_attendance`/`hearing_preparation`/`travel` (billable, visible, 1.0), `client_communication` (billable, visibleToClient:false, factor 0.5), `admin`/`system`/`break` (non-billable), `manual_entry` (за вибором адвоката).

**Billing ACTIONS:** `add_time_entry`, `update_time_entry`, `cancel_time_entry`, `delete_time_entry`, `split_time_entry`, `assign_offline_period`, `confirm_event(eventId,eventType,decision)`, `add_travel(parentEventId,parentEventType,direction,duration,options)`, `cancel_travel`, `start_external_work`, `end_external_work`, `update_external_work`, `track_session_start`, `track_session_end`.

**Двофазна модель події:** створення hearing резервує `time_entry` (status `planned`); travel — окрема категорія через явний `add_travel` (НЕ автоматично); підтвердження через `confirm_event`. Hearing variant matrix: `completed`, `postponed_opponent`, `postponed_self`, `court_fault` (factor 0.5/0.3 traveled/no_travel), `custom`. Auto-confirm 24-48-72 год.

**Місячна ротація:** 1 числа попередній місяць → `_archives/time_entries_YYYY-MM.json` на Drive; активний registry тримає тільки поточний місяць; `shouldArchive(billing_meta)` у Drive-load.

**Інструментація 25 точок** (усі в try/catch): App(4) app_launched/module_navigation/case_created/case_closed; Dashboard(5); CaseDossier(6); QuickInput(3); Notebook(2); DocumentProcessor(5). 10 точок Anthropic API мають паралельний `activityTracker.report('agent_call')` → `ai_usage[]` (токени) + `time_entries[]` (час). НЕ дублювати поля між ними.

**Permissions time_entries:** `TIME_ENTRY_ACTIONS`; `canViewTimeEntries` (bureau_owner все, інші свої); `canEditTimeEntry` (автор або bureau_owner).

**Сервіси:** `activityTracker` (`report`, `start/endSession`, `start/endSubtimer`, `assignOfflinePeriod` — усе в try/catch), `masterTimer` (states `stopped|active|paused|idle`, persist 60с, recovery 30хв, autoStart за `user.preferences.autoStartMasterTimer.enabled`), `timeStandards` (`getTimeStandard`), `smartReturnHandler` (experimental), `timeEntriesArchiver`, `timeEntriesQuery`, `moduleNames` (MODULES enum + `categoryForCase`).

**Experimental (`// review after 1 month`):** ACTIVITY_CATEGORIES (client_communication 0.5), EVENT_VARIANT_MATRIX (court_fault), стандарти часу, semanticGroup detection, IDLE_TIMEOUT_MIN (5хв), місячна ротація.

### Канонічна схема документа (поточна v11 — 28 легких полів)

SSOT: `cases[].documents[]` у `registry_data.json` — єдине джерело **легких** метаданих. Важкі поля — у `.metadata/documents_extended.json` (lazy-load). Жодних паралельних `documents_index.json`.

**27 легких полів** = 18 базових v5 (`id, name, originalName, category, author, documentNature, namingStatus, isKey, procId, driveId, driveUrl, folder, pageCount, size, icon, date, addedAt, updatedAt, addedBy, status` — насправді 20 у переліку: ідентифікація/класифікація/зв'язки/Drive/розмір/дати/аудит/стан) + `originalDriveId`, `originalMime` (TASK A) + `sourceConfidence`, `extractedAt`, `ecitsSource`, `movementCard`, `alternativeSources` (v7) + `textFormat`, `cleanedAt` (v10, TASK 3.1) + `variants` (v11, TASK V2-A2). Нові v7-поля — nullable default null; `textFormat` — required default `'txt'` (НЕ nullable), `cleanedAt` — nullable default null; `variants` — required default `{clean:null,digest:null}` (НЕ nullable; час генерації кожного AI-варіанту очистки, НЕ плутати з `textFormat`/`cleanedAt` — правило #11).

**Required+nullable** (присутнє, але null → маркер ⚠ «потребує перегляду»): `category`, `author`, `procId`, `driveId`.

**enum:** `category`: pleading|motion|court_act|evidence|contract|correspondence|identification|other|null. `author`: ours|opponent|court|third_party|null. `documentNature`: searchable|scanned. `namingStatus`: auto|manual|pending. `folder`: 00_INBOX_СПРАВИ|01_ОРИГІНАЛИ|02_ОБРОБЛЕНІ|03_ФРАГМЕНТИ|04_ПОЗИЦІЯ|05_ЗОВНІШНІ. `status`: active|archived. `textFormat`: txt|md (формат витягнутого тексту у 02_ОБРОБЛЕНІ; НЕ плутати з `documentNature`/`status` — правило #11).

**Extended (lazy-load `.metadata/documents_extended.json`):** `documentId, tags, notes, annotations, processingHistory, extractedTextSummary, customFields, attentionNotes` (v10 — що AI помітив при очистці тексту, БЕЗ зміни змісту; `[{ page?, note }]`).

**Сервіси:** `src/schemas/documentSchema.js` (`CANONICAL_DOCUMENT_FIELDS`, `EXTENDED_DOCUMENT_FIELDS`, `CRITICAL_FIELDS_FOR_WARNING`); `documentFactory.js` (`createDocument` — єдина точка, ID `doc_${Date.now()}_${rand36}`; `validateDocument`; `needsReview`; `getMissingCriticalFields`; `normalizeAddedBy` safety net); `documentsExtended.js` (`loadExtendedForCase`/`saveExtendedForCase`/`getExtendedForDocument`/`setExtendedForDocument`/`invalidateCache`; латиниця → `q=` безпечне); міграції `migrations/v4ToV5.js` (`migrateRegistryV4toV5`, `splitDocumentV4toV5`) + кроки v6/v6_5/v7/v8/v9/v10 у `migrationService.js`.

### Очистка тексту → Markdown (cleanTextService, TASK 3.1 → V2-A2)

> **ОНОВЛЕНО V2-A2 (clean_text v2, 3 режими).** Нижче — історія 3.1; чинний стан змінено так:
> (1) **Три режими** замість одного. `cleanDocument({ mode })`, `mode ∈ {'digest','clean'}`, default `'digest'`. `digest`=Конспект (поточний промт, переказує). `clean`=Чистий (НОВИЙ строгий промт: лише де-шум, НЕ міняти слово/цифру/дату/особу/рід). «Точний» — без AI, live з layout у в'ювері (V2-A1). Конспект — НІКОЛИ не джерело для агента/цитат.
> (2) **`.txt` НЕ пишемо коли є layout** (Document AI/фото-склейка) — `ocrService.extractText` + три явні write-точки. `.txt` лишається лише без layout (pdfjsLocal малі / searchable/конвертер).
> (3) **`.layout` і `.txt` ЗБЕРІГАЮТЬСЯ при очистці** — `deleteLayout`/`moveRawTxtToArchive` ПРИБРАНО (layout=джерело Точного/повтору; .txt=вірний текст no-layout). Success-шлях: лише `saveMarkdown(mode)` + `updateDocumentMeta(variants)`.
> (4) **Зберігання за суфіксом**: `<base>_<id>.clean.md` / `.digest.md` (обидва співіснують). Legacy `<base>_<id>.md` читається як digest.
> (5) **DP більше НЕ чистить** — пост-крок (`cleanForReading`/`cleanFinalizedDocument`) + тумблер прибрано повністю. Очистка стала справою в'ювера / ACTION `clean_document_text` (приймає `mode`, default digest). Ядро+adapter лишаються.
> (6) **Хелпер `getDocumentText(doc, caseData)`** (`ocrService`) — ЄДИНА точка ВІРНОГО тексту: scanned layout→`page._text`, інакше `.txt`; НІКОЛИ не Конспект. Споживачі: `contextGenerator` (helper-first, fallback `extractTextBatch`), агент, в'ювер. `getCleanOrRawText` тепер: digest `.md`→інакше вірний текст (layout→`.txt`).
> (7) **schema 11**: `document.variants` `{clean,digest}` + `update_document` allowlist отримав `variants`.
> Деталі: `docs/reports/report_task_v2a2_core.md`. Решта 3.1-опису — історичний контекст.


Спільне ядро `src/services/cleanTextService.js` — сирий OCR-текст сканованого документа → гарний читабельний Markdown, НЕ міняючи юридичний зміст. **Скоуп ТІЛЬКИ `documentNature==='scanned'`** (skoup-гард; searchable повністю поза функцією — у нього вже чистий цифровий текст). 3-кроковий гібрид: `layoutToMarkdownDraft` (КРОК 1, детермінований конденсатор, 0 токенів — читає layout ПОСТОРІНКОВО через `page._text`+геометрія boundingPoly, НЕ offset'и в глобальний .txt; дзеркало `pageMarkers.js`) → `polishToMarkdown` (КРОК 2, Haiku, консервативний, JSON depth-counter, повертає `{markdown, attentionNotes}`) → `cleanDocument` (КРОК 3 оркестрація + долі артефактів: `.md` створити, `.txt`→`_raw_txt/`, `.layout.json` видалити, метадані `textFormat:'md'`+`cleanedAt`+`attentionNotes`). C7-логування один шлях: `logAiUsage` (agentType `text_cleaner`) завжди; `activityTracker.report` лише при `billAsUserAction` (default true для кнопок/ACTION; **DP передає false** — автопродовження). agentType `textCleaner` у `SYSTEM_DEFAULTS` → Haiku. **Споживач у 3.1 — Document Processor, очистка як ПОСТ-КРОК** (нова філософія адвоката): тумблер «Очистити для читання» — НЕ очистка до нарізки, а той самий `cleanDocument`, підключений ОСТАННІМ кроком у `splitDocumentsV3` (ПІСЛЯ `writeProcessedArtifacts`, коли `.txt`+`.layout` готові у 02) по кожному готовому `scanned`-документу. Очистка СТРОГО після нарізки/склейки на роз'єднаних документах → дилема «не можу різати MD по сторінках» зникає (працює однаково для slice і image_merge). `extractV3` більше НЕ чистить (лишає сирий `.txt`); inline-дубль `aiCleanText` ліквідовано. Drive-шви ядра (`fetchLayout`/`fetchRawText`/`saveMarkdown`/`moveRawTxtToArchive`/`deleteLayout`/`updateDocumentMeta`) — у `cleanTextDriveAdapter.js` (`buildCleanDocumentDriveDeps`) поверх `ocrService` (`getCachedLayout`/`getCachedText`/`writeMarkdownArtifact`/`archiveRawTxt`/`deleteLayoutArtifact`) + `executeAction update_document` (textFormat/cleanedAt) + `documentsExtended` (attentionNotes); **їх перевикористає 3.2** (кнопки стають тонкими). `update_document` allowlist отримав `textFormat`/`cleanedAt`; `document_processor_agent` — дозвіл `update_document`. Кнопки ретроактивної очистки — 3.2, мультивибір реєстру — 3.3. Viewer читає `.md` через `ocrService.getCleanOrRawText` (спочатку `.md`, інакше `.txt`) + `MarkdownRenderer` (легкий MD→HTML, без npm-залежності).

**Точки створення документа (всі через `createDocument()`), `addedBy`:**

| Точка | Файл | addedBy |
|-------|------|---------|
| CaseDossier модаль «+ Додати документ» | `CaseDossier:2452-2486` | `user` |
| CaseDossier drag-n-drop drop queue | `CaseDossier:1940-2010` | `user` (через `update_case_field` — тимчасово) |
| INITIAL_CASES (seed Брановський) | `App.jsx:100-113` | `system` |

### addedBy ↔ source — DISAMBIGUATION (правило-рівень, #11)

Два паралельні поля на РІЗНІ питання — не плутати:

**`document.addedBy`** — ХТО/ЩО зробило акт додавання (actor): `user` (адвокат/помічник вручну) | `agent` (AI-агент) | `system` (міграція/автосинхронізація).

**`document.source`** — ЗВІДКИ прийшов файл (канал). enum v7 (перейменовано з v6.5): `manual` (було `manual_upload`) | `court_sync` (було `ecits`) | `metadata_extractor` | `telegram` | `email` | `unknown` | `null`.

Однозначні комбінації: `{addedBy:'system', source:'court_sync'}`, `{addedBy:'user', source:'manual'}`, `{addedBy:'agent', source:'telegram'}`, `{addedBy:'user', source:'email'}`.

**sourcePolicy.js** — `SOURCE_PRIORITY`: `manual`(100) > `court_sync`(80) > `metadata_extractor`(60) > `telegram`/`email`(50) > `unknown`(10). `canOverwrite(existing,new)` → true якщо новий пріоритетніший.

### Розширення схеми v7 (ЄСІТС)

Обидва канали (Court Sync, Metadata Extractor) пишуть у ту саму схему через ті самі ACTIONS; споживачі джерело не розрізняють.

- **case (+3):** `ecitsState` (з `syncMetrics` counters), `parties[]`, `processParticipants[]`. `team[]` — НЕ чіпати (internal bureau ≠ processParticipants).
- **proceeding (+1):** `composition` (`{presiding, reporter, members[]}`).
- **hearing (+6):** `source`, `sourceConfidence`, `extractedAt`, `ecitsContext`, `assignedTo`, `attendedBy[]`. `add_hearing`/`update_hearing` приймають backward-compat (warning якщо source не передано).
- **user (+1):** `ecitsCabinetIdentifier` (multi-user dedupe).

**Нові ACTIONS (8):** Sync: `mark_synced_from_ecits`, `update_case_ecits_state` (patch тільки для `ecitsState`). Edit (AI-first дзеркало R1): `update_parties`, `update_team` (без source), `update_process_participants`, `update_proceeding_composition`, `update_document_movement_card`, `update_alternative_sources` (append). Усі публікують подію в eventBus з `tenantId` у payload.

**PERMISSIONS — дві ролі:** `court_sync_agent` (enabled; дозволено `add_hearing`, `update_hearing`, всі 8 нових; заборонено `destroy_case`/`add_document`/`update_document`/`delete_document`/`create_case`). `metadata_extractor_agent` (defined, **DISABLED** через порожній allowlist `[]` — не активувати).

**Billing v7:** `SYSTEM_ACTIONS_NO_BILLING` (Set): `mark_synced_from_ecits`, `update_case_ecits_state`. `EDIT_ACTIONS_SOURCE_AWARE` нараховуються тільки коли `source==='manual'`; з `court_sync`/`metadata_extractor` — НЕ нараховуються.

### Founder flag (v6)

`users[].isFounder` — **глобальна** позначка власника продукту (не tenant-scoped). `DEFAULT_USER` (`vadym`) → true, решта false. Хелпер `isCurrentUserFounder()` = `getCurrentUser()?.isFounder===true` (false для null). Точка для founder-only UI (Розвідник, Admin metrics). НЕ для tenant-доступу, НЕ для білінгових лімітів, НЕ UI-перемикача.

### Court Sync MVP (TASK 0.4, schemaVersion 9)

**Сценарій:** адвокат → «Електронний суд» → «Імпорт» → копіює промпт → вставляє у Claude for Chrome (sidebar браузера) → агент обходить кабінет ЄСІТС, фільтрує справи за роком (25/26), повертає JSON envelope → адвокат вставляє у textarea «Обробити». Legal BMS створює нові справи (`origin='ecits_import'`, name префікс `[ЄСІТС]`), оновлює існуючі (за `ecitsState.caseId`), додає засідання 2026 (`hearing.source='court_sync'`). Підсумок у ResultCard.

**case.origin enum (v9):** `manual` (default) | `ecits_import` | `telegram_import` | `email_import`. Аналог `document.source` на рівні справи. НЕ плутати з `case.team[].addedBy` (хто додав у команду — інший сенс, правило #11). Міграція `migrateToVersion9` ставить `'manual'` усім існуючим справам (до bump'а всі створювались адвокатом вручну).

**Розширений `create_case`** (`actionsRegistry.js`): підтримує два формати — legacy `({ fields })` і плоский `({ name, case_no, ..., origin, ecitsState, parties, processParticipants })`. Плоскі ключі мають пріоритет над `fields`. Дедуплікація: якщо `params.ecitsState.caseId` уже існує — повертає `{ success: false, error: 'duplicate_ecits_case', existingCaseId }`. Використовує `ensureCaseSaasAndEcitsFields` (v7+v9 канонічний дефолт) замість лише `ensureCaseSaasFields`.

**`ensureCaseSaasAndEcitsFields`** — нова точка нормалізації для нових справ (R1 fix). Накладається поверх `migrateCase`/`ensureCaseSaasFields`, додаючи `ecitsState` (з `buildDefaultEcitsState`), `parties[]` `[]`, `processParticipants[]` `[]`, `origin='manual'`. Існуючі справи з Drive ідуть через міграційний ланцюг — ця функція їх не чіпає.

**PERMISSIONS — `court_sync_agent` отримав `create_case`** (12 дозволених дій). Заборонено: `destroy_case`, `add_document`, `update_document`, `delete_document` — Court Sync MVP не пише документи.

**Білінг (R5 fix):** `add_hearing` і `update_hearing` додано в `EDIT_ACTIONS_SOURCE_AWARE`. Виклики з `source='court_sync'`/`metadata_extractor` НЕ нараховуються (автосинхронізація, не робота адвоката). Виклики з `source='manual'` (адвокат) — нараховуються як раніше. Додатково: `create_case` з `origin='ecits_import'` теж виключається з білінгу через окрему перевірку у hook'у.

**4 архітектурні закладки розширення (повне ДНК для Track B — власне Chrome extension):**

1. **`extensionBridge.js`** (`src/services/extensionBridge.js`): module-scoped state + `configure(deps)` (кожен render у App.jsx) + `enable()` (один раз ПІСЛЯ hydration). Публікує `window.LegalBMS` з `apiLevel`, `version`, `whenReady()`, `submitScenarioResult(envelope)` (transport='extension'), `on(event, handler)` (eventBus), `getEntitlements()`. Емітить DOM event `legalbms:ready`. `registerExtension` — НЕ закладено (YAGNI, tracking_debt).

2. **`hashRouter.js`** (`src/services/hashRouter.js`): мінімальний hash-router без зовнішніх пакетів. Граматика `#/<module>[/<entityId>][/<view>]`. `registerRoute(moduleId, { onEnter, onLeave? })`, `subscribe(listener)`, `navigate(path)`, `start()`, `stop()`. Court Sync роут `#/court-sync/<subtab>` (overview/import/log/settings/discrepancies) — target для майбутнього extension і deep-link'ів. Інші модулі додають свої роути без переписування ядра.

3. **`tenant.subscription.entitlements`** (поряд з legacy `features:['all']`): per-module/scenario декларація. Структура `{ [moduleId]: { enabled, scenarios?, trialMode, expiresAt, remainingUsages } }`. Сервіс `entitlementsService.js`: `canUseModule(tenant, moduleId, scenarioId)` → `{ allowed, reason, source }`; `getForExtension(tenant)` (handshake); `ensureEntitlements(subscription)` (з `migrateTenant`). `tariffMatrix.js` — `TARIFF_MATRIX` з планом `self_hosted` (наш поточний); майбутні плани додаються рядками. Legacy `features:['all']` НЕ видаляється (помічене як deprecated в tracking_debt).

4. **`scenarioProcessor.js`** (`src/services/ecits/scenarioProcessor.js`): спільна функція для UI («Обробити» в ImportTab) і майбутнього extension. DI: приймає `{ executeAction, agentId, transport, getCases, getTenant, appendScenarioHistoryEntry, onProgress }`. Кроки: `validateEnvelope` → для кожної ecitsCase: дедуплікація через `ecitsState.caseId` → `create_case`/`update_case_ecits_state` → `add_hearing` для нових засідань → `appendScenarioHistoryEntry`. Повертає `{ casesCreated, casesUpdated, hearingsAdded, skipped, errors, warnings, scenarioRunId }`.

**Журнал виконань:** `tenant.ecits_scenario_history[]` LIFO cap 200. Дзеркало `recon_history[]`. Структура: `{ scenarioRunId, scenarioId, scenarioVersion, transport, startedAt, completedAt, status, tenantId, userId, result: {casesCreated, casesUpdated, hearingsAdded, skipped}, errors }`. БЕЗ schema bump (розширення `DEFAULT_TENANT` без міграції). НЕ дублює `time_entries`, `ai_usage`, `auditLog`.

**Безпекові межі (`src/services/ecits/safety.js`):** `ECITS_NEVER_TOUCH` (UI кнопки — «НАДАТИ ЗГОДУ», «ОСКАРЖИТИ», «НАДІСЛАТИ», «ВИДАЛИТИ», ...), `ECITS_NEVER_DO` (категорії — javascript_tool, доступ до файлової системи, OAuth Drive токени, посилання поза cabinet.court.gov.ua). `buildSafetyBlock()` вшиває це у промпт; `isForbiddenAction(label)` — для майбутнього програмного enforcement у власному розширенні.

**Промпт (`src/services/ecits/promptBuilder.js`):** `buildEcitsImportPrompt({ targetHearingYear=2026, acceptedCaseYears=[25,26] })`. Фільтр справ за роком у case_no (третій сегмент `NNN/NNNNN/NN[-X]`). Інструкція дедуплікації засідань (одна дата = одне засідання, навіть якщо кілька повісток). Витягає `ecitsCaseId` (32-hex з URL), `case_no`, `court`, `category`, `advocateRole`, `primaryParty`, `cabinetUrl`. Засідання: `date`, `time`, `hearingRoom`, `proceedingNumber`, `noticeType`, `cabinetUrl`. Структура envelope: `{ envelopeVersion:1, scenarioId:'ecits_import_cases_and_hearings', scenarioVersion:1, data: { ecitsAdvocate, stats, cases:[{ ecitsCaseId, case_no, ..., hearings:[...] }], warnings, skipped } }`.

**UI модуля Court Sync (`src/components/CourtSync/`):** 3 активні вкладки — `OverviewTab` (статистика + історія синхронізацій), `ImportTab` (3 кроки: copy prompt → run у Claude for Chrome → paste JSON + Обробити, ResultCard з підсумком), `SettingsTab` (поле `ecitsCabinetIdentifier` — інформативне поки multi-user не активований). `Журнал` і `Розбіжності` — заглушки (наступні TASK). `Розвідник` — лише для founder (`isCurrentUserFounder()===true`).

**Чого MVP TASK 0.4 НЕ робить (→ `future_scenarios_court_sync.md`):** алгоритм matchingу з тестовими справами; ручне об'єднання (merge_cases); dismissedMatches/syncDisabled; soft delete; синхронізація документів з ЄСІТС (чекає на DP v2); парсинг складу суду/сторін/картки руху; автоматизація передачі JSON (copy-paste у MVP); активація `metadata_extractor_agent` (досі DISABLED).

### Модуль «Електронний суд» (TASK 0.2/0.3) — інфраструктурний скелет

Вкладка (іконка `Scale`) між «Книжкою» і «Новою справою»; `src/components/CourtSync/index.jsx`. Підвкладки ЄСІТС (Огляд/Журнал/Налаштування/Розбіжності — заглушки) видимі всім; «Розвідник» — тільки founder. Точки розширення: `eventBus.js`+`eventBusTopics.js` (`ecits.documents_received|hearing_scheduled|case_status_changed|submission_completed`); `ecitsService.js` (фасад-заглушки `triggerSync`/`getLastSyncTime`/`getSyncReport`/`getSettings`/`updateSettings` + recon API); `tenant.settings.moduleIntegration.ecits` (tenant-scoped, без міграції); `driveService.getOrCreateResearchFolder` (lazy `_research/ecits/`, `_research/competitors/`). Recon: сценарій `RECON_ecits_basic_v1`, артефакти на Drive `_research/ecits/<reconId>/`, історія в `localStorage('levytskyi_recon_history')` + `tenant.recon_history[]`; виконується через Claude for Chrome адвоката (НЕ списує наші токени, НЕ публікує події). Тільки існуючі design-токени, без емодзі в UI модуля.

### TASK A — конвертація форматів у PDF (AddDocumentModal)

PDF — єдиний формат відображення. `src/services/converter/` фасад `converterService.convertToPdf(file,context)`:

| Тип | Конвертер | Збереження |
|-----|-----------|------------|
| PDF | passthrough | як є → 01_ОРИГІНАЛИ |
| HTML | `htmlToPdf.js` | тільки PDF |
| DOCX | `docxToPdf.js` (mammoth→html2pdf) | PDF + DOCX як `originalDriveId` |
| image | `imageToPdf.js` (Canvas+jsPDF) | тільки PDF |
| HEIC | `heicToJpeg.js`→imageToPdf | тільки PDF |

Контракт: `{pdfBlob, originalBlob, pdfName, originalName, originalMime, warnings, converter, durationMs}` (+ `extractedText` для DOCX/HTML).

**Дві гілки:** DOCX/HTML — текст уже витягнуто (mammoth/innerText), `documentNature='searchable'`, пишеться у `02_ОБРОБЛЕНІ/<basename>_<driveId>.txt`, Document AI **НЕ викликається**, `.layout.json` не пишеться. PDF/image — OCR-pipeline (pdfjsLocal→documentAi), генерує `.txt`+`.layout.json`. `ocrService.serializeLayout` фільтрує `image`/`tokens` з кожної сторінки (~7МБ→~100-500КБ; pageStructure у пам'яті повний).

**Помилка `convertToPdf`** → `toast.error`, модалка лишається відкритою, документ НЕ створюється, на Drive нічого. Помилка `originalBlob` (DOCX поряд) — не критична (PDF уже є, без `originalDriveId` + warning).

Feature flag `CONVERT_DOCX_TO_PDF` (default true, у `converterService.js`, зміна = деплой, НЕ через UI). Залежності lazy через `import()`: `html2pdf.js`, `jspdf`, `heic2any`. `modelResolver.SYSTEM_DEFAULTS.imageSorter='claude-sonnet-4-20250514'` — точка для TASK B.

### ЗАБОРОНЕНО (консолідовано)

- НЕ обходити `executeAction` для модифікацій даних; НЕ обходити `createDocument()` / `converterService.convertToPdf` / `activityTracker.report`.
- НЕ створювати нові сутності без `tenantId`; НЕ дублювати `tenantId` у вкладених сутностях; НЕ дублювати поля між `ai_usage[]` і `time_entries[]`; НЕ дублювати важкі поля документа в `cases[].documents[]`.
- НЕ додавати поля в канонічну схему без bump schemaVersion + міграції; НЕ розширювати `addedBy`/enum без bump (signal порушення #11).
- НЕ використовувати `addedBy` для «звідки файл» (це `source`); НЕ повертати legacy `lawyer_via_dp`/`lawyer_manual`/`ecits`/`migration`/`manual_upload` у новий код.
- НЕ замінювати заглушки на реальну логіку без узгодження; НЕ додавати UI керування користувачами/ролями; НЕ створювати UI білінгу (окремий TASK); НЕ UI-перемикач `isFounder`.
- НЕ використовувати `isFounder` для tenant-доступу/білінгу; НЕ зав'язувати ліміти на `isFounder`.
- НЕ робити `add_travel` автоматичним при створенні hearing; НЕ видаляти `case.timeLog[]` (DEPRECATED, лишається порожнім).
- НЕ активувати `metadata_extractor_agent`; НЕ міняти семантику `case.team[]`; НЕ використовувати `update_case_ecits_state.patch` для не-`ecitsState` полів; НЕ створювати відкладені ACTIONS (`add_timeline_event`, `update_case_dnzs`).
- НЕ перейменовувати `client`/`judges` — denormalized summary до окремого backfill TASK (→ `tracking_debt.md`).
- НЕ повертати TASK B (склейка зображень); НЕ міняти `CONVERT_DOCX_TO_PDF` через UI; НЕ викликати Document AI на конвертованому з DOCX/HTML PDF; НЕ продовжувати pipeline якщо `convertToPdf` кинув.
- НЕ використовувати кирилицю в `q=` Drive API (правило #8).

---

## АРХІТЕКТУРНЕ ПРАВИЛО — СПІЛЬНИЙ СТАН

Єдине джерело правди для всіх модулів — `App.jsx`.

**НЕ можна:**
- Тримати cases[], notes[], calendarEvents[] всередині компонента
- Викликати setCases() напряму з компонента
- Дублювати дані між модулями

**МОЖНА і ТРЕБА:**
- Отримувати дані через props
- Змінювати дані через функції з props
- Тримати в компоненті тільки UI-стан (активна вкладка, текст в полі)

Функції зміни спільних даних живуть **ТІЛЬКИ** в App.jsx:
- updateCase(caseId, field, value)
- addNote(note) / deleteNote(noteId)
- addCalendarEvent(event) / updateCalendarEvent(id, updates) / deleteCalendarEvent(id)

---

## AGENT HISTORY — 3-TIER CACHE PATTERN

Це **НЕ архітектурний борг**, а валідний 3-tier cache:

1. **`cases[i].agentHistory`** — резервний fallback в registry
2. **`localStorage.agent_history_<caseId>`** — швидкий кеш при старті
3. **`agent_history.json`** на Drive — головна персистентна копія

Логіка:
- Запис: пишеться в усі 3 одночасно
- Читання: каскад Drive → localStorage → registry
- Slice: 50 повідомлень у всіх трьох (раніше був баг — 20 в localStorage, виправлено)

Деталі — `docs/diagnostics/diagnostic_agentHistory.md`.

---

## ERRORBOUNDARY — ПРИНЦИП СТІЛЬНИКА В КОДІ

Один клас в App.jsx. Обгортає кожен великий модуль при рендері.
Якщо модуль падає — решта системи працює.

```js
class ErrorBoundary extends React.Component {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return (
      <div style={{padding:20,color:"#e74c3c"}}>
        ⚠️ Модуль тимчасово недоступний
        <button onClick={()=>this.setState({hasError:false})}>Спробувати знову</button>
      </div>
    );
    return this.props.children;
  }
}
```

Використання: `<ErrorBoundary><CaseDossier .../></ErrorBoundary>`

---

## OCR — ПРОВАЙДЕР-ПАТЕРН (PLANKA PICATINNY)

`src/services/ocrService.js` — фасад. Один інтерфейс для всіх модулів які потребують OCR.

```
ocrService.js
  ↓ автоматично використовує:
ocr/documentAi.js (основний — процесор ab-levytskyi-ocr, europe-west2)
ocr/claudeVision.js (fallback)
ocr/pdfjsLocal.js (локальний для малих файлів)
```

**Document AI:**
- Project: registry-ab-levytskyi
- Processor: 2cc453e438078154
- Region: europe-west2
- Стабільно розпізнає українські судові документи
- Перевершує Claude Vision за стабільністю і швидкістю на великих файлах

**Як використовується:**
- Document Processor v2 (планується) — семантична нарізка
- Context Generator (вже є) — формування case_context.md
- Майбутні модулі — через той самий фасад

`pdf-lib` — локальна нарізка великих PDF на чанки по 25 стор перед Document AI.

---

## TOOL USE СТРАТЕГІЯ

### Поточний стан

Більшість агентів працюють через JSON ACTIONS:
- QI agent ✓ (стабільний, не чіпаємо)
- Dashboard agent ✓ (стабільний, не чіпаємо)
- Dossier agent в режимі чату ✓ (тільки спілкується)

### Міграція на tool use

Tool Use **НЕ окремий preparation TASK**. Закладається ВПЕРШЕ в TASK який його реально потребує — **Document Processor v2**.

```
src/services/
├── toolUseRunner.js       — універсальний раннер (НОВЕ)
└── toolDefinitions.js     — реєстр доступних tools (НОВЕ)
```

Перший модуль закладає інфраструктуру. Наступні переюзовують.

### На tool use:
- Document Processor v2 (запланований)
- Context Generator (інтегрований з Document Processor)
- Canvas-конструктор документів (запланований, нативно tool use)
- Майбутні модулі що цього потребують

### НЕ мігруємо:
- QI, Dashboard, Dossier-чат — працюють стабільно

---

## ТЕСТУВАННЯ

**Стек:** Vitest 4.x (test runner), Node environment.

### Команди

- `npm test` — повний прогон (для CI/CD).
- `npm run test:watch` — watch mode під час розробки.
- `npm run test:ui` — графічний UI у браузері (опційно).

### Структура

```
tests/
├── unit/                   — юніт-тести сервісів (чисті функції, без DOM)
│   ├── documentFactory.test.js
│   ├── documentSchema.test.js
│   ├── documentsExtended.test.js
│   ├── migrations.test.js
│   ├── toolDefinitions.test.js
│   └── toolUseRunner.test.js
└── integration/            — workflow-тести (executeAction + ACTIONS + PERMISSIONS)
    ├── _actionsTestSetup.js — тонкий адаптер над реальним createActions (0 ACTION-логіки)
    ├── actions.test.js
    ├── drag-n-drop.test.js
    ├── agent-workflow.test.js
    ├── update_document_source.test.js
    └── document-processor.test.js
```

ACTIONS / PERMISSIONS / executeAction винесено з App.jsx у `src/services/actionsRegistry.js` як factory `createActions(deps)` (TASK 5). App.jsx створює інстанс у тілі компонента (кожен render) і прокидає `executeAction` пропом у Dashboard/CaseDossier — НЕ глобальний сінглтон; спільний стан лишається в App.jsx і приходить у factory через `deps` (`getCases`/`setCases`/…). Контракт `executeAction(agentId, action, params, [userId])` незмінний. `tests/integration/_actionsTestSetup.js` — тонкий адаптер: НУЛЬ дублювання логіки, лише конструює ізольовані deps поверх справжнього `createActions` (старий `_actionsHarness.js`, що дублював ACTIONS вручну, видалено — ручної синхронізації більше немає). Чисті/детерміновані залежності лишаються прямими `import` у `actionsRegistry.js`; стан React, Drive/audit/billing/eventBus сайд-ефекти і permission-заглушки ін'єктуються (App підставляє реальні, тести — стаби).

### Правило для нових TASK

Кожен TASK з суттєвими змінами повинен:
1. Додати юніт-тести для нових сервісних функцій у `tests/unit/`.
2. Додати інтеграційні тести для нових workflow'ів у `tests/integration/` якщо торкається ACTIONS/PERMISSIONS.
3. Перед коммітом — `npm test` повністю зелений.

CI/CD блокує деплой якщо хоч один тест червоний.

### CI/CD

`.github/workflows/deploy.yml` має три послідовні job-и: `test → build → deploy`. Будь-який red test блокує build і deploy. Артефакти не публікуються поки тести не зелені.

---

## ПОТОЧНИЙ СТАН СИСТЕМИ

### Завершено

- ✅ Vite migration
- ✅ Модульна структура (Dashboard / CaseDossier / Notebook / DocumentProcessor)
- ✅ SaaS Foundation v1 (2026-05-04) — tenants/users/auditLog/permissions
- ✅ SaaS Foundation v1.1 Patch (2026-05-05) — schemaVersion 3, ai_usage, modelPreferences, subscriptions
- ✅ Billing Foundation v2 (2026-05-05) — schemaVersion 4, time_entries, master_timer, archives
- ✅ Document AI інтеграція
- ✅ Test Infrastructure (2026-05-08) — Vitest з 180+ тестами і CI блокуванням деплою при red тестах

### В роботі / спостереження

- 🔄 Спостереження за реальною роботою Billing Foundation (1-2 тижні)
- 🔄 Збір накопичених знахідок у `docs/bugs/bugs_found_during_billing_foundation.md`

### Заплановано

- 🟡 TASK Document Processor v2 + Context Generator (з tool use, наступний великий)
- 🟡 TASK Canvas-конструктор документів (наступний модуль після DP v2)
- 🟡 TASK Multi-user Activation (окремий чат, для Олени-помічниці)
- 🟡 TASK Storage Migration (зміна директорії на Drive)
- 🟡 TASK ЄСІТС RPA інтеграція
- 🟡 TASK Telegram бот
- 🟡 TASK Billing UI v1 (через 6+ міс)
- 🟡 TASK AI Provider Abstraction (через 6-12 міс при SaaS-комерціалізації)

---

## LESSONS.md — ІНСТИТУЦІЙНА ПАМ'ЯТЬ

Файл `LESSONS.md` в корені репо містить уроки з попередніх сесій.

Звертатись ТІЛЬКИ коли:
- Перша спроба не дала результату
- Бачиш схожий симптом але не знаєш причину
- Збираєшся робити merge або переписувати великий блок
- Щось зникло після попереднього фіксу

Читати: `cat LESSONS.md`
**НЕ змінювати код на основі LESSONS.md без явного завдання в TASK.md.**

---

## DEVELOPMENT_PHILOSOPHY.md — ОБОВ'ЯЗКОВО ПРОЧИТАТИ

Окремий файл `DEVELOPMENT_PHILOSOPHY.md` містить:
- Принцип "ембріон з повним ДНК"
- Як проектувати нові модулі (SaaS + Multi-user + Billing з самого початку)
- Архітектурні шаблони (planka Picatinny, executeAction, провайдер-патерн)
- Філософію білінгу (13 тез)
- Стандарти TASK (SAAS і BILLING IMPLICATIONS секції)

**Читати при будь-якій новій розробці.**

---

**Кінець CLAUDE.md v5.0**
**Готово до оновлення Claude Code в окремому TASK.**
