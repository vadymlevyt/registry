// ── imageDocument · duplicateSelection ───────────────────────────────────────
// Спільна чиста логіка для кнопки «Видалити всі дублікати» (банер).
// Використовується І модалкою (ImageMergePanel/PreviewView), І DP
// (DpImageMergeEditor) — один сенс, без дублювання (правило #30).
//
// #12 (рішення адвоката 2026-05-30): «Видалити всі» ПОВАЖАЄ ручний вибір.
// AI-рекомендація застосовується ТІЛЬКИ до НЕЗАЙМАНИХ груп. Група пропускається
// повністю (не чіпається) якщо:
//   • вона у dismissedGroupIds — адвокат розгрупував її кнопкою «Це не
//     дублікати» (це окремі сторінки, не дублі); АБО
//   • адвокат уже вручну торкнувся групи — будь-який її член ВІДСУТНІЙ серед
//     активних (isMemberPresent(idx) === false). Це покриває обидва ручні
//     сценарії: «видалив рекомендований (зелений), лишив свій (жовтий)» і
//     «видалив частину членів вручну». Його вибір головніший за AI.
// Лише для «чистих» (незайманих) груп лишаємо g.recommended, решту — у Set
// на видалення.

/**
 * @param {Array<{group:number[], recommended:number, reason?:string}>} duplicates
 *   — групи дублів (індекси у просторі orig).
 * @param {Object} ctx
 * @param {{has:(gid:number)=>boolean}} [ctx.dismissedGroupIds] — Set ID
 *   розгрупованих груп (groupId = індекс у duplicates).
 * @param {(idx:number)=>boolean} ctx.isMemberPresent — чи член ще присутній
 *   серед активних (не видалений вручну).
 * @returns {Set<number>} індекси до видалення (тільки з незайманих груп).
 */
export function selectRecommendedDuplicateRemovals(duplicates, { dismissedGroupIds, isMemberPresent } = {}) {
  const toRemove = new Set();
  if (!Array.isArray(duplicates)) return toRemove;
  const present = typeof isMemberPresent === 'function' ? isMemberPresent : () => true;

  duplicates.forEach((g, groupId) => {
    if (dismissedGroupIds?.has?.(groupId)) return;          // розгруповано — не чіпати
    if (!Array.isArray(g?.group)) return;
    const touchedManually = g.group.some((idx) => !present(idx));
    if (touchedManually) return;                            // ручний вибір головніший
    for (const idx of g.group) {
      if (idx !== g.recommended) toRemove.add(idx);
    }
  });

  return toRemove;
}
