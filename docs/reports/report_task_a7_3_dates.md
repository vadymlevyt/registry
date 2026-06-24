# Звіт — TASK A7.3: Дата документа у плані нарізки (виняток ii)

**Дата:** 2026-06-24
**Гілка:** `claude/a7-3-dates` (від свіжого `main`, де A7.1+A7.2 вже зведені)
**Спека:** `docs/tasks/TASK_a7_slicing_edit_screen.md` §8 «A7.3» (+ §2.3, §9, §10)
**Статус:** готово, `npm test` зелений, без нової міграції/schema-bump.

---

## 1. ЩО ЗРОБЛЕНО (скоуп A7.3, точно за §2.3)

AI пропонує **дату документа**, адвокат застосовує її через тумблер або править
вручну — на тому ж екрані редагування плану нарізки (A7.2). До «Виконати» нічого
не пишеться; на «Виконати» у `createDocument.date` іде **ефективна** дата.

1. **ЗНАЧЕННЯ дати (propose).** `triagePrompt` додає `date` (`YYYY-MM-DD`|null) у
   JSON-вихід на документ (явна інструкція: «немає/сумнівно → null, НЕ вгадуй»).
   Дати рахуються **завжди** у фазі propose (той самий один Triage-виклик — без
   нового AI, §6/§7).

2. **Перенесення у план.** `triageStage.normalizePlan` переносить валідовану `date`
   у вузол плану + джерело `dateSource` (дефолт `'auto'`). На рівні плану —
   `applyAutoDates` (стан тумблера, дефолт **OFF**); Triage-план і неінтерактивний
   `run()` його не ставлять → auto-дати «розчиняються» (behavior-preserving).

3. **Модель редагування** — `slicePlanModel.js`:
   - `planToGroups`/`groupsToPlan` несуть `date` + `dateSource` (той самий патерн,
     що `namingStatus auto/manual`); `groupsToPlan(groups, unused, applyAutoDates)`
     кладе тумблер на рівень плану.
   - `setGroupDate(groups, docId, iso)` — будь-яка правка календариком (дата **або**
     явне «без дати» = `''`) → вузол стає `'manual'` (ручне в пріоритеті, #11).
   - `resolveEffectiveDate(node, applyAutoDates)` — **спільне джерело правди**:
     `manual` завжди перемагає (вкл. manual-null → null); `auto` лише при тумблері ON.
   - `splitGroupAt` — хвіст (новий документ) дату **не успадковує**; `mergeWithNext`
     зберігає дату/джерело першого.

4. **Запис ефективної дати** — `splitDocumentsV3` (`defaultBuildMetadata`):
   `resolveEffectiveDate(doc, plan.applyAutoDates)` → у `createDocument.date`.
   Невикористані AI-дати нікуди не пишуться (як сьогодні).

5. **Екран** — `DpSlicePlanEditor.jsx`:
   - тумблер **«Проставити дати»** (дефолт OFF, `// experimental — review`);
   - на кожному вузлі — спільний `DatePicker` (UI/DatePicker, не плодимо новий);
   - показ: `manual` → завжди своя (вкл. `''`); `auto` → AI-дата **лише** при ON,
     інакше порожньо («Без дати»);
   - на «Виконати» → `groupsToPlan(..., applyAutoDates)` → `executeRun`.

**Нуль повторного AI:** тумблер — суто UI-стан над уже-готовими даними session.

---

## 2. ФАЙЛИ

**Код:**
- `src/services/documentBoundary/triagePrompt.js` — `date` у виході + інструкція.
- `src/services/documentPipeline/slicePlanModel.js` — `isIsoDate`,
  `resolveEffectiveDate`, `setGroupDate`; `date/dateSource` у `planToGroups`/
  `groupsToPlan`; `applyAutoDates` на рівні плану; split/merge правки.
- `src/services/documentPipeline/stages/triageStage.js` — `normalizePlan` переносить
  `date/dateSource` + `applyAutoDates` (імпорт `isIsoDate`).
- `src/services/documentPipeline/stages/splitDocumentsV3.js` — ефективна дата у
  `createDocument` (імпорт `resolveEffectiveDate`).
- `src/components/DocumentProcessorV2/DpSlicePlanEditor.jsx` + `styles.css` — тумблер,
  `DatePicker`, `handleDate`, display-логіка.

**Тести:**
- `tests/unit/triagePrompt.test.js` — date у промпті.
- `tests/unit/slicePlanModel.test.js` — `isIsoDate`, `resolveEffectiveDate`,
  `setGroupDate`, date carry, split/merge.
- `tests/unit/triageStage.test.js` — `normalizePlan` переносить date/auto + OFF.
- `tests/unit/splitDocumentsV3.test.js` — ефективна дата (manual/manual-null/auto×тумблер).
- `tests/integration/dp-two-phase.test.js` — date тече propose→persist.
- `tests/integration/dp-a7-3-dates.test.jsx` — тумблер ON/OFF на екрані.

---

## 3. КОНТРАКТ ОДНОЗНАЧНОСТІ (#11)

- `date` (значення) і `dateSource` (`auto`/`manual`, ХТО поставив) — два сенси, два
  поля; на плані додатково `applyAutoDates` (стан тумблера). Не змішуються.
- Не дубльовано канонічне `document.date` (§10): на плані — транзитні поля вузла,
  у документ іде **одна** ефективна дата через `createDocument`.
- `resolveEffectiveDate` — єдина точка обчислення (editor-прев'ю і persist
  читають її, не дублюють логіку).

## 4. SAAS / BILLING / AI

- **SAAS:** нових сутностей нема; дата лягає у вже tenant-scoped `cases[].documents[]`
  через наявний `add_document`/`createDocument` шлях.
- **BILLING:** жодного нового AI-виклику (date у тому ж Triage-промпті). Тумблер і
  DatePicker — без AI. Без нових категорій/інструментації.
- **AI:** єдина зміна — `date` у `triagePrompt` (та сама модель/один виклик).

## 5. МЕЖІ (НЕ входило)

- A7.4 (inline-правка date/author/category у «Деталях» вʼювера) — **не** робив.
- Повна A5, серверні питання (#42 довговічність) — поза скоупом.
- `run()` неінтерактивний / backend A7.1 — не чіпав (behavior-preserving).

## 6. ТЕСТИ

`npm test` — повний прогон зелений (183 файли / 2297 тестів). Цільові набори A7.3 —
106/106 у вибірковому прогоні зачеплених файлів.
