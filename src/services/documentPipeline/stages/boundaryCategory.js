// ── DP · BOUNDARY TYPE → CANONICAL CATEGORY ─────────────────────────────────
// Єдиний сенс (правило #11): груба рубрика нарізки (boundary `type`, який дає
// AI-Triage / план реконструкції) → канонічна category документа
// (src/schemas/documentSchema.js). Не плутати з document.category як таким —
// `type` груба, `category` канонічна; мапа явна, не «і те й те».
//
// Живий споживач — splitDocumentsV3.resolveCategory. Винесено сюди при чистці
// мертвих поколінь пошуку меж (A1, Частина B): класифікатор classifyV2 видалено,
// а ця єдина жива функція переїхала у власний тонкий модуль.

// Словник type документа з documentBoundary/prompt.js → canonical category.
const BOUNDARY_TYPE_TO_CATEGORY = {
  court_cover: 'other',
  pleading: 'pleading',
  court_act: 'court_act',
  evidence: 'evidence',
  certificate: 'identification',
  contract: 'contract',
  other: 'other',
};

export function categoryFromBoundaryType(type) {
  return BOUNDARY_TYPE_TO_CATEGORY[type] || 'other';
}
