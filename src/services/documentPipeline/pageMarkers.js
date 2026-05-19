// ── DOCUMENT PIPELINE · PAGE MARKERS (Ф1 Smart Triage) ──────────────────────
// Чистий примітив: зі збереженого per-page OCR-layout (Document AI вже
// порахував текст кожної сторінки у `_text`) зібрати текст з ЯВНИМИ
// маркерами `=== СТОРІНКА N ===` перед кожною сторінкою.
//
// Навіщо (корінь зламу DP-4, R5/R6): текст межевого детектора йшов як
// `slice(0,50000)` БЕЗ номерів сторінок → AI не мав на що спертись і
// галюцинував startPage/endPage. Маркери дають реальні якорі; повний текст
// (без 50K-обрізки) дає всю справу.
//
// Один сенс: «текст для пошуку меж з посторінковими якорями». НЕ чистий
// readable-текст (той лишається без маркерів, персиститься окремо у
// 02_ОБРОБЛЕНІ). Ф0 (структурний паспорт) РОЗШИРЮЄ цей примітив — додає
// дайджест геометрії/orientation/dimension до того ж посторінкового обходу,
// НЕ переписує його.

// Номер сторінки = позиція у layoutJson.pages (1-based). pages — суцільний
// впорядкований per-page список файла (streamingExecutor concat по chunk'ах
// у порядку сторінок). На resume layout може бути неповним — тоді source
// неповний і викликач має лишитись на plain-тексті (див. isPagedLayout).

/**
 * Чи покриває layoutJson увесь файл посторінково (для маркерів придатний).
 * @param {object|null} layoutJson — { schemaVersion, pages:[{_text,...}] }
 * @param {number|null} [expectedPageCount] — якщо відомий, звіряємо повноту
 * @returns {boolean}
 */
export function isPagedLayout(layoutJson, expectedPageCount = null) {
  const pages = layoutJson && Array.isArray(layoutJson.pages) ? layoutJson.pages : null;
  if (!pages || pages.length === 0) return false;
  if (expectedPageCount != null && pages.length !== expectedPageCount) return false;
  return true;
}

/**
 * Зібрати посторінково-маркований текст файла.
 * @param {object|null} layoutJson — { schemaVersion, pages:[{_text,...}] }
 * @param {number|null} [expectedPageCount]
 * @returns {string} текст з `=== СТОРІНКА N ===` або '' якщо layout непридатний
 */
export function buildPagedText(layoutJson, expectedPageCount = null) {
  if (!isPagedLayout(layoutJson, expectedPageCount)) return '';
  return layoutJson.pages
    .map((page, i) => `=== СТОРІНКА ${i + 1} ===\n${(page && page._text) || ''}`)
    .join('\n\n');
}
