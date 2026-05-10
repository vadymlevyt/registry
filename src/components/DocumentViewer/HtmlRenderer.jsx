// ── HtmlRenderer — рендер HTML з підтримкою кодувань (UTF-8, Windows-1251).
//
// Завантажуємо файл як ArrayBuffer (бо charset може бути не UTF-8), детектуємо
// кодування (BOM → Content-Type → meta-tag → fallback utf-8), декодуємо
// і рендеримо у sandbox-iframe через srcdoc.
//
// Особливий випадок ЄСІТС: HTML де реальні дані — у <meta> тегах (judges,
// sides, addresses) без видимого <body>. Якщо body порожній/малозмістовний,
// показуємо META-пари як таблицю ключ-значення.
//
// Помилка → empty state. Drive .txt не використовується як fallback.

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, Loader } from 'lucide-react';
import { Button } from '../UI';
import { ICON_SIZE } from '../UI/icons.js';
import { useDriveFileBuffer } from './useDriveFileBuffer.js';
import {
  decodeHtmlBuffer,
  extractEcitsMetaPairs,
  prepareHtmlForIframe,
} from '../../utils/htmlCharsetDetection.js';

const META_DOMINANT_BODY_THRESHOLD = 50; // якщо <body>...</body> текст < 50 символів І є META-пари → ЄСІТС режим

// Стилі що інжектяться у iframe srcdoc щоб документ виглядав як паперовий
// (чорний текст на білому аркуші A4 з тінню, на сірому фоні стола), незалежно
// від теми додатку. !important перебиває inline-стилі і color-схеми оригіналу.
const IFRAME_THEME_STYLE = `
  html, body { background: #e8e8ec !important; color: #000000 !important; margin: 0; padding: 30px 16px; }
  body, body * { color: #000000 !important; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 14px; line-height: 1.5; }
  .html-page {
    background: #ffffff !important;
    max-width: 794px;
    margin: 0 auto;
    padding: 60px 80px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    min-height: 1123px;
    box-sizing: border-box;
  }
  table { border-collapse: collapse; }
  table, td, th { border-color: #999 !important; }
  a { color: #1d4ed8 !important; text-decoration: underline; }
  img { max-width: 100%; height: auto; background: white; }
`;

function extractBodyText(html) {
  const m = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (!m) return '';
  return m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

export function HtmlRenderer({ driveId }) {
  const { data, contentType, loading, error, retry } = useDriveFileBuffer(driveId);
  const [decoded, setDecoded] = useState(null);
  const [decodeError, setDecodeError] = useState(null);

  useEffect(() => {
    if (!data) {
      setDecoded(null);
      setDecodeError(null);
      return;
    }
    try {
      const result = decodeHtmlBuffer(data, contentType);
      setDecoded(result);
      setDecodeError(null);
    } catch (e) {
      setDecoded(null);
      setDecodeError(e?.message || 'Не вдалось декодувати документ');
    }
  }, [data, contentType]);

  const ecitsPairs = useMemo(() => {
    if (!decoded?.text) return [];
    const bodyText = extractBodyText(decoded.text);
    if (bodyText.length >= META_DOMINANT_BODY_THRESHOLD) return [];
    return extractEcitsMetaPairs(decoded.text);
  }, [decoded]);

  if (loading) {
    return (
      <div className="document-viewer__loading">
        <Loader size={ICON_SIZE.md} />
        <span>Завантаження документа...</span>
      </div>
    );
  }

  if (error || decodeError) {
    return (
      <div className="document-viewer__empty-state">
        <AlertTriangle size={48} />
        <p>Не вдалось декодувати документ</p>
        <p className="document-viewer__empty-state-detail">{error || decodeError}</p>
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

  if (!decoded) return null;

  // ЄСІТС-формат: body порожній/коротенький, але є META-пари — показуємо таблицю.
  if (ecitsPairs.length > 0) {
    return (
      <div className="document-viewer__content document-viewer__content--html">
        <div className="html-ecits">
          <p className="html-ecits__hint">
            Документ старого формату ЄСІТС — реальні дані у META-тегах:
          </p>
          <table className="html-ecits__table">
            <tbody>
              {ecitsPairs.map((pair, i) => (
                <tr key={i}>
                  <td className="html-ecits__name">{pair.name}</td>
                  <td className="html-ecits__value">{pair.content}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Стандартний HTML — рендер у sandbox-iframe через srcdoc для ізоляції стилів.
  // prepareHtmlForIframe видаляє конфліктний <meta charset="windows-1251">
  // (інакше браузер всередині iframe інтерпретує наш UTF-16 рядок як CP1251 →
  // ромбіки) і інжектить <meta charset="utf-8"> + стилі для форсу чорного
  // на білому як паперовий документ.
  // sandbox без allow-scripts: ніяких скриптів не виконується. Виділення працює
  // нативно у iframe.
  const preparedHtml = prepareHtmlForIframe(decoded.text, IFRAME_THEME_STYLE, { wrapPage: true });
  return (
    <div className="document-viewer__content document-viewer__content--html">
      <iframe
        className="html-iframe"
        title="Документ"
        srcDoc={preparedHtml}
        sandbox="allow-same-origin"
      />
    </div>
  );
}
