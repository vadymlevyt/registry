// ── DP-4 · DOCUMENT PIPELINE CONTEXT (streaming activation) ─────────────────
// DP-3 збудував streamingExecutor + ecitsInboxWatcher, але не вмонтував їх —
// без UI-споживача інфраструктура спить (tree-shaken, тести зелені). DP-4
// активує її ТУТ: один React Context який тримає інстанс executor'а і
// watcher'а, ін'єктує реальні deps (Drive/OCR/AI/executeAction) і прокидає
// `run/cancel/resume` + стан ECITS-надходжень у DP UI.
//
// Чому Context, а не глобальний сінглтон (CLAUDE.md §8 / DEVELOPMENT_PHILOSOPHY):
// DI лишається DI — як createActions(deps) у App.jsx. App не має інших
// Provider'ів (TenantProvider/ActionsProvider у handoff не існують —
// прокидання через props + createActions); тому це ПЕРШИЙ Provider, монтується
// у тілі App обгорткою рендера, executeAction приходить пропом (не імпорт
// стану — диригент і шар незмінні).
//
// Інваріант: streaming працює ТІЛЬКИ коли вмонтовано і ТІЛЬКИ коли UI кличе
// run() (або ECITS auto-режим). Дефолт tenant.settings.ecitsAutoProcess =
// 'manual' → watcher лише оновлює лічильники, нічого не запускає.

import React, {
  useMemo, useRef, useEffect, useState, useCallback,
} from 'react';

// Контекст і хук винесено у lightweight-модуль (без важких імпортів) — щоб
// JobProgressTopbar/GlobalProgressScreen не тягнули весь executor-ланцюг.
// Реекспортуємо для зворотної сумісності існуючих імпортів з .jsx (тести).
import { DocumentPipelineContext, useDocumentPipeline } from './documentPipelineContextCore.js';

export { DocumentPipelineContext, useDocumentPipeline };

import { createStreamingExecutor } from '../services/documentPipeline/streamingExecutor.js';
import { createDefaultDrivePort } from '../services/documentPipeline/drivePort.js';
import { createDiagLogger } from '../services/documentPipeline/diagLogger.js';
import { createWorkerClient } from '../services/documentPipeline/workerClient.js';
import { createDocumentPipeline } from '../services/documentPipeline.js';
import { createTriageStage } from '../services/documentPipeline/stages/triageStage.js';
import { createExtractV3 } from '../services/documentPipeline/stages/extractV3.js';
import { createConfirmBoundaries } from '../services/documentPipeline/stages/confirmBoundaries.js';
import { createSplitDocumentsV3 } from '../services/documentPipeline/stages/splitDocumentsV3.js';
import { createDatasetCollector } from '../services/datasetCollector.js';
import { createEcitsInboxWatcher } from '../services/ecitsInboxWatcher.js';
import * as jobProgressStore from '../services/documentPipeline/jobProgressStore.js';

import { createDocument } from '../services/documentFactory.js';
import { convertToPdf } from '../services/converter/converterService.js';
import { compressPdfBuffer, DEFAULT_COMPRESSION_PRESET } from '../services/compression/imageCompressor.js';
import { createAddFiles } from '../services/addFiles/addFilesService.js';
import { maybeCompressFileForAdd } from '../services/compression/compressFrontStep.js';
import { toast } from '../services/toast.js';
import * as ocrService from '../services/ocrService.js';
import { uploadFileToCaseFolder } from '../services/driveService.js';
import {
  getCurrentUserId, getCurrentTenantId, getEcitsAutoProcess, getSplitterDatasetEnabled,
} from '../services/tenantService.js';
import * as eventBus from '../services/eventBus.js';
import {
  ECITS_DOCUMENTS_RECEIVED, ECITS_INBOX_PENDING,
  DOCUMENT_INGESTED, DOCUMENT_BATCH_PROCESSED, DOCUMENT_FRAGMENT_SAVED,
} from '../services/eventBusTopics.js';

// ── AI helpers (graceful degradation) ───────────────────────────────────────
// aiTriage кидає якщо нема ключа або мережі — createTriageStage трактує це НЕ
// фатально (passthrough), extractV3 лишає сирий OCR-текст. Ingest не блокується.

function getApiKey() {
  try { return localStorage.getItem('claude_api_key'); } catch { return null; }
}

// Ф2 Triage-транспорт. Тонка обгортка над analyzeTriageViaToolUse (Haiku,
// білінг §12 всередині модуля). Нема ключа → кидає; createTriageStage
// трактує НЕ фатально (passthrough). aiUsageSink не передаємо — React-точка
// логує через дефолтний sink (як analyzeViaToolUse у Provider-контексті).
async function aiTriage({ artifacts, userHint, caseId }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Немає API ключа для Triage');
  const { analyzeTriageViaToolUse } = await import('../services/documentBoundary/analyzeTriageViaToolUse.js');
  return analyzeTriageViaToolUse({ artifacts, userHint, caseId, apiKey });
}

// OCR одного chunk: байти приходять з _temp (streamingExecutor читає, потім
// зануляє). documentAi.extract підтримує localBlob — Drive-id чанку не
// потрібен. Кеш у 02_ОБРОБЛЕНІ не пишеться (нема subFolders → no-op).
async function ocrChunkBytes({ bytes }) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const res = await ocrService.extractText(
    { name: 'chunk.pdf', mimeType: 'application/pdf', localBlob: blob },
    { skipCache: true, forceProvider: 'documentAi' },
  );
  return { text: res?.text || '', layout: res?.pageStructure || null };
}

// uploadToOriginals — DP-аліас СПІЛЬНОЇ точки завантаження
// (driveService.uploadFileToCaseFolder). Та сама функція, що й модалка — ОДИН
// шлях заливки на всю систему (читає байти ПЕРЕД upload). Тонкий аліас для
// наявних call-sites (persist / buildPipelineDeps / addFilesRun).
async function uploadToOriginals(file, caseData) {
  return uploadFileToCaseFolder(file, caseData);
}

export function DocumentPipelineProvider({ executeAction, children }) {
  // Per-run опції 8 перемикачів (Зона 2). buildPipelineDeps читає звідси, щоб
  // НЕ міняти контракт executor.run(input) (інфраструктуру не переробляємо).
  const runOptionsRef = useRef({});
  const cancelledRef = useRef(false);

  const getActor = useCallback(() => ({
    userId: getCurrentUserId() || null,
    tenantId: getCurrentTenantId() || null,
  }), []);

  const executor = useMemo(() => {
    const drivePort = createDefaultDrivePort();
    const workerClient = createWorkerClient({});

    const persistDocuments = async ({ caseId, document }) => {
      try {
        const r = await executeAction('document_processor_agent', 'add_documents', {
          caseId, documents: [document],
        });
        return r?.success ? { success: true } : { success: false, error: r?.error || 'add_documents failed' };
      } catch (err) {
        return { success: false, error: err?.message || String(err) };
      }
    };

    const datasetCollector = createDatasetCollector({
      drivePort,
      getEnabled: () => getSplitterDatasetEnabled(),
    });

    // V2-A2: DP більше НЕ чистить текст (пост-крок прибрано — parent §DP БІЛЬШЕ
    // НЕ ЧИСТИТЬ). Очистка стала справою в'ювера/ACTION clean_document_text по
    // одному документу на вимогу. Ядро cleanTextService.cleanDocument лишається,
    // але DP його НЕ кличе.

    const buildPipelineDeps = ({ getStreamedText, getStreamedLayout }) => {
      const opt = runOptionsRef.current || {};
      return {
        stageOverrides: {
          // Ф2 Smart Triage — ЄДИНЕ ЯДРО у слоті DETECT_BOUNDARIES (диригент
          // незмінний). Один AI-диспетч (Haiku, паспорт-вхід) → ЄДИНИЙ план
          // з .route; виконання маршрутів — у PERSIST (splitDocumentsV3).
          // Мертві покоління меж (detectBoundariesV2/V3, multiFileReconstructor)
          // знесено в A1-B. Текст-аксесори ті самі (потоковий OCR + per-page
          // layout для паспорта).
          detectBoundaries: createTriageStage({
            triage: aiTriage,
            getStreamedText,
            getStreamedLayout,
            // 1C.2 — DP-4 toggle «Просто додати файли»: ON → детермінований
            // план add_as_is per PDF, AI Triage пропускається.
            skipPdfSlicing: opt.skipPdfSlicing === true,
          }),
          extract: createExtractV3({
            // TASK 3.1: extract БІЛЬШЕ не чистить (очистка — пост-крок у persist
            // на готових документах). Лишає сирий OCR-текст (txt).
            getStreamedText,
            getStreamedLayout,
          }),
          confirm: createConfirmBoundaries({ autoConfirm: opt.autoConfirm !== false }),
          persist: createSplitDocumentsV3({
            runInWorker: workerClient.runInWorker,
            drivePort,
            uploadFile: uploadToOriginals,
            createDocument,
            persistDocument: persistDocuments,
            // Ф3 виконавець route image_merge: композиція наявних
            // sortation/converter/worker (lazy import — поза critical path
            // ingest, як інші важкі залежності Provider).
            mergeImagesToPdf: async ({ images }) => {
              const { renderImageMergeToPdf } = await import('../services/sortation/imageMergeRenderer.js');
              return renderImageMergeToPdf({ images, runInWorker: workerClient.runInWorker });
            },
            // TASK 4 §7.1: writeText02 НЕ ін'єктуємо — `.txt` більше не пишемо.
            // splitDocumentsV3 гард `typeof writeText02 === 'function'` → no-op.
            // scanned кешується у .layout.json (writeLayout02); searchable
            // дістає текст із текстового шару PDF на вимогу (extractTextLayer).
            writeLayout02: async ({ caseData, driveId, name, layoutJson }) => {
              try {
                // B1 (20.05.2026): передаємо ОБ'ЄКТ, не string. Стара версія
                // робила JSON.stringify(layoutJson) ДО writeLayoutArtifact —
                // strip image/tokens не запрацював, файли на Drive виходили
                // 14МБ замість ~400КБ (форензика на справі Брановського).
                // writeLayoutArtifact САМА робить strip+serialize.
                const layoutObj = typeof layoutJson === 'string'
                  ? JSON.parse(layoutJson)
                  : layoutJson;
                await ocrService.writeLayoutArtifact(
                  { id: driveId, name, subFolders: caseData?.storage?.subFolders },
                  layoutObj,
                );
              } catch { /* layout кеш не критичний */ }
            },
            eventBus,
            topics: { DOCUMENT_FRAGMENT_SAVED },
            datasetCollector: opt.collectDataset ? datasetCollector : null,
            fragmentsMode: opt.fragmentsCombined ? 'combined' : 'separate',
          }),
        },
        convertToPdf,
        uploadFile: uploadToOriginals,
        createDocument,
        eventBus,
        topics: { DOCUMENT_INGESTED, DOCUMENT_BATCH_PROCESSED },
        // TASK 2: рішення адвоката з DP-тумблера «Оновити case_context.md».
        // emitStage кладе його у payload DOCUMENT_BATCH_PROCESSED; CaseDossier
        // слухає і регенерує нарис справи лише коли true.
        updateCaseContext: opt.updateCaseContext === true,
        getActor,
      };
    };

    return createStreamingExecutor({
      drivePort,
      workerClient,
      createPipeline: createDocumentPipeline,
      processChunk: ocrChunkBytes,
      buildPipelineDeps,
      getActor,
      // Діагностичний логер (Drive `_diagnostics/`, console-free): свіжий на
      // кожен run(). Пише числа/мітки/коди помилок (НЕ текст документів) —
      // щоб діагностувати збій нарізки/OCR без devtools на планшеті.
      makeDiag: () => createDiagLogger({ drivePort }),
      // TASK 4 E — стиснення scanned PDF ПЕРЕД нарізкою (фіксований Середній).
      // Рушій РЕАЛЬНИЙ downscale (render→JPEG→pdf-lib-перебудова), НЕ слабкий
      // re-save. scanned-guard вшито (searchable → pass-through). shouldCompress
      // читає прапор compress прогону (runOptionsRef, виставляє тумблер DP).
      compressBuffer: async (arrayBuffer) => compressPdfBuffer(arrayBuffer, { preset: DEFAULT_COMPRESSION_PRESET }),
      shouldCompress: () => runOptionsRef.current?.compress === true,
      isCancelled: () => cancelledRef.current === true,
      deleteDocument: async ({ caseId, documentId }) => {
        try { await executeAction('dossier_agent', 'delete_document', { caseId, documentId }); }
        catch { /* best-effort відкат */ }
      },
      onProgress: () => { /* jobProgressStore вже отримує push у executor */ },
    });
  }, [executeAction, getActor]);

  // Публічна обгортка: стартує опції 8 перемикачів і скидає cancel-прапор.
  const run = useCallback((input, options = {}) => {
    runOptionsRef.current = options || {};
    cancelledRef.current = false;
    return executor.run(input);
  }, [executor]);

  const resume = useCallback((input, options = {}) => {
    runOptionsRef.current = options || {};
    cancelledRef.current = false;
    return executor.resume(input);
  }, [executor]);

  // TASK 4 · етап C — default OCR-enrich для «просто додати» (non-streaming).
  // Пост-крок ПІСЛЯ persist для одного документа: scanned/image → OCR через
  // ocrService (каскад pdfjsLocal→documentAi; пише ЛИШЕ .layout у 02, оновлює
  // nature). DOCX/HTML — конвертер дав searchable PDF, текст у текстовому шарі
  // PDF (TASK 4 §7.1: .txt НЕ пишемо, дістаємо на вимогу); Document AI НЕ
  // викликаємо (CLAUDE.md ЗАБОРОНЕНО на конвертованому PDF). Best-effort: збій
  // не валить додавання — «Розпізнати» у в'ювері лишається. Vision-фолбек тут
  // НЕ потрібен; модалка робить власний OCR з Vision (deferOcr=true) і цей крок
  // пропускає.
  const ocrEnrichAddAsIs = useCallback(async ({ item, document, caseData }) => {
    const subFolders = caseData?.storage?.subFolders;
    const driveId = item.driveId || document?.driveId || null;
    if (!driveId || !subFolders?.['02_ОБРОБЛЕНІ']) return;

    // DOCX/HTML — конвертер дав searchable PDF (pdf-lib drawText, текстовий шар
    // у самому PDF). TASK 4 §7.1: `.txt` НЕ пишемо — текст дістається з
    // текстового шару PDF на вимогу (getDocumentText/extractTextLayer).
    // Document AI не чіпаємо (CLAUDE.md ЗАБОРОНЕНО на конвертованому PDF).
    if (item.extractedText && item.extractedText.trim()) {
      return;
    }

    // localBlob — байти, що ВЖЕ в памʼяті add-флоу (те саме, що залив на Drive:
    // конвертований/стиснений PDF або passthrough-оригінал). Передаємо у OCR —
    // провайдери (documentAi/pdfjsLocal) читають їх локально замість повторного
    // завантаження всього файлу з Drive. Drive-source (пікер) блоба не має →
    // провайдер тягне за id (fallback). Один сенс (#11): «байти для OCR».
    // Паритет з metadataEnrichAddAsIs.
    const localBlob = item.uploadedFile instanceof Blob
      ? item.uploadedFile
      : (item.raw instanceof Blob ? item.raw : null);
    const ocrFile = {
      id: driveId,
      name: item.uploadedFile?.name || document?.originalName || document?.name || 'document.pdf',
      mimeType: item.originalMime || 'application/pdf',
      subFolders,
      ...(localBlob ? { localBlob } : {}),
    };
    if (!ocrService.hasOcrSupport(ocrFile)) return;
    try {
      const res = await ocrService.extractText(ocrFile, { skipCache: true });
      const finalNature = res?.provider === 'pdfjsLocal' ? 'searchable' : 'scanned';
      const fields = { lastOcrAt: new Date().toISOString() };
      if (document && finalNature !== document.documentNature) fields.documentNature = finalNature;
      if (document?.id) {
        await executeAction('document_processor_agent', 'update_document', {
          caseId: caseData.id, documentId: document.id, fields,
        });
      }
    } catch (e) {
      // Document AI недоступний — документ уже додано; OCR можна повторити у
      // в'ювері. Не блокуємо (best-effort, паритет зі стрім-шляхом).
      console.warn('[ocrEnrichAddAsIs] OCR best-effort failed:', e?.message || e);
    }
  }, [executeAction]);

  // TASK 4 (rework) · Стадія D — DP «просто додати» через ОКРЕМИЙ сервіс
  // addFiles (той самий, що модалка; нуль звʼязку з нарізкою). DP-deps:
  // uploadToOriginals + document_processor_agent/add_documents. Стиснення —
  // ін'єктований крок з прогрес-тостом (один toast, лічильник на місці).
  // Пост-крок OCR: повний OCR (ocrMode='full') → layout у 02 по кожному
  // документу (ocrEnrichAddAsIs); «без OCR» (none) → НІЧОГО (без Vision —
  // metadataEnrichAddAsIs БІЛЬШЕ НЕ ВИКЛИКАЄТЬСЯ, рішення власника).
  const addFilesRun = useCallback(async (input, options = {}) => {
    const ocrMode = options.ocrMode || 'full';

    let compressToastId = null;
    let lastTick = 0;
    const compressFile = async (f) => {
      try {
        return await maybeCompressFileForAdd(f, {
          onProgress: (done, total) => {
            const now = Date.now();
            if (compressToastId != null && now - lastTick < 250 && done < total) return;
            lastTick = now;
            const title = `Стиснення: ${done} / ${total} стор.`;
            if (compressToastId == null) compressToastId = toast.info(title, { persistent: true });
            else toast.update(compressToastId, { title });
          },
        });
      } finally {
        if (compressToastId != null) { toast.dismiss(compressToastId); compressToastId = null; }
      }
    };

    const svc = createAddFiles({
      convertToPdf,
      uploadFile: uploadToOriginals,
      compressFile,
      createDocument,
      persistDocument: async ({ caseId, document }) => {
        try {
          const r = await executeAction('document_processor_agent', 'add_documents', { caseId, documents: [document] });
          return r?.success ? { success: true } : { success: false, error: r?.error || 'add_documents failed' };
        } catch (err) { return { success: false, error: err?.message || String(err) }; }
      },
      eventBus,
      topics: { DOCUMENT_INGESTED, DOCUMENT_BATCH_PROCESSED },
      getActor,
    });

    const result = await svc.addFiles(input, options);

    if (result.ok && ocrMode !== 'none') {
      for (const f of result.files || []) {
        if (!f.document) continue;
        try { await ocrEnrichAddAsIs({ item: f, document: f.document, caseData: input.caseData }); }
        catch (e) { console.warn('[addFilesRun] OCR enrich failed (non-fatal):', e?.message || e); }
      }
    }
    return result;
  }, [executeAction, getActor, ocrEnrichAddAsIs]);

  const cancel = useCallback(() => { cancelledRef.current = true; }, []);
  const keepPartial = useCallback((caseId, jobId) => executor.keepPartial(caseId, jobId), [executor]);
  const discardAll = useCallback((caseId, jobId) => executor.discardAll(caseId, jobId), [executor]);

  // ── Прогрес-екран ↔ топбар (Bug 2/3) ──────────────────────────────────────
  // Єдине джерело правди «згорнуто/розгорнуто» — тут, а не локальний state
  // DocumentProcessorV2 (бо топбар живе в App, а повний екран — у вкладці;
  // раніше вони не знали один про одного → дублювання + неможливо повернутись).
  // Повноекранний прогрес і топбар ВЗАЄМОВИКЛЮЧНІ: один сенс на прапор (#11).
  const [progressMinimized, setProgressMinimized] = useState(false);
  const minimizeProgress = useCallback(() => setProgressMinimized(true), []);
  const expandProgress = useCallback(() => setProgressMinimized(false), []);

  // ── ECITS pending state (3 точки індикації UI) ────────────────────────────
  // Map<caseId, count> з події ECITS_INBOX_PENDING (watcher manual-режим).
  const [ecitsPending, setEcitsPending] = useState(() => ({}));

  useEffect(() => {
    const unsub = eventBus.subscribe(ECITS_INBOX_PENDING, (payload) => {
      const caseId = payload?.caseId;
      if (!caseId) return;
      setEcitsPending((prev) => ({ ...prev, [caseId]: Number(payload?.count) || 0 }));
    });
    return () => { try { unsub && unsub(); } catch { /* noop */ } };
  }, []);

  const clearEcitsPending = useCallback((caseId) => {
    setEcitsPending((prev) => {
      if (!(caseId in prev)) return prev;
      const next = { ...prev }; delete next[caseId]; return next;
    });
  }, []);

  // ── ecitsInboxWatcher + Drive-poll fallback (активація DP-4) ───────────────
  useEffect(() => {
    const watcher = createEcitsInboxWatcher({
      eventBus,
      topics: { ECITS_DOCUMENTS_RECEIVED, ECITS_INBOX_PENDING },
      getEcitsAutoProcess,
      executeAction,
      runPipeline: (payload) => run({
        caseId: payload?.caseId,
        caseData: payload?.caseData || null,
        agentId: 'document_processor_agent',
        source: 'court_sync',
        addedBy: 'system',
        files: payload?.files || [],
      }, {}),
      getActor,
      onError: (err) => { console.warn('[ecitsInboxWatcher]', err?.message || err); },
    });
    watcher.start();
    // Drive-poll fallback для resume (сам зупиняється коли jobs порожні).
    jobProgressStore.attachDrivePolling({
      loadState: (caseId, jobId) => executor._jobStore.loadState(caseId, jobId),
    });
    return () => { try { watcher.stop(); } catch { /* noop */ } };
  }, [executeAction, run, getActor, executor]);

  const value = useMemo(() => ({
    run, addFiles: addFilesRun, resume, cancel, keepPartial, discardAll,
    ecitsPending, clearEcitsPending,
    progressMinimized, minimizeProgress, expandProgress,
  }), [
    run, addFilesRun, resume, cancel, keepPartial, discardAll, ecitsPending, clearEcitsPending,
    progressMinimized, minimizeProgress, expandProgress,
  ]);

  return (
    <DocumentPipelineContext.Provider value={value}>
      {children}
    </DocumentPipelineContext.Provider>
  );
}
