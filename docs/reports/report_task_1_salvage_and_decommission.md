# REPORT — TASK 1: Salvage-and-decommission старого DocumentProcessor

**Дата:** 15.05.2026
**Тип:** код-зміна (salvage + delete + версіонування), один цілісний TASK з 3 фазами
**Статус:** виконано, чекає підтвердження на push у main (правило #1 — код-зміна)

---

## ЩО ЗРОБЛЕНО ПО ФАЗАХ

### Фаза A — Salvage (трансплантація)
Чисті органи витягнуто зі старого DP у нові сервіси **перед** видаленням оболонки. Окремий коміт `b3b847f` (старий DP ще присутній — це pre-deletion handle).

- **`src/services/compressionService.js`** ← `compressPDF` (`DocumentProcessor/index.jsx:143-151`) **дослівно** тіло, named export `compressPdf(arrayBuffer)`. Чиста функція, без React/UI/мережі.
- **`src/services/documentBoundary/splitPdf.js`** ← `splitPDFByDocuments` (`:108-141`) **дослівно** алгоритм (рядки 110-140). Єдина адаптація: приймає `arrayBuffer` замість `File` (сервіс чистий; File — турбота caller'а).
- **`src/services/documentBoundary/prompt.js`** ← AI-промпт (`:189-222`) **дослівно**, `buildBoundaryPrompt(userHint)`. Шаблон + інтерполяція hint точно як legacy (включно з кінцевим пробілом після «справи.» при порожньому hint).
- **`src/services/documentBoundary/analyzeViaToolUse.js`** ← `analyzePDFWithDocumentBlock` (`:155-264`). **Дослівно:** base64-кодування, `resolveModel('documentProcessor')`, білінг (`logAiUsageViaSink` + `activityTracker.report('agent_call', document_parser/parse_document)`), JSON-clean+parse. **Переписано:** транспорт — прямий `fetch api.anthropic.com` + ручна `response.ok` → `toolUseRunner.callAPIWithRetry` (retry 429/5xx, friendly-errors).
- **`src/services/documentBoundary/index.js`** — фасад `detectBoundaries()` / `splitByBoundaries()`; контракт propose→confirm задокументовано.
- **Паритет-тести:** `tests/unit/compressionService.test.js` (3), `tests/unit/documentBoundary.test.js` (5, з промпт-снапшотом дослівно).

### Фаза B — Decommission (після зелених паритет-тестів)
- Видалено каталог `src/components/DocumentProcessor/` (`git rm`, єдиний файл `index.jsx`, 1204 рядки).
- `CaseDossier/index.jsx` — 4 точкові правки: видалено import (`:2`), видалено `Wrench` з icon-імпорту (`:21` — більше ніде не вживається), видалено таб-запис (`:2650`), видалено рендер-гард (`:2714-2726`). Заглушка таба не потрібна.
- `tests/integration/document-processor.test.js` — **залишено як є** (підтверджено: імпортує лише `createDocument`+`createHarness`, тестує `document_processor_agent` через `_actionsHarness`, компонент не імпортує — видалення не ламає).
- `grep -rn DocumentProcessor src/ tests/` — **нуль код-залежностей**; лишилися тільки текстові згадки (провенанс-коментарі нових salvage-файлів + пре-існуючі коментарі/описи).

### Фаза C — Версіонування
- **Тег `pre-dp-v2-old-dp-removal`** поставлено на pre-deletion коміт **`b3b847f8b5bb0928674470fc2a54bde366667bdb`** (Фаза A; старий DP там ще цілий). Звіряння під час DP v2: `git show pre-dp-v2-old-dp-removal:src/components/DocumentProcessor/index.jsx`.
- `CLAUDE.md` таблиця «Точки створення документа» — видалено 2 рядки про `DocumentProcessor` (`:804-822`, `:955-963`). Інших змін у CLAUDE.md не робив.
- `tracking_debt.md` — додано записи #4 (косметичні текстові згадки) і #5 (clamp-розбіжність legacy split → рішення DP v2).

---

## ФАЙЛИ

**Створено (7):** `src/services/compressionService.js`, `src/services/documentBoundary/{index,splitPdf,prompt,analyzeViaToolUse}.js`, `tests/unit/{compressionService,documentBoundary}.test.js`.
**Видалено (1):** `src/components/DocumentProcessor/index.jsx` (каталог `DocumentProcessor/`).
**Модифіковано (3):** `src/components/CaseDossier/index.jsx` (4 правки), `CLAUDE.md` (-2 рядки таблиці), `tracking_debt.md` (+2 записи). Плюс цей звіт.

---

## ВІДХИЛЕННЯ ВІД ПЛАНУ (з поясненнями)

1. **`documentBoundary` — чистий сервіс без `executeAction`/Drive (не «переписано через executeAction», а навмисно НЕ перенесено).**
   План A.3 казав `updateCase`/`driveRequest` «переписуються через executeAction/стандартний шар». Але споживача нема (старий DP видаляється, DP v2 не існує), а сервіс не може імпортувати `executeAction` (він прокидається пропом — це територія TASK 5). **Рішення:** salvage-модуль чистий (detect/split → повертає PDF у пам'яті); обхід шару (`driveRequest`/`updateCase`) свідомо **не трансплантовано** — це і є патологія заради якої зноситься старий DP; propose→confirm збережено як **двокроковий контракт API** + задокументовано. **Чому краще:** відповідає рамці «DP v2 — тонкий диригент, сервіси чисті» (`discussion_dp_v2_philosophy_response.md` §6) і аудиту §5.2 (який і спроєктував модуль без executeAction). **Вплив на наступні:** DP v2 (майбутній) робитиме персистенцію через `executeAction('document_processor_agent','add_documents')`; TASK 5 (ActionsRegistry) лишається передумовою DP v2 як і планувалось. Це не звуження — це коректне читання salvage-без-споживача; виношу явно щоб ви могли поправити якщо намір був інший.

2. **`splitPdf` приймає `arrayBuffer`, не `File`.** Legacy `splitPDFByDocuments(file, ...)` робив `await file.arrayBuffer()`. Сервіс має бути чистим — робота з `File` це UI-рівень. Алгоритм (рядки 110-140) лишився байт-у-байт. Косметична адаптація, дозволена клаузою автономії.

3. **`Wrench` прибрано з icon-імпорту CaseDossier (`:21`).** План явно називав 3 правки (import/таб/гард). Після видалення таба `Wrench` ніде не вживається → лишити його в імпорті = мертвий код (проти філософії). Прибрав як 4-ту правку — органічно в scope чистого decommission.

4. **`tracking_debt.md`: записи #4 і #5, не «#2».** TASK казав «тригер запису #2». Але наявний #2 у `tracking_debt.md` — інша сутність (повнота дайджесту при schema bump). Перезаписувати валідний запис = тихе злиття двох сутностей (порушення #11). **Рішення:** додав нові #4 (косметичні згадки) і #5 (clamp-розбіжність), не чіпаючи #2. Виношу явно.

5. **In-file header CLAUDE.md / інші згадки — НЕ чіпав.** Тільки 2 рядки таблиці, як вимагав TASK. Решта (stale line-numbers інших рядків таблиці, текстові згадки в коментарях) — поза scope (audit §7 / окремий doc-TASK), зафіксовано в `tracking_debt.md` #4.

---

## РІШЕННЯ ПРО `getMimeType` (A.4)

**НЕ трансплантовано.** `grep` показав: `getMimeType` (`DocumentProcessor/index.jsx:266-276`) вживається лише на `:682` у `saveFilesToStorage` — це upload/storage-шлях, який **не входить у salvage** (salvage = `compressPDF`/`splitPDFByDocuments`/`analyzePDFWithDocumentBlock`). Жодна трансплантована функція `getMimeType` не використовує. Переносити = створити другу мапу MIME поряд з `converterService` (`IMAGE_EXT_TO_MIME`, `canConvert`) → два джерела істини, порушення #11. Рішення: не переносити; MIME у новому світі належить `converterService`.

---

## ACCEPTANCE CRITERIA — СТАТУС

**Фаза A:** ✅ `compressionService.js` (`compressPdf`); ✅ `documentBoundary/` з 4 файлами (index, splitPdf, prompt, analyzeViaToolUse); ✅ паритет-тести compressionService зелені (3); ✅ паритет-тести documentBoundary зелені (5); ✅ снапшот промпту = legacy дослівно (тест проходить).
**Фаза B:** ✅ каталог `DocumentProcessor/` видалено; ✅ правки в CaseDossier (4, не 3 — +Wrench, обґрунтовано); ✅ grep підтверджує нуль код-залежностей; ✅ `npm test` зелений.
**Фаза C:** ✅ тег `pre-dp-v2-old-dp-removal` на pre-deletion коміт `b3b847f`; ✅ CLAUDE.md таблиця оновлена (-2 рядки).
**Загальне:** ✅ всі тести зелені; ⏳ правило #1 — зведення нижче, чекає підтвердження перед main.

---

## ТЕСТИ: ДО / ПІСЛЯ

| | До TASK 1 | Після Фази A | Після Фази B/C |
|--|-----------|--------------|----------------|
| Test files | 62 | 64 | 64 |
| Tests | 1075 | **1083** (+8 паритетних) | **1083** |
| Статус | зелений | зелений | зелений |

Видалення компонента не зламало жодного тесту (`document-processor.test.js` працює на рівні ACTION через harness, не імпортує компонент — підтверджено).

---

## ТЕГ

`pre-dp-v2-old-dp-removal` → коміт **`b3b847f8b5bb0928674470fc2a54bde366667bdb`** (Фаза A, старий DP ще присутній). Локально створено; пушиться разом з гілкою (push тега не тригерить деплой — лише push у `main` тригерить, per CLAUDE.md CI).

---

## ПОБІЧНІ ЗНАХІДКИ

1. **Дублікат логіки нарізки в legacy:** `splitPDFByDocuments` (`:108-141`) і inline-копія в `handleSplit` (`:880-914`) — майже ідентичні, але `handleSplit` мав `Math.max(0, doc.startPage - 1)` (захист від негативного startIdx), а `splitPDFByDocuments` — ні. Перенесено `:108-141` дослівно (як інструктовано); розбіжність **не злита тихо** → `tracking_debt.md` #5 (тригер: коли DP v2 підключатиме `documentBoundary` — обрати канонічний clamp). Не «виправлення знахідки», а свідома фіксація відкладеного рішення.
2. **`caseSchema.js:78`** опис `lastProcessingContext` згадує `DocumentProcessor` — поле лишається валідним (його пише ACTION `update_processing_context`, не компонент), стале лише формулювання → `tracking_debt.md` #4.

Інших знахідок немає. Знахідки audit §7 — не в scope, не чіпав.

---

## ПІДТВЕРДЖЕННЯ ЧИСТОТИ

Зачеплено рівно: 7 створених + 1 видалений + 3 модифіковані файли + цей звіт. `converterService`/`sortation`/`ocr` не чіпав. Нових ACTIONS/permissions/eventBus-подій не додавав. `source`-перейменувань не робив. DP v2 не починав. INITIAL_CASES/Брановський — підтверджено decoupled (`App.jsx:124-135`, через `createDocument({addedBy:'system'})`), не змінював. Білінг-інструментація парсера збережена дослівно в `analyzeViaToolUse.js`.
