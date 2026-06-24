// ── A7.2 · ЛІНЬКУВАТИЙ РЕНДЕР СТОРІНКИ PDF (для оцінки межі на сканах) ────────
// §2.2: для сканів кривий OCR-текст не дає певності межі — на клік по картці
// рендеримо САМУ сторінку з _temp-оригіналу через pdf.js, ЛІНЬКУВАТО (лише ця
// сторінка, лише на вимогу). Текстові краї картки лишаються основним дешевим
// сигналом; це — підтвердження оком.
//
// pdf.js worker ініціалізовано глобально в App.jsx (GlobalWorkerOptions). Байти
// _temp-оригіналу тягнемо через Drive (readDriveFileBytes — re-auth усередині).
// Документ кешуємо у module-scope за driveId, щоб клік по сусідніх сторінках
// того ж файла не перезавантажував увесь PDF (велике джерело).

import { useEffect, useRef, useState } from 'react';
import { Loader, AlertTriangle } from 'lucide-react';
import { ICON_SIZE } from '../UI/icons.js';
import { readDriveFileBytes } from '../../services/driveService.js';

// Кеш getDocument-промісів за driveId (RAM живого сеансу; скидається з вкладкою).
const docCache = new Map();

async function loadPdf(driveId) {
  if (docCache.has(driveId)) return docCache.get(driveId);
  const promise = (async () => {
    const pdfjsLib = await import('pdfjs-dist');
    const bytes = await readDriveFileBytes(driveId);
    return pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
  })();
  docCache.set(driveId, promise);
  return promise;
}

export function SlicePagePreview({ driveId, pageNumber, maxWidth = 520 }) {
  const canvasRef = useRef(null);
  const [state, setState] = useState('loading');     // loading | ready | error

  useEffect(() => {
    let cancelled = false;
    let renderTask = null;
    setState('loading');
    (async () => {
      if (!driveId) { if (!cancelled) setState('error'); return; }
      try {
        const pdf = await loadPdf(driveId);
        if (cancelled) return;
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2, Math.max(0.4, maxWidth / base.width));
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d');
        renderTask = page.render({ canvasContext: ctx, viewport });
        await renderTask.promise;
        if (!cancelled) setState('ready');
      } catch (e) {
        if (cancelled) return;
        // Кеш міг застрягти на падінні fetch — прибираємо, щоб повтор спрацював.
        if (e?.name !== 'RenderingCancelledException') {
          docCache.delete(driveId);
          console.warn('[SlicePagePreview] render failed:', e?.message || e);
          setState('error');
        }
      }
    })();
    return () => {
      cancelled = true;
      try { renderTask?.cancel(); } catch { /* noop */ }
    };
  }, [driveId, pageNumber, maxWidth]);

  return (
    <div className="dp-slice-editor__preview-render">
      {state === 'loading' && (
        <div className="dpv2-muted dp-slice-editor__preview-status">
          <Loader size={ICON_SIZE.sm} /> Рендер сторінки {pageNumber}…
        </div>
      )}
      {state === 'error' && (
        <div className="dpv2-muted dp-slice-editor__preview-status">
          <AlertTriangle size={ICON_SIZE.sm} /> Не вдалось показати сторінку (доступна після «Виконати» у в’ювері).
        </div>
      )}
      <canvas ref={canvasRef} style={{ maxWidth: '100%', display: state === 'ready' ? 'block' : 'none' }} />
    </div>
  );
}
