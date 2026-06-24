// A7.1 — двофазний DP (proposeRun / executeRun) НАСКРІЗЬ: справжній заморожений
// диригент + Triage (detectBoundaries) + реальний split/persist через
// createSplitDocumentsV3 + справжній createActions (_actionsTestSetup).
// Доводить:
//   • proposeRun повертає план і НІЧОГО не персистить (0 документів у справі,
//     0 add_documents, _temp лишається — гейт «до Виконати нічого на Drive»);
//   • executeRun персистить за ПЕРЕДАНИМ (відредагованим) планом, не за
//     запропонованим, і чистить _temp;
//   • run() = композиція proposeRun+executeRun(plan) — behavior-preserving.
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
  id: 'case_2ph', name: 'Двофаза', tenantId: 'tenant_1', ownerId: 'vadym',
  documents: [], proceedings: [{ id: 'proc_main', title: 'Основне' }], storage: { subFolders: {} },
};

const realTriage = ({ artifacts, userHint, caseId }) =>
  analyzeTriageViaToolUse({ artifacts, userHint, caseId, apiKey: 'test-key' });

function buildExecutor(port, h) {
  return createStreamingExecutor({
    drivePort: port,
    workerClient: wc,
    createPipeline: createDocumentPipeline,
    processChunk: async ({ startPage }) => ({ text: `текст стор ${startPage}` }),
    perf: {},
    buildPipelineDeps: ({ getStreamedText, getStreamedLayout }) => ({
      stageOverrides: {
        detectBoundaries: createTriageStage({ triage: realTriage, getStreamedText, getStreamedLayout }),
        extract: createExtractV3({ getStreamedText, getStreamedLayout }),
        confirm: createConfirmBoundaries({}),
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
          eventBus: { publish: () => {} },
          topics: { DOCUMENT_FRAGMENT_SAVED },
        }),
      },
      uploadFile: async () => 'unused',
      createDocument,
      eventBus: { publish: () => {} },
      topics: { DOCUMENT_INGESTED: 'document.ingested', DOCUMENT_BATCH_PROCESSED: 'document.batch_processed' },
      getActor: () => ({ userId: 'vadym', tenantId: 'tenant_1' }),
    }),
  });
}

function stubTriageFetch(plan) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify(plan) }],
    usage: { input_tokens: 10, output_tokens: 5 },
  }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function file(fileId, pages) {
  return { fileId, name: `${fileId}.pdf`, arrayBuffer: toArrayBuffer(await makePdfBytes(pages)), size: pages * 1500, originalMime: 'application/pdf' };
}

// План на 2 add_as_is-документи (по файлу). Той самий, що повертає Triage-стаб.
const TWO_DOC_PLAN = {
  documents: [
    { documentId: 'd1', name: 'Документ А', type: 'pleading', route: 'add_as_is', fragments: [{ fileId: 'a', startPage: 1, endPage: 2 }] },
    { documentId: 'd2', name: 'Документ Б', type: 'court_act', route: 'add_as_is', fragments: [{ fileId: 'b', startPage: 1, endPage: 2 }] },
  ],
  unusedPages: [],
};

function docsOf(h) {
  return h.getCases().find((c) => c.id === 'case_2ph').documents;
}

describe('A7.1 — двофазний DP наскрізь', () => {
  let h, port;
  beforeEach(() => {
    progressStore._resetForTests();
    h = createHarness({ initialCases: [structuredClone(CASE)] });
    port = createMemDrivePort();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  function input() {
    return {
      caseId: 'case_2ph', caseData: structuredClone(CASE), jobId: 'j2ph',
      agentId: 'document_processor_agent', source: 'manual', addedBy: 'user',
    };
  }

  it('proposeRun повертає план і НЕ персистить (0 документів, 0 на Drive, _temp лишається)', async () => {
    stubTriageFetch(TWO_DOC_PLAN);
    const exec = buildExecutor(port, h);
    const proposed = await exec.proposeRun({ ...input(), files: [await file('a', 2), await file('b', 2)] });

    expect(proposed.ok).toBe(true);
    expect(proposed.session).toBeTruthy();
    expect(proposed.plan.documents).toHaveLength(2);
    expect(proposed.plan.documents.map((d) => d.name)).toEqual(['Документ А', 'Документ Б']);

    // Гейт: жодного документа у справі, жодного фінального файлу 01_ОРИГІНАЛИ.
    expect(docsOf(h)).toHaveLength(0);
    expect(port._allNames().some((n) => n === 'a.pdf' || n === 'b.pdf')).toBe(false);
    // _temp ЖИВИЙ (proposeRun не чистить) — job_state і temp-оригінали на місці.
    expect(port._countFilesNamed('job_state.json')).toBeGreaterThan(0);
    expect(port._allNames().some((n) => /^orig_/.test(n))).toBe(true);
  });

  it('executeRun персистить за ПЕРЕДАНИМ (відредагованим) планом, не за запропонованим', async () => {
    stubTriageFetch(TWO_DOC_PLAN);
    const exec = buildExecutor(port, h);
    const proposed = await exec.proposeRun({ ...input(), files: [await file('a', 2), await file('b', 2)] });
    expect(proposed.plan.documents).toHaveLength(2);

    // Адвокат відредагував: лишив ОДИН документ (тільки файл a), нова назва.
    const editedPlan = {
      documents: [
        { documentId: 'e1', name: 'Лише А (відредаговано)', type: 'pleading', route: 'add_as_is', fragments: [{ fileId: 'a', startPage: 1, endPage: 2 }] },
      ],
      unusedPages: [],
    };
    const res = await exec.executeRun(proposed.session, editedPlan);

    expect(res.ok).toBe(true);
    expect(res.cleanedUp).toBe(true);
    const stored = docsOf(h);
    expect(stored).toHaveLength(1);                       // 1, не запропоновані 2
    // Персистована назва отримує суфікс `.pdf` (splitDocumentsV3 route-handler),
    // на відміну від назви у плані (без суфікса) — поведінка незмінна.
    expect(stored[0].name).toBe('Лише А (відредаговано).pdf');
    // _temp прибрано на успіху Фази 2.
    expect(port._countFilesNamed('job_state.json')).toBe(0);
    expect(port._allNames().some((n) => /^orig_|^chunk_/.test(n))).toBe(false);
  });

  it('A7.3: дата тече propose→persist — editedPlan з manual-датою → createDocument.date', async () => {
    stubTriageFetch(TWO_DOC_PLAN);
    const exec = buildExecutor(port, h);
    const proposed = await exec.proposeRun({ ...input(), files: [await file('a', 2), await file('b', 2)] });

    // Адвокат поставив дату на перший документ (manual); тумблер OFF.
    const editedPlan = {
      applyAutoDates: false,
      documents: [
        { documentId: 'e1', name: 'З датою', type: 'pleading', route: 'add_as_is', date: '2026-03-14', dateSource: 'manual', fragments: [{ fileId: 'a', startPage: 1, endPage: 2 }] },
        { documentId: 'e2', name: 'Без дати', type: 'court_act', route: 'add_as_is', date: null, dateSource: 'auto', fragments: [{ fileId: 'b', startPage: 1, endPage: 2 }] },
      ],
      unusedPages: [],
    };
    const res = await exec.executeRun(proposed.session, editedPlan);
    expect(res.ok).toBe(true);
    const stored = docsOf(h);
    const withDate = stored.find((d) => d.name === 'З датою.pdf');
    const noDate = stored.find((d) => d.name === 'Без дати.pdf');
    expect(withDate.date).toBe('2026-03-14');             // manual → персистована
    expect(noDate.date).toBeNull();                       // auto + тумблер OFF → null
  });

  it('A7.3: applyAutoDates ON у плані → auto-дата персиститься (executeRun)', async () => {
    stubTriageFetch(TWO_DOC_PLAN);
    const exec = buildExecutor(port, h);
    const proposed = await exec.proposeRun({ ...input(), files: [await file('a', 2)] });
    const editedPlan = {
      applyAutoDates: true,
      documents: [
        { documentId: 'e1', name: 'Авто', route: 'add_as_is', date: '2026-06-01', dateSource: 'auto', fragments: [{ fileId: 'a', startPage: 1, endPage: 2 }] },
      ],
      unusedPages: [],
    };
    await exec.executeRun(proposed.session, editedPlan);
    expect(docsOf(h).find((d) => d.name === 'Авто.pdf').date).toBe('2026-06-01');
  });

  it('run() = композиція: персистить ЗАПРОПОНОВАНИЙ план без редагування (behavior-preserving)', async () => {
    stubTriageFetch(TWO_DOC_PLAN);
    const exec = buildExecutor(port, h);
    const res = await exec.run({ ...input(), files: [await file('a', 2), await file('b', 2)] });

    expect(res.ok).toBe(true);
    expect(res.cleanedUp).toBe(true);
    const stored = docsOf(h);
    expect(stored).toHaveLength(2);
    expect(stored.map((d) => d.name).sort()).toEqual(['Документ А.pdf', 'Документ Б.pdf']);
    expect(port._countFilesNamed('job_state.json')).toBe(0);
  });
});
