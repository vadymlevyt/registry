# Звіт — Lane B: UI-борги image editor (#33 / #36+#28 / #34-фото)

**Дата:** 2026-05-31
**Гілка:** `claude/lane-b-ui-debts-jCZmx`
**Бриф:** `docs/consultations/handoff_2026-05-31_laneB_ui_debts.md`
**План:** `docs/consultations/consultation_ui_debt_consolidation_plan.md`

Серіально, один відкритий DP, окремі коміти. Файли лише своєї смуги
(`DpImageMergeEditor.jsx`, `ImageMergePanel/`, `ImageEditor/`). `App.jsx`,
`DocumentProcessorV2/index.jsx`, `CaseDossier` Огляд, `contextGenerator.js` — не чіпано.

**Стан:** `npm test` зелений (1752), `npm run build` OK на кожному кроці. У `main` НЕ зводив.

---

## B1 — Винос решти спільних хелперів (#33)

**Коміт 1 (фаза 1, чисті функції).** Інлайн-копії в обох споживачах
(`ImageMergePanel/PreviewView`, `DpImageMergeEditor`, `grid/SortableGrid`)
замінено на імпорт спільних чистих функцій:

- `grid/displayItems.js` (+): `buildFlatPositions(displayItems)`,
  `countActiveDuplicateGroups(duplicateGroups, dismissedGroupIds)`.
- `services/imageDocument/cropState.js` (новий): `buildCropStateByIndex`,
  `countActiveCrop`, `buildUncertainSet`.

Свідомі зміни поведінки (консолідація, не регресія):
- **Банер «N груп дублікатів» у модалці** тепер виключає dismissed-групи
  (раніше сире `.length` лишалось стейл після «Це не дублікати»). Тепер збігається
  з кількістю намальованих жовтих рамок — як у DP.
- **`flatPositions` у DP** тепер над глобальним `displayItems` (нумерація `#N`
  йде візуальним порядком сітки, члени дублів поспіль), а не сирим `pageIndices`.
  Те саме джерело що модалка (`SortableGrid`). `GroupSection` отримує `displayItems`
  пропом (обчислюється раз у `DndOrchestrator`) — рендер і нумерація не розходяться.

**Коміт 2 (фаза 2, хук).** Найбільший дубль (~70 рядків ×2) винесено у
`components/ImageEditor/hooks/usePreviewUrls.js`. Обидва споживачі викликають
хук замість власних `useEffect`/`ref`/`state`. Канонічна поведінка = DP-версія
(краща): `cropProposals`/`userRotation` свідомо НЕ у deps; надійний unmount-cleanup
через `urlsRef` + чергу. Модалці це додатково усуває зайвий повторний прогін
(раніше мала `cropProposals` у deps) і потенційний leak активних URL. Прибрано
ручний reset previewUrls у `handleStartProcessing` (хук reрунить на зміну realFiles).

Тести: `tests/unit/displayItems.test.js` (+`buildFlatPositions`/`countActiveDuplicateGroups`),
`tests/unit/cropState.test.js` (новий), `tests/unit/usePreviewUrls.test.jsx` (новий, renderHook).

---

## B2 — Вільне перетягування між групами + порожня група як drop-ціль (#36/#28)

Раніше drop у DP працював лише НА фото; у порожню/нову групу нічого не
перетягувалось (`closestCenter` не таргетив групи без sortable-елементів).

- **`useDroppable` per `GroupSection`** на контейнер сітки
  (`g::<docId>::container`, уже зарезервований у `ItemIdDecode`). Уся область
  групи (вкл. порожню) — валідна drop-ціль; `over.id===container` →
  `handleDragEnd` додає у кінець групи.
- **Кастомний `collisionDetection`**: пріоритет конкретному фото/групі під
  курсором (reorder/вставка перед), fallback на контейнер коли курсор над
  порожнім місцем. Не ламає reorder, вмикає drop у порожню групу.
- **`DragOverlay`**: прев'ю одиниці що тягнеться (спільний `RenderItem` без
  sortable-обгорток) + підсвічування активної drop-цілі (інлайн-стиль — `dp-*`
  CSS у `DocumentProcessorV2/styles.css` поза смугою B).
- **Lifecycle порожніх груп** (щоб add-group був корисним): авто-видалення групи
  ТІЛЬКИ коли вона спорожніла внаслідок самої операції (source при drag; група
  що втратила останнє фото при delete/dup). Свідомо додані порожні drop-цілі
  лишаються (прибираються кнопкою-кошиком). Зачеплено `handleDragEnd`,
  `handleRemove`, `removeIndicesFromGroups`.
- Add-group лишився необмеженим.

Продуктовий результат: розділити набір фото на N документів, перетягнувши аркуші
в нову порожню групу.

Тести: `tests/integration/dp-image-merge-multidoc.test.js` (+ drop-on-empty-container,
розділення на N, виживання порожньої drop-цілі; оновлено mirror під новий filter),
`tests/unit/DpImageMergeEditorParity.test.jsx` (+ render add-group + кошик).

---

## B3 — Прогрес фото-обробки (фото-частина #34)

**Спільний компонент** `components/ImageEditor/ProcessingProgress.jsx` (правило #30,
не локальний дубль). Два варіанти однієї логіки: `variant="screen"` (spinner +
лейбл + лічильник + бар + stepper по фазах) і `variant="badge"` (компактний
неблокуючий поп-ап). Самодостатні стилі (`image-editor__progress*`) у спільному
`imageEditor.css`.

Споживачі (обидва в смузі B):
1. **Модалка `ProcessingView`** — делегує рендер спільному компоненту
   (screen + `PHASES` stepper). Власної розмітки прогресу більше не тримає.
2. **DP startup** — неблокуючий бейдж під час фонового аналізу країв
   (`detectDocumentEdges` по N фото): «Аналіз країв документів… N/M». Раніше цей
   крок не показував нічого (лише `console.log`).

Тест: `tests/unit/ProcessingProgress.test.jsx` (новий).

### Свідомо ЗА МЕЖАМИ смуги B (follow-up)

- **Прогрес `prepareImagesForMerge` + per-group `sortImageDocument`** живе у
  `DocumentProcessorV2/index.jsx` (поза смугою B — там лише `console.log`,
  «UI Зона 4 поки не отримує сигнал», tracking_debt). Важка обробка завершується
  ДО маунту `DpImageMergeEditor`, тому її індикатор належить екрану обробки в
  `index.jsx`. Спільний `ProcessingProgress` готовий до споживання — лишилось
  під'єднати його у `index.jsx` (тривіально: `onProgress(phase, done, total)`
  вже є). Це робить власник `index.jsx` (смуга C / координатор).
- **Контекст-частина #34 (`CaseDossier`)** — поза смугою B (перетин із Lane C),
  не робив (за брифом).

### Знахідка (не виправляв — не моя смуга)

У `CaseDossier/ImageMergePanel.css` рядки `.image-merge-panel__processing*` і
`.image-merge-panel__phase-step*` стали **мертвими** (розмітку винесено у
спільний `ProcessingProgress` з власними класами). Файл — поза смугою B
(`CaseDossier`, не тека `ImageMergePanel/`), тож не чіпав. Прибрати — окремий
крок власника файлу.

---

## DoD

- [x] B1 §0 перезаудит виконано; список §2 актуалізовано (виявлено й зафіксовано
      розбіжності `countActiveDuplicateGroups` модалка↔DP і `flatPositions` input).
- [x] Чисті хелпери Фази 1 + хук Фази 2 у спільному; обидва споживачі імпортують;
      інлайн-копії видалено (`grep`-доказ у комітах).
- [x] B2: порожня група — придатна drop-ціль; крос-груповий drag + reorder без
      регресій; add-group необмежений; DnD-тести (drop-on-empty) додані.
- [x] B3: спільний `ProcessingProgress`, два in-lane споживачі; index.jsx-частина
      документована як followup.
- [x] Юніт/інтеграційні тести додані; `npm test` зелений (1752); `npm run build` OK.
- [x] Лише файли смуги B; у `main` не зведено (чекає координатора).
