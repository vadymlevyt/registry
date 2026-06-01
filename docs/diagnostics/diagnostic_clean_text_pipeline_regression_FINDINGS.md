# FINDINGS — діагностика регресії DP (OCR/нарізка) «після clean-text»

> **Статус: ТІЛЬКИ ДІАГНОСТИКА. Фікс НЕ застосовано** (це окрема наступна сесія).
> Жодного рядка продакшн-коду не змінено. Усі 1807 тестів зелені на поточному стані.
> Сесія: гілка `claude/diagnostic-clean-text-regression-scDiU`.

---

## 0. TL;DR (одне речення на кожне)

1. **clean-text НЕ винний.** Дельта `af7cb4d→ab6086e` доказово НЕ чіпає жодного файлу OCR/чанкування/triage; усе OCR-ядро **байт-у-байт ідентичне** робочому стану.
2. **Премиса хендофу зламана:** «робочий» `ac6a135` і поточний `main` (`ab6086e`) — **РОЗ'ЄДНАНІ історії без спільного предка** (був rewrite). «Звинувачуй дельту af7cb4d→ab6086e» — хибна рамка; реальна дельта «з робочого» — це величезний рефактор image-merge/TASK 2 (≈9790+/4772−), а не clean-text.
3. **Обидва симптоми — це ПРЕ-існуючий, НЕзмінений код**, не нова регресія: «40 МБ» = дефект `adviseChunkPages` (floor `MIN_CHUNK_PAGES=5` перебиває байтовий бюджет + середнє-замість-max байт/стор., сценарій C); «1 документ / порожнє 02» = `triage_whole_volume` (AI не зміг знайти межі на томі ≥70 стор.) **АБО** тумблер `skipPdfSlicing`.
4. **H1 і H2 (обидві гіпотези хендофу) спростовані на рівні коду:** релевантний код не змінювався з робочого стану → причина не в дельті, а в **рантайм/вхідних умовах** (конкретний файл + середовище), яку без живого прогону доказати не можна — даю план інструментування для наступника.

---

## 1. МЕТОД І ДЖЕРЕЛА ДОКАЗІВ

Усі висновки нижче — з `git` (вміст і топологія), читання коду і повного прогону тестів.
Реальні 40-МБ файли адвоката + Drive + планшет недоступні в пісочниці → **симптом не
відтворювався наживо**; де висновок спирається на рантайм, це явно позначено
«потребує підтвердження прогоном».

Команди-докази (можна перепровірити):
```
git diff --stat af7cb4d ab6086e -- src/services/ocr/ src/services/documentPipeline/   # OCR-ядро не в дельті
git merge-base ac6a135 ab6086e                                                          # ПОРОЖНЬО → нема предка
git merge-base --is-ancestor ac6a135 ab6086e ; echo $?                                  # 1 → НЕ предок
git diff --stat ac6a135 ab6086e -- src/                                                 # реальна «з робочого» дельта
npm ci && npm test                                                                       # 141 файл / 1807 тестів — зелено
```

---

## 2. FINDING 1 — clean-text ЕКЗОНЕРОВАНО (доказово)

**Дельта clean-text-мерджу `af7cb4d→ab6086e` НЕ містить жодного файлу OCR/чанкування/triage:**

```
git diff --stat af7cb4d ab6086e -- \
  src/services/ocr/documentAi.js \
  src/services/documentPipeline/memoryMonitor.js \
  src/services/documentPipeline/chunkManager.js \
  src/services/documentPipeline/streamingExecutor.js \
  src/services/documentPipeline/stages/triageStage.js
→ (порожньо)
```

Pipeline-файли, які clean-text реально чіпав, потоку OCR-тексту НЕ рвуть:
- **`extractV3.js`** — лише ВИДАЛЕНО мертву in-memory очистку (`aiCleanText`); `getStreamedText`-аксесор і `processedText` лишилися (рядки 34–66 поточного файлу). Текст так само доходить.
- **`splitDocumentsV3.js`** — ДОДАНО пост-крок очистки ПІСЛЯ `writeProcessedArtifacts` (рядки 406–435), у `if (cleanForReading===true && typeof cleanFinalizedDocument==='function')`. Тумблер `cleanForReading` за замовчуванням **OFF** → блок не виконується. Навіть якщо ON — він обгорнутий у try/catch, persist уже завершено, throw звідти не блокує нарізку.
- **`DocumentPipelineContext.jsx`** — лише wiring (прибрано `aiCleanText`, додано `cleanFinalizedDocument`). `getStreamedText/getStreamedLayout` передаються в стадії без змін (рядки 195–208).

**Висновок:** clean-text фізично не може сам спричинити «1 doc / порожнє 02 / 40 МБ» — код, що це робить, у його дельті відсутній. **H1 («clean-text зламав wiring/потік тексту») спростована.**

---

## 3. FINDING 2 — ПРЕМИСА ХЕНДОФУ ЗЛАМАНА: РОЗ'ЄДНАНІ ІСТОРІЇ

Хендоф припускає лінійність `ac6a135 → … → af7cb4d → ab6086e`. Це **не так**:

```
git merge-base ac6a135 ab6086e        → (порожньо: спільного предка НЕМАЄ)
git merge-base --is-ancestor ac6a135 ab6086e ; echo $?   → 1 (НЕ предок)
git rev-list --count ac6a135 ^af7cb4d → 28
git rev-list --count af7cb4d ^ac6a135 → 45
```

Тобто між «підтверджено робочим» `ac6a135` і поточним main стався **rewrite історії**
(rebase/squash/нова коренева гілка). Наслідки для діагностики:
- Вузький diff `af7cb4d→ab6086e` (на якому наполягає хендоф) — **не** «що змінилось з робочого».
- Реальна змістова дельта «робоче → поточне» — це `git diff ac6a135 ab6086e`:
  **≈9790 вставок / 4772 видалень у 61 файлі**, де домінує **рефактор image-merge / TASK 2**
  (ImageMergePanel розбито на модулі, `DocumentProcessorV2/index.jsx` +434, `multiImageToPdf` +258,
  `imageDocumentGrouper` +391, `prepareImagesForMerge` +335, новий `ImageEditor/*`), а **не** clean-text.

⚠ **Важливо для довіри:** оскільки історії роз'єднані, `git diff ac6a135 …` показує різницю
ДВОХ незалежно зібраних дерев, а не «навмисні зміни». Тому нижче я спираюсь на **зміст**
(що насправді в коді зараз), а не на «хто який рядок додав».

---

## 4. FINDING 3 — OCR/ЧАНК/TRIAGE ЯДРО БАЙТ-ІДЕНТИЧНЕ РОБОЧОМУ

```
git diff --stat ac6a135 ab6086e -- \
  src/services/ocr/documentAi.js \
  src/services/documentPipeline/memoryMonitor.js \
  src/services/documentPipeline/chunkManager.js \
  src/services/documentPipeline/streamingExecutor.js
→ (порожньо)
```

Між робочим `ac6a135` і поточним `ab6086e` змінилися лише дві стадії pipeline:
- **`triageStage.js` (+69):** ДОДАНО гілку `skipPdfSlicing` (детермінований план, **default OFF**)
  і ВИДАЛЕНО мертвий `allImagesRoute`. Ядро `isDegeneratePlan` / `passportOf` /
  `triage_whole_volume` — **без змін** (підтверджено `git show ac6a135:…/triageStage.js`).
- **`splitDocumentsV3.js` (+24 у вузькому вікні, +56 сумарно):** warning-suppress для whole-file
  add_as_is (1C.3) + пост-крок очистки (clean-text). Логіка нарізки/запису 02 — не чіпана.

**Імплікація для H2:** механізм «40 МБ» живе в `adviseChunkPages`/`documentAi`, **які не
змінювалися з робочого стану**. Тому **нової регресії чанкування немає** — це **латентний,
завжди-присутній** дефект. **H2 у формі «нова поломка чанкування» спростована.**

---

## 5. FINDING 4 — МЕХАНІЗМ «40 МБ» (EXECUTOR_THREW), пре-існуючий

### 5.1 Точка throw і її НЕ-проковтування
`ocrService.extractText({localBlob})` → `documentAi.extract`:
```
src/services/ocr/documentAi.js:298
  if (arrayBuffer.byteLength > 40 * 1024 * 1024) throw makeError('UNSUPPORTED', 'Файл більший за 40 МБ');
```
Цей чек дивиться на **весь blob чанка**, який передав streaming-шар. У `streamingExecutor.streamFile`:
```
src/services/documentPipeline/streamingExecutor.js:126-130
  try { res = await deps.processChunk({ bytes: chunkBytes, … }); }
  finally { chunkBytes = null; }      // throw НЕ перехоплюється — лише занулення
```
→ throw **піднімається** до зовнішнього try `run()` → `state.error = { code:'EXECUTOR_THREW' }`
(рядок 316) і **best-effort rollback** уже створених документів (рядок 353). Тобто **«40 МБ»
АБОРТУЄ задачу**, а НЕ дає «тихо порожній текст».

> **Це спростовує модель §4 хендофу** («порожній getStreamedText → triage бачить порожньо → 1 документ»):
> throw із chunk-OCR не залишає порожній текст — він валить увесь job у Зону 2 «Потребує уваги».
> Тому **«40 МБ» і «1 документ» — РІЗНІ механізми** (див. §6), а не одна причина.

### 5.2 Корінь: floor перебиває байтовий бюджет (дефект `memoryMonitor`)
```
src/services/documentPipeline/memoryMonitor.js:60-88  adviseChunkPages()
  bytesPerPage = fileSizeBytes / pages
  pagesFor40MB = floor(40MB / bytesPerPage)     // байтовий бюджет
  advised = min(DEFAULT=25, pagesFor40MB)
  …
  return Math.max(MIN_CHUNK_PAGES=5, min(MAX=40, advised))   // ← floor ПЕРЕБИВАЄ бюджет
```
Якщо `bytesPerPage > 8 МБ` → `pagesFor40MB ≤ 4` → `advised = 4`, але `Math.max(5, 4) = 5`.
**5 «жирних» сторінок × >8 МБ = >40 МБ** → `documentAi:298` throw. Чанк-менеджер ріже саме
за діапазоном сторінок (`materializeChunk` → worker `splitPdf` по `ranges`,
`chunkManager.js:56-64`), тож такий 5-сторінковий чанк реально матеріалізується >40 МБ.

**Хто це зачіпає:** файл із малою кількістю сторінок і високим байт/стор. (напр. ~43 МБ / 5 стор. ≈ 8.6 МБ/стор.).
Збігається з симптомом «менший файл ~43 МБ при окремому прогоні впав 40 МБ».

### 5.3 Сценарій C (середнє vs max) — другий бік того ж дефекту
`adviseChunkPages` рахує `bytesPerPage` як **середнє** (`fileSizeBytes/pages`). Для тома з
рівним середнім, але кількома дуже жирними сторінками, конкретний 25-сторінковий діапазон
може матеріалізуватися >40 МБ, хоча середнє дозволяє 25. Це рівно §6-C попереднього звіту
(`report_task_documentai_limit_40mb_imageless.md`). Теж пре-існуючий, теж у незмінному коді.

---

## 6. FINDING 5 — МЕХАНІЗМ «1 ДОКУМЕНТ / ПОРОЖНЄ 02», пре-існуючий

Це **НЕ** throw-шлях (§5). Це **свідомий halt triage** на великому томі:
```
src/services/documentPipeline/stages/triageStage.js:322-345
  if (isDegeneratePlan(plan, live)) {
    return { halt:true, decisions:[{ type:'triage_whole_volume', … }] };  // том = 1 шматок
  }
```
`isDegeneratePlan` (рядок 171) → true, коли AI Triage повернув **рівно 1 документ** маршруту
`add_as_is`/`slice`, що покриває **весь** том, і сумарно **≥ `DEGENERATE_MIN_PAGES=70`** сторінок.
Тоді диригент бачить `halt:true` → зупиняє pipeline → persist/02 **не виконується** →
у Зону 3 йде картка `triage_whole_volume` («Потребує уваги»), а файл лишається доданим лише в
01_ОРИГІНАЛИ. **Це і є «1 документ + порожнє 02 + файл тільки в 01».**

**Чому AI повернув вироджений план?** `passportOf` (рядок 25) будує паспорт для triage з
`getStreamedText`+layout. Якщо OCR-текст/паспорт бідний (мало сигналу меж) — Haiku не
розрізняє межі й віддає том одним шматком. Тобто **погана/порожня OCR-видача → вироджений
план → halt → "1 doc"**. Уся ця логіка **існувала вже в `ac6a135`** (підтверджено) — отже це
не нова поломка стадії.

**Другий можливий шлях «1 doc» (відсіяти при відтворенні):** тумблер
**`skipPdfSlicing` («Просто додати файли»)** — коли ON, triage пропускається й кожен файл стає
1 документом `add_as_is` (`triageStage.js:267-285`; default `false`,
`DocumentProcessorV2/index.jsx:60`). Якщо адвокат випадково мав його ON — це дасть рівно
«1 doc / 01 only» детерміновано, без жодних OCR-причин. **Слід перевірити стан тумблера у
прогоні, що впав** (дешева перевірка перед глибоким аналізом).

### Відсів історичних механізмів (вимога хендофу §2)
- **imageless «1 doc» (§2.2 хендофу): ВІДСІЯНО.** `imagelessMode` свідомо НЕ передається у
  `documentAi.js` на ВСІХ трьох комітах (`af7cb4d`, `ab6086e`, **і `ac6a135`**) —
  `git grep imagelessMode <sha> -- src/services/ocr/documentAi.js`. Поточний «1 doc» —
  downstream порожнього/бідного OCR-паспорта (triage_whole_volume), а не imageless.
- **Сценарій C «40 МБ» (§2.1 C): ПІДТВЕРДЖЕНО** як корінь throw-шляху (§5), у незмінному коді.

---

## 7. ВЕРДИКТ ПО ГІПОТЕЗАХ

| Гіпотеза хендофу | Вердикт | Доказ |
|---|---|---|
| **H1** — clean-text-дельта зламала потік/wiring | **СПРОСТОВАНО** | дельта `af7cb4d→ab6086e` не чіпає OCR/triage/chunk (§2); `getStreamedText` wiring цілий; пост-крок default-OFF і у try/catch |
| **H2** — *нова* регресія чанкування (середнє vs max) | **СПРОСТОВАНО як «нова»** | `adviseChunkPages`/`documentAi`/`chunkManager`/`memoryMonitor` **байт-ідентичні** робочому (§4). Дефект РЕАЛЬНИЙ, але **латентний/пре-існуючий**, не привнесений жодним мерджем |

**Справжня причина:** не код-дельта, а **спрацювання латентних дефектів на конкретному
вході/середовищі**. Два незалежні прояви:
- **«40 МБ» (окремий 43-МБ прогін)** = floor-дефект §5.2 / сценарій C §5.3 → `documentAi:298` throw → `EXECUTOR_THREW`.
- **«1 doc / порожнє 02» (пакет)** = `triage_whole_volume` §6 (бідний OCR-паспорт на томі ≥70 стор.) або тумблер `skipPdfSlicing`.

---

## 8. ЧЕСНА МЕЖА: «ЧОМУ ТІ САМІ ФАЙЛИ РАНІШЕ ПРОХОДИЛИ?»

Це **не доведено** без живого прогону, і ось чому це принципово:

- `adviseChunkPages` детермінований за `(totalPages, fileSizeBytes)` **окрім** гілки тиску
  пам'яті, яка читає `performance.memory`. На **iPad/Safari `performance.memory` = undefined**
  (`readMemory` повертає null, `memoryMonitor.js:36-47`) → memory-гілка **не виконується** →
  для тих самих байтів/сторінок вихід ІДЕНТИЧНИЙ. Тобто на планшеті той самий файл при тому
  самому коді мав би поводитись однаково.
- Звідси кандидати, чому «тепер інакше» (їх має розрізнити наступник прогоном):
  1. **Файли не байт-ідентичні** тим, що тестувались на `ac6a135` (пере-збереження/інше
     джерело/інша вибірка сторінок). Адвокат каже «ті самі», але через rewrite історії
     (§3) сам «робочий» baseline нереконструйований — порівняння могло бути на іншому білді.
  2. **Інше середовище** у «робочому» замірі (`report_task_revert_imagelessmode.md` ряд. 22) —
     напр. десктоп Chrome, де memory-гілка дає інший розмір чанка.
  3. **Тумблери прогону** (`skipPdfSlicing`/`compressAll`) у поточному падінні відрізнялись.
     `compressAll` (default false) у `buildRunInput` сканований PDF НЕ стискає
     (`DocumentProcessorV2/index.jsx:197-228` — passthrough), тож рекомпресії в дефолтному
     шляху немає; але якщо тумблер був ON — байт/стор. змінюється.

Без артефактів прогону (файли + лог консолі) точний тригер **не фіксується доказово** — тому
нижче план інструментування, щоб наступна сесія зафіксувала його за один прогін.

---

## 9. ДВА ДОТИЧНІ ДЕФЕКТИ (з §6 хендофу) — вердикт

1. **floor `Math.max(MIN_CHUNK_PAGES=5, …)` (`memoryMonitor.js:88`) — ЛАГОДИТИ.** Це
   проксимальна причина throw-шляху (§5.2). Floor мусить **поступатися** байтовому бюджету:
   якщо бюджет каже <5 стор. на 40 МБ — брати менше (аж до 1), а НЕ форсувати 5.
2. **`catch {}` у `writeText02`/`writeLayout02` (`DocumentPipelineContext.jsx:228,244`) —
   ЛАГОДИТИ (діагностично).** У поточному інциденті 02 порожнє тому, що persist взагалі не
   дійшов (halt) або OCR-тексту не було — тож `catch{}` тут нічого не «з'їв». **Але** він
   маскує реальні помилки запису 02 і робить майбутню діагностику сліпою. Замінити на
   логування (`console.warn`) без зміни «не критично для job». Те саме стосується кількох
   `catch {}` у `splitDocumentsV3.js` навколо `writeText02`/`writeLayout02`.

---

## 10. ГОТОВИЙ ПЛАН ФІКСУ ДЛЯ НАСТУПНОЇ СЕСІЇ

> Очистка clean-text і schemaVersion 10 **зберігаються повністю** — їх чіпати не треба
> (вони не причетні). Фікс — у пре-існуючому чанк/triage-ядрі + діагностика.

### Крок 0 — ІНСТРУМЕНТУВАТИ і ВІДТВОРИТИ (1 прогін малого файлу з пачки)
Тимчасові логи (НЕ комітити у фінал):
- `streamingExecutor.streamFile` перед `processChunk` (рядок 127): лог
  `fileId, chunk.index, startPage-endPage, chunkBytes.byteLength, advisedChunkPages, totalPages, fileSizeBytes`.
- `memoryMonitor.adviseChunkPages`: лог `bytesPerPage, pagesFor40MB, advised(до floor), повернене(після floor)`.
- Triage вже логує `[Triage] artifacts=… pages=… input=…t output=…t` (`analyzeTriageViaToolUse.js`)
  і є `console.info('[DP timing] …')`. Зчитати їх із DevTools Console планшета.
- Зафіксувати ТОЧКУ розриву: (а) чанк >40 МБ? → floor/сценарій C; (б) `triage_whole_volume`
  у decisions? → бідний паспорт; (в) стан тумблерів `skipPdfSlicing/compressAll`.

### Крок 1 — ФІКС floor (корінь «40 МБ»), `memoryMonitor.js`
- Розв'язати floor і байтовий бюджет: floor `MIN_CHUNK_PAGES` застосовувати **лише** коли
  байтовий бюджет його дозволяє; інакше брати `min(advised, pagesFor40MB)` навіть якщо <5
  (мінімум 1). Тобто байтовий ліміт 40 МБ — **жорсткий**, floor — лише оптимізація накладних.
- Розгляд сценарію C: якщо за середнім бюджет дозволяє 25, але реальні сторінки нерівні —
  додати **запас** (напр. цільові 32 МБ замість 40 МБ у `pagesFor40MB`), щоб варіація per-page
  не пробивала 40 МБ. Точне рішення (середнє×запас vs реальний max через pdf-lib metadata) —
  на розсуд наступника; мінімальний фікс = запас + чесний floor.
- **Тести (`tests/unit/memoryMonitor.test.js`):** додати кейси — (а) `bytesPerPage>8МБ` →
  повернене×bytesPerPage ≤ 40 МБ (floor НЕ форсує >40 МБ); (б) рівне середнє, але запас тримає
  чанк <40 МБ. Поточні 8 тестів floor-кейс не покривають.

### Крок 2 — ОБРОБКА «жирного» чанка без аборту (стійкість throw-шляху)
- На `documentAi:298`/`streamingExecutor:127`: коли один чанк >40 МБ — НЕ валити весь job.
  Варіанти (на вибір наступника): рекурсивно ділити чанк навпіл до проходження ліміту, або
  деградувати на `pdfjsLocal`/per-page, або позначити сторінки як `unusedPages` із
  attention-decision замість `EXECUTOR_THREW`. Мінімальний фікс — split-навпіл у
  `streamFile` при упійманому `UNSUPPORTED '>40МБ'`.
- **Тест (`tests/unit/chunkManager.test.js` або новий `streamingExecutor` тест):** чанк, що
  перевищує ліміт, ділиться і проходить, job НЕ падає в `EXECUTOR_THREW`.

### Крок 3 — `catch{}` → видиме логування (діагностична гігієна)
- `DocumentPipelineContext.jsx:228,244` і відповідні `catch{}` у `splitDocumentsV3.js`:
  замінити порожні на `catch (e) { console.warn('[02 write]', name, e?.message) }`. Поведінку
  «не критично для job» зберегти. Жодного тесту не ламає; додати один, що writeText02-помилка
  логиться і не валить persist.

### Крок 4 (опційно, якщо Крок 0 покаже triage_whole_volume) — паспорт triage
- Якщо лог покаже `output` Haiku обрізаним або порожній паспорт — перевірити `passportOf`/
  `resolveBoundaryText` і `max_tokens` (вже піднято до 16000). Якщо паспорт порожній через
  порожній `getStreamedText` — це знов вертає у Крок 1/2 (OCR не дав тексту через 40-МБ-throw).

### Мінімальний фікс vs точковий revert
- **Точковий revert хунків НЕ доречний:** проблемний код не привнесений мерджем (він
  пре-існуючий, ідентичний робочому — §4). Реверт clean-text/wider-window **не полагодить**
  і зруйнує clean-text/schemaVersion 10. Тому — **мінімальний прицільний фікс** Кроків 1–3.

---

## 11. ЧІТКО: ФІКС НЕ ЗАСТОСОВАНО

Жодного рядка продакшн-коду не змінено в цій сесії. 1807 тестів зелені на поточному стані
(`ab6086e`-лінія). Цей файл — єдиний артефакт сесії. Реалізація Кроків 1–4 — **окрема наступна
сесія** за цим планом.

---

### Додаток A — ключові координати коду (для наступника)

| Що | Файл:рядок |
|---|---|
| 40-МБ throw (весь blob чанка) | `src/services/ocr/documentAi.js:298` |
| 40-МБ throw (внутр. чанк documentAi) | `src/services/ocr/documentAi.js:390-396` |
| throw НЕ проковтується → EXECUTOR_THREW | `src/services/documentPipeline/streamingExecutor.js:126-130, 316, 353` |
| floor перебиває байтовий бюджет | `src/services/documentPipeline/memoryMonitor.js:60-88` (особл. 88) |
| materialize чанка за діапазоном сторінок | `src/services/documentPipeline/chunkManager.js:35-64` |
| triage halt «том = 1 шматок» | `src/services/documentPipeline/stages/triageStage.js:322-345` |
| `isDegeneratePlan` (≥70 стор.) | `src/services/documentPipeline/stages/triageStage.js:171-199` |
| паспорт triage з OCR-тексту | `src/services/documentPipeline/stages/triageStage.js:25-31` |
| тумблер `skipPdfSlicing` (default off) | `src/components/DocumentProcessorV2/index.jsx:60`; гілка `triageStage.js:267-285` |
| `catch{}` 02-write | `src/contexts/DocumentPipelineContext.jsx:223-245` |
| imageless НЕ передається (відсів §6) | `src/services/ocr/documentAi.js:161` |
