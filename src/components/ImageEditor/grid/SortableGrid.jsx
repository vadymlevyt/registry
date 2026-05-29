// ── ImageEditor · grid · SortableGrid ────────────────────────────────────────
// @dnd-kit lazy load + рендер DndGrid коли бібліотеки готові. Поки lazy load —
// показуємо звичайний grid (без drag handles, але thumbnail'и видимі).
//
// displayItems — list of { type: 'single'|'group', id, ... } (див. PreviewView).
// Sortable одиниці — items (не плоскі індекси). Drag-and-drop переміщує single
// АБО всю групу одним рухом. Адвокат не може перетягти один член групи
// окремо — це правильно бо дублікати мають лишатись поруч.

import { useState, useEffect, useCallback } from 'react';
import { RenderItem } from '../RenderItem.jsx';
import { DndGrid } from './DndGrid.jsx';

export function SortableGrid({
  displayItems,
  thumbUrls,
  previewUrls,
  warningsByIndex,
  duplicateMembership,
  userRotation,
  uncertainSet,
  cropStateByIndex,
  onReorder,
  onRemove,
  onRotate,
  onToggleCropDisabled,
  onOpenPopup,
  onContextMenu,
  onKeepRecommendedDuplicate,
  onDismissDuplicateGroup,
}) {
  const [dndReady, setDndReady] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [core, sortable, utilities] = await Promise.all([
          import('@dnd-kit/core'),
          import('@dnd-kit/sortable'),
          import('@dnd-kit/utilities'),
        ]);
        if (cancelled) return;
        setDndReady({
          DndContext: core.DndContext,
          PointerSensor: core.PointerSensor,
          TouchSensor: core.TouchSensor,
          useSensor: core.useSensor,
          useSensors: core.useSensors,
          closestCenter: core.closestCenter,
          SortableContext: sortable.SortableContext,
          rectSortingStrategy: sortable.rectSortingStrategy,
          arrayMove: sortable.arrayMove,
          useSortable: sortable.useSortable,
          CSS: utilities.CSS,
        });
      } catch (e) {
        console.warn('[ImageMergePanel] @dnd-kit lazy load failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Помічник: для одиночного thumbnail position у плоскому списку
  // (для відображення «#N» лейбла). Для group items — масив positions членів.
  const computeFlatPositions = useCallback(() => {
    const map = new Map();
    let pos = 0;
    for (const item of displayItems) {
      if (item.type === 'single') {
        map.set(item.idx, pos++);
      } else {
        for (const idx of item.indices) map.set(idx, pos++);
      }
    }
    return map;
  }, [displayItems]);
  const flatPositions = computeFlatPositions();

  if (!dndReady) {
    return (
      <div className="image-merge-panel__grid image-merge-panel__grid--loading">
        {displayItems.map((item) => (
          <RenderItem
            key={item.id}
            item={item}
            thumbUrls={thumbUrls}
            previewUrls={previewUrls}
            warningsByIndex={warningsByIndex}
            duplicateMembership={duplicateMembership}
            userRotation={userRotation}
            uncertainSet={uncertainSet}
            cropStateByIndex={cropStateByIndex}
            flatPositions={flatPositions}
            onRemove={onRemove}
            onRotate={onRotate}
            onToggleCropDisabled={onToggleCropDisabled}
            onOpenPopup={onOpenPopup}
            onContextMenu={onContextMenu}
            onKeepRecommendedDuplicate={onKeepRecommendedDuplicate}
            onDismissDuplicateGroup={onDismissDuplicateGroup}
            sortableRef={null}
            sortableStyle={null}
            sortableListeners={null}
            sortableAttributes={null}
            isDragging={false}
          />
        ))}
      </div>
    );
  }

  return (
    <DndGrid
      dndReady={dndReady}
      displayItems={displayItems}
      thumbUrls={thumbUrls}
      previewUrls={previewUrls}
      warningsByIndex={warningsByIndex}
      duplicateMembership={duplicateMembership}
      userRotation={userRotation}
      uncertainSet={uncertainSet}
      cropStateByIndex={cropStateByIndex}
      flatPositions={flatPositions}
      onReorder={onReorder}
      onRemove={onRemove}
      onRotate={onRotate}
      onToggleCropDisabled={onToggleCropDisabled}
      onOpenPopup={onOpenPopup}
      onContextMenu={onContextMenu}
      onKeepRecommendedDuplicate={onKeepRecommendedDuplicate}
      onDismissDuplicateGroup={onDismissDuplicateGroup}
    />
  );
}
