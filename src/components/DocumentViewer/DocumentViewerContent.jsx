import { useEffect, useState } from 'react';
import { FileText, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '../UI';
import { ICON_SIZE } from '../UI/icons.js';
import { getCachedText, localizeOcrError } from '../../services/ocrService.js';

/**
 * Контентна частина Viewer'а.
 *
 * Scan-режим — Drive iframe preview (підтримує PDF, image, docx — все що Drive
 * вміє показати). Власний PDF.js render не використовуємо: в існуючому
 * Viewer'і теж був iframe, працює стабільно і не дублює рендер.
 *
 * Text-режим — підтягує OCR-кеш з 02_ОБРОБЛЕНІ через ocrService. Якщо кешу
 * немає — empty state з кнопкою "Розпізнати зараз".
 */
export function DocumentViewerContent({ document, mode, caseData, onReprocess }) {
  if (mode === 'scan') {
    return <ScanContent document={document} />;
  }
  return (
    <TextContent
      document={document}
      caseData={caseData}
      onReprocess={onReprocess}
    />
  );
}

function ScanContent({ document }) {
  if (!document.driveId) {
    return (
      <div className="document-viewer__empty-state">
        <AlertTriangle size={48} />
        <p>Файл не прикріплено до Drive</p>
        <p className="document-viewer__empty-state-detail">
          Прикріпіть файл щоб переглянути зміст.
        </p>
      </div>
    );
  }

  const isImage = (document.mimeType || '').startsWith('image/');
  if (isImage) {
    return (
      <div className="document-viewer__content document-viewer__content--scan">
        <img
          className="document-viewer__image"
          src={`https://drive.google.com/uc?export=view&id=${document.driveId}`}
          alt={document.name}
        />
      </div>
    );
  }

  return (
    <div className="document-viewer__content document-viewer__content--scan">
      <iframe
        className="document-viewer__iframe"
        src={`https://drive.google.com/file/d/${document.driveId}/preview`}
        title={document.name}
        allow="autoplay"
      />
    </div>
  );
}

function TextContent({ document, caseData, onReprocess }) {
  const [text, setText] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setText(null);

    const subFolders = caseData?.storage?.subFolders;

    if (!document.driveId || !subFolders?.['02_ОБРОБЛЕНІ']) {
      setLoading(false);
      return undefined;
    }

    const file = {
      id: document.driveId,
      name: document.originalName || document.name,
      mimeType: document.mimeType || 'application/pdf',
      subFolders,
    };

    getCachedText(file)
      .then(content => {
        if (cancelled) return;
        setText(content || null);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(localizeOcrError(err.code) || err.message || 'Не вдалось завантажити текст');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [document.id, document.driveId, caseData?.storage?.subFolders]);

  if (loading) {
    return (
      <div className="document-viewer__loading">
        <RefreshCw size={ICON_SIZE.md} />
        <span>Завантаження тексту...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="document-viewer__empty-state">
        <AlertTriangle size={48} />
        <p>Не вдалось завантажити текст</p>
        <p className="document-viewer__empty-state-detail">{error}</p>
      </div>
    );
  }

  if (!text) {
    const canReprocess = !!document.driveId && !!onReprocess;
    return (
      <div className="document-viewer__empty-state">
        <FileText size={48} />
        <p>Текст для цього документа ще не розпізнано</p>
        {canReprocess && (
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={ICON_SIZE.sm} />}
            onClick={() => onReprocess(document)}
          >
            Розпізнати зараз
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="document-viewer__content document-viewer__content--text">
      <pre className="document-viewer__text">{text}</pre>
    </div>
  );
}
