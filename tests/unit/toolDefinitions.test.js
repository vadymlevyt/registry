// Юніт-тести Tool Use definitions для агента досьє.
// Покриває: required fields, синхронізацію з PERMISSIONS, відсутність
// масивних type у input_schema, відсутність дублікатів.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
} from '../../src/services/toolDefinitions.js';
import { CANONICAL_DOCUMENT_FIELDS } from '../../src/schemas/documentSchema.js';

const ALL_INDIVIDUAL_TOOLS = [
  ADD_DOCUMENT_TOOL, UPDATE_DOCUMENT_TOOL,
  ADD_PROCEEDING_TOOL, UPDATE_PROCEEDING_TOOL,
  ADD_HEARING_TOOL, UPDATE_HEARING_TOOL, DELETE_HEARING_TOOL,
  ADD_DEADLINE_TOOL, UPDATE_DEADLINE_TOOL, DELETE_DEADLINE_TOOL,
  ADD_NOTE_TOOL, UPDATE_NOTE_TOOL, DELETE_NOTE_TOOL, PIN_NOTE_TOOL, UNPIN_NOTE_TOOL,
  CREATE_CASE_TOOL, UPDATE_CASE_FIELD_TOOL, CLOSE_CASE_TOOL, RESTORE_CASE_TOOL,
  UPDATE_PROCESSING_CONTEXT_TOOL,
];

// Дії які свідомо ВИКЛЮЧЕНІ з DOSSIER_AGENT_TOOLS (але можуть бути у PERMISSIONS).
const EXCLUDED_FROM_DOSSIER_TOOLS = {
  delete_document:    'UI-only — модифікує файли на Drive, потребує підтвердження',
  delete_proceeding:  'UI-only — каскадно обнуляє procId документів',
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
  create_case:              'агент досьє діє лише з поточною справою',
};

const dropNull = (arr) => arr.filter(v => v !== null);

describe('toolDefinitions', () => {
  describe('required fields на кожному tool', () => {
    it.each(ALL_INDIVIDUAL_TOOLS)('$name — name + description + input_schema', (tool) => {
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe('string');
      // description має бути informative (>= 80 символів) — захист від
      // регресії коли хтось скоротить опис до "Робить X".
      expect(tool.description.length).toBeGreaterThanOrEqual(80);
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe('object');
      expect(tool.input_schema.properties).toBeDefined();
      expect(Array.isArray(tool.input_schema.required)).toBe(true);
    });
  });

  describe('Енами синхронізовані зі схемою (без null)', () => {
    it('category enum tool === schema без null', () => {
      const schemaEnum = dropNull(CANONICAL_DOCUMENT_FIELDS.category.enum);
      const toolEnum = ADD_DOCUMENT_TOOL.input_schema.properties.document.properties.category.enum;
      expect(toolEnum).toEqual(schemaEnum);
    });

    it('author enum tool === schema без null, без legacy "opp"', () => {
      const schemaEnum = dropNull(CANONICAL_DOCUMENT_FIELDS.author.enum);
      const toolEnum = ADD_DOCUMENT_TOOL.input_schema.properties.document.properties.author.enum;
      expect(toolEnum).toEqual(schemaEnum);
      expect(toolEnum).not.toContain('opp');
      expect(toolEnum).toContain('opponent');
    });

    it('folder enum tool === schema', () => {
      const schemaEnum = CANONICAL_DOCUMENT_FIELDS.folder.enum;
      const toolEnum = ADD_DOCUMENT_TOOL.input_schema.properties.document.properties.folder.enum;
      expect(toolEnum).toEqual(schemaEnum);
    });
  });

  describe('Відсутність масивних type (Anthropic-friendly)', () => {
    function findArrayTypes(schema, path = '') {
      if (!schema || typeof schema !== 'object') return [];
      const issues = [];
      if (Array.isArray(schema.type)) issues.push(`${path}.type=${JSON.stringify(schema.type)}`);
      if (schema.properties) {
        for (const [k, v] of Object.entries(schema.properties)) {
          issues.push(...findArrayTypes(v, `${path}.${k}`));
        }
      }
      if (schema.items) issues.push(...findArrayTypes(schema.items, `${path}.items`));
      return issues;
    }

    it.each(ALL_INDIVIDUAL_TOOLS)('$name — input_schema без масивних type', (tool) => {
      expect(findArrayTypes(tool.input_schema, tool.name)).toEqual([]);
    });
  });

  describe('Жодних дублікатів tool.name', () => {
    it('усі імена унікальні', () => {
      const names = ALL_INDIVIDUAL_TOOLS.map(t => t.name);
      expect(new Set(names).size).toBe(names.length);
    });
  });

  describe('DOSSIER_AGENT_TOOLS', () => {
    it('містить усі очікувані tools (без CREATE_CASE_TOOL)', () => {
      const dossierNames = new Set(DOSSIER_AGENT_TOOLS.map(t => t.name));
      const expected = [
        'add_hearing', 'update_hearing', 'delete_hearing',
        'add_deadline', 'update_deadline', 'delete_deadline',
        'add_note', 'update_note', 'delete_note', 'pin_note', 'unpin_note',
        'add_document', 'update_document',
        'add_proceeding', 'update_proceeding',
        'update_case_field', 'close_case', 'restore_case',
        'update_processing_context',
      ];
      for (const e of expected) {
        expect(dossierNames.has(e)).toBe(true);
      }
    });

    it('НЕ містить create_case (агент досьє діє лише з поточною справою)', () => {
      expect(DOSSIER_AGENT_TOOLS.map(t => t.name)).not.toContain('create_case');
    });

    it('НЕ містить delete_document і delete_proceeding (UI-only)', () => {
      const names = DOSSIER_AGENT_TOOLS.map(t => t.name);
      expect(names).not.toContain('delete_document');
      expect(names).not.toContain('delete_proceeding');
    });
  });

  describe('Синхронізація з PERMISSIONS.dossier_agent (App.jsx)', () => {
    let actionsSet;
    {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const appJsxPath = path.resolve(__dirname, '../../src/App.jsx');
      const src = fs.readFileSync(appJsxPath, 'utf8');
      const startIdx = src.indexOf('dossier_agent: [');
      const endIdx = src.indexOf('],', startIdx);
      const block = src.slice(startIdx, endIdx + 1);
      const actions = [...block.matchAll(/['"]([a-z_]+)['"]/g)].map(m => m[1]);
      actionsSet = new Set(actions);
    }

    it('кожен дозволений ACTION (поза EXCLUDED) має tool', () => {
      const toolNames = new Set(DOSSIER_AGENT_TOOLS.map(t => t.name));
      const missing = [...actionsSet].filter(a =>
        !toolNames.has(a) && !(a in EXCLUDED_FROM_DOSSIER_TOOLS)
      );
      expect(missing).toEqual([]);
    });

    it('жодного tool не дозволено агенту що відсутнє в PERMISSIONS', () => {
      const toolNames = [...new Set(DOSSIER_AGENT_TOOLS.map(t => t.name))];
      const extra = toolNames.filter(t => !actionsSet.has(t));
      expect(extra).toEqual([]);
    });

    it('EXCLUDED не містить застарілих записів (тільки UI-only-never-в-PERMISSIONS можуть бути)', () => {
      const UI_ONLY_NEVER_IN_PERMS = new Set(['delete_document', 'delete_proceeding', 'delete_time_entry']);
      const stale = Object.keys(EXCLUDED_FROM_DOSSIER_TOOLS).filter(a =>
        !actionsSet.has(a) && !UI_ONLY_NEVER_IN_PERMS.has(a)
      );
      expect(stale).toEqual([]);
    });
  });

  describe('DOCUMENT_PROCESSOR_AGENT_TOOLS', () => {
    it('заглушка — порожній масив (заповниться у TASK Document Processor v2)', () => {
      expect(DOCUMENT_PROCESSOR_AGENT_TOOLS).toEqual([]);
    });
  });

  describe('getToolsForAgent', () => {
    it('повертає DOSSIER_AGENT_TOOLS для dossier_agent', () => {
      expect(getToolsForAgent('dossier_agent')).toBe(DOSSIER_AGENT_TOOLS);
    });

    it('повертає DOCUMENT_PROCESSOR_AGENT_TOOLS для document_processor_agent', () => {
      expect(getToolsForAgent('document_processor_agent')).toBe(DOCUMENT_PROCESSOR_AGENT_TOOLS);
    });

    it('повертає [] для невідомого агента', () => {
      expect(getToolsForAgent('unknown')).toEqual([]);
    });
  });

  describe('Описи дискримінують подібні tools', () => {
    it('add_document description згадує add_documents (для розрізнення з batch DP)', () => {
      expect(/add_documents/.test(ADD_DOCUMENT_TOOL.description)).toBe(true);
    });

    it('update_proceeding description пояснює про незмінний type', () => {
      expect(/type/i.test(UPDATE_PROCEEDING_TOOL.description)).toBe(true);
    });

    it('delete_hearing description нагадує перепитати при множинних записах', () => {
      expect(/перепита|кілька|питай|уточни/i.test(DELETE_HEARING_TOOL.description)).toBe(true);
    });
  });
});
