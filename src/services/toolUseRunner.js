// ── TOOL USE RUNNER ──────────────────────────────────────────────────────────
// Універсальний раннер для нативного Anthropic Tool Use циклу.
//
// Архітектура multi-turn:
//
//   1. Викликати API з messages + tools
//   2. Якщо response.stop_reason === 'tool_use':
//        a. Витягти tool_use блоки з content
//        b. Виконати кожен через executeAction
//        c. Повернути tool_result блоки наступним user-повідомленням
//        d. Goto 1
//      Інакше — повернути фінальний текст
//
//   maxTurns обмежує цикл (захист від залипання моделі).
//
// Принципи:
//   • Помилки одного tool НЕ зупиняють інші у тому ж турні.
//   • Тех-помилки (виняток у handler) повертаються моделі через is_error
//     у tool_result — модель може спробувати інше рішення.
//   • ai_usage пишеться на КОЖНОМУ турні (не лише в кінці) — точніший CRM-зріз.
//   • caseId з context передається у params якщо модель пропустила (graceful
//     fallback, не нав'язування — модель завжди може передати свій).
//
// Контракт callAnthropicAPI:
//   async ({ messages, tools, systemPrompt }) => apiResponse
//   apiResponse — нативний Anthropic API JSON.
//
// Контракт executeAction:
//   async (agentId, actionName, params) => { success, error?, ...result }

import { logAiUsage } from './aiUsageService.js';
import { MODULES } from './moduleNames.js';

const DEFAULT_MAX_TURNS = 10;

// ── Helpers ──────────────────────────────────────────────────────────────────

// Витягти tool_use блоки з API response.content[].
function extractToolUseBlocks(apiResponse) {
  if (!apiResponse || !Array.isArray(apiResponse.content)) return [];
  return apiResponse.content.filter(b => b && b.type === 'tool_use');
}

// Витягти текст з API response (text-блоки склеюються через \n).
function extractFinalText(apiResponse) {
  if (!apiResponse || !Array.isArray(apiResponse.content)) return '';
  return apiResponse.content
    .filter(b => b && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('\n')
    .trim();
}

// Чи відповідь моделі містить tool_use і модель чекає від нас tool_result.
function hasToolUse(apiResponse) {
  if (!apiResponse) return false;
  if (apiResponse.stop_reason === 'tool_use') return true;
  return extractToolUseBlocks(apiResponse).length > 0;
}

// Сформатувати tool_result content для повернення моделі.
// Anthropic очікує string або content blocks. Використовуємо JSON-серіалізацію
// для повноти інформації — модель розпарсить.
function formatToolResultContent(value) {
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ── runToolUse — обробити один API turn ──────────────────────────────────────

// Виконує tool_use блоки з відповіді моделі. Повертає масив tool_result
// блоків готових для наступного user-повідомлення, плюс метрики.
//
// Параметри:
//   apiResponse   — повна відповідь Anthropic API (з content[]).
//   agentId       — для PERMISSIONS allowlist в executeAction.
//   executeAction — функція виконання дій (закриває caseId, userId, tenantId).
//   context       — { caseId, ... } — контекст для ін'єкції caseId якщо
//                   модель забула передати у params.
//
// Повертає:
//   {
//     toolResults: [{ type: 'tool_result', tool_use_id, content, is_error? }],
//     hasToolUse: boolean,
//     finalText: string,
//     errors: [{ toolName, toolUseId, error }],
//     toolCalls: number
//   }
export async function runToolUse({ apiResponse, agentId, executeAction, context = {} }) {
  const finalText = extractFinalText(apiResponse);
  const blocks = extractToolUseBlocks(apiResponse);
  const toolResults = [];
  const errors = [];

  if (blocks.length === 0) {
    return { toolResults, hasToolUse: false, finalText, errors, toolCalls: 0 };
  }

  for (const block of blocks) {
    const { id: toolUseId, name: toolName, input: rawInput } = block;
    const params = (rawInput && typeof rawInput === 'object') ? { ...rawInput } : {};

    // Auto-inject caseId якщо tool його очікує а модель не передала.
    // Робимо це лише якщо params.caseId явно не задано — щоб модель могла
    // явно передати інший caseId якщо треба.
    if (context.caseId && params.caseId === undefined) {
      params.caseId = context.caseId;
    }

    let resultPayload;
    let isError = false;
    try {
      const result = await executeAction(agentId, toolName, params);
      if (result && result.success === false) {
        // Семантична помилка (валідація / permissions / not found). Повертаємо
        // моделі щоб вона могла спробувати інакше.
        resultPayload = { success: false, error: result.error || 'unknown error', ...result };
        isError = true;
        errors.push({ toolName, toolUseId, error: result.error || 'unknown' });
      } else {
        resultPayload = result || { success: true };
      }
    } catch (err) {
      // Тех-помилка (виняток у handler). Логуємо і повертаємо моделі.
      console.error(`[toolUseRunner] Tool '${toolName}' threw exception:`, err);
      resultPayload = { success: false, error: err?.message || String(err) };
      isError = true;
      errors.push({ toolName, toolUseId, error: err?.message || String(err) });
    }

    toolResults.push({
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: formatToolResultContent(resultPayload),
      ...(isError ? { is_error: true } : {})
    });
  }

  return {
    toolResults,
    hasToolUse: true,
    finalText,
    errors,
    toolCalls: blocks.length
  };
}

// ── runMultiTurnConversation — повний цикл ──────────────────────────────────

// Параметри:
//   callAnthropicAPI — async ({ messages, tools, systemPrompt }) => apiResponse
//   initialMessages  — [{ role, content }, ...] (історія + поточний user-msg)
//   tools            — масив tool definitions
//   systemPrompt     — системний промпт агента
//   context:
//     agentId        — 'dossier_agent' тощо
//     userId, tenantId
//     executeAction  — функція виконання дій
//     caseId         — auto-inject у params (опційно)
//     model          — назва моделі для ai_usage
//     setAiUsage     — React setter для ai_usage[] (опційно — без нього не логуємо)
//   maxTurns         — захист від залипання, default 10
//
// Повертає:
//   {
//     finalText: string,         // текст від моделі останнього турну
//     totalToolCalls: number,    // сума по всіх турнах
//     turns: number,             // скільки турнів виконалось
//     truncated: boolean,        // true якщо досягли maxTurns без фінального тексту
//     errors: [...],             // усі помилки tools
//     usage: { inputTokens, outputTokens, costUsd } // сума по турнам
//   }
export async function runMultiTurnConversation({
  callAnthropicAPI,
  initialMessages,
  tools,
  systemPrompt,
  context = {},
  maxTurns = DEFAULT_MAX_TURNS
}) {
  if (typeof callAnthropicAPI !== 'function') {
    throw new Error('runMultiTurnConversation: callAnthropicAPI is required');
  }
  if (!Array.isArray(initialMessages)) {
    throw new Error('runMultiTurnConversation: initialMessages must be an array');
  }

  const messages = [...initialMessages];
  const allErrors = [];
  let totalToolCalls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let lastFinalText = '';
  let turns = 0;
  let truncated = false;

  for (let turn = 0; turn < maxTurns; turn++) {
    turns = turn + 1;

    // 1. Виклик API
    const apiResponse = await callAnthropicAPI({
      messages,
      tools,
      systemPrompt
    });

    // 2. Логування ai_usage за поточний турн (якщо є setter)
    const usage = apiResponse?.usage || {};
    const inT = Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0;
    const outT = Number.isFinite(usage.output_tokens) ? usage.output_tokens : 0;
    totalInputTokens += inT;
    totalOutputTokens += outT;

    if (context.setAiUsage && (inT || outT)) {
      try {
        logAiUsage({
          agentType: context.agentId || 'unknown',
          model: context.model || apiResponse?.model || 'unknown',
          inputTokens: inT,
          outputTokens: outT,
          context: {
            caseId: context.caseId || null,
            module: context.module || MODULES.CASE_DOSSIER,
            operation: context.operation || 'tool_use',
          },
        }, context.setAiUsage);
      } catch (e) {
        console.warn('[toolUseRunner] ai_usage log failed:', e?.message || e);
      }
    }

    // 3. Обробити response — або це фінальний текст, або tool_use
    const turnResult = await runToolUse({
      apiResponse,
      agentId: context.agentId,
      executeAction: context.executeAction,
      context
    });

    totalToolCalls += turnResult.toolCalls;
    if (turnResult.errors.length > 0) {
      allErrors.push(...turnResult.errors);
    }
    lastFinalText = turnResult.finalText;

    if (!turnResult.hasToolUse) {
      // Фінальний текст — модель завершила цикл.
      return {
        finalText: lastFinalText,
        totalToolCalls,
        turns,
        truncated: false,
        errors: allErrors,
        usage: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
        }
      };
    }

    // 4. Додати assistant-повідомлення (з tool_use) і user-повідомлення з tool_results
    // у messages для наступного турну. Anthropic потребує повний content масив
    // assistant-повідомлення (а не лише текст) — інакше tool_use_id "висить".
    messages.push({
      role: 'assistant',
      content: apiResponse.content
    });
    messages.push({
      role: 'user',
      content: turnResult.toolResults
    });
  }

  // Досягли maxTurns без фінального тексту — модель залипла.
  truncated = true;
  console.warn(`[toolUseRunner] maxTurns=${maxTurns} reached without final text`);
  return {
    finalText: lastFinalText || '⚠ Агент не зміг завершити дію після кількох спроб. Спробуйте сформулювати інакше.',
    totalToolCalls,
    turns,
    truncated,
    errors: allErrors,
    usage: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    }
  };
}

// ── callAPIWithRetry — допоміжна обгортка з retry ───────────────────────────
//
// Exponential backoff для 429 і 5xx. Дружні повідомлення для 401/мережа.
// Викидає Error з полем .userMessage — UI може показати його напряму.

export async function callAPIWithRetry(params, options = {}) {
  const {
    apiKey,
    apiUrl = 'https://api.anthropic.com/v1/messages',
    maxRetries = 3,
    initialDelayMs = 1000,
  } = options;

  if (!apiKey) {
    const e = new Error('Немає API ключа');
    e.userMessage = 'Перевірте API ключ Claude в налаштуваннях.';
    throw e;
  }

  let lastError = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let response;
    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(params)
      });
    } catch (networkErr) {
      // Мережа — fetch кинув. Транзитивна помилка, retry.
      lastError = networkErr;
      console.warn(`[callAPIWithRetry] network error attempt ${attempt + 1}/${maxRetries}:`, networkErr?.message);
      if (attempt === maxRetries - 1) {
        const e = new Error('Network error: ' + (networkErr?.message || ''));
        e.userMessage = 'Не вдалось зв\'язатись з агентом. Перевірте інтернет і спробуйте ще раз.';
        e.cause = networkErr;
        throw e;
      }
      await sleep(initialDelayMs * Math.pow(2, attempt));
      continue;
    }

    if (response.ok) {
      return await response.json();
    }

    // Non-2xx — інтерпретуємо.
    const status = response.status;
    let errBody = '';
    try { errBody = await response.text(); } catch {}

    if (status === 401 || status === 403) {
      const e = new Error(`Auth error ${status}: ${errBody.slice(0, 200)}`);
      e.userMessage = 'Перевірте API ключ Claude в налаштуваннях.';
      e.status = status;
      throw e; // не retry — auth не виправиться чеканням
    }

    if (status === 400) {
      const e = new Error(`Bad request ${status}: ${errBody.slice(0, 300)}`);
      e.userMessage = 'Агент отримав некоректні дані. Спробуйте сформулювати запит інакше.';
      e.status = status;
      throw e; // не retry — детермінована помилка
    }

    if (status === 429 || status >= 500) {
      lastError = new Error(`HTTP ${status}: ${errBody.slice(0, 200)}`);
      lastError.status = status;
      console.warn(`[callAPIWithRetry] retryable status ${status} attempt ${attempt + 1}/${maxRetries}`);
      if (attempt === maxRetries - 1) {
        const e = new Error(lastError.message);
        e.status = status;
        e.userMessage = status === 429
          ? 'Забагато запитів за короткий час. Спробуйте через хвилину.'
          : 'Сервіс агента тимчасово недоступний. Спробуйте через хвилину.';
        throw e;
      }
      await sleep(initialDelayMs * Math.pow(2, attempt));
      continue;
    }

    // Інші коди — не retry-able.
    const e = new Error(`HTTP ${status}: ${errBody.slice(0, 200)}`);
    e.status = status;
    e.userMessage = `Помилка сервісу (${status}). Спробуйте ще раз.`;
    throw e;
  }

  // Сюди не повинно дійти, але про всяк випадок.
  if (lastError) throw lastError;
  throw new Error('callAPIWithRetry: unexpected end');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
