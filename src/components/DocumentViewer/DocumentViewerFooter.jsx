import { ExternalLink, Download, Copy, Share2, Bot, RefreshCw } from 'lucide-react';
import { Button } from '../UI';
import { ICON_SIZE } from '../UI/icons.js';
import { toast } from '../../services/toast.js';
import { driveRequest } from '../../services/driveAuth.js';
import { getDocumentText } from '../../services/ocrService.js';

/**
 * Підвал Viewer'а — 5 дій. Перерозпізнати показуємо тільки для scanned.
 * Поділитись — тільки якщо доступний Web Share API (мобільні / частина десктопів).
 *
 * Копіювати активне у текстових режимах (Точний/Чистий/Конспект) — у «Скан»/
 * «Документ» копіювати нема чого. Копіюємо ВІРНИЙ текст (getDocumentText, layout→
 * .txt), НІКОЛИ не переказ-Конспект — для юр-цитат потрібен дослівний шар.
 *
 * V2-B: кнопку «Очистити документ» (3.2) прибрано — генерація Чистий/Конспект
 * живе у вкладках перемикача (один шлях, правило #11).
 */
export function DocumentViewerFooter({
  document,
  caseData,
  mode,
  onDiscussWithAgent,
  onReprocess,
}) {
  const isScanned = document.documentNature === 'scanned';
  const hasDrive = !!document.driveId;
  // У режимі «Скан»/«Документ» (value 'scan') тексту для копіювання немає.
  const canCopy = mode !== 'scan';
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
    if (!canCopy) {
      toast.info('Перейдіть у текстовий режим (Точний/Чистий/Конспект) щоб скопіювати вміст');
      return;
    }
    const subFolders = caseData?.storage?.subFolders;
    if (!hasDrive || !subFolders?.['02_ОБРОБЛЕНІ']) {
      toast.warning('Текст недоступний для копіювання');
      return;
    }
    try {
      const text = await getDocumentText(document, caseData);
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
        disabled={!canCopy}
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
    </footer>
  );
}
