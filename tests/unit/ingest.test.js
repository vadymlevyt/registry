// TASK 4 · етап A — ingest.js: єдина труба додавання. Фасад поверх Context-run
// (обгортки над executor.run). Перевіряємо делегування, дефолти ocrMode/compress,
// прокидання pipeline-налаштувань і вхідних полів, NO_FILES на порожньому вході.
import { describe, it, expect, vi } from 'vitest';
import { createIngest, DEFAULT_OCR_MODE } from '../../src/services/documentPipeline/ingest.js';

describe('ingest.createIngest', () => {
  it('кидає без runPipeline', () => {
    expect(() => createIngest({})).toThrow(/runPipeline/);
  });

  it('NO_FILES на порожньому вході — не кличе runPipeline, не кидає', async () => {
    const runPipeline = vi.fn();
    const { ingestFiles } = createIngest({ runPipeline });
    const r1 = await ingestFiles({ caseId: 'c1', files: [] });
    const r2 = await ingestFiles({ caseId: 'c1' });
    expect(r1.ok).toBe(false);
    expect(r1.error.code).toBe('NO_FILES');
    expect(r2.error.code).toBe('NO_FILES');
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it('делегує вхід без змін і застосовує дефолти ocrMode=full/compress=false', async () => {
    const runPipeline = vi.fn(async () => ({ ok: true, documents: [{ id: 'd0' }] }));
    const { ingestFiles } = createIngest({ runPipeline });
    const input = {
      caseId: 'c1', caseData: { id: 'c1' }, agentId: 'document_processor_agent',
      source: 'manual', addedBy: 'user', files: [{ fileId: 'f0', name: 'a.pdf' }],
    };
    const res = await ingestFiles(input);
    expect(res.ok).toBe(true);
    expect(runPipeline).toHaveBeenCalledTimes(1);
    const [passedInput, passedOptions] = runPipeline.mock.calls[0];
    expect(passedInput).toBe(input);                      // вхід прокинуто як є
    expect(passedOptions.ocrMode).toBe(DEFAULT_OCR_MODE);
    expect(passedOptions.ocrMode).toBe('full');
    expect(passedOptions.compress).toBe(false);
  });

  it('прокидає pipeline-налаштування без інтерпретації + явні ocrMode/compress', async () => {
    const runPipeline = vi.fn(async () => ({ ok: true }));
    const { ingestFiles } = createIngest({ runPipeline });
    await ingestFiles(
      { caseId: 'c1', files: [{ fileId: 'f0' }] },
      { skipPdfSlicing: true, autoConfirm: true, collectDataset: false, ocrMode: 'none', compress: true },
    );
    const [, opts] = runPipeline.mock.calls[0];
    expect(opts.skipPdfSlicing).toBe(true);
    expect(opts.autoConfirm).toBe(true);
    expect(opts.collectDataset).toBe(false);
    expect(opts.ocrMode).toBe('none');
    expect(opts.compress).toBe(true);
  });

  it('повертає результат runPipeline без обгортання', async () => {
    const result = { ok: false, jobId: 'j1', resumable: true, errors: [{ code: 'X' }] };
    const { ingestFiles } = createIngest({ runPipeline: async () => result });
    const res = await ingestFiles({ files: [{ fileId: 'f0' }] });
    expect(res).toBe(result);
  });

  // ── TASK 4 · етап C — маршрутизація mode (slice ↔ add_as_is) ──────────────
  it('mode add_as_is → runAddAsIs, НЕ runPipeline; mode НЕ прокидається далі', async () => {
    const runPipeline = vi.fn(async () => ({ ok: true }));
    const runAddAsIs = vi.fn(async () => ({ ok: true, documents: [{ id: 'd1' }] }));
    const { ingestFiles } = createIngest({ runPipeline, runAddAsIs });
    const input = { caseId: 'c1', files: [{ fileId: 'f0', raw: {} }] };
    const res = await ingestFiles(input, { mode: 'add_as_is', deferOcr: true, ocrMode: 'full' });
    expect(res.documents).toEqual([{ id: 'd1' }]);
    expect(runAddAsIs).toHaveBeenCalledTimes(1);
    expect(runPipeline).not.toHaveBeenCalled();
    const [passedInput, opts] = runAddAsIs.mock.calls[0];
    expect(passedInput).toBe(input);
    expect(opts).not.toHaveProperty('mode');     // mode маршрутизує, не тече далі
    expect(opts.deferOcr).toBe(true);            // pipelineSettings прокинуто
    expect(opts.ocrMode).toBe('full');
  });

  it('mode slice (дефолт) → runPipeline; runAddAsIs не чіпається', async () => {
    const runPipeline = vi.fn(async () => ({ ok: true }));
    const runAddAsIs = vi.fn(async () => ({ ok: true }));
    const { ingestFiles } = createIngest({ runPipeline, runAddAsIs });
    await ingestFiles({ files: [{ fileId: 'f0' }] }, { skipPdfSlicing: true });
    expect(runPipeline).toHaveBeenCalledTimes(1);
    expect(runAddAsIs).not.toHaveBeenCalled();
    const [, opts] = runPipeline.mock.calls[0];
    expect(opts).not.toHaveProperty('mode');
  });

  it('mode add_as_is без runAddAsIs — кидає (а не тихо в slice)', async () => {
    const runPipeline = vi.fn(async () => ({ ok: true }));
    const { ingestFiles } = createIngest({ runPipeline });
    await expect(
      ingestFiles({ files: [{ fileId: 'f0' }] }, { mode: 'add_as_is' }),
    ).rejects.toThrow(/runAddAsIs/);
    expect(runPipeline).not.toHaveBeenCalled();
  });
});
