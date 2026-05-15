// ── DOCUMENT BOUNDARY · FACADE ───────────────────────────────────────────────
// Модуль виявлення і розрізання меж склеєних PDF. Трансплантовано (TASK 1
// salvage-and-decommission) з історичного DocumentProcessor; стара оболонка
// видалена, pre-deletion код — git tag pre-dp-v2-old-dp-removal.
//
// КОНТРАКТ propose → confirm (зберігається як ПРИНЦИП, не оптимізується):
//   • detectBoundaries() — лише ПРОПОНУЄ структуру, нічого не пише.
//   • splitByBoundaries() — окремий ЯВНИЙ виклик, лише ріже у пам'яті.
//   Двокроковість API і є propose→confirm на рівні контракту; UI-гейт
//   підтвердження адвокатом — відповідальність майбутнього DP v2.
//
// Модуль ЧИСТИЙ: без Drive, без executeAction, без React/state. Персистенцію
// (запис у 02_ОБРОБЛЕНІ, executeAction('document_processor_agent',
// 'add_documents', ...)) робить майбутній DP v2 — тонкий диригент, НЕ цей
// сервіс. Обхід шару зі старого handleSplit (driveRequest/updateCase) НЕ
// трансплантовано свідомо: це і є патологія заради якої старий DP зноситься.

import { splitPdf } from './splitPdf.js';
import { analyzeBoundariesViaToolUse } from './analyzeViaToolUse.js';

export { splitPdf } from './splitPdf.js';
export { buildBoundaryPrompt } from './prompt.js';
export { analyzeBoundariesViaToolUse } from './analyzeViaToolUse.js';

/**
 * Запропонувати межі документів у склеєному PDF (нічого не пише).
 * @param {object} args — { arrayBuffer, apiKey, userHint?, caseId?, aiUsageSink? }
 * @returns {Promise<{totalPages:number, documents:Array<{name,startPage,endPage,type}>}>}
 */
export async function detectBoundaries({ arrayBuffer, apiKey, userHint = '', caseId = null, aiUsageSink } = {}) {
  return analyzeBoundariesViaToolUse({ arrayBuffer, apiKey, userHint, caseId, aiUsageSink });
}

/**
 * Розрізати PDF за ПІДТВЕРДЖЕНИМИ межами (лише в пам'яті, не персистить).
 * @param {ArrayBuffer|Uint8Array} arrayBuffer
 * @param {Array<{name,type,startPage,endPage}>} ranges
 * @returns {Promise<Array<{name,type,pageCount,data:Uint8Array,sizeMB:string}>>}
 */
export async function splitByBoundaries(arrayBuffer, ranges) {
  return splitPdf(arrayBuffer, ranges);
}
