# Звіт — TASK 2: context_generator_unify

**Дата:** 2026-05-30
**Гілка:** `claude/context-generator-unify-l3cUZ` (remote execution → harness видає робочу гілку; фолд у `main` після підтвердження адвоката, бо це деплой)
**Базова специфікація:** `docs/tasks/TASK_context_generator_unify.md`
**Тип:** винос inline-логіки у спільний сервіс (Вісь C) + робочий DP-тумблер через подію (Вісь A) + збереження C7 (Вісь B)
**schemaVersion:** без bump

---

## 1. Що винесено, фінальна форма `contextGenerator.js`

Створено `src/components/CaseDossier/services/contextGenerator.js` (643 рядки).
Перенесено з `CaseDossier/index.jsx`:

- `CASE_CONTEXT_SYSTEM_PROMPT_V2` — **ДОСЛІВНО, byte-identical** (286 рядків;
  форма+інструкція заповнення нарису: 11 розділів, хронологія, аналіз). Звірено
  `diff` проти git HEAD — порожній. Жодного символу не змінено.
- `CASE_TYPE_LABELS`, `PROC_TYPE_LABELS` (використовувались лише у `buildCaseMetadata`).
- `buildCaseMetadata`, `fillSystemPrompt`, `getNotesForContext`, `formatNotesForPrompt` — verbatim.
- Чиста логіка `handleCreateContext` (кроки 3–12): збір документів, OCR,
  prompt, AI-виклик, білінг, archive+save Drive.

### Сигнатура / DI

```js
generateCaseContext({
  caseData, notes, folderId, subFolders, token, apiKey,
  onProgress = () => {},          // прогрес → компонент мапить у contextMsg / toast
  aiUsageSink = null,             // React-setter ai_usage[] (OCR + генерація)
  // DI-шви (дефолти — реальні імпорти; тести підставляють стаби):
  driveRequest, ocrService, resolveModel, listFolderFiles,
  findOrCreateFolder, uploadFileToDrive, logAiUsage, activityTracker, fetchImpl,
}) → { saved:true, contextText, stats:{count,fromCache,failed} }
   | { saved:false, error:{ code, message? } }   // NO_FILES|AUTH|NO_API_KEY|EMPTY|SAVE_FAILED
   // AI HTTP-помилка → throw (компонент ловить у свій catch, як inline-версія)
```

### Розподіл React-стану vs чиста логіка (#11)

Сервіс **без React-стану**, без `toast`/`systemConfirm`. У компоненті лишилися
ТІЛЬКИ UI-обовʼязки:
- React-стан: `contextMsg` (через `onProgress: setContextMsg`), `contextLoading`,
  `setCaseContext` (refresh після save), `isCreatingContext` (guard).
- Інтерактивні розвилки: **replace existing** (`systemConfirm` перед генерацією,
  бо DP-шлях завжди перезаписує без запиту) і **OAuth consent** (на код `AUTH`).
- `ensureSubFolders` (пише `updateCase`/`setStorageState`) — лишився у компоненті,
  результат `subFolders` передається у сервіс.
- Маппінг кодів помилок сервісу → `messages.context.*` toast'и (поведінка ідентична).

---

## 2. Рішення по тригеру DP — ВАРІАНТ A (подія)

Реалізовано як домовлено у спеці (РІШЕННЯ АДВОКАТА §1): **через подію
`DOCUMENT_BATCH_PROCESSED`**, не прямий імпорт DP→сервіс.

- `DocumentPipelineContext.buildPipelineDeps` прокидає `opt.updateCaseContext`
  (per-run settings адвоката) у deps пайплайна.
- `documentPipeline.emitStage` кладе `updateCaseContext: deps.updateCaseContext === true`
  у `batchPayload` події. Дефолт `false` → manual-add (AddDocumentModal pipeline)
  нарис не чіпає.
- `CaseDossier` слухає подію (`useEffect` + `dpContextHandlerRef` щоб не
  перепідписуватись на кожен render і не ловити stale-замикань): якщо
  `payload.updateCaseContext === true` і `payload.caseId === caseData.id` →
  **повна** регенерація з поточного (вже оновленого persist'ом) набору.

**Чому A:** DP не знає про нутрощі досьє (брати-споживачі, слабке звʼязування).
Варіант B (прямий імпорт) звʼязав би модулі вбік. Порядок гарантований: подія
летить ПІСЛЯ persist → нові документи вже у справі до генерації.

DP-шлях ненавʼязливий: `onProgress: () => {}` (без contextMsg-спаму), один
info-toast «Оновлюю нарис справи…», уся гілка у `try/catch` — помилка генерації
**не валить** обробку документів (DP вже завершив persist).

---

## 3. Як збережено AI usage логування (C7)

Інлайн-версія вже логувала (C7 для context-gen не був дірявий). При виносі
логування переїхало **у сервіс** і лишилось **єдиним шляхом** на обох споживачів:

```js
logAiUsage({ agentType:'case_context_generator', model, inputTokens,
  outputTokens, context:{ caseId, module:CASE_DOSSIER, operation:'generate_context' }}, aiUsageSink);
activityTracker.report('agent_call', { caseId, module:CASE_DOSSIER,
  category:categoryForCase(caseId), metadata:{ agentType:'case_context_generator', operation:'generate_context' }});
```

Паралельні структури `ai_usage[]` (оператор SaaS) і `time_entries[]` (адвокат) —
**без дублювання полів**. OCR-телеметрія йде тим самим `aiUsageSink` (LIFO 50000).
`resolveModel('caseContextGenerator')` → Sonnet — не чіпали. Unit-тест перевіряє
що `logAiUsage` отримує саме `case_context_generator` і той самий `sink`.

---

## 4. Числа тестів і build

| | Файли | Тести |
|---|---|---|
| Baseline (до TASK 2) | 121 | 1621 passed |
| Після TASK 2 | 123 | **1637 passed** |
| Дельта | +2 | +16 |

- `tests/unit/contextGenerator.test.js` — 10 тестів: щасливий шлях (збереження,
  upload у корінь справи), **джерело=документи-не-.txt** (`.txt`/`agent_history`/
  `case_context.md` відсіюються, text-layer PDF потрапляє), **C7-логування**
  (logAiUsage + activityTracker через spy), архівація існуючого, stats
  (fromCache/failed), коди розвилок (NO_FILES/AUTH/NO_API_KEY/EMPTY/SAVE_FAILED),
  AI HTTP-помилка кидає.
- `tests/integration/dp-context-trigger.test.js` — 6 тестів: producer кладе
  `updateCaseContext` у payload (true/false); consumer-гард викликає генерацію
  лише при `true`+поточна-справа (`false` / чужа справа → ні).
- `npm test` — **1637 passed, 0 failed**.
- `npm run build` — **success** (exit 0, ~20с; лише відомий warning «chunk > 500 kB»).

---

## 5. Побічні знахідки → bugs/ + tracking_debt

- **Борг #29** (`tracking_debt.md`): інкрементальне оновлення `case_context` —
  зараз повна регенерація з усіх документів. Тригер: коли повна стане
  дорогою/повільною на товстій справі → окремий TASK (нарис + лише нові
  документи DP-сесії; можливий гібрид; можливо окрема кнопка).
- Окремого `bugs_found_during_*.md` не створено — попутних багів не виявлено.

---

## 6. Як перевірити (Огляд + DP-тумблер)

1. Справа → вкладка **«Огляд»** → «Створити контекст» → працює як раніше (нарис
   генерується, зберігається, ті самі повідомлення; replace-діалог якщо існує).
2. Справа → **«Робота з документами»** → обробити кілька документів з **увімкненим**
   тумблером «Оновити case_context.md» → після обробки нарис справи **оновився**
   (вміст / дата свіжіші; toast «Оновлюю нарис справи…»).
3. Той самий запуск з **вимкненим** тумблером → нарис НЕ чіпається.
4. Агент досьє у чаті «знає» оновлений нарис (читає свіжий `case_context.md`).

Якщо щось зламано — `git revert <commit>`, повідомити.

---

## 7. Git commit confirmation

Два внутрішні коміти на гілці `claude/context-generator-unify-l3cUZ` (push/деплой
один — наприкінці, після підтвердження адвоката):

1. **Коміт 1** — `TASK 2 (коміт 1): винос генерації case_context у спільний сервіс`
   — `contextGenerator.js` + `CaseDossier/index.jsx` (Огляд → обгортка; слухач
   події дрімає) + `tests/unit/contextGenerator.test.js`.
2. **Коміт 2** — `TASK 2 (коміт 2): робочий DP-тумблер «Оновити case_context.md» через подію`
   — `documentPipeline.js` (payload) + `DocumentPipelineContext.jsx` (deps) +
   `tests/integration/dp-context-trigger.test.js`.

Docs-коміт (звіт + ARCHITECTURE_HISTORY + tracking_debt #29 + roadmap ✓ TASK_2) — окремо.

**Push у `main` (= деплой GitHub Pages) — ПІСЛЯ підтвердження адвоката** (CLAUDE.md
правило №1 для змін коду). Перед push: `git pull --rebase origin main`, тільки FF,
тільки при зелених тестах.

---

## 8. Acceptance (усі ✅)

- [x] `contextGenerator.js` створено; промпт (verbatim) + логіка винесені.
- [x] Вкладка «Огляд» працює ІДЕНТИЧНО (поведінка, повідомлення).
- [x] React-стан (`contextMsg`/`contextLoading`) лишився у компоненті; сервіс без React.
- [x] AI usage логування збережено (`case_context_generator` + activityTracker) — C7, один шлях.
- [x] DP тумблер робочий: після обробки нарис оновлюється.
- [x] тригер DP — варіант A (event-based), реалізовано як домовлено.
- [x] помилка генерації в DP-шляху не валить обробку (try/catch, ненавʼязливо).
- [x] джерело тексту збережено: документи (не лише `.txt`) + `extractTextBatch`.
- [x] регенерація ПОВНА; інкремент НЕ реалізовано (борг #29).
- [x] один push/деплой (внутрішньо 2 коміти).
- [x] нові тести (unit на сервіс + DP-тригер інтеграційний).
- [x] `npm test` зелений (1637), `npm run build` success.

**Кінець звіту TASK 2 (context_generator_unify).**
