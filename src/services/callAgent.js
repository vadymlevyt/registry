// ── CALL AGENT — тонка парасоля над AI-транспортами (TASK B1 · борг #55 Частина А) ──
//
// ОДНА точка виклику AI, яка САМА робить дві речі, що раніше дублювалися в
// кожній AI-точці вручну (клас багів «забув інструментацію»):
//   1. резолвить модель через resolveModel(agentType) — ієрархія
//      user→tenant→system, НЕ hardcoded;
//   2. пише облік — ai_usage (токени, для оператора SaaS) + activityTracker
//      (час, для білінгу адвоката) — у try/catch, ніколи не валить сам виклик.
//
// Виклик делегується наявним транспортам toolUseRunner (текст / стрім /
// tool-use) — у транспортах НІЧОГО не переписуємо (planka Picatinny: парасоля
// — це новий шар поверх, не зміна існуючого).
//
// Сенс (ембріон з повним ДНК): будь-який НОВИЙ AI-виклик, написаний через
// callAgent, народжується з обліком автоматично — не з ручним, що потім
// переробляти.
//
// ── §3 ПОДВІЙНИЙ ОБЛІК — РІШЕННЯ: ВАРІАНТ А (одна точка обліку) ──────────────
// runMultiTurnConversation сам логує ai_usage на кожному турні, АЛЕ лише коли
// йому передано context.setAiUsage. Тому для шляху callAgent ми СВІДОМО НЕ
// передаємо setAiUsage у транспорт (toolUse-гілка нижче) — внутрішній логер
// двигуна заглушений, а ai_usage пишеться РІВНО ОДИН раз тут, за фінальним
// агрегованим usage. Це прибирає ризик подвоєння рахунку (правило #11 — одне
// джерело правди для обліку). Доведено tests/unit/callAgent.test.js (кейс 3).
//
// ── ДВА СЛОВНИКИ АГЕНТІВ (правило #11 — це КОРЕКТНІСТЬ, не напруга) ──────────
//   • agentType      — ключ резолву моделі, camelCase (SYSTEM_DEFAULTS у
//                      modelResolver: 'qiParserDocument', 'textCleaner', ...).
//   • usageAgentType — мітка у ai_usage[].agentType + activityTracker, snake_case
//                      (enum логів: 'document_parser', 'text_cleaner', ...).
// Це РІЗНІ сутності з різними просторами імен; зливати їх в один ключ ламає
// snake_case-enum логів і історичну агрегацію. Default usageAgentType береться
// з AGENT_USAGE_LABELS (мапінг camelCase→snake_case); невідомий ключ → fallback
// на сам agentType (тоді caller має передати usageAgentType явно).

import { resolveModel } from './modelResolver.js';
import { callAPIWithRetry, callAPIStreaming, runMultiTurnConversation } from './toolUseRunner.js';
import { logAiUsageViaSink } from './aiUsageService.js';
import * as activityTracker from './activityTracker.js';
import { categoryForCase } from './moduleNames.js';

// Реєстр відповідності resolve-ключ (camelCase) → ai_usage-мітка (snake_case).
// Кожен запис віддзеркалює РЕАЛЬНУ мітку, що вже пишеться в коді сьогодні —
// це не спекуляція, а фіксація наявних двох словників. Невідомий ключ →
// fallback на сам agentType (див. resolveUsageAgentType).
export const AGENT_USAGE_LABELS = Object.freeze({
  qiParserDocument: 'document_parser',      // Triage, analyzeViaToolUse
  documentParserVision: 'document_parser',  // claudeVision (OCR-fallback)
  metadataExtractor: 'metadata_extractor',  // claudeVision (режим без OCR)
  imageSorter: 'image_sorter',              // sortImageDocument
  imageDocumentGrouper: 'image_document_grouper',
  caseContextGenerator: 'case_context_generator',
  textCleaner: 'text_cleaner',              // cleanTextService
});

// usageAgentType за замовчуванням: явне значення → мапінг → сам agentType.
function resolveUsageAgentType(agentType, explicit) {
  if (explicit) return explicit;
  return AGENT_USAGE_LABELS[agentType] || agentType;
}

/**
 * Єдина точка виклику AI з авто-резолвом моделі і авто-обліком.
 *
 * @param {object}   args
 * @param {string}   args.agentType        camelCase resolve-ключ (обов'язково).
 * @param {'text'|'stream'|'toolUse'} [args.mode='text']  транспорт (лише «як кликати»).
 * @param {string}   [args.system]         системний промпт.
 * @param {Array}    [args.messages]       масив повідомлень (формат Anthropic).
 * @param {Array}    [args.tools]          tool definitions (для mode:'toolUse').
 * @param {number}   [args.max_tokens]     дозвіл на вивід (не вимога).
 * @param {object}   [args.context]        { caseId, module, operation } — для логів.
 * @param {string}   args.apiKey           API-ключ (як передається транспортам).
 * @param {Function} [args.onStreamDelta]  колбек дельт (для mode:'stream').
 * @param {Function} [args.aiUsageSink]    куди писати ai_usage (logAiUsageViaSink).
 * @param {boolean}  [args.billAsUserAction=true]  чи писати activityTracker (час
 *                   адвоката). false для автопродовження (DP-фон). Лише про
 *                   білінг — НЕ змішувати з mode (правило #11).
 * @param {string}   [args.usageAgentType] snake_case мітка ai_usage; default —
 *                   мапінг від agentType (AGENT_USAGE_LABELS).
 * @param {Function} [args.executeAction]  виконавець дій (лише mode:'toolUse').
 * @param {number}   [args.maxTurns]       захист циклу (лише mode:'toolUse').
 * @returns {Promise<{text?:string, toolResult?:object, usage:{inputTokens:number, outputTokens:number}, model:string, stop_reason:(string|null)}>}
 */
export async function callAgent({
  agentType,
  mode = 'text',
  system,
  messages,
  tools,
  max_tokens,
  context = {},
  apiKey,
  onStreamDelta,
  aiUsageSink,
  billAsUserAction = true,
  usageAgentType,
  executeAction,
  maxTurns,
} = {}) {
  if (!agentType) throw new Error('callAgent: agentType є обов\'язковим');

  // ── КРОК 1: резолв моделі ТУТ, не в caller'а (ієрархія user→tenant→system) ──
  const model = resolveModel(agentType);

  // ── КРОК 2: делегувати транспорту за mode ──────────────────────────────────
  let text;
  let toolResult;
  let inputTokens;
  let outputTokens;
  let stop_reason = null;

  if (mode === 'text') {
    const data = await callAPIWithRetry(
      { model, max_tokens, system, messages, tools },
      { apiKey }
    );
    text = extractText(data);
    // Сирий usage транспорту (може бути undefined якщо API не повернув usage) —
    // forward без примусового 0, щоб діагностика caller'ів бачила точно те, що
    // повернув API. Нормалізацію до числа робить buildUsageEntry при логуванні.
    inputTokens = data?.usage?.input_tokens;
    outputTokens = data?.usage?.output_tokens;
    stop_reason = data?.stop_reason ?? null;
  } else if (mode === 'stream') {
    const data = await callAPIStreaming(
      { model, max_tokens, system, messages },
      { apiKey, onDelta: onStreamDelta }
    );
    text = extractText(data);
    inputTokens = data?.usage?.input_tokens;
    outputTokens = data?.usage?.output_tokens;
    stop_reason = data?.stop_reason ?? null;
  } else if (mode === 'toolUse') {
    // §3 Варіант А: setAiUsage СВІДОМО не передаємо у context → внутрішній
    // логер двигуна заглушений; ai_usage пише лише ця парасоля (нижче).
    const result = await runMultiTurnConversation({
      callAnthropicAPI: async ({ messages: m, tools: t, systemPrompt }) =>
        callAPIWithRetry(
          { model, max_tokens, system: systemPrompt, messages: m, tools: t },
          { apiKey }
        ),
      initialMessages: messages,
      tools,
      systemPrompt: system,
      context: {
        agentId: agentType,
        executeAction,
        caseId: context.caseId ?? null,
        model,
        module: context.module ?? null,
        operation: context.operation ?? 'tool_use',
        // setAiUsage НЕ передаємо — див. §3 Варіант А.
      },
      ...(Number.isFinite(maxTurns) ? { maxTurns } : {}),
    });
    text = result.finalText;
    toolResult = result;
    inputTokens = result?.usage?.inputTokens;
    outputTokens = result?.usage?.outputTokens;
    stop_reason = result?.truncated ? 'max_turns' : 'end_turn';
  } else {
    throw new Error(`callAgent: невідомий mode '${mode}'`);
  }

  // ── КРОК 3: облік РІВНО ОДИН раз, у try/catch (ніколи не валить виклик) ──────
  try {
    const logLabel = resolveUsageAgentType(agentType, usageAgentType);
    logAiUsageViaSink(
      {
        agentType: logLabel,
        model,
        inputTokens,
        outputTokens,
        context: {
          caseId: context.caseId ?? null,
          module: context.module ?? null,
          operation: context.operation ?? 'other',
        },
      },
      aiUsageSink
    );
    if (billAsUserAction) {
      activityTracker.report('agent_call', {
        caseId: context.caseId ?? null,
        module: context.module ?? null,
        category: categoryForCase(context.caseId ?? null),
        metadata: { agentType: logLabel, operation: context.operation ?? 'other' },
      });
    }
  } catch (e) {
    // Облік ізольований — падіння білінгу не валить AI-виклик (§3, §7).
    console.warn('[callAgent] облік не вдався (ізольовано):', e?.message || e);
  }

  return {
    text,
    toolResult,
    usage: { inputTokens, outputTokens },
    model,
    stop_reason,
  };
}

// Склеїти text-блоки з нативної Anthropic-відповіді (content[].type==='text').
// Той самий формат, що повертають усі три транспорти toolUseRunner.
function extractText(apiResponse) {
  if (!apiResponse || !Array.isArray(apiResponse.content)) return '';
  return apiResponse.content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim();
}
