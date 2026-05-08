// TASK 3.7 — tool definitions validation.
// Запуск: node scripts/sanity_test_task3_tooldefs.mjs
//
// Покриваємо:
//   • усі tools мають required fields (name, description, input_schema)
//   • усі enum'и валідні (відповідають канонічній схемі)
//   • DOSSIER_AGENT_TOOLS синхронізований з PERMISSIONS.dossier_agent з App.jsx
//     (за винятком UI-only delete_*)
//   • немає дублікатів name
//   • description'и не порожні і descriptive (>= 80 символів)
//   • input_schema має required-список і properties
//   • DOCUMENT_PROCESSOR_AGENT_TOOLS — поки порожній (заглушка)

import {
  ADD_DOCUMENT_TOOL,
  UPDATE_DOCUMENT_TOOL,
  ADD_PROCEEDING_TOOL,
  UPDATE_PROCEEDING_TOOL,
  ADD_HEARING_TOOL,
  UPDATE_HEARING_TOOL,
  DELETE_HEARING_TOOL,
  ADD_DEADLINE_TOOL,
  UPDATE_DEADLINE_TOOL,
  DELETE_DEADLINE_TOOL,
  ADD_NOTE_TOOL,
  UPDATE_NOTE_TOOL,
  DELETE_NOTE_TOOL,
  PIN_NOTE_TOOL,
  UNPIN_NOTE_TOOL,
  CREATE_CASE_TOOL,
  UPDATE_CASE_FIELD_TOOL,
  CLOSE_CASE_TOOL,
  RESTORE_CASE_TOOL,
  UPDATE_PROCESSING_CONTEXT_TOOL,
  DOSSIER_AGENT_TOOLS,
  DOCUMENT_PROCESSOR_AGENT_TOOLS,
  getToolsForAgent,
} from '../src/services/toolDefinitions.js';

import { CANONICAL_DOCUMENT_FIELDS } from '../src/schemas/documentSchema.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function assert(cond, label, extra = '') {
  if (cond) { console.log(`✓ ${label}`); pass++; }
  else      { console.log(`✗ ${label}  ${extra}`); fail++; }
}

console.log('━━━ TASK 3.1 tool definitions validation ━━━\n');

const ALL_INDIVIDUAL_TOOLS = [
  ADD_DOCUMENT_TOOL, UPDATE_DOCUMENT_TOOL,
  ADD_PROCEEDING_TOOL, UPDATE_PROCEEDING_TOOL,
  ADD_HEARING_TOOL, UPDATE_HEARING_TOOL, DELETE_HEARING_TOOL,
  ADD_DEADLINE_TOOL, UPDATE_DEADLINE_TOOL, DELETE_DEADLINE_TOOL,
  ADD_NOTE_TOOL, UPDATE_NOTE_TOOL, DELETE_NOTE_TOOL, PIN_NOTE_TOOL, UNPIN_NOTE_TOOL,
  CREATE_CASE_TOOL, UPDATE_CASE_FIELD_TOOL, CLOSE_CASE_TOOL, RESTORE_CASE_TOOL,
  UPDATE_PROCESSING_CONTEXT_TOOL,
];

// ── Required fields на кожному tool ──
for (const tool of ALL_INDIVIDUAL_TOOLS) {
  assert(typeof tool.name === 'string' && tool.name.length > 0, `Tool ${tool.name || '?'} — has name`);
  assert(typeof tool.description === 'string' && tool.description.length >= 80, `Tool ${tool.name} — description >= 80 chars (got ${tool.description?.length || 0})`);
  assert(tool.input_schema && tool.input_schema.type === 'object', `Tool ${tool.name} — input_schema.type=object`);
  assert(tool.input_schema.properties && typeof tool.input_schema.properties === 'object', `Tool ${tool.name} — has properties`);
  assert(Array.isArray(tool.input_schema.required), `Tool ${tool.name} — required is array`);
}

// ── Енами відповідають канонічній схемі ──
const schemaCategoryEnum = CANONICAL_DOCUMENT_FIELDS.category.enum;
const toolCategoryEnum = ADD_DOCUMENT_TOOL.input_schema.properties.document.properties.category.enum;
assert(JSON.stringify(toolCategoryEnum) === JSON.stringify(schemaCategoryEnum),
  'category enum синхронізований зі schema',
  `tool=${JSON.stringify(toolCategoryEnum)} schema=${JSON.stringify(schemaCategoryEnum)}`);

const schemaAuthorEnum = CANONICAL_DOCUMENT_FIELDS.author.enum;
const toolAuthorEnum = ADD_DOCUMENT_TOOL.input_schema.properties.document.properties.author.enum;
assert(JSON.stringify(toolAuthorEnum) === JSON.stringify(schemaAuthorEnum),
  'author enum синхронізований зі schema');

assert(toolAuthorEnum.includes('opponent'), 'author enum містить opponent (а не opp)');
assert(!toolAuthorEnum.includes('opp'), 'author enum НЕ містить legacy opp');

const schemaFolderEnum = CANONICAL_DOCUMENT_FIELDS.folder.enum;
const toolFolderEnum = ADD_DOCUMENT_TOOL.input_schema.properties.document.properties.folder.enum;
assert(JSON.stringify(toolFolderEnum) === JSON.stringify(schemaFolderEnum),
  'folder enum синхронізований зі schema');

// ── Немає дублікатів name ──
{
  const names = ALL_INDIVIDUAL_TOOLS.map(t => t.name);
  const unique = new Set(names);
  assert(names.length === unique.size, 'Немає дублікатів tool.name', `names=${JSON.stringify(names)}`);
}

// ── DOSSIER_AGENT_TOOLS включає всі індивідуальні константи ──
{
  const dossierNames = DOSSIER_AGENT_TOOLS.map(t => t.name).sort();
  const expectedNames = ALL_INDIVIDUAL_TOOLS.map(t => t.name).sort();
  assert(JSON.stringify(dossierNames) === JSON.stringify(expectedNames),
    'DOSSIER_AGENT_TOOLS містить усі індивідуальні константи',
    `dossier=${JSON.stringify(dossierNames)}`);
}

// ── Синхронізація з PERMISSIONS.dossier_agent з App.jsx ──
// Читаємо App.jsx як текст і знаходимо блок dossier_agent: [...].
{
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const appJsxPath = path.resolve(__dirname, '../src/App.jsx');
  const src = fs.readFileSync(appJsxPath, 'utf8');

  // Знаходимо dossier_agent: [ ... ] (multiline). Простий пошук — від
  // 'dossier_agent: [' до закриття дужок з ', або ]\n. Достатньо для тесту.
  const startIdx = src.indexOf('dossier_agent: [');
  assert(startIdx > -1, 'dossier_agent блок знайдено в App.jsx');
  const endIdx = src.indexOf('],', startIdx);
  const block = src.slice(startIdx, endIdx + 1);

  // Витягуємо рядкові літерали 'xxx' або "xxx".
  const actions = [...block.matchAll(/['"]([a-z_]+)['"]/g)].map(m => m[1]);
  const actionsSet = new Set(actions);

  // UI-only ACTIONS свідомо ВІДСУТНІ у DOSSIER_AGENT_TOOLS.
  const UI_ONLY = ['delete_document', 'delete_proceeding'];

  // Перевіряємо що у tools є все з PERMISSIONS, окрім UI-only;
  // і що у tools немає чогось зайвого що не дозволено в PERMISSIONS.
  const toolNames = new Set(DOSSIER_AGENT_TOOLS.map(t => t.name));

  const missingFromTools = [...actionsSet].filter(a =>
    !toolNames.has(a) &&
    !UI_ONLY.includes(a) &&
    a !== 'batch_update' && // композитна, не tool
    a !== 'add_time_entry' && a !== 'update_time_entry' && a !== 'cancel_time_entry' && a !== 'split_time_entry' && a !== 'assign_offline_period' &&
    a !== 'confirm_event' && a !== 'add_travel' && a !== 'cancel_travel' &&
    a !== 'start_external_work' && a !== 'end_external_work' && a !== 'update_external_work' &&
    a !== 'track_session_start' && a !== 'track_session_end'
  );
  assert(missingFromTools.length === 0,
    'У DOSSIER_AGENT_TOOLS є tool для кожного нетаймового дозволеного ACTION (окрім UI-only)',
    `missing=${missingFromTools.join(', ')}`);

  const extra = [...toolNames].filter(t => !actionsSet.has(t));
  assert(extra.length === 0,
    'Жодного tool не дозволено агенту що відсутнє в PERMISSIONS',
    `extra=${extra.join(', ')}`);
}

// ── DOCUMENT_PROCESSOR_AGENT_TOOLS — заглушка ──
assert(Array.isArray(DOCUMENT_PROCESSOR_AGENT_TOOLS), 'DOCUMENT_PROCESSOR_AGENT_TOOLS — масив');
assert(DOCUMENT_PROCESSOR_AGENT_TOOLS.length === 0, 'DOCUMENT_PROCESSOR_AGENT_TOOLS поки порожній (заглушка для DP v2)');

// ── getToolsForAgent ──
assert(getToolsForAgent('dossier_agent') === DOSSIER_AGENT_TOOLS, 'getToolsForAgent dossier_agent');
assert(getToolsForAgent('document_processor_agent') === DOCUMENT_PROCESSOR_AGENT_TOOLS, 'getToolsForAgent document_processor_agent');
assert(Array.isArray(getToolsForAgent('unknown')) && getToolsForAgent('unknown').length === 0, 'getToolsForAgent unknown → []');

// ── Описи дискримінують подібні tools ──
// add_document mentions add_documents (дискримінація з batch).
assert(/add_documents/.test(ADD_DOCUMENT_TOOL.description),
  'add_document description згадує add_documents для дискримінації');

// Описи UPDATE_PROCEEDING_TOOL мають згадувати що type не редагується.
assert(/type/i.test(UPDATE_PROCEEDING_TOOL.description),
  'update_proceeding description пояснює про незмінний type');

// delete_hearing description має згадувати про "уточни" якщо кілька.
assert(/перепита|кілька|уточни|питай/i.test(DELETE_HEARING_TOOL.description),
  'delete_hearing description нагадує перепитати при множинних записах');

console.log(`\n━━━ Результат tooldefs: ${pass} pass, ${fail} fail ━━━`);
process.exit(fail > 0 ? 1 : 0);
