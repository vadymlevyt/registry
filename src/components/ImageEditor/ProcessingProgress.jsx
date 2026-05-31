// ── ImageEditor · ProcessingProgress ─────────────────────────────────────────
// СПІЛЬНИЙ індикатор прогресу довгих фото-операцій image-editor (борг #34,
// фото-частина; правило #30 — один шлях, не локальний дубль).
//
// Два варіанти однієї логіки:
//   variant="screen"  — повноекранна фаза обробки (spinner + лейбл + лічильник +
//                       прогрес-бар + опційний stepper по фазах). Споживач:
//                       модалка ImageMergePanel (ProcessingView).
//   variant="badge"   — компактний неблокуючий поп-ап/бейдж поверх редактора
//                       (spinner + лейбл + лічильник + тонкий бар). Споживач:
//                       DpImageMergeEditor startup (edge-detection та ін.).
//
// Чиста презентація: жодного стану/ефектів. Прогрес приходить пропами
// (phase/done/total) — той самий контракт onProgress(phase, done, total), що
// в pipeline/edge-detection. Стилі — у спільному imageEditor.css.

const STATE_BY_POSITION = (idx, currentIdx) =>
  (idx < currentIdx ? 'done' : idx === currentIdx ? 'active' : 'pending');

export function ProcessingProgress({
  label,                 // явний лейбл; якщо нема — береться з активного step
  phase,                 // ключ активної фази (для stepper / деривації лейбла)
  done = 0,
  total = 0,
  steps = null,          // [{ key, label }] → рендерити stepper (screen-варіант)
  variant = 'screen',    // 'screen' | 'badge'
  showSpinner = true,
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const currentIdx = steps ? steps.findIndex((p) => p.key === phase) : -1;
  const displayLabel = label
    || (currentIdx >= 0 ? steps[currentIdx].label : '')
    || 'Обробка…';
  const showCounter = total > 1 && done < total;
  const showBar = total > 0;

  return (
    <div className={`image-editor__progress image-editor__progress--${variant}`}>
      {showSpinner && <div className="image-editor__progress-spinner" aria-hidden="true" />}

      <div className="image-editor__progress-label">
        {displayLabel}
        {showCounter && (
          <span className="image-editor__progress-counter">
            {' '}{done} / {total}
          </span>
        )}
      </div>

      {showBar && (
        <div
          className="image-editor__progress-bar"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="image-editor__progress-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      )}

      {steps && steps.length > 0 && (
        <div className="image-editor__progress-stepper">
          {steps.map((step, idx) => {
            const state = STATE_BY_POSITION(idx, currentIdx < 0 ? 0 : currentIdx);
            return (
              <div
                key={step.key}
                className={`image-editor__progress-step image-editor__progress-step--${state}`}
              >
                <span className="image-editor__progress-step-dot" aria-hidden="true">
                  {state === 'done' ? '✓' : (idx + 1)}
                </span>
                <span className="image-editor__progress-step-label">{step.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
