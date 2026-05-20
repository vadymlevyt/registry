# Post-mortem — DP speed Phase B → REVERT

**Дата:** 2026-05-20
**Контекст:** `TASK_dp_layout_leak_and_speed_fixes.md` §4 (P1-P4 perf-оптимізації)
**Гілка реалізації:** `claude/optimize-dp-pipeline-phase-b-Sw2NH` (HEAD `7491b92`, збережена на origin)
**Revert-коміти у main:** `b6b8e62`/`2a70949`/`495ec56`/`de12853`/`88ddd09`

---

## 1. Що сталось

Phase B (4 perf-фікси P1-P4) було реалізовано окремою сесією, пройшло
**1423/1423 тестів** локально, запушено в main чистим FF
(`dd4569d..7491b92`), CI/Pages задеплоено. Все процедурно бездоганно.

На реальному прогоні адвоката на планшеті (`vadymlevyt.github.io/registry/`,
справа Брановського, 65 стор. → очікувано ~25 нарізаних документів):
- **Швидкість виросла** — 2-3 хв замість 5-6 (P1+P4 виграш, як і
  планувалось).
- **Якість впала катастрофічно** — уся справа лягла в реєстр одним
  документом 65 стор., перемикач Скан/Текст у в'юері зник
  (`documentNature=null` бо нарізка не виконалась).

Симптом ідентичний стану ДО Phase A фікса B2 (зниклий перемикач) і ДО
коректної нарізки — branch B passthrough замість branch A slice у
`splitDocumentsV3`.

## 2. Дії

Я відкотив усі 5 комітів Phase B через `git revert` (НЕ `--hard reset`):

```
git revert --no-edit 7491b92 eca8f9e fa3839e 5280fcd be5c944
git push origin HEAD:main
```

5 revert-комітів повернули main на функціональний стан `dd4569d`
(Phase A). Тести: **1392/1392** — точне число до Phase B. Файлова система
ідентична Phase A (`git diff dd4569d HEAD --stat` порожній).

Гілка Phase B збережена на origin недоторкана — для пост-mortem і
forward-fix без перебудови з нуля.

## 3. Адвокат підтвердив прогон Phase A після revert

- Брановський 65 стор. → **28 у плані, 26 у реєстрі**, 5 хв.
- 1 пропуск — decision дедупу через `findDuplicate`: «Сертифікат експерта
  Вербова В.В. (альбомна) — схожий на наявний, додано як новий варіант».
  Це функціонал борг #14 (metadata-евристика). Спрацював коректно —
  адвокат вирішує сам.
- 1 пропуск — ймовірно паспорт громадянина у image_merge_failed graceful
  skip (B3 фікс).
- **Якість вища за попередні прогони** на тому ж файлі: правильно
  різнить «Довідки про склад сім'ї — перша/друга», «Висновки експерта
  №66 (RENAULT) / №67 (JEEP)», category-теги влучні.

## 4. Гіпотеза кореня (поки не верифікована)

Найімовірніший винуватець — **P1** (єдиний з P1-P4, що суттєво змінив
логіку нарізки `splitDocumentsV3.js`). Дві окремі гіпотези:

### Гіпотеза A — dedup-race у двофазному PERSIST

P1 розбив plan-loop на CPU-prep серіально + Drive I/O паралельно. Дедуп
розширено: `findDuplicate(name, pageCount, size, [...registryView(), ...pendingInBatch])`.

Гіпотеза: дедуп помилково ловить нарізані документи як дублікати при
проходженні CPU-prep:
- Перший нарізаний документ → дабп у `pendingInBatch`
- Другий нарізаний документ з можливо схожим `pageCount` АБО якимось
  іншим matching-полем → `findDuplicate` повертає попередній → skip
- І так далі — усі скіпаються
- Branch A повертає `ok:true` з 0 документами

Можлива причина — нарізані документи з одного джерельного PDF справді
мають збіг по `size` (бо `precutSources` рахує `size` як байти зрізу, які
можуть бути близькі для документів з однаковою к-стю сторінок). У старому
коді `pendingInBatch` не існував, дедуп бачив тільки `registryView()` (вже
збережене на Drive), і race не виникав.

### Гіпотеза B — зміна error-contract

Старий код у branch A:
```js
// throw → catch → return ВІДРАЗУ з callback стадії:
return { ok: false, error: { code: 'UPLOAD_FAILED', file_skipped: true } };
```
Це повертало `ok:false` зі стадії → pipeline FAIL → видима помилка.

Новий код P1:
```js
// throw → catch → set stageError, return {error: e} в runWithConcurrency:
if (!stageError) stageError = e;
return { error: e };
// ... після Promise.all:
if (stageError) return { ok: false, error: stageError };
```

Якщо в якомусь edge-case `stageError` НЕ виставився (наприклад, всі таски
повернули `{skipped: true}` через dedup-race) — branch A повертає `ok:true`
з 0 documents, pipeline продовжується до branch B passthrough.

## 5. Чому 1423 тестів не зловили

Інституційне обмеження №1 батьківського `TASK_smart_triage.md` прямо
попереджає:

> «Корінь зламу DP-4: стадії були зелені ізольовано (власні stageDeps у
> тесті), а Provider реально НЕ ін'єктував `detectSingle` → ланцюг тихо
> падав у passthrough, жоден тест не ловив. Кожен новий маршрут МУСИТЬ
> мати інтеграційний тест, що ганяє справжній `DocumentPipelineProvider`
> через executor, не лише стадію в ізоляції.»

Phase B мав `tests/integration/dp-persist-concurrency.test.js` — Provider-
integration тест, але він перевіряв **тільки concurrency-ліміт** (пік
одночасних upload ≤5), а **не якісну поведінку результату**: «після
Provider-DP run з реалістичним 25-doc планом усі 25 документів справді
створені у `cases[]`, branch A повністю виконана, без fallback у branch B».
Цей **якісний** invariant — те, що Phase B v2 ОБОВ'ЯЗКОВО має тестувати.

## 6. Що далі (forward-fix план — поза цим post-mortem)

Phase B forward-fix — окрема сесія, тригер у `tracking_debt.md` #20.
Послідовність роботи:

1. **Діагностика** — запустити локально Phase B гілку, додати
   instrumentation у `findDuplicate` і `runWithConcurrency` taskFn,
   реалістичний 25-doc план, реалістичні mock Drive uploadFile. Звузити
   гіпотезу A vs B vs C (щось третє).
2. **Forward-fix** — точкова правка `splitDocumentsV3.js` (P1) і/або
   `concurrency.js`. Може бути малою: наприклад, дедуп працює лише на
   `findDuplicate(name+size)` де size з джерельного byteRange, не з
   нарізаного результату.
3. **Provider-integration тест якісної поведінки** — після DP run з
   25-doc планом: усі 25 documents створені, `cases[].documents.length`
   зросла на 25, жоден не в decisions з `file_skipped`. ОБОВ'ЯЗКОВО.
4. **P2-P4 окремо** — вони НЕ торкаються логіки нарізки і самі по собі
   ймовірно коректні. Можна повертати по одному з власними тестами.

## 7. Чесний урок

«Зелено в тестах» — не «працює». 1423/1423 — імпресивно на папері. На
планшеті адвоката — катастрофа. Це другий раз цього класу бага в проекті
(перший — DP-4, рік тому). Forward-fix Phase B повинен **закласти якісний
Provider-integration інваріант** у кожен новий маршрут — інакше повторне
наступання на ті ж граблі.

Інший урок: **скрізь де є dedup heuristic + новий стан-збирач** (тут
`pendingInBatch`), додавати unit-тест ЯКИЙ ОБОВ'ЯЗКОВО має знайти hit на
realistic-named документах з одного джерела. У Phase B такого тесту не
було — тільки concurrency-механіка.

## 8. Що в main зараз

- Функціональний стан `dd4569d` (Phase A — B1+B2+B3 фікси).
- 5 revert-комітів зверху для прозорості історії.
- Тести 1392/1392.
- Адвокат тестує і підтверджує робочий стан.

Phase B гілка `claude/optimize-dp-pipeline-phase-b-Sw2NH` (HEAD `7491b92`)
збережена на origin для майбутнього forward-fix.

---

**Кінець post-mortem.** Phase B forward-fix — окремою сесією за тригером
у `tracking_debt.md` #20.
