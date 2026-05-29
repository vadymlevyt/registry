# Баги виявлені під час TASK 1B (image_merge_unify) — post-merge

**Файл-журнал** побічних знахідок ПІД ЧАС реальної перевірки 1B адвокатом
(2026-05-29 вечір) — після push коду на GitHub Pages деплой. Сама фіча 1B
(N-доку склейка фото у DP) працює; нижче — точкові фікси на додачу.

---

## #1 — DP image-merge: обрізані фото показуються у СІТЦІ Зони 3 необрізаними

**Дата:** 2026-05-29 (вечір, після merge 1B)
**Тип:** UI-розсинхрон з еталоном (модалкою)
**Виявив:** адвокат при перевірці DP image-merge на реальній справі

### Симптом

У DP image-merge editor:
- Тап по фото → попап з `CropperHost` показує **обрізане** (як і має бути).
- Сама сітка Zone 3 (`SortableGrid` thumbnail'и) — фото **необрізане**
  (показує сирий оригінал, не результат crop'у).

Модалка «🖼 Склеїти зображення» (CaseDossier AddDocumentModal) — обидва місця
показують обрізане ідентично.

### Корінь

`src/components/DocumentProcessorV2/DpImageMergeEditor.jsx` передавав у
`RenderItem` ланцюг `previewUrls={null}` (DpSortableItem інтерполював `null`
як literal). Сітка показувала лише сирий `URL.createObjectURL` з оригіналу.
Попап показував crop НАЖИВО через `CropperHost` (свій рендер).

Модалка робить **previewUrls Map** через `useEffect` + `computeRenderedBlob`
(`src/components/CaseDossier/ImageMergePanel/index.jsx` рядки 173-252):
для фото з real transformation (auto-orientation != 0 OR processedBlob OR
applied crop) генерує baked blob, кладе URL у Map, передає сітці. DP цього
не робив.

### Фікс (точно як модалка — eталон)

`src/components/DocumentProcessorV2/DpImageMergeEditor.jsx`:

1. Новий стан `previewUrls` (Map) + `previewUrlsToRevokeRef`.
2. Новий `useEffect` (deps: cropOverrides, cropProposals, cropDisabled,
   cropAppliedSet, processedBlobs, normalizedFiles, detectedOrientations —
   **userRotation НЕ у deps**, інакше CSS-анімація ламається):
   - Target set: idx де `autoDeg != 0` OR `hasProc` OR `hasAppliedCrop &&
     !cropDisabled`.
   - Lazy import `imageRenderer.computeRenderedBlob`.
   - Виклик з прапорами `{ applyUserRotation: false, applyCrop: true,
     includeProposalRect: false }` — той самий patern що модалка.
   - Atomic `setPreviewUrls(newMap)`; старі URL у delayed-revoke черзі (1s).
3. Проп `previewUrls` прокинуто через `DndOrchestrator` → `GroupSection` →
   `DpSortableItem` → `RenderItem`.

### Три джерела правди (правило #11)

Розшарування зачіпає важливу інваріантність — три рівні трансформації
накладаються в РІЗНИХ місцях:

1. **auto-orientation** — ЗАПІКАЄТЬСЯ у preview blob (`computeRenderedBlob`
   `applyUserRotation:false` + `applyCrop:true` все одно дає `totalDeg =
   autoDeg`).
2. **crop** — ЗАПІКАЄТЬСЯ у той самий preview blob (`applyCrop:true`).
3. **user-rotation** (↻ адвоката) — **НЕ** запікається. Йде CSS-трансформом
   зверху Thumbnail через проп `userRotation={cssRotationMap}`.

Перевіряли пліч-о-пліч з модалкою на тому самому фото — обрізка ідентична,
жодного подвійного crop'у, жодного подвійного rotation'у.

### Тести

`tests/unit/DpImageMergeEditor.test.jsx` (новий, 5 тестів):
- auto-orientation=0 і нема crop → `computeRenderedBlob` НЕ викликається.
- auto-orientation != 0 → виклик з прапорами `applyUserRotation:false`,
  `applyCrop:true`, `includeProposalRect:false`.
- 3 фото (90°, 0°, 270°) → виклик ТІЛЬКИ для idx 0 і 2 (унікальні idx).
- Контракт ctx — всі ключі стабільні (cropOverrides, cropApplied тощо).
- `computeRenderedBlob` повернув identity (raw file) → URL не створюється.

`npm test`: 1615 → **1620 passed** (+5), 121 файлів.
`npm run build`: success.

### Що НЕ зачеплено

- Модалка `ImageMergePanel` — не зачеплена (її previewUrls patern був
  еталоном; ми **дзеркалили** його у DP).
- Попап (CropperHost) — без змін (його обрізка наживо працює як раніше).
- `userRotation` шарується CSS-трансформом у Thumbnail — без змін.
- Решта DP flow (нарізка PDF / mix / skipPdfSlicing) — без змін.

### Зачеплені файли

- `src/components/DocumentProcessorV2/DpImageMergeEditor.jsx` — фікс.
- `tests/unit/DpImageMergeEditor.test.jsx` — новий тест-файл.
- `docs/bugs/bugs_found_during_image_merge_unify.md` — цей файл.

---
