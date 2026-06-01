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
import * as ocrService from '../services/ocrService.js';
import { findOrCreateFolder, uploadBytesToDrive } from '../services/driveService.js';
import { callAPIWithRetry } from '../services/toolUseRunner.js';
import { resolveModel } from '../services/modelResolver.js';
import { cleanDocument as cleanTextCleanDocument } from '../services/cleanTextService.js';
import { buildCleanDocumentDriveDeps } from '../services/cleanTextDriveAdapter.js';
import {
  getCurrentUserId, getCurrentTenantId, getEcitsAutoProcess, getSplitterDatasetEnabled,
} from '../services/tenantService.js';
import * as eventBus from '../services/eventBus.js';
import {
  ECITS_DOCUMENTS_RECEIVED, ECITS_INBOX_PENDING,
  DOCUMENT_INGESTED, DOCUMENT_BATCH_PROCESSED, DOCUMENT_FRAGMENT_SAVED,
} from '../services/eventBusTopics.js';

// ── AI helpers (graceful degradation) ───────────────────────────────────────
// analyzeFile / cleanText кидають якщо нема ключа або мережі — V3-стадії
// трактують це НЕ фатально (detectBoundariesV3: passthrough → fallback persist;
// extractV3: лишає сирий OCR-текст). Ingest не блокується.

function getApiKey() {
  try { return localStorage.getItem('claude_api_key'); } catch { return null; }
}

function extractJson(text) {
  if (!text) return null;
  const s = text.indexOf('{');
  if (s < 0) return null;
  let depth = 0;
  for (let i = s; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) { try { return JSON.parse(text.slice(s, i + 1)); } catch { return null; } } }
  }
  return null;
}

async function aiReconstructFile({ fileName, text, openTails, userHint }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Немає API ключа для реконструкції');
  const { buildReconstructionPrompt } = await import('../services/documentBoundary/multiFileReconstructor.js');
  const prompt = buildReconstructionPrompt({ fileName, text, openTails, userHint });
  const res = await callAPIWithRetry({
    model: resolveModel('document_parser') || 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  }, { apiKey });
  const out = res?.content?.[0]?.text || res?.content || '';
  const parsed = extractJson(typeof out === 'string' ? out : '');
  if (!parsed) throw new Error('Реконструкція повернула не-JSON');
  return { documents: parsed.documents || [], unusedPages: parsed.unusedPages || [] };
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

// Завантажити фінальний документ у 01_ОРИГІНАЛИ справи. Той самий seam що
// DP-1 persist.uploadFile (file, caseData) → driveId.
async function uploadToOriginals(file, caseData) {
  let folderId = caseData?.storage?.subFolders?.['01_ОРИГІНАЛИ'] || null;
  if (!folderId) {
    const root = caseData?.storage?.driveFolderId || null;
    const f = await findOrCreateFolder('01_ОРИГІНАЛИ', root, null);
    folderId = f?.id;
  }
  if (!folderId) throw new Error('Не знайдено папку 01_ОРИГІНАЛИ справи');
  const bytes = file._bytes
    ? (file._bytes instanceof Uint8Array ? file._bytes : new Uint8Array(file._bytes))
    : new Uint8Array(await file.arrayBuffer());
  const up = await uploadBytesToDrive(folderId, file.name, bytes, 'application/pdf');
  return up.id;
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

    // TASK 3.1 — очистка тексту для читання як ПОСТ-КРОК на готових документах.
    // Drive-шви ядра cleanDocument будуються ОДИН раз (executeAction стабільний);
    // splitDocumentsV3 кличе cleanFinalizedDocument по кожному scanned-документу
    // ПІСЛЯ фіналізації. billAsUserAction:false — автопродовження обробки, не
    // окрема оплачувана дія адвоката (parent §C7): токени завжди, activityTracker
    // як дію — ні. Ті ж Drive-шви перевикористає 3.2 (кнопки).
    const cleanDriveDeps = buildCleanDocumentDriveDeps({
      executeAction,
      agentId: 'document_processor_agent',
    });
    const cleanFinalizedDocument = ({ document, caseData }) => cleanTextCleanDocument({
      document,
      caseData,
      apiKey: getApiKey(),
      billAsUserAction: false,
      aiUsageSink: null,
      ...cleanDriveDeps,
    });

    const buildPipelineDeps = ({ getStreamedText, getStreamedLayout }) => {
      const opt = runOptionsRef.current || {};
      return {
        stageOverrides: {
          // Ф2 Smart Triage — НОВЕ ЯДРО у слоті DETECT_BOUNDARIES (диригент
          // незмінний). Один AI-диспетч (Haiku, паспорт-вхід) → ЄДИНИЙ план
          // з .route. detectBoundariesV3 / reconstructAcrossFiles НЕ видалені
          // — стануть виконавцями маршрутів у PERSIST (Ф3). Текст-аксесори ті
          // самі що раніше (потоковий OCR + per-page layout для паспорта).
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
            writeText02: async ({ caseData, driveId, name, text, format }) => {
              try {
                await ocrService.writeExtractedTextArtifact(
                  { id: driveId, name, subFolders: caseData?.storage?.subFolders }, text,
                );
              } catch { /* кеш не критичний */ }
            },
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
            // TASK 3.1 — тумблер «Очистити для читання»: ПОСТ-КРОК очистки на
            // готових scanned-документах (.txt→.md через ядро cleanDocument).
            cleanForReading: opt.cleanForReading === true,
            cleanFinalizedDocument,
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
    run, resume, cancel, keepPartial, discardAll,
    ecitsPending, clearEcitsPending,
    progressMinimized, minimizeProgress, expandProgress,
  }), [
    run, resume, cancel, keepPartial, discardAll, ecitsPending, clearEcitsPending,
    progressMinimized, minimizeProgress, expandProgress,
  ]);

  return (
    <DocumentPipelineContext.Provider value={value}>
      {children}
    </DocumentPipelineContext.Provider>
  );
}
