// P1 (Фаза B, 20.05.2026) — Provider-integration: PERSIST Drive-uploads
// йдуть паралельно з обмеженням concurrency.
//
// Обмеження №1 батьківського TASK_smart_triage (§2.1): кожен фікс має тест
// ЧЕРЕЗ справжній DocumentPipelineProvider-injected executor, не лише
// стадію в ізоляції. Тут інструментуємо uploadFile (виконавець Drive-upload
// фінального документа у 01_ОРИГІНАЛИ) щоб лічити пік одночасних викликів.
//
// Реальний кейс: Брановський 65 стор. → ~25 нарізаних. До P1: 25 послідовних
// uploadFile (~10-15 сек кожен на planшеті) ~5-8 хв. Після P1: 5 паралельних
// у польоті → ~60-100 сек.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockProviderState = {
  documentAi: { canHandle: false, result: null, error: null },
  claudeVision: { canHandle: false, result: null, error: null },
  pdfjsLocal: { canHandle: false, result: null, error: null },
};
function makeProvider(name) {
  return {
    default: {
      name,
      canHandle: () => mockProviderState[name].canHandle,
      extract: vi.fn(async () => mockProviderState[name].result),
    },
  };
}
vi.mock('../../src/services/ocr/documentAi.js', () => makeProvider('documentAi'));
vi.mock('../../src/services/ocr/claudeVision.js', () => makeProvider('claudeVision'));
vi.mock('../../src/services/ocr/pdfjsLocal.js', () => makeProvider('pdfjsLocal'));

vi.mock('../../src/services/driveAuth.js', () => ({
  driveRequest: vi.fn(async () => new Response('', { status: 404 })),
}));

import { createDocumentPipeline } from '../../src/services/documentPipeline.js';
import { createDocument } from '../../src/services/documentFactory.js';
import { createTriageStage } from '../../src/services/documentPipeline/stages/triageStage.js';
import { createConfirmBoundaries } from '../../src/services/documentPipeline/stages/confirmBoundaries.js';
import { createExtractV3 } from '../../src/services/documentPipeline/stages/extractV3.js';
import { createSplitDocumentsV3 } from '../../src/services/documentPipeline/stages/splitDocumentsV3.js';
import { analyzeTriageViaToolUse } from '../../src/services/documentBoundary/analyzeTriageViaToolUse.js';
import { createStreamingExecutor } from '../../src/services/documentPipeline/streamingExecutor.js';
import { createWorkerClient } from '../../src/services/documentPipeline/workerClient.js';
import * as progressStore from '../../src/services/documentPipeline/jobProgressStore.js';
import { DOCUMENT_FRAGMENT_SAVED } from '../../src/services/eventBusTopics.js';
import { createHarness } from './_actionsTestSetup.js';
import { createMemDrivePort } from '../_memDrivePort.js';
import { makePdfBytes, toArrayBuffer } from '../_pdfFixture.js';

const wc = createWorkerClient({ forceInProcess: true });

const CASE = {
  id: 'case_p1', name: 'P1 concurrency', tenantId: 'tenant_1', ownerId: 'vadym',
  documents: [], proceedings: [{ id: 'proc_main', title: 'Основне' }],
};

const realTriage = ({ artifacts, userHint, caseId }) =>
  analyzeTriageViaToolUse({ artifacts, userHint, caseId, apiKey: 'test-key' });

// processChunk-стуб з мінімальним layout (без image/tokens). 1 сторінка =
// 1 page у layoutJson — splitDocumentsV3 може зрізати текст по межах.
async function processChunkLight({ startPage, endPage }) {
  const pages = [];
  for (let p = startPage; p <= endPage; p++) {
    pages.push({
      pageNumber: p,
      paragraphs: [{ layout: { textAnchor: { textSegments: [{ startIndex: 0, endIndex: 5 }] } } }],
      blocks: [{ confidence: 0.99 }],
      dimension: { width: 1240, height: 1754 },
      detectedLanguages: [{ languageCode: 'uk' }],
      _text: `Стор ${p}`,
    });
  }
  return { text: pages.map((p) => p._text).join('\n'), layout: pages };
}

// Інструментований uploadFile: лічить пік одночасних викликів. delay
// імітує мережеву затримку — без delay тест зеленіє завжди (бо
// runWithConcurrency запускає worker'и одразу і вони можуть встигнути
// серіально між тіками event loop).
function makeConcurrencyTracker(delayMs) {
  let inFlight = 0;
  let peak = 0;
  let totalCalls = 0;
  return {
    async track(fn) {
      inFlight++;
      totalCalls++;
      if (inFlight > peak) peak = inFlight;
      try {
        await new Promise((r) => setTimeout(r, delayMs));
        return await fn();
      } finally {
        inFlight--;
      }
    },
    get peak() { return peak; },
    get totalCalls() { return totalCalls; },
  };
}

function buildExecutor(port, h, tracker) {
  return createStreamingExecutor({
    drivePort: port, workerClient: wc, createPipeline: createDocumentPipeline,
    processChunk: processChunkLight, perf: {},
    buildPipelineDeps: ({ getStreamedText, getStreamedLayout }) => ({
      stageOverrides: {
        detectBoundaries: createTriageStage({ triage: realTriage, getStreamedText, getStreamedLayout }),
        extract: createExtractV3({ getStreamedText, getStreamedLayout }),
        confirm: createConfirmBoundaries({}),
        persist: createSplitDocumentsV3({
          runInWorker: wc.runInWorker, drivePort: port,
          uploadFile: async (file) =>
            tracker.track(async () => {
              const folder = await port.getOrCreateFolder('01_ОРИГІНАЛИ', null);
              const bytes = file._bytes || new Uint8Array(await file.arrayBuffer());
              return (await port.uploadBytes(folder.id, file.name, bytes, 'application/pdf')).id;
            }),
          createDocument,
          buildDocumentMetadata: ({ item, driveId, job }) => ({
            procId: 'proc_main', name: item.name, documentNature: 'scanned',
            folder: '01_ОРИГІНАЛИ', addedBy: job.addedBy || 'system',
            source: job.source || 'manual', driveId,
            driveUrl: driveId ? `https://drive.google.com/file/d/${driveId}/view` : null,
            size: item.size || 0, ...(item.metadataTemplate || {}),
          }),
          persistDocument: ({ caseId, document }) =>
            h.executeAction('document_processor_agent', 'add_documents', { caseId, documents: [document] }),
          eventBus: { publish: () => {} },
          topics: { DOCUMENT_FRAGMENT_SAVED },
        }),
      },
      convertToPdf: async () => ({ pdfBlob: { size: 1 }, originalBlob: null, pdfName: 'd', originalName: 'd.pdf', originalMime: 'application/pdf', extractedText: null, warnings: [], converter: 'passthrough', durationMs: 1 }),
      uploadFile: async () => 'unused',
      createDocument,
      eventBus: { publish: () => {} },
      topics: { DOCUMENT_INGESTED: 'document.ingested', DOCUMENT_BATCH_PROCESSED: 'document.batch_processed' },
      getActor: () => ({ userId: 'vadym', tenantId: 'tenant_1' }),
    }),
  });
}

function stubTriageFetch(plan) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify(plan) }], usage: { input_tokens: 1, output_tokens: 1 },
  }), { status: 200 })));
}

const file = async (id, pages, mime = 'application/pdf', name) =>
  ({ fileId: id, name: name || `${id}.pdf`, arrayBuffer: toArrayBuffer(await makePdfBytes(pages)), size: pages * 1500, originalMime: mime });

describe('P1 Provider-integration — concurrency limit на PERSIST', () => {
  let h, port;
  beforeEach(() => {
    progressStore._resetForTests();
    h = createHarness({ initialCases: [structuredClone(CASE)] });
    port = createMemDrivePort();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('10 нарізаних документів → пік одночасних uploadFile ≤ PERSIST_CONCURRENCY (5)', async () => {
    // План Triage: 10 документів, кожен — окрема сторінка (slice).
    const docs = [];
    for (let i = 1; i <= 10; i++) {
      docs.push({
        documentId: `d${i}`,
        name: `Документ_${i}`,
        type: 'court_act',
        route: 'slice',
        fragments: [{ fileId: 'big', startPage: i, endPage: i }],
      });
    }
    stubTriageFetch({ documents: docs, unusedPages: [] });

    // 30мс delay у uploadFile — без delay event loop може встигнути серіально
    // (синхронні мікротаски) і пік буде 1, тест нечесний. 30мс достатньо
    // щоб концурентність насправді проявилась.
    const tracker = makeConcurrencyTracker(30);

    const caseData = structuredClone(CASE);
    caseData.storage = { subFolders: {} };
    const exec = buildExecutor(port, h, tracker);
    const res = await exec.run({
      caseId: 'case_p1', caseData, agentId: 'document_processor_agent',
      source: 'manual', addedBy: 'user', files: [await file('big', 10)],
    });

    expect(res.ok).toBe(true);
    expect(tracker.totalCalls).toBe(10);
    expect(tracker.peak).toBeGreaterThan(1);             // паралельність реальна
    expect(tracker.peak).toBeLessThanOrEqual(5);         // не перевищили ліміт
    expect(h.getCases().find((c) => c.id === 'case_p1').documents).toHaveLength(10);
  });

  it('2 документи → пік ≤ 2 (concurrency не "роздуває" worker-пул)', async () => {
    stubTriageFetch({
      documents: [
        { documentId: 'd1', name: 'A', type: 'court_act', route: 'slice', fragments: [{ fileId: 'big', startPage: 1, endPage: 1 }] },
        { documentId: 'd2', name: 'B', type: 'court_act', route: 'slice', fragments: [{ fileId: 'big', startPage: 2, endPage: 2 }] },
      ], unusedPages: [],
    });
    const tracker = makeConcurrencyTracker(30);
    const caseData = structuredClone(CASE);
    caseData.storage = { subFolders: {} };
    const exec = buildExecutor(port, h, tracker);
    const res = await exec.run({
      caseId: 'case_p1', caseData, agentId: 'document_processor_agent',
      source: 'manual', addedBy: 'user', files: [await file('big', 2)],
    });
    expect(res.ok).toBe(true);
    expect(tracker.totalCalls).toBe(2);
    expect(tracker.peak).toBeLessThanOrEqual(2);
    expect(h.getCases().find((c) => c.id === 'case_p1').documents).toHaveLength(2);
  });
});
