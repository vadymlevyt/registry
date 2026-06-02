import { useEffect, useState } from 'react';
import { getCachedLayout } from '../../services/ocrService.js';
import { layoutToMarkdownDraft } from '../../services/cleanTextService.js';

/**
 * useExactLayout — джерело режиму «Точний» у в'ювері (V2-A1).
 *
 * Одна точка для двох питань: (а) чи доступна опція «Точний» (status==='ready');
 * (б) що рендерити (markdown). Тягне `<base>_<id>.layout.json` з 02_ОБРОБЛЕНІ
 * через `ocrService.getCachedLayout` і конвертує детермінованим конденсатором
 * `cleanTextService.layoutToMarkdownDraft` (КРОК 1, 0 токенів AI). Live, БЕЗ
 * зберігання на Drive — рахуємо на льоту щоразу (дешево, детерміновано).
 *
 * `enabled` — вмикати пробу ТІЛЬКИ для scanned-документів з перемикачем
 * (searchable / inline-renderable → false, жодного Drive-виклику). Це єдиний
 * сенс прапора: «цей документ — кандидат на режим Точний, спробуй зібрати».
 *
 * status:
 *   'idle'        — проба не запускалась (enabled=false або нема документа)
 *   'loading'     — layout тягнеться з Drive
 *   'ready'       — layout є і конденсатор дав непорожній Markdown (markdown!=null)
 *   'unavailable' — нема layout / порожній результат / помилка (опція ховається,
 *                   в'ювер не падає)
 *
 * @returns {{ status: string, markdown: string|null }}
 */
export function useExactLayout({ document, caseData, enabled }) {
  const [state, setState] = useState({ status: 'idle', markdown: null });

  const driveId = document?.driveId;
  const subFolders = caseData?.storage?.subFolders;
  const processedFolderId = subFolders?.['02_ОБРОБЛЕНІ'];

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle', markdown: null });
      return undefined;
    }
    if (!driveId || !processedFolderId) {
      setState({ status: 'unavailable', markdown: null });
      return undefined;
    }

    let cancelled = false;
    setState({ status: 'loading', markdown: null });

    // Імена з Drive — NFC-нормалізований Unicode (як у TextContent). Той самий
    // file-контракт що getCleanOrRawText — щоб getCachedLayout знайшов
    // <base>_<id>.layout.json за тим самим basename.
    const rawName = document.originalName || document.name || '';
    const normalizedName =
      typeof rawName.normalize === 'function' ? rawName.normalize('NFC') : rawName;
    const file = {
      id: driveId,
      name: normalizedName,
      mimeType: document.mimeType || 'application/pdf',
      subFolders,
    };

    (async () => {
      try {
        const layout = await getCachedLayout(file);
        if (cancelled) return;
        if (!layout) {
          setState({ status: 'unavailable', markdown: null });
          return;
        }
        const markdown = layoutToMarkdownDraft(layout);
        if (cancelled) return;
        if (!markdown || !String(markdown).trim()) {
          setState({ status: 'unavailable', markdown: null });
          return;
        }
        setState({ status: 'ready', markdown });
      } catch {
        // Нема layout / збій Drive / збій конденсатора → опція ховається,
        // в'ювер працює далі (Скан/Текст незмінні).
        if (!cancelled) setState({ status: 'unavailable', markdown: null });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, document?.id, driveId, processedFolderId]);

  return state;
}
