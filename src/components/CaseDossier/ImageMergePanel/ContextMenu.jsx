// ── ImageMergePanel · ContextMenu ────────────────────────────────────────────
// Контекстне меню (desktop right-click) для thumbnail у grid.
// Адвокат правокліком на зображення → меню «Переглянути / Повернути / Видалити».

import { Eye, RotateCw, Trash2 } from 'lucide-react';
import { ICON_SIZE } from '../../UI/icons.js';

export function ContextMenu({ x, y, onView, onRotate, onRemove }) {
  // Корекція позиції щоб меню не вилазило за межі екрану.
  const adjX = typeof window !== 'undefined'
    ? Math.min(x, window.innerWidth - 220)
    : x;
  const adjY = typeof window !== 'undefined'
    ? Math.min(y, window.innerHeight - 200)
    : y;
  return (
    <div
      className="image-merge-panel__ctxmenu"
      style={{ left: adjX, top: adjY }}
      role="menu"
    >
      <button type="button" className="image-merge-panel__ctxmenu-item" onClick={onView}>
        <Eye size={ICON_SIZE.sm} /> Переглянути
      </button>
      <button type="button" className="image-merge-panel__ctxmenu-item" onClick={onRotate}>
        <RotateCw size={ICON_SIZE.sm} /> Повернути на 90°
      </button>
      <button
        type="button"
        className="image-merge-panel__ctxmenu-item image-merge-panel__ctxmenu-item--danger"
        onClick={onRemove}
      >
        <Trash2 size={ICON_SIZE.sm} /> Видалити
      </button>
    </div>
  );
}
