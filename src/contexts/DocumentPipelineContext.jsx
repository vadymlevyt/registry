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
import { createIngest } from '../services/documentPipeline/ingest.js';
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
import { createDocumentPipeline as createAddAsIsPipeline } from '../services/documentPipeline.js';
import { inferNatureFromFile, defaultNatureForUI } from '../services/detectDocumentNature.js';
import * as ocrService from '../services/ocrService.js';
import { enrichDocumentWithVisionMetadata } from '../services/documentMetadata.js';
import { findOrCreateFolder, uploadBytesToDrive } from '../services/driveService.js';
import { callAPIWithRetry } from '../services/toolUseRunner.js';
import { resolveModel } from '../services/modelResolver.js';
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

// defaultAddAsIsMetadata — дефолтний білдер канонічних метаданих для
// non-streaming «просто додати» (DP-тумблер). Один файл = один документ:
// назва з імені файлу, nature виводиться (DOCX/HTML конвертер → searchable),
// решта класифікації (category/author/procId) лишається null → маркер
// «потребує перегляду». Модалка передає власний buildDocumentMetadata
// (форма адвоката) і цей дефолт не використовує.
function defaultAddAsIsMetadata({ item, driveId, originalDriveId, job }) {
  const fileForInfer = item.uploadedFile
    || (item.raw ? { type: item.raw.type, name: item.raw.name } : { type: item.type, name: item.name });
  const isTextExtractedConvert =
    item.converterType === 'docxToPdf' || item.converterType === 'htmlToPdf';
  const nature = isTextExtractedConvert
    ? 'searchable'
    : (inferNatureFromFile({ mimeType: fileForInfer.type, originalName: fileForInfer.name })
        || defaultNatureForUI({ mimeType: fileForInfer.type, originalName: fileForInfer.name })
        || 'searchable');
  const base = (item.name || 'Документ').replace(/\.[^.]+$/, '');
  return {
    name: base,
    category: null,
    author: null,
    procId: null,
    date: null,
    isKey: false,
    driveId: driveId || null,
    driveUrl: driveId ? `https://drive.google.com/file/d/${driveId}/view` : null,
    size: item.uploadedFile?.size || item.size || 0,
    originalName: item.name || null,
    originalDriveId: originalDriveId || null,
    originalMime: item.originalMime ?? null,
    folder: '01_ОРИГІНАЛИ',
    addedBy: job?.addedBy || 'user',
    namingStatus: 'auto',
    documentNature: nature,
    // source — канал ПОХОДЖЕННЯ (правило addedBy↔source): успадковуємо з job.
    source: job?.source || 'manual',
  };
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

  // TASK 4 · етап D — «без OCR» пост-крок (ocrMode='none'). Замість повного OCR
  // (ocrEnrichAddAsIs) — Vision читає 1-2 стор. → пропонує метадані; артефактів
  // у 02 НЕ створюємо (нічого на Drive). Спільний оркестратор
  // enrichDocumentWithVisionMetadata (той самий код що модалка). Best-effort:
  // збій метаданих не валить додавання (документ уже в 01, «Розпізнати» пізніше).
  const metadataEnrichAddAsIs = useCallback(async ({ item, document, caseData }) => {
    const driveId = item.driveId || document?.driveId || null;
    if (!driveId || !document) return;
    // localBlob — байти, що вже в памʼяті add-флоу (конвертований PDF або
    // passthrough-оригінал). Vision рендерить 1-2 стор. саме з нього → файл
    // читається ОДИН раз, без повторного завантаження всього файлу з Drive
    // заради двох сторінок. Drive-source (пікер) блоба не має → renderFileToImages
    // сам завантажить за id (fallback). Один сенс (#11): «байти для Vision».
    const localBlob = item.uploadedFile instanceof Blob
      ? item.uploadedFile
      : (item.raw instanceof Blob ? item.raw : null);
    const ocrFile = {
      id: driveId,
      name: item.uploadedFile?.name || document?.originalName || document?.name || 'document.pdf',
      mimeType: item.originalMime || 'application/pdf',
      subFolders: caseData?.storage?.subFolders,
      ...(localBlob ? { localBlob } : {}),
    };
    await enrichDocumentWithVisionMetadata({
      ocrFile,
      doc: document,
      caseId: caseData.id,
      caseData,
      executeAction,
      agentId: 'document_processor_agent',
    });
  }, [executeAction]);

  // TASK 4 · етап E — maybeCompressFile: стиснути ОДИН файл перед додаванням
  // (add_as_is). Стискаємо лише PDF (рушій сам має scanned-guard: searchable →
  // pass-through); не-PDF (DOCX-оригінал, інше) повертаємо як є. Best-effort:
  // будь-який збій → оригінал (документ усе одно має додатись, правило resilience).
  const maybeCompressFile = useCallback(async (file) => {
    try {
      const isPdf = file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '');
      if (!isPdf || typeof file?.arrayBuffer !== 'function') return file;
      const ab = await file.arrayBuffer();
      const c = await compressPdfBuffer(ab, { preset: DEFAULT_COMPRESSION_PRESET });
      if (c && c.bytes && c.compressed) {
        return new File([c.bytes], file.name, { type: 'application/pdf' });
      }
      return file;
    } catch (e) {
      console.warn('[maybeCompressFile] best-effort failed:', e?.message || e);
      return file;
    }
  }, []);

  // TASK 4 · етап C — runAddAsIs: non-streaming труба «просто додати». Кожен
  // файл = один документ, БЕЗ нарізки; усі типи + будь-яка комбінація через
  // спільний диригент createDocumentPipeline (convert→persist→emit). Споживачі:
  // DP-тумблер «Просто додати» (комбо/не-PDF) і модалка (один файл). OCR —
  // ін'єктований пост-крок: модалка передає deferOcr=true і робить власний
  // Vision-OCR з result; DP лишає дефолтний ocrEnrichAddAsIs (ocrMode='full')
  // або metadataEnrichAddAsIs (ocrMode='none', «без OCR»).
  const runAddAsIs = useCallback(async (input, options = {}) => {
    const opt = options || {};
    const buildDocumentMetadata = typeof opt.buildDocumentMetadata === 'function'
      ? opt.buildDocumentMetadata
      : defaultAddAsIsMetadata;

    // persistDocument — модалка передає власний (dossier_agent/add_document +
    // updateCase-fallback, behavior-preserve); DP лишає дефолт
    // (document_processor_agent/add_documents — той самий шлях що стрім).
    const persistDocument = typeof opt.persistDocument === 'function'
      ? opt.persistDocument
      : async ({ caseId, document }) => {
          try {
            const r = await executeAction('document_processor_agent', 'add_documents', {
              caseId, documents: [document],
            });
            return r?.success ? { success: true } : { success: false, error: r?.error || 'add_documents failed' };
          } catch (err) {
            return { success: false, error: err?.message || String(err) };
          }
        };

    // uploadFile — модалка передає власний uploadFileLocal (verify/ensure
    // subFolders, behavior-preserve); DP лишає дефолт uploadToOriginals.
    const baseUploadFile = typeof opt.uploadFile === 'function' ? opt.uploadFile : uploadToOriginals;

    // TASK 4 E — стиснення ПЕРЕД додаванням (опція з тумблера, фіксований
    // Середній). Обгортка над uploadFile — ЄДИНА точка: стискаємо сам файл
    // перед завантаженням на Drive. Рушій має scanned-guard (searchable PDF /
    // не-PDF → pass-through), тож DOCX-оригінал поряд і текстові PDF проходять
    // як є. Best-effort: збій → оригінал (resilience, документ усе одно додається).
    const uploadFile = opt.compress === true
      ? async (file, caseData) => baseUploadFile(await maybeCompressFile(file), caseData)
      : baseUploadFile;

    const pipeline = createAddAsIsPipeline({
      convertToPdf,
      uploadFile,
      createDocument,
      buildDocumentMetadata,
      persistDocument,
      eventBus,
      topics: { DOCUMENT_INGESTED, DOCUMENT_BATCH_PROCESSED },
      updateCaseContext: opt.updateCaseContext === true,
      getActor,
    });

    const result = await pipeline.run(input);

    // Пост-persist OCR. deferOcr=true (модалка) → пропускаємо: модалка робить
    // власний пост-крок (повний OCR з Vision-фолбеком АБО Vision-метадані за
    // своїм тумблером). Інакше (DP) — дефолтний best-effort enrich по кожному
    // створеному документу: ocrMode='none' → Vision-метадані (без 02);
    // інакше → повний OCR (ocrEnrichAddAsIs).
    const noOcr = opt.ocrMode === 'none';
    if (result.ok && opt.deferOcr !== true) {
      for (const fileItem of result.files || []) {
        if (!fileItem.document) continue;
        try {
          if (noOcr) {
            await metadataEnrichAddAsIs({ item: fileItem, document: fileItem.document, caseData: input.caseData });
          } else {
            await ocrEnrichAddAsIs({ item: fileItem, document: fileItem.document, caseData: input.caseData });
          }
        } catch (e) {
          console.warn('[runAddAsIs] post-persist enrich failed (non-fatal):', e?.message || e);
        }
      }
    }
    return result;
  }, [executeAction, getActor, ocrEnrichAddAsIs, metadataEnrichAddAsIs, maybeCompressFile]);

  // TASK 4 · етап A/C — єдина труба додавання. ingest.js — тонкий фасад поверх
  // `run` (streaming, mode 'slice') і `runAddAsIs` (non-streaming, mode
  // 'add_as_is'). DP і модалка кличуть ОДНУ цю точку; mode маршрутизує.
  const { ingestFiles } = useMemo(
    () => createIngest({ runPipeline: run, runAddAsIs }),
    [run, runAddAsIs],
  );

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
    run, ingestFiles, resume, cancel, keepPartial, discardAll,
    ecitsPending, clearEcitsPending,
    progressMinimized, minimizeProgress, expandProgress,
  }), [
    run, ingestFiles, resume, cancel, keepPartial, discardAll, ecitsPending, clearEcitsPending,
    progressMinimized, minimizeProgress, expandProgress,
  ]);

  return (
    <DocumentPipelineContext.Provider value={value}>
      {children}
    </DocumentPipelineContext.Provider>
  );
}
