// ── DP-3 · JOB PROGRESS TOPBAR ──────────────────────────────────────────────
// Єдиний UI DP-3 (повний екран прогресу — DP-4). Без нього streaming не має
// сенсу: адвокат має бачити що 250-сторінковий том обробляється у фоні.
//
// Встановлені рішення §3:
//   • зʼявляється ТІЛЬКИ коли є активні jobs (jobProgressStore), зникає по
//     завершенні — стор сам джерело «показувати чи ні».
//   • місце — горизонтальна смужка між логотипом і «збережено» (там вільно).
//   • згорнути ↔ розгорнути: топбар ↔ повноекранний прогрес (DP-3 — заглушка-
//     модалка з ТИМИ САМИМИ даними; повний UI DP-4).
//   • responsive: вузькі екрани (планшет вертикально/телефон) → 2 рядки, не
//     обрізання тексту; ДУЖЕ малі — компактна іконка (закладка-заглушка).
//   • НЕ floating widget (заважав би агенту досьє у правому нижньому куті).
//
// Стільниковий принцип: UI-стан локальний (відкрита модалка), доменні дані —
// з jobProgressStore (transient UI-стор, не App.jsx SSOT — як eventBus).

import React, { useEffect, useState } from 'react';
import { subscribe } from '../../services/documentPipeline/jobProgressStore.js';
import './styles.css';

function formatEta(ms) {
  if (ms == null) return null;
  if (ms <= 0) return 'майже готово';
  const s = Math.round(ms / 1000);
  if (s < 60) return `~${s} с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `~${m} хв`;
  const h = Math.floor(m / 60);
  return `~${h} год ${m % 60} хв`;
}

// onCancel(jobId) — ін'єктований із App (executor cancellation). У DP-3
// логіка скасування готова (streamingExecutor), UI підтвердження «зберегти
// N / видалити все» — заглушка DP-4. Якщо onCancel не передано — кнопка
// прихована (не показуємо мертвий контрол).
export default function JobProgressTopbar({ onCancel = null }) {
  const [jobs, setJobs] = useState([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => subscribe(setJobs), []);

  if (!jobs || jobs.length === 0) return null;          // нема jobs → топбар відсутній

  // Кілька jobs — показуємо агрегат (перший активний + лічильник).
  const primary = jobs[0];
  const more = jobs.length - 1;
  const pct = Math.round((primary.ratio || 0) * 100);
  const eta = formatEta(primary.etaMs);

  return (
    <>
      <div
        className="job-topbar"
        role="status"
        aria-live="polite"
        title="Натисніть щоб розгорнути прогрес"
      >
        <button className="job-topbar-main" onClick={() => setExpanded(true)}>
          <span className="job-topbar-spinner" aria-hidden="true" />
          <span className="job-topbar-title">
            {primary.title}{more > 0 ? ` (+${more})` : ''}
          </span>
          <span className="job-topbar-bar" aria-hidden="true">
            <span className="job-topbar-bar-fill" style={{ width: `${pct}%` }} />
          </span>
          <span className="job-topbar-meta">
            {pct}%{eta ? ` · ${eta}` : ''}
          </span>
        </button>
        {/* Закладка-заглушка: компактна іконка для дуже малих екранів.
            Активація — коли стане потрібна (CSS показує замість тексту). */}
        <span className="job-topbar-compact" aria-hidden="true" />
        <span className="job-topbar-actions">
          <button className="btn-sm btn-ghost" onClick={() => setExpanded(true)}>
            Розгорнути
          </button>
          {typeof onCancel === 'function' && (
            <button
              className="btn-sm btn-ghost"
              onClick={() => onCancel(primary.jobId)}
              title="Скасувати обробку"
            >
              Скасувати
            </button>
          )}
        </span>
      </div>

      {/* DP-3 заглушка повноекранного прогресу — ті самі дані. Повний UI DP-4. */}
      {expanded && (
        <div className="job-topbar-overlay" onClick={() => setExpanded(false)}>
          <div className="job-topbar-modal" onClick={(e) => e.stopPropagation()}>
            <div className="job-topbar-modal-head">
              <strong>Фонова обробка</strong>
              <button className="btn-sm btn-ghost" onClick={() => setExpanded(false)}>Згорнути</button>
            </div>
            {jobs.map((j) => (
              <div key={j.jobId} className="job-topbar-modal-row">
                <div className="job-topbar-title">{j.title}</div>
                <span className="job-topbar-bar">
                  <span className="job-topbar-bar-fill" style={{ width: `${Math.round((j.ratio || 0) * 100)}%` }} />
                </span>
                <div className="job-topbar-meta">
                  {j.done}/{j.total} · {Math.round((j.ratio || 0) * 100)}%
                  {j.etaMs != null ? ` · ${formatEta(j.etaMs)}` : ''}
                  {j.stage ? ` · ${j.stage}` : ''}
                </div>
                {typeof onCancel === 'function' && j.status === 'running' && (
                  <button className="btn-sm btn-ghost" onClick={() => onCancel(j.jobId)}>Скасувати</button>
                )}
              </div>
            ))}
            <div className="job-topbar-modal-note">
              Повноекранний прогрес-екран — у наступному оновленні (DP-4).
            </div>
          </div>
        </div>
      )}
    </>
  );
}
