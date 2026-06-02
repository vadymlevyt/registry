import { Image, AlignLeft, FileText } from 'lucide-react';
import { ICON_SIZE } from '../UI/icons.js';
import './ScanTextToggle.css';

/**
 * Перемикач режиму Viewer для scanned документів.
 *
 * Props:
 *   mode      — 'scan' | 'exact' | 'text'
 *   onChange  — (newMode) => void
 *   showExact — показувати опцію «Точний» (V2-A1). true ТІЛЬКИ коли документ
 *               scanned і має layout (рішення приймає DocumentViewer після
 *               проби getCachedLayout). default false — для старих викликів
 *               (Скан/Текст) поведінка незмінна.
 *
 * «Точний» — детермінований показ тексту скана з layout на льоту (КРОК 1
 * cleanTextService, 0 токенів AI). Стоїть між «Скан» і «Текст»: спершу
 * оригінал-зображення, потім дослівний вирівняний текст з layout, потім
 * поточний «Текст» (.md→.txt) для порівняння.
 */
export function ScanTextToggle({ mode, onChange, showExact = false }) {
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
      {showExact && (
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'exact'}
          className={`scan-text-toggle__option ${mode === 'exact' ? 'is-active' : ''}`}
          onClick={() => onChange('exact')}
        >
          <AlignLeft size={ICON_SIZE.sm} />
          <span>Точний</span>
        </button>
      )}
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
