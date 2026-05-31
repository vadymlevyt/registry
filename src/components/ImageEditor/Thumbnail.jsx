// ── ImageEditor · Thumbnail ──────────────────────────────────────────────────
// Мініатюра одного зображення у grid. Підтримує HEIC (через previewUrls що
// генеруються async у головному компоненті). Має:
//   - rotation badge (CSS transform для плавної анімації user rotation)
//   - cropApplied badge (зелена ✓ коли крн застосовано)
//   - duplicate badges (recommended / other)
//   - uncertain orientation warning
//   - crop badge (✂️ active/disabled) — toggle через onToggleCropDisabled
//   - context menu trigger (right-click)
//   - sortable drag handle (з @dnd-kit/sortable)
//   - кнопки під картинкою: переглянути / повернути / видалити
//   - "Залишити цей, видалити інші" — для рекомендованого дубліката

// Спільний CSS редактора зображень (grid/thumbnail/dup-group/popup/cropper/
// ctxmenu/банери). Імпорт ТУТ, у листі-компоненті, який статично тягнуть обидві
// в'юхи (модалка через grid/SortableGrid → RenderItem → Thumbnail; документ-
// процесор через DpImageMergeEditor → RenderItem → Thumbnail). Так спільний
// компонент володіє своїм стилем і рендериться ідентично, хто б його не тягнув —
// незалежно від того, чи відкривали модалку «Склеїти зображення».
import './imageEditor.css';

import {
  Image as ImageIcon,
  AlertTriangle,
  Check,
  Crop as CropIcon,
  Eye,
  RotateCw,
  X,
  GripVertical,
} from 'lucide-react';
import { ICON_SIZE } from '../UI/icons.js';

export function Thumbnail({
  origIdx, position, url, isProcessed = false, warning, duplicateInfo, rotation, isUncertain,
  cropState, inGroup = false,
  onRemove, onRotate, onToggleCropDisabled, onOpenPopup, onContextMenu, onKeepRecommendedDuplicate, sortable,
}) {
  const isDuplicateRecommended = duplicateInfo && duplicateInfo.recommended === origIdx;
  const isDuplicateOther = duplicateInfo && duplicateInfo.recommended !== origIdx;

  // cropApplied — єдине джерело правди для зеленого індикатора. cropState
  // === 'applied' встановлюється у cropStateByIndex коли cropAppliedSet.has
  // або processedBlobs.has — тобто адвокат явно тапнув ✓ Готово АБО straighten
  // canvas baked повний результат.
  const cropApplied = cropState === 'applied';
  const cls =
    'image-merge-panel__thumb' +
    (warning ? ' image-merge-panel__thumb--warn' : '') +
    (duplicateInfo && !inGroup ? ' image-merge-panel__thumb--dup' : '') +
    (isDuplicateRecommended ? ' image-merge-panel__thumb--dup-recommended' : '') +
    (isDuplicateOther && !inGroup ? ' image-merge-panel__thumb--dup-other' : '') +
    (inGroup ? ' image-merge-panel__thumb--in-group' : '') +
    (cropApplied ? ' image-merge-panel__thumb--processed' : '') +
    (sortable?.isDragging ? ' image-merge-panel__thumb--dragging' : '');

  const handleClick = (e) => {
    // Простий клік по картинці — теж відкриває попап (touch UX:
    // адвокат тапнув по картинці = хоче розглянути).
    // Drag-and-drop спрацьовує тільки якщо рух > activationConstraint distance.
    if (e.target.closest('button')) return; // клік по кнопці — окремий handler
    onOpenPopup();
  };

  return (
    <div
      className={cls}
      onContextMenu={onContextMenu}
    >
      <div className="image-merge-panel__thumb-image-wrap"
           {...(sortable?.listeners || {})}
           {...(sortable?.attributes || {})}
           role="button"
           tabIndex={0}
           onClick={handleClick}
           aria-label={`Сторінка ${position + 1}. Тап — переглянути, утримуйте для перетягування.`}
      >
        {url ? (
          <img
            src={url}
            alt={`Сторінка ${position + 1}`}
            className="image-merge-panel__thumb-img"
            // CSS rotation завжди застосовується для USER rotation — blob у
            // previewUrls запікається без неї (тільки auto + crop), щоб ↻
            // тапи давали плавну CSS transition анімацію 0.3s ease на transform.
            // Якщо є processedBlob — rotation = (userNow - baseUserRot), тобто
            // delta з моменту apply (бо processedBlob уже має user_at_apply
            // запечений). Без processedBlob — rotation = повний user рівень.
            style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
          />
        ) : (
          <div className="image-merge-panel__thumb-placeholder">
            <ImageIcon size={32} />
          </div>
        )}
        <span className="image-merge-panel__thumb-pos">#{position + 1}</span>
        {cropApplied && (
          <span className="image-merge-panel__thumb-processed-badge" title="Обрізку застосовано">
            <Check size={11} />
          </span>
        )}
        {isDuplicateRecommended && (
          <span className="image-merge-panel__thumb-dup-badge image-merge-panel__thumb-dup-badge--recommended">
            <Check size={12} />
            Рекомендую залишити
          </span>
        )}
        {isDuplicateOther && (
          <span className="image-merge-panel__thumb-dup-badge">
            Дублікат
          </span>
        )}
        {isUncertain && !duplicateInfo && (
          <span className="image-merge-panel__thumb-orient-badge" title="Орієнтація не визначена автоматично. Перевір і виправ кнопкою ↻ якщо треба.">
            <AlertTriangle size={10} /> Перевір орієнтацію
          </span>
        )}
        {/* ✂️ показуємо ТІЛЬКИ у станах 'active' (AI/manual frame не applied)
            і 'disabled'. При 'applied' замість ✂️ показується зелена ✓ вище.
            Один індикатор у певний момент — стан користувацький однозначний. */}
        {(cropState === 'active' || cropState === 'disabled') && (
          <button
            type="button"
            className={
              'image-merge-panel__thumb-crop-badge' +
              (cropState === 'disabled' ? ' image-merge-panel__thumb-crop-badge--disabled' : '')
            }
            onClick={(e) => {
              e.stopPropagation();
              onToggleCropDisabled && onToggleCropDisabled();
            }}
            title={
              cropState === 'active'
                ? 'Є рамка обрізки. Тап — вимкнути для цього фото.'
                : 'Обрізку вимкнено. Тап — увімкнути назад.'
            }
            aria-label="Перемкнути обрізку"
          >
            <CropIcon size={12} />
          </button>
        )}
        <span
          className="image-merge-panel__thumb-handle"
          aria-hidden="true"
          title="Перетягніть для зміни порядку"
        >
          <GripVertical size={16} />
        </span>
      </div>

      {/* Кнопки під картинкою — окремий рядок */}
      <div className="image-merge-panel__thumb-actions">
        <button
          type="button"
          className="image-merge-panel__thumb-action"
          onClick={onOpenPopup}
          title="Переглянути збільшено"
          aria-label="Переглянути"
        >
          <Eye size={ICON_SIZE.sm} />
        </button>
        <button
          type="button"
          className="image-merge-panel__thumb-action"
          onClick={onRotate}
          title="Повернути на 90°"
          aria-label="Повернути"
        >
          <RotateCw size={ICON_SIZE.sm} />
        </button>
        <button
          type="button"
          className="image-merge-panel__thumb-action image-merge-panel__thumb-action--danger"
          onClick={onRemove}
          title="Видалити"
          aria-label="Видалити"
        >
          <X size={ICON_SIZE.sm} />
        </button>
      </div>

      {duplicateInfo && isDuplicateRecommended && !inGroup && (
        <button
          type="button"
          className="image-merge-panel__thumb-keep-dup"
          onClick={() => onKeepRecommendedDuplicate(duplicateInfo.groupIndices, duplicateInfo.recommended)}
          title={duplicateInfo.reason}
        >
          Залишити цей, видалити інші
        </button>
      )}

      {warning && (
        <div className="image-merge-panel__thumb-warning" title={warning}>
          <AlertTriangle size={12} />
          <span>{warning}</span>
        </div>
      )}
    </div>
  );
}
