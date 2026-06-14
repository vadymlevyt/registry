// ── callAgent — тонка парасоля над AI-транспортами (TASK B1 · борг #55 Частина А) ──
// Транспорти/резолвер/трекер мокаються на рівні модуля; logAiUsageViaSink
// лишається РЕАЛЬНИМ — ai_usage ловимо через переданий aiUsageSink (саме так
// доводимо однократність обліку §3, без подвоєння).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/modelResolver.js', () => ({
  resolveModel: vi.fn(),
}));
vi.mock('../../src/services/toolUseRunner.js', () => ({
  callAPIWithRetry: vi.fn(),
  callAPIStreaming: vi.fn(),
  runMultiTurnConversation: vi.fn(),
}));
vi.mock('../../src/services/activityTracker.js', () => ({
  report: vi.fn(),
}));

import { callAgent, AGENT_USAGE_LABELS } from '../../src/services/callAgent.js';
import { resolveModel } from '../../src/services/modelResolver.js';
import {
  callAPIWithRetry,
  callAPIStreaming,
  runMultiTurnConversation,
} from '../../src/services/toolUseRunner.js';
import * as activityTracker from '../../src/services/activityTracker.js';

const TEXT_RESPONSE = {
  content: [{ type: 'text', text: 'привіт' }],
  usage: { input_tokens: 12, output_tokens: 7 },
  stop_reason: 'end_turn',
};

beforeEach(() => {
  vi.resetAllMocks();
  // resetAllMocks прибирає impl — повертаємо детермінований резолв.
  resolveModel.mockImplementation((agentType) => `model-for-${agentType}`);
});

describe('callAgent', () => {
  // §9.1
  it('mode:text → callAPIWithRetry з резолвленою моделлю; повертає text+usage', async () => {
    callAPIWithRetry.mockResolvedValue(TEXT_RESPONSE);
    const res = await callAgent({
      agentType: 'qiParserDocument',
      mode: 'text',
      messages: [{ role: 'user', content: 'q' }],
      max_tokens: 16000,
      apiKey: 'k',
      aiUsageSink: vi.fn(),
    });

    expect(callAPIWithRetry).toHaveBeenCalledTimes(1);
    const [params, opts] = callAPIWithRetry.mock.calls[0];
    expect(params.model).toBe('model-for-qiParserDocument');
    expect(params.max_tokens).toBe(16000);
    expect(opts).toEqual({ apiKey: 'k' });

    expect(res.text).toBe('привіт');
    expect(res.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
    expect(res.model).toBe('model-for-qiParserDocument');
    expect(res.stop_reason).toBe('end_turn');
    expect(runMultiTurnConversation).not.toHaveBeenCalled();
  });

  // P2-фікс (#55): Anthropic може віддати 200 з error-тілом. Транспорт кидає лише
  // на non-2xx, тож цей м'який кейс ловиться централізовано в callAgent ДО обліку.
  it('mode:text → 200 з error-тілом кидає Error(message) і НЕ пише облік', async () => {
    callAPIWithRetry.mockResolvedValue({ error: { message: 'overloaded' } });
    const sink = vi.fn();
    await expect(callAgent({
      agentType: 'qiParserDocument',
      mode: 'text',
      messages: [{ role: 'user', content: 'q' }],
      apiKey: 'k',
      aiUsageSink: sink,
    })).rejects.toThrow('overloaded');
    // кидок ДО кроку обліку → ні ai_usage, ні activityTracker
    expect(sink).not.toHaveBeenCalled();
    expect(activityTracker.report).not.toHaveBeenCalled();
  });

  // та сама централізована перевірка діє і для mode:stream
  it('mode:stream → 200 з error-тілом кидає Error(message)', async () => {
    callAPIStreaming.mockResolvedValue({ error: { message: 'rate_limited' } });
    await expect(callAgent({
      agentType: 'qiParserDocument',
      mode: 'stream',
      messages: [{ role: 'user', content: 'q' }],
      apiKey: 'k',
      aiUsageSink: vi.fn(),
    })).rejects.toThrow('rate_limited');
  });

  // §9.2
  it('mode:toolUse → tool-use транспорт; повертає toolResult', async () => {
    runMultiTurnConversation.mockResolvedValue({
      finalText: 'готово',
      totalToolCalls: 1,
      turns: 1,
      truncated: false,
      errors: [],
      usage: { inputTokens: 5, outputTokens: 3 },
    });
    const res = await callAgent({
      agentType: 'dossierAgent',
      mode: 'toolUse',
      messages: [{ role: 'user', content: 'q' }],
      tools: [{ name: 't' }],
      apiKey: 'k',
      executeAction: vi.fn(),
      aiUsageSink: vi.fn(),
    });

    expect(runMultiTurnConversation).toHaveBeenCalledTimes(1);
    expect(callAPIWithRetry).not.toHaveBeenCalled();
    expect(res.text).toBe('готово');
    expect(res.toolResult).toBeTruthy();
    expect(res.toolResult.totalToolCalls).toBe(1);
    expect(res.usage).toEqual({ inputTokens: 5, outputTokens: 3 });
  });

  // §3 Варіант А — двигун НЕ отримує setAiUsage (внутрішній логер заглушений).
  it('mode:toolUse → context.setAiUsage НЕ передається у транспорт (§3 Варіант А)', async () => {
    runMultiTurnConversation.mockResolvedValue({
      finalText: 'ok', totalToolCalls: 0, turns: 1, truncated: false, errors: [],
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    await callAgent({
      agentType: 'qiParserDocument', mode: 'toolUse', messages: [], tools: [],
      apiKey: 'k', executeAction: vi.fn(), aiUsageSink: vi.fn(),
    });
    const arg = runMultiTurnConversation.mock.calls[0][0];
    expect(arg.context.setAiUsage).toBeUndefined();
  });

  // §9.3 — облік РІВНО один раз (доказ проти подвоєння §3).
  it('облік один раз (mode:text): sink ловить рівно один ai_usage', async () => {
    const sink = vi.fn();
    callAPIWithRetry.mockResolvedValue(TEXT_RESPONSE);
    await callAgent({
      agentType: 'qiParserDocument', mode: 'text', messages: [], apiKey: 'k', aiUsageSink: sink,
    });
    expect(sink).toHaveBeenCalledTimes(1);
    const entry = sink.mock.calls[0][0];
    // Мітка ai_usage — snake_case через AGENT_USAGE_LABELS (НЕ camelCase resolve-ключ).
    expect(entry.agentType).toBe('document_parser');
    expect(entry.totalTokens).toBe(19);
  });

  it('облік один раз (mode:toolUse): sink один (двигун не дублює без setAiUsage)', async () => {
    const sink = vi.fn();
    runMultiTurnConversation.mockResolvedValue({
      finalText: 'ok', totalToolCalls: 0, turns: 1, truncated: false, errors: [],
      usage: { inputTokens: 2, outputTokens: 2 },
    });
    await callAgent({
      agentType: 'qiParserDocument', mode: 'toolUse', messages: [], tools: [],
      apiKey: 'k', executeAction: vi.fn(), aiUsageSink: sink,
    });
    expect(sink).toHaveBeenCalledTimes(1);
  });

  // §9.4
  it('billAsUserAction:false → activityTracker.report НЕ викликається; ai_usage — так', async () => {
    const sink = vi.fn();
    callAPIWithRetry.mockResolvedValue(TEXT_RESPONSE);
    await callAgent({
      agentType: 'qiParserDocument', mode: 'text', messages: [], apiKey: 'k',
      aiUsageSink: sink, billAsUserAction: false,
    });
    expect(activityTracker.report).not.toHaveBeenCalled();
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('billAsUserAction default true → activityTracker.report викликається з агент-міткою', async () => {
    callAPIWithRetry.mockResolvedValue(TEXT_RESPONSE);
    await callAgent({
      agentType: 'qiParserDocument', mode: 'text', messages: [], apiKey: 'k',
      context: { operation: 'triage' }, aiUsageSink: vi.fn(),
    });
    expect(activityTracker.report).toHaveBeenCalledTimes(1);
    expect(activityTracker.report).toHaveBeenCalledWith(
      'agent_call',
      expect.objectContaining({
        metadata: expect.objectContaining({ agentType: 'document_parser', operation: 'triage' }),
      })
    );
  });

  // §9.5 — помилка транспорту проброшується; облік не виконується.
  it('помилка транспорту → проброшується наверх; облік не викликається', async () => {
    const sink = vi.fn();
    const boom = new Error('boom');
    boom.userMessage = 'дружньо';
    callAPIWithRetry.mockRejectedValue(boom);
    await expect(
      callAgent({ agentType: 'qiParserDocument', mode: 'text', messages: [], apiKey: 'k', aiUsageSink: sink })
    ).rejects.toThrow('boom');
    expect(sink).not.toHaveBeenCalled();
    expect(activityTracker.report).not.toHaveBeenCalled();
  });

  // §9.5 — падіння САМОГО обліку ізольоване try/catch (не валить виклик).
  it('падіння обліку (activityTracker кидає) НЕ валить виклик — результат повертається', async () => {
    activityTracker.report.mockImplementation(() => { throw new Error('billing fail'); });
    callAPIWithRetry.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn',
    });
    const res = await callAgent({
      agentType: 'qiParserDocument', mode: 'text', messages: [], apiKey: 'k', aiUsageSink: vi.fn(),
    });
    expect(res.text).toBe('ok');
  });

  // §9.6
  it('resolveModel викликано з переданим agentType (не hardcoded)', async () => {
    callAPIWithRetry.mockResolvedValue(TEXT_RESPONSE);
    await callAgent({ agentType: 'textCleaner', mode: 'text', messages: [], apiKey: 'k', aiUsageSink: vi.fn() });
    expect(resolveModel).toHaveBeenCalledWith('textCleaner');
  });

  // ── Два словники агентів (правило #11) ──────────────────────────────────────
  it('AGENT_USAGE_LABELS: qiParserDocument → document_parser (resolve-ключ ≠ лог-мітка)', () => {
    expect(AGENT_USAGE_LABELS.qiParserDocument).toBe('document_parser');
  });

  it('usageAgentType явний — перекриває дефолтний мапінг', async () => {
    const sink = vi.fn();
    callAPIWithRetry.mockResolvedValue(TEXT_RESPONSE);
    await callAgent({
      agentType: 'qiParserDocument', mode: 'text', messages: [], apiKey: 'k',
      usageAgentType: 'custom_label', aiUsageSink: sink,
    });
    expect(sink.mock.calls[0][0].agentType).toBe('custom_label');
  });

  it('невідомий agentType → usageAgentType fallback на сам agentType', async () => {
    const sink = vi.fn();
    callAPIWithRetry.mockResolvedValue(TEXT_RESPONSE);
    await callAgent({
      agentType: 'brandNewAgent', mode: 'text', messages: [], apiKey: 'k', aiUsageSink: sink,
    });
    expect(sink.mock.calls[0][0].agentType).toBe('brandNewAgent');
  });

  // ── Контрактні гарди ────────────────────────────────────────────────────────
  it('відсутній agentType → кидає', async () => {
    await expect(callAgent({ mode: 'text', messages: [], apiKey: 'k' })).rejects.toThrow(/agentType/);
  });

  it('невідомий mode → кидає', async () => {
    await expect(
      callAgent({ agentType: 'qiParserDocument', mode: 'нема', messages: [], apiKey: 'k' })
    ).rejects.toThrow(/mode/);
  });

  // mode:'stream' — делегує callAPIStreaming, прокидає onStreamDelta як onDelta.
  it('mode:stream → callAPIStreaming з onDelta', async () => {
    callAPIStreaming.mockResolvedValue({
      content: [{ type: 'text', text: 'стрім' }], usage: { input_tokens: 4, output_tokens: 2 }, stop_reason: 'end_turn',
    });
    const onStreamDelta = vi.fn();
    const res = await callAgent({
      agentType: 'textCleaner', mode: 'stream', messages: [], apiKey: 'k',
      onStreamDelta, aiUsageSink: vi.fn(),
    });
    expect(callAPIStreaming).toHaveBeenCalledTimes(1);
    const [, opts] = callAPIStreaming.mock.calls[0];
    expect(opts.apiKey).toBe('k');
    expect(opts.onDelta).toBe(onStreamDelta);
    expect(res.text).toBe('стрім');
    expect(res.usage).toEqual({ inputTokens: 4, outputTokens: 2 });
  });
});
