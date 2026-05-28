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

### 4.7 Які компоненти ймовірно додаватимуться в майбутньому

Корінь `src/` після Фази 5 має готову форму під SaaS-розгортання:

#### Папка `components/` — додаткові верхньорівневі модулі

| Компонент | Файл | Тригер |
|---|---|---|
| `TenantSwitcher.jsx` | components/TenantSwitcher/ | Multi-user Activation — перемикання організацій |
| `UserMenu.jsx` | components/UserMenu/ | Multi-user — аватар, профіль, вихід |
| `NotificationCenter.jsx` | components/NotificationCenter/ | дедлайни що наближаються, нові засідання |
| `GlobalSearch.jsx` | components/GlobalSearch/ | універсальний пошук справ/нотаток/документів |
| `KeyboardShortcuts.jsx` | components/KeyboardShortcuts/ | overlay списку гарячих клавіш |
| `VoiceCommandPanel.jsx` | components/VoiceCommandPanel/ | глобальна голосова команда (AI-first) |
| `OnboardingTour.jsx` | components/OnboardingTour/ | walkthrough при першому вході |

#### Папка `services/` — нові сервіси інфраструктури

| Сервіс | Файл | Тригер |
|---|---|---|
| `notificationService.js` | services/ | Notification Center потребує підписки на події |
| `voiceCommandService.js` | services/ | глобальна обробка голосових команд (Web Speech API) |
| `searchIndexService.js` | services/ | повнотекстовий індекс для GlobalSearch |
| `aiProviderRouter.js` | services/ai/ | AI Provider Abstraction (Anthropic / OpenAI / Grok) |
| `telegramBotBridge.js` | services/ | Telegram бот через спільний actionsRegistry |

#### Папка `hooks/` — кастомні React-хуки

| Хук | Файл | Тригер |
|---|---|---|
| `useTenant.js` | hooks/ | tenant-aware рендеринг |
| `useNotifications.js` | hooks/ | NotificationCenter |
| `useVoiceCommand.js` | hooks/ | глобальне голосове управління |
| `useKeyboardShortcuts.js` | hooks/ | реєстрація локальних shortcut'ів |
| `useEntitlements.js` | hooks/ | gating UI за тарифом |

#### Папка `data/` — seed-дані та фікстури

| Файл | Тригер |
|---|---|
| `tenantPresets.js` | пресети для різних типів tenants (solo/bureau/firm) |
| `roleTemplates.js` | дефолтні шаблони ролей |
| `demoMode.js` | демо-дані для нових юзерів без реальних справ |

**Принцип:** усі нові верхньорівневі модулі підключаються в `App.jsx`
як **рівноправні діти render-дерева**, не як вмонтований код. App.jsx
лишається оркестратором.

---

## 5. ImageMergePanel.jsx — 2822 → 14 файлів (Фаза 1 — детальний розгляд)

### 5.1 Що це за файл і що він робить

`src/components/CaseDossier/ImageMergePanel.jsx` — реалізує функціонал
**склейки кількох зображень у один PDF**. Адвокат бачить його коли в
CaseDossier → AddDocumentModal обирає кнопку «🖼 Склеїти зображення»
(на відміну від «📄 Додати файл» для одного файлу).

**Типовий сценарій:** адвокат сфотографував паспорт громадянина (4 фото —
обкладинка, реєстрація, прописка, тощо), або «з'їв» 8 сторінок постанови
у вигляді фото. Замість вантажити окремими файлами — склеює в одну PDF
з правильним порядком.

#### Контракт компонента (публічне API)

```jsx
<ImageMergePanel
  caseData={...}              // справа адвоката
  apiKey={...}                // ключ Claude API
  onSubmit={...}              // (file, mergeArtifacts) → коли готово
  onCancel={...}              // адвокат натиснув «Назад»
  onOpenDrivePicker={...}     // адвокат хоче додати з Drive
  onSingleFileRedirect={...}  // лише 1 файл — перекинути у single-file потік
  ref={...}                   // forwardRef + useImperativeHandle (методи назовні)
/>
```

#### Три фази UX

1. **`selecting`** — вибір файлів. Кнопки «Завантажити з пристрою» (device
   input multiple) і «Додати з Drive» (multi-select picker).
2. **`processing`** — AI pipeline. OCR → image sorting agent (визначає
   порядок 1-2-3-4) → orientation detection (через EXIF + Document AI) →
   edge detection (для crop proposals) → PDF assembly.
3. **`preview`** — grid з drag-and-drop, попап перегляду з pinch-zoom,
   ручна корекція повороту, обрізка країв, форма метаданих
   (категорія, автор, дата, назва).

### 5.2 Що містить — компонент за компонентом

**14 внутрішніх компонентів + 4 хелпери/константи**. Реальні розміри:

| # | Сутність | Рядки | Скільки | За що відповідає |
|---|---|---|---|---|
| — | імпорти, константи (CATEGORY_OPTIONS, AUTHOR_OPTIONS, MAX_IMAGES_WARN), `isImageFile` | 1-78 | 78 | заголовок файлу |
| 1 | `ImageMergePanel` (основний, forwardRef) | 79-880 | **802** | головна машина станів, useImperativeHandle назовні |
| — | `PHASES` (константа) | 872-880 | 9 | мапа фаз для прогресу |
| 2 | `ProcessingView` | 881-930 | 50 | сторінка-індикатор фази processing |
| 3 | `PreviewView` | 931-1431 | **501** | сторінка preview — оркестрація grid, popup, форми, рендеру |
| 4 | `SortableGrid` | 1432-1554 | 123 | drag-and-drop grid (@dnd-kit/sortable) для зміни порядку |
| 5 | `DndGrid` | 1555-1614 | 60 | обгортка над DndContext (touch + mouse) |
| 6 | `SortableItem` | 1615-1656 | 42 | окрема картка зображення у grid |
| 7 | `RenderItem` | 1657-1879 | 223 | рендер тіла картки (thumbnail + кнопки + warnings) |
| 8 | `Thumbnail` | 1880-2069 | 190 | мініатюра з підтримкою HEIC (lazy convert через heic2any) |
| 9 | `PreviewPopup` | 2070-2630 | **686** | повноекранний попап з pinch-zoom (react-zoom-pan-pinch), crop UI, manual rotation |
| 10 | `CropperHost` (експортується!) | 2631-2718 | 88 | хост cropper'а, окремий експорт для тестів |
| — | `rotateRectCW` (хелпер) | 2719-2744 | 26 | геометрія: поворот rect на 90° CW |
| — | `rotateRectCCW` (хелпер) | 2745-2755 | 11 | дзеркальна операція |
| 11 | `ContextMenu` | 2756-2788 | 33 | right-click menu (Переглянути / Повернути / Видалити) |
| 12 | `SingleFileWarning` | 2789-2822 | 33 | модалка «у вас один файл, ви впевнені?» |

#### Карта залежностей

```
ImageMergePanel (main)
 ├─ ProcessingView                   ← на фазі processing
 ├─ PreviewView                       ← на фазі preview, оркеструє:
 │   ├─ SortableGrid                  ← drag-and-drop grid
 │   │   └─ DndGrid                   ← DndContext wrapper
 │   │       └─ SortableItem          ← sortable картка
 │   │           └─ RenderItem        ← вміст картки
 │   │               ├─ Thumbnail     ← мініатюра (HEIC-aware)
 │   │               └─ ContextMenu   ← right-click
 │   ├─ PreviewPopup                  ← повноекранний перегляд
 │   │   └─ CropperHost               ← cropper UI
 │   │       ├─ rotateRectCW          ← геометрія
 │   │       └─ rotateRectCCW
 │   └─ SingleFileWarning             ← модалка попередження
```

Це **дерево**, не плутанина. Кожен компонент має чітких батьків, передає
props вниз, не лізе через замикання у state Main компонента. Структура
**уже добра** — просто всі гілки живуть в одному файлі.

### 5.3 Чому файл роздувся — історія шарів

Типове накопичення сценаріями за ~два місяці:

**Стартова точка** (TASK B базова версія): простий компонент склейки
~400-500 рядків. Все логічно жило в одному файлі.

**Шар 1 — Drag-and-drop.** Адвокату потрібно міняти порядок картинок.
Додано `SortableGrid` + `DndGrid` + `SortableItem` через `@dnd-kit/core`.
**+225 рядків.**

**Шар 2 — HEIC підтримка.** Айфон шле HEIC, браузер не вміє рендерити
нативно. Додано lazy-import `heic2any`, спеціальна логіка в `Thumbnail`.
**+190 рядків.**

**Шар 3 — Manual rotation.** Адвокат розвернув телефон, фото догори
ногами. Окрема `userRotation` Map (правило #11 — окрема від auto-detect).
**+85 рядків.**

**Шар 4 — Preview popup.** Пощипати-зумнути фото, побачити деталі.
Додано `PreviewPopup` з `react-zoom-pan-pinch`. **+686 рядків** — це
найбільший шматок!

**Шар 5 — Passive crop UX.** AI визначає межі документа на фото (edge
detection), показує bounding box. Адвокат бачить crop proposal — приймає
або корегує. Додано `cropProposals` Map, `CropperHost`, геометрію
поворотів. **+130 рядків.**

**Шар 6 — Single file warning.** Адвокат натиснув «Створити PDF» з одним
файлом — модалка пропонує перекинути в single-file flow. **+33 рядки.**

**Кореневі причини:**

1. **Близькість контексту.** Всі ці шари — про «зображення в PDF».
   Природно тримати разом.
2. **Інкрементальне додавання.** Кожен шар — окремий TASK, ніхто з тих
   TASK'ів сам по собі не вимагав «винеси все».
3. **Відсутність порогу.** Не було правила «коли файл переходить 1500
   рядків — перенос». Тому 5 шарів пройшли непомітно.

Це **природний процес**, не лінь і не недогляд. Без правила-сторожа
кожен великий файл проходить такий шлях.

### 5.4 Мокап до / після

**ДО:**

```
src/components/CaseDossier/
└── ImageMergePanel.jsx          (2822 рядків, 14 компонентів усередині)
```

**ПІСЛЯ (з ДНК-папками під майбутні розширення):**

```
src/components/CaseDossier/
└── ImageMergePanel/                ← папка
    ├── index.jsx                   (≈810) головний компонент + useImperativeHandle
    ├── PreviewView.jsx             (≈505) оркестратор фази preview
    ├── PreviewPopup.jsx            (≈690) повноекранний попап з pinch-zoom
    ├── RenderItem.jsx              (≈225) тіло картки в grid
    ├── Thumbnail.jsx               (≈195) мініатюра з HEIC-логікою
    ├── CropperHost.jsx             (≈95)  експортний — лишається експортним
    ├── ContextMenu.jsx             (≈40)
    ├── ProcessingView.jsx          (≈55)
    ├── SingleFileWarning.jsx       (≈40)
    ├── constants.js                (≈30)  CATEGORY_OPTIONS, AUTHOR_OPTIONS,
    │                                       MAX_IMAGES_WARN, PHASES, isImageFile
    ├── geometry.js                 (≈45)  rotateRectCW, rotateRectCCW
    ├── grid/                       ← підпапка drag-and-drop
    │   ├── SortableGrid.jsx        (≈125)
    │   ├── DndGrid.jsx             (≈65)
    │   └── SortableItem.jsx        (≈45)
    ├── tools/                      ← МАЙБУТНЄ (порожня поки)
    ├── annotations/                ← МАЙБУТНЄ (порожня поки)
    ├── ai/                         ← МАЙБУТНЄ (порожня поки)
    └── export/                     ← МАЙБУТНЄ (порожня поки)
```

**Сума:** 12 React-файлів + 2 модулі-хелпери. Найбільший
(`PreviewPopup.jsx`) — близько 690 рядків (на межі прийнятного, але
зчеплення zoom+crop логічне). Решта — у здоровому діапазоні 30-505.

#### Окремий нюанс: `CropperHost` уже експортується

Рядок 2631: `export function CropperHost(...)`. Це означає що
`tests/unit/cropperHost.test.jsx` уже імпортує його напряму. **При
виносі у власний файл імпорт у тесті оновлюється на новий шлях** — більше
нічого міняти не треба.

### 5.5 Що поділ дасть конкретно

**Зараз (вимірюється):**

- Один файл 2822 рядки в директорії CaseDossier
- 4 тести вже існують (`ImageMergePanel.test.jsx`, `cropperHost.test.jsx`,
  `imageMergeRenderer.test.js`, `multiImageToPdf.test.js`)
- Будь-яка зміна у будь-якому з 14 компонентів = зачіпає той самий файл
  = merge-конфлікт ймовірний

**Після (вимірюється):**

- 14 файлів, кожен ≤690 рядків
- Тести можуть точково тестувати окремі компоненти (наприклад unit-тест
  на `Thumbnail` з мок-HEIC-файлом)
- Зміна у `PreviewPopup` не зачіпає файл `Thumbnail` — паралельна робота
  можлива
- AI-контекст: щоб поправити баг у `Thumbnail`, треба читати ~195 рядків,
  не 2822
- Discoverability: «де живе DnD?» → `grid/` папка

**Чого НЕ зміниться:**

- Адвокат відкриває склейку — все працює ідентично. Жоден піксель UI не
  міняється.
- Bundle size — однаковий (Vite склеює)
- Тести — той самий набір, мінімальне оновлення імпортів

### 5.6 Як запобігти повторному роздуттю

**Правило, яке варто внести у `CLAUDE.md` (правило №12):**

```
№12 — Розмір файлу як межа

При додаванні нового внутрішнього компонента/хелпера у існуючий файл:

— Якщо новий блок >100 рядків — створювати окремий файл одразу
— Якщо файл після додавання перетне 800 рядків — створювати окремий
  файл одразу
— Якщо файл після додавання перетне 1500 рядків — обов'язковий міні-TASK
  розщеплення в тому ж PR

Виняток: registry-файли (actionsRegistry, migrationService) — для них
структура каталогу важливіша за розмір.
```

Це **правило-сторож** на кшталт правила #11. Воно перетворює рефлекс
«логічно близько → в той самий файл» на свідому паузу «а чи перетне
поріг?».

**Технічний enforcement (опціонально):** простий чек у CI
`scripts/check-file-sizes.js` що попереджає (не блокує) про файли понад
1500 рядків. Починати **без CI-enforcement** — бачимо ефект правила,
потім вирішуємо чи треба автоматика.

### 5.7 Які компоненти ймовірно додаватимуться в майбутньому

Правдоподібні наступні шари (фотозйомка з телефону, паспорти,
постанови — реальні сценарії адвоката):

#### Підпапка `tools/` — інструменти редагування

| Компонент | Файл | Тригер |
|---|---|---|
| `BrightnessContrastTool.jsx` | tools/ | адвокат фотографує погано освітлений документ |
| `PerspectiveCorrectionTool.jsx` | tools/ | фото столу під кутом, edge detection не справляється |
| `PageDeskewTool.jsx` | tools/ | скан з фотоапарата нерівно |
| `ColorPickerTool.jsx` | tools/ | вибір ч/б vs color для economy |

#### Підпапка `annotations/` — нанесення на зображення

| Компонент | Файл | Тригер |
|---|---|---|
| `AnnotationOverlay.jsx` | annotations/ | потреба нанесення підпису/печатки |
| `SignatureStamp.jsx` | annotations/ | вставка готового підпису адвоката |
| `TextWatermark.jsx` | annotations/ | водяний знак «копія вірна оригіналу» |

#### Підпапка `ai/` — AI-помічники

| Компонент | Файл | Тригер |
|---|---|---|
| `MultiPageDetector.jsx` | ai/ | AI визначає що 8 фото — це 2 документи по 4 стор. |
| `ScanQualityCheck.jsx` | ai/ | попередження «фото нечитабельне, переробити» |
| `PageReorderHints.jsx` | ai/ | image sorting agent невпевнений у порядку |
| `AutoCropSuggestion.jsx` | ai/ | альтернатива existing crop proposal |

#### Підпапка `export/` — експортні налаштування

| Компонент | Файл | Тригер |
|---|---|---|
| `ExportOptionsTool.jsx` | export/ | DPI, compression, color/grayscale |
| `PageSizePreset.jsx` | export/ | A4 / Letter / Legal вибір |
| `CompressionLevel.jsx` | export/ | економія місця на Drive |

**Принцип:** ці папки **створюються порожніми у TASK Фази 1** — як
ДНК-закладки. Кожен майбутній TASK додає компонент у відповідну папку
від народження. Жодного «потім винесемо» — структура каталогу одразу
сигналізує **куди** йде новий код.

### 5.8 Ризик і час

**Ризик: мінімальний.** Це фізичне переміщення з імпортами. Жодної зміни
логіки, жодної зміни сигнатур.

**Тести:** існуючі 4 файли тестів лишаються зеленими. Імпорти у
`cropperHost.test.jsx` оновлюються на новий шлях. Інші три не торкаються.

**Час:** орієнтовно **один вечір** з тестами і перевіркою на реальній
справі (склейка зображень паспорта).

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

### 6.6 Які компоненти ймовірно додаватимуться в майбутньому

#### Підпапка `tabs/` — нові вкладки досьє

| Вкладка | Файл | Тригер |
|---|---|---|
| `TimelineTab.jsx` | tabs/ | хронологічний вид усього що сталось у справі (hearings, deadlines, notes, documents) |
| `FinancesTab.jsx` | tabs/ | Billing UI v1 — деталізація `time_entries` для цієї справи |
| `StrategyTab.jsx` | tabs/ | довгострокова стратегія, гіпотези, тактика — окремо від notes |
| `ClientPortalTab.jsx` | tabs/ | CRM-зріз: що видно клієнту (`visibleToClient` фільтр) |
| `TeamTab.jsx` | tabs/ | Multi-user — управління командою справи (case.team[]) |
| `ECITSTab.jsx` | tabs/ | окрема вкладка з даними з ЄСІТС (parties, composition, syncMetrics) |

#### Підпапка `panels/` — допоміжні панелі (sidebar)

| Панель | Файл | Тригер |
|---|---|---|
| `VoiceCommandPanel.jsx` | panels/ | AI-first — глобальний голос для команд на справі |
| `QuickStatsSidebar.jsx` | panels/ | вузький sidebar з ключовими цифрами справи |
| `RelatedCasesPanel.jsx` | panels/ | пов'язані справи (той самий клієнт, той самий суддя) |
| `DeadlineSentinel.jsx` | panels/ | вертикальна шкала найближчих дедлайнів |

#### Підпапка `services/` — локальні сервіси досьє

| Сервіс | Файл | Тригер |
|---|---|---|
| `contextGenerator.js` | services/ | (вже у Фазі 4) формування case_context.md для AI |
| `caseAnalytics.js` | services/ | агрегації для FinancesTab і QuickStatsSidebar |
| `caseLinker.js` | services/ | алгоритм пошуку пов'язаних справ для RelatedCasesPanel |

#### Папка `modals/` (нова, за потребою)

| Модалка | Файл | Тригер |
|---|---|---|
| `ShareCaseModal.jsx` | modals/ | поширення доступу (external collaborator) |
| `MergeCasesModal.jsx` | modals/ | злиття дублікатів (ЄСІТС + ручна — одна справа) |
| `ArchiveModal.jsx` | modals/ | архівування з підтвердженням |

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

### 7.6 Які компоненти ймовірно додаватимуться в майбутньому

#### Підпапка `views/` — нові режими перегляду

| Вид | Файл | Тригер |
|---|---|---|
| `WeekView.jsx` | views/ | детальний тижневий вид (зараз тільки day + month) |
| `YearView.jsx` | views/ | загальний річний — для планування і статистики |
| `AgendaView.jsx` | views/ | список всіх засідань без візуальної сітки |
| `CourtroomView.jsx` | views/ | групування за судом, не за датою |

#### Підпапка `widgets/` — окремі віджети дашборду

| Віджет | Файл | Тригер |
|---|---|---|
| `ConflictsWidget.jsx` | widgets/ | окремий блок із колізіями розкладу |
| `DeadlineSentinel.jsx` | widgets/ | дзеркало DeadlineSentinel з CaseDossier на верхньому рівні |
| `BillingSummary.jsx` | widgets/ | Billing UI — годин/день, тиждень |
| `TodaysFocus.jsx` | widgets/ | AI-генероване «що зараз найважливіше» |
| `TravelMap.jsx` | widgets/ | мапа поточних виїздів |

#### Підпапка `helpers/` — нові утиліти

| Хелпер | Файл | Тригер |
|---|---|---|
| `recurringEvents.js` | helpers/ | повторювані події (зараз тільки одиничні) |
| `multiDayEvents.js` | helpers/ | події що тривають >1 дня (триденне слухання) |
| `travelOptimizer.js` | helpers/ | AI-помічник для розрахунку оптимального маршруту |

#### Папка `panels/` (нова, за потребою)

| Панель | Файл | Тригер |
|---|---|---|
| `FilterPanel.jsx` | panels/ | бічна панель фільтрів (case, court, type, status) |
| `SearchPanel.jsx` | panels/ | jump-to-date, пошук події |
| `NotificationsPanel.jsx` | panels/ | випадаюча панель з повідомленнями |

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

### 8.6 Які компоненти ймовірно додаватимуться в майбутньому

#### Папка `AddDocumentModal/` (верхній рівень)

| Компонент | Файл | Тригер |
|---|---|---|
| `BatchUploadProgress.jsx` | AddDocumentModal/ | прогрес при пакетному додаванні |
| `MetadataAutofill.jsx` | AddDocumentModal/ | AI-підказки полів на основі імені файлу/OCR |
| `DuplicateWarning.jsx` | AddDocumentModal/ | попередження «такий документ вже є» |

#### Підпапка `DrivePicker/` (всередині AddDocumentModal)

| Компонент | Файл | Тригер |
|---|---|---|
| `RecentsList.jsx` | DrivePicker/ | список нещодавніх папок Drive |
| `Favorites.jsx` | DrivePicker/ | улюблені папки адвоката |
| `DriveSearch.jsx` | DrivePicker/ | пошук по Drive (зараз тільки browse) |
| `SharedDrivesPanel.jsx` | DrivePicker/ | Shared Drives (тенант може мати корпоративний) |
| `ThumbnailPreview.jsx` | DrivePicker/ | прев'ю файлу перед вибором |

#### Розширення `SourceSwitcher`

| Джерело | Файл | Тригер |
|---|---|---|
| `TelegramSource.jsx` | DrivePicker/sources/ | Telegram бот вже синхронізує — show inbox |
| `EmailSource.jsx` | DrivePicker/sources/ | додавання з email вкладень |
| `ScannerSource.jsx` | DrivePicker/sources/ | прямий захват з камери (на десктопі через WebRTC) |

#### Папка `shared/` (можлива міграція)

Якщо при виносі побачимо що `DrivePicker` справді спільний з
`DocumentProcessorV2/DrivePicker` — створиться `components/UI/DrivePicker/`
як спільний UI-компонент. Тоді обидва місця імпортують його замість мати
свій. **Це окремий мікро-TASK**, не разом з винесенням.

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
