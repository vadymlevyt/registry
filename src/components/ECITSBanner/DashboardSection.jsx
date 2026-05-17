// DP-4 · ECITS Точка 3 — секція Дашборду «Нові надходження з ЄСІТС».
// Список справ з непорожнім INBOX (ecitsPending з DocumentPipelineContext).
// Рендериться лише коли є хоч одна справа з надходженнями (нуль hardcoded).
import { Mail } from 'lucide-react';
import { ICON_SIZE } from '../UI/icons.js';
import { Button } from '../UI';
import { useDocumentPipeline } from '../../contexts/DocumentPipelineContext.jsx';
import './styles.css';

export function ECITSDashboardSection({ cases = [], onOpenCase }) {
  const pipeline = useDocumentPipeline();
  const pending = pipeline?.ecitsPending || {};
  const withInbox = (cases || [])
    .map((c) => ({ c, count: pending[c.id] || 0 }))
    .filter((x) => x.count > 0);

  if (withInbox.length === 0) return null;

  return (
    <div className="ecits-dash">
      <div className="ecits-dash-title">
        <Mail size={ICON_SIZE.sm} />
        Нові надходження з ЄСІТС
      </div>
      {withInbox.map(({ c, count }) => (
        <div key={c.id} className="ecits-dash-row">
          <span className="ecits-grow">{c.name}</span>
          <span className="ecits-dash-count">{count} нових</span>
          <Button variant="secondary" size="sm" onClick={() => onOpenCase && onOpenCase(c.id)}>
            Обробити
          </Button>
        </div>
      ))}
    </div>
  );
}
