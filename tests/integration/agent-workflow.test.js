// Інтеграційний тест workflow агента досьє (Tool Use):
//   адвокат пише запит → mock API повертає tool_use → runner викликає
//   executeAction → state оновлено → фінальний текст від моделі.
//
// Покриває end-to-end логіку TASK 3 + TASK 3 patch (caseId protection).
import { describe, it, expect, beforeEach } from 'vitest';
import { runMultiTurnConversation } from '../../src/services/toolUseRunner.js';
import { createHarness } from './_actionsHarness.js';

function scriptedAPI(responses) {
  let i = 0;
  const calls = [];
  return Object.assign(
    async (args) => {
      calls.push(args);
      if (i >= responses.length) throw new Error(`out of responses at ${i + 1}`);
      const r = responses[i++];
      if (r instanceof Error) throw r;
      return r;
    },
    { calls }
  );
}

describe('dossier agent workflow', () => {
  let h;
  beforeEach(() => {
    h = createHarness({
      initialCases: [{
        id: 'case_001', name: 'Тестова',
        documents: [], hearings: [], proceedings: [{ id: 'proc_main', type: 'first', title: 'Основне', parentProcId: null }],
        deadlines: [], notes: [], pinnedNoteIds: [],
      }],
    });
  });

  it('Single tool call: add_hearing → засідання у state + фінальний текст', async () => {
    const api = scriptedAPI([
      {
        content: [
          { type: 'text', text: 'Додаю засідання...' },
          { type: 'tool_use', id: 't1', name: 'add_hearing', input: { caseId: 'case_001', date: '2026-05-15', time: '10:00' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 200, output_tokens: 30 },
      },
      {
        content: [{ type: 'text', text: 'Засідання додано на 15 травня.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 250, output_tokens: 15 },
      },
    ]);

    const result = await runMultiTurnConversation({
      callAnthropicAPI: api,
      initialMessages: [{ role: 'user', content: 'Додай засідання на 15 травня о 10' }],
      tools: [],
      systemPrompt: 'sys',
      context: { agentId: 'dossier_agent', executeAction: h.executeAction, caseId: 'case_001' },
    });

    expect(result.totalToolCalls).toBe(1);
    expect(result.turns).toBe(2);
    expect(result.finalText).toMatch(/15 травня/);
    expect(h.getCases()[0].hearings).toHaveLength(1);
    expect(h.getCases()[0].hearings[0].date).toBe('2026-05-15');
    expect(h.getCases()[0].hearings[0].time).toBe('10:00');
  });

  it('Multi-action: 3 tool_use в одному турі (засідання + дедлайн + нотатка)', async () => {
    const api = scriptedAPI([
      {
        content: [
          { type: 'tool_use', id: 'a', name: 'add_hearing', input: { caseId: 'case_001', date: '2026-05-15', time: '10:00' } },
          { type: 'tool_use', id: 'b', name: 'add_deadline', input: { caseId: 'case_001', name: 'Подати апеляцію', date: '2026-06-01' } },
          { type: 'tool_use', id: 'c', name: 'add_note', input: { caseId: 'case_001', text: 'Підготувати тактику', category: 'strategy' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 300, output_tokens: 80 },
      },
      {
        content: [{ type: 'text', text: 'Усі три дії виконано.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 400, output_tokens: 20 },
      },
    ]);

    const result = await runMultiTurnConversation({
      callAnthropicAPI: api,
      initialMessages: [{ role: 'user', content: 'кілька дій' }],
      tools: [],
      systemPrompt: 'sys',
      context: { agentId: 'dossier_agent', executeAction: h.executeAction, caseId: 'case_001' },
    });

    expect(result.totalToolCalls).toBe(3);
    expect(result.errors).toHaveLength(0);
    const c = h.getCases()[0];
    expect(c.hearings).toHaveLength(1);
    expect(c.deadlines).toHaveLength(1);
    expect(c.notes).toHaveLength(1);
  });

  it('caseId protection: модель передає інший caseId → перезаписано на context.caseId', async () => {
    const api = scriptedAPI([
      {
        content: [{ type: 'tool_use', id: 't', name: 'add_hearing', input: { caseId: 'WRONG_CASE_ID', date: '2026-05-15', time: '10:00' } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 20 },
      },
      {
        content: [{ type: 'text', text: 'Додано (caseId був неправильний — виправлено).' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 130, output_tokens: 15 },
      },
    ]);

    const result = await runMultiTurnConversation({
      callAnthropicAPI: api,
      initialMessages: [{ role: 'user', content: 'x' }],
      tools: [],
      systemPrompt: 'sys',
      context: { agentId: 'dossier_agent', executeAction: h.executeAction, caseId: 'case_001' },
    });

    expect(result.totalToolCalls).toBe(1);
    // Засідання НЕ потрапило в WRONG_CASE_ID (його взагалі немає в harness).
    expect(h.getCases()[0].hearings).toHaveLength(1);
    expect(h.getCases()[0].id).toBe('case_001');
    // tool_result у 2-му виклику API має містити помітку про перезапис
    const secondMessages = api.calls[1].messages;
    const toolResult = secondMessages[secondMessages.length - 1].content[0];
    expect(/перезаписано|поточну/.test(toolResult.content)).toBe(true);
  });

  it('Edge A: tool падає → модель отримує is_error → адаптується', async () => {
    const api = scriptedAPI([
      {
        content: [{ type: 'tool_use', id: 't1', name: 'add_hearing', input: { caseId: 'case_001', date: '2026-05-15' } }], // без time → fails
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 20 },
      },
      {
        content: [{ type: 'text', text: 'Не вдалось — забув час. Який саме?' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 130, output_tokens: 15 },
      },
    ]);

    const result = await runMultiTurnConversation({
      callAnthropicAPI: api,
      initialMessages: [{ role: 'user', content: 'засідання на 15 травня' }],
      tools: [],
      systemPrompt: 'sys',
      context: { agentId: 'dossier_agent', executeAction: h.executeAction, caseId: 'case_001' },
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/Час/);
    expect(result.finalText).toMatch(/забув|час/i);
    expect(h.getCases()[0].hearings).toHaveLength(0); // засідання не додалось
    // tool_result з is_error пішов моделі у 2-му виклику
    const secondMessages = api.calls[1].messages;
    const toolResult = secondMessages[secondMessages.length - 1].content[0];
    expect(toolResult.is_error).toBe(true);
  });

  it('PERMISSIONS блокування: dossier_agent не може add_documents (зона DP)', async () => {
    const api = scriptedAPI([
      {
        content: [{ type: 'tool_use', id: 't', name: 'add_documents', input: { caseId: 'case_001', documents: [] } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 20 },
      },
      {
        content: [{ type: 'text', text: 'Не маю дозволу — це зона DP.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 130, output_tokens: 15 },
      },
    ]);

    const result = await runMultiTurnConversation({
      callAnthropicAPI: api,
      initialMessages: [{ role: 'user', content: 'батч' }],
      tools: [],
      systemPrompt: 'sys',
      context: { agentId: 'dossier_agent', executeAction: h.executeAction, caseId: 'case_001' },
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/Немає повноважень/);
  });
});
