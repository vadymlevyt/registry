# Звіт — Відкат `imagelessMode: true` з Document AI запиту (регресія Triage)

**Дата:** 26.05.2026 (вечір)
**Спека:** `docs/tasks/TASK_revert_imagelessmode.md` (вкладена адвокатом, не в репо)
**Гілка:** `claude/new-session-QHBq9`
**Виконавець:** Claude Code (web, opus 4.7)
**Батьківський TASK:** `report_task_documentai_limit_40mb_imageless.md` (виконаний 26.05 опівдні; цей TASK — відкат частини, що зламала Triage на томах ≥285 стор.).

---

## 1. Що зроблено

### Точковий відкат — один опційний параметр API

`src/services/ocr/documentAi.js` — видалено `imagelessMode: true` з body POST-запиту до Document AI `:process` endpoint. Google за замовчуванням використовує `imagelessMode: false` (поле відсутнє → response містить `image` base64 + усі залежні поля: `imageQualityScores.qualityScore`, `visualElements`, повна `paragraphs/blocks` структура).

- **`documentAi.js:159-167`** — body тепер `{ rawDocument: { content, mimeType } }` — точно стан до фіксу 26.05 опівдні. Коментар оновлено: один абзац про те ЧОМУ свідомо НЕ передаємо параметр (посилання на LESSONS.md урок).
- **`documentAi.js:1-5`** — синхронізовано шапку файлу (раніше згадувала `imagelessMode:true` як активний, тепер — як свідомо вимкнений + посилання на LESSONS).

### Що **збережено** від попереднього TASK (свідомо, згідно §1 спеки)

- **`DOC_AI_MB_PER_REQUEST = 40`** (`documentAi.js:46`) — НЕ чіпали. Підтверджено робочим: файли Стрибка 18/32/35/39/42 МБ нарізаються; два файли по 40-42 МБ одночасно → 12 документів.
- **`DOC_AI_PAGES_PER_REQUEST = 15`** — не чіпали.
- **`STRIPPED_LAYOUT_FIELDS`** у `ocrService.js` — не чіпали. Тепер коли `image` знов повертається у response — strip працює як до 26.05 (фільтрує `image`/`tokens` при serialize у `.layout.json`).
- **`memoryMonitor.adviseChunkPages`**, retry-стратегія, `classifyError`, `streamingExecutor` catch-shape — не чіпали.

### Тести (оновлені)

`tests/unit/documentAi.test.js` — **2 тести з 5** інвертовано:

1. **`postToDocAi body НЕ містить imagelessMode (default Google = false)`** — раніше асерт `body.imagelessMode === true`, тепер `'imagelessMode' in body === false` + `body.imagelessMode === undefined`. Базова форма `rawDocument.mimeType / content` — збережена.
2. **`image MIME → body теж БЕЗ imagelessMode`** — те саме для single-request гілки (не PDF).

Решта 3 тести (guard на 30/39/41 МБ) — лишились без змін (це окремий канал, 40 МБ ліміт зберігається).

### Урок у `LESSONS.md`

**Новий запис на самому верху списку уроків** `[2026-05-26] API-параметри прибирання даних впливають на downstream pipeline` — повний текст з §10 спеки (контекст, що пішло не так, корінь рішення, правило на майбутнє, зв'язок з правилом #11, інструкція «не вмикати знов»).

## 2. Як перевірено

- `npm test` ДО першої правки (baseline): **118 файлів, 1540 тестів — усі зелені** (стан після попереднього TASK).
- `npm test` ПІСЛЯ правки `documentAi.js` (видалено `imagelessMode:true`): **118/1540 зелений**.
- `npm test` ПІСЛЯ оновлення 2 тестів у `documentAi.test.js`: **118/1540 зелений**. Жоден інший тест не зачеплений.
- Цільовий вузький прогін `tests/unit/documentAi.test.js` — 5/5 (3 guard-тести 30/39/41 МБ + 2 інвертовані body-тести).
- Регрессійні integration-тести pipeline (§4.3 спеки): `dp-triage`, `dp4-ui`, `documentPipeline`, `dp-persist-routes`, `dp-document-nature`, `dp-stage-progress`, `dp3-streaming`, `dp-layout-persist`, `dp-text-slice` — усі зелені у повному прогоні.
- `npm run build` — ✓ built in 17.36s. Жодних нових Vite/Rollup попереджень.
- `grep "imagelessMode" src/`: жодних згадок. Чисто видалено.

## 3. Поведінка до/після

**Синтетичний сценарій:** PDF 100 стор., Triage прогон (нарізка на документи).

**ДО відкату** (стан 26.05 опівдні після фіксу):
- `body = { rawDocument:{…}, imagelessMode: true }`.
- Document AI повертає response БЕЗ `image` base64 на кожній сторінці + БЕЗ `imageQualityScores.qualityScore` + БЕЗ `visualElements`. JSON у 5-10× менший (як і обіцяли в попередньому TASK).
- `pageMarkers.compactDigest` будує сигнальну сітку для Haiku Triage без 2-3 ключових сигналів меж (стрибок якості, наявність печатки/підпису на останній сторінці документа).
- На томах 285+ стор. (де паспорт обмежений rich-cap 70 стор. через TASK smart_triage_degenerate) Triage Haiku здається — повертає `[ { startPage:1, endPage:1, type:null } ]` → план degenerate → `splitDocumentsV3` створює 1 doc з усього тома.
- **Реальний симптом адвоката:** Том 1 «Нестеренко» 335 стор / 207 МБ → 1 doc / pageCount=1 / тип «не визначено». До 26.05 опівдні той самий Том 1 стабільно нарізався на 18-21 doc (двічі поспіль).

**ПІСЛЯ відкату** (поточний стан):
- `body = { rawDocument:{…} }` — без `imagelessMode`.
- Google default `imagelessMode: false` → response містить повну сторінкову структуру з `imageQualityScores`/`visualElements`.
- `pageMarkers.compactDigest` отримує усі сигнали меж — Triage Haiku зважує їх як раніше.
- Том 1 знов очікувано нарізається на ~18-21 doc.
- `STRIPPED_LAYOUT_FIELDS` стрипає `image`/`tokens` з кожної сторінки перед персистом `.layout.json` — на диск нічого зайвого не лягає (стан як до 26.05 опівдні).
- Memory peak повертається на рівень до 26.05 — але адвокат явно зафіксував що **memory не була кореневою причиною** падіння Тома 2/3 (теорія cumulative image base64 спростована: Том 1 207 МБ проходив, менші Том 2/3 падали — справжній корінь був `DOC_AI_MB_PER_REQUEST = 20`, який вже виправлений підняттям до 40).

**Файли Стрибка 32-42 МБ:** продовжують нарізатися. Це працює завдяки 40 МБ guard (`DOC_AI_MB_PER_REQUEST=40`), не завдяки `imagelessMode`. 40 МБ guard зберігається — Стрибки далі проходять.

## 4. Знайдені побічні баги

Жодних. Відкат точковий — один опційний параметр API. `grep "imagelessMode"` по `src/` чистий.

## 5. Оновлення `ARCHITECTURE_HISTORY.md`

Додано рядок у покажчик (хронологія):

```
| Revert imagelessMode (регресія Triage) (2026-05-26 вечір) | без bump | `TASK_revert_imagelessmode.md`, `report_task_revert_imagelessmode.md` |
```

Без розширеного наративу — фікс точковий (один рядок API параметра), повна історія є у спеці, цьому звіті і у LESSONS.md (з правилом на майбутнє).

## 6. Відкриті питання / наступний крок

**Цей TASK НЕ виправляє Том 2/Том 3.** Він повертає Том 1 до робочого стану 26.05 опівдні.

**Наступний крок №1** (негайний — підтвердження відновлення):
- Адвокат повторно прогонить **Том 1 «Нестеренко»** (335 стор / 207 МБ) на планшеті. Очікувано: знов нарізка на ~18-21 doc, як двічі поспіль 26.05 до полудня.
- Якщо так → ціль TASK досягнута, регресія усунута. Якщо ні → діагностика, бо щось ще змінилось (малоймовірно, бо діаграма точно повертає стан ДО фіксу).

**Наступний крок №2** (окремий TASK — структурна проблема Тома 2/3):
- Том 2 / Том 3 (170+ МБ / 285+ стор) — навіть з повними сигналами Triage не бачить меж на однотипному контенті. Це **структурна проблема Triage на однотипних томах**, не пов'язана з `imagelessMode`. Кандидати рішення:
  - **Варіант A:** Розширення `isDegeneratePlan` фільтром «< 20% покриття» — якщо план покриває менше 20% сторінок, маркувати як degenerate (а не тільки коли план = 1 стор.). Передавати на повторну спробу або нейтральний halt у «Питання» (як вже зроблено для triage_whole_volume).
  - **Варіант Б:** Адаптивний Triage у батчах — розрізати том на 2-3 батчі по 100-150 стор., Triage по кожному окремо, потім merge меж. Дорожче (більше Haiku-викликів), але працює на однотипному контенті.
  - **Варіант В:** TOC-детектор (`tracking_debt.md #21`) — якщо том починається з реєстру/опису документів, парсити таблицю → ground truth → обходити Triage. Найдешевше і найточніше для томів з реєстром (більшість українських кримінальних томів).

Вибір варіанта — за рішенням адвоката після підтвердження що Том 1 знов нарізається.

**Кандидат розширення (НЕ цей TASK):** `imagelessMode` з умовною валідацією — якщо колись захочемо повернутись, потрібен TASK з представницькими даними (Том 1 з/без параметра, порівняти план Triage, перевірити що 18-21 doc зберігається). Поки що — `LESSONS.md` фіксує «не вмикати знов без явного TASK».

## 7. Регресійна дисципліна (звіт по §8 спеки)

- **Baseline ДО першої правки:** `npm test` — 118 файлів, 1540 тестів, усі зелені.
- **Після видалення `imagelessMode:true` з body (`documentAi.js:159-167`):** `npm test` — 118 файлів, **1538 тестів зелених, 2 червоних** (`postToDocAi body містить imagelessMode:true`, `image MIME → imagelessMode:true теж присутній`). Це **очікувана зміна тестів** — вони асертили відсутній тепер прапор. Документуємо як «expected red, треба інвертувати».
- **Після інверсії 2 тестів у `tests/unit/documentAi.test.js`:** `npm test` — 118/1540 зелений. Жоден інший тест не зачеплений.
- **Після оновлення шапки `documentAi.js`** (sync коментаря): `npm test` — 118/1540 зелений.
- **Після додавання уроку у `LESSONS.md`:** `npm test` — 118/1540 зелений (markdown не зачіпає тести).
- **`npm run build`:** ✓ built in 17.36s. Артефакти dist/ генеруються нормально.
- **Sanity на критичних інтеграційних** (через `npm test` повний прогон): `dp-triage`, `dp4-ui`, `documentPipeline`, `dp-persist-routes`, `dp-document-nature`, `dp-stage-progress`, `dp3-streaming`, `dp-layout-persist`, `dp-text-slice` — усі зелені.
- **Manual smoke виконавцем неможливий** — remote env, браузера немає, Тома 1 (207 МБ PDF) у тестових даних немає. Чесно зафіксовано згідно дозволу спеки §3 і §9.7. Тестує адвокат на планшеті після push у `main`.
- **Заборонені зони (§6 спеки) не зачеплено:** `DOC_AI_MB_PER_REQUEST=40`, `DOC_AI_PAGES_PER_REQUEST=15`, `STRIPPED_LAYOUT_FIELDS`, `adviseChunkPages`, `memoryMonitor`, retry-стратегія, `classifyError`, `streamingExecutor`, OCR/Triage/нарізка — нічого з цього не торкалось. Підтверджено git diff: змінено тільки `src/services/ocr/documentAi.js` (рядки 1-5 + 159-167), `tests/unit/documentAi.test.js` (2 тести), `LESSONS.md` (новий запис), `ARCHITECTURE_HISTORY.md` (1 рядок).
- **`AskUserQuestion` не знадобився** — все вкладалось у мінімальний скоуп (один рядок API, оновити 2 тести, документація).
- **SAAS / BILLING / AI USAGE** (за §5 спеки): жодних змін. Document AI cost per request не залежить від `imagelessMode`. schemaVersion не bump'ився. `tenants[]`, `users[]`, `permissions`, `time_entries[]`, `ai_usage[]` — не зачеплено.

---

**Готово до push у `main`** після підтвердження адвоката (CLAUDE.md правило #1 — зміна коду тригерить CI + Pages deploy).
