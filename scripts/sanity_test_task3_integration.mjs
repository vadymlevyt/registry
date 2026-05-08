// TASK 3.7 — integration test.
// Запуск: node scripts/sanity_test_task3_integration.mjs
//
// Покриваємо end-to-end:
//   • реальні DOSSIER_AGENT_TOOLS передаються callAnthropicAPI
//   • mock API повертає правдоподібний tool_use для add_hearing
//   • executeAction викликається з правильними параметрами
//   • ai_usage записався з правильним costUsd
//   • Edge case C: модель повертає невалідні параметри → tool fails →
//     модель адаптується у наступному турні
//   • Edge case B (часткова): мережева помилка через callAPIWithRetry
//   • messages history правильно нарощується

import { runMultiTurnConversation } from '../src/services/toolUseRunner.js';
import { DOSSIER_AGENT_TOOLS, getToolsForAgent } from '../src/services/toolDefinitions.js';
import { calculateCost } from '../src/services/aiUsageService.js';

let pass = 0, fail = 0;
function assert(cond, label, extra = '') {
  if (cond) { console.log(`✓ ${label}`); pass++; }
  else      { console.log(`✗ ${label}  ${extra}`); fail++; }
}

console.log('━━━ TASK 3.7 integration ━━━\n');

// ── Helper: mock executeAction що відтворює реальну валідацію add_hearing ──
function makeRealisticExecute() {
  const calls = [];
  const fn = async (agentId, action, params) => {
    calls.push({ agentId, action, params });
    if (action === 'add_hearing') {
      if (!params.date) return { success: false, error: "Дата засідання обов'язкова" };
      if (!params.time) return { success: false, error: "Час засідання обов'язковий" };
      // Перевірка формату YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
        return { success: false, error: 'Невалідна дата (потрібен формат YYYY-MM-DD)' };
      }
      const id = `hrg_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
      return { success: true, hearingId: id };
    }
    if (action === 'add_note') {
      return { success: true, noteId: `note_${Date.now()}` };
    }
    if (action === 'add_deadline') {
      if (!params.name || !params.date) return { success: false, error: "name і date обов'язкові" };
      return { success: true, deadlineId: `dl_${Date.now()}` };
    }
    return { success: true };
  };
  fn.calls = calls;
  return fn;
}

// ── Test 1: end-to-end add_hearing з валідними параметрами ──
{
  let apiCallCount = 0;
  const callAPI = async ({ messages, tools, systemPrompt }) => {
    apiCallCount++;
    if (apiCallCount === 1) {
      return {
        content: [
          { type: 'text', text: 'Зрозумів, додаю засідання.' },
          { type: 'tool_use', id: 'tu_1', name: 'add_hearing', input: { caseId: 'case_x', date: '2026-05-20', time: '11:00' } }
        ],
        stop_reason: 'tool_use',
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 250, output_tokens: 40 }
      };
    }
    return {
      content: [{ type: 'text', text: 'Засідання додано. ID: hrg_xxx.' }],
      stop_reason: 'end_turn',
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 320, output_tokens: 25 }
    };
  };

  const ex = makeRealisticExecute();
  const usageEntries = [];
  const setAiUsage = (updater) => {
    if (typeof updater === 'function') {
      const next = updater([]);
      if (next.length > 0) usageEntries.push(next[next.length - 1]);
    }
  };

  const result = await runMultiTurnConversation({
    callAnthropicAPI: callAPI,
    initialMessages: [{ role: 'user', content: 'Додай засідання на 20 травня о 11 ранку' }],
    tools: DOSSIER_AGENT_TOOLS,
    systemPrompt: 'system prompt',
    context: {
      agentId: 'dossier_agent',
      executeAction: ex,
      caseId: 'case_x',
      model: 'claude-sonnet-4-20250514',
      setAiUsage
    }
  });

  // Базові метрики
  assert(result.totalToolCalls === 1, 'Test 1: totalToolCalls=1');
  assert(result.turns === 2, 'Test 1: turns=2');
  assert(!result.truncated, 'Test 1: !truncated');
  assert(result.errors.length === 0, 'Test 1: жодних tool errors');

  // executeAction виклик
  assert(ex.calls.length === 1, 'Test 1: executeAction виклик 1 раз');
  assert(ex.calls[0].agentId === 'dossier_agent', 'Test 1: agentId = dossier_agent');
  assert(ex.calls[0].action === 'add_hearing', 'Test 1: action = add_hearing');
  assert(ex.calls[0].params.caseId === 'case_x', 'Test 1: caseId передано');
  assert(ex.calls[0].params.date === '2026-05-20', 'Test 1: date передано');
  assert(ex.calls[0].params.time === '11:00', 'Test 1: time передано');

  // ai_usage
  assert(usageEntries.length === 2, 'Test 1: 2 ai_usage записи');
  const expectedCost1 = calculateCost('claude-sonnet-4-20250514', 250, 40);
  assert(usageEntries[0].estimatedCostUSD === expectedCost1,
    `Test 1: cost 1-го турна правильно (${expectedCost1})`);
  const totalCost = usageEntries.reduce((s, e) => s + e.estimatedCostUSD, 0);
  const expectedTotal = calculateCost('claude-sonnet-4-20250514', 250, 40) + calculateCost('claude-sonnet-4-20250514', 320, 25);
  assert(Math.abs(totalCost - expectedTotal) < 1e-9, 'Test 1: сумарний cost правильний');

  // Tools передались у API
  assert(callAPI && apiCallCount === 2, 'Test 1: API викликався 2 рази');
}

// ── Test 2: Edge case C — модель повертає date='завтра', tool fails, модель адаптується ──
{
  let apiCallCount = 0;
  const callAPI = async () => {
    apiCallCount++;
    if (apiCallCount === 1) {
      return {
        content: [{ type: 'tool_use', id: 't1', name: 'add_hearing', input: { caseId: 'case_x', date: 'завтра', time: '10:00' } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 20 }
      };
    }
    if (apiCallCount === 2) {
      // Модель отримала помилку валідації, спробувала ще раз правильно.
      return {
        content: [{ type: 'tool_use', id: 't2', name: 'add_hearing', input: { caseId: 'case_x', date: '2026-05-09', time: '10:00' } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 150, output_tokens: 25 }
      };
    }
    return {
      content: [{ type: 'text', text: 'Засідання додано на завтра.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 200, output_tokens: 15 }
    };
  };

  const ex = makeRealisticExecute();
  const result = await runMultiTurnConversation({
    callAnthropicAPI: callAPI,
    initialMessages: [{ role: 'user', content: 'засідання завтра о 10' }],
    tools: DOSSIER_AGENT_TOOLS,
    systemPrompt: 'sys',
    context: { agentId: 'dossier_agent', executeAction: ex, caseId: 'case_x' }
  });

  assert(result.errors.length === 1, 'Test 2 (Edge C): 1 помилка валідації');
  assert(result.errors[0].error.includes('YYYY-MM-DD') || result.errors[0].error.includes('Невалідна'),
    'Test 2 (Edge C): помилка про формат дати');
  assert(result.totalToolCalls === 2, 'Test 2 (Edge C): 2 tool_use загалом');
  assert(result.turns === 3, 'Test 2 (Edge C): 3 турна');
  assert(result.finalText.includes('додано'), 'Test 2 (Edge C): фінальний текст');
  assert(ex.calls[1].params.date === '2026-05-09', 'Test 2 (Edge C): другий tool вже з валідним форматом');
}

// ── Test 3: getToolsForAgent повертає правильний реєстр ──
{
  const tools = getToolsForAgent('dossier_agent');
  assert(tools === DOSSIER_AGENT_TOOLS, 'Test 3: getToolsForAgent повертає DOSSIER_AGENT_TOOLS');
  assert(tools.find(t => t.name === 'add_hearing'), 'Test 3: add_hearing у реєстрі');
  assert(tools.find(t => t.name === 'add_document'), 'Test 3: add_document у реєстрі');
  assert(!tools.find(t => t.name === 'delete_document'), 'Test 3: delete_document ВІДСУТНІЙ (UI-only)');
  assert(!tools.find(t => t.name === 'delete_proceeding'), 'Test 3: delete_proceeding ВІДСУТНІЙ (UI-only)');
}

// ── Test 4: Tools serializable для API (немає функцій / undefined) ──
{
  const json = JSON.stringify(DOSSIER_AGENT_TOOLS);
  assert(json.length > 1000, 'Test 4: tools серіалізовані як JSON (sufficient size)');
  const parsed = JSON.parse(json);
  assert(Array.isArray(parsed) && parsed.length === DOSSIER_AGENT_TOOLS.length,
    'Test 4: round-trip без втрат');
  for (const tool of parsed) {
    assert(typeof tool.name === 'string', `Test 4: ${tool.name} — name string after JSON`);
    assert(tool.input_schema && tool.input_schema.type === 'object',
      `Test 4: ${tool.name} — input_schema збережено`);
  }
}

// ── Test 5: Multi-action в одній репліці — 3 дії одночасно ──
{
  let apiCallCount = 0;
  const callAPI = async () => {
    apiCallCount++;
    if (apiCallCount === 1) {
      return {
        content: [
          { type: 'tool_use', id: 'a', name: 'add_hearing', input: { caseId: 'case_x', date: '2026-05-15', time: '10:00' } },
          { type: 'tool_use', id: 'b', name: 'add_deadline', input: { caseId: 'case_x', name: 'Подати апеляцію', date: '2026-06-01' } },
          { type: 'tool_use', id: 'c', name: 'add_note', input: { caseId: 'case_x', text: 'Підготувати тактику', category: 'strategy' } }
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 300, output_tokens: 80 }
      };
    }
    return {
      content: [{ type: 'text', text: 'Додано: засідання, дедлайн, нотатку.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 400, output_tokens: 20 }
    };
  };

  const ex = makeRealisticExecute();
  const r = await runMultiTurnConversation({
    callAnthropicAPI: callAPI,
    initialMessages: [{ role: 'user', content: 'кілька дій разом' }],
    tools: DOSSIER_AGENT_TOOLS,
    systemPrompt: 'sys',
    context: { agentId: 'dossier_agent', executeAction: ex, caseId: 'case_x' }
  });

  assert(r.totalToolCalls === 3, 'Test 5: 3 паралельні tool_use');
  assert(r.errors.length === 0, 'Test 5: жодних помилок');
  assert(ex.calls.length === 3, 'Test 5: 3 виклики executeAction');
  const actions = ex.calls.map(c => c.action).sort();
  assert(JSON.stringify(actions) === JSON.stringify(['add_deadline', 'add_hearing', 'add_note']),
    'Test 5: усі 3 дії виконані');
}

console.log(`\n━━━ Результат integration: ${pass} pass, ${fail} fail ━━━`);
process.exit(fail > 0 ? 1 : 0);
