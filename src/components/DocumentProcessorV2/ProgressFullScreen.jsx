// DP-4 · Зона 4 — повноекранний прогрес-екран. Замінює DP-3 заглушку-модалку.
// Доменні дані — з jobProgressStore (transient UI-стор DP-3, реальний драйвер
// прогресу: push від executor + Drive-poll fallback). Нуль hardcoded preview.
import { Button } from '../UI';
import { X, Loader, Check, AlertTriangle } from 'lucide-react';
import { ICON_SIZE } from '../UI/icons.js';
import './styles.css';

function fmtEta(ms) {
  if (ms == null) return null;
  if (ms <= 0) return 'майже готово';
  const s = Math.round(ms / 1000);
  if (s < 60) return `~${s} с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `~${m} хв`;
  return `~${Math.floor(m / 60)} год ${m % 60} хв`;
}

// job — snapshot з jobProgressStore для цієї справи (або null → не рендеримо).
export function ProgressFullScreen({ job, caseData, onCancel, onMinimize }) {
  if (!job) return null;
  const pct = Math.round((job.ratio || 0) * 100);
  const eta = fmtEta(job.etaMs);
  const stage = job.stage || 'processing';
  const finished = job.status !== 'running';

  return (
    <div className="dpv2-progress-overlay" role="dialog" aria-modal="true">
      <div className="dpv2-progress">
        <div className="dpv2-progress-head">
          <div>
            <div className="dpv2-progress-case">{caseData?.name || 'Обробка документів'}</div>
            <div className="dpv2-progress-sub">
              {caseData?.case_no ? `№${caseData.case_no} · ` : ''}{job.title}
            </div>
          </div>
          <button
            className="dpv2-iconbtn"
            onClick={onMinimize}
            title="Згорнути у топбар"
            aria-label="Згорнути"
          >
            <X size={ICON_SIZE.md} />
          </button>
        </div>

        <div>
          <div className="dpv2-progress-overall">
            <span>
              {finished
                ? (job.status === 'cancelled' ? 'Скасовано' : 'Завершено')
                : `Опрацьовано ${job.done || 0} з ${job.total || 0} блоків`}
            </span>
            <span>{pct}%{eta && !finished ? ` · ${eta}` : ''}</span>
          </div>
          <div className="dpv2-bar" aria-hidden="true">
            <span className="dpv2-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="dpv2-filelist">
          <div className="dpv2-filerow">
            <span className={finished ? 'dpv2-st-done' : 'dpv2-st-proc'}>
              {finished
                ? (job.status === 'cancelled'
                    ? <AlertTriangle size={ICON_SIZE.sm} />
                    : <Check size={ICON_SIZE.sm} />)
                : <Loader size={ICON_SIZE.sm} className="dpv2-spin" />}
            </span>
            <span className="dpv2-grow">{job.title}</span>
            <span className="dpv2-list-meta">{job.done || 0}/{job.total || 0}</span>
          </div>
        </div>

        <div className="dpv2-progress-chunk">
          Стадія: {stage}
        </div>

        <div className="dpv2-progress-actions">
          {!finished && typeof onCancel === 'function' && (
            <Button variant="danger" onClick={() => onCancel(job.jobId)}>Скасувати</Button>
          )}
          <Button variant="secondary" onClick={onMinimize}>Згорнути</Button>
        </div>
      </div>
    </div>
  );
}
