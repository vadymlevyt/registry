# Звіт — DP layout-leak + speed fixes (Phase B завершено)

**Дата:** 2026-05-20
**Спека:** `docs/tasks/TASK_dp_layout_leak_and_speed_fixes.md` §4 (P1-P4)
**Гілка реалізації:** `claude/optimize-dp-pipeline-phase-b-Sw2NH`
**База:** `dd4569d` (звіт Фази A в `main`)
**Коміти:** `be5c944` (P1) · `5280fcd` (P2) · `fa3839e` (P3) · `eca8f9e` (P4)
**Стан:** Усі чотири P-фікси готові на гілці, тести зелені. Очікую підтвердження адвоката ПЕРЕД push у `main` (правило №1 CLAUDE.md).

---

## 1. Що зроблено (по фіксу — окремий коміт, окремий тест)

### P1 — Паралелізувати PERSIST Drive-uploads (`be5c944`)

**Місце:** `src/services/documentPipeline/stages/splitDocumentsV3.js` (plan-loop, fallback-loop, fragments-uploads).

**Зміни:**
- Новий хелпер `src/services/concurrency.js#runWithConcurrency(items, fn, n, onProgress)` — `N` тасків, `M` одночасних у польоті, результати у вхідному порядку, throw на позиції → `{__error}`.
- Plan-loop розбито на дві фази: (1) CPU-prep (build `pdfBytes` з `cutByKey`, дедуп) серіально; (2) upload+persist+writeArtifacts паралельно з `PERSIST_CONCURRENCY=5`.
- Дедуп розширено: `registryView() ∪ pendingInBatch` — інакше дві однакові назви плану обидві проходять (бо `newDocuments` росте лише після persist; race).
- Fallback-loop аналогічно: sourceBytes+dedup серіально, upload+persist паралельно.
- `saveFragments`: split серіально (worker single-threaded), upload паралельно.
- Контракт помилок збережено: UPLOAD_FAILED → file_skipped, PERSIST_FAILED → fatal. Документи, що УСПІШНО persisted до моменту помилки — лишаються (раніше теж лишались — це не транзакційний шар).

**Тести (Provider-injected, §2.1):**
- `tests/unit/concurrency.test.js` — 7 кейсів (порядок результатів, пік ≤ ліміт, throw, onProgress, concurrency=1 регресія, concurrency>items не «роздуває»).
- `tests/integration/dp-persist-concurrency.test.js` — реальний `DocumentPipelineProvider` ін'єктований executor + інструментований `uploadFile`. 10-doc план → пік одночасних викликів ≤ 5; 2-doc план → пік ≤ 2.

### P2 — Trailing-debounce 800мс registry-save useEffect (`5280fcd`)

**Місце:** `src/App.jsx` EFFECT-B (auto-save до localStorage/Drive на 11-дем `[cases, tenants, users, auditLog, ...]`).

**Зміни:**
- Новий примітив `src/services/debouncedSave.js#createDebouncedSave(saveFn, delay)`: `trigger()` перезводить таймер, `flush()` — негайно якщо pending, `cancel()` — без виклику, `trigger(nextFn)` — оновлює замикання (актуальний снапшот стану).
- `App.jsx` EFFECT-B → `debouncedSaveRef.current?.trigger(saveFn)`. Окремий `useEffect` навішує `visibilitychange → flush` і `unmount → flush` (захист від втрати останніх 800мс при закритті вкладки).
- `actionsRegistry.js` отримав новий dep `requestImmediateSave`; `close_case` і `restore_case` викликають `flushSave()` (окрема гілка immediate, не нашаровується на trigger — правило #11).
- `App.jsx` `deleteCasePermanently` (UI destroy_case) викликає `requestImmediateSave()` одразу після `setCases`.

**Тести (P2 unit fake timers, як у спеці):**
- `tests/unit/debouncedSave.test.js` — 8 кейсів: 10 trigger у 100мс → 1 save через 800мс тиші; повторний trigger через 1500мс → ще 1 save; flush з/без pending; cancel; trigger(nextFn) свіже замикання; критична дія trigger→flush одразу; delay=0.

### P3 — Explicit timeout 60с Drive API (`fa3839e`)

**Місце:** `src/services/driveAuth.js#driveRequest` — єдиний wrapper, через який ідуть ВСІ ~50 Drive-викликів системи.

**Зміни:**
- Внутрішній `AbortController` з `DRIVE_TIMEOUT_MS=60_000` мс таймаутом.
- Caller може override через `options.timeoutMs` (для дуже великих файлів) або `options.signal` (зовнішній signal → НЕ нав'язуємо власний timeout, life-cycle caller'а).
- `buildTimeoutSignal` повертає `{signal, clear}` — `clear` cleanup'ить таймер після завершення fetch (успіх/throw). 401 retry-шлях має окремий timeout.

**Тести (P3 unit fake timers, як у спеці):**
- `tests/unit/driveAuth-timeout.test.js` — 6 кейсів: fetch що не повертається → AbortError через `DRIVE_TIMEOUT_MS`; caller signal → без власного timeout; `timeoutMs` override → коротший таймаут; успішний fetch < timeout → response; `timeoutMs` НЕ потрапляє у fetch options; контракт `DRIVE_TIMEOUT_MS = 60_000`.

### P4 — Throttle jobState save до ≤1/10с з immediate-on-critical (`eca8f9e`)

**Місце:** `src/services/documentPipeline/jobState.js` + `streamingExecutor.js`.

**Зміни:**
- `createJobStateStore(drivePort, { throttleMs })` — додано `saveStateThrottled` (leading-edge throttle: перший immediate, наступні у вікні `JOBSTATE_THROTTLE_MS=10_000` → pending trailing-save з НАЙСВІЖІШИМ станом).
- `flushPendingSave()` — викликати перед terminal `saveState` щоб throttled не перезаписав terminal-стан старіше пізніше.
- `saveState` (immediate) і `clearState` скасовують pending (leak-fix: інакше throttled-timer спрацював би після clearState і відновив `job_state.json` у видаленій папці).
- `streamingExecutor.js` — переведено на `saveStateThrottled`: L110 (register chunks), L139 (per-chunk OCR done), L199/L206 (file status changes). Terminal — immediate: L193 (upload_original failed), L303 (pipeline stopped), L311 (executor threw), `finishCancelled` (cancelled). Кожному terminal — `flushPendingSave()` ПЕРЕД `saveState`.

**Тести (P4 unit fake timers, як у спеці):**
- `tests/unit/jobStateThrottle.test.js` — 8 кейсів: 30 saves у 500мс → 1 leading upload, через `throttleMs` trailing з найсвіжішим станом; leading+trailing; immediate скасовує pending; `flushPendingSave`; `clearState` leak-fix; `throttleMs` override; `JOBSTATE_THROTTLE_MS=10_000` контракт.

---

## 2. Тести — повна картина

**Було (після Фази A):** 1392 / 1392.

**Стало:** **1423 / 1423** зелені (+31 нових: 7 concurrency + 2 dp-persist-concurrency + 8 debouncedSave + 6 driveAuth-timeout + 8 jobStateThrottle).

Жодних регресій. Усі попередні тести Фази A зелені (B1/B2/B3 layout-strip, documentNature, image_merge graceful).

---

## 3. Очікуваний виграш на Брановського (65 стор. → 25 docs)

Після Фази A: ~5-6 хв end-to-end. Після Фази B (накопичено):

| Фікс | Зменшення | Механізм |
|---|---|---|
| **P1** | PERSIST з ~300-400 сек → ~60-100 сек (×3-5) | `Promise.all` з concurrency 5, ~6 HTTP per host на планшеті |
| **P2** | ~150 fires → ~3-5 saves (~10-15 сек) | trailing-debounce 800мс |
| **P3** | прибирає невидимі багатогодинні зависання | explicit 60с AbortController |
| **P4** | ~120 saves → ~5-10 saves (~10-15 сек) | leading-edge throttle 10с |

**Сумарно (порядок):** Брановський **5-6 хв → бажано <3 хв** end-to-end. Для майбутніх 200-250 стор. з очисткою/стисненням мультиплікативний ефект — кожна важка операція бачить уже паралельний/дебаунсений I/O.

P3 — рідкісний випадок (поганий WiFi), але прибирає мовчазні многохвилинні зависання, які адвокат сприймає як «висить».

---

## 4. Що тестувати на ПЛАНШЕТІ

Перед push у `main` адвокат тестує цикл DP на справі **Брановський** (та сама 65-стор. справа що Фаза A). Очікувано:

### Маст-перевірки
1. **Час end-to-end:** старт → завершення з модалкою результату. Ціль: ≤3 хв (раніше ~5-6 хв).
2. **Усі 25 документів** збереглись (як у прогонах Фази A — допускається ~1-2 image_merge_failed на «Копія паспорту»; B3 не валить інші).
3. **Розмір `.layout.json`** у `02_ОБРОБЛЕНІ/`: ~37 КБ/стор. як після Фази A (P1-P4 не торкаються strip).
4. **Перемикач Скан/Текст** у в'юері на нарізаних документах — є (B2 збережено).

### Перевірки P-фіксів
5. **P1 (паралелізм):** у мережевих DevTools на планшеті — кілька паралельних PUT/POST до `googleapis.com` у фазі PERSIST (не строго один-за-одним). Час фази PERSIST на 25 docs — ~1-2 хв замість ~5-7 хв.
6. **P2 (дебаунс):** індикатор «Saved at HH:MM» у footer — оновлюється раз на 1-2 секунди під час DP, не на кожну мікро-зміну. Адвокат не повинен бачити перформанс-проблем у UI.
7. **P3 (timeout):** якщо адвокат вимкне WiFi на середині DP — через ~60 секунд має з'явитись видима помилка (toast або «Потребує уваги»), а НЕ нескінченне «висить на 100%».
8. **P4 (jobState throttle):** не видно адвокату (внутрішня оптимізація). Перевіряється тільки опосередковано через загальний час.

### Контрперевірки (НЕ повинно зламатись)
9. **Закриття справи** (`close_case`) → одразу з'являється у списку «Закриті». Drive має нову версію `registry_data.json` без 800мс затримки (P2 immediate-save).
10. **Видалення справи** (`destroy_case` через UI) → справа зникає, auditLog має `done`-запис, Drive `registry_data.json` оновлений одразу.
11. **Скасування DP** (якщо кнопка є у UI) → стан зберігається коректно, resume працює (P4 critical immediate).

---

## 5. Git

Гілка `claude/optimize-dp-pipeline-phase-b-Sw2NH` гілкована від `dd4569d` (`main`). 4 коміти, кожен P — окремий.

**Push у `main` ТРИГЕРИТЬ CI (test→build→deploy на GitHub Pages).** Тому перед FF потрібне коротке підтвердження адвоката, що знайшов час протестувати на планшеті (правило №1 CLAUDE.md).

Якщо тестування не пройшло — діагностика на гілці, без push.

---

## 6. Поза обсягом / на майбутнє

P1-P4 — мундейн I/O оптимізації. Нуль зміни логіки, моделей, диригента, схеми. Закладено фундамент для:

- **Подальші оптимізації на 200-250 стор. томах** — після підтвердження на Брановського.
- **Стиснення великих масивів** (текст, layout) перед Drive upload — окремий TASK (тригер: коли середній том стане >100 стор. і `02_ОБРОБЛЕНІ` стане громіздким).
- **Розширене propose→confirm UI для якості нарізки** — D1 збагачений паспорт (tracking_debt #19, тригер: після Фази B якість лишається <90%).

---

## 7. Уроки (короткі)

1. **Provider-injected тест має бути на ПОВНИЙ executor, не лише стадію.** P1 покрито через `createStreamingExecutor` + `createSplitDocumentsV3`. Це обмеження №1 батьківського TASK після зломів DP-4 — і воно ловить race-conditions у concurrency, що ізольовані unit-тести можуть пропустити.
2. **Один сенс на ім'я (правило #11) — не теорія, а інженерна дисципліна.** P2: `requestImmediateSave` — окрема гілка від `debouncedSaveRef.trigger`, не нашаровується на існуючий шлях. P4: `saveStateThrottled` і `saveState` — два різні методи, не один з прапором.
3. **Cleanup pending-timers — обов'язковий при terminal-shutdown.** P4: `clearState` без `_cancelPending()` створив би leak (throttled-timer спрацював би після `clearState` і відновив `job_state.json`). P3: `clear()` після успішного fetch.
4. **Апостроф у JS string'у в одинарних лапках (правило #5) — реальна точка зламу.** Один тест P3 не парсився через `від caller → не нав'язуємо`. Виправлено переходом на подвійні лапки.

---

**Кінець звіту Фази B.** Чекаю підтвердження адвоката після тесту на планшеті ПЕРЕД push у `main`.
