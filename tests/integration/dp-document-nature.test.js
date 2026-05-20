// B2 (20.05.2026) — Provider-integration: documentNature='scanned' на
// нарізаних документах через streamingExecutor → splitDocumentsV3 →
// add_documents executeAction. Контракт: createDocument отримує meta з
// documentNature виведеним з джерела (наявність OCR-layoutJson).
//
// Обмеження №1 батьківського TASK: перевірка через справжній шар
// add_documents executeAction, не через стуб createDocument. Якщо хтось
// через 3 міс прибере inferDocumentNatureFromSource з splitDocumentsV3 —
// тест червоний (DocumentViewer перемикач Скан/Текст знову зникає).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Мокаємо OCR провайдери (тягнуть pdfjs/DOMMatrix — поза jsdom).
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
  id: 'case_nat', name: 'Document nature', tenantId: 'tenant_1', ownerId: 'vadym',
  documents: [], proceedings: [{ id: 'proc_main', title: 'Основне' }],
  storage: { subFolders: {} },
};

const realTriage = ({ artifacts, userHint, caseId }) =>
  analyzeTriageViaToolUse({ artifacts, userHint, caseId, apiKey: 'test-key' });

// processChunk-стуб: повертає текст + структуру (як Document AI на скані).
// Сам факт що streamingExecutor викликає processChunk і отримує непорожній
// layout означає: джерело є 'scanned' з точки зору пайплайну (текст з OCR,
// не з PDF text layer).
async function processChunkScanned({ startPage, endPage }) {
  const pages = [];
  for (let p = startPage; p <= endPage; p++) {
    pages.push({ pageNumber: p, _text: `OCR-текст стор ${p}`, blocks: [{ confidence: 0.95 }] });
  }
  return { text: pages.map((p) => p._text).join('\n'), layout: pages };
}

function buildExecutor(port, h, processChunk = processChunkScanned) {
  return createStreamingExecutor({
    drivePort: port, workerClient: wc, createPipeline: createDocumentPipeline,
    processChunk, perf: {},
    buildPipelineDeps: ({ getStreamedText, getStreamedLayout }) => ({
      stageOverrides: {
        detectBoundaries: createTriageStage({ triage: realTriage, getStreamedText, getStreamedLayout }),
        extract: createExtractV3({ getStreamedText, getStreamedLayout }),
        confirm: createConfirmBoundaries({}),
        persist: createSplitDocumentsV3({
          runInWorker: wc.runInWorker, drivePort: port,
          uploadFile: async (file) => {
            const folder = await port.getOrCreateFolder('01_ОРИГІНАЛИ', null);
            const bytes = file._bytes || new Uint8Array(await file.arrayBuffer());
            return (await port.uploadBytes(folder.id, file.name, bytes, 'application/pdf')).id;
          },
          createDocument,                              // СПРАВЖНЯ фабрика
          // BUILD-meta-DI-seam без явного documentNature — щоб перевірити
          // що splitDocumentsV3 САМ виводить його з layoutJson через
          // metadataTemplate (інакше Provider-каллер не передає nature).
          buildDocumentMetadata: ({ item, driveId, job }) => ({
            procId: 'proc_main', name: item.name,
            folder: '01_ОРИГІНАЛИ', addedBy: job.addedBy || 'user',
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

describe('B2 Provider-integration — documentNature на нарізаних документах', () => {
  let h, port;
  beforeEach(() => {
    progressStore._resetForTests();
    h = createHarness({ initialCases: [structuredClone(CASE)] });
    port = createMemDrivePort();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('сканований PDF → slice на 3 документи → ВСІ scanned (перемикач у в\'юері видимий)', async () => {
    stubTriageFetch({ documents: [
      { documentId: 'd1', name: 'Позов', type: 'pleading', route: 'slice', fragments: [{ fileId: 'big', startPage: 1, endPage: 3 }] },
      { documentId: 'd2', name: 'Ухвала', type: 'court_act', route: 'slice', fragments: [{ fileId: 'big', startPage: 4, endPage: 5 }] },
      { documentId: 'd3', name: 'Квитанція', type: 'court_act', route: 'slice', fragments: [{ fileId: 'big', startPage: 6, endPage: 6 }] },
    ], unusedPages: [] });

    const exec = buildExecutor(port, h);
    const res = await exec.run({
      caseId: 'case_nat', caseData: structuredClone(CASE),
      agentId: 'document_processor_agent', source: 'manual', addedBy: 'user',
      files: [await file('big', 6)],
    });
    expect(res.ok).toBe(true);

    const persisted = h.getCases().find((c) => c.id === 'case_nat').documents;
    expect(persisted).toHaveLength(3);
    for (const d of persisted) {
      expect(d.documentNature).toBe('scanned');
    }
  });

  it('add_as_is з джерела з OCR → documentNature=scanned (single document)', async () => {
    stubTriageFetch({ documents: [
      { documentId: 'd1', name: 'Ухвала', type: 'court_act', route: 'add_as_is', fragments: [{ fileId: 'a', startPage: 1, endPage: 2 }] },
    ], unusedPages: [] });

    const exec = buildExecutor(port, h);
    const res = await exec.run({
      caseId: 'case_nat', caseData: structuredClone(CASE),
      agentId: 'document_processor_agent', source: 'manual', addedBy: 'user',
      files: [await file('a', 2)],
    });
    expect(res.ok).toBe(true);
    const docs = h.getCases().find((c) => c.id === 'case_nat').documents;
    expect(docs).toHaveLength(1);
    expect(docs[0].documentNature).toBe('scanned');
  });

  it('fragment_reconstruct з двох scanned файлів → "scanned"', async () => {
    stubTriageFetch({ documents: [
      { documentId: 'd1', name: 'Експертиза', type: 'evidence', route: 'fragment_reconstruct',
        fragments: [{ fileId: 'f0', startPage: 1, endPage: 3 }, { fileId: 'f1', startPage: 1, endPage: 2 }] },
    ], unusedPages: [] });

    const exec = buildExecutor(port, h);
    const res = await exec.run({
      caseId: 'case_nat', caseData: structuredClone(CASE),
      agentId: 'document_processor_agent', source: 'manual', addedBy: 'user',
      files: [await file('f0', 3), await file('f1', 2)],
    });
    expect(res.ok).toBe(true);
    const docs = h.getCases().find((c) => c.id === 'case_nat').documents;
    expect(docs[0].documentNature).toBe('scanned');
  });
});
