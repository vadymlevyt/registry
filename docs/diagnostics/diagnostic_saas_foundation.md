# Діагностика перед TASK SaaS Foundation v1

**Дата:** 2026-05-04
**Виконав:** Claude Code Opus 4.7 (1M context)
**Статус:** Розвідка завершена. Чекаю згоди адвоката на впровадження.
**Гілка:** main

---

## ⚠️ КРИТИЧНІ РОЗБІЖНОСТІ ПЛАНУ І РЕАЛЬНОСТІ

Перед усім — **три факти, які змінюють план**:

### 1. Vite уже виконано

CLAUDE.md і ПОТОЧНИЙ СТАН в TASK.md описує систему як «один файл `index.html` (~3100 рядків), Babel CDN». **Це вже не так.**

```
БУЛО (CLAUDE.md):              ПОТОЧНИЙ СТАН РЕАЛЬНОСТІ:
index.html ~3100 рядків        index.html — 15 рядків (тільки <div id="root">)
Babel CDN                      Vite 6 + React 18 + ES modules
                               src/App.jsx — 4391 рядок
                               src/components/{Dashboard, CaseDossier,
                                              DocumentProcessor, Notebook}
                               src/services/{driveAuth, driveService, ocr}
                               package.json з npm-залежностями
```

В TASK.md є фраза «**Після Vite (не зараз)** — Блокнот / Календар / Досьє в окремі компоненти». Реально це вже зроблено. **CLAUDE.md потребує оновлення** — окремою задачею. Самостійно його не правлю в межах цього TASK.

### 2. `registry_data.json` ≠ повний state

TASK описує `registry_data.json` як файл з `cases[]`, `hearings[]`, `notes[]`, `pinnedNoteIds[]` на верхньому рівні. **Реальність інша:**

- `registry_data.json` на Drive містить **тільки масив cases[]** (без обгортки об'єктом). `hearings`/`deadlines` — це **підмасиви всередині кожної справи** (`case.hearings[]`, `case.deadlines[]`), а не верхнього рівня.
- `notes` (поза справою) живуть **тільки в localStorage** (`levytskyi_notes`), у Drive їх немає.
- `calendarEvents` — **похідні** з notes+cases, не зберігаються окремо в Drive.
- `timeLog` — тільки localStorage (`levytskyi_timelog`).

Виклик у [App.jsx:3446](src/App.jsx#L3446): `driveService.writeCases(token, cases)` — серіалізується саме `cases`, не цілий об'єкт.

### 3. Концептуально немає registry_data **обгортки**

План TASK передбачає `tenants[]`, `users[]`, `auditLog[]` **поряд** з `cases[]`. Щоб це втілити — потрібно змінити формат файлу з масиву на об'єкт:

```
БУЛО (Drive):                  ПОТРІБНО:
[                              {
  { id:1, name:..., ... },       "schemaVersion": 2,
  { id:2, name:..., ... },       "tenants": [...],
  ...                            "users": [...],
]                                "auditLog": [...],
                                 "structuralUnits": [],
                                 "cases": [...],
                                 "settingsVersion": "2.0_saas_foundation"
                               }
```

Це означає що `driveService.readCases` і `writeCases` треба міняти. Стара логіка читання масиву має зберегтися як **fallback на старий формат** для першого запуску після оновлення (інакше мігрувати нема з чого).

---

## 1. Поточний стан registry_data.json

### Поля верхнього рівня

`registry_data.json` на Drive — **це просто масив `cases[]`**. Інших структур у файлі немає. Розмір локального state-snapshotа залежить від користувача (на Drive нічого не зчитував — токен не доступний з робочого середовища).

### Структура одного запису `cases[i]` (зведено з [App.jsx:79-119](src/App.jsx#L79) і `normalizeCases` [App.jsx:3124-3238](src/App.jsx#L3124))

```js
{
  id: 1 | 'case_1730900000_xyz',          // змішано: number (для INITIAL_CASES) і string (для нових через ACTIONS.create_case)
  userId: 'vadym',                         // ← вже є! додається в normalizeCases якщо немає
  createdAt: '2026-...T...:Z',             // ← вже є (нормалізовано)
  updatedAt: '2026-...T...:Z',             // ← вже є (нормалізовано)
  name: 'Брановський',
  client: 'Брановський В.І.',
  category: 'civil' | 'criminal' | 'military' | 'admin',
  status: 'active' | 'paused' | 'closed',
  court: 'Господарський суд Київ',
  case_no: '910/4521/24',
  judge: 'string|null',                    // опціонально
  next_action: 'Подати апеляцію',
  notes: [                                 // масив (нормалізовано з legacy string)
    { id, text, title?, caseName?, category, source, ts, createdAt?, updatedAt? }
  ],
  pinnedNoteIds: ['noteId1', ...],         // масив string-id
  hearings: [
    { id: 'hrg_...', date: 'YYYY-MM-DD', time: 'HH:MM', duration: 120, status: 'scheduled', type, court?, notes? }
  ],
  deadlines: [
    { id: 'dl_...', name: 'Заява про витрати', date: 'YYYY-MM-DD' }
  ],
  timeLog: [],                             // ← вже є (нормалізовано)
  agentHistory: [],                        // ← тимчасово в кейсі (TASK каже: винести)
  proceedings: [...],                      // тільки в Брановський (Case 4)
  documents: [...],                        // тільки в Брановський (Case 4)
  driveFolderId: 'drive_folder_id'         // після створення папки на Drive
}
```

### Структура `notes` (state, localStorage `levytskyi_notes`)

Об'єкт-bucket (НЕ масив):

```js
{
  cases:   [...],    // нотатки, прив'язані до конкретної справи
  general: [...],    // загальні нотатки
  content: [...],    // контент-ідеї
  system:  [...],    // системні нотатки
  records: [...]     // інше
}
```

Кожна нота: `{ id, text, category, caseId, caseName, source, result, ts, createdAt, updatedAt? }`.

### Структура `calendarEvents` (state, localStorage `levytskyi_calendar_events`)

Похідні з notes+cases, перебудовується через `rebuildCalendarView` ([App.jsx:3461](src/App.jsx#L3461)) на кожній зміні `[notes, cases]`. **Зберігати tenantId окремо немає сенсу** — він успадкується з cases/notes.

### Структура `timeLog` (state, localStorage `levytskyi_timelog`)

Масив:
```js
{ id: 'tl_...', userId: 'vadym', caseId, date, duration, description, type, source, createdAt }
```
`userId: 'vadym'` уже жорстко прописаний в [App.jsx:4038](src/App.jsx#L4038).

### Версія даних

- Поле `dataVersion` / `schemaVersion` / `migrationVersion` — **відсутнє**. У `normalizeCases` міграції роблять «м'який пробіг» по полях без явного маркування версії. Це треба ввести в межах TASK — `schemaVersion: 2` (або `migrationVersion: '2.0_saas_foundation'`, як в TASK).

### Виявлені неконсистентності

1. **Тип `id`** змішаний: `1..20` для INITIAL_CASES (number), `case_${Date.now()}` (string) для нових. Скрізь у коді порівнюється через `String(c.id) === String(...)` — отже не блокує, але міграція має ставити **string** як стандарт.
2. **`userId` для cases** — є (нормалізовано), для **notes** — немає взагалі. Доведеться додати.
3. **`createdBy`** як окреме поле — нема ніде. План TASK хоче його скрізь — добавимо.
4. **`agentHistory`** живе в кейсі (App.jsx:3228), а ще паралельно в `localStorage` `agent_history_${caseId}` (CaseDossier:446) і на Drive (`agent_history.json`, CaseDossier:517). Три джерела правди — поза скоупом TASK, але треба пам'ятати.

---

## 2. executeAction — поточна реалізація

### Розташування

- Файл: [src/App.jsx:4145](src/App.jsx#L4145)
- Сигнатура:

```js
const executeAction = (agentId, action, params, userId = 'vadym') => {
  const allowed = PERMISSIONS[agentId] || [];
  if (!allowed.includes(action)) return { success: false, error: `Немає повноважень: ${action}` };
  if (!ACTIONS[action])           return { success: false, error: `Невідома дія: ${action}` };
  logAction({ agentId, action, params, userId });
  try {
    const result = ACTIONS[action](params);
    return result;
  } catch (e) { return { success: false, error: e.message }; }
};
```

**Це СИНХРОННА функція** (всі ACTIONS — синхронні, крім `batch_update`). План TASK пише її як `async function executeAction(...)` — для сумісності з batch_update і майбутнім audit log це треба зробити **async**, перевіривши що всі callers готові (вони і так не чекають на результат).

### Точки виклику з агентів

- `Dashboard` → `onExecuteAction('dashboard_agent', ...)` — App.jsx:4211, у самому Dashboard 7+ викликів ([Dashboard:1251, 1675, 1683, 1694, 1702, 1735, 1744, 2364, 2650](src/components/Dashboard/index.jsx)).
- `CaseDossier` → `onExecuteAction('dossier_agent', ...)` — App.jsx:4298, у самому Dossier 14+ викликів (засідання, дедлайни через UI).
- `QuickInput` → `onExecuteAction('qi_agent', ...)` — App.jsx:4344. У QI також є **прямий обхід** через `setCases(prev => prev.filter(...))` для destroy_case ([App.jsx:1920](src/App.jsx#L1920)). Це навмисно — destroy не дозволено агенту.

### Поточна логіка перевірок

- ✅ Перевірка `PERMISSIONS[agentId].includes(action)` — є.
- ✅ Перевірка `ACTIONS[action]` існує — є.
- ✅ Логування в `localStorage.levytskyi_action_log` через `logAction` ([App.jsx:4127](src/App.jsx#L4127)) — є, але **це не auditLog** з TASK, а просто історія для аналітики (без `tenantId`/`userRoleAtTime`).
- ❌ Перевірка `tenantId` — відсутня.
- ❌ Перевірка `userId` має право на конкретну справу — відсутня.
- ❌ Запис у `auditLog[]` як вимагає TASK — відсутній (є тільки локальний `levytskyi_action_log`).

---

## 3. ACTIONS і PERMISSIONS — поточна структура

### Розташування

- ACTIONS: [src/App.jsx:3762-4091](src/App.jsx#L3762)
- PERMISSIONS: [src/App.jsx:4094-4124](src/App.jsx#L4094)

### Кількість і список actions (19)

| Група | Actions |
| --- | --- |
| Справи | `create_case`, `close_case`, `restore_case`, `update_case_field` |
| Дедлайни | `add_deadline`, `update_deadline`, `delete_deadline` |
| Засідання | `add_hearing`, `update_hearing`, `delete_hearing` |
| Нотатки | `add_note`, `update_note`, `delete_note`, `pin_note`, `unpin_note` |
| Час/Сесії | `add_time_entry`, `track_session_start`, `track_session_end` |
| Композит | `batch_update` |

**Примітка:** `destroy_case` нема в ACTIONS — лише в `handleDeleteCase` ([App.jsx:3747](src/App.jsx#L3747)) через UI. План TASK хоче `destroy_case` логувати в auditLog. Я б **не виносив його в ACTIONS** (зберігаємо принцип «destroy тільки UI»), а просто в `handleDeleteCase` і `closeCase` зробив пряме звернення до `auditLog.write()`.

### Структура PERMISSIONS

`{ agentId: [allowed_actions] }`. Простий allowlist, без поняття tenant/role/case-level. Підходить як база.

### Чи треба переробляти зараз

**Ні.** Структура мінімальна, приріст робиться поверх:
- `requiresAudit` — реалізуємо через окремий масив `AUDIT_ACTIONS` (як в плані TASK).
- `affectsCase` — виводимо з `params.caseId` (вже доступно).
- `requiredRole` — поки не потрібно (всі дії дозволені `bureau_owner`); закладаємо хук `checkRolePermission` як заглушку.

---

## 4. Завантаження і збереження даних

### Функції load

| # | Місце | Що робить |
| --- | --- | --- |
| 1 | [App.jsx:3243-3258](src/App.jsx#L3243) | useState init: localStorage `levytskyi_cases` → fallback на `INITIAL_CASES`, обидва через `normalizeCases`. |
| 2 | [App.jsx:3417-3426](src/App.jsx#L3417) | useEffect on mount: `driveService.readCases(token)` → `setCases(normalizeCases(...))` якщо Drive має дані. |
| 3 | [App.jsx:3292](src/App.jsx#L3292) | useState init notes: localStorage `levytskyi_notes`. |
| 4 | [App.jsx:3273](src/App.jsx#L3273) | useState init calendarEvents: localStorage `levytskyi_calendar_events`. |
| 5 | [App.jsx:3336](src/App.jsx#L3336) | useState init timeLog: localStorage `levytskyi_timelog`. |

### Функції save

| # | Місце | Що робить |
| --- | --- | --- |
| 1 | [App.jsx:3429-3451](src/App.jsx#L3429) | useEffect on `[cases]`: localStorage + (якщо Drive підключено) `driveService.writeCases` + автобекап раз на добу через `backupRegistryData`. |
| 2 | [App.jsx:3454-3456](src/App.jsx#L3454) | useEffect on `[timeLog]`: localStorage. |
| 3 | `saveNotesToLS` — викликається з `addNote/updateNote/deleteNote` в кількох місцях. |

### Місце для інтеграції міграції

**Найбезпечніше:** в `useEffect` що читає Drive ([App.jsx:3417-3426](src/App.jsx#L3417)) — після `driveService.readCases(token)`, перед `setCases`. Логіка:

```
1. readCases → driveData (масив АБО об'єкт)
2. if (Array.isArray(driveData))   → старий формат, треба мігрувати
   else if (driveData?.schemaVersion >= 2) → новий формат, просто розпакувати cases
3. Перед міграцією — викликати backupRegistryData(token, driveData) з суфіксом 'pre_saas'
4. Виконати migrate(driveData) → newRegistry { schemaVersion:2, tenants, users, auditLog, cases }
5. driveService.writeRegistry(token, newRegistry)
6. setCases(newRegistry.cases); встановити інші state (tenants, users, auditLog) у відповідні новостворені state-змінні
```

**Бекап перед міграцією:** в `services/driveService.js` уже є `backupRegistryData` ([driveService.js:138](src/services/driveService.js#L138)) — створює `_backups/registry_data_<ts>.json` і ротує до 7 шт. Перед міграцією можна викликати **зайвий разовий бекап** з фіксованим іменем `registry_data_backup_pre_saas_<ts>.json` (поза ротацією).

### Особливості

- Drive sync — **без debouncing**. Кожна зміна `cases` зберігає на Drive миттєво (`useEffect [cases]`). Великі міграції можуть зробити серію повних писань — але це лише один раз при апгрейді.
- Conflict resolution — **відсутній**. Якщо адвокат відкрив систему на двох пристроях паралельно — буде last-write-wins. Поза скоупом TASK.
- 401 на `driveRequest` обробляється через `refreshDriveToken` (driveAuth.js, імпортується App.jsx:8). Тобто короткий токен має автооновлення.

---

## 5. Структура папок на Drive

З `services/driveService.js` (Document service):

```
Drive root/
├── 00_INBOX/                        ← глобальний inbox
├── 01_АКТИВНІ_СПРАВИ/
│   └── <Назва справи>/
│       ├── 01_ОРИГІНАЛИ/
│       ├── 02_ОБРОБЛЕНІ/
│       ├── 03_ФРАГМЕНТИ/
│       ├── 04_ПОЗИЦІЯ/
│       ├── 05_ЗОВНІШНІ/
│       ├── case_context.md          (генерується для агента, CaseDossier:496)
│       └── agent_history.json       (для агента, CaseDossier:517)
├── _backups/                        ← автобекапи (7 останніх)
└── registry_data.json               ← єдиний реєстр (зараз — масив)
```

**Чи треба змінювати структуру** — ні. Multi-tenant поки що не вимагає. У майбутньому SaaS-версії одна організація = окремий Drive (або окрема папка `tenant_<id>/`), але зараз нічого не міняємо.

---

## 6. Агенти

### Реєстр агентів і їх взаємодія

| Агент | Файл промпту | Модель | Як отримує userId | actions |
| --- | --- | --- | --- | --- |
| **Document AI parser (Haiku)** | `HAIKU_SYSTEM_PROMPT` ([App.jsx:446](src/App.jsx#L446)) | claude-haiku-4-5-20251001 | Не отримує (повертає JSON, потім обробка в Quick Input) | Через recommended_actions: `update_case_date`, `update_deadline`, `create_case`, `save_note`, `update_case_status` |
| **QI chat (Sonnet)** | `SONNET_CHAT_PROMPT` ([App.jsx:517](src/App.jsx#L517)) | claude-sonnet-4-20250514 | Не отримує. `executeAction(..., userId='vadym')` хардкод default. | Через `qi_agent`-permissions ([App.jsx:4095](src/App.jsx#L4095)) |
| **Dashboard agent** | systemPrompt будується inline ([Dashboard:1488](src/components/Dashboard/index.jsx#L1488)) | sonnet | Не отримує | dashboard_agent permissions |
| **Dossier agent** | systemPrompt будується inline ([CaseDossier:840, 1269](src/components/CaseDossier/index.jsx)) | sonnet | Не отримує | dossier_agent permissions |
| **CaseContext generator** | `CASE_CONTEXT_SYSTEM_PROMPT_V2` ([CaseDossier:43](src/components/CaseDossier/index.jsx#L43)) | sonnet | Не агент-action, генерує лише `case_context.md` файл на Drive | — |
| **Document Processor** | inline ([DocumentProcessor:159, 392, 531](src/components/DocumentProcessor/index.jsx)) | різні | Не отримує | Не йде через executeAction (працює з документами) |

### Що треба буде поправити (мінімально)

- `executeAction(agentId, action, params, userId = 'vadym')` — поки що `userId` як default. У фазі впровадження **залишаємо інтерфейс**, всередині отримуємо `currentUser` через хук `getCurrentUser()`. Агенти продовжують **не передавати** userId — він домішується автоматично. Жоден промпт міняти не треба.
- В кожен виклик додавати `context: { module, agent }` — для запису в auditLog.

---

## 7. Об'єм даних

| Сутність | Реальна кількість | Джерело |
| --- | --- | --- |
| `INITIAL_CASES` (демо) | 20 | [App.jsx:79-119](src/App.jsx#L79) |
| `cases[]` на Drive | **невідомо** (Drive токен в localStorage браузера, не доступний з агента) | localStorage / Drive |
| `hearings[]` сумарно | невідомо (вкладені в cases) | — |
| `notes[]` (бакетовано в localStorage) | невідомо | localStorage `levytskyi_notes` |
| `timeLog[]` | невідомо | localStorage `levytskyi_timelog` |
| Розмір `registry_data.json` | оцінка: 50-300 KB (20-50 справ × 1-5 KB) | Drive |

**Висновок щодо обсягу міграції:** даних мало. Міграція — мілісекунди. **Не може тривати довго.**

---

## 8. Ризики і питання

### Ризики

1. **Зміна формату `registry_data.json` з масиву на об'єкт.**
   Якщо новий код задеплоєно а адвокат відкрив систему на старому пристрої (browser cache) — старий код прочитає об'єкт і `Array.isArray(driveCases) && driveCases.length > 0` буде `false` → fallback на localStorage без помилки. Тобто нічого не падає, але адвокат не побачить нові справи зі свіжих сесій. **Mitigation:** після деплою попросити адвоката робити hard reload (Ctrl+Shift+R) на всіх пристроях.

2. **`hearings[]`/`deadlines[]`/`notes[]` всередині cases, а план TASK пише про них як top-level.**
   План передбачає `hearings[*].tenantId`, `deadlines[*].tenantId`, `notes[*].tenantId`. Реально вони вкладені — `tenantId` в кожному з них **дублює** `cases[i].tenantId`. Пропоную:
   - Для **cases-bound** notes/hearings/deadlines — НЕ дублювати `tenantId` (успадковується з cases).
   - Для **standalone notes** (поза справою, в localStorage) — додавати `tenantId`.
   - `createdBy` додавати **завжди**, бо в межах команди різні люди можуть додавати в одну справу.

3. **`addCase`, `closeCase`, `restoreCase`, `handleDeleteCase` — окремі функції поза `executeAction`.**
   План TASK хоче щоб усі модифікації йшли через executeAction. Але `addCase` (форма UI), `closeCase` (UI кнопка), `handleDeleteCase` (UI кнопка) — обходять executeAction. Опції:
   - **A.** Перенаправити їх через executeAction з агентом `'main_app'` (нова роль в PERMISSIONS).
   - **B.** Залишити окремо, але всередині кожної додати `auditLog.write()` напряму.
   Пропоную **B** — менше ризик зламати UI, рівноцінно для аудиту.

4. **`destroy_case` робить незворотну дію — видалення Drive-папки.**
   В межах TASK ця дія має писатися в auditLog. Проблема: запис аудиту відбувається **після** видалення Drive-папки. Якщо мережа впала — справи нема, аудиту нема. Пропоную: записувати аудит **до** видалення (зі статусом `pending`), потім після успіху оновити на `done` або зчищати запис на помилку.

5. **`useEffect` на `[cases]` пише в Drive негайно.**
   Велика міграція спричинить запис на ~50KB JSON. ОК для одного файлу, але батарея/трафік мобільного клієнта… Mitigation: один разовий запис перед і після міграції з логуванням, debounce поза скоупом.

6. **Старі INITIAL_CASES мають `id: 1..20` (number).**
   Після міграції залишаються number-id. Скрізь є `String(c.id)` для порівнянь — не зламається. Але якщо хтось почне робити lookup по string → string, треба пам'ятати normalizeCase string id для **нових** справ і залишити числові для існуючих, не чіпаючи.

7. **Race у `useEffect [cases]` під час міграції.**
   Послідовність: load → migrate → setCases(migrated) → useEffect [cases] спрацьовує → writes back to Drive. Це **бажано** (зберігаємо мігроване). Але якщо в цей момент фоновий read почав працювати — конфлікт. Mitigation: міграція — **синхронно в read-then-migrate** (один useEffect), без проміжного setState.

8. **`agentHistory` в кейсі.**
   План TASK не торкається. Залишаємо як є. Але якщо адвокат завантажить дуже довгий діалог — agentHistory може роздути JSON. Поза скоупом.

### Відкриті питання (потребують відповіді адвоката перед впровадженням)

**Q1.** CLAUDE.md описує систему як «один index.html + Babel CDN». Реально вже Vite. Чи оновлювати CLAUDE.md в межах цього TASK (видалити блок «Після Vite»), чи окремою задачею?

**Q2.** План TASK хоче `tenantId` у всіх hearings/deadlines/notes. Але вони вкладені в cases. Згоден на варіант: «**не дублювати** tenantId всередині вкладених сутностей, додавати тільки `createdBy`. tenantId успадковується з parent case»?

**Q3.** `addCase` (форма «Нова справа» в UI), `closeCase`, `handleDeleteCase` — обходять executeAction. Пропоную залишити їх окремо, але вшити прямий виклик `writeAuditLog(...)` усередину для критичних дій. Згоден?

**Q4.** Чи писати в audit log всі `update_case_field`/`update_hearing`/`update_deadline`/`update_note`? TASK явно сказав «**не пишемо** в цьому TASK — занадто багатослівно». Підтверджуєте — лише: `create_case`, `close_case`, `restore_case`, `destroy_case`, `delete_hearing`, `delete_deadline`?

**Q5.** План TASK хоче файл `src/services/permissions.js`. Але реально в `src/services/` уже є `driveAuth.js`, `driveService.js`, `ocrService.js`, `ocr/`. Пропоную: 4 окремі сервіси як в шаблоні звіту (`tenantService.js`, `permissionService.js`, `auditLogService.js`, `migrationService.js`), щоб не змішувати все в одному `permissions.js`. Згоден?

**Q6.** `getCurrentUser()` зараз — заглушка що повертає `vadym`. Куди його класти — в `tenantService.js` чи окремо `currentUserService.js`?

**Q7.** На який момент рахувати `migrationVersion`? Пропозиція: зберігати `schemaVersion: 2` в корені `registry_data.json` після міграції; для майбутніх змін інкрементувати. Підходить?

### Пропозиції з обходу ризиків

1. **Бекап перед міграцією — фіксованим іменем поза ротацією.** Перед першим запуском нової версії (коли формат старий і стартує міграція) — зберегти `registry_data_backup_pre_saas_<timestamp>.json` через `uploadFileToDrive` напряму, **не через** `backupRegistryData` (щоб уникнути ротації).

2. **Міграція — ідемпотентна.** Перевірка `if (driveData?.schemaVersion >= 2) return driveData` в `migrate()` — повторні запуски не нашкодять.

3. **executeAction → async з audit log в `try/finally` після `performAction`.** Гарантує що навіть невдалі дії не лишають «полу-аудит».

4. **Нові поля додаються тільки в `normalizeCases` (для read) і в `migrate` (для one-time-upgrade).** Ніяких розкиданих по коду «if !c.tenantId — додай tenantId».

5. **Тести вручну перед commit:**
   - Reset → INITIAL_CASES → міграція → перевірка всіх 20 справ відкриваються.
   - Створення нової справи → перевірка `tenantId/ownerId/team/shareType/externalAccess` встановилися.
   - Закриття/відновлення/видалення → перевірка запису в auditLog.
   - QI/Dashboard/Dossier — викликати дію → перевірка не зламалося.

---

## 9. Адаптований план впровадження

### Що відрізняється від оригінального плану

| План TASK | Реальний план |
| --- | --- |
| `index.html` ~3100 рядків, Babel CDN | Vite, src/App.jsx 4391 рядок |
| Файл `permissions.js` зі всім | 4 файли в `src/services/`: `tenantService.js`, `permissionService.js`, `auditLogService.js`, `migrationService.js` |
| `executeAction` синхронна | Зробити **async** заради `await writeAuditLog` |
| `tenantId` скрізь | Тільки в top-level (cases, standalone notes, timeLog, ideas), вкладені — успадковують |
| `registry_data.json` як `{ tenants, users, ..., cases }` | **Так само**, формат файлу зміниться з масиву на об'єкт; стара логіка читання — як fallback |
| Бекап `registry_data_backup_pre_saas.json` | Через `uploadFileToDrive` напряму (поза ротацією `backupRegistryData`) |

### Послідовність кроків (адаптована)

**Крок 0** — Узгодити з адвокатом відповіді на Q1-Q7 (15 хв).

**Крок 1** — Створити сервіси-заглушки (1 год):
- `src/services/tenantService.js` — DEFAULT_TENANT, DEFAULT_USER, `getCurrentTenant()`, `getCurrentUser()`
- `src/services/permissionService.js` — `checkTenantAccess`, `checkRolePermission`, `checkCaseAccess`
- `src/services/auditLogService.js` — `AUDIT_ACTIONS`, `shouldAudit`, `writeAuditLog(setAuditLog, params)`
- `src/services/migrationService.js` — `migrateRegistry(driveData)` — приймає масив або об'єкт, повертає об'єкт нової форми

**Крок 2** — Розширити `driveService` в App.jsx (30 хв):
- Перейменувати `readCases` → `readRegistry`, `writeCases` → `writeRegistry`
- `readRegistry` повертає raw (масив або об'єкт)
- `writeRegistry` приймає об'єкт нової форми
- Старі імена залишити як аліаси (deprecated) щоб не ламати existing call sites — або одразу замінити всі ~5 місць.

**Крок 3** — App.jsx: state для нових структур (30 хв):
- `const [tenants, setTenants] = useState([DEFAULT_TENANT])`
- `const [users, setUsers] = useState([DEFAULT_USER])`
- `const [auditLog, setAuditLog] = useState([])`
- `const [structuralUnits, setStructuralUnits] = useState([])`

**Крок 4** — Інтегрувати міграцію в startup useEffect ([App.jsx:3417](src/App.jsx#L3417)) (30 хв):
- Якщо driveData = масив → бекап + migrateRegistry → setAll → writeRegistry.
- Якщо driveData = об'єкт із schemaVersion>=2 → setAll напряму.
- Якщо driveData = null → setAll з default tenant/user.

**Крок 5** — Розширити `normalizeCases` (15 хв):
- Додати `tenantId`, `ownerId`, `team`, `shareType`, `externalAccess` як default-and-set-if-missing.

**Крок 6** — Зробити `executeAction` async і обгорнути audit (1 год):
- Прийняти `currentUser` з `getCurrentUser()` всередині.
- Викликати `checkTenantAccess`, `checkRolePermission`, `checkCaseAccess` (всі заглушки → true).
- Після `ACTIONS[action](params)` — якщо `shouldAudit(action)`, викликати `writeAuditLog(setAuditLog, {...})`.

**Крок 7** — UI-функції поза executeAction (45 хв):
- `addCase`, `saveCaseEdit`: додати `tenantId/ownerId/team/shareType/externalAccess`, audit.
- `closeCase`, `restoreCase`, `deleteCasePermanently` (`destroy_case`): audit.
- `addNote`, `deleteNote`, `updateNote`: додати `tenantId`, `createdBy`. Audit пропускаємо (Q4).

**Крок 8** — `writeRegistry` має писати **повний об'єкт** (1 год):
- useEffect `[cases]` → змінити на `[cases, tenants, users, auditLog, structuralUnits]`.
- writeRegistry({ schemaVersion:2, tenants, users, auditLog, structuralUnits, cases, settingsVersion:'2.0_saas_foundation' }).

**Крок 9** — Тестування (1-2 год):
- Reset → fresh INITIAL_CASES → перевірити міграція спрацьовує.
- Усі модулі (Дашборд, Списки, Досьє, Книжка, Аналіз) працюють.
- Усі агенти (QI, Dashboard, Dossier) виконують дії.
- Створити/закрити/відновити/видалити справу — auditLog пише.
- Hard reload — дані з Drive завантажуються вірно.

**Крок 10** — Документація (30 хв):
- Додати в CLAUDE.md розділ «Філософія системи — ембріон з повним ДНК» (текст з TASK).
- Оновити рядки про «один index.html + Babel» на правду про Vite (Q1).
- LESSONS.md — пропустити.

**Крок 11** — Звіт (30 хв):
- `report_saas_foundation.md` за шаблоном.
- `bugs_found_during_saas_foundation.md` (поки що порожній — багів не знайшов, лише архітектурні розбіжності задокументовано тут).

**Крок 12** — Один commit у main:
```
feat: SaaS Foundation v1 — tenants, users, team, audit log, permissions service

- Структури tenants/users/auditLog/structuralUnits в registry_data.json (schemaVersion:2)
- cases отримують tenantId, ownerId, team[], shareType, externalAccess[]
- executeAction async із заглушками permission-перевірок і записом критичних дій в auditLog
- 4 нові сервіси: tenantService, permissionService, auditLogService, migrationService
- Backup pre-saas перед міграцією
- Філософія "ембріон з повним ДНК" в CLAUDE.md
```

**Орієнтовно:** 7-8 годин впровадження + 1-2 години тестування.

---

## 10. Готовність до впровадження

- [x] Усі поля верхнього рівня перевірено
- [x] `executeAction` знайдено і вивчено
- [x] ACTIONS/PERMISSIONS вивчено
- [x] Точка інтеграції міграції визначена
- [x] Бекап-стратегія описана
- [x] Усі ризики мають план обходу
- [x] Усі агенти проінспектовано
- [ ] **Q1-Q7 потребують відповіді адвоката** — перш ніж стартувати

---

**Очікую від адвоката:**

1. Прочитати цей файл.
2. Відповісти на Q1-Q7 (можна одним повідомленням, текстом «1: …, 2: …»).
3. Дати команду «продовжуй впровадження» — і я починаю Крок 1.

Якщо відповіді покажуть що план треба переробити суттєво — повернуся до діагностики.
