# Звіт — Smart Triage: degenerate plan → нейтральна зупинка з видимим маркером

**Дата:** 25.05.2026
**Спека:** `docs/tasks/TASK_smart_triage_degenerate_plan_neutral_stop.md`
**Гілка:** `claude/smart-triage-degenerate-plan-Xxg1n`
**Виконавець:** Claude Code (web, opus 4.7)

---

## 1. Що зроблено

### Інфраструктурний внесок — нова disposition `halt` у диригенті

`src/services/documentPipeline.js`:
- **`documentPipeline.js:46-60`** — розширений коментар-інваріант. Додана 5-та категорія `halt:true, decisions:[…]` — «свідомий стоп: стадія завершила свою роботу і вважає продовження нерелевантним». Окремо від `fatal` за правилом #11: `fatal` = дані неповні (артефакти зберігаються, у Помилках); `halt` = дані штатні, стадія сама обрала зупинку (у Питаннях).
- **`documentPipeline.js:371-385`** — `classifyDisposition` отримала **+1 рядок** ПЕРЕД перевіркою `result.ok`: `if (result.halt === true) return 'halt'`. Експортована (раніше була внутрішня) — для unit-тестів. Поведінка трьох наявних диспозицій (`continue`/`fatal`/`skip`) — не змінена.
- **`documentPipeline.js:493-503`** — у циклі `run` додана нова гілка обробки `halt` МІЖ merge decisions і обробкою `ok:false`: ставить `ctx.stoppedAt = name`, break — БЕЗ запису у `ctx.errors`. Інші стадії продовжують повертати `ok:true` / `ok:false+error` як раніше — додатковий шлях, не заміна.

Бонус, як зазначено у спеці: `halt` готовий для майбутніх TASK C/D (юзер відмінив на `confirmBoundaries`, дублікат на dedup-стадії, чорновики тощо).

### Triage halt-канал

`src/services/documentPipeline/stages/triageStage.js`:
- **`triageStage.js:124-167`** — нова експортована чиста функція `isDegeneratePlan(plan, liveFiles)` з двома обов'язковими фільтрами зі спеки §3.2 (після уточнення):
  - `DEGENERATE_MIN_PAGES = 70` — той самий поріг, що `RICH_PASSPORT_MAX_PAGES_DEFAULT` у `pageMarkers.js` (правило #11 — одна цифра, один сенс «межа якості Haiku вікна»).
  - `DEGENERATE_ELIGIBLE_ROUTES = {'add_as_is', 'slice'}` — тільки маршрути, де AI мав знайти/підтвердити межі. `image_merge` / `fragment_reconstruct` / `signature_sidecar` / `to_fragments` / `discard` — дизайн route, не degenerate.
- **`triageStage.js:248-269`** — у `triageStage` ПЕРЕД успішним return додано перевірку `isDegeneratePlan(plan, live)` → повертає `{halt: true, decisions: [{type: 'triage_whole_volume', scope: 'triage', message, meta: {liveFileCount, totalPages}}]}`.
- НЕ чіпнуто: catch на `triageStage.js:240-247` (тиха-відмова на API-помилці лишається — інший сценарій), `trivialImagePlan` (детермінована сітка перед AI), `normalizePlan` (форма raw-відповіді — окрема відповідальність).

### Поріг rich-паспорта 100 → 70 + override-хук

`src/services/documentPipeline/pageMarkers.js`:
- **`pageMarkers.js:368-385`** — стара константа `RICH_PASSPORT_MAX_PAGES = 100` **видалена** (а не лишена поряд — правило #11). Замість неї:
  - `RICH_PASSPORT_MAX_PAGES_DEFAULT = 70` — обґрунтування у коментарі.
  - module-scoped `_richMaxPagesOverride = null`.
  - `_setRichPassportMaxPages(n)` — експортована, префікс `_` як контракт-конвенція «не для production-коду, тільки тести / майбутня tenant-калібровка».
  - `richMaxPages()` резолвер — підставляється в `passportOptsForBudget`.
- Grep підтвердив: жодного зовнішнього споживача `RICH_PASSPORT_MAX_PAGES` — лише старі імена в тест-коментарях, оновлено.

### UI — нейтральне «Питання» в DPv2

`src/components/DocumentProcessorV2/index.jsx`:
- **`DocumentProcessorV2/index.jsx:255-259`** — додано `'triage_whole_volume'` до `ATTENTION_TYPES`. Жодних `NEUTRAL_ERROR_CODES`, жодного розщеплення `errors[]`, жодного нового CSS-класу. `attentionDecisions.filter` уже рендерить через `dpv2-attention-card` без `--error` — це рівно те, що треба.

### Тести (нові)

- `tests/unit/triageStage.test.js` — **+13 тестів** у блоках:
  - `isDegeneratePlan — критерій + фільтри обсягу і route` (12 тестів): сітка покриває обидва фільтри (80/3/69/100 стор., add_as_is/slice/image_merge/fragment_reconstruct/discard/2-doc/2-file/0-doc).
  - `_setRichPassportMaxPages — round-trip` (1 тест): override впливає на резолвер через `resolveBoundaryText`.
- `tests/unit/triageStage.test.js` — **+1 reminder** «Симетрія порогів» — поведінкова перевірка через 70/69 граничні, що цифра `DEGENERATE_MIN_PAGES` = `RICH_PASSPORT_MAX_PAGES_DEFAULT`. Розійдеться одна — реактивно червоніє.
- `tests/unit/documentPipelineDisposition.test.js` (**новий файл**, 8 тестів): нова disposition `halt` (3 case-и: standalone, з ok:false, з ok:true) + regression на три наявні (`continue`/`fatal`/`skip`/`ok:false без полів` → fatal/`null|undefined` → fatal).
- `tests/integration/triage_degenerate_plan.test.js` (**новий файл**, 4 тести): прогін через справжній `createDocumentPipeline` + стаб triage. degenerate raw → halt, errors порожні, persist spy НЕ викликався, decision `triage_whole_volume` з правильними scope/message/meta. Regression: нормальний 2-doc план, triage throw catch-passthrough, малий PDF (3 стор. < 70) → НЕ degenerate.
- `tests/integration/dp4-ui-triage-whole-volume.test.jsx` (**новий файл**, 1 тест): рендерить DPv2 з результатом `{stoppedAt:'detectBoundaries', errors:[], decisions:[{type:'triage_whole_volume',...}]}` → перевіряє, що повідомлення є в «Питання», і блок «Помилки» каже «Помилок немає».

### Тести (оновлені — у прямій зоні зміни порогу)

- `tests/unit/pageMarkers.test.js:343/358/385` — три коментарі і числа порогу переходу оновлено з `100`/`101` на `70`/`71` (тест поведінки rich-vs-default profile). Логіка тестів не змінена, тільки межова цифра.

---

## 2. Як перевірено

**Прогони `npm test` між кроками:**

| Етап | Test files | Tests | Стан |
|------|-----------|-------|------|
| Baseline (до змін) | 113 | 1505 | ✅ |
| Після §3.1 (halt у диригенті) | 113 | 1505 | ✅ |
| Після §3.2 (перша версія без фільтрів) | 108 | 1494 | ❌ 11 failed (legitimate happy-path: add_as_is/image_merge/fragment_reconstruct/dedup-single) |
| **Зупинка → AskUserQuestion → spec оновлено** | — | — | (див. §7) |
| Після §3.2 (з фільтрами route + обсяг) | 113 | 1505 | ✅ |
| Після §3.3 (поріг 100→70) | 112 | 1504 | ❌ 1 failed (`tests/unit/pageMarkers.test.js` `поріг переходу: 100 → rich, 101 → дефолти` — у прямій зоні зміни) |
| Після оновлення pageMarkers test (100/101 → 70/71) | 113 | 1505 | ✅ |
| Після §3.4 (ATTENTION_TYPES) | 113 | 1505 | ✅ |
| Після §3.5 (grep + експорт classifyDisposition) | 113 | 1505 | ✅ |
| **+ нові тести** (триаж/disposition/integration/UI) | 116 | 1531 | ✅ |
| **Фінальний прогон** | 116 | 1531 | ✅ |

Regression на три наявні disposition (continue/fatal/skip) — окремий блок у `documentPipelineDisposition.test.js`. Усі зелені.

`npm run build` — успіх (21.07s; warning про chunk size — наявне, без регресу).

---

## 3. Поведінка до/після

### Сценарій A — degenerate plan на 200-стор. томі (з виходом halt)

**До:**
```js
pipeline.run({...}) → {
  ok: true,                              // ← "формальний успіх"
  documents: [{id:'doc_xyz', pageCount: 200, /* нерізаний том */}],
  errors: [],
  decisions: [{type:'document_boundaries', documentCount: 1, /* "1 файл → 1 документ" */}],
  stoppedAt: null,
}
```
Адвокат бачив зелений «успіх», у досьє лежав один нерозбитий PDF на 200 сторінок. Жодного попередження.

**Після:**
```js
pipeline.run({...}) → {
  ok: false,
  documents: [],                         // ← PERSIST не виконався
  errors: [],                            // ← halt не пише сюди
  decisions: [{
    type: 'triage_whole_volume',
    scope: 'triage',
    message: 'Не вдалось визначити межі документів — том пропонується як один шматок. Потрібна ручна нарізка або повторний прогін меншими частинами.',
    meta: { liveFileCount: 1, totalPages: 200 },
  }],
  stoppedAt: 'detectBoundaries',
}
```
У Зоні 3 DPv2 → вкладка «Потребує уваги» → блок «Питання» з нейтральним повідомленням; блок «Помилки» каже «Помилок немає». Без червоних кольорів, без слів «помилка»/«збій».

### Сценарій B — малий PDF (3 стор.) що справді є одним документом

Поведінка незмінна: `isDegeneratePlan` повертає `false` через фільтр `DEGENERATE_MIN_PAGES=70` → halt не спрацьовує → PERSIST штатно матеріалізує документ.

### Сценарій C — `image_merge` / `fragment_reconstruct`

Поведінка незмінна: фільтр `DEGENERATE_ELIGIBLE_ROUTES={'add_as_is','slice'}` пропускає ці маршрути — це їх дизайн, не provід AI.

---

## 4. Знайдені побічні баги

Жодних побічних багів, що вимагали б `bugs_found_during_smart_triage_neutral_stop.md`. Перші 11 падінь після §3.2 — це **сигнал точного спрацювання §8 «не патчити поверхово»**, а не побічний баг: критерій спеки виявився необхідним, але недостатнім, спека уточнена в окремому коміті `b6c3bce` (адвокатом).

`tracking_debt.md` нових рядків не отримує.

---

## 5. Оновлення `ARCHITECTURE_HISTORY.md`

Доданий новий розділ **«Smart Triage degenerate plan → halt-канал (2026-05-25)»** з:
- Зв'язком з батьківськими TASK Smart Triage / passport_scale_and_text.
- Описом нової `halt` disposition як **первинного контракту диригента** (готового для TASK C/D).
- Описом `isDegeneratePlan` з двома фільтрами і обґрунтуванням (необхідна, але не достатня умова — фільтр route + фільтр обсягу).
- Описом зниження порогу rich-паспорта (100→70) і `_setRichPassportMaxPages` як internal-only override.

---

## 6. Відкриті питання / спостереження

- **Поріг 70 — стартова точка.** Якщо валідація адвокатом на 70-100 стор. покаже що degenerate-detection ловить помилково на 80-стор. томі з легітимним single-doc add_as_is — поріг піднімаємо. Зворотній бік: якщо degenerate-detection пропускає degenerate на 70-стор. томі — потрібен окремий сигнал якості, не зниження порога (правило #11).
- **`isDegeneratePlan` не дивиться на семантику.** Якщо AI поверне формально-валідний 2-doc план де два документи логічно тотожні (один великий + один маленький усередині нього) — не зловить. Це інша гілка fix'у (semantic dedup на post-normalize), у спеці явно поза скоупом. Лишається у `tracking_debt.md` як подальша еволюція Triage якщо виявиться у логах.
- **`pageCount` у `ctx.files` (DP-1 makeContext).** Зараз `pageCount` не нормалізується у `makeContext` — Provider додає його через streamingExecutor після OCR-chunk'ів. У integration-тесті довелось загорнути triageStage у тонкий адаптер. Потенційний refactor: додати `pageCount` до контракту `makeContext` (signal: чи цей файл — багатосторінковий артефакт). Не зачіпає production (Provider це робить через інший шлях), фіксуємо як майбутнє покращення.

---

## 7. Регресійна дисципліна (звіт по §8)

### Baseline
`npm test` ДО першої зміни — **113 test files / 1505 tests passed**.

### Прогони між кроками
Див. таблицю в §2. Кожен з 5 кроків (3.1–3.5) супроводжувався окремим `npm test`. Жоден червоний тест не глушився, не апдейтився snapshot, не додавався skip.

### Точка зупинки (§8 спрацював)
Після §3.2 (перша версія `isDegeneratePlan` без фільтрів) — **11 failed**:
- `tests/integration/dp-triage.test.js` (3) — route add_as_is/image_merge/fragment_reconstruct з single-doc-100% покриттям.
- `tests/integration/dp-persist-routes.test.js` (3) — ті ж сценарії на PERSIST-етапі.
- `tests/integration/dp-document-nature.test.js` (2) — documentNature на single-doc планах.
- `tests/integration/dp-layout-persist.test.js` (2) — layout writing для single-doc.
- `tests/unit/triageStage.test.js` (1) — «анти-тиха-втрата: реальний документ перемагає to_fragments на перекритті» (після dedup лишається 1 doc що покриває 100%).

Усі — у прямій зоні змін, але **експонують сигнал** що критерій «1 doc × 100%» — недостатній. Зупинився, `AskUserQuestion` адвокату. Адвокат:
1. Оновив спеку §3.2 у коміті `b6c3bce` (фільтри обсягу + route).
2. Я fast-forward'нув гілку до оновленої спеки.
3. Перевиконав §3.2 — `isDegeneratePlan` з двома фільтрами → 0 падінь.

Це і є коректна реакція на §8: не патчити поверхово, не глушити, не апдейтити snapshot — а **підняти проблему до автора спеки**.

### `npm run build`
Успіх, 21.07s. Жодного нового warning (єдиний chunk-size warning — наявне до TASK).

### Manual smoke (з §8)
**Чесна заява:** remote execution environment (Claude Code на вебі / в cloud sandbox) **не має доступу до браузера** (`google-chrome`/`chromium`/`firefox` — відсутні в `/usr/bin/`). Manual smoke у вигляді відкриття DPv2 і drag-n-drop малого PDF / перевірки в'юера сканів **виконати неможливо**. Це обмеження середовища, не пропуск дисципліни.

**Surrogate-перевірка (через тести):**
- `tests/integration/dp4-ui-triage-whole-volume.test.jsx` — рендерить справжній `DocumentProcessorV2` через `@testing-library/react` jsdom з результатом halt, перевіряє що повідомлення з'являється у «Питання» і «Помилки» порожні. Зелений.
- `tests/unit/DocumentProcessorV2.test.jsx` (5 тестів, незмінних) — зони 1-3 рендеряться, header правильний, перемикачі присутні. Зелений.
- `tests/integration/dp4-ui.test.jsx` (1 тест, незмінний) — happy-path UI flow з вибором файлу і запуском. Зелений.
- В'юер сканів/тексту (`DocumentViewer*.test.jsx`, ~25 тестів) — НЕ модифікувались, лишились зеленими (підтверджує: TASK не зачепив непрямо).

**Адвокату при ручному прогоні на планшеті** — рекомендую перевірити три сценарії:
1. Малий PDF (1-3 стор.) → drag-n-drop у DPv2 → має пройти штатно як до TASK.
2. Великий том (200+ стор.) де AI може повернути degenerate → у вкладці «Потребує уваги» має з'явитись блок «Питання» з нейтральним повідомленням, блок «Помилки» — «Помилок немає».
3. Відкрити в'юер у Матеріалах справи на наявному документі — текст/скани мають показуватись без лагів, як до TASK.

### Список перевірених місць (grep на disposition enum)
```bash
grep -rn "classifyDisposition\|disposition ===" src/ tests/
```
Результат: **6 збігів, усі в `src/services/documentPipeline.js`** — внутрішня кухня диригента. Жодного зовнішнього споживача.

```bash
grep -rn "'continue'\|'fatal'\|'skip'\|'halt'" src/ tests/
```
Результат: **11 збігів, усі в `src/services/documentPipeline.js`** + 1 в `tests/unit/documentBoundary.test.js:44` (`name: 'skip'` — ім'я документа в плані, не disposition; не торкається enum).

Висновок: жодне зовнішнє місце не робить exhaustive-match на disposition strings → нова `'halt'` ні в кого не ламає логіку `switch`/`if-else`. Якщо в майбутньому з'явиться сторонній споживач — він зобов'язаний додати гілку `halt` (документ-інваріант у `documentPipeline.js:46-60`).

### Інваріант перевірений
`addDocuments`/PERSIST не виконується на halt — окремо перевірено spy'єм у `tests/integration/triage_degenerate_plan.test.js`: `expect(persistSpy).not.toHaveBeenCalled()` після halt-у. Plus regression: на нормальному 2-doc плані / triage throw / малому PDF — `persistSpy` викликається.

### Зони ризику (з §8) — статус
1. ✅ **Диригент `documentPipeline.js`** — disposition `halt` додано, всі 3 наявні disposition не зачеплені (regression-тести зелені).
2. ✅ **`triageStage.js`** — `normalizePlan` НЕ чіпнуто, `isDegeneratePlan` — окрема чиста функція ПІСЛЯ normalize. 11 існуючих тестів triageStage (включно з G3 dedup) — зелені.
3. ✅ **`pageMarkers.js`** — `buildCompactTriagePassport`/`buildStructuralPassport`/`buildPagedText`/`isPagedLayout` НЕ чіпнуто. Зміна — лише в `passportOptsForBudget` через `richMaxPages()`. Усі 35 тестів `pageMarkers.test.js` — зелені (3 тести з оновленими цифрами 100/101→70/71).
4. ✅ **`DocumentProcessorV2/index.jsx`** — `ATTENTION_TYPES` — єдине місце споживача (фільтр + лічильник через `attentionCount = errors.length + attentionDecisions.length`). Розсинхрону немає (один масив, два використання).

### Матеріали справи / в'юер сканів-тексту
Не модифікувались. Тести `tests/unit/DocumentViewer*.test.jsx` (~25 тестів) — зелені до і після. Жодного непрямого впливу.

---

## Підсумок

TASK закритий повним обсягом §3.1–§3.5 + §4.1–§4.4 з регресійною дисципліною §8.
- **+1 нова disposition `halt`** у диригенті як інфраструктурний внесок (TASK C/D).
- **+1 нова чиста функція `isDegeneratePlan`** з двома фільтрами (правило #11 — обсяг + route).
- **+1 нова decision-type `triage_whole_volume`** у Зоні 3 «Питання» через наявний `ATTENTION_TYPES`.
- **+1 export `_setRichPassportMaxPages`** як internal-only override для тестів/калібровки.
- **Поріг rich-паспорта 100 → 70**, синхронізований з `DEGENERATE_MIN_PAGES` через тест-нагадувач.
- **+25 нових тестів** (12 unit isDegeneratePlan + 1 unit override + 1 unit симетрії + 8 unit classifyDisposition + 4 integration triage + 1 integration UI).
- **0 нових ACTIONS / PERMISSIONS / schemaVersion змін.**
- **0 змін у `ai_usage`, `time_entries`, `auditLog`** (halt — інфраструктура, не дія).

Адвокат отримує чесне «потрібна ручна нарізка» замість мовчазного нерізаного 200-стор. PDF. Дешеві артефакти стейджів (plan.json, passport) лишаються для діагностики. Жодного нового UI-екрана, жодного UI-перемикача.
