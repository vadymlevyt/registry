// ── DOCUMENT BOUNDARY · TRIAGE TRANSPORT (Ф2 Smart Triage) ──────────────────
// AI-хід Triage поверх парасолі callAgent (TASK B1 · борг #55 Частина А).
// Структура дзеркалить analyzeViaToolUse.js (інституційний патерн), АЛЕ:
//   • вхід — text-блок структурного паспорта (Ф0), НЕ Document Block:
//     нуль image-токенів (вартісна модель §6);
//   • модель і облік — тепер через callAgent (НЕ вручну тут):
//       – callAgent сам резолвить модель через resolveModel('qiParserDocument')
//         (Haiku, ~1/3 ціни Sonnet; R8-фікс — snake_case 'document_parser' нема
//         в SYSTEM_DEFAULTS → тихо тягнув би Sonnet);
//       – callAgent сам пише ai_usage (мітка 'document_parser' через
//         AGENT_USAGE_LABELS) + activityTracker('agent_call', operation:'triage')
//         РІВНО ОДИН раз, у try/catch (§3 Варіант А — без подвоєння).
//     Ручний logAiUsageViaSink/activityTracker.report звідси ПРИБРАНО — тепер це
//     робить парасоля. Результат нарізки і лічильники токенів — НЕЗМІННІ.
//
// Чистий модуль: без Drive/React. Транспорт мокається через global fetch
// (як toolUseRunner/analyzeViaToolUse тести) — Provider-integration тест
// ганяє цей РЕАЛЬНИЙ модуль через стадію (обмеження §2.1).

import { MODULES } from '../moduleNames.js';
import { callAgent } from '../callAgent.js';
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
 * @returns {Promise<{documents:Array, unusedPages:Array, usage:object}>}
 */
export async function analyzeTriageViaToolUse({ artifacts = [], userHint = '', caseId = null, apiKey, aiUsageSink } = {}) {
  if (!apiKey) throw new Error('Немає API ключа для Triage');

  const prompt = buildTriagePrompt({ artifacts, userHint });

  // Парасоля callAgent: резолв моделі + облік усередині (див. шапку файлу).
  // mode:'text' — Triage це одно-турновий text-complete (НЕ tool-use попри
  // історичну назву файлу); поведінка ідентична попередньому callAPIWithRetry.
  const { text, usage, model } = await callAgent({
    agentType: 'qiParserDocument',
    mode: 'text',
    // Підвищено з 4000 — для тома з 50-74 документами план у JSON ≈ 60-90
    // токенів на документ × 74 ≈ 5900 токенів. Anthropic тарифікує тільки
    // використані токени, не ліміт — це дозвіл, не вимога видавати більше.
    max_tokens: 16000,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    context: { caseId: caseId || null, module: MODULES.DOCUMENT_PROCESSOR, operation: 'triage' },
    apiKey,
    aiUsageSink,
  });

  // Діагностика великих томів — реальні токени input/output. Без цього
  // неможливо розрізнити «AI обрізаний max_tokens» від «AI здається сам»
  // на томах 200+ стор. Видно у DevTools Console на планшеті адвоката.
  try {
    const inT = usage?.inputTokens;
    const outT = usage?.outputTokens;
    const artifactsCount = artifacts.length;
    const totalPages = artifacts.reduce((s, a) => s + (a.pageCount || 0), 0);
    // eslint-disable-next-line no-console
    console.info(
      `[Triage] artifacts=${artifactsCount} pages=${totalPages} `
      + `input=${inT}t output=${outT}t model=${model}`
    );
  } catch { /* лог ізольований — не валить pipeline */ }

  const parsed = extractJson(typeof text === 'string' ? text : '');
  if (!parsed) {
    throw new Error('Triage повернув не-JSON: ' + String(text || '').slice(0, 200));
  }
  // usage прокидаємо наскрізь (TASK triage_diag_logging §3.1): triageStage
  // кладе input/output токени у triage_done — реальна вартість тріажу видима
  // у diag-лозі поряд з паспортом. Логіки нарізки не торкає.
  return { documents: parsed.documents || [], unusedPages: parsed.unusedPages || [], usage };
}
