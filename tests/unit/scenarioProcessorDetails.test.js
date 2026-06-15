// scenarioProcessorDetails.test.js — TASK case_ui_and_result_polish §4.
// Перевіряє per-case деталі у Result: processCase (через submitScenarioResult)
// повертає action/changed, submitScenarioResult і processDeferredCases
// агрегують result.details[]. Адитивно — старі поля не ламаються.

import { describe, it, expect, vi } from 'vitest';
import {
  submitScenarioResult,
  processDeferredCases,
} from '../../src/services/ecits/scenarioProcessor.js';

function makeEnvelope(cases) {
  return {
    envelopeVersion: 1,
    scenarioId: 'ecits_import_cases_and_hearings',
    scenarioVersion: 1,
    data: { cases, warnings: [], skipped: [] },
  };
}

function ecitsCase(overrides = {}) {
  return {
    case_no: '450/2275/25',
    court: 'Київський суд',
    category: 'civil',
    representedParties: ['Бабенко О.І.'],
    hearings: [{ date: '2026-05-25', time: '08:50' }],
    ...overrides,
  };
}

function makeDeps() {
  const cases = [];
  const executeAction = vi.fn(async (agentId, action, params) => {
    if (action === 'create_case') {
      const newCase = {
        id: `case_${cases.length + 1}`,
        case_no: params.case_no,
        name: params.name,
        client: params.client,
        nameSource: params.nameSource,
        hearings: [],
      };
      cases.push(newCase);
      return { success: true, caseId: newCase.id };
    }
    if (action === 'add_hearing') {
      const c = cases.find((x) => x.id === params.caseId);
      if (c) c.hearings.push({ id: `h_${c.hearings.length + 1}`, date: params.date, time: params.time });
      return { success: true, hearingId: 'h_x' };
    }
    if (action === 'update_case_ecits_state') return { success: true };
    if (action === 'update_case_identity') {
      const c = cases.find((x) => x.id === params.caseId);
      if (c) { c.name = params.name; c.client = params.client; }
      return { success: true };
    }
    return { success: false, error: `unknown ${action}` };
  });
  return { executeAction, getCases: () => cases, cases };
}

describe('result.details — нова справа (§4)', () => {
  it('action=created з людиночитними змінами (назва + засідання)', async () => {
    const { executeAction, getCases } = makeDeps();
    const res = await submitScenarioResult(makeEnvelope([ecitsCase()]), { executeAction, getCases });

    expect(Array.isArray(res.details)).toBe(true);
    expect(res.details).toHaveLength(1);
    const d = res.details[0];
    expect(d.case_no).toBe('450/2275/25');
    expect(d.action).toBe('created');
    expect(d.changed.some((s) => s.startsWith('нова назва:'))).toBe(true);
    expect(d.changed).toContain('+1 засідань');
  });
});

describe('result.details — існуюча справа (§4)', () => {
  it('action=updated з «оновлено ecitsState»', async () => {
    const { executeAction } = makeDeps();
    const existing = [{ id: 'case_e', case_no: '450/2275/25', name: '[ЄСІТС] стара', client: null, hearings: [{ id: 'h1', date: '2026-05-25', time: '08:50' }] }];
    const res = await submitScenarioResult(
      makeEnvelope([ecitsCase({ representedParties: [] })]),
      { executeAction, getCases: () => existing },
    );
    expect(res.details).toHaveLength(1);
    expect(res.details[0].action).toBe('updated');
    expect(res.details[0].changed).toContain('оновлено ecitsState');
  });
});

describe('result.details — пропущена справа (§4)', () => {
  it('action=skipped коли немає case_no', async () => {
    const { executeAction, getCases } = makeDeps();
    const res = await submitScenarioResult(
      makeEnvelope([ecitsCase({ case_no: null, hearings: [] })]),
      { executeAction, getCases },
    );
    expect(res.details).toHaveLength(1);
    expect(res.details[0].action).toBe('skipped');
    expect(res.details[0].changed.some((s) => s.startsWith('пропущено:'))).toBe(true);
  });
});

describe('result.details — агрегація кількох справ (§4)', () => {
  it('по одній деталі на кожну оброблену справу', async () => {
    const { executeAction, getCases } = makeDeps();
    const res = await submitScenarioResult(
      makeEnvelope([
        ecitsCase({ case_no: '450/1/25' }),
        ecitsCase({ case_no: '450/2/25' }),
      ]),
      { executeAction, getCases },
    );
    expect(res.details).toHaveLength(2);
    expect(res.details.map((d) => d.case_no).sort()).toEqual(['450/1/25', '450/2/25']);
  });
});

describe('processDeferredCases — деталі (§4)', () => {
  it('повертає details[] для обраних deferred-справ', async () => {
    const { executeAction, getCases } = makeDeps();
    const inc = await processDeferredCases([ecitsCase({ case_no: '999/9/26' })], { executeAction, getCases });
    expect(Array.isArray(inc.details)).toBe(true);
    expect(inc.details).toHaveLength(1);
    expect(inc.details[0].action).toBe('created');
  });

  it('порожній вхід → порожні details', async () => {
    const { executeAction, getCases } = makeDeps();
    const inc = await processDeferredCases([], { executeAction, getCases });
    expect(inc.details).toEqual([]);
  });
});
