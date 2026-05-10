import { useEffect, useState } from 'react';
import { FileText, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '../UI';
import { ICON_SIZE } from '../UI/icons.js';
import { getCachedText, localizeOcrError } from '../../services/ocrService.js';
import { PdfRenderer } from './PdfRenderer.jsx';
import { DocxRenderer } from './DocxRenderer.jsx';
import { HtmlRenderer } from './HtmlRenderer.jsx';

/**
 * Контентна частина Viewer'а.
 *
 * Логіка вибору рендеру:
 *   - mode='scan' — обираємо власний рендер за типом файлу:
 *       PDF (searchable і scanned) → PdfRenderer (pdfjs viewer iframe). Один
 *         тулбар, одне виділення, однаковий UX для всіх PDF (мікро-TASK 5.2-fix5)
 *       зображення → <img> з Drive
 *       DOCX → DocxRenderer (mammoth → HTML)
 *       HTML → HtmlRenderer (charset detection + iframe srcdoc)
 *       інші (TXT, MD, RTF, XLSX, ODT) → Drive iframe як fallback (нативного
 *         рендеру для них поза скопом TASK 5.2)
 *   - mode='text' → плашка з extracted OCR-текстом (для scanned)
 *
 * Принцип: .txt у 02_ОБРОБЛЕНІ — ТІЛЬКИ для агента і пошуку. Власні рендери
 * НЕ використовують .txt як fallback при помилках. Помилка → empty state.
 *
 * useEffect для text-режиму залежить від `document.lastOcrAt` — після успішного
 * перерозпізнавання CaseDossier викликає update_document({ lastOcrAt: now }),
 * що ре-фетчить текст.
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

function getExtension(name) {
  if (!name) return '';
  const m = /\.([^.]+)$/.exec(String(name).toLowerCase());
  return m ? m[1] : '';
}

function isPdf(doc) {
  const mime = (doc.mimeType || '').toLowerCase();
  const ext = getExtension(doc.originalName || doc.name);
  return mime === 'application/pdf' || ext === 'pdf';
}

function isDocx(doc) {
  const mime = (doc.mimeType || '').toLowerCase();
  const ext = getExtension(doc.originalName || doc.name);
  return (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  );
}

function isHtml(doc) {
  const mime = (doc.mimeType || '').toLowerCase();
  const ext = getExtension(doc.originalName || doc.name);
  return (
    mime === 'text/html' ||
    mime === 'application/xhtml+xml' ||
    ext === 'html' ||
    ext === 'htm' ||
    ext === 'xhtml' ||
    ext === 'xht'
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

  // Усі PDF (searchable і scanned) — pdfjs viewer iframe. Одноманітний UI:
  // той самий тулбар, та сама поведінка zoom/scroll. Виділення тексту в
  // scanned PDF буде порожнім (немає textLayer бо немає ембедденого тексту) —
  // це очікувано: для роботи з текстом сканованого документа адвокат
  // перемикається на режим Текст і працює з extracted OCR-плашкою.
  if (isPdf(document)) {
    return <PdfRenderer driveId={document.driveId} name={document.name} />;
  }
  if (isDocx(document)) {
    return <DocxRenderer driveId={document.driveId} />;
  }
  if (isHtml(document)) {
    return <HtmlRenderer driveId={document.driveId} />;
  }

  // Інші inline-renderable (TXT, MD, RTF, CSV, XLSX, PPTX, ODT) — Drive iframe.
  // Власні рендери для цих типів — поза скопом мікро-TASK 5.2.
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
