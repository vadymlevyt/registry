// dp-enriched-digest — Provider-INTEGRATION ЯКІСНОЇ поведінки (обмеження №1).
//
// Це той тип тесту, якого НЕ було для Phase B P1 (паралелізація PERSIST):
// 25-doc реалістичний план через справжній DocumentPipelineProvider +
// executor + диригент → ВСІ 25 documents мають бути створені, branch
// 'slice' повністю виконана, без passthrough.
//
// Phase B зламала саме якісну поведінку: тести concurrency-ліміту були
// зелені, але 25-doc план тихо проваджувався в passthrough. Цей тест
// стереже від такого: якщо план з 25 документів повертає <25 у persist →
// червоний.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDocumentPipeline } from '../../src/services/documentPipeline.js';
import { createDocument } from '../../src/services/documentFactory.js';
import { createTriageStage } from '../../src/services/documentPipeline/stages/triageStage.js';
import { createConfirmBoundaries } from '../../src/services/documentPipeline/stages/confirmBoundaries.js';
import { createExtractV3 } from '../../src/services/documentPipeline/stages/extractV3.js';
import { analyzeTriageViaToolUse } from '../../src/services/documentBoundary/analyzeTriageViaToolUse.js';
import { detectTableOfContents } from '../../src/services/documentBoundary/tocDetector.js';
import { createStreamingExecutor } from '../../src/services/documentPipeline/streamingExecutor.js';
import { createWorkerClient } from '../../src/services/documentPipeline/workerClient.js';
import * as progressStore from '../../src/services/documentPipeline/jobProgressStore.js';
import { createMemDrivePort } from '../_memDrivePort.js';
import { makePdfBytes, toArrayBuffer } from '../_pdfFixture.js';

const wc = createWorkerClient({ forceInProcess: true });
const CASE = {
  id: 'case_enriched', name: 'Enriched', tenantId: 'tenant_1', ownerId: 'vadym',
  documents: [], proceedings: [{ id: 'proc_main', title: 'Основне' }], storage: { subFolders: {} },
};

const realTriage = ({ artifacts, userHint, caseId }) =>
  analyzeTriageViaToolUse({ artifacts, userHint, caseId, apiKey: 'test-key' });
const realTocDetect = ({ fileId, layoutJson, totalPages, caseId }) =>
  detectTableOfContents({ fileId, layoutJson, totalPages, caseId, apiKey: 'test-key' });

// Створюємо реалістичний layout на 30 сторінок з сигналами (НЕ реєстр —
// щоб ToC не активувався і пішов AI Triage з збагаченим дайджестом).
function buildRealisticLayout(totalPages) {
  const pages = [];
  for (let i = 0; i < totalPages; i++) {
    // Кожна 4-та сторінка — початок нового документа з ЯКОРЕМ + ПОЧАТОК-ДОКУМЕНТА.
    const isDocStart = i % 4 === 0;
    const docNum = Math.floor(i / 4) + 1;
    const pageInDoc = (i % 4) + 1;
    pages.push({
      _text: isDocStart
        ? `ПОСТАНОВА\nпро провадження № ${docNum}\n${pageInDoc} з 4`
        : `продовження тексту постанови № ${docNum}\nсторінка ${pageInDoc}\n${pageInDoc} з 4`,
      blocks: isDocStart ? [
        { layout: { boundingPoly: { normalizedVertices: [
          { x: 0.35, y: 0.05 }, { x: 0.65, y: 0.05 }, { x: 0.65, y: 0.10 }, { x: 0.35, y: 0.10 },
        ] } } },
        { layout: { boundingPoly: { normalizedVertices: [
          { x: 0.05, y: 0.20 }, { x: 0.95, y: 0.20 }, { x: 0.95, y: 0.40 }, { x: 0.05, y: 0.40 },
        ] } } },
      ] : [{ layout: { boundingPoly: { normalizedVertices: [
        { x: 0.05, y: 0.20 }, { x: 0.95, y: 0.20 }, { x: 0.95, y: 0.40 }, { x: 0.05, y: 0.40 },
      ] } } }],
      dimension: { width: 595, height: 842 },
      imageQualityScores: { qualityScore: isDocStart ? 0.92 : 0.88 },
      detectedLanguages: [{ languageCode: 'uk' }],
    });
  }
  return pages;
}

function buildExecutor(port, captured, layoutPages) {
  return createStreamingExecutor({
    drivePort: port,
    workerClient: wc,
    createPipeline: createDocumentPipeline,
    processChunk: async ({ startPage, endPage }) => {
      // Повертаємо layout-сторінки за діапазоном з нашого фіксованого набору.
      const slice = layoutPages.slice(startPage - 1, endPage);
      return { text: slice.map((p) => p._text).join('\n'), layout: slice };
    },
    perf: {},
    buildPipelineDeps: ({ getStreamedText, getStreamedLayout }) => ({
      stageOverrides: {
        detectBoundaries: createTriageStage({
          triage: realTriage,
          tocDetect: realTocDetect,
          getStreamedText,
          getStreamedLayout,
        }),
        extract: createExtractV3({ getStreamedText, getStreamedLayout }),
        confirm: createConfirmBoundaries({}),
        persist: async (ctx) => {
          captured.plan = ctx.reconstructionPlan;
          captured.decisions = ctx.decisions;
          captured.passportSent = ctx.passportSentToTriage;
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

// Stub fetch для AI: AI Triage отримує passport з нашими сигналами і
// повертає plan з документів за реєстром (тут — без ToC, бо це не реєстр).
function stubFetchWith25DocPlan(fileId) {
  const documents = Array.from({ length: 25 }, (_, i) => ({
    documentId: `d${i + 1}`,
    name: `Постанова ${i + 1}`,
    type: 'court_act',
    route: 'slice',
    fragments: [{ fileId, startPage: i * 4 + 1, endPage: Math.min(i * 4 + 4, 100) }],
    open: false,
  }));
  const fetchMock = vi.fn(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const text = body.messages?.[0]?.content?.[0]?.text || '';
    let respText;
    if (text.includes('isRegistry')) {
      // ToC detect: НЕ реєстр (це тест branch B — збагачений дайджест)
      respText = JSON.stringify({ isRegistry: false, registryHeaderText: null, registryPages: [], firstDocumentPage: null });
    } else if (text.includes('startLeaf')) {
      respText = JSON.stringify({ items: [] });
    } else if (text.includes('Маршрути (route)')) {
      // AI Triage: повертаємо 25-doc план
      respText = JSON.stringify({ documents, unusedPages: [] });
    } else {
      respText = '{}';
    }
    return new Response(JSON.stringify({
      content: [{ type: 'text', text: respText }],
      usage: { input_tokens: 100, output_tokens: 50 },
    }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ФД-I dp-enriched-digest — Provider-INTEGRATION якісної поведінки 25-doc', () => {
  let port, captured;
  beforeEach(() => {
    progressStore._resetForTests();
    port = createMemDrivePort();
    captured = {};
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('25-doc реалістичний план через Provider → ВСІ 25 створені у persist (страж Phase B)', async () => {
    // 100 сторінок (25 документів по 4 стор. кожен) — без реєстру → AI Triage з збагаченим дайджестом
    const layoutPages = buildRealisticLayout(100);
    const fileId = 'enriched_file';
    stubFetchWith25DocPlan(fileId);
    const exec = buildExecutor(port, captured, layoutPages);
    const res = await exec.run({
      caseId: 'case_enriched', caseData: structuredClone(CASE),
      agentId: 'document_processor_agent', source: 'manual', addedBy: 'user',
      files: [{
        fileId, name: 'enriched.pdf',
        arrayBuffer: toArrayBuffer(await makePdfBytes(100)),
        size: 100 * 1500, originalMime: 'application/pdf',
      }],
    });
    // Це КРИТИЧНИЙ assert якісної поведінки 25-doc плану (обмеження №1).
    expect(res.ok).toBe(true);
    expect(captured.plan).toBeDefined();
    expect(captured.plan.documents).toHaveLength(25);
    expect(res.documents).toHaveLength(25);
    // Усі documents з route 'slice', не passthrough.
    expect(captured.plan.documents.every((d) => d.route === 'slice')).toBe(true);
  });

  it('AI Triage отримав збагачений паспорт з новими сигналами (ЯКІР, ПОЧАТОК, тощо)', async () => {
    const layoutPages = buildRealisticLayout(100);
    const fileId = 'signals_file';
    let triagePromptText = '';
    const fetchMock = vi.fn(async (_url, opts) => {
      const body = JSON.parse(opts.body);
      const text = body.messages?.[0]?.content?.[0]?.text || '';
      if (text.includes('isRegistry')) {
        return new Response(JSON.stringify({
          content: [{ type: 'text', text: JSON.stringify({ isRegistry: false, registryPages: [] }) }],
          usage: { input_tokens: 50, output_tokens: 25 },
        }), { status: 200 });
      }
      if (text.includes('Маршрути (route)')) {
        triagePromptText = text;
        return new Response(JSON.stringify({
          content: [{ type: 'text', text: JSON.stringify({
            documents: [{ documentId: 'd1', name: 'X', route: 'add_as_is', fragments: [{ fileId, startPage: 1, endPage: 100 }] }],
            unusedPages: [],
          }) }],
          usage: { input_tokens: 100, output_tokens: 50 },
        }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const exec = buildExecutor(port, captured, layoutPages);
    await exec.run({
      caseId: 'case_enriched', caseData: structuredClone(CASE),
      agentId: 'document_processor_agent', source: 'manual', addedBy: 'user',
      files: [{
        fileId, name: 'sig.pdf',
        arrayBuffer: toArrayBuffer(await makePdfBytes(100)),
        size: 100 * 1500, originalMime: 'application/pdf',
      }],
    });
    // Triage prompt має містити збагачений паспорт зі сигналами дайджесту.
    expect(triagePromptText).toContain('=== СТОРІНКА 1 ===');
    // СИЛЬНІ сигнали з фіктивних layout-сторінок мають дійти у паспорт:
    expect(triagePromptText).toContain('ПОЧАТОК-ДОКУМЕНТА');
    expect(triagePromptText).toContain('ЯКІР-ДОКУМЕНТА');
    expect(triagePromptText).toContain('заголовок:"ПОСТАНОВА"');
    expect(triagePromptText).toContain('док-стор:1/4');
    // Промпт інструктує аналізувати сигнали у сукупності (нова філософія —
    // «думай, не виконуй буквально»; категорії СИЛЬНІ/СИЛЬНІ-АНТИ прибрані).
    expect(triagePromptText).toMatch(/в\s+сукупності/i);
    expect(triagePromptText).toMatch(/ПРИНЦИП РІШЕННЯ/);
    expect(triagePromptText).toMatch(/орієнтир.*не\s+догма/i);
  });
});
