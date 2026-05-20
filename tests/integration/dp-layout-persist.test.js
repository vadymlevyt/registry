// B1 (20.05.2026) — Provider-integration: layout-strip персистенції.
// Корінь bug: DocumentPipelineContext робив JSON.stringify(layoutJson) ДО
// ocrService.writeLayoutArtifact → strip image/tokens не запрацював,
// 14МБ файли на Drive замість ~400КБ. Цей тест ловить регресію через
// зовнішній факт (вміст blob'а на Drive), не через виклик функції в ізоляції.
//
// Обмеження №1 батьківського TASK (від DP-4): кожен фікс має інтеграційний
// тест ЧЕРЕЗ справжній шар (drivePort uploadBytes/uploadText), не stub
// поверх writeLayoutArtifact. Якщо хтось через 3 міс поверне stringify
// перед writeLayoutArtifact — uploadText на Drive міститиме "image" і
// "tokens" як ключі сторінки, тест червоний.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Мокаємо OCR провайдери (вони тягнуть pdfjs/DOMMatrix що не існує у Node).
// Це СТАНДАРТНИЙ патерн з tests/unit/ocrService.test.js — не мокаємо
// сам ocrService (його тестуємо), а лише тяжкі сторонні залежності.
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
import * as ocrService from '../../src/services/ocrService.js';
import { createHarness } from './_actionsTestSetup.js';
import { createMemDrivePort } from '../_memDrivePort.js';
import { makePdfBytes, toArrayBuffer } from '../_pdfFixture.js';

const wc = createWorkerClient({ forceInProcess: true });

const CASE = {
  id: 'case_layout', name: 'Layout strip', tenantId: 'tenant_1', ownerId: 'vadym',
  documents: [], proceedings: [{ id: 'proc_main', title: 'Основне' }],
};

const realTriage = ({ artifacts, userHint, caseId }) =>
  analyzeTriageViaToolUse({ artifacts, userHint, caseId, apiKey: 'test-key' });

// Фейкове джерело "важкого" pageStructure: image (base64 ~5КБ) + tokens (500
// per-letter координат) — як реальний Document AI повертає на 1 стор. скана.
// Без strip розмір однієї сторінки ~ image.length + tokens-JSON ~ 7МБ у проді.
function makeHeavyPage(pageNum) {
  const fakeImage = 'data:image/png;base64,' + 'A'.repeat(5000);
  const fakeTokens = Array.from({ length: 500 }, (_, i) => ({
    detectedBreak: null,
    layout: { textAnchor: { textSegments: [{ startIndex: i, endIndex: i + 1 }] } },
  }));
  return {
    pageNumber: pageNum,
    image: fakeImage,
    tokens: fakeTokens,
    paragraphs: [{ layout: { textAnchor: { textSegments: [{ startIndex: 0, endIndex: 5 }] } } }],
    blocks: [{ confidence: 0.99 }],
    dimension: { width: 1240, height: 1754 },
    detectedLanguages: [{ languageCode: 'uk' }],
    _text: `Стор ${pageNum}`,
  };
}

// processChunk-стуб — повертає важкий layout (з image/tokens) як справжній
// Document AI. Дає реальну "сировину" пайплайну для перевірки що strip
// відбувається саме в шарі persist→writeLayout02, не раніше.
async function processChunkHeavy({ startPage, endPage }) {
  const pages = [];
  for (let p = startPage; p <= endPage; p++) pages.push(makeHeavyPage(p));
  return { text: pages.map((p) => p._text).join('\n'), layout: pages };
}

function buildExecutor(port, h) {
  return createStreamingExecutor({
    drivePort: port, workerClient: wc, createPipeline: createDocumentPipeline,
    processChunk: processChunkHeavy, perf: {},
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
            folder: '01_ОРИГІНАЛИ', addedBy: job.addedBy || 'system',
            source: job.source || 'manual', driveId,
            driveUrl: driveId ? `https://drive.google.com/file/d/${driveId}/view` : null,
            size: item.size || 0, ...(item.metadataTemplate || {}),
          }),
          persistDocument: ({ caseId, document }) =>
            h.executeAction('document_processor_agent', 'add_documents', { caseId, documents: [document] }),
          // САМЕ ТА САМА writeLayout02 що в DocumentPipelineContext.jsx (B1):
          // приймаємо OBJECT і передаємо OBJECT у writeLayoutArtifact (не
          // JSON.stringify) — strip відповідальний шар ocrService.
          writeLayout02: async ({ caseData, driveId, name, layoutJson }) => {
            try {
              const layoutObj = typeof layoutJson === 'string' ? JSON.parse(layoutJson) : layoutJson;
              await ocrService.writeLayoutArtifact(
                { id: driveId, name, subFolders: caseData?.storage?.subFolders },
                layoutObj,
              );
            } catch { /* layout кеш не критичний — поведінка контексту */ }
          },
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

// driveRequest mock — ocrService.writeLayoutArtifact йде через driveRequest
// (не через drivePort). Імітуємо Drive multipart upload, accumulating
// записаний контент у `driveUploads` для асертів. Це той самий патерн що в
// tests/unit/ocrService.test.js (без зв'язки port — bo writeLayoutArtifact
// має власний шлях через driveAuth.driveRequest).
const driveUploads = [];
vi.mock('../../src/services/driveAuth.js', () => ({
  driveRequest: vi.fn(async (url, opts = {}) => {
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?q=')) {
      return new Response(JSON.stringify({ files: [] }), { status: 200 });
    }
    if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
      const form = opts.body;
      const metaBlob = form.get('metadata');
      const fileBlob = form.get('file');
      const meta = JSON.parse(await metaBlob.text());
      const content = await fileBlob.text();
      driveUploads.push({ folderId: meta.parents?.[0] || null, name: meta.name, content, mimeType: fileBlob.type });
      return new Response(JSON.stringify({ id: `drv_${driveUploads.length}`, name: meta.name }), { status: 200 });
    }
    return new Response('', { status: 404 });
  }),
}));

const file = async (id, pages, mime = 'application/pdf', name) =>
  ({ fileId: id, name: name || `${id}.pdf`, arrayBuffer: toArrayBuffer(await makePdfBytes(pages)), size: pages * 1500, originalMime: mime });

describe('B1 Provider-integration — layout strip через справжній writeLayoutArtifact', () => {
  let h, port;
  beforeEach(() => {
    progressStore._resetForTests();
    h = createHarness({ initialCases: [structuredClone(CASE)] });
    port = createMemDrivePort();
    driveUploads.length = 0;
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('5-стор. PDF з важким pageStructure → .layout.json на Drive БЕЗ image/tokens', async () => {
    // План Triage: 1 документ slice 5 стор.
    stubTriageFetch({
      documents: [{ documentId: 'd1', name: 'Скан', type: 'court_act', route: 'slice', fragments: [{ fileId: 'big', startPage: 1, endPage: 5 }] }],
      unusedPages: [],
    });
    // 02_ОБРОБЛЕНІ заздалегідь — щоб writeLayoutArtifact мала subFolderId.
    const obrobFolder = await port.getOrCreateFolder('02_ОБРОБЛЕНІ', null);
    const caseData = structuredClone(CASE);
    caseData.storage = { subFolders: { '02_ОБРОБЛЕНІ': obrobFolder.id } };

    const exec = buildExecutor(port, h);
    const res = await exec.run({
      caseId: 'case_layout', caseData, agentId: 'document_processor_agent',
      source: 'manual', addedBy: 'user',
      files: [await file('big', 5)],
    });

    expect(res.ok).toBe(true);
    expect(h.getCases().find((c) => c.id === 'case_layout').documents).toHaveLength(1);

    // Знайти запис .layout.json на mock-Drive.
    const layoutUpload = driveUploads.find((u) => /\.layout\.json$/.test(u.name));
    expect(layoutUpload, 'writeLayoutArtifact мала викликати uploadText для .layout.json').toBeDefined();

    // КЛЮЧОВА АСЕРЦІЯ — strip фактично відбувся. Якщо хтось через 3 міс
    // поверне JSON.stringify ДО writeLayoutArtifact — обидві перевірки
    // червоні: фактичний контент на Drive містить "image" і "tokens".
    expect(layoutUpload.content).not.toContain('"image"');
    expect(layoutUpload.content).not.toContain('"tokens"');

    // Розмір файла пропорційний корисним полям, не fakeImage (~5КБ).
    // Сирий JSON.stringify(layoutObj) з image+tokens був би сильно більший.
    const parsed = JSON.parse(layoutUpload.content);
    expect(Array.isArray(parsed.pages)).toBe(true);
    expect(parsed.pages.length).toBeGreaterThan(0);
    for (const page of parsed.pages) {
      expect(page.image).toBeUndefined();
      expect(page.tokens).toBeUndefined();
      expect(page._text).toBeDefined();                              // легке поле збережено
    }
  });

  it('persist пише .layout.json коли layoutJson непорожній (контракт writeLayout02)', async () => {
    stubTriageFetch({
      documents: [{ documentId: 'd1', name: 'Док', type: 'court_act', route: 'slice', fragments: [{ fileId: 'f', startPage: 1, endPage: 2 }] }],
      unusedPages: [],
    });
    const obrobFolder = await port.getOrCreateFolder('02_ОБРОБЛЕНІ', null);
    const caseData = structuredClone(CASE);
    caseData.storage = { subFolders: { '02_ОБРОБЛЕНІ': obrobFolder.id } };

    const exec = buildExecutor(port, h);
    await exec.run({
      caseId: 'case_layout', caseData, agentId: 'document_processor_agent',
      source: 'manual', addedBy: 'user', files: [await file('f', 2)],
    });

    expect(driveUploads.some((u) => /\.layout\.json$/.test(u.name))).toBe(true);
  });
});
