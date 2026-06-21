// ── DP-3 · STREAMING EXECUTOR ───────────────────────────────────────────────
// Координатор streaming-обробки. ФУНДАМЕНТ МАСШТАБОВАНОСТІ: великий том /
// 30-файловий пакет на планшеті без вбивства вкладки. У RAM — байти ОДНОГО
// chunk, ніколи весь файл.
//
// Лайфцикл одного файла (встановлене рішення §4.1 + §5 узгоджено — пояснення
// у звіті §12: робоча копія оригіналу живе в `_temp/` поки йде обробка, бо
// §5 каже «оригінал адвоката НЕ зберігається», а §4.1 — «видаляється з RAM»;
// фінальні нарізані документи → 01_ОРИГІНАЛИ; `_temp` чиститься на успіху):
//   1. upload оригіналу у _temp/<caseId>_<jobId>/ → driveId → байти з RAM геть
//   2. chunkManager.planChunks (memory-aware) → діапазони сторінок
//   3. для кожного chunk: materialize у _temp → read bytes → processChunk
//      (OCR) → текст у jobState → ЗАНУЛИТИ байти chunk → save jobState +
//      progress + ETA
//   4. mergeText (Worker) → уніфікований текст файла
//   5. pipeline.run(files[].extractedText=текст, driveId=temp) — detect→
//      classify→extract→confirm→split(persist)→emit (стадії V3 через
//      stageOverrides; диригент НЕ змінюється)
//   6. успіх → jobState.clearState (чистить _temp: chunks + temp-оригінал +
//      job_state); fatal → лишаємо jobState (resumable), стоп з повідомленням
//
// Універсальність (§4.1): один файл / пакет 2-5 / 30+ файлів — ТОЙ САМИЙ
// шлях, різниця лише в обсязі. Жодних мінімальних обмежень входу.
//
// Чиста фабрика DI (як createActions/createDocumentPipeline). Нуль глобальних
// сінглтонів. Worker/Drive/AI/pipeline — через deps.

import { createWorkerClient } from './workerClient.js';
import { createChunkManager } from './chunkManager.js';
import {
  createJobStateStore, makeInitialJobState, jobProgress, estimateRemainingMs, JOB_STATUS,
} from './jobState.js';
import * as progressStore from './jobProgressStore.js';
import { stageLabel } from './stageLabels.js';
import { NOOP_DIAG } from './diagLogger.js';

function mb(bytes) {
  return Number((Number(bytes || 0) / 1024 / 1024).toFixed(2));
}

const ONE_GB = 1024 * 1024 * 1024;

// Рекомендований мінімум вільного місця (§4.11). >500МБ пакет → 5ГБ.
function freeSpaceVerdict(quota, estimatedBytes) {
  if (!quota || quota.limitless) return { ok: true };
  if (quota.free < ONE_GB) {
    return { ok: false, code: 'DRIVE_FULL', message: 'Звільніть місце на Drive (потрібно щонайменше 1 ГБ) і натисніть Продовжити.' };
  }
  if (estimatedBytes > 500 * 1024 * 1024 && quota.free < 5 * ONE_GB) {
    return { ok: true, warning: 'Місця обмаль — рекомендовано звільнити перед великим пакетом.' };
  }
  return { ok: true };
}

// deps:
//   drivePort                       — DP-3 Drive-порт (createDefaultDrivePort)
//   createPipeline(pipeDeps)→{run}  — createDocumentPipeline (інʼєкт для тестів)
//   pipelineDeps                    — deps для pipeline (stageOverrides V3 тощо)
//   processChunk({bytes,startPage,endPage,fileId}) → {text, layoutJson?}
//                                     — OCR одного chunk (default: ocrService;
//                                       тест — детермінований стаб)
//   workerClient?                   — createWorkerClient (default: новий)
//   getActor?()                     — {userId,tenantId} для подій/квоти
//   onProgress?(snapshot)           — додатковий підписник (крім progressStore)
//   isCancelled?()→boolean          — кооперативне скасування
//   compressBuffer?(ab)→{bytes,compressed,skipped,reason,inBytes,outBytes}
//                                     — TASK 4 E: стиснути scanned PDF ПЕРЕД
//                                       нарізкою (фіксований Середній, pdf-lib).
//   shouldCompress?()→boolean       — читати прапор compress прогону (runOptions)
export function createStreamingExecutor(deps = {}) {
  const { drivePort } = deps;
  if (!drivePort) throw new Error('createStreamingExecutor: drivePort обовʼязковий');
  if (typeof deps.createPipeline !== 'function') throw new Error('createStreamingExecutor: createPipeline обовʼязковий');
  if (typeof deps.processChunk !== 'function') throw new Error('createStreamingExecutor: processChunk обовʼязковий');

  const workerClient = deps.workerClient || createWorkerClient({});
  const jobStore = createJobStateStore(drivePort);
  const chunkMgr = createChunkManager({
    runInWorker: workerClient.runInWorker,
    drivePort,
    jobFolderId: jobStore._jobFolderId,
    perf: deps.perf,
  });
  const isCancelled = typeof deps.isCancelled === 'function' ? deps.isCancelled : () => false;
  // Діагностичний логер (Drive-based, console-free). Свіжий на кожен run().
  // Дефолт — NOOP (тести/без drivePort-логера). Реальний інʼєктує Provider.
  const makeDiag = typeof deps.makeDiag === 'function' ? deps.makeDiag : () => NOOP_DIAG;

  function reportProgress(jobId, state) {
    const { done, total } = jobProgress(state);
    const etaMs = estimateRemainingMs(state);
    // bug 7: OCR — псевдо-стадія перед диригентом (chunk-OCR у streamFile).
    // Людський підпис + «блок X з Y» замість буквального 'processing'.
    progressStore.updateJob(jobId, {
      done, total, etaMs,
      stage: 'ocr',
      stageLabel: stageLabel('ocr'),
      detail: total > 0 ? `блок ${done} з ${total}` : null,
    });
    if (typeof deps.onProgress === 'function') {
      try { deps.onProgress({ jobId, done, total, etaMs }); } catch { /* ізольовано */ }
    }
  }

  // Потоково OCR-ити один файл по chunk'ах. Повертає {text, layoutJson,
  // pageCount}. RAM: байти одного chunk, занулюються одразу.
  async function streamFile(state, fileEntry, sourceAb, diag = NOOP_DIAG) {
    const plan = await chunkMgr.planChunks({
      buffer: sourceAb,
      fileSizeBytes: fileEntry.sizeBytes || 0,
      forceChunkPages: fileEntry.forceChunkPages || null,
    });
    const { pageCount, chunks } = plan;
    fileEntry.totalPages = pageCount;
    fileEntry.totalChunks = chunks.length;

    // ДІАГ: план нарізки. Тут видно «14 блоків» і ЧОМУ: pageCount + chunkPages.
    // bytesPerPageKB показує рівномірність; chunkRanges — діапазони сторінок.
    const fileSizeBytes = fileEntry.sizeBytes || 0;
    diag.log('plan_chunks', {
      fileId: fileEntry.fileId,
      fileSizeMB: mb(fileSizeBytes),
      pageCount,
      chunkPages: plan.chunkPages,
      totalChunks: chunks.length,
      bytesPerPageKB: pageCount > 0 ? Number((fileSizeBytes / pageCount / 1024).toFixed(1)) : 0,
      forceChunkPages: fileEntry.forceChunkPages || null,
      chunkRanges: chunks.map((c) => [c.startPage, c.endPage]),
    });

    // Зареєструвати chunks у jobState (resume бачить що лишилось).
    for (const c of chunks) {
      if (!state.chunks.some((s) => s.fileId === fileEntry.fileId && s.index === c.index)) {
        state.chunks.push({ fileId: fileEntry.fileId, index: c.index, startPage: c.startPage, endPage: c.endPage, driveId: null, status: 'pending', text: null });
      }
    }
    await jobStore.saveState(state);

    let merged = [];
    let layout = [];
    for (const c of chunks) {
      if (isCancelled()) return { cancelled: true };
      const slot = state.chunks.find((s) => s.fileId === fileEntry.fileId && s.index === c.index);
      if (slot && slot.status === 'done') {           // resume: вже оброблено
        if (slot.text != null) merged.push({ startPage: c.startPage, text: slot.text });
        continue;
      }
      const t0 = Date.now();
      // materialize chunk → _temp (RAM: тільки цей chunk)
      const mat = await chunkMgr.materializeChunk({ caseId: state.caseId, jobId: state.jobId, fileId: fileEntry.fileId, buffer: sourceAb, chunk: c });
      // ДІАГ: РЕАЛЬНА вага вирізаного блоку (pdf-lib copyPages+save). ОСЬ
      // вирішальне число: якщо блок 25 сторінок легкого файла важить >40 МБ —
      // нарізка роздуває (тягне спільний обʼєкт). Логуємо ДО OCR, тому навіть
      // падіння «>40 МБ» у processChunk лишить це в лозі.
      diag.log('chunk_materialized', {
        fileId: fileEntry.fileId,
        index: c.index,
        startPage: c.startPage,
        endPage: c.endPage,
        pages: c.endPage - c.startPage + 1,
        sizeMB: mb(mat.sizeBytes),
        sizeBytes: mat.sizeBytes,
      });
      let chunkBytes = await chunkMgr.readChunkBytes(mat.driveId);
      let res;
      try {
        res = await deps.processChunk({ bytes: chunkBytes, startPage: c.startPage, endPage: c.endPage, fileId: fileEntry.fileId });
      } catch (err) {
        // ДІАГ: падіння OCR блоку (тут летить «Файл більший за 40 МБ» з
        // documentAi). Прикріплюємо вагу блоку — звʼязок збою з роздувом.
        diag.log('chunk_ocr_error', {
          fileId: fileEntry.fileId,
          index: c.index,
          startPage: c.startPage,
          endPage: c.endPage,
          sizeMB: mb(mat.sizeBytes),
          code: err?.code || null,
          message: err?.message || String(err),
        });
        throw err;
      } finally {
        chunkBytes = null;                            // GC-дисципліна: занулення
      }
      // ДІАГ: успіх блоку — довжина тексту (НЕ текст), к-сть сторінок layout, ms.
      diag.log('chunk_ocr_done', {
        fileId: fileEntry.fileId,
        index: c.index,
        ms: Date.now() - t0,
        textLength: (res?.text || '').length,
        layoutPages: Array.isArray(res?.layout) ? res.layout.length : 0,
      });
      if (slot) {
        slot.driveId = mat.driveId;
        slot.status = 'done';
        slot.text = res?.text || '';
      }
      merged.push({ startPage: c.startPage, text: res?.text || '' });
      if (Array.isArray(res?.layout)) layout = layout.concat(res.layout);
      state.chunkDurationsMs.push(Date.now() - t0);
      await jobStore.saveState(state);
      reportProgress(state.jobId, state);
    }

    const { text } = await workerClient.runInWorker('mergeText', { chunks: merged });
    merged = null;                                    // звільнити проміжне
    // ДІАГ: підсумок файла — скільки тексту зібрано і скільки layout-сторінок.
    // textLength=0 при pageCount>0 — сигнал «OCR нічого не дав» (порожній том).
    diag.log('file_streamed', {
      fileId: fileEntry.fileId,
      pageCount,
      totalChunks: chunks.length,
      textLength: (text || '').length,
      layoutPages: layout.length,
    });
    return { text, layoutJson: layout.length ? { schemaVersion: 1, pages: layout } : null, pageCount };
  }

  // Головний запуск. input: { caseId, caseData, files:[{fileId,name,raw|
  // arrayBuffer, size, originalMime, metadataTemplate}], source, addedBy,
  // agentId, conversionContext, jobId? } — той самий вхід що pipeline +
  // streaming-обгортка.
  async function run(input, { resumeState = null } = {}) {
    const jobId = resumeState?.jobId || input.jobId || `dpjob_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const caseId = input.caseId;
    const title = input.files?.length > 1 ? `Пакет: ${input.files.length} файлів` : (input.files?.[0]?.name || 'Обробка документа');

    // ДІАГ: свіжий логер на цей прогін. flush() у finally нижче — пише файл на
    // Drive незалежно від того, яким return вийшов run() (успіх/стоп/throw).
    const diag = makeDiag();
    diag.log('run_start', {
      jobId, caseId,
      resumed: !!resumeState,
      source: input.source || 'manual',
      addedBy: input.addedBy || 'user',
      fileCount: (input.files || []).length,
      files: (input.files || []).map((f) => ({
        fileId: f.fileId, name: f.name, sizeMB: mb(f.size || f.raw?.size || 0),
      })),
    });
    return runGuarded(input, { resumeState, jobId, caseId, title, diag });
  }

  // runGuarded — тіло run() з гарантованим diag.flush() у finally на всіх
  // шляхах виходу (винесено, щоб не дублювати flush перед кожним return).
  async function runGuarded(input, { resumeState, jobId, caseId, title, diag }) {
    try {
    progressStore.startJob({ jobId, caseId, title, total: 0 });
    progressStore.reconcilePolling();

    // §4.11 — вільне місце.
    const estBytes = (input.files || []).reduce((s, f) => s + (f.size || f.raw?.size || 0), 0) * 3;
    let quota = null;
    try { quota = await drivePort.quota(); } catch { /* недоступно — не блокуємо */ }
    const verdict = freeSpaceVerdict(quota, estBytes);
    if (!verdict.ok) {
      progressStore.updateJob(jobId, { status: 'blocked', stage: verdict.code });
      return { ok: false, jobId, blocked: true, error: { code: verdict.code, message: verdict.message }, resumable: true };
    }

    let state = resumeState || makeInitialJobState({
      jobId, caseId,
      files: (input.files || []).map((f) => ({ fileId: f.fileId, name: f.name })),
    });
    state.status = JOB_STATUS.RUNNING;
    await jobStore.saveState(state);

    const pipelineFiles = [];
    try {
      for (let i = 0; i < input.files.length; i++) {
        if (isCancelled()) return finishCancelled(state, pipelineFiles);
        const f = input.files[i];
        const fe = state.files[i] || (state.files[i] = { fileId: f.fileId, name: f.name, status: 'pending' });

        // 1. оригінал → _temp, RAM звільнено.
        let ab = f.arrayBuffer || (f.raw?.arrayBuffer ? await f.raw.arrayBuffer() : (f.raw?._bytes?.buffer || f.raw?._bytes || null));
        if (!ab) { fe.status = 'done'; continue; }
        let sizeBytes = f.size || ab.byteLength || 0;

        // TASK 4 E — стиснення ПЕРЕД нарізкою (фіксований Середній, опція з
        // тумблера DP). КРИТИЧНО: рушій будує PDF через pdf-lib (кожна сторінка —
        // власні ресурси) → copyPages у chunkManager ріже ПРОПОРЦІЙНО (доктрина
        // §3.2); без цього чанк ≈ весь файл → Document AI «>40 МБ». scanned-guard
        // у рушії: searchable PDF проходить як є (skipped). Best-effort: збій
        // стиснення НЕ валить обробку — продовжуємо на оригіналі (resilience).
        if (typeof deps.compressBuffer === 'function' && typeof deps.shouldCompress === 'function' && deps.shouldCompress()) {
          try {
            const c = await deps.compressBuffer(ab);
            if (c && c.bytes && c.compressed) {
              ab = c.bytes;                                  // Uint8Array; downstream toArrayBuffer-aware
              sizeBytes = c.outBytes || ab.byteLength || sizeBytes;
              diag.log('compressed', { fileId: f.fileId, inMB: mb(c.inBytes), outMB: mb(c.outBytes) });
            } else if (c && c.skipped) {
              diag.log('compress_skipped', { fileId: f.fileId, reason: c.reason || null });
            }
          } catch (err) {
            diag.log('compress_error', { fileId: f.fileId, message: err?.message || String(err) });
          }
        }

        const tempFolderId = await jobStore._jobFolderId(caseId, jobId);
        let tempOriginal;
        try {
          tempOriginal = await drivePort.uploadBytes(tempFolderId, `orig_${f.fileId}.pdf`, new Uint8Array(ab), 'application/pdf');
        } catch (err) {
          state.status = JOB_STATUS.STOPPED; state.stoppedAt = 'upload_original'; state.error = { code: 'UPLOAD_FAILED', message: err?.message || 'upload original' };
          await jobStore.saveState(state);
          return { ok: false, jobId, resumable: true, error: state.error };
        }
        fe.originalDriveId = tempOriginal.id;
        fe.sizeBytes = sizeBytes;
        fe.status = 'processing';
        await jobStore.saveState(state);

        // 2-4. потокова OCR по chunk'ах.
        const streamed = await streamFile(state, fe, ab, diag);
        ab = null;                                    // GC: оригінал з RAM геть
        if (streamed?.cancelled) return finishCancelled(state, pipelineFiles);
        fe.status = 'done';
        await jobStore.saveState(state);

        pipelineFiles.push({
          fileId: f.fileId,
          name: f.name,
          driveId: fe.originalDriveId,                // split читатиме з _temp
          isDriveSource: true,
          originalMime: f.originalMime || 'application/pdf',
          size: fe.sizeBytes,
          type: 'application/pdf',
          metadataTemplate: f.metadataTemplate || {},
          extractedText: streamed.text || '',
          layoutJson: streamed.layoutJson || null,
          pageCount: streamed.pageCount || null,
        });
      }

      // 5. pipeline (V3 стадії через stageOverrides; диригент незмінний).
      // Потоковий OCR-текст приходить у стадії через DI-аксесор: makeContext
      // диригента НЕ переносить extractedText, а convert обнуляє його для
      // Drive-source. executor володіє текстом → ін'єктує getStreamedText
      // (як buildDocumentMetadata DI-seam DP-1). buildPipelineDeps(accessors)
      // дає caller'у зібрати stageOverrides V3 з цим аксесором; fallback —
      // статичний pipelineDeps (тести/не-streaming).
      const textMap = new Map(pipelineFiles.map((f) => [f.fileId, f.extractedText || '']));
      const layoutMap = new Map(pipelineFiles.map((f) => [f.fileId, f.layoutJson || null]));
      const accessors = {
        getStreamedText: (id) => textMap.get(id) || '',
        getStreamedLayout: (id) => layoutMap.get(id) || null,
      };
      const builtDeps = typeof deps.buildPipelineDeps === 'function'
        ? deps.buildPipelineDeps(accessors)
        : { ...deps.pipelineDeps, stageOverrides: { ...(deps.pipelineDeps?.stageOverrides || {}) } };
      // G0 — прогрес/таймінг належить executor (як reportProgress): диригент
      // кличе deps.onStage/onStageEnd, Provider buildPipelineDeps НЕ чіпаємо.
      // bug 7: людський підпис стадії у jobProgressStore (UI). bug 3:
      // per-stage таймінг у консоль + накопичений у снапшот для діагностики
      // 46-хв шляху. Обидва ізольовані — телеметрія не валить job.
      const stageTimings = {};
      const pipeDeps = {
        ...builtDeps,
        onStage: (name) => {
          try { progressStore.updateJob(jobId, { stage: name, stageLabel: stageLabel(name), detail: null }); }
          catch { /* progress ізольований */ }
        },
        onStageEnd: (name, ms) => {
          stageTimings[name] = (stageTimings[name] || 0) + (Number(ms) || 0);
          try {
            if (typeof console !== 'undefined' && console.info) {
              console.info(`[DP timing] ${name}: ${Math.round(Number(ms) || 0)}ms`);
            }
          } catch { /* лог ізольований */ }
          diag.log('stage_end', { name, ms: Math.round(Number(ms) || 0) });
          try { progressStore.updateJob(jobId, { timings: { ...stageTimings } }); }
          catch { /* progress ізольований */ }
        },
        // bug 6: під-прогрес ДОВГОЇ стадії (PERSIST per-document — тиха
        // 30+-хв зона після OCR, де бар фризнув на 100%). Один сенс,
        // окремий від chunk-ratio (правило #11): subDone/subTotal — «крок
        // у поточній стадії», ratio лишається загальним OCR-прогресом.
        onSubProgress: ({ done, total, label } = {}) => {
          const d = Number(done) || 0;
          const t = Number(total) || 0;
          try {
            progressStore.updateJob(jobId, {
              subDone: d, subTotal: t,
              detail: t > 0 ? `${label || 'Крок'} ${d} з ${t}` : (label || null),
            });
          } catch { /* progress ізольований */ }
        },
      };
      const pipeline = deps.createPipeline(pipeDeps);
      const result = await pipeline.run({
        jobId,
        caseId,
        caseData: input.caseData,
        agentId: input.agentId || 'document_processor_agent',
        source: input.source || 'manual',
        addedBy: input.addedBy || 'user',
        conversionContext: input.conversionContext || null,
        files: pipelineFiles,
      });

      // ДІАГ: підсумок диригента — скільки документів вийшло, які маршрути
      // (route), де зупинився. ОСЬ де видно «1 документ / порожня 02»: route
      // add_as_is×1, stoppedAt='triage_whole_volume', чи documentsCount=0.
      diag.log('pipeline_result', {
        ok: !!result.ok,
        stoppedAt: result.stoppedAt || null,
        documentsCount: Array.isArray(result.documents) ? result.documents.length : 0,
        decisionsCount: Array.isArray(result.decisions) ? result.decisions.length : 0,
        routes: Array.isArray(result.decisions)
          ? result.decisions.map((d) => d?.route || d?.type || null)
          : null,
        // ДІАГ тріажу (TASK triage_diag_logging §3.4): паспорт + токени + текст
        // помилки через канал decisions (scope==='triage'). Розгортаємо meta у
        // плоский запис — у diag-файлі видно ЧОМУ том став одним шматком
        // (рідкий паспорт? обрізаний max_tokens? AI здався?), без читання коду.
        triage: Array.isArray(result.decisions)
          ? result.decisions
              .filter((d) => d?.scope === 'triage')
              .map((d) => ({ type: d.type, message: d.message || null, ...(d.meta || {}) }))
          : null,
        errorsCount: Array.isArray(result.errors) ? result.errors.length : 0,
        firstError: result.errors?.[0]?.message || result.errors?.[0]?.code || null,
        timings: stageTimings,
      });

      if (result.ok && !result.stoppedAt) {
        // 6. успіх → чистимо _temp повністю (chunks + temp-оригінали + state).
        state.status = JOB_STATUS.DONE;
        state.documents = result.documents.map((d) => d.id);
        await jobStore.clearState(caseId, jobId);
        progressStore.updateJob(jobId, { done: state.chunks.length, total: state.chunks.length, stage: 'done' });
        progressStore.finishJob(jobId, { status: 'done', graceMs: 1500 });
        progressStore.reconcilePolling();
        return { ok: true, jobId, documents: result.documents, decisions: result.decisions, events: result.events, cleanedUp: true };
      }

      // pipeline зупинився (fatal/skip) — стан resumable, _temp лишається.
      state.status = JOB_STATUS.STOPPED;
      state.stoppedAt = result.stoppedAt || 'pipeline';
      state.error = result.errors?.[result.errors.length - 1] || null;
      await jobStore.saveState(state);
      progressStore.finishJob(jobId, { status: 'stopped', graceMs: 0 });
      progressStore.reconcilePolling();
      return { ok: false, jobId, resumable: true, stoppedAt: state.stoppedAt, errors: result.errors, decisions: result.decisions };
    } catch (err) {
      // Вирівнювання return-shape з pipeline-stoppage (рядки 299-306): для UI
      // (DPv2 Зона 3 «Помилки») і будь-якого caller'а існує ОДИН контракт
      // на ok:false — `errors[]` масив (правило #11). Без цього збій executor
      // (throw з streamFile/Drive/worker) доходить до адвоката лише тостом
      // без деталей: `res.errors` undefined → опис тосту порожній → блок
      // «Помилки» показує «Помилок немає» хоча реально стався збій.
      state.status = JOB_STATUS.STOPPED;
      state.stoppedAt = state.stoppedAt || 'exception';
      state.error = { code: 'EXECUTOR_THREW', message: err?.message || String(err), stage: state.stoppedAt };
      // ДІАГ: фатальний throw (включно з «Файл більший за 40 МБ» що долетів
      // сюди з processChunk). chunk_ocr_error вище вже зафіксував номер+вагу
      // блоку — тут лишається загальний підсумок прогону.
      diag.log('run_error', { code: state.error.code, message: state.error.message, stage: state.stoppedAt });
      try { await jobStore.saveState(state); } catch { /* стан міг не зберегтись */ }
      progressStore.finishJob(jobId, { status: 'stopped' });
      progressStore.reconcilePolling();
      return { ok: false, jobId, resumable: true, stoppedAt: state.stoppedAt, errors: [state.error], decisions: [] };
    }
    } finally {
      // ДІАГ: ЗАВЖДИ викидаємо лог на Drive — на будь-якому шляху виходу
      // (успіх / стоп / throw / blocked / cancelled). Best-effort: помилка
      // запису логу не впливає на результат run().
      try { await diag.flush({ jobId, caseId }); } catch { /* лог best-effort */ }
    }
  }

  // Скасування адвокатом (Варіант В §8): рішення «зберегти N / видалити все»
  // приймає caller (UI заглушка DP-4); тут — обидві гілки логіки готові.
  async function finishCancelled(state, pipelineFiles) {
    state.status = JOB_STATUS.STOPPED;
    state.stoppedAt = 'cancelled';
    await jobStore.saveState(state);
    progressStore.finishJob(state.jobId, { status: 'cancelled' });
    progressStore.reconcilePolling();
    return {
      ok: false, jobId: state.jobId, cancelled: true, resumable: true,
      readyDocuments: state.documents || [],
      // caller обирає: keepReady → keepPartial(); discardAll → discardAll()
      prompt: `Скасовано. Готових документів: ${(state.documents || []).length}. Зберегти їх чи видалити все?`,
    };
  }

  // keepPartial — лишити готові документи, прибрати лише _temp/state.
  async function keepPartial(caseId, jobId) {
    await jobStore.clearState(caseId, jobId);
    return { ok: true, kept: true };
  }

  // discardAll — відкат: видалити готові з 01_ОРИГІНАЛИ + _temp/state.
  // Видалення документів — через ін'єктований deleteDocument (executeAction;
  // нічого повз шар). Якщо не передано — чистимо лише _temp (без сирітств).
  async function discardAll(caseId, jobId) {
    const st = await jobStore.loadState(caseId, jobId);
    if (st && typeof deps.deleteDocument === 'function') {
      for (const docId of st.documents || []) {
        try { await deps.deleteDocument({ caseId, documentId: docId }); } catch { /* best-effort відкат */ }
      }
    }
    await jobStore.clearState(caseId, jobId);
    return { ok: true, discarded: true };
  }

  // resume — продовжити незавершений job з місця збою (§4.3). caller
  // вирішує resume vs новий старт (UI/тест); тут — підняти стан і дорун.
  async function resume(input) {
    const st = await jobStore.loadState(input.caseId, input.jobId);
    if (!st || st.status === JOB_STATUS.DONE) return { ok: false, reason: 'NO_RESUMABLE_JOB' };
    return run(input, { resumeState: st });
  }

  async function checkResumable(caseId, jobId) {
    return jobStore.hasResumableJob(caseId, jobId);
  }

  return { run, resume, checkResumable, keepPartial, discardAll, _jobStore: jobStore };
}
