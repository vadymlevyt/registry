import { useCallback, useEffect, useState } from 'react';
import { FileText, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '../UI';
import { ICON_SIZE } from '../UI/icons.js';
import { getCachedText, localizeOcrError } from '../../services/ocrService.js';
import { PdfJsViewer } from './PdfJsViewer.jsx';

/**
 * Контентна частина Viewer'а.
 *
 * Scan-режим:
 *   - PDF (mimeType=application/pdf або *.pdf) → PdfJsViewer (canvas + textLayer)
 *     щоб адвокат міг виділяти текст. На fatal-error — fallback на Drive iframe.
 *   - Зображення (image/*) → <img> з drive.google.com/uc.
 *   - Інші формати (docx тощо) → Drive iframe preview.
 *
 * Text-режим — підтягує OCR-кеш з 02_ОБРОБЛЕНІ через ocrService. Якщо кешу
 * немає — empty state з кнопкою "Розпізнати зараз".
 *
 * useEffect залежить від `document.lastOcrAt` — після успішного перерозпізнавання
 * CaseDossier викликає update_document({ lastOcrAt: now }), що ре-фетчить текст.
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
  // PdfJsViewer може зафейлити (мережа моргнула, ZIP-замаскований PDF тощо).
  // У такому разі переключаємось на Drive iframe — preview без виділення,
  // але адвокат хоч щось бачить. Рішення тримається у локальному state поки
  // документ не зміниться.
  const [pdfJsFailed, setPdfJsFailed] = useState(false);
  useEffect(() => {
    setPdfJsFailed(false);
  }, [document?.id, document?.driveId]);

  const handlePdfJsFatal = useCallback(() => {
    setPdfJsFailed(true);
  }, []);

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

  const mime = document.mimeType || '';
  const lname = (document.originalName || document.name || '').toLowerCase();
  const isImage = mime.startsWith('image/');
  const isPdf = mime === 'application/pdf' || lname.endsWith('.pdf');

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

  if (isPdf && !pdfJsFailed) {
    return (
      <div className="document-viewer__content document-viewer__content--scan">
        <PdfJsViewer
          driveId={document.driveId}
          name={document.name}
          onFatalError={handlePdfJsFatal}
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

    // Імена файлів з Drive повертаються в NFC-нормалізованому Unicode.
    // ocrService нормалізує сам через name='...' порівняння, але для
    // надійності передаємо normalize'ed name (важливо для українських
    // символів які можуть бути у NFD з iOS).
    const rawName = document.originalName || document.name || '';
    const normalizedName = typeof rawName.normalize === 'function'
      ? rawName.normalize('NFC')
      : rawName;

    const file = {
      id: document.driveId,
      name: normalizedName,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document.id, document.driveId, document.lastOcrAt, caseData?.storage?.subFolders]);

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
