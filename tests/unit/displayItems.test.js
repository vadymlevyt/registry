// Спільна логіка групування дублів image-editor (модалка + DP).
// Ключовий кейс — розкидані (НЕ суміжні) члени групи → ОДИН group item з усіма
// членами: саме це ламала видалена adjacency-only `buildDuplicateSegments` у DP.

import { describe, it, expect } from 'vitest';
import {
  buildDuplicateMembership,
  buildDisplayItems,
  flattenDisplayItems,
  buildFlatPositions,
  countActiveDuplicateGroups,
} from '../../src/components/ImageEditor/grid/displayItems.js';

describe('buildDisplayItems', () => {
  it('розкидані (НЕ суміжні) члени групи → один group item з усіма членами, відсортованими за origIdx', () => {
    // Група = {0, 3, 5}, але в orderedIndices вони НЕ поруч (між ними 1,2,4).
    const orderedIndices = [0, 1, 2, 3, 4, 5];
    const duplicateGroups = [
      { group: [5, 0, 3], recommended: 0, reason: 'схожі' },
    ];
    const items = buildDisplayItems(orderedIndices, duplicateGroups, new Set());

    const groupItems = items.filter((it) => it.type === 'group');
    expect(groupItems).toHaveLength(1);
    // Усі три члени в ОДНІЙ групі (adjacency-only дала б 3 окремі плитки).
    expect(groupItems[0].indices).toEqual([0, 3, 5]); // відсортовано за origIdx
    expect(groupItems[0].gIdx).toBe(0);
    expect(groupItems[0].recommended).toBe(0);

    // Решта (1,2,4) — single, group з'являється на позиції першого члена (idx 0).
    expect(items.map((it) => (it.type === 'group' ? 'G' : it.idx))).toEqual(['G', 1, 2, 4]);
  });

  it('dismissed група → НЕ групується (усі single)', () => {
    const orderedIndices = [0, 1, 2];
    const duplicateGroups = [{ group: [0, 2], recommended: 0, reason: 'x' }];
    const items = buildDisplayItems(orderedIndices, duplicateGroups, new Set([0]));
    expect(items.every((it) => it.type === 'single')).toBe(true);
    expect(items.map((it) => it.idx)).toEqual([0, 1, 2]);
  });

  it('кілька груп + singles → кожна група одним item на позиції першого члена, у порядку orderedIndices', () => {
    const orderedIndices = [0, 1, 2, 3, 4, 5];
    const duplicateGroups = [
      { group: [1, 4], recommended: 1, reason: 'a' }, // gIdx 0
      { group: [3, 5], recommended: 3, reason: 'b' }, // gIdx 1
    ];
    const items = buildDisplayItems(orderedIndices, duplicateGroups, new Set());
    // Порядок: single 0, group(1,4) на поз. 1, single 2, group(3,5) на поз. 3.
    expect(items.map((it) => (it.type === 'group' ? `G${it.gIdx}` : it.idx)))
      .toEqual([0, 'G0', 2, 'G1']);
    expect(items.find((it) => it.id === 'group_0').indices).toEqual([1, 4]);
    expect(items.find((it) => it.id === 'group_1').indices).toEqual([3, 5]);
  });

  it('немає груп → усі single у порядку orderedIndices', () => {
    const items = buildDisplayItems([2, 0, 1], [], new Set());
    expect(items).toEqual([
      { type: 'single', id: 'single_2', idx: 2 },
      { type: 'single', id: 'single_0', idx: 0 },
      { type: 'single', id: 'single_1', idx: 1 },
    ]);
  });

  it('член групи, видалений з orderedIndices, не потрапляє у indices', () => {
    // origIdx 4 видалили (немає в orderedIndices) — лишається {1} → все одно
    // рендериться як group item (з одним членом), не падає.
    const items = buildDisplayItems([0, 1, 2], [{ group: [1, 4], recommended: 1, reason: 'x' }], new Set());
    const grp = items.find((it) => it.type === 'group');
    expect(grp.indices).toEqual([1]);
  });
});

describe('flattenDisplayItems', () => {
  it('flatten(build(...)) — перестановка вхідних orderedIndices без втрат/дублів', () => {
    const orderedIndices = [0, 1, 2, 3, 4, 5];
    const duplicateGroups = [
      { group: [5, 0, 3], recommended: 0, reason: 'x' },
    ];
    const flat = flattenDisplayItems(buildDisplayItems(orderedIndices, duplicateGroups, new Set()));
    expect([...flat].sort((a, b) => a - b)).toEqual(orderedIndices);
    expect(flat).toHaveLength(orderedIndices.length);
    expect(new Set(flat).size).toBe(orderedIndices.length); // без дублів
  });

  it('flatten зберігає внутрішній порядок: спершу члени групи (sorted), single окремо', () => {
    const items = buildDisplayItems([0, 1, 2, 3], [{ group: [2, 0], recommended: 0, reason: 'x' }], new Set());
    // group(0,2) на позиції першого члена (idx 0), потім single 1, single 3.
    expect(flattenDisplayItems(items)).toEqual([0, 2, 1, 3]);
  });
});

describe('buildDuplicateMembership', () => {
  it('мапить усіх членів усіх (не-dismissed) груп → meta з groupId', () => {
    const groups = [
      { group: [1, 4], recommended: 4, reason: 'a' },
      { group: [2, 7], recommended: 2, reason: 'b' },
    ];
    const m = buildDuplicateMembership(groups, new Set());
    expect(m.get(1)).toEqual({ groupId: 0, recommended: 4, reason: 'a', groupIndices: [1, 4] });
    expect(m.get(4).groupId).toBe(0);
    expect(m.get(2).groupId).toBe(1);
    expect(m.get(7).groupId).toBe(1);
    expect(m.size).toBe(4);
  });

  it('виключає dismissed групи', () => {
    const groups = [
      { group: [1, 4], recommended: 4, reason: 'a' }, // dismissed
      { group: [2, 7], recommended: 2, reason: 'b' },
    ];
    const m = buildDuplicateMembership(groups, new Set([0]));
    expect(m.has(1)).toBe(false);
    expect(m.has(4)).toBe(false);
    expect(m.get(2).groupId).toBe(1);
    expect(m.size).toBe(2);
  });

  it('порожній/undefined вхід → порожня мапа', () => {
    expect(buildDuplicateMembership(undefined, new Set()).size).toBe(0);
    expect(buildDuplicateMembership([], new Set()).size).toBe(0);
  });
});

describe('buildFlatPositions', () => {
  it('усі single → послідовна нумерація у порядку displayItems', () => {
    const items = buildDisplayItems([2, 0, 1], [], new Set());
    const pos = buildFlatPositions(items);
    // Порядок items: single 2, single 0, single 1.
    expect(pos.get(2)).toBe(0);
    expect(pos.get(0)).toBe(1);
    expect(pos.get(1)).toBe(2);
  });

  it('члени групи дублів нумеруються ПОСПІЛЬ за візуальним порядком сітки (а не сирим)', () => {
    // Група {0,3,5} розкидана у orderedIndices [0,1,2,3,4,5]. Візуально група
    // стягується на позицію першого члена: [G(0,3,5), 1, 2, 4].
    const items = buildDisplayItems([0, 1, 2, 3, 4, 5], [{ group: [5, 0, 3], recommended: 0, reason: 'x' }], new Set());
    const pos = buildFlatPositions(items);
    // Члени групи отримують 0,1,2 (поспіль), потім singles 1,2,4 → 3,4,5.
    expect(pos.get(0)).toBe(0);
    expect(pos.get(3)).toBe(1);
    expect(pos.get(5)).toBe(2);
    expect(pos.get(1)).toBe(3);
    expect(pos.get(2)).toBe(4);
    expect(pos.get(4)).toBe(5);
  });

  it('кожен origIdx має унікальну позицію 0..N-1', () => {
    const items = buildDisplayItems([0, 1, 2, 3], [{ group: [2, 0], recommended: 0, reason: 'x' }], new Set());
    const pos = buildFlatPositions(items);
    const vals = [...pos.values()].sort((a, b) => a - b);
    expect(vals).toEqual([0, 1, 2, 3]);
  });

  it('порожній/undefined вхід → порожня мапа', () => {
    expect(buildFlatPositions([]).size).toBe(0);
    expect(buildFlatPositions(undefined).size).toBe(0);
  });
});

describe('countActiveDuplicateGroups', () => {
  it('рахує всі групи коли нічого не dismissed', () => {
    const groups = [
      { group: [0, 1], recommended: 0, reason: 'a' },
      { group: [2, 3], recommended: 2, reason: 'b' },
    ];
    expect(countActiveDuplicateGroups(groups, new Set())).toBe(2);
  });

  it('виключає dismissed групи (збігається з намальованими рамками)', () => {
    const groups = [
      { group: [0, 1], recommended: 0, reason: 'a' }, // dismissed
      { group: [2, 3], recommended: 2, reason: 'b' },
    ];
    expect(countActiveDuplicateGroups(groups, new Set([0]))).toBe(1);
    expect(countActiveDuplicateGroups(groups, new Set([0, 1]))).toBe(0);
  });

  it('порожній/undefined вхід → 0', () => {
    expect(countActiveDuplicateGroups(undefined, new Set())).toBe(0);
    expect(countActiveDuplicateGroups([], new Set())).toBe(0);
    expect(countActiveDuplicateGroups([{ group: [0, 1], recommended: 0, reason: 'a' }], undefined)).toBe(1);
  });
});
