// ── ImageMergePanel · ProcessingView ─────────────────────────────────────────
// Сторінка-індикатор фази processing: spinner + phase label + progress bar +
// stepper по 6 фазах pipeline (preparing / heic / ocr / sort / rotate / pdf).

import { PHASES } from '../../ImageEditor/constants.js';

export function ProcessingView({ progress }) {
  const currentIdx = PHASES.findIndex((p) => p.key === progress.phase);
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const currentPhase = PHASES[currentIdx] || PHASES[0];

  return (
    <div className="image-merge-panel__processing">
      <div className="image-merge-panel__processing-spinner" aria-hidden="true" />

      <div className="image-merge-panel__processing-label">
        {currentPhase.label}
        {progress.total > 1 && progress.done < progress.total && (
          <span className="image-merge-panel__processing-counter">
            {' '}{progress.done} / {progress.total}
          </span>
        )}
      </div>

      <div className="image-merge-panel__processing-bar" role="progressbar" aria-valuenow={pct}>
        <div
          className="image-merge-panel__processing-bar-fill"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="image-merge-panel__phase-stepper">
        {PHASES.map((phase, idx) => {
          const state =
            idx < currentIdx ? 'done' :
            idx === currentIdx ? 'active' :
            'pending';
          return (
            <div
              key={phase.key}
              className={`image-merge-panel__phase-step image-merge-panel__phase-step--${state}`}
            >
              <span className="image-merge-panel__phase-step-dot" aria-hidden="true">
                {state === 'done' ? '✓' : (idx + 1)}
              </span>
              <span className="image-merge-panel__phase-step-label">{phase.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
