# CONTEXT — Передавальний файл для сесії розширення `legal-bms-extension`

> **Архівний документ, створений в репо `vadymlevyt/registry`.** Призначений
> до ручного перенесення у репо `vadymlevyt/legal-bms-extension`
> (`~/Documents/GitHub/legal-bms-extension/` на iMac). Нова сесія Claude Code,
> що працюватиме над розширенням, читає цей файл **першим**.

---

## 1. ПРИЗНАЧЕННЯ ФАЙЛУ

Це передавальний контекст. Він дає повну картину: чому розширення існує, як
воно інтегрується з Legal BMS, який API вже готовий його прийняти, яку логіку
обходу треба перенести в код, і з чого почати (Етап 0 — каркас).

Усе нижче зведено з реального коду в `registry` (з посиланнями на файли) +
зі знахідок полігону. Принцип проекту: **не вигадувати — або з джерела, або
чесне «не знаю, треба перевірити»**. Якщо в цьому файлі чогось немає — це
перевіряється в коді `registry` або питанням адвокату, не домислюється.

---

## 2. КОНТЕКСТ ПРОЕКТУ

- **Адвокат:** Левицький Вадим Андрійович — практикуючий адвокат, **не
  програміст**. Стратегію й архітектуру веде в чаті; код пише Claude Code.
- **Legal BMS** (кодова назва Registry v3, репо `vadymlevyt/registry`) —
  операційна система адвоката-практика для ведення судових справ з вбудованим
  AI. Стек: **React 18 + Vite 6 + ES modules**. Хостинг: **GitHub Pages** —
  `https://vadymlevyt.github.io/registry/`. Сховище даних: **Google Drive**
  (`registry_data.json`). Дані живуть у Drive, не в БД.
- **Робоча мова — українська** (код, коментарі, TASK, звіти, спілкування).
- **Розширення — частина модуля Court Sync** (синхронізація з кабінетом ЄСІТС
  `cabinet.court.gov.ua`). Це не окремий продукт, а робочий інструмент одного
  модуля Legal BMS.

---

## 3. ВЗАЄМОЗВ'ЯЗОК TRACK A ↔ TRACK B

Модуль Court Sync розвивається у двох гілках:

- **Track A — полігон.** Claude for Chrome (AI-агент у браузері) обходить
  кабінет ЄСІТС за промптом, який адвокат копіює з Legal BMS і вставляє в
  sidebar. На полігоні **відточуємо** алгоритми обходу: фільтри, визначення
  активності, дедуплікацію, точку рішення, структуру даних, UX. **Не для
  щоденної роботи.**
- **Track B — продукт (це розширення).** Власне Chrome-розширення —
  **детермінований код**. Робочий інструмент майбутнього.

**Стратегія:** логіка з Track A → переноситься у код Track B.

**Чому розширення фундаментально необхідне** (Track A довів свої межі —
це зафіксована знахідка, не думка):

1. **Природа чату блокує проміжне збереження.** Модель «повідомлення →
   відповідь». Щоб виписати проміжний результат, треба завершити повідомлення =
   чекати реакції. Тому агент відкладає проміжні журнали до кінця обходу.
2. **Compacting** (стиснення робочої пам'яті при довгому обході) **стирає
   деталі в `null` АБО провокує галюцинацію.** Коли агента примушують дати
   значення зі стертого — він реконструює = вигадує (помилка в по-батькові →
   справа потрапить не до того клієнта).
3. **Ліміти токенів** Claude for Chrome перебивають довгі обходи.

Робочий метод Track A зараз (єдиний надійний): **порції по 4 справи + зупинка
з питанням «продовжувати?» + фінал зі звірки журналів-повідомлень.** Це ручна
імітація того, що **код розширення робитиме природно**: пише дані одразу після
кожної справи, без compacting і без природи чату. Розширення усуває корінь усіх
трьох проблем.

---

## 4. ВІДТОЧЕНА ЛОГІКА ОБХОДУ (для перенесення в код Track B)

Уся ця логіка вже реалізована як інструкції промпту в
`registry/src/services/ecits/promptBuilder.js` (а похідні функції — як
експортований код). У Track B вона стає **детермінованим кодом content-script
кабінету (Етап 1+)**, не промптом.

### 4.1. Фільтр за роком (у списку, до заходу в справу)

- Рік = цифри після **другого** слешу в `case_no` (формат `NNN/NNNNN/NN[-X]`).
- MVP бере тільки роки **25 і 26**. Приклади: `450/2275/25`→25 (беремо),
  `367/4744/26`→26 (беремо), `761/15469/20-ц`→20 (пропуск), `528/1522/24`→24
  (пропуск).
- Готові функції в коді: `extractYearFromCaseNo(caseNo)` і
  `isAcceptedCaseYear(caseNo)` — **експортовані з `promptBuilder.js`**, можна
  перенести 1:1 у розширення.

### 4.2. Фільтр за роллю (колонка «Мій процесуальний статус»)

- **Пропускаємо** справу якщо роль — рівно одне слово **«Представник»** без
  уточнення (підтягнута через довіреність на клієнта-сторону, адвокат не
  учасник). → у `skipped` з reason про довіреність.
- **Беремо** будь-яку конкретну роль: «Адвокат», «Захисник», «Представник
  позивача/відповідача/заявника/потерпілого/скаржника/третьої особи» і будь-яке
  їх поєднання.
- Заходимо у справу тільки якщо пройшла **обидва** фільтри.

### 4.3. Перевірка активності (на вході у справу)

- **Рік 26** → справа свіжа, **беремо завжди** (засідань 2026 може ще не бути).
- **Рік 25** → беремо **ТІЛЬКИ якщо є хоча б одне засідання 2026** (будь-яка
  інстанція — перша/апеляція/касація; **інстанція не має значення**). Немає
  засідань 2026 → `skipped` (неактивна), реквізити НЕ витягуємо.
- Сенс: не переповнювати контекст обходом завершених справ.

### 4.4. Точка рішення — кримінальні з кількома обвинуваченими

- Якщо в кримінальній (`category: criminal`, роль «Захисник») кілька
  обвинувачених і **не зрозуміло кого захищає Левицький** — **НЕ вгадувати
  прізвище**. Засідання все одно витягти. `primaryParty` тимчасово = `case_no`.
- Агент **не перериває обхід** заради питання — збирає всі неоднозначності й
  подає адвокату **одним списком наприкінці**, чекає одну відповідь.
- У Track B це стане **формою з галочками в popup** (Етап 4), не текстовим
  діалогом.

### 4.5. Дедуплікація засідань

- **Одна дата = одне засідання**, навіть якщо прийшло кілька повісток на ту саму
  дату. Перед додаванням перевірити чи дата вже є у списку справи.
- Джерело дат: спершу «Внесення дат слухання» (структуровано), окремі повістки —
  тільки якщо там дати немає.

### 4.6. Мапінг `primaryParty` за роллю адвоката

- Представник позивача→позивач; відповідача→відповідач; заявника→заявник;
  потерпілого→потерпілий; скаржника→скаржник; третьої особи→третя особа;
  «Адвокат»→визначити з «Інформація про справу»; «Захисник»→підзахисний;
  поєднання→перша конкретна роль.
- Формат: `«Прізвище І.П.»`. Юрособи (ТОВ/ПП/ФОП/АТ) → повна назва без скорочення.

### 4.7. `category` за літерою в `case_no`

- `ц`→`civil`, `к`→`criminal`, `а`→`administrative`, `г`/`м`→`civil`; немає
  літери → визначити з типу провадження.

### 4.8. `advocateRole` enum

- `plaintiff_rep` | `defendant_rep` | `third_party_rep` | `defender`.

**Файли-джерела:** `registry/src/services/ecits/promptBuilder.js` (уся логіка
як інструкції + функції року), `registry/src/services/ecits/scenarioProcessor.js`
(обробка результату), `registry/tests/unit/promptBuilder.test.js` (тести
функцій року), `registry/tests/unit/scenarioProcessor.test.js`.

---

## 5. `window.LegalBMS` API — КРИТИЧНО ДЛЯ РОЗШИРЕННЯ

Найважливіший розділ. Без нього каркас не зробити.

### 5.1. Де визначений

`registry/src/services/extensionBridge.js`. Об'єкт `window.LegalBMS` ставиться
на **сторінці SPA** (`https://vadymlevyt.github.io/registry/`) у функції
`enable()`. Lifecycle:

- `configure(deps)` — App.jsx викликає кожен render (свіжі залежності).
- `enable()` — App.jsx викликає **один раз ПІСЛЯ hydration з Drive**
  (`registry/src/App.jsx`, виклик `extensionBridge.enable()`). До `enable()`
  `window.LegalBMS` **не існує**.
- При `enable()` емітиться DOM-подія `legalbms:ready` на `document` з
  `detail: { apiLevel, version }`.

`apiLevel` (зараз `1`) і `version` (`'1.0.0'`) — для перевірки сумісності.
`apiLevel` зростатиме при breaking-зміні форми API.

### 5.2. Методи (точні сигнатури з коду)

```javascript
window.LegalBMS = {
  apiLevel: 1,                 // number — версія контракту API
  version: '1.0.0',            // string
  isReady: true,               // boolean

  // Проміс, що резолвиться коли bridge активний (після hydration).
  whenReady: () => Promise<void>,

  // Головний метод: передати envelope з ЄСІТС у Legal BMS на обробку.
  // Усередині форсить transport:'extension'. Повертає результат
  // scenarioProcessor: { scenarioRunId, casesCreated, casesUpdated,
  //   hearingsAdded, skipped, errors, warnings }.
  submitScenarioResult: async (envelope) => Promise<Result>,

  // Підписка на подію eventBus. Повертає функцію відписки.
  // event — рядок-топік (див. §6.4). handler — (payload) => void.
  on: (event, handler) => (function unsubscribe),

  // Зріз entitlements для розширення (НЕ sensitive дані).
  // Повертає: { ecits: { enabled, scenarios, trialMode, expiresAt },
  //             documents: {...}, canvas: {...} }.
  getEntitlements: () => object,
};
```

> `registerExtension(...)` **НЕ закладено** (YAGNI, tracking_debt #ext-1).
> Handshake-провенанс розширення вводити лише за реальної потреби.

**Безпека API:** bridge віддає тільки явні методи. Жодних токенів, жодного
прямого доступу до `cases[]` чи state. Розширення взаємодіє виключно через ці
методи (`extensionBridge.js`, коментар угорі файла).

### 5.3. ⚠️ КЛЮЧОВИЙ НЮАНС CHROME — ізольований світ vs MAIN world

`window.LegalBMS` живе у **page context** сторінки SPA. **Content-script за
замовчуванням працює в ISOLATED world** — він бачить DOM, але **НЕ бачить
`window.LegalBMS`** (це об'єкт JS сторінки, не DOM).

Тому:
- **DOM-подію `legalbms:ready` content-script ЧУЄ** (події DOM спільні).
- **Методи `window.LegalBMS` напряму викликати НЕ може** з isolated world.

Рішення (обрати в Етапі 0): оголосити content-script на сторінці Legal BMS з
**`"world": "MAIN"`** у manifest v3 (тоді він у page context і бачить
`window.LegalBMS`, але має обмежений доступ до `chrome.*`), **АБО** інжектити
окремий page-script у MAIN world і спілкуватися назад через
`window.postMessage` / `CustomEvent`. Дані до background — через
`chrome.runtime.sendMessage`.

### 5.4. Архітектура двох вкладок (важливо розуміти з початку)

Кабінет ЄСІТС і Legal BMS — це **різні вкладки/origin**:
- Content-script на `cabinet.court.gov.ua` робить **обхід** (Етап 1+).
- Content-script на `vadymlevyt.github.io/registry` має **доступ до
  `window.LegalBMS`** і викликає `submitScenarioResult`.
- **`background.js` (service worker) — координатор** між цими двома
  content-script'ами.

Потік даних робочого розширення: cabinet-script збирає envelope → шле в
background → background релеїть у legal-bms-script на вкладці Legal BMS →
той викликає `window.LegalBMS.submitScenarioResult(envelope)`.

### 5.5. Приклад handshake (для Етапу 0)

Page-script у MAIN world на сторінці Legal BMS:

```javascript
// legal-bms-page.js — інжектиться в MAIN world сторінки vadymlevyt.github.io/registry
(function () {
  function announce(api) {
    const entitlements = api.getEntitlements();
    // Назад у isolated world / background — через DOM CustomEvent або postMessage:
    document.dispatchEvent(new CustomEvent('legalbms-ext:handshake', {
      detail: { apiLevel: api.apiLevel, version: api.version, entitlements },
    }));
  }

  if (window.LegalBMS && window.LegalBMS.isReady) {
    window.LegalBMS.whenReady().then(() => announce(window.LegalBMS));
  } else {
    // Bridge ще не активний (Drive не під'єднано / hydration не завершено).
    document.addEventListener('legalbms:ready', () => {
      window.LegalBMS.whenReady().then(() => announce(window.LegalBMS));
    }, { once: true });
  }
})();
```

Content-script (isolated world) слухає `legalbms-ext:handshake` на `document`,
пересилає `detail` у background через `chrome.runtime.sendMessage`. Для відправки
envelope — зворотний шлях: background → content-script → CustomEvent у MAIN-script
→ `window.LegalBMS.submitScenarioResult(envelope)` → результат назад тим же
ланцюгом.

---

## 6. ENVELOPE ФОРМАТ І SCENARIOPROCESSOR

### 6.1. Точна структура envelope (контракт)

Константи: `SCENARIO_ID='ecits_import_cases_and_hearings'`, `SCENARIO_VERSION=1`,
`ENVELOPE_VERSION=1` (експортовані з `promptBuilder.js`).

```json
{
  "envelopeVersion": 1,
  "scenarioId": "ecits_import_cases_and_hearings",
  "scenarioVersion": 1,
  "producedAt": "<ISO datetime>",
  "producedBy": { "provider": "chrome_extension", "providerVersion": "<версія розширення>" },
  "data": {
    "ecitsAdvocate": { "fullName": "Левицький Вадим Андрійович", "cabinetIdentifier": null },
    "stats": { "totalCasesInCabinet": 50, "filtered": 11, "withHearings2026": 7 },
    "cases": [
      {
        "ecitsCaseId": "<32-hex з URL /cases/case=<hex>>",
        "case_no": "NNN/NNNNN/NN[-X]",
        "court": "...",
        "category": "civil|criminal|administrative",
        "advocateRole": "plaintiff_rep|defendant_rep|third_party_rep|defender",
        "primaryParty": "Прізвище І.П.",
        "primaryPartyFullName": "Прізвище Ім'я По-батькові",
        "cabinetUrl": "https://cabinet.court.gov.ua/...",
        "hearings": [
          {
            "date": "2026-05-25", "time": "08:50", "court": "...",
            "hearingRoom": "336", "proceedingNumber": "6-392/26",
            "cabinetUrl": "https://cabinet.court.gov.ua/...",
            "noticeType": "Судова повістка про виклик в суд"
          }
        ]
      }
    ],
    "warnings": ["рядок", "рядок"],
    "skipped": [ { "case_no": "...", "reason": "..." } ]
  }
}
```

**КРИТИЧНІ ВИМОГИ (інакше імпорт падає):**
- `warnings` — масив **РЯДКІВ**, НЕ об'єктів. Об'єкт `{case_no, message}`
  спричиняє **React error #31** → модуль падає в заглушку «Модуль тимчасово
  недоступний». case_no вшивати в текст рядка.
- `validateEnvelope` (у `scenarioProcessor.js`) вимагає: `envelopeVersion===1`,
  `scenarioId==='ecits_import_cases_and_hearings'`, наявність `data` і
  `data.cases` як масиву. Інакше кидає Error.
- **Перевага розширення:** воно має видавати готовий 100%-сумісний envelope
  **без ручного переобгортання** (Track A цим страждає — Claude for Chrome
  часто видає неповну структуру; це лагодиться окремо в Track A через TASK 0.4.5).

### 6.2. Дедуплікація справ — за `case_no` (рішення, ще не в коді)

- **У коді зараз** дедуп за `ecitsState.caseId` (32-hex):
  `scenarioProcessor.js` шукає `getCases().find(c => c?.ecitsState?.caseId ===
  ecitsCase.ecitsCaseId)`; `create_case` має дзеркальну перевірку.
- **Зафіксоване рішення (адвокат, доменний експерт):** дедуплікувати **за
  номером справи `case_no`** — він унікальний, постійний, і **всі провадження
  (апеляція/касація) живуть під одним номером справи**. 32-hex код — це радше
  ідентифікатор **провадження/картки в кабінеті**, не справи; його лишають як
  посилання на джерело, не як ключ дедупу. **Засторога:** `case_no` перед
  порівнянням нормалізувати (пробіли, суфікс `-ц`, регістр, розділювачі).
- **Для розширення:** надійно видавати коректний `case_no` для **кожної** справи
  — це майбутній ключ дедупу. ЄСІТС-код теж віддавати (як посилання на
  провадження).

### 6.3. Підсумок діагностики `update_case_ecits_state`

Повний звіт: `registry/docs/diagnostics/report_diagnostic_ecits_state.md`.

- **Не зайвий, але не ключ дедупу.** `ecitsState` тримає посилання на джерело +
  sync-метадані. Дедуп тримається на ключі (`caseId` зараз → `case_no` за
  рішенням), що ставиться при **створенні**, не цим ACTION. Тому навіть коли
  `update_case_ecits_state` падає — дублів не виникає.
- **Знайдений баг (BUG-1):** read-after-write через **заморожений снапшот**.
  Читання справ іде через `getCases: () => cases` (immutable-снапшот рендеру), а
  записи — через `setCases(prev=>…)` у живий стан. Усередині одного прогону
  читання не бачить записів → `update_case_ecits_state failed: Справу X не
  знайдено`. Тести маскують дефект (мутабельний масив).
- **Рекомендація:** Варіант B — лагодити read-канал (читати живий стан),
  паралельно перевести дедуп на нормалізований `case_no`. Це робота Track A
  (адмін-сесії), **розширення її не торкається**.

### 6.4. Події eventBus (для `window.LegalBMS.on`)

Топіки — у `registry/src/services/eventBusTopics.js`. Релевантний для
розширення: `ECITS_SUBMISSION_COMPLETED = 'ecits.submission_completed'`.
`eventBus.subscribe(eventName, handler)` повертає функцію відписки; `on()`
це дзеркалить. **Увага:** більшість ЄСІТС-топіків зараз **без publisher'ів**
(інфраструктура констант) — не покладатися на події як на гарантований сигнал
у Етапі 0; основний канал — `submitScenarioResult` + його returned-результат.

### 6.5. Поточні відомі обмеження

- **Засідання без часу відхиляються.** `scenarioProcessor` пропускає засідання
  з відсутніми `date`/`time` (`hearing skipped: missing date/time`). Знахідка
  полігону: такі дати часто з **протоколів**; пропозиція — брати дати лише з
  повісток/«Внесення дат слухання». Відкрите питання, рішення за адвокатом.
- **scenarioProcessor НЕ викликає `mark_synced_from_ecits`** → `syncMetrics`
  лічильники не інкрементуються (tracking_debt). Не впливає на розширення.

---

## 7. ПЕРШЕ ЗАВДАННЯ НОВОЇ СЕСІЇ — ЕТАП 0 (КАРКАС)

Мета Етапу 0: **handshake + скелет**, ще БЕЗ обходу кабінету. Перевірити, що
розширення встановлюється, бачить `window.LegalBMS` на вкладці Legal BMS,
зчитує entitlements, показує статус у popup.

### 7.1. Що зробити

- **`manifest.json`** (Manifest v3):
  - `manifest_version: 3`, `name`, `version`, `description`.
  - `permissions`: щонайменше `storage`, `scripting` (за потреби `activeTab`).
  - `host_permissions`: `https://cabinet.court.gov.ua/*`,
    `https://vadymlevyt.github.io/*`.
  - `background`: `{ "service_worker": "background.js", "type": "module" }`.
  - `content_scripts`: матч `https://vadymlevyt.github.io/registry/*` →
    `content-scripts/legal-bms.js`. Передбачити доступ до `window.LegalBMS`
    (через `"world": "MAIN"` або інжекцію page-script — див. §5.3).
  - `action`: `{ "default_popup": "popup/popup.html" }`.
- **`background.js`** — service worker, координатор. У Етапі 0: приймає
  handshake-повідомлення від content-script, тримає стан (ready? entitlements?),
  відповідає popup'у.
- **`content-scripts/legal-bms.js`** — handshake через `window.LegalBMS`:
  дочекатись `whenReady()` (або `legalbms:ready`), зчитати `apiLevel/version/
  getEntitlements()`, переслати в background (див. приклад §5.5).
- **`popup/`** (`popup.html` + `popup.js` + мінімальний стиль) — скелет UI:
  показати «Legal BMS підключено: так/ні», `apiLevel`, чи `ecits` enabled.
  Кнопка-заглушка (ще без обходу).
- **`package.json`** — мінімальні залежності (лінтер/збірник за потреби; для
  чистого MV3 можна без bundler на старті).
- **`README.md`** — опис проекту, зв'язок з Legal BMS, як завантажити unpacked
  у Chrome (developer mode), що таке Етап 0.

### 7.2. Етап 0 НЕ включає

- Обхід кабінету ЄСІТС — це **Етап 1** (потребує дослідження селекторів).
- UI вибору обсягу (одна/кілька/всі + період) — **Етап 4**.
- Логіку фільтрації справ — **Етап 2**.
- Реальну відправку envelope — мінімально можна заглушку, повний потік — Етап 3.

### 7.3. Подальші етапи (орієнтир)

Етап 1 — обхід однієї справи (content-script `ecits-cabinet.js`, перевірка
крихкості селекторів) → Етап 2 — список з фільтрами (§4.1–4.2) → Етап 3 —
handshake + submit (повний потік двох вкладок) → Етап 4 — popup UI (вибір
обсягу, форма точки рішення з галочками) → Етап 5 — публікація.

---

## 8. СТАНДАРТИ РОЗРОБКИ (з `registry/DEVELOPMENT_PHILOSOPHY.md`)

### 8.1. Сім принципів (для цього репо)

1. **AI-first.** Кожна дія доступна і через UI, і через агента/API. Дані
   структуровані для парсингу агентом, не лише для показу.
2. **Ембріон з повним ДНК.** Нова сутність одразу проектується з готовністю до
   SaaS (tenantId), multi-user (userId, permissions), billing-інструментації,
   AI (resolveModel). «Не потім додамо — а одразу».
3. **Planka Picatinny (provider pattern).** Один фасад, кілька реалізацій;
   додавання нової реалізації = один новий файл, ядро не чіпається.
4. **Однозначність (правило #11).** Кожне ім'я/прапор/поле = один сенс. Перед
   розширенням існуючого імені новим сенсом — **пауза**: чи це той самий намір?
   Якщо ні — нове ім'я, не нашарування. На місці оголошення — одне речення про
   сенс.
5. **Single Source of Truth.** Одне джерело правди на тип даних. **Для
   розширення:** дані живуть у Legal BMS (через `window.LegalBMS`), розширення
   власної копії/БД не тримає.
6. **Додавати, не переписувати.** Нові концепти — окремі файли/функції. Старий
   код лишається незмінним коли можливо (фасад/обгортка замість переписування).
7. **Тести разом з кодом + принцип DELTA.** Що додаєш — те покриваєш тестом;
   `npm test` зелений перед комітом. DELTA: 80% сьогодні > 100% через два тижні —
   **АЛЕ** структура даних, безпека, архітектурне ДНК робляться правильно з
   першого разу.

### 8.2. Формат TASK-файлів

- Кладуться в `docs/tasks/TASK_<id>_<slug>.md`.
- Містять: мету, контекст, кроки реалізації, критерії готовності.
- Для суттєвих змін — **обов'язкові секції** `SAAS IMPLICATIONS` і `BILLING
  IMPLICATIONS` (як сутність вписується в multi-tenant; точки інструментації).
  Якщо викликає AI — `AI USAGE IMPLICATIONS`.

### 8.3. Формат звітів

- `docs/reports/report_task_<id>_<slug>.md` — звіт про завершення TASK: що
  зроблено, які файли, які тести, що лишилось/відкладено.

### 8.4. SEMANTIC CLARITY CHECK (обов'язкова секція)

Перед злиттям/завершенням TASK — явна перевірка правила #11: чи кожне нове
ім'я/поле/прапор має один сенс? Чи нове **додає однозначності**, а не створює
два сенси на одне ім'я? Якщо друге — спершу впорядкувати, потім розширювати.

### 8.5. Експертна автономія

Виконавець має автономію в **деталях реалізації** в межах наміру спеки (напр.
порядок блоків, іменування внутрішніх функцій, структура файлів) — і фіксує
такі рішення в коментарі/звіті («експертна автономія TASK X»). Намір і контракт
задає спека; «як саме» — за виконавцем, якщо не суперечить філософії.

### 8.6. Діагностика перед фіксом

**Не виправляти не зрозумівши.** Спершу окремий TASK-розслідування (read-only,
звіт із посиланнями на код файл:рядок), адвокат обирає напрям, **потім** окремий
TASK на реалізацію. Реальний кейс: `update_case_ecits_state` — спершу
діагностика, лише потім фікс.

---

## 9. ЧОГО НЕ РОБИТИ

- **НЕ дублювати логіку `scenarioProcessor`** — обробка envelope лишається в
  Legal BMS (`registry`). Розширення тільки **збирає** і **передає** envelope.
- **НЕ створювати власну БД/сховище** даних справ у розширенні. Дані — лише
  через `window.LegalBMS`. Локальний `chrome.storage` — тільки для налаштувань
  самого розширення (токен, прапори), не для справ/засідань.
- **НЕ виходити за межі Етапу 0** у першому TASK (без обходу кабінету, без UI
  вибору обсягу, без фільтрації).
- **НЕ міняти формат envelope** — він фіксований у `registry`
  (`promptBuilder.js`/`scenarioProcessor.js`). Розширення підлаштовується під
  нього (особливо: `warnings` — масив рядків; `scenarioId` обов'язковий).
- **НЕ робити обхід кабінету без точних селекторів** — селектори
  `cabinet.court.gov.ua` досліджуються на Етапі 1 на живому кабінеті, не
  вгадуються.
- **НЕ зберігати/логувати OAuth-токени Drive, не ходити за межі
  `cabinet.court.gov.ua`** у частині обходу (безпекові межі —
  `registry/src/services/ecits/safety.js`: `ECITS_NEVER_TOUCH`,
  `ECITS_NEVER_DO`).

---

## 10. КООРДИНАЦІЯ

- **Адмін-сесія** (Claude Code в репо `registry`) керує **Track A**: доводить
  Court Sync до 100% — TASK 0.4.5 (готовий envelope без переобгортання),
  діагностика/фікс `ecits_state`, UI вибору обсягу на полігоні. Веде
  `registry/docs/consultations/ecits_admin_context.md` (жива пам'ять модуля).
- **Сесія розширення** (Claude Code в репо `legal-bms-extension`, цей файл)
  працює паралельно над **Track B**, починаючи з Етапу 0.
- **Координація — через адвоката + передавальні файли.** Контракт між треками:
  `window.LegalBMS` API (§5) і envelope-формат (§6). Якщо розширенню потрібна
  зміна в Legal BMS (новий метод API, нове поле) — це **запит до адмін-сесії**
  (через адвоката), не зміна в `registry` з боку розширення.

---

## 11. ПОСИЛАННЯ НА РЕСУРСИ

**Файли в репо `registry` (повні шляхи):**
- `src/services/extensionBridge.js` — `window.LegalBMS` API (§5).
- `src/services/ecits/promptBuilder.js` — логіка обходу + функції року (§4).
- `src/services/ecits/scenarioProcessor.js` — обробка envelope, `validateEnvelope`.
- `src/services/ecits/safety.js` — безпекові межі (`ECITS_NEVER_TOUCH/DO`).
- `src/services/entitlementsService.js` — `getForExtension`, `buildDefaultEntitlements`
  (модуль `ecits`, сценарій `import_cases_and_hearings`).
- `src/services/eventBus.js`, `src/services/eventBusTopics.js` — події.
- `src/services/hashRouter.js` — deep-link `#/court-sync/import` (граматика
  `#/<module>/<entityId>`).
- `src/components/CourtSync/` — UI модуля (ImportTab — поточний ручний шлях).
- `src/services/actionsRegistry.js` — ACTIONS/PERMISSIONS (`court_sync_agent`).
- `docs/diagnostics/report_diagnostic_ecits_state.md` — повна діагностика (§6.3).
- `docs/consultations/ecits_admin_context.md` — контекст/статут адмін-сесії ЄСІТС.
- `DEVELOPMENT_PHILOSOPHY.md`, `CLAUDE.md` — філософія й архітектура Legal BMS.

**`SPEC_extension_court_sync.md`** — жива специфікація розширення (4 рівні
захисту, етапи 0–5, знання кабінету з прогонів). Створена в чаті полігону; у
репо `registry` її **немає**. Ключові точки з неї вже відображені тут (§3, §4,
§7). Якщо потрібна повна — попросити адвоката докласти у репо розширення.

**`ecits_envelope_final.json`** — успішно імпортований envelope з 11 справами
(зразок правильної структури). Теж у чаті полігону; за потреби — від адвоката.

---

**Кінець передавального контексту. Перший крок нової сесії: створити TASK 0
каркаса розширення (Етап 0, §7) на основі цього файла + `SPEC_extension_court_sync.md`.**
