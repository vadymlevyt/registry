# Архітектурні рекомендації — ембріон для Chrome extension Legal BMS

**Тип:** консультативний документ для адмін-чату (НЕ реалізація коду).
**Дата:** 2026-05-16
**Контекст:** перед фінальним TASK 0.4 (Court Sync MVP). Власне розширення розробляється паралельно; обидва (Claude for Chrome + майбутнє розширення) — провайдери одного інтеграційного шару.
**База:** стан коду на `cc5da17`, факти з `docs/audits/audit_before_task_0_4.md`.

Наскрізний принцип усіх рекомендацій нижче: **транспорт ≠ джерело ≠ білінг** (правило #11). UI-вставка JSON і розширення — це лише два *транспорти* доставки одних і тих самих ЄСІТС-даних. Вони не повинні розгалужувати ні схему, ні білінгову категорію, ні набір ACTIONS — лише провенанс-метадані.

---

## ПИТАННЯ 1 — `window.LegalBMS` API

### а) Кращі патерни в існуючому коді

Глобального `window.*`-bridge немає (аудит §7.24 підтвердив). Але винаходити нову інфраструктуру не треба — у коді вже є **три патерни, які bridge має переюзати, а не дублювати**:

1. **`activityTracker.configure({sink, patchSink})` + module-scoped `_sink` + `enable()/disable()`** (`activityTracker.js`). Це готовий патерн «пізнього зв'язування»: модуль тримає змінний внутрішній референс, App.jsx прокидає в нього актуальні колбеки кожен render, а `_enabled` гейтить запис до завершення hydration. **Bridge має бути дослівною копією цієї механіки.**
2. **`eventBus` (`subscribe/publish`)** — для `window.LegalBMS.on(event, handler)`. Bridge `on` мусить просто делегувати в `eventBus.subscribe`. Створювати другу шину подій — пряме порушення правила #11 (дві сутності «підписка на подію»).
3. **`createActions(deps)` factory + `executeAction` як єдина воронка** (архіваріус). Bridge НЕ отримує доступу до `ACTIONS` напряму — усе тільки через `executeAction` (інакше дірка в PERMISSIONS).

Висновок: `window.LegalBMS` — це **тонкий транспортний шим без бізнес-логіки**. Кожен його метод делегує: `submitScenarioResult` → `scenarioProcessor` (Q4), `on` → `eventBus.subscribe`, `getEntitlements` → `entitlementsService` (Q3). Це пряме застосування «додавати, не переписувати» + provider pattern: `window.LegalBMS` — один транспорт-провайдер, Claude-for-Chrome (ручна вставка) — інший, обидва годують один facade.

### б) Куди фізично прописати

Розбір варіантів проти фактів коду:

- **`main.jsx` — НІ.** Він pre-React (аудит: тільки `createRoot` + ErrorBoundary). Немає доступу до `executeAction`, який народжується всередині тіла `App` через `createActions(deps)` кожен render.
- **`App.jsx` через `useEffect` із замиканням на `executeAction` — НІ.** `executeAction` замикає render-снапшот `getCases:()=>cases`. Об'єкт `window.LegalBMS`, виставлений один раз в `useEffect`, законсервує **застарілий** `executeAction` → мутації повз актуальний стан (той самий клас бага, від якого `update_document` рятується функціональним `setCases(prev=>…)`).
- **Окремий `src/services/extensionBridge.js` — ТАК.** Дзеркалить `activityTracker`: module-scoped мутабельні референси + `configure()` + `install()` (ідемпотентний, чіпляє `window.LegalBMS` рівно раз зі **стабільною ідентичністю**; методи об'єкта читають *поточні* референси). App.jsx в ефекті викликає `extensionBridge.configure({ executeAction, getEntitlements, … })` (актуалізація щорендер, як уже робиться для `activityTracker.configure` і `bindMasterTimer`).

Рекомендація: **`src/services/extensionBridge.js`**, контрактно ідентичний механіці `activityTracker`. Один новий файл, нуль переписування App.jsx (лише один `configure`-виклик у вже наявному блоці прив'язок сервісів).

### в) Сигнал готовності

Булевого `isReady` **недостатньо** (гонка: розширення прочитає до монтування). Потрібна тріада, причому з критичним нюансом:

1. `window.LegalBMS` присутній лише ПІСЛЯ `install()` (сама присутність = частковий сигнал).
2. `whenReady()` повертає `Promise`, що резолвиться одразу якщо готово, інакше — на події.
3. DOM-подія `window` `legalbms:ready` (`CustomEvent`) при завершенні `install`. Розширення: `await (window.LegalBMS?.whenReady() ?? new Promise(r => addEventListener('legalbms:ready', r, {once:true})))` — покриває обидва порядки завантаження.

**Критичний нюанс із аудиту (R1 + Drive-first splash):** readiness НЕ можна сигналити по факту монтування. У App.jsx є splash, що блокує UI до hydration; `activityTracker._enabled` вмикається тільки після `setDriveHydrated(true)`, бо запис у `cases` до hydration перетирається EFFECT-A. `submitScenarioResult` мутує `cases` → **bridge має сигналити ready тільки після hydration**, дзеркаливши `activityTracker.enable()`. Інакше перша ж синхронізація розширення до hydration пропаде. Це найважливіша поправка до пропозиції адмін-чату.

### г) Версіонування одразу

Так — структурне, дешеве, «повне ДНК». Версіонувати **контракт bridge**, не застосунок:

```
window.LegalBMS = { version:'1.0.0', apiLevel:1, appVersion:<build>, isReady, whenReady, … }
```

`apiLevel` (ціле) — груба сумісність: розширення перевіряє `apiLevel >= N` без semver-парсингу. `version` — semver контракту. `appVersion` окремо (діагностика). Контракт версіонується від народження — інакше перша несумісна зміна payload зламає розгорнуте розширення без шляху деградації.

---

## ПИТАННЯ 2 — Hash-routing

### а) Вплив на інші модулі (DP v2, Canvas)

Не зачепить **за умови** що це генеричний `hash ↔ tab` через розширюваний реєстр маршрутів, а не хардкод під court-sync у тілі App.jsx. Рекомендація — таблиця маршрутів-констант (`{ '#/court-sync/import': {tab:'courtsync', sub:'import'}, … }`); DP v2/Canvas просто додають рядок (додавати, не переписувати). Жодної гілки `if (route==='courtsync')` в App.jsx.

### б) react-router чи власний listener

**Власний мінімальний hash-listener. react-router — ні.** Обґрунтування з коду:

- App.jsx — один великий компонент з `const [tab,setTab]=useState('dashboard')`. react-router вимагає винести роутинг у route-компоненти = масштабне переписування, проти «додавати, не переписувати».
- Хостинг GitHub Pages + Vite: `BrowserRouter` тягне basename-проблеми; `HashRouter` усе одно треба інтегрувати з наявним `tab`-станом.
- Потрібно ~30 рядків сервісу `src/services/hashRouter.js`: parse hash → `{tab, subtab, entityId}`; listener `hashchange`; on tab change → `history.replaceState`. Це YAGNI/DELTA-вибір.

### в) Конфлікт із наявним `location.hash`

Аудит-grep: у `src/` ніхто не використовує `location.hash` для навігації (нема `hashchange`-слухачів, нема `pushState`); `main.jsx` тільки `location.reload`. Конфлікту сьогодні нема. Захист на майбутнє (правило #11 — «hash означає маршрут лише коли…»): усі маршрути під префіксом `#/`; listener **ігнорує** хеші без префікса `#/` (щоб майбутні якірні посилання / сторонні ліби з голим `#section` не тригерили роутер). Один сенс хеша = «маршрут застосунку», лише з префіксом.

### г) Глибокі посилання (`#/case/case_47/dossier`)

З аудиту: досьє — окремий стан `dossierCase` (`setDossierCase`), не `tab`. Тому deep-link вимагає: parse → знайти справу за id **після hydration** → `setDossierCase`. Критично — відкласти застосування доки `driveHydrated && cases.length` (та сама гонка що Q1в, R1). Патерн «pending deep link»: розпарсений намір зберігається, застосовується в ефекті раз по готовності даних. Сутність не знайдено → graceful fallback на таб модуля + toast (не blank — правило #4 проекту).

Рекомендація: зафіксувати **граматику маршруту вже зараз**, навіть якщо реалізовано тільки court-sync: `#/<module>[/<entityId>][/<view>]`. Генерична, розширювана (ембріон ДНК) — case/document/canvas deep-links потім не потребують переробки роутера.

---

## ПИТАННЯ 3 — `tenant.subscription.entitlements`

### а) Поряд чи замість `features`

Факт із аудит-grep: `features:['all']` оголошено рівно один раз у `DEFAULT_TENANT` і **ніде не читається** (жодного споживача в коді). Тобто поле де-факто мертве.

Рекомендація: **додати `entitlements` ПОРЯД, `features` не чіпати взагалі** (не розширювати його сенс — правило #11; не видаляти — «додавати, не переписувати» + старі registry на Drive можуть містити). Позначити `features` deprecated у `tracking_debt.md` з тригером «коли приземлиться SaaS tariff matrix — вирішити долю `features`». Жодного коду, що читає `features`, перероблювати не треба (бо такого нема) — `entitlements` отримує єдиного нового читача (Q3в).

### б) Backward-compat

Критична деталь з аудиту (`migrationService.js:189-196`): `migrateTenant` будує `subscription` як `...(t.subscription||{})` і явно дефолтить лише `plan/status/limits/current/alerts` — **`entitlements` НЕ дефолтиться**. Старий збережений tenant без `entitlements` його не отримає.

Рекомендація: додати `ensureEntitlements(sub.entitlements)` у `migrateTenant` — **дослівне дзеркало наявного прецеденту `ensureModuleIntegration`** (`migrationService.js:221`): ідемпотентний merge дефолтів, **БЕЗ schemaVersion bump** (це розширення tenant-конфігу, не registry-схеми — той самий клас, що `moduleIntegration.ecits` і `recon_history[]`, додані без міграції). Це вже усталений патерн проекту для «nullable структуроване поле в tenant без міграції» — не винаходимо новий.

### в) Helper `canUseModule`

Так, єдиний читач (SSOT гейтингу). Сигнатура — не голий boolean, а як стиль `checkCaseAccess`, але багатший:

```
canUseModule(tenant, moduleId, scenarioId?) → { allowed:boolean, reason:string|null }
```

`reason` потрібен для UX (показати чому недоступно) і телеметрії. Логіка: `tenant.subscription.entitlements[moduleId]`; відсутнє → permissive для `self_hosted` (ембріон: заглушка повертає дозвіл для solo, як `permissionService` повертає true для `bureau_owner`). Перевірки: `enabled`, `expiresAt` (null=∞), scenario-флаг якщо передано `scenarioId`, `remainingUsages` (null=∞). Місце — новий `src/services/entitlementsService.js`, сиблінг `subscriptionService.js` (provider-pattern сімейство). Заглушки permissive зараз, реальний tariff-розрахунок потім — точно принцип ембріона.

### г) `TARIFF_MATRIX` окремим файлом

Так — `src/services/tariffMatrix.js` (константа). Зараз лише `self_hosted → все enabled`. Розділення відповідальностей: **DEFAULT_TENANT зберігає матеріалізований `entitlements`** (це дані — розширення читає через `getEntitlements()` без перерахунку), **`TARIFF_MATRIX` — джерело для майбутнього SaaS-перерахунку** (`entitlementsService.computeEntitlements(plan)`). Відповідає SSOT + філософії варіабельності (дефолти — стартові точки). Не зливати дані й матрицю в одне (правило #11).

---

## ПИТАННЯ 4 — `submitScenarioResult` як спільна функція

### а) Передача залежностей через `createActions(deps)`

Ключовий факт: `executeAction` народжується ВСЕРЕДИНІ render App.jsx із замиканням на `getCases:()=>cases`. Тому `scenarioProcessor` **не може імпортувати `executeAction`** (на module-scope його не існує). Має приймати **ін'єкцією** — той самий принцип, що `createActions(deps)`:

```
submitScenarioResult(scenarioId, payload, { source, executeAction, agentId })
```

- UI передає render-scoped `executeAction` + `agentId` (`'court_sync_agent'` для ЄСІТС-сценаріїв).
- `window.LegalBMS`-обгортка бере `executeAction` через late-binding-референс `extensionBridge` (Q1б — `configure` оновлює його щорендер → нема stale closure).

`scenarioProcessor` = чиста оркестрація поверх ін'єктованого `executeAction`. **Власного доступу до `ACTIONS` не отримує** — усе через єдину воронку (архіваріус). Це консистентно з філософією factory+deps.

### б) Інтеграція з activityTracker (UI=робота / розширення=автосинхронізація)

Тут найважливіша порада, і вона перекриває аудит-ризик **R5**.

Пропозиція «UI рахувати як роботу, розширення — як автосинхронізацію» **базується на хибній осі**. Дані з ЄСІТС лишаються ЄСІТС-даними незалежно від того, адвокат вставив JSON чи розширення доставило. Адвокат, що вставляє JSON, **не виконує юридичну роботу над засіданням** — він робить ~30-секундну системну операцію. Тому правильна модель:

1. **`source` завжди `'court_sync'`** (і для UI-вставки, і для розширення) — бо файл/засідання реально походить із суду. Транспорт (хто доставив JSON) — це провенанс-метадані, НЕ `source` і НЕ білінгова категорія (правило #11).
2. **НЕ обгортати `submitScenarioResult` у власний `activityTracker.report`** — це подвоїть із hook'ом у `executeAction` (порушення «НЕ дублювати»). Білінг лишається там, де він є — у hook executeAction.
3. **Per-action білінг для court_sync треба прибрати — це R5.** Зараз `add_hearing`/`update_hearing` НЕ в `SYSTEM_ACTIONS_NO_BILLING` і НЕ в `EDIT_ACTIONS_SOURCE_AWARE`, тож кожне синхронізоване засідання впаде в `time_entries[]` як оплачуваний `case_work`. Рекомендація: **TASK 0.4 мусить розширити source-aware гейт hook'а на `add_hearing`/`update_hearing`** (коли `source∈{court_sync,metadata_extractor}` — не нараховувати), мінімальною зміною через наявний механізм `EDIT_ACTIONS_SOURCE_AWARE`. Після цього UI-vs-розширення для білінгу стає нерелевантним — обидва коректно не нараховуються (бо обидва court_sync).
4. **Опційно** — один summary `time_entry` категорії `system` (non-billable) на сам акт запуску імпорту, через існуючий hook, не вручну.

Підсумок: розрізнення UI/розширення живе як **провенанс** (`captureMethod`/transport у scenario-history і `entry.metadata`), а не як білінгова гілка. Закрити R5 — передумова коректності з першої синхронізації.

### в) Журнал `tenant.ecits_scenario_history[]`

Так, сильно узгоджено з філософією білінгу («інструментація зараз, UI потім») і ембріоном. Рекомендація — **дослівне дзеркало наявного прецеденту `tenant.recon_history[]`**: додано в `DEFAULT_TENANT` без schema bump, шлях localStorage→registry, LIFO-cap (recon=200), сортування. Запис: `{ scenarioId, transport:'extension'|'manual_paste', startedAt, completedAt, status, result:{casesCreated,casesUpdated,hearingsAdded,…}, tenantId, userId, errors[] }`. `tenantId`+`userId` з народження (multi-tenant/multi-user ДНК).

SSOT-застереження (правило #11 / «НЕ дублювати»): це **4-й окремий потік**, відмінний від `time_entries[]` (білінг), `ai_usage[]` (токени), `auditLog[]` (критичні дії). Явно зафіксувати призначення (провенанс/audit сценаріїв) і не дублювати в нього поля інших трьох потоків.

---

## ПИТАННЯ 5 — точки, які адмін-чат міг пропустити «ззовні системи»

### 5.1 Ідемпотентність / зовнішній ключ дедуплікації (пріоритет — вищий за 4 питання вище)

Court Sync і розширення **повторно доставлятимуть ті самі ЄСІТС-дані** при кожній ре-синхронізації. У схемі v7 вже є `hearing.ecitsContext.ecitsNotificationId`, `document.ecitsSource.ecitsDocumentId`, `sourcePolicy.hashData()`, `_lastSource`, `alternativeSources[]`. Але **payload-рівневої ідемпотентності немає**: `add_hearing` генерує `hrg_${Date.now()}` без природного ключа — повторний submit створить **дублікати засідань**.

Рекомендація: рішення «upsert за зовнішнім ключем» закласти структурно ЗАРАЗ. Поля під ключ уже існують у схемі (`ecitsNotificationId`/`ecitsDocumentId`) — бракує лише логіки в `scenarioProcessor`: перед `add_*` шукати існуючий запис за ЄСІТС-ref → `update_*` замість `add_*`. Це данні+поведінка, дешево зараз, **боляче потім** (дублікати в проді — найгірший клас). TASK 0.4 мусить це вирішити явно; за вагою це більше за чотири питання вище.

### 5.2 Версіонований транспорт-незалежний конверт (provider pattern на інтеграційний шар)

Обидва провайдери годують `scenarioProcessor`. Закласти версіонований конверт зараз:

```
{ envelopeVersion, scenarioId, scenarioVersion, producedAt,
  producedBy:{ provider, providerVersion }, data }
```

`scenarioProcessor` валідує `envelopeVersion` (reject/upgrade). Це **planka Picatinny на інтеграційний шар**: facade (`scenarioProcessor`) стабільний, провайдери (транспорти) змінні, конверт — стабільний контракт між ними (точно філософія `ocrService.js`). Дзеркалить наявне версіонування recon-сценаріїв (`RECON_ecits_basic_v1`). Дешеве структурне ДНК; рятує від болючої міграції коли payload розширення зміниться у v2.

### 5.3 Мінімальна поверхня window + межа безпеки (золота середина)

`window.LegalBMS` досяжний будь-яким скриптом сторінки (включно з content-script будь-якого розширення). Дві поправки:

- **Жодного привілейованого шляху.** `submitScenarioResult` НЕ обходить `executeAction`/PERMISSIONS — `court_sync_agent` allowlist лишається чинним і для розширення. Це природно виконується, якщо `scenarioProcessor` користується лише ін'єктованим `executeAction` (Q4а). Зафіксувати явно: транспорт, що обходив би PERMISSIONS — архітектурна дірка (безпека — не компроміс, ПРИНЦИП DELTA).
- **`registerExtension` — відкласти.** Поки нема конкретного споживача identity/handshake, це спекулятивна поверхня API, що погано старіє (YAGNI/золота середина). MVP-поверхня: `submitScenarioResult` + `on` + `getEntitlements` + `whenReady` + `version`. `registerExtension` (і origin/handshake-токен) → `tracking_debt.md` з тригером «розширення потребує auth-рукостискання».

---

## Зведення для написання TASK 0.4

| # | Рекомендація | Патерн який переюзуємо | Вартість |
|---|--------------|------------------------|----------|
| Q1 | `extensionBridge.js`, дзеркало `activityTracker.configure/_sink/_enabled`; ready після hydration; `whenReady()`+подія; `apiLevel` | activityTracker / eventBus | 1 файл + 1 `configure` у App.jsx |
| Q2 | Власний `hashRouter.js`, реєстр маршрутів `#/<module>[/<id>][/<view>]`, ігнор не-`#/`, pending-deeplink після hydration | новий сервіс, без router-ліби | ~30 рядків + 1 ефект |
| Q3 | `entitlements` поряд з `features`; `ensureEntitlements` у `migrateTenant` (дзеркало `ensureModuleIntegration`, без bump); `entitlementsService.canUseModule`; `tariffMatrix.js` | ensureModuleIntegration / subscriptionService | 2 файли + 1 рядок у migrateTenant |
| Q4 | `scenarioProcessor.submitScenarioResult(...,{executeAction,agentId,source})` через DI; `source='court_sync'` завжди; **закрити R5**; `ecits_scenario_history[]` як дзеркало `recon_history[]` | createActions(deps) / recon_history | 1 файл + правка billing-гейта (R5) |
| Q5 | upsert за ЄСІТС-ref (дедуп); версіонований конверт; мінімальна window-поверхня + без обходу PERMISSIONS | sourcePolicy / ocrService / архіваріус | структурні рішення в спеці 0.4 |

**Передумова коректності:** аудит-ризики **R1** (новий `create_case` без `ecitsState/parties/processParticipants`) і **R5** (hearing-ACTIONS білляться попри `court_sync`) — не «потім», а в scope TASK 0.4: вони підривають і bridge-readiness (R1 → гонка hydration), і білінг (R5 → забруднення з першої синхронізації). Решта — чисте додавання поверх упорядкованої бази.
