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

// ACTIONS свідомо виключені з DOSSIER_AGENT_TOOLS, навіть якщо PERMISSIONS
// агента їх дозволяє. Додавати сюди лише з обґрунтуванням.
const EXCLUDED_FROM_DOSSIER_TOOLS = {
  // UI-only через _fromUI прапор (TASK 2).
  delete_document:    'UI-only — модифікує файли на Drive, потребує підтвердження',
  delete_proceeding:  'UI-only — каскадно обнуляє procId документів, потребує підтвердження',
  // Окремий шар білінгу — не зона текстового чату досьє.
  add_time_entry:           'окремий шар білінгу',
  update_time_entry:        'окремий шар білінгу',
  cancel_time_entry:        'окремий шар білінгу',
  delete_time_entry:        'окремий шар білінгу',
  split_time_entry:         'окремий шар білінгу',
  assign_offline_period:    'окремий шар білінгу',
  confirm_event:            'утиліта календаря/часу',
  add_travel:               'утиліта календаря/часу',
  cancel_travel:            'утиліта календаря/часу',
  start_external_work:      'облік часу',
  end_external_work:        'облік часу',
  update_external_work:     'облік часу',
  track_session_start:      'облік сесій',
  track_session_end:        'облік сесій',
  // Створення нової справи — поза межами поточної. Зона QI/Dashboard.
  create_case:              'агент досьє діє лише з поточною справою',
  // batch_update прибрано з PERMISSIONS.dossier_agent — модель робить це
  // нативно через паралельні tool_use блоки. У EXCLUDED не вносимо: якщо
  // повернеться у PERMISSIONS — тест синхронізації одразу впіймає.
};

// ── Required fields на кожному tool ──
for (const tool of ALL_INDIVIDUAL_TOOLS) {
  assert(typeof tool.name === 'string' && tool.name.length > 0, `Tool ${tool.name || '?'} — has name`);
  assert(typeof tool.description === 'string' && tool.description.length >= 80, `Tool ${tool.name} — description >= 80 chars (got ${tool.description?.length || 0})`);
  assert(tool.input_schema && tool.input_schema.type === 'object', `Tool ${tool.name} — input_schema.type=object`);
  assert(tool.input_schema.properties && typeof tool.input_schema.properties === 'object', `Tool ${tool.name} — has properties`);
  assert(Array.isArray(tool.input_schema.required), `Tool ${tool.name} — required is array`);
}

// ── Енами відповідають канонічній схемі (без null — Anthropic-friendly) ──
// Tool Use не любить enum що містить null; null обробляється через "опуск поля".
const dropNull = (arr) => arr.filter(v => v !== null);
const schemaCategoryEnum = dropNull(CANONICAL_DOCUMENT_FIELDS.category.enum);
const toolCategoryEnum = ADD_DOCUMENT_TOOL.input_schema.properties.document.properties.category.enum;
assert(JSON.stringify(toolCategoryEnum) === JSON.stringify(schemaCategoryEnum),
  'category enum синхронізований зі schema (без null)',
  `tool=${JSON.stringify(toolCategoryEnum)} schema=${JSON.stringify(schemaCategoryEnum)}`);

const schemaAuthorEnum = dropNull(CANONICAL_DOCUMENT_FIELDS.author.enum);
const toolAuthorEnum = ADD_DOCUMENT_TOOL.input_schema.properties.document.properties.author.enum;
assert(JSON.stringify(toolAuthorEnum) === JSON.stringify(schemaAuthorEnum),
  'author enum синхронізований зі schema (без null)');

assert(toolAuthorEnum.includes('opponent'), 'author enum містить opponent (а не opp)');
assert(!toolAuthorEnum.includes('opp'), 'author enum НЕ містить legacy opp');
assert(!toolCategoryEnum.includes(null), 'category enum НЕ містить null (Anthropic-friendly)');
assert(!toolAuthorEnum.includes(null), 'author enum НЕ містить null (Anthropic-friendly)');

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

// ── DOSSIER_AGENT_TOOLS включає всі індивідуальні константи (без CREATE_CASE_TOOL) ──
{
  const dossierNames = DOSSIER_AGENT_TOOLS.map(t => t.name).sort();
  const expectedNames = ALL_INDIVIDUAL_TOOLS
    .filter(t => t !== CREATE_CASE_TOOL) // create_case свідомо виключено
    .map(t => t.name).sort();
  assert(JSON.stringify(dossierNames) === JSON.stringify(expectedNames),
    'DOSSIER_AGENT_TOOLS містить усі індивідуальні константи (окрім CREATE_CASE_TOOL)',
    `dossier=${JSON.stringify(dossierNames)}`);
  assert(!dossierNames.includes('create_case'),
    'create_case свідомо виключений з DOSSIER_AGENT_TOOLS (агент діє лише з поточною справою)');
}

// ── Явна наявність кожного очікуваного tool у DOSSIER_AGENT_TOOLS ──
// Це ловить регресії типу "агент каже у мене немає delete_hearing".
{
  const expectedDossierTools = [
    'add_hearing', 'update_hearing', 'delete_hearing',
    'add_deadline', 'update_deadline', 'delete_deadline',
    'add_note', 'update_note', 'delete_note', 'pin_note', 'unpin_note',
    'add_document', 'update_document',
    'add_proceeding', 'update_proceeding',
    'update_case_field', 'close_case', 'restore_case',
    'update_processing_context',
  ];
  const dossierNamesSet = new Set(DOSSIER_AGENT_TOOLS.map(t => t.name));
  for (const expected of expectedDossierTools) {
    assert(dossierNamesSet.has(expected),
      `DOSSIER_AGENT_TOOLS містить ${expected}`,
      `dossier=${[...dossierNamesSet].join(',')}`);
  }
}

// ── Синхронізація з PERMISSIONS.dossier_agent з App.jsx ──
// Читаємо App.jsx як текст і знаходимо блок dossier_agent: [...].
{
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const appJsxPath = path.resolve(__dirname, '../src/App.jsx');
  const src = fs.readFileSync(appJsxPath, 'utf8');

  // Знаходимо dossier_agent: [ ... ] (multiline). Простий пошук — від
  // 'dossier_agent: [' до закриття дужок з ', або ]\n.
  const startIdx = src.indexOf('dossier_agent: [');
  assert(startIdx > -1, 'dossier_agent блок знайдено в App.jsx');
  const endIdx = src.indexOf('],', startIdx);
  const block = src.slice(startIdx, endIdx + 1);

  // Витягуємо рядкові літерали 'xxx' або "xxx".
  const actions = [...block.matchAll(/['"]([a-z_]+)['"]/g)].map(m => m[1]);
  const actionsSet = new Set(actions);

  const toolNames = new Set(DOSSIER_AGENT_TOOLS.map(t => t.name));

  // Кожен дозволений ACTION (без EXCLUDED_FROM_DOSSIER_TOOLS) має tool.
  const missingFromTools = [...actionsSet].filter(a =>
    !toolNames.has(a) && !(a in EXCLUDED_FROM_DOSSIER_TOOLS)
  );
  assert(missingFromTools.length === 0,
    'Кожен дозволений ACTION (поза EXCLUDED_FROM_DOSSIER_TOOLS) має tool',
    `missing=${missingFromTools.join(', ')}`);

  const extra = [...toolNames].filter(t => !actionsSet.has(t));
  assert(extra.length === 0,
    'Жодного tool не дозволено агенту що відсутнє в PERMISSIONS',
    `extra=${extra.join(', ')}`);

  // Кожен EXCLUDED — реально дозволений у PERMISSIONS (інакше exclusion зайва).
  // Виняток: delete_document, delete_proceeding, delete_time_entry — це UI-only,
  // їх може не бути в PERMISSIONS взагалі (заборонено всім агентам).
  const UI_ONLY_NEVER_IN_PERMS = new Set(['delete_document', 'delete_proceeding', 'delete_time_entry']);
  const stale = Object.keys(EXCLUDED_FROM_DOSSIER_TOOLS).filter(a =>
    !actionsSet.has(a) && !UI_ONLY_NEVER_IN_PERMS.has(a)
  );
  assert(stale.length === 0,
    'EXCLUDED_FROM_DOSSIER_TOOLS не містить застарілих записів',
    `stale=${stale.join(', ')}`);
}

// ── Жодного type:[string,null] у схемі (Anthropic Tool Use стабільніше з простими типами) ──
{
  function checkNoArrayTypes(schema, path = '') {
    if (!schema || typeof schema !== 'object') return [];
    const issues = [];
    if (Array.isArray(schema.type)) {
      issues.push(`${path}.type=${JSON.stringify(schema.type)}`);
    }
    if (schema.properties) {
      for (const [k, v] of Object.entries(schema.properties)) {
        issues.push(...checkNoArrayTypes(v, `${path}.${k}`));
      }
    }
    if (schema.items) issues.push(...checkNoArrayTypes(schema.items, `${path}.items`));
    return issues;
  }
  for (const tool of ALL_INDIVIDUAL_TOOLS) {
    const issues = checkNoArrayTypes(tool.input_schema, tool.name);
    assert(issues.length === 0,
      `${tool.name} — input_schema без масивних type (Anthropic-friendly)`,
      issues.join(', '));
  }
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
