# TASK — Стійкий вибір моделі (Model Picker) і реакція на виведення моделі з обігу

**Статус:** SPEC (на рев'ю адвоката, код не починати до затвердження)
**Дата:** 2026-06-19 · **рев'ю/правки:** 2026-06-21
**Гілка розробки:** `claude/quick-input-error-qtek7w`
**Schema bump:** НЕ потрібен (`modelPreferences` уже в контракті user/tenant)

> **Оновлення 2026-06-21 (після рев'ю збоку):**
> 1. **Гострий 404 уже закрито хотфіксом у `main`** (`ac51a48`): `SYSTEM_DEFAULTS` на чинних ID,
>    `MODEL_PRICING` звірено. Прод не висить. Цей TASK — про **довговічний шар** (пікер + живий
>    список + єдине джерело tenant), а не про повторний bump ID. Реалізувати **поверх `main`** (ребейз).
> 2. **Виправлено read-path (§4.6):** persist через `setTenants` сам по собі недостатній — `resolveModel`
>    читає `getCurrentTenant()`, а той повертає застиглий сінглтон. Потрібне **єдине живе джерело tenant**
>    (і запис, і читання). Це ж — серверний шов гідрації (коротка ремарка в §4.6).
> 3. **Прибрано «живу qiAgent-фікстуру» (§13):** не лишаємо робочий QI зламаним на проді; ланцюг
>    реакції на retirement перевіряємо юніт-тестом + разовим ручним override.

---

## 1. КОНТЕКСТ І ПРОБЛЕМА

16.06.2026 Anthropic вивів з обігу `claude-sonnet-4-20250514`. Усі агенти, у яких ця
модель була дефолтом (`qiAgent`, `dashboardAgent`, `dossierAgent`, `documentProcessor`,
`documentParserVision`, `caseContextGenerator`, `imageSorter` — `modelResolver.SYSTEM_DEFAULTS`),
почали отримувати з API `not_found_error` (HTTP 404). Adвокат у Quick Input побачив сирий
текст відповіді API:

> **Помилка: model: claude-sonnet-4-20250514**

Джерело показу — `App.jsx:1771` (`sendChat`): `Помилка: ${err?.error?.message || res.status}`.
Формат `"message": "model: <id>"` — стандартна відповідь Anthropic на `not_found_error`.

**Два дефекти, які це оголило:**

1. **Жорсткий дефолт у коді.** Заміна виведеної моделі = редагування коду + деплой. При
   кожному наступному retirement ситуація повториться.
2. **Незрозуміла реакція.** Адвокат бачить внутрішній ID моделі, а не людську підказку і
   спосіб виправити. Система не реагує — просто показує помилку і застрягає.

**Першопричина не у Quick Input.** QI лише першим наткнувся. Той самий дефолт бив би в
Dashboard-чаті, Досьє-чаті, генераторі контексту, обробці документів.

---

## 2. ЦІЛЬ / НЕ-ЦІЛЬ

### Ціль

Коли актуальну сьогодні модель колись виведуть — система **сама реагує**: ловить помилку,
показує адвокату зрозуміле повідомлення і **живий список актуальних моделей** (тягнеться з
API, не константа), адвокат обирає заміну, вибір **зберігається і синхронізується між
пристроями**. Той самий механізм = ручний вибір моделі для будь-якого агента (один шлях для
аварійного і добровільного вибору).

### Не-ціль (цей TASK НЕ робить)

- НЕ мігрує агентів на tool use (ортогонально; модель передається полем `model` у будь-якому
  режимі — tool use від retirement не захищає).
- НЕ робить AI Provider Abstraction (OpenAI/Grok) — окремий майбутній TASK.
- НЕ вбудовує інлайн-пікери в кожен модуль (тільки модалка-помилка + екран Налаштувань —
  рішення адвоката від 2026-06-19).
- НЕ активує заглушки multi-user; НЕ робить per-user вибір (для соло — рівень tenant).

---

## 3. ПРИНЦИП — ОДНІ ДВЕРІ (вже існують)

Усі агенти вже ходять через `resolveModel(agentType)` (`src/services/modelResolver.js:61`):

```
user.preferences.modelPreferences[agentType]
  → tenant.modelPreferences[agentType]
    → SYSTEM_DEFAULTS[agentType]
      → FALLBACK_MODEL
```

«Хто проходить через двері і з якою моделлю» — це вже просто запис у `modelPreferences`,
без зміни коду викликів. Цей TASK додає (а) живе джерело списку моделей, (б) інтерфейс, щоб
адвокат міг цей запис зробити, (в) автоматичне відкриття цього інтерфейсу при помилці.
**Жоден виклик API не отримує нового хардкоду моделі.**

---

## 4. АРХІТЕКТУРА РІШЕННЯ

### 4.1 Живий список моделей — `src/services/modelsService.js` (НОВИЙ, фасад)

Planka Picatinny: один фасад над Anthropic Models API; у майбутньому під ним можуть стати
провайдери інших постачальників (узгоджено з AI Provider Abstraction).

- `fetchAvailableModels(apiKey, { force = false })` — `GET https://api.anthropic.com/v1/models?limit=1000`
  тим самим ключем, що вже у застосунку. Повертає `{ models: [{ id, displayName, createdAt }], stale, fetchedAt, error }`.
- **Кеш** у localStorage `levytskyi_models_cache` = `{ fetchedAt, models }`, TTL 24 год.
  ЄДИНИЙ сенс кешу: уникнути зайвого запиту на кожне відкриття пікера; primary-джерело —
  завжди API при простроченні / `force`. (Кеш списку моделей — суто прискорення UI, НЕ
  крос-девайс вибір; вибір живе окремо — §4.6. Правило #11.)
- `getCachedModels()` — синхронний доступ до кешу (миттєвий показ, поки `fetch` оновлює).
- Помилки (мережа / 401): повертає stale-кеш + `error`; не кидає (правило №4 — async у try/catch).

> Anthropic Models API НЕ повертає ціни. Наслідок для білінгу — §7.

### 4.2 Детекція «модель не знайдена» — `isModelNotFoundError(status, body)`

Хелпер у `modelsService.js`. ЄДИНИЙ сенс: розпізнати, що API відхилив саме ідентифікатор
моделі (404 + `error.type === 'not_found_error'`, або `message` починається з `model:`).
Не плутати з 401 (ключ/Drive), 429 (rate limit), 400 (інші помилки) — для них реакція інша.

### 4.3 Сигнал → UI — топік eventBus `ai.model_unavailable`

Додати в `eventBusTopics.js`. Payload: `{ agentType, model, tenantId }`. На місцях виклику
API, коли `isModelNotFoundError` → `publish('ai.model_unavailable', …)`. App.jsx підписується
і відкриває `ModelPicker`, відфільтрований під конкретного агента. eventBus уже існує і саме
для такого крос-модульного сигналу без прямих імпортів.

**Місця виклику, які емітять сигнал** (інтерактивні — фаза 1):
- `App.jsx:1338`, `App.jsx:1474`, `App.jsx:1754` (QI: аналіз + чат)
- `Dashboard/index.jsx:1490` (чат дашборду)

Фонові виклики (фаза 2, той самий хелпер): `contextGenerator.js:582`, `ocr/claudeVision.js`,
`sortation/imageSortingAgent.js`, `sortation/imageDocumentGrouper.js`, `toolUseRunner.js`.

> Альтернатива «один спільний `callAnthropic()`-фасад над усіма викликами» — правильна
> кінцева форма (одні двері і для транспорту API), але це більший рефактор 8 точок. За
> принципом DELTA — у цьому TASK додаємо хелпер детекції + емісію на інтерактивних точках;
> повний фасад — окремий борг (`tracking_debt.md`).

### 4.4 `ModelPicker` — модалка, ДВА рівноправні входи (`src/components/ModelPicker/`)

Один компонент, дві точки відкриття (правило дублювання інтерфейсів):

1. **Аварійний (реактивний)** — відкривається з `ai.model_unavailable`. Заголовок:
   «Модель «<id>» більше недоступна (виведена з обігу). Оберіть актуальну модель для
   <людська назва ролі>». Показує живий список (display_name + id), сортований за `createdAt`
   desc. Вибір → `setModelPreference(agentType, id)` → тост → (опційно) повтор останнього запиту.
2. **Добровільний (проактивний)** — відкривається з екрану Налаштувань для будь-якого агента.

Поведінка списку: миттєво з `getCachedModels()`, паралельно `fetchAvailableModels(force)`
оновлює. Кнопка «Оновити список». Якщо API недоступний — показати stale + позначку.

### 4.5 Екран Налаштувань — список ролей агентів

Простий екран (модалка/вкладка) зі списком ролей з `SYSTEM_DEFAULTS` (qiAgent, dashboardAgent,
dossierAgent, documentProcessor, …) — для кожної: людська назва + поточна **розв'язана**
модель (`resolveModel(agentType)`) + позначка джерела (tenant override / system default) +
кнопка «Змінити» (відкриває `ModelPicker`) + «Скинути до дефолту» (`clearModelPreference`).

Це і є «другий шар»: ручний вибір моделі для будь-якого місця. Dashboard поки лишається на
Haiku — але адвокат зможе тут поставити йому хоч Opus, бо всі ходять через ті самі двері.

### 4.6 Персист вибору — КРОС-ДЕВАЙС через `tenant.modelPreferences` (Drive)

**Рішення адвоката 2026-06-19: вибір має зберігатися між пристроями.** Тому персист — не
localStorage, а `tenant.modelPreferences[agentType]` у `registry_data.json`, що синхронізується
через Drive. **Увага (виправлено на рев'ю 2026-06-21):** недостатньо лише записати — `resolveModel`
читає tenant НЕ з React-стану, а через `getCurrentTenant()`, який сьогодні повертає **застиглий
сінглтон**, не зв'язаний ні з Drive-станом, ні з React-`tenants`. Тобто запис і читання мусять
дивитися в ОДНЕ живе джерело — інакше вибір збережеться, але `resolveModel` його не побачить
(деталі — read-path нижче).

**Чому tenant, а не user.preferences:** для соло-практики «активна модель агента» — це
tenant-рівень дефолту (синкається на весь tenant = на одного адвоката). `user.preferences`
лишається шаром 1 для майбутнього per-user override у multi-user (повне ДНК — не чіпаємо).

#### КРИТИЧНА ЗНАХІДКА — плумбінг персисту (інакше Drive не дійде)

`getCurrentTenant()` (`tenantService.js:186`) повертає сінглтон-заглушку `DEFAULT_TENANT`.
Прецедент `setSplitterDatasetEnabled` (`tenantService.js:230`) **мутує цей сінглтон**. Але:

- React-стан `tenants` ініціалізується `[DEFAULT_TENANT]` (`App.jsx:3700`), і саме `tenants`
  серіалізується в `registry_data.json` на Drive (`App.jsx:4598`, dep-array `4650`).
- Після завантаження з Drive — `setTenants(registry.tenants)` (`App.jsx:4409`) замінює масив
  **новими об'єктами**. Відтоді `tenants[0] !== DEFAULT_TENANT`, а `getCurrentTenant()` усе ще
  повертає стару заглушку.

**Висновок — ЄДИНЕ ЖИВЕ ДЖЕРЕЛО tenant (і запис, і читання):**

1. **Запис** — через React-стан: `setModelPreference` — **функція з App.jsx** (поряд з
   `updateCase`/`addNote`), що робить `setTenants`, оновлюючи `tenants[0].modelPreferences`, і
   прокидається пропом туди, де є `ModelPicker`. Це доводить вибір до Drive (крос-девайс).
2. **Читання** — `getCurrentTenant()` має повертати **той самий живий tenant**, а не застиглий
   сінглтон. Інакше `resolveModel` вибору не побачить ні в сесії, ні після reload (бо геттер
   завжди віддає літерал-заглушку). Мінімальний коректний крок: `tenantService` тримає
   module-level **`activeTenant`-ref**, який App **прошиває** (а) при гідрації з Drive/localStorage
   і (б) при кожному `setModelPreference`; `getCurrentTenant()` читає цей ref. Запис і читання
   тоді дивляться в одне джерело.

Без кроку 2 персист «працює» на Drive, але `resolveModel` лишається на дефолті — вибір марний.
Це той самий латентний розрив, що й у `getSplitterDatasetEnabled`/`getEcitsAutoProcess` (читають
заглушку) і `setSplitterDatasetEnabled` (мутує заглушку). Цей TASK лагодить розрив **тільки для
свого шляху** (tenant-ref + `setModelPreference`); чужі читачі заглушки — у `tracking_debt.md`.

> **Ремарка про майбутню серверну архітектуру (для виконавця).** Цей `activeTenant`-ref і є точкою
> гідрації, що на сервері стане завантаженням tenant із БД/сесії. Тому тримай контракт чистим і
> переносимим: `getCurrentTenant()` повертає **плоский серіалізовний об'єкт** (жодних Drive-/
> сховище-специфічних хендлів крізь нього); **єдина** точка, що знає про джерело, — гідрація (не
> точки виклику). Більше нічого спеціально «під сервер» робити не треба — лише не зашити сюди
> прив'язку до конкретного сховища.

**Гідрація після перезавантаження** — безкоштовна: `tenants` вантажиться з localStorage
(`App.jsx:3692`) і з Drive (`App.jsx:4408`), `tenant.modelPreferences` приходить разом.

---

## 5. ДАНІ / СХЕМА

- `tenant.modelPreferences` — **уже існує** (`tenantService.js:43`, `migrationService.js:232`).
  Значення: `{ [agentType]: modelId }`. Schema bump НЕ потрібен.
- `localStorage levytskyi_models_cache` — кеш СПИСКУ моделей (не вибору), поза схемою, з TTL.
- Нічого не дублюється між `ai_usage[]` і `time_entries[]`; вибір моделі — конфіг, не подія.

---

## 6. ЦІНОВИЙ РОЗРИВ (MODEL_PRICING)

`MODEL_PRICING` (`aiUsageService.js:12`) — ручна таблиця, keyed by model id. Нова обрана модель,
якої там нема → `calculateCost` бере `default` (0) → `estimatedCostUSD: 0` у `ai_usage[]`.
Телеметрія не падає (вже є fallback), але вартість недорахується.

**Рішення цього TASK:** прийняти graceful-degrade (0 + модель усе одно записана в `ai_usage[]`
для подальшого ручного перерахунку). Додати у `tracking_debt.md` тригер: «при додаванні нової
моделі у вибір — оновити `MODEL_PRICING`». Авто-підтягування цін НЕ робимо (Models API цін не
віддає; YAGNI).

**Знахідка — ВЖЕ ВИПРАВЛЕНО у `main`** (хотфікс `ac51a48`, разом з ID моделей; tracking_debt #44
закрито). Звірено з довідником `claude-api`, чинні значення:

| Модель | ID | $/1М вхід | $/1М вихід |
|--------|-----|----------:|-----------:|
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | 3.00 | 15.00 |
| Claude Opus 4.8 | `claude-opus-4-8` | 5.00 | 25.00 |
| Claude Haiku 4.5 | `claude-haiku-4-5-20251001` | 1.00 | 5.00 |

`claude-sonnet-4-20250514` лишено в таблиці з поміткою historical (для старих записів `ai_usage[]`).
Цей TASK пунктом цін уже не займається — лишається тригер у `tracking_debt.md`: «при додаванні
нової моделі у вибір — оновити `MODEL_PRICING`».

---

## 7. ФАЙЛИ

**Нові:**
- `src/services/modelsService.js` — фасад Models API + кеш + `isModelNotFoundError`.
- `src/components/ModelPicker/index.jsx` — модалка (два входи), ErrorBoundary-friendly.
- `src/components/Settings/ModelSettings.jsx` (або секція в наявних Налаштуваннях) — список ролей.
- `tests/unit/modelsService.test.js` — кеш/TTL/парсинг/детектор.
- `tests/unit/modelResolver.test.js` — розв'язання з tenant override (якщо ще нема).

**Змінювані:**
- `src/services/modelResolver.js` — `setModelPreference(tenants, setTenants, agentType, id)` /
  `clearModelPreference(...)` як чисті хелпери над переданим станом (логіка оновлення
  `tenants[0].modelPreferences`); або ці функції живуть в App.jsx, а modelResolver лишається
  суто читачем. **Рішення — у §12.**
- `src/services/eventBusTopics.js` — топік `ai.model_unavailable`.
- `src/services/tenantService.js` — **read-path фікс (§4.6):** module-level `activeTenant`-ref +
  `setActiveTenant(tenant)`; `getCurrentTenant()` читає ref замість літерал-сінглтона. (Той самий
  ref природно стане точкою серверної гідрації — ремарка §4.6.)
- `src/App.jsx` — підписка на топік + рендер `ModelPicker`; `setModelPreference` через `setTenants`;
  **прошивка `setActiveTenant` при гідрації (Drive/localStorage) і при `setModelPreference`**;
  емісія сигналу на 3 точках API; передача `apiKey` у `modelsService`.
- `src/components/Dashboard/index.jsx` — емісія сигналу на точці чату.
- `ROLE_LABELS` (людські назви ролей) — маленький мапінг (де саме — §12).

---

## 8. AI-FIRST / SAAS / BILLING / AI USAGE IMPLICATIONS

### AI-FIRST
Вибір моделі — конфіг, прецедент якого (`setSplitterDatasetEnabled`) реалізований простою
функцією, а не ACTION. Тож основні шляхи — UI (модалка + Налаштування). **Хук на майбутнє:**
ACTION `set_model_preference` для голос/агент-керування («постав Досьє на Opus») — занести в
`tracking_debt.md` як AI-first-добудову (зараз YAGNI, бо персист через React-стан, не через
executeAction→Drive). Verifiable: агент може прочитати `resolveModel(agentType)` і `tenant.modelPreferences`.

### SAAS IMPLICATIONS
- Поля: `tenant.modelPreferences[agentType]` (існує). `user.preferences.modelPreferences` —
  лишається шаром 1 для multi-user (не активуємо).
- Tenant isolation: вибір живе в tenant → синкається в межах tenant. Для соло — один адвокат.
- Permissions: вибір моделі в SaaS — дія рівня власника tenant (`canEditBilling`-сусід); зараз
  заглушка true. UI-керування ролями НЕ додаємо.

### BILLING IMPLICATIONS
- `fetchAvailableModels` — це НЕ agent-call (не генерація). НЕ пишемо `ai_usage[]`, НЕ пишемо
  `time_entries[]`, НЕ `activityTracker.report`. Вибір моделі білінг не нараховує.
- Наслідок для вартості при новій моделі — §6.

### AI USAGE IMPLICATIONS
- Точки виклику AI не додаються — лише обгортаються детекцією помилки.
- `resolveModel` лишається єдиною точкою; `logAiUsage` далі пише фактично використану модель.

---

## 9. ТЕСТИ (разом з кодом — обов'язково)

- `modelsService`: парсинг відповіді `/v1/models`; TTL-кеш (свіжий/прострочений/force);
  graceful при 401/мережі (повертає stale + error); `isModelNotFoundError` (404 not_found →
  true; 401/429/400 → false; `message` `model:` → true).
- `modelResolver`: tenant override перекриває SYSTEM_DEFAULTS; `setModelPreference` оновлює
  `tenants[0].modelPreferences` (через переданий setter); `clear` повертає до дефолту.
- (Якщо `ModelPicker` тестуємо) — рендер списку з кешу, виклик `onSelect`.
- `npm test` повністю зелений перед комітом; CI блокує деплой при red.

---

## 10. ФАЗИ (DELTA — 80% сьогодні)

- **Фаза 1 (MVP, цей TASK):** `modelsService` + детектор + топік + `ModelPicker` (аварійний
  вхід) + **єдине живе джерело tenant** (`activeTenant`-ref у `tenantService` + `setModelPreference`
  через `setTenants`, §4.6) → persist крос-девайс І читання `resolveModel` дивляться в одне джерело +
  емісія на 3 інтерактивних точках (QI×2 + Dashboard) + екран Налаштувань (добровільний вхід) + тести.
- **Фаза 2 (борг):** емісія на фонових точках; спільний `callAnthropic()`-фасад; ACTION
  `set_model_preference` (AI-first); інлайн-пікери в модулях (якщо знадобляться).

---

## 11. ВІДКРИТІ ПИТАННЯ (на рев'ю)

1. **Де живуть `setModelPreference`/`clearModelPreference`:** (а) в `App.jsx` поряд з
   `updateCase`/`addNote` (бо потрібен `setTenants`) — рекомендовано; modelResolver лишається
   суто читачем. (б) В `modelResolver.js` як чисті функції `(tenants, setTenants, …) => …`.
   Рекомендація — (а): мутації спільного стану живуть тільки в App.jsx (архітектурне правило
   «спільний стан»).
2. **Куди вішати екран Налаштувань:** чи є наявний Settings-екран, у який додати секцію, чи
   робимо окрему модалку. Уточнити при імплементації (в репо є `CourtSync/SettingsTab`, але це
   модульні налаштування ЄСІТС — не системні).
3. **`ROLE_LABELS`** (людські назви агентів) — новий маленький мапінг у `modelResolver.js`
   поряд з `SYSTEM_DEFAULTS` (там, де живуть ролі) — узгодити.
4. **`SYSTEM_DEFAULTS` ID + `MODEL_PRICING` — вже у `main`** (хотфікс `ac51a48`, §13). Жодного
   агента на виведеному ID НЕ лишаємо (від ідеї живої qiAgent-фікстури відмовилися — §13.2).
   Цей TASK реалізується поверх `main` (ребейз перед стартом).

---

## 12. ЧОГО TASK НЕ РОБИТЬ

- Не мігрує на tool use; не робить AI Provider Abstraction; не активує multi-user / per-user
  вибір; не додає UI керування ролями/користувачами; не робить білінг-UI; не авто-підтягує ціни;
  не будує спільний `callAnthropic()`-фасад (борг); не виправляє чужий борг
  `setSplitterDatasetEnabled` (тільки фіксує в `tracking_debt.md`).

---

## 13. ОНОВЛЕННЯ ДЕФОЛТНИХ МОДЕЛЕЙ (вже у `main`) + ТЕСТ ЛАНЦЮГА

> **СТАТУС 2026-06-21: §13.1 і §6 ВЖЕ ВИКОНАНО окремим хотфіксом у `main`** (коміт `ac51a48`,
> «replace retired model IDs causing 404»), бо прод висів на 404. Тобто `SYSTEM_DEFAULTS` уже на
> чинних ID і `MODEL_PRICING` уже звірено. **Цей TASK НЕ повторює і НЕ відкочує це** — він
> реалізується **поверх `main`** (гілку перед стартом ребейзнути на `main`, інакше стара
> partial-версія цих файлів на гілці зреґресує хотфікс). Лишок цього TASK — **довговічний шар**:
> `modelsService` + детектор + `ModelPicker` + Налаштування + єдине живе джерело tenant (§4.6).

### 13.1 `SYSTEM_DEFAULTS` — цільовий стан (уже у `main`)

| agentType | Стало (у `main`) |
|-----------|------------------|
| `dossierAgent` / `qiAgent` / `dashboardAgent` / `documentProcessor` / `documentParserVision` / `caseContextGenerator` / `imageSorter` | `claude-sonnet-4-6` |
| `deepAnalysis` | `claude-opus-4-8` |
| `qiParserDocument` / `qiParserImage` / `imageDocumentGrouper` / `textCleaner` / `textDigest` / `metadataExtractor` | `claude-haiku-4-5-20251001` (без змін) |

`FALLBACK_MODEL` = `claude-sonnet-4-6`. **Жоден агент НЕ лишається на виведеному ID** —
відмовилися від ідеї «лишити `qiAgent` зламаним як живу фікстуру»: відвантажувати головний
робочий вхід (Quick Input) зламаним на проді — зайвий ризик, а «потім окремим комітом полагодити»
легко забути. Ланцюг реакції на retirement перевіряємо без поломки прода — див. §13.2.

### 13.2 Перевірка ланцюга реакції — без поломки прода

1. **Детермінований юніт-тест (основний доказ):** `isModelNotFoundError(404, {error:{type:'not_found_error'}})`
   === true (і false для 401/429/400); після `setModelPreference(agentType, id)` — `resolveModel(agentType)`
   повертає вибране (override перекриває `SYSTEM_DEFAULTS`); читання йде через живий tenant-ref (§4.6),
   не через сінглтон. Це «живий» індикатор, що майбутні зміни не зламали ланцюг.
2. **Разовий ручний прогін (наскрізно):** тимчасово виставити для одного агента **завідомо неіснуючий
   ID** через `tenant.modelPreferences` (override, НЕ дефолт у коді) → переконатися, що 404 ловиться,
   `ModelPicker` відкривається з живим списком, вибір зберігається і застосовується крос-девайс →
   прибрати тимчасовий override. Прод-дефолти при цьому лишаються робочими.
