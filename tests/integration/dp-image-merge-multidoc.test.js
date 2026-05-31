// dp-image-merge-multidoc — DnD між кількома документами-групами у DP.
//
// Сценарій: 2 документи (паспорт 2 фото, договір 3 фото). Адвокат перетягує
// фото АБО цілу групу дублів з одного документа в інший. Перевіряємо, що
// pageIndices оновлюються правильно (cross-group move) і порожні групи
// відсіюються.
//
// Тест працює на рівні чистої логіки (дзеркало DpImageMergeEditor.handleDragEnd),
// бо повний рендер @dnd-kit у jsdom не дає реальних drag-подій.
//
// ── Копія DnD-логіки (дзеркало DpImageMergeEditor.handleDragEnd) ─────────────
// Це чиста функція яку ми тестуємо ізольовано. Вона МАЄ збігатися з логікою у
// компоненті. Якщо handleDragEnd змінюється — оновити і тут.
//   single → g::<docId>::p::<origIdx>
//   group  → g::<docId>::grp::<gIdx>   (тягнеться як одне ціле)
//   container → g::<docId>::container  (порожнє місце документа)
// Членство фото у групі дублів читається зі спільного duplicateMembership
// (buildDuplicateMembership) — DP не визначає групи сам.

import { describe, it, expect } from 'vitest';
import { buildDuplicateMembership } from '../../src/components/ImageEditor/grid/displayItems.js';

function decode(id) {
  let m = /^g::(.+?)::p::(\d+)$/.exec(id || '');
  if (m) return { kind: 'single', docId: m[1], origIdx: Number(m[2]) };
  m = /^g::(.+?)::grp::(\d+)$/.exec(id || '');
  if (m) return { kind: 'group', docId: m[1], gIdx: Number(m[2]) };
  m = /^g::(.+)::container$/.exec(id || '');
  if (m) return { kind: 'container', docId: m[1] };
  return null;
}

function simulateDragEnd(groups, activeId, overId, duplicateMembership = new Map()) {
  if (activeId === overId) return groups;
  const a = decode(activeId);
  const o = decode(overId);
  if (!a || a.kind === 'container') return groups;
  const targetDocId = o?.docId || null;
  if (!targetDocId) return groups;

  const next = groups.map((g) => ({ ...g, pageIndices: [...g.pageIndices] }));
  const sourceGroup = next.find((g) => g.docId === a.docId);
  const targetGroup = next.find((g) => g.docId === targetDocId);
  if (!sourceGroup || !targetGroup) return groups;

  const movedIndices = a.kind === 'group'
    ? sourceGroup.pageIndices.filter((i) => duplicateMembership.get(i)?.groupId === a.gIdx)
    : [a.origIdx];
  if (movedIndices.length === 0) return groups;

  let anchorIdx = null;
  if (o.kind === 'single') anchorIdx = o.origIdx;
  else if (o.kind === 'group') {
    const found = targetGroup.pageIndices.find(
      (i) => duplicateMembership.get(i)?.groupId === o.gIdx,
    );
    anchorIdx = found === undefined ? null : found;
  }
  if (anchorIdx != null && movedIndices.includes(anchorIdx)) return groups;

  const movedSet = new Set(movedIndices);
  sourceGroup.pageIndices = sourceGroup.pageIndices.filter((i) => !movedSet.has(i));

  const insertAt = anchorIdx == null
    ? targetGroup.pageIndices.length
    : Math.max(0, targetGroup.pageIndices.indexOf(anchorIdx));
  targetGroup.pageIndices.splice(insertAt, 0, ...movedIndices);

  // Прибираємо лише source-групу, якщо вона спорожніла; інші порожні (свідомо
  // додані drop-цілі — борг #36) лишаються.
  return next.filter((g) => g.docId !== a.docId || g.pageIndices.length > 0);
}

describe('DP image-merge — DnD між документами', () => {
  const baseGroups = () => [
    { docId: 'd1', pageIndices: [0, 1] },
    { docId: 'd2', pageIndices: [2, 3, 4] },
  ];

  it('переносить фото з d1 у d2 на позицію', () => {
    const groups = baseGroups();
    const result = simulateDragEnd(groups, 'g::d1::p::0', 'g::d2::p::3');
    expect(result.find((g) => g.docId === 'd1').pageIndices).toEqual([1]);
    expect(result.find((g) => g.docId === 'd2').pageIndices).toEqual([2, 0, 3, 4]);
  });

  it('переносить усе з групи → порожня група відсіюється', () => {
    let groups = baseGroups();
    groups = simulateDragEnd(groups, 'g::d1::p::0', 'g::d2::p::2');
    groups = simulateDragEnd(groups, 'g::d1::p::1', 'g::d2::p::2');
    expect(groups.find((g) => g.docId === 'd1')).toBeUndefined();
    expect(groups.length).toBe(1);
  });

  it('drop на контейнер (порожнє місце) додає в кінець', () => {
    const groups = baseGroups();
    const result = simulateDragEnd(groups, 'g::d1::p::0', 'g::d2::container');
    expect(result.find((g) => g.docId === 'd2').pageIndices).toEqual([2, 3, 4, 0]);
  });

  it('reorder у межах тієї самої групи', () => {
    const groups = baseGroups();
    const result = simulateDragEnd(groups, 'g::d1::p::1', 'g::d1::p::0');
    expect(result.find((g) => g.docId === 'd1').pageIndices).toEqual([1, 0]);
  });

  it('переносить ЦІЛУ групу дублів між документами як одне ціло (усі члени разом)', () => {
    // d1 містить групу дублів {0,1} (gIdx 0). Тягнемо групу у d2 на позицію 3.
    const groups = baseGroups();
    const membership = buildDuplicateMembership(
      [{ group: [0, 1], recommended: 0, reason: 'dup' }],
      new Set(),
    );
    const result = simulateDragEnd(groups, 'g::d1::grp::0', 'g::d2::p::3', membership);
    // d1 спорожнів (обидва члени пішли) → відсіяний.
    expect(result.find((g) => g.docId === 'd1')).toBeUndefined();
    // Обидва члени вставлені разом перед anchor=3.
    expect(result.find((g) => g.docId === 'd2').pageIndices).toEqual([2, 0, 1, 3, 4]);
  });
});

describe('DP image-merge — drop у порожню/нову групу (борг #36/#28)', () => {
  it('drop фото на контейнер ПОРОЖНЬОЇ групи → фото переноситься туди', () => {
    const groups = [
      { docId: 'd1', pageIndices: [0, 1] },
      { docId: 'dNew', pageIndices: [] },
    ];
    const result = simulateDragEnd(groups, 'g::d1::p::0', 'g::dNew::container');
    expect(result.find((g) => g.docId === 'd1').pageIndices).toEqual([1]);
    expect(result.find((g) => g.docId === 'dNew').pageIndices).toEqual([0]);
  });

  it('розділення набору на N документів: послідовно тягнемо аркуші у нову групу', () => {
    let groups = [
      { docId: 'd1', pageIndices: [0, 1, 2, 3] },
      { docId: 'dNew', pageIndices: [] },
    ];
    groups = simulateDragEnd(groups, 'g::d1::p::2', 'g::dNew::container');
    groups = simulateDragEnd(groups, 'g::d1::p::3', 'g::dNew::container');
    expect(groups.find((g) => g.docId === 'd1').pageIndices).toEqual([0, 1]);
    expect(groups.find((g) => g.docId === 'dNew').pageIndices).toEqual([2, 3]);
  });

  it('свідомо додана порожня група ВИЖИВАЄ при перетягуванні між іншими групами', () => {
    // dEmpty — щойно додана drop-ціль. Тягнемо фото між d1 і d2 — dEmpty не зникає.
    const groups = [
      { docId: 'd1', pageIndices: [0, 1] },
      { docId: 'd2', pageIndices: [2] },
      { docId: 'dEmpty', pageIndices: [] },
    ];
    const result = simulateDragEnd(groups, 'g::d1::p::0', 'g::d2::p::2');
    expect(result.find((g) => g.docId === 'dEmpty')).toBeDefined();
    expect(result.find((g) => g.docId === 'dEmpty').pageIndices).toEqual([]);
  });
});
