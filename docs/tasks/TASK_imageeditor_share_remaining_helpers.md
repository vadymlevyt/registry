# TASK — Винесення решти спільної логіки image-editor (модалка ↔ DP)

**Статус:** специфікація (відкладено; виконувати за тригером — див. нижче)
**Тип:** усунення дублювання (Rule of Three / правило #11) — продовження виносу `displayItems.js`
**Schema bump:** НЕ потрібен
**Борг:** `tracking_debt.md` #33 (конкретизація наскрізної вимоги #30)

---

## 0. ⚠️ ПЕРЕД ВИКОНАННЯМ — ПЕРЕАУДИТ (обов'язково)

Цей таск складено **2026-05-31** одразу після виносу `grid/displayItems.js`. До моменту
виконання код міг змінитись (нові фічі DP, ще один винос, рефактор). **Перш ніж писати код —
перезвір аудит:** для кожного пункту §2 наново порівняй модалку і DP, онови рядки/факти, викинь
пункти що вже винесені, додай нові дублі якщо з'явились. Якщо розбіжність стала виправданою —
познач і не чіпай. **Не виконуй наосліп за застарілим списком.**

Перед роботою: прочитати `CLAUDE.md`, `DEVELOPMENT_PHILOSOPHY.md` (правило «Спільний рендер UI»),
`tracking_debt.md` #30 і #33.

**Головне правило (як у попередньому виносі):** переносити логіку **дослівно** з робочого
джерела у спільний модуль, обидва споживачі **імпортують**, копії **видалити**. Нуль
переписування. `grep` доводить відсутність копій.

---

## 1. КОНТЕКСТ

Image-editor спільний у `src/components/ImageEditor/`. Винесено: групування дублів
(`grid/displayItems.js`), PDF-rebuild (`services/imageDocument/pdfRebuild.js`),
`prepareImagesForMerge`, `sortImageDocument`, `duplicateSelection`, картки
(`Thumbnail`/`RenderItem`/`PreviewPopup`/`ContextMenu`), сітка (`grid/SortableGrid`/`DndGrid`).

**Два споживачі:**
- Модалка: `CaseDossier/ImageMergePanel/index.jsx` + `ImageMergePanel/PreviewView.jsx`
- DP: `DocumentProcessorV2/DpImageMergeEditor.jsx`

Аудит 2026-05-31 (після виносу `displayItems`) знайшов ще кілька **дубльованих двома копіями**
шматків. Це не баги — функціонально однакові; ризик: зміниш в одному, забудеш у близнюку → DP і
модалка розходяться (той самий клас проблеми, що дав баг групування).

---

## 2. ЩО ВИНЕСТИ (перевірено; перезвірити перед роботою — §0)

### Фаза 1 — чисті функції (тривіально, низький ризик)

Винести у `src/services/imageDocument/` (або поряд із `displayItems.js`) як чисті функції +
юніт-тести. Логіка взята дослівно з робочих копій.

| Хелпер | Що робить | Копії (перевірити рядки) |
|--------|-----------|--------------------------|
| `buildCropStateByIndex(cropProposals, cropOverrides, cropDisabled, cropAppliedSet, processedBlobs)` → `Map<idx,'applied'\|'disabled'\|'active'\|'none'>` | стан обрізки кожного фото | `PreviewView.jsx:87` = `DpImageMergeEditor.jsx:610` |
| `countActiveCrop(cropStateByIndex)` → number | скільки фото з активною обрізкою (текст банера «Обрізку буде застосовано до N сторінок») | `PreviewView.jsx:106` = `DpImageMergeEditor.jsx:627` |
| `buildFlatPositions(displayItems)` → `Map<idx,pos>` | нумерація карток «#N» | `SortableGrid.jsx:66` = `DpImageMergeEditor.jsx:828` |
| `countActiveDuplicateGroups(duplicateGroups, dismissedGroupIds)` | лічильник активних груп дублів (банер) | `PreviewView.jsx` (через displayItems) ↔ `DpImageMergeEditor.jsx:634` |
| `buildUncertainSet(uncertainOrientationIndices)` → `Set` | фото з непевною орієнтацією (банер) | `PreviewView.jsx:153` = `DpImageMergeEditor.jsx:639` |

Обидва споживачі замінюють інлайн-обчислення на виклики цих функцій у тих самих `useMemo`
(залежності зберегти). Поведінка не змінюється.

> Примітка: `buildDuplicateMembership` уже у `displayItems.js` — НЕ дублювати. Якщо нові хелпери
> логічно належать до групування — класти у `displayItems.js`; якщо до crop/банера — окремий
> модуль (`cropState.js` / `alertState.js`). Не плодити файли без потреби.

### Фаза 2 — `previewUrls` (більший шматок, делікатніше — окремо)

Найбільший дубль (~70 рядків ×2): async-генерація прев'ю-blob після rotation/crop +
відкладений revoke старих URL (`previewUrlsToRevokeRef`).
- Копії: `DpImageMergeEditor.jsx:232-299` ≈ `ImageMergePanel/index.jsx:174-249`.
- Винести у хук `src/components/ImageEditor/hooks/usePreviewUrls.js`
  (`usePreviewUrls(normalizedFiles, cropState, userRotation, ...)`), обидва споживачі викликають.
- Це хук з ефектами/ref-ами — **робити окремо від Фази 1**, після ретельного порівняння (можливі
  дрібні відмінності в залежностях ефекту/cleanup). Якщо відмінності суттєві — спершу звести
  поведінку, тоді виносити.

---

## 3. ЩО НЕ ЧІПАТИ (виправдана розбіжність)

- **Крос-груповий DnD у DP** (`handleDragEnd`, `ItemIdEncode/Decode`, мульти-`SortableContext`) —
  DP має N документів-груп із drag між ними; модалка одно-контейнерна. Інший контекст, не дубль.
  (Див. також `tracking_debt.md` #28 — окремий UX-борг drop-on-container.)
- **Popup / context-menu стан** — локальний view-only UI, виносити дорожче за користь.
- **Горизонталь/вертикаль розкладки рамки дублів** — свідомо прийнята розбіжність (керується
  спільним `imageEditor.css` через ширину клітинки; не код DP). Якщо колись фіксувати напрямок —
  один рядок у спільному `dup-group-body`.

---

## 4. ТЕСТИ

- Юніт на кожну чисту функцію Фази 1 (`tests/unit/`) — ключове: однаковий вхід → однаковий вихід,
  edge-кейси (порожньо, всі applied/disabled, дублі/без).
- Фаза 2: оновити/додати тест, що previewUrls-хук дає той самий результат для обох споживачів.
- Регресія: наявні тести модалки і DP (`dp-image-merge-multidoc`, `dpDuplicateFrameLayout`,
  `displayItems`) лишаються зелені. `npm test` повністю зелений.

## 5. DoD

- [ ] §0 перезаудит виконано, список §2 актуалізовано перед кодом.
- [ ] Чисті хелпери Фази 1 у спільному; обидва споживачі імпортують; інлайн-копії видалені.
- [ ] `grep` доводить відсутність дубльованих обчислень (cropState/flatPositions/counts) у DP і модалці.
- [ ] (Фаза 2, якщо в обсязі) `usePreviewUrls` спільний; обидві копії видалені.
- [ ] Юніт-тести додані; `npm test` зелений; `npm run build` OK.

## 6. SAAS / BILLING

Без впливу — чистий клієнтський рендер/підрахунки. Жодних ACTIONS, полів, схеми, AI-викликів.
