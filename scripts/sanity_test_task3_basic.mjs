// TASK 3.7 — basic runToolUse tests.
// Запуск: node scripts/sanity_test_task3_basic.mjs
//
// Покриваємо:
//   • text-only response (немає tool_use) → hasToolUse=false, finalText заповнено
//   • single tool_use call (success) → toolResults має один блок без is_error
//   • multiple tool_use blocks паралельно → всі виконуються, errors=[]
//   • tool падає (executeAction success: false) → is_error=true, errors не порожні
//   • tool кидає exception → is_error=true, runToolUse не падає сам
//   • caseId auto-injection з context

import { runToolUse } from '../src/services/toolUseRunner.js';

let pass = 0, fail = 0;
function assert(cond, label, extra = '') {
  if (cond) { console.log(`✓ ${label}`); pass++; }
  else      { console.log(`✗ ${label}  ${extra}`); fail++; }
}

console.log('━━━ TASK 3.1+3.2 basic runToolUse ━━━\n');

// ── Helper: фабрика mock executeAction ──
function makeExecuteAction({ behavior } = {}) {
  const calls = [];
  const fn = async (agentId, action, params) => {
    calls.push({ agentId, action, params });
    if (typeof behavior === 'function') return await behavior({ agentId, action, params });
    return { success: true, action, params };
  };
  fn.calls = calls;
  return fn;
}

// ── Test 1: text-only response ──
{
  const apiResponse = {
    content: [{ type: 'text', text: 'Привіт. Чим можу допомогти?' }],
    stop_reason: 'end_turn'
  };
  const exec = makeExecuteAction();
  const r = await runToolUse({ apiResponse, agentId: 'dossier_agent', executeAction: exec, context: {} });

  assert(r.hasToolUse === false, 'Test 1: text-only — hasToolUse=false');
  assert(r.toolCalls === 0, 'Test 1: text-only — toolCalls=0');
  assert(r.finalText === 'Привіт. Чим можу допомогти?', 'Test 1: text-only — finalText заповнено');
  assert(r.errors.length === 0, 'Test 1: text-only — errors порожній');
  assert(exec.calls.length === 0, 'Test 1: executeAction не викликався');
}

// ── Test 2: single tool_use success ──
{
  const apiResponse = {
    content: [
      { type: 'text', text: 'Додаю засідання.' },
      { type: 'tool_use', id: 'tu_1', name: 'add_hearing', input: { caseId: 'case_x', date: '2026-05-15', time: '10:00' } }
    ],
    stop_reason: 'tool_use'
  };
  const exec = makeExecuteAction({
    behavior: async ({ params }) => ({ success: true, hearingId: 'hrg_1', echo: params })
  });
  const r = await runToolUse({ apiResponse, agentId: 'dossier_agent', executeAction: exec, context: {} });

  assert(r.hasToolUse === true, 'Test 2: single tool_use — hasToolUse=true');
  assert(r.toolCalls === 1, 'Test 2: toolCalls=1');
  assert(r.toolResults.length === 1, 'Test 2: toolResults має 1 блок');
  assert(r.toolResults[0].type === 'tool_result', 'Test 2: type=tool_result');
  assert(r.toolResults[0].tool_use_id === 'tu_1', 'Test 2: tool_use_id збережено');
  assert(!r.toolResults[0].is_error, 'Test 2: is_error не виставлено для success');
  assert(exec.calls[0].action === 'add_hearing', 'Test 2: executeAction викликаний з add_hearing');
  assert(exec.calls[0].params.date === '2026-05-15', 'Test 2: params передано коректно');
  assert(r.finalText === 'Додаю засідання.', 'Test 2: finalText з text-блоку');
}

// ── Test 3: multiple tool_use blocks ──
{
  const apiResponse = {
    content: [
      { type: 'tool_use', id: 'tu_1', name: 'add_hearing', input: { date: '2026-05-15', time: '10:00' } },
      { type: 'tool_use', id: 'tu_2', name: 'add_deadline', input: { name: 'Подати апеляцію', date: '2026-06-01' } },
      { type: 'tool_use', id: 'tu_3', name: 'pin_note', input: { noteId: 'note_1' } }
    ],
    stop_reason: 'tool_use'
  };
  const exec = makeExecuteAction();
  const r = await runToolUse({ apiResponse, agentId: 'dossier_agent', executeAction: exec, context: { caseId: 'case_x' } });

  assert(r.toolCalls === 3, 'Test 3: 3 паралельні tool_use');
  assert(r.toolResults.length === 3, 'Test 3: 3 tool_results');
  assert(exec.calls.every(c => c.params.caseId === 'case_x'), 'Test 3: caseId auto-injected у всі виклики');
  assert(r.errors.length === 0, 'Test 3: жодних помилок');
}

// ── Test 4: tool повертає success:false ──
{
  const apiResponse = {
    content: [{ type: 'tool_use', id: 'tu_x', name: 'add_hearing', input: { caseId: 'case_x' } }],
    stop_reason: 'tool_use'
  };
  const exec = makeExecuteAction({
    behavior: async () => ({ success: false, error: "Дата засідання обов'язкова" })
  });
  const r = await runToolUse({ apiResponse, agentId: 'dossier_agent', executeAction: exec, context: {} });

  assert(r.toolResults[0].is_error === true, 'Test 4: is_error=true для success:false');
  assert(r.errors.length === 1, 'Test 4: errors не порожній');
  assert(/Дата/.test(r.toolResults[0].content), 'Test 4: error message у content');
}

// ── Test 5: tool кидає exception ──
{
  const apiResponse = {
    content: [{ type: 'tool_use', id: 'tu_e', name: 'add_hearing', input: {} }],
    stop_reason: 'tool_use'
  };
  const exec = makeExecuteAction({
    behavior: async () => { throw new Error('Несподівана помилка handler'); }
  });
  let runFailed = false;
  let r;
  try {
    r = await runToolUse({ apiResponse, agentId: 'dossier_agent', executeAction: exec, context: {} });
  } catch (e) {
    runFailed = true;
  }

  assert(!runFailed, 'Test 5: runToolUse не падає при exception у handler');
  assert(r?.toolResults[0]?.is_error === true, 'Test 5: is_error=true при exception');
  assert(r?.errors.length === 1, 'Test 5: errors містить exception');
}

// ── Test 6: каскад — один падає, інші виконуються ──
{
  const apiResponse = {
    content: [
      { type: 'tool_use', id: 'a', name: 'add_hearing', input: { date: '2026-05-15', time: '10:00' } },
      { type: 'tool_use', id: 'b', name: 'add_deadline', input: {} }, // спричинить помилку
      { type: 'tool_use', id: 'c', name: 'pin_note', input: { noteId: 'n1' } },
    ],
    stop_reason: 'tool_use'
  };
  const exec = makeExecuteAction({
    behavior: async ({ action }) => {
      if (action === 'add_deadline') return { success: false, error: 'name обов\'язковий' };
      return { success: true };
    }
  });
  const r = await runToolUse({ apiResponse, agentId: 'dossier_agent', executeAction: exec, context: {} });

  assert(exec.calls.length === 3, 'Test 6: усі 3 tool викликались попри помилку другого');
  assert(r.toolResults[0].is_error !== true, 'Test 6: tool_result[0] success');
  assert(r.toolResults[1].is_error === true, 'Test 6: tool_result[1] is_error');
  assert(r.toolResults[2].is_error !== true, 'Test 6: tool_result[2] success');
  assert(r.errors.length === 1, 'Test 6: тільки 1 помилка');
}

// ── Test 7: caseId auto-injection НЕ перезаписує model-передану ──
{
  const apiResponse = {
    content: [{ type: 'tool_use', id: 'tu_z', name: 'add_hearing', input: { caseId: 'case_explicit', date: '2026-05-15', time: '10:00' } }],
    stop_reason: 'tool_use'
  };
  const exec = makeExecuteAction();
  const r = await runToolUse({ apiResponse, agentId: 'dossier_agent', executeAction: exec, context: { caseId: 'case_default' } });

  assert(exec.calls[0].params.caseId === 'case_explicit', 'Test 7: модель може передати свій caseId — не перезаписується контекстом');
}

// ── Test 8: пустий content → no-op ──
{
  const apiResponse = { content: [], stop_reason: 'end_turn' };
  const exec = makeExecuteAction();
  const r = await runToolUse({ apiResponse, agentId: 'dossier_agent', executeAction: exec, context: {} });

  assert(r.hasToolUse === false, 'Test 8: empty content → hasToolUse=false');
  assert(r.toolCalls === 0, 'Test 8: empty content → toolCalls=0');
  assert(r.finalText === '', 'Test 8: empty content → finalText empty');
}

console.log(`\n━━━ Результат basic: ${pass} pass, ${fail} fail ━━━`);
process.exit(fail > 0 ? 1 : 0);
