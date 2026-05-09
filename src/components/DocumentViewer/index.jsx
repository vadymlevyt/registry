import { useState, useEffect } from 'react';
import { FileText } from 'lucide-react';
import { DocumentViewerHeader } from './DocumentViewerHeader.jsx';
import { DocumentViewerContent } from './DocumentViewerContent.jsx';
import { DocumentViewerFooter } from './DocumentViewerFooter.jsx';
import { defaultNatureForUI, inferNatureFromFile } from '../../services/detectDocumentNature.js';
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
  onDelete,
}) {
  const [mode, setMode] = useState(() => loadModePreference(document?.id));

  // documentNature може бути не визначений на legacy-документах (до v5).
  // У такому випадку визначаємо за іменем/mime: PDF/image → 'scanned',
  // docx/txt → 'searchable'. Це дає valid UI поки фонова detection
  // обновить поле через update_document.
  const inferred = inferNatureFromFile(document) || defaultNatureForUI(document);
  const effectiveNature = document?.documentNature || inferred;
  const isScanned = effectiveNature === 'scanned';
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

  // Якщо documentNature відсутній (legacy <v5 або імпорт без класифікації),
  // але швидка інференція дала впевнений результат — фіксуємо його через
  // update_document. Глибока pdf-перевірка не запускається тут (важко без
  // blob), тільки очевидні висновки за іменем/mimeType. Працює fire-and-forget.
  useEffect(() => {
    if (!document?.id || !onUpdate) return;
    if (document.documentNature === 'scanned' || document.documentNature === 'searchable') return;
    const sure = inferNatureFromFile(document);
    if (!sure) return;
    onUpdate(document.id, { documentNature: sure });
  }, [document?.id, document?.documentNature, onUpdate]);

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

  // Для footer "Перерозпізнати" враховуємо ефективну природу.
  const effectiveDoc = document?.documentNature
    ? document
    : { ...document, documentNature: effectiveNature };

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
        onDelete={onDelete}
        onClose={onClose}
      />
      <DocumentViewerContent
        document={document}
        mode={effectiveMode}
        caseData={caseData}
        onReprocess={onReprocess}
      />
      <DocumentViewerFooter
        document={effectiveDoc}
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
