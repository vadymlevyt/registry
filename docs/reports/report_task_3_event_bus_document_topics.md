# REPORT — TASK 3: eventBus document-топіки

**Дата:** 15.05.2026
**Тип:** код-зміна, адитивний
**Статус:** виконано, чекає підтвердження на push у main (правило #1)

---

## ЩО ЗРОБЛЕНО

Два файли змінено (більше нічого не зачеплено):

### 1. `src/services/eventBusTopics.js`
- Додано константи: `DOCUMENT_INGESTED = 'document.ingested'`, `DOCUMENT_BATCH_PROCESSED = 'document.batch_processed'` — в **окремій секції з власним коментарем** одразу після v7-edit констант (після `DOCUMENT_ALTERNATIVE_SOURCE_ADDED`).
- Додано `DOCUMENT_TOPICS = Object.freeze([DOCUMENT_INGESTED, DOCUMENT_BATCH_PROCESSED, DOCUMENT_MOVEMENT_CARD_UPDATED, DOCUMENT_ALTERNATIVE_SOURCE_ADDED])` — паралельно `ECITS_TOPICS` / `V7_EDIT_TOPICS` (після `V7_EDIT_TOPICS`).
- Оновлено in-file header-коментар: додано рядок про TASK 3 топіки (інвентар файлу, щоб його власна документація не була застарілою — поширений doc-drift; це той самий файл, у scope; **CLAUDE.md НЕ чіпав**).

### 2. `tests/unit/canonicalSchemaV7.test.js`
- Імпорт: додано `DOCUMENT_INGESTED, DOCUMENT_BATCH_PROCESSED, DOCUMENT_TOPICS`.
- У наявний `describe('eventBusTopics — нові v7 топіки')` додано 2 `it`-блоки в існуючому стилі: перевірка значень двох констант + `DOCUMENT_TOPICS` frozen/length 4/contains 4 очікуваних.

---

## ВІДХИЛЕННЯ ВІД ПЛАНУ

**Одне, обґрунтоване (експертна автономія):**

План казав «після рядка 41 за іменуванням існуючих топіків». Буквально це поклало б `DOCUMENT_INGESTED`/`DOCUMENT_BATCH_PROCESSED` під коментар-блок (рядки 33-35) «Публікуються з **6 нових edit-ACTIONS** (R1 AI-first дзеркало)». Але ці два топіки **НЕ публікуються з тих 6 edit-ACTIONS** — це узагальнені lifecycle-події майбутнього DP v2.

**Що змінив:** виніс їх в окрему секцію з власним коментарем («Document lifecycle events (TASK 3, для DP v2)»), а не під edit-ACTIONS коментар.

**Чому краще:** інакше коментар читався б як такий, що описує і edit-ACTIONS-події, і lifecycle-події — один коментар, два сенси. Це дух правила #11 (однозначність) на рівні документації коду. Розташування все одно «після рядка 41 за іменуванням існуючих топіків» — просто з чесним заголовком секції.

**Вплив на наступні TASK'и:** позитивний / нейтральний. DP v2 (майбутній) публікуватиме `DOCUMENT_INGESTED`/`DOCUMENT_BATCH_PROCESSED` — секція явно це позначає. `DOCUMENT_TOPICS` має навмисний перетин із `V7_EDIT_TOPICS` (`movement_card`/`alternative_source` — і edit-, і document-події); це задокументовано коментарем біля масиву як «два незалежні зрізи однієї константи, не дубль сенсу», щоб майбутній розробник не сприйняв це за помилку.

Інших відхилень немає. In-file header-коментар оновив без окремого дозволу бо це той самий файл (не CLAUDE.md) і застарілий інвентар у ньому — рівно той клас doc-drift, який аудит фіксує; вважаю органічним у scope. Якщо вважаєте зайвим — приберу одним рядком.

---

## ACCEPTANCE CRITERIA — СТАТУС

| Критерій | Статус |
|----------|--------|
| Дві нові константи експортовані | ✅ `DOCUMENT_INGESTED`, `DOCUMENT_BATCH_PROCESSED` |
| Створено `DOCUMENT_TOPICS` frozen масив | ✅ `Object.freeze([...])`, 4 елементи |
| Жодної публікації / підписки в коді | ✅ grep `src/ tests/` — нові топіки лише у визначенні (`eventBusTopics.js`) і тесті; нуль `eventBus.publish`/`subscribe` |
| Усі тести зелені (`npm test`) | ✅ 1075 passed / 62 files |
| schemaVersion НЕ bump | ✅ не чіпав (це константи, не дані) |
| CLAUDE.md НЕ оновлював у цьому TASK | ✅ не чіпав |
| Жодних слухачів (Dashboard/billing) | ✅ не підключав |
| Правило #1 (підтвердження перед main) | ⏳ чекає — код-зміна, зведення нижче |

---

## ТЕСТИ: ДО / ПІСЛЯ

| | До | Після |
|--|----|----|
| Test files | 62 passed | 62 passed |
| Tests | 1073 passed | **1075 passed** (+2 нових `it`) |
| Статус | зелений | зелений |

Жодного існуючого тесту не зламано: `V7_EDIT_TOPICS` (toHaveLength 6) і `ECITS_TOPICS` (toHaveLength 6) не модифікувались, тому строгі length-асерції в `canonicalSchemaV7.test.js` і `courtSyncInfrastructure.test.js` лишились валідними.

---

## ПОБІЧНІ ЗНАХІДКИ

Немає нових. Раніше зафіксовані в `audit_before_dp1_v2.md` розділ 7 (doc-drift CLAUDE.md, колізія `source` тощо) — не в scope цього TASK, не чіпав.

---

## ПІДТВЕРДЖЕННЯ ЧИСТОТИ

`git status --short` показує рівно 2 модифіковані файли (`src/services/eventBusTopics.js`, `tests/unit/canonicalSchemaV7.test.js`) + цей звіт. Жодного іншого файлу не зачеплено. Нуль публікацій/підписок. Зміна суто адитивна — наявна поведінка не модифікована.
