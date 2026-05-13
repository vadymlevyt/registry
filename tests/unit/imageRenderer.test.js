// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock heavy Canvas-based helpers: ці тести перевіряють ЛОГІКУ
// computeRenderedBlob (який шлях, які аргументи), а не сам Canvas drawing
// (це покривається тестами orientationCorrector і cropHelper).

vi.mock('../../src/services/sortation/orientationCorrector.js', () => ({
  rotateImageBlob: vi.fn(async (blob, deg) => ({
    __mock: 'rotated', source: blob, degrees: deg,
  })),
}));
vi.mock('../../src/services/sortation/cropHelper.js', () => ({
  cropImageBlob: vi.fn(async (blob, rect) => ({
    __mock: 'cropped', source: blob, rect,
  })),
}));

import { computeRenderedBlob, userRotationCssDelta } from '../../src/services/sortation/imageRenderer.js';
import { rotateImageBlob } from '../../src/services/sortation/orientationCorrector.js';
import { cropImageBlob } from '../../src/services/sortation/cropHelper.js';

const makeRawFile = (name = 'raw.jpg') => new File(['raw'], name, { type: 'image/jpeg' });
const makeProcessedBlob = () => new Blob(['proc'], { type: 'image/jpeg' });

function makeCtx(overrides = {}) {
  return {
    realFiles: [makeRawFile('a.jpg')],
    detectedOrientations: [0],
    userRotation: new Map(),
    processedBlobs: new Map(),
    cropOverrides: new Map(),
    cropProposals: new Map(),
    cropDisabled: new Set(),
    cropAppliedSet: new Set(),
    idx: 0,
    ...overrides,
  };
}

beforeEach(() => {
  rotateImageBlob.mockClear();
  cropImageBlob.mockClear();
});

describe('computeRenderedBlob — базові гілки', () => {
  it('повертає null коли idx виходить за межі realFiles', async () => {
    const blob = await computeRenderedBlob({ ...makeCtx(), idx: 5 });
    expect(blob).toBeNull();
  });

  it('повертає null коли realFiles не масив', async () => {
    const blob = await computeRenderedBlob({ ...makeCtx({ realFiles: null }) });
    expect(blob).toBeNull();
  });

  it('autoDeg=0, нема crop, нема user — повертає raw file as-is (no canvas calls)', async () => {
    const ctx = makeCtx();
    const blob = await computeRenderedBlob(ctx);
    expect(blob).toBe(ctx.realFiles[0]);
    expect(rotateImageBlob).not.toHaveBeenCalled();
    expect(cropImageBlob).not.toHaveBeenCalled();
  });

  it('autoDeg=180 — обертає на 180° без crop', async () => {
    const ctx = makeCtx({ detectedOrientations: [180] });
    const blob = await computeRenderedBlob(ctx);
    expect(rotateImageBlob).toHaveBeenCalledWith(ctx.realFiles[0], 180);
    expect(cropImageBlob).not.toHaveBeenCalled();
    expect(blob).toMatchObject({ __mock: 'rotated', degrees: 180 });
  });

  it('applyUserRotation=true додає userRotation до autoRotation', async () => {
    const ctx = makeCtx({
      detectedOrientations: [180],
      userRotation: new Map([[0, 90]]),
    });
    await computeRenderedBlob(ctx, { applyUserRotation: true });
    expect(rotateImageBlob).toHaveBeenCalledWith(ctx.realFiles[0], 270);
  });

  it('applyUserRotation=false запікає тільки autoRotation (user через CSS)', async () => {
    const ctx = makeCtx({
      detectedOrientations: [180],
      userRotation: new Map([[0, 90]]),
    });
    await computeRenderedBlob(ctx, { applyUserRotation: false });
    expect(rotateImageBlob).toHaveBeenCalledWith(ctx.realFiles[0], 180);
  });
});

describe('computeRenderedBlob — crop логіка', () => {
  it('cropOverride + cropAppliedSet=true — апплаїть crop а потім rotation', async () => {
    const rect = { x: 10, y: 20, width: 100, height: 200 };
    const ctx = makeCtx({
      detectedOrientations: [180],
      cropOverrides: new Map([[0, rect]]),
      cropAppliedSet: new Set([0]),
    });
    await computeRenderedBlob(ctx);
    expect(cropImageBlob).toHaveBeenCalledWith(ctx.realFiles[0], rect);
    // rotation на crop результаті
    expect(rotateImageBlob).toHaveBeenCalledWith(
      expect.objectContaining({ __mock: 'cropped' }), 180
    );
  });

  it('cropOverride + cropAppliedSet=false — НЕ апплаїть crop (scenario 2 frame-only)', async () => {
    const rect = { x: 10, y: 20, width: 100, height: 200 };
    const ctx = makeCtx({
      detectedOrientations: [180],
      cropOverrides: new Map([[0, rect]]),
      cropAppliedSet: new Set(), // empty
    });
    await computeRenderedBlob(ctx);
    expect(cropImageBlob).not.toHaveBeenCalled();
    expect(rotateImageBlob).toHaveBeenCalledWith(ctx.realFiles[0], 180);
  });

  it('cropOverride + includeProposalRect=true (PDF rebuild) — апплаїть навіть без applied', async () => {
    const rect = { x: 10, y: 20, width: 100, height: 200 };
    const ctx = makeCtx({
      detectedOrientations: [180],
      cropOverrides: new Map([[0, rect]]),
      cropAppliedSet: new Set(),
    });
    await computeRenderedBlob(ctx, { includeProposalRect: true });
    expect(cropImageBlob).toHaveBeenCalledWith(ctx.realFiles[0], rect);
  });

  it('cropProposal без override — апплаїть тільки коли includeProposalRect=true', async () => {
    const rect = { x: 5, y: 5, width: 50, height: 80 };
    const ctxNoInclude = makeCtx({
      cropProposals: new Map([[0, rect]]),
    });
    await computeRenderedBlob(ctxNoInclude);
    expect(cropImageBlob).not.toHaveBeenCalled();

    cropImageBlob.mockClear();
    const ctxInclude = makeCtx({
      cropProposals: new Map([[0, rect]]),
    });
    await computeRenderedBlob(ctxInclude, { includeProposalRect: true });
    expect(cropImageBlob).toHaveBeenCalledWith(ctxInclude.realFiles[0], rect);
  });

  it('cropDisabled — НІКОЛИ не апплаїть crop, навіть з override + applied', async () => {
    const rect = { x: 0, y: 0, width: 100, height: 100 };
    const ctx = makeCtx({
      cropOverrides: new Map([[0, rect]]),
      cropAppliedSet: new Set([0]),
      cropDisabled: new Set([0]),
    });
    await computeRenderedBlob(ctx, { includeProposalRect: true });
    expect(cropImageBlob).not.toHaveBeenCalled();
  });

  it('applyCrop=false — пропускає crop незалежно від applied', async () => {
    const rect = { x: 0, y: 0, width: 100, height: 100 };
    const ctx = makeCtx({
      cropOverrides: new Map([[0, rect]]),
      cropAppliedSet: new Set([0]),
    });
    await computeRenderedBlob(ctx, { applyCrop: false });
    expect(cropImageBlob).not.toHaveBeenCalled();
  });
});

describe('computeRenderedBlob — processedBlob fast-path', () => {
  it('processedBlob exists, applyUserRotation=false — повертає proc.blob as-is', async () => {
    const proc = { blob: makeProcessedBlob(), baseUserRotation: 90 };
    const ctx = makeCtx({
      processedBlobs: new Map([[0, proc]]),
      userRotation: new Map([[0, 180]]),
    });
    const blob = await computeRenderedBlob(ctx, { applyUserRotation: false });
    expect(blob).toBe(proc.blob);
    expect(rotateImageBlob).not.toHaveBeenCalled();
    expect(cropImageBlob).not.toHaveBeenCalled();
  });

  it('processedBlob, applyUserRotation=true, userDeg===baseUser — повертає as-is', async () => {
    const proc = { blob: makeProcessedBlob(), baseUserRotation: 90 };
    const ctx = makeCtx({
      processedBlobs: new Map([[0, proc]]),
      userRotation: new Map([[0, 90]]),
    });
    const blob = await computeRenderedBlob(ctx, { applyUserRotation: true });
    expect(blob).toBe(proc.blob);
    expect(rotateImageBlob).not.toHaveBeenCalled();
  });

  it('processedBlob, applyUserRotation=true, userDeg!==baseUser — обертає на delta', async () => {
    const proc = { blob: makeProcessedBlob(), baseUserRotation: 90 };
    const ctx = makeCtx({
      processedBlobs: new Map([[0, proc]]),
      userRotation: new Map([[0, 270]]),
    });
    await computeRenderedBlob(ctx, { applyUserRotation: true });
    expect(rotateImageBlob).toHaveBeenCalledWith(proc.blob, 180); // 270-90
  });

  it('processedBlob ігнорує cropOverride (crop уже запечений у canvas)', async () => {
    const proc = { blob: makeProcessedBlob(), baseUserRotation: 0 };
    const ctx = makeCtx({
      processedBlobs: new Map([[0, proc]]),
      cropOverrides: new Map([[0, { x:0, y:0, width:10, height:10 }]]),
      cropAppliedSet: new Set([0]),
    });
    await computeRenderedBlob(ctx);
    expect(cropImageBlob).not.toHaveBeenCalled();
  });
});

describe('userRotationCssDelta', () => {
  it('повертає user rotation коли немає processedBlob', () => {
    const ctx = makeCtx({ userRotation: new Map([[0, 90]]) });
    expect(userRotationCssDelta(ctx, 0)).toBe(90);
  });

  it('повертає 0 коли user=0 і нема processedBlob', () => {
    const ctx = makeCtx();
    expect(userRotationCssDelta(ctx, 0)).toBe(0);
  });

  it('повертає delta (user - baseUser) коли є processedBlob', () => {
    const ctx = makeCtx({
      userRotation: new Map([[0, 270]]),
      processedBlobs: new Map([[0, { blob: makeProcessedBlob(), baseUserRotation: 90 }]]),
    });
    expect(userRotationCssDelta(ctx, 0)).toBe(180);
  });

  it('нормалізує негативний delta у [0, 360)', () => {
    const ctx = makeCtx({
      userRotation: new Map([[0, 0]]),
      processedBlobs: new Map([[0, { blob: makeProcessedBlob(), baseUserRotation: 90 }]]),
    });
    expect(userRotationCssDelta(ctx, 0)).toBe(270); // 0 - 90 = -90 → 270
  });
});

describe('computeRenderedBlob — сценарії з реального flow', () => {
  it('сценарій 1: crop apply після auto-rotation 180° → blob = crop + rotate(180+0)', async () => {
    const rect = { x: 100, y: 200, width: 800, height: 600 };
    const ctx = makeCtx({
      detectedOrientations: [180],
      cropOverrides: new Map([[0, rect]]),
      cropAppliedSet: new Set([0]),
    });
    await computeRenderedBlob(ctx, { applyUserRotation: true });
    expect(cropImageBlob).toHaveBeenCalledWith(ctx.realFiles[0], rect);
    expect(rotateImageBlob).toHaveBeenCalledWith(
      expect.objectContaining({ __mock: 'cropped' }), 180
    );
  });

  it('сценарій 2 frame-only: rect збережено але preview thumbnail повертає тільки auto-rotated (no crop)', async () => {
    const rect = { x: 100, y: 200, width: 800, height: 600 };
    const ctx = makeCtx({
      detectedOrientations: [180],
      cropOverrides: new Map([[0, rect]]),
      cropAppliedSet: new Set(), // frame-only, NOT applied
    });
    await computeRenderedBlob(ctx, { applyUserRotation: false });
    expect(cropImageBlob).not.toHaveBeenCalled();
    expect(rotateImageBlob).toHaveBeenCalledWith(ctx.realFiles[0], 180);
  });

  it('сценарій 2 final PDF: includeProposalRect=true → апплаїть rect (frame-only включно)', async () => {
    const rect = { x: 100, y: 200, width: 800, height: 600 };
    const ctx = makeCtx({
      detectedOrientations: [180],
      cropOverrides: new Map([[0, rect]]),
      cropAppliedSet: new Set(), // frame-only
    });
    await computeRenderedBlob(ctx, { applyUserRotation: true, includeProposalRect: true });
    expect(cropImageBlob).toHaveBeenCalledWith(ctx.realFiles[0], rect);
    expect(rotateImageBlob).toHaveBeenCalledWith(
      expect.objectContaining({ __mock: 'cropped' }), 180
    );
  });

  it('сценарій 3: ручне обертання після auto — preview blob = тільки auto, CSS дає user delta', async () => {
    const ctx = makeCtx({
      detectedOrientations: [180],
      userRotation: new Map([[0, 90]]),
    });
    // applyUserRotation=false (preview)
    await computeRenderedBlob(ctx, { applyUserRotation: false });
    expect(rotateImageBlob).toHaveBeenCalledWith(ctx.realFiles[0], 180);
    // PDF rebuild аналогічно бере (180+90)=270
    rotateImageBlob.mockClear();
    await computeRenderedBlob(ctx, { applyUserRotation: true });
    expect(rotateImageBlob).toHaveBeenCalledWith(ctx.realFiles[0], 270);
  });
});
