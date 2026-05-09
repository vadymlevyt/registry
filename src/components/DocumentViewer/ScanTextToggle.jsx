import { Image, FileText } from 'lucide-react';
import { ICON_SIZE } from '../UI/icons.js';
import './ScanTextToggle.css';

/**
 * Перемикач режиму Viewer для scanned документів.
 *
 * Props:
 *   mode      — 'scan' | 'text'
 *   onChange  — (newMode) => void
 */
export function ScanTextToggle({ mode, onChange }) {
  return (
    <div className="scan-text-toggle" role="tablist" aria-label="Режим перегляду">
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'scan'}
        className={`scan-text-toggle__option ${mode === 'scan' ? 'is-active' : ''}`}
        onClick={() => onChange('scan')}
      >
        <Image size={ICON_SIZE.sm} />
        <span>Скан</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'text'}
        className={`scan-text-toggle__option ${mode === 'text' ? 'is-active' : ''}`}
        onClick={() => onChange('text')}
      >
        <FileText size={ICON_SIZE.sm} />
        <span>Текст</span>
      </button>
    </div>
  );
}
