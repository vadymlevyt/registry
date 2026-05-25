# TASK — Smart Triage: degenerate plan → нейтральна зупинка з видимим маркером

**Дата спеку:** 25.05.2026 · **Автор:** Claude (сесія консультації з адвокатом)
**Статус:** ФІНАЛІЗОВАНО — вибір адвоката: **(A) новий disposition `halt`** у диригенті
(свідомий стоп) + `decision` типу `triage_whole_volume` у Зоні 3 «Питання» через
наявний механізм `ATTENTION_TYPES`. (Варіант B з error-каналом і білим списком
`NEUTRAL_ERROR_CODES` **відхилений** — нашаровував би третій семантичний канал
на `errors[]`, повторюючи skipCache-помилку правила #11.)
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

**Бонусний вихід:** disposition `halt` буде готовий і для майбутніх
TASK C/D, де стадії теж матимуть сценарії «свідомого стопу без аварії»
(чорновики, користувач відмінив, дублікат бранчем-вище тощо).

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

1. **Degenerate plan не доходить до PERSIST.** Triage свідомо зупиняє
   пайплайн через нову disposition `halt` диригента, повертаючи
   `{halt:true, decisions:[…]}`. PERSIST не запускається.
2. **Маркер живе в `ctx.decisions[]`** як `{type:'triage_whole_volume',
   …}` і рендериться у **Зоні 3 «Питання»** через наявний механізм
   `ATTENTION_TYPES` (без червоного стилю, без `--error`). `ctx.errors`
   **НЕ чіпається**. Лексика — нейтральна («не вдалось визначити межі
   документів — потрібна ручна нарізка»), без слів «помилка», «збій»,
   «вибачте», без техдеталей у тілі повідомлення.
3. **Дешеві артефакти стейджів лишаються** (plan.json, normalized,
   passport) — для діагностики. Фінальний нарізаний PDF у
   `01_ОРИГІНАЛИ`/`02_ОБРОБЛЕНІ` НЕ створюється. У `03_ФРАГМЕНТИ`
   нічого з цього прогону не йде (там тільки реальні фрагменти).
4. **Поріг rich-паспорта 100→70 стор.** з override-хуком (для тестування
   і майбутньої per-tenant калібровки). Rich-профіль на 70+ більше не
   видається.
5. Жодного нового екрана, жодного нового UI-перемикача, жодних змін
   ACTIONS/PERMISSIONS/схеми (батьківські §3, обмеження №3), жодного
   нового error-каналу / білого списку кодів.

---

## 2. Архітектурний принцип (правило #11)

**Один сенс на ім'я.** Не нашаровувати на `ctx.errors[]` третій
семантичний канал «нейтральних помилок» через білий список у компоненті
(повторили б skipCache-помилку). Замість цього — **чотири різні
питання → чотири явні значення** disposition:

| Disposition | Що означає | ctx.errors | ctx.stoppedAt | break |
|---|---|---|---|---|
| `continue` | стадія успішна, йдемо далі | не чіпається | не чіпається | ні |
| `halt` *(нова)* | свідомий стоп: стадія завершила свою роботу і вважає продовження нерелевантним. Сенс у `decisions` | **не чіпається** | встановлюється | так |
| `skip` | один файл провалився, batch продовжує (контракт DP-4) | error додається | встановлюється | так (single-file) |
| `fatal` | ламається, можливо resume | error додається | встановлюється | так |

**Чому `halt` окремо від `fatal`** (правило #11 в дії): `fatal` = «дані
неповні, не продовжуємо тихо», артефакти лишаються для resume, у UI —
червона картка в «Помилках». `halt` = «дані штатні, але стадія сама
обрала зупинку», у UI — нейтральне питання в «Питаннях». Різні намери,
різні дані: путати їх через `error.code` + білий список = два сенси на
одне ім'я.

**Decision `triage_whole_volume`** — нейтральна назва стану, не команда
і не помилка. Адвокат читає її як «питання що потребує ручної дії», бо
саме там вона і відображається.

**Degenerate detection** — окрема чиста функція `isDegeneratePlan(plan,
liveFiles)`, не прапор всередині `normalizePlan`. Один сенс: «план
виглядає як passthrough — один документ покриває 100% живих сторінок».
Тестується ізольовано.

---

## 3. ЗМІНИ КОДУ

### 3.1 `src/services/documentPipeline.js` — нова disposition `halt`

**Розширити коментар-інваріант** (рядки ~46-52):

```
//   5. halt:true, decisions:[…]       → свідомий стоп: стадія завершила
//                                       свою роботу і вважає продовження
//                                       нерелевантним. Сенс — у decisions
//                                       (Зона 3 «Питання»), не у errors.
```

**`classifyDisposition`** — додати рядок ПЕРЕД перевіркою `result.ok`:

```js
function classifyDisposition(result) {
  if (!result) return 'fatal';
  if (result.halt === true) return 'halt';   // ← НОВЕ: свідомий стоп
  if (result.ok === true) return 'continue';
  const err = result.error || {};
  if (err.fatal === true) return 'fatal';
  if (err.file_skipped === true) return 'skip';
  return 'fatal';
}
```

**У циклі `run`** — додати гілку `halt` МІЖ merge decisions і обробкою
`ok:false`:

```js
if (disposition === 'continue') {
  continue;
}

if (disposition === 'halt') {
  // halt — свідомий стоп пайплайна стадією, не аварія. Сенс несе
  // decisions (Зона 3 «Питання»), не error. ctx.errors не чіпаємо,
  // ctx.documents лишається яким є (можливо порожнім). Стоп — щоб
  // наступні стадії (PERSIST/INDEX) не плодили фіктивних документів.
  ctx.stoppedAt = name;
  break;
}

// ok:false — фіксуємо помилку у накопичувач (вкладка Помилки DP-4).
ctx.errors = [...ctx.errors, { ...(result.error || {}), stage: result.error?.stage || name }];
…
```

**Орієнтовний обсяг:** +1 рядок у `classifyDisposition`, +5 рядків у
циклі `run`, +5 рядків коментарів = ~+10 рядків. Нічого не ламається —
існуючі стадії продовжують повертати `ok:true` / `ok:false+error` як
раніше; `halt` — додатковий шлях, не заміна.

**`finalizeResult` не змінюється:** `ok = ctx.documents.length > 0 &&
!ctx.stoppedAt`. На halt-у `stoppedAt` встановлено → результат пайплайна
`ok:false`, але `errors:[]` порожній, `decisions:[{type:'triage_whole_volume',…}]`
— UI коректно інтерпретує (див. §3.4).

### 3.2 `src/services/documentPipeline/stages/triageStage.js`

**ВАЖЛИВО (уточнено 25.05.2026 після першого виконання):** критерій
«1 doc × 100% покриття» — необхідна, але **недостатня** умова.
Бо лагідно ловить три легітимні сценарії:

1. Малий PDF (3-20 стор.) → AI коректно каже `add_as_is` на весь файл.
   Це не провал — PDF справді є одним документом.
2. Група фото → AI `image_merge` робить з них один документ. Це **дизайн
   route**, не provід.
3. `fragment_reconstruct` — збирання документа через кілька PDF в один.
   Теж **дизайн route**.

Тому функція **МУСИТЬ мати два додаткові фільтри** (інакше зламає
~11 існуючих integration-тестів і реальні happy-path сценарії адвоката):

- **Фільтр обсягу** — degenerate concern реальний тільки на томах, де
  Haiku справді здає вікно. Це той самий поріг, що й
  `RICH_PASSPORT_MAX_PAGES_DEFAULT` з §3.3 — один сенс цифри, одна
  межа «з якої точки Haiku в зоні ризику» (правило #11).
- **Фільтр route** — degenerate можливий тільки для маршрутів, де AI
  мав знайти/підтвердити межі. Для `image_merge` /
  `fragment_reconstruct` / `signature_sidecar` / `to_fragments` /
  `discard` «1 doc × 100%» — це **очікувана поведінка route**, не
  провал. Залишаємо тільки `add_as_is` і `slice`.

**Додати** експортовану чисту функцію (одразу після `resolveOverlaps`):

```js
// DEGENERATE_MIN_PAGES — той самий поріг, що RICH_PASSPORT_MAX_PAGES_DEFAULT
// у pageMarkers.js (правило #11: одна цифра — один сенс «межа якості
// Haiku вікна»). Якщо буде змінено там — синхронно змінити тут (і
// зафіксувати в звіті §9.4 grep підтвердження).
const DEGENERATE_MIN_PAGES = 70;

// DEGENERATE_ELIGIBLE_ROUTES — маршрути, де AI мав знайти/підтвердити
// межі. Для image_merge / fragment_reconstruct / signature_sidecar /
// to_fragments / discard «1 doc × 100%» — дизайн route, не провал.
const DEGENERATE_ELIGIBLE_ROUTES = new Set(['add_as_is', 'slice']);

// isDegeneratePlan — план виглядає як passthrough НА ВЕЛИКОМУ ТОМІ ДЕ
// AI МАВ ШУКАТИ МЕЖІ: рівно один документ маршруту add_as_is/slice,
// фрагменти якого покривають 100% сторінок усіх живих файлів, при
// сумарному обсязі ≥DEGENERATE_MIN_PAGES. Окрема від normalizePlan, бо
// normalize працює над raw AI-відповіддю (форма), а ця — над уже
// нормалізованим планом і живим набором файлів (семантика покриття +
// контекст обсягу + контекст маршруту).
export function isDegeneratePlan(plan, liveFiles) {
  if (!plan || plan.documents?.length !== 1) return false;
  const doc = plan.documents[0];
  if (!DEGENERATE_ELIGIBLE_ROUTES.has(doc.route)) return false;
  if (doc.fragments.length === 0) return false;
  const totalPages = liveFiles.reduce((s, f) => s + (f.pageCount || 1), 0);
  if (totalPages < DEGENERATE_MIN_PAGES) return false;
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

**Замість успішного return** з планом — перед формуванням
`reconstructionPlan` додати перевірку (новий блок, ~рядок 209, перед
блоком що повертає `{ok:true, ctx:{...}, decisions:[…document_boundaries…]}`):

```js
if (isDegeneratePlan(plan, live)) {
  // Свідомий стоп пайплайна: AI не зміг розрізнити межі, повертає тома
  // одним шматком. Це не помилка стейджу і не виняток API (для нього є
  // catch вище) — це визнання, що автоматичної відповіді немає, потрібна
  // ручна дія. Тому НЕ ok:false+error, а halt+decision: сенс несе
  // decision у Зоні 3 «Питання» через ATTENTION_TYPES. Диригент бачить
  // halt:true → break без запису у ctx.errors.
  return {
    halt: true,
    decisions: [{
      type: 'triage_whole_volume',
      scope: 'triage',
      message: 'Не вдалось визначити межі документів — том пропонується '
             + 'як один шматок. Потрібна ручна нарізка або повторний '
             + 'прогін меншими частинами.',
      meta: {
        liveFileCount: live.length,
        totalPages: live.reduce((s, f) => s + (f.pageCount || 1), 0),
      },
    }],
  };
}
```

**НЕ чіпати:** catch на 201-207 (тиха-відмова на API-помилці лишається —
це інший сценарій: API-вибух, ingest не блокуємо). `trivialImagePlan`
(одна сторінка = один документ — це **не** degenerate, бо адвокат і
очікує саме такого результату для одного фото). `normalizePlan` —
форма, не семантика.

**Контракт стадії:** жодного нового `error.code`, жодного `fatal:true`.
Halt-канал — це окрема disposition диригента, не варіант помилки.

### 3.3 `src/services/documentPipeline/pageMarkers.js`

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

### 3.4 `src/components/DocumentProcessorV2/index.jsx`

**Єдина зміна** — додати `'triage_whole_volume'` до `ATTENTION_TYPES`
(рядок ~255):

```js
const ATTENTION_TYPES = [
  'text_clean_failed',
  'document_split_skipped',
  'duplicate_skipped',
  'duplicate_review',
  'triage_whole_volume',   // ← НОВЕ: свідомий halt Triage, не помилка
];
```

**Усе.** Жодних `NEUTRAL_ERROR_CODES`. Жодного розщеплення `errors` на
`neutralErrors`/`hardErrors`. `attentionDecisions.filter(...
ATTENTION_TYPES.includes(d.type))` уже бере decision у Зону 3 «Питання»
і рендерить через `dpv2-attention-card` без `--error` — рівно те, що
треба.

`errors[]` у пайплайн-результаті порожній на цьому шляху (halt не пише в
`ctx.errors`), тож блок «Помилки» покаже «Помилок немає» автоматично.

### 3.5 Перевірка інших споживачів `classifyDisposition`

Grep на `classifyDisposition`, `disposition ===`, `'fatal'`, `'skip'`,
`'continue'` у `src/` і `tests/`. Якщо є інші місця, що роблять
exhaustive-match на enum disposition — додати ручку `halt` (early
return на «свідомий стоп без помилок»). Очікувано таких місць немає —
disposition внутрішня кухня диригента — але перевірити обов'язково.

---

## 4. ТЕСТИ (обов'язково перед merge)

### 4.1 Unit — `tests/unit/triageStage.test.js` (новий файл)

- `isDegeneratePlan` на синтетичних планах **(сітка покриває обидва нові фільтри)**:
  - 1 файл **80 стор.**, `route:'add_as_is'`, `[{fragments:[{1,80}]}]` → **true**.
  - 1 файл **80 стор.**, `route:'slice'`, `[{fragments:[{1,80}]}]` → **true**.
  - **Фільтр обсягу (Q1):** 1 файл **3 стор.**, `route:'add_as_is'`, `[{fragments:[{1,3}]}]` → **false** (нижче DEGENERATE_MIN_PAGES=70 — це happy-path малого PDF).
  - **Фільтр обсягу:** 1 файл **69 стор.**, `route:'add_as_is'` → **false** (на самій межі — нижче ще не ловимо).
  - **Фільтр route (Q2):** 1 файл 100 стор., `route:'image_merge'`, `[{fragments:[{1,100}]}]` → **false** (image_merge — дизайн route).
  - **Фільтр route:** 1 файл 100 стор., `route:'fragment_reconstruct'` → **false** (дизайн route).
  - **Фільтр route:** план з `{route:'discard'}` → **false** (службовий).
  - 1 файл 100 стор., `route:'add_as_is'`, план `[{fragments:[{1,60}]}, {fragments:[{61,100}]}]` → **false** (два документи — не degenerate).
  - 2 файли по 50 стор. (total 100), `route:'add_as_is'`, план `[{fragments:[{file1,1,50},{file2,1,50}]}]` → **true** (multi-file passthrough на великому сумарному обсязі).
  - 2 файли по 50 стор., план з 1 документа що покриває тільки file1 → **false**.
  - План з 0 документів → **false**.
- `_setRichPassportMaxPages(50)` / `richMaxPages()` round-trip.
- **Симетрія порогів:** окремий тест-нагадувач, що `DEGENERATE_MIN_PAGES`
  у `triageStage.js` дорівнює `RICH_PASSPORT_MAX_PAGES_DEFAULT` у
  `pageMarkers.js` (правило #11 — одна цифра один сенс; якщо зміниться
  одна — впаде цей тест як reminder синхронно змінити іншу).

### 4.2 Unit — `tests/unit/documentPipelineDisposition.test.js` (новий)

- `classifyDisposition({halt:true})` → `'halt'`.
- `classifyDisposition({halt:true, ok:false})` → `'halt'` (halt вище ok).
- `classifyDisposition({ok:true})` → `'continue'` (regression).
- `classifyDisposition({ok:false, error:{fatal:true}})` → `'fatal'` (regression).
- `classifyDisposition({ok:false, error:{file_skipped:true}})` → `'skip'` (regression).
- `classifyDisposition({ok:false})` → `'fatal'` (інваріант, regression).

### 4.3 Integration — `tests/integration/triage_degenerate_plan.test.js` (новий)

Прогін через справжній `createDocumentPipeline` з стабом triage:

- Стаб `triage` повертає degenerate raw → результат пайплайна:
  - `result.errors` порожній;
  - `result.decisions` містить `{type:'triage_whole_volume', scope:'triage', message:/не вдалось визначити межі/i}`;
  - `result.stoppedAt === 'detectBoundaries'`;
  - `result.documents` порожній (PERSIST не виконався);
  - `result.ok === false` (бо `documents.length===0` AND `stoppedAt`).
- Стаб `triage` повертає 2-документний нормальний план → `{ok:true,
  documents:[…], errors:[], stoppedAt:null}` (regression).
- Стаб `triage` кидає виняток → catch-passthrough як раніше:
  `{ok:false, errors:[], stoppedAt:null}` (regression; catch у triageStage
  повертає `{ok:true}` з warning'ами у files).
- `trivialImagePlan` (1 image, 1 page) → `{ok:true}` (НЕ degenerate).

### 4.4 UI — `triage_whole_volume` у «Питання»

В наявних інтеграційних тестах DocumentProcessorV2 (або новому
snapshot-тесті, якщо є інфраструктура) перевірити, що при

```js
result = {
  errors: [],
  decisions: [{ type:'triage_whole_volume', message:'…', scope:'triage' }],
  documents: [],
  stoppedAt: 'detectBoundaries',
};
```

- блок «Питання» містить це повідомлення;
- блок «Помилки» порожній («Помилок немає»).

Перед merge — `npm test` повністю зелений.

---

## 5. SAAS IMPLICATIONS

- Жодних змін у `tenants[]`, `users[]`, `permissions`, `caseAccess[]`.
- `tenantId` / `ownerId` нових сутностей не з'являється — TASK не
  створює нових структур даних.
- Multi-user readiness: `decision.type === 'triage_whole_volume'`
  стабільний enum, не залежить від ролі — UI однаково ховатиме його у
  «Питання» для всіх tenant types (solo / bureau / association / firm)
  через те, що `ATTENTION_TYPES` — глобальний компонентний список.
- Не порушує SaaS isolation: decision лишається в межах jobу (того
  самого `caseId`), нічого не пишеться поза tenant scope.
- Disposition `halt` доступна всім майбутнім стадіям у TASK C/D
  (наприклад, «користувач відмінив на confirmBoundaries», «дублікат
  виявлений на dedup-стадії» — той самий механізм без розширення
  типу помилки).

## 6. BILLING IMPLICATIONS

- Triage `activityTracker.report('agent_call', {agentType:'triage_agent'})`
  спрацьовує **до** detection degenerate plan — токени Haiku вже спалені,
  `ai_usage[]` має штатний запис. Це коректно: AI відпрацював, час
  адвоката на чекання теж витрачено.
- `time_entries[]` для адвоката: запис категорії `case_work` triggered
  через `module_navigation` в Document Processor лишається — адвокат
  справді працював з модулем.
- PERSIST стадія не запускається (halt → break) → `add_documents` ACTION
  не викликається → НЕ створюється фіктивний billing-запис на «успішну
  нарізку», якої не було.
- Жодних нових ACTIONS, жодних змін `SYSTEM_ACTIONS_NO_BILLING` /
  `EDIT_ACTIONS_SOURCE_AWARE`.
- `halt` сам по собі не білінговий-релевантний (це інфраструктура
  диригента, не дія адвоката і не AI-виклик).

---

## 7. ЗАБОРОНЕНО (в межах цього TASK)

- НЕ додавати UI-перемикач для `_setRichPassportMaxPages` (це
  тестовий/калібровочний hook, не feature).
- НЕ повертати `RICH_PASSPORT_MAX_PAGES=100` назад без явного TASK з
  валідаційними даними протилежного знаку.
- НЕ робити degenerate detection «м'яким попередженням» що пропускає
  пайплайн далі — це повертає той самий тихий fallback, тільки з
  warning'ом замість halt'а.
- НЕ створювати `error.code='TRIAGE_NEEDS_MANUAL_SPLIT'` / `error.fatal`
  / `error.halt` — degenerate plan це **halt+decision**, не помилка
  жодного ґатунку. Якщо у звіті/коментарях побачите слова «error code
  для цього випадку» — це повернення до відхиленого варіанту B.
- НЕ створювати `NEUTRAL_ERROR_CODES` / `neutralErrors` / `hardErrors`
  у компоненті — варіант B відхилений. UI-канал = `ATTENTION_TYPES`
  з типом decision.
- НЕ нашаровувати halt на `error.fatal` через прапор (`error.halt=true`,
  `error.severity='neutral'`) — disposition окрема, не атрибут помилки.
  Правило #11.
- НЕ розширювати `ATTENTION_TYPES` випадковими новими типами без
  спеку — список це контракт між стадіями і UI, не вільний enum.
- НЕ змінювати лексику decision на «помилку», «збій», «вибачте» —
  адвокату це не помилка системи, це **запит на ручну дію**.
- НЕ використовувати disposition `halt` для прихованих фіналізацій
  (наприклад, «вдало завершили, але без документів» — це справжній
  `ok:true` з порожнім `documents`, не halt). Halt = «стадія сама
  вирішила, що подальші стадії не мають сенсу».
- НЕ прибирати фільтр обсягу (`DEGENERATE_MIN_PAGES`) і фільтр route
  (`DEGENERATE_ELIGIBLE_ROUTES`) з `isDegeneratePlan` навіть якщо тести
  «здаються надлишковими». Перша версія спеки (без них) ламала
  ~11 integration-тестів на легітимних happy-path сценаріях (малий PDF,
  image_merge, fragment_reconstruct). Це і є корінь — критерій
  «1 doc × 100%» **необхідний, але не достатній**.

---

## 8. НЕ ЗЛАМАТИ НАЯВНЕ (вимога регресійної дисципліни)

**Прецеденти:** у попередніх TASK після виконання ламались Матеріали
справи, в'юер сканів/тексту, окремі гілки робочого пайплайна. Корінь —
не якась одна помилка, а недогляд за **косвеними ефектами** змін
(стейдж торкає shared utility → ламається сусідній споживач; зміна
підпису функції → інший виклик мовчки повертає `undefined`; правка UI-
константи → інший компонент губить рендер).

**Цей TASK торкає три зони з високим ризиком регресу:**

1. **Диригент `documentPipeline.js`** — додавання disposition `halt`
   йде в hot-path кожного прогону. Зламана `classifyDisposition` =
   зламані ВСІ стадії, не тільки triage.
2. **`triageStage.js`** — це активний слот `DETECT_BOUNDARIES` для
   всіх томів, включно з тими де AI повертає нормальний план.
3. **`pageMarkers.js`** — `resolveBoundaryText` ходить у Triage кожного
   прогону; зміна порогу зачіпає характеристику паспорта для томів
   70-100 стор. (раніше rich, тепер стартовий).
4. **`DocumentProcessorV2/index.jsx`** — `ATTENTION_TYPES` читається в
   двох місцях (фільтр і лічильник); пропустити одне = розсинхрон UI.

**Що ОБОВ'ЯЗКОВО зробити під час виконання (не після — на кожному кроці):**

- **Перед першою зміною** — `npm test` і зафіксувати число pass/fail
  як baseline. Після кожного логічного кроку (нова функція, новий
  ALL CAPS константа, нова гілка disposition) — повторний прогон. Будь-
  яке падіння testу, що раніше був зеленим = регрес, **зупинитись і
  розібратись** до коріння (не глушити, не апдейтити snapshot, не
  додавати skip).

- **Disposition `halt` — exhaustive grep**:
  - `grep -rn "classifyDisposition\|disposition ===\|'continue'\|'fatal'\|'skip'" src/ tests/`
  - Кожне знайдене місце — або не торкається enum, або має нову гілку
    для `'halt'`. У звіті §9.4 окремо перелічити: «перевірено N місць,
    змін у K із них».

- **Triage normal-path regression**: інтеграційний тест з нормальним
  2-документним планом (§4.3) — зелений ДО і ПІСЛЯ змін. Якщо до
  цього TASK такого тесту не було — додати ПЕРЕД будь-якою зміною
  triageStage, побачити green, потім вже редагувати стейдж.

- **`addDocuments`/PERSIST не виконується на halt** — окремо перевірити
  spy/мок'ом у тесті: `expect(addDocsSpy).not.toHaveBeenCalled()` при
  degenerate plan. Інакше можливий тихий регрес «halt оголошено, але
  PERSIST все одно йде через інший шлях».

- **Матеріали справи (`CaseDossier` Documents tab) і в'юер
  сканів/тексту** — НЕ модифікувати в цьому TASK. Якщо при roзеленні
  тестів спливає падіння тесту з цих модулів, це означає, що
  непрямий вплив таки є — **зупинитись, не патчити поверхово**,
  написати в звіт §9.4 з кореневою діагностикою і узгодити окремо.

- **`buildCompactTriagePassport` / `buildStructuralPassport` /
  `buildPagedText` / `isPagedLayout`** — НЕ чіпати їхні підписи й
  поведінку. Зниження порогу — лише в `passportOptsForBudget` (через
  `richMaxPages()`), а не в самих функціях.

- **`normalizePlan` НЕ ЧІПАТИ.** Degenerate detection живе ЗОВНІ
  `normalizePlan` (§3.2). Будь-який сторонній фікс `normalizePlan`
  («заодно», «помітив дублікат») у цьому TASK заборонений → окремий
  TASK.

- **Білдка локально**: `npm run build` перед коммітом. Vite/Rollup мовчки
  не толерують крайні випадки (export missing, cyclic import) — тесть
  Vitest їх не завжди ловить.

- **Sanity manual smoke** (якщо є локальний прогон з реальним registry):
  - відкрити Документ Процесор v2, перетягнути малий файл (PDF з
    текстовим шаром, 1-2 стор.) — має пройти штатно, як до TASK;
  - відкрити в'юер у Матеріалах справи на наявному документі — НЕ
    лагає, тексти/скани показуються як раніше;
  - перевірити що Зона 3 «Питання» рендериться навіть коли вона
    порожня (текст «Питань немає.»).

**Принцип:** якщо в процесі виконання спливає **будь-який** симптом
поза прямою зоною змін — це сигнал зупинки, не patch-and-move-on. Звіт
§9.4 має бути чесним: краще «знайшов потенційний регрес X, відкладено
до окремого TASK, тут не патчив» ніж тихий шов.

---

## 9. ЗВІТ (обов'язково ПІСЛЯ виконання)

Після завершення TASK (код у main, тести зелені) **обов'язково**
написати звіт і покласти в репо:

- **Шлях:** `docs/reports/report_task_smart_triage_degenerate_plan_neutral_stop.md`
- **Включає:**
  1. **Що зроблено** — перелік файлів зі змінами (file_path:line_number).
     Окремо виділити **нову disposition `halt`** у диригенті як
     інфраструктурний внесок, корисний для TASK C/D.
  2. **Як перевірено** — список нових тестів, результат `npm test`
     (число pass/fail), окремо — regression-тести на 3 наявні
     disposition (continue/fatal/skip).
  3. **Поведінка до/після** — короткий before/after на синтетичному
     degenerate сценарії: який shape повертає `pipeline.run`, що бачить
     адвокат у Зоні 3.
  4. **Знайдені побічні баги** (якщо є) → окремо в
     `docs/bugs/bugs_found_during_smart_triage_neutral_stop.md` +
     рядок у `tracking_debt.md` якщо не виправляли в межах цього TASK.
  5. **Оновлення `ARCHITECTURE_HISTORY.md`** — один запис у хронологію
     TASK'ів (дата, гілка, summary, лінк на цей спек і на звіт).
     Окремо зафіксувати disposition `halt` як новий первинний контракт
     диригента — щоб майбутні TASK мали посилання.
  6. **Відкриті питання / спостереження** — якщо поріг 70 теж виявиться
     завеликим, або degenerate detection пропускає крайові випадки —
     зафіксувати для наступної ітерації.
  7. **Регресійна дисципліна (звіт по §8)** — обов'язково: baseline
     pass/fail ДО змін; усі прогони `npm test` між кроками; результат
     `npm run build`; результат manual smoke (Документ Процесор v2 на
     малому файлі + в'юер Матеріалів справи); список перевірених місць
     по grep-у на disposition enum; будь-які знайдені непрямі симптоми
     (навіть якщо НЕ патчили — особливо тоді).
- Звіт пишеться **після** push у main (або після підтвердження адвоката
  на code-merge, якщо TASK закінчився на гілці `claude/*`).

---

**Кінець TASK.**
