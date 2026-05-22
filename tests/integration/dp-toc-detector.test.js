// dp-toc-detector — Provider-INTEGRATION (обмеження №1 батьківського TASK).
//
// Корінь Phase B-style регресії: стадії зелені ізольовано, але Provider не
// ін'єктував реальні deps → ланцюг тихо падав, жоден тест не ловив. Тут
// ганяємо СПРАВЖНІЙ заморожений диригент через streamingExecutor +
// buildPipelineDeps, що ДЗЕРКАЛИТЬ Provider:
//   detectBoundaries: createTriageStage({
//     triage:    <РЕАЛЬНИЙ analyzeTriageViaToolUse>,
//     tocDetect: <РЕАЛЬНИЙ detectTableOfContents>,
//     getStreamedText, getStreamedLayout,
//   })
// Єдиний мок — global fetch (як у Provider при живому ключі).
//
// Перевіряє якісну поведінку 30-doc реєстру наскрізь Provider→executor→
// стадія (TASK ToC §3.6 acceptance): tocDetector знайшов і розпарсив
// реєстр → план з 30 документів → AI Triage НЕ викликався → persist
// доходить до 30 documents у ctx.
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
import { createHarness } from './_actionsTestSetup.js';
import { createMemDrivePort } from '../_memDrivePort.js';
import { makePdfBytes, toArrayBuffer } from '../_pdfFixture.js';

const wc = createWorkerClient({ forceInProcess: true });
const CASE = {
  id: 'case_toc', name: 'ToC', tenantId: 'tenant_1', ownerId: 'vadym',
  documents: [], proceedings: [{ id: 'proc_main', title: 'Основне' }], storage: { subFolders: {} },
};

// Provider-shape транспорти: РЕАЛЬНІ модулі, лише fetch застабнутий.
const realTriage = ({ artifacts, userHint, caseId }) =>
  analyzeTriageViaToolUse({ artifacts, userHint, caseId, apiKey: 'test-key' });
const realTocDetect = ({ fileId, layoutJson, totalPages, caseId }) =>
  detectTableOfContents({ fileId, layoutJson, totalPages, caseId, apiKey: 'test-key' });

function buildExecutor(port, captured) {
  return createStreamingExecutor({
    drivePort: port,
    workerClient: wc,
    createPipeline: createDocumentPipeline,
    processChunk: async ({ startPage, endPage }) => {
      // Симулюємо chunked OCR — повертаємо layout зі сторінками з відповідними
      // _text за діапазоном. Перші 3 сторінки = реєстр, далі — документи.
      const pages = [];
      for (let p = startPage; p <= endPage; p++) {
        if (p <= 3) {
          // Реєстр-сторінки
          const lines = ['ОПИС ДОКУМЕНТІВ ЯКІ МІСТЯТЬСЯ В ТОМІ', '№ | Назва документа | Аркуші'];
          // На першій сторінці реєстру — заголовок + перші ~12 рядків,
          // на другій — рядки 12-24, на третій — 24-30.
          const from = (p - 1) * 12 + 1;
          const to = Math.min(p * 12, 30);
          for (let n = from; n <= to; n++) {
            lines.push(`${n} | Документ ${n} | ${n}-${n}`);
          }
          pages.push({ _text: lines.join('\n') });
        } else {
          pages.push({ _text: `документ ${p - 3} тіло сторінки` });
        }
      }
      return { text: pages.map((x) => x._text).join('\n\n'), layout: pages };
    },
    perf: {},
    buildPipelineDeps: ({ getStreamedText, getStreamedLayout }) => ({
      stageOverrides: {
        // САМЕ так Provider ін'єктує detectBoundaries (ФД-T2): triage + tocDetect.
        detectBoundaries: createTriageStage({
          triage: realTriage,
          tocDetect: realTocDetect,
          getStreamedText,
          getStreamedLayout,
        }),
        extract: createExtractV3({ getStreamedText, getStreamedLayout }),
        confirm: createConfirmBoundaries({}),
        // Захоплюємо план ПІСЛЯ confirm; додаємо документи у ctx — диригент
        // вважає прогін успішним лише за ctx.documents.length>0
        // (documentPipeline.js:417).
        persist: async (ctx) => {
          captured.plan = ctx.reconstructionPlan;
          captured.decisions = ctx.decisions;
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

// stub fetch для AI-викликів. Кожен виклик ідентифікується за вмістом промпта.
//
// Послідовність викликів у Provider'і:
//   1. toc_detect — фрагмент промпта містить "isRegistry"
//   2. toc_parse  — фрагмент промпта містить "startLeaf"
//   3. triage     — фрагмент промпта містить "Маршрути (route)"
// Кожен повертає визначений mock JSON.
function stubFetchForToc({ detectResp, parseResp, triageResp }) {
  const callLog = [];
  const fetchMock = vi.fn(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const text = body.messages?.[0]?.content?.[0]?.text || '';
    let respText;
    if (text.includes('isRegistry')) {
      callLog.push('toc_detect');
      respText = JSON.stringify(detectResp);
    } else if (text.includes('startLeaf')) {
      callLog.push('toc_parse');
      respText = JSON.stringify(parseResp);
    } else if (text.includes('Маршрути (route)')) {
      callLog.push('triage');
      respText = JSON.stringify(triageResp || { documents: [], unusedPages: [] });
    } else {
      callLog.push('unknown');
      respText = '{}';
    }
    return new Response(JSON.stringify({
      content: [{ type: 'text', text: respText }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, callLog };
}

async function makeFile(fileId, pages, name) {
  return {
    fileId,
    name: name || `${fileId}.pdf`,
    arrayBuffer: toArrayBuffer(await makePdfBytes(pages)),
    size: pages * 1500,
    originalMime: 'application/pdf',
  };
}

describe('ФД-T2 Provider-integration — ToC препроцесор маршрутизує наскрізь диригент', () => {
  let port, captured;
  beforeEach(() => {
    progressStore._resetForTests();
    port = createMemDrivePort();
    captured = {};
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  async function runWithFile(file) {
    const exec = buildExecutor(port, captured);
    return exec.run({
      caseId: 'case_toc', caseData: structuredClone(CASE),
      agentId: 'document_processor_agent', source: 'manual', addedBy: 'user', files: [file],
    });
  }

  it('30-doc реєстр → план з 30 документів, AI Triage НЕ викликається (КРИТИЧНИЙ тест якісної поведінки)', async () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      n: i + 1, name: `Документ ${i + 1}`, startLeaf: i + 1, endLeaf: i + 1,
    }));
    const { fetchMock, callLog } = stubFetchForToc({
      detectResp: { isRegistry: true, registryHeaderText: 'ОПИС ДОКУМЕНТІВ', registryPages: [1, 2, 3], firstDocumentPage: 4 },
      parseResp: { items },
    });
    const res = await runWithFile(await makeFile('toc_file', 33));
    expect(res.ok).toBe(true);
    // ToC спрацював — план з 30 документів
    expect(captured.plan).toBeDefined();
    expect(captured.plan.documents).toHaveLength(30);
    expect(captured.plan.source).toBe('toc_detector');
    expect(captured.plan.confirmed).toBe(true); // confirm autoConfirm:true
    // Жоден документ — НЕ AI Triage (deterministic)
    expect(callLog).toEqual(['toc_detect', 'toc_parse']);
    expect(callLog).not.toContain('triage');
    // Перевіряємо первинні / останні діапазони з offset 3
    expect(captured.plan.documents[0].fragments[0].startPage).toBe(4);
    expect(captured.plan.documents[29].fragments[0].startPage).toBe(33);
    // Всі 30 documents створені після persist (страж якісної поведінки —
    // обмеження №1, той самий тип тесту що не написали для Phase B P1).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('реєстру нема → fallback на AI Triage, документи створюються Triage-планом', async () => {
    const { fetchMock, callLog } = stubFetchForToc({
      detectResp: { isRegistry: false, registryHeaderText: null, registryPages: [], firstDocumentPage: null },
      parseResp: { items: [] },
      triageResp: { documents: [
        { documentId: 'd1', name: 'Позов', type: 'pleading', route: 'slice', fragments: [{ fileId: 'no_toc_file', startPage: 1, endPage: 15 }] },
        { documentId: 'd2', name: 'Ухвала', type: 'court_act', route: 'slice', fragments: [{ fileId: 'no_toc_file', startPage: 16, endPage: 30 }] },
      ], unusedPages: [] },
    });
    const res = await runWithFile(await makeFile('no_toc_file', 30));
    expect(res.ok).toBe(true);
    expect(callLog).toEqual(['toc_detect', 'triage']);
    expect(captured.plan.documents).toHaveLength(2);
    expect(captured.plan.source).toBeUndefined(); // не з toc_detector
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('малий том (<10 стор.) → ToC пропускається, прямий AI Triage', async () => {
    const { callLog } = stubFetchForToc({
      detectResp: { isRegistry: false, registryPages: [] }, // не буде викликаний
      parseResp: { items: [] },
      triageResp: { documents: [{ documentId: 'd1', name: 'Single', route: 'add_as_is', fragments: [{ fileId: 'small', startPage: 1, endPage: 5 }] }], unusedPages: [] },
    });
    const res = await runWithFile(await makeFile('small', 5));
    expect(res.ok).toBe(true);
    expect(callLog).toEqual(['triage']);
    expect(captured.plan.documents).toHaveLength(1);
  });

  it('ToC parse повернув невалідні items (overlap) → fallback на AI Triage', async () => {
    const { callLog } = stubFetchForToc({
      detectResp: { isRegistry: true, registryPages: [1, 2], firstDocumentPage: 3 },
      parseResp: { items: [
        { n: 1, name: 'A', startLeaf: 1, endLeaf: 5 },
        { n: 2, name: 'B', startLeaf: 4, endLeaf: 7 },  // overlap з попереднім
      ] },
      triageResp: { documents: [{ documentId: 'd1', name: 'Fallback', route: 'slice', fragments: [{ fileId: 'overlap_file', startPage: 1, endPage: 15 }] }], unusedPages: [] },
    });
    const res = await runWithFile(await makeFile('overlap_file', 15));
    expect(res.ok).toBe(true);
    expect(callLog).toEqual(['toc_detect', 'toc_parse', 'triage']);
    expect(captured.plan.documents).toHaveLength(1);
    expect(captured.plan.source).toBeUndefined();
  });

  it('decisions містять source toc_detector коли реєстр спрацював', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ n: i + 1, name: `D${i + 1}`, startLeaf: i + 1, endLeaf: i + 1 }));
    stubFetchForToc({
      detectResp: { isRegistry: true, registryPages: [1, 2], firstDocumentPage: 3 },
      parseResp: { items },
    });
    await runWithFile(await makeFile('decisions_file', 12));
    const triageDecisions = (captured.decisions || []).filter((d) => d.scope === 'triage');
    expect(triageDecisions.length).toBeGreaterThan(0);
    expect(triageDecisions[0].source).toBe('toc_detector');
    expect(triageDecisions[0].message).toMatch(/Реєстр матеріалів/);
  });
});

// ── ЛІНІЇ 1+2 захисту від зависання — Provider-INTEGRATION ──────────────────
// Корінь регресії Нестеренко 273pp: tocDetector був на дефолтних опціях
// callAPIWithRetry (5 спроб × 120с timeout) → worst-case 20хв «висне на 0%».
// Тест перевіряє наскрізну поведінку: ПЕРШИЙ Haiku-виклик (toc_detect)
// зависає (fetch ніколи не резолвиться, лише AbortError на signal) → ЛІНІЯ 1
// (TOC_API_OPTIONS у tocDetector) спрацьовує через AbortController у
// callAPIWithRetry → askHaiku повертає {ok:false} → tocDetect повертає
// {isToc:false} → fallback на AI Triage → план будується звичайною Гілкою B.
describe('ЛІНІЇ 1+2 — Provider-INT fallback при зависанні tocDetect', () => {
  let port, captured;
  beforeEach(() => {
    progressStore._resetForTests();
    port = createMemDrivePort();
    captured = {};
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // fetch що hang-ить, поки не abort'нуть через signal. Це коректна імітація
  // реальної повільної мережі / зависання API: callAPIWithRetry викликає
  // controller.abort() через TOC_API_OPTIONS.requestTimeoutMs → fetch reject
  // AbortError → транзитивна помилка → backoff → next attempt.
  function stubFetchHangingTocDetect({ triageResp }) {
    const callLog = [];
    const fetchMock = vi.fn((_url, opts) => {
      const body = JSON.parse(opts.body);
      const text = body.messages?.[0]?.content?.[0]?.text || '';
      // toc_detect: hang (відповідає abort) — нічого не резолвимо.
      if (text.includes('isRegistry')) {
        callLog.push('toc_detect_hang');
        return new Promise((_resolve, reject) => {
          if (opts.signal) {
            opts.signal.addEventListener('abort', () => {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      }
      // triage: миттєво.
      if (text.includes('Маршрути (route)')) {
        callLog.push('triage');
        return Promise.resolve(new Response(JSON.stringify({
          content: [{ type: 'text', text: JSON.stringify(triageResp) }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }), { status: 200 }));
      }
      callLog.push('unknown');
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock, callLog };
  }

  it('toc_detect зависає → ЛІНІЯ 1 spрацьовує → fallback на AI Triage; pipeline завершується за <3хв тестового часу', async () => {
    const triageResp = {
      documents: [
        { documentId: 'd1', name: 'Документ з Triage', type: 'pleading', route: 'slice', fragments: [{ fileId: 'hanging_file', startPage: 1, endPage: 15 }] },
        { documentId: 'd2', name: 'Інший', type: 'other', route: 'slice', fragments: [{ fileId: 'hanging_file', startPage: 16, endPage: 33 }] },
      ],
      unusedPages: [],
    };
    const { fetchMock, callLog } = stubFetchHangingTocDetect({ triageResp });

    const exec = buildExecutor(port, captured);
    const file = await makeFile('hanging_file', 33);
    const runPromise = exec.run({
      caseId: 'case_toc', caseData: structuredClone(CASE),
      agentId: 'document_processor_agent', source: 'manual', addedBy: 'user', files: [file],
    });

    // Прокручуємо час: ЛІНІЯ 1 worst-case ~95с (2×45с timeout + 1×backoff).
    // <3хв = 180с — з запасом покриває обидві спроби callAPIWithRetry + триаж.
    await vi.advanceTimersByTimeAsync(180000);
    const res = await runPromise;

    expect(res.ok).toBe(true);
    // План будується звичайною Гілкою B (через AI Triage).
    expect(captured.plan).toBeDefined();
    expect(captured.plan.source).toBeUndefined();
    expect(captured.plan.documents).toHaveLength(2);
    expect(captured.plan.documents[0].documentId).toBe('d1');
    // toc_detect мав хоча б 1 спробу через ЛІНІЮ 1 (maxRetries:2) — далі
    // фактична кількість залежить від internals callAPIWithRetry; жорстко не
    // фіксуємо щоб не плутати ЛІНІЮ 1 з налаштуваннями retry-loop.
    expect(callLog.filter((c) => c === 'toc_detect_hang').length).toBeGreaterThanOrEqual(1);
    expect(callLog).toContain('triage');
    expect(fetchMock).toHaveBeenCalled();
  }, /* test timeout ms */ 30000);
});
