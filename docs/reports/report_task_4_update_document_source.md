# REPORT — TASK 4: update_document_source ACTION

**Дата:** 15.05.2026
**Тип:** новий ACTION + permission (редукований обсяг після Кроку 0)
**Статус:** виконано, чекає підтвердження на push у main (правило #1 — код-зміна)

---

## РЕЗУЛЬТАТ АУДИТУ ОБСЯГУ (КРОК 0) — детально

Перевірено всі наявні v7 source-aware ACTIONS проти 3 сценаріїв із контексту TASK.

| Потреба / сценарій | Покрито наявним? | Чим |
|---|---|---|
| (c) Той самий документ прийшов другим каналом → зафіксувати alternativeSource | **ПОВНІСТЮ покрито** | `update_alternative_sources({caseId,documentId,alternativeSource})` — будує запис через `buildAlternativeSourceRecord`, append у `document.alternativeSources[]`, публікує `DOCUMENT_ALTERNATIVE_SOURCE_ADDED`, у `EDIT_ACTIONS_SOURCE_AWARE`, у `court_sync_agent` allowlist |
| (a) Адвокат перепомічає manual-документ як court_sync; (b) агент: «познач цей документ як з Telegram» — тобто **зміна `document.source`** (+sourceConfidence/extractedAt) | **НЕ покрито жодним ACTION** | `update_document` свідомо виключає source-поля (`ALLOWED_UPDATE_FIELDS` = name/category/author/documentNature/namingStatus/isKey/procId/driveUrl/folder/pageCount/date/icon/status/lastOcrAt — джерельних немає); `update_document_movement_card` міняє лише `movementCard`; `update_alternative_sources` лише **append** у `alternativeSources[]`, `document.source` не чіпає; `update_case_ecits_state` — case-level `ecitsState`, не документ |

**Висновок:** TASK 4 потрібний, але **редукованого обсягу**. Сценарій (c) уже працює — новий ACTION його **не дублює**, а **переюзовує** той самий механізм (`buildAlternativeSourceRecord` + `DOCUMENT_ALTERNATIVE_SOURCE_ADDED`) як fallback. Реальний доданий обсяг = одна операція «змінити `document.source` за політикою `canOverwrite`, інакше зафіксувати provenance». Не реалізація з нуля — композиція наявних примітивів (`canOverwrite`, `buildAlternativeSourceRecord`, event). Закриття без коду **не** легітимне (сценарії a/b справді не покриті).

## ЩО ЗРОБЛЕНО

Додано sync-ACTION `update_document_source` (за патерном `update_case_ecits_state`/`update_alternative_sources`), permission'и, членство в `EDIT_ACTIONS_SOURCE_AWARE`, дзеркало в harness, інтеграційні тести.

**Підпис:** `update_document_source({ caseId, documentId, source /*обов'язково*/, sourceConfidence?, extractedAt?, alternativeSource? })` → `{ success, overwriteSkipped }`.

## ФАЙЛИ МОДИФІКОВАНІ

| Файл | Зміни |
|------|-------|
| `src/App.jsx` | +ACTION `update_document_source` (після `update_alternative_sources`); +`'update_document_source'` у `EDIT_ACTIONS_SOURCE_AWARE`; +у `court_sync_agent` і `document_processor_agent` PERMISSIONS. **+69 рядків, лише адитивно** (`ALLOWED_UPDATE_FIELDS` `update_document` НЕ чіпав) |
| `tests/integration/_actionsHarness.js` | дзеркало App.jsx: +import `canOverwrite`/`buildAlternativeSourceRecord`; +ACTION (без eventBus — як решта v7 source-aware у harness); +permission'и. Ручна синхронізація — документований контракт harness (`tracking_debt.md` #3) |

## ФАЙЛИ СТВОРЕНІ

- `tests/integration/update_document_source.test.js` — 11 тестів (canOverwrite дозволено/заборонено, alternativeSource fallback, перший запис, permission gating ×4 агенти, валідація ×3).
- `docs/reports/report_task_4_update_document_source.md` — цей звіт.

## ЛОГІКА canOverwrite + alternativeSources

1. Знайти case+document; `existingSource = d.source ?? null`.
2. `canOverwrite(existingSource, source)`:
   - **true** (новий пріоритет вищий/рівний, або existing порожній) → перезаписати `source` (+ `sourceConfidence`/`extractedAt` якщо передані), `updatedAt`. `overwriteSkipped=false`.
   - **false** (нижчий пріоритет — напр. `manual`(100) ← `court_sync`(80)) → **source НЕ міняємо** (жодного auto-downgrade). `overwriteSkipped=true`. Якщо передано `alternativeSource` → `buildAlternativeSourceRecord` (або готовий запис якщо має `dataHash`) → append у `alternativeSources[]` (той самий механізм що `update_alternative_sources`). Без `alternativeSource` — просто пропуск.
3. Подія: лише на fallback-гілці → `DOCUMENT_ALTERNATIVE_SOURCE_ADDED` (дослівно як `update_alternative_sources`). На overwrite-гілці події немає (немає topic `document.source_updated`; не вигадуємо — поза scope, як `update_document` теж нічого не публікує).

## ВІДХИЛЕННЯ ВІД ПЛАНУ (з поясненнями)

1. **Редукований обсяг (Крок 0).** План описував повний ACTION; аудит показав що сценарій (c) уже покритий. Новий ACTION композує наявні примітиви, fallback дослівно переюзовує механізм `update_alternative_sources` (не дублює). **Краще:** нуль дублювання логіки/абстракцій (DRY тут — та сама операція, не хибна абстракція). **Вплив на DP v2:** DP v2 матиме один ACTION для зміни source + автоматичний provenance-fallback; не треба окремо комбінувати.
2. **Без `writeAudit` (план Крок 1 згадував «audit log»).** Уся v7 source-aware родина (`update_*_movement_card`/`_alternative_sources`/`_parties`/…) використовує **eventBus як audit-механізм** (eventBusTopics: «Підписники: … audit dashboards»), не `writeAudit`; `AUDIT_ACTIONS` (auditLogService) їх не містить. Додавати `writeAudit` = неконсистентно + `shouldAudit('update_document_source')` однаково false без зміни `AUDIT_ACTIONS` (поза scope). Тому audit реалізовано через eventBus як у сиблінгів.
3. **Крок 4 (toolDefinitions) пропущено — обґрунтовано.** `getToolsForAgent` повертає `[]` для `court_sync_agent` і `document_processor_agent`; **жоден** v7 source-aware ACTION не має tool-визначення (родина викликається через `executeAction`, не Tool Use). Додати tool тут = неконсистентно + передчасно (DP v2 заповнить `DOCUMENT_PROCESSOR_AGENT_TOOLS` пізніше). Не релевантно зараз.
4. **Нюанс canOverwrite — важливо для DP v2 (виношу явно).** Сценарій (a) контексту звучав як «перепомітити manual → court_sync». Але `canOverwrite('manual','court_sync')` = false (court_sync 80 < manual 100) — політика **правильно блокує downgrade**. Тому фактична поведінка: `source` лишається `'manual'`, а `court_sync` фіксується як **provenance** у `alternativeSources[]` (якщо передано `alternativeSource`). Інформація адвоката не втрачається — вона в provenance; `manual` (найвища довіра) не знижується автоматично. Це коректно за `discussion_dp_v2_philosophy_response.md` §Питання 2 (provenance ≠ conflict, no silent/auto overwrite). DP v2 має це враховувати: «перепомітка на нижчий пріоритет» = додавання provenance, не зміна primary source.
5. **eventBus/billing не тестуються через harness — як і вся родина.** Harness не реплікує eventBus і `EDIT_ACTIONS_SOURCE_AWARE`-білінг (його `executeAction` робить лише permission+dispatch). 6 сиблінг-ACTIONS теж не мають harness-тестів на eventBus/білінг. Покрито: структурний паритет з `update_alternative_sources` (reviewed v7 патерн) + членство в `EDIT_ACTIONS_SOURCE_AWARE` (code-inspectable). 11 harness-тестів покривають усі гілки canOverwrite/permission/валідації.

## ACCEPTANCE CRITERIA — СТАТУС

| Критерій | Статус |
|----------|--------|
| ACTION `update_document_source` у App.jsx з повною логікою | ✅ |
| `canOverwrite` інтегрований свідомо | ✅ overwrite vs fallback гілки |
| `alternativeSources` append коли overwrite неможливо | ✅ (за наявності `alternativeSource`), переюзує `buildAlternativeSourceRecord` |
| Permissions додано (court_sync_agent, document_processor_agent) | ✅ App.jsx + harness; metadata_extractor_agent НЕ чіпав (лишається `[]`) |
| `EDIT_ACTIONS_SOURCE_AWARE` містить новий ACTION | ✅ |
| Тести покривають усі гілки логіки | ✅ 11 тестів (canOverwrite±, fallback, перший запис, gating ×4, валідація ×3) |
| Усі попередні тести (1092+) зелені | ✅ 1092 → **1101** |
| Нові тести зелені | ✅ |
| `npm test` зелений | ✅ 66 files / 1101 tests |
| `npm run build` (CI parity) | ✅ build OK (chunk-size warning — пре-існуюче) |
| Правило #1 | ⏳ зведення, чекає підтвердження перед main |

## ТЕСТИ: ДО / ПІСЛЯ

| | До TASK 4 | Після |
|--|-----------|-------|
| Test files | 65 | 66 (+`update_document_source.test.js`) |
| Tests | 1092 | **1101** (+9) |
| Статус | зелений | зелений; build OK |

## ПІДТВЕРДЖЕННЯ НЕЗАЧЕПЛЕНОСТІ

`update_document` (`ALLOWED_UPDATE_FIELDS` — цілий, source-поля не додавав; by-design обмеження збережено), `update_document_movement_card`, `update_alternative_sources`, `update_case_ecits_state` — **не зачеплені** (git diff: лише адитивні вставки; нові рядки після `update_alternative_sources`, нові елементи в Set/allowlist). `sourcePolicy.canOverwrite`/`buildAlternativeSourceRecord` — використано як є, не змінено. `metadata_extractor_agent` лишається disabled (`[]`). Нових eventBus-топіків не створював; `DOCUMENT_INGESTED`/`DOCUMENT_BATCH_PROCESSED` не публікував. Не змішано з TASK 5. CLAUDE.md не редагувався.
