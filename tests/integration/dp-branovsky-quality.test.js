// dp-branovsky-quality — REGRESSION тест якості нарізки на Брановський-like
// томі (65 стор., без реєстру, цивільна справа з ~28 документами).
//
// Baseline з diagnostic_dp_large_volume_test.md: реальний прогон дав ~85-93%
// точності (24-26/28). Цей тест МАЄ підтвердити що зміни ФД-D1+D2+D2.5+D3
// НЕ регресували нижче 85% (а краще покращили).
//
// ВАЖЛИВО: це mock-симуляція, не реальний прогін. Тест перевіряє:
// 1. AI Triage отримує паспорт з усіма новими сигналами правильно (ЯКІР,
//    ПОЧАТОК-ДОКУМЕНТА, СКИДАННЯ-НУМЕРАЦІЇ тощо у потрібних місцях).
// 2. Mock AI (з нашим планом) повертає 24 документи зі sliced діапазонами.
// 3. ВСІ 24 documents створюються у persist (не passthrough — страж).
//
// Реальний прогон на планшеті — обов'язковий перед FF у main (STOP #2).
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
  id: 'case_brano', name: 'Брановський (mock)', tenantId: 'tenant_1', ownerId: 'vadym',
  documents: [], proceedings: [{ id: 'proc_main', title: 'Основне' }], storage: { subFolders: {} },
};

// Структура mock-Брановського: 65 стор., 28 документів, без реєстру.
// Назви типові для цивільної справи (позов, ухвали суду, протоколи).
const GROUND_TRUTH_DOCS = [
  { name: 'Позовна заява', start: 1, end: 8 },
  { name: 'Квитанція про сплату судового збору', start: 9, end: 9 },
  { name: 'Довіреність', start: 10, end: 10 },
  { name: 'Договір купівлі-продажу', start: 11, end: 14 },
  { name: 'Свідоцтво про право власності', start: 15, end: 16 },
  { name: 'Постанова про відкриття провадження', start: 17, end: 18 },
  { name: 'Ухвала про відкладення', start: 19, end: 20 },
  { name: 'Заява про прискорення', start: 21, end: 22 },
  { name: 'Клопотання', start: 23, end: 24 },
  { name: 'Висновок експерта', start: 25, end: 30 },
  { name: 'Протокол судового засідання', start: 31, end: 33 },
  { name: 'Постанова про витребування доказів', start: 34, end: 34 },
  { name: 'Лист канцелярії', start: 35, end: 35 },
  { name: 'Довідка', start: 36, end: 36 },
  { name: 'Ухвала про залучення', start: 37, end: 38 },
  { name: 'Постанова про призначення', start: 39, end: 40 },
  { name: 'Заперечення відповідача', start: 41, end: 44 },
  { name: 'Відповідь на заперечення', start: 45, end: 47 },
  { name: 'Протокол судового засідання', start: 48, end: 50 },
  { name: 'Висновок експерта (додатковий)', start: 51, end: 55 },
  { name: 'Клопотання про допит', start: 56, end: 57 },
  { name: 'Ухвала про відкладення (повторно)', start: 58, end: 59 },
  { name: 'Протокол судового засідання', start: 60, end: 62 },
  { name: 'Рішення', start: 63, end: 65 },
];

function buildBranovskyLayout() {
  const pages = [];
  // Утиліта — згенерувати сторінку з потрібними сигналами.
  const layout = (text, opts = {}) => ({
    _text: text,
    blocks: opts.titleBlock
      ? [{ layout: { boundingPoly: { normalizedVertices: [{ x: 0.35, y: 0.05 }, { x: 0.65, y: 0.05 }, { x: 0.65, y: 0.10 }, { x: 0.35, y: 0.10 }] } } },
         { layout: { boundingPoly: { normalizedVertices: [{ x: 0.05, y: 0.20 }, { x: 0.95, y: 0.20 }, { x: 0.95, y: 0.40 }, { x: 0.05, y: 0.40 }] } } }]
      : [{ layout: { boundingPoly: { normalizedVertices: [{ x: 0.05, y: 0.20 }, { x: 0.95, y: 0.20 }, { x: 0.95, y: 0.40 }, { x: 0.05, y: 0.40 }] } } }],
    dimension: { width: 595, height: 842 },
    imageQualityScores: { qualityScore: 0.9 },
  });
  for (const doc of GROUND_TRUTH_DOCS) {
    const docLen = doc.end - doc.start + 1;
    for (let p = doc.start, idx = 1; p <= doc.end; p++, idx++) {
      const isFirst = idx === 1;
      // Тільки перша сторінка документа має title-блок з ЯКОРЕМ.
      const title = isFirst ? doc.name.toUpperCase() : '';
      const body = `${title}\n${isFirst ? `тіло документа ${doc.name}.` : `продовження документа ${doc.name}.`}\n${idx} з ${docLen}`;
      pages.push(layout(body, { titleBlock: isFirst }));
    }
  }
  return pages;
}

const realTriage = ({ artifacts, userHint, caseId }) =>
  analyzeTriageViaToolUse({ artifacts, userHint, caseId, apiKey: 'test-key' });
const realTocDetect = ({ fileId, layoutJson, totalPages, caseId }) =>
  detectTableOfContents({ fileId, layoutJson, totalPages, caseId, apiKey: 'test-key' });

function buildExecutor(port, captured, layoutPages) {
  return createStreamingExecutor({
    drivePort: port,
    workerClient: wc,
    createPipeline: createDocumentPipeline,
    processChunk: async ({ startPage, endPage }) => {
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

// Симулюємо AI Triage який бачить паспорт зі збагаченим дайджестом і
// "правильно" повертає 24 з 24 документів (mock — щоб перевірити що нічого
// не губиться в pipeline). Це не оцінка реальної моделі — це страж від
// регресії pipeline. Для перевірки реальної точності — прогон на планшеті.
function stubFetchForBranovsky(fileId) {
  const documents = GROUND_TRUTH_DOCS.map((d, i) => ({
    documentId: `d${i + 1}`,
    name: d.name,
    type: 'court_act',
    route: 'slice',
    fragments: [{ fileId, startPage: d.start, endPage: d.end }],
    open: false,
  }));
  const fetchMock = vi.fn(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const text = body.messages?.[0]?.content?.[0]?.text || '';
    let respText;
    if (text.includes('isRegistry')) {
      respText = JSON.stringify({ isRegistry: false, registryPages: [], firstDocumentPage: null });
    } else if (text.includes('Маршрути (route)')) {
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

describe('Regression dp-branovsky-quality — точність ≥85% mock-страж', () => {
  let port, captured;
  beforeEach(() => {
    progressStore._resetForTests();
    port = createMemDrivePort();
    captured = {};
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('mock-Брановський 65 стор., 24 doc-план → ВСІ створюються (≥85% baseline)', async () => {
    const layoutPages = buildBranovskyLayout();
    expect(layoutPages.length).toBe(65); // інваріант ground truth
    const fileId = 'branovsky_mock';
    stubFetchForBranovsky(fileId);
    const exec = buildExecutor(port, captured, layoutPages);
    const res = await exec.run({
      caseId: 'case_brano', caseData: structuredClone(CASE),
      agentId: 'document_processor_agent', source: 'manual', addedBy: 'user',
      files: [{
        fileId, name: 'brano.pdf',
        arrayBuffer: toArrayBuffer(await makePdfBytes(65)),
        size: 65 * 1500, originalMime: 'application/pdf',
      }],
    });
    expect(res.ok).toBe(true);
    expect(captured.plan.documents).toHaveLength(GROUND_TRUTH_DOCS.length);
    // Точність mock: 24/24 = 100% (страж від pipeline-регресії; реальна
    // точність — на планшеті). Поріг ≥85% з baseline diagnostic.
    const accuracy = captured.plan.documents.length / GROUND_TRUTH_DOCS.length;
    expect(accuracy).toBeGreaterThanOrEqual(0.85);
  });

  it('AI Triage отримав паспорт з ЯКОРЯМИ і ПОЧАТКАМИ для кожного нового документа', async () => {
    const layoutPages = buildBranovskyLayout();
    const fileId = 'branovsky_signals';
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
      }
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: JSON.stringify({
          documents: [{ documentId: 'd1', name: 'X', route: 'add_as_is', fragments: [{ fileId, startPage: 1, endPage: 65 }] }],
          unusedPages: [],
        }) }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const exec = buildExecutor(port, captured, layoutPages);
    await exec.run({
      caseId: 'case_brano', caseData: structuredClone(CASE),
      agentId: 'document_processor_agent', source: 'manual', addedBy: 'user',
      files: [{
        fileId, name: 'brano_sig.pdf',
        arrayBuffer: toArrayBuffer(await makePdfBytes(65)),
        size: 65 * 1500, originalMime: 'application/pdf',
      }],
    });
    // Кількість ЯКОРІВ у промпті — приблизно стільки скільки документів (мінімум ≥20 з 24).
    const anchors = (triagePromptText.match(/ЯКІР-ДОКУМЕНТА/g) || []).length;
    expect(anchors).toBeGreaterThanOrEqual(20);
    // ПОЧАТОК-ДОКУМЕНТА теж приблизно стільки — кожен документ починається з «1 з N».
    const starts = (triagePromptText.match(/ПОЧАТОК-ДОКУМЕНТА/g) || []).length;
    expect(starts).toBeGreaterThanOrEqual(20);
    // КІНЕЦЬ-ДОКУМЕНТА — для документів довжиною >=2 стор. (більшість з GROUND_TRUTH).
    const ends = (triagePromptText.match(/КІНЕЦЬ-ДОКУМЕНТА/g) || []).length;
    expect(ends).toBeGreaterThanOrEqual(15);
  });
});
