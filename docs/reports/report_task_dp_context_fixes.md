# Звіт — TASK DP context fixes (Сесія 1, зона «Контекст»)

**Дата:** 2026-05-30
**Гілка:** `claude/context-generator-unify-l3cUZ` (продовження сесії TASK 2; фолд у `main` після підтвердження адвоката — деплой)
**Базова специфікація:** `docs/tasks/TASK_dp_context_fixes.md`
**Каталог багів:** `docs/bugs/bugs_found_during_dp_testing.md` (#7, #6, #5, #3, #2)
**schemaVersion:** без bump

---

## 0. Що лагодили

Реальне тестування виявило що контекст-генератор **псував розуміння справи
агентом** (89-91 «документ» замість 43, «45 помилок»), а для **фото** тумблер
«Оновити case_context» мовчки не працював. 5 фіксів у зоні «Контекст»
(`services/contextGenerator.js` + event-wiring DP). Зона image-merge editor
(#1/#9/#4) — НЕ цей TASK.

---

## 1. #7 🔴 — джерело документів = реєстр (SSOT), не folder-scan

**Корінь:** `generateCaseContext` сканувала папки Drive `01_ОРИГІНАЛИ` +
`02_ОБРОБЛЕНІ` і фільтр відсіював `.txt`/`agent_history.json`/`case_context.md`,
**але НЕ `.layout.json`**. → кожен документ рахувався кілька разів (оригінал +
layout [+ оброблений]), а `.layout.json` (JSON, не PDF) валив OCR → ~45
«помилок» ≈ кількість документів.

**Фікс:** джерело генерації = `caseData.documents` (канонічний SSOT). Для кожного
документа з `driveId` будуємо `{ id: driveId, name, mimeType:'application/pdf',
subFolders, driveFolderId }` і женемо через `ocrService.extractTextBatch`.

**Що збережено (критично):** текст береться тим самим `ocrService` (кеш `.txt` за
`driveId` → fallback OCR; `pdfjsLocal` витягує text-layer searchable-PDF).
Властивість «джерело = документи, не лише `.txt`» **не втрачена** — text-layer
PDF (яким 1C не пише `.txt`) не зникає з контексту. Документ без `driveId` →
пропускається з warning, рахується у `stats.skipped` (не вигадуємо).

**Результат:** лік = `caseData.documents.length` (43, не 89/91); нуль
`.layout.json`/дублів 01-02; нуль layout-помилок. Діє і в Огляді, і в DP (одна
функція). Менше OCR/AI-викликів → знімає й більшість rate-limit #8.

**До/після на тест-справі:** «91 документ · 45 помилок» → «43 документи · 0
помилок» (фактичний лік буде рівний `documents.length` справи).

## 2. #5 🔴 — фото-шлях публікує `DOCUMENT_BATCH_PROCESSED`

**Корінь:** image-merge обходить `pipeline.run` → `emitStage` не публікує подію →
слухач контексту в CaseDossier (TASK 2) не спрацьовує. Тому для фото контекст
оновлювався (файл зʼявлявся), але **без сигналу** і без гарантованого тригера.

**Фікс:** `handleImageMergeSubmit` (`DocumentProcessorV2/index.jsx`) після
успішного `add_documents` публікує `DOCUMENT_BATCH_PROCESSED` тією самою формою
що `emitStage` (`{ caseId, documentIds, count, tenantId, userId,
updateCaseContext, timestamp }`). `updateCaseContext` — зі стану тумблера тієї ж
DP-сесії (`settings.updateCaseContext`). Publish ізольований `try/catch`, лише
після успіху `add_documents`. Слухач CaseDossier спрацьовує однаково для фото →
оновлення нарису + сигнал.

## 3. #2 🟡 — архів попереднього `case_context.md` при DP-тригері

Архівація (`listFolderFiles` → знайти існуючий → copy в `archive/` → delete) уже
живе **у спільному сервісі** `generateCaseContext` (крок 12, від TASK 2). Обидва
споживачі (Огляд + DP-тригер) кличуть ту саму функцію → обидва архівують. Окремої
зміни коду не потребувало; покрито unit-assertion «архівує існуючий перед
перезаписом».

## 4. #3 🟡 — окремий сигнал «нарис оновлено»

Додано `messages.context.updated` (заголовок «✓ Нарис справи оновлено») окремо
від `created`. DP-слухач у CaseDossier тепер показує `updated` при завершенні
фонової регенерації — не плутається з тостом нарізки «Оброблено N документів»
(нарізка ≠ контекст). Огляд-шлях лишає `created` (це справді створення з кнопки).

## 5. #6 🟢 — дата+час у нарисі

`buildCaseMetadata` додає `CURRENT_DATETIME_ISO` (локальний час `YYYY-MM-DD
HH:MM`). У промпті: «Сьогодні:» → datetime; шапка «Створено/Оновлено: [ISO дата
і час]»; у секції «ФОРМАТ ДАТ» — виняток для цих полів. Структуру/розділи промпту
не змінено (лише поле дати розширено), як вимагала спека.

---

## 6. Числа тестів і build

| | Файли | Тести |
|---|---|---|
| Baseline (після TASK 2) | 123 | 1637 passed |
| Після TASK DP context fixes | 124 | **1642 passed** |

- `tests/unit/contextGenerator.test.js` — переписано під реєстр-джерело: лік =
  `documents.length`, нуль folder-артефактів, text-layer не губиться, документ
  без `driveId` → `stats.skipped`, NO_FILES на порожньому реєстрі; #6 (промпт
  містить «Сьогодні:» з датою+часом); C7-логування; #2 архів; коди розвилок.
- `tests/integration/dp-image-merge-context-event.test.jsx` (НОВИЙ) — jsdom mount
  DP → вхід у image-merge → submit → asserts publish `DOCUMENT_BATCH_PROCESSED`
  з `updateCaseContext`; не публікує якщо `add_documents` впав.
- `npm test` — **1642 passed, 0 failed**. `npm run build` — **success**.

---

## 7. Побічні знахідки

- #8 (rate-limit 429) — не окремий фікс: очікувано спадає як наслідок #7
  (43 замість 91 виклику). Окремий backoff/throttle не робили (спостереження;
  якщо повториться — окремий пункт).
- Нових боргів у `tracking_debt.md` не додано.
- Зона image-merge editor (#1 дублі, #9 контроль crop, #4 overlay) — свідомо НЕ
  цей TASK (окрема сесія), у каталозі лишаються відкритими.

---

## 8. Як перевірити (після деплою)

1. Огляд → «Створити контекст» → у нарисі **реальна** кількість документів (не
   роздута), без «45 помилок».
2. Агент досьє: «скільки документів» → правильна цифра (43, не 89).
3. DP → додати **фото** з увімкненим тумблером «Оновити case_context» → контекст
   оновився **+ є сигнал** «✓ Нарис справи оновлено».
4. DP → нарізка PDF з тумблером → контекст оновився, архів попередньої версії на
   місці.
5. У `case_context.md` — дата **і час** генерації.

Якщо щось зламано — `git revert <commit>`, повідомити.

---

## 9. Git commits (гілка `claude/context-generator-unify-l3cUZ`)

1. `fix(context) #7+#6: джерело генерації = реєстр cases[].documents (SSOT) + дата/час`
   — `contextGenerator.js` + `tests/unit/contextGenerator.test.js`.
2. `fix(context) #5: image-merge публікує DOCUMENT_BATCH_PROCESSED`
   — `DocumentProcessorV2/index.jsx` + `tests/integration/dp-image-merge-context-event.test.jsx`.
3. `fix(context) #3: окремий сигнал «✓ Нарис справи оновлено» (DP-тригер)`
   — `messages.js` + `CaseDossier/index.jsx`.

Docs-коміт (звіт + bugs-статуси + ARCHITECTURE_HISTORY) — окремо.

**Push у `main` (= деплой) — ПІСЛЯ підтвердження адвоката** (CLAUDE.md правило №1).
Перед push: `git pull --rebase origin main`, тільки FF, тільки при зелених тестах.

---

## 10. Acceptance (усі ✅)

- [x] #7: лік документів у нарисі = реальний `caseData.documents.length`.
- [x] #7: нуль layout-помилок; `.layout.json`/дублі 01-02 не потрапляють у генерацію.
- [x] #7: text-layer PDF досі враховується (джерело = документи через ocrService).
- [x] #7: фікс діє і в Огляді, і в DP (одна функція).
- [x] #5: image-merge публікує `DOCUMENT_BATCH_PROCESSED`; з тумблером — контекст оновлюється + сигнал (для ФОТО).
- [x] #2: архів попереднього `case_context.md` пишеться при DP-тригері (спільний сервіс).
- [x] #3: завершення оновлення контексту має окремий сигнал.
- [x] #6: у нарисі дата+час; промпт-структура не зламана.
- [x] нові/оновлені тести; `npm test` зелений (1642); `npm run build` success.
- [x] один деплой у кінці (внутрішньо коміти по пунктах).

**Кінець звіту TASK DP context fixes.**
