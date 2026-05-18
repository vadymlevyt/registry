# DIAGNOSTIC DP-4 ROOT CAUSE — чому нарізка справи Брановського не працює

**Дата:** 18.05.2026
**Тип:** Розслідування (БЕЗ зміни коду) — перевірка гіпотези адвоката про
непридатність multi-file реконструктора для single-file нарізки
**Передумова:** після DP-4 BUGFIX (`shouldReconstruct: live.length >= 1`)
адвокат протестував справу Брановського (1 PDF, 65 стор., 21МБ) — нарізка
все ще не працює, job завис.

> ⚠ **СТАН РЕПО:** коміт BUGFIX `f4872ac` вже у `origin/main` (запушено
> попереднім ходом за явним підтвердженням адвоката "так, пуш у мейн", ДО
> цього запиту). «Не пушити» вже неможливо — фікс на `main`. Це
> розслідування визначає чи потрібен **revert** `shouldReconstruct`.
> Жодних нових змін коду/пушів до рішення адвоката.

---

## 0. ВЕРДИКТ (стисло)

**Гіпотеза адвоката — СУТТЄВО ПРАВИЛЬНА** в архітектурній частині, але
МЕХАНІЗМ зависання інший ніж описано:

| Твердження гіпотези | Перевірка |
|---|---|
| «multi-file промпт не підходить для single-file» | ✅ **ПІДТВЕРДЖЕНО** (симуляція) |
| «AI зависає у multi-turn loop без виходу» | ❌ **ХИБНО механічно** — `reconstructAcrossFiles` це `for (const f of files)`, 1 файл = **рівно 1 виклик AI**, жодного loop/maxIterations/while |
| «повертає порожній план» | ✅ можливо (AI не розуміє задачу) |
| «дає відповідь яку код не вміє інтерпретувати» | ✅ так (галюциновані номери сторінок — у тексті немає маркерів) |
| «перший DP працював бо мав ОДНУ задачу — наріж цей PDF» | ✅ **ПІДТВЕРДЖЕНО** — це і є архітектурно правильний шлях |

**Справжня причина зависання job (status:"running" назавжди):** `fetch()` у
`callAPIWithRetry` (`toolUseRunner.js:352`) **БЕЗ timeout/AbortController**.
Довгий виклик Sonnet з 50К-символьним промптом на планшеті (фонова вкладка
присипляється / мережа флапає) → `await fetch` ніколи не резолвиться →
`await pipeline.run()` висить → executor не доходить ні до DONE, ні до
STOPPED → `job_state.json` заморожений `status:"running"`, resume не
запропоновано.

**BUGFIX `shouldReconstruct: >=1` — архітектурно НЕправильний фікс.**
Він примусив непридатний інструмент (multi-file реконструктор). Правильний
фікс — те що DP-3 і задумував: single-file → `detectSingle` =
`documentBoundary.detectBoundaries` (виділений промпт «наріж цей PDF», з
самим PDF як Document Block). Provider його **ніколи не ін'єктував** — оце
і є справжній не виправлений баг DP-4. Рекомендація — **Варіант C** (нижче).

---

## 1. `reconstructAcrossFiles()` — детальний розбір

`src/services/documentBoundary/multiFileReconstructor.js`:

```js
for (const f of files) {                    // ← НЕ while, НЕ recursion
  fileResult = await analyzeFile({ fileId, fileName, text: f.text, openTails, userHint });
  // catch → unusedPages.push, continue
  ({plan, openTails, unusedPages+} = mergeFileResult(...));
}
return { documents: plan.map(...), unusedPages, openTails, fileCount };
```

- **Умова виходу з «multi-turn»:** немає multi-turn. Це проста ітерація по
  `files`. 1 файл → тіло циклу 1 раз → 1 `analyzeFile`. Вихід — кінець
  масиву `files`. **maxIterations не потрібен і відсутній.**
- **`openTails` при single-file:** завжди `[]` (нема попередніх файлів).
  Передається в промпт як «(немає)». Не ламає логіку, але робить блок
  промпту про «відкриті хвости» безглуздим для адвоката-AI.
- **timeout на AI call:** **НЕМАЄ** ні тут, ні в `aiReconstructFile`, ні в
  `callAPIWithRetry` (`fetch` без `AbortController`). `callAPIWithRetry`
  має `maxRetries=5` + backoff (~24-46с) АЛЕ лише якщо `fetch`
  **кидає/повертає статус**. Якщо з'єднання відкрите і висить — `await
  fetch` висить **нескінченно**.
- **`reconstructionPlan:null`, `cursor:{0,0}`, `documents:[]` у
  job_state.json — НЕ діагностичні:** це поля `makeInitialJobState`
  (`jobState.js:53,56`), які `streamingExecutor` **ніколи не записує** у
  jobState (вони — стан pipeline-ctx, не jobState). `cursor` — мертве поле,
  завжди `{0,0}`. Підозра адвоката (п.2,4) — хибний слід.

## 2. Симуляція single-file reconstruction (емпірично)

Тимчасовий тест (видалено після прогону): мок `analyzeFile` логує промпт,
1 файл, текст >119К символів без маркерів сторінок.

```
AI calls (turns): 1                       ← НЕ multi-turn (1 файл = 1 виклик)
text given to reconstructor: 720000
text actually in prompt:       50900      ← buildReconstructionPrompt: text.slice(0,50000)
prompt framing: "Це частина пакета файлів судової справи."
                "Незакриті документи з попередніх файлів (відкриті хвости): (немає)"
prompt mentions "пакета файлів":   true
prompt mentions "наступному файлі": true
prompt asks to SLICE one PDF:      NO — лише "які логічні документи присутні"
result.documents: 0 (коли AI «нічого не знайшов»)
```

**Висновки симуляції:**
1. **Зависання НЕ в реконструкторі** — 1 детермінований виклик, миттєвий
   вихід. Зависання — у мережному `fetch` всередині `analyzeFile`.
2. **Текст обрізається 720K/119K → 50K.** AI бачить лише ~першу третину
   65-сторінкової справи. Документи з другої половини — невидимі.
3. **Промпт семантично хибний для single-file:** «частина пакета»,
   «відкриті хвости», «наступний файл» — для одного самодостатнього скану
   це шум, що збиває AI з пантелику (підтверджує гіпотезу адвоката).
4. **Промпт НЕ ставить задачу нарізки.** Питає «які логічні документи
   присутні» (аналіз пакета), а не «наріж цей PDF на окремі документи з
   точними межами сторінок». Перший DP мав саме другий, конкретний промпт.
5. **У тексті немає маркерів сторінок** (`mergeText` = конкатенація chunk-ів
   без `--- стор. N ---`). AI просять `startPage/endPage`, але він не може
   їх знати → **галюцинує**. `splitPdf` (`splitPdf.js:32`)
   `Math.min(endPage-1, totalPages-1)` клемпить зверху (95→65) але
   `startIdx=startPage-1` не клемпиться знизу — невалідні діапазони →
   або хибна нарізка, або порожній PDF, або (рідше) SPLIT_FAILED.

## 3. UI прогрес: топбар оновлюється, повний екран — ні (п.6)

- Обидва (`JobProgressTopbar`, `GlobalProgressScreen`→`ProgressFullScreen`)
  підписані на **той самий** `jobProgressStore` (`useJobProgress`/
  `subscribe`). Джерело даних ідентичне.
- Під час OCR `streamingExecutor.reportProgress` штовхає `updateJob` →
  обидва оновлюються. **Після OCR (фаза `pipeline.run`) штовхань НЕМАЄ** —
  стадії pipeline не пишуть у jobProgressStore. Обидва компоненти
  **застигають на 100% / "processing"** поки `pipeline.run` висить.
- Чому здається що «топбар живий, повний екран — ні»: топбар має
  **CSS-спінер** (`job-topbar-spinner`, нескінченна анімація) → виглядає
  «оновлюється»; `ProgressFullScreen` показує статичні числа
  («Опрацьовано 3 з 3», «100% · майже готово») → виглядає «застряг».
  Drive-poll fallback (5с) теж нічого не міняє (chunks вже done).
- **Це не окрема регресія даних** — обидва читають один стор; це наслідок
  №1 (pipeline висить → прогресу більше немає для НІКОГО). Жодного
  окремого «джерела даних» у повному екрані немає. (Якщо адвокат бачить
  розбіжність ДО зависання — потрібен живий repro; код-шлях ідентичний.)

## 4. Recovery після втрати інтернету (п.7)

- `streamingExecutor.resume()`, `checkResumable()`,
  `jobStore.hasResumableJob()` — **існують (DP-3), але з UI НЕ викликаються
  ніде.** `grep` по `src/components/DocumentProcessorV2/` — нуль entrypoint
  «продовжити/resume/перерваний».
- Provider при mount робить лише `attachDrivePolling({loadState})`. Polling
  оживає **тільки якщо в `jobProgressStore` вже є job** (`jobs.size>0`).
  На свіжому завантаженні вкладки стор порожній (модуль-сінглтон
  скидається) → polling не стартує → **Drive `job_state.json` ніхто не
  сканує** → resume не пропонується.
- Втрата мережі під час AI: `callAPIWithRetry` 5×retry (~24-46с) → throw →
  `reconstructAcrossFiles` catch → 0 docs → splitDocumentsV3 гілка B →
  `drivePort.readBytes` (мережа лежить) → throw → `UPLOAD_FAILED
  file_skipped` → pipeline `ok:false` → executor STOPPED, `saveState`
  (`resumable:true`) → `job_state.json` лишається. UI: `startProcessing`
  catch → `toast.error`, `setRunning(false)`. **Resume-UI немає** → стан
  «зникає», продовжити неможливо. **Підтверджено: resume — мертвий код з
  точки зору UI.**

## 5. ВИСНОВОК і рекомендація

### Гіпотеза адвоката — підтверджена (з уточненням механізму)

Multi-file реконструктор **архітектурно непридатний** для single-file
нарізки: промпт про «пакет/хвости/наступний файл», не ставить задачу
нарізки, текст ріжеться до 50K, немає маркерів сторінок → AI або повертає
порожньо, або галюцинує межі. `shouldReconstruct: >=1` примусив цей
непридатний шлях. **Зависання** — окремий дефект (no-timeout `fetch` +
довгий Sonnet + присипляння вкладки планшета), який робить картину
«100%, processing, назавжди».

`detectBoundariesV3` ВЖЕ має правильну гілку: `live.length === 1 &&
stageDeps.detectSingle` → делегує одно-файловому детектору
(`documentBoundary.detectBoundaries` → `analyzeBoundariesViaToolUse`:
**окремий промпт «наріж склеєний PDF», сам PDF як Document Block, реальні
сторінки**). **Provider просто ніколи не ін'єктував `detectSingle`** —
оце справжній невиправлений баг DP-4 (а не gate `>1`).

### Рекомендація: **Варіант C** (revert `>=1`, ін'єктувати `detectSingle`)

1. **Відкотити** `shouldReconstruct: live.length >= 1` у Provider (це
   неправильний фікс — примушує непридатний інструмент).
2. **Ін'єктувати `detectSingle`** у `createDetectBoundariesV3` у Provider:
   `detectSingle = ({arrayBuffer,...}) => documentBoundary.detectBoundaries(...)`
   + `readArrayBuffer(item) = drivePort.readBytes(item.driveId)` (байти
   робочої копії з `_temp` — вони ще там до `clearState`). Це активує
   виділений single-PDF промпт з реальним PDF (як у першому DP, що
   працював). Multi-file гілка лишається для реальних пакетів (>1 файл).
3. **Додати timeout** у `callAPIWithRetry` (`AbortController`, напр. 90с на
   спробу) — інакше будь-який AI-виклик може підвісити весь pipeline.
4. **Wire resume:** Provider при mount сканує Drive на незавершені
   `job_state.json` (`hasResumableJob`), `DocumentProcessorV2` показує
   «Продовжити перервану обробку» → `pipeline.resume(input)`.
5. (Похідне) `resolveModel('document_parser')` — ключа немає в
   `SYSTEM_DEFAULTS` (там `qiParserDocument`/`documentProcessor`), тихий
   fallback на Sonnet. Узгодити agentType при wiring detectSingle.

**Варіант B** (AI швидко визначає режим, адвокат підтверджує) — гарне
**доповнення** пізніше (DP-5/6), але потребує UI підтвердження; не
обов'язковий щоб полагодити Брановського.
**Варіант A** (адвокат явно обирає Нарізати/Склеїти/Додати/Авто) —
надійний запасний, якщо AI-детект режиму виявиться ненадійним; теж UI.
**C — мінімальний, архітектурно правильний, без нового UI, відновлює
поведінку першого DP.** A/B — наступний крок поверх C.

### Що НЕ так з поточним станом main

BUGFIX `f4872ac` на `main` містить корисні фікси (Баг 2/3/4/5/7/8/9 +
класифікація + дедуп — вони валідні й не пов'язані з цією проблемою) АЛЕ
Баг 1 «фікс» (`shouldReconstruct: >=1`) — неправильний і активує
непридатний шлях. **Рішення адвоката потрібне:**

- **(C-fix-forward)** лишити main як є, окремий наступний коміт: revert
  `>=1` + ін'єкт `detectSingle` + timeout + resume-wire. *(рекомендовано —
  решта BUGFIX корисна, не чіпаємо; деплой уже стався)*
- **(revert-all)** відкотити весь `f4872ac` з main, переробити Баг 1
  правильно, повернути решту фіксів. *(дорожче, втрачає валідні фікси)*
- **(revert-partial)** один коміт що скасовує лише `shouldReconstruct`-
  рядок у Provider (DP знову не нарізає, але не висить на непридатному
  шляху), повноцінний C — окремим TASK.

---

## 6. Перелік знахідок (підсумок)

| # | Знахідка | Файл:деталь | Тяжкість |
|---|---|---|---|
| R1 | `shouldReconstruct:>=1` примушує непридатний multi-file реконструктор на single-file | `DocumentPipelineContext.jsx` (BUGFIX) | **критич.** |
| R2 | `fetch` без timeout/AbortController → pipeline висить назавжди | `toolUseRunner.js:352` | **критич.** |
| R3 | `detectSingle` ніколи не ін'єктований Provider'ом (правильний шлях мертвий) | `DocumentPipelineContext.jsx` | **критич.** |
| R4 | Промпт реконструкції не ставить задачу нарізки + framing «пакет/хвости» | `multiFileReconstructor.js buildReconstructionPrompt` | висока |
| R5 | Текст ріжеться `slice(0,50000)` зі 119K+ → AI бачить ~⅓ справи | `multiFileReconstructor.js:55` | висока |
| R6 | Немає маркерів сторінок у тексті → AI галюцинує `startPage/endPage` | `streamingExecutor mergeText` / промпт | висока |
| R7 | Resume (executor.resume/hasResumableJob) існує, але з UI не викликається | `DocumentPipelineContext.jsx`, `DocumentProcessorV2` | висока |
| R8 | `resolveModel('document_parser')` — ключа нема в SYSTEM_DEFAULTS, тихий fallback Sonnet | `modelResolver.js` vs `DocumentPipelineContext.jsx aiReconstructFile` | середня |
| R9 | Прогрес «застигає» після OCR для обох UI (топбар «живий» лише через CSS-спінер) — наслідок R1/R2, не окрема регресія | `jobProgressStore` (push лише під час OCR) | інфо |
| R10 | `job_state.json` поля `reconstructionPlan/cursor/documents` — неінформативні (executor їх не пише); підозри п.2,4 — хибний слід | `jobState.js:53,56` | інфо |

---

## 7. Наступний крок

Розслідування завершене, **код не змінювався, нічого не пушилось**
(окрім уже-наявного на main `f4872ac` з попереднього ходу). Чекаю
рішення адвоката за §5 «Що НЕ так з поточним станом main»: який варіант
обробки Баг 1 (C-fix-forward / revert-all / revert-partial) і чи
затверджувати Варіант C як архітектуру нарізки single-file.
