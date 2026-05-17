// DP-2 — стадія classifyV2. Gated passthrough коли людина вже класифікувала
// (no-regression модалки), high→пише метадані, low→decision без перезапису,
// ecitsContext-підказка, мапа boundary-type→category.
import { describe, it, expect, vi } from 'vitest';
import { createClassifyV2, categoryFromBoundaryType } from '../../src/services/documentPipeline/stages/classifyV2.js';

function ctx(fileOver = {}, over = {}) {
  return {
    job: { caseId: 'case_1' },
    files: [{
      fileId: 'f0', name: 'doc.pdf', type: 'application/pdf', skipped: false,
      warnings: [], metadataTemplate: {}, extractedText: null, ...fileOver,
    }],
    documents: [], decisions: [], errors: [], events: [],
    metadataSidecar: null,
    ...over,
  };
}

describe('classifyV2 — мапа boundary-type → canonical category', () => {
  it('відповідає словнику documentBoundary/prompt', () => {
    expect(categoryFromBoundaryType('pleading')).toBe('pleading');
    expect(categoryFromBoundaryType('court_act')).toBe('court_act');
    expect(categoryFromBoundaryType('certificate')).toBe('identification');
    expect(categoryFromBoundaryType('court_cover')).toBe('other');
    expect(categoryFromBoundaryType('невідоме')).toBe('other');
  });
});

describe('classifyV2 — gated (no-regression модалки)', () => {
  it('passthrough коли адвокат уже задав category+author', async () => {
    const classify = vi.fn();
    const stage = createClassifyV2({ classify });
    const r = await stage(ctx({ metadataTemplate: { category: 'pleading', author: 'ours' } }));
    expect(r).toEqual({ ok: true });
    expect(classify).not.toHaveBeenCalled();
  });

  it('passthrough коли немає classify-транспорту', async () => {
    const stage = createClassifyV2({});
    const r = await stage(ctx({ extractedText: 'текст' }));
    expect(r).toEqual({ ok: true });
  });
});

describe('classifyV2 — активна гілка', () => {
  it('висока впевненість → category/author пишуться у metadataTemplate', async () => {
    const classify = vi.fn(async () => ({ category: 'court_act', author: 'court', confidence: 'high' }));
    const stage = createClassifyV2({ classify });
    const r = await stage(ctx({ extractedText: 'УХВАЛА суду' }));
    expect(r.ok).toBe(true);
    expect(r.ctx.files[0].metadataTemplate).toMatchObject({ category: 'court_act', author: 'court' });
    expect(r.ctx.files[0].classification.applied).toBe(true);
    expect(r.decisions).toBeUndefined();
  });

  it('низька впевненість → decision, metadataTemplate НЕ перезаписано', async () => {
    const classify = vi.fn(async () => ({ category: 'evidence', author: 'opponent', confidence: 'low' }));
    const stage = createClassifyV2({ classify });
    const r = await stage(ctx({ extractedText: 'щось' }));
    expect(r.ok).toBe(true);
    expect(r.ctx.files[0].metadataTemplate.category).toBeUndefined();
    expect(r.ctx.files[0].classification.applied).toBe(false);
    expect(r.decisions[0]).toMatchObject({ type: 'classification', fileId: 'f0' });
  });

  it('тип з boundary-словника мапиться у category коли немає прямого category', async () => {
    const classify = vi.fn(async () => ({ type: 'pleading', author: 'ours', confidence: 0.95 }));
    const stage = createClassifyV2({ classify });
    const r = await stage(ctx({ extractedText: 'ПОЗОВНА ЗАЯВА' }));
    expect(r.ctx.files[0].metadataTemplate.category).toBe('pleading');
  });

  it('немає тексту і немає ecitsContext → classification_unavailable, нічого не вгадуємо', async () => {
    const classify = vi.fn();
    const stage = createClassifyV2({ classify, shouldClassify: () => true });
    const r = await stage(ctx());
    expect(r.ok).toBe(true);
    expect(classify).not.toHaveBeenCalled();
    expect(r.decisions[0].type).toBe('classification_unavailable');
    expect(r.ctx.files[0].metadataTemplate.category).toBeUndefined();
  });

  it('court_sync → ecitsContext переданий класифікатору як підказка', async () => {
    const classify = vi.fn(async () => ({ category: 'court_act', confidence: 'high' }));
    const stage = createClassifyV2({ classify });
    await stage(ctx({}, { metadataSidecar: { source: 'court_sync', ecitsContext: { summary: 'ухвала про відкриття', notificationType: 'court_act' } } }));
    expect(classify).toHaveBeenCalledTimes(1);
    const arg = classify.mock.calls[0][0];
    expect(arg.ecitsContext).toMatchObject({ notificationType: 'court_act' });
  });
});
