// TASK 3.7 — multi-turn conversation tests.
// Запуск: node scripts/sanity_test_task3_multiturn.mjs
//
// Покриваємо:
//   • 2 турна послідовно (tool → tool → final text)
//   • maxTurns обмеження (моделює залипання моделі — повертає truncated)
//   • помилка в середині multi-turn (network error у 2-му турні)
//   • успішне завершення з 3 tool calls
//   • ai_usage логування на кожному турні
//   • messages коректно нарощуються (assistant.content + user.tool_result)
//   • Edge case A: tool падає у середині multi-turn — модель адаптується
//   • Edge case D: модель залипає у циклі

import { runMultiTurnConversation } from '../src/services/toolUseRunner.js';

let pass = 0, fail = 0;
function assert(cond, label, extra = '') {
  if (cond) { console.log(`✓ ${label}`); pass++; }
  else      { console.log(`✗ ${label}  ${extra}`); fail++; }
}

console.log('━━━ TASK 3.2 multi-turn ━━━\n');

// ── Helper: scripted API responses ──
// Кожен виклик API повертає наступну відповідь зі сценарію.
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

function exec(behaviorMap = {}) {
  const calls = [];
  const fn = async (agentId, action, params) => {
    calls.push({ agentId, action, params });
    if (typeof behaviorMap[action] === 'function') {
      return await behaviorMap[action](params);
    }
    return { success: true };
  };
  fn.calls = calls;
  return fn;
}

// ── Test 1: 2 турна (tool → final text) ──
{
  const api = scriptedAPI([
    {
      content: [
        { type: 'tool_use', id: 'tu_1', name: 'add_hearing', input: { caseId: 'case_x', date: '2026-05-15', time: '10:00' } }
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 20 }
    },
    {
      content: [{ type: 'text', text: 'Засідання додано на 15 травня.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 150, output_tokens: 15 }
    }
  ]);
  const ex = exec({ add_hearing: async () => ({ success: true, hearingId: 'hrg_1' }) });

  const r = await runMultiTurnConversation({
    callAnthropicAPI: api,
    initialMessages: [{ role: 'user', content: 'Додай засідання на 15 травня о 10' }],
    tools: [],
    systemPrompt: 'sys',
    context: { agentId: 'dossier_agent', executeAction: ex, caseId: 'case_x' }
  });

  assert(r.turns === 2, 'Test 1: turns=2');
  assert(r.totalToolCalls === 1, 'Test 1: totalToolCalls=1');
  assert(r.finalText.includes('15 травня'), 'Test 1: finalText містить дату');
  assert(r.truncated === false, 'Test 1: truncated=false');
  assert(r.usage.inputTokens === 250, 'Test 1: усі inputTokens сумовано');
  assert(r.usage.outputTokens === 35, 'Test 1: усі outputTokens сумовано');
  assert(api.calls.length === 2, 'Test 1: API викликався 2 рази');
  // Перевірити що другий виклик містить assistant content + tool_result
  const secondCallMessages = api.calls[1].messages;
  assert(secondCallMessages.length === 3, 'Test 1: 2-й виклик має 3 messages (user + assistant + user_tool_result)');
  assert(secondCallMessages[1].role === 'assistant', 'Test 1: 2-й msg = assistant');
  assert(secondCallMessages[2].role === 'user' && Array.isArray(secondCallMessages[2].content) && secondCallMessages[2].content[0]?.type === 'tool_result', 'Test 1: 3-й msg = tool_result');
}

// ── Test 2: maxTurns обмеження (модель залипає) ──
{
  // Кожна відповідь — нова tool_use (модель ніяк не зупиняється).
  const stuckResponses = Array.from({ length: 15 }, (_, i) => ({
    content: [{ type: 'tool_use', id: `tu_${i}`, name: 'add_note', input: { text: `n${i}` } }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 5 }
  }));
  const api = scriptedAPI(stuckResponses);
  const ex = exec();

  const r = await runMultiTurnConversation({
    callAnthropicAPI: api,
    initialMessages: [{ role: 'user', content: 'крути' }],
    tools: [],
    systemPrompt: 'sys',
    context: { agentId: 'dossier_agent', executeAction: ex },
    maxTurns: 5
  });

  assert(r.turns === 5, 'Test 2: turns=5 (maxTurns)');
  assert(r.truncated === true, 'Test 2: truncated=true');
  assert(r.totalToolCalls === 5, 'Test 2: totalToolCalls=5');
  assert(api.calls.length === 5, 'Test 2: API викликався не більше ніж maxTurns');
  assert(r.finalText.includes('⚠'), 'Test 2: finalText містить попередження');
}

// ── Test 3: мережева помилка у 2-му турні ──
{
  const api = scriptedAPI([
    {
      content: [{ type: 'tool_use', id: 'tu_1', name: 'add_hearing', input: { date: '2026-05-15', time: '10:00' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 50, output_tokens: 10 }
    },
    new Error('network refused')
  ]);
  const ex = exec();

  let caught = null;
  try {
    await runMultiTurnConversation({
      callAnthropicAPI: api,
      initialMessages: [{ role: 'user', content: 'додай' }],
      tools: [],
      systemPrompt: 'sys',
      context: { agentId: 'dossier_agent', executeAction: ex }
    });
  } catch (e) {
    caught = e;
  }

  assert(caught !== null, 'Test 3: винятки прокидуються наверх для UI обробки');
  assert(/network/.test(caught.message), 'Test 3: повідомлення містить network');
  // Перший tool ВИКОНАВСЯ — це важливо. Дані з 1-го турна збережено.
  assert(ex.calls.length === 1, 'Test 3: перший tool виконався перед мережевою помилкою');
}

// ── Test 4: успішне завершення з 3 tool calls (один турн) ──
{
  const api = scriptedAPI([
    {
      content: [
        { type: 'tool_use', id: 't1', name: 'add_hearing', input: { date: '2026-05-15', time: '10:00' } },
        { type: 'tool_use', id: 't2', name: 'add_deadline', input: { name: 'апеляція', date: '2026-06-01' } },
        { type: 'tool_use', id: 't3', name: 'pin_note', input: { noteId: 'n1' } }
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 200, output_tokens: 30 }
    },
    {
      content: [{ type: 'text', text: 'Усі 3 дії виконано.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 250, output_tokens: 10 }
    }
  ]);
  const ex = exec();

  const r = await runMultiTurnConversation({
    callAnthropicAPI: api,
    initialMessages: [{ role: 'user', content: 'кілька дій' }],
    tools: [],
    systemPrompt: 'sys',
    context: { agentId: 'dossier_agent', executeAction: ex, caseId: 'case_x' }
  });

  assert(r.totalToolCalls === 3, 'Test 4: 3 паралельні tool_use в одному турні');
  assert(r.turns === 2, 'Test 4: 2 турна загалом');
  assert(r.finalText === 'Усі 3 дії виконано.', 'Test 4: фінальний текст');
}

// ── Test 5: ai_usage логування ──
{
  const usageEntries = [];
  const setAiUsage = (updater) => {
    if (typeof updater === 'function') {
      const next = updater([]);
      // Беремо лише новий запис.
      if (next.length > 0) usageEntries.push(next[next.length - 1]);
    }
  };

  const api = scriptedAPI([
    {
      content: [{ type: 'tool_use', id: 't1', name: 'add_note', input: { text: 'n' } }],
      stop_reason: 'tool_use',
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 100, output_tokens: 20 }
    },
    {
      content: [{ type: 'text', text: 'OK' }],
      stop_reason: 'end_turn',
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 120, output_tokens: 10 }
    }
  ]);
  const ex = exec();

  await runMultiTurnConversation({
    callAnthropicAPI: api,
    initialMessages: [{ role: 'user', content: 'ok' }],
    tools: [],
    systemPrompt: 'sys',
    context: {
      agentId: 'dossier_agent',
      executeAction: ex,
      model: 'claude-sonnet-4-20250514',
      setAiUsage,
      caseId: 'case_x'
    }
  });

  assert(usageEntries.length === 2, 'Test 5: 2 ai_usage записи (один на турн)');
  assert(usageEntries[0].agentType === 'dossier_agent', 'Test 5: agentType правильно');
  assert(usageEntries[0].inputTokens === 100, 'Test 5: inputTokens 1-го турна');
  assert(usageEntries[1].inputTokens === 120, 'Test 5: inputTokens 2-го турна');
  assert(typeof usageEntries[0].estimatedCostUSD === 'number', 'Test 5: estimatedCostUSD calculated');
  assert(usageEntries[0].context.caseId === 'case_x', 'Test 5: caseId у context');
  assert(usageEntries[0].context.operation === 'tool_use', 'Test 5: operation=tool_use за замовч.');
}

// ── Test 6: Edge case A — tool падає у середині multi-turn ──
// Перший турн: модель робить tool_use → executeAction повертає помилку.
// Другий турн: модель отримує is_error tool_result і реагує текстом.
{
  const api = scriptedAPI([
    {
      content: [{ type: 'tool_use', id: 't1', name: 'add_hearing', input: { caseId: 'case_x' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 50, output_tokens: 10 }
    },
    {
      content: [{ type: 'text', text: 'Не вдалось — забув час. Уточни?' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 80, output_tokens: 15 }
    }
  ]);
  const ex = exec({
    add_hearing: async (params) => {
      if (!params.time) return { success: false, error: "Час засідання обов'язковий" };
      return { success: true };
    }
  });

  const r = await runMultiTurnConversation({
    callAnthropicAPI: api,
    initialMessages: [{ role: 'user', content: 'засідання на 15 травня' }],
    tools: [],
    systemPrompt: 'sys',
    context: { agentId: 'dossier_agent', executeAction: ex, caseId: 'case_x' }
  });

  assert(r.errors.length === 1, 'Test 6 (Edge A): 1 tool error не обірвав цикл');
  assert(r.turns === 2, 'Test 6 (Edge A): модель змогла адаптуватись у 2-му турні');
  assert(r.finalText.includes('забув'), 'Test 6 (Edge A): фінальний текст від моделі');
  // Перевірити що в messages для 2-го виклику пішов is_error tool_result
  const secondCall = api.calls[1].messages;
  const toolResult = secondCall[secondCall.length - 1].content[0];
  assert(toolResult.is_error === true, 'Test 6: tool_result з is_error=true передано моделі');
}

console.log(`\n━━━ Результат multi-turn: ${pass} pass, ${fail} fail ━━━`);
process.exit(fail > 0 ? 1 : 0);
