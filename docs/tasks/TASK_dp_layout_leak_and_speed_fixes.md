# TASK — Document Processor: layout-strip leak + speed fixes

**Дата спеку:** 20.05.2026 · **Автор:** Claude (сесія форензичного аудиту DP)
**Статус:** готово до реалізації · **Тип:** виправлення багів + перформанс
**Батьківські TASK:** `docs/tasks/TASK_smart_triage.md`, `docs/tasks/TASK_smart_triage_passport_scale_and_text.md`
**Передумова:** компактний паспорт у `main` (комiт `e19134c`); ФД-1.1 на гілці, НЕ змержена. Цей TASK **не торкається паспорта** — лише виправляє кореневі баги і прибирає серіальні шари. Якість нарізки тестується після фіксів окремо.

---

## 0. Корінь — знайдений з реальних даних

Форензичний аналіз `.layout.json` зі справи Брановського (планшет, тест 17:14-17:28) на 8 сторінок, файл **14 МБ**:

| Поле | Розмір | % від файлу | Має бути |
|---|---|---|---|
| `image` (base64-PNG render сторінки) | 11.6 МБ | 80.7% | **викинуто** |
| `tokens` (per-letter координати) | 2.4 МБ | 16.4% | **викинуто** |
| Корисне (text, blocks, paragraphs, dimension) | ~400 КБ | ~3% | зберігається |

`ocrService.js:139` декларує `STRIPPED_LAYOUT_FIELDS = ['image', 'tokens']`. У TASK_smart_triage §6: «image — base64-PNG, ~7 МБ/стор., саме за це платиться Vision; tokens — по-літерні координати — не треба». Це **головна вартісна оптимізація** проекту.

**Стрип НЕ працює.** Точне місце:

`src/contexts/DocumentPipelineContext.jsx:219-227`:
```js
writeLayout02: async ({ caseData, driveId, name, layoutJson }) => {
  try {
    await ocrService.writeLayoutArtifact(
      { id: driveId, name, subFolders: caseData?.storage?.subFolders },
      typeof layoutJson === 'string' ? layoutJson : JSON.stringify(layoutJson),  // ← БАГ
    );
  } catch { /* layout кеш не критичний */ }
}
```

`JSON.stringify(layoutJson)` перетворює об'єкт на string **до** передачі в `writeLayoutArtifact`. А `writeLayoutArtifact` (ocrService.js:196-206) очікує **об'єкт** для проходу `for (const f of STRIPPED_LAYOUT_FIELDS) delete page[f]`. На string ця логіка не запрацює — поля `image`/`tokens` проходять у Drive як є.

**Магнітуда на Брановському (25 документів):**
- Очікувано: 25 × ~400 КБ layout = ~10 МБ загалом
- Реально: 25 × ~14 МБ layout = **~350 МБ серіальних Drive uploads**
- На планшеті WiFi 5-10 МБ/сек: **5-15 хв** чистого мережевого I/O
- На повільнішій мережі або більшому томі — десятки хвилин

**Catch ковтає помилки:** `try { ... } catch { /* layout кеш не критичний */ }` — pipeline не падає, лише «висить на 100% майже готово».

**Спостережений симптом** (тест адвоката, планшет, 17:14-17:28):
- 17:14 старт → 17:18 (4 хв) усі AI-стадії завершено, UI «100% майже готово»
- 17:18-17:28 (10 хв) — невидиме завантаження 350 МБ
- ~17:28 — image_merge помилка з'являється у UI (окремий баг, B3)
- Деякі документи нарізались (24 з 25), бо catch дозволив pipeline продовжити

---

## 1. Місія (що означає «готово»)

1. **Layout-стрип працює** — на Drive у `02_ОБРОБЛЕНІ/*.layout.json` ВІДСУТНІ поля `image` і `tokens`. Розмір файлу пропорційний корисним даним (~50-100 КБ/сторінку, не ~1.5 МБ/сторінку).
2. **Брановський 65 стор. на планшеті** обробляється **≤ 5 хв** end-to-end (з фіксу B1 одного — десь 60-70% часу зрізається; з P1-P4 — додатково).
3. **В'юер показує перемикач Скан/Текст** на нарізаних з сканованого джерела документах.
4. **image_merge помилки не валять весь pipeline** — конкретний документ позначається в decisions, інші завершуються нормально.
5. Жодних змін у компактному паспорті, Triage, OCR, моделях, диригенті.

---

## 2. Інституційні обмеження (з батьківських TASK §2 — діють тут БЕЗ змін)

- **№1 Provider-injected тест** — кожен фікс має інтеграційний тест через справжній `DocumentPipelineProvider` ін'єктований executor.
- **№4 Диригент заморожений** — без нових стадій, без зміни `DEFAULT_STAGE_ORDER`.
- **№5 Без зміни схеми** — без bump schemaVersion / міграції / бекапу.
- **№11 Один сенс на ім'я** — нові прапори/функції з чітким single-sense коментарем на місці оголошення.
- **№2 fetch timeout** — уже зроблено в Ф1; цей TASK додає аналогічний timeout для Drive (P3).
- npm test ПОВНІСТЮ зелений перед кожним комітом.

---

## 3. БАГИ (Фаза A — критичні, блокують поточну роботу)

### B1 — Layout-strip leak (КОРНЕВИЙ)

**Місце:** `src/contexts/DocumentPipelineContext.jsx:219-227`

**Корінь:** `JSON.stringify(layoutJson)` перед `writeLayoutArtifact` обходить strip.

**Фікс:** Передавати об'єкт, не string. `writeLayoutArtifact` сам зробить strip + serialize.

```js
writeLayout02: async ({ caseData, driveId, name, layoutJson }) => {
  try {
    // ВАЖЛИВО: передаємо ОБ'ЄКТ, не string — щоб writeLayoutArtifact
    // міг прибрати STRIPPED_LAYOUT_FIELDS (image, tokens) перед записом.
    // JSON.stringify виконує writeLayoutArtifact після strip (ocrService.js).
    const obj = typeof layoutJson === 'string' ? JSON.parse(layoutJson) : layoutJson;
    await ocrService.writeLayoutArtifact(
      { id: driveId, name, subFolders: caseData?.storage?.subFolders },
      obj,
    );
  } catch { /* layout кеш не критичний */ }
}
```

**Якщо `writeLayoutArtifact` приймає тільки string** (треба перевірити) — refactor її щоб приймала об'єкт і робила strip+stringify внутрішньо (один сенс: «записати layout на Drive зі стрипом важких полів»). Стара string-сигнатура — deprecated шлях, прибрати.

**Тест (unit):** 
```
tests/unit/ocrService.layoutStrip.test.js
- given layout з pages[].image і pages[].tokens
- call writeLayoutArtifact (з mock Drive uploadText)
- assert: uploaded blob НЕ містить підрядка '"image"' і '"tokens"'
- assert: розмір uploaded blob < (sum of layout.pages[].image+tokens length)
```

**Тест (інтеграційний):**
```
tests/integration/dp.layoutPersist.test.js
- Provider-injected DP run на mock 5-page scan
- assert: всі writeLayout02 викликалися
- assert: жоден з written blobs не має image/tokens (інспектувати mock drivePort.uploadText args)
```

### B2 — `documentNature='scanned'` не виставляється на нарізаних документах

**Місце:** `src/services/documentPipeline/stages/splitDocumentsV3.js:~300-310` (зона `createDocument` для нарізаних)

**Корінь:** При створенні нарізаного документа `createDocument(meta)` отримує meta без `documentNature`. У `documentFactory.js:56`: `documentNature: metadata.documentNature || detectNature(metadata)`. `detectNature` для PDF з extension `.pdf` повертає `null` або `'searchable'` — НЕ `'scanned'`, навіть якщо джерело був скан. В'юер показує перемикач Скан/Текст лише для `documentNature === 'scanned'`.

**Фікс:** У `splitDocumentsV3.js` при формуванні `meta` для `createDocument` явно передавати `documentNature` з джерельного файлу:
- Якщо source `documentNature === 'scanned'` → нарізаний теж `'scanned'`
- Якщо source `documentNature === 'searchable'` → нарізаний теж `'searchable'`
- Якщо source unknown → fallback на `detectNature`

Точне місце правки — там де будується `meta` об'єкт перед `createDocument(meta)` у гілці plan.documents (~268-310). Виявити source file через `fr.fileId` → знайти у `live` → взяти `documentNature` звідти.

**Тест (unit):** 
```
tests/unit/splitDocumentsV3.documentNature.test.js  
- given live[0] = {documentNature: 'scanned'}, plan.doc fragments → live[0]
- call buildMeta() (або еквівалент)
- assert: meta.documentNature === 'scanned'
- repeat for 'searchable', null
```

**Тест (інтеграційний):**
```
tests/integration/dp.viewerToggle.test.js
- Provider DP run на mock scanned PDF → 3 sliced docs
- assert: всі 3 створених документа мають documentNature === 'scanned'
- (опційно) симулювати DocumentViewer mount → assert toggle присутній у DOM
```

### B3 — image_merge помилка валить токсично

**Місце:** image_merge маршрут у PERSIST (де відбувається композиція image → PDF; ймовірно `imageMergeRenderer.js` через `mergeImagesToPdf` ін'єктор у Provider).

**Симптом (зі скріншота):** `HTMLImage→createImageBitmap decode failed: 'The source image could not be decoded'` — на специфічному файлі «Копія паспорту громадянина України (Брановський Л.Б.)». Імовірно HEIC, або PDF з image-only сторінкою якої canvas не приймає, або corrupted bytes.

**Фікс:**
1. **Локалізувати помилку** на рівні конкретного документа: `try { await mergeImagesToPdf(...) } catch (err) { decisions.push({ type: 'image_merge_failed', documentName, message }) }`. Pipeline продовжує інші документи.
2. **Перевірити фідер**: чи цей паспорт міг бути HEIC, який не пройшов через CONVERT (heicToJpeg)? Якщо так — додати fallback: пропустити HEIC через `heicToJpeg` перед image_merge.
3. **Видимий toast** з посиланням на конкретний документ, не загальний «Обробка завершилась з помилками».

**Тест (unit):**
```
tests/unit/imageMerge.errorHandling.test.js
- given mock image bytes що падають на createImageBitmap
- call mergeImagesToPdf
- assert: повертає {success: false, error} замість throw
```

**Тест (інтеграційний):**
```
tests/integration/dp.imageMergePartialFailure.test.js
- 3 image docs: 2 valid + 1 invalid (mocked bad bytes)
- assert: pipeline завершується ok:true
- assert: decisions містить image_merge_failed для конкретного doc
- assert: 2 valid docs створені, 1 invalid — не створений + decision
```

---

## 4. PERFORMANCE OPTIMIZATIONS (Фаза B — на великі томи, незалежні від багів)

Адвокат явно сказав: «на великих томах потрібна максимальна швидкість, кожні 10-20-30 сек економії — це теж треба робити». Чотири мундейн I/O оптимізації, кожна незалежна, кожна низькоризикова.

### P1 — Паралелізувати PERSIST Drive-uploads

**Місце:** `src/services/documentPipeline/stages/splitDocumentsV3.js`:
- Рядок 207 (`for (const doc of plan.documents)` — основний цикл)
- Рядок 320 (`for (const item of live)` — secondary)
- Рядки 421-461 (fragments цикл)

**Фікс:** замінити `for-await` на `Promise.all` з обмеженим concurrency (5-10). Використати наявний хелпер або просту реалізацію `pLimit`.

```js
// Псевдокод
const CONCURRENCY = 5;
const limit = pLimit(CONCURRENCY);
await Promise.all(plan.documents.map((doc) => limit(async () => {
  // тіло циклу як було
})));
```

**Очікуваний виграш:** ~5× на 25 документах (на planшеті обмеження ~6 паралельних HTTP per host — реальний виграш ~3-5×). На Брановському: ~60-100 сек замість ~300-400 сек.

**Тест:**
```
tests/integration/dp.persistConcurrency.test.js
- mock drivePort з контролем concurrency
- DP run на 10-doc plan
- assert: одночасних Drive викликів НЕ > CONCURRENCY
- assert: загальний час менший за serial baseline
```

### P2 — Дебаунс registry-save useEffect

**Місце:** `src/App.jsx:4314-4382` (useEffect з 11-зрізним dep array + writeRegistry).

**Корінь:** під час DP запускається ~150-200 разів через `setAuditLog`, `setAiUsage`, etc. Кожен раз: 9 синхронних localStorage.setItem + опційно Drive write. Без дебаунсу.

**Фікс:** trailing-debounce 500-1000ms на сам useEffect (зачекати «тишу» state-змін перед save).

```js
// Псевдокод (всередині useEffect)
const saveTimerRef = useRef(null);
useEffect(() => {
  if (!ready) return;
  clearTimeout(saveTimerRef.current);
  saveTimerRef.current = setTimeout(() => {
    // existing save logic
  }, 800);
  return () => clearTimeout(saveTimerRef.current);
}, [/* той самий dep array */]);
```

**УВАГА:** **Не** дебаунсити критичні операції (`destroy_case`, `close_case`) — там потрібен immediate save. Якщо є — flag для immediate.

**Очікуваний виграш:** на Брановському ~150 fires → ~3-5 saves = ~10-15 сек економії на localStorage + Drive.

**Тест:**
```
tests/unit/registrySave.debounce.test.js
- fire 10 state changes в межах 100ms
- advance fake timers 800ms
- assert: writeRegistry викликався РАЗ
- fire 1 state change, advance 1500ms, fire ще 1, advance 800ms
- assert: writeRegistry викликався 2 рази
```

### P3 — Drive API timeout

**Місце:** усі функції в `driveService` (App.jsx ~2900+) і `drivePort` обгортка (де є).

**Корінь:** жоден Drive виклик не має explicit timeout. Покладаємось на дефолтний браузерний fetch (невизначений, часто десятки хвилин).

**Фікс:** обгорнути всі Drive API в `fetchWithTimeout(url, opts, 60_000)` з AbortController. На abort → проброс помилки нагору. catch у викликачах залишається.

**Очікуваний виграш:** прибирає невидимі багатогодинні зависання при мережевих проблемах.

**Тест:**
```
tests/unit/driveService.timeout.test.js
- mock fetch що не повертається
- assert: driveService.uploadFile rejects with AbortError через 60s
```

### P4 — jobState save throttle

**Місце:** `src/services/documentPipeline/streamingExecutor.js:110, 139` (per-chunk `jobStore.saveState`).

**Корінь:** ~120 saveState/DP run × ~100-200мс кожен Drive write = ~12-24 сек прихованої роботи.

**Фікс:** throttle saveState до ≤1 раз/10 сек (для прогресу) + immediate save при критичних подіях (chunk done, error, cancellation).

**Очікуваний виграш:** ~10-15 сек економії, без втрати resume-функціональності (resume бачить ≤10-сек давніший стан — прийнятно).

**Тест:**
```
tests/unit/jobState.throttle.test.js
- fire 30 saveState calls в межах 5 сек
- assert: drivePort.uploadText викликався ≤2 рази
- assert: останній call містить найсвіжіший стан
```

---

## 5. Фази з STOP-точками

- **Фаза A — БАГИ (B1, B2, B3).** Незалежно одна від одної, можна паралельно або послідовно. Зелені тести на межі. **ТВЕРДИЙ STOP** — адвокат тестує Брановського на планшеті. Очікувано: ≤5 хв, 25 нарізаних з перемикачем Скан/Текст, image_merge не блокує. *Якщо так — переходимо до фази B. Якщо ні — діагностика.*
- **Фаза B — PERFORMANCE (P1, P2, P3, P4).** Незалежні. STOP на межі. Адвокат тестує — фіксує перформанс на 65pp і за можливості більший том. *Якщо швидкість прийнятна — фаза C.*
- **Фаза C — звіт** `docs/reports/report_task_dp_layout_leak_and_speed_fixes.md` (з baseline до/після, де відомо), оновити `ARCHITECTURE_HISTORY.md`. Без зайвого шуму.

Рекомендований порядок: B1 (КОРІНЬ) → B2 → B3 → STOP → P1 → P2 → P3 → P4 → STOP → звіт.

**B1 один сам по собі — головний виграш** (з 350 МБ upload до ~10 МБ). Якщо адвокат хоче — можна зупинитись лише на ньому і тестувати, інші — окремими TASK.

---

## 6. Acceptance criteria (бінарний чек-лист)

### Фаза A
- [ ] `02_ОБРОБЛЕНІ/*.layout.json` на Drive НЕ містять `image` і `tokens` полів (інспекція реального файла адвокатом + unit тест).
- [ ] Розмір layout-файлу пропорційний `_text + blocks + paragraphs` (~50-100 КБ/стор., не ~1.5 МБ).
- [ ] Брановський 65pp на планшеті ≤ 5 хв (з фіксу B1 одного очікувано ~2-3 хв).
- [ ] Перемикач Скан/Текст з'являється у в'юері на нарізаних документах (`documentNature='scanned'` у створених документах).
- [ ] image_merge помилка на конкретному документі НЕ валить інші — pipeline ok:true, decisions містить точну помилку.
- [ ] Всі unit + integration тести зелені (новий + наявний suite).

### Фаза B
- [ ] PERSIST використовує `Promise.all` з concurrency ≤10; на 25 документах одночасних Drive-викликів ≤10.
- [ ] Registry-save дебаунс активний — на 100 state-mutations в межах 500мс пишеться 1 раз.
- [ ] Drive операції мають explicit 60s timeout, abort працює.
- [ ] jobState throttling: ≤1 save/10 сек у нормальному режимі.
- [ ] Без регресії: всі попередні тести зелені.

### Загальне
- [ ] npm test зелений ПОВНІСТЮ.
- [ ] Жодних змін у компактному паспорті, Triage, OCR, моделях, диригенті, схемі.
- [ ] `tracking_debt.md` оновлено якщо знайдено побічні баги.

---

## 7. SAAS IMPLICATIONS

- Жодної нової сутності, схеми, прав. Усі фікси — внутрішня механіка.
- `tenantId` не зачіпається. Resume-стан per-case успадковує tenant.
- Drive operations залишаються per-tenant через `tenant.storage` фасад (нічого не міняється).

## 8. BILLING IMPLICATIONS

- Цей TASK **зменшує** час адвоката у `time_entries[]` (DP-сесія стає коротшою). Очікувано середній time_entry на DP-job впаде з ~50 хв до ~5 хв.
- Жодних нових білінг-точок. `activityTracker.report` і `logAiUsage` уже інструментовані в наявних місцях.
- НЕ дублювати поля між `ai_usage[]` і `time_entries[]`.

## 9. AI USAGE IMPLICATIONS

- AI виклики **не торкаємо**. Triage (Sonnet/Haiku), classify (Haiku), extract (Haiku) залишаються як є. Модель не міняється.
- `resolveModel('documentProcessor')` — без змін у цьому TASK (питання Haiku-vs-Sonnet — окрема дискусія).

---

## 10. ПОЗА ОБСЯГОМ — НЕ РОБИТИ

- НЕ міняти компактний паспорт (`buildCompactTriagePassport`, `resolveBoundaryText`).
- НЕ повертати повнотекстовий паспорт.
- НЕ Vision-Triage, НЕ batching Triage, НЕ зміна моделей.
- НЕ нова стадія диригента, НЕ зміна порядку.
- НЕ bump schemaVersion / міграція / бекап.
- НЕ вибіркова per-document очистка (D3, відкладено).
- НЕ змерджувати ФД-1.1 (адаптивна щільність) — окрема дискусія після цього TASK.
- НЕ змінювати UI DP-модалки (окрім видимої помилки для image_merge у фазі A).

---

## 11. HANDOFF — старт нової сесії

**Прочитати в порядку:**
1. `CLAUDE.md` — архітектура, тверді правила.
2. `DEVELOPMENT_PHILOSOPHY.md` — без цього файлу TASK не починати.
3. `docs/tasks/TASK_smart_triage.md` — батьківський, §2 (8 обмежень) критично.
4. `docs/tasks/TASK_smart_triage_passport_scale_and_text.md` — попередній фаз TASK (компактний паспорт), для контексту що НЕ чіпати.
5. ЦЕЙ файл — спека.

**Карта коду (де баги):**
- B1: `src/contexts/DocumentPipelineContext.jsx:219-227` + `src/services/ocrService.js:139-206` (STRIPPED_LAYOUT_FIELDS, writeLayoutArtifact)
- B2: `src/services/documentPipeline/stages/splitDocumentsV3.js:~270-310` (createDocument meta), `src/services/documentFactory.js:56,190` (documentNature, detectNature), `src/components/DocumentViewer/` (toggle gate)
- B3: image_merge шлях — `src/contexts/DocumentPipelineContext.jsx:~205` (`mergeImagesToPdf` ін'єктор), `src/services/sortation/imageMergeRenderer.js`
- P1: `src/services/documentPipeline/stages/splitDocumentsV3.js:207, 320, 421`
- P2: `src/App.jsx:4314-4382` (useEffect registry save)
- P3: driveService у `src/App.jsx` (~2900+), функції upload/read
- P4: `src/services/documentPipeline/streamingExecutor.js:110, 139` (jobStore.saveState)

**Git (правило №1 CLAUDE.md):** web/remote → harness видасть `claude/*` гілку. Коміти на гілці. **Зміни КОДУ у main** — тільки FF, тільки при зелених тестах, тільки після короткого підтвердження адвоката ПЕРЕД push (push у main тригерить CI + деплой Pages). Звіт фази C (.md) — FF у main без підтвердження.

**На виході:** реалізовані фази A+B з тестами + звіт фази C + оновлений `ARCHITECTURE_HISTORY.md` і `tracking_debt.md` (якщо побічні баги).

---

**Кінець TASK_dp_layout_leak_and_speed_fixes.md.** Реалізація — окрема нова сесія за цим файлом.
