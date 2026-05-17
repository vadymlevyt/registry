// DP-2 — стадія detectBoundariesV2. Gated passthrough (no-regression),
// propose-only (не ріже), ecitsContext-підказка, non-fatal на помилці AI.
import { describe, it, expect, vi } from 'vitest';
import { createDetectBoundariesV2 } from '../../src/services/documentPipeline/stages/detectBoundariesV2.js';

function ctx(over = {}) {
  return {
    job: { caseId: 'case_1' },
    files: [{
      fileId: 'f0', name: 'merged.pdf', type: 'application/pdf',
      raw: { _bytes: new Uint8Array([1, 2, 3]) }, skipped: false, warnings: [],
    }],
    documents: [], decisions: [], errors: [], events: [],
    metadataSidecar: null,
    ...over,
  };
}

describe('detectBoundariesV2 — gated', () => {
  it('passthrough коли немає сигналу склейки (поведінка DP-1, нуль AI)', async () => {
    const detectBoundaries = vi.fn();
    const stage = createDetectBoundariesV2({ detectBoundaries });
    const r = await stage(ctx());
    expect(r).toEqual({ ok: true });
    expect(detectBoundaries).not.toHaveBeenCalled();
  });

  it('passthrough коли немає detectBoundaries-транспорту', async () => {
    const stage = createDetectBoundariesV2({});
    const r = await stage(ctx({ metadataSidecar: { expectsMultipleDocuments: true } }));
    expect(r).toEqual({ ok: true });
  });
});

describe('detectBoundariesV2 — активна гілка (propose, не split)', () => {
  it('склейка → boundaryProposals + decision, документ НЕ ріжеться', async () => {
    const detectBoundaries = vi.fn(async () => ({
      totalPages: 10,
      documents: [
        { name: 'Позов', startPage: 1, endPage: 4, type: 'pleading' },
        { name: 'Ухвала', startPage: 5, endPage: 10, type: 'court_act' },
      ],
    }));
    const stage = createDetectBoundariesV2({ detectBoundaries, getApiKey: () => 'k' });
    const r = await stage(ctx({ metadataSidecar: { expectsMultipleDocuments: true } }));

    expect(r.ok).toBe(true);
    expect(detectBoundaries).toHaveBeenCalledTimes(1);
    expect(r.ctx.files[0].boundaryProposals).toHaveLength(2);
    expect(r.ctx.files[0].boundaryProposals[0]).toMatchObject({ type: 'pleading', category: 'pleading' });
    expect(r.ctx.files[0].boundaryProposals[1].category).toBe('court_act');
    expect(r.decisions).toHaveLength(1);
    expect(r.decisions[0]).toMatchObject({ type: 'document_boundaries', totalPages: 10, fileId: 'f0' });
    // Жодного split: data/частин немає, лише пропозиція.
    expect(r.ctx.files[0].data).toBeUndefined();
  });

  it('один документ у файлі → нема decision (не склейка)', async () => {
    const detectBoundaries = vi.fn(async () => ({ totalPages: 3, documents: [{ name: 'Позов', startPage: 1, endPage: 3, type: 'pleading' }] }));
    const stage = createDetectBoundariesV2({ detectBoundaries, shouldDetect: () => true });
    const r = await stage(ctx());
    expect(r.ok).toBe(true);
    expect(r.decisions).toBeUndefined();
    expect(r.ctx.files[0].boundaryProposals).toHaveLength(1);
  });

  it('ecitsContext court_sync → userHint переданий у detectBoundaries', async () => {
    const detectBoundaries = vi.fn(async () => ({ totalPages: 2, documents: [] }));
    const stage = createDetectBoundariesV2({ detectBoundaries, shouldDetect: () => true });
    await stage(ctx({
      metadataSidecar: { source: 'court_sync', ecitsContext: { caseType: 'civil', court: 'Печерський' } },
    }));
    const arg = detectBoundaries.mock.calls[0][0];
    expect(arg.userHint).toContain('тип справи: civil');
    expect(arg.userHint).toContain('суд: Печерський');
  });

  it('помилка AI — НЕ фатальна (warning, ingestion не блокується)', async () => {
    const detectBoundaries = vi.fn(async () => { throw new Error('429'); });
    const stage = createDetectBoundariesV2({ detectBoundaries, shouldDetect: () => true });
    const r = await stage(ctx());
    expect(r.ok).toBe(true);
    expect(r.ctx.files[0].warnings[0]).toMatch(/boundary detect: 429/);
    expect(r.decisions).toBeUndefined();
  });
});
