// B3 (20.05.2026) — Provider-integration: часткова image_merge помилка не
// валить ВЕСЬ pipeline. Корінь: splitDocumentsV3 повертав {fatal:true} на
// перший throw mergeImagesToPdf → жоден документ із N не зберігався.
// Реальний симптом (скріншот 17:28): "decode failed" на конкретному файлі
// з 25-документного набору — 24 інші теж зникали.
//
// Обмеження №1 батьківського TASK: тест через справжній шар executeAction
// add_documents, не через стуб persistDocument. Перевіряє що:
//   1) pipeline.ok === true (не fatal);
//   2) decisions містить image_merge_failed з documentName конкретно;
//   3) решта документів УСПІШНО додалися у справу.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockProviderState = {
  documentAi: { canHandle: false, result: null, error: null },
  claudeVision: { canHandle: false, result: null, error: null },
  pdfjsLocal: { canHandle: false, result: null, error: null },
};
function makeProvider(name) {
  return { default: { name, canHandle: () => mockProviderState[name].canHandle, extract: vi.fn(async () => mockProviderState[name].result) } };
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
  id: 'case_im', name: 'Image merge failure', tenantId: 'tenant_1', ownerId: 'vadym',
  documents: [], proceedings: [{ id: 'proc_main', title: 'Основне' }], storage: { subFolders: {} },
};

const realTriage = ({ artifacts, userHint, caseId }) =>
  analyzeTriageViaToolUse({ artifacts, userHint, caseId, apiKey: 'test-key' });

function buildExecutor(port, h, mergeSpy) {
  return createStreamingExecutor({
    drivePort: port, workerClient: wc, createPipeline: createDocumentPipeline,
    processChunk: async ({ startPage }) => ({ text: `стор ${startPage}`, layout: [{ pageNumber: startPage, _text: `p${startPage}` }] }), perf: {},
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
          createDocument,
          buildDocumentMetadata: ({ item, driveId, job }) => ({
            procId: 'proc_main', name: item.name, documentNature: 'scanned',
            folder: '01_ОРИГІНАЛИ', addedBy: job.addedBy || 'user',
            source: job.source || 'manual', driveId,
            driveUrl: driveId ? `https://drive.google.com/file/d/${driveId}/view` : null,
            size: item.size || 0, ...(item.metadataTemplate || {}),
          }),
          persistDocument: ({ caseId, document }) =>
            h.executeAction('document_processor_agent', 'add_documents', { caseId, documents: [document] }),
          mergeImagesToPdf: mergeSpy,
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
  ({ fileId: id, name: name || `${id}.jpg`, arrayBuffer: toArrayBuffer(await makePdfBytes(pages)), size: pages * 1500, originalMime: mime });

describe('B3 Provider-integration — image_merge помилка не валить pipeline', () => {
  let h, port;
  beforeEach(() => {
    progressStore._resetForTests();
    h = createHarness({ initialCases: [structuredClone(CASE)] });
    port = createMemDrivePort();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('3 image_merge документи, 1 кривий → 2 валідні зберігаються, 1 у decisions', async () => {
    // Triage план: 3 image-merge документи, кожен з власного файла.
    stubTriageFetch({ documents: [
      { documentId: 'd1', name: 'Договір', type: 'contract', route: 'image_merge', fragments: [{ fileId: 'a', startPage: 1, endPage: 1 }] },
      { documentId: 'd2', name: 'Паспорт', type: 'identification', route: 'image_merge', fragments: [{ fileId: 'b', startPage: 1, endPage: 1 }] },
      { documentId: 'd3', name: 'Довідка', type: 'evidence', route: 'image_merge', fragments: [{ fileId: 'c', startPage: 1, endPage: 1 }] },
    ], unusedPages: [] });

    // mergeImagesToPdf кидає на «Паспорт» (HEIC що canvas не декодує —
    // справжній симптом адвоката 20.05).
    const mergeSpy = vi.fn(async ({ docName }) => {
      if (docName === 'Паспорт') {
        throw new Error('HTMLImage→createImageBitmap decode failed: source image could not be decoded');
      }
      return new Uint8Array(await makePdfBytes(1));
    });

    const exec = buildExecutor(port, h, mergeSpy);
    const res = await exec.run({
      caseId: 'case_im', caseData: structuredClone(CASE),
      agentId: 'document_processor_agent', source: 'manual', addedBy: 'user',
      files: [
        await file('a', 1, 'image/jpeg', 'A.jpg'),
        await file('b', 1, 'image/heic', 'B.heic'),
        await file('c', 1, 'image/jpeg', 'C.jpg'),
      ],
    });

    // pipeline.ok === true — НЕ fatal через одного кривого документа.
    expect(res.ok).toBe(true);

    // У справі — 2 документи (Договір, Довідка); Паспорт відсутній.
    const docs = h.getCases().find((c) => c.id === 'case_im').documents;
    const names = docs.map((d) => d.name).sort();
    expect(names).toEqual(['Довідка.pdf', 'Договір.pdf']);

    // decisions містять image_merge_failed з documentName=Паспорт.
    const allDecisions = [...(res.decisions || []), ...(res.errors || [])];
    const failed = allDecisions.find((x) => x.type === 'image_merge_failed');
    expect(failed).toBeDefined();
    expect(failed.documentName).toBe('Паспорт');
    expect(failed.message).toMatch(/decode failed/);
  });

  it('перший документ image_merge кидає → наступні все одно завершуються', async () => {
    // Корінь bug: раніше fatal:true === early return → індекси після
    // помилкового документа не оброблялись. Тест ловить регресію навіть
    // якщо ordering у плані інший.
    stubTriageFetch({ documents: [
      { documentId: 'd1', name: 'Паспорт', route: 'image_merge', fragments: [{ fileId: 'a', startPage: 1, endPage: 1 }] },
      { documentId: 'd2', name: 'Договір', route: 'image_merge', fragments: [{ fileId: 'b', startPage: 1, endPage: 1 }] },
    ], unusedPages: [] });

    const mergeSpy = vi.fn(async ({ docName }) => {
      if (docName === 'Паспорт') throw new Error('decode failed');
      return new Uint8Array(await makePdfBytes(1));
    });

    const exec = buildExecutor(port, h, mergeSpy);
    const res = await exec.run({
      caseId: 'case_im', caseData: structuredClone(CASE),
      agentId: 'document_processor_agent', source: 'manual', addedBy: 'user',
      files: [await file('a', 1, 'image/heic', 'A.heic'), await file('b', 1, 'image/jpeg', 'B.jpg')],
    });

    expect(res.ok).toBe(true);
    const docs = h.getCases().find((c) => c.id === 'case_im').documents;
    expect(docs.map((d) => d.name)).toEqual(['Договір.pdf']);
    // mergeImagesToPdf викликано ОБИДВА рази (не зупинились на першому).
    expect(mergeSpy).toHaveBeenCalledTimes(2);
  });
});
