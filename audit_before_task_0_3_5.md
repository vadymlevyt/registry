# AUDIT — Стан системи перед TASK 0.3.5 (Canonical Schema Bump v7 для ЄСІТС)

**Дата:** 2026-05-14
**Тип:** read-only знімок коду перед плануванням TASK 0.3.5
**Гілка:** main (clean), останній коміт `d650776`
**Поточна версія схеми реєстру:** `CURRENT_SCHEMA_VERSION = 6` (`migrationService.js:46`)
**Поточна версія канонічної схеми документа:** `CURRENT_SCHEMA_VERSION = 5` (`documentSchema.js:170`) — окремий лічильник
**Поточний `MIGRATION_VERSION`:** `'6.0_founder_flag'` (`migrationService.js:47`)

---

## 1. SCHEMA SYSTEM

### а) ПОТОЧНИЙ СТАН

**Два паралельні `CURRENT_SCHEMA_VERSION` у різних файлах:**

| Файл | Константа | Значення | Призначення |
|------|-----------|----------|-------------|
| `src/services/migrationService.js:46` | `CURRENT_SCHEMA_VERSION` | **6** | Найвища досяжна після всіх кроків |
| `src/services/migrationService.js:47` | `MIGRATION_VERSION` | `'6.0_founder_flag'` | settingsVersion-label |
| `src/services/migrationService.js:52` | `BASE_CHAIN_VERSION` | **4** | Таргет лише `migrateRegistry` |
| `src/services/migrationService.js:53` | `BASE_CHAIN_LABEL` | `'4.0_billing_foundation'` | Label для базового ланцюга |
| `src/schemas/documentSchema.js:170` | `CURRENT_SCHEMA_VERSION` | **5** | Версія канонічної доку-схеми (НЕ те саме!) |

**Імпортується в App.jsx як `DOCUMENT_SCHEMA_VERSION`** (рядок 4018, 4035) — використовується для гейтінгу запуску `migrateRegistryV4toV5`.

**Минулі міграції (з doc-коментарів `migrationService.js:1-25`):**

| Версія | Лейбл | Що додано |
|--------|-------|-----------|
| v1 (неявна) | — | Голий масив `cases[]` |
| v2 | `2.0_saas_foundation` | `tenants[]/users[]/auditLog[]/structuralUnits[]`, обгортка-об'єкт |
| v3 | `3.0_patch_and_extension` | `ai_usage[]`, `caseAccess[]`, `tenant.storage`, `modelPreferences`, `subscription.{limits,current,alerts}`, `case.team[].permissions`, нормалізація id |
| v4 | `4.0_billing_foundation` | `time_entries[]`, `master_timer_state{}`, `billing_meta{}`, `tenant.settings.timeStandards` |
| v5 | `5.0_canonical_documents` | Канонічна схема документа, розщеплення legacy → `{canonical, extended}`, окремий ланцюг `migrations/v4ToV5.js` |
| v6 | `6.0_founder_flag` | `users[].isFounder` (vadym=true, інші=false) |

**Як викликається міграція при завантаженні registry** — оркестрація живе в `App.jsx` EFFECT-A (приблизно 3970-4070):

```
const raw = readResult.data;
let { registry, didMigrate, fromVersion, toVersion } = migrateRegistry(raw); // → v4
// pre-saas, pre-v3, pre-v4, pre-v5 backups (по флагах localStorage)
if ((registry.schemaVersion || 1) < DOCUMENT_SCHEMA_VERSION) {  // <5
  const v5 = migrateRegistryV4toV5(registry);
  if (v5.didMigrate) { registry = v5.registry; ... extendedByCaseV5 ... }
}
// pre-v6 backup
if ((registry.schemaVersion || 1) < 6) {
  const v6 = migrateToVersion6(registry);
  if (v6.didMigrate) { registry = v6.registry; ... }
}
```

**Як працює backup перед міграцією:**
- 5 окремих функцій у `driveService`: `backupRegistryDataPreSaas`, `backupRegistryDataPreV3`, `backupRegistryDataPreBilling`, `backupRegistryDataPreV5`, `backupRegistryDataPreV6` (імпортовано в App.jsx:7).
- Бекап пишеться в `_backups/` на Drive (поза ротацією).
- Кожен бекап одноразовий — захищений прапором у localStorage:
  - `levytskyi_pre_saas_backup_done`
  - `levytskyi_pre_v3_backup_done`
  - `levytskyi_billing_backup_done_v4`
  - `levytskyi_pre_v5_backup_done`
  - `levytskyi_pre_v6_backup_done`
- Якщо бекап впав — лог-warning, міграція продовжується (бекап не блокер).
- Локальної папки `_backups/` у репо немає (вона на Drive).

### б) ПЛАН TASK 0.3.5

- Bump `CURRENT_SCHEMA_VERSION = 7`, `MIGRATION_VERSION = '7.0_ecits_canonical'`.
- Окрема функція `migrateToVersion7(registry)` (за патерном `migrateToVersion6`).
- Pre-v7 бекап (`backupRegistryDataPreV7`, прапор `levytskyi_pre_v7_backup_done`).
- Виклик у App.jsx EFFECT-A після `migrateToVersion6`.

### в) РОЗБІЖНОСТІ І РИЗИКИ

1. **Канонічна доку-схема має ВЛАСНИЙ `CURRENT_SCHEMA_VERSION = 5`.** Якщо плановані зміни TASK 0.3.5 торкаються `documentSchema.js` (а вони торкаються — нові поля документа), треба узгодити: бампити цей теж до 6 чи лишати? Поточна логіка `App.jsx:4035` ще раз запустить `migrateRegistryV4toV5` коли побачить що `registry.schemaVersion < DOCUMENT_SCHEMA_VERSION` (5). Якщо `documentSchema.js` лишити на 5, але додати nullable поля — логіка не зламається (документи з v6/v7 проходять міграцію v4→v5 ідемпотентно). Але це створює риск розузгодження: документи з різних точок створення можуть отримати різний шейп.

2. **Прецедент розширення без bump.** `source` (TASK 0.2), `originalDriveId`/`originalMime` (TASK A) — додавалися nullable з default `null` БЕЗ bump'у схеми. План TASK 0.3.5 додає 5 нових полів документа і робить bump v6→v7 — це порушення прецеденту. Треба чітко обґрунтувати: що з нових полів НЕ є простим nullable додаванням і вимагає міграції.

3. **caseSchema і hearingSchema не існують як файли.** Cаse і hearing — implicit shape, що описаний у CLAUDE.md і впроваджується через `migrateCase` в `migrationService.js` (поля SaaS) і ACTIONS в App.jsx (форма для нових записів). Bump схеми реєстру до v7 з "розширенням caseSchema/hearingSchema" вимагатиме створення цих файлів — це НОВИЙ архітектурний патерн, не просто додавання полів.

### г) РЕКОМЕНДАЦІЯ

- TASK 0.3.5 має ЯВНО прийняти рішення про долю `documentSchema.js:CURRENT_SCHEMA_VERSION` (лишати 5 чи бампити 6/7) і узгодити з логікою EFFECT-A. Найбезпечніший варіант: лишити константу 5, але додати нові поля nullable за прецедентом `source`. Тоді `migrateRegistryV4toV5` лишається як є; вся "робота" v6→v7 робиться у `migrateToVersion7` для CASE/HEARING полів, а нові nullable документні поля підхоплюються `createDocument` без міграції.
- Альтернативний варіант (повний bump доку-схеми): треба окремо описати чому bump потрібен (мабуть для додавання `movementCard` / `alternativeSources` як обов'язкових структур). Тоді треба написати `migrations/v5ToV6.js` для документів — окремий файл за патерном `v4ToV5.js`.
- Створити schema-файли `caseSchema.js` і `hearingSchema.js` — нова інженерна одиниця, заслуговує окремого підрозділу TASK з правилом «один сенс на ім'я» (правило #11 CLAUDE.md).

---

## 2. DOCUMENT SCHEMA — поточний стан

### а) ПОТОЧНИЙ СТАН

**Файл:** `src/schemas/documentSchema.js` (171 рядок).

**Канонічних полів — 23** (`CANONICAL_DOCUMENT_FIELDS`, рядки 16-134):

```
Ідентифікація:    id, name, originalName
Класифікація:     category, author, documentNature, namingStatus, isKey
Зв'язки:          procId
Drive:            driveId, driveUrl, folder
Розмір/формат:    pageCount, size, icon
Дати:             date, addedAt, updatedAt
Аудит:            addedBy
Стан:             status
Канал:            source                   ← TASK 0.2 (nullable, без bump)
Оригінал поряд:   originalDriveId, originalMime  ← TASK A (nullable, без bump)
```

**Extended поля — 7** (`EXTENDED_DOCUMENT_FIELDS`, рядки 138-160): `documentId, tags, notes, annotations, processingHistory, extractedTextSummary, customFields`.

**Що ВЖЕ є з планованого:**
- `source` ✅ (`enum: ['manual_upload', 'ecits', 'telegram', 'email', null]`, рядки 108-114). Довідник у `src/constants/documentSources.js` (`DOCUMENT_SOURCES`, `DOCUMENT_SOURCE_LABELS`, `isValidDocumentSource`).
- `originalDriveId`, `originalMime` ✅ (TASK A для DOCX→PDF).

**Чого НЕМАЄ з планованого:**
- `sourceConfidence` ❌
- `extractedAt` ❌
- `ecitsSource` ❌ (об'єкт з ecits-специфічним контекстом)
- `movementCard` ❌ (картка руху документа з ЄСІТС)
- `alternativeSources` ❌

**Валідність:** `validateDocument(doc)` у `documentFactory.js:68-109` — тип/required/nullable/enum sверка. Не "розумна" — рівно проти `CANONICAL_DOCUMENT_FIELDS`. `needsReview(doc)` — перевіряє що жодне з `CRITICAL_FIELDS_FOR_WARNING = ['procId','category','author']` не null.

**"Canonical documents v5"** — поняття з Phase 1.5 (CLAUDE.md розділ): документи мають фіксований шейп з 23 полів, з гарантованою наявністю всіх ключів (хай і `null`), всі точки створення проходять через `createDocument()`. Розщеплення light/heavy винесено в окремий файл `documents_extended.json` per-case.

### б) ПЛАН TASK 0.3.5

- `source` залишити (вже є).
- Додати: `sourceConfidence`, `extractedAt`, `ecitsSource`, `movementCard`, `alternativeSources`.

### в) РОЗБІЖНОСТІ І РИЗИКИ

1. **Жорсткий тест на 23 поля.** `tests/unit/documentSchema.test.js:19`:
   ```js
   expect(Object.keys(CANONICAL_DOCUMENT_FIELDS)).toHaveLength(23);
   ```
   Будь-яке додавання полів зламає тест. Треба оновити очікувану кількість і коментар у тесті, що пояснює нумерацію (зараз: "TASK A додав originalDriveId / originalMime").

2. **Тест на enum `addedBy`** (documentSchema.test.js:86-93) включає `'ecits'` — добре, нічого міняти не треба.

3. **`createDocument` з `documentFactory.js:23-64` явно перелічує всі канонічні поля з default-значеннями.** Кожне нове поле треба додати тут (інакше документи з нових точок створення будуть мати `undefined` замість `null`, що зламає `validateDocument`).

4. **`splitDocumentV4toV5` з `migrations/v4ToV5.js:129-202`** має `CANONICAL_FIELDS = new Set([...18 fields...])`. Цей `Set` не включає `source`, `originalDriveId`, `originalMime` — це працює бо TASK 0.2/A додавали поля БЕЗ bump'у схеми (legacy документи проходять `splitDocumentV4toV5` і потім `createDocument` дає їм default `null` для нових полів). Якщо TASK 0.5 робить bump — треба окремий міграційний файл (`v6ToV7.js`?) і узгоджена логіка дефолтів для нових полів у legacy документах.

5. **`movementCard` і `ecitsSource` як НЕТРИВІАЛЬНІ структури.** Якщо це об'єкти з вкладеними полями — це уже не "просте nullable поле", а складна сутність. За CLAUDE.md правилом #11 («один сенс на ім'я») — треба продумати: чи це 1 поле з вкладеним об'єктом, чи це extended-сутність (yкладається у `documents_extended.json`)? Поточна архітектура має чітке розділення light/heavy: ID/category/dates — light; tags/notes/processingHistory — heavy. Куди потрапляє `movementCard`? За його розміром (повна історія руху документа — потенційно велика) — швидше це heavy. Але за смисловим важелем (адвокат хоче бачити в списку чи документ синхронізовано з ЄСІТС) — light.

### г) РЕКОМЕНДАЦІЯ

- Розділити нові поля на light (ствердження факту) і heavy (повний контекст):
  - **Light в canonical:** `sourceConfidence` (enum: high/medium/low/null), `extractedAt` (ISO datetime або null). Обидва nullable, без зайвої вкладеності.
  - **Heavy в extended:** `ecitsSource` (об'єкт з кабінет-ID, URL повідомлення, raw payload), `movementCard` (масив подій руху), `alternativeSources` (масив альтернативних джерел того самого документа). Додати у `EXTENDED_DOCUMENT_FIELDS` без torch'у канонічної.
- За цим підходом bump може бути не потрібним для документної схеми — лише для case/hearing. Це послідовно з прецедентом TASK 0.2 і TASK A.
- Якщо все одно потрібен повний bump доку-схеми — створити `src/services/migrations/v5ToV6_documents.js` за патерном `v4ToV5.js` (окремий файл, ідемпотентна, повертає `{registry, didMigrate, ...}`).
- Оновити жорсткі тести в `documentSchema.test.js` (23 → нове число) і `migrations.test.js` (toVersion очікування).

---

## 3. CASE SCHEMA — поточний стан

### а) ПОТОЧНИЙ СТАН

**Окремого файлу `caseSchema.js` НЕМАЄ.** Шейп case описаний в:
- `INITIAL_CASES` seed-даних (App.jsx:100-146) — мінімальний демо-приклад.
- `migrateCase` функції (`migrationService.js:96-151`) — що нормалізується/додається.
- ACTIONS у App.jsx (4674-5710) — `create_case`, `update_case_field`, `add_proceeding` etc.
- Текстовому опису у CLAUDE.md.

**Поля справи (з seed + migration + ACTIONS):**

```
// Ідентифікація і базові метадані
id (string: 'case_<n>')
name, client, court, case_no, category, status, judge, next_action, notes
createdAt, updatedAt

// Вкладені сутності
hearings: [{id, date, time, duration, status, type, court?, notes?, createdBy}]
deadlines: [{id, name, date, createdBy}]
notes: [{id, text, category, ts, ..., createdBy}]
documents: [...23 canonical fields per doc]
proceedings: [{id, type, title, court, status, parentProcId, parentEventId,
               color?, caseNumber?, dateOpened?, judges?, description?}]  // лише на seed case_4
pinnedNoteIds: []
agentHistory: []  // 3-tier cache
timeLog: []       // DEPRECATED, лишається порожнім

// SaaS (v2+)
tenantId, ownerId, shareType, externalAccess[]
team: [{ userId, caseRole, addedAt, addedBy, permissions: {...7 boolean} }]

// Phase 1.5
storage: { driveFolderId, subFolders: { '01_ОРИГІНАЛИ': id, ... } }
lastProcessingContext: {...}  // після Document Processor
```

**Структура `case.parties`:** **НЕ ІСНУЄ.** Сторони фігурують лише як вільнотекстове поле `client` (рядок типу `"Корева М.В."` чи `"ТОВ «Квант»"`). Жодних формальних ролей сторін (позивач/відповідач/третя особа), жодного масиву `parties[]`.

**Структура `case.proceedings`:** масив об'єктів. Реально присутній лише в seed `case_4` (Брановський). Поля з ACTIONS (`update_proceeding` ALLOWED_UPDATE_FIELDS, App.jsx:5563-5566): `title, parentProcId, parentEventId, color, court, caseNumber, dateOpened, judges, description, status`. Тип не редагується (структурне рішення, App.jsx:5562). Підтримує деревовидну ієрархію через `parentProcId` з захистом від циклів (App.jsx:212-223).

**Структура `case.team`:** масив (з `migrationService.js:107-114`):
```js
[{ userId, caseRole, addedAt, addedBy, permissions: {canEdit, canDelete, canShare,
   canAddTeam, canViewBilling, canEditBilling, canRunAI} }]
```
Дефолти `permissions` за `caseRole` живуть у `migrationService.js:56-62` (`ROLE_PERMISSION_DEFAULTS`).
Реально читається у `permissionService.checkCaseAccess` (рядок 51).
**Глобальні ролі (на користувачі):** solo_advocate, solo_assistant, bureau_owner, bureau_lawyer, bureau_assistant, association_*, firm_*, external_collaborator (опис у CLAUDE.md розділ SaaS Foundation).
**caseRole (на члені команди справи):** lead, owner, oversight, team_member, co-lead, support, consulted, external (CLAUDE.md). У коді ці значення фігурують у `ROLE_PERMISSION_DEFAULTS` як `owner | lead | co-lead | support | external`.

**Чого НЕМАЄ:** `ecitsState`, `syncMetrics`, `parties[]`, `proceeding.composition` (хоча `judges` у `update_proceeding` allowed list — близько за смислом).

### б) ПЛАН TASK 0.3.5

- `caseSchema` розширити: `ecitsState` (з `syncMetrics`), `parties[]`, `team[]` (з `userId`), `proceeding.composition`.

### в) РОЗБІЖНОСТІ І РИЗИКИ

1. **`caseSchema` як файл не існує.** Створення `src/schemas/caseSchema.js` — нова архітектурна одиниця. Треба обрати: тільки опис (як `documentSchema.js`) чи з фабрикою (як `documentFactory.js`)?

2. **`team[]` уже з `userId`.** Поточна структура — `[{ userId, caseRole, addedAt, addedBy, permissions: {...} }]`. План каже "додати з userId" — ймовірно непорозуміння. Треба пояснити що саме розширюється.

3. **`proceeding.composition`** — план не уточнює структуру. У поточній схемі вже є `judges` (string field у update_proceeding allowlist). `composition` для колегіального суду — масив суддів з ролями (головуючий/учасник). Треба явно сказати — це заміна `judges` чи паралельне поле? Якщо заміна — треба міграція legacy `judges` → `composition`.

4. **`ecitsState` як підструктура case** — це load-bearing рішення. Якщо це окрема велика структура з `syncMetrics`, `lastSyncAt`, `unresolvedDocuments[]`, `discrepancies[]` — її треба продумати з повним ДНК (правило #9): чи tenant-scoped, чи userId-scoped (хто синхронізував), чи будуть billing-implications.

5. **`parties[]`** — фундаментальна зміна. Зараз `client: string` — простий рядок. Якщо `parties[] = [{role: 'plaintiff'|'defendant'|'third_party', name, type: 'person'|'organization', ...}]` — треба міграція з `client` (heuristic парсинг) і узгодження з UI (CaseCard, CaseModal, картка справи в Dossier — все читає `c.client` напряму).

### г) РЕКОМЕНДАЦІЯ

- TASK 0.3.5 має або створити formal `src/schemas/caseSchema.js` за патерном `documentSchema.js` (опис полів через об'єкт-конфіг), або обмежитись додаванням нових nullable полів через `migrateCase` без формального schema-файлу. Перший варіант інженерно чистіший, але більший за обсягом.
- Поле `parties[]` дуже навантажене семантикою. Або переписувати UI що читає `c.client`, або тримати `client` як denormalized-string, а `parties[]` додати окремо. Друге простіше для backward-compat.
- `team[]` уже має `userId` — переформулювати план чи прибрати.
- `proceeding.composition` — вирішити: розширити `judges: string` до `composition: [{...}]` з міграцією, або додати `composition` як окреме nullable поле і лишити `judges` як denormalized-text (за прецедентом client).
- `ecitsState` має містити лише agreговані метрики (lastSyncAt, totalDocsSynced, unresolvedCount). Деталі — в інших структурах (наприклад `documentsExtended` для документів зі ЄСІТС, `tenant.recon_history` для розвідки).

---

## 4. HEARING SCHEMA — поточний стан

### а) ПОТОЧНИЙ СТАН

**Окремого `hearingSchema.js` НЕМАЄ.** Шейп hearing визначається через:
- `mkHearing` helper (App.jsx:95-98): `{id: 'hrg_<ts>_<rand>', date, time, court, notes:'', status: 'scheduled'}`.
- `add_hearing` ACTION (App.jsx:4769-4785): `{id, date, time, duration: 120 default, status: 'scheduled', type: null}`.
- `update_hearing` ACTION (App.jsx:4787-4819): редагує `date, time, duration, type`.
- `migrateCase` (migrationService.js:122-128): додає `createdBy` до існуючих hearings.

**Реально існуючі поля hearing:** `id, date, time, duration, status, type, court?, notes?, createdBy`.

**Чого НЕМАЄ:** `source`, `sourceConfidence`, `extractedAt`, `ecitsContext`, `assignedTo`, `attendedBy[]`.

**Як створюються hearings:**
- ACTION `add_hearing` (App.jsx:4769) — головна точка через executeAction. Сигнатура: `({caseId, date, time, duration=120, type=null})`. Валідує що `date` і `time` обов'язкові.
- Mock через `mkHearing` лише в seed `INITIAL_CASES`.
- `update_hearing` без явного `hearingId` шукає найближче scheduled (App.jsx:4795-4803).

**JOIN-зв'язки:**
- `hearings` — вкладений масив у `case`. Жодних окремих індексів.
- `time_entries[].hearingId` — при створенні `add_travel` (App.jsx:5164: `hearingId: parentEventType === 'hearing' ? parentEventId : null`).
- `time_entries[].parentEventId` + `parentEventType: 'hearing'` — двофазна модель резервування.
- `confirm_event` (App.jsx:5097) приймає `eventId` (hearingId зокрема) і оновлює всі прив'язані `time_entries`.

### б) ПЛАН TASK 0.3.5

- Розширити hearing полями: `source`, `sourceConfidence`, `extractedAt`, `ecitsContext`, `assignedTo`, `attendedBy[]`.
- Розширити `add_hearing`/`update_hearing` з опційним `source` (backward compatible).

### в) РОЗБІЖНОСТІ І РИЗИКИ

1. **Поточний `add_hearing` валідує лише `date` і `time` як required.** Усі нові поля будуть або прийняті як є (якщо передані), або відсутні (стара поведінка). Backward-compat відкривається тривіально.

2. **Дзеркалити шейп hearing у hearingSchema.js + factory** — нова архітектура. Аналогічно case (пункт 3).

3. **Шейп hearing нерівномірний.** `mkHearing` повертає `{date, time, court, notes}`, `add_hearing` ACTION повертає `{date, time, duration, status, type}`. Нема `court`/`notes` у ACTION-результаті і нема `duration`/`status`/`type` у seed. Адвокат бачить різні поля залежно від походження hearing. Bump схеми — добра нагода привести до канонічної форми (з міграцією старих hearings).

4. **`assignedTo`/`attendedBy[]` semantically близькі до `case.team[]`.** Якщо адвокат призначив hearing на колегу, треба синхронізувати з team membership. Інакше можна призначити hearing на людину, яка не має доступу до справи. Треба визначити: hearing.assignedTo автоматично додає у case.team чи лише довідкове.

5. **Вкладені сутності за CLAUDE.md правилом не дублюють `tenantId`.** Якщо `ecitsContext` містить `tenantId` — порушення правила. Має успадковувати від case.

6. **Тести `agent-workflow.test.js`/`drag-n-drop.test.js`** імовірно перевіряють форму hearings після add/update. Треба ревізувати `tests/integration/_actionsHarness.js` (де поточна логіка ACTIONS дублюється) — нові поля треба додати у harness.

### г) РЕКОМЕНДАЦІЯ

- Створити `src/schemas/hearingSchema.js` (опис canonical полів) і `src/services/hearingFactory.js` (createHearing/validateHearing) — за патерном document.
- Розширити `add_hearing` опційними `source`, `sourceConfidence`, `extractedAt` (для випадків коли hearing прийшов автоматично з ЄСІТС).
- `assignedTo` / `attendedBy[]` — додати nullable, але задокументувати що НЕ створюють автоматично запис у `case.team`. Окремий ACTION (наприклад `assign_hearing`) робить обидві операції консистентно.
- `ecitsContext` — об'єкт з ID повідомлення в ЄСІТС, URL, raw payload. Не дублювати `tenantId`/`caseId` (успадковуються).
- Перед TASK 0.3.5: оновити `tests/integration/_actionsHarness.js` — інакше інтеграційні тести впадуть.

---

## 5. ACTIONS REGISTRY

### а) ПОТОЧНИЙ СТАН

**Файл:** `src/App.jsx`. **ACTIONS живе в closure** всередині компонента App, рядок 4672 `const ACTIONS = {...}`. **Окремого `actionsRegistry.js` НЕМАЄ** — це описано як майбутній рефактор (CLAUDE.md → Тестування → "ActionsRegistry refactor" з `_actionsHarness.js` коментарем).

**Усі ACTIONS зі сигнатурами (App.jsx:4672-5710):**

```
// Справи
create_case({ fields })
close_case({ caseId })
restore_case({ caseId })
update_case_field({ caseId, field, value })
  // allowedFields: name, client, court, case_no, category,
  //                next_action, notes, judge, status

// Дедлайни
add_deadline({ caseId, name, date })
update_deadline({ caseId, deadlineId, name, date })
delete_deadline({ caseId, deadlineId })

// Засідання
add_hearing({ caseId, date, time, duration=120, type=null })
update_hearing({ caseId, hearingId, date, time, duration, type })
delete_hearing({ caseId, hearingId })

// Нотатки
add_note({ text, category='general', date, time, duration, caseId=null })
update_note({ noteId, text, date, time, duration, caseId })
delete_note({ noteId })
pin_note({ noteId, caseId })
unpin_note({ noteId, caseId })

// Час / Білінг
add_time_entry({ caseId, date, duration, description, category, billable, type, source })
update_time_entry({ id, fields })
cancel_time_entry({ id, reason })
delete_time_entry({ id })             // audit: time_entry_deleted
split_time_entry({ id, durations[] })
assign_offline_period({ from, to, category, caseId, subCategory, semanticGroup })
confirm_event({ eventId, eventType='hearing', decision })  // двофазна модель
add_travel({ parentEventId, parentEventType='hearing', direction='to', duration, caseId, court, city })
cancel_travel({ travelEntryId, reason })
track_session_start({ caseId, sessionId, module, category })
track_session_end({ sessionId })
start_external_work({ category, caseId, subCategory, plannedDuration, semanticGroup })
end_external_work()
update_external_work({ updates })

// Документи і провадження (Phase 1.5)
add_document({ caseId, document })
add_documents({ caseId, documents })
update_document({ caseId, documentId, fields })
  // ALLOWED_UPDATE_FIELDS: name, category, author, documentNature,
  //   namingStatus, isKey, procId, driveUrl, folder, pageCount,
  //   date, icon, status, lastOcrAt
delete_document({ caseId, documentId, mode='full' })  // UI-only, mode: full|registry_only|archive
add_proceeding({ caseId, proceeding })
update_proceeding({ caseId, proceedingId, fields })
  // ALLOWED_UPDATE_FIELDS: title, parentProcId, parentEventId,
  //   color, court, caseNumber, dateOpened, judges, description, status
delete_proceeding({ caseId, proceedingId })  // UI-only
update_processing_context({ caseId, context })

// Композит
batch_update({ operations[], agentId })
```

**`UI_ONLY_ACTIONS` (App.jsx:228):** `delete_document`, `delete_proceeding` — потрібен `params._fromUI: true`. `destroy_case` — окремий UI-only шлях через `deleteCasePermanently`, не через ACTIONS.

**`executeAction` (App.jsx:5780-5881)** — async, послідовно:
1. Перевірка `UI_ONLY_ACTIONS` (потребує `_fromUI`).
2. Перевірка `PERMISSIONS[agentId]` allowlist.
3. Перевірка `ACTIONS[action]` існує.
4. `checkTenantAccess(effectiveUserId, tenantId)`.
5. `checkRolePermission(currentUser.globalRole, action)` (заглушка → true для bureau_owner).
6. Якщо `params.caseId` — `checkCaseAccess(effectiveUserId, caseObj)`.
7. `await ACTIONS[action](params)`.
8. `shouldAudit(action) && writeAudit(...)` — якщо action у `AUDIT_ACTIONS`.
9. `activityTracker.report(action, {...})` — для значущих дій (виключаючи track_session_*, batch_update).

**Source-параметра в executeAction НЕ ІСНУЄ.** Якщо ACTION має знати джерело виклику — це треба передавати у `params` явно (наприклад, `add_document({source: 'ecits', ...})`).

**Як викликаються ACTIONS:**
- З агентів (QI, Dashboard, Dossier) через `onExecuteAction(agentId, action, params)` (App.jsx:6164/6259/6306 etc.).
- З UI-обробників — там само, з `_fromUI: true` для UI-only.
- З `batch_update` — внутрішньо через `ACTIONS[op.action](op.params)` без перевірок `executeAction` (PERMISSIONS перевіряються вручну в batch_update — App.jsx:5693).

**Чого НЕМАЄ:**
- `mark_synced_from_ecits` ❌
- `update_case_ecits_state` ❌
- Жодного префіксу `ecits_*` / `court_*` / `sync_*`.

### б) ПЛАН TASK 0.3.5

- Розширити `add_hearing`/`update_hearing` з опційним `source` (backward compatible).
- Додати `mark_synced_from_ecits`, `update_case_ecits_state`.

### в) РОЗБІЖНОСТІ І РИЗИКИ

1. **ACTIONS живуть у closure App.jsx.** Додавання нових ACTIONS — це редагування 6354-рядкового файлу. Реєстр ACTIONS НЕ модульний. Це рекурсивна проблема (вже зафіксована як майбутній TASK ActionsRegistry refactor).

2. **`update_case_field` має жорсткий allowlist.** Якщо план хоче `update_case_field({field: 'ecitsState', value: ...})` — треба розширити список. Але `ecitsState` — структурно інше (об'єкт, не примітив) → за правилом #11 треба окремий ACTION, не розширення `update_case_field`. План це і пропонує (`update_case_ecits_state`) — добре.

3. **`update_hearing` НЕ має validation для нових полів.** Якщо передати `source: 'ecits'`, воно нічого не зробить — оновлюється тільки `date/time/duration/type`. Треба розширити set полів які копіюються (зараз: `date ?? h.date, time ?? h.time, duration ?? h.duration, type ?? h.type` — App.jsx:4811-4812).

4. **`mark_synced_from_ecits` сигнатуру треба продумати.** Це per-document чи per-case? Змінює `document.ecitsSource` чи `document.source`? Записує `extractedAt`?

5. **`activityTracker.report(action, ...)` пише `time_entries`.** Якщо `mark_synced_from_ecits` — це системна синхронізація а не робота адвоката, потенційно слід виключити з categoryForCase (як track_session_*). Інакше воно потрапить у білінгові звіти як `case_work`.

6. **`AUDIT_ACTIONS`** (auditLogService.js:7-29) включає `add_document`, `update_document`, `add_proceeding` etc. Якщо нові ACTIONS критичні — треба додати їх туди (інакше синхронізація з ЄСІТС не залишить сліду в auditLog).

7. **`_actionsHarness.js` (tests/integration:1-441)** дублює логіку ACTIONS. Будь-яка нова ACTION → треба синхронно оновити harness, інакше інтеграційні тести або впадуть, або будуть тестувати застарілий API.

### г) РЕКОМЕНДАЦІЯ

- Додавати нові ACTIONS у тому ж closure (інакшого шляху зараз нема). Окремий бамп — refactor ActionsRegistry — поза скоупом TASK 0.3.5.
- `mark_synced_from_ecits({caseId, documentId, ecitsSource, extractedAt, sourceConfidence})` — на конкретний документ. Виставляє `source='ecits'`, `ecitsSource`, `extractedAt`, `sourceConfidence`. Не пише у time_entries (виключити з білінгу — додати до списку у App.jsx:5857). Має бути в `AUDIT_ACTIONS`.
- `update_case_ecits_state({caseId, ecitsState})` — replace-всю-структуру, не merge. Auditable.
- Розширити set допустимих оновлень в `update_hearing` (App.jsx:4811-4812) на нові поля (`source, sourceConfidence, extractedAt, ecitsContext, assignedTo`). Backward-compat: якщо не передано — стара поведінка.
- Заздалегідь запланувати оновлення `_actionsHarness.js` як частину DoD TASK'а.

---

## 6. PERMISSIONS SYSTEM

### а) ПОТОЧНИЙ СТАН

**Файл:** `src/App.jsx:5713-5773` — `const PERMISSIONS = {...}` (closure, як ACTIONS).

**Існуючі ролі агентів:**

| agentId | Дії в allowlist (з App.jsx) |
|---------|-----------------------------|
| `qi_agent` | create/close/restore_case, update_case_field, всі deadline, всі hearing, всі note, time_entry actions, confirm_event, travel, external_work, batch_update, add_document, update_document, add_proceeding, update_proceeding |
| `dashboard_agent` | hearings (всі 3), notes (всі 3), confirm_event, add_travel, batch_update |
| `dossier_agent` | усе те що qi_agent + track_session_*, update_processing_context |
| `document_processor_agent` | add_documents, update_processing_context, batch_update |

**Структура запису:** простий масив строк (не об'єкт). Лише `allowedActions`. Жодного `forbidden`/`requireConfirm`/`scope`.

**Перевірка permission** — у `executeAction`, App.jsx:5798:
```js
const allowed = PERMISSIONS[agentId] || [];
if (!allowed.includes(action)) return { success: false, error: 'Немає повноважень: ${action}' };
```

**Глобальні role permissions** — у `permissionService.js:26-33` (`checkRolePermission`):
```js
if (globalRole === 'bureau_owner') return true;
return true;  // заглушка для інших — пропускає все
```

**Tenant/case access** — реальна логіка в `permissionService.checkTenantAccess` і `checkCaseAccess`.

**Чого НЕМАЄ:**
- `court_sync_agent` ❌
- `metadata_extractor_agent` ❌
- Жодного forbidden-механізму.

### б) ПЛАН TASK 0.3.5

- `court_sync_agent` (enabled).
- `metadata_extractor_agent` (defined, disabled).

### в) РОЗБІЖНОСТІ І РИЗИКИ

1. **PERMISSIONS — масив строк, не об'єкт.** Поняття "disabled" не моделюється. Якщо `metadata_extractor_agent` визначений, але disabled — як це виразити? Варіанти: порожній масив `[]` (значить "немає прав на жодну дію"), або окрема структура `DISABLED_AGENTS = new Set([...])`.

2. **Закритий closure App.jsx.** Як і ACTIONS, додавання нових ролей — редагування App.jsx. У реєстр PERMISSIONS треба додавати нові ACTIONS після їх створення.

3. **Якщо `court_sync_agent` дозволений `mark_synced_from_ecits` і `update_case_ecits_state`** — він також має право на `update_document`, `update_hearing`, `add_document` (для документів зі ЄСІТС)? План не уточнює. Треба чіткий список.

4. **Жодного UI-rendering для ролей.** Назви агентів фігурують лише як рядкові id у permission checks. Введення нової ролі не має UI-наслідків.

5. **`metadata_extractor_agent` без рідної дії — чим він займається?** Якщо він планований під `extractMetadataFromDocument` — цієї ACTION ще немає. Disabled-стан означає "не використовуємо поки", але реєстрація в коді — щоб не забути.

### г) РЕКОМЕНДАЦІЯ

- Додати в `PERMISSIONS`:
  ```js
  court_sync_agent: ['mark_synced_from_ecits', 'update_case_ecits_state',
                     'add_document', 'update_document',
                     'add_hearing', 'update_hearing'],
  metadata_extractor_agent: [],  // disabled = empty allowlist
  ```
  з коментарем-доменом для `metadata_extractor_agent`: «Резервоване ім'я для майбутнього TASK Metadata Extractor v1. Поки порожній allowlist — будь-який виклик буде відхилено `executeAction`. Активувати разом з ACTIONS extract_metadata_*».
- Не вводити окремий `DISABLED_AGENTS` Set — порожній allowlist уже достатньо semantically чистий за принципом одного механізму.
- Описати у CLAUDE.md новий розділ "ROLES SaaS Foundation v3.5" з повною матрицею.

---

## 7. EVENT BUS

### а) ПОТОЧНИЙ СТАН

**Файл:** `src/services/eventBus.js` (73 рядки) — створено в TASK 0.2.
- API: `subscribe(eventName, handler) → unsubscribe`, `publish(eventName, payload)`, `clear()` (тести), `subscriberCount(eventName)`.
- In-memory `Map<topic, Set<handler>>`.
- Помилки в handler — лог-warning, не злітають.
- SaaS-готовий (зараз глобальний, у майбутньому per-tenant).

**Файл:** `src/services/eventBusTopics.js` (22 рядки) — константи топіків:
- `ECITS_DOCUMENTS_RECEIVED = 'ecits.documents_received'`
- `ECITS_HEARING_SCHEDULED = 'ecits.hearing_scheduled'`
- `ECITS_CASE_STATUS_CHANGED = 'ecits.case_status_changed'`
- `ECITS_SUBMISSION_COMPLETED = 'ecits.submission_completed'`
- `ECITS_TOPICS = Object.freeze([...])`

**Хто публікує:** **НІХТО** (підтверджено `grep -rn "publish(" /src/`). EventBus — інфраструктурна заглушка.
**Хто підписаний:** **НІХТО** (підтверджено `grep`).
**Інтегрований з activityTracker:** **НІ.** activityTracker викликається прямими функціями (`activityTracker.report(...)`), не через eventBus.

### б) ПЛАН TASK 0.3.5

- EventBus події з нових ACTIONS: `ecits.sync_completed`, `ecits.case_state_updated`.

### в) РОЗБІЖНОСТІ І РИЗИКИ

1. **Поточні топіки vs планові — несумісні неймінги.** Уже є `ecits.documents_received` (документи отримані з ЄСІТС). Чи `ecits.sync_completed` перекриває? `case_status_changed` vs `case_state_updated` — теж близькі. Треба явне рішення: розширюємо набір чи переписуємо.

2. **`publish` з ACTIONS можливий лише через імпорт `eventBus` у App.jsx.** Зараз App.jsx не імпортує `eventBus`. Треба додати імпорт і виклик `publish(...)` з відповідних handler-функцій ACTIONS.

3. **Принцип однозначності (правило #11).** `mark_synced_from_ecits` природно публікує `ecits.sync_completed`. `update_case_ecits_state` — `ecits.case_state_updated`. Не плутати з існуючими, які описують "приймальні" події (документи прийшли, засідання заплановане).

4. **Тести `courtSyncInfrastructure.test.js`** перевіряють шейп eventBusTopics (4 константи). Додавання двох нових — оновити тест (новий expect length: 6).

### г) РЕКОМЕНДАЦІЯ

- Додати в `eventBusTopics.js`:
  ```js
  export const ECITS_SYNC_COMPLETED = 'ecits.sync_completed';
  export const ECITS_CASE_STATE_UPDATED = 'ecits.case_state_updated';
  ```
  і розширити масив `ECITS_TOPICS`.
- Імпортувати `publish` з `eventBus` у App.jsx і викликати у нових ACTIONS після успішного результату.
- Оновити тест на довжину `ECITS_TOPICS`.
- НЕ робити publish з самого `executeAction` (загальний шар) — це порушить принцип «один сенс на один event». Кожна ACTION сама вирішує чи публікувати.

---

## 8. ACTIVITY TRACKER / BILLING

### а) ПОТОЧНИЙ СТАН

**Файл:** `src/services/activityTracker.js` (модульний state з `_sink`/`_patchSink`/`_activeSession`/`_activeSubtimer`/`_enabled`).

**Підписка:** Прямі функції (`activityTracker.report(...)`). Не використовує eventBus.

**Hook-патерн** (`activityTracker.on(eventName, fn)`): зовнішні слухачі для `onSessionStart`, `onSessionEnd`, `onSubtimerStart`, `onSubtimerEnd`, `onReport`. Використовується masterTimer та smartReturnHandler.

**Sink:** Колбек у App.jsx (`setTimeEntries`) — записи потрапляють у React state, потім у `time_entries[]` registry.

**`_enabled` гейт:** до Drive hydration трекер вимкнений. Вмикається в App.jsx після `setDriveHydrated(true)`. Захист від race condition коли app_launched записувався в time_entries до зчитування реальних даних з Drive.

**Категорії:** з `ACTIVITY_CATEGORIES` і `getCategoryDefaults` (timeStandards.js):
- case_work, hearing_attendance, hearing_preparation, travel, client_communication, admin, system, break, manual_entry.
- Кожна має `billable`, `visibleToClient`, `billFactor`.

**Готовність прийняти нові типи:** **ТАК** — `report(eventType, context)` приймає довільний `eventType` як string. Категорія керується з `context.category` або default з activeSession. Можна викликати `activityTracker.report('ecits_sync', {category: 'system', module: 'court_sync', ...})`.

### б) ПЛАН TASK 0.3.5

- Не описано прямо. Очікувано — нові ACTIONS викликатимуть `activityTracker.report` через `executeAction` hook.

### в) РОЗБІЖНОСТІ І РИЗИКИ

1. **Автоматичний звіт для всіх успішних ACTIONS** — `executeAction` робить `activityTracker.report(action, ...)` з категорією `categoryForCase(caseId)` (App.jsx:5856-5874). Якщо `mark_synced_from_ecits({caseId})` — отримає `case_work` (бо `caseId` присутній). Це **неправильно**: синхронізація з ЄСІТС — це системна дія, не робота адвоката над справою.

2. **Виключення зі списку** App.jsx:5857: `['track_session_start', 'track_session_end', 'batch_update']`. Треба додати нові ACTIONS до виключень.

3. **Або** новий ACTION сам викликає `activityTracker.report` з кастомним category=`system` і `module=MODULES.SYSTEM` після виконання — тоді не треба чіпати загальну логіку. Але це порушує однорідність — інші ACTIONS не звітують самі, лише через виключення.

### г) РЕКОМЕНДАЦІЯ

- Додати `mark_synced_from_ecits` і `update_case_ecits_state` до списку виключень в App.jsx:5857. Не репортити їх через executeAction-hook.
- Якщо потрібен білінговий запис (для тарифу що рахує ЄСІТС-операції) — нова `ACTIVITY_CATEGORY = 'court_sync'` з `billable: false`, явний виклик з ACTION.
- Не міняти інтерфейс `activityTracker.report` — він уже universal.

---

## 9. TENANT / USER STRUCTURE

### а) ПОТОЧНИЙ СТАН

**Файл:** `src/services/tenantService.js`.

**`DEFAULT_TENANT` (рядки 18-112) — повний перелік полів:**
```
tenantId, type ('bureau'), name, edrpou, registrationDate, ownerUserId,
addresses {kyiv, kostopil},
contacts {email, phone, website},
bankDetails {iban, bank},
storage {provider, quotaGB, usedBytes},
modelPreferences {dossierAgent, qiAgent, qiParserDocument, qiParserImage,
                  dashboardAgent, documentProcessor, documentParserVision,
                  caseContextGenerator, deepAnalysis} (всі null),
subscription {
  plan, status, validUntil, features,
  limits {aiTokensPerMonth, aiCostPerMonth, storageGB, teamMembers, casesActive},
  current {periodStart, periodEnd, tokensUsed, costUsedUSD, storageUsedGB,
           teamMembersCount, casesActiveCount},
  alerts {warnAt, blockAt}
},
settings {
  language, documentStandard {font, fontSize, margins, lineHeight, pageSize},
  timeStandards (null = використовуємо системні),
  moduleIntegration {
    ecits {autoSync, syncIntervalMinutes, casesToSync, autoProcessIncoming,
           detectDeadlinesOnReceive, executionProvider}
  }
},
recon_history: [],   // TASK 0.3, додано без bump
createdAt, updatedAt
```

**`tenant.subscription.entitlements`** — **НЕ ІСНУЄ.** Є `subscription.features: ['all']` і `subscription.limits` (порожні null) — найближче семантично.

**`tenant.settings.moduleIntegration`** — **ТАК**, з `ecits` секцією. Дефолти у двох місцях: `tenantService.DEFAULT_TENANT` і `ecitsService.DEFAULT_ECITS_SETTINGS` (CLAUDE.md фіксує що це навмисне дублювання, синхронізація вручну).

**`DEFAULT_USER` (рядки 114-138):**
```
userId, tenantId, globalRole ('bureau_owner'),
name, rnokpp, advokatLicense {number, issuedDate, issuedBy},
email, secondaryEmail, phone,
active, structuralUnit (null), supervisorId (null), billingRate (null),
isFounder: true,    // TASK 0.1 v6
createdAt, lastLoginAt
```

**`isFounder` (TASK 0.1) — як працює:**
- Поле `users[].isFounder: boolean`.
- `migrateToVersion6` (migrationService.js:368-406) проставляє `true` для `userId='vadym'`, `false` для всіх інших.
- Хелпер `isCurrentUserFounder()` (tenantService.js:160-163) — `getCurrentUser()?.isFounder === true`.
- Реально використовується в `CourtSync/index.jsx:77` для гейту секції «Розвідник».
- Не використовується в permission checks для tenant-доступу (це **не** tenant-flag).

**Як використовується `userId`:**
- `getCurrentUserId()` (tenantService.js:150-152) — для будь-яких записів `userId`/`createdBy`/`addedBy`.
- В `executeAction` через `effectiveUserId` (приймається параметром або з `getCurrentUser()`).
- В permissionService — `checkTenantAccess(userId, tenantId)`, `checkCaseAccess(userId, caseObj)`.

### б) ПЛАН TASK 0.3.5

- `caseSchema` розширити з `team[]` (з `userId`) — але `team[]` уже з `userId`. Можливо непорозуміння в плані.

### в) РОЗБІЖНОСТІ І РИЗИКИ

1. **`tenant.subscription.entitlements` не існує.** План згадує "як саме реалізовано" — відповідь: ніяк, цього поля немає. Якщо TASK 0.3.5 хоче додати entitlements (наприклад "цей тариф включає ЄСІТС") — це нова структура. Сумісне з ДНК-принципом, можна додати без bump'у (за прецедентом recon_history).

2. **`tenant.settings.moduleIntegration.ecits` має 6 полів і вже використовується.** `getSettings()` в ecitsService мерджить з `DEFAULT_ECITS_SETTINGS`. План не каже про нові поля тут — добре.

### г) РЕКОМЕНДАЦІЯ

- Не торкатися `team[]` — `userId` уже там.
- Якщо потрібно entitlements — додати `tenant.subscription.entitlements: {}` як nullable об'єкт без bump'у. Документувати в CLAUDE.md.
- `tenant.settings.moduleIntegration.ecits` — лишити як є.

---

## 10. МОДУЛЬ «ЕЛЕКТРОННИЙ СУД» — поточний стан з TASK 0.2/0.3

### а) ПОТОЧНИЙ СТАН

**Структура папок:**
```
src/components/CourtSync/
├── index.jsx                           — роутер модуля з founder-gating
├── Reconnaissance/
│   └── index.jsx                       — Розвідка ЄСІТС (founder-only)
└── setup/
    └── ClaudeForChromeSetup.jsx        — one-time walkthrough встановлення
```

**Підвкладки** (з `CourtSync/index.jsx`):

| Секція | Підвкладка | Стан |
|--------|------------|------|
| ЄСІТС | Огляд | заглушка `PlaceholderPanel` "У розробці" |
| ЄСІТС | Журнал | заглушка |
| ЄСІТС | Налаштування | заглушка |
| ЄСІТС | Розбіжності | заглушка |
| Розвідник (founder) | Розвідка ЄСІТС | реальний компонент `Reconnaissance` |

**`ecitsService.js` методи:**

| Метод | Стан |
|-------|------|
| `triggerSync()` | mock: `{success: false, message: "у розробці"}` |
| `getLastSyncTime()` | повертає `null` |
| `getSyncReport()` | mock-структура |
| `getSettings()` | реально читає з tenant.settings.moduleIntegration.ecits |
| `updateSettings(patch)` | merge без персистенції (TODO для executeAction `update_tenant_settings`) |
| `DEFAULT_ECITS_SETTINGS` | frozen-об'єкт |
| `getReconScenarios()` | реально повертає `RECON_SCENARIOS` |
| `getReconScenarioById(id)` | реально |
| `getReconHistory()` | читає з localStorage `levytskyi_recon_history` |
| `registerReconRun(scenarioId)` | реально, пише у localStorage |
| `markReconCompleted(reconId, patch)` | реально |
| `testProviderConnection()` | mock: detected=false |
| `exportReconForAnalysis(reconId)` | повертає очікуваний path, не робить ZIP |

**`tenant.settings.moduleIntegration.ecits` — точна структура зараз:**
```js
{
  autoSync: false,
  syncIntervalMinutes: null,
  casesToSync: 'all',           // 'all' | 'active' | array of caseIds
  autoProcessIncoming: false,
  detectDeadlinesOnReceive: false,
  executionProvider: 'claudeForChrome',
}
```

**Як зберігаються recon-результати:**
- **Поточне джерело правди** — `localStorage('levytskyi_recon_history')`, до 200 записів з ротацією.
- `tenant.recon_history[]` — зарезервоване поле в DEFAULT_TENANT, теоретично має наповнюватись при наступному записі реєстру, але **прямо в коді синхронізація localStorage → tenant.recon_history НЕ ВИКОНУЄТЬСЯ** (з огляду на `tenantService.js:107-109` — це лише дефолт-структура).

**Recon-сценарії:** `src/services/recon/scenarios/ecitsBasic.js` — один сценарій `RECON_ecits_basic_v1` з повним промптом для Claude for Chrome. `RECON_SCENARIOS = [RECON_ecits_basic_v1]`.

### б) ПЛАН TASK 0.3.5

- Не описує змін у CourtSync UI або в ecitsService методах. Зміни — структурні (схема + ACTIONS + події).

### в) РОЗБІЖНОСТІ І РИЗИКИ

1. **`updateSettings` не персистить.** Якщо TASK 0.3.5 додає нові ACTIONS, які мають `tenant.settings.moduleIntegration.ecits` — потрібен реальний шлях запису (наприклад executeAction `update_tenant_settings`). Зараз цього шляху немає.

2. **Reconnaissance UI читає з localStorage.** Якщо TASK 0.3.5 додає нові ACTIONS для синхронізації, які пишуть `tenant.recon_history` — Reconnaissance має знати звідки читати (localStorage ще чи registry).

3. **Підвкладки заглушки** не залежать від нових ACTIONS — їх можна реалізувати в окремому TASK.

### г) РЕКОМЕНДАЦІЯ

- Не змінювати CourtSync UI/ecitsService у TASK 0.3.5 — це окремий TASK Court Sync UI v1 пізніше.
- Якщо ACTION `update_case_ecits_state` має писати в registry — переконатись що `tenant.recon_history` наповнюється у тому ж місці (інакше дві паралельні точки правди).

---

## 11. METADATA EXTRACTOR — стан

### а) ПОТОЧНИЙ СТАН

**`src/services/metadataExtractor/` НЕ ІСНУЄ** (підтверджено `find -type d -name metadataExtractor`).

**Жодних згадок** `metadata_extractor` / `metadataExtractor` у `src/` (підтверджено grep).

Це порожнє місце.

### б) ПЛАН TASK 0.3.5

- Створити `src/services/metadataExtractor/README.md` (ембріон).

### в) РОЗБІЖНОСТІ І РИЗИКИ

1. README без коду — сигнал «місце зарезервоване». Не функціональний код, але мінімально корисно для майбутнього TASK.
2. CLAUDE.md правило: «не створювати документаційні файли (.md) якщо не просили». Тут TASK явно це робить — допустимо, але треба сказати про мету в самому README.

### г) РЕКОМЕНДАЦІЯ

- Файл OK як ембріон, але одночасно треба зареєструвати `metadata_extractor_agent: []` в PERMISSIONS (пункт 6) — інакше файл і агент роз'їдуться.

---

## 12. CANONICAL DOCUMENTS V5

### а) ПОТОЧНИЙ СТАН

Поняття з Phase 1.5 TASK (CLAUDE.md розділ "PHASE 1.5 — CANONICAL DOCUMENT SCHEMA v5.0"):

- Всі документи у системі мають **єдиний фіксований шейп** (23 канонічні поля) — НЕ розширення legacy об'єкта довільними полями.
- **Розщеплення light/heavy:** легкі поля живуть у `cases[].documents[]` у `registry_data.json`. Важкі — у `documents_extended.json` у `.metadata/` папки справи.
- **Єдина точка створення:** `documentFactory.createDocument(metadata)` — всі точки додавання документа (DocumentProcessor, CaseDossier модаль, drag-n-drop, INITIAL_CASES seed) проходять через неї.
- **Валідація:** `validateDocument(doc)` гарантує що всі canonical поля присутні (хай і `null`), і що enum-значення коректні.
- **Маркер "потребує перегляду" ⚠** — `needsReview(doc)` повертає true якщо хоч одне з `procId/category/author` дорівнює null.
- **Міграція legacy:** `migrations/v4ToV5.splitDocumentV4toV5(oldDoc)` → `{canonical, extended | null}`. Невідомі поля → `extended.customFields` (нічого не втрачається). Спецкейси: `tags: ['key']` → `isKey:true`, `author:'opp'` → `'opponent'`, `scanned:true` → `documentNature:'scanned'`, текстові дати ("березень 2023") → `customFields.legacyDateText`.

**Чи є вже "розгалуження" для різних типів джерел:** **ТАК, через поле `source`.** `enum: ['manual_upload', 'ecits', 'telegram', 'email', null]`. Але це лише enum; жодного коду який реально розгалужує обробку за `source` ще НЕМАЄ.

**Як це впливає на додавання source-поля:** ніяк — `source` уже є. Питання тільки в нових допоміжних полях (sourceConfidence, ecitsSource etc.).

### б) ПЛАН TASK 0.3.5

- Розширити канон додатковими полями (див. розділ 2).

### в) РОЗБІЖНОСТІ І РИЗИКИ

Див. розділ 2.

### г) РЕКОМЕНДАЦІЯ

- TASK 0.3.5 має бути "v5.5 розширення" — додавання nullable полів у canonical без переписування factory/validation/migration. Альтернатива (повний v6 для документної схеми) — окремий ризик.

---

## 13. ІСНУЮЧІ КОНФЛІКТИ ТА ПРОБЛЕМИ

### а) ПОТОЧНИЙ СТАН

**1. Жорсткі тести на форму схеми/міграції.**

| Тест | Файл | Що ламається |
|------|------|--------------|
| `Object.keys(CANONICAL_DOCUMENT_FIELDS).toHaveLength(23)` | documentSchema.test.js:19 | Будь-яке нове поле |
| `CURRENT_SCHEMA_VERSION === 5` (доку-схема) | documentSchema.test.js:143 | Якщо бампати documentSchema |
| `CURRENT_SCHEMA_VERSION === 6`, `MIGRATION_VERSION === '6.0_founder_flag'` | founderFlag.test.js:124-129 | Якщо бампати registry-схему |
| `result.toVersion === 5` | migrations.test.js:100 | Якщо змінювати поведінку v4→v5 |
| `ECITS_TOPICS.toHaveLength(4)` | courtSyncInfrastructure.test.js:106 | Якщо додавати нові топіки |
| `validateDocument(doc).valid` matchers | багато тестів | Якщо додавати required поля |

**2. ACTIONS і PERMISSIONS — closure в App.jsx.** Тести не імпортують їх напряму — використовують `tests/integration/_actionsHarness.js`, який дублює логіку. Будь-яка нова ACTION потребує оновлення в ДВОХ МІСЦЯХ.

**3. UI компоненти що читають структуру documents/cases/hearings напряму:**

| Компонент | Що читає |
|-----------|----------|
| `CaseCard` (App.jsx:249-306) | `c.name, c.client, c.court, c.category, c.status, c.deadlines` |
| `CaseModal` (App.jsx:308-388) | `c.name, c.client, c.case_no, c.court, c.category, c.status, c.notes` |
| `Calendar` (App.jsx:391-491) | `c.hearings, c.deadlines` |
| `Dashboard/index.jsx` | `h.duration` (для tooltips), `c.hearings`, `c.deadlines` |
| `CaseDossier/index.jsx` | hearing duration, всі canonical document поля, proceedings |
| `DocumentViewer/*` | document.name, driveId, originalDriveId, source, etc. |

**Якщо `parties[]` замінює `client: string`** — треба переписати CaseCard:267 (`{c.client}`), CaseModal:323, calendar tooltips. Це 5+ місць у App.jsx.

**4. Текстові дати у legacy документах** — `customFields.legacyDateText` (TASK Phase 1.5). Не блокер, але якщо новий ACTION читає `document.date` без перевірки на null — варто врахувати.

**5. `levytskyi_action_log` (legacy)** — вилучено в TASK SaaS Foundation v1.1 (бекап у Drive `_backups/levytskyi_action_log_<ts>.json`, прапор `levytskyi_action_log_cleaned_v1_1`). Не використовувати — використовувати auditLog.

**6. `case.timeLog[]` — DEPRECATED** (CLAUDE.md). Лишається порожнім масивом, але існує. Не плутати з `time_entries[]`.

**7. `ROLE_PERMISSION_DEFAULTS` має ролі owner/lead/co-lead/support/external** (migrationService.js:56-62). У CLAUDE.md перелічено більше caseRole (oversight, team_member, consulted). Розузгодження — у дефолтах permissions цих 3 ролей немає, що не блокер (буде fallback support), але виглядає як необроблений borg.

**8. `proceedings` живуть лише у seed `case_4`.** Усі інші справи їх не мають. ACTION `add_proceeding` працює, але не використовується активно з UI поки що.

**9. Дублювання `DEFAULT_ECITS_SETTINGS`** — у `tenantService.js` (вшито в DEFAULT_TENANT.settings.moduleIntegration.ecits) і в `ecitsService.js` (`DEFAULT_ECITS_SETTINGS`) і `migrationService.js:187-194` (`DEFAULT_ECITS_SETTINGS_FOR_TENANT`). Три точки правди для одних і тих самих 6 полів. Якщо TASK 0.3.5 додає нове поле в ecits-settings — треба пам'ятати про всі три.

### б) ПЛАН TASK 0.3.5

- Тести `canonicalSchemaV7.test.js` (новий файл).
- Оновлення CLAUDE.md (40 рядків новий розділ).

### в) РОЗБІЖНОСТІ І РИЗИКИ

- План не згадує оновлення жорстких існуючих тестів. Це не проблема плану — це необхідність TASK'а.
- План не згадує `tests/integration/_actionsHarness.js` — без оновлення інтеграційні тести впадуть.

### г) РЕКОМЕНДАЦІЯ

- DoD TASK 0.3.5 явно перерахувати:
  - `documentSchema.test.js` — оновити кількість полів і коментар.
  - `migrations.test.js` — додати кейси для нової міграції.
  - `founderFlag.test.js` — оновити `CURRENT_SCHEMA_VERSION === 7`, `MIGRATION_VERSION === '7.0_ecits_canonical'`.
  - `courtSyncInfrastructure.test.js` — оновити `ECITS_TOPICS.toHaveLength(6)` (якщо додаємо 2 нових).
  - `_actionsHarness.js` — додати нові ACTIONS.
  - Новий `canonicalSchemaV7.test.js` — фіксує контракт нових полів.

---

## ЗАГАЛЬНИЙ ВИСНОВОК

**План TASK 0.3.5 в цілому валідний відносно реальної системи**, але потребує **середнього коригування** перед написанням TASK'а. Більшість блоків (eventBus, ecitsService, source-поле, isFounder, founder-gating Розвідника, recon-інфраструктура, executeAction-pipeline, audit/billing-hook'и) уже існують у потрібному вигляді — план базується на реальному стані. Прецедент розширення без bump'у (поля `source`, `originalDriveId` додавалися як nullable без bump'у схеми) ставить під сумнів необхідність повного bump v6→v7 — частина запланованих полів може потрапити в систему за тим самим прецедентом.

**5 найбільших ризиків / точок для перегляду:**

1. **Дві паралельні `CURRENT_SCHEMA_VERSION` (registry=6, document=5) — план не уточнює яку бампати.** Без явного рішення є ризик розузгодження логіки `App.jsx:4035` і `migrateRegistryV4toV5`. Рекомендація: лишити documentSchema на 5, додати nullable поля за прецедентом; bump до 7 робити тільки для `migrationService.CURRENT_SCHEMA_VERSION` (registry-таргет) для нових case/hearing-полів.

2. **`caseSchema.js` і `hearingSchema.js` НЕ ІСНУЮТЬ як файли — план припускає їх наявність.** Вибір: створити нові schema-файли за патерном documentSchema (значне розширення скоупу), або обмежитись додаванням полів через `migrateCase` без формалізації (мінімалістичний підхід). План має це чітко вирішити.

3. **`update_case_field` має жорсткий allowlist полів-примітивів — `ecitsState` як об'єкт туди не вписується.** План правильно пропонує окремий ACTION `update_case_ecits_state`. Але треба додати logіку виключення цих ACTIONS з activityTracker-hook'а в `executeAction` (інакше системна синхронізація потрапить у білінг як `case_work`).

4. **`parties[]` як заміна `client: string` зачепить 5+ UI-компонентів** (CaseCard, CaseModal, Calendar, Dashboard, CaseDossier). План говорить "розширити caseSchema parties[]" без уточнення — це nullable додаткове поле чи реальна заміна. Найбезпечніше: додати `parties[]` як denormalized-структуру, лишити `client: string` як summary для UI.

5. **Принаймні 7 жорстких тестів зламаються** від планованих змін (форма канонічної схеми, кількість топіків, MIGRATION_VERSION, toVersion очікування, `_actionsHarness.js`). DoD TASK'а має явно перелічити ці тести як обов'язкові до оновлення.

**Рішення:** Достатньо **скоригувати деталі плану** — переписувати TASK з нуля не потрібно. Ключові уточнення: (1) що саме бампити, (2) формальні schema-файли чи ні, (3) явні переліки нових ACTIONS з виключеннями для billing-hook'а, (4) backward-compat strategy для `parties` vs `client`, (5) повний DoD з оновленнями тестів і `_actionsHarness.js`.
