# REPORT — representedParties + ручне редагування назви/клієнта + nameSource

**TASK:** `docs/tasks/TASK_represented_parties_and_manual_edit.md`
**Дата:** 2026-06-11
**Гілка:** `feat/represented-parties-name-source` (від `origin/main` e225507)
**Статус:** реалізовано повністю, `npm test` зелений (169 файлів / 2175 тестів), `npm run build` проходить.

---

## 1. Що зроблено (за спекою §2–§5)

### §2 — нове поле `case.nameSource: 'auto' | 'manual'`

Один сенс (правило #11): **хто востаннє визначив name/client — система чи людина руками.**
Одне розрізнення для name+client РАЗОМ (не по прапору на поле). БЕЗ schema bump —
адитивне поле з лінивим дефолтом у двох точках:

- `migrationService.js` → `ensureCaseSaasAndEcitsFields`: явне значення зберігається;
  інакше `name.startsWith('[ЄСІТС] ')` → `'auto'`, інакше `'manual'` (консервативно).
  Діє лише для НОВИХ справ (create_case / scenarioProcessor) — справи з Drive
  не матеріалізують поле при load (formal-міграції НЕМАЄ, як вимагала спека).
- `scenarioProcessor.js` → `effectiveNameSource(existing)` (експортований хелпер):
  той самий лінивий дефолт при UPDATE-рішенні для справ без поля.

### §3 — Зміна A: CREATE зі списком сторін

`scenarioProcessor.js`:
- Нові експортовані хелпери `resolveRepresentedParties(ecitsCase)` (representedParties[]
  з пріоритетом, fallback primaryParty, фільтр сміття) і `buildCaseIdentity(ecitsCase)` —
  ОДНА точка шаблону `[ЄСІТС] <сторона1, сторона2> (<case_no>)` для CREATE і UPDATE.
- `buildCreateCaseParams`: name/client зі списку; `nameSource:'auto'`;
  `representedPartiesFullNames[]` зберігається top-level на справі (для майбутнього
  backfill canonical parties[]; додається лише коли непорожній — старі envelope без змін).
  Canonical `parties[]` НЕ зачеплено.

### §4 — Зміна B: UPDATE існуючої справи

`scenarioProcessor.js` → `maybeUpdateAutoIdentity(...)`, викликається у `processCase`
в ОБОХ гілках existing (звичайний матч за case_no + гілка гонки duplicate_case_no):
- гейт 1: envelope-кейс приніс непорожній `representedParties[]` (старі envelope —
  поведінка незмінна);
- гейт 2: `effectiveNameSource(existing) === 'auto'`; `'manual'` → name/client
  НЕ чіпаються ЗА ЖОДНИХ умов (лише ecitsState як раніше);
- ідемпотентність: якщо name/client вже актуальні — виклику немає;
- оновлення йде ЧЕРЕЗ `executeAction` (не обхід) — див. новий ACTION нижче;
  `nameSource` лишається `'auto'` (court_sync НЕ перемикає на manual).

Приймальні кейси покриті інтеграційно: Бабенки (`[ЄСІТС] 757/9362/25-ц` без імені →
з іменами, включно з нормалізацією суфікса `-ц`), Махді (`[ЄСІТС] Пироженко Є.В.
(363/4635/25)` → `[ЄСІТС] Махді А.С. (363/4635/25)`).

### НОВИЙ ACTION — `update_case_identity` (рішення виконавця за спекою §4)

Спека давала вибір: `update_case_field` двічі АБО компактний `update_case_identity`.
Обрано **`update_case_identity({caseId, name, client, nameSource, source})`**, бо:
- атомарно (один setCases на name+client+nameSource, один updatedAt);
- НЕ розширює сенс `update_case_field` (та дія лишається людською правкою і сама
  ставить `nameSource:'manual'` — два наміри не нашаровуються на одне ім'я, правило #11);
- не відкриває court_sync_agent'у весь allowlist полів update_case_field (status, court…).

Контракт: `source` обов'язковий; `nameSource` опційний, валідується `'auto'|'manual'`;
порожній `name` відхиляється; потрібен хоча б один із name/client.

### §5 — Зміна C: inline-редагування name/client (UI)

- Новий спільний компонент **`src/components/UI/InlineEditableText.jsx`** (+ CSS на
  токенах `tokens.css`, нуль inline-кольорів): клік по тексту або іконці ✎ → input
  з курсором → Enter/blur зберігає, Esc скасовує; незмінене значення не зберігається;
  `allowEmpty=false` для name (не можна стерти назву), client можна очистити.
- **CaseModal (App.jsx)**: name (modal-title) і client (modal-sub) стали
  inline-editable. Збереження: `executeAction('qi_agent', 'update_case_field',
  {caseId, field, value})` — дія сама ставить `nameSource:'manual'`. У render-точку
  CaseModal тепер передається ЖИВИЙ об'єкт справи з `cases[]` (не снапшот `selected`),
  щоб правка одразу відображалась.
- Тільки name + client (інші поля — наявна форма редагування, поза scope).

## 2. Супутні зміни (в межах наміру спеки)

- **`update_case_field`** (actionsRegistry): для `field ∈ {name, client}` виставляє
  `nameSource:'manual'` у тому самому setCases. Обґрунтування: court_sync_agent цієї
  дії не має (його шлях — update_case_identity), тож будь-який виклик
  update_case_field на name/client — людська правка (UI або агент від імені адвоката).
  Це і є механізм захисту зі спеки §2.
- **`saveCaseEdit`** (App.jsx, наявна форма «Редагувати справу»): якщо у формі
  змінено name або client — `nameSource:'manual'`; інакше попередній `nameSource`
  зберігається (форма його не містить і раніше мовчки губила б).
- **PERMISSIONS**: `court_sync_agent` + `update_case_identity` (13 дій).
  `update_case_field` йому як і раніше ЗАБОРОНЕНИЙ (перевірено тестом).

## 3. SAAS IMPLICATIONS

- Нове поле `case.nameSource` — атрибут справи, успадковує tenant-ізоляцію справи
  (без власного tenantId, як інші скалярні поля). `representedPartiesFullNames[]` —
  так само.
- `update_case_identity` іде через повний executeAction-pipeline: PERMISSIONS
  allowlist → checkTenantAccess → checkRolePermission → checkCaseAccess.
- Multi-user: «ручне святе» діє на рівні справи (одне поле на справу), що відповідає
  рішенню спеки про одне розрізнення.

## 4. BILLING IMPLICATIONS

- `update_case_identity` додано в `EDIT_ACTIONS_SOURCE_AWARE`: виклики з
  `source='court_sync'` (автосинхронізація) НЕ нараховуються у time_entries
  (перевірено тестом через trackerCalls); гіпотетичний виклик із `source='manual'`
  нараховувався б як робота адвоката.
- Inline-правка через `update_case_field` нараховується як і раніше (generic
  executeAction-hook) — людська дія.
- AI не викликається — ai_usage без змін.

## 5. Тести (нові)

- `tests/unit/scenarioProcessor.test.js` (+18): resolveRepresentedParties /
  buildCaseIdentity / effectiveNameSource; buildCreateCaseParams (список / один /
  без сторін / старий envelope / fullNames); UPDATE-сценарії через mock executeAction
  (Бабенки, Махді, manual-захист, без nameSource за префіксом, старий envelope,
  ідемпотентність, court_sync не ставить manual).
- `tests/integration/represented-parties.test.js` (16, на РЕАЛЬНОМУ createActions):
  CREATE A; UPDATE B (Бабенки з суфіксом `-ц`, Махді, manual untouched, legacy-manual
  за префіксом, старий envelope, білінг-виключення); C (update_case_field(name|client)
  → manual → наступний імпорт НЕ перезаписав; court не чіпає nameSource); PERMISSIONS
  (court_sync ✓ identity / ✗ case_field) + валідація контракту; лінивий дефолт
  ensureCaseSaasAndEcitsFields.
- `tests/unit/InlineEditableText.test.jsx` (9): рендер/placeholder/клік→input/
  Enter/blur/Esc/без-змін/allowEmpty обидва режими.

`npm test`: **169 файлів / 2175 тестів — зелено.** `npm run build` — проходить.

## 6. Межі — дотримано

- nameSource='manual' НІКОЛИ не перезаписується автоматично (гейт + тести).
- Canonical `parties[]`/`processParticipants` НЕ зачеплені (тест: parties лишаються []).
- schemaVersion / envelopeVersion НЕ бампнуто.
- Старі envelope (без representedParties) — поведінка незмінна (тести CREATE і UPDATE).

## 7. Файли

| Файл | Зміна |
|------|-------|
| `src/services/ecits/scenarioProcessor.js` | хелпери + CREATE зі списком + UPDATE identity |
| `src/services/actionsRegistry.js` | ACTION `update_case_identity`; `update_case_field` → nameSource manual; PERMISSIONS; EDIT_ACTIONS_SOURCE_AWARE |
| `src/services/migrationService.js` | лінивий дефолт nameSource у ensureCaseSaasAndEcitsFields |
| `src/components/UI/InlineEditableText.jsx` + `.css` + `index.js` | новий UI-компонент |
| `src/App.jsx` | CaseModal inline-edit; живий c у render; saveCaseEdit nameSource |
| `tests/…` | 3 файли тестів (нові/доповнені) |

## 8. Здача

Гілка: **`feat/represented-parties-name-source`** — запушена, НЕ змержена в main.
Очікує: адмін-звірка діфа зі спекою → одне-реченнєве «ок» адвоката → FF у main.
