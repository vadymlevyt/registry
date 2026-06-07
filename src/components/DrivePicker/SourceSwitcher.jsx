// ── DrivePicker · SourceSwitcher (TASK 4 · етап B) ──────────────────────────
// Перемикач джерела: Мій Drive / Поділилися зі мною / Спільні Drive (chip
// показується лише коли sharedDrivesAvail). Винос із AddDocumentModal без змін.
import { Cloud, HardDrive, Users } from 'lucide-react';
import { ICON_SIZE } from '../UI/icons.js';

export function SourceSwitcher({ mode, sharedDrivesAvail, onChange }) {
  return (
    <div className="add-document-modal__drive-sources" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'myDrive'}
        className={
          'add-document-modal__drive-source-chip' +
          (mode === 'myDrive' ? ' add-document-modal__drive-source-chip--active' : '')
        }
        onClick={() => onChange('myDrive')}
      >
        <HardDrive size={ICON_SIZE.sm} />
        Мій Drive
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'sharedWithMe'}
        className={
          'add-document-modal__drive-source-chip' +
          (mode === 'sharedWithMe' ? ' add-document-modal__drive-source-chip--active' : '')
        }
        onClick={() => onChange('sharedWithMe')}
      >
        <Users size={ICON_SIZE.sm} />
        Поділилися зі мною
      </button>
      {sharedDrivesAvail && (
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'sharedDrives'}
          className={
            'add-document-modal__drive-source-chip' +
            (mode === 'sharedDrives' ? ' add-document-modal__drive-source-chip--active' : '')
          }
          onClick={() => onChange('sharedDrives')}
        >
          <Cloud size={ICON_SIZE.sm} />
          Спільні Drive
        </button>
      )}
    </div>
  );
}
