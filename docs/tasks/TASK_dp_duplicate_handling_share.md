# TASK — Дублікати в image-editor: ОДНА спільна логіка для модалки і DP

**Статус:** специфікація (готова до окремої сесії)
**Тип:** усунення дублювання логіки (Rule of Three / правило #11) — НЕ нова фіча
**Schema bump:** НЕ потрібен

---

## 0. ОБОВ'ЯЗКОВО ПЕРЕД РОБОТОЮ

1. Прочитати `CLAUDE.md` і `DEVELOPMENT_PHILOSOPHY.md`.
2. **Правило цього TASK (головне):** заборонено писати в DP **будь-яку власну** логіку обробки
   дублікатів. Дозволено ТІЛЬКИ викликати спільні функції/компоненти. Якщо здається, що «у DP
   трохи інакше» — це сигнал, що абстракція неповна: доопрацюй спільну, а не форкай у DP.

---

## 1. КОРІНЬ ПРОБЛЕМИ

Image-editor винесено у спільне `src/components/ImageEditor/` (Thumbnail, RenderItem,
PreviewPopup, grid/SortableGrid, grid/DndGrid, imageEditor.css). Модалка
(`CaseDossier/ImageMergePanel/`) це використовує. **DP (`DocumentProcessorV2/DpImageMergeEditor.jsx`)
— переписав обробку дублів власноруч** замість використання спільного:

| Логіка | Модалка (єдине джерело істини) | DP (НЕЛЕГАЛЬНА копія — видалити) |
|--------|-------------------------------|----------------------------------|
| membership origIdx→{groupId,recommended,reason,groupIndices} | `PreviewView.jsx:119-134` | `DpImageMergeEditor.jsx:636-651` |
| групування у displayItems (збирає ВСІХ членів групи разом, незалежно від позиції) | `PreviewView.jsx:151-191` (`displayItems`) | `DpImageMergeEditor.jsx:61-85` (`buildDuplicateSegments` — **adjacency-only, баг**) |
| flatten назад у плоскі індекси | `PreviewView.jsx:196-203` (`flattenItems`) | (немає / своє) |
| рендер картки-групи (рамка + «Це не дублікати») | спільний `RenderItem.jsx:57-112` (`type:'group'`) | власний `<div dupGroup>` `DpImageMergeEditor.jsx:1005-1029` |
| сітка + DnD групи як одного цілого | спільний `grid/SortableGrid.jsx` | власний `DpSortableItem` + `SortableContext` |

**Симптом на екрані:** `buildDuplicateSegments` рамкує лише **сусідні** плитки одного groupId.
Коли `sortImageDocument` повертає членів групи **не поруч** — кожен рендериться окремою плиткою з
бейджем, **без рамки** «Дублікати (N)» і без кнопки «Це не дублікати». Модалчин `displayItems`
стягує всіх членів групи в одну рамку незалежно від позиції — тому в модалці правильно.

Спільне для вибору видалення вже є і використовується обома: `selectRecommendedDuplicateRemovals`
(`services/imageDocument/duplicateSelection.js`). Решту групувальної логіки — теж зробити спільною.

---

## 2. РІШЕННЯ — ВИНЕСТИ ГРУПУВАННЯ У СПІЛЬНИЙ МОДУЛЬ

### 2.1. Новий спільний модуль (чисті функції, без React)

`src/components/ImageEditor/grid/displayItems.js` (поряд зі `SortableGrid.jsx`):

```js
// Єдине джерело істини групування дублів для image-editor (модалка + DP).
// duplicateGroups: Array<{ group: number[], recommended: number, reason: string }>
// dismissedGroupIds: Set<number> (порядковий індекс групи в duplicateGroups)

export function buildDuplicateMembership(duplicateGroups, dismissedGroupIds) { /* як PreviewView:119-134 */ }

export function buildDisplayItems(orderedIndices, duplicateGroups, dismissedGroupIds) { /* як PreviewView:151-191 */ }

export function flattenDisplayItems(items) { /* як PreviewView:196-203 */ }
```

Логіку взяти **дослівно** з `PreviewView.jsx` (вона робоча) — це перенесення, не переписування.
Семантика збережена: дублікати завжди разом, члени всередині сортуються за origIdx
(детерміновано), single-item для решти.

### 2.2. Модалка — замінити інлайн-копії на імпорт (поведінка НЕ змінюється)

У `PreviewView.jsx`: `duplicateMembership`/`displayItems`/`flattenItems` → загорнути виклики
спільних `buildDuplicateMembership`/`buildDisplayItems`/`flattenDisplayItems` у ті ж `useMemo`/
`useCallback` (щоб залежності й мемоізація лишились). Джерело груп у модалці —
`pipelineResult.sortResult.duplicates`. Нічого більше не чіпати.

### 2.3. DP — ВИДАЛИТИ власну логіку, узяти спільну

У `DpImageMergeEditor.jsx`:
1. **Видалити** `buildDuplicateSegments` (61-85) повністю.
2. **Видалити** інлайн `duplicateMembership` (636-651) → замінити на `buildDuplicateMembership(initialDuplicates, dismissedDuplicateGroupIds)`.
3. Для кожної групи-документа будувати `displayItems` через **спільний**
   `buildDisplayItems(group.pageIndices, initialDuplicates, dismissedDuplicateGroupIds)`.
4. **Видалити** власний `<div dupGroup>` рендер (1005-1029). Картку-групу і single рендерити через
   **спільний** `RenderItem` (`type:'group'` дає рамку + заголовок + «Це не дублікати»).
5. Хендлери `handleKeepRecommendedDuplicate` / `handleKeepAllRecommendedDuplicates` /
   `handleDismissDuplicateGroup` лишаються в DP як тонкі обгортки, але тіло вибору видалень —
   ТІЛЬКИ через `selectRecommendedDuplicateRemovals` (вже так: 469). Жодної своєї логіки вибору.

### 2.4. DnD — зберегти крос-групове перетягування, але одиниця = displayItem

DP відрізняється від модалки тим, що має **кілька документів-груп** і дозволяє тягати фото
**між** документами (один спільний `DndContext`). Це лишається. Але сортовані одиниці в межах
сітки одного документа стають **displayItems** (single АБО group), а не плоскі фото:
- single → sortable за id фото (як зараз),
- group → **один** sortable-юніт за id групи; усередині — члени через `RenderItem type:'group'`,
  які НЕ сортуються поодинці (дублі лишаються разом — той самий інваріант, що `SortableGrid`
  коментує: «Адвокат не може перетягти один член групи окремо»).

**Ідеальний кінцевий стан (зробити, якщо виходить чисто):** DP per-документ використовує спільний
`SortableGrid` напряму, а крос-груповий drag лишається на рівні батьківського `DndContext`. Якщо
крос-групова механіка робить пряме використання `SortableGrid` надто інвазивним — **мінімум**:
DP будує `displayItems` спільною функцією і рендерить кожен елемент спільним `RenderItem`
(нуль власного групування/рамки). Що з цих двох — на розсуд виконавця за критерієм «найменше
коду в DP, нуль дубльованої логіки». **buildDuplicateSegments і власний dupGroup-div зникають у
будь-якому разі.**

### 2.5. Перевірка повноти перенесення (анти-форк)

Після змін у `DpImageMergeEditor.jsx` НЕ має лишитись: власної функції розкладу дублів на
сегменти; власного обчислення membership; власного JSX рамки-групи; будь-якого `recommended`/
`groupId`-перебору поза спільними функціями. `grep -n "buildDuplicateSegments\|dup-group-header"
src/components/DocumentProcessorV2/` → порожньо (рамка тепер зі спільного RenderItem).

---

## 3. ТЕСТИ (перед коммітом `npm test` зелений)

### 3.1. Юніт — `tests/unit/displayItems.test.js` (новий)

Покрити спільні функції (це чисті функції — легко):
- members розкидані (НЕ суміжні) → один `group` item з усіма членами, відсортованими за origIdx
  (**саме цей кейс ловить баг buildDuplicateSegments**).
- dismissed група → НЕ групується (всі single).
- кілька груп + singles → правильний порядок, кожна група одним item на позиції першого члена.
- `flattenDisplayItems(buildDisplayItems(...))` повертає перестановку вхідних orderedIndices без
  втрат/дублів.
- `buildDuplicateMembership` виключає dismissed, мапить усіх членів.

### 3.2. Інтеграція / регресія

- Перевірити, що `tests/unit/dpDuplicateFrameLayout.test.js` і будь-які тести модалки лишаються
  зеленими (поведінка модалки не змінилась — лише джерело функцій).
- Якщо є рендер-тест DP — додати кейс «розкидані дублі → рендериться рамка-група» (raніше падав би).

---

## 4. SAAS / BILLING

Без впливу: чисто клієнтський рендер/групування. AI-виявлення дублів (`sortImageDocument`) і його
білінг (C7) НЕ чіпаються. Жодних нових ACTIONS, полів, схеми.

---

## 5. ЧОГО НЕ РОБИТИ

- НЕ переписувати логіку дублів у DP «по-своєму» (корінь усієї проблеми).
- НЕ міняти поведінку модалки (тільки джерело функцій: інлайн → спільний імпорт).
- НЕ чіпати `sortImageDocument` / детекцію дублів / per-group виклик у `DocumentProcessorV2/index.jsx:315-366`.
- НЕ ламати крос-груповий drag між документами в DP.
- НЕ дублювати CSS — рамка вже у спільному `imageEditor.css`.

---

## 6. КРИТЕРІЙ ГОТОВНОСТІ

- [ ] Спільний `grid/displayItems.js` створено; модалка і DP **обидва** імпортують його.
- [ ] У DP видалено `buildDuplicateSegments`, інлайн membership і власний dupGroup-JSX.
- [ ] Розкидані дублі в DP тепер у спільній рамці «Дублікати (N)» з кнопкою «Це не дублікати» (як модалка).
- [ ] `grep buildDuplicateSegments src/` → порожньо.
- [ ] Крос-груповий drag у DP працює як раніше.
- [ ] Нові юніт-тести + `npm test` зелений.
