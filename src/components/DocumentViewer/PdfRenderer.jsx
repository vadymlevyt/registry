// ── PdfRenderer — iframe з повним pdfjs viewer (Mozilla pdf.js viewer.html).
//
// Раніше: власний canvas+textLayer через pdfjs-dist API. Виявилось архітектурно
// тупиковим: textLayer pdfjs — мозаїка span'ів на text run, native browser
// selection не може зробити їх суцільними → стрибки виділення на Android.
// Magnifier-лінза Chrome Android не блокується CSS'ом.
//
// Зараз: iframe з повним pdfjs viewer (web/viewer.html від Mozilla, скопійовано
// у public/pdfjs-viewer/). Той самий viewer що Drive використовує — виділення
// суцільне на рядок, magnifier поведений, pinch-zoom і scroll нативні.
//
// Файл завантажуємо як ArrayBuffer через Drive API (driveRequest обробляє 401
// і re-auth), створюємо blob URL, передаємо у viewer через ?file=. Blob URL
// same-origin з нашою сторінкою → iframe має повний доступ.
//
// При unmount/перемиканні документа — URL.revokeObjectURL для cleanup blob
// (інакше memory leak: blob тримається доки сторінка жива).
//
// pdfjs-dist залишається у залежностях для ocrService/pdfjsLocal extraction.

import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, Loader } from 'lucide-react';
import { Button } from '../UI';
import { ICON_SIZE } from '../UI/icons.js';
import { useDriveFileBuffer } from './useDriveFileBuffer.js';

// BASE_URL Vite — у dev '/' , на GitHub Pages '/registry/'. Без import.meta.env
// доступу у тестовому середовищі — fallback '/'.
function viewerBaseUrl() {
  // eslint-disable-next-line no-undef
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
  return base.endsWith('/') ? `${base}pdfjs-viewer/web/viewer.html` : `${base}/pdfjs-viewer/web/viewer.html`;
}

// URL формат pdfjs viewer:
//   viewer.html?file=<urlencoded blob URL>#zoom=page-width&pagemode=none
// query string для джерела файлу, hash для viewer-параметрів. zoom=page-width
// підганяє ширину PDF під iframe; pagemode=none ховає sidebar (thumbnails).
function buildViewerUrl(blobUrl) {
  return `${viewerBaseUrl()}?file=${encodeURIComponent(blobUrl)}#zoom=page-width&pagemode=none`;
}

export function PdfRenderer({ driveId, name }) {
  const { data, loading, error, retry } = useDriveFileBuffer(driveId);
  const [blobUrl, setBlobUrl] = useState(null);

  useEffect(() => {
    if (!data) {
      setBlobUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
    setBlobUrl(url);
    return () => {
      // revoke коли документ змінюється або компонент розмонтовано — інакше
      // blob тримається у пам'яті всю сесію.
      URL.revokeObjectURL(url);
    };
  }, [data]);

  if (loading) {
    return (
      <div className="document-viewer__loading">
        <Loader size={ICON_SIZE.md} />
        <span>Завантаження PDF...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="document-viewer__empty-state">
        <AlertTriangle size={48} />
        <p>Не вдалось завантажити документ</p>
        <p className="document-viewer__empty-state-detail">{error}</p>
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCw size={ICON_SIZE.sm} />}
          onClick={retry}
        >
          Спробувати знову
        </Button>
      </div>
    );
  }

  if (!blobUrl) return null;

  return (
    <div className="document-viewer__content document-viewer__content--pdf">
      <iframe
        className="pdf-iframe"
        title={name || 'PDF документ'}
        src={buildViewerUrl(blobUrl)}
      />
    </div>
  );
}
