// ── DrivePicker · DriveListItem (TASK 4 · етап B) ───────────────────────────
// Один рядок списку: папка / файл / зображення; чекбокс у multi-images.
// Винос із AddDocumentModal без змін.
import { Folder, FileText, Image as ImageIcon, Check } from 'lucide-react';
import { ICON_SIZE } from '../UI/icons.js';
import { FOLDER_MIME } from './helpers.js';

export function DriveListItem({ item, onClick, selected = false, showCheckbox = false }) {
  const isFolder = item.mimeType === FOLDER_MIME;
  const isImage = typeof item.mimeType === 'string' && item.mimeType.startsWith('image/');
  const sizeLabel = !isFolder && item.size
    ? `${(parseInt(item.size, 10) / 1024).toFixed(0)} КБ`
    : null;
  const dateLabel = item.modifiedTime
    ? new Date(item.modifiedTime).toLocaleDateString('uk-UA', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      })
    : null;
  const meta = [sizeLabel, dateLabel].filter(Boolean).join(' • ');
  return (
    <button
      type="button"
      className={
        'add-document-modal__drive-item' +
        (isFolder ? ' add-document-modal__drive-item--folder' : '') +
        (selected ? ' add-document-modal__drive-item--selected' : '')
      }
      onClick={onClick}
      aria-pressed={showCheckbox ? selected : undefined}
    >
      {showCheckbox && (
        <span
          className={
            'add-document-modal__drive-item-check' +
            (selected ? ' add-document-modal__drive-item-check--on' : '')
          }
          aria-hidden="true"
        >
          {selected && <Check size={14} />}
        </span>
      )}
      {isFolder ? <Folder size={ICON_SIZE.sm} /> : (isImage ? <ImageIcon size={ICON_SIZE.sm} /> : <FileText size={ICON_SIZE.sm} />)}
      <div className="add-document-modal__drive-item-info">
        <div className="add-document-modal__drive-item-name">{item.name}</div>
        {meta && (
          <div className="add-document-modal__drive-item-meta">{meta}</div>
        )}
      </div>
    </button>
  );
}
