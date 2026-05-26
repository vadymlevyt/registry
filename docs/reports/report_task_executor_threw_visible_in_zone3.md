# Звіт — EXECUTOR_THREW: збій виконавця видимий у Зоні 3 «Помилки»

**Дата:** 26.05.2026
**Спека:** `docs/tasks/TASK_executor_threw_visible_in_zone3.md` (вкладена адвокатом, не в репо)
**Гілка:** `claude/new-session-QHBq9`
**Виконавець:** Claude Code (web, opus 4.7)

---

## 1. Що зроблено

### Інфраструктурний внесок — один зовнішній return-shape на `ok:false`

`src/services/documentPipeline/streamingExecutor.js`:
- **`streamingExecutor.js:307-321`** — outer `catch (err)` у `run()` тепер повертає **той самий shape** що штатний pipeline-stoppage (рядки 299-306): `{ ok:false, jobId, resumable:true, stoppedAt, errors:[…], decisions:[] }`. До правки повертав сингулярний `error: state.error` — два різні return-shape на одному зовнішньому імені `executor.run` для одного `ok:false` (порушення правила #11 — двійник degenerate-plan minulого TASK, де passthrough ставав на `ok:true`).
- `errors[0]` зберігає форму `{ code:'EXECUTOR_THREW', message: err?.message || String(err), stage: state.stoppedAt }`. `stage` — інформативне поле для каналу діагностики (де саме впало: `'streaming'`, `'pipeline'`, або `'exception'` якщо стан не встиг записати конкретну стадію). Voiced коментарем-інваріантом одне речення про сенс (DEVELOPMENT_PHILOSOPHY §«Однозначність» — коли вводиш нове поле, на місці оголошення фіксуй сенс).
- **НЕ зачеплено:** успішний шлях `ok:true` (рядок 296), штатний pipeline-stoppage (299-306), blocked-verdict «Drive повний» (167 — окремий канал, `res.blocked:true` + DPv2 свій тост), UPLOAD_FAILED early-return (192-195 — non-throw гілка, окремий код-шлях, поза скоупом цього TASK; зафіксовано як кандидат для наступного огляду в §6).

### Тести (нові)

`tests/unit/streamingExecutor.test.js` — **+3 тести** у наявному файлі:

1. **catch-return: exception у processChunk → errors[] масив** — справжній `createStreamingExecutor` зі стабом `processChunk` що `throw new Error('OCR chunk 4: Document AI вичерпано retry')`. Перевіряє `res.ok===false`, `res.resumable===true`, `res.stoppedAt` непорожній, `Array.isArray(res.errors)`, `res.errors[0].code==='EXECUTOR_THREW'`, `message` містить рядок з `err.message`, `decisions===[]`, **і явно `res.error===undefined`** — щоб майбутній рефактор не повернув сингулярний канал.
2. **catch-return: ok:true shape незмінний (regression)** — verify §3 інваріанта: успішний прогон повертає той самий shape що до фіксу (`{ok, jobId, documents, decisions, events, cleanedUp}`), без полів exception-шляху.
3. **catch-return: pipeline-stoppage shape не зачеплено (regression)** — стабований pipeline `{ok:false, stoppedAt:'persist', errors:[…], decisions:[…]}`, перевірка що `executor.run` повертає `errors`/`decisions` точно як прийшло з pipeline (не загорнуто, не перезаписано).

`tests/integration/dp4-ui-executor-threw.test.jsx` — **+1 файл** (паттерн `dp4-ui-triage-whole-volume.test.jsx`):
- Семантично-двійник triage_whole_volume тесту: там halt-decision у «Питання», тут — exception у «Помилки».
- Рендерить DPv2 з `DocumentPipelineContext` де `run` повертає `{ok:false, errors:[{code:'EXECUTOR_THREW', message:'OCR chunk 4: Document AI вичерпано retry', stage:'streaming'}], decisions:[]}`.
- Перевіряє `EXECUTOR_THREW` у `<strong>` Зони 3 «Помилки» + читабельний текст `Document AI вичерпано retry` + блок «Питання» показує «Питань немає» + явно **відсутній** «Помилок немає» (блок наповнений).

## 2. Як перевірено

- `npm test` ДО правки (baseline): **116 файлів, 1531 тест — усі зелені**.
- `npm test` ПІСЛЯ правки: **117 файлів (+1), 1535 тестів (+4) — усі зелені**. Жодного раніше-зеленого тесту не зачеплено.
  - +3 unit-тести у `tests/unit/streamingExecutor.test.js` (catch-return shape, ok:true regression, pipeline-stoppage regression).
  - +1 integration-тест у `tests/integration/dp4-ui-executor-threw.test.jsx`.
- Цільовий вузький прогін перед фінальним:
  - `tests/unit/streamingExecutor.test.js` — 10/10.
  - `tests/integration/dp4-ui-executor-threw.test.jsx` — 1/1.
  - `tests/integration/dp4-ui.test.jsx` — 1/1 (happy-path не зачеплено).
  - `tests/integration/dp4-ui-triage-whole-volume.test.jsx` — 1/1 (двійник у «Питання» не зачеплено).
- `npm run build` — ✓ built in 21.80s. Жодних нових Vite/Rollup попереджень.
- Regression на штатний pipeline-stoppage — окремий §4.3 тест, зелений.
- Regression на ok:true — окремий §4.2 тест, зелений.

## 3. Поведінка до/після

**Синтетичний сценарій:** `processChunk` кидає `Error('OCR chunk 4: Document AI вичерпано retry')` (моделює реальне падіння на 4-му chunk Тома 2/3 в адвоката).

**До правки** — `executor.run` повертав:
```js
{ ok: false, jobId: 'jE', resumable: true,
  error: { code: 'EXECUTOR_THREW', message: 'OCR chunk 4: Document AI вичерпано retry' } }
```
DPv2 поведінка: `res.errors` undefined → `res.errors?.[0]?.message` undefined → `toast.error('Обробка завершилась з помилками', { description: undefined })` — тост без деталей. У Зоні 3 «Помилки» — `errors.length===0` → блок показує **«Помилок немає»** хоча реально стався збій. Адвокат бачить лише тост-заголовок, причина невідома.

**Після правки** — `executor.run` повертає:
```js
{ ok: false, jobId: 'jE', resumable: true, stoppedAt: 'streaming',
  errors: [{ code: 'EXECUTOR_THREW',
             message: 'OCR chunk 4: Document AI вичерпано retry',
             stage: 'streaming' }],
  decisions: [] }
```
DPv2 поведінка: `res.errors[0].message` непорожній → тост з описом збою; у Зоні 3 «Помилки» — `EXECUTOR_THREW` крупним шрифтом + повне повідомлення `err.message` під ним. Кнопка «Залишити на потім». Адвокат при наступному прогоні Тома 2/3 на планшеті побачить РЕАЛЬНУ причину 4-chunk падіння.

## 4. Знайдені побічні баги

**Один кандидат-двійник catch-shape** (НЕ виправлено в цьому TASK):
- `streamingExecutor.js:192-195` — early-return при `UPLOAD_FAILED` (помилка `drivePort.uploadBytes` оригіналу в `_temp`) теж використовує сингулярний `error: state.error`, не `errors:[…]`. Це окрема non-throw гілка всередині `try`, тому виправлений outer `catch` її не охоплює.
- Симптом такий самий що чинив поточний TASK: якщо upload впаде, у Зоні 3 буде «Помилок немає».
- **Рішення:** не патчу в цьому TASK (правило «one TASK = one change» — спека §2.1 явно вказала рядки 307-315), фіксую тут як кандидат для наступного TASK + рядок у `tracking_debt.md`. Аналогічна тривіальна заміна `error: state.error` → `stoppedAt, errors:[state.error], decisions:[]` + перевірка blocked-verdict (рядок 167) — окремий канал з полем `blocked:true`, DPv2 має для нього свій тост; його чіпати не треба.

Окремого файлу `docs/bugs/bugs_found_during_executor_threw_visible.md` не створюю — знахідка єдина, тривіальна, і вже зафіксована тут + у `tracking_debt.md` (див. §7 цього звіту).

## 5. Оновлення `ARCHITECTURE_HISTORY.md`

Додано рядок у покажчик (хронологія):

```
| EXECUTOR_THREW visible у Зоні 3 (2026-05-26) | без bump | `TASK_executor_threw_visible_in_zone3.md`, `report_task_executor_threw_visible_in_zone3.md` |
```

Без розширеного наративу — фікс інфраструктурний і вузький (правило #11 застосоване до catch-return executor'а), повна історія є у спеці і цьому звіті.

## 6. Відкриті питання / наступний крок

**Цей TASK НЕ лагодить саме падіння OCR на 4-му chunk у Тома 2/3.** Він вмикає діагностичний сигнал.

**Наступний крок:** адвокат прогонить Том 2 (170 МБ / 285 стор.) або Том 3 (143 МБ / 213 стор.) на планшеті з виправленим `errors[]` і пришле скріншот Зони 3 «Помилки». На основі реального тексту в `errors[0].message` (стадія + причина — можливі гіпотези: 20 МБ guard Document AI на чанк, Drive 503 на materialize-chunk upload, OOM-проксі через failed fetch, timeout Document AI на якомусь конкретному діапазоні сторінок) — окремий TASK на власне фікс падіння.

**Кандидат-двійник catch-shape** (UPLOAD_FAILED early-return на `streamingExecutor.js:192-195`) — наступний TASK після того, як побачимо чи реальна причина саме там. Якщо буде — заодно вирівняти.

**Інші напрями** (далі за спекою §10):
- Якість Triage без `tocDetector` (Том 1 — 18-21 з ~74 документів) — структурний TASK, після цього фіксу.
- Тости «Видалено документів: N» — підтверджено через grep що це ручні дії в CaseDossier, не баг (нічого не робимо).

## 7. Регресійна дисципліна (звіт по §8 спеки)

- **Baseline ДО першої правки:** `npm test` — 116 файлів, 1531 тест, усі зелені.
- **Після додавання unit-тестів streamingExecutor.test.js (+3):** `npm test` — 116 файлів, 1534 тести, усі зелені.
- **Після додавання integration-тесту dp4-ui-executor-threw.test.jsx (+1):** `npm test` — 117 файлів, 1535 тестів, усі зелені.
- **Після правки catch-гілки streamingExecutor.js:307-321:** `npm test` — 117 файлів, 1535 тестів, усі зелені. Нових падінь немає, snapshot не апдейтили, skip не додавали.
- **`npm run build`:** ✓ built in 21.80s. Артефакти dist/ генеруються нормально.
- **Sanity на критичних інтеграційних:**
  - `dp4-ui.test.jsx` — happy-path UI flow, зелений.
  - `dp4-ui-triage-whole-volume.test.jsx` — двійник у «Питання», зелений.
  - `dp3-streaming.test.js` (у повному прогоні) — зелений.
  - `dp-triage.test.js`, `dp-persist-routes.test.js`, `documentPipeline.test.js`, `dp-stage-progress.test.js`, `dp-document-nature.test.js` (через `npm test` повний) — усі зелені.
- **Manual smoke:** remote env, браузер недоступний → surrogate через UI integration-тест `dp4-ui-executor-threw.test.jsx` (рендер DPv2 з catch-return сценарієм, перевірка blocking Зони 3 «Помилки»). Чесно зафіксовано — згідно дозволу спеки §7.
- **Заборонені зони (§6) не зачеплено:** OCR (`src/services/ocrService.js`, `src/services/ocr/*`), Triage / нарізка (`triageStage.js`, `splitDocumentsV3.js`, `normalizePlan`, `isDegeneratePlan`), пам'ять (`chunkManager.js`, `memoryMonitor.js`, `layout.concat`), успішний return executor (`ok:true` на рядку 296), pipeline-stoppage (рядки 299-306) — grep-перевірено, жоден з цих файлів/рядків не торкнутий.
- **SAAS / BILLING / AI USAGE:** усі секції спеки §5 виконано — нічого не зачеплено. Catch-path executor — інфраструктура диригента, не дія адвоката і не AI-виклик. schemaVersion не bump'ився (структурно реєстр не зміненився).

**Лексика §2.3** — НЕ зачіпав (мінімальний скоуп). Слова «помилка» / «error» залишились як були. Це поза інваріантом цього TASK.

---

**Готово до push у `main`** після підтвердження адвоката (CLAUDE.md правило #1 — зміна коду тригерить CI + Pages deploy).
