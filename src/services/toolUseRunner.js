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

    // ── caseId protection ─────────────────────────────────────────────────
    // Якщо runner запущено з закріпленою справою (context.caseId) — агент
    // не може діяти з іншою справою. Це принципова ізоляція досьє.
    //
    //  • Модель пропустила caseId → ставимо контекстний.
    //  • Модель передала ТОЙ САМИЙ caseId → нічого не змінюємо.
    //  • Модель передала ІНШИЙ caseId → перезаписуємо на контекстний і
    //    додаємо помітку у tool_result, щоб модель побачила і не пробувала
    //    знову.
    let caseIdOverridden = false;
    let attemptedCaseId = null;
    if (context.caseId) {
      const incoming = params.caseId;
      if (incoming === undefined || incoming === null || incoming === '') {
        params.caseId = context.caseId;
      } else if (incoming !== context.caseId) {
        attemptedCaseId = incoming;
        params.caseId = context.caseId;
        caseIdOverridden = true;
      }
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
      // Помітка для моделі — вона має побачити це в tool_result і не
      // намагатись знову.
      if (caseIdOverridden) {
        resultPayload = {
          ...(typeof resultPayload === 'object' ? resultPayload : { result: resultPayload }),
          _caseIdOverridden: true,
          _note: `caseId перезаписано з '${attemptedCaseId}' на поточну справу '${context.caseId}'. Агент досьє може діяти лише в межах поточної справи.`
        };
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
// Дружні повідомлення для 401/мережа. Для 429 і 5xx — exponential backoff з
// jitter; для 429 додатково респектуємо retry-after header якщо Anthropic
// його повертає (у секундах). 429 не показується користувачу одразу — спершу
// спокійно чекаємо і пробуємо знову, бо при швидкому послідовному введенні
// частина токенів пер-хвилинного ліміту лишається в попередньому turn.
//
// maxRetries=5 і initialDelayMs=1500 обрано так, щоб повне виснаження було
// близько 1500 + 3000 + 6000 + 12000 + jitter ≈ 24с — тоді нічого не падає
// при 1-2 секундних "хвилинних спайках" на Tier 1.
//
// Викидає Error з полем .userMessage — UI може показати напряму.

export async function callAPIWithRetry(params, options = {}) {
  const {
    apiKey,
    apiUrl = 'https://api.anthropic.com/v1/messages',
    maxRetries = 5,
    initialDelayMs = 1500,
    maxDelayMs = 20000,
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
      await sleep(backoffDelay(attempt, initialDelayMs, maxDelayMs));
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
      // Для 429 — респект retry-after header (у секундах).
      let delayMs = backoffDelay(attempt, initialDelayMs, maxDelayMs);
      if (status === 429) {
        const ra = parseRetryAfter(response.headers);
        if (ra != null) delayMs = Math.min(Math.max(ra, 1000), maxDelayMs);
      }
      await sleep(delayMs);
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

// Exponential backoff з jitter (full jitter за рекомендацією AWS).
// attempt=0 → ~initialDelay, attempt=1 → ~2x, attempt=2 → ~4x, ...
// Jitter — щоб не синхронізувати retry між паралельними клієнтами.
function backoffDelay(attempt, initialMs, maxMs) {
  const exp = initialMs * Math.pow(2, attempt);
  const capped = Math.min(exp, maxMs);
  // Full jitter: випадково в [capped/2, capped].
  return Math.floor(capped / 2 + Math.random() * (capped / 2));
}

// Anthropic повертає Retry-After як ціле число секунд (або HTTP-date).
// Тут парсимо лише числовий формат — найчастіший випадок.
function parseRetryAfter(headers) {
  if (!headers || typeof headers.get !== 'function') return null;
  const raw = headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.floor(seconds * 1000);
  }
  // HTTP-date формат — fallback не реалізуємо, бо рідко.
  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
