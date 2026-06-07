// ── DrivePicker · SourceSwitcher (TASK 4 · етапи B/B2) ──────────────────────
// Перемикач джерела: Мій Drive / Поділилися зі мною / Спільні Drive. Набір
// чипів керується пропом `sources` (B2 — обидва пікери дістають усі три як
// union). Чип «Спільні Drive» додатково гейтиться наявністю (sharedDrivesAvail).
import { Cloud, HardDrive, Users } from 'lucide-react';
import { ICON_SIZE } from '../UI/icons.js';
import { DEFAULT_SOURCES } from './helpers.js';

export function SourceSwitcher({ mode, sharedDrivesAvail, onChange, sources = DEFAULT_SOURCES }) {
  const has = (s) => sources.includes(s);
  // Якщо лишилось одне джерело — перемикач зайвий (нема між чим перемикати).
  if (sources.length <= 1) return null;
  return (
    <div className="add-document-modal__drive-sources" role="tablist">
      {has('myDrive') && (
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
      )}
      {has('sharedWithMe') && (
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
      )}
      {has('sharedDrives') && sharedDrivesAvail && (
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
