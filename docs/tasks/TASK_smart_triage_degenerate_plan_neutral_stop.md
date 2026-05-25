# TASK — Smart Triage: degenerate plan → нейтральна зупинка з видимим маркером

**Дата спеку:** 25.05.2026 · **Автор:** Claude (сесія консультації з адвокатом)
**Статус:** ФІНАЛІЗОВАНО — вибір адвоката: (B) error-канал з нейтральною лексикою + (1) рендер у Зону 3 «Питання».
**Тип:** fix-доповнення до `TASK_smart_triage_passport_scale_and_text.md`.
**Батьківські TASK:** `docs/tasks/TASK_smart_triage.md`, `docs/tasks/TASK_smart_triage_passport_scale_and_text.md`
**Гілка розробки:** `claude/legal-bms-task-a-2uOeh`

Цей TASK закриває **єдиний симптом**, який лишився після батьківського
доповнення §0 «тихий режим відмови»: коли Triage штатно повертає план, але
план **виглядає як passthrough** (один документ на весь том) — система все
одно мовчки нарізає «один великий PDF без меж». Адвокат отримує
формально-успішний результат, фактично — необроблений том.

Усі інституційні обмеження батьківських TASK (правила #1–#11, §13)
лишаються в силі. При розбіжності перемагають вони + здоровий глузд, не
буква цього доповнення.

---

## 0. Корінь (що саме ламається сьогодні)

Парадоксальна поведінка пайплайна на томі 200+ стор., коли паспорт меж
ще влазить у вікно Haiku, але якість деградувала:

1. `triageStage.js:198-200` — `triage(...)` повертає `raw` без винятку.
2. `normalizePlan(raw)` повертає `{documents: [{route:'add_as_is',
   fragments:[{startPage:1, endPage:N}]}]}` — **один документ на весь
   діапазон** усіх файлів.
3. Перевірка `plan.documents.length === 0` (рядок 208) не спрацьовує —
   документ є, він один.
4. PERSIST штатно матеріалізує цей один «документ»: реєстр отримує
   нерозбитий том, у `03_ФРАГМЕНТИ` — нічого (бо `unusedPages` теж
   порожній). Адвокат бачить зелений «успіх».

Це **семантичний brother** силент-fallback з батьківського §0: там passthrough
ставав на catch, тут — на «успішному» виході. Той самий ефект для адвоката:
тома не розрізана, повідомлення немає.

**Контекст ширшої проблеми:** межова якість Haiku на 100+ сторінок —
батьківський TASK з порогом `RICH_PASSPORT_MAX_PAGES=100` лежить на самому
краю. На 70-100 стор. компактний паспорт уже точніший за rich. Це окрема
гілка фіксу.

---

## 1. Місія (що означає «готово»)

1. **Degenerate plan не доходить до PERSIST.** Якщо Triage пропонує єдиний
   документ, що покриває 100% живих сторінок усіх файлів, — пайплайн
   зупиняється з видимим, нейтральним маркером.
2. **Маркер живе в `result.errors[]`**, але має код-білий-список і
   рендериться у **Зоні 3 «Питання»** (не «Помилки»). Стиль — як у
   `attentionDecisions` (warning), не червоний. Лексика — нейтральна
   («не вдалось автоматично визначити межі — потрібна ручна нарізка»),
   без «вибачте», без скарг, без техдеталей у тілі повідомлення.
3. **Дешеві артефакти стейджів лишаються** (plan.json, normalized,
   passport) — для діагностики. Фінальний нарізаний PDF у
   `01_ОРИГІНАЛИ`/`02_ОБРОБЛЕНІ` НЕ створюється. У `03_ФРАГМЕНТИ`
   нічого з цього прогону не йде (там тільки реальні фрагменти).
4. **Поріг rich-паспорта 100→70 стор.** з override-хуком (для тестування
   і майбутньої per-tenant калібровки). Rich-профіль на 70+ більше не
   видається.
5. Жодного нового екрана, жодного нового UI-перемикача, жодних змін
   ACTIONS/PERMISSIONS/схеми (батьківські §3, обмеження №3).

---

## 2. Архітектурний принцип (правило #11)

**Один сенс на ім'я.** Не нашаровувати на наявний `errors[]` третій
семантичний канал прапором (повторили б skipCache-помилку). Замість
цього — **два різні питання різними даними**:

| Питання | Поле | Сенс |
|---|---|---|
| Що сталось? (machine-readable) | `error.code` | стабільний enum для UI-маршрутизації |
| Як це показати? (UI-routing) | `NEUTRAL_ERROR_CODES` (white-list у компоненті) | які коди йдуть у Зону 3 «Питання» (warning), решта — у «Помилки» (red) |

`fatal: true` лишається на самому error-об'єкті — це окреме питання
«пайплайн продовжує чи зупиняється» (відповідь: зупиняється). UI-канал —
ортогональний.

**Degenerate detection** — окрема чиста функція `isDegeneratePlan(plan,
liveFiles)`, не прапор всередині `normalizePlan`. Один сенс: «план
виглядає як passthrough — один документ покриває 100% живих сторінок».
Тестується ізольовано.

---

## 3. ЗМІНИ КОДУ

### 3.1 `src/services/documentPipeline/stages/triageStage.js`

**Додати** експортовану чисту функцію (одразу після `resolveOverlaps`):

```js
// isDegeneratePlan — план виглядає як passthrough: рівно один документ,
// чиї фрагменти покривають 100% сторінок усіх живих файлів. Один сенс:
// «AI не знайшов меж — повертає тома як один шматок, що тотожно
// відсутності нарізки». Окрема від normalizePlan, бо normalize працює
// над raw AI-відповіддю (форма), а ця — над уже нормалізованим планом
// і живим набором файлів (семантика покриття).
export function isDegeneratePlan(plan, liveFiles) {
  if (!plan || plan.documents?.length !== 1) return false;
  const doc = plan.documents[0];
  if (doc.route === 'discard' || doc.fragments.length === 0) return false;
  const byFile = new Map();
  for (const fr of doc.fragments) {
    const prev = byFile.get(fr.fileId) || [];
    prev.push([fr.startPage, fr.endPage]);
    byFile.set(fr.fileId, prev);
  }
  if (byFile.size !== liveFiles.length) return false;
  for (const f of liveFiles) {
    const ranges = byFile.get(f.fileId);
    if (!ranges) return false;
    const pc = f.pageCount || 1;
    const covered = new Set();
    for (const [s, e] of ranges) {
      for (let p = s; p <= e; p++) covered.add(p);
    }
    if (covered.size < pc) return false;
  }
  return true;
}
```

**Змінити** вихідну гілку успішного Triage (рядки ~210-229):

```js
if (isDegeneratePlan(plan, live)) {
  return {
    ok: false,
    error: {
      code: 'TRIAGE_NEEDS_MANUAL_SPLIT',
      message: 'Не вдалось автоматично визначити межі документів — '
             + 'том оброблено як один фрагмент. Потрібна ручна нарізка '
             + 'або повторний прогін меншими частинами.',
      fatal: true,
      stage: 'triage',
      meta: {
        liveFileCount: live.length,
        totalPages: live.reduce((s, f) => s + (f.pageCount || 1), 0),
      },
    },
  };
}
```

**НЕ чіпати:** catch на 201-207 (тиха-відмова на API-помилці лишається —
це інший сценарій: API-вибух, ingest не блокуємо). `trivialImagePlan`
(одна сторінка = один документ — це **не** degenerate, бо адвокат і
очікує саме такого результату для одного фото).

### 3.2 `src/services/documentPipeline/pageMarkers.js`

```js
// Один сенс: «з цього порогу адаптивна rich-щільність паспорта
// небезпечна — переходимо на стартовий мінімум». Зниження зі 100 до 70:
// валідація адвокатом на томах 70-100 стор. показала, що Haiku на rich-
// паспорті в цьому діапазоні втрачає межі (degenerate plan). Стартова
// точка, обґрунтована емпірично; override-хук для калібровки/тестів.
const RICH_PASSPORT_MAX_PAGES_DEFAULT = 70;
let _richMaxPagesOverride = null;

export function _setRichPassportMaxPages(n) {
  _richMaxPagesOverride = (typeof n === 'number' && n > 0) ? n : null;
}
function richMaxPages() {
  return _richMaxPagesOverride ?? RICH_PASSPORT_MAX_PAGES_DEFAULT;
}
```

Замінити прямі звертання до `RICH_PASSPORT_MAX_PAGES` на виклик
`richMaxPages()`. Старе ім'я **видалити** (а не лишати поряд — це
правило #11; нічого не споживає його ззовні, grep підтвердити).

Префікс `_` у `_setRichPassportMaxPages` — внутрішня контракт-конвенція:
«не для production-коду, тільки тести / майбутня tenant-калібровка
через явний оператор». Не для UI.

### 3.3 `src/components/DocumentProcessorV2/index.jsx`

Додати константу поряд з `ATTENTION_TYPES` (рядок ~255):

```js
// White-list error-кодів, які рендеряться у Зону 3 «Питання» (warning),
// а не у «Помилки» (red). Один сенс: «нейтральні стани, які виглядають
// як помилки в моделі даних, але для адвоката — це питання що
// потребують ручної дії, не системна аварія».
const NEUTRAL_ERROR_CODES = new Set(['TRIAGE_NEEDS_MANUAL_SPLIT']);
```

Розщепити `errors` на два списки в Зоні 3 (рядки ~487-495):

```js
const neutralErrors = errors.filter((e) => NEUTRAL_ERROR_CODES.has(e.code));
const hardErrors    = errors.filter((e) => !NEUTRAL_ERROR_CODES.has(e.code));
const attentionCount = hardErrors.length + attentionDecisions.length + neutralErrors.length;
```

У блоці `resultTab === 'attention'`: nейтральні error-картки рендерити
**разом** з `attentionDecisions` у групі «Питання» (стиль
`dpv2-attention-card` без `--error`). У групі «Помилки» лишається
тільки `hardErrors`.

### 3.4 Pipeline orchestrator (`documentPipeline.js`)

Перевірити, що повернене зі stage `{ok:false, error}` коректно
збирається в `result.errors[]` і зупиняє послідовність наступних стадій
(PERSIST/INDEX). Якщо контракт вже такий — нічого не змінювати; інакше
— мінімальний фікс щоб `fatal:true` справді обривав.

**Очікувана поведінка після фіксу:** PERSIST не запускається,
01_ОРИГІНАЛИ / 02_ОБРОБЛЕНІ нового PDF не отримують, `03_ФРАГМЕНТИ`
лишається порожнім (немає що туди класти — degenerate plan не виділив
фрагментів). Дешеві артефакти стейджу Triage (plan.json,
artifacts[].passport) лишаються на диску для діагностики.

---

## 4. ТЕСТИ (обов'язково перед merge)

### 4.1 Unit — `tests/unit/triageStage.test.js` (новий файл)

- `isDegeneratePlan` на синтетичних планах:
  - 1 файл 50 стор., план `[{fragments:[{1,50}]}]` → **true**.
  - 1 файл 50 стор., план `[{fragments:[{1,30}]}, {fragments:[{31,50}]}]` → **false**.
  - 2 файли по 10 стор., план `[{fragments:[{file1,1,10},{file2,1,10}]}]` → **true**.
  - 2 файли по 10 стор., план з 1 документа, що покриває тільки file1 → **false**.
  - План з `{route:'discard'}` → **false** (discard не degenerate).
  - План з 0 документів → **false**.
- `_setRichPassportMaxPages(50)` / `richMaxPages()` round-trip.

### 4.2 Integration — `tests/integration/triage_degenerate_plan.test.js` (новий)

- Стаб `triage` повертає degenerate raw → `triageStage` повертає
  `{ok:false, error:{code:'TRIAGE_NEEDS_MANUAL_SPLIT', fatal:true}}`.
- Стаб `triage` повертає 2-документний план → `{ok:true}` як раніше
  (regression).
- Стаб `triage` кидає виняток → catch-passthrough як раніше (regression).
- `trivialImagePlan` (1 image, 1 page) → `{ok:true}` (НЕ degenerate).

### 4.3 UI — switch `NEUTRAL_ERROR_CODES`

В наявних інтеграційних тестах DocumentProcessorV2 (або новому
snapshot-тесті, якщо є інфраструктура) перевірити що при
`result.errors = [{code:'TRIAGE_NEEDS_MANUAL_SPLIT', message:'...'}]`:
- блок «Питання» містить це повідомлення;
- блок «Помилки» порожній («Помилок немає»).

Перед merge — `npm test` повністю зелений.

---

## 5. SAAS IMPLICATIONS

- Жодних змін у `tenants[]`, `users[]`, `permissions`, `caseAccess[]`.
- `tenantId` / `ownerId` нових сутностей не з'являється — TASK не
  створює нових структур даних.
- Multi-user readiness: код `TRIAGE_NEEDS_MANUAL_SPLIT` стабільний
  enum, не залежить від ролі — UI однаково ховатиме його у «Питання»
  для всіх tenant types (solo / bureau / association / firm).
- Не порушує SaaS isolation: помилка лишається в межах jobу (того
  самого `caseId`), нічого не пишеться поза tenant scope.

## 6. BILLING IMPLICATIONS

- Triage `activityTracker.report('agent_call', {agentType:'triage_agent'})`
  спрацьовує **до** detection degenerate plan — токени Haiku вже спалені,
  `ai_usage[]` має штатний запис. Це коректно: AI відпрацював, час
  адвоката на чекання теж витрачено.
- `time_entries[]` для адвоката: запис категорії `case_work` triggered
  через `module_navigation` в Document Processor лишається — адвокат
  справді працював з модулем.
- PERSIST стадія не запускається → `add_documents` ACTION не
  викликається → НЕ створюється фіктивний billing-запис на «успішну
  нарізку», якої не було.
- Жодних нових ACTIONS, жодних змін `SYSTEM_ACTIONS_NO_BILLING` /
  `EDIT_ACTIONS_SOURCE_AWARE`.

---

## 7. ЗАБОРОНЕНО (в межах цього TASK)

- НЕ додавати UI-перемикач для `_setRichPassportMaxPages` (це
  тестовий/калібровочний hook, не feature).
- НЕ повертати `RICH_PASSPORT_MAX_PAGES=100` назад без явного TASK з
  валідаційними даними протилежного знаку.
- НЕ робити detection degenerate plan «м'яким попередженням» що
  пропускає пайплайн далі — це повертає той самий тихий fallback,
  тільки з warning'ом.
- НЕ розширювати `NEUTRAL_ERROR_CODES` новими кодами без оновлення
  цього TASK / окремого спеку (white-list — це контракт між пайплайном
  і UI, не вільний enum).
- НЕ створювати нове поле в `error` об'єкті (`isNeutral`, `uiChannel`,
  `severity`) — UI-routing живе у компоненті через `NEUTRAL_ERROR_CODES`,
  не в моделі даних. Правило #11.
- НЕ змінювати лексику повідомлення на «помилку», «збій», «вибачте» —
  адвокату це не помилка системи, це **запит на ручну дію**.

---

## 8. ЗВІТ (обов'язково ПІСЛЯ виконання)

Після завершення TASK (код у main, тести зелені) **обов'язково**
написати звіт і покласти в репо:

- **Шлях:** `docs/reports/report_task_smart_triage_degenerate_plan_neutral_stop.md`
- **Включає:**
  1. **Що зроблено** — перелік файлів зі змінами (file_path:line_number).
  2. **Як перевірено** — список нових тестів, результат `npm test` (число pass/fail).
  3. **Поведінка до/після** — короткий before/after на синтетичному degenerate сценарії.
  4. **Знайдені побічні баги** (якщо є) → окремо в
     `docs/bugs/bugs_found_during_smart_triage_neutral_stop.md` +
     рядок у `tracking_debt.md` якщо не виправляли в межах цього TASK.
  5. **Оновлення `ARCHITECTURE_HISTORY.md`** — один запис у хронологію
     TASK'ів (дата, гілка, summary, лінк на цей спек і на звіт).
  6. **Відкриті питання / спостереження** — якщо порог 70 теж виявиться
     завеликим, або degenerate detection пропускає крайові випадки —
     зафіксувати для наступної ітерації.
- Звіт пишеться **після** push у main (або після підтвердження адвоката
  на code-merge, якщо TASK закінчився на гілці `claude/*`).

---

**Кінець TASK.**
