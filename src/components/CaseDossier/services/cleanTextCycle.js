// ── CLEAN TEXT CYCLE (TASK 3.2) ─────────────────────────────────────────────
// Чиста логіка ретроактивної очистки текстів справи (кнопка «Очистити тексти»
// в Огляді). Винесена з CaseDossier щоб бути тестовною без React (UI-стан —
// прогрес/ResultCard — лишається в компоненті; тут — фільтр+цикл+агрегація).
//
// Скоуп (parent §СКОУП): очистка ВИКЛЮЧНО для documentNature==='scanned' з сирим
// текстом (textFormat!=='md'). searchable (DOCX/HTML/текстовий PDF) і вже-.md —
// пропускаються. Архівні документи (status==='archived') не чіпаємо.

/**
 * partitionForCleaning — розбити документи справи на чергу очистки і пропуски.
 * @param {Array} documents — caseData.documents
 * @returns {{ queue: Array, skippedCount: number }}
 *   queue — активні scanned з сирим текстом (підлягають очистці);
 *   skippedCount — активні документи поза скоупом (searchable або вже .md).
 */
export function partitionForCleaning(documents) {
  const docs = Array.isArray(documents) ? documents : [];
  const active = docs.filter(d => d && d.status !== 'archived');
  const queue = active.filter(d => d.documentNature === 'scanned' && d.textFormat !== 'md');
  const skippedCount = active.length - queue.length;
  return { queue, skippedCount };
}

/**
 * runCleanCycle — прогнати чергу очистки через ACTION clean_document_text.
 * Кожен документ — окремий executeAction (повна перевірка прав + білінг у ядрі).
 * Агрегує підсумок для ResultCard. Помилка одного документа не валить цикл.
 *
 * @param {object} opts
 *   documents — caseData.documents (фільтрується через partitionForCleaning)
 *   caseId — id справи
 *   executeAction — (agentId, action, params) => Promise<result>
 *   onProgress — (text, index, total) => void (UI-прогрес)
 *   agentId — за замовчуванням 'dossier_agent'
 * @returns {Promise<{cleaned, skipped, degraded, errors, attentionNotes}>}
 */
export async function runCleanCycle({
  documents,
  caseId,
  executeAction,
  onProgress = () => {},
  agentId = 'dossier_agent',
}) {
  const { queue, skippedCount } = partitionForCleaning(documents);
  let cleaned = 0;
  let degraded = 0;
  let errors = 0;
  const attentionNotes = [];

  for (let i = 0; i < queue.length; i++) {
    const doc = queue[i];
    const docName = doc.name || doc.originalName || '';
    onProgress(`Чищу ${i + 1} з ${queue.length}: ${docName}`, i + 1, queue.length);
    let r;
    try {
      r = await executeAction(agentId, 'clean_document_text', { caseId, documentId: doc.id });
    } catch (e) {
      r = { success: false, error: (e && e.message) || String(e) };
    }
    if (r && r.success) {
      cleaned += 1;
      for (const n of (r.attentionNotes || [])) {
        if (n && n.note) attentionNotes.push({ docName, note: n.note });
      }
    } else if (r && r.degraded) {
      degraded += 1;
    } else if (r && r.skipped) {
      // ядро-гард відсіяв (рідко — фільтр уже відсіяв скоуп); не помилка
    } else {
      errors += 1;
    }
  }

  return { cleaned, skipped: skippedCount, degraded, errors, attentionNotes };
}
