// Ф2 Provider-INTEGRATION (обмеження §2.1 — головна нова тест-вимога).
// Тут ламались DP-3/4: стадія зелена ізольовано, а Provider не ін'єктував
// реальні deps → ланцюг тихо падав, жоден тест не ловив.
//
// Цей тест ганяє СПРАВЖНІЙ заморожений диригент (createDocumentPipeline)
// через streamingExecutor + buildPipelineDeps, що ДЗЕРКАЛИТЬ Provider:
//   detectBoundaries: createTriageStage({ triage: <РЕАЛЬНИЙ
//     analyzeTriageViaToolUse>, getStreamedText, getStreamedLayout })
// Єдиний мок — global fetch (як у Provider при живому ключі). Перевіряє
// .route per-артефакт на КОЖЕН маршрут наскрізь Provider→executor→стадія.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDocumentPipeline } from '../../src/services/documentPipeline.js';
import { createDocument } from '../../src/services/documentFactory.js';
import { createTriageStage } from '../../src/services/documentPipeline/stages/triageStage.js';
import { createConfirmBoundaries } from '../../src/services/documentPipeline/stages/confirmBoundaries.js';
import { createExtractV3 } from '../../src/services/documentPipeline/stages/extractV3.js';
import { analyzeTriageViaToolUse } from '../../src/services/documentBoundary/analyzeTriageViaToolUse.js';
import { createStreamingExecutor } from '../../src/services/documentPipeline/streamingExecutor.js';
import { createWorkerClient } from '../../src/services/documentPipeline/workerClient.js';
import * as progressStore from '../../src/services/documentPipeline/jobProgressStore.js';
import { createHarness } from './_actionsTestSetup.js';
import { createMemDrivePort } from '../_memDrivePort.js';
import { makePdfBytes, toArrayBuffer } from '../_pdfFixture.js';

const wc = createWorkerClient({ forceInProcess: true });
const CASE = {
  id: 'case_tri', name: 'Triage', tenantId: 'tenant_1', ownerId: 'vadym',
  documents: [], proceedings: [{ id: 'proc_main', title: 'Основне' }], storage: { subFolders: {} },
};

// Provider-shape triage-транспорт: РЕАЛЬНИЙ analyzeTriageViaToolUse (модель,
// промпт, JSON-parse, білінг — справжні; лише fetch застабнутий).
const realTriage = ({ artifacts, userHint, caseId }) =>
  analyzeTriageViaToolUse({ artifacts, userHint, caseId, apiKey: 'test-key' });

function buildExecutor(port, h, captured) {
  return createStreamingExecutor({
    drivePort: port,
    workerClient: wc,
    createPipeline: createDocumentPipeline,            // СПРАВЖНІЙ заморожений диригент
    processChunk: async ({ startPage }) => ({ text: `текст стор ${startPage}` }),
    perf: {},
    buildPipelineDeps: ({ getStreamedText, getStreamedLayout }) => ({
      stageOverrides: {
        // САМЕ так Provider ін'єктує detectBoundaries (Ф2).
        detectBoundaries: createTriageStage({ triage: realTriage, getStreamedText, getStreamedLayout }),
        extract: createExtractV3({ getStreamedText, getStreamedLayout }),
        confirm: createConfirmBoundaries({}),           // autoConfirm true
        // Захоплюємо план ПІСЛЯ confirm (route-диспетч PERSIST — Ф3).
        // Додаємо документ у ctx — диригент вважає прогін успішним лише за
        // ctx.documents.length>0 (documentPipeline.js:417).
        persist: async (ctx) => {
          captured.plan = ctx.reconstructionPlan;
          const docs = (ctx.reconstructionPlan?.documents || []).map((d, i) =>
            createDocument({ name: d.name || `doc${i}`, driveId: `cap_${i}`, size: 1, addedBy: 'system', namingStatus: 'auto' }));
          return { ok: true, ctx: { ...ctx, documents: [...ctx.documents, ...docs] } };
        },
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
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify(plan) }],
    usage: { input_tokens: 10, output_tokens: 5 },
  }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function file(fileId, pages, mime = 'application/pdf', name) {
  return { fileId, name: name || `${fileId}.pdf`, arrayBuffer: toArrayBuffer(await makePdfBytes(pages)), size: pages * 1500, originalMime: mime };
}

describe('Ф2 Provider-integration — Triage маршрутизує наскрізь диригент', () => {
  let h, port, captured;
  beforeEach(() => {
    progressStore._resetForTests();
    h = createHarness({ initialCases: [structuredClone(CASE)] });
    port = createMemDrivePort();
    captured = {};
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  async function run(files) {
    const exec = buildExecutor(port, h, captured);
    return exec.run({
      caseId: 'case_tri', caseData: structuredClone(CASE),
      agentId: 'document_processor_agent', source: 'manual', addedBy: 'user', files,
    });
  }

  it('route add_as_is — готовий PDF проходить як один документ', async () => {
    stubTriageFetch({ documents: [{ documentId: 'd1', name: 'Ухвала', type: 'court_act', route: 'add_as_is', fragments: [{ fileId: 'a', startPage: 1, endPage: 3 }] }], unusedPages: [] });
    const res = await run([await file('a', 3)]);
    expect(res.ok).toBe(true);
    expect(captured.plan.confirmed).toBe(true);
    expect(captured.plan.documents.map((d) => d.route)).toEqual(['add_as_is']);
  });

  it('route slice — один PDF → кілька документів', async () => {
    stubTriageFetch({ documents: [
      { documentId: 'd1', name: 'Позов', type: 'pleading', route: 'slice', fragments: [{ fileId: 'big', startPage: 1, endPage: 4 }] },
      { documentId: 'd2', name: 'Ухвала', type: 'court_act', route: 'slice', fragments: [{ fileId: 'big', startPage: 5, endPage: 6 }] },
    ], unusedPages: [] });
    const res = await run([await file('big', 6)]);
    expect(res.ok).toBe(true);
    expect(captured.plan.documents.map((d) => d.route)).toEqual(['slice', 'slice']);
    expect(captured.plan.documents[1].fragments[0].startPage).toBe(5);
  });

  it('route image_merge (AI) — група фото = один документ', async () => {
    stubTriageFetch({ documents: [{ documentId: 'd1', name: 'Договір', route: 'image_merge', fragments: [{ fileId: 'p1', startPage: 1, endPage: 1 }, { fileId: 'p2', startPage: 1, endPage: 1 }] }], unusedPages: [] });
    const res = await run([await file('p1', 1, 'image/jpeg', 'IMG_001.jpg'), await file('p2', 1, 'image/jpeg', 'IMG_002.jpg')]);
    expect(res.ok).toBe(true);
    expect(captured.plan.documents[0].route).toBe('image_merge');
    expect(captured.plan.documents[0].fragments).toHaveLength(2);
  });

  it('route fragment_reconstruct — документ розрізаний по кількох PDF', async () => {
    stubTriageFetch({ documents: [{ documentId: 'd1', name: 'Експертиза', type: 'evidence', route: 'fragment_reconstruct', fragments: [{ fileId: 'f0', startPage: 1, endPage: 3 }, { fileId: 'f1', startPage: 1, endPage: 2 }] }], unusedPages: [] });
    const res = await run([await file('f0', 3), await file('f1', 2)]);
    expect(res.ok).toBe(true);
    expect(captured.plan.documents[0].route).toBe('fragment_reconstruct');
    expect(captured.plan.documents[0].fragments.map((x) => x.fileId)).toEqual(['f0', 'f1']);
  });

  it('route to_fragments + discard — службове/сміття у плані', async () => {
    stubTriageFetch({ documents: [
      { documentId: 'd1', name: 'Документ', route: 'add_as_is', fragments: [{ fileId: 'm', startPage: 1, endPage: 2 }] },
      { documentId: 'd2', name: 'Обкладинка', route: 'to_fragments', fragments: [{ fileId: 'm', startPage: 3, endPage: 3 }] },
      { documentId: 'd3', name: 'Порожнє', route: 'discard', fragments: [] },
    ], unusedPages: [{ fileId: 'm', startPage: 4, endPage: 4, reason: 'порожня' }] });
    const res = await run([await file('m', 4)]);
    expect(res.ok).toBe(true);
    const routes = captured.plan.documents.map((d) => d.route);
    expect(routes).toEqual(['add_as_is', 'to_fragments', 'discard']);
    expect(captured.plan.unusedPages[0].reason).toBe('порожня');
  });

  it('детермінована сітка — 1 фото 1 сторінка → image_merge БЕЗ AI-виклику', async () => {
    const fetchMock = stubTriageFetch({ documents: [], unusedPages: [] });
    const res = await run([await file('solo', 1, 'image/png', 'photo.png')]);
    expect(res.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();             // сітка пре-фільтрує без токенів
    expect(captured.plan.documents[0].route).toBe('image_merge');
  });
});
