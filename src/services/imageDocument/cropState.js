// ── imageDocument · cropState ────────────────────────────────────────────────
// Чисті похідні UI-стани image-editor для рендера сітки (модалка + DP).
// Логіку перенесено ДОСЛІВНО з робочих копій (`ImageMergePanel/PreviewView.jsx`
// та `DocumentProcessorV2/DpImageMergeEditor.jsx`) — це перенесення, не
// переписування. Обидва споживачі імпортують саме ці функції; інлайн-копії
// видалено (борг #33 / правило #11).
//
// Без React: чисті функції від вхідних Map/Set → похідний Map/Set/число.

// origIdx → crop state ('none'|'active'|'disabled'|'applied').
//   'active'   = є rect (proposal/override) і не disabled, НЕ applied → сіра ✂️.
//   'disabled' = адвокат вимкнув → обрізка НЕ застосовується.
//   'applied'  = адвокат тапнув ✓ Готово АБО processedBlob (canvas-baked crop)
//                → зелена ✓. Джерела істини: cropAppliedSet (явний крок) і
//                processedBlobs (запечений crop).
// Ключі (origIdx) беруться лише з тих фото, де є rect або processedBlob — решта
// не з'являється у мапі (cropState за замовчуванням 'none' у RenderItem).
// (PreviewView:87-104 = DpImageMergeEditor:610-623)
export function buildCropStateByIndex(cropProposals, cropOverrides, cropDisabled, cropAppliedSet, processedBlobs) {
  const map = new Map();
  const allIds = new Set([
    ...(cropProposals?.keys?.() || []),
    ...(cropOverrides?.keys?.() || []),
    ...(processedBlobs?.keys?.() || []),
  ]);
  for (const idx of allIds) {
    if (cropAppliedSet?.has?.(idx) || processedBlobs?.has?.(idx)) {
      map.set(idx, 'applied');
    } else if (cropDisabled?.has?.(idx)) {
      map.set(idx, 'disabled');
    } else {
      map.set(idx, 'active');
    }
  }
  return map;
}

// Скільки фото з активною (не вимкненою, не застосованою) обрізкою — для тексту
// банера «Обрізку буде застосовано до N сторінок».
// (PreviewView:106-112 = DpImageMergeEditor:627-631)
export function countActiveCrop(cropStateByIndex) {
  let n = 0;
  for (const state of (cropStateByIndex?.values?.() || [])) {
    if (state === 'active') n++;
  }
  return n;
}

// Набір origIdx із непевною орієнтацією (aspect-евристика) — для банера
// «Орієнтація N не визначена» і для бейджа на thumbnail. Дефенсивно з [].
// (PreviewView:156 = DpImageMergeEditor:639)
export function buildUncertainSet(indices) {
  return new Set(indices || []);
}
