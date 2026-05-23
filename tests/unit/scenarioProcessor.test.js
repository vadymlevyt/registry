// scenarioProcessor.test.js — TASK 0.4

import { describe, it, expect, vi } from 'vitest';
import {
  submitScenarioResult,
  validateEnvelope,
  buildCreateCaseParams,
  buildAddHearingParams,
} from '../../src/services/ecits/scenarioProcessor.js';

function makeEnvelope(overrides = {}) {
  return {
    envelopeVersion: 1,
    scenarioId: 'ecits_import_cases_and_hearings',
    scenarioVersion: 1,
    producedAt: '2026-05-23T10:00:00.000Z',
    producedBy: { provider: 'claude_for_chrome', providerVersion: 'sonnet-4.6' },
    data: {
      ecitsAdvocate: { fullName: 'Левицький В.А.', cabinetIdentifier: null },
      stats: { totalCasesInCabinet: 1, filtered: 1, withHearings2026: 1 },
      cases: [{
        ecitsCaseId: 'abc123def456abc123def456abc123de',
        case_no: '450/2275/25',
        court: 'Київський суд',
        category: 'civil',
        advocateRole: 'plaintiff_rep',
        primaryParty: 'Бабенко О.І.',
        primaryPartyFullName: 'Бабенко Олена Іванівна',
        cabinetUrl: 'https://cabinet.court.gov.ua/cases/case=abc123def456abc123def456abc123de',
        hearings: [{
          date: '2026-05-25',
          time: '08:50',
          court: 'Київський суд',
          hearingRoom: '336',
          proceedingNumber: '6-392/26',
          cabinetUrl: 'https://cabinet.court.gov.ua/...',
          noticeType: 'Судова повістка',
        }],
      }],
      warnings: [],
      skipped: [],
    },
    ...overrides,
  };
}

describe('validateEnvelope', () => {
  it('приймає валідний envelope', () => {
    expect(() => validateEnvelope(makeEnvelope())).not.toThrow();
  });
  it('відхиляє невалідну версію', () => {
    expect(() => validateEnvelope({ envelopeVersion: 99, scenarioId: 'x', data: { cases: [] } }))
      .toThrow(/envelopeVersion/);
  });
  it('відхиляє невідомий scenarioId', () => {
    expect(() => validateEnvelope({ envelopeVersion: 1, scenarioId: 'other', data: { cases: [] } }))
      .toThrow(/scenarioId/);
  });
  it('відхиляє відсутні data', () => {
    expect(() => validateEnvelope({ envelopeVersion: 1, scenarioId: 'ecits_import_cases_and_hearings' }))
      .toThrow(/data/);
  });
  it('відхиляє відсутні cases масив', () => {
    expect(() => validateEnvelope({ envelopeVersion: 1, scenarioId: 'ecits_import_cases_and_hearings', data: {} }))
      .toThrow(/cases/);
  });
});

describe('buildCreateCaseParams', () => {
  it('виставляє origin=ecits_import і ecitsState.caseId', () => {
    const p = buildCreateCaseParams({
      ecitsCaseId: 'hex',
      case_no: '450/2275/25',
      court: 'Київський суд',
      category: 'civil',
      primaryParty: 'Бабенко О.І.',
    });
    expect(p.origin).toBe('ecits_import');
    expect(p.ecitsState.caseId).toBe('hex');
    expect(p.ecitsState._lastSource).toBe('court_sync');
    expect(p.ecitsState.syncStatus).toBe('synced');
    expect(p.name).toContain('[ЄСІТС]');
    expect(p.client).toBe('Бабенко О.І.');
  });
});

describe('buildAddHearingParams', () => {
  it('завжди ставить source=court_sync', () => {
    const p = buildAddHearingParams('case_1', {
      date: '2026-05-25', time: '08:50',
      noticeType: 'Судова повістка',
      cabinetUrl: 'https://...',
    });
    expect(p.source).toBe('court_sync');
    expect(p.sourceConfidence).toBe('high');
    expect(p.ecitsContext.cabinetUrl).toBe('https://...');
    expect(p.ecitsContext.notificationDocumentType).toBe('Судова повістка');
  });
});

describe('submitScenarioResult — інтеграція через mock executeAction', () => {
  function makeDeps() {
    const calls = [];
    const cases = [];
    const executeAction = vi.fn(async (agentId, action, params) => {
      calls.push({ agentId, action, params });
      if (action === 'create_case') {
        const newCase = {
          id: `case_${cases.length + 1}`,
          origin: params.origin,
          ecitsState: params.ecitsState,
          hearings: [],
        };
        cases.push(newCase);
        return { success: true, caseId: newCase.id };
      }
      if (action === 'add_hearing') {
        const c = cases.find(x => x.id === params.caseId);
        if (c) c.hearings.push({ id: `h_${c.hearings.length + 1}`, date: params.date, time: params.time });
        return { success: true, hearingId: 'h_x' };
      }
      if (action === 'update_case_ecits_state') {
        return { success: true };
      }
      return { success: false, error: `unknown ${action}` };
    });
    return {
      executeAction,
      calls,
      cases,
      getCases: () => cases,
    };
  }

  it('кидає коли deps.executeAction відсутній', async () => {
    await expect(submitScenarioResult(makeEnvelope(), {})).rejects.toThrow(/executeAction/);
  });

  it('обробляє нову справу — create_case + add_hearing', async () => {
    const { executeAction, calls, getCases } = makeDeps();
    const res = await submitScenarioResult(makeEnvelope(), { executeAction, getCases });
    expect(res.casesCreated).toBe(1);
    expect(res.hearingsAdded).toBe(1);
    expect(res.errors).toHaveLength(0);
    const createCall = calls.find(c => c.action === 'create_case');
    expect(createCall.params.origin).toBe('ecits_import');
    expect(createCall.agentId).toBe('court_sync_agent');
    const addCall = calls.find(c => c.action === 'add_hearing');
    expect(addCall.params.source).toBe('court_sync');
  });

  it('використовує update_case_ecits_state якщо справа з тим самим ecitsCaseId уже є', async () => {
    const { executeAction, calls } = makeDeps();
    const existing = [{
      id: 'case_existing',
      ecitsState: { caseId: 'abc123def456abc123def456abc123de' },
      hearings: [],
    }];
    const res = await submitScenarioResult(makeEnvelope(), {
      executeAction,
      getCases: () => existing,
    });
    expect(res.casesCreated).toBe(0);
    expect(res.casesUpdated).toBe(1);
    expect(calls.find(c => c.action === 'create_case')).toBeUndefined();
    expect(calls.find(c => c.action === 'update_case_ecits_state')).toBeTruthy();
  });

  it('пропускає дублі засідань (за датою+часом)', async () => {
    const { executeAction } = makeDeps();
    const existing = [{
      id: 'case_existing',
      ecitsState: { caseId: 'abc123def456abc123def456abc123de' },
      hearings: [{ id: 'h1', date: '2026-05-25', time: '08:50' }],
    }];
    const res = await submitScenarioResult(makeEnvelope(), {
      executeAction,
      getCases: () => existing,
    });
    expect(res.hearingsAdded).toBe(0);
  });

  it('записує запис у scenario history якщо deps.appendScenarioHistoryEntry передано', async () => {
    const { executeAction, getCases } = makeDeps();
    const history = [];
    const res = await submitScenarioResult(makeEnvelope(), {
      executeAction,
      getCases,
      appendScenarioHistoryEntry: (entry) => history.push(entry),
    });
    expect(history).toHaveLength(1);
    expect(history[0].scenarioRunId).toBe(res.scenarioRunId);
    expect(history[0].status).toBe('completed');
    expect(history[0].transport).toBe('manual_paste');
  });

  it('пропускає кейс без ecitsCaseId і фіксує помилку', async () => {
    const { executeAction, getCases } = makeDeps();
    const env = makeEnvelope();
    env.data.cases[0].ecitsCaseId = null;
    const res = await submitScenarioResult(env, { executeAction, getCases });
    expect(res.skipped).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/ecitsCaseId/);
  });

  it('викликає onProgress для кожної справи', async () => {
    const { executeAction, getCases } = makeDeps();
    const progress = [];
    await submitScenarioResult(makeEnvelope(), {
      executeAction, getCases,
      onProgress: (msg) => progress.push(msg),
    });
    expect(progress.length).toBeGreaterThanOrEqual(1);
    expect(progress[0]).toMatch(/Обробка 1/);
  });
});
