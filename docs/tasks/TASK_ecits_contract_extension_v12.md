# TASK — Розширення контракту envelope ЄСІТС (schema 12)

**Тип:** спека для сесії-виконавця (адмін-сесія НЕ реалізує сама).
**Статус:** очікує затвердження адвоката → потім виконавець.
**Дата:** 2026-06-09
**Підстава:** запит сесії розширення `2026-06-09_contract_extension_request.md`
(прогін екстрактора на 50 реальних справах — поточний контракт вужчий за
дійсність). Поки контракт не розширено — розширення в DRY-RUN.
**Схема:** `CURRENT_SCHEMA_VERSION 11 → 12`, `MIGRATION_VERSION '12.0_ecits_roles_dates'`.

> Принцип: усі зміни **адитивні**, зворотно сумісні. Старі envelope (один
> `advocateRole`, 3 категорії, без дат і `likelyNotMine`) лишаються валідними.

---

## 0. Рішення в одному абзаці

Envelope і модель справи розширюються п'ятьма адитивними змінами. Ролі —
множинні (`advocateRoles[]` top-level на справі + `advocateRole` як головна).
Категорії — дві нові юрисдикції + `null`, з **мапінгом** envelope-словника на
case-словник (бо `admin`≡`administrative` — правило #11). Дати справи з кабінету
— у `ecitsState` (провенанс, щоб не плутати з `case.documents[]`). `likelyNotMine`
— **envelope-only** прапор: процесор такі справи не заводить, а повертає окремою
корзиною `pendingReview`; ImportTab показує опт-ін пікер «Можливо не ваші».
`validateEnvelope` лишається envelope-рівневим (не валить per-case enum).

---

## 1. Зміна 1 — Ролі: множинність + ширший словник

**Envelope (per-case):** додаються опційні `advocateRoles: string[]` і
лишається `advocateRole: string` (= головна/перша роль).

**Канонічний словник ролей (11):**
`plaintiff_rep, defendant_rep, third_party_rep, applicant_rep, victim_rep,
appellant_rep, interested_party_rep, defender, appellant, advocate,
representative_unspecified`.

**Зберігання (відповідь на питання (c)):** top-level поля справи
- `case.advocateRole: string | null` — головна роль;
- `case.advocateRoles: string[]` — повний набір.

Обґрунтування top-level (а не в `ecitsState`): процесуальна роль адвоката —
**стабільний атрибут справи** (AI-first: агент питає «яка моя роль у справі X»
прямо на справі), застосовний і до **ручних** справ у майбутньому, не лише
ЄСІТС. `ecitsState` — для transient sync-стану; класти туди стабільну роль =
другий сенс на полі (правило #11).

**Нормалізація (у `scenarioProcessor.buildCreateCaseParams`):**
```
advocateRoles = Array.isArray(ec.advocateRoles) && ec.advocateRoles.length
                  ? ec.advocateRoles
                  : (ec.advocateRole ? [ec.advocateRole] : []);
advocateRole  = advocateRoles[0] ?? ec.advocateRole ?? null;
```
Невідомі значення ролей **не валять імпорт** — проходять як є, але додаються в
`result.warnings` рядком (для ока адвоката). Експортувати `ADVOCATE_ROLE_VALUES`
(масив 11) для звірки/тестів.

---

## 2. Зміна 2 — Категорії: дві юрисдикції + null + мапінг словників

**Колізія словників (правило #11) — головне тут.** Поточний стан:
- `caseSchema.js:30` → `category enum ['civil','criminal','military','admin']`;
- envelope (promptBuilder) → `civil|criminal|administrative`.

`admin` (legacy, напр. `INITIAL_CASES` Манолюк, адмінсуд) **≡** envelope
`administrative` — **один сенс під двома іменами**. НЕ зберігати обидва.

**Envelope-словник категорій (контракт, 6):**
`civil | criminal | administrative | commercial | administrative_offense | null`.

**Case-словник категорій (зберігання, після мапінгу):**
`civil | criminal | military | admin | commercial | administrative_offense | null`.

**Мапа envelope→case (у `buildCreateCaseParams`, експортувати як
`ENVELOPE_TO_CASE_CATEGORY`):**
```
civil                 → civil
criminal              → criminal
administrative        → admin                  // звести до legacy-значення
commercial            → commercial             // нове
administrative_offense→ administrative_offense  // нове (≠ administrative!)
null / невідоме       → null  (+ warning якщо невідоме непорожнє)
```
> `administrative` (адмінсуд) і `administrative_offense` (справи про
> адмінправопорушення) — **різні** юрисдикції, не плутати.

**`caseSchema.js`:** розширити `category.enum` значеннями `commercial`,
`administrative_offense`; позначити nullable (`required:false`, опис «null =
потребує уточнення»). `military` лишається (legacy, у envelope не приходить).

**Відповідь на питання (b):** `null` заводиться без проблем. Уже зараз
`buildCreateCaseParams` робить `category: ec.category || null`, `create_case`
зберігає як є (`caseSchema` — описова, не enforced на запис). Дефолтне значення
НЕ потрібне: `null` = «категорія не визначена / потребує уточнення». Виконавцю:
перевірити, що UI/`contextGenerator` null-безпечні при відображенні категорії
(null-guard, не падати).

---

## 3. Зміна 3 — `likelyNotMine` + опт-ін пікер

**Envelope (per-case):** опційний `likelyNotMine: boolean` (екстрактор ставить
`true` для голого «Представник» → роль `representative_unspecified`). **Це
envelope-only поле — на створену справу НЕ зберігається** (після підтвердження
справа звичайна; зберігати прапор = непотрібний другий сенс).

**Потік (один прохід кабінету, без повторного скрейпінгу):**
1. `submitScenarioResult` **партиціонує** `data.cases`:
   - `auto` = `likelyNotMine !== true` → обробляються як зараз;
   - `deferred` = `likelyNotMine === true` → **НЕ обробляються**, повертаються
     повними об'єктами у `result.pendingReview: ecitsCase[]`.
2. `result` отримує `pendingReview` (НЕ рахується у `skipped` — окрема корзина).
3. **ImportTab** після сабміту, якщо `pendingReview.length` — рендерить секцію
   **«Можливо не ваші — оберіть, які додати»**: чекбокси (за замовчуванням усі
   зняті), кнопки «Додати обрані» / «Відхилити всі».
4. «Додати обрані» → виклик нового експорту
   `processDeferredCases(selectedEcitsCases, deps)` (та сама `processCase`-петля),
   результат мерджиться у показаний підсумок. Кабінет повторно НЕ обходиться —
   метадані вже в руках.

**Новий експорт у `scenarioProcessor.js`:**
`export async function processDeferredCases(ecitsCases, deps)` — приймає масив
сирих ecitsCase, ганяє той самий `processCase`, повертає
`{ casesCreated, casesUpdated, hearingsAdded, skipped, errors }`. Перевикористати
спільну внутрішню петлю (винести з `submitScenarioResult`, щоб не дублювати —
правило #11/DRY).

**Відповідь на питання (a):** назву `likelyNotMine` і механізм **підтверджую**.
В Legal BMS іншого механізму тріажу «на перевірку» для імпорту немає — пікер у
ImportTab (опт-ін, нічого не обрано за замовчуванням, один прохід) і є
правильний дім. Рекомендацію екстрактора «один прохід + корзина» приймаю (не
робимо другий скрейпінг — повільний, крихкий, ризик таймауту).

---

## 4. Зміна 4 — Дати справи зі списку

**Envelope (per-case):** опційні **top-level** (пласко, поряд з `case_no`/
`ecitsCaseId`, НЕ вкладено):
- `firstDocumentDate: string | null` — дата першого документа (довідково);
- `lastDocumentDate: string | null` — **дата останнього документа = сигнал
  активності** (ISO `yyyy-mm-dd`).

Екстрактор віддає їх **пласко**; ecitsState у envelope не конструює — це робить
Legal BMS (так само, як мапить `ecitsCaseId`→`ecitsState.caseId`,
`court`→`ecitsState.court`).

**Зберігання:** Legal BMS кладе у `ecitsState`:
- `ecitsState.firstDocumentDate: string | null`
- `ecitsState.lastDocumentDate: string | null`

Обґрунтування (правило #11): це **знімок зі списку кабінету ЄСІТС**, не власний
документообіг BMS. Top-level `case.lastDocumentDate` зіткнувся б за сенсом із
`case.documents[]` (документи самого BMS) — два сенси на схоже ім'я. У
`ecitsState` провенанс однозначний: «остання дата документа як її показує
кабінет». Рік справи й далі беремо **з номера** (`extractYearFromCaseNo`), не з
дати — надійніше (дати різняться на 1–3 дні).

**`buildDefaultEcitsState`:** додати `firstDocumentDate: null`,
`lastDocumentDate: null`. **`buildCreateCaseParams`:** прокинути обидві з
envelope у `ecitsState` (`?? null`).

---

## 5. Зміна 5 — Зворотна сумісність

- `validateEnvelope` **не чіпаємо на envelope-рівні** — воно й зараз не валідує
  per-case enum, тож масив ролей і нові значення **вже приймаються**, імпорт не
  падає. Додаємо лише експортовані словники-константи (`ADVOCATE_ROLE_VALUES`,
  `ENVELOPE_CATEGORY_VALUES`, `ENVELOPE_TO_CASE_CATEGORY`) для звірки/тестів.
  Невідомі значення → `warnings`, ніколи не throw.
- Старі envelope: `advocateRole` без `advocateRoles` → `advocateRoles=[role]`;
  3 категорії → мапляться; без дат/`likelyNotMine` → дефолти. Усе валідне.
- Нові поля справи nullable/default → існуючі справи мігрують у дефолти.
- **Версії envelope:** `envelopeVersion=1` і `scenarioVersion=1` — **НЕ бампимо**.
  Зміни адитивні (не breaking), тож версія лишається 1. Сигнал нових полів — їх
  наявність, не версія. Додатково: `validateEnvelope` пінить `envelopeVersion===1`
  (кидає на інше) — бамп без зміни валідатора зламав би імпорт. Бамп робимо лише
  при справді breaking-зміні (видалення/перейменування обов'язкового поля), тоді
  ж розширюємо валідатор на діапазон.

---

## 6. Міграція (schema 12)

- `CURRENT_SCHEMA_VERSION = 12`, `MIGRATION_VERSION = '12.0_ecits_roles_dates'`.
- **`migrateToVersion12(registry)`** (ідемпотентна, з бекапом `_backups/` поза
  ротацією + прапор проти повтору, як попередні кроки): для кожної справи —
  `advocateRole ??= null`; `advocateRoles`: якщо не масив → `advocateRole ?
  [advocateRole] : []`; у `ecitsState` (він уже є після v7) →
  `firstDocumentDate ??= null`, `lastDocumentDate ??= null`.
- **`ensureCaseSaasAndEcitsFields`** (точка нормалізації нових справ): додати ті
  ж дефолти (`advocateRole`, `advocateRoles`, дати в ecitsState через оновлений
  `buildDefaultEcitsState`).
- **`App.jsx` EFFECT-A:** додати крок `migrateToVersion12` у ланцюг після
  `migrateToVersion11` (власний бекап + прапор).
- Оновити CLAUDE.md розділ schemaVersion (рядок ланцюга міграцій).

---

## 7. Файли під зміну (карта для виконавця)

| Файл | Зміна |
|------|-------|
| `src/services/ecits/scenarioProcessor.js` | словники-константи; `buildCreateCaseParams` (ролі, мапа категорій, дати в ecitsState); партиціонування `likelyNotMine` + `result.pendingReview`; новий `processDeferredCases`; винести спільну петлю |
| `src/schemas/caseSchema.js` | `category.enum` +`commercial`,`administrative_offense`, nullable; нові `advocateRole`, `advocateRoles`; опис дат у `ecitsState` |
| `src/services/migrationService.js` | bump версій; `migrateToVersion12`; `buildDefaultEcitsState` +дві дати; `ensureCaseSaasAndEcitsFields` +дефолти |
| `src/App.jsx` | EFFECT-A: крок `migrateToVersion12` (бекап+прапор) |
| `src/components/CourtSync/ImportTab.jsx` | пікер «Можливо не ваші» (опт-ін) + виклик `processDeferredCases`, мердж результату |
| `CLAUDE.md` | оновити рядок ланцюга міграцій (schema 12) |
| `src/services/ecits/promptBuilder.js` | *(вторинне, Track A)* оновити шаблон envelope/словники під нові поля — щоб і Claude for Chrome давав сумісне; не блокує стенд розширення |

**`create_case` — без змін:** спредить `...merged`, нові top-level поля справи
зберігаються; `ensureCaseSaasAndEcitsFields` їх нормалізує. Якщо потрібно, щоб
агент міг **редагувати** ролі — окремий ACTION пізніше (не в цьому TASK).

---

## 8. Тести (обов'язково, перед комітом — `npm test` зелений)

- `tests/unit/scenarioProcessor.test.js`: `advocateRoles[]` (масив і fallback з
  одного), мапа категорій (`administrative→admin`, нові, null, невідоме→warning),
  дати в ecitsState, **партиціонування `likelyNotMine`** (не створюються,
  потрапляють у `pendingReview`), `processDeferredCases` (створює обрані).
  Зберегти прод-семантику тесту (read-after-write — окремий борг, не тут).
- `tests/unit/migrations.test.js`: `migrateToVersion12` ідемпотентність +
  дефолти на старих справах (з ecitsState і без).
- `tests/integration/court-sync-mvp.test.js`: наскрізний імпорт envelope з
  новими полями; зворотна сумісність старого envelope.
- (UI) тест ImportTab-пікера — рендер `pendingReview`, опт-ін, «Додати обрані».
- Звірка на **реальному envelope екстрактора** (50 справ) — як приймальний крок.

---

## 9. SAAS / BILLING / SEMANTIC CLARITY

**SAAS IMPLICATIONS.** Нові поля — case-рівневі, без дублювання `tenantId` у
вкладених. `advocateRoles` успадковує tenant справи. Пікер — той самий ImportTab,
без нового UI ролей/користувачів.

**BILLING IMPLICATIONS.** Обробка `likelyNotMine`-обраних іде тим самим
`create_case` з `origin='ecits_import'` → **виключено з білінгу** (як і авто-
імпорт). Пікер — дія адвоката, але створення лишається системним імпортом
(автосинхронізація). Нових точок інструментації немає.

**SEMANTIC CLARITY CHECK (правило #11).** Свідомо рознесено за провенансом і
сенсом: ролі — top-level (стабільний атрибут справи); дати кабінету — `ecitsState`
(знімок ЄСІТС, не плутати з `documents[]`); `likelyNotMine` — envelope-only
(import-time тріаж, не атрибут справи); `administrative`→`admin` (звести
дубль-сенс, не плодити друге ім'я); `administrative_offense` ≠ `administrative`
(різні юрисдикції — окремі значення). Кожне нове ім'я — один сенс.

---

## 10. Heads-up на горизонті (НЕ в цьому TASK — закладка)

**`window.LegalBMS.getCasesList()`** (двосторонній зв'язок, дзеркало
`submitScenarioResult`). Архітектурна закладка вже є: `extensionBridge.js` —
правильний шов. Коли дійде черга: додати метод у `enable()`-об'єкт поряд із
`submitScenarioResult`, віддавати зрізаний `CaseSummary[]` (форму, пагінацію,
мінімальні поля, окремий entitlement — узгодити за
`court_sync_algorithm_and_ui_settings.md §4.3`), без прямого доступу до state
(як `getEntitlements`). `apiLevel` бампнути при додаванні. Зараз — лише
зарезервувати, не реалізовувати.

---

## 11. Робастність envelope — без ручного перепакування (вимога адвоката, 2026-06-09)

**Контекст:** з Track A (Claude for Chrome) повторювалась проблема — чат видавав
неповний envelope (без `scenarioId`/обгортки `data`, `warnings` об'єктами замість
рядків → React error #31), і чат мусив перепаковувати JSON вручну. Розширення —
детермінований код, але Legal BMS має бути **толерантним на вході** і давати
**чіткі помилки**, а не падати. Мета: «майже правильний» envelope заводиться сам.

**Реалізувати (адитивно, не ламає валідні envelope):**

1. **`normalizeEnvelope(raw)` — новий чистий хелпер у `scenarioProcessor.js`,
   викликається ПЕРШИМ у `submitScenarioResult` (перед `validateEnvelope`).**
   Безпечні коерції з логуванням кожної правки у `result.warnings` (щоб було
   видно що підправили):
   - якщо `raw.data` відсутній, але `raw.cases` — масив на верхньому рівні →
     обгорнути у `data: { cases }` (точно та помилка, яку чат робив руками);
   - якщо `envelopeVersion`/`scenarioId`/`scenarioVersion` відсутні, але решта
     схожа на наш envelope → підставити канонічні дефолти (`1` /
     `'ecits_import_cases_and_hearings'` / `1`) + warning;
   - `data.warnings` — кожен елемент привести до **рядка** (об'єкт
     `{case_no,message}` → `"<case_no>: <message>"`). **Це прямо усуває React
     error #31.**
   - `data.skipped` — нормалізувати елементи до `{ case_no, reason }` (рядки).
   - `data.cases` — гарантувати масив (не падати, якщо `null`/відсутній).

2. **`validateEnvelope` — чіткіші, дієві помилки.** Лишається строгим шлюзом
   ПІСЛЯ нормалізації, але повідомлення мають точно називати чого бракує і
   підказку («схоже, відсутня обгортка `data` — очікується `{ envelopeVersion,
   scenarioId, data: { cases } }`»). Помилка показується в ImportTab текстом, не
   крашем.

3. **`ResultCard`/ImportTab — захист рендеру:** `warnings`/`skipped`/`errors`
   рендерити тільки як рядки (через coerce), щоб жоден об'єкт у цих полях ніколи
   не зронив модуль у заглушку.

4. **Єдине джерело контракту для розширення (анти-розсинхрон):**
   - експортувати з `scenarioProcessor.js` константи й приклад-скелет
     (`ENVELOPE_VERSION`, `SCENARIO_ID`, `SCENARIO_VERSION`, словники ролей/
     категорій, `buildEnvelopeSkeleton()` — повертає порожній валідний каркас);
   - додати **golden-fixture тест**: реальний envelope екстрактора (50 справ)
     лежить у `tests/fixtures/ecits_envelope_2026-06-09.json`, тест проганяє його
     через `normalizeEnvelope`+`validateEnvelope`+`submitScenarioResult` і
     фіксує, що нічого не перепаковується руками і нічого не втрачається;
   - сесія розширення **дзеркалить** цей самий скелет/словники у своєму коді
     (координація через `CONTEXT_for_extension_session.md §6` — оновити його
     новими полями), щоб генерувати 100%-сумісний envelope з першого разу.

**Тести робастності:** envelope без `data`-обгортки → нормалізується +warning, не
падає; `warnings` об'єктами → стають рядками, React не крашить; повністю битий
envelope (без cases) → чітка помилка в ImportTab, не заглушка.

---

## 12. Орієнтовний порядок/строки

1. Затвердження адвоката цієї спеки.
2. Виконавець: схема 12 + scenarioProcessor + caseSchema + міграція + ImportTab-
   пікер + тести — **орієнтовно один сеанс виконавця** (адитивно, добре
   локалізовано). Точну дату не фіксую (не контролюю розклад виконавця).
3. Приймальна звірка на реальному envelope екстрактора (50 справ).
4. Після зеленого стенду — dev/staging з доступним `window.LegalBMS.
   submitScenarioResult` для наскрізного реле. Розширення виходить з DRY-RUN.
