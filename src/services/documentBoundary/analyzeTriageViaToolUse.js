// ── DOCUMENT BOUNDARY · TRIAGE TRANSPORT (Ф2 Smart Triage) ──────────────────
// AI-хід Triage поверх toolUseRunner.callAPIWithRetry (єдиний транспорт з
// retry/timeout/friendly-errors — Ф1). Структура дзеркалить
// analyzeViaToolUse.js (інституційний патерн), АЛЕ:
//   • вхід — text-блок структурного паспорта (Ф0), НЕ Document Block:
//     нуль image-токенів (вартісна модель §6);
//   • модель — Haiku через resolveModel('qiParserDocument') (структурна
//     задача, ~1/3 ціни Sonnet; R8-фікс — 'document_parser' тихо тягнув
//     Sonnet бо ключа нема в SYSTEM_DEFAULTS);
//   • білінг §12: logAiUsageViaSink (ai_usage[], оператор SaaS) +
//     activityTracker.report('agent_call', operation:'triage') (time_entries[],
//     час адвоката) — НЕ дублювати поля; усе в try/catch (не валити job).
//
// Чистий модуль: без Drive/React. Транспорт мокається через global fetch
// (як toolUseRunner/analyzeViaToolUse тести) — Provider-integration тест
// ганяє цей РЕАЛЬНИЙ модуль через стадію (обмеження §2.1).

import { resolveModel } from '../modelResolver.js';
import { logAiUsageViaSink } from '../aiUsageService.js';
import * as activityTracker from '../activityTracker.js';
import { MODULES, categoryForCase } from '../moduleNames.js';
import { callAPIWithRetry } from '../toolUseRunner.js';
import { buildTriagePrompt } from './triagePrompt.js';

function extractJson(text) {
  if (typeof text !== 'string') return null;
  const s = text.indexOf('{');
  if (s < 0) return null;
  let depth = 0;
  for (let i = s; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) { try { return JSON.parse(text.slice(s, i + 1)); } catch { return null; } }
    }
  }
  return null;
}

/**
 * Запитати Triage-план для набору артефактів.
 * @param {object} args
 * @param {Array<{fileId,name,origin?,pageCount?,passport:string}>} args.artifacts
 * @param {string} [args.userHint]
 * @param {string|null} [args.caseId]
 * @param {string} args.apiKey
 * @param {Function} [args.aiUsageSink]
 * @returns {Promise<{documents:Array, unusedPages:Array}>}
 */
export async function analyzeTriageViaToolUse({ artifacts = [], userHint = '', caseId = null, apiKey, aiUsageSink } = {}) {
  if (!apiKey) throw new Error('Немає API ключа для Triage');

  // Haiku — структурна задача (вартісна модель §6). Ієрархія user→tenant→
  // system збережена (resolveModel), не hardcoded.
  const model = resolveModel('qiParserDocument');
  const prompt = buildTriagePrompt({ artifacts, userHint });

  const data = await callAPIWithRetry({
    model,
    max_tokens: 4000,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
  }, { apiKey });

  if (data?.error) throw new Error(data.error.message);

  try {
    logAiUsageViaSink({
      agentType: 'document_parser',
      model,
      inputTokens: data?.usage?.input_tokens,
      outputTokens: data?.usage?.output_tokens,
      context: { caseId: caseId || null, module: MODULES.DOCUMENT_PROCESSOR, operation: 'triage' },
    }, aiUsageSink);
    activityTracker.report('agent_call', {
      caseId: caseId || null,
      module: MODULES.DOCUMENT_PROCESSOR,
      category: categoryForCase(caseId),
      metadata: { agentType: 'document_parser', operation: 'triage' },
    });
  } catch { /* білінг не валить job (§12) */ }

  const out = data?.content?.[0]?.text;
  const parsed = extractJson(typeof out === 'string' ? out : '');
  if (!parsed) {
    throw new Error('Triage повернув не-JSON: ' + String(out || '').slice(0, 200));
  }
  return { documents: parsed.documents || [], unusedPages: parsed.unusedPages || [] };
}
