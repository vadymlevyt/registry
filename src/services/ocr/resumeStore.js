// ── OCR RESUME STORE ────────────────────────────────────────────────────────
// In-memory мапа { driveId → ResumeState }. Дозволяє наступному виклику
// extractText продовжити з місця де попередня спроба впала на NETWORK
// помилці після вичерпання retry — не передруковуючи вже оброблені чанки
// Document AI.
//
// СВІДОМО без persistence (Drive / localStorage / IndexedDB):
//   • Document AI повторно розпізнає той самий чанк дешево, перезавантаження
//     сторінки = з нуля — допустимо.
//   • Стан тимчасовий, у реєстрі немає сенсу.
//   • CLAUDE.md правило #8 (кирилиця у q= Drive API) — менше Drive I/O краще.
//
// Якщо в майбутньому знадобиться переживати reload — окремий TASK з прицілом
// на IndexedDB. Тут — простіше і чесніше.
//
// Стан ResumeState (формат):
//   {
//     driveId: string,
//     totalPages: number,
//     processedRanges: [{ startPage, endPage }],   // 1-based, inclusive
//     textChunks: [{ startPage, endPage, text }],  // у тому ж порядку
//     pageStructureAll: [...],                     // Document AI pages з global pageNumber
//     warnings: string[],
//     lastFailedRange: { startPage, endPage } | null,
//     lastError: { code, message } | null,
//     provider: 'documentAi',                       // хто залишив state
//     savedAt: number,                              // ms timestamp
//   }
//
// Інваріант: якщо є state у мапі — обробка НЕ завершена. Очищується після
// успішного завершення повного файлу.

const store = new Map();

export function getResume(driveId) {
  if (!driveId) return null;
  return store.get(driveId) || null;
}

export function setResume(driveId, state) {
  if (!driveId || !state) return;
  store.set(driveId, { ...state, savedAt: Date.now() });
}

export function clearResume(driveId) {
  if (!driveId) return;
  store.delete(driveId);
}

export function hasResume(driveId) {
  if (!driveId) return false;
  return store.has(driveId);
}

// Скільки сторінок вже оброблено. Для toast і діалогу: "Опрацьовано N з M".
export function processedPageCount(state) {
  if (!state || !Array.isArray(state.processedRanges)) return 0;
  return state.processedRanges.reduce(
    (sum, r) => sum + Math.max(0, (r.endPage - r.startPage + 1)),
    0
  );
}

// Тільки для тестів — повне очищення мапи.
export function _clearAllForTests() {
  store.clear();
}
