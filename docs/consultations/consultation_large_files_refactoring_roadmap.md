# CONSULTATION: Roadmap рефакторингу великих файлів

**Версія:** 1.0
**Дата:** 28.05.2026
**Адресат:** адвокат + Claude Code для майбутніх TASK
**Тип:** консультація / план / orientation, **НЕ TASK**

---

## Преамбула

Цей документ — результат розмови про розмір файлів. Не вимога, не обіцянка,
не TASK-специфікація. Це **мапа** з мокапами цільових структур і природним
порядком робіт.

Жодних дат. Жодних зобов'язань. Жодних побічних змін логіки. Усі переноси —
**behavior-preserving** (поведінка системи ідентична до і після).

При активації будь-якої фази — окрема TASK-специфікація в `docs/tasks/` зі
звичайними секціями SAAS / BILLING / AI USAGE IMPLICATIONS (правило #10).
Цей документ описує **що і чому**, не **як саме крок за кроком**.

---

## 1. Поточний стан — заміри (2026-05-28)

Усе `src/` — **45 358 рядків** на ~250 файлів. Для legal-SPA з такою
функціональністю це нижній край середнього (нормально).

### Топ-10 великих файлів

| Файл | Рядки | Стан | Відро |
|---|---|---|---|
| `src/App.jsx` | 5357 | 🔴 Червона | 1 |
| `src/components/CaseDossier/index.jsx` | 3260 | 🔴 Червона | 1 |
| `src/components/CaseDossier/ImageMergePanel.jsx` | 2822 | 🔴 Червона | 1 |
| `src/components/Dashboard/index.jsx` | 2710 | 🔴 Червона | 1 |
| `src/services/actionsRegistry.js` | 1790 | 🟢 Правильна форма | 3 |
| `src/services/converter/pdfLibHtmlRenderer.js` | 1632 | 🟡 Запах | 2 |
| `src/components/CaseDossier/AddDocumentModal.jsx` | 1039 | 🟡 Запах | 1 |
| `src/services/migrationService.js` | 1005 | 🟡 Запах | 2 |
| `src/components/Notebook/index.jsx` | 800 | ✅ Прийнятно | — |
| `src/services/sortation/orientationCorrector.js` | 771 | ✅ Прийнятно | — |

Решта ~240 файлів — здорові (<500), переважно <300.

### Орієнтири «нормальності»

| Сутність | Здорово | Прийнятно | Запах | Червона лампа |
|---|---|---|---|---|
| Файл | <300 | 300-500 | 500-1000 | >1000 |
| React-компонент | <300 | 300-500 | 500-800 | >1000 |
| Функція | <30 | 30-60 | 60-100 | >100 |
| Entry-point | <300 | 300-600 | 600-1000 | >1500 |

---

## 2. Філософська рамка

### Що розмір НЕ ламає

- **Runtime швидкість** — нуль різниці (Vite склеює все в bundle)
- **Збої / краші / баги** — не корелюють з розміром
- **Користувацький досвід** — адвокат не побачить різниці
- **Пам'ять браузера** — однакова
- **Деплой / GitHub Pages** — однаково

### Що розмір кусає (метафора прокладки кабелів)

Система працює і так, і так. Але:

1. **Когнітивне навантаження** — людська пам'ять 7 елементів, AI-контекст
   обмежений. Великий файл = довше «зайти в контекст».
2. **Merge-конфлікти** — гілка `claude/*` + main одночасно на App.jsx
   майже гарантують конфлікт (правило #3 з CLAUDE.md).
3. **Тестування** — компонент усередині `App.jsx` майже неможливо
   ізолювати. У власному файлі — props-based unit-тест за 20 хв.
4. **Приховане зв'язування** — компоненти через замикання тихо
   тягнуться до сусіднього state. У окремому файлі з явними props
   спокуса фізично неможлива.
5. **Reviewability** — дифф у файлі на 500 рядків читається миттєво,
   у файлі на 5000 — «де я взагалі?».
6. **AI context window** — кожне читання `App.jsx` коштує ~25-30 тис.
   токенів. На складних TASK'ах це реальний ліміт.

**Висновок:** розмір — це **відсоткова ставка на майбутні зміни**, не
зараз. Зараз 0%, через рік 5%, через два — 15%. Накопичується.

---

## 3. Три відра — категоризація

### 🔴 Відро 1: чисті виноси, низький ризик, велика користь

1. `App.jsx` (5357)
2. `CaseDossier/index.jsx` (3260)
3. `ImageMergePanel.jsx` (2822)
4. `Dashboard/index.jsx` (2710)
5. `AddDocumentModal.jsx` (1039)

### 🟡 Відро 2: граничні — не зараз, за тригером

6. `pdfLibHtmlRenderer.js` (1632) — тригер: наступне суттєве редагування
7. `migrationService.js` (1005) — тригер: v10+ міграція

### 🟢 Відро 3: правильна форма, не чіпати

8. `actionsRegistry.js` (1790) — каталог 48 ACTIONS, ~37 рядків на дію

---

## 4. App.jsx — окремий план (5357 → ~1200)

### 4.1 Поточна структура за рядками

```
рядки 1-3506    → НЕ App() (3506 рядків чужих компонентів і даних)
рядки 3507-5357 → сам function App() (1850 рядків)
рядки 5357      → export default App
```

**Сам компонент App як React — це 1850 рядків.** Решта 3506 — інші
компоненти, які історично склали в той самий файл і ніхто не виносив.

### 4.2 Що сидить поза App() — детальний перелік

| Що | Рядки | Скільки | Куди |
|---|---|---|---|
| `QuickInput` (компонент) | 1073-2670 | **1597** | `components/QuickInput/index.jsx` |
| `AnalysisPanel` (компонент) | 3136-3384 | 248 | `components/AnalysisPanel/index.jsx` |
| `AddCaseForm` (компонент) | 2671-2902 | 231 | `components/Registry/AddCaseForm.jsx` |
| `Calendar` (компонент) | 386-490 | 104 | `components/Registry/Calendar.jsx` |
| `CaseCard` + `CaseModal` | 244-385 | 141 | `components/Registry/*.jsx` |
| `SONNET_CHAT_PROMPT` (рядок) | 562-786 | 224 | `services/agentPrompts.js` |
| `HAIKU_SYSTEM_PROMPT` (рядок) | 491-561 | 70 | `services/agentPrompts.js` |
| `buildSystemContext` | 940-1072 | 132 | `services/qiContext.js` |
| `findCaseForAction` + `SCENARIO_REGISTRY` + QI labels | 787-939 | 152 | `services/qiContext.js` |
| `normalizeCases` + хелпери | 3385-3506 | 121 | `utils/normalizeCases.js` |
| `INITIAL_CASES` (seed-дані) | 117-165 | 48 | `data/initialCases.js` |
| Імпорти + дрібні хелпери | 1-116, 166-243 | ~200 | лишається в App.jsx |

**Сума виносів:** ~3068 рядків.

### 4.3 Що в самому App() (1850 рядків) — далі винос

| Блок | Скільки | Куди |
|---|---|---|
| Drive hydration `EFFECT-A` + 9 міграційних кроків | ~500 | `services/registryHydration.js` + `hooks/useRegistryHydration.js` |
| Drive write `EFFECT-B` + debounce | ~200 | той самий hook |
| Splash 4-state UI + handlers | ~250 | `components/SplashScreen/index.jsx` |
| `useState` декларації (13+) | ~200 | лишається (це декларації, виносу мало) |
| `createActions(deps)` + extensionBridge + hashRouter wiring | ~100 | лишається |
| Render-дерево + props down | ~400 | лишається |
| Допоміжні effects | ~200 | лишається |

**Сума виносів з App():** ~950 рядків.

### 4.4 Мокап цільової структури App.jsx

```
src/
├── App.jsx                            (≈1200 рядків)
│   ├── imports
│   ├── useState декларації (cases, notes, calendar, tenants,
│   │   users, auditLog, aiUsage, timeEntries, masterTimer,
│   │   billingMeta, drive status, tab, ...)
│   ├── const { executeAction } = createActions({...})
│   ├── useRegistryHydration({setCases, setNotes, ...})
│   ├── extensionBridge.configure({...})
│   ├── hashRouter wiring
│   ├── допоміжні useEffect
│   └── return (
│         <SplashScreen ... /> або
│         <DocumentPipelineProvider executeAction={...}>
│           <Dashboard ... />
│           <CaseDossier ... />
│           <Notebook ... />
│           <CourtSync ... />
│           <QuickInput ... />
│           <AnalysisPanel ... />
│         </DocumentPipelineProvider>
│       )
│
├── components/
│   ├── QuickInput/
│   │   └── index.jsx                  (≈1600, винесено з App.jsx)
│   ├── AnalysisPanel/
│   │   └── index.jsx                  (≈250)
│   ├── Registry/                      ← НОВА папка
│   │   ├── CaseCard.jsx               (≈60)
│   │   ├── CaseModal.jsx              (≈85)
│   │   ├── Calendar.jsx               (≈105)
│   │   └── AddCaseForm.jsx            (≈230)
│   ├── SplashScreen/                  ← НОВА папка
│   │   └── index.jsx                  (≈250, з Drive UI + retry/restore)
│   └── … (решта)
│
├── services/
│   ├── agentPrompts.js                (≈300, винесено HAIKU+SONNET промпти)
│   ├── qiContext.js                   (≈285, buildSystemContext + findCaseForAction)
│   ├── registryHydration.js           (≈500, EFFECT-A + EFFECT-B логіка)
│   └── … (решта)
│
├── hooks/                             ← НОВА папка
│   └── useRegistryHydration.js        (≈250, тонкий хук над registryHydration)
│
├── utils/                             ← вже існує
│   └── normalizeCases.js              (≈120)
│
└── data/                              ← НОВА папка
    └── initialCases.js                (≈50, seed Брановський)
```

### 4.5 Арифметика

```
зараз:                          5357 рядків

винос чужих компонентів і даних:
  QuickInput               -1597
  AnalysisPanel             -248
  AddCaseForm               -231
  Calendar/Card/Modal       -245
  prompts                   -294
  qiContext                 -284
  normalizeCases            -121
  initialCases               -48
                            ───────
                            -3068
→ App.jsx                   ≈ 2300 рядків

винос hydration + splash з App():
  registryHydration         -700
  SplashScreen              -250
                            ───────
                             -950
→ App.jsx                   ≈ 1200-1350 рядків ✓
```

### 4.6 Що лишиться в App.jsx (і має лишитись)

- State management (13+ `useState` — це декларації, не логіка)
- `createActions(deps)` wiring — інстанціювання кожен render
- Маршрутизація (tab state + hashRouter подписка)
- Render-дерево (вкладки Dashboard/CaseDossier/Notebook/CourtSync)
- Universal Panel orchestration (QI/Agent toggle)
- Тонкі useEffect (toast cleanup, activityTracker booting)

Це — **власне оркестрація**, її не виносять.

---

## 5. ImageMergePanel.jsx — 2822 → ~600 + 12 файлів

### 5.1 Поточний стан

Файл **уже містить 14 внутрішніх компонентів** — структура є, просто всі
в одному файлі.

### 5.2 Мокап до / після

**ДО:**

```
src/components/CaseDossier/
└── ImageMergePanel.jsx          (2822 рядків, 14 компонентів усередині)
```

**ПІСЛЯ:**

```
src/components/CaseDossier/
└── ImageMergePanel/                ← папка
    ├── index.jsx                   (≈600, основний компонент з forwardRef)
    ├── ProcessingView.jsx          (≈50)
    ├── PreviewView.jsx             (≈500)
    ├── SortableGrid.jsx            (≈120)
    ├── DndGrid.jsx                 (≈60)
    ├── SortableItem.jsx            (≈40)
    ├── RenderItem.jsx              (≈220)
    ├── Thumbnail.jsx               (≈190)
    ├── PreviewPopup.jsx            (≈560)
    ├── CropperHost.jsx             (≈90)
    ├── ContextMenu.jsx             (≈30)
    ├── SingleFileWarning.jsx       (≈60)
    ├── constants.js                (≈30, CATEGORY_OPTIONS, AUTHOR_OPTIONS, MAX_IMAGES_WARN)
    └── geometry.js                 (≈50, rotateRectCW, rotateRectCCW)
```

### 5.3 Що вже добре і просто переноситься

- Кожен внутрішній компонент має чіткі межі (forwardRef, props)
- Жоден компонент не «руками» лізе у state іншого — все через props/callbacks
- `CATEGORY_OPTIONS` / `AUTHOR_OPTIONS` / `MAX_IMAGES_WARN` — константи на топі файлу

### 5.4 Ризик

**Мінімальний.** Це фізичне переміщення з імпортами. Жодної зміни логіки,
жодної зміни сигнатур. Існуючі тести (`tests/unit/ImageMergePanel.*`,
`tests/integration/multiImageToPdf.test.js`) лишаються зеленими.

### 5.5 Час

Орієнтовно **один вечір** з тестами і перевіркою на реальній справі
(склейка зображень паспорта).

---

## 6. CaseDossier/index.jsx — 3260 → ~900 + 7-9 файлів

### 6.1 Поточний стан

Два жирні `render`-функції:
- `renderOverview` (рядки 1874-2258, ~385)
- `renderMaterials` (рядки 2259-2705, ~447)

Плюс шапка, ECITS Banner, tabs, BODY layout, agent panel, drive storage,
context generator.

### 6.2 Мокап до / після

**ДО:**

```
src/components/CaseDossier/
├── index.jsx                       (3260)
├── AddDocumentModal.jsx            (1039)
├── ImageMergePanel.jsx             (2822)
├── ArchiveView.jsx
├── DeleteDocumentModal.jsx
└── *.css
```

**ПІСЛЯ:**

```
src/components/CaseDossier/
├── index.jsx                       (≈900, шапка + tabs + body shell + agent toggle)
├── tabs/                           ← НОВА папка
│   ├── OverviewTab.jsx             (≈400)
│   ├── MaterialsTab.jsx            (≈500)
│   ├── DocworkTab.jsx              (≈80, тонкий wrapper навколо DocumentProcessorV2)
│   ├── PositionTab.jsx             (≈100, плейсхолдер)
│   └── TemplatesTab.jsx            (≈100, плейсхолдер)
├── panels/                         ← НОВА папка
│   ├── AgentPanel.jsx              (≈300, чат з агентом досьє)
│   └── StorageSection.jsx          (≈250, Drive folder state machine)
├── services/                       ← локальні сервіси модуля
│   └── contextGenerator.js         (≈200, формування case_context.md, без React)
├── AddDocumentModal/               (винесене, див. розділ 8)
├── ImageMergePanel/                (винесене, див. розділ 5)
├── ArchiveView.jsx
├── DeleteDocumentModal.jsx
└── *.css
```

### 6.3 Стратегія виносу

`CaseDossier/index.jsx` має спільний state (`selectedDoc`, `editingNoteId`,
`agentMessages`, `folderStatus`, ...). При виносі вкладок треба чітко
визначити:

- **Лишається в `index.jsx`**: state машина вкладок, agent open/close,
  активна вкладка, props спускання
- **Передається у вкладку props**: caseData, documents, notes, executeAction,
  callbacks
- **Виноситься повністю**: чиста логіка (наприклад `contextGenerator.js`
  не залежить від React)

### 6.4 Ризик

**Середній.** Спільний state і функції що ходять між вкладками. Треба
точно визначити які функції лишаються в `index.jsx` (передаються як props),
а які чисті можна винести у `services/`.

### 6.5 Час

Орієнтовно **два-три дні** з тестами. Чотири окремі мікро-TASK'и (по одній
вкладці за раз) безпечніші ніж один великий.

---

## 7. Dashboard/index.jsx — 2710 → ~1100 + 6-7 файлів

### 7.1 Поточний стан

Внутрішні компоненти видно одразу:
- `CaseDropdown` (рядки 74-127, ~55)
- `TimePicker` (рядки 131-207, ~75) ⚠️ **ДУБЛЮЄ `UI/TimePicker.jsx`**
- `SlotsColumn` (рядки 245-613, ~370)
- `useSlotDrag` (рядки 614-679, ~65)

Плюс хелпери: `mergeNoteGroups`, `classifyDayHearings`, `findConflicts`,
`buildDashboardContext`, `parseTimeMin`, `addMinutesToTime`,
`calcTravelBlocks`, `buildMonthGrid`, `getWeekDays`, `formatDayTitle`.

Плюс константи: `MONTHS_UK`, `MONTHS_GEN`, `WDAYS`, `SLOTS`, `SLOT_H`,
`SLOT_MIN`, `EVENT_TYPE_LABEL`, `EVENT_TYPE_ICON`.

### 7.2 Мокап до / після

**ДО:**

```
src/components/Dashboard/
└── index.jsx                       (2710)
```

**ПІСЛЯ:**

```
src/components/Dashboard/
├── index.jsx                       (≈1100, головний компонент)
├── components/                     ← НОВА папка
│   ├── CaseDropdown.jsx            (≈55)
│   ├── SlotsColumn.jsx             (≈370)
│   └── (TimePicker → видалити, використати UI/TimePicker.jsx — див. 7.4)
├── hooks/                          ← НОВА папка
│   └── useSlotDrag.js              (≈65)
├── helpers/                        ← НОВА папка
│   ├── classifyDayHearings.js      (≈25)
│   ├── findConflicts.js            (≈25)
│   ├── buildDashboardContext.js    (≈175)
│   └── timeUtils.js                (≈60, parseTimeMin, addMinutesToTime, calcTravelBlocks)
└── constants.js                    (≈70, MONTHS_UK, WDAYS, SLOTS, EVENT_TYPE_*)
```

### 7.3 Прихована знахідка — дублікація TimePicker

У Dashboard/index.jsx рядки 131-207 — власний `TimePicker`. У
`src/components/UI/TimePicker.jsx` — теж TimePicker.

**Це класичне порушення правила #11** (однозначність): одне ім'я — два
сенси. Хтось додав другий, не побачивши перший. Тести цього не зловили
бо обидва працюють у своїх скоупах.

**При виносі цей баг випливає одразу і вирішується** — звести на один,
видалити Dashboard-локальний. Можлива маленька різниця у поведінці
(перевірити при виносі).

### 7.4 Ризик

**Низький.** Внутрішні компоненти структурно прості (props-based, без
лезіння в state Dashboard'у напряму через замикання). `useSlotDrag` —
кастомний хук, ізольований.

### 7.5 Час

Орієнтовно **один-два вечори** з тестами + окремий міні-TASK на
нормалізацію TimePicker (двох → одного).

---

## 8. AddDocumentModal.jsx — 1039 → ~330 + 5 файлів

### 8.1 Поточний стан

Сам компонент `AddDocumentModal` — рядки 79-397, ~320 (нормально).

Решта 720 рядків — це **DrivePicker всередині**:
- `DrivePickerSection` (398-724, ~330)
- `multiPlural` (725-733)
- `SourceSwitcher` (734-781, ~50)
- `Breadcrumb` (782-816, ~35)
- `filterForSelectionMode` (817-828)
- `DriveList` (829-894, ~65)
- `DriveListItem` (895-?, ~30)

### 8.2 Мокап до / після

**ДО:**

```
src/components/CaseDossier/
└── AddDocumentModal.jsx            (1039)
```

**ПІСЛЯ:**

```
src/components/CaseDossier/
└── AddDocumentModal/               ← папка
    ├── index.jsx                   (≈320, AddDocumentModal — без змін)
    ├── DrivePicker/                ← вкладена папка
    │   ├── index.jsx               (≈330, DrivePickerSection)
    │   ├── SourceSwitcher.jsx      (≈50)
    │   ├── Breadcrumb.jsx          (≈35)
    │   ├── DriveList.jsx           (≈65)
    │   └── DriveListItem.jsx       (≈30)
    └── helpers.js                  (≈30, multiPlural, filterForSelectionMode)
```

### 8.3 Бонус — потенційна спільність з DocumentProcessorV2/DrivePicker

`src/components/DocumentProcessorV2/DrivePicker.jsx` уже існує.

**При виносі стане видно:** чи це той самий патерн і можна звести у
`components/UI/DrivePicker/`, чи це два різних інструменти.

**Рішення про злиття — окремий мікро-TASK після виносу**, не разом. Не
лізти в обидва одночасно.

### 8.4 Ризик

**Низький.** Чисте розкладання по поличках.

### 8.5 Час

Орієнтовно **пів-день** з тестами.

---

## 9. pdfLibHtmlRenderer.js — 1632 (відкладено)

### 9.1 Чому не зараз

Це **власний HTML→PDF рендерер** з власним layout-engine. За природою
складна штука (фон-завантаження, обчислення позицій, гліфи).

Файл живе у вузькому конверторному шарі. Якщо ти ніколи його не редагуєш —
розмір нікого не муляє.

### 9.2 Природний розріз (коли активується)

```
src/services/converter/htmlToPdf/
├── index.js                        (≈400, основна функція + pipeline)
├── fonts.js                        (≈150, getFontUrl, loadAllFontBytes, FONT_FAMILY_MAP)
├── layoutEngine.js                 (≈700, обчислення позицій блоків)
├── renderInline.js                 (≈300, рендеринг тексту з форматуванням)
└── constants.js                    (≈80, A4_*, BASE_FONT_SIZE, HEADING_SCALE)
```

### 9.3 Тригер активації

При наступному суттєвому редагуванні цього файлу (наприклад додавання
підтримки таблиць у HTML→PDF, або зміна шрифтової підсистеми).

---

## 10. migrationService.js — 1005 (відкладено)

### 10.1 Чому не зараз

Це **реєстр 9 міграцій + хелпери**. Структурно — той самий патерн що
`actionsRegistry.js`: каталог.

Прецедент виносу вже є — `migrations/v4ToV5.js`. Інші міграції просто не
винесли бо ланцюг не настільки великий.

### 10.2 Природний розріз (коли активується)

```
src/services/migrations/
├── index.js                        (≈150, орекстратор + buildEmptyRegistry)
├── chain/
│   ├── v1-to-v4.js                 (≈400, базовий ланцюг)
│   ├── v6.js                       (≈70, founder flag)
│   ├── v6_5.js                     (≈120, addedBy cleanup)
│   ├── v7.js                       (≈150, ecits canonical)
│   ├── v8.js                       (≈50, captureMethod)
│   └── v9.js                       (≈70, case origin)
├── helpers.js                      (≈100, normalizeCaseId, migrateTenant, ensureTeamPermissions)
└── v4ToV5.js                       (уже існує)
```

### 10.3 Тригер активації

При додаванні v10+ міграції. Якщо ланцюг дійде до 12 версій і файл вибухне
до 1500 — точно час розщеплювати.

---

## 11. actionsRegistry.js — 1790 (не чіпати)

### 11.1 Чому це правильна форма

Він **буквально каталог**:

- 48 ACTIONS у одному `const ACTIONS = {...}`
- 6 PERMISSIONS-ролей у одному `const PERMISSIONS = {...}`
- Один `executeAction` з 6-кроковим pipeline:
  permissions → tenant → role → caseAccess → ACTIONS[action] → audit → billing
- `SYSTEM_ACTIONS_NO_BILLING` / `EDIT_ACTIONS_SOURCE_AWARE` як Set'и
- DI factory `createActions(deps)`

1790 рядків / 48 операцій = **~37 рядків на дію**. Це нормально.

### 11.2 Що буде якщо розрізати по доменах

Якщо розщепити на `caseActions.js` / `hearingActions.js` /
`noteActions.js` / ... — це **зруйнує SSoT для контракту системи**:

1. Втрата єдиної точки аудиту «що в системі можна зробити»
2. Розпорошення `executeAction` machinery (або дублювання, або тонкі
   обгортки що додають стрибки)
3. Розрив DI factory (одна → шість)

Це саме той випадок коли розмір — **фіча**, не баг.

### 11.3 Якщо колись виросте до 80+ ACTIONS

Секційний поділ **всередині** того ж файлу через `// ── СЕКЦІЯ ─` коментарі,
не розрив на файли. Або secondary file для зовсім нової області (як
`UI_ONLY_ACTIONS` Set винесено зверху).

---

## 12. Roadmap — порядок дій (з тригерами, без дат)

Кожен пункт — окремий behavior-preserving TASK з власною
TASK-специфікацією в `docs/tasks/`.

### Фаза 1 — найдешевший і найочевидніший

**TASK: ImageMergePanel split**

- Винос 14 внутрішніх компонентів у власні файли
- Жодної зміни логіки
- Тести зелені, реальна склейка зображень працює
- Ризик мінімальний
- Час: один вечір

**Тригер:** свідоме рішення адвоката почати рефакторинг.

### Фаза 2 — невеликий, виявляє знахідки

**TASK: AddDocumentModal/DrivePicker split**

- Винос DrivePicker у вкладену папку
- Виявляє можливу дублікацію з `DocumentProcessorV2/DrivePicker`
- Час: пів-день

**Тригер:** після фази 1.

### Фаза 3 — структурно простий, виявляє баг

**TASK: Dashboard split + TimePicker normalize**

- Винос внутрішніх компонентів, хелперів, констант
- **Окремий мікро-TASK:** нормалізація двох TimePicker'ів на один
- Час: один-два вечори + пів-день на TimePicker

**Тригер:** після фази 2.

### Фаза 4 — найскладніший, найбільший виграш

**TASK: CaseDossier split (4 мікро-TASK'и)**

- 4.1: винос `OverviewTab`
- 4.2: винос `MaterialsTab`
- 4.3: винос `AgentPanel`, `StorageSection`
- 4.4: винос `contextGenerator.js`
- Кожен мікро-TASK — behavior-preserving, окремий PR
- Час: два-три дні сумарно

**Тригер:** після фази 3. Не поспішати — спершу побачити що менші виноси
не мають побічних ефектів.

### Фаза 5 — окрема історія App.jsx (3-4 мікро-TASK'и)

**TASK A: винос компонентів і даних з App.jsx**

- 5A.1: винос `QuickInput`
- 5A.2: винос `AnalysisPanel`, `AddCaseForm`, `Registry/*` компонентів
- 5A.3: винос промптів у `services/agentPrompts.js`
- 5A.4: винос `qiContext.js`, `normalizeCases`, `INITIAL_CASES`

**TASK B: винос Drive hydration з самого App()**

- Винос `EFFECT-A` (9 міграцій) + `EFFECT-B` у `services/registryHydration.js`
- Створення `hooks/useRegistryHydration.js`
- Винос splash UI у `components/SplashScreen/`
- **Найризикованіше з усього roadmap** — race conditions, міграції, prапори
- Тестується на реальному Drive адвоката перед merge
- Час: один-два дні з ретельним тестуванням

**Тригер:** після фази 4. Або раніше якщо адвокат хоче App.jsx меншим
раніше CaseDossier (це OK — фази 5 і 4 незалежні одна від одної).

### Фаза 6 — за тригером (відкладено)

- `pdfLibHtmlRenderer` — при наступному суттєвому редагуванні
- `migrationService` — при v10+ міграції

### Фаза 7 — не робити

- `actionsRegistry` — правильна форма, не чіпати

---

## 13. Cross-cutting правила для всіх фаз

### 13.1 Behavior-preserving — головне

Кожен TASK з виносу:
- **НЕ змінює** поведінку системи
- **НЕ змінює** API компонентів (props лишаються ті самі)
- **НЕ змінює** UI (адвокат не побачить різниці)
- **НЕ додає** нових фіч
- **НЕ виправляє** «попутно» інші баги (це окремі TASK'и → tracking_debt)

Виняток: при виносі Dashboard виявиться дублікат TimePicker — це окремий
мікро-TASK з власною специфікацією, не «попутно».

### 13.2 Тести

- Усі існуючі тести **залишаються зеленими** після кожного PR
- Нові тести: **не обов'язково**, бо логіка не змінюється
- Якщо при виносі стало можливо просто додати юніт-тест для винесеного
  компонента — додай (це бонус, не вимога)

### 13.3 Узгодження з PHILOSOPHY

- Правило #11 (однозначність): кожен новий файл — одне ім'я, один сенс
- Принцип здорового організму: AUDIT → REVIEW → CLEANUP → AUDIT → РОЗШИРЕННЯ
- Принцип DELTA: 80% сьогодні > 100% через два тижні. Фаза 1
  (ImageMergePanel) дає миттєвий результат, фаза 5B (hydration) може
  чекати поки не дозріє.

### 13.4 Документація

Кожна завершена фаза — `docs/reports/report_*_split.md` з:
- Цифрами до/після (рядки, файли)
- Знайденими побічними знахідками → `tracking_debt.md` або
  `bugs_found_during_*.md`
- Підтвердженням що тести зелені

### 13.5 ARCHITECTURE_HISTORY.md

Великі фази (4, 5) — окремі секції в `ARCHITECTURE_HISTORY.md`. Дрібні
(1-3) — згадка у Покажчику без окремої секції.

---

## 14. Очікувані результати — стан src/ після всіх фаз

### 14.1 Розмір файлів

| Файл | До | Після | Зменшення |
|---|---|---|---|
| `App.jsx` | 5357 | ≈1200 | -77% |
| `CaseDossier/index.jsx` | 3260 | ≈900 | -72% |
| `ImageMergePanel.jsx` | 2822 | ≈600 (index) | -79% |
| `Dashboard/index.jsx` | 2710 | ≈1100 | -59% |
| `AddDocumentModal.jsx` | 1039 | ≈320 (index) | -69% |
| `actionsRegistry.js` | 1790 | 1790 | 0% (не чіпали) |
| `pdfLibHtmlRenderer.js` | 1632 | 1632 | 0% (відкладено) |
| `migrationService.js` | 1005 | 1005 | 0% (відкладено) |

### 14.2 Загальний обсяг src/

Орієнтовно **45 358 → 47 000-48 000 рядків**. Незначне зростання за рахунок
імпортів у нових файлах. Це нормально.

**Кількість файлів:** з ~250 → ~280-290.

### 14.3 Що НЕ зміниться

- Поведінка системи — ідентична
- UI адвоката — ідентичний
- Bundle size — приблизно той самий (Vite tree-shaking)
- Швидкість роботи — та сама
- Перелік ACTIONS, PERMISSIONS, схема даних — без змін
- schemaVersion — без bump'у (це не зміна даних)

### 14.4 Що зміниться

- **Cognitive load** при роботі з ядром системи — значно нижче
- **Merge-конфлікти** — рідше (більше дрібних файлів)
- **AI-context коштує** менше при більшості TASK'ів
- **Тестування** ізольованих частин — простіше
- **Discoverability** — «де живе X?» відповідається за 2 секунди

---

## 15. Що НЕ входить у обсяг

### 15.1 Не в roadmap

- Зміна логіки роботи будь-якого модуля
- Нові фічі (Document Processor v2, Canvas, Multi-user, Telegram)
- Зміна схеми даних або bump schemaVersion
- Зміна списку ACTIONS чи PERMISSIONS
- Зміна UI / дизайну
- Перехід на сервер (Node.js + Express) — це окрема архітектурна
  розмова, відкинуто у попередній консультації
- Перехід React Context або Redux — SSoT в App.jsx лишається

### 15.2 Не зачіпається

- `tests/` — лишаються зелені, не переписуються
- `docs/` — лишаються як є, додаються нові report'и
- `index.html`, `vite.config.js`, `package.json` — без змін (можливо
  додати alias'и для нових папок але не обов'язково)
- CI/CD — без змін

---

## 16. Альтернативні погляди

### 16.1 «Не робити нічого»

Валідна позиція. Система працює, адвокат продуктивний. Витрати часу на
рефакторинг можуть піти на нові модулі (DP v2, Canvas).

**Контраргумент:** кожен новий великий TASK у ядрі (наприклад Multi-user
Activation, який ходить через `executeAction` і `App.jsx state`) стане
дорожчим без рефакторингу. Це відсоткова ставка на майбутнє.

### 16.2 «Робити все одразу у одній сесії»

Невалідна. Великі рефактори в одному PR — типовий сценарій тихої
регресії (як було з Phase B в DP layout-leak, борг #20 у
`tracking_debt.md`).

**Правильно:** окремий PR за фазу, прогон тестів між ними, спостереження
адвокатом у реальній роботі.

### 16.3 «Робити тільки App.jsx»

Валідна позиція. App.jsx — найбільший біль. Якщо часу мало — робити
тільки фазу 5.

**Контраргумент:** фаза 1 (ImageMergePanel) дешева і дає швидкий результат
— ритм рефакторингу. Краще починати з малого.

---

## 17. Як активувати

1. Адвокат читає документ, погоджується / не погоджується / коригує
2. При погодженні — обирає першу фазу (рекомендовано: фаза 1)
3. Створюється окрема TASK-специфікація в `docs/tasks/`
4. TASK виконується behavior-preserving
5. PR в `main`, тести зелені, deploy
6. **Спостереження 3-7 днів** у реальній роботі
7. Якщо все ок — наступна фаза. Якщо щось сплило — фікс перед наступною.

**Без дедлайнів. Без поспіху. Без зобов'язань.**

---

## Кінцівка

Цей документ — мапа, не маршрут. Маршрут вибирає адвокат.

Сумарний обсяг робіт: **5-7 робочих днів Claude Code** розкиданих на
2-4 місяці спостережного періоду. Безперервна робота не потрібна — між
фазами система функціонує точно так як зараз.

Результат: ядро системи стає **читабельним за 10 хвилин нової сесії**,
а не за годину. Це не «продукт став кращим», це «обслуговування продукту
стало дешевшим». Чітко як прокладка кабелів у будівлі — користувач не
бачить, наступний електрик не плаче.

---

**Кінець CONSULTATION large_files_refactoring_roadmap v1.0**
