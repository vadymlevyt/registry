// Спільні похідні UI-стани image-editor (модалка + DP): crop-стан per-фото,
// лічильник активних обрізок, набір непевної орієнтації. Винесено з інлайн-копій
// PreviewView / DpImageMergeEditor (борг #33) — тут перевіряємо однаковий
// вхід → однаковий вихід та edge-кейси.

import { describe, it, expect } from 'vitest';
import {
  buildCropStateByIndex,
  countActiveCrop,
  buildUncertainSet,
} from '../../src/services/imageDocument/cropState.js';

describe('buildCropStateByIndex', () => {
  it('proposal без override/applied/disabled → active', () => {
    const m = buildCropStateByIndex(new Map([[0, { x: 0 }]]), new Map(), new Set(), new Set(), new Map());
    expect(m.get(0)).toBe('active');
  });

  it('disabled → disabled (перебиває active)', () => {
    const m = buildCropStateByIndex(new Map([[0, { x: 0 }]]), new Map(), new Set([0]), new Set(), new Map());
    expect(m.get(0)).toBe('disabled');
  });

  it('cropAppliedSet → applied (перебиває disabled)', () => {
    const m = buildCropStateByIndex(new Map([[0, { x: 0 }]]), new Map([[0, { x: 0 }]]), new Set([0]), new Set([0]), new Map());
    expect(m.get(0)).toBe('applied');
  });

  it('processedBlob → applied навіть без proposal/override', () => {
    const m = buildCropStateByIndex(new Map(), new Map(), new Set(), new Set(), new Map([[3, { blob: {} }]]));
    expect(m.get(3)).toBe('applied');
  });

  it('фото без жодного rect/blob → відсутнє у мапі (RenderItem трактує як none)', () => {
    const m = buildCropStateByIndex(new Map(), new Map(), new Set(), new Set(), new Map());
    expect(m.size).toBe(0);
    expect(m.has(0)).toBe(false);
  });

  it("об'єднує ключі з proposals + overrides + processedBlobs", () => {
    const m = buildCropStateByIndex(
      new Map([[0, {}]]),
      new Map([[1, {}]]),
      new Set(),
      new Set([1]),
      new Map([[2, {}]]),
    );
    expect(m.get(0)).toBe('active');   // proposal only
    expect(m.get(1)).toBe('applied');  // override + applied
    expect(m.get(2)).toBe('applied');  // processedBlob
    expect(m.size).toBe(3);
  });
});

describe('countActiveCrop', () => {
  it('рахує лише стани active', () => {
    const state = new Map([[0, 'active'], [1, 'disabled'], [2, 'applied'], [3, 'active']]);
    expect(countActiveCrop(state)).toBe(2);
  });

  it('порожній/undefined → 0', () => {
    expect(countActiveCrop(new Map())).toBe(0);
    expect(countActiveCrop(undefined)).toBe(0);
  });
});

describe('buildUncertainSet', () => {
  it('масив індексів → Set', () => {
    const s = buildUncertainSet([1, 4, 7]);
    expect(s.has(4)).toBe(true);
    expect(s.size).toBe(3);
  });

  it('порожній/undefined → порожній Set', () => {
    expect(buildUncertainSet([]).size).toBe(0);
    expect(buildUncertainSet(undefined).size).toBe(0);
  });
});
