// ── ImageEditor · grid · DndGrid ─────────────────────────────────────────────
// DndContext wrapper з sensor конфігурацією (PointerSensor + TouchSensor).
// Touch — delay 200ms tolerance 5px (тримай-щоб-перетягти). Mouse — distance 5px.
// onDragEnd: arrayMove у displayItems і onReorder з новим items array.

import { SortableItem } from './SortableItem.jsx';

export function DndGrid({
  dndReady, displayItems, thumbUrls, previewUrls, warningsByIndex, duplicateMembership, userRotation, uncertainSet,
  cropStateByIndex, flatPositions,
  onReorder, onRemove, onRotate, onToggleCropDisabled, onOpenPopup, onContextMenu,
  onKeepRecommendedDuplicate, onDismissDuplicateGroup,
}) {
  const {
    DndContext, PointerSensor, TouchSensor, useSensor, useSensors, closestCenter,
    SortableContext, rectSortingStrategy, arrayMove,
  } = dndReady;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = displayItems.map((it) => it.id);
    const oldIndex = ids.indexOf(active.id);
    const newIndex = ids.indexOf(over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(displayItems, oldIndex, newIndex));
  }

  const sortableIds = displayItems.map((it) => it.id);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
        <div className="image-merge-panel__grid">
          {displayItems.map((item) => (
            <SortableItem
              key={item.id}
              dndReady={dndReady}
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
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
