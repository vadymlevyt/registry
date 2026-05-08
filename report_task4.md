# Звіт TASK 4 — Test Infrastructure (Vitest + 180 тестів + CI блокування)

**Дата:** 2026-05-08
**Виконавець:** Claude Code (Opus 4.7, 1M context)
**Статус:** Завершено. 180/180 тестів зелені, повний прогон 2.9с, білд чистий, CI/CD блокує деплой при red тестах.

---

## Резюме TASK 4

Налаштована повноцінна тестова інфраструктура на Vitest. Існуючі sanity-tests (TASK 2 + TASK 3 — ~301 assertion) переформатовано у структурні `describe/it/expect` блоки і розділено на 6 unit-файлів і 4 integration-файли. Додано GitHub Actions test job, який блокує build і deploy якщо хоча б один тест червоний. Документацію (CLAUDE.md розділ "ТЕСТУВАННЯ", DEVELOPMENT_PHILOSOPHY.md розділ "ТЕСТИ РАЗОМ З КОДОМ") оновлено. Старі `scripts/sanity_test_*.mjs` видалено.

Інфраструктура готова — кожен наступний TASK додаватиме тести у вже існуючу структуру.

---

## Реалізація з TASK

| Підзадача | Статус | Результат |
|-----------|--------|-----------|
| 4.1 Vitest install + config | ✓ | `vitest@4.1.5`, `@vitest/ui@4.1.5` у devDependencies; `vitest.config.js` (Node env, threads, 10c timeout, CI json reporter); 3 npm scripts (`test`, `test:watch`, `test:ui`). |
| 4.2 Unit-тести — 6 файлів | ✓ | 149 тестів (documentFactory 22, documentSchema 19, documentsExtended 10, migrations 17, toolDefinitions 56, toolUseRunner 25). |
| 4.3 Integration-тести — 4 файли | ✓ | 31 тест (actions 13, drag-n-drop 5, agent-workflow 5, document-processor 7) + спільний harness. |
| 4.4 CI/CD test job | ✓ | `.github/workflows/deploy.yml` має `test → build → deploy` ланцюг. Test job блокує build і deploy. |
| 4.5 Документація + видалення sanity | ✓ | CLAUDE.md розділ "ТЕСТУВАННЯ"; DEVELOPMENT_PHILOSOPHY.md розділ "ТЕСТИ РАЗОМ З КОДОМ"; 5 sanity-mjs видалено. |

---

## Створені файли

### Конфіг
| Файл | Призначення |
|------|-------------|
| `vitest.config.js` | Конфіг Vitest (Node env, threads pool, 10с timeout, json reporter у CI). |

### Юніт-тести (6 файлів, 149 тестів)
| Файл | Тестів | Покриває |
|------|--------|----------|
| `tests/unit/documentFactory.test.js` | 22 | createDocument (defaults, унікальні id, detectNature, icon picker), validateDocument, needsReview, getMissingCriticalFields. |
| `tests/unit/documentSchema.test.js` | 19 | CANONICAL_DOCUMENT_FIELDS (20 полів — лове реальність, не CLAUDE.md "18"), EXTENDED (7 полів), CRITICAL_FIELDS_FOR_WARNING, CURRENT_SCHEMA_VERSION=5, валідність енумів. |
| `tests/unit/documentsExtended.test.js` | 10 | loadExtendedForCase (з мокнутим Drive API через vi.mock), saveExtendedForCase round-trip, getExtendedForDocument дефолти, setExtendedForDocument мердж, deleteExtendedForDocument, in-memory cache. |
| `tests/unit/migrations.test.js` | 17 | splitDocumentV4toV5 (number→string id, opp→opponent normalize, тег "key"→isKey, scanned→documentNature, legacy date text→customFields), migrateRegistryV4toV5 (ідемпотентність, schemaVersion 4→5, extendedByCase). |
| `tests/unit/toolDefinitions.test.js` | 56 | required fields, енами sync зі схемою, відсутність масивних type, відсутність дублікатів name, синхронізація з PERMISSIONS.dossier_agent у App.jsx (читається через fs.readFileSync), описи дискримінують tools. |
| `tests/unit/toolUseRunner.test.js` | 25 | runToolUse (text-only, single/multi tool_use, error handling, exception handling, caseId protection 4-кейси), runMultiTurnConversation (2 турна, maxTurns truncation, мережева помилка, ai_usage per-turn, Edge A), callAPIWithRetry (success, no apiKey, 401, 400, 429 з/без Retry-After, 500, max retries, network). |

### Інтеграційні тести (4 файли, 31 тест)
| Файл | Тестів | Покриває |
|------|--------|----------|
| `tests/integration/_actionsHarness.js` | (не тест) | Спільний harness: повторює PERMISSIONS, UI_ONLY_ACTIONS, executeAction, ACTIONS subset (create_case, update_case_field, close/restore, hearings, deadlines, notes, документи, провадження, update_processing_context). Поки ACTIONS не винесено в окремий модуль — це джерело потенційного дрейфу. |
| `tests/integration/actions.test.js` | 13 | executeAction з реальним PERMISSIONS: add_document успіх/блок/невалідний/дубль; add_documents batch + атомарність + DP block create_case; update_document allowed/forbidden field; delete_document UI-only через _fromUI; add_hearing dossier+dashboard. |
| `tests/integration/drag-n-drop.test.js` | 5 | Симуляція drag-n-drop циклу: 1 файл з ⚠ маркером, 3 файли по черзі (race-safe), один upload падає, offline (driveId=null), TASK 2 patch — update_case_field 'documents' заблоковано. |
| `tests/integration/agent-workflow.test.js` | 5 | end-to-end Tool Use: single add_hearing, 3 паралельні дії в одному турні, caseId protection (модель передає WRONG_CASE_ID → перезапис), Edge A (tool fails → модель адаптується), PERMISSIONS блокування add_documents для dossier_agent. |
| `tests/integration/document-processor.test.js` | 7 | document_processor_agent контракт: add_documents успіх, атомарність, дублі, блок create_case і add_hearing, update_processing_context з валідним/невалідним context. |

### Документація
| Файл | Призначення |
|------|-------------|
| `discovered_issues_during_task4.md` | Знахідки під час міграції (ACTIONS refactor рекомендація, 18 vs 20 поля schema, Vitest 4.x deprecation). |
| `report_task4.md` | Цей звіт. |

---

## Змінені файли

- **`package.json`** — `vitest` + `@vitest/ui` у devDependencies; 3 нові scripts (`test`, `test:watch`, `test:ui`).
- **`package-lock.json`** — оновлено для нових пакетів.
- **`.github/workflows/deploy.yml`** — додано `test` job як `needs:` для `build`. Послідовність: test → build → deploy.
- **`CLAUDE.md`** — новий розділ "## ТЕСТУВАННЯ" перед "## ПОТОЧНИЙ СТАН СИСТЕМИ" (команди, структура, правило для нових TASK, CI/CD блокування). Додано "Test Infrastructure (2026-05-08)" у "Завершено".
- **`DEVELOPMENT_PHILOSOPHY.md`** — новий розділ "## ТЕСТИ РАЗОМ З КОДОМ" перед "## ПРИНЦИП DELTA".

## Видалені файли

- `scripts/sanity_test_task2.mjs`
- `scripts/sanity_test_task3_basic.mjs`
- `scripts/sanity_test_task3_multiturn.mjs`
- `scripts/sanity_test_task3_tooldefs.mjs`
- `scripts/sanity_test_task3_integration.mjs`
- (директорія `scripts/` тепер порожня → видалена)

---

## Покриття тестами

| Модуль | Юніт | Інтеграція |
|--------|------|------------|
| `documentFactory.js` | 22 | (через драг-н-дроп) |
| `schemas/documentSchema.js` | 19 | — |
| `documentsExtended.js` (з мок-Drive) | 10 | — |
| `migrations/v4ToV5.js` | 17 | — |
| `toolDefinitions.js` | 56 | (через agent-workflow) |
| `toolUseRunner.js` | 25 | 5 (agent-workflow) |
| ACTIONS / executeAction (через harness) | — | 13 |
| Drag-n-drop workflow | — | 5 |
| Document Processor agent | — | 7 |
| **Сумарно** | **149** | **31** |

**Загалом:** 180 тестів.

---

## Час виконання

`npm test` (повний прогон): **2.9 секунди** (transform 1.12s, import 2.48s, tests 1.88s).

Один `callAPIWithRetry` тест включає реальний таймер `1010ms` для Retry-After (header вказав 1с) — це нормально, бо перевіряємо саме респект до header. Не сповільнює інші тести бо паралельний прогон.

---

## CI/CD статус

`.github/workflows/deploy.yml` тепер:
1. **test** job — `npm ci && npm test`. Якщо хоч один тест червоний — fail.
2. **build** job — `needs: test`, не запускається якщо test fail.
3. **deploy** job — `needs: build`, не публікує артефакти якщо build fail.

При push на main — автоматичний прогон тестів. Деплой на сайт йде лише якщо все зелене.

---

## Відхилення від TASK з обґрунтуванням

1. **ACTIONS не винесено в `src/services/actionsRegistry.js`** (TASK 4.3 пропонував Варіант A). Замість цього — `tests/integration/_actionsHarness.js` повторює логіку. Причина: вилучення 38 ACTIONS з App.jsx — самостійний refactor 1-2 дні (~600 рядків з замиканнями на cases/setCases/setNotes/setTimeEntries/getCurrentUser/activityTracker). Виконати в окремому TASK ActionsRegistry refactor — зафіксовано у `discovered_issues_during_task4.md` і у CLAUDE.md розділ Тестування. **Поточний ризик:** при зміні ACTIONS у App.jsx треба синхронно оновлювати harness, інакше тест проходить на застарілій логіці.

2. **CANONICAL_DOCUMENT_FIELDS — 20, не 18.** TASK і CLAUDE.md казали "18". Реальність — 20 полів. Тест `documentSchema.test.js:13` фіксує саме 20 і має коментар про неузгодженість CLAUDE.md. При наступному CLAUDE.md audit виправити число.

3. **EXTENDED_DOCUMENT_FIELDS — 7, не 6.** Аналогічно: documentId + 6 інших. Тест ловить.

4. **Vitest 4.x deprecated `poolOptions.threads`.** Виправлено на топ-рівневі `maxWorkers/minWorkers`. У TASK config приклад був з застарілим API.

5. **3 vulnerabilities після `npm install vitest`** (1 moderate, 2 high) — у транзитивних залежностях. Не критично для dev tool, не блокує CI/CD деплой. `npm audit fix` залишено для окремого TASK безпеки.

---

## Знахідки

Деталі — у `discovered_issues_during_task4.md`. Короткий перелік:

1. **ACTIONS і PERMISSIONS закриті в App.jsx** — рекомендований TASK ActionsRegistry refactor для виключення harness drift.
2. **CLAUDE.md формулювання "18+6 полів"** не відповідає коду (20+7). Виправити при CLAUDE.md audit.
3. **callAPIWithRetry** — поточні параметри (5 retries, 1.5→24с) можуть бути замалі для Tier 1 під сильним навантаженням. Спостерігати на реальних метриках.

---

## Білд + push

- **`npm test`** — ✓ 180/180 за 2.9с.
- **`npm run build`** — ✓ чистий, 1 994 KB JS / 619 KB gzip / 11.25s.
- **Git коміт + push** — наступним кроком.

---

## Пояснення в термінал для адвоката

Я зробив систему автоматичних перевірок. Тепер коли я (або хтось інший) роблю будь-яку зміну в коді — перед тим як вона потрапить на сайт, понад 180 автоматичних тестів перевіряють, що нічого не зламано. Якщо хоч один тест червоний — сайт не оновлюється поки не виправимо.

**Що тобі це дає:**
- Раніше якщо я ламав щось — ти бачив це сам коли заходив на сайт.
- Тепер до сайту йде тільки те що пройшло всі 180 перевірок.
- Якщо щось не пройшло — система не пустить помилковий код на сайт, а я (або наступний агент Claude Code) побачить червоний результат і виправить перед оновленням.

**Що перевіряється:**
- Канонічна схема документа (20 полів) — щоб ніхто випадково не видалив поле і не зламав уже існуючі справи.
- Дозволи агентів (хто що може робити) — щоб агент досьє не отримав права видаляти справи, а агент Document Processor не отримав права створювати нові справи.
- Робота tools (нативний механізм виклику дій моделлю) — щоб видалення засідання працювало, щоб агент не міг помилково діяти з іншою справою тощо.
- Workflow drag-n-drop — щоб перетягування файлів у досьє коректно записувало документи з маркером ⚠.
- Поведінка при помилках — мережа пропала, перевантаження API, неправильний параметр від моделі.

**Скільки перевірок:** 180 зелених. Прогін займає 2.9 секунди.

**Що тобі робити:** нічого, все автоматично. Якщо побачиш на GitHub червоний індикатор замість зеленого (зазвичай це 🔴 проти ✅) — кажи, я подивлюсь що зламалось.

**Що змінилось у процесі деплою:**
- Раніше: push в main → відразу збирається сайт → відразу деплоїться.
- Тепер: push в main → 180 тестів → якщо зелено → збирається сайт → деплоїться. Якщо червоно — деплой не починається. На це додалось 1-2 хвилини до часу деплою.

**Деталі:** повний технічний звіт — у файлі `report_task4.md` в корені репо. Завантаж його в адмін-чат щоб подивитись таблиці покриття і деталі реалізації.
