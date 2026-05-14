# REVIEW — Чорновик TASK 0.3.5 (Canonical Schema Bump v7)

**Дата:** 2026-05-14
**Тип:** критичний рев'ю чорновика TASK з огляду на реальний стан коду + DEVELOPMENT_PHILOSOPHY.md
**Базовий аудит фактичного стану:** `audit_before_task_0_3_5.md` (попередній файл — лишається валідним як референс шейпу системи)
**Статус:** проміжний документ для адмін-чату, не комітимо

---

## ПРИЗНАЧЕННЯ ЦЬОГО ФАЙЛУ

Аудит від 2026-05-14 робився БЕЗ доступу до самого чорновика TASK 0.3.5 — лише по 25-рядковій довідці. Тепер чорновик отримано (10 секцій з повним переліком полів, ACTIONS, PERMISSIONS, міграції, тестів). Цей файл — **другий прохід**: вже бачу конкретні рішення, можу вказати точкові розбіжності з реальністю коду і DEVELOPMENT_PHILOSOPHY.md.

Структура: спочатку **резюме знайдених проблем за серйозністю** (блокери / ризики / зауваження), потім **деталізація кожної**, в кінці — **узгодження з DEVELOPMENT_PHILOSOPHY.md** і **рекомендований порядок дій**.

---

## EXECUTIVE SUMMARY

**Чорновик добре побудований структурно** — має всі обов'язкові секції (SAAS / BILLING / AI USAGE IMPLICATIONS), чітко відокремлює "що НЕ робити", описує acceptance criteria. Філософія "обидва канали пишуть в одну схему через одні ACTIONS" архітектурно правильна і відповідає принципам planka Picatinny + AI-first.

**Але чорновик містить 4 КРИТИЧНІ блокери, які мовчки ламають уже існуючі архітектурні рішення системи.** Без їх вирішення TASK призведе до:
- Втрати tenant access logic (повна заміна семантики `case.team[]`)
- Червоних тестів одразу після старту (`source` enum несумісний з тим що тестується зараз)
- Двох паралельних таксономій для одного і того самого поняття (`document.addedBy` vs `document.source`)
- Структури PERMISSIONS в форматі який не існує в коді і вимагає переписування `executeAction`

**6 СЕРЙОЗНИХ ризиків** — порушення AI-first принципу (поля без ACTIONS), default-значення які перезаписують реальні дані, відсутність `update_parties`/`update_team` робить нові поля read-only без шляху до ручного оновлення.

**11 МЕНШИХ зауважень** — переважно про оновлення тестів, console-логів, синхронізацію з 3 точками правди дефолтів (DEFAULT_TENANT, ecitsService, migrationService).

**Загальний вердикт:** план потребує **середнього доопрацювання** (рішення по 4 блокерах + явні відповіді на ризики). Не переписувати з нуля, але без доопрацювання не стартувати.

---

## КРИТИЧНІ БЛОКЕРИ

### B1. case.team[] — повна заміна семантики ламає SaaS-foundation v3

**Що каже план (секція 3):**
```
case.team: Array<{
  role: 'lawyer' | 'prosecutor' | 'judge' | 'secretary' | 'legal_representative',
  caseRole: 'defender' | 'plaintiff_rep' | 'defendant_rep' | ...,
  fullName: string,
  isOurLawyer: boolean,
  representsParty: string | null,
  source, sourceConfidence, extractedAt
}>
Default для існуючих: [] (порожній масив)
```

**Що насправді в коді (`migrationService.js:107-114` + `permissionService.js:51`):**
```js
// Існуюче case.team[] (SaaS Foundation v2/v3):
[{
  userId: 'vadym',
  caseRole: 'lead' | 'owner' | 'co-lead' | 'support' | 'external',
  addedAt: ISO,
  addedBy: userId,
  permissions: { canEdit, canDelete, canShare, canAddTeam,
                 canViewBilling, canEditBilling, canRunAI }
}]

// Реально читається в permissionService.checkCaseAccess:
if (Array.isArray(caseObj.team) && caseObj.team.some(m => m.userId === userId)) {
  return true;  // ← без team membership адвокат не отримує доступу до справи
}
```

**Чому це блокер:**

1. **Існуюче `team[]` — це команда юристів бюро в справі для permission control.** Воно несе `userId`/`permissions` для tenant-isolation. Це фундамент SaaS Foundation v2/v3 (CLAUDE.md розділ "SAAS FOUNDATION v3.0 PATCH AND EXTENSION").

2. **Запропоноване `team[]` — це повний список процесуальних учасників** (наші, прокурор, суддя, секретар) без `userId`/`permissions`. Семантично це **різне поняття**.

3. **Default `[]` для існуючих** = міграція **видаляє існуючий vadym з team всіх справ**. Bureau owner ще пройде через fallback `globalRole === 'bureau_owner' return true`, але як тільки SaaS активується для `bureau_lawyer` чи `support` — вони втратять доступ до всіх legacy справ.

4. **`migrateCase` (migrationService.js:107-114) активно створює default team** з vadym якщо team порожній. Якщо TASK 0.3.5 переписує семантику — `migrateCase` теж треба переробити (план не каже).

5. **DEVELOPMENT_PHILOSOPHY.md правило #11 (однозначність):** "Поле структури — одна відповідальність. Не складати в одне поле що змішує lifecycle і вміст". Тут: `case.team` зараз = "хто з бюро має доступ", план хоче = "хто бере участь у процесі". Дві відповідальності → треба два поля.

**Рекомендація:**

Перейменувати або перерозбити:
- **Варіант A (preferred):** Зберегти існуюче `case.team[]` (internal bureau team), додати **нове поле** `case.processParticipants[]` (або `case.courtParticipants[]`) для процесуальних учасників. Це чисто за правилом #11.
- **Варіант B:** Перейменувати існуюче `case.team` → `case.internalTeam` з міграцією, нове поле залишити з ім'ям `case.team`. Складніше — вимагає оновлення всіх місць читання (permissionService.js, migrationService.js, App.jsx у permissions checks).

Я рекомендую **Варіант A** — менше точок зміни, не торкається permissionService, нове поле має семантично точніше ім'я.

---

### B2. document.source enum несумісний з існуючим

**Що каже план (секція 2):**
```
document.source: enum
  Допустимі значення: 'manual' | 'court_sync' | 'metadata_extractor'
                      | 'telegram' | 'email' | 'unknown' | null
  Default для існуючих: 'manual'
```

**Що в коді зараз (`documentSchema.js:108-114`, `constants/documentSources.js`, `tests/unit/courtSyncInfrastructure.test.js:212-214`, `tests/unit/documentFactory.test.js:98-101`):**
```js
// Існуюче (TASK 0.2):
document.source enum: ['manual_upload', 'ecits', 'telegram', 'email', null]

// Тест, який зламається:
expect(DOCUMENT_SOURCES).toEqual(['manual_upload', 'ecits', 'telegram', 'email']);
expect(doc.source).toBe('manual_upload');
```

**Чому це блокер:**

1. **`manual_upload` ≠ `manual`** — план перейменовує без міграції старих значень. Якщо існують документи зі `source: 'manual_upload'` (а вони існують з моменту TASK 0.2), вони стануть невалідними після зміни enum.

2. **`ecits` ≠ `court_sync`** — те саме. План каже "default для існуючих: 'manual'", але існуючі документи можуть мати `source: 'ecits'` від TASK 0.2 — вони отримають дві проблеми: (а) зачитуючись стають невалідними, (б) міграція їх перепише з 'ecits' на 'manual' (втрата справжнього джерела).

3. **`metadata_extractor` і `unknown`** — нові валідні значення. Це OK, додавання.

4. **Тести зламаються одразу.** План пише "Всі попередні тести залишаються зеленими" (секція 9). Це **технічно неможливо** без оновлення `documentFactory.test.js:98-101` і `courtSyncInfrastructure.test.js:212-227`. Те ж стосується `documentSchema.test.js:19` (23 поля → 28 полів).

**Рекомендація:**

Один з двох варіантів:

- **Варіант A (preferred):** Зробити повну міграцію enum-значень у `migrateToVersion7`:
  - `'manual_upload'` → `'manual'`
  - `'ecits'` → `'court_sync'`
  - `'telegram'`, `'email'`, `null` → лишаються
  - Додати `'metadata_extractor'`, `'unknown'`
  - Оновити `documentSources.js`: перейменувати константи, додати нові
  - Оновити тести явно
- **Варіант B:** Розширити enum, не перейменовувати. Тоді нові канали додаються (`'court_sync'`, `'metadata_extractor'`, `'unknown'`), але `'manual_upload'`/`'ecits'` залишаються як аліаси для backward-compat. Це порушує принцип однозначності (правило #11) — один канал = одне ім'я.

Я рекомендую **Варіант A** — правило #11 виграє над зворотною сумісністю. Документ міграції має це явно зазначити.

---

### B3. document.source vs document.addedBy — дві паралельні таксономії

**Існуючий `document.addedBy` enum (`documentSchema.js:87-92`):**
```
['lawyer_via_dp', 'lawyer_manual', 'agent', 'ecits', 'migration']
```
Семантика: "хто додав документ в систему".

**Запропонований `document.source` enum (план секція 2):**
```
['manual', 'court_sync', 'metadata_extractor', 'telegram', 'email', 'unknown', null]
```
Семантика (зі CLAUDE.md розділ "ECITS і інші канали"): "канал по якому документ потрапив у систему".

**Чому це блокер:**

1. **Різниця "хто додав" vs "канал" — спекулятивна.** Якщо `addedBy: 'ecits'` означає "додано через ЄСІТС-інтеграцію" — це вже інформація про канал, а не про людину/агента. Дублювання з планованим `source: 'court_sync'`.

2. **DEVELOPMENT_PHILOSOPHY.md правило #11:** "Якщо не можеш сформулювати сенс одним реченням без 'АБО' / 'а також' / 'інколи' — абстракція зібрана неправильно". Зараз `addedBy` поєднує два сенси: 'lawyer_via_dp' (де додано) + 'agent' (хто додав) + 'ecits' (звідки прийшов) + 'migration' (як з'явилось). Це порушення принципу.

3. **План не уточнює відносини між полями.** Що тоді робить `addedBy`? Депрекейтиться? Лишається як паралельна структура? Що адвокат побачить у UI: "Додано: lawyer_manual / Канал: manual"?

**Рекомендація:**

TASK 0.3.5 має явно вирішити:

- **Варіант A (рекомендую):** Розділити responsibilities явно:
  - `addedBy` → перейменувати в `addedByActor` з enum `['user', 'agent', 'system']` (хто/що зробило акт додавання)
  - `source` → залишити з планованим enum (звідки прийшов файл)
  - Опціонально третє поле: `addedByUserId: 'vadym' | 'olena' | ...` (для multi-user майбутнього)
- **Варіант B:** Лишити `addedBy` як є (з його гетерогенним enum), додати `source` як планується, явно задокументувати що це паралельні поля з різним фокусом. Кожен `addedBy: 'ecits'` має дублюватися як `source: 'court_sync'`. Це порушення правила #11, але мінімум коду.

Принаймні треба **explicit рішення** в плані — інакше через 3 місяці ніхто не пам'ятатиме, чим вони відрізняються.

---

### B4. PERMISSIONS structure — повна заміна формату

**Що каже план (секція 6):**
```
У src/permissions/agentPermissions.js (або де живе таблиця ролей):

а) court_sync_agent:
  - enabled: true
  - allowedActions: ['add_hearing', 'update_hearing', 'mark_synced_from_ecits',
                     'update_case_ecits_state']
  - forbidden: ['destroy_case', 'add_document', ...]

б) metadata_extractor_agent:
  - enabled: false
  - allowedActions: [...]
  - forbidden: [...]
  - activationRequires: 'manual_review'
```

**Що в коді зараз (`App.jsx:5713-5773`):**
```js
// Існуюче PERMISSIONS — closure в App.jsx, не окремий файл:
const PERMISSIONS = {
  qi_agent: ['create_case', 'close_case', ..., 'add_document'],  // масив строк
  dashboard_agent: ['add_hearing', ...],
  dossier_agent: [...],
  document_processor_agent: [...],
};

// Перевірка в executeAction (App.jsx:5798):
const allowed = PERMISSIONS[agentId] || [];
if (!allowed.includes(action)) return { success: false, error: ... };
```

**Чому це блокер:**

1. **Файл `src/permissions/agentPermissions.js` НЕ ІСНУЄ.** Усі PERMISSIONS живуть як closure в App.jsx. План пропонує "агентські permissions у новому файлі" як даність, не як рефактор.

2. **Формат суттєво інший.** Поточне — `{agentId: ['action1', 'action2']}`. Планується — `{agentId: {enabled, allowedActions, forbidden, activationRequires}}`. **Це не розширення, а переписування.**

3. **`executeAction` не вміє обробляти ані `enabled`, ані `forbidden`, ані `activationRequires`.** Поточна перевірка це `allowed.includes(action)` — простий includes. Треба переписати:
   ```js
   const role = PERMISSIONS[agentId];
   if (!role) return { error: 'Unknown agent' };
   if (!role.enabled) return { error: 'Agent disabled' };
   if (role.forbidden?.includes(action)) return { error: 'Forbidden' };
   if (!role.allowedActions.includes(action)) return { error: 'Not in allowlist' };
   ```

4. **Інші 4 ролі (qi_agent, dashboard_agent, dossier_agent, document_processor_agent) лишаться в старому форматі** — heterogeneous PERMISSIONS object. executeAction має робити ще логіку "якщо PERMISSIONS[agentId] масив — старий шлях, якщо об'єкт — новий". Або переписати всі 4 ролі.

5. **Філософія "архіваріус":** "ВСІ ЗМІНИ ДАНИХ ПРОХОДЯТЬ ЧЕРЕЗ ОДНУ ФУНКЦІЮ" — означає executeAction не може мати дві гілки логіки залежно від формату ролі. Або всі ролі переходять на нову схему, або всі лишаються на старій.

**Рекомендація:**

Один з двох варіантів:

- **Варіант A (preferred):** TASK 0.3.5 робить **повну міграцію PERMISSIONS** у новий формат для всіх 4 існуючих ролей + 2 нових. Створює `src/permissions/agentPermissions.js` як єдиний файл. Переписує `executeAction` під новий формат. Це збільшує scope TASK'а, але архітектурно правильно.
- **Варіант B:** Лишити `forbidden` і `enabled` як **soft-конвенції** (без enforcement), реалізувати тільки `allowedActions` як зараз — порожній масив для disabled ролі. Тоді існуючий формат розширюється до:
  ```js
  court_sync_agent: ['mark_synced_from_ecits', 'update_case_ecits_state', 'add_hearing', 'update_hearing'],
  metadata_extractor_agent: [],  // disabled = empty allowlist
  ```
  Жодних змін executeAction не потрібно. Це я рекомендував у попередньому аудиті (розділ 6 → г) РЕКОМЕНДАЦІЯ).

Я рекомендую **Варіант B** для TASK 0.3.5, з нотою про **окремий майбутній TASK PermissionsRefactor v1**, який введе об'єктний формат для всіх ролей синхронно. Це принципова зміна архітектури, не другорядна частина схеми-bump TASK'а.

---

## СЕРЙОЗНІ РИЗИКИ

### R1. AI-FIRST порушення: поля без ACTIONS для редагування

**З DEVELOPMENT_PHILOSOPHY.md (розділ AI-FIRST ARCHITECTURE):**
> "Усі ACTIONS доступні агентам. Якщо нову дію не можна виконати через executeAction — це баг архітектури."
>
> "Принцип дублювання інтерфейсів. Будь-яка дія в системі доступна двома рівноправними шляхами — через UI і через агента в чаті."

**Що каже план (секція 5):**
> "ACTIONS ЯКІ НЕ РОБИМО ЗАРАЗ:
> - update_parties
> - update_team
> - update_proceeding_composition
> - add_timeline_event
> - update_document_movement_card
> - update_case_dnzs"

**Чому це ризик:**

1. **План додає поля `case.parties[]`, `case.team[]` (нова семантика), `proceeding.composition`, `document.movementCard`, `document.alternativeSources`.** Усі вони отримують default `[]` чи `null` при міграції. Жоден ACTION не редагує їх.

2. **Адвокат не може через діалог з агентом сказати:** "У позові додай третьою особою ще ось кого" — `update_parties` не існує. **Це порушення AI-first** напряму.

3. **Через UI ці поля теж не редагуються** (немає UI). Фактично вони мертві поки не з'явиться окремий TASK з ACTIONS.

4. **`mark_synced_from_ecits` тільки оновлює `case.ecitsState`** (план секція 5.б: "оновлює case.ecitsState відповідними значеннями"). Він НЕ пише `parties[]`, `team[]`, `composition`, `movementCard`. Тобто навіть з ЄСІТС поля заповнюватись не будуть в TASK 0.3.5.

5. **`update_case_ecits_state` приймає `patch: Partial<case.ecitsState>`** — обмежений ecitsState. Не торкається інших нових полів.

**Висновок:** TASK 0.3.5 створює "мертві поля" — закладає структури, які ніщо не пише і ніщо не редагує. Це не порушення філософії "ембріон з повним ДНК" (структури — частина ДНК, закладати правильно), але **порушення AI-first** (нема дій → немає AI-доступу).

**Рекомендація:**

Один з двох:

- **Варіант A (preferred):** Розширити scope TASK 0.3.5 додаванням мінімальних edit-ACTIONS:
  - `update_parties({caseId, parties[]})` — replace-all
  - `update_team({caseId, team[]})` — replace-all (з огляду на B1 — це нове поле, не існуюче)
  - `update_proceeding_composition({caseId, proceedingId, composition})`
  - `update_document_movement_card({caseId, documentId, movementCard})`
  - `update_document_alternative_sources({caseId, documentId, alternativeSources[]})`
  
  Усі — replace-all, мінімальні. PERMISSIONS — лише для `dossier_agent` і `qi_agent`. Це додає ~150 рядків, але закриває AI-first дзеркально.

- **Варіант B:** Розширити `update_case_ecits_state.patch` semantics на ширший scope: prijmaje patch для всіх нових полів справи, не лише ecitsState. План має чітко це документувати. **Я цього не рекомендую** — порушує однозначність імені (правило #11): функція з ім'ям "update ecits state" пише довільні поля.

**Найгірший варіант (який план зараз пропонує):** залишити поля без ACTIONS. Тоді в звіті по TASK треба явно зафіксувати "AI-first порушено для парт/team/composition/movementCard, треба ASAP TASK 0.3.6 з ACTIONS". Інакше це буде архітектурний борг, який всі забудуть.

---

### R2. parties[] vs client (string) — дві точки правди залишаються

**Існуюче:** `case.client: string` (наприклад `"Корева М.В."`, `"ТОВ «Квант»"`) — використовується у CaseCard, CaseModal, Calendar tooltips, Dashboard, CaseDossier.

**Запропоноване:** `case.parties: Array<{role, fullName, code, position, source, sourceConfidence, extractedAt}>` з default `[]` для існуючих.

**Ризик:**

1. Default `[]` означає **усі legacy-справи лишаються з parties=[] поки парс/синхронізація не заповнить**. UI продовжує показувати `c.client`. Дві точки правди — `client` (legacy denormalized) і `parties[]` (нова canonical).

2. План не каже, що робити з `c.client` коли `parties[]` заповнено. Лишити обидва? Тоді розузгодження неминуче.

3. **DEVELOPMENT_PHILOSOPHY.md "Single Source of Truth":** "ОДНЕ ДЖЕРЕЛО ПРАВДИ ДЛЯ КОЖНОГО ТИПУ ДАНИХ. Якщо знаходить дублювання: знайти source of truth, видалити дублікати, оновити доступ через єдине джерело."

**Рекомендація:**

Явно задокументувати в TASK 0.3.5:

- `case.client` → лишається як **denormalized summary** для UI до моменту TASK Backfill v1, який заповнить `parties[]` з legacy `client`.
- Після backfill — `client` депрекейтиться (computed з parties), або видаляється з міграцією.
- Поточний TASK 0.3.5 нічого не змінює в `client` поведінці.

Це **soft рішення** — порушує SSoT тимчасово, але уникає UI-ламання. TASK 0.3.5 має це явно сказати.

---

### R3. activityTracker.report для нових системних ACTIONS — потраплять у білінг як case_work

**Що в коді (`App.jsx:5856-5874`):**
```js
if (result && (result.success || result.successCount) &&
    !['track_session_start', 'track_session_end', 'batch_update'].includes(action)) {
  activityTracker.report(action, {
    caseId: hookCaseId,
    category: categoryForCase(hookCaseId),  // 'case_work' якщо caseId присутній
    ...
  });
}
```

**Що каже план (BILLING IMPLICATIONS):**
> "Не торкається білінгу зараз. У майбутньому при реалізації синхронізаційних сценаріїв (TASK 0.4+) activityTracker буде викликатись з відповідних модулів. Розширення схеми не впливає на time_entries чи ai_usage."

**Ризик:**

`mark_synced_from_ecits({caseId})` — успішно повертає `{success: true}`. **Автоматично потрапляє в activityTracker.report з category='case_work'.** Це означає, що кожна синхронізація з ЄСІТС додає запис у `time_entries[]` як **робота адвоката над справою**, хоча це системна операція без часу адвоката.

В місячному звіті адвокат побачить sync-операції в білінговому зрізі по справі. Клієнт у CRM-зрізі побачить "робота юриста: synchronize з ЄСІТС".

**Рекомендація:**

В TASK 0.3.5 явно додати до списку виключень в `App.jsx:5857`:
```js
!['track_session_start', 'track_session_end', 'batch_update',
  'mark_synced_from_ecits', 'update_case_ecits_state'].includes(action)
```

Або (краще архітектурно): зробити **per-action метадану** (наприклад, `ACTIONS_NO_BILLING_REPORT = new Set([...])`) поряд з ACTIONS, щоб уникнути inline-list, який редагується кожен раз.

**Доповнення до плану:** BILLING IMPLICATIONS секція має це згадати — "новий ACTION має бути виключений з activityTracker-hook щоб не потрапити у time_entries як case_work".

---

### R4. INITIAL_CASES seed і migrateCase треба синхронно переробити

**Що в коді:**
- `App.jsx:100-146` — INITIAL_CASES (20 demo справ).
- `migrationService.js:96-151` — `migrateCase(c)` додає SaaS-поля до legacy справ.

**Конфлікти з планом:**

1. **migrateCase додає default `team[]` з vadym** (рядки 107-114). Якщо TASK 0.3.5 переписує семантику team — `migrateCase` має теж змінитись. План не каже.

2. **INITIAL_CASES не мають `parties`, `ecitsState`, `team` в новій семантиці.** При міграції v6→v7 вони отримають defaults, але це означає всі 20 demo-справ — це чисто manual створення. У UI вони покажуться без сторін (бо `parties: []`), хоч `client` лишається.

3. **Seed `case_4` (Брановський) має `proceedings`** (Брановський, App.jsx:105-108). У них немає `composition`. Міграція проставить `composition: null` для двох existing проваджень. Це OK, але треба упевнитись що `update_proceeding` ALLOWED_UPDATE_FIELDS (App.jsx:5563-5566) розширити для `composition` якщо план додає update-можливість.

**Рекомендація:**

- TASK 0.3.5 має **явно зачепити `migrateCase`** і узгодити логіку:
  - Якщо team-нова-семантика, то `migrateCase` НЕ створює default team з vadym (бо vadym не "учасник процесу", а internal lawyer).
  - Якщо team-стара-семантика лишається разом з новою (рекомендований Варіант A в B1) — `migrateCase` без змін.
- Не торкатися INITIAL_CASES крім seed `case_4` (там можна розширити `proceedings[0].composition` як приклад для UI-розробки).

---

### R5. Default 'manual' для існуючих документів перезаписує реальний 'ecits'

**Що каже план (секція 8.а):**
> "Для кожного документа в registry:
> - якщо немає поля source: проставити 'manual'"

**Ризик:**

Існуючі документи з TASK 0.2 ВЖЕ МОЖУТЬ МАТИ `source: 'ecits'` або `source: 'manual_upload'`. Логіка "якщо немає source" — двозначна:
- "немає" = `undefined` → проставляється `'manual'`. **Існуючі `'ecits'`/`'manual_upload'` зберігаються.**
- АБО "немає" = `null OR undefined` → теж `'manual'`. Тоді `null` (legacy default з TASK 0.2) → `'manual'`. Це може бути не те, що очікується для документів які чесно мали `null` бо невідомо.

**Рекомендація:**

План має явно сказати міграційну логіку:

```js
function migrateDocumentSource(doc) {
  if (doc.source === undefined) return 'manual';        // не існувало поля
  if (doc.source === null) return 'manual';             // явно null = невідомо → manual
  if (doc.source === 'manual_upload') return 'manual';  // переіменування (див. B2)
  if (doc.source === 'ecits') return 'court_sync';      // переіменування (див. B2)
  return doc.source;  // 'telegram', 'email' лишаються
}
```

І документувати в console.log: "[TASK 0.3.5] Renamed N documents source: manual_upload → manual, M: ecits → court_sync".

---

### R6. ecitsState пишеться `mark_synced_from_ecits` але читається ким?

**Що пише план:**
- `mark_synced_from_ecits` оновлює `case.ecitsState.{lastSyncedAt, lastSyncedBy, syncStatus, failureReason}`.
- `update_case_ecits_state` мерджить patch у `case.ecitsState`.

**Чого план не каже:**
- **Хто і де читає `case.ecitsState`?** Жодного UI. Жодного агента (план явно нічого не активує).
- **Як адвокат бачить що справа була синхронізована?** Жодного індикатора в UI (картка справи, дашборд).

**Ризик:** мертві дані — пишемо, але ніхто не бачить. Через рік адвокат дивується "чому моя справа не синхронізована" — відповідь у `ecitsState.syncStatus`, але прочитати не може.

**Рекомендація:**

TASK 0.3.5 на рівні плану має **обмежитись закладкою** (це валідно — "інструментація зараз, UI потім" з філософії білінгу теза 4). Але треба:

1. Явно сказати в TASK: "UI читання ecitsState — окремий TASK Court Sync UI v1 (наступний за 0.4)".
2. У звіті по TASK явно перерахувати поля, які записуються але не читаються — щоб у CLAUDE.md з'явилася нота "tracking debt: fields written but not displayed".

---

## МЕНШІ ЗАУВАЖЕННЯ

### N1. План помилково стверджує "Всі попередні тести залишаються зеленими"

**Чорновик (секція 9):** "Всі попередні тести залишаються зеленими."

**Реальність:** мінімум 4 тести зламаються одразу:

| Тест | Файл | Причина |
|------|------|---------|
| `expect(Object.keys(CANONICAL_DOCUMENT_FIELDS)).toHaveLength(23)` | documentSchema.test.js:19 | План додає 5 нових полів → 28 |
| `expect(doc.source).toBe('manual_upload')` | documentFactory.test.js:100 | План перейменовує enum |
| `expect(DOCUMENT_SOURCES).toEqual(['manual_upload', 'ecits', 'telegram', 'email'])` | courtSyncInfrastructure.test.js:212 | План переписує enum |
| `expect(CURRENT_SCHEMA_VERSION).toBe(6)` + `expect(MIGRATION_VERSION).toBe('6.0_founder_flag')` | founderFlag.test.js:124-129 | План бампає до 7 |

**Рекомендація:** Acceptance criterion змінити з "Всі попередні тести залишаються зеленими" на "Всі попередні тести оновлені відповідно до v7-схеми і зелені". Перерахувати ці 4 тести явно у DoD.

---

### N2. localStorage flag pattern для бекапу — не описаний

План каже "Створити registry_data_backup_pre_v7_<timestamp>.json", але не каже про **прапор** `levytskyi_pre_v7_backup_done` за патерном існуючих 5 бекапів (`pre_saas`, `pre_v3`, `billing_v4`, `pre_v5`, `pre_v6`).

Без прапора кожне завантаження аппки буде намагатися створити бекап заново.

**Рекомендація:** Явно додати: "перед бекапом — перевірка прапора `levytskyi_pre_v7_backup_done`, після успішного бекапу — `localStorage.setItem(прапор, '1')`".

---

### N3. CLAUDE.md обмеження "не більше 40 рядків" — оптимістично

TASK 0.3.5 додає:
- 5 нових полів документа з enum/structure
- 4 нові поля справи (включно з вкладеними структурами)
- 4 нові поля hearing
- 1 нове поле proceeding (composition)
- 2 нові ACTIONS зі сигнатурами
- 2 нові PERMISSIONS ролі
- Принцип source-полів і пріоритетизації
- Папку-ембріон metadataExtractor

Адекватний опис цього в CLAUDE.md — мінімум 60-80 рядків (за патерном TASK A який зайняв ~75 рядків). 40 — це або поверхневий опис (адвокат через 6 міс не зрозуміє), або перерахунок без деталей.

**Рекомендація:** Або підняти ліміт до 70-80 рядків, або винести деталі в окремий референсний файл (`canonical_schema_v7.md`) і в CLAUDE.md дати тільки 40-рядкове резюме з посиланням.

---

### N4. Дублювання DEFAULT_ECITS_SETTINGS — три точки правди

CLAUDE.md і код визнають що **дефолти ecits-settings продубльовано тричі**:
- `tenantService.js:94-103` (DEFAULT_TENANT.settings.moduleIntegration.ecits)
- `ecitsService.js:28-35` (DEFAULT_ECITS_SETTINGS, frozen)
- `migrationService.js:187-194` (DEFAULT_ECITS_SETTINGS_FOR_TENANT)

TASK 0.3.5 не торкається ecits-settings, але якщо в майбутньому (TASK 0.4+) додаються нові поля settings — треба не забути синхронізувати в усіх трьох. Це не блокер для TASK 0.3.5, але **вартує згадати в CLAUDE.md як accepted technical debt**.

---

### N5. Source поля у 4 структурах (document, parties[], team[], hearing) — code duplication

`source`, `sourceConfidence`, `extractedAt` повторюються у:
- `document` (top-level)
- `case.parties[]` (per-element)
- `case.team[]` (per-element)
- `hearing` (top-level)

За принципом DRY варто витягти в shared shape `withProvenance` — але це може бути premature abstraction. CLAUDE.md правило #11 каже: "Три схожі рядки краще за передчасну абстракцію" (з системного промпта Claude).

**Рекомендація:** OK мати дублювання для першої ітерації. Зафіксувати в CLAUDE.md ноту "якщо provenance-поля з'являться у 5-й структурі — рефакторити в shared shape". Не блокер.

---

### N6. proceeding.composition — конфлікт з існуючим judges field

**Що в коді (`App.jsx:5563-5566` — ALLOWED_UPDATE_FIELDS для update_proceeding):**
```js
['title', 'parentProcId', 'parentEventId', 'color', 'court',
 'caseNumber', 'dateOpened', 'judges', 'description', 'status']
```

`judges` — string (за коментарями). План додає `composition: {presiding, reporter, members[]}` — структурований об'єкт.

**Конфлікт:** які стосунки `judges` (legacy string) і `composition` (нова структура)? Депрекейтиться `judges`? Лишається обидва? План не каже.

**Рекомендація:** Явно зафіксувати: `judges` → лишається як denormalized summary (для UI який ще не вміє читати composition). `composition` → нове canonical поле. Migrate `judges` → `composition` — окремий backfill TASK.

---

### N7. activationRequires: 'manual_review' — semantic-only поле

План додає `activationRequires: 'manual_review'` для `metadata_extractor_agent`. Але:
- Жодного механізму який це enforce'ить.
- Жодного UI який покаже warning.
- Семантично це лише коментар.

**Рекомендація:** Або зробити це enforced (executeAction перевіряє і повертає error з цим полем), або винести у JSDoc-коментар над роллю в коді. Поле в data-структурі без механізму — мертвий код.

---

### N8. Acceptance criterion "Vite build чистий" — недостатньо специфічно

DoD каже "Vite build чистий". Але:
- Чи "чистий" означає "без warnings"? Чи "build success"?
- Vite видає warnings про bundle size (>500KB). Це блокер чи ОК?

**Рекомендація:** "Vite build success без нових warnings (порівняно з main гілкою)".

---

### N9. План не торкається migrateRegistry chain ordering у App.jsx

Поточний chain в App.jsx EFFECT-A (рядки 3970-4070):
1. `migrateRegistry(raw)` → v4
2. backups
3. `migrateRegistryV4toV5(registry)` → v5
4. backup pre_v6
5. `migrateToVersion6(registry)` → v6

Для TASK 0.3.5 треба додати:
6. backup pre_v7
7. `migrateToVersion7(registry)` → v7

**Рекомендація:** План має явно сказати: "Викликати migrateToVersion7 у App.jsx EFFECT-A після migrateToVersion6, перед setStates. Бекап pre_v7 — перед викликом міграції." Без цього виконавець може помилково викликати в іншому порядку.

---

### N10. tests/integration/_actionsHarness.js — обов'язково оновити

Існуючий harness (`tests/integration/_actionsHarness.js`, 16 КБ) дублює логіку ACTIONS з App.jsx (бо ACTIONS в closure). План додає 2 нові ACTIONS (`mark_synced_from_ecits`, `update_case_ecits_state`) і розширює 2 існуючі (`add_hearing`, `update_hearing`). Без оновлення harness — інтеграційні тести або впадуть, або будуть тестувати застарілий API.

**Рекомендація:** Додати в DoD: "_actionsHarness.js оновлено для нових і розширених ACTIONS".

---

### N11. Console.log префікс не уніфікований

План пропонує:
- `[TASK 0.3.5] Migrating registry from v6 to v7...`
- `[TASK 0.3.5] Updated N documents`
- `[TASK 0.3.5] Pre-v7 backup saved to: <path>`
- `[ACTION] add_hearing called without explicit source, falling back to 'manual'`

Існуючий код використовує `[Phase 1.5]`, `[TASK 0.1]`, `[SaaS Foundation v1.1]`. Варіація `[TASK 0.3.5]` підходить. Але `[ACTION]` — generic prefix, плутається з іншим кодом. Краще `[ACTION add_hearing]` чи `[TASK 0.3.5 ACTION]`.

**Рекомендація:** Узгодити — `[TASK 0.3.5]` для міграції, `[ACTION add_hearing]` для warning'у в ACTION.

---

## УЗГОДЖЕННЯ З DEVELOPMENT_PHILOSOPHY.md

Прохід по головних принципах філософії з оцінкою чорновика:

### ✅ Ембріон з повним ДНК
- План правильно закладає структуру даних повними (ecitsSource з полями, movementCard з deliveries, proceeding.composition).
- Не "потім додамо" — додає при народженні. Узгоджується з принципом.

### ❌ AI-FIRST (порушено) — див. R1
- Поля додаються, але ACTIONS для редагування немає (`update_parties`, `update_team`, etc. явно "не робимо зараз").
- Адвокат не може голосом сказати "додай сторону" → порушення дзеркального доступу UI/агент.

### ⚠️ Архіваріус (executeAction) — частково
- Нові ACTIONS правильно проходять через executeAction → ✅
- Поля які пишуться поза ACTIONS (через `update_case_ecits_state.patch` з довільним scope) — ⚠️ ризик байпасу.

### ❌ Single Source of Truth (порушено тимчасово) — див. R2
- `client` (string) і `parties[]` — дві точки правди. План не вирішує (соромливо лишає на майбутнє).

### ❌ Однозначність (правило #11, кілька порушень):
- B1: `case.team` — два сенси (internal bureau team vs процесуальні учасники).
- B3: `document.addedBy` vs `document.source` — два імені на один концепт каналу.
- N6: `proceeding.judges` (string) vs `composition.members` (struct) — конкуренція.

### ✅ Planka Picatinny (Provider Pattern)
- "Обидва канали (ЄСІТС і інші) пишуть в одну схему через одні ACTIONS" — це і є provider pattern на рівні джерел даних. ✅

### ✅ Стільниковий принцип
- TASK 0.3.5 — інфраструктурний, не торкається UI компонентів. Якщо щось зламається в одному модулі (наприклад permission check з пустим team) — інші компоненти продовжують працювати завдяки ErrorBoundary. ✅

### ⚠️ Тести разом з кодом
- План додає `canonicalSchemaV7.test.js` ✅
- Але стверджує "всі попередні тести зелені" що неправда (N1) ⚠️
- DoD не згадує `_actionsHarness.js` (N10) ⚠️

### ✅ SAAS / BILLING / AI USAGE IMPLICATIONS секції присутні
- Структура шаблону з PHILOSOPHY дотримана. ✅
- Але SAAS IMPLICATIONS не перераховує `Tenant isolation` і `Multi-user behavior` як підрозділи (PHILOSOPHY вимагає). ⚠️
- BILLING IMPLICATIONS пропускає R3 (executeAction-hook торкається білінгу автоматично). ⚠️

### ✅ Принцип DELTA
- "Структура даних → робити правильно з першого разу" → план правильно закладає повну ДНК. ✅
- Винятки (UI потім, інтеграція потім) — узгоджуються. ✅

---

## РЕКОМЕНДОВАНИЙ ПОРЯДОК ДІЙ

Перед стартом TASK 0.3.5 адмін-чату варто:

1. **Прийняти рішення по 4 блокерах** (B1-B4):
   - B1: Варіант A (нове поле `processParticipants[]`, не чіпаємо існуюче `team`).
   - B2: Варіант A (повна міграція enum-значень `manual_upload`→`manual`, `ecits`→`court_sync`).
   - B3: Варіант A (розділити `addedBy` → `addedByActor` + `source`) АБО Варіант B з explicit задокументуванням паралельності.
   - B4: Варіант B (порожній allowlist для disabled), окремий майбутній TASK PermissionsRefactor.

2. **Прийняти рішення по 2 ключових ризиках:**
   - R1 (AI-first): Варіант A — додати мінімальні edit-ACTIONS.
   - R3 (білінг): додати ACTIONS у виключення з activityTracker-hook.

3. **Оновити чорновик TASK** з рішеннями (це може зайняти 30-60 хвилин адмін-чату).

4. **Виправити acceptance criteria** (N1, N2, N9, N10).

5. **Передати оновлений TASK на виконання.**

---

## ЗАГАЛЬНИЙ ВИСНОВОК

**Чорновик TASK 0.3.5 є архітектурно правильним напрямком**, який добре відповідає AI-FIRST і ембріональному принципам філософії. Концепція "обидва канали в одну схему через одні ACTIONS" — інженерно чиста і дозволяє масштабуватися на нові джерела (Telegram, email, голос) без переписування core-логіки.

**Але чорновик у поточному вигляді:**
- **Мовчки ламає три існуючі архітектурні шари** (`case.team` semantics, `document.source` enum, PERMISSIONS structure). Кожен з цих ламань — приховуваний регрес: код буде компілюватись, тести "зелені" після оновлення, але SaaS-foundation, AI-first, або інший фундаментальний принцип буде підірвано.
- **Створює мертві поля** через відсутність edit-ACTIONS — порушення AI-first.
- **Стверджує "тести зелені"**, що технічно неможливо без оновлення мінімум 4 тестів — це знак неперевіреного припущення.

**Рекомендую** не стартувати TASK як є — потрібно 30-60 хв доопрацювання чорновика з рішеннями по 4 блокерах і 2 ключових ризиках. Зміни не великі (переважно — формулювання "як саме переплавляємо існуюче"), але без них TASK залишить систему у розузгодженому стані, який доведеться розплутувати окремими hot-fix TASK'ами.

**Доопрацьований TASK буде сильним інженерним кроком** — заставити архітектуру до прийому ЄСІТС без переписування core'а пізніше. Це відповідає принципу DELTA: "Структура даних → робити правильно з першого разу. Архітектура → закладати з повним ДНК."

---

# ─────────────────────────────────────────────────────────
# ОНОВЛЕННЯ — ПІСЛЯ ДОПОВНЕНЬ АДМІН-ЧАТУ ВІД 2026-05-14
# ─────────────────────────────────────────────────────────

Після написання review (вище) отримав інформацію, що адмін-чат сам провів додатковий раунд правок одразу після чорновика, ще до запиту на аудит. Запропоновані доповнення:

1. `document.ecitsSource.receivedThroughCabinet` стає об'єктом `{userId, cabinetIdentifier}`, а не строкою. Те саме для `receivedAlsoThroughCabinet[]`.
2. `case.team[].userId: string | null` — null для зовнішніх осіб (опонент, прокурор, суддя), userId для адвокатів бюро.
3. `hearing.assignedTo: userId | null` і `hearing.attendedBy: Array<userId>` — multi-user-готовність.
4. eventBus події з нових ACTIONS: `mark_synced_from_ecits` → `'ecits.sync_completed'`, `update_case_ecits_state` → `'ecits.case_state_updated'`.
5. `case.ecitsState.syncMetrics: {totalSyncs, successfulSyncs, failedSyncs, documentsExtracted, hearingsExtracted, lastDurationMs}` — для майбутньої аналітики/ROI.
6. Новий файл `src/services/sourcePolicy.js` з константами `SOURCE_PRIORITY` і хелпером `canOverwrite(existingSource, newSource)`.

Нижче — переоцінка кожного блокера/ризика з мого первинного review з огляду на ці доповнення.

---

## ПЕРЕОЦІНКА БЛОКЕРІВ

### B1 — case.team[] semantics → переоцінено як **СЕРЙОЗНИЙ РИЗИК (не блокер)**

**Що змінилось:** Адмін-чат свідомо вибирає стратегію "один масив team[] для всіх учасників справи, розрізнення через `isOurLawyer === true` + `userId !== null`". Існуюче `case.team[]` (SaaS Foundation v3) переписується, але **userId зберігається** для адвокатів бюро.

**Чому з блокера → ризик:**
- Існуюча `permissionService.checkCaseAccess` (рядок 51): `team.some(m => m.userId === userId)` — продовжує працювати, бо adventure для членів бюро userId буде валідним. Зовнішні (з `userId: null`) не пройдуть perm check — це коректна поведінка.
- Tenant access не ламається.

**Що лишається ризиком:**
- **Втрата `permissions: {canEdit, canDelete, ...}` об'єкта.** Існуюче `team[]` має `permissions` per-member з SaaS Foundation v3. Запропоноване `team[]` його не містить. Це **тиха регресія** — бюро втрачає гранулярний контроль ('canViewBilling', 'canRunAI' etc.). План мовчки видаляє цю фічу.
- **`addedAt`/`addedBy`/`caseRole` (старе значення 'lead'/'owner'/'co-lead'/'support'/'external')** — план не уточнює чи зберігаються. Якщо ні — ще одна тиха регресія.
- **Правило #11 (один сенс на ім'я):** team[] тепер несе ДВА сенси: (а) "хто з бюро має доступ і які права" (старий), (б) "учасники процесу включно з опонентами" (новий). Один масив, два сенси, розрізнення через flag — це класичний паттерн боргу.

**Рекомендація після доповнень:**
- **Або** все-таки розщепити на два поля (`internalTeam` + `processParticipants`) — як я первинно рекомендував.
- **Або** свідомо прийняти "один team[] для всіх" з **явним додаванням** `permissions` до schema нового team[]:
  ```js
  case.team[i] = {
    userId, role, caseRole, fullName, isOurLawyer, representsParty,
    addedAt, addedBy,                              // зберігаємо з SaaS v3
    permissions: { canEdit, ... } | null,          // null для external (userId === null)
    source, sourceConfidence, extractedAt          // нове
  }
  ```
  Тоді при міграції існуючі члени бюро зберігають `permissions`, нові external отримують `permissions: null`. Без цього — тиха регресія SaaS Foundation v3.

### B2 — document.source enum → **БЛОКЕР, не вирішений доповненнями**

Доповнення адмін-чату не торкаються enum source. Конфлікт `'manual_upload'` vs `'manual'`, `'ecits'` vs `'court_sync'` залишається. Тести `documentFactory.test.js:100` і `courtSyncInfrastructure.test.js:212` зламаються. Рекомендація з первинного review (Варіант A — повна міграція enum-значень в migrateToVersion7) лишається в силі.

### B3 — document.addedBy vs document.source → **БЛОКЕР, не вирішений**

Доповнення адмін-чату не вирішують паралельну таксономію. Нова структура `ecitsSource.receivedThroughCabinet: {userId, cabinetIdentifier}` додає **третю точку правди** про походження документа: тепер є `addedBy` (хто/як додав), `source` (канал), `ecitsSource.receivedThroughCabinet.userId` (хто з бюро отримав). Три імені на близькі сенси. Рекомендація з первинного review (явно розділити responsibilities) лишається.

### B4 — PERMISSIONS structure → **БЛОКЕР, не вирішений**

Доповнення адмін-чату не торкаються формату PERMISSIONS. План все ще пропонує об'єктний формат `{enabled, allowedActions, forbidden, activationRequires}` для нових ролей, тоді як існуючі 4 ролі — масиви строк. Рекомендація з первинного review (Варіант B — порожній allowlist для disabled, окремий PermissionsRefactor TASK) лишається.

---

## ПЕРЕОЦІНКА РИЗИКІВ

### R1 — AI-first відсутність ACTIONS → **РИЗИК, частково загострений доповненнями**

Доповнення додають `hearing.attendedBy: Array<userId>`. Хто заповнює? `update_hearing` (план секція 5.а) приймає тільки `source`, `sourceConfidence`, `ecitsContext` — не `attendedBy`/`assignedTo`. Тобто додаються нові поля без шляху редагування. Адвокат не може через діалог сказати "познач що Олена була на цьому засіданні".

Загальний рахунок мертвих полів:
- `case.parties[]` ❌ нема `update_parties`
- `case.team[]` (нова семантика) ❌ нема `update_team`
- `proceeding.composition` ❌ нема `update_proceeding_composition`
- `document.movementCard` ❌ нема `update_document_movement_card`
- `document.alternativeSources` ❌ нема `update_alternative_sources`
- `hearing.assignedTo` ❌ нема ACTION
- `hearing.attendedBy[]` ❌ нема ACTION
- `case.ecitsState.syncMetrics` ⚠️ заповнюється `mark_synced_from_ecits`, але не явно (план не каже про counters в логіці)

Рекомендація — Варіант A з первинного review (мінімальні edit-ACTIONS) — посилюється. Тепер **8 мертвих полів** замість 5.

### R2 — parties vs client → **БЕЗ ЗМІН** — лишається ризик.

### R3 — activityTracker billing-hook → **ЧАСТКОВО ВИРІШЕНО**

Доповнення додають eventBus події (`ecits.sync_completed`, `ecits.case_state_updated`). Але це ОКРЕМО від проблеми R3 — `executeAction` все одно автоматично викликає `activityTracker.report(action, {category: 'case_work'})` для нових ACTIONS, бо вони мають `caseId` у params. eventBus події — це додатковий канал, не заміна activityTracker-hook.

**Рекомендація:** обидва механізми треба:
- Додати ACTIONS у виключення з activityTracker-hook (App.jsx:5857) — мій R3.
- Додати eventBus публікацію в логіку самих ACTIONS — доповнення адмін-чату.

Без першого — записи синхронізації потраплять у time_entries як case_work попри eventBus події.

### R4 — INITIAL_CASES і migrateCase → **ЗАГОСТРЕНО**

Тепер `migrateCase` має додавати ще більше defaults для нових полів. Зокрема — як трактувати існуючий `team[]` з SaaS v3 (з `permissions`/`addedAt`/`addedBy`) при міграції до нового формату? План не каже. Якщо просто перезаписати на `[]` — втрачається структура. Якщо мігрувати — треба mapping logic (який не описаний).

**Рекомендація:** TASK 0.3.5 явно описує `migrateTeamV6toV7(oldTeam)` — як старі члени з permissions перетворюються на нові з isOurLawyer/role/caseRole.

### R5 — Default 'manual' перезаписує 'ecits' → **БЛОКЕР, не вирішений**.

Доповнення не торкаються логіки міграції source. Рекомендація з первинного review (явна логіка перейменування) лишається.

### R6 — ecitsState мертві дані → **ЧАСТКОВО ВИРІШЕНО**

eventBus події публікуються — є точка спостереження для майбутніх підписників. Але UI читання все ще немає. Це OK для інфраструктурного TASK'а, треба явна нота "tracking debt" в звіті.

---

## НОВІ ЗНАХІДКИ ВІД ДОПОВНЕНЬ АДМІН-ЧАТУ

### N12. cabinetIdentifier — нове поняття без джерела правди

**Доповнення (1):**
```js
document.ecitsSource.receivedThroughCabinet = {
  userId: 'usr_abc123',
  cabinetIdentifier: 'levytsky'
}
```

**Проблема:** `cabinetIdentifier` — як адвокат відомий у ЄСІТС-кабінеті. Зараз ні в `users[]`, ні в `tenants[]` НЕМАЄ поля `cabinetIdentifier`. План неявно припускає що воно з'явиться, але не каже де і як.

**Рекомендація:** додати в `DEFAULT_USER` (tenantService.js) поле `ecitsCabinetIdentifier: string | null` — як адвокат ідентифікується в кабінеті ЄСІТС (РНОКПП, email, login — recon має показати). Default null. Тоді `document.ecitsSource.receivedThroughCabinet.cabinetIdentifier` має заповнюватись з `users[].ecitsCabinetIdentifier`, не з повітря.

### N13. syncMetrics counters — план не каже хто інкрементує

**Доповнення (5):**
```js
case.ecitsState.syncMetrics = {
  totalSyncs, successfulSyncs, failedSyncs,
  documentsExtracted, hearingsExtracted, lastDurationMs
}
```

**Проблема:** План каже "Default: всі поля 0/null. Заповнюється починаючи з TASK 0.4." Але `mark_synced_from_ecits` уже у TASK 0.3.5. Якщо в TASK 0.3.5 syncMetrics не заповнюється — він мертвий до TASK 0.4. Якщо заповнюється — план секція 5.б про це не каже.

**Рекомендація:** в TASK 0.3.5 явно описати що `mark_synced_from_ecits` має робити з counters:
```js
mark_synced_from_ecits({caseId, status='synced', failureReason=null}) {
  setCases(prev => prev.map(c => {
    if (c.id !== caseId) return c;
    const m = c.ecitsState?.syncMetrics || {totalSyncs: 0, ...};
    return {
      ...c,
      ecitsState: {
        ...c.ecitsState,
        lastSyncedAt: now(),
        lastSyncedBy: getCurrentUserId(),
        syncStatus: status,
        failureReason,
        syncMetrics: {
          ...m,
          totalSyncs: m.totalSyncs + 1,
          successfulSyncs: m.successfulSyncs + (status === 'synced' ? 1 : 0),
          failedSyncs: m.failedSyncs + (status === 'failed' ? 1 : 0),
        }
      }
    };
  }));
  publish('ecits.sync_completed', {caseId, userId, timestamp, status});
}
```

### N14. sourcePolicy.canOverwrite — оголошений але не використовуваний у TASK 0.3.5

**Доповнення (6):** новий файл `src/services/sourcePolicy.js` з `SOURCE_PRIORITY` і `canOverwrite()`.

**Проблема:** План каже "У майбутньому це може бути tenant-scoped". Але **в TASK 0.3.5 жоден ACTION не викликає `canOverwrite`**. Тобто додається файл, який ніщо не використовує.

**Рекомендація:** використати `canOverwrite` в `update_case_ecits_state` (план секція 5.в каже "НЕ перезаписує поля які мають manual-походження без явного дозволу" — точно те саме, що `canOverwrite`):
```js
update_case_ecits_state({caseId, patch, source}) {
  setCases(prev => prev.map(c => {
    if (c.id !== caseId) return c;
    const merged = {};
    for (const [key, newVal] of Object.entries(patch)) {
      const existingFieldSource = c.ecitsState?._sourceMap?.[key] || 'unknown';
      if (canOverwrite(existingFieldSource, source)) {
        merged[key] = newVal;
      }
    }
    return {...c, ecitsState: {...c.ecitsState, ...merged}};
  }));
}
```
Це потребує також `_sourceMap` per-field — нова структура. Або простіше: перевіряти на рівні всього ecitsState (один source для всього об'єкта).

Без використання — sourcePolicy.js залишається orphan-файлом до TASK 0.4+.

### N15. eventBus події без `tenantId` у payload

**Доповнення (4):** payload `{caseId, userId, timestamp, status}` для `ecits.sync_completed`.

**Проблема:** Зараз тільки один tenant. У SaaS майбутньому eventBus per-tenant (CLAUDE.md обіцяє). Але payload не містить `tenantId` — підписник не зможе фільтрувати між tenants без зайвого lookup.

**Рекомендація:** додати `tenantId` у всі payload eventBus подій:
```js
{caseId, tenantId, userId, timestamp, status}
```
Це дрібниця, але закладається ДНК для SaaS-go-live.

---

## ОНОВЛЕНИЙ ВИСНОВОК (з огляду на доповнення адмін-чату)

**Доповнення адмін-чату — гарний крок у правильному напрямку.** Multi-user готовність (userId у trio: ecitsSource, team, hearing.assignedTo/attendedBy) і eventBus-події покривають частину ризиків мого первинного review. Особливо приємно бачити `sourcePolicy.js` як винесену константу — це закладка для tenant-scoped policies в майбутньому.

**Але:**
- **3 з 4 первинних блокерів (B2, B3, B4) не вирішено доповненнями** — лишаються в силі.
- **B1 переоцінено як ризик**, але з'явилась тиха регресія SaaS Foundation v3 permissions (втрачаються `permissions: {canEdit, ...}` per-member).
- **R1 (AI-first) загострився** — тепер 8 мертвих полів замість 5.
- **3 нові знахідки** (N12-N14): cabinetIdentifier без джерела, syncMetrics без логіки інкрементування, sourcePolicy.js як orphan-файл.

**Загальна рекомендація** після всіх доповнень:

Перед стартом TASK 0.3.5 потрібно ще один раунд правок чорновика:

1. **Розв'язати B2** — обрати стратегію enum-міграції (Варіант A з первинного review).
2. **Розв'язати B3** — обрати стратегію source vs addedBy.
3. **Розв'язати B4** — fall back на масиви строк для PERMISSIONS, з нотою про окремий PermissionsRefactor.
4. **Зберегти `permissions: {...}` у новому team[]** — щоб не втратити SaaS Foundation v3.
5. **Описати logic syncMetrics counters** в `mark_synced_from_ecits`.
6. **Використати `canOverwrite` у `update_case_ecits_state`** — інакше sourcePolicy.js — orphan.
7. **Додати `tenantId` у eventBus payloads.**
8. **Додати `ecitsCabinetIdentifier`** на user-рівні.
9. **Виключити нові ACTIONS з activityTracker-hook** (App.jsx:5857) — інакше bilingual race з eventBus.
10. **Або додати мінімальні edit-ACTIONS для 8 мертвих полів** (R1), або явно зафіксувати їх як борг для TASK 0.3.6.

**Розмір змін:** 60-90 хвилин адмін-чат-роботи на доопрацювання чорновика. Після цього TASK буде готовий до виконання — і виконавець не залишить системі тихих регресій SaaS Foundation, мертвих полів, чи orphan-файлів.
