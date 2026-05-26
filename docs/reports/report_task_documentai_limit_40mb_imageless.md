# Звіт — Document AI ліміт 20→40 МБ + imagelessMode:true

**Дата:** 26.05.2026
**Спека:** `docs/tasks/TASK_documentai_limit_40mb_imageless.md` (вкладена адвокатом, не в репо)
**Гілка:** `claude/new-session-QHBq9`
**Виконавець:** Claude Code (web, opus 4.7)
**Батьківський TASK:** `report_task_executor_threw_visible_in_zone3.md` (зробив помилку видимою — `EXECUTOR_THREW: Файл більший за 20 МБ` доїхав до Зони 3, корінь точно ідентифіковано).

---

## 1. Що зроблено

### Інфраструктурна синхронізація — одна цифра «межа Document AI» (правило #11)

`src/services/ocr/documentAi.js` — дві мікроправки + три коментарні синхронізації:

- **`documentAi.js:46`** — `DOC_AI_MB_PER_REQUEST = 40` (було 20). Це автоматично виправляє ОБА guard'и:
  - Outer guard (`documentAi.js:291`) на повний chunk `arrayBuffer`.
  - Inner sub-chunk guard (`documentAi.js:383`) після pdf-lib slice.
- **`documentAi.js:159-167`** — `body` POST-запиту до Document AI :process тепер містить `imagelessMode: true` поряд з `rawDocument`. Поле підтверджено в офіційному Google Discovery API (`GoogleCloudDocumentaiV1ProcessRequest.imagelessMode`, тип `boolean`, опис `"Option to remove images from the document."`). Прибирає `image` base64 з response → JSON у 5-10× менший → менший memory peak per chunk на iPad heap.
- **`documentAi.js:1-5`** — оновлено шапку файлу (раніше було «20 МБ на запит», тепер «40 МБ на запит» + одне речення про `imagelessMode`).
- **`documentAi.js:21`** — оновлено коментар класифікації UNSUPPORTED (раніше `>20МБ`, тепер `>40МБ`).
- **`documentAi.js:385`** — внутрішнє лог-повідомлення `state.lastError.message` з захардкоженого `'chunk > 20MB'` перебудовано на template `\`chunk > ${DOC_AI_MB_PER_REQUEST}MB\`` (правило #11: одна цифра в одному місці, лог автоматично сінхронізується з константою при наступних правках).

**Інфраструктурний внесок:** до цього TASK `documentAi.js` цілився на 20 МБ, тоді як `memoryMonitor.adviseChunkPages` (`memoryMonitor.js:69`) уже планував chunks під 40 МБ через `pagesFor40MB = Math.floor((40 * 1024 * 1024) / bytesPerPage)`. Конструктивна неузгодженість: один сенс «межа Document AI online sync request» виражався двома різними цифрами в двох файлах. TASK закрив це — цифра тепер одна, 40 МБ, і документована в коментарі біля константи що це SSOT для всього коду.

**НЕ зачеплено** (свідомо, згідно §6 спеки):
- `DOC_AI_PAGES_PER_REQUEST = 15` — без verified release notes Google про підняття до 30 з `imagelessMode`.
- `STRIPPED_LAYOUT_FIELDS = ['image', 'tokens']` у `ocrService.js` — лишається safety-net на випадок якщо edge-case API все-таки поверне image (зворотна сумісність).
- `memoryMonitor.adviseChunkPages` — вже правильно цілиться на 40 МБ.
- `RETRY_MAX_ATTEMPTS`, `RETRY_BACKOFF_MS`, `classifyError`, `streamingExecutor` catch-shape (фікс попереднього TASK).

### Тести (нові)

Створено **новий файл** `tests/unit/documentAi.test.js` — 5 тестів. Раніше тестового файлу для `documentAi.js` не існувало (`find tests -name "*documentAi*"` — порожньо; grep по `DOC_AI_MB_PER_REQUEST` — лише сам `documentAi.js`).

Підхід: справжній default-export `documentAi` з мокнутим `driveAuth.driveRequest` (перехоплює Drive download + Document AI :process в одному моку) і мокнутим `pdf-lib` (повертає 5-сторінковий PDF — гілка «малий PDF, один запит»). Це дозволяє виконати повний `extract()` з продакшн-кодом guard'у і body shape без реальної мережі.

1. **PDF 30 МБ → проходить guard** — раніше падав на 20 МБ, тепер під 40.
2. **PDF 39 МБ (граничний) → проходить guard** — щільне покриття межі знизу.
3. **PDF 41 МБ → throw `UNSUPPORTED` з повідомленням `Файл більший за 40 МБ`** — щільне покриття межі зверху + перевірка що POST до Document AI НЕ відбувся (guard зловив раніше).
4. **body postToDocAi містить `imagelessMode: true`** — перехоплення body запиту, JSON.parse, явний асерт `body.imagelessMode === true`, плюс перевірка що базова форма `rawDocument.mimeType`/`content` збережена.
5. **image MIME → `imagelessMode: true` теж присутній** — гілка single-request (не PDF) теж включає поле.

## 2. Як перевірено

- `npm test` ДО правки: **117 файлів, 1535 тестів — усі зелені** (baseline з попереднього TASK).
- `npm test` ПІСЛЯ правки: **118 файлів (+1), 1540 тестів (+5) — усі зелені**. Жодного раніше-зеленого тесту не зачеплено.
- Цільовий вузький прогін перед фінальним: `tests/unit/documentAi.test.js` — 5/5.
- `tests/unit/memoryMonitor.test.js` — 8/8 зелених (§4.3 regression: `pagesFor40MB` ассерт автоматично відображає 40 МБ ціль, що тепер консистентна з documentAi).
- Існуючі integration-тести pipeline (§4.4): `dp-triage`, `dp4-ui`, `documentPipeline`, `dp-persist-routes`, `dp-document-nature`, `dp-stage-progress`, `dp3-streaming`, `dp-layout-persist`, `dp-text-slice` — усі зелені у повному прогоні `npm test`.
- `grep "DOC_AI_MB_PER_REQUEST" src/ tests/`: 4 згадки, усі в `documentAi.js` (1 визначення + 3 використання). Жодного магічного `20` поза цим контекстом.
- `npm run build` — ✓ built in 16.99s. Жодних нових Vite/Rollup попереджень.

## 3. Поведінка до/після

**Синтетичний 30 МБ PDF** (моделює Стрибок 32 МБ, Том 2 чанк після нерівномірного розподілу):

**До правки** — `documentAi.extract({mimeType:'application/pdf', size:30MB})`:
- `arrayBuffer.byteLength (30MB) > 20MB` → outer guard throw'ить `UNSUPPORTED: 'Файл більший за 20 МБ'`.
- Bubble через `streamFile` → `processChunk` → outer catch в `streamingExecutor.run` → (після попереднього TASK) `errors:[{code:'EXECUTOR_THREW', message:'Файл більший за 20 МБ', stage:'streaming'}]`.
- DPv2 Зона 3 «Помилки» показує `EXECUTOR_THREW` + текст. Адвокат бачить корінь.

**Після правки** — той самий 30 МБ PDF:
- `arrayBuffer.byteLength (30MB) > 40MB` → false → guard пропускає.
- Запит до Document AI `:process` з `body = { rawDocument:{content, mimeType}, imagelessMode:true }`.
- Response від API менший в 5-10× (немає `image` base64 на кожній сторінці).
- `text` + `pageStructure` повертаються в pipeline → Triage → нарізка → персист.

**Том 2 / Том 3 4-й чанк сценарій:** з нерівномірним розподілом байтів між сторінками 4-й чанк після `adviseChunkPages` міг важити 21-25 МБ (середній 20МБ при 200 МБ/300 стор → 20 кБ/стор, але деякі стор. 200-300 кБ → 25-стор. чанк = 5-7 МБ; нерівномірно 25-30 МБ). До правки — `UNSUPPORTED >20МБ`. Після — проходить.

**Стрибок 32 МБ / 42 МБ:**
- 32 МБ < 40 МБ → проходить guard без чанкування.
- 42 МБ > 40 МБ → outer guard throw — але це pdf-lib гілка: `adviseChunkPages` уже розрахує chunks ≤ 40 МБ ще ДО Document AI guard (memoryMonitor target 40 МБ). 25 стор. при 42 МБ/25 = 1.68 МБ/стор → `pagesFor40MB = 23` → один чанк 23 стор. = 38.6 МБ < 40 → проходить. Другий чанк 2 стор. = 3.4 МБ → проходить.

## 4. Знайдені побічні баги

Жодних — TASK мікро-точковий. Перевірив grep по «20» в `documentAi.js`: жодних магічних `20` поза `DOC_AI_MB_PER_REQUEST` контекстом залишилось. Усі літеральні 20-МБ згадки в коментарях/повідомленнях оновлені на 40 (або переписані через template literal на саму константу — захист на майбутнє).

## 5. Оновлення `ARCHITECTURE_HISTORY.md`

Додано рядок у покажчик (хронологія):

```
| DocAI ліміт 20→40 МБ + imagelessMode (2026-05-26) | без bump | `TASK_documentai_limit_40mb_imageless.md`, `report_task_documentai_limit_40mb_imageless.md` |
```

Без розширеного наративу — фікс мікро-точковий (2 поля в одному файлі + інфраструктурна синхронізація з memoryMonitor через спільну цифру 40 МБ).

## 6. Відкриті питання / наступний крок

**Цей TASK НЕ гарантує що Том 2 / Том 3 / Ситко тепер пройдуть до кінця.** Він знімає одну конкретну гілку відмови — «>20 МБ» guard. Реальний результат побачимо тільки коли адвокат прогонить файли на планшеті.

**Наступний крок:** адвокат прогонить на планшеті:
1. **Том 2 «Нестеренко» друга частина** (раніше падав «Файл більший за 20 МБ» після фіксу видимості).
2. **Стрибок 32 МБ / 42 МБ** (раніше падав).
3. **Ситко** (раніше падав).
4. Пришле скріншоти Зони 3 «Помилки».

**Три сценарії результату:**

- **A) Усе проходить, документи створено** → ціль TASK досягнута; рухаємось до якості Triage (`tocDetector` — окремий TASK з `tracking_debt.md #21`).
- **B) Проходить guard, але впадає на іншій помилці** (наприклад Drive 503, Document AI 400 з іншим повідомленням, OOM на pdf-lib slice великого pdf) → завдяки фіксу попереднього TASK реальне повідомлення видно у Зоні 3 → точкова правка наступним TASK.
- **C) Усе ще `Файл більший за 40 МБ`** → значить `adviseChunkPages` дає чанки нерівномірно (середнє правильне, але max-байт у chunk > 40 МБ через дуже жирні сторінки). Корінь — `adviseChunkPages` рахує по середньому байту/стор, не по реальному max. Окремий TASK: розрахунок по реальному розмірі сторінок з pdf-lib metadata, не по середньому (зафіксовано як кандидат у §10 спеки).

**Кандидат розширення (НЕ цей TASK):** `DOC_AI_PAGES_PER_REQUEST` 15 → 30 з `imagelessMode`. З вторинних джерел це можливо, з первинних Google Discovery — не підтверджено. Чекає release notes від Google або реальної потреби (якщо швидкість стане критичною).

## 7. Регресійна дисципліна (звіт по §8 спеки)

- **Baseline ДО першої правки:** `npm test` — 117 файлів, 1535 тестів, усі зелені.
- **Після підняття константи з 20 на 40 (рядок 46):** `npm test` — 117 файлів, 1535 тестів, усі зелені. **Жоден існуючий тест не падав на цій правці** (асертів на `20 МБ` у тестах не виявилось — grep чистий). Це консистентно з тим що `memoryMonitor` уже цілився на 40 МБ і його тести вже зелені.
- **Після додавання `imagelessMode: true` у body (рядки 159-167):** `npm test` — 117/1535 зелений (жоден існуючий тест не перевіряв body shape).
- **Після додавання unit-тестів `tests/unit/documentAi.test.js` (+5):** `npm test` — 118/1540 зелений.
- **Коментарні sync (`documentAi.js:1-5, 21, 385`):** `npm test` — 118/1540 зелений.
- **`npm run build`:** ✓ built in 16.99s. Артефакти dist/ генеруються нормально.
- **Sanity на критичних інтеграційних** (через `npm test` повний прогон): `dp-triage`, `dp4-ui`, `documentPipeline`, `dp-persist-routes`, `dp-document-nature`, `dp-stage-progress`, `dp3-streaming`, `dp-layout-persist`, `dp-text-slice` — усі зелені.
- **Manual smoke виконавцем неможливий** — remote env (Claude Code на вебі), браузера немає, реального файлу 30+ МБ немає. Чесно зафіксовано згідно дозволу спеки §8 і §9.7. Тестує адвокат на планшеті після push у `main`.
- **Заборонені зони (§6) не зачеплено:** `adviseChunkPages`, `memoryMonitor.js`, `chunkManager.js`, `ocrService.STRIPPED_LAYOUT_FIELDS`, `DOC_AI_PAGES_PER_REQUEST`, retry-стратегія, `classifyError`, `streamingExecutor`. Підтверджено git diff: змінено тільки `src/services/ocr/documentAi.js`.
- **`AskUserQuestion` не знадобився** — все вкладалось у мінімальний скоуп.

**SAAS / BILLING / AI USAGE** (за §5 спеки): жодних змін. schemaVersion не bump'ився. Document AI цінник за документ/сторінку не залежить від `imagelessMode` (Google не bills за image generation окремо). `ai_usage[]` запис лишається таким же. `tenants[]`, `users[]`, `permissions`, `time_entries[]` — не зачеплено.

---

**Готово до push у `main`** після підтвердження адвоката (CLAUDE.md правило #1 — зміна коду тригерить CI + Pages deploy).
