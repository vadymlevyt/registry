// ── PdfRenderer — нативний рендер PDF через pdfjs-dist.
// Власний React-wrapper навколо існуючого pdfjs (5.6.205, worker налаштовано
// у App.jsx). Забезпечує canvas + textLayer для виділення/копіювання тексту,
// IntersectionObserver для lazy-rendering сторінок, ResizeObserver для
// fit-to-width.
//
// Замість Drive iframe (який блокує текстовий шар) — ця реалізація дає адвокату
// нативне виділення, копіювання і базис для майбутніх маркера/нотаток.
//
// Помилка завантаження або рендеру → empty state з кнопкою "Спробувати знову".
// Drive .txt НІКОЛИ не використовується як fallback (це окрема роль для агента).

import { useEffect, useRef, useState, useCallback } from 'react';
import { AlertTriangle, RefreshCw, Loader } from 'lucide-react';
import { Button } from '../UI';
import { ICON_SIZE } from '../UI/icons.js';
import { useDriveFileBuffer } from './useDriveFileBuffer.js';
import 'pdfjs-dist/web/pdf_viewer.css';

// Lazy-load pdfjs щоб не вантажити його (DOMMatrix, OffscreenCanvas) при mount
// у jsdom-тестах. У браузері це fire-and-forget при першому використанні і
// одноразово кешується модульним резолвером.
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist');
  }
  return pdfjsPromise;
}

export function PdfRenderer({ driveId, name }) {
  const { data, loading, error, retry } = useDriveFileBuffer(driveId);
  const [pdf, setPdf] = useState(null);
  const [pdfError, setPdfError] = useState(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!data) {
      setPdf(null);
      setPdfError(null);
      return undefined;
    }
    let cancelled = false;
    let loadingTask = null;
    (async () => {
      try {
        const pdfjsLib = await loadPdfjs();
        if (cancelled) return;
        loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data) });
        const doc = await loadingTask.promise;
        if (cancelled) {
          try { doc.destroy(); } catch (e) {}
          return;
        }
        setPdf(doc);
        setPdfError(null);
      } catch (e) {
        if (cancelled) return;
        setPdfError(e?.message || 'Не вдалось відкрити PDF');
        setPdf(null);
      }
    })();
    return () => {
      cancelled = true;
      try { loadingTask?.destroy(); } catch (e) {}
    };
  }, [data]);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const el = containerRef.current;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setContainerWidth(prev => (Math.abs(prev - w) > 1 ? w : prev));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  if (pdfError) {
    return (
      <div className="document-viewer__empty-state">
        <AlertTriangle size={48} />
        <p>Не вдалось рендерити PDF</p>
        <p className="document-viewer__empty-state-detail">{pdfError}</p>
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

  return (
    <div
      ref={containerRef}
      className="document-viewer__content document-viewer__content--pdf"
    >
      {pdf && containerWidth > 0 && (
        <PdfPagesList pdf={pdf} containerWidth={containerWidth} name={name} />
      )}
    </div>
  );
}

function PdfPagesList({ pdf, containerWidth, name }) {
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    pages.push(
      <PdfPage
        key={`${pdf.fingerprints?.[0] || 'pdf'}-${n}`}
        pdf={pdf}
        pageNumber={n}
        containerWidth={containerWidth}
        name={name}
      />
    );
  }
  return <div className="pdf-pages">{pages}</div>;
}

function PdfPage({ pdf, pageNumber, containerWidth, name }) {
  const pageRef = useRef(null);
  const canvasRef = useRef(null);
  const textLayerRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [pageError, setPageError] = useState(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = (containerWidth - 32) / baseViewport.width;
        const safeScale = Math.max(0.5, Math.min(scale, 4));
        const viewport = page.getViewport({ scale: safeScale });
        if (!cancelled) {
          setDims({ width: viewport.width, height: viewport.height });
        }
      } catch (e) {
        if (!cancelled) setPageError(e?.message || 'Помилка сторінки');
      }
    })();
    return () => { cancelled = true; };
  }, [pdf, pageNumber, containerWidth]);

  useEffect(() => {
    if (!pageRef.current) return undefined;
    const el = pageRef.current;
    const io = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) setVisible(true);
        }
      },
      { rootMargin: '400px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const renderPage = useCallback(async () => {
    if (!visible || rendered || !canvasRef.current || !textLayerRef.current) return;
    if (dims.width === 0) return;
    let renderTask = null;
    let textLayer = null;
    try {
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = (containerWidth - 32) / baseViewport.width;
      const safeScale = Math.max(0.5, Math.min(scale, 4));
      const viewport = page.getViewport({ scale: safeScale });

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      renderTask = page.render({ canvasContext: ctx, viewport, canvas });
      await renderTask.promise;

      const pdfjsLib = await loadPdfjs();
      const textContainer = textLayerRef.current;
      if (!textContainer) return;
      textContainer.innerHTML = '';
      textContainer.style.width = `${viewport.width}px`;
      textContainer.style.height = `${viewport.height}px`;
      textLayer = new pdfjsLib.TextLayer({
        textContentSource: page.streamTextContent(),
        container: textContainer,
        viewport,
      });
      await textLayer.render();

      setRendered(true);
      setPageError(null);
    } catch (e) {
      if (e?.name !== 'RenderingCancelledException') {
        setPageError(e?.message || 'Помилка рендеру сторінки');
      }
    }
  }, [pdf, pageNumber, containerWidth, visible, rendered, dims.width]);

  useEffect(() => {
    renderPage();
  }, [renderPage]);

  return (
    <div
      ref={pageRef}
      className="pdf-page"
      data-page-number={pageNumber}
      style={{
        width: dims.width || undefined,
        height: dims.height || undefined,
      }}
      aria-label={`Сторінка ${pageNumber} документа ${name || ''}`}
    >
      <canvas ref={canvasRef} className="pdf-page__canvas" />
      <div ref={textLayerRef} className="textLayer pdf-page__text-layer" />
      {pageError && (
        <div className="pdf-page__error">
          <AlertTriangle size={ICON_SIZE.sm} />
          <span>Помилка сторінки {pageNumber}</span>
        </div>
      )}
    </div>
  );
}
