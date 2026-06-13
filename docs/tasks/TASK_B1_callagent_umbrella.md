# TASK B1 — Тонка парасоля `callAgent` + авто-білінг (Частина А боргу #55)

**Дата спеки:** 2026-06-13
**Вісь:** B (розгрібання хаосу) · фундамент під A5 (функція метаданів)
**Тип:** новий сервіс-обгортка (planka Picatinny) + один proof-споживач
**Статус:** готова до виконання
**Оцінка:** ~0.5-1 день

---

## 0. ОБОВ'ЯЗКОВЕ ЧИТАННЯ (в порядку)
1. `CLAUDE.md` — архітектура, тверді правила (особливо §«TOOL USE СТРАТЕГІЯ», §«Моделі», правило #11 однозначність).
2. `DEVELOPMENT_PHILOSOPHY.md` — БЕЗ цього TASK не починати (особливо «Planka Picatinny», «ембріон з повним ДНК», «Однозначність»).
3. `docs/ROADMAP.md` — **Версія 2** (внизу файлу): Вісь B → B1; шпаргалка борг #55.
4. ЦЕЙ файл.

---

## 1. КОНТЕКСТ І МЕТА

### Проблема (своїми словами)
Зараз заклик AI у коді відбувається двома способами. Частина агентів іде через спільний двигун `toolUseRunner.js` (`callAPIWithRetry`/`callAPIStreaming`/`runMultiTurnConversation`) — там вибір моделі і частковий облік уже централізовані. АЛЕ ~7 точок роблять **прямий `fetch`** до Anthropic повз двигун (App.jsx ×3, Dashboard, `contextGenerator`, `claudeVision`, `imageSortingAgent`/`imageDocumentGrouper`), і **кожна з них вручну дублює облік токенів** (`logAiUsage` + `activityTracker.report`). Це клас багів «забули інструментацію»: додав нову AI-точку, не дописав облік — витрати течуть повз білінг непомітно.

### Що робимо в B1
Створюємо **тонку обгортку** `callAgent({ agentType, ... })` — ОДНУ точку, через яку:
1. **сама** резолвиться модель через `resolveModel(agentType)` (ієрархія user→tenant→system, не hardcoded);
2. **сам** пишеться облік — `ai_usage` (токени, для оператора SaaS) + `activityTracker` (час, для білінгу адвоката) — у `try/catch`, ніколи не валить сам виклик;
3. виклик делегується наявним транспортам `toolUseRunner` (текст / стрім / tool-use) — **нічого не переписуємо в транспортах**.

Сенс (принцип «ембріон з повним ДНК»): будь-який **новий** AI-виклик, написаний через `callAgent`, **народжується з обліком автоматично** — не з ручним, який потім переробляти. Першим реальним споживачем стане A5 (функція метаданів).

### Чого B1 НЕ робить (це Частина Б / B2)
Масова міграція 7 прямих-`fetch` точок — **НЕ зараз**. Вони мігруються принагідно по дорозі (зокрема в A7). Це окремий борг #55 Частина Б.

---

## 2. КОНТРАКТ `callAgent` (що проектуємо)

Новий файл `src/services/callAgent.js`. Єдина експортована функція з конфігурованим режимом:

```
callAgent({
  agentType,            // обов'язково — ключ для resolveModel + agentType у логах
  mode,                 // 'text' | 'stream' | 'toolUse'  (default 'text')
  system,               // системний промпт (опційно)
  messages,             // масив повідомлень (формат Anthropic)
  tools,                // для mode:'toolUse' — список tool definitions
  max_tokens,           // дозвіл на вивід (не вимога)
  context,              // { caseId, module, operation } — для логів
  apiKey,               // ключ (як зараз передається транспортам)
  onStreamDelta,        // для mode:'stream' — колбек дельт (опційно)
  // службові ін'єкції для тестів/білінгу:
  aiUsageSink,          // куди писати ai_usage (як logAiUsageViaSink)
  billAsUserAction,     // bool: чи писати activityTracker (default true)
}) → { text?, toolResult?, usage, model, stop_reason }
```

**Один сенс на параметр (правило #11):** `mode` — лише транспорт (як кликати), `billAsUserAction` — лише «чи це робота адвоката для білінгу» (автопродовження DP → false, кнопка/ACTION → true). Не змішувати.

### Внутрішня логіка (3 кроки)
1. `model = resolveModel(agentType)` — резолв тут, не в caller'а.
2. делегувати транспорту за `mode`:
   - `text` → `callAPIWithRetry`
   - `stream` → `callAPIStreaming`
   - `toolUse` → `runToolUse` / `runMultiTurnConversation`
3. **після відповіді** — облік ОДИН раз: `logAiUsage(... aiUsageSink)` завжди + `activityTracker.report('agent_call', ...)` якщо `billAsUserAction`.

---

## 3. КЛЮЧОВИЙ РИЗИК — ПОДВІЙНИЙ ОБЛІК (читати уважно)

`toolUseRunner.js` **уже логує** `ai_usage` всередині (`runMultiTurnConversation` пише на кожному турні — є `logAiUsage` ~рядок 245, gated на `setAiUsage`). Якщо `callAgent` обгорне його і теж залогує — буде **подвійний рахунок** токенів. Це пряме порушення правила #11 (одне джерело правди для обліку).

**Рішення (обрати ОДНЕ, задокументувати на місці):**
- Варіант А: `callAgent` — ЄДИНА точка обліку; внутрішнє логування транспортів **вимикається** (не передавати `setAiUsage`/sink у транспорт, логувати лише в `callAgent` за фінальним `usage`).
- Варіант Б: для `mode:'toolUse'` облік лишається в транспорті (бо там per-turn точніший CRM-зріз), а `callAgent` для tool-use **не дублює** — лише `activityTracker`.

Рекомендація: **Варіант А** (одна точка — менше сюрпризів, простіше тестувати). Виконавець обирає свідомо і **тестом доводить, що рахунок не подвоївся**.

---

## 4. PROOF-СПОЖИВАЧ (щоб не було «функції без caller'а»)

Фундамент без жодного споживача — антипатерн (YAGNI / speculative generality, заборонено філософією). Тому B1 **переводить РІВНО ОДНУ** наявну точку на `callAgent` як доказ життя:

**Кандидат: Triage** — `src/services/documentBoundary/analyzeTriageViaToolUse.js`. Чому саме він:
- програмний агент (НЕ чат — чат не чіпаємо);
- уже на tool-use;
- уже логує `ai_usage` + `activityTracker` **вручну** — ідеальний before/after, щоб довести, що парасоля централізує облік **без втрати інструментації і без подвоєння**;
- покритий наявними тестами (`tests/integration/dp-toc-detector.test.js`, `dp-enriched-digest.test.js`, `tests/unit/triageStage.test.js`) — регресію видно одразу.

Після переводу: `analyzeTriageViaToolUse` кличе `callAgent({ agentType:'qiParserDocument', mode:'toolUse', ... })`, ручні `logAiUsageViaSink`/`activityTracker.report` з нього **прибираються** (тепер це робить парасоля). Результат Triage (план нарізки) і реальні лічильники токенів — **не змінюються**.

> Якщо власник захоче proof-споживача нуль (лише парасоля + тести) — допустимо, але тоді A5 МУСИТЬ бути першим споживачем одразу за B1. Рекомендація — Triage, бо дає живий регресійний захист.

---

## 5. ЩО НЕ РОБИТИ (тверді межі)
- **НЕ чіпати чат-агентів** (QI, Dashboard, Dossier) — CLAUDE.md прямо забороняє.
- **НЕ мігрувати** решту 6 прямих-`fetch` точок (це B2, борг #55 Частина Б).
- **НЕ міняти** `resolveModel`/`SYSTEM_DEFAULTS` ієрархію — лише викликати.
- **НЕ міняти** транспорти `toolUseRunner` по суті (хіба що передати/не передати прапор логування — мінімально, behavior-preserving для інших викликачів).
- **НЕ міняти** формат `ai_usage`/`activityTracker` записів (поля ті самі).
- **НЕ дублювати** поля між `ai_usage` і `time_entries` (CLAUDE.md).

---

## 6. SAAS IMPLICATIONS
- **Tenant/User:** `callAgent` бере `tenantId`/`userId` так само, як наявний шлях (через `logAiUsage`/`activityTracker`, що читають `getCurrentUser`/`getCurrentTenant`). Нових полів сутностей немає.
- **Permissions:** `callAgent` — транспорт AI, НЕ модифікує дані; через `executeAction`/PERMISSIONS не проходить (дані пише вже сам агент окремо). Нічого в PERMISSIONS не додаємо.
- **Model hierarchy:** `resolveModel(agentType)` зберігає ієрархію user→tenant→system — Premium-tenant зможе перевизначити модель per-agentType без зміни `callAgent`.

## 7. BILLING IMPLICATIONS
- **Точка інструментації:** `callAgent` стає **єдиною** точкою для всіх НОВИХ агент-викликів: `ai_usage` (токени) + `activityTracker.report('agent_call')` (час). Це і є головний виграш — прибирає клас багів «забули інструментацію».
- **Категорія часу:** `agent_call` → `categoryForCase(caseId)` (як зараз у Triage). `billAsUserAction:false` для автопродовження (DP-фон) — НЕ нараховує час адвоката, але `ai_usage` пишеться завжди.
- **Без подвоєння:** §3 — критично; тест доводить однократність.

## 8. AI USAGE IMPLICATIONS
- **agentType:** приймається параметром; для proof-споживача — `qiParserDocument` (як зараз Triage; `document_parser` у логах).
- **resolveModel:** через нього, не hardcoded. Ієрархія user→tenant→system уже працює (`modelResolver.SYSTEM_DEFAULTS` + `user/tenant.modelPreferences`). `callAgent` лише викликає `resolveModel(agentType)` — НЕ змінює механізм.
- **Екран вибору моделі адвокатом (як у застосунку Claude) — борг #51, НЕ входить у B1.** Механізм перевизначення (`user.preferences.modelPreferences[agentType]`) уже готовий; бракує лише UI, що його запише. `callAgent` повністю сумісний: щойно з'явиться екран, його вибір підхопиться автоматично, без зміни парасолі.
- **logAiUsage context:** `{ caseId, module, operation }` — той самий формат, що наявні точки.
- **Tool Use чи текст:** `callAgent` підтримує обидва через `mode`; чат-агенти не мігруємо.

---

## 9. ТЕСТИ (обов'язково, npm test зелений)
Новий `tests/unit/callAgent.test.js`:
1. `mode:'text'` → кличе `callAPIWithRetry` з резолвленою моделлю; повертає `text`+`usage`.
2. `mode:'toolUse'` → кличе tool-use транспорт; повертає `toolResult`.
3. **Облік один раз:** застаблений sink ловить РІВНО ОДИН запис `ai_usage` на виклик (доказ проти подвоєння §3).
4. `billAsUserAction:false` → `activityTracker.report` НЕ викликається; `ai_usage` — викликається.
5. Помилка транспорту → облік у `try/catch` не валить; помилка проброшується наверх коректно.
6. `resolveModel` викликано з переданим `agentType` (не hardcoded).

Регресія proof-споживача: наявні Triage-тести (`dp-toc-detector`, `dp-enriched-digest`, `triageStage`) лишаються зеленими; план нарізки і лічильники токенів не змінились.

---

## 10. ACCEPTANCE CRITERIA
- [ ] `src/services/callAgent.js` існує; контракт §2; один сенс на параметр (#11).
- [ ] Резолв моделі — всередині `callAgent`, не в caller'а.
- [ ] Облік (`ai_usage` + опційно `activityTracker`) — у `callAgent`, у `try/catch`, **один раз** (доведено тестом).
- [ ] Proof-споживач (Triage) переведено; ручний облік з нього прибрано; поведінка і лічильники незмінні.
- [ ] Чат-агенти і 6 інших fetch-точок — НЕ торкані.
- [ ] `npm test` повністю зелений; додано `tests/unit/callAgent.test.js`.
- [ ] Рішення §3 (варіант А/Б) задокументовано коментарем на місці.

---

## 11. ОРІЄНТИРИ В КОДІ
- НОВЕ: `src/services/callAgent.js`.
- `src/services/toolUseRunner.js` — `callAPIWithRetry` (~333), `callAPIStreaming` (~541), `runToolUse` (~94), `runMultiTurnConversation` (~202), `logAiUsage` (~245, ризик подвоєння §3).
- `src/services/modelResolver.js` — `resolveModel`, `SYSTEM_DEFAULTS`.
- `src/services/aiUsageService.js` — `logAiUsage`, `logAiUsageViaSink`, `MODEL_PRICING`.
- `src/services/activityTracker.js` — `report`.
- `src/services/moduleNames.js` — `MODULES`, `categoryForCase`.
- PROOF: `src/services/documentBoundary/analyzeTriageViaToolUse.js` (ручний облік ~88-100 → прибрати).

---

## 12. HANDOFF / GIT
- Працювати на гілці, яку видасть harness (`claude/*`).
- Наприкінці: код + тести зелені + **створити PR** (для зручності рев'ю власником).
- Рев'ю: окрема свіжа сесія `/code-review high` по діфу; підсумок — в адмін-сесію на звірку з задумом.
- НЕ зводити в `main` без підтвердження (це зміна КОДУ, не лише документації — правило №1 CLAUDE.md).

---

**Кінець TASK B1.**
