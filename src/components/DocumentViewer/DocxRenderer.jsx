// ── DocxRenderer — рендер DOCX через mammoth.js.
// Завантажуємо файл як ArrayBuffer, конвертуємо в HTML, вставляємо у styled
// .docx-content. Базове форматування (h1-h6, p, ul/ol, table) приведено до
// читабельного вигляду близького до Word.
//
// Помилка → empty state. Drive .txt НЕ використовується як fallback.

import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, Loader } from 'lucide-react';
import { Button } from '../UI';
import { ICON_SIZE } from '../UI/icons.js';
import { useDriveFileBuffer } from './useDriveFileBuffer.js';

// Lazy-load mammoth — браузерний бандл важкий і ініціалізується лише за
// потреби (коли реально відкривається DOCX).
let mammothPromise = null;
function loadMammoth() {
  if (!mammothPromise) {
    mammothPromise = import('mammoth/mammoth.browser.js');
  }
  return mammothPromise;
}

export function DocxRenderer({ driveId }) {
  const { data, loading, error, retry } = useDriveFileBuffer(driveId);
  const [html, setHtml] = useState(null);
  const [convertError, setConvertError] = useState(null);

  useEffect(() => {
    if (!data) {
      setHtml(null);
      setConvertError(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const mammothMod = await loadMammoth();
        if (cancelled) return;
        const mammoth = mammothMod.default || mammothMod;
        const result = await mammoth.convertToHtml({ arrayBuffer: data });
        if (cancelled) return;
        setHtml(result?.value || '');
        setConvertError(null);
      } catch (e) {
        if (cancelled) return;
        setConvertError(e?.message || 'Не вдалось конвертувати DOCX');
        setHtml(null);
      }
    })();
    return () => { cancelled = true; };
  }, [data]);

  if (loading) {
    return (
      <div className="document-viewer__loading">
        <Loader size={ICON_SIZE.md} />
        <span>Завантаження документа...</span>
      </div>
    );
  }

  if (error || convertError) {
    const message = error || convertError;
    return (
      <div className="document-viewer__empty-state">
        <AlertTriangle size={48} />
        <p>Не вдалось рендерити DOCX</p>
        <p className="document-viewer__empty-state-detail">{message}</p>
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

  if (html === null) return null;

  return (
    <div className="document-viewer__content document-viewer__content--docx">
      <div
        className="docx-content"
        // mammoth повертає sanitized HTML без скриптів. dangerouslySetInnerHTML
        // тут безпечний бо джерело — наш сервіс mammoth, а не довільний HTML.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
