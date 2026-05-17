// ── DP-3 STAGE · CONFIRM BOUNDARIES ─────────────────────────────────────────
// Підключається через deps.stageOverrides[STAGE.CONFIRM]. Диригент НЕ
// змінюється. Замінює DP-1 заглушку confirm (auto-pass) у streaming-шляху.
//
// propose→confirm-гейт (зберігається як ПРИНЦИП): фіксує decisions[] з
// планом реконструкції І список невикористаних сторінок (ctx.unusedPages[])
// з причинами — це джерело для UI вкладки Підтвердження (DP-4) і для стадії
// saveFragments.
//
// DP-3 БЕЗ UI (топбар — єдиний UI; повний екран — DP-4). Тому опція
// autoConfirm:true (дефолт для streaming/тестів) позначає план підтвердженим
// одразу — pipeline доходить до реального split і дає результат. autoConfirm
// явно ввімкнений, не «тихо так» — один сенс (правило #11):
//   • autoConfirm:true  → план позначається confirmed, split іде далі.
//   • autoConfirm:false → план лишається proposed; split нічого не ріже
//     (чекає UI-підтвердження DP-4) — НЕ fatal, просто без нарізки.
//
// Нема плану (один документ, без меж) → auto-pass (поведінка DP-1
// passthrough збережена — single-file НЕ регресує).

export function createConfirmBoundaries(stageDeps = {}) {
  const autoConfirm = stageDeps.autoConfirm !== false;     // дефолт true (DP-3)

  return async function confirmBoundaries(ctx) {
    const plan = ctx.reconstructionPlan;
    if (!plan || !Array.isArray(plan.documents) || plan.documents.length === 0) {
      return { ok: true };                                 // нема що підтверджувати
    }

    const unusedPages = Array.isArray(ctx.unusedPages) ? ctx.unusedPages
      : (Array.isArray(plan.unusedPages) ? plan.unusedPages : []);

    const confirmedPlan = {
      ...plan,
      confirmed: autoConfirm === true,
      confirmedAt: autoConfirm ? new Date().toISOString() : null,
      confirmedBy: autoConfirm ? (ctx.job.addedBy || 'system') : null,
    };

    const decisions = [{
      type: 'boundaries_confirmation',
      autoConfirmed: autoConfirm === true,
      documentCount: plan.documents.length,
      unusedPageCount: unusedPages.length,
      documents: plan.documents.map((d) => ({
        documentId: d.documentId, name: d.name, type: d.type,
        fragments: d.fragments,
      })),
      unusedPages,
      message: autoConfirm
        ? `Авто-підтверджено ${plan.documents.length} документів і ${unusedPages.length} фрагментів (UI підтвердження — DP-4).`
        : `${plan.documents.length} документів очікують підтвердження адвоката (DP-4).`,
    }];

    return {
      ok: true,
      ctx: { ...ctx, reconstructionPlan: confirmedPlan, unusedPages },
      decisions,
    };
  };
}
