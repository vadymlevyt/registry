// A7.1 — юніт-тести двофазних меж диригента (startFrom/stopAfter/ctx).
// Доводять: опції ріжуть ВИКОНАННЯ підвідрізком DEFAULT_STAGE_ORDER, без опцій —
// повний незмінний прогін (OCP, behavior-preserving), а композиція
// stopAfter→(ctx)startFrom дає той самий результат, що суцільний run().
import { describe, it, expect, vi } from 'vitest';
import {
  createDocumentPipeline,
  STAGE,
  DEFAULT_STAGE_ORDER,
} from '../../src/services/documentPipeline.js';
import { makePersistStub } from '../_persistStub.js';

function makeDeps(over = {}) {
  const { stageOverrides: overStages, ...rest } = over;
  return {
    uploadFile: vi.fn(async () => 'drive_X'),
    createDocument: vi.fn((m) => ({ id: 'doc_1', name: m.name || 'd', source: m.source || 'manual', ...m })),
    persistDocument: vi.fn(async () => ({ success: true })),
    eventBus: { publish: vi.fn() },
    topics: { DOCUMENT_INGESTED: 'document.ingested', DOCUMENT_BATCH_PROCESSED: 'document.batch_processed' },
    getActor: () => ({ userId: 'u1', tenantId: 't1' }),
    ...rest,
    stageOverrides: {
      [STAGE.DETECT_BOUNDARIES]: async () => ({ ok: true }),
      [STAGE.EXTRACT]: async () => ({ ok: true }),
      [STAGE.CONFIRM]: async () => ({ ok: true }),
      [STAGE.PERSIST]: makePersistStub(),
      ...(overStages || {}),
    },
  };
}

function baseInput() {
  return {
    caseId: 'case_1',
    caseData: { id: 'case_1' },
    files: [{ fileId: 'doc', raw: { name: 'a.pdf', size: 5, type: 'application/pdf' } }],
  };
}

describe('documentPipeline — двофазні межі (A7.1)', () => {
  it('без опцій — повний прогін незмінний (усі 6 стадій, документ персиститься)', async () => {
    const seen = [];
    const deps = makeDeps({ onStage: (n) => seen.push(n) });
    const res = await createDocumentPipeline(deps).run(baseInput());
    expect(seen).toEqual([...DEFAULT_STAGE_ORDER]);
    expect(res.ok).toBe(true);
    expect(res.documents).toHaveLength(1);
    expect(deps.persistDocument).toHaveBeenCalledTimes(1);
  });

  it('stopAfter: DETECT_BOUNDARIES — ріже після межі (INTAKE+DETECT), persist НЕ кличеться', async () => {
    const seen = [];
    const deps = makeDeps({ onStage: (n) => seen.push(n) });
    const res = await createDocumentPipeline(deps).run(baseInput(), { stopAfter: STAGE.DETECT_BOUNDARIES });
    expect(seen).toEqual([STAGE.INTAKE, STAGE.DETECT_BOUNDARIES]);
    expect(deps.persistDocument).not.toHaveBeenCalled();
    expect(res.documents).toHaveLength(0);       // PERSIST не дійшов
    expect(res.stoppedAt).toBeNull();            // штатний стоп вікна, не помилка
    expect(res.ctx).toBeTruthy();                // ctx повертається для Фази 2
  });

  it('startFrom: EXTRACT з готовим ctx — пропускає INTAKE/DETECT, доганяє до EMIT', async () => {
    const deps = makeDeps();
    const pipe = createDocumentPipeline(deps);
    // Фаза 1 → беремо ctx паузи.
    const phase1 = await pipe.run(baseInput(), { stopAfter: STAGE.DETECT_BOUNDARIES });
    const seen = [];
    const deps2 = makeDeps({ onStage: (n) => seen.push(n) });
    const phase2 = await createDocumentPipeline(deps2).run(null, { startFrom: STAGE.EXTRACT, ctx: phase1.ctx });
    expect(seen).toEqual([STAGE.EXTRACT, STAGE.CONFIRM, STAGE.PERSIST, STAGE.EMIT]);
    expect(seen).not.toContain(STAGE.INTAKE);
    expect(phase2.ok).toBe(true);
    expect(phase2.documents).toHaveLength(1);
    expect(deps2.persistDocument).toHaveBeenCalledTimes(1);
  });

  it('композиція stopAfter→(ctx)startFrom = суцільний run() (той самий результат)', async () => {
    const full = await createDocumentPipeline(makeDeps()).run(baseInput());

    const pipe = createDocumentPipeline(makeDeps());
    const p1 = await pipe.run(baseInput(), { stopAfter: STAGE.DETECT_BOUNDARIES });
    const p2 = await pipe.run(null, { startFrom: STAGE.EXTRACT, ctx: p1.ctx });

    expect(p2.ok).toBe(full.ok);
    expect(p2.documents).toHaveLength(full.documents.length);
    expect(p2.documents.map((d) => d.id)).toEqual(full.documents.map((d) => d.id));
  });

  it('reconstructionPlan, який встановила Фаза 1, доживає до Фази 2 через ctx', async () => {
    const PLAN = { documents: [{ documentId: 'd1', name: 'X', route: 'add_as_is', fragments: [], open: false }] };
    let seenPlanInConfirm = null;
    const deps = makeDeps({
      stageOverrides: {
        [STAGE.DETECT_BOUNDARIES]: async (ctx) => ({ ok: true, ctx: { ...ctx, reconstructionPlan: PLAN } }),
        [STAGE.CONFIRM]: async (ctx) => { seenPlanInConfirm = ctx.reconstructionPlan; return { ok: true }; },
      },
    });
    const pipe = createDocumentPipeline(deps);
    const p1 = await pipe.run(baseInput(), { stopAfter: STAGE.DETECT_BOUNDARIES });
    expect(p1.ctx.reconstructionPlan).toEqual(PLAN);
    await pipe.run(null, { startFrom: STAGE.EXTRACT, ctx: p1.ctx });
    expect(seenPlanInConfirm).toEqual(PLAN);     // план Фази 1 доїхав у CONFIRM Фази 2
  });

  it('невідома startFrom/stopAfter — кидає (видима помилка, не тихий no-op)', async () => {
    const pipe = createDocumentPipeline(makeDeps());
    await expect(pipe.run(baseInput(), { startFrom: 'nope' })).rejects.toThrow(/невідома стадія startFrom/);
    await expect(pipe.run(baseInput(), { stopAfter: 'nope' })).rejects.toThrow(/невідома стадія stopAfter/);
  });

  it('порожнє вікно (startFrom після stopAfter) — кидає', async () => {
    const pipe = createDocumentPipeline(makeDeps());
    await expect(
      pipe.run(baseInput(), { startFrom: STAGE.PERSIST, stopAfter: STAGE.DETECT_BOUNDARIES }),
    ).rejects.toThrow(/порожнє вікно/);
  });
});
