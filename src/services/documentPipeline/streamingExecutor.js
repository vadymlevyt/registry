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
  async function streamFile(state, fileEntry, sourceAb) {
    const { pageCount, chunks } = await chunkMgr.planChunks({
      buffer: sourceAb,
      fileSizeBytes: fileEntry.sizeBytes || 0,
      forceChunkPages: fileEntry.forceChunkPages || null,
    });
    fileEntry.totalPages = pageCount;
    fileEntry.totalChunks = chunks.length;

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
      let chunkBytes = await chunkMgr.readChunkBytes(mat.driveId);
      let res;
      try {
        res = await deps.processChunk({ bytes: chunkBytes, startPage: c.startPage, endPage: c.endPage, fileId: fileEntry.fileId });
      } finally {
        chunkBytes = null;                            // GC-дисципліна: занулення
      }
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
        fe.sizeBytes = f.size || ab.byteLength || 0;
        fe.status = 'processing';
        await jobStore.saveState(state);

        // 2-4. потокова OCR по chunk'ах.
        const streamed = await streamFile(state, fe, ab);
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
      state.status = JOB_STATUS.STOPPED;
      state.stoppedAt = state.stoppedAt || 'exception';
      state.error = { code: 'EXECUTOR_THREW', message: err?.message || String(err) };
      try { await jobStore.saveState(state); } catch { /* стан міг не зберегтись */ }
      progressStore.finishJob(jobId, { status: 'stopped' });
      progressStore.reconcilePolling();
      return { ok: false, jobId, resumable: true, error: state.error };
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
