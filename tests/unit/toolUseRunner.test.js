// Юніт-тести Tool Use runner: runToolUse + runMultiTurnConversation +
// callAPIWithRetry. Покриває edge cases A/B/C/D з TASK 3 і caseId protection
// з TASK 3 patch.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  runToolUse,
  runMultiTurnConversation,
  callAPIWithRetry,
} from '../../src/services/toolUseRunner.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeExecuteAction(behavior) {
  const calls = [];
  const fn = async (agentId, action, params) => {
    calls.push({ agentId, action, params });
    if (typeof behavior === 'function') return await behavior({ agentId, action, params });
    return { success: true };
  };
  fn.calls = calls;
  return fn;
}

function scriptedAPI(responses) {
  let i = 0;
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    if (i >= responses.length) {
      throw new Error(`scriptedAPI: no more responses (call ${i + 1}, scripted ${responses.length})`);
    }
    const r = responses[i++];
    if (r instanceof Error) throw r;
    return r;
  };
  fn.calls = calls;
  return fn;
}

// ── runToolUse ─────────────────────────────────────────────────────────────

describe('runToolUse', () => {
  describe('text-only response', () => {
    it('hasToolUse=false, finalText заповнено', async () => {
      const apiResponse = {
        content: [{ type: 'text', text: 'Привіт.' }],
        stop_reason: 'end_turn',
      };
      const exec = makeExecuteAction();
      const r = await runToolUse({ apiResponse, agentId: 'dossier_agent', executeAction: exec });
      expect(r.hasToolUse).toBe(false);
      expect(r.finalText).toBe('Привіт.');
      expect(r.toolCalls).toBe(0);
      expect(exec.calls).toHaveLength(0);
    });

    it('порожній content — hasToolUse=false, finalText=""', async () => {
      const r = await runToolUse({
        apiResponse: { content: [], stop_reason: 'end_turn' },
        agentId: 'dossier_agent',
        executeAction: makeExecuteAction(),
      });
      expect(r.hasToolUse).toBe(false);
      expect(r.finalText).toBe('');
    });
  });

  describe('single tool call', () => {
    it('успішний виклик додає 1 tool_result без is_error', async () => {
      const apiResponse = {
        content: [
          { type: 'text', text: 'Додаю.' },
          { type: 'tool_use', id: 'tu_1', name: 'add_hearing', input: { caseId: 'c1', date: '2026-05-15', time: '10:00' } },
        ],
        stop_reason: 'tool_use',
      };
      const exec = makeExecuteAction(async () => ({ success: true, hearingId: 'hrg_1' }));
      const r = await runToolUse({ apiResponse, agentId: 'dossier_agent', executeAction: exec });

      expect(r.hasToolUse).toBe(true);
      expect(r.toolCalls).toBe(1);
      expect(r.toolResults).toHaveLength(1);
      expect(r.toolResults[0].type).toBe('tool_result');
      expect(r.toolResults[0].tool_use_id).toBe('tu_1');
      expect(r.toolResults[0].is_error).toBeUndefined();
      expect(exec.calls[0].action).toBe('add_hearing');
    });
  });

  describe('multiple tool blocks', () => {
    it('усі tool_use блоки виконуються', async () => {
      const apiResponse = {
        content: [
          { type: 'tool_use', id: 'a', name: 'add_hearing', input: { date: '2026-05-15', time: '10:00' } },
          { type: 'tool_use', id: 'b', name: 'add_deadline', input: { name: 'апеляція', date: '2026-06-01' } },
          { type: 'tool_use', id: 'c', name: 'pin_note', input: { noteId: 'n1' } },
        ],
        stop_reason: 'tool_use',
      };
      const exec = makeExecuteAction();
      const r = await runToolUse({ apiResponse, agentId: 'dossier_agent', executeAction: exec, context: { caseId: 'c1' } });

      expect(r.toolCalls).toBe(3);
      expect(exec.calls).toHaveLength(3);
      expect(exec.calls.every(c => c.params.caseId === 'c1')).toBe(true);
    });
  });

  describe('tool error handling', () => {
    it('executeAction returns success:false → is_error=true в tool_result', async () => {
      const exec = makeExecuteAction(async () => ({ success: false, error: 'Дата обовʼязкова' }));
      const r = await runToolUse({
        apiResponse: { content: [{ type: 'tool_use', id: 'x', name: 'add_hearing', input: {} }], stop_reason: 'tool_use' },
        agentId: 'dossier_agent',
        executeAction: exec,
      });
      expect(r.toolResults[0].is_error).toBe(true);
      expect(r.errors).toHaveLength(1);
      expect(/Дата/.test(r.toolResults[0].content)).toBe(true);
    });

    it('handler кидає виняток → is_error=true, runner не падає', async () => {
      const exec = makeExecuteAction(async () => { throw new Error('boom'); });
      const r = await runToolUse({
        apiResponse: { content: [{ type: 'tool_use', id: 'x', name: 'add_hearing', input: {} }], stop_reason: 'tool_use' },
        agentId: 'dossier_agent',
        executeAction: exec,
      });
      expect(r.toolResults[0].is_error).toBe(true);
      expect(r.errors[0].error).toMatch(/boom/);
    });

    it('один падає → інші все одно виконуються (каскад не перериває)', async () => {
      const exec = makeExecuteAction(async ({ action }) =>
        action === 'add_deadline'
          ? { success: false, error: "name обов'язковий" }
          : { success: true }
      );
      const r = await runToolUse({
        apiResponse: {
          content: [
            { type: 'tool_use', id: 'a', name: 'add_hearing', input: { date: '2026-05-15', time: '10:00' } },
            { type: 'tool_use', id: 'b', name: 'add_deadline', input: {} },
            { type: 'tool_use', id: 'c', name: 'pin_note', input: { noteId: 'n1' } },
          ],
          stop_reason: 'tool_use',
        },
        agentId: 'dossier_agent',
        executeAction: exec,
      });
      expect(exec.calls).toHaveLength(3);
      expect(r.toolResults[0].is_error).toBeUndefined();
      expect(r.toolResults[1].is_error).toBe(true);
      expect(r.toolResults[2].is_error).toBeUndefined();
    });
  });

  describe('caseId protection (TASK 3 patch)', () => {
    it('модель пропустила caseId → injected з context', async () => {
      const exec = makeExecuteAction();
      await runToolUse({
        apiResponse: { content: [{ type: 'tool_use', id: 't', name: 'add_hearing', input: { date: '2026-05-15', time: '10:00' } }], stop_reason: 'tool_use' },
        agentId: 'dossier_agent',
        executeAction: exec,
        context: { caseId: 'case_current' },
      });
      expect(exec.calls[0].params.caseId).toBe('case_current');
    });

    it('модель передала ту саму caseId → нічого не змінюється', async () => {
      const exec = makeExecuteAction();
      const r = await runToolUse({
        apiResponse: { content: [{ type: 'tool_use', id: 't', name: 'add_hearing', input: { caseId: 'case_current', date: '2026-05-15', time: '10:00' } }], stop_reason: 'tool_use' },
        agentId: 'dossier_agent',
        executeAction: exec,
        context: { caseId: 'case_current' },
      });
      expect(exec.calls[0].params.caseId).toBe('case_current');
      expect(/перезаписано/.test(r.toolResults[0].content)).toBe(false);
    });

    it('модель передала ІНШИЙ caseId → перезапис на context.caseId + помітка', async () => {
      const exec = makeExecuteAction();
      const r = await runToolUse({
        apiResponse: { content: [{ type: 'tool_use', id: 't', name: 'add_hearing', input: { caseId: 'case_other', date: '2026-05-15', time: '10:00' } }], stop_reason: 'tool_use' },
        agentId: 'dossier_agent',
        executeAction: exec,
        context: { caseId: 'case_current' },
      });
      expect(exec.calls[0].params.caseId).toBe('case_current');
      expect(/case_other/.test(r.toolResults[0].content)).toBe(true);
      expect(/перезаписано|поточну/i.test(r.toolResults[0].content)).toBe(true);
    });

    it('без context.caseId — модель повна свобода', async () => {
      const exec = makeExecuteAction();
      await runToolUse({
        apiResponse: { content: [{ type: 'tool_use', id: 't', name: 'add_hearing', input: { caseId: 'free' } }], stop_reason: 'tool_use' },
        agentId: 'dossier_agent',
        executeAction: exec,
        context: {},
      });
      expect(exec.calls[0].params.caseId).toBe('free');
    });
  });
});

// ── runMultiTurnConversation ───────────────────────────────────────────────

describe('runMultiTurnConversation', () => {
  it('2 турна (tool → final text)', async () => {
    const api = scriptedAPI([
      { content: [{ type: 'tool_use', id: 't1', name: 'add_hearing', input: { date: '2026-05-15', time: '10:00' } }], stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 20 } },
      { content: [{ type: 'text', text: 'Готово.' }], stop_reason: 'end_turn', usage: { input_tokens: 150, output_tokens: 10 } },
    ]);
    const exec = makeExecuteAction(async () => ({ success: true, hearingId: 'h1' }));

    const r = await runMultiTurnConversation({
      callAnthropicAPI: api,
      initialMessages: [{ role: 'user', content: 'додай' }],
      tools: [],
      systemPrompt: 'sys',
      context: { agentId: 'dossier_agent', executeAction: exec, caseId: 'c1' },
    });

    expect(r.turns).toBe(2);
    expect(r.totalToolCalls).toBe(1);
    expect(r.finalText).toBe('Готово.');
    expect(r.truncated).toBe(false);
    expect(r.usage.inputTokens).toBe(250);
  });

  it('Edge D: maxTurns truncation', async () => {
    const stuck = Array.from({ length: 10 }, (_, i) => ({
      content: [{ type: 'tool_use', id: `t${i}`, name: 'add_note', input: { text: 'x' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 },
    }));
    const r = await runMultiTurnConversation({
      callAnthropicAPI: scriptedAPI(stuck),
      initialMessages: [{ role: 'user', content: 'крути' }],
      tools: [],
      systemPrompt: 'sys',
      context: { agentId: 'dossier_agent', executeAction: makeExecuteAction() },
      maxTurns: 5,
    });
    expect(r.turns).toBe(5);
    expect(r.truncated).toBe(true);
    expect(r.finalText).toMatch(/⚠/);
  });

  it('Edge B: мережева помилка прокидується', async () => {
    const api = scriptedAPI([
      { content: [{ type: 'tool_use', id: 't1', name: 'add_hearing', input: { date: '2026-05-15', time: '10:00' } }], stop_reason: 'tool_use', usage: { input_tokens: 50, output_tokens: 10 } },
      new Error('network refused'),
    ]);
    const exec = makeExecuteAction();
    await expect(runMultiTurnConversation({
      callAnthropicAPI: api,
      initialMessages: [{ role: 'user', content: 'x' }],
      tools: [],
      systemPrompt: 'sys',
      context: { agentId: 'dossier_agent', executeAction: exec },
    })).rejects.toThrow(/network/);
    // Перший tool ВИКОНАВСЯ перед мережевою помилкою.
    expect(exec.calls).toHaveLength(1);
  });

  it('ai_usage логується на кожному турні', async () => {
    const usageEntries = [];
    const setAiUsage = (updater) => {
      if (typeof updater === 'function') {
        const next = updater([]);
        if (next.length > 0) usageEntries.push(next[next.length - 1]);
      }
    };
    const api = scriptedAPI([
      { content: [{ type: 'tool_use', id: 't1', name: 'add_note', input: { text: 'n' } }], stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 20 } },
      { content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', usage: { input_tokens: 120, output_tokens: 10 } },
    ]);
    await runMultiTurnConversation({
      callAnthropicAPI: api,
      initialMessages: [{ role: 'user', content: 'x' }],
      tools: [],
      systemPrompt: 'sys',
      context: {
        agentId: 'dossier_agent',
        executeAction: makeExecuteAction(),
        model: 'claude-sonnet-4-20250514',
        caseId: 'c1',
        setAiUsage,
      },
    });
    expect(usageEntries).toHaveLength(2);
    expect(usageEntries[0].agentType).toBe('dossier_agent');
    expect(usageEntries[0].context.caseId).toBe('c1');
    expect(typeof usageEntries[0].estimatedCostUSD).toBe('number');
  });

  it('Edge A: tool падає у середині multi-turn → модель адаптується', async () => {
    const api = scriptedAPI([
      { content: [{ type: 'tool_use', id: 't1', name: 'add_hearing', input: { caseId: 'c1' } }], stop_reason: 'tool_use', usage: { input_tokens: 50, output_tokens: 10 } },
      { content: [{ type: 'text', text: 'Не вдалось — забув час.' }], stop_reason: 'end_turn', usage: { input_tokens: 80, output_tokens: 15 } },
    ]);
    const exec = makeExecuteAction(async ({ params }) =>
      params.time
        ? { success: true }
        : { success: false, error: "Час обов'язковий" }
    );
    const r = await runMultiTurnConversation({
      callAnthropicAPI: api,
      initialMessages: [{ role: 'user', content: 'засідання на 15 травня' }],
      tools: [],
      systemPrompt: 'sys',
      context: { agentId: 'dossier_agent', executeAction: exec, caseId: 'c1' },
    });
    expect(r.errors).toHaveLength(1);
    expect(r.turns).toBe(2);
    expect(r.finalText).toMatch(/забув/);
    // tool_result з is_error передається моделі у 2-му виклику
    const secondMessages = api.calls[1].messages;
    const toolResult = secondMessages[secondMessages.length - 1].content[0];
    expect(toolResult.is_error).toBe(true);
  });
});

// ── callAPIWithRetry ───────────────────────────────────────────────────────

describe('callAPIWithRetry', () => {
  beforeEach(() => {
    // Глобальний fetch мокаємо через vi.stubGlobal у кожному тесті індивідуально.
    vi.unstubAllGlobals();
  });

  it('success on first try → одне fetch, повертає JSON', async () => {
    const response = new Response(JSON.stringify({ id: 'msg_1', content: [] }), { status: 200 });
    const fetchMock = vi.fn(async () => response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await callAPIWithRetry({ model: 'x' }, { apiKey: 'k' });
    expect(result.id).toBe('msg_1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('відсутність apiKey → одразу userMessage без fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(callAPIWithRetry({}, { apiKey: '' })).rejects.toMatchObject({
      userMessage: expect.stringMatching(/API ключ/),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('401 → одразу userMessage без retry', async () => {
    const fetchMock = vi.fn(async () => new Response('unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callAPIWithRetry({}, { apiKey: 'bad' })).rejects.toMatchObject({
      status: 401,
      userMessage: expect.stringMatching(/API ключ/),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('400 → не retry-able', async () => {
    const fetchMock = vi.fn(async () => new Response('bad request', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callAPIWithRetry({}, { apiKey: 'k' })).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('429 з Retry-After header → респектує і retry', async () => {
    let attempt = 0;
    const fetchMock = vi.fn(async () => {
      attempt++;
      if (attempt === 1) {
        return new Response('rate limit', {
          status: 429,
          headers: { 'retry-after': '1' }, // 1 секунда
        });
      }
      return new Response(JSON.stringify({ id: 'msg' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callAPIWithRetry({}, { apiKey: 'k', maxRetries: 3, initialDelayMs: 50, maxDelayMs: 2000 });
    expect(result.id).toBe('msg');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('429 без Retry-After → exponential backoff і retry', async () => {
    let attempt = 0;
    const fetchMock = vi.fn(async () => {
      attempt++;
      if (attempt < 2) return new Response('rate limit', { status: 429 });
      return new Response(JSON.stringify({ id: 'msg' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callAPIWithRetry({}, { apiKey: 'k', maxRetries: 3, initialDelayMs: 10, maxDelayMs: 200 });
    expect(result.id).toBe('msg');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('max retries exceeded на 429 → userMessage', async () => {
    const fetchMock = vi.fn(async () => new Response('rate limit', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callAPIWithRetry({}, { apiKey: 'k', maxRetries: 2, initialDelayMs: 10, maxDelayMs: 50 })).rejects.toMatchObject({
      status: 429,
      userMessage: expect.stringMatching(/Забагато запитів/),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('500 → retry-able', async () => {
    let attempt = 0;
    const fetchMock = vi.fn(async () => {
      attempt++;
      if (attempt < 2) return new Response('server error', { status: 500 });
      return new Response(JSON.stringify({ id: 'm' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callAPIWithRetry({}, { apiKey: 'k', maxRetries: 3, initialDelayMs: 10, maxDelayMs: 50 });
    expect(result.id).toBe('m');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('мережа кидає → retry і потім userMessage', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetchMock);

    await expect(callAPIWithRetry({}, { apiKey: 'k', maxRetries: 2, initialDelayMs: 10, maxDelayMs: 50 })).rejects.toMatchObject({
      userMessage: expect.stringMatching(/інтернет|зв'язатись/),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // Ф1 (корінь зависання DP-4): висячий fetch (вкладка присипляється / флап
  // мережі) має зрізатись timeout-ом → AbortError → той самий network-catch →
  // retry → після maxRetries дружня помилка. БЕЗ цього весь pipeline вішався
  // назавжди (await fetch ніколи не резолвиться).
  it('висячий fetch → requestTimeoutMs abort → retry → userMessage (НЕ вічне зависання)', async () => {
    // fetch що сам ніколи не резолвиться, лише реджектиться по signal.abort().
    const fetchMock = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callAPIWithRetry({}, {
      apiKey: 'k', maxRetries: 2, initialDelayMs: 10, maxDelayMs: 50, requestTimeoutMs: 20,
    })).rejects.toMatchObject({
      userMessage: expect.stringMatching(/інтернет|зв'язатись/),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2); // abort трактується як транзитивна → retry
  });

  it('успіх до timeout → таймер знятий, без abort', async () => {
    const fetchMock = vi.fn((_url, { signal }) => {
      expect(signal).toBeInstanceOf(AbortSignal); // signal реально передається
      return Promise.resolve(new Response(JSON.stringify({ id: 'ok' }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callAPIWithRetry({}, { apiKey: 'k', requestTimeoutMs: 50 });
    expect(result.id).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
