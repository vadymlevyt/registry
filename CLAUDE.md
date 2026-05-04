# CLAUDE.md — Legal BMS АБ Левицького

## Що це за проект
Реєстр справ адвокатського бюро Левицького.
Стек: React 18 + Babel CDN, один файл index.html (~3100 рядків).
Хостинг: GitHub Pages — https://vadymlevyt.github.io/registry/
Репо: github.com/vadymlevyt/registry

## КРИТИЧНЕ ПРАВИЛО №1 — Гілки
Завжди працювати в гілці main. НЕ створювати окремі гілки.
Після змін: git add -A && git commit -m "..." && git push origin main

## LESSONS.md — ІНСТИТУЦІЙНА ПАМ'ЯТЬ

Файл LESSONS.md в корені репо містить уроки з попередніх сесій.

Звертатись ТІЛЬКИ коли:
- Перша спроба не дала результату
- Бачиш схожий симптом але не знаєш причину
- Збираєшся робити merge або переписувати великий блок
- Щось зникло після попереднього фіксу

Читати: cat LESSONS.md
НЕ змінювати код на основі LESSONS.md без явного завдання в TASK.md.

## КРИТИЧНЕ ПРАВИЛО №2 — textarea в QI
textarea в Quick Input ЗАВЖДИ має фіксовану height: 120px.
НЕ flex:1, НЕ min-height, НЕ height:100%.
Кнопки (Файл/Нотатка/Аналізувати) розміщуються поза scrollable div з flexShrink:0.
Порушення цього правила виштовхує кнопки за межі екрану.

## КРИТИЧНЕ ПРАВИЛО №3 — Merge конфлікти
При merge двох версій коду — НІКОЛИ не залишати обидва варіанти.
Перевіряти після merge:
- Немає дублікатів змінних (accessibleFile і workingFile одночасно)
- Немає мертвого коду після return
- В catch блоках немає return який блокує fallback

## КРИТИЧНЕ ПРАВИЛО №4 — Blank page
Blank page = JS помилка яка не перехоплена.
При будь-якій зміні в async функціях — обгортати в try/catch.
Особливо: pdfjsLib, FileReader, fetch до API.
При помилці — показувати setErrorCategory(), не давати сторінці впасти.

## КРИТИЧНЕ ПРАВИЛО №5 — Апострофи в українському тексті
Апостроф у словах (пам'ять, пов'язаний) в JS рядках в одинарних лапках — ламає синтаксис.
Весь україномовний текст — в подвійних лапках або шаблонних рядках (`...`).

## АРХІТЕКТУРА СИСТЕМИ

### Два окремих system prompt (НЕ один спільний):
- HAIKU_SYSTEM_PROMPT — для аналізу документів. Повертає ТІЛЬКИ JSON.
- SONNET_CHAT_PROMPT — для чату. Повертає текст + ACTION_JSON.
Змішувати не можна — Haiku плутається і перестає повертати JSON.

### ACTION_JSON парсинг — depth counter, НЕ regex:
```js
const idx = responseText.indexOf('ACTION_JSON:');
const start = responseText.indexOf('{', idx);
let depth = 0;
for (let i = start; i < responseText.length; i++) {
  if (responseText[i] === '{') depth++;
  else if (responseText[i] === '}') { depth--; if (depth === 0) { ... } }
}
```
Regex [\s\S]*? зупиняється на першій } — не використовувати для JSON.

### Моделі:
- claude-haiku-4-5-20251001 — аналіз документів (Haiku)
- claude-sonnet-4-20250514 — чат команди (Sonnet)

### Дії в sendChat — обробники є для:
update_case_date, update_deadline, update_case_field,
update_case_status, delete_case, create_case, save_note

Для кожної нової дії — додавати окремий блок в sendChat.
Агент без обробника пише "виконую" але нічого не робить.

### findCaseForAction — пошук по 5 варіантах:
1. Точний збіг імені
2. Базове ім'я без номера в дужках
3. По номеру справи case_no
4. Часткове співпадіння
5. По прізвищу в полі client

### handleFile — читання файлів:
- Завжди використовувати workingFile (не accessibleFile, не file напряму)
- MIME fallback якщо немає розширення в імені
- Drive файли з хмари не читаються через <input> на Android — це обмеження платформи

## СТРУКТУРА ДАНИХ

### Справа (Case):
id, name, client, category (civil/criminal/military/administrative),
status (active/paused/closed), court, case_no,
hearing_date (YYYY-MM-DD), hearing_time (HH:MM),
deadline (YYYY-MM-DD), deadline_type, next_action, notes

### Нотатки:
localStorage 'levytskyi_notes' — масив {text, result, ts}

### Drive sync:
registry_data.json на Google Drive.
Scope: drive.file (тільки файли створені системою).
Token: localStorage 'levytskyi_drive_token'.

## ПІСЛЯ VITE (не зараз)
- Блокнот — src/components/Notebook/
- Календар — src/components/Calendar/
- Досьє справи — src/components/CaseDossier/
- Google Picker API для Drive файлів
- Семантична перевірка дублів документів

## ШАБЛОН НОВОГО КОМПОНЕНТА

Кожен модуль в src/components/[Name]/index.jsx будується за цим шаблоном.
Принцип стільника: автономний, loose coupling, падіння не руйнує систему.

export default function ModuleName({
  cases,        // читає — не зберігає всередині
  updateCase,   // змінює через App.jsx
  onClose       // виходить через App.jsx
}) {
  // Локальний стан — тільки UI (що відкрито, що виділено)
  // НІКОЛИ: const [cases, setCases] = useState([]) всередині компонента
  // API ключ: localStorage.getItem("claude_api_key") напряму
}

## ERRORBOUNDARY — ПРИНЦИП СТІЛЬНИКА В КОДІ

Один клас в App.jsx. Обгортає кожен великий модуль при рендері.
Якщо модуль падає — решта системи працює.

class ErrorBoundary extends React.Component {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return (
      <div style={{padding:20,color:"#e74c3c",fontSize:13}}>
        ⚠️ Модуль тимчасово недоступний
        <button onClick={()=>this.setState({hasError:false})}>Спробувати знову</button>
      </div>
    );
    return this.props.children;
  }
}

Використання: <ErrorBoundary><CaseDossier .../></ErrorBoundary>

## AGENT HISTORY — ПРАВИЛО

Зараз: agentHistory: [] — порожній масив в об'єкті справи в registry_data.json.
В майбутньому: окремий файл agent_history.json в Google Drive.
Структура майбутнього файлу:
  { "Брановський": [...останні 10 повідомлень], "Манолюк": [...] }
НЕ розширювати registry_data.json history-даними агента.

## IDEAS — ПРАВИЛО

ideas[] живе в App.jsx state і зберігається в registry_data.json.
Кожна ідея: { id, text, caseId, caseName, type, status, createdAt }
Кнопка 💡 доступна з будь-якого модуля — стандарт системи як 🎤.

## ПОТОЧНИЙ СТАН
Фаза 1 завершена. Фаза 2 в процесі.
Наступний крок: перехід на Vite (потрібен десктоп).

## 🧬 ФІЛОСОФІЯ СИСТЕМИ — ЕМБРІОН З ПОВНИМ ДНК

Legal BMS — живий організм. Зараз він на стадії ембріону:
- **Зовні:** соло-практика з одним адвокатом
- **Всередині:** повна архітектура для SaaS з чотирма типами організацій (solo / bureau / association / firm), багаторівневими ієрархіями, командами справ, permissions, аудитом, білінгом, всім майбутнім функціоналом

Ембріон людини маленький, але має повне ДНК дорослого тіла. Печінка не з'являється «ззовні» при розвитку — вона завжди була в ДНК і просто розгортається в потрібний момент.

**Так само Legal BMS:**
- Зараз багато речей — заглушки що повертають true (бо один користувач)
- Структури даних — повні, з усіма потрібними полями для майбутнього
- Перевірки прав — викликаються (готові прийняти реальну логіку)
- Audit log — реально пише (для одного користувача поки що)

Коли система розгорнеться в SaaS — це не «додавання нового», а **розгортання того що вже є**. Заглушки замінюються на реальну логіку. Користувачі додаються в `users[]`. Tenants — в `tenants[]`. Ніяких архітектурних переробок.

### Принципи для кожного TASK

При роботі над **будь-яким** новим функціоналом запитай себе:

1. **Tenant-aware?** Нова сутність прив'язана до `tenantId`?
2. **User-aware?** Зрозуміло хто створив, оновив, видалив (`createdBy`/`updatedBy`)?
3. **Audit-aware?** Критичні дії пишуться в `auditLog[]`?
4. **Permission-aware?** Дія проходить через `executeAction` з перевірками?
5. **Future-aware?** Чи передбачені хуки для майбутніх ролей, команд, прав?
6. **Data-rich?** Збираються чи всі дані які можуть знадобитись потім (не зараз)?

Якщо хоч одне питання має відповідь «ні» — **зараз є можливість** додати потрібні поля/перевірки/хуки. Робимо одразу. Не «потім переробимо».

## SAAS FOUNDATION v2.0

### Типи tenants (фіксований enum)

- **solo** — адвокат-фізособа з помічником
- **bureau** — адвокатське бюро (наш поточний випадок: `ab_levytskyi`)
- **association** — адвокатське об'єднання (партнери з кластерами)
- **firm** — юридична фірма (багаторівнева ієрархія, практики)

### Глобальні ролі (фіксований enum за типом)

**Solo:** solo_advocate, solo_assistant
**Bureau:** bureau_owner, bureau_lawyer, bureau_assistant
**Association:** association_partner, association_lawyer, association_assistant
**Firm:** firm_managing_partner, firm_partner, firm_counsel, firm_senior_associate, firm_associate, firm_junior_associate, firm_paralegal, firm_intern
**Cross-tenant:** external_collaborator

### Ролі в команді справи (caseRole)

Окремо від глобальних ролей у кожній справі є caseRole:
- `lead` — повний контроль
- `oversight` — read-only + може втручатися
- `team_member` — робота за вказівками lead
- `consulted` — read-only + може коментувати
- `external` — зовнішній адвокат з тимчасовим доступом

### Архітектура `executeAction`

```
агент → executeAction(agentId, action, params)
              ↓
   1. allowlist PERMISSIONS[agentId]
              ↓
   2. checkTenantAccess() ← заглушка → true
              ↓
   3. checkRolePermission() ← заглушка → true для bureau_owner
              ↓
   4. checkCaseAccess() ← перевіряє ownerId/team/externalAccess
              ↓
   5. ACTIONS[action](params) ← реальна логіка
              ↓
   6. shouldAudit(action) ? writeAuditLog : nothing
              ↓
   7. save до Drive (через useEffect)
```

`executeAction` **async**. Усі callers мають await'ити результат якщо читають `.success`/`.error`.

### Які дії пишуться в auditLog

ТІЛЬКИ критичні (з `AUDIT_ACTIONS` в `src/services/auditLogService.js`):
- `create_case`, `close_case`, `restore_case`, `destroy_case`
- `delete_hearing`, `delete_deadline`

`update_*`, `add_note`, `pin_note`, `add_hearing`, `add_deadline`, `add_time_entry` — **НЕ пишемо**. Шум переважає користь.

### Структура `registry_data.json` v2

```json
{
  "schemaVersion": 2,
  "settingsVersion": "2.0_saas_foundation",
  "tenants": [...],
  "users": [...],
  "auditLog": [...],
  "structuralUnits": [],
  "cases": [...]
}
```

Старий формат (масив cases[]) автоматично мігрується при першому завантаженні. Перед міграцією створюється бекап `registry_data_backup_pre_saas_<ts>.json` у `_backups/`.

### Сервіси SaaS Foundation

- `src/services/tenantService.js` — `getCurrentTenant()`, `getCurrentUser()`, DEFAULT_TENANT, DEFAULT_USER
- `src/services/permissionService.js` — `checkTenantAccess`, `checkRolePermission`, `checkCaseAccess` (зараз заглушки)
- `src/services/auditLogService.js` — `AUDIT_ACTIONS`, `shouldAudit`, `writeAuditLog`, `updateAuditLogStatus`
- `src/services/migrationService.js` — `migrateRegistry`, `ensureCaseSaasFields`, `CURRENT_SCHEMA_VERSION`

### Поля справи — обов'язкові SaaS

Кожна справа в `cases[]` після міграції має:
- `tenantId` — приналежність до організації
- `ownerId` — провідний адвокат (= автор)
- `team[]` — `[{ userId, caseRole, addedAt, addedBy }]`
- `shareType` — `private` | `internal` | `external`
- `externalAccess[]` — для майбутніх крос-tenant доступів

Вкладені сутності (`hearings[]`, `deadlines[]`, `notes[]` всередині cases) — **не дублюють** `tenantId`, успадковують з parent. Але отримують `createdBy`.

Standalone notes (поза справою, в `levytskyi_notes`) — мають `tenantId` і `createdBy`.

### destroy_case — спеціальна процедура

Запис в auditLog **до** видалення зі статусом `pending`, після успіху → `done`, на помилку → `failed`. Гарантує що навіть втрачена мережа лишає слід.

### Що НЕ робити

- НЕ додавати UI керування користувачами/ролями (окремий TASK)
- НЕ замінювати заглушки на реальну логіку без узгодження з архітектором
- НЕ створювати нові сутності без `tenantId`
- НЕ обходити `executeAction` для модифікацій даних (виняток: UI-функції addCase/closeCase/restoreCase/destroy_case з прямим writeAuditLog)
- НЕ дублювати `tenantId` у вкладених сутностях справи

## АРХІТЕКТУРНЕ ПРАВИЛО — СПІЛЬНИЙ СТАН

Єдине джерело правди для всіх модулів — App.jsx.

НЕ можна:
- Тримати cases[], notes[], calendarEvents[] всередині компонента
- Викликати setCases() напряму з компонента
- Дублювати дані між модулями

МОЖНА і ТРЕБА:
- Отримувати дані через props
- Змінювати дані через функції що прийшли через props
- Тримати всередині компонента тільки UI-стан (активна вкладка, текст в полі)

Функції зміни спільних даних живуть ТІЛЬКИ в App.jsx:
- updateCase(caseId, field, value)
- addNote(note) / deleteNote(noteId)
- addCalendarEvent(event) / updateCalendarEvent(id, updates) / deleteCalendarEvent(id)
