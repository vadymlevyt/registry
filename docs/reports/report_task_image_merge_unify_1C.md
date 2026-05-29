# Звіт — TASK 1C: image_merge_unify, deterministicRoute + Toggle + warning-fix

**Дата:** 2026-05-29
**Гілка:** `claude/image-merge-unify-1C`
**Базова специфікація:** `docs/tasks/TASK_image_merge_unify.md` ПІД-TASK 1C
**Тип:** маршрутизація + UI-тумблер + warning logic у 02_ОБРОБЛЕНІ (Вісь A + Вісь B)
**schemaVersion:** без bump (немає зміни структури registry_data.json)
**Попередня сесія:** TASK 1A (винос reusable у спільне) — `report_task_image_merge_unify_1A.md`

---

## 1. Що зроблено по кожній з 3 частин

### 1C.1 — deterministicRoute «всі файли — фото → image_merge без AI Triage»

**Файли:**
- `src/services/documentPipeline/stages/triageStage.js`
  - нова функція `allImagesRoute(live)` (поряд із наявною `trivialImagePlan`)
  - виклик у `createTriageStage()` як друга детермінована гілка (після
    `skipPdfSlicing` override, перед `trivialImagePlan` і AI Triage)

**Логіка:** якщо всі живі файли — `image/*` і їх ≥2 → детермінований план
`{ documents:[{ route:'image_merge', fragments: [{fileId, startPage:1, endPage:pageCount||1}, …] }] }`,
повертається БЕЗ виклику AI Triage. Для 1 image спрацьовує існуючий
`trivialImagePlan` (legacy single-image passthrough — поведінка без змін).

**📌 ВАЖЛИВО (для наступної сесії 1B):** для N≥2 фото зараз створюється
**ОДИН image_merge документ** з N фрагментами. Це проміжний стан до 1B —
у 1B grouper розгорне цей один документ у **N окремих документів**
(або стільки документів, скільки виявить Haiku-grouper). Поточна 1C
поведінка «N фото → 1 PDF до 1B» — не регрес, а узгоджена з §4.1 візії
послідовність: маршрутизація детермінується зараз, групування додасться у 1B.

**Decision message:** «Усі N файлів — фото → image_merge без AI Triage
(детермінована сітка).»

### 1C.2 — Toggle «Просто додати файли» (`skipPdfSlicing`) — per-file routing

**Файли:**
- `src/components/DocumentProcessorV2/index.jsx`
  - `DEFAULT_SETTINGS`: новий ключ `skipPdfSlicing: false` з one-line
    коментарем сенсу (правило #11) ПРЯМО на місці оголошення.
  - Zone 2 UI: новий `<Toggle>` у групі «ОРГАНІЗАЦІЯ» з лейблом «Просто
    додати файли» та description «кожен PDF — окремий документ, без
    AI-нарізки».
- `src/contexts/DocumentPipelineContext.jsx`
  - `buildPipelineDeps`: прокинуто `skipPdfSlicing: opt.skipPdfSlicing === true`
    у `createTriageStage`.
- `src/services/documentPipeline/stages/triageStage.js`
  - функція `skipPdfSlicingPlan(live)` — **per-file** маршрутизація:
    кожен живий файл стає окремим документом; `image/*` → route
    `image_merge` solo, решта → `add_as_is` solo. AI Triage не
    викликається взагалі.
  - У `createTriageStage` гілка `skipPdfSlicing` — **найвищий
    пріоритет** (override `allImagesRoute` і `trivialImagePlan`),
    бо адвокат явно сказав «не різати/не груповати».

**Сенс (документований у коментарі на місці):**
> `skipPdfSlicing` — пропустити AI-нарізку (Triage) і per-file
> маршрутизувати кожен живий файл: фото → image_merge solo, інше →
> add_as_is solo. Працює і у міксі PDF+фото (інакше AI Triage поріже PDF
> попри toggle). НЕ вимикає OCR, метадані, класифікацію.

**Decision message:** «Просто додати файли: N файл(ів) → N окремих
документів, AI-нарізку пропущено.»

**Чому per-file, а не per-batch:** початкова реалізація вимикала toggle
у міксі (image+PDF) і повертала null → набір йшов у AI Triage, PDF
ріжуться попри тумблер. Це ровно ТЕ, що toggle мусить вимкнути. Тому
маршрутизація стала per-file: один план, різні маршрути всередині. Сенс
toggle — «не різати/не групувати; додай як є», незалежно від змісту
батча (правило #11: один прапор → одне рішення).

### 1C.3 — warning text_slice_fallback тільки для реального slicing

**Файли:**
- `src/services/documentPipeline/stages/splitDocumentsV3.js`
  - нова детермінована перевірка `isWholeFileAddAsIs(planDoc, live)` —
    повертає `true` коли `route==='add_as_is'`, 1 фрагмент, діапазон
    покриває всі сторінки джерела.
  - `writeProcessedArtifacts`: warning `text_slice_fallback` ПОДАВЛЕНО
    для whole-file add_as_is (це text-layer/DOCX-конвертований PDF без
    per-page layout — нормально, не slice fail).
  - Реальний slicing (multi-fragment або частковий діапазон) з
    fallback-текстом — warning **лишається** (захист від bug 2 не
    повертається).

**📌 ВАЖЛИВО:** **`.txt` для text-layer PDF МИ НЕ ПИШЕМО.** Text-layer
PDF самодостатній — текст вже в самому файлі. `.txt` у 02_ОБРОБЛЕНІ
потрібен ТІЛЬКИ для сканів (де реального тексту в PDF немає, OCR його
витягнув). Це навмисне рішення (рев'ю адвоката 2026-05-29). 1C.3
обмежено фіксом warning-логіки; жодних додаткових `.txt`-гілок у path
B (fallback persist) не додано.

---

## 2. Рішення в межах експертної автономії

### 2.1 `allImagesRoute` vs розширення `trivialImagePlan`

Спека дала вибір: розширити `trivialImagePlan` на N файлів АБО додати
окрему функцію `allImagesRoute`. **Обрано окрему функцію** (як рекомендує
спека з посиланням на правило #11):

- `trivialImagePlan` — 1 image → 1 документ image_merge. Семантика
  «тривіальний single-image passthrough» (історична).
- `allImagesRoute` — N images (N≥2) → 1 image_merge документ з N
  фрагментами. Семантика «батч фото для майбутнього N-doc grouping у DP
  (1B)».

Два різні наміри. Якби розширили `trivialImagePlan`, його сенс розповзся б
на «1 фото = passthrough» + «N фото = склейка/grouping». Окрема функція
зберігає однозначність.

**`trivialImagePlan` лишається активним** для випадку 1 image (його
викликає `createTriageStage` після `allImagesRoute` як fallback). Коли
1B розгорнеться, обидві функції можна свідомо злити з документуванням
(або лишити дві — на смак реалізатора 1B).

### 2.2 Порядок гейтів — `skipPdfSlicing` має пріоритет над `allImagesRoute`

Порядок у `createTriageStage`:

1. **`skipPdfSlicing` toggle ON** (per-file) — найвищий пріоритет.
   Адвокат явно сказав «не різати/не групувати» → AI Triage пропускається,
   кожен файл = окремий документ зі своїм route (image_merge solo для
   image/*, add_as_is solo для решти).
2. **`allImagesRoute`** (toggle OFF, N≥2 images) — 1 image_merge документ
   для майбутнього 1B grouper'а.
3. **`trivialImagePlan`** (toggle OFF, 1 image) — legacy single-image.
4. **AI Triage** — мікс / pure-PDF з toggle OFF.

Toggle ON має пріоритет над `allImagesRoute` спеціально: при ON
адвокат не хоче об'єднання фото в один документ — хоче «кожне як є».
Це збігається з UI-лейблом «Просто додати файли».

### 2.3 1C.3 — `.txt` для text-layer PDF: НЕ пишемо

Початкова реалізація 1C.3 додавала виклик `writeProcessedArtifacts` у
path B (fallback persist) щоб писати `.txt` для text-layer PDF. На
рев'ю адвоката 2026-05-29 ця гілка ВІДКОЧЕНА:

> Текстовий шар у text-PDF самодостатній; `.txt` в 02_ОБРОБЛЕНІ
> потрібен ТІЛЬКИ для сканів (де тексту нема). warning-фікс на
> add_as_is — лишай, він корисний.

Тому 1C.3 фінально обмежено **тільки** виправленням
`text_slice_fallback` warning — щоб він не спрацьовував для whole-file
add_as_is (false-positive). Path B не зачеплено.

### 2.4 Тести-регресії 3 існуючих integration-тести

Зміна 1C.1 (allImagesRoute інтерсептить AI Triage для all-image наборів)
зачепила 3 existing-тести які стабували AI Triage для image-входів:

1. `tests/integration/dp-persist-routes.test.js` — тест
   `image_merge → mergeImagesToPdf seam` стабував AI Triage щоб назвати
   документ `Договір`. Тепер AI Triage пропускається → name=null →
   generic `d1.pdf`. **Оновив assertion** на `d1.pdf`. mergeSpy
   викликається з тими ж images у тому ж порядку — суть тесту збережена.

2. `tests/integration/dp-image-merge-failure.test.js` обидва тести —
   перевіряють що один кривий image_merge документ не вбиває pipeline.
   Для всіх-images вхід allImagesRoute дає 1 документ — регресія
   «один кривий не вбиває pipeline» не активна на цій конфігурації.
   **Додав технічний файл** `mix-signal.pdf` (`application/pdf`) у вхід
   обох тестів + у `stubTriageFetch` план doc з route='discard' для нього.
   Це defeats `allImagesRoute` (бо вже не «всі files — image»),
   `stubTriageFetch` план з 3 image_merge документами активний як раніше.
   Регресія перевіряється точно так як до 1C. Зміни описані коментарями
   на місці.

---

## 3. Як перевірити що Triage пропускається для фото (1C.1)

**Unit-тест:**
```js
const triage = vi.fn();
const stage = createTriageStage({ triage });
await stage(ctxOf([
  { fileId: 'p1', originalMime: 'image/jpeg', pageCount: 1 },
  { fileId: 'p2', originalMime: 'image/png', pageCount: 1 },
]));
expect(triage).not.toHaveBeenCalled();              // ← AI Triage пропущено
```
(`tests/unit/triageStage.test.js` — describe `1C.1 allImagesRoute`)

**Реальна перевірка адвокатом (після merge + deploy):**
1. Справа → «Робота з документами» (DP).
2. Закинути 3-5 фото з телефону (JPEG/HEIC/PNG, по 1 сторінці).
3. Запустити обробку (autoConfirm:true як зараз).
4. У `result.decisions` буде `deterministic:true` з повідомленням
   «Усі N файлів — фото → image_merge без AI Triage». Швидко (без
   токенів на Triage).
5. Виконання дає **1 image_merge документ з N фото** (детерміновано до
   1B). У 1B grouper розгорне його на N документів (один документ
   на фактичну сутність — паспорт, договір і т.д.).

## Як працює `skipPdfSlicing` per-file (1C.2)

**Unit-тести:**

1. **Чистий PDF набір ON** → per-file add_as_is, AI Triage пропущено:
   ```js
   stage = createTriageStage({ triage, skipPdfSlicing: true });
   // input: 2 PDF
   // result: 2 docs, both route='add_as_is'
   ```

2. **Мікс PDF+фото ON** → per-file (фото→image_merge, PDF→add_as_is),
   AI Triage пропущено (КЛЮЧОВИЙ кейс правки):
   ```js
   // input: photo.jpg, doc.pdf, photo2.heic
   // result: 3 docs, routes = ['image_merge', 'add_as_is', 'image_merge']
   ```

3. **Усі image ON** → per-file image_merge (НЕ 1 документ — кожне фото
   окремий док, на відміну від OFF, де allImagesRoute об'єднує).

4. **OFF (default)** → AI Triage як раніше, allImagesRoute для all-image.

**Реальна перевірка адвокатом:**
1. Справа → «Робота з документами».
2. Зона 2 → ОРГАНІЗАЦІЯ → увімкнути «Просто додати файли».
3. Закинути мікс: 3 PDF (текстові або скани) + 2 фото з телефону.
4. Запустити. AI Triage не викликається. У справі з'явилось **5
   окремих документів**: 3 з PDF (як є, без нарізки) і 2 з фото (як
   є, без склейки/групування).
5. Вимкнути toggle → той самий вхід піде через AI Triage (PDF може
   поріжуться, фото підуть allImagesRoute → 1 документ для 1B grouper).

**Сенс toggle:** «не різати де не треба, не групувати, не палити
токени». Спрацьовує і у міксі.

## Як перевірити warning text_slice_fallback (1C.3)

**Unit-тести у `splitDocumentsV3` describe `1C.3`:**
- `plan add_as_is whole-file, text-layer (без layoutJson) → БЕЗ warning
  text_slice_fallback` (false-positive подавлено)
- `OCR (layoutJson.pages непорожній) → пишеться і .txt, і .layout.json`
  (regression: OCR-флоу не зачеплено)
- `реальний slicing (частковий діапазон) з fallback-текстом → warning
  ВСЕ Ж публікується` (захист від bug 2)

**Реальна перевірка адвокатом:** закинути text-layer PDF. У decisions
не повинно бути `text_slice_fallback` warning (раніше він був
false-positive). Для скана warning лишається коли layout неповний.

---

## 4. Стан тестів і build

### Тести
- **Baseline (до 1C):** 118 файлів / **1581 passed**.
- **Після 1C (фінал):** 118 файлів / **1593 passed** — +12 нових:
  - `tests/unit/triageStage.test.js`: +9 (1C.1 — 4 тести, 1C.2 — 5 тестів)
  - `tests/unit/splitDocumentsV3.test.js`: +3 (1C.3 — 2 тести +
    1 OCR-regression)
- **Дельта:** +12 passing, 0 failing.
- **Оновлені existing-тести (без зміни числа):** 3 (зведено вище у §2.4).
- Команда: `npm test` (Vitest 4.x).

### Build
- `npm run build` — **success**, exit 0, ~17s. Без warnings/errors
  крім вже-відомого «chunk > 500 kB» (heavy lazy bundles — окремий
  бекап, не cumulative).
- Vite resolution для DocumentPipelineContext (новий wiring) і
  triageStage (нові гілки) перевірена прогоном test+build.

---

## 5. Побічні знахідки

Файл `docs/bugs/bugs_found_during_image_merge_unify.md` НЕ створено
протягом 1C — побічних багів не виявлено. Зміни локальні і вузькі.

**Tracking debt:** записи від 1A (#25, #26) лишаються чинними. Нових
записів у `tracking_debt.md` за 1C не додано — наявні діри від спеки
(grouper для 1B, CSS-prefix, classification consolidation) усе ще
актуальні і вже трекаються.

---

## 6. Зачеплені файли (точний список)

**Відредаговано (5):**
- `src/services/documentPipeline/stages/triageStage.js` — `allImagesRoute`,
  `skipPdfSlicingPlan` (per-file), нові гілки в `createTriageStage`
  з правильним пріоритетом.
- `src/services/documentPipeline/stages/splitDocumentsV3.js` —
  `isWholeFileAddAsIs`, suppression warning для whole-file add_as_is.
- `src/components/DocumentProcessorV2/index.jsx` — `DEFAULT_SETTINGS.skipPdfSlicing`
  + Toggle UI.
- `src/contexts/DocumentPipelineContext.jsx` — `skipPdfSlicing` опція
  прокинута у `createTriageStage`.
- `tests/integration/dp-persist-routes.test.js` — assertion `d1.pdf`
  замість `Договір.pdf` (1C.1 змінила джерело назви).
- `tests/integration/dp-image-merge-failure.test.js` — додано
  технічний `mix-signal.pdf` у вхід обох тестів, оновлено stub
  (route='discard' для нього), щоб defeat `allImagesRoute` і зберегти
  регресію.

**Створено в тестах (0 нових файлів):**
- Нові тести додані у наявні `tests/unit/triageStage.test.js` і
  `tests/unit/splitDocumentsV3.test.js`.

**Створено (1 — цей звіт):**
- `docs/reports/report_task_image_merge_unify_1C.md`.

---

## 7. Що далі — для наступної сесії

Спека `TASK_image_merge_unify.md` рекомендує порядок `1A → 1C → 1B`:
- ✅ 1A — винос reusable (попередня сесія).
- ✅ 1C — детермінований роутинг + per-file toggle + warning-fix.
- ⏭ **1B** — серце TASK: N-документна склейка фото в DP.
  Спирається на ImageEditor (1A) і `allImagesRoute` (1C). У 1B:
  - створити `src/services/sortation/imageDocumentGrouper.js` (Haiku,
    обов'язкове `logAiUsageViaSink` + `activityTracker.report('agent_call', …)`
    — закриває C7 для нового агента).
  - додати agentType `imageDocumentGrouper` у `modelResolver.SYSTEM_DEFAULTS`.
  - **Розгорнути 1-документний `allImagesRoute` план у N документів** —
    тут міститься суть «диригент-адвокат» для image-merge сценарію.
    Коли toggle OFF і всі files фото → grouper викликається на 1 image_merge
    документі з N фрагментами і повертає N документів. Toggle ON шлях
    (per-file solo) лишається detgermined — grouper не викликається.
  - У DP UI (Зона 3) — N візуальних груп через reuse ImageEditor,
    drag фото між групами, виконання через `add_documents` тільки
    після кнопки «Виконати».

Передача чистого репо в `main`:
- Гілка `claude/image-merge-unify-1C` пушиться на origin. FF-only merge
  у `main` — **після підтвердження адвоката** (це зміна коду, не лише
  докси). Тести і build зелені.

---

## 8. Acceptance 1C (всі ✅)

- [x] всі файли — фото → AI Triage НЕ викликається (unit-тест
      `1C.1 allImagesRoute` верифікує `expect(triage).not.toHaveBeenCalled()`)
- [x] `skipPdfSlicing` тумблер у Зоні 2, default `false`, one-line
      коментар сенсу прямо в `DEFAULT_SETTINGS`
- [x] ON → кожен живий файл = окремий документ (per-file routing); фото
      → image_merge solo, PDF → add_as_is solo; OCR/метадані лишаються
- [x] OFF → поведінка ідентична поточній (default false; AI Triage
      шлях не зачеплений)
- [x] text-layer PDF тепер не отримує false-positive warning
      `text_slice_fallback` (whole-file add_as_is). `.txt` для text-PDF
      МИ НЕ ПИШЕМО (свідоме рішення — text-PDF самодостатній).
- [x] нові тести: routing (all-images skip triage), skipPdfSlicing ON
      per-file (pure PDF / mix / all photos / OFF default), warning
      logic для whole-file vs partial slice — додано 12, всі зелені
- [x] `npm test` зелений (1593), `npm run build` success

---

## 9. Git commit

Один atomic коміт на гілці `claude/image-merge-unify-1C` з повним
скоупом 1C (1C.1 routing + 1C.2 per-file toggle + 1C.3 warning-fix +
тести + звіт). Деталі — `git log`.

**Кінець звіту TASK 1C.**
