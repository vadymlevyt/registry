// ── ImageMergePanel · SingleFileWarning ──────────────────────────────────────
// Модалка-попередження коли адвокат натиснув «Створити PDF» з одним файлом.
// Склейка має сенс для двох+ зображень — пропонує перейти у single-file flow
// або додати ще файлів.

import { AlertTriangle, Image as ImageIcon } from 'lucide-react';
import { Button } from '../../UI';
import { ICON_SIZE } from '../../UI/icons.js';

export function SingleFileWarning({ file, canRedirect, onRedirect, onAddMore, onCancel }) {
  return (
    <div className="image-merge-panel__sfw-overlay" role="dialog" aria-modal="true">
      <div className="image-merge-panel__sfw">
        <div className="image-merge-panel__sfw-icon">
          <AlertTriangle size={32} />
        </div>
        <h3 className="image-merge-panel__sfw-title">Вибрано один файл</h3>
        <p className="image-merge-panel__sfw-text">
          Склейка має сенс для двох або більше зображень. Для додавання одного
          документа використайте кнопку «Додати файл» — це швидше і не запускає
          сортування.
        </p>
        <div className="image-merge-panel__sfw-file">
          <ImageIcon size={ICON_SIZE.sm} />
          <span>{file?.name || 'Без імені'}</span>
        </div>
        <div className="image-merge-panel__sfw-actions">
          {canRedirect && (
            <Button variant="primary" onClick={onRedirect}>
              Перейти до «Додати файл»
            </Button>
          )}
          <Button variant="secondary" onClick={onAddMore}>
            Додати ще зображень
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Скасувати
          </Button>
        </div>
      </div>
    </div>
  );
}
