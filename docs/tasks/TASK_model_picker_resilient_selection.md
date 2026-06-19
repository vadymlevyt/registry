# TASK — Стійкий вибір моделі (Model Picker) і реакція на виведення моделі з обігу

**Статус:** SPEC (на рев'ю адвоката, код не починати до затвердження)
**Дата:** 2026-06-19
**Гілка розробки:** `claude/quick-input-error-qtek7w`
**Schema bump:** НЕ потрібен (`modelPreferences` уже в контракті user/tenant)

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
через Drive. `resolveModel` уже читає `tenant.modelPreferences` як шар 2 — додаткового читання
не треба.

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

**Висновок:** писати вибір треба **через React-стан** (`setTenants`, оновлюючи `tenants[0].modelPreferences`),
а НЕ мутацією сінглтона. Інакше: (а) на Drive нічого не дійде (серіалізується React-стан, не
заглушка), (б) `resolveModel` через `getCurrentTenant()` читатиме стару заглушку, не оновлений
tenant. Тобто `setModelPreference` має бути **функцією з App.jsx** (поряд з `updateCase`/`addNote`),
яка робить `setTenants` і прокидається пропом туди, де є `ModelPicker`.

> Це той самий латентний борг, що й `setSplitterDatasetEnabled` (мутує заглушку — її зміна
> теж може не доходити до Drive після hydration). Фіксувати чужий борг у цьому TASK не треба
> (DELTA), але `setModelPreference` робимо одразу правильно — через React-стан. Знахідку про
> `setSplitterDatasetEnabled` занести в `tracking_debt.md`.

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
- `src/App.jsx` — підписка на топік + рендер `ModelPicker`; `setModelPreference` через `setTenants`;
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
  вхід) + персист крос-девайс через `setTenants` + емісія на 3 інтерактивних точках (QI×2 +
  Dashboard) + екран Налаштувань (добровільний вхід) + тести.
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
4. **Чи чіпати `SYSTEM_DEFAULTS` зараз:** дефолти ще містять виведений `claude-sonnet-4-20250514`
   (тимчасово рятує лише `FALLBACK_MODEL = claude-sonnet-4-6`). Пропоную в рамках цього TASK
   також оновити `SYSTEM_DEFAULTS` на чинні моделі — інакше «з коробки» все одно 404 до першого
   ручного вибору. (Окреме мікро-питання: підтвердити цільові ID — Sonnet/Opus — через
   `claude-api` skill на момент імплементації.)

---

## 12. ЧОГО TASK НЕ РОБИТЬ

- Не мігрує на tool use; не робить AI Provider Abstraction; не активує multi-user / per-user
  вибір; не додає UI керування ролями/користувачами; не робить білінг-UI; не авто-підтягує ціни;
  не будує спільний `callAnthropic()`-фасад (борг); не виправляє чужий борг
  `setSplitterDatasetEnabled` (тільки фіксує в `tracking_debt.md`).
