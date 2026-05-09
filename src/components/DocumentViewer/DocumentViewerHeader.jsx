import { Star, Wrench, X } from 'lucide-react';
import { ICON_SIZE } from '../UI/icons.js';
import { Tooltip } from '../UI';
import { ScanTextToggle } from './ScanTextToggle.jsx';
import {
  CATEGORY_LABELS,
  AUTHOR_LABELS,
  proceedingColor,
  formatDate,
  formatFileSize,
} from './labels.js';

/**
 * Шапка Viewer'а: перемикач режиму, назва, метарядок, кнопки керування.
 *
 * showModeToggle=true тільки для scanned документів — у searchable PDF немає
 * сенсу показувати картинку, тому одразу режим Текст.
 */
export function DocumentViewerHeader({
  document,
  caseData,
  showModeToggle,
  mode,
  onModeChange,
  onToggleKey,
  onOpenDetails,
  onClose,
}) {
  const proceeding = caseData?.proceedings?.find(p => p.id === document.procId);

  return (
    <header className="document-viewer__header">
      <div className="document-viewer__header-row">
        {showModeToggle && <ScanTextToggle mode={mode} onChange={onModeChange} />}

        <h2 className="document-viewer__title" title={document.name}>
          {document.name}
        </h2>

        <div className="document-viewer__header-actions">
          <Tooltip
            content={
              document.isKey
                ? 'Зняти позначку ключового документа'
                : 'Позначити як ключовий'
            }
          >
            <button
              type="button"
              className={`document-viewer__star ${document.isKey ? 'is-active' : ''}`}
              onClick={() => onToggleKey(!document.isKey)}
              aria-label="Ключовий документ"
              aria-pressed={!!document.isKey}
            >
              <Star
                size={ICON_SIZE.md}
                fill={document.isKey ? 'var(--color-gold)' : 'none'}
              />
            </button>
          </Tooltip>

          <Tooltip content="Деталі документа">
            <button
              type="button"
              className="document-viewer__icon-button"
              onClick={onOpenDetails}
              aria-label="Деталі"
            >
              <Wrench size={ICON_SIZE.md} />
            </button>
          </Tooltip>

          <Tooltip content="Закрити">
            <button
              type="button"
              className="document-viewer__icon-button"
              onClick={onClose}
              aria-label="Закрити"
            >
              <X size={ICON_SIZE.md} />
            </button>
          </Tooltip>
        </div>
      </div>

      <DocumentMeta document={document} proceeding={proceeding} />
    </header>
  );
}

function DocumentMeta({ document, proceeding }) {
  const items = [];

  if (document.category) {
    items.push({
      key: 'category',
      node: CATEGORY_LABELS[document.category] || document.category,
    });
  }
  if (document.author) {
    items.push({
      key: 'author',
      node: AUTHOR_LABELS[document.author] || document.author,
    });
  }
  if (proceeding) {
    items.push({
      key: 'proceeding',
      node: <ProceedingTag proceeding={proceeding} />,
    });
  }
  const dateText = formatDate(document.date);
  if (dateText) items.push({ key: 'date', node: dateText });
  if (document.pageCount) {
    items.push({ key: 'pages', node: `${document.pageCount} стор` });
  }
  const sizeText = formatFileSize(document.size);
  if (sizeText) items.push({ key: 'size', node: sizeText });

  if (items.length === 0) return null;

  return (
    <div className="document-viewer__meta">
      {items.map(({ key, node }) => (
        <span key={key} className="document-viewer__meta-item">
          {node}
        </span>
      ))}
    </div>
  );
}

function ProceedingTag({ proceeding }) {
  return (
    <span className="document-viewer__proceeding-tag">
      <span
        className="document-viewer__proceeding-dot"
        style={{ background: proceedingColor(proceeding.type) }}
      />
      {proceeding.title}
    </span>
  );
}
