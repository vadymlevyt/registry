// G0 Provider-INTEGRATION (обмеження §2.1 — головна тест-вимога TASK).
// bug 7 ламався б тихо без цього: stageLabels зелені ізольовано, а executor
// реально НЕ інжектує onStage у заморожений диригент → UI знову "processing",
// жоден юніт не ловить. Тут — СПРАВЖНІЙ createStreamingExecutor + СПРАВЖНІЙ
// createDocumentPipeline (заморожений), deps інжектуються як у Provider;
// перевіряємо що jobProgressStore отримує людський підпис стадій НАСКРІЗЬ
// (OCR-фаза → стадії диригента) і що per-stage таймінги фіксуються (bug 3).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDocumentPipeline } from '../../src/services/documentPipeline.js';
import { createDocument } from '../../src/services/documentFactory.js';
import { createStreamingExecutor } from '../../src/services/documentPipeline/streamingExecutor.js';
import { createWorkerClient } from '../../src/services/documentPipeline/workerClient.js';
import * as progressStore from '../../src/services/documentPipeline/jobProgressStore.js';
import { createMemDrivePort } from '../_memDrivePort.js';
import { makePdfBytes, toArrayBuffer } from '../_pdfFixture.js';

const wc = createWorkerClient({ forceInProcess: true });
const CASE = {
  id: 'case_sp', name: 'StageProgress', tenantId: 'tenant_1', ownerId: 'vadym',
  documents: [], storage: { subFolders: {} },
};

function buildExecutor(port) {
  return createStreamingExecutor({
    drivePort: port,
    workerClient: wc,
    createPipeline: createDocumentPipeline,            // СПРАВЖНІЙ заморожений диригент
    processChunk: async ({ startPage }) => ({ text: `текст стор ${startPage}` }),
    perf: {},
    buildPipelineDeps: () => ({
      // Provider-shape: persist створює документ (диригент вважає прогін
      // успішним лише за ctx.documents.length>0).
      // A1-D: диригент нарізки не має дефолтів для стадій нарізки — Provider
      // інжектить triageStage/extractV3/confirmBoundaries/splitDocumentsV3. Тут
      // тонкі стаби тих самих слотів, щоб onStage/onStageEnd зміряли кожну.
      stageOverrides: {
        detectBoundaries: async () => ({ ok: true }),
        extract: async () => ({ ok: true }),
        confirm: async () => ({ ok: true }),
        persist: async (ctx) => ({
          ok: true,
          ctx: { ...ctx, documents: [...ctx.documents, createDocument({ name: 'd', driveId: 'x', size: 1, addedBy: 'system', namingStatus: 'auto' })] },
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

describe('G0 Provider-integration — людський підпис стадій наскрізь', () => {
  let port, snaps;
  beforeEach(() => {
    progressStore._resetForTests();
    port = createMemDrivePort();
    snaps = [];
    progressStore.subscribe((s) => { if (s[0]) snaps.push({ ...s[0] }); });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  async function run() {
    const exec = buildExecutor(port);
    return exec.run({
      caseId: 'case_sp', caseData: structuredClone(CASE),
      agentId: 'document_processor_agent', source: 'manual', addedBy: 'user',
      files: [{ fileId: 'big', name: 'big.pdf', arrayBuffer: toArrayBuffer(await makePdfBytes(3)), size: 4500, originalMime: 'application/pdf' }],
    });
  }

  it('OCR-фаза показує людський підпис, не буквальне "processing"', async () => {
    const res = await run();
    expect(res.ok).toBe(true);
    const labels = snaps.map((s) => s.stageLabel).filter(Boolean);
    expect(labels).toContain('Розпізнавання тексту');
    // Ніде не лишилось технічного 'processing' як stage (корінь bug 7).
    expect(snaps.some((s) => s.stage === 'processing')).toBe(false);
    const ocr = snaps.find((s) => s.stage === 'ocr');
    expect(ocr.detail).toMatch(/блок \d+ з \d+/);
  });

  it('після OCR диригент репортить стадії людською мовою', async () => {
    await run();
    const labels = new Set(snaps.map((s) => s.stageLabel).filter(Boolean));
    // Найважливіші для адвоката довгі фази (тиха 30-хв зона у bug 3/6).
    expect(labels.has('Аналіз структури документів')).toBe(true);
    expect(labels.has('Розкладання документів')).toBe(true);
    expect(labels.has('Завершення')).toBe(true);
  });

  it('per-stage таймінги накопичуються у снапшот (вимір bug 3)', async () => {
    await run();
    const withTimings = snaps.filter((s) => s.timings && Object.keys(s.timings).length > 0);
    expect(withTimings.length).toBeGreaterThan(0);
    const last = withTimings[withTimings.length - 1].timings;
    // Принаймні стадії диригента зміряні (числові ms).
    expect(typeof last.detectBoundaries).toBe('number');
    expect(typeof last.persist).toBe('number');
    expect(last.persist).toBeGreaterThanOrEqual(0);
  });

  it('порядок: OCR-підпис передує підпису persist (наскрізна історія)', async () => {
    await run();
    const seq = snaps.map((s) => s.stageLabel).filter(Boolean);
    const firstOcr = seq.indexOf('Розпізнавання тексту');
    const firstPersist = seq.indexOf('Розкладання документів');
    expect(firstOcr).toBeGreaterThanOrEqual(0);
    expect(firstPersist).toBeGreaterThan(firstOcr);
  });
});
