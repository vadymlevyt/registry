// ── ImageMergePanel · ProcessingView ─────────────────────────────────────────
// Сторінка-індикатор фази processing. Делегує рендер СПІЛЬНОМУ компоненту
// ProcessingProgress (борг #34, правило #30) — spinner + лейбл + лічильник +
// прогрес-бар + stepper по 6 фазах pipeline (preparing/heic/ocr/sort/rotate/pdf).
// Власної розмітки прогресу більше не тримає (нуль дубльованого UI).

import { PHASES } from '../../ImageEditor/constants.js';
import { ProcessingProgress } from '../../ImageEditor/ProcessingProgress.jsx';

export function ProcessingView({ progress }) {
  return (
    <ProcessingProgress
      variant="screen"
      phase={progress.phase}
      done={progress.done}
      total={progress.total}
      steps={PHASES}
    />
  );
}
