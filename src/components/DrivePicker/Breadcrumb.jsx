// ── DrivePicker · Breadcrumb (TASK 4 · етап B) ──────────────────────────────
// Шлях у Drive (підняття по parents[] обчислюється в index.jsx). Винос без змін.
import { ChevronRight } from 'lucide-react';
import { ICON_SIZE } from '../UI/icons.js';

export function Breadcrumb({ crumbs, onClick }) {
  if (!crumbs || crumbs.length === 0) return null;
  return (
    <div className="add-document-modal__drive-crumbs" aria-label="Шлях у Drive">
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={`${c.id}-${i}`} className="add-document-modal__drive-crumb-row">
            {i > 0 && (
              <ChevronRight
                size={ICON_SIZE.sm}
                className="add-document-modal__drive-crumb-sep"
              />
            )}
            <button
              type="button"
              className={
                'add-document-modal__drive-crumb' +
                (isLast ? ' add-document-modal__drive-crumb--current' : '')
              }
              onClick={() => onClick(c)}
              disabled={isLast}
              title={c.name}
            >
              {c.name}
            </button>
          </span>
        );
      })}
    </div>
  );
}
