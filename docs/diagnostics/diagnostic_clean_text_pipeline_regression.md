# HANDOFF / ПРОМПТ ДЛЯ СВІЖОЇ СЕСІЇ — регресія DP: OCR/нарізка зламані після clean-text (TASK 3)

> **Це готовий промпт.** Встав його як завдання у НОВУ сесію Claude Code (web). Він самодостатній: усі SHA, файли і метод усередині. Сесія, що його написала, була довга — тому передаємо свіжій з повним бюджетом контексту.

---

## 0. ПЕРЕД РОБОТОЮ (обов'язково)

1. Прочитай `CLAUDE.md` (архітектура) і `DEVELOPMENT_PHILOSOPHY.md` (принципи) — без цього не починай.
2. Гілковий воркфлоу — за `CLAUDE.md` правило №1 (web/remote → працюєш на виданій `claude/*`, у `main` зводиться тільки FF при зелених тестах; **зміни коду — лише після підтвердження адвоката**).
3. **Спершу АНАЛІЗ і письмовий звіт, тільки потім фікс.** Адвокат вимагає: знайти причину доказово, показати, і аж тоді відновлювати. Не «вгадав і поправив».

---

## 1. СИМПТОМ (слова адвоката, 2026-06-01)

Document Processor (DPv2) перестав нормально нарізати скановані PDF:

- Файли, які **раніше стабільно нарізалися на багато документів**, тепер → **1 документ** на весь файл.
- У папці справи `02_ОБРОБЛЕНІ` **немає артефактів узагалі** (.txt/.layout). Файл потрапляє **тільки в `01_ОРИГІНАЛИ`**.
- Найменший із пачки (~43 МБ) при окремому прогоні **впав з помилкою `EXECUTOR_THREW: Файл більший за 40 МБ`** (видно в Зоні 2 → «Потребує уваги»).
- Більші файли (143 МБ та ін.) «не лізуть» — той самий результат (1 документ / порожньо в 02).

**Це ТІ САМІ файли, що працювали.** Конкретно: пачка з 6 файлів (~43, 42, 38, 35, ~18-19 МБ і ще один) **раніше нарізалась нормально, усі шість**. Той самий 335-сторінковий том (раніше ~200 МБ, нещодавно стиснутий до ~79 МБ нашим стендом #39) **раніше різався на 18-21 документ**. Адвокат **впевнений**, що це регресія коду, а не дані/файли — тест із оригіналом 200 МБ він робити відмовився як марнування часу, і має рацію: набір файлів незмінний.

**Часова кореляція:** усе працювало **до 2026-06-01**. Сьогодні в `main` зайшов clean-text (TASK 3). Після цього — поломка. Адвокат прямо вказує: clean-text заліз у сам **OCR-на-нарізці** («самий OCR той йшов на нарізці, воно там щось наплутало»). Функцію очистки **двічі переробляли** (зміна філософії), і десь у тих комітах регресія.

---

## 2. МЕЖІ КОМІТІВ (точні SHA)

| Що | SHA | Дата |
|---|---|---|
| **Останній РОБОЧИЙ стан pipeline** (main до clean-text) | **`af7cb4d`** | 2026-06-01 |
| clean-text зайшов у main (merge) | **`ab6086e`** | 2026-06-01 |
| clean-text: ядро + DP-консолідація + schemaVersion 10 | `fd8d913` | 2026-06-01 |
| clean-text: поправка філософії (пост-крок) | `0d5d25a` (docs), `67fdda4` (code) | 2026-06-01 |
| clean-text доп2: чанкування+ліміти cleanTextService | `788b821` | 2026-06-01 |

**Робочий diff для аналізу:** `git diff af7cb4d ab6086e -- <pipeline-файли>`.
**Перевірити робочий стан емпірично:** `git checkout af7cb4d` (детач) і прогнати ту саму пачку АБО `git checkout af7cb4d -- <файл>` для точкового порівняння.

### Файли pipeline, які clean-text змінив (фокус аналізу):

```
src/contexts/DocumentPipelineContext.jsx          (~42 рядки) — wiring стадій, processChunk=ocrChunkBytes, writeText02/writeLayout02, cleanForReading
src/services/documentPipeline/stages/extractV3.js (~59, переважно ВИДАЛЕННЯ) — прибрано in-memory очистку, лишає сирий txt
src/services/documentPipeline/stages/splitDocumentsV3.js (+32) — ДОДАНО пост-крок очистки після writeProcessedArtifacts
src/services/ocrService.js                         (+117) — markdown-хелпери (getCleanOrRawText/writeMarkdownArtifact/archiveRawTxt/...)
```

Дотичні (schemaVersion 10 — **НЕ ламати дані**): `App.jsx` (EFFECT-A migrateToVersion10), `migrationService.js`, `actionsRegistry.js` (`update_document` allowlist += textFormat/cleanedAt), `documentSchema.js`, `documentFactory.js`.

---

## 3. КАРТА ШЛЯХУ OCR→ТЕКСТ→МЕЖІ→02 (щоб не блукати)

```
DPv2 (DocumentProcessorV2/index.jsx) → pipeline.run(input)
  → streamingExecutor.run → для кожного PDF: streamFile()
      → chunkManager.planChunks({buffer, fileSizeBytes, ...})  ← memoryMonitor.adviseChunkPages вирішує сторінок/чанк
      → для кожного чанка: materializeChunk (worker splitPdf → _temp) → readChunkBytes
          → deps.processChunk = ocrChunkBytes (DocumentPipelineContext.jsx:110)
              → ocrService.extractText({localBlob: chunkPDF}, {forceProvider:'documentAi'})
                  → documentAi.extract: РЯДОК 298 — if (arrayBuffer > 40МБ) throw 'Файл більший за 40 МБ'
      → mergeText (worker) → state: streamed text/layout per fileId
  → стадії диригента (через getStreamedText/getStreamedLayout):
      detectBoundaries = createTriageStage  (межі з OCR-тексту; skipPdfSlicing → 1 doc add_as_is)
      → confirm → extractV3 (готує processedText='txt')
      → persist = splitDocumentsV3 → writeProcessedArtifacts → writeText02/writeLayout02 (→ 02_ОБРОБЛЕНІ)
          → [clean-text ПОСТ-КРОК cleanFinalizedDocument, якщо cleanForReading]
```

`getStreamedText(fileId)` порожній → triage бачить порожній текст → **1 документ**; і extractV3 passthrough → нема `processedText` → **02 порожнє**. Тобто «1 doc» і «порожнє 02» — наслідок **порожнього/відсутнього OCR-тексту**. А `EXECUTOR_THREW: Файл більший за 40 МБ` — це коли **чанк, відданий у OCR, вийшов >40 МБ**.

---

## 4. ЩО ВЖЕ ПЕРЕВІРЕНО (ЛІДИ — перевір, НЕ вір на слово)

Попередня сесія (статичний аналіз, без прогону) встановила. Підтвердь або спростуй емпірично:

1. `extractV3.js` (поточний) **усе ще** виставляє `processedText` зі streamed-тексту (на вигляд цілий). → Перевір, що streamed-текст реально доходить.
2. За `git show --stat`, clean-text **НЕ чіпав** `streamingExecutor.js`, `chunkManager.js`, `memoryMonitor.js`, `triageStage.js`, `documentAi.js`. → Тобто якщо регресія в OCR/нарізці — вона **непряма** (через зміну wiring/контексту/стадій). Перевір diff `DocumentPipelineContext.jsx` ОСОБЛИВО уважно (там processChunk, getStreamedText wiring, writeText02).
3. **`memoryMonitor.adviseChunkPages` має реальний баг** (рядок 88): `Math.max(MIN_CHUNK_PAGES=5, …)` затирає байтовий бюджет → для сторінок >8 МБ чанк форсується ≥5 стор. → може перевищити 40 МБ. **АЛЕ** для 79 МБ/335 стор. (~0.24 МБ/стор.) чанк ≈6 МБ — цей баг **НЕ пояснює** 40-МБ throw на цьому файлі. Цифри не сходяться → ймовірно проблема в **самій нарізці чанка** (worker `splitPdf` віддає більше, ніж діапазон) АБО whole-file потрапляє в extract. **ІНСТРУМЕНТУЙ**: залогуй реальний `chunk.startPage/endPage` і `chunkBytes.byteLength` ПЕРЕД `processChunk`.
4. `writeText02`/`writeLayout02` у `DocumentPipelineContext.jsx` мають **порожній `catch {}`** — мовчки ковтають помилки запису в 02. Це може давати «02 порожнє» **без жодної помилки в UI**. Розмежуй для діагностики (логуй помилку, не ковтай).
5. **«1 документ на великих однотипних томах» — ВІДОМА невиправлена проблема Triage**, зафіксована комітом `ac6a135` (26.05) дослівно: *«Цей TASK НЕ виправляє Том 2/3 — окрема структурна проблема Triage на однотипному контенті»*. → Частина симптому «1 doc» **могла існувати до clean-text**. **ОБОВ'ЯЗКОВО розрізни**: що зламав clean-text vs що було відомою дірою Triage. Не звали все на clean-text і не пропусти реальну регресію.

---

## 5. КОНТЕКСТ ДИЗАЙНУ CLEAN-TEXT (щоб не знищити потрібне)

- Адвокат згадує: спершу clean-text задумувався як **очистка ВСЬОГО тексту ДО нарізки** (OCR → очистити весь текст → потім різати на сторінки). Потім філософію **змінили на пост-крок ПІСЛЯ нарізки** на готових документах (`67fdda4`). Через ці переробки, на думку адвоката, OCR-на-нарізці заплутали.
- **Поточний канон у `CLAUDE.md`** (розділ «Очистка тексту → Markdown, TASK 3.1»): очистка — ПОСТ-КРОК у `splitDocumentsV3` ПІСЛЯ `writeProcessedArtifacts`; `extractV3` сирий txt; viewer читає `.md`; **schemaVersion 10 уже в даних** (`textFormat`/`cleanedAt`).
- ⚠ **Тому НЕ роби сліпий `git revert ab6086e`**: це знесе schemaVersion 10 (поламає вже мігровані дані), viewer .md, і потрібну адвокату функцію. clean-text **бажаний** — але він **не сміє ламати OCR/нарізку/запис у 02**.

---

## 6. МЕТОД (жорстко, без здогадів)

1. **Відтворити + інструментувати** (або порівняти з `af7cb4d`):
   - Залогувати в `streamFile`: `chunk.startPage-endPage`, `chunkBytes.byteLength` перед OCR; довжину `res.text` після; помилки `writeText02`.
   - Прогнати представницький файл (можна малий ~18 МБ з тієї пачки — він теж ламається). Зафіксувати, на якому саме кроці рветься: чанк >40 МБ? порожній OCR-текст? порожнє 02 при непорожньому тексті?
2. **Порядковий diff** `git diff af7cb4d ab6086e -- src/contexts/DocumentPipelineContext.jsx src/services/documentPipeline/stages/extractV3.js src/services/documentPipeline/stages/splitDocumentsV3.js`. Поясни ефект **кожного** хунка на потік OCR→текст→межі→02. Шукай: розрив `getStreamedText` wiring; зміну порядку/умов стадій; пост-крок, що кидає/блокує persist; зміну `processChunk`.
3. **Бінарне підтвердження**: `git checkout af7cb4d -- <підозрюваний файл>` поверх поточного → прогнати → якщо лагодиться, регресія саме в дельті цього файлу. Звузити до конкретних рядків.
4. **Розрізнити** регресію clean-text від відомої дірки Triage (`ac6a135`, п.4.5).

## 7. ВІДНОВЛЕННЯ (після доказаної причини)

- **Мінімальне**: повернути робочу поведінку OCR/нарізки/запису-в-02 точно як на `af7cb4d`, **зберігши** clean-text як опційний пост-крок, що **не запускається і не заважає**, поки не ввімкнено тумблер «Очистити для читання».
- Якщо регресія структурно сплетена з clean-text — **відкоти лише винні хунки** і пере-приземли clean-text чисто (не весь merge).
- **schemaVersion 10 і міграцію не чіпати** (дані вже мігровані; ідемпотентність зберегти).
- Полагодь принагідно два реальні дефекти: (а) floor у `memoryMonitor` (байтовий бюджет має право опускати чанк нижче 5, аж до 1); (б) `catch {}` у `writeText02/writeLayout02` (хоча б логувати, щоб «02 порожнє» не було тихим).

## 8. ОБМЕЖЕННЯ І ЗДАЧА

- Тести зелені (`npm test`); нові — для виявленої регресії (інтеграційний DP-тест, що ловить «≥2 документи + є артефакти в 02» на представницькому вході).
- `CLAUDE.md` правило №3 (merge — не лишати обидва варіанти), №4 (try/catch у async), №11 (однозначність).
- **Здача:**
  1. `docs/diagnostics/diagnostic_clean_text_pipeline_regression.md` — звіт: точна причина + докази (логи/diff/рядки), розмежування з дірою Triage.
  2. Фікс (на гілці) + зелені тести.
  3. **Підтвердження адвоката ПЕРЕД `main`** (це код → CI+деплой).

---

**TL;DR для сесії:** Між `af7cb4d` (працювало) і `ab6086e` (clean-text, зламалось) зламались OCR-нарізка і запис у `02_ОБРОБЛЕНІ` — файли йдуть у 1 документ без артефактів, малий падає на «Файл більший за 40 МБ». Знайди точну причину в дельті 4 pipeline-файлів (особливо `DocumentPipelineContext.jsx`), доведи інструментуванням, відрізни від відомої дірки Triage (`ac6a135`), і віднови робочу поведінку **не зносячи** clean-text/schemaVersion 10. Спершу звіт, потім фікс, потім підтвердження для `main`.
