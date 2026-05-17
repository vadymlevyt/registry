// DP-3 — streamingExecutor: free-space gate, RAM-bounded chunk loop,
// resume, cleanup, cancellation. createPipeline застаблено (юніт executor'а).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStreamingExecutor } from '../../src/services/documentPipeline/streamingExecutor.js';
import { createWorkerClient } from '../../src/services/documentPipeline/workerClient.js';
import * as progressStore from '../../src/services/documentPipeline/jobProgressStore.js';
import { createMemDrivePort } from '../_memDrivePort.js';
import { makePdfBytes, toArrayBuffer } from '../_pdfFixture.js';

const wc = createWorkerClient({ forceInProcess: true });

function makeExec(over = {}) {
  const port = over.drivePort || createMemDrivePort();
  const okPipeline = { run: vi.fn(async (input) => ({ ok: true, documents: input.files.map((f, i) => ({ id: `doc_${i}` })), decisions: [], events: [], stoppedAt: null })) };
  const exec = createStreamingExecutor({
    drivePort: port,
    workerClient: wc,
    createPipeline: over.createPipeline || (() => okPipeline),
    pipelineDeps: {},
    processChunk: over.processChunk || (async ({ startPage }) => ({ text: `T${startPage}` })),
    perf: {},
    ...over.execOver,
  });
  return { exec, port, okPipeline };
}

async function fileInput(pages, fileId = 'f0') {
  return { fileId, name: `${fileId}.pdf`, arrayBuffer: toArrayBuffer(await makePdfBytes(pages)), size: pages * 1000, originalMime: 'application/pdf' };
}

describe('streamingExecutor', () => {
  beforeEach(() => progressStore._resetForTests());

  it('free-space < 1GB → блок з повідомленням, resumable', async () => {
    const port = createMemDrivePort();
    port.quota = async () => ({ usage: 99, limit: 100, free: 100 * 1024 * 1024, limitless: false });
    const { exec } = makeExec({ drivePort: port });
    const res = await exec.run({ caseId: 'c1', caseData: {}, files: [await fileInput(3)] });
    expect(res.ok).toBe(false);
    expect(res.blocked).toBe(true);
    expect(res.error.code).toBe('DRIVE_FULL');
    expect(res.resumable).toBe(true);
  });

  it('успіх: chunk-loop OCR, pipeline, _temp очищено (cleanup)', async () => {
    const { exec, port } = makeExec();
    const res = await exec.run({ caseId: 'c1', caseData: { id: 'c1' }, files: [await fileInput(12)] });
    expect(res.ok).toBe(true);
    expect(res.cleanedUp).toBe(true);
    expect(res.documents.length).toBeGreaterThan(0);
    // _temp очищено: ні job_state, ні chunk-байтів, ні temp-оригіналу
    expect(port._countFilesNamed('job_state.json')).toBe(0);
    expect(port._allNames().some((n) => /^chunk_/.test(n))).toBe(false);
    expect(port._allNames().some((n) => /^orig_/.test(n))).toBe(false);
  });

  it('універсальність: один файл і пакет — той самий шлях', async () => {
    const { exec } = makeExec();
    const r1 = await exec.run({ caseId: 'c1', caseData: { id: 'c1' }, files: [await fileInput(4, 'a')] });
    const r2 = await exec.run({ caseId: 'c1', caseData: { id: 'c1' }, files: [await fileInput(4, 'a'), await fileInput(6, 'b')] });
    expect(r1.ok && r2.ok).toBe(true);
  });

  it('processChunk викликається по chunk-ах; ETA/прогрес у стор', async () => {
    const processChunk = vi.fn(async ({ startPage }) => ({ text: `p${startPage}` }));
    const { exec } = makeExec({ processChunk });
    const seen = [];
    const un = progressStore.subscribe((s) => s[0] && seen.push(s[0].done));
    // 60 сторінок > DEFAULT_CHUNK_PAGES(25) → кілька chunk (RAM-bounded).
    await exec.run({ caseId: 'c1', caseData: { id: 'c1' }, files: [await fileInput(60)] });
    un();
    expect(processChunk.mock.calls.length).toBeGreaterThan(1); // кілька chunk
  });

  it('resume: повторні chunk не передруковуються (skip done)', async () => {
    const port = createMemDrivePort();
    const calls = [];
    const processChunk = vi.fn(async ({ startPage }) => { calls.push(startPage); return { text: 't' }; });
    // 1-й прогон — pipeline «падає» fatal → стан resumable, _temp лишається
    const failing = { run: async () => ({ ok: false, stoppedAt: 'persist', errors: [{ code: 'X' }], decisions: [] }) };
    const e1 = createStreamingExecutor({ drivePort: port, workerClient: wc, createPipeline: () => failing, processChunk, perf: {} });
    const inp = { caseId: 'c1', caseData: { id: 'c1' }, jobId: 'jR', files: [await fileInput(15)] };
    const r1 = await e1.run(structuredClone(inputClone(inp)));
    expect(r1.ok).toBe(false);
    expect(r1.resumable).toBe(true);
    const firstCount = calls.length;
    expect(firstCount).toBeGreaterThan(0);

    // 2-й прогон resume — chunks вже done у jobState → НЕ передруковуються
    const okp = { run: async (i) => ({ ok: true, documents: [{ id: 'd1' }], decisions: [], events: [], stoppedAt: null }) };
    const e2 = createStreamingExecutor({ drivePort: port, workerClient: wc, createPipeline: () => okp, processChunk, perf: {} });
    const r2 = await e2.resume(inputClone(inp));
    expect(r2.ok).toBe(true);
    expect(calls.length).toBe(firstCount); // нуль повторних processChunk
  });

  it('checkResumable / discardAll прибирає _temp', async () => {
    const { exec, port } = makeExec({
      createPipeline: () => ({ run: async () => ({ ok: false, stoppedAt: 'persist', errors: [], decisions: [] }) }),
    });
    const r = await exec.run({ caseId: 'c1', caseData: { id: 'c1' }, jobId: 'jX', files: [await fileInput(8)] });
    expect(r.resumable).toBe(true);
    expect(await exec.checkResumable('c1', 'jX')).toBe(true);
    await exec.discardAll('c1', 'jX');
    expect(await exec.checkResumable('c1', 'jX')).toBe(false);
  });

  it('скасування: prompt «зберегти N / видалити все», keepPartial лишає документи', async () => {
    let cancelled = false;
    const { exec } = makeExec({ execOver: { isCancelled: () => cancelled } });
    cancelled = true;
    const res = await exec.run({ caseId: 'c1', caseData: { id: 'c1' }, jobId: 'jC', files: [await fileInput(6)] });
    expect(res.cancelled).toBe(true);
    expect(res.prompt).toMatch(/Зберегти.*видалити все/);
    const kp = await exec.keepPartial('c1', 'jC');
    expect(kp.kept).toBe(true);
  });
});

// structuredClone не клонує arrayBuffer-aliased поля коректно для повтору —
// віддаємо свіжий вхід (executor читає arrayBuffer один раз).
function inputClone(inp) {
  return { ...inp, files: inp.files.map((f) => ({ ...f, arrayBuffer: f.arrayBuffer.slice ? f.arrayBuffer.slice(0) : f.arrayBuffer })) };
}
