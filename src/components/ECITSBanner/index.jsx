// DP-4 · ECITS Банер (Точка 1 індикації нових надходжень з Court Sync).
// Дані — з DocumentPipelineContext.ecitsPending (ecitsInboxWatcher manual-режим
// публікує ECITS_INBOX_PENDING; провайдер тримає Map caseId→count). Нуль
// hardcoded — рендериться лише коли count > 0.
import { Button } from '../UI';
import { Mail } from 'lucide-react';
import { ICON_SIZE } from '../UI/icons.js';
import { useDocumentPipeline } from '../../contexts/DocumentPipelineContext.jsx';
import './styles.css';

export function ECITSBanner({ caseId, onProcess, onViewList }) {
  const pipeline = useDocumentPipeline();
  const count = pipeline?.ecitsPending?.[caseId] || 0;
  if (count <= 0) return null;

  return (
    <div className="ecits-banner" role="status">
      <span className="ecits-banner-icon"><Mail size={ICON_SIZE.md} /></span>
      <span className="ecits-banner-text">
        В INBOX {count} нових файлів від Court Sync
      </span>
      <span className="ecits-banner-actions">
        <Button variant="primary" size="sm" onClick={onProcess}>Обробити</Button>
        <Button variant="ghost" size="sm" onClick={onViewList}>Дивитись список</Button>
      </span>
    </div>
  );
}
