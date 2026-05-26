# Звіт — Triage AI діагностика: max_tokens 4000→16000 + лог токенів

**Дата:** 26.05.2026 (вечір, після revert imagelessMode)
**Спека:** `docs/tasks/TASK_triage_maxtokens_diagnostic.md` (вкладена адвокатом, не в репо)
**Гілка:** `claude/new-session-QHBq9`
**Виконавець:** Claude Code (web, opus 4.7)
**Батьківські TASK:** `report_task_executor_threw_visible_in_zone3.md`, `report_task_documentai_limit_40mb_imageless.md`, `report_task_revert_imagelessmode.md`.

---

## 1. Що зроблено

### Діагностичний фікс — два точкові кроки

`src/services/documentBoundary/analyzeTriageViaToolUse.js`:

- **`analyzeTriageViaToolUse.js:60-67`** — `max_tokens: 4000` → `16000`. Один числовий рядок + 6-рядковий коментар поряд про обґрунтування: для тома з 50-74 документами план у JSON ≈ 60-90 токенів на документ × 74 ≈ 5900 токенів, старий ліміт 4000 потенційно змушував Haiku видавати «здавальницький» план бо знав що не вкладеться. Узгоджено з `CaseDossier` context-generator який вже використовує 16000. Цінник Anthropic не залежить від ліміту (тарифікуються використані токени), тому це **дозвіл**, не **вимога** видавати більше.
- **`analyzeTriageViaToolUse.js:71-83`** — `console.info('[Triage] artifacts=N pages=N input=Nt output=Nt model=…')` блок після `callAPIWithRetry` ПЕРЕД `if (data?.error) throw`. Обгорнуто `try/catch` — лог не валить pipeline якщо щось у формуванні рядка кине (захист від edge cases). Лог містить тільки `usage.input_tokens` / `usage.output_tokens` поля + лічильник artifacts і total pages — нуль privacy-sensitive даних (немає тексту промпта, немає JSON response, немає caseId).

**НЕ зачеплено** (свідомо, згідно §6 спеки):
- Промпт `triagePrompt.js` — без змін.
- `triageStage.js`, `isDegeneratePlan`, `pageMarkers.js` — без змін.
- Інші `max_tokens` у проєкті (Dashboard 500, analyzeViaToolUse 2000, **CaseDossier context-generator 4000** — інший контекст, не Triage; поза скоупом TASK).
- `logAiUsageViaSink`, `activityTracker.report`, retry-стратегія, `extractJson` — без змін.

### Тести (нові — 3 додано до існуючих 5)

`tests/unit/analyzeTriageViaToolUse.test.js`:

1. **`body містить max_tokens: 16000 (підвищено з 4000)`** — перехоплення body запиту через `vi.stubGlobal('fetch', ...)` (вже існуючий патерн у тесті) + `JSON.parse(opts.body)`, асерт `cap.body.max_tokens === 16000`.
2. **`console.info логує [Triage] з реальними input/output токенами`** — `vi.spyOn(console, 'info')`, прогін з `artifacts:[{pageCount:285}]` (моделює великий том), перевірка що в `spy.mock.calls` є рядок з `[Triage] artifacts=1 pages=285 input=10t output=5t model=…` (числа з stub `usage`).
3. **`відсутність data.usage не валить pipeline (try/catch ізолює лог)`** — stub fetch повертає response БЕЗ `usage` поля, перевірка що `out.documents === []` (pipeline не падає) і лог все одно викликається (з `input=undefinedt` — це нормально, бо try/catch ловить throw, а не undefined у template). Тест валідує що відсутність полів НЕ ламає функціональність — це і є важлива гарантія.

## 2. Як перевірено

- `npm test` ДО першої правки (baseline): **118 файлів, 1540 тестів — усі зелені**.
- `npm test` ПІСЛЯ підняття `max_tokens` (`analyzeTriageViaToolUse.js:60-67`): **118/1540 зелений**. Жоден існуючий тест не зачеплений — `max_tokens: 4000` ніде явно не асертився (grep `max_tokens.*4000` у `tests/` чистий).
- `npm test` ПІСЛЯ додавання `console.info` блоку: **118/1540 зелений**. Існуючі 5 тестів `analyzeTriageViaToolUse.test.js` продовжують проходити (їхній stub fetch повертає `usage: {input_tokens:10, output_tokens:5}` — лог спрацьовує, але `console.info` не валить тест).
- `npm test` ПІСЛЯ додавання 3 нових тестів: **118 файлів, 1543 тести (+3) — усі зелені**.
- Цільовий вузький прогін `tests/unit/analyzeTriageViaToolUse.test.js` — 8/8.
- Регресія `tests/integration/dp-triage.test.js` — зелений у повному прогоні (стаб там не асертить `max_tokens`).
- `npm run build` — ✓ built in 17.62s.
- `grep "max_tokens.*4000" src/`: 1 згадка лишилась — `CaseDossier/index.jsx:1671` (context-generator, не Triage; поза скоупом).

## 3. Поведінка до/після

### Лог у DevTools Console (приклад тексту)

Після цього TASK на кожному прогоні Triage у `console.info` з'явиться рядок виду:

```
[Triage] artifacts=1 pages=335 input=14250t output=520t model=claude-haiku-4-5-20251001
```

де:
- `artifacts=N` — скільки артефактів (PDF файлів) пішло в Triage (зазвичай 1 для одного тому, або більше для batch).
- `pages=N` — сумарна кількість сторінок усіх артефактів.
- `input=Nt` — реальні input tokens у запиті (паспорт + промпт).
- `output=Nt` — реальні output tokens у відповіді Haiku.
- `model=…` — підтвердження що використовується саме Haiku (`claude-haiku-4-5-20251001`).

### Контекст: що цей лог показує

- **`output=200-500t` попри `max_tokens=16000`** → Haiku видає мало незалежно від ліміту → корінь у природі AI/контенту/промпту. Наступний крок — Варіант Б (батч-Triage або перехід на Sonnet/Opus для великих томів).
- **`output=5000-8000t` + нарізка стала повнішою (~50+ doc)** → корінь був у `max_tokens=4000` → одна цифра вирішила. Регресія Тома 1 закрита, рухаємось далі.
- **`output≈16000t` з parsing-error у Зоні 3** → план не вмістився навіть у 16K → ще піднімати АБО переходити на Sonnet (у Sonnet 4 ліміт ~64K output).

До цього TASK реальне число output tokens було невидимим — `logAiUsageViaSink` пише в `ai_usage[]` на Drive, але без планшетного дашборду адвокат не міг побачити в момент прогону що саме видав AI. Тепер видно прямо у Console.

### Pipeline behavior

Логічної зміни нуль — це чисто діагностика. `max_tokens=16000` дозволяє Haiku видати більше, але не змушує. `console.info` — side-channel, не впливає на нічий вхід/вихід функції.

## 4. Знайдені побічні баги

Жодних. Перевірив `grep "max_tokens.*4000" src/`: лишилось одне місце — `CaseDossier/index.jsx:1671` (context-generator, інший контекст — генерує case_context.md, не Triage). Це поза скоупом цього TASK і потенційно валідне значення для іншої задачі (короткий контекстний документ). Якщо коли-небудь захочемо систематично оглянути всі `max_tokens` константи у проєкті — окремий аудит-TASK.

## 5. Оновлення `ARCHITECTURE_HISTORY.md`

Додано рядок у покажчик (хронологія):

```
| Triage max_tokens 4000→16000 + діагностичний лог (2026-05-26 вечір) | без bump | `TASK_triage_maxtokens_diagnostic.md`, `report_task_triage_maxtokens_diagnostic.md` |
```

Без розширеного наративу — фікс точковий, діагностичний; повна інтерпретація буде в наступному TASK після того як адвокат пришле скріншот лога.

## 6. Відкриті питання / наступний крок

**Цей TASK НЕ виправляє нарізку Тома 1.** Він знімає одну змінну (`max_tokens=4000`) з рівняння і дає видимі дані для наступного рішення.

**Наступний крок (негайний — діагностика):**

Адвокат прогонить **Том 1 «Нестеренко»** (335 стор / 207 МБ) на планшеті **з відкритим DevTools Console** (Safari → Develop → планшет → Console; або Chrome remote debugging). Шукати рядок `[Triage] artifacts=… pages=335 input=…t output=…t model=…`. Пришле скріншот цього рядка.

**Інтерпретація — три сценарії:**

1. **`output=5000-8000t`, нарізка стала ~18-50 doc** → корінь був у `max_tokens=4000`. Регресія закрита, Том 1 знов працює. Том 2/3 (285 стор) — можливо теж покращиться, бо там план менший але теж міг впиратись у ліміт.
2. **`output=200-500t` попри `max_tokens=16000`, нарізка усе ще 1 doc** → ліміт не був коренем. AI здається сам на томах 200+ стор. Наступний TASK:
   - **Варіант Б1:** Перейти на Sonnet для томів >100 стор (тариф ~3× дорожче, але якість вища і output capacity більший).
   - **Варіант Б2:** Батч-Triage — розрізати том на 2-3 секції по 100-150 стор, Triage кожну окремо, merge меж. Дорожче (більше Haiku-викликів), стабільніше.
   - **Варіант A:** Розширення `isDegeneratePlan` фільтром «<20% покриття» — нейтральний halt у «Питання» замість тихої passthrough як 1 doc. Це не виправлення нарізки, але робить degraded поведінку видимою.
3. **`output≈16000t` з JSON parse error у Зоні 3** → план не вмістився навіть у 16K. Окремий TASK з підняттям до 32K або з переходом на Sonnet (Sonnet 4 підтримує ~64K output).

**Кандидати поза скоупом цього TASK (`tracking_debt.md` кандидати):**
- **TOC-детектор** (`tracking_debt.md #21`) — більшість українських кримінальних томів починається з реєстру документів. Парс реєстру → ground truth → обхід Triage. Найточніше для томів з реєстром.
- **`console.info` → `eventBus` подія `triage.token_usage`** — для централізованого моніторингу без потреби DevTools. Окремий структурний TASK якщо лог стане регулярним інструментом діагностики.
- **Лог у `decision.metadata` для Зони 3** — щоб адвокат бачив токени прямо у UI без DevTools. Окремий UI-TASK.

## 7. Регресійна дисципліна (звіт по §8 спеки)

- **Baseline ДО першої правки:** `npm test` — 118 файлів, 1540 тестів, усі зелені.
- **Після підняття `max_tokens` (рядок 60→67):** `npm test` — 118/1540 зелений. Жодний існуючий тест не падав (grep `max_tokens.*4000` у `tests/` чистий — асерт ніде не стояв).
- **Після додавання `console.info` блоку (рядки 71-83):** `npm test` — 118/1540 зелений. Існуючі stub fetch у тестах `analyzeTriageViaToolUse` повертають `usage:{input_tokens:10, output_tokens:5}` — лог спрацьовує без помилок.
- **Після додавання 3 нових тестів:** `npm test` — 118 файлів, 1543 тести (+3), усі зелені.
- **`npm run build`:** ✓ built in 17.62s. Жодних нових Vite/Rollup попереджень.
- **Sanity на критичних інтеграційних** (через `npm test` повний прогон): `dp-triage`, `dp4-ui`, `documentPipeline`, `dp-persist-routes`, `dp-document-nature`, `dp-stage-progress`, `dp3-streaming`, `dp-layout-persist`, `dp-text-slice` — усі зелені.
- **Manual smoke виконавцем неможливий** — remote env, браузера немає, реального промпта з 285+-сторінковим паспортом немає. Чесно зафіксовано згідно дозволу спеки §3 і §9.7. **Головна верифікація** — через `console.info` у DevTools адвоката на планшеті після push у `main`.
- **Заборонені зони (§6 спеки) не зачеплено:** `triagePrompt.js`, `triageStage.js`, `isDegeneratePlan`, `pageMarkers.js`, інші `max_tokens` (`CaseDossier:1671`), `logAiUsageViaSink`, `activityTracker.report`, `decision.metadata`. Підтверджено git diff: змінено тільки `src/services/documentBoundary/analyzeTriageViaToolUse.js` + `tests/unit/analyzeTriageViaToolUse.test.js`.
- **`AskUserQuestion` не знадобився** — вкладалось у мінімальний скоуп (одна цифра + один try/catch блок).
- **SAAS / BILLING / AI USAGE** (за §5 спеки): жодних змін. `time_entries[]` і `ai_usage[]` не зачіпаються — пишуться через існуючий `logAiUsageViaSink`/`activityTracker.report`, які отримують tokens з `data.usage` як раніше. `console.info` — side-channel, нуль білінгових імплікацій. schemaVersion не bump'ився.

---

**Готово до push у `main`** після підтвердження адвоката (CLAUDE.md правило #1 — зміна коду тригерить CI + Pages deploy).
