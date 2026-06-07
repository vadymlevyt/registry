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

// Режими інгесту (один сенс на значення, правило #11):
//   'slice'      — конвеєр з нарізкою/потоковим OCR (streamingExecutor + AI
//                  Triage). Default: DP-нарізка і поточна поведінка.
//   'add_as_is'  — кожен файл = один документ, БЕЗ нарізки; усі типи
//                  (PDF/HTML/DOCX/image) і будь-яка КОМБІНАЦІЯ за раз через
//                  converterService (non-streaming per-file). Споживачі:
//                  модалка «+ Додати документ» і DP-тумблер «Просто додати».
export const INGEST_MODE = Object.freeze({ SLICE: 'slice', ADD_AS_IS: 'add_as_is' });

// createIngest — фабрика фасаду.
//   runPipeline(input, options)  → Promise<result>
//     Запуск конвеєра з нарізкою (streamingExecutor.run через Context-обгортку).
//     Контракт результату — той самий що executor.run.
//   runAddAsIs(input, options)?  → Promise<result>
//     Non-streaming per-file додавання (mode 'add_as_is'). Опційний: якщо не
//     переданий, виклик з mode 'add_as_is' кине (TASK 4 етап C активує).
export function createIngest({ runPipeline, runAddAsIs } = {}) {
  if (typeof runPipeline !== 'function') {
    throw new Error('createIngest: runPipeline обовʼязковий');
  }

  // ingestFiles — єдина точка входу додавання.
  //   input   — { caseId, caseData, files:[...], agentId, source, addedBy,
  //              conversionContext?, jobId? } (той самий вхід що executor.run).
  //   options — { mode?, ocrMode?, compress?, onProgress?, ...pipelineSettings }.
  //             mode маршрутизує (slice ↔ add_as_is) і НЕ прокидається далі.
  //             pipelineSettings (skipPdfSlicing/autoConfirm/collectDataset/
  //             buildDocumentMetadata/deferOcr/…) прокидаються БЕЗ змін.
  // Повертає той самий результат, що runPipeline/runAddAsIs; на порожньому
  // вході — { ok:false, error:{ code:'NO_FILES' } } (не кидає — caller toast).
  async function ingestFiles(input = {}, options = {}) {
    const files = Array.isArray(input.files) ? input.files : [];
    if (files.length === 0) {
      return { ok: false, error: { code: 'NO_FILES', message: 'Немає файлів для обробки' } };
    }
    const {
      mode = INGEST_MODE.SLICE,
      ocrMode = DEFAULT_OCR_MODE,
      compress = false,
      ...pipelineSettings
    } = options;
    // ocrMode/compress лягають у опції прогону поряд з налаштуваннями DP.
    // Споживачі ocrMode/compress у streaming-гілці з'являться у D/E.
    const runOptions = { ...pipelineSettings, ocrMode, compress };

    // 'add_as_is' — труба без нарізки (усі типи + комбо). Один файл = один
    // документ; converterService приводить до PDF; searchable/конвертовані
    // читаються на вимогу. Етап C — спільний шлях для модалки і DP «просто
    // додати».
    if (mode === INGEST_MODE.ADD_AS_IS) {
      if (typeof runAddAsIs !== 'function') {
        throw new Error('createIngest: runAddAsIs обовʼязковий для mode add_as_is');
      }
      return runAddAsIs(input, runOptions);
    }

    return runPipeline(input, runOptions);
  }

  return { ingestFiles };
}
