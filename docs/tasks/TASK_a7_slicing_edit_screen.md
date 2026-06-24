# TASK A7 — Екран редагування плану нарізки (двофазний DP, Варіант A) + два дати-винятки

**Дата:** 2026-06-23
**Вісь:** A (завершення Document Processor). Найбільший пункт DP.
**Передумови:** AUDIT — `docs/audits/audit_before_a7_slicing_edit_screen.md`. Рішення власника:
двофазність = **Варіант A** (`proposeRun`/`executeRun`, стан у «шухляді», не «завмерлий процес»);
**два дати-винятки ВХОДЯТЬ** в A7; повна функція метаданів (A5) і §7.3 — НЕ тут (серверна ера).
**Філософія:** AI-first (усе через `executeAction`), правило #11, додавати-не-переписувати,
OCP диригента (стадії через `stageOverrides`, диригент не змінюється у логіці стадій).

---

## 1. МЕТА

Зробити CONFIRM **справжнім гейтом**: адвокат бачить і **редагує план нарізки ДО** того, як
щось ріжеться чи пишеться на Drive. Конвеєр стає **двофазним**: пропозиція плану → правка на
екрані → виконання за відредагованим планом. Плюс — дешеві дати: AI пропонує дату документа,
адвокат править (на екрані нарізки і inline у вʼювері).

**UX (незмінний для адвоката в обох фазах):** закинув файли → побачив запропонований план
(дерево документів) → поправив (обʼєднати/розділити/назва/тип/дата) → «Виконати» → нарізало і
зберегло. До «Виконати» на Drive **нічого** не зʼявляється.

---

## 2. СКОУП — ЩО ВХОДИТЬ

### 2.1 Двофазний рушій (Варіант A) — backend
- **Диригент `documentPipeline.js`:** додати в `run` опції `{ startFrom?, stopAfter? }` — виконувати
  **підвідрізок** `DEFAULT_STAGE_ORDER`. Без них — повний прогін (поведінка незмінна, OCP).
  Логіку стадій НЕ чіпати.
- **`streamingExecutor`:** розщепити наскрізний `run` на:
  - **`proposeRun(input)`** → OCR-стрім (як зараз) → акумулює `pipelineFiles` (text+layout у RAM) →
    диригент `stopAfter: DETECT_BOUNDARIES` → повертає `{ ok, jobId, plan: ctx.reconstructionPlan,
    session }`. **`_temp` НЕ чистить.** `session` = «шухляда»: тримає `state`, `pipelineFiles`,
    accessors (`getStreamedText/Layout`), `builtDeps`, `jobId/caseId/input`.
  - **`executeRun(session, editedPlan)`** → валідує/нормалізує `editedPlan` → кладе у
    `ctx.reconstructionPlan` → диригент `startFrom: EXTRACT` (EXTRACT→CONFIRM→PERSIST→EMIT) →
    `clearState` (`_temp`) на успіху → повертає `{ documents, decisions, events }`.
  - **`run(input)` лишається** як композиція `proposeRun` + `executeRun(plan)` (поведінка
    байт-у-байт як сьогодні) — для **неінтерактивних** викликачів (`ecitsInboxWatcher`,
    `addFiles`, тести). Інтерактивний DP-UI кличе дві фази окремо.
- **Точка паузи:** план готовий після `DETECT_BOUNDARIES` (triage). `EXTRACT` лише декорує файли
  для persist → належить Фазі 2. Triage будує паспорт з RAM-accessors, не з `EXTRACT` → пауза
  після DETECT_BOUNDARIES коректна.

### 2.2 Екран редагування (Зона 3 DP стає pre-execution)
- Після `proposeRun` Зона 3 показує **редагований план** (не пост-persist перегляд):
  дерево вузлів `reconstructionPlan.documents[]`; на кожному: **назва** (rename), **тип**
  (select enum), **дата** (`DatePicker`, виняток ii), маршрут (route), діапазони сторінок.
- Операції: **обʼєднати** два вузли (конкат fragments), **розділити** вузол (поділ fragments на
  сторінці), rename, set type/date, перепризначити route, прибрати/повернути `unusedPages`.
  Увімкнути нині-`disabled` кнопки «Розділити»/«Обʼєднати» (`DocumentProcessorV2:1152-1153`).
- **«Виконати»** = єдина кнопка-гейт → `executeRun(session, editedPlan)`. До неї — нічого на Drive.
- Після `executeRun` Зона 3 показує **результат** (готові документи) — як зараз. Тобто два стани:
  «план (редагується)» → «результат».
- Валідація плану перед виконанням: перевикористати `normalizePlan`/`resolveOverlaps` (fragments
  у межах сторінок джерела; без небажаних перекриттів). Невалідне — видимий warning, не тихо.

### 2.3 Виняток (ii) — дата в propose-плані + тумблер застосування
- `triagePrompt` додає в JSON-вихід `date` (`YYYY-MM-DD`|null) на документ.
- `triageStage.normalizePlan` переносить `date` у вузол плану. **Дати рахуються ЗАВЖДИ** у фазі
  propose і лежать у session/«шухляді» (тумблер нижче їх НЕ перераховує — лише застосовує).
- `splitDocumentsV3` (`defaultBuildMetadata`/`buildMeta`) пише **ефективну** `date` у `createDocument`.

**Тумблер «Проставити дати» на екрані редагування (один сенс — застосувати готові AI-дати):**
- Дефолт **OFF** (`// experimental — review`; tunable одним рядком; рішення власника: не плодити
  помилкові дати на великих пакетах).
- Кожен вузол має `date` + джерело **`auto`** (від triage) | **`manual`** (адвокат).
  - тумблер **ON** → вузли `auto` показують AI-дату; `manual` — свою;
  - тумблер **OFF** → `auto`-дати НЕ застосовуються (порожньо); `manual` — лишаються;
  - будь-яка правка `DatePicker`-ом (поставити АБО явно «без дати») → вузол стає `manual` →
    **тумблер його більше не чіпає** (ручне в пріоритеті, правило #11; той самий патерн, що
    `namingStatus auto/manual`).
- **На «Виконати»** у `createDocument.date` іде ЕФЕКТИВНА дата: `manual` якщо є, інакше
  (`auto` коли тумблер ON, інакше `null` — як сьогодні). Невикористані AI-дати просто
  «розчиняються» (нікуди не пишуться).
- **Нуль зайвого AI:** тумблер — суто UI-стан над уже-готовими даними session (без повторних викликів).
- Екран показує дату на вузлі через `DatePicker`, завжди **правиму** (AI = пропозиція, не істина).

### 2.4 Виняток (i) — inline-правка у «Деталях» вʼювера
- `CaseDossier:2316` `onOpenDetails` зараз заглушка (`toast «у розробці»`) → зробити **панель
  правки** `date` (`DatePicker`) / `author` (select) / `category` (select) одного документа.
- Запис — **через `executeAction('dossier_agent','update_document', {caseId, documentId, fields})`**
  (R2: не локальний `updateCase` повз архіваріус — заради аудиту/білінгу/permission).

---

## 3. СКОУП — ЩО НЕ ВХОДИТЬ (межі)
- **Повна функція метаданів A5** (авто `author`/`category`, наскрізний `MetadataEditor`,
  `determineMetadata`) — серверна ера (`handoff_2026-06-23_metadata_a5_decisions_and_deferral.md`).
- **§7.3 важіль участі в контексті** — окремий напрямок (сервер).
- **Довговічність плану через навігацію (#42)** — `session` живе **лише в живому сеансі** (RAM);
  пішов з вкладки — план зник. Довговічність = серверне.
- **Дерево проваджень** (категоризація DP-6) — лишається плоский список вузлів плану.
- Повторний/частковий OCR — ні (OCR один раз у `proposeRun`, перевикористання у `executeRun`).

---

## 4. КОНТРАКТИ (для виконавця)

```
proposeRun(input) → {
  ok, jobId,
  plan: { documents:[{documentId,name,type,date?,route,fragments[],open}], unusedPages[] },
  session   // непрозорий handle (RAM): state, pipelineFiles, accessors, builtDeps, jobId, caseId
}
executeRun(session, editedPlan) → { ok, documents[], decisions[], events[] }   // + clearState
run(input) = proposeRun → executeRun(plan)   // composed, behavior-preserving (неінтерактивні)
```
Диригент: `run(input, { startFrom, stopAfter })` — підвідрізок `DEFAULT_STAGE_ORDER`; без опцій —
повний (як зараз). Без зміни логіки стадій (OCP).

---

## 5. SAAS IMPLICATIONS
- Нових сутностей нема. План/документи — у вже tenant-scoped `cases[]`.
- `session` — per-user, живий сеанс; multi-user/довговічність — серверна ера.
- Виняток (i) пише через `executeAction update_document` → зберігає `checkTenantAccess`/
  `checkCaseAccess`/permission-перевірки і audit (на відміну від поточного локального `updateCase`).
- `executeRun` персистить через наявний `splitDocumentsV3` → той самий `add_document`/`createDocument`
  шлях з `tenantId/ownerId` (без змін).

## 6. BILLING IMPLICATIONS
- **AI:** triage вже логується (`callAgent` → `ai_usage` + `activityTracker`). Додавання `date` у
  промпт = **той самий виклик**, без нового логування. Жодного нового AI-виклику A7 не вводить.
- **Persist:** `executeRun` = наявна інструментація PERSIST (без змін).
- **Редагування плану** = активна робота адвоката: спертися на наявний module-session трекінг DP
  (`activityTracker`, MODULES.DOCUMENT_PROCESSOR). **НЕ** додавати окремий per-edit івент (уникнути
  подвійного обліку, правило #11). Якщо потрібен сигнал — один `dp_plan_confirmed` на «Виконати».
- **Виняток (i):** `update_document` з `source='manual'` → наявне правило `EDIT_ACTIONS_SOURCE_AWARE`
  (нараховується як робота адвоката). Без нових категорій.

## 7. AI USAGE IMPLICATIONS
- Єдина зміна — `date` у `triagePrompt` (та сама модель `qiParserDocument`/Haiku через `callAgent`,
  той самий один виклик). Екран і inline-правка — **без AI** (ручні).

---

## 8. ФАЗИ ВПРОВАДЖЕННЯ (кожна — самодостатня, з тестами)
- **A7.1 — двофазний backend (behavior-preserving).** Диригент bounds + `streamingExecutor`
  `proposeRun`/`executeRun`; `run` = композиція. **Вихід ідентичний сьогоднішньому** (propose
  одразу + execute = той самий результат). Без UI. Найделікатніша зона — повний прогін DP-тестів.
- **A7.2 — екран редагування.** Зона 3 редагований план + gate «Виконати» + обʼєднати/розділити/
  rename/type; стан «план»→«результат». (Без дати.)
- **A7.3 — дата (ii).** `triagePrompt` date → `normalizePlan` → `splitDocumentsV3` → поле дати на вузлі.
- **A7.4 — дата (i).** Панель «Деталі» вʼювера: inline-правка date/author/category через ACTION.

Порядок: A7.1 (де-ризик) → A7.2 → A7.3 → A7.4. Кожну можна здавати окремо.

---

## 9. ТЕСТИ
**unit:**
- диригент: `startFrom`/`stopAfter` ріжуть прогін правильно; без опцій — повний (незмінний).
- `normalizePlan` переносить `date`; `splitDocumentsV3` пише `date` у `createDocument`.
- операції плану: merge (конкат fragments), split (поділ діапазону), валідація меж/перекриттів.
**integration:**
- двофазність: `proposeRun` повертає план і **нічого не персистить** (0 документів, 0 на Drive);
  `executeRun(editedPlan)` персистить **відредагований** результат.
- gate: до `executeRun` — жодного `add_document`/Drive-запису.
- дата: тече propose→persist; правка на екрані доходить у `createDocument`.
- виняток (i): inline-правка йде через `update_document` ACTION (tenant/permission/audit-шлях),
  не локальний `updateCase`.
- **behavior-preserving:** композиція `run()` = старий `run()` (наявні DP integration-тести зелені).

---

## 10. РИЗИКИ / НА ЩО ЗВАЖАТИ
- **R3 (делікатність):** `streamingExecutor` — OCR-стрім; розщеплення `run` потребує **повного**
  прогону DP (нарізка/resume/артефакти/міксти PDF+фото). A7.1 робиться behavior-preserving саме
  щоб це де-ризикувати.
- **Неінтерактивні викликачі** (`ecitsInboxWatcher`, `addFiles`) мусять лишитись на композиції
  `run()` — не зламати їх рефактором.
- **Сесія = живий сеанс** (#42): план/артефакти в RAM, перехід вкладки = втрата. Це свідомо
  (довговічність → сервер). На екрані — чесний стан (не вдавати, що переживе навігацію).
- **Дата з AI недетермінована** → завжди правима до «Виконати»; помилкову адвокат поправить.
- **R2:** виняток (i) через ACTION, а не локальний `updateCase` — інакше дірка аудиту/білінгу.

---

## 11. КОД-ОРІЄНТИРИ
- `src/services/documentPipeline.js` (`STAGE`, `DEFAULT_STAGE_ORDER`, цикл стадій — додати bounds).
- `src/services/documentPipeline/streamingExecutor.js` (`run` — розщепити; `clearState` лише в execute).
- `src/services/documentPipeline/stages/{triageStage,extractV3,confirmBoundaries,splitDocumentsV3}.js`.
- `src/services/documentBoundary/triagePrompt.js` (+`date` у вихід).
- `src/components/DocumentProcessorV2/index.jsx` (Зона 3 `:1107+` → редагований план; drag-кнопки `:1152`).
- `src/components/UI/DatePicker.jsx` (дата-UI, спільний).
- `src/components/DocumentViewer/DocumentViewerHeader.jsx` + `CaseDossier/index.jsx:2305-2318`
  (`onOpenDetails` заглушка → панель правки; `onUpdate` → маршрутизувати через `executeAction`).

---

**Здача:** спека → REVIEW з власником → код на гілці (A7.1→A7.4) → `npm test` зелений →
підтвердження перед `main` (бо код тригерить CI+деплой).
