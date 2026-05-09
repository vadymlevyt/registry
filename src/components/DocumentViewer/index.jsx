import { useState, useEffect } from 'react';
import { FileText } from 'lucide-react';
import { DocumentViewerHeader } from './DocumentViewerHeader.jsx';
import { DocumentViewerContent } from './DocumentViewerContent.jsx';
import { DocumentViewerFooter } from './DocumentViewerFooter.jsx';
import './DocumentViewer.css';

const MODE_KEY_PREFIX = 'viewer_mode_';
const MODE_KEYS_INDEX = 'viewer_mode_index';
const MODE_KEYS_LIMIT = 100;

/**
 * DocumentViewer — переглядач документа справи.
 *
 * Підтримує два режими:
 *   scan — Drive iframe preview (PDF/image/Office)
 *   text — текстовий вміст з 02_ОБРОБЛЕНІ (через ocrService.getCachedText)
 *
 * Searchable документи — завжди в режимі text без перемикача.
 * Scanned — перемикач видимий, дефолт зі збереженого localStorage чи 'scan'.
 *
 * Контрольований компонент: батько (CaseDossier) тримає selectedDoc у власному
 * state і передає сюди + обробники подій.
 */
export function DocumentViewer({
  document,
  caseData,
  onClose,
  onUpdate,
  onOpenDetails,
  onDiscussWithAgent,
  onReprocess,
}) {
  const [mode, setMode] = useState(() => loadModePreference(document?.id));

  const isScanned = document?.documentNature === 'scanned';
  const effectiveMode = isScanned ? mode : 'text';

  useEffect(() => {
    if (!document?.id) return;
    setMode(loadModePreference(document.id));
  }, [document?.id]);

  useEffect(() => {
    if (isScanned && document?.id) {
      saveModePreference(document.id, mode);
    }
  }, [mode, document?.id, isScanned]);

  if (!document) {
    return (
      <div className="document-viewer document-viewer--empty">
        <div className="document-viewer__empty-content">
          <FileText size={64} />
          <p>Оберіть документ зі списку щоб переглянути</p>
        </div>
      </div>
    );
  }

  const handleToggleKey = nextValue => {
    onUpdate && onUpdate(document.id, { isKey: nextValue });
  };

  return (
    <div className="document-viewer">
      <DocumentViewerHeader
        document={document}
        caseData={caseData}
        showModeToggle={isScanned}
        mode={effectiveMode}
        onModeChange={setMode}
        onToggleKey={handleToggleKey}
        onOpenDetails={() => onOpenDetails && onOpenDetails(document.id)}
        onClose={onClose}
      />
      <DocumentViewerContent
        document={document}
        mode={effectiveMode}
        caseData={caseData}
        onReprocess={onReprocess}
      />
      <DocumentViewerFooter
        document={document}
        caseData={caseData}
        mode={effectiveMode}
        onDiscussWithAgent={onDiscussWithAgent}
        onReprocess={onReprocess}
      />
    </div>
  );
}

// Exported для прямих юніт-тестів LRU поведінки.
export function loadModePreference(documentId) {
  if (!documentId || typeof localStorage === 'undefined') return 'scan';
  try {
    return localStorage.getItem(`${MODE_KEY_PREFIX}${documentId}`) || 'scan';
  } catch {
    return 'scan';
  }
}

export function saveModePreference(documentId, mode) {
  if (!documentId || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(`${MODE_KEY_PREFIX}${documentId}`, mode);
    // Підтримуємо невеликий LRU index щоб localStorage не розбухав від тисяч ключів.
    const raw = localStorage.getItem(MODE_KEYS_INDEX);
    const index = raw ? JSON.parse(raw) : [];
    const next = [documentId, ...index.filter(id => id !== documentId)].slice(
      0,
      MODE_KEYS_LIMIT
    );
    localStorage.setItem(MODE_KEYS_INDEX, JSON.stringify(next));
    // Видалити витіснені
    for (const oldId of index) {
      if (!next.includes(oldId)) {
        localStorage.removeItem(`${MODE_KEY_PREFIX}${oldId}`);
      }
    }
  } catch {
    // localStorage переповнений — пропускаємо тихо
  }
}
