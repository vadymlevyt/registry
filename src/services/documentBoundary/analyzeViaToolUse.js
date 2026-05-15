// ── DOCUMENT BOUNDARY · ANALYZE (TOOL USE TRANSPORT) ─────────────────────────
// Виявлення меж документів через Anthropic Document Block. Трансплантовано з
// історичного DocumentProcessor (analyzePDFWithDocumentBlock,
// src/components/DocumentProcessor/index.jsx:155-264) у TASK 1.
//
// ДОСЛІВНО збережено: base64-кодування PDF, resolveModel('documentProcessor'),
// білінг-інструментація (logAiUsageViaSink + activityTracker.report
// 'agent_call' document_parser/parse_document), JSON-clean+parse.
// ПЕРЕПИСАНО (бо змінює підхід / є патологією): прямий fetch до
// api.anthropic.com + ручна перевірка response.ok → через
// toolUseRunner.callAPIWithRetry (єдиний транспорт з retry/friendly-errors).

import { resolveModel } from '../modelResolver.js';
import { logAiUsageViaSink } from '../aiUsageService.js';
import * as activityTracker from '../activityTracker.js';
import { MODULES, categoryForCase } from '../moduleNames.js';
import { callAPIWithRetry } from '../toolUseRunner.js';
import { buildBoundaryPrompt } from './prompt.js';

/**
 * Запитати модель про межі документів у склеєному PDF.
 * @param {object} args
 * @param {ArrayBuffer|Uint8Array} args.arrayBuffer — PDF
 * @param {string} args.apiKey — Anthropic API ключ
 * @param {string} [args.userHint] — контекст від адвоката
 * @param {string|null} [args.caseId] — для білінг-контексту
 * @param {Function} [args.aiUsageSink] — sink для не-React точок (як legacy)
 * @returns {Promise<{totalPages:number, documents:Array<{name,startPage,endPage,type}>}>}
 */
export async function analyzeBoundariesViaToolUse({ arrayBuffer, apiKey, userHint = '', caseId = null, aiUsageSink } = {}) {
  const uint8 = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  const base64 = btoa(binary);

  const docModel = resolveModel('documentProcessor');

  // Транспорт переписано: callAPIWithRetry сам робить fetch зі стандартними
  // headers, retry на 429/5xx, friendly-error на 401/400/мережа, і повертає
  // вже розпарсений JSON-об'єкт (як legacy data = await response.json()).
  const data = await callAPIWithRetry({
    model: docModel,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: buildBoundaryPrompt(userHint) },
      ],
    }],
  }, { apiKey });

  if (data.error) {
    throw new Error(data.error.message);
  }

  try {
    logAiUsageViaSink({
      agentType: 'document_parser',
      model: docModel,
      inputTokens: data?.usage?.input_tokens,
      outputTokens: data?.usage?.output_tokens,
      context: { caseId: caseId || null, module: MODULES.DOCUMENT_PROCESSOR, operation: 'parse_document' },
    }, aiUsageSink);
    activityTracker.report('agent_call', {
      caseId: caseId || null,
      module: MODULES.DOCUMENT_PROCESSOR,
      category: categoryForCase(caseId),
      metadata: { agentType: 'document_parser', operation: 'parse_document' },
    });
  } catch {}

  const text = data.content[0].text;

  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    throw new Error('Не вдалось розпізнати структуру документа: ' + text.substring(0, 200));
  }
}
