// ── useDriveFileBuffer — спільний хук завантаження Drive-файла як ArrayBuffer.
// Використовується PdfRenderer, DocxRenderer, HtmlRenderer.
//
// driveRequest з driveAuth обробляє 401 (silent re-auth + 1 retry) сам, тому
// тут стандартизуємо лише форму стану і expose retry() для empty-state кнопки.

import { useState, useEffect, useCallback } from 'react';
import { driveRequest } from '../../services/driveAuth.js';

export function useDriveFileBuffer(driveId) {
  const [state, setState] = useState({
    data: null,
    contentType: null,
    loading: !!driveId,
    error: null,
  });
  const [retryNonce, setRetryNonce] = useState(0);

  const retry = useCallback(() => setRetryNonce(n => n + 1), []);

  useEffect(() => {
    if (!driveId) {
      setState({ data: null, contentType: null, loading: false, error: 'no-drive-id' });
      return undefined;
    }
    let cancelled = false;
    setState({ data: null, contentType: null, loading: true, error: null });

    (async () => {
      try {
        const res = await driveRequest(
          `https://www.googleapis.com/drive/v3/files/${driveId}?alt=media`
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const contentType = res.headers.get('content-type') || '';
        const buffer = await res.arrayBuffer();
        if (cancelled) return;
        setState({ data: buffer, contentType, loading: false, error: null });
      } catch (e) {
        if (cancelled) return;
        setState({
          data: null,
          contentType: null,
          loading: false,
          error: e?.message || 'Не вдалось завантажити файл',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [driveId, retryNonce]);

  return { ...state, retry };
}
