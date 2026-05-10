import { useEffect, useRef, useState, useCallback } from 'react';
import { ZoomIn, ZoomOut, RefreshCw, AlertTriangle } from 'lucide-react';
import { ICON_SIZE } from '../UI/icons.js';
import { driveRequest } from '../../services/driveAuth.js';
import './PdfJsViewer.css';

// pdfjs імпортується динамічно — pdf.mjs використовує DOMMatrix який
// відсутній у jsdom, що ламає юніт-тести DocumentViewer (вони рендерять
// компонент, але реально PDF не завантажують). У браузері динамічний
// import резолвиться миттєво (Vite вже бандлить chunk через App.jsx
// pdfjsLib.GlobalWorkerOptions).
let pdfjsLibPromise = null;
function loadPdfjs() {
  if (!pdfjsLibPromise) pdfjsLibPromise = import('pdfjs-dist');
  return pdfjsLibPromise;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 3.0;
const SCALE_STEP = 0.25;
// rootMargin для IntersectionObserver — рендеримо ±500px навколо viewport.
// Це і є "поточна сторінка ± 2 сусідні" для типових A4 (~1100px у scale=1).
const RENDER_MARGIN = '500px 0px';

/**
 * PdfJsViewer — рендер PDF через pdf.js (canvas + textLayer).
 *
 * На відміну від `https://drive.google.com/file/d/<id>/preview` iframe, тут
 * є справжній HTML-textLayer поверх canvas — адвокат може виділяти текст
 * пальцем/мишею і копіювати. Lazy: сторінки рендеряться тільки коли вони у
 * viewport ± 500px (через IntersectionObserver).
 *
 * Помилка завантаження → onFatalError, батько переключиться на iframe.
 */
export function PdfJsViewer({ driveId, name, onFatalError }) {
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [errorMessage, setErrorMessage] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.0);

  const scrollRef = useRef(null);
  const pdfRef = useRef(null);
  const pdfjsLibRef = useRef(null); // resolved pdfjs module — потрібен для TextLayer у renderPage
  const baseViewportsRef = useRef(new Map()); // pageNum → {width, height} at scale=1
  const pageNodesRef = useRef(new Map()); // pageNum → wrapper element
  const renderedRef = useRef(new Set()); // pageNum, що вже рендерили на поточному масштабі
  const renderTasksRef = useRef(new Map()); // pageNum → pdfjs render task
  const observerRef = useRef(null);

  // Кожне натискання scale-кнопок інкрементує цей маркер. Render-функція
  // запам'ятовує своє покоління і перевіряє перед фінальною set'ою у
  // renderedRef — щоб не залишити "застарілий" ренд після зміни масштабу.
  const renderGenRef = useRef(0);

  // Завантаження документа
  useEffect(() => {
    if (!driveId) return undefined;
    let cancelled = false;
    let loadingTask = null;
    setStatus('loading');
    setErrorMessage(null);
    setNumPages(0);
    pdfRef.current = null;
    baseViewportsRef.current = new Map();
    renderedRef.current = new Set();

    (async () => {
      try {
        const pdfjsLib = await loadPdfjs();
        if (cancelled) return;
        pdfjsLibRef.current = pdfjsLib;

        const res = await driveRequest(
          `https://www.googleapis.com/drive/v3/files/${driveId}?alt=media`
        );
        if (!res.ok) {
          const err = new Error(`Drive ${res.status}`);
          err.code = res.status === 401 ? 'AUTH' : 'HTTP';
          throw err;
        }
        const buf = await res.arrayBuffer();
        if (cancelled) return;

        loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buf) });
        const pdf = await loadingTask.promise;
        if (cancelled) {
          try { pdf.destroy(); } catch (e) {}
          return;
        }
        pdfRef.current = pdf;

        // Pre-fetch базові viewport-розміри щоб одразу показати правильні
        // placeholder-блоки (без layout shift під час lazy render).
        const baseViewports = new Map();
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const v = page.getViewport({ scale: 1 });
          baseViewports.set(i, { width: v.width, height: v.height });
          if (cancelled) return;
        }

        baseViewportsRef.current = baseViewports;
        setNumPages(pdf.numPages);
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        console.warn('[PdfJsViewer] load failed:', e.message);
        setErrorMessage(e.message || 'Невідома помилка');
        setStatus('error');
        if (onFatalError) onFatalError(e);
      }
    })();

    return () => {
      cancelled = true;
      try { loadingTask?.destroy?.(); } catch (e) {}
      try { pdfRef.current?.destroy?.(); } catch (e) {}
      pdfRef.current = null;
    };
  }, [driveId, onFatalError]);

  const renderPage = useCallback(async (pageNum) => {
    const pdf = pdfRef.current;
    if (!pdf) return;
    if (renderedRef.current.has(pageNum)) return;
    const wrapper = pageNodesRef.current.get(pageNum);
    if (!wrapper) return;

    // Резервуємо слот одразу, щоб уникнути дубль-renderPage у наступному tick.
    renderedRef.current.add(pageNum);
    const myGen = renderGenRef.current;

    try {
      const page = await pdf.getPage(pageNum);
      if (myGen !== renderGenRef.current) {
        renderedRef.current.delete(pageNum);
        return;
      }
      const viewport = page.getViewport({ scale });
      const canvas = wrapper.querySelector('canvas');
      const textContainer = wrapper.querySelector('.textLayer');
      if (!canvas || !textContainer) {
        renderedRef.current.delete(pageNum);
        return;
      }

      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      const ctx = canvas.getContext('2d');
      const transform = outputScale !== 1
        ? [outputScale, 0, 0, outputScale, 0, 0]
        : null;

      const renderTask = page.render({ canvasContext: ctx, viewport, transform });
      renderTasksRef.current.set(pageNum, renderTask);
      await renderTask.promise;
      renderTasksRef.current.delete(pageNum);

      if (myGen !== renderGenRef.current) {
        renderedRef.current.delete(pageNum);
        return;
      }

      // Текстовий шар — окремий рендер після canvas.
      textContainer.innerHTML = '';
      const textContent = await page.getTextContent();
      if (myGen !== renderGenRef.current) {
        renderedRef.current.delete(pageNum);
        return;
      }
      const pdfjsLib = pdfjsLibRef.current;
      if (!pdfjsLib) {
        renderedRef.current.delete(pageNum);
        return;
      }
      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: textContainer,
        viewport,
      });
      await textLayer.render();
    } catch (e) {
      if (e.name !== 'RenderingCancelledException') {
        console.warn(`[PdfJsViewer] page ${pageNum} failed:`, e.message);
      }
      renderedRef.current.delete(pageNum);
    }
  }, [scale]);

  // Re-render при зміні масштабу: cancel поточних, очистити, нагадати observer'у.
  useEffect(() => {
    if (status !== 'ready') return;
    renderGenRef.current += 1;
    for (const t of renderTasksRef.current.values()) {
      try { t.cancel?.(); } catch (e) {}
    }
    renderTasksRef.current.clear();
    renderedRef.current.clear();
    // Очистити старі canvas/textLayer, інакше при zoom out лишаються великі
    // bitmap'и і textLayer-divi не співпадають з новим viewport.
    for (const wrapper of pageNodesRef.current.values()) {
      const canvas = wrapper.querySelector('canvas');
      const text = wrapper.querySelector('.textLayer');
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      if (text) text.innerHTML = '';
    }
    // Викликати renderPage для тих що вже у viewport.
    requestAnimationFrame(() => {
      const root = scrollRef.current;
      if (!root) return;
      const rootRect = root.getBoundingClientRect();
      for (const [num, el] of pageNodesRef.current.entries()) {
        const rect = el.getBoundingClientRect();
        const visibleish =
          rect.bottom > rootRect.top - 500 && rect.top < rootRect.bottom + 500;
        if (visibleish) renderPage(num);
      }
    });
  }, [scale, status, renderPage]);

  // IntersectionObserver — підключаємо коли стан 'ready'.
  useEffect(() => {
    if (status !== 'ready') return undefined;
    const root = scrollRef.current;
    if (!root) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const pageNum = parseInt(entry.target.dataset.page, 10);
          if (pageNum) renderPage(pageNum);
        }
      },
      { root, rootMargin: RENDER_MARGIN, threshold: 0.01 }
    );

    observerRef.current = observer;
    for (const el of pageNodesRef.current.values()) {
      observer.observe(el);
    }

    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [status, renderPage]);

  const setPageRef = useCallback((pageNum) => (el) => {
    if (el) {
      pageNodesRef.current.set(pageNum, el);
      observerRef.current?.observe(el);
    } else {
      pageNodesRef.current.delete(pageNum);
    }
  }, []);

  const handleZoomIn = () => setScale((s) => Math.min(MAX_SCALE, +(s + SCALE_STEP).toFixed(2)));
  const handleZoomOut = () => setScale((s) => Math.max(MIN_SCALE, +(s - SCALE_STEP).toFixed(2)));

  if (status === 'loading') {
    return (
      <div className="pdfjs-viewer__loading">
        <RefreshCw size={ICON_SIZE.md} className="pdfjs-viewer__spinner" />
        <span>Завантажуємо PDF...</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="pdfjs-viewer__error">
        <AlertTriangle size={32} />
        <p>Не вдалось рендерити PDF</p>
        <p className="pdfjs-viewer__error-detail">{errorMessage}</p>
      </div>
    );
  }

  return (
    <div className="pdfjs-viewer">
      <div className="pdfjs-viewer__toolbar">
        <button
          type="button"
          className="pdfjs-viewer__zoom-btn"
          onClick={handleZoomOut}
          disabled={scale <= MIN_SCALE}
          aria-label="Зменшити"
        >
          <ZoomOut size={ICON_SIZE.sm} />
        </button>
        <span className="pdfjs-viewer__zoom-value">{Math.round(scale * 100)}%</span>
        <button
          type="button"
          className="pdfjs-viewer__zoom-btn"
          onClick={handleZoomIn}
          disabled={scale >= MAX_SCALE}
          aria-label="Збільшити"
        >
          <ZoomIn size={ICON_SIZE.sm} />
        </button>
        <span className="pdfjs-viewer__page-count">{numPages} стор.</span>
      </div>
      <div className="pdfjs-viewer__pages" ref={scrollRef}>
        {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
          const bv = baseViewportsRef.current.get(pageNum);
          const w = bv ? bv.width * scale : 595;
          const h = bv ? bv.height * scale : 842;
          return (
            <div
              key={pageNum}
              ref={setPageRef(pageNum)}
              data-page={pageNum}
              className="pdfjs-viewer__page"
              style={{ width: `${w}px`, height: `${h}px` }}
              aria-label={`Сторінка ${pageNum} з ${numPages} — ${name || ''}`}
            >
              <canvas className="pdfjs-viewer__canvas" />
              <div className="textLayer" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
