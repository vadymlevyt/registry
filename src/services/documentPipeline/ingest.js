// ── TASK 4 · INGEST — одна труба додавання файлів ───────────────────────────
// «Додати файли в систему» — ОДНЕ питання з кількома входами (модалка, DP
// нарізка/склейка/«просто додати», у майбутньому ZIP). До цього таску воно
// жило двома паралельними шляхами обробки. `ingest.js` — ЄДИНИЙ фасад, який
// нормалізує вхід і делегує у streaming-конвеєр (RAM-чанки/resume/нарізка).
//
// Тонкий оркестратор (ПРИНЦИП спеки): жодної бізнес-логіки OCR/нарізки тут —
// лише дротування. Гілки `ocrMode`/`compress` живуть НИЖЧЕ (streamingExecutor
// + buildPipelineDeps, етапи D/E); ingest їх лише ПРОКИДАЄ як опції прогону,
// застосовуючи дефолти. На етапі A їх ніхто не споживає — поведінка незмінна.
//
// Чиста фабрика DI (як createActions / createStreamingExecutor): нуль
// глобальних сінглтонів. `runPipeline(input, options)` приходить ззовні —
// це Context-обгортка над executor.run, яка вже прокидає options у
// runOptionsRef → buildPipelineDeps (стан/Drive/AI/білінг лишаються там).

// Дефолт режиму OCR на додаванні. 'full' = поточна поведінка (Document AI
// повний OCR + артефакти у 02_ОБРОБЛЕНІ). Режим «без OCR» вмикається явно на
// етапі D — тут лише дефолт, щоб ingest не нав'язував поведінки.
export const DEFAULT_OCR_MODE = 'full';

// createIngest — фабрика фасаду.
//   runPipeline(input, options) → Promise<result>
//     ЄДИНА залежність: функція запуску конвеєра. Контракт результату —
//     той самий що executor.run (ok/jobId/documents/decisions/errors/…).
export function createIngest({ runPipeline } = {}) {
  if (typeof runPipeline !== 'function') {
    throw new Error('createIngest: runPipeline обовʼязковий');
  }

  // ingestFiles — єдина точка входу додавання.
  //   input   — { caseId, caseData, files:[...], agentId, source, addedBy,
  //              conversionContext?, jobId? } (той самий вхід що executor.run).
  //   options — { ocrMode?, compress?, onProgress?, ...pipelineSettings }.
  //             pipelineSettings (skipPdfSlicing/autoConfirm/collectDataset/…)
  //             прокидаються БЕЗ змін — ingest їх не інтерпретує.
  // Повертає той самий результат, що runPipeline; на порожньому вході —
  // { ok:false, error:{ code:'NO_FILES' } } (не кидає — caller показує toast).
  async function ingestFiles(input = {}, options = {}) {
    const files = Array.isArray(input.files) ? input.files : [];
    if (files.length === 0) {
      return { ok: false, error: { code: 'NO_FILES', message: 'Немає файлів для обробки' } };
    }
    const {
      ocrMode = DEFAULT_OCR_MODE,
      compress = false,
      ...pipelineSettings
    } = options;
    // ocrMode/compress лягають у опції прогону поряд з налаштуваннями DP.
    // Споживачі (streamingExecutor/buildPipelineDeps) з'являться у D/E; на
    // етапі A вони присутні, але інертні → поведінка байт-у-байт та сама.
    const runOptions = { ...pipelineSettings, ocrMode, compress };
    return runPipeline(input, runOptions);
  }

  return { ingestFiles };
}
