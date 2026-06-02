import { useState } from 'react';
import { ExternalLink, Download, Copy, Share2, Bot, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '../UI';
import { ICON_SIZE } from '../UI/icons.js';
import { toast } from '../../services/toast.js';
import { driveRequest } from '../../services/driveAuth.js';
import { getCachedText } from '../../services/ocrService.js';

/**
 * Підвал Viewer'а — 6 дій. Перерозпізнати показуємо тільки для scanned.
 * Поділитись — тільки якщо доступний Web Share API (мобільні / частина десктопів).
 *
 * Копіювати працює тільки в режимі text — в scan тексту немає (показуємо
 * підказку перейти в режим Текст).
 */
export function DocumentViewerFooter({
  document,
  caseData,
  mode,
  onDiscussWithAgent,
  onReprocess,
  onCleanText,
}) {
  const isScanned = document.documentNature === 'scanned';
  const hasDrive = !!document.driveId;
  // TASK 3.2 — «Очистити документ»: лише scanned + сирий (textFormat!=='md').
  // searchable / вже очищені (.md) — поза скоупом, кнопки немає.
  const canClean = isScanned && document.textFormat !== 'md' && hasDrive && typeof onCleanText === 'function';
  const [cleaning, setCleaning] = useState(false);

  const handleClean = async () => {
    if (cleaning) return;
    setCleaning(true);
    try {
      await onCleanText(document);
    } finally {
      setCleaning(false);
    }
  };
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const handleOpenInDrive = () => {
    if (!hasDrive) {
      toast.warning('Файл недоступний на Drive');
      return;
    }
    window.open(
      `https://drive.google.com/file/d/${document.driveId}/view`,
      '_blank',
      'noopener,noreferrer'
    );
  };

  const handleDownload = async () => {
    if (!hasDrive) {
      toast.warning('Файл недоступний на Drive');
      return;
    }
    try {
      const res = await driveRequest(
        `https://www.googleapis.com/drive/v3/files/${document.driveId}?alt=media`
      );
      if (!res.ok) throw new Error(`Drive ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = document.originalName || document.name || 'document';
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error('Не вдалось завантажити', {
        description: err.message || 'Перевірте підключення Drive і спробуйте ще раз',
      });
    }
  };

  const handleCopy = async () => {
    if (mode !== 'text') {
      toast.info('Перейдіть у режим Текст щоб скопіювати вміст');
      return;
    }
    const subFolders = caseData?.storage?.subFolders;
    if (!hasDrive || !subFolders?.['02_ОБРОБЛЕНІ']) {
      toast.warning('Текст недоступний для копіювання');
      return;
    }
    try {
      const file = {
        id: document.driveId,
        name: document.originalName || document.name,
        mimeType: document.mimeType || 'application/pdf',
        subFolders,
      };
      const text = await getCachedText(file);
      if (!text) {
        toast.info('Текст ще не розпізнано — спочатку запустіть розпізнавання');
        return;
      }
      await navigator.clipboard.writeText(text);
      toast.success('Скопійовано');
    } catch (err) {
      toast.error('Не вдалось скопіювати', {
        description: err.message || 'Браузер заблокував доступ до буфера обміну',
      });
    }
  };

  const handleShare = async () => {
    if (!canShare) return;
    try {
      await navigator.share({
        title: document.name,
        url: hasDrive
          ? `https://drive.google.com/file/d/${document.driveId}/view`
          : window.location.href,
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        toast.error('Не вдалось поділитись', { description: err.message });
      }
    }
  };

  const handleReprocess = () => {
    if (!hasDrive) {
      toast.warning('Файл недоступний на Drive');
      return;
    }
    onReprocess && onReprocess(document);
  };

  return (
    <footer className="document-viewer__footer">
      <Button
        variant="ghost"
        size="sm"
        icon={<ExternalLink size={ICON_SIZE.sm} />}
        onClick={handleOpenInDrive}
        disabled={!hasDrive}
      >
        Drive
      </Button>

      <Button
        variant="ghost"
        size="sm"
        icon={<Download size={ICON_SIZE.sm} />}
        onClick={handleDownload}
        disabled={!hasDrive}
      >
        Завантажити
      </Button>

      <Button
        variant="ghost"
        size="sm"
        icon={<Copy size={ICON_SIZE.sm} />}
        onClick={handleCopy}
        disabled={mode !== 'text'}
      >
        Копіювати
      </Button>

      {canShare && (
        <Button
          variant="ghost"
          size="sm"
          icon={<Share2 size={ICON_SIZE.sm} />}
          onClick={handleShare}
        >
          Поділитись
        </Button>
      )}

      <Button
        variant="ghost"
        size="sm"
        icon={<Bot size={ICON_SIZE.sm} />}
        onClick={() => onDiscussWithAgent && onDiscussWithAgent(document)}
      >
        Обговорити
      </Button>

      {isScanned && (
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshCw size={ICON_SIZE.sm} />}
          onClick={handleReprocess}
          disabled={!hasDrive}
        >
          Перерозпізнати
        </Button>
      )}

      {canClean && (
        <Button
          variant="ghost"
          size="sm"
          icon={<Sparkles size={ICON_SIZE.sm} />}
          onClick={handleClean}
          disabled={cleaning}
        >
          {cleaning ? 'Очищаю…' : 'Очистити документ'}
        </Button>
      )}
    </footer>
  );
}
