// #12 — selectRecommendedDuplicateRemovals: «Видалити всі дублікати» поважає
// ручний вибір. Спільна логіка модалки і DP.
import { describe, it, expect } from 'vitest';
import { selectRecommendedDuplicateRemovals } from '../../src/services/imageDocument/duplicateSelection.js';

const all = (idx) => true; // всі присутні (нічого не видаляли вручну)

describe('selectRecommendedDuplicateRemovals (#12)', () => {
  it('чиста група → лишає recommended, решту у видалення', () => {
    const dups = [{ group: [0, 1, 2], recommended: 1 }];
    const out = selectRecommendedDuplicateRemovals(dups, { isMemberPresent: all });
    expect([...out].sort()).toEqual([0, 2]);
  });

  it('dismissed-група → недоторкана (нічого не видаляється)', () => {
    const dups = [{ group: [0, 1], recommended: 0 }];
    const out = selectRecommendedDuplicateRemovals(dups, {
      dismissedGroupIds: new Set([0]),
      isMemberPresent: all,
    });
    expect(out.size).toBe(0);
  });

  it('ручний вибір: видалив рекомендований (зелений), лишив свій → група недоторкана', () => {
    const dups = [{ group: [0, 1], recommended: 0 }];
    // idx 0 (recommended) уже видалений вручну → відсутній.
    const present = new Set([1]);
    const out = selectRecommendedDuplicateRemovals(dups, {
      isMemberPresent: (idx) => present.has(idx),
    });
    expect(out.size).toBe(0); // жовтий (idx 1) НЕ виноситься
  });

  it('ручний вибір: видалив один член вручну → вся група пропускається', () => {
    const dups = [{ group: [3, 4, 5], recommended: 4 }];
    const present = new Set([3, 4]); // 5 видалений вручну
    const out = selectRecommendedDuplicateRemovals(dups, {
      isMemberPresent: (idx) => present.has(idx),
    });
    expect(out.size).toBe(0);
  });

  it('мікс: чиста група оброблюється, dismissed і ручна — ні', () => {
    const dups = [
      { group: [0, 1], recommended: 0 },   // чиста → видалити 1
      { group: [2, 3], recommended: 2 },   // dismissed → пропустити
      { group: [4, 5], recommended: 4 },   // ручна (5 відсутній) → пропустити
    ];
    const present = new Set([0, 1, 2, 3, 4]); // 5 видалений
    const out = selectRecommendedDuplicateRemovals(dups, {
      dismissedGroupIds: new Set([1]),
      isMemberPresent: (idx) => present.has(idx),
    });
    expect([...out]).toEqual([1]);
  });

  it('порожній / невалідний вхід → порожній Set', () => {
    expect(selectRecommendedDuplicateRemovals(null, { isMemberPresent: all }).size).toBe(0);
    expect(selectRecommendedDuplicateRemovals([], { isMemberPresent: all }).size).toBe(0);
    expect(selectRecommendedDuplicateRemovals([{ recommended: 0 }], { isMemberPresent: all }).size).toBe(0);
  });
});
