// ── ImageMergePanel · RenderItem ─────────────────────────────────────────────
// Рендер тіла картки grid: одиничний Thumbnail АБО group card з кількома
// thumbnail'ами всередині (для групи дублікатів).
//
// Викликається з SortableItem (з dnd-kit sortable wrapper) і з SortableGrid
// loading state (без sortable wrappers — звичайний рендер).

import { X } from 'lucide-react';
import { Thumbnail } from './Thumbnail.jsx';

export function RenderItem({
  item, thumbUrls, previewUrls, warningsByIndex, duplicateMembership, userRotation, uncertainSet,
  cropStateByIndex, flatPositions,
  onRemove, onRotate, onToggleCropDisabled, onOpenPopup, onContextMenu,
  onKeepRecommendedDuplicate, onDismissDuplicateGroup,
  sortableRef, sortableStyle, sortableListeners, sortableAttributes, isDragging,
}) {
  if (item.type === 'single') {
    const origIdx = item.idx;
    const previewUrl = previewUrls?.get?.(origIdx);
    const displayUrl = previewUrl || thumbUrls.get(origIdx);
    // isProcessed — preview blob існує (auto-rotation АБО crop запечений).
    // Залишений тільки для CSS; зелена ✓ керується cropState === 'applied'
    // (одне джерело правди у cropStateByIndex).
    const isProcessed = !!previewUrl;
    return (
      <div ref={sortableRef} style={sortableStyle}>
        <Thumbnail
          origIdx={origIdx}
          position={flatPositions.get(origIdx) ?? 0}
          url={displayUrl}
          isProcessed={isProcessed}
          warning={warningsByIndex.get(origIdx) || null}
          duplicateInfo={duplicateMembership.get(origIdx) || null}
          rotation={userRotation.get(origIdx) || 0}
          isUncertain={uncertainSet?.has?.(origIdx) || false}
          cropState={cropStateByIndex?.get?.(origIdx) || 'none'}
          onRemove={() => onRemove(origIdx)}
          onRotate={() => onRotate(origIdx)}
          onToggleCropDisabled={() => onToggleCropDisabled(origIdx)}
          onOpenPopup={() => onOpenPopup(origIdx)}
          onContextMenu={(e) => onContextMenu(e, origIdx)}
          onKeepRecommendedDuplicate={onKeepRecommendedDuplicate}
          sortable={sortableListeners ? {
            listeners: sortableListeners,
            attributes: sortableAttributes,
            isDragging,
          } : null}
        />
      </div>
    );
  }

  // Group: rendering wrapper + multiple thumbnails inside (not individually
  // sortable — group drags as one unit).
  return (
    <div
      ref={sortableRef}
      style={sortableStyle}
      className={
        'image-merge-panel__dup-group' +
        (isDragging ? ' image-merge-panel__dup-group--dragging' : '')
      }
    >
      <div className="image-merge-panel__dup-group-header">
        <span className="image-merge-panel__dup-group-label">
          Дублікати ({item.indices.length}) — рекомендую залишити зелений
        </span>
        <button
          type="button"
          className="image-merge-panel__dup-group-dismiss"
          onClick={() => onDismissDuplicateGroup(item.gIdx)}
          title="Якщо це насправді різні сторінки — розгрупувати"
        >
          <X size={12} />
          Це не дублікати
        </button>
      </div>
      <div
        className="image-merge-panel__dup-group-body"
        {...(sortableListeners || {})}
        {...(sortableAttributes || {})}
      >
        {item.indices.map((origIdx) => {
          const previewUrl = previewUrls?.get?.(origIdx);
          return (
            <Thumbnail
              key={origIdx}
              origIdx={origIdx}
              position={flatPositions.get(origIdx) ?? 0}
              url={previewUrl || thumbUrls.get(origIdx)}
              isProcessed={!!previewUrl}
              warning={warningsByIndex.get(origIdx) || null}
              duplicateInfo={duplicateMembership.get(origIdx) || null}
              rotation={userRotation.get(origIdx) || 0}
              isUncertain={uncertainSet?.has?.(origIdx) || false}
              cropState={cropStateByIndex?.get?.(origIdx) || 'none'}
              onRemove={() => onRemove(origIdx)}
              onRotate={() => onRotate(origIdx)}
              onToggleCropDisabled={() => onToggleCropDisabled(origIdx)}
              onOpenPopup={() => onOpenPopup(origIdx)}
              onContextMenu={(e) => onContextMenu(e, origIdx)}
              onKeepRecommendedDuplicate={onKeepRecommendedDuplicate}
              sortable={null}
              inGroup={true}
            />
          );
        })}
      </div>
    </div>
  );
}
