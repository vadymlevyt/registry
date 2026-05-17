// DP-3 інтеграція — streamingExecutor драйвить СПРАВЖНІЙ диригент DP-1
// (незмінений) + V3 стадії через stageOverrides + СПРАВЖНІЙ createActions
// (через _actionsTestSetup, нуль дублювання). Доводить: великий PDF і пакет
// файлів streaming-обробляються, документи лягають у cases[].documents через
// реальний add_documents, фрагменти зберігаються, _temp чиститься, resume
// продовжує з місця, single-file НЕ регресує.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDocumentPipeline } from '../../src/services/documentPipeline.js';
import { createDocument } from '../../src/services/documentFactory.js';
import { createDetectBoundariesV3 } from '../../src/services/documentPipeline/stages/detectBoundariesV3.js';
import { createConfirmBoundaries } from '../../src/services/documentPipeline/stages/confirmBoundaries.js';
import { createExtractV3 } from '../../src/services/documentPipeline/stages/extractV3.js';
import { createSplitDocumentsV3 } from '../../src/services/documentPipeline/stages/splitDocumentsV3.js';
import { createStreamingExecutor } from '../../src/services/documentPipeline/streamingExecutor.js';
import { createWorkerClient } from '../../src/services/documentPipeline/workerClient.js';
import * as progressStore from '../../src/services/documentPipeline/jobProgressStore.js';
import { DOCUMENT_FRAGMENT_SAVED } from '../../src/services/eventBusTopics.js';
import { createHarness } from './_actionsTestSetup.js';
import { createMemDrivePort } from '../_memDrivePort.js';
import { makePdfBytes, toArrayBuffer } from '../_pdfFixture.js';

const wc = createWorkerClient({ forceInProcess: true });
const CASE = {
  id: 'case_dp3', name: 'Справа DP-3', tenantId: 'tenant_1', ownerId: 'vadym',
  documents: [], proceedings: [{ id: 'proc_main', title: 'Основне' }],
  storage: { subFolders: {} },
};

function buildExecutor(port, h, { analyzeFile, published, isCancelled, processChunk } = {}) {
  return createStreamingExecutor({
    drivePort: port,
    workerClient: wc,
    createPipeline: createDocumentPipeline,         // СПРАВЖНІЙ заморожений диригент
    processChunk: processChunk || (async ({ startPage }) => ({ text: `текст стор ${startPage}` })),
    perf: {},
    isCancelled,
    // buildPipelineDeps(accessors) — V3 стадії з потоковим текстом (DI-seam).
    buildPipelineDeps: ({ getStreamedText, getStreamedLayout }) => ({
      stageOverrides: {
        detectBoundaries: createDetectBoundariesV3({ analyzeFile, getStreamedText }),
        extract: createExtractV3({ getStreamedText, getStreamedLayout }),
        confirm: createConfirmBoundaries({}),         // autoConfirm true (DP-3)
        persist: createSplitDocumentsV3({
          runInWorker: wc.runInWorker,
          drivePort: port,
          uploadFile: async (file) => {
            const folder = await port.getOrCreateFolder('01_ОРИГІНАЛИ', null);
            const bytes = file._bytes || new Uint8Array(await file.arrayBuffer());
            return (await port.uploadBytes(folder.id, file.name, bytes, 'application/pdf')).id;
          },
          createDocument,
          buildDocumentMetadata: ({ item, driveId, job }) => ({
            procId: 'proc_main', name: item.name, documentNature: 'searchable',
            folder: '01_ОРИГІНАЛИ', addedBy: job.addedBy || 'system',
            source: job.source || 'manual', driveId,
            driveUrl: driveId ? `https://drive.google.com/file/d/${driveId}/view` : null,
            size: item.size || 0, ...(item.metadataTemplate || {}),
          }),
          persistDocument: ({ caseId, document }) =>
            h.executeAction('document_processor_agent', 'add_documents', { caseId, documents: [document] }),
          eventBus: { publish: (t, p) => published && published.push({ t, p }) },
          topics: { DOCUMENT_FRAGMENT_SAVED },
        }),
      },
      convertToPdf: async () => ({ pdfBlob: { size: 1 }, originalBlob: null, pdfName: 'd', originalName: 'd.pdf', originalMime: 'application/pdf', extractedText: null, warnings: [], converter: 'passthrough', durationMs: 1 }),
      uploadFile: async () => 'unused_main_upload',
      createDocument,
      eventBus: { publish: () => {} },
      topics: { DOCUMENT_INGESTED: 'document.ingested', DOCUMENT_BATCH_PROCESSED: 'document.batch_processed' },
      getActor: () => ({ userId: 'vadym', tenantId: 'tenant_1' }),
    }),
  });
}

async function pdfFile(pages, fileId) {
  return { fileId, name: `${fileId}.pdf`, arrayBuffer: toArrayBuffer(await makePdfBytes(pages)), size: pages * 1500, originalMime: 'application/pdf' };
}

describe('DP-3 інтеграція — streaming через справжній шар', () => {
  let h, port;
  beforeEach(() => {
    progressStore._resetForTests();
    h = createHarness({ initialCases: [structuredClone(CASE)] });
    port = createMemDrivePort();
  });

  it('великий PDF (60 стор) → streaming chunk-loop → 1 документ у справі, _temp чисто', async () => {
    // один файл, detect ≤1 → план не будується → fallback persist (1 документ)
    const analyzeFile = vi.fn(async () => ({ documents: [], unusedPages: [] }));
    const exec = buildExecutor(port, h, { analyzeFile });
    const res = await exec.run({
      caseId: 'case_dp3', caseData: structuredClone(CASE),
      agentId: 'document_processor_agent', source: 'manual', addedBy: 'user',
      files: [await pdfFile(60, 'big')],
    });
    expect(res.ok).toBe(true);
    expect(res.cleanedUp).toBe(true);
    const stored = h.getCases().find((c) => c.id === 'case_dp3').documents;
    expect(stored).toHaveLength(1);
    expect(port._countFilesNamed('job_state.json')).toBe(0);       // _temp прибрано
    expect(port._allNames().some((n) => /^chunk_|^orig_/.test(n))).toBe(false);
  });

  it('пакет 3 файлів → multi-file реконструкція → N логічних документів через add_documents', async () => {
    // Документ "Позов" розкиданий по f1+f2; f3 — окремий акт; 1 порожня сторінка.
    const analyzeFile = vi.fn(async ({ fileId }) => {
      if (fileId === 'f1') return { documents: [{ documentId: 'pozov', name: 'Позовна заява', type: 'pleading', startPage: 1, endPage: 3, open: true }], unusedPages: [] };
      if (fileId === 'f2') return { documents: [{ documentId: 'x', continuesFromTail: 'pozov', startPage: 1, endPage: 2, open: false }], unusedPages: [{ startPage: 3, endPage: 3, reason: 'порожня сторінка' }] };
      return { documents: [{ documentId: 'uhvala', name: 'Ухвала суду', type: 'court_act', startPage: 1, endPage: 2, open: false }], unusedPages: [] };
    });
    const published = [];
    const exec = buildExecutor(port, h, { analyzeFile, published });
    const fragFolder = await port.getOrCreateFolder('03_ФРАГМЕНТИ', null);
    const caseData = structuredClone(CASE);
    caseData.storage.subFolders['03_ФРАГМЕНТИ'] = fragFolder.id;
    const res = await exec.run({
      caseId: 'case_dp3', caseData,
      agentId: 'document_processor_agent', source: 'manual', addedBy: 'user',
      files: [await pdfFile(4, 'f1'), await pdfFile(4, 'f2'), await pdfFile(2, 'f3')],
    });
    expect(res.ok).toBe(true);
    const stored = h.getCases().find((c) => c.id === 'case_dp3').documents;
    // 2 логічні документи (Позов мультифайловий + Ухвала)
    expect(stored).toHaveLength(2);
    expect(stored.map((d) => d.name).sort()).toEqual(['Ухвала суду.pdf', 'Позовна заява.pdf'].sort());
    // фрагмент (порожня сторінка) збережено + подія
    expect(port._allNames().some((n) => /^fragment_001\.pdf$/.test(n))).toBe(true);
    expect(published.some((e) => e.t === DOCUMENT_FRAGMENT_SAVED)).toBe(true);
    // _temp прибрано після успіху
    expect(port._countFilesNamed('job_state.json')).toBe(0);
  });

  it('resume: pipeline впав fatal → стан resumable → 2-й прогон не передруковує chunk', async () => {
    const calls = [];
    const processChunk = async ({ startPage }) => { calls.push(startPage); return { text: `s${startPage}` }; };
    const analyzeFile = async () => ({ documents: [], unusedPages: [] });

    // 1-й прогон: персист «падає» (add_documents у неіснуючу справу → fatal)
    const failing = createStreamingExecutor({
      drivePort: port, workerClient: wc, createPipeline: createDocumentPipeline, processChunk, perf: {},
      buildPipelineDeps: ({ getStreamedText }) => ({
        stageOverrides: {
          detectBoundaries: createDetectBoundariesV3({ analyzeFile, getStreamedText }),
          extract: createExtractV3({ getStreamedText }),
          confirm: createConfirmBoundaries({}),
          persist: createSplitDocumentsV3({
            runInWorker: wc.runInWorker, drivePort: port,
            uploadFile: async () => 'x', createDocument,
            persistDocument: async () => ({ success: false, error: 'fatal persist' }),
          }),
        },
        eventBus: { publish: () => {} },
        topics: { DOCUMENT_INGESTED: 'a', DOCUMENT_BATCH_PROCESSED: 'b' },
        getActor: () => ({}),
      }),
    });
    const inp = () => ({ caseId: 'case_dp3', caseData: structuredClone(CASE), jobId: 'jResume', agentId: 'document_processor_agent', files: [{ fileId: 'big', name: 'big.pdf', size: 90000, originalMime: 'application/pdf' }] });
    const i1 = inp(); i1.files[0].arrayBuffer = toArrayBuffer(await makePdfBytes(40));
    const r1 = await failing.run(i1);
    expect(r1.ok).toBe(false);
    expect(r1.resumable).toBe(true);
    const firstCount = calls.length;
    expect(firstCount).toBeGreaterThan(0);

    // 2-й прогон resume з OK персистом — chunks done → нуль повторних OCR
    const ok = buildExecutor(port, h, { analyzeFile });
    const i2 = inp(); i2.files[0].arrayBuffer = toArrayBuffer(await makePdfBytes(40));
    const r2 = await ok.resume(i2);
    expect(r2.ok).toBe(true);
    expect(calls.length).toBe(firstCount);              // нуль повторних processChunk
  });

  it('AddDocumentModal НЕ регресує: диригент без V3 і без executor = DP-1 поведінка', async () => {
    // Прямий pipeline (як AddDocumentModal) — V3 стадій НЕ підключаємо.
    const pipe = createDocumentPipeline({
      convertToPdf: async () => ({ pdfBlob: { size: 5 }, originalBlob: null, pdfName: 'd', originalName: 'd.pdf', originalMime: 'application/pdf', extractedText: null, warnings: [], converter: 'passthrough', durationMs: 1 }),
      uploadFile: async () => 'drive_single',
      createDocument,
      buildDocumentMetadata: ({ item, driveId }) => ({ procId: 'proc_main', name: item.name, documentNature: 'searchable', folder: '01_ОРИГІНАЛИ', addedBy: 'user', source: 'manual', driveId, size: item.size || 0, ...(item.metadataTemplate || {}) }),
      persistDocument: ({ caseId, document }) => h.executeAction('dossier_agent', 'add_document', { caseId, document }),
      eventBus: { publish: () => {} },
      topics: { DOCUMENT_INGESTED: 'a', DOCUMENT_BATCH_PROCESSED: 'b' },
      getActor: () => ({ userId: 'vadym', tenantId: 'tenant_1' }),
    });
    const res = await pipe.run({
      caseId: 'case_dp3', caseData: { id: 'case_dp3' }, agentId: 'dossier_agent',
      files: [{ fileId: 'single', raw: { name: 'a.pdf', size: 5, type: 'application/pdf', arrayBuffer: async () => new ArrayBuffer(5) }, metadataTemplate: { category: 'pleading', author: 'ours' } }],
    });
    expect(res.ok).toBe(true);
    expect(res.documents).toHaveLength(1);
    const stored = h.getCases().find((c) => c.id === 'case_dp3').documents;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ category: 'pleading', author: 'ours' });
  });
});
