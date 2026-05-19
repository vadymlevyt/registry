// G1 Provider-INTEGRATION (обмеження §2.1) — bug 2 наскрізь.
// Корінь bug 2 пройшов би повз юніти без цього: writeProcessedArtifacts
// зрізає правильно ізольовано, але якщо streamingExecutor реально не дає
// per-page layoutJson у ctx.files (як у DP-4 з detectSingle) — стадія тихо
// пише цілий файл, жоден тест не ловить. Тут СПРАВЖНІЙ заморожений диригент
// + streamingExecutor + РЕАЛЬНІ createTriageStage/createExtractV3/
// createSplitDocumentsV3 (Provider-shape); processChunk віддає per-page
// layout (як documentAi._text); єдиний мок — fetch плану Triage. Перевіряємо
// що TXT кожного документа = ЛИШЕ його діапазон сторінок.
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
  id: 'case_ts', name: 'Text slice', tenantId: 'tenant_1', ownerId: 'vadym',
  documents: [], proceedings: [{ id: 'proc_main', title: 'Основне' }], storage: { subFolders: {} },
};
const realTriage = ({ artifacts, userHint, caseId }) =>
  analyzeTriageViaToolUse({ artifacts, userHint, caseId, apiKey: 'test-key' });

function buildExecutor(port, h, textSpy) {
  return createStreamingExecutor({
    drivePort: port, workerClient: wc, createPipeline: createDocumentPipeline,
    // processChunk дзеркалить documentAi: текст + per-page layout з _text.
    processChunk: async ({ startPage, endPage }) => {
      const pages = [];
      for (let p = startPage; p <= endPage; p++) pages.push({ _text: `ТЕКСТ-СТОРІНКИ-${p}` });
      return { text: pages.map((x) => x._text).join('\n'), layout: pages };
    },
    perf: {},
    buildPipelineDeps: ({ getStreamedText, getStreamedLayout }) => ({
      stageOverrides: {
        detectBoundaries: createTriageStage({ triage: realTriage, getStreamedText, getStreamedLayout }),
        extract: createExtractV3({ getStreamedText, getStreamedLayout }),
        confirm: createConfirmBoundaries({}),
        persist: createSplitDocumentsV3({
          runInWorker: wc.runInWorker, drivePort: port,
          uploadFile: async (f) => {
            const folder = await port.getOrCreateFolder('01_ОРИГІНАЛИ', null);
            const bytes = f._bytes || new Uint8Array(await f.arrayBuffer());
            return (await port.uploadBytes(folder.id, f.name, bytes, 'application/pdf')).id;
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
          // Захоплюємо ровно те, що пішло б у 02_ОБРОБЛЕНІ (ocrService seam).
          writeText02: async (a) => { textSpy.push({ name: a.name, text: a.text }); },
          writeLayout02: async () => {},
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
const file = async (id, pages) =>
  ({ fileId: id, name: `${id}.pdf`, arrayBuffer: toArrayBuffer(await makePdfBytes(pages)), size: pages * 1500, originalMime: 'application/pdf' });

describe('G1 Provider-integration — TXT 02_ОБРОБЛЕНІ зрізаний за документом', () => {
  let h, port, textSpy;
  beforeEach(() => {
    progressStore._resetForTests();
    h = createHarness({ initialCases: [structuredClone(CASE)] });
    port = createMemDrivePort();
    textSpy = [];
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  async function run(files) {
    const exec = buildExecutor(port, h, textSpy);
    return exec.run({ caseId: 'case_ts', caseData: structuredClone(CASE), agentId: 'document_processor_agent', source: 'manual', addedBy: 'user', files });
  }

  it('slice 6-стор. PDF → 2 документи, кожен TXT лише свій діапазон (НЕ весь файл)', async () => {
    stubTriageFetch({ documents: [
      { documentId: 'd1', name: 'Позов', type: 'pleading', route: 'slice', fragments: [{ fileId: 'big', startPage: 1, endPage: 3 }] },
      { documentId: 'd2', name: 'Ухвала', type: 'court_act', route: 'slice', fragments: [{ fileId: 'big', startPage: 4, endPage: 6 }] },
    ], unusedPages: [] });
    const res = await run([await file('big', 6)]);
    expect(res.ok).toBe(true);
    expect(textSpy).toHaveLength(2);

    const pozov = textSpy.find((x) => x.name === 'Позов.pdf');
    const uhvala = textSpy.find((x) => x.name === 'Ухвала.pdf');
    expect(pozov.text).toContain('ТЕКСТ-СТОРІНКИ-1');
    expect(pozov.text).toContain('ТЕКСТ-СТОРІНКИ-3');
    expect(pozov.text).not.toContain('ТЕКСТ-СТОРІНКИ-4');   // не текст іншого документа
    expect(uhvala.text).toContain('ТЕКСТ-СТОРІНКИ-4');
    expect(uhvala.text).toContain('ТЕКСТ-СТОРІНКИ-6');
    expect(uhvala.text).not.toContain('ТЕКСТ-СТОРІНКИ-1');   // не змішаний (корінь bug 2)
  });
});
