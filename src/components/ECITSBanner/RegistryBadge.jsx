// DP-4 · ECITS Точка 2 — індикатор [✉ N] на картці справи в Реєстрі.
// Дані з DocumentPipelineContext.ecitsPending. Нуль hardcoded — null коли 0.
import { Mail } from 'lucide-react';
import { ICON_SIZE } from '../UI/icons.js';
import { useDocumentPipeline } from '../../contexts/DocumentPipelineContext.jsx';
import './styles.css';

export function ECITSRegistryBadge({ caseId }) {
  const pipeline = useDocumentPipeline();
  const count = pipeline?.ecitsPending?.[caseId] || 0;
  if (count <= 0) return null;
  return (
    <span className="ecits-reg-badge" title={`${count} нових надходжень з ЄСІТС`}>
      <Mail size={ICON_SIZE.xs} />
      {count}
    </span>
  );
}
