// DP-4 bugfix (Bug 2/3) · ГЛОБАЛЬНИЙ ПРОГРЕС-ЕКРАН.
// Раніше DocumentProcessorV2 рендерив ProgressFullScreen локально (вкладка
// docwork) ОДНОЧАСНО з глобальним JobProgressTopbar (App) → дублювання; а
// «Згорнути» вело у локальний стан, з якого топбар не міг повернути назад.
//
// Тепер єдине джерело правди «згорнуто/розгорнуто» — DocumentPipelineContext.
// Повний екран і топбар ВЗАЄМОВИКЛЮЧНІ: повний екран показується ТІЛЬКИ коли
// є активний job І !progressMinimized; інакше — топбар (App). Перехід
// двосторонній: «Згорнути» → minimizeProgress() (топбар), клік топбару →
// expandProgress() (повний екран). Оверлей фіксований — позиція в DOM не
// важлива, тому монтується поряд з модалками App усередині Provider.
import { useJobProgress } from './useJobProgress.js';
import { ProgressFullScreen } from './ProgressFullScreen.jsx';
import { useDocumentPipeline } from '../../contexts/documentPipelineContextCore.js';

export default function GlobalProgressScreen({ cases = [] }) {
  const ctx = useDocumentPipeline();
  const jobs = useJobProgress();
  if (!ctx || ctx.progressMinimized) return null;
  if (!jobs || jobs.length === 0) return null;

  const job = jobs[0];
  const caseData = cases.find((c) => c.id === job.caseId) || null;

  return (
    <ProgressFullScreen
      job={job}
      caseData={caseData}
      onCancel={(jobId) => ctx.cancel(jobId)}
      onMinimize={ctx.minimizeProgress}
    />
  );
}
