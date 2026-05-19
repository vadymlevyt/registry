// Ф3 Provider-INTEGRATION (обмеження №1 — той клас тестів, якого бракувало
// DP-3/4). СПРАВЖНІЙ заморожений диригент через streamingExecutor +
// Provider-shape buildPipelineDeps: РЕАЛЬНІ createTriageStage +
// createSplitDocumentsV3-диспетч + реальний add_documents (через
// _actionsTestSetup). Єдині моки: global fetch (план Triage) і
// mergeImagesToPdf-seam (canvas — поза jsdom; композицію покриває
// imageMergeRenderer.test.js). Перевіряє КОЖЕН route наскрізь.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  id: 'case_pr', name: 'Persist routes', tenantId: 'tenant_1', ownerId: 'vadym',
  documents: [], proceedings: [{ id: 'proc_main', title: 'Основне' }], storage: { subFolders: {} },
};
const realTriage = ({ artifacts, userHint, caseId }) =>
  analyzeTriageViaToolUse({ artifacts, userHint, caseId, apiKey: 'test-key' });

function buildExecutor(port, h, mergeSpy) {
  return createStreamingExecutor({
    drivePort: port, workerClient: wc, createPipeline: createDocumentPipeline,
    processChunk: async ({ startPage }) => ({ text: `стор ${startPage}` }), perf: {},
    buildPipelineDeps: ({ getStreamedText, getStreamedLayout }) => ({
      stageOverrides: {
        detectBoundaries: createTriageStage({ triage: realTriage, getStreamedText, getStreamedLayout }),
        extract: createExtractV3({ getStreamedText, getStreamedLayout }),
        confirm: createConfirmBoundaries({}),
        // САМЕ так Provider ін'єктує persist (Ф3) — реальний диспетч за route.
        persist: createSplitDocumentsV3({
          runInWorker: wc.runInWorker, drivePort: port,
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
  ({ fileId: id, name: name || `${id}.pdf`, arrayBuffer: toArrayBuffer(await makePdfBytes(pages)), size: pages * 1500, originalMime: mime });

describe('Ф3 Provider-integration — PERSIST виконує кожен route', () => {
  let h, port, mergeSpy;
  beforeEach(() => {
    progressStore._resetForTests();
    h = createHarness({ initialCases: [structuredClone(CASE)] });
    port = createMemDrivePort();
    mergeSpy = vi.fn(async () => new Uint8Array(await makePdfBytes(1)));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  async function run(files, caseData = structuredClone(CASE)) {
    const exec = buildExecutor(port, h, mergeSpy);
    return exec.run({ caseId: 'case_pr', caseData, agentId: 'document_processor_agent', source: 'manual', addedBy: 'user', files });
  }
  const docs = () => h.getCases().find((c) => c.id === 'case_pr').documents;

  it('add_as_is → 1 канонічний документ у справі', async () => {
    stubTriageFetch({ documents: [{ documentId: 'd1', name: 'Ухвала', type: 'court_act', route: 'add_as_is', fragments: [{ fileId: 'a', startPage: 1, endPage: 3 }] }], unusedPages: [] });
    const res = await run([await file('a', 3)]);
    expect(res.ok).toBe(true);
    expect(docs()).toHaveLength(1);
    expect(docs()[0].name).toBe('Ухвала.pdf');
  });

  it('slice → один PDF розрізано на 2 документи у справі', async () => {
    stubTriageFetch({ documents: [
      { documentId: 'd1', name: 'Позов', type: 'pleading', route: 'slice', fragments: [{ fileId: 'big', startPage: 1, endPage: 4 }] },
      { documentId: 'd2', name: 'Ухвала', type: 'court_act', route: 'slice', fragments: [{ fileId: 'big', startPage: 5, endPage: 6 }] },
    ], unusedPages: [] });
    const res = await run([await file('big', 6)]);
    expect(res.ok).toBe(true);
    expect(docs().map((d) => d.name).sort()).toEqual(['Позов.pdf', 'Ухвала.pdf'].sort());
  });

  it('fragment_reconstruct → документ із 2 файлів зведено в 1', async () => {
    stubTriageFetch({ documents: [{ documentId: 'd1', name: 'Експертиза', type: 'evidence', route: 'fragment_reconstruct', fragments: [{ fileId: 'f0', startPage: 1, endPage: 3 }, { fileId: 'f1', startPage: 1, endPage: 2 }] }], unusedPages: [] });
    const res = await run([await file('f0', 3), await file('f1', 2)]);
    expect(res.ok).toBe(true);
    expect(docs()).toHaveLength(1);
    expect(docs()[0].name).toBe('Експертиза.pdf');
  });

  it('image_merge → mergeImagesToPdf seam з джерелами у порядку плану → 1 документ', async () => {
    stubTriageFetch({ documents: [{ documentId: 'd1', name: 'Договір', type: 'contract', route: 'image_merge', fragments: [{ fileId: 'p1', startPage: 1, endPage: 1 }, { fileId: 'p2', startPage: 1, endPage: 1 }] }], unusedPages: [] });
    const res = await run([await file('p1', 1, 'image/jpeg', 'IMG_1.jpg'), await file('p2', 1, 'image/jpeg', 'IMG_2.jpg')]);
    expect(res.ok).toBe(true);
    expect(mergeSpy).toHaveBeenCalledTimes(1);
    expect(mergeSpy.mock.calls[0][0].images.map((i) => i.name)).toEqual(['IMG_1.jpg', 'IMG_2.jpg']);
    expect(docs()).toHaveLength(1);
    expect(docs()[0].name).toBe('Договір.pdf');
  });

  it('to_fragments → 03_ФРАГМЕНТИ (без канонічного документа)', async () => {
    const fragFolder = await port.getOrCreateFolder('03_ФРАГМЕНТИ', null);
    const caseData = structuredClone(CASE);
    caseData.storage.subFolders['03_ФРАГМЕНТИ'] = fragFolder.id;
    stubTriageFetch({ documents: [
      { documentId: 'd1', name: 'Рішення', type: 'court_act', route: 'add_as_is', fragments: [{ fileId: 'm', startPage: 1, endPage: 2 }] },
      { documentId: 'd2', name: 'Обкладинка', route: 'to_fragments', fragments: [{ fileId: 'm', startPage: 3, endPage: 3 }] },
    ], unusedPages: [] });
    const res = await run([await file('m', 3)], caseData);
    expect(res.ok).toBe(true);
    expect(docs()).toHaveLength(1);                                   // лише add_as_is
    expect(port._allNames().some((n) => /^fragment_001\.pdf$/.test(n))).toBe(true);
  });

  it('discard → нічого у справі і на Drive', async () => {
    stubTriageFetch({ documents: [
      { documentId: 'd1', name: 'Документ', route: 'add_as_is', fragments: [{ fileId: 'x', startPage: 1, endPage: 2 }] },
      { documentId: 'd2', name: 'Сміття', route: 'discard', fragments: [{ fileId: 'x', startPage: 3, endPage: 3 }] },
    ], unusedPages: [] });
    const res = await run([await file('x', 3)]);
    expect(res.ok).toBe(true);
    expect(docs()).toHaveLength(1);
    expect(docs().some((d) => /Сміття/.test(d.name))).toBe(false);
  });

  it('G3 (bug 1): над-сегментація Triage (квитанція 3 назвами) → реєстр без дублів', async () => {
    stubTriageFetch({ documents: [
      { documentId: 'd1', name: 'Позовна заява', type: 'pleading', route: 'slice', fragments: [{ fileId: 'big', startPage: 1, endPage: 5 }] },
      // Та сама квитанція трьома назвами з тих самих сторінок (корінь bug 1).
      { documentId: 'd2', name: 'Квитанція про оплату судового збору', type: 'court_act', route: 'add_as_is', fragments: [{ fileId: 'big', startPage: 6, endPage: 6 }] },
      { documentId: 'd3', name: 'Платіжна інструкція', type: 'court_act', route: 'add_as_is', fragments: [{ fileId: 'big', startPage: 6, endPage: 6 }] },
      { documentId: 'd4', name: 'Платіжна інструкція (судовий збір)', type: 'court_act', route: 'add_as_is', fragments: [{ fileId: 'big', startPage: 6, endPage: 6 }] },
    ], unusedPages: [] });
    const res = await run([await file('big', 6)]);
    expect(res.ok).toBe(true);
    // Було б 4 (корінь bug 1) — стало 2: позов + 1 квитанція (3 зведено).
    expect(docs()).toHaveLength(2);
    const names = docs().map((d) => d.name).sort();
    expect(names).toEqual(['Квитанція про оплату судового збору.pdf', 'Позовна заява.pdf']);
  });
});
