# Звіт — TASK A7.2: Екран редагування плану нарізки + справжній гейт

**Дата:** 2026-06-24
**Гілка:** `claude/a7-2-edit-screen` (від `claude/a7-1-two-phase`)
**Спека:** `docs/tasks/TASK_a7_slicing_edit_screen.md` §8 «A7.2»
**Статус:** готово, `npm test` зелений (182 файли / 2272 тести), `npm run build` ok.

---

## 1. ЩО ЗРОБЛЕНО (скоуп A7.2)

Slice-шлях Document Processor став **двофазним для адвоката**: «Розпочати» більше
НЕ ріже одразу — спершу показує **редагований план** (стрічка карток-сторінок,
згрупованих по документах), і лише «Виконати» матеріалізує його на Drive.

1. **Backend-міст (контекст).** `DocumentPipelineContext` тепер експонує
   `proposeRun(input, options)` і `executeRun(session, editedPlan)` (Фази A7.1).
   `proposeRun` виставляє `runOptionsRef` (опції прогону читає `buildPipelineDeps`
   під час побудови pipeline; pipeline лежить у session → executeRun успадковує
   ті самі опції). Сам `streamingExecutor` (A7.1) не чіпав.

2. **Чиста модель редагування** — `src/services/documentPipeline/slicePlanModel.js`.
   `planToGroups`/`groupsToPlan` (сторінки ↔ фрагменти), `splitGroupAt`,
   `mergeWithNext`, `movePage`, `renameGroup`, `setGroupType`, `removeGroup`,
   `collapsePagesToFragments`. Без React/Drive/AI — межі тестуються ізольовано.
   20 unit-тестів.

3. **Екран редагування** — `DpSlicePlanEditor.jsx` + `SlicePagePreview.jsx`:
   - план як **стрічка карток-сторінок по документах** (§2.2); картка = перші
     рядки `page._text` з session (дешево, миттєво);
   - **межа = роздільник між групами**; правка: перетягнути картку в сусідню
     групу (DnD, lazy `@dnd-kit`) АБО «Розділити тут» (картка) / «Обʼєднати з
     наступним» (документ) — кнопки, які тепер реально працюють;
   - **rename** (Input) + **тип** (Select enum, `CATEGORY_OPTIONS`);
   - **скани**: клік по картці → лінькуватий рендер сторінки pdf.js з `_temp`
     оригіналу (`SlicePagePreview`, кеш документа за driveId);
   - **«Виконати»** — ЄДИНА кнопка-гейт → `executeRun(session, editedPlan)`;
   - валідація перед виконанням — реюз `normalizePlan`/`resolveOverlaps` (порожній
     план / зведені перекриття → видимий warning, не тихо).

4. **DocumentProcessorV2.** Slice-гілка `startProcessing` кличе `proposeRun`;
   успіх з планом → `planSession` у стані компонента → Зона 3 показує
   `DpSlicePlanEditor`; «Виконати» → `handlePlanExecute` → `executeRun` → результат
   (як раніше). Два стани: «план (редагується)» → «результат». add_as_is і
   image-merge шляхи — **без змін**.

---

## 2. ПАТЕРНИ І РІШЕННЯ

- **Rule of Three (§2.2).** UX «картки→групи→перетягування» взято з
  `DpImageMergeEditor` (один `DndContext`, N `SortableContext`), але **предмет
  інший**: сторінка PDF (`fileId+pageNumber`, текст) ≠ фото (blob/crop/rotate/
  дублі). Спільне ще не має третього споживача — скопійовано UX-патерн, а не
  машинерію фото (правило #11). Якщо зʼявиться третій споживач — виносити.
- **Логіка первинна (AI-first філософія).** Операції меж — чисті функції
  (`slicePlanModel`), повністю тестовані без UI. Екран — вікно до них.
- **Hook-safety.** DnD-хуки (`useDroppable`/`useSortable`) винесені в окремі
  компоненти-ТИПИ (`SliceDroppableStrip`/`SliceSortableCard`); викликаються
  БЕЗумовно. Стрічка обирається за `dndReady` на рівні JSX (Plain vs Droppable
  тип) → Rules of Hooks дотримано незалежно від порядку lazy-load `@dnd-kit`.
  `SlicePageCard` — презентаційний (0 хуків).
- **Гейт.** До «Виконати» — жодного `add_document`/Drive-запису (доведено
  тестами; `proposeRun` лишає `_temp`, нічого не персистить — A7.1).

---

## 3. ТЕСТИ

**unit** — `tests/unit/slicePlanModel.test.js` (20): pageKey round-trip, collapse
фрагментів, planToGroups↔groupsToPlan, split/merge/movePage/rename/type/remove,
валідність меж після правок.

**integration** — `tests/integration/dp-a7-2-edit-screen.test.jsx` (4):
- ГЕЙТ: proposeRun→екран; `executeRun` НЕ викликано до «Виконати»;
- правка (rename + Обʼєднати) доходить у `executeRun` як ВІДРЕДАГОВАНИЙ editedPlan
  (1 документ, нова назва, діапазон 1-4);
- «Розділити тут» → +1 документ у editedPlan;
- «Скасувати» закриває екран без `executeRun`.

**Оновлені наявні** (slice-шлях UI → двофазний контракт `proposeRun`/`executeRun`):
`dp4-ui.test.jsx`, `dp4-add-as-is.test.jsx` (двері нарізки), `dp4-ui-triage-whole-volume.test.jsx`,
`dp4-ui-executor-threw.test.jsx`. Add_as_is/image-merge тести — без змін, зелені.

**Виправлено (A7.1 хвіст):** 2 expectation у `dp-two-phase.test.js` — персистована
назва документа має суфікс `.pdf` (поведінка `splitDocumentsV3` незмінна; тест
WIP-гілки був написаний без суфікса). Це не зміна коду, лише коректне очікування.

---

## 4. SAAS / BILLING / AI (за спекою §5-7)

- **SAAS:** нових сутностей нема; план/документи у tenant-scoped `cases[]`.
  `session` — per-user живий сеанс (RAM). Persist — через наявний
  `splitDocumentsV3`/`add_document` (tenantId/ownerId без змін).
- **BILLING:** A7.2 НЕ додає per-edit івентів (уникнення подвійного обліку, §6).
  Triage (Фаза 1) логується як раніше; persist (Фаза 2) — наявна інструментація.
  Жодного нового AI-виклику.
- **AI:** екран і правки — без AI (ручні). Дати (`triagePrompt date`) — A7.3, тут нема.

---

## 5. МЕЖІ (свідомо НЕ зроблено — поза A7.2)

- **Дати (A7.3):** `DatePicker`/тумблер «Проставити дати» — окремий етап.
- **Inline-правка у вʼювері (A7.4):** `onOpenDetails` лишається як є.
- **Перенарізка ВЖЕ збережених документів:** disabled-стаби «Розділити»/«Обʼєднати»
  у post-persist «Нарізці» (стара 1152-1153) **прибрано** і замінено підказкою
  «межі редагуються на екрані плану перед Виконати». Інтерактивна правка меж тепер
  живе ДО persist (новий екран) — це і є їх реалізація; перенарізка persisted-доків
  потребувала б повторного прогону (інший напрямок, не A7.2).
- **Довговічність плану через навігацію (#42):** `session` лише в RAM; вихід з
  вкладки = втрата плану (свідомо, §10; «Скасувати» чесно відкидає).
- **Неінтерактивні викликачі** (`ecitsInboxWatcher`, `addFiles`) — на композиції
  `run()`, не чіпано.

---

## 6. CLAUDE.md

Варіант C (мінімальне втручання): A7.2 не змінює канонічних контрактів схеми/
ACTIONS — лише UI поверх A7.1 backend. Оновлення опису DP-екрана — разом із A7.3/A7.4,
коли двофазний екран набуде фінального вигляду (дати + метадані-винятки).

---

## 7. ФАЙЛИ

**Нові:** `src/services/documentPipeline/slicePlanModel.js`,
`src/components/DocumentProcessorV2/DpSlicePlanEditor.jsx`,
`src/components/DocumentProcessorV2/SlicePagePreview.jsx`,
`tests/unit/slicePlanModel.test.js`, `tests/integration/dp-a7-2-edit-screen.test.jsx`.

**Змінені:** `src/contexts/DocumentPipelineContext.jsx` (+proposeRun/executeRun),
`src/components/DocumentProcessorV2/index.jsx` (двофазний slice flow + render екрана),
`src/components/DocumentProcessorV2/styles.css` (.dp-slice-editor),
4 оновлені slice-UI тести + 1 фікс expectation A7.1.
