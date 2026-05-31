// ── ImageEditor · grid · displayItems ───────────────────────────────────────
// ЄДИНЕ ДЖЕРЕЛО ІСТИНИ групування дублів для image-editor (модалка + DP).
//
// Чисті функції без React. Логіку перенесено ДОСЛІВНО з робочого
// `ImageMergePanel/PreviewView.jsx` (раніше інлайн `duplicateMembership` /
// `displayItems` / `flattenItems`) — це перенесення, не переписування. DP
// (`DocumentProcessorV2/DpImageMergeEditor.jsx`) раніше мав власну, поламану
// adjacency-only копію (`buildDuplicateSegments`) — її видалено, тепер обидва
// споживачі викликають саме ці функції.
//
// Семантика (інваріанти):
//   - дублікати завжди разом ОДНИМ item-групою, незалежно від позиції членів
//     у orderedIndices (саме це ламала adjacency-only логіка DP);
//   - члени всередині групи відсортовані за origIdx (детерміновано — однаковий
//     вхід дає той самий displayItems, навіть якщо AI повертає різний порядок);
//   - решта індексів — single items;
//   - dismissed-групи (адвокат натиснув «Це не дублікати») НЕ групуються.
//
// Типи:
//   duplicateGroups: Array<{ group: number[], recommended: number, reason: string }>
//   dismissedGroupIds: Set<number>  // порядковий індекс групи в duplicateGroups
//   displayItem:
//     { type: 'single', id: 'single_<idx>', idx }
//     { type: 'group',  id: 'group_<gIdx>', gIdx, indices: [origIdx,...], recommended, reason }

// origIdx → { groupId, recommended, reason, groupIndices }. groupId — порядковий
// номер групи у duplicateGroups. Виключаємо dismissed групи. (PreviewView:119-134)
export function buildDuplicateMembership(duplicateGroups, dismissedGroupIds) {
  const map = new Map();
  const groups = duplicateGroups || [];
  groups.forEach((g, groupId) => {
    if (dismissedGroupIds?.has?.(groupId)) return;
    for (const idx of g.group) {
      map.set(idx, {
        groupId,
        recommended: g.recommended,
        reason: g.reason,
        groupIndices: g.group,
      });
    }
  });
  return map;
}

// Плоский orderedIndices → список displayItems (дублі одним item-групою на
// позиції першого зустрінутого члена). (PreviewView:151-191)
export function buildDisplayItems(orderedIndices, duplicateGroups, dismissedGroupIds) {
  const groups = duplicateGroups || [];
  const activeGroups = groups
    .map((g, gIdx) => ({ g, gIdx }))
    .filter(({ gIdx }) => !dismissedGroupIds?.has?.(gIdx));

  if (activeGroups.length === 0) {
    return orderedIndices.map((idx) => ({ type: 'single', id: `single_${idx}`, idx }));
  }

  // index → group meta
  const indexToGroup = new Map();
  for (const { g, gIdx } of activeGroups) {
    for (const idx of g.group) indexToGroup.set(idx, { gIdx, g });
  }

  const items = [];
  const seenGroups = new Set();
  for (const idx of orderedIndices) {
    const meta = indexToGroup.get(idx);
    if (!meta) {
      items.push({ type: 'single', id: `single_${idx}`, idx });
      continue;
    }
    if (seenGroups.has(meta.gIdx)) continue;
    seenGroups.add(meta.gIdx);
    // Stable order у групі: за original index (deterministic)
    const sortedMembers = [...meta.g.group]
      .filter((i) => orderedIndices.includes(i))
      .sort((a, b) => a - b);
    items.push({
      type: 'group',
      id: `group_${meta.gIdx}`,
      gIdx: meta.gIdx,
      indices: sortedMembers,
      recommended: meta.g.recommended,
      reason: meta.g.reason,
    });
  }
  return items;
}

// displayItems → плоский масив оригінальних індексів (перестановка входу без
// втрат/дублів). (PreviewView:196-203)
export function flattenDisplayItems(items) {
  const flat = [];
  for (const it of items) {
    if (it.type === 'single') flat.push(it.idx);
    else flat.push(...it.indices);
  }
  return flat;
}

// displayItems → Map<origIdx, pos>: позиція кожного origIdx у плоскому списку
// для лейбла «#N». Член групи дублів отримує позицію у порядку появи у
// displayItems (group члени відсортовані за origIdx у buildDisplayItems), тому
// нумерація йде ВІЗУАЛЬНИМ порядком сітки, а не сирим порядком pageIndices.
// СПІЛЬНЕ для модалки (SortableGrid) і DP. (SortableGrid:66-78)
export function buildFlatPositions(displayItems) {
  const map = new Map();
  let pos = 0;
  for (const item of (displayItems || [])) {
    if (item.type === 'single') {
      map.set(item.idx, pos++);
    } else {
      for (const idx of item.indices) map.set(idx, pos++);
    }
  }
  return map;
}

// Лічильник активних (НЕ-dismissed) груп дублів — для тексту банера «Знайдено N
// груп дублікатів». dismissedGroupIds — Set порядкових індексів груп у
// duplicateGroups (адвокат натиснув «Це не дублікати»). СПІЛЬНЕ: модалка і DP
// показують той самий лічильник, що збігається з кількістю намальованих жовтих
// рамок. (DpImageMergeEditor:634)
export function countActiveDuplicateGroups(duplicateGroups, dismissedGroupIds) {
  return (duplicateGroups || []).filter((_, gIdx) => !dismissedGroupIds?.has?.(gIdx)).length;
}
