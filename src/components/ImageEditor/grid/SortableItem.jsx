// ── ImageEditor · grid · SortableItem ────────────────────────────────────────
// Sortable одиниця для @dnd-kit/sortable. Обгортає RenderItem дет-залежним
// transform/transition і передає sortable listeners у RenderItem.
//
// Group items span more grid cells (group.indices.length × default cell width).

import { RenderItem } from '../RenderItem.jsx';

export function SortableItem({
  dndReady, item, thumbUrls, previewUrls, warningsByIndex, duplicateMembership, userRotation, uncertainSet,
  cropStateByIndex, flatPositions,
  onRemove, onRotate, onToggleCropDisabled, onOpenPopup, onContextMenu,
  onKeepRecommendedDuplicate, onDismissDuplicateGroup,
}) {
  const { useSortable, CSS } = dndReady;
  const sortable = useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    // Group items span more grid cells (group.indices.length × default cell width)
    gridColumn: item.type === 'group' ? `span ${Math.min(item.indices.length, 3)}` : undefined,
  };
  return (
    <RenderItem
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
      sortableRef={sortable.setNodeRef}
      sortableStyle={style}
      sortableListeners={sortable.listeners}
      sortableAttributes={sortable.attributes}
      isDragging={sortable.isDragging}
    />
  );
}
