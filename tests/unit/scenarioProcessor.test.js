// scenarioProcessor.test.js — TASK 0.4 + TASK v12 (contract extension)

import { describe, it, expect, vi } from 'vitest';
import {
  submitScenarioResult,
  validateEnvelope,
  buildCreateCaseParams,
  buildAddHearingParams,
  normalizeEnvelope,
  processDeferredCases,
  resolveAdvocateRoles,
  resolveCaseCategory,
  resolveRepresentedParties,
  buildCaseIdentity,
  effectiveNameSource,
  buildEnvelopeSkeleton,
  ADVOCATE_ROLE_VALUES,
  ENVELOPE_CATEGORY_VALUES,
  ENVELOPE_TO_CASE_CATEGORY,
  ENVELOPE_VERSION,
  SCENARIO_ID,
  SCENARIO_VERSION,
} from '../../src/services/ecits/scenarioProcessor.js';
import { normalizeCaseNoKey } from '../../src/services/ecits/caseNoKey.js';

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
  it('повідомлення про відсутній data містить підказку про форму', () => {
    expect(() => validateEnvelope({ envelopeVersion: 1, scenarioId: 'ecits_import_cases_and_hearings' }))
      .toThrow(/envelopeVersion.*scenarioId.*data.*cases/);
  });
});

describe('buildCreateCaseParams', () => {
  it('виставляє origin=ecits_import; ecitsCaseId з envelope ігнорується (правило #11)', () => {
    const { params: p, warnings } = buildCreateCaseParams({
      ecitsCaseId: 'hex_ignored',
      case_no: '450/2275/25',
      court: 'Київський суд',
      category: 'civil',
      primaryParty: 'Бабенко О.І.',
    });
    expect(p.origin).toBe('ecits_import');
    // ecitsState — контейнер sync-метаданих; per-proceeding ecitsCaseId
    // прибрано з активного коду (TASK ecits_identity_by_caseno).
    expect(p.ecitsState).toBeDefined();
    expect('caseId' in p.ecitsState).toBe(false);
    expect(p.ecitsState._lastSource).toBe('court_sync');
    expect(p.ecitsState.syncStatus).toBe('synced');
    expect(p.name).toContain('[ЄСІТС]');
    expect(p.client).toBe('Бабенко О.І.');
    expect(warnings).toEqual([]);
  });
  it('відсутній ecitsCaseId в envelope — не валить імпорт', () => {
    const { params: p, warnings } = buildCreateCaseParams({
      ecitsCaseId: null,
      case_no: '450/2275/25',
      primaryParty: 'X',
    });
    expect(p.case_no).toBe('450/2275/25');
    expect(warnings).toEqual([]);
  });
});

describe('normalizeCaseNoKey — спільний хелпер дедупу', () => {
  it('повний номер з суфіксом-літерою → ключ без суфікса (адвокат: усі провадження живуть під одним case_no)', () => {
    expect(normalizeCaseNoKey('761/15469/20-Ц')).toBe('761/15469/20');
    expect(normalizeCaseNoKey('761/15469/20-ц')).toBe('761/15469/20');
    expect(normalizeCaseNoKey('761/15469/20')).toBe('761/15469/20');
  });
  it('кириличний і латинський суфікс зливаються', () => {
    expect(normalizeCaseNoKey('500/55/26-A')).toBe('500/55/26');
    expect(normalizeCaseNoKey('500/55/26-а')).toBe('500/55/26');
  });
  it('внутрішні і оточуючі пробіли прибирає', () => {
    expect(normalizeCaseNoKey('  450 / 2275 / 25  ')).toBe('450/2275/25');
  });
  it('lower-case однаково трактує регістр', () => {
    expect(normalizeCaseNoKey('761/15469/20-Ц'))
      .toBe(normalizeCaseNoKey('761/15469/20-ц'));
  });
  it('null/undefined/порожній рядок → null', () => {
    expect(normalizeCaseNoKey(null)).toBeNull();
    expect(normalizeCaseNoKey(undefined)).toBeNull();
    expect(normalizeCaseNoKey('')).toBeNull();
    expect(normalizeCaseNoKey('   ')).toBeNull();
  });
  it('нерядок → null (не кидає)', () => {
    expect(normalizeCaseNoKey(123)).toBeNull();
    expect(normalizeCaseNoKey({})).toBeNull();
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
          case_no: params.case_no, // потрібно для case_no-дедупу (TASK ecits_identity_by_caseno)
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

  it('використовує update_case_ecits_state якщо справа з тим самим case_no уже є', async () => {
    const { executeAction, calls } = makeDeps();
    const existing = [{
      id: 'case_existing',
      case_no: '450/2275/25',
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

  it('матч існуючої справи з кінцевим суфіксом-літерою — нормалізація case_no', async () => {
    const { executeAction, calls } = makeDeps();
    // У registry лежить версія з суфіксом (введена адвокатом вручну).
    const existing = [{
      id: 'case_with_suffix',
      case_no: '450/2275/25-Ц',
      hearings: [],
    }];
    // Envelope приходить без суфікса. normalizeCaseNoKey має звести.
    const res = await submitScenarioResult(makeEnvelope(), {
      executeAction,
      getCases: () => existing,
    });
    expect(res.casesCreated).toBe(0);
    expect(res.casesUpdated).toBe(1);
    expect(calls.find(c => c.action === 'create_case')).toBeUndefined();
  });

  it('пропускає дублі засідань (за датою+часом)', async () => {
    const { executeAction } = makeDeps();
    const existing = [{
      id: 'case_existing',
      case_no: '450/2275/25',
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

  it('ecitsCaseId=null БІЛЬШЕ НЕ блокує — справа заводиться за case_no', async () => {
    const { executeAction, getCases } = makeDeps();
    const env = makeEnvelope();
    env.data.cases[0].ecitsCaseId = null; // реальний сценарій 2026-06-09
    const res = await submitScenarioResult(env, { executeAction, getCases });
    expect(res.skipped).toBe(0);
    expect(res.casesCreated).toBe(1);
    expect(res.errors).toHaveLength(0);
  });

  it('відсутній case_no → skip з ясною помилкою', async () => {
    const { executeAction, getCases } = makeDeps();
    const env = makeEnvelope();
    env.data.cases[0].case_no = null;
    env.data.cases[0].ecitsCaseId = null;
    const res = await submitScenarioResult(env, { executeAction, getCases });
    expect(res.skipped).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/case_no/);
  });

  it('within-run dedup: два envelope-кейси з тим самим case_no → одна справа (потрібен живий getCases)', async () => {
    const { executeAction, calls, getCases } = makeDeps();
    const env = makeEnvelope();
    // Додаємо другий кейс з тим самим case_no (інша назва провадження,
    // інший hearing). Зміна C: scenarioProcessor під час другої ітерації
    // має бачити щойно створену справу.
    env.data.cases.push({
      ...env.data.cases[0],
      ecitsCaseId: null,                       // реальний 2026-06-09 кейс
      hearings: [{ date: '2026-07-10', time: '10:00' }],
    });
    const res = await submitScenarioResult(env, { executeAction, getCases });
    expect(res.casesCreated).toBe(1);
    expect(res.casesUpdated).toBe(1);
    expect(res.hearingsAdded).toBe(2);
    expect(calls.filter(c => c.action === 'create_case')).toHaveLength(1);
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

// ── TASK represented_parties — CREATE зі списком сторін + nameSource ───────
describe('TASK represented_parties — resolveRepresentedParties / buildCaseIdentity', () => {
  it('representedParties[] має пріоритет над primaryParty', () => {
    expect(resolveRepresentedParties({
      representedParties: ['Іваненко І.І.', 'Петренко П.П.'],
      primaryParty: 'Іваненко І.І.',
    })).toEqual(['Іваненко І.І.', 'Петренко П.П.']);
  });
  it('fallback на primaryParty коли representedParties відсутній (старі envelope)', () => {
    expect(resolveRepresentedParties({ primaryParty: 'Бабенко О.І.' })).toEqual(['Бабенко О.І.']);
  });
  it('без сторін → порожній масив', () => {
    expect(resolveRepresentedParties({})).toEqual([]);
    expect(resolveRepresentedParties({ representedParties: [] })).toEqual([]);
  });
  it('фільтрує сміття (нерядки, порожні)', () => {
    expect(resolveRepresentedParties({ representedParties: ['А', '', null, '  ', 42, 'Б'] }))
      .toEqual(['А', 'Б']);
  });
  it('buildCaseIdentity: список → "[ЄСІТС] А, Б (no)" + client join', () => {
    const id = buildCaseIdentity({
      case_no: '757/9362/25',
      representedParties: ['Бабенко О.І.', 'Бабенко П.П.'],
    });
    expect(id.name).toBe('[ЄСІТС] Бабенко О.І., Бабенко П.П. (757/9362/25)');
    expect(id.client).toBe('Бабенко О.І., Бабенко П.П.');
  });
  it('buildCaseIdentity: без сторін → fallback "[ЄСІТС] case_no", client null', () => {
    const id = buildCaseIdentity({ case_no: '450/2275/25' });
    expect(id.name).toBe('[ЄСІТС] 450/2275/25');
    expect(id.client).toBeNull();
  });
});

describe('TASK represented_parties — effectiveNameSource', () => {
  it('явне auto/manual повертається як є', () => {
    expect(effectiveNameSource({ nameSource: 'auto', name: 'X' })).toBe('auto');
    expect(effectiveNameSource({ nameSource: 'manual', name: '[ЄСІТС] X' })).toBe('manual');
  });
  it('без nameSource → виводиться за префіксом "[ЄСІТС] "', () => {
    expect(effectiveNameSource({ name: '[ЄСІТС] Пироженко Є.В. (363/4635/25)' })).toBe('auto');
    expect(effectiveNameSource({ name: 'Іваненко проти ТОВ' })).toBe('manual');
  });
  it('невалідне значення nameSource → лінивий дефолт (консервативно)', () => {
    expect(effectiveNameSource({ nameSource: 'garbage', name: 'X' })).toBe('manual');
    expect(effectiveNameSource(null)).toBe('manual');
  });
});

describe('TASK represented_parties — buildCreateCaseParams зі списком', () => {
  it('список → назва зі всіма сторонами, client join, nameSource auto', () => {
    const { params } = buildCreateCaseParams({
      case_no: '757/9362/25',
      representedParties: ['Бабенко О.І.', 'Бабенко П.П.'],
    });
    expect(params.name).toBe('[ЄСІТС] Бабенко О.І., Бабенко П.П. (757/9362/25)');
    expect(params.client).toBe('Бабенко О.І., Бабенко П.П.');
    expect(params.nameSource).toBe('auto');
  });
  it('один елемент → як раніше з primaryParty', () => {
    const { params } = buildCreateCaseParams({
      case_no: '450/2275/25',
      representedParties: ['Бабенко О.І.'],
    });
    expect(params.name).toBe('[ЄСІТС] Бабенко О.І. (450/2275/25)');
    expect(params.client).toBe('Бабенко О.І.');
  });
  it('старий envelope (тільки primaryParty) → ідентичний попередній шаблон', () => {
    const { params } = buildCreateCaseParams({
      case_no: '450/2275/25',
      primaryParty: 'Бабенко О.І.',
    });
    expect(params.name).toBe('[ЄСІТС] Бабенко О.І. (450/2275/25)');
    expect(params.client).toBe('Бабенко О.І.');
    expect(params.nameSource).toBe('auto');
  });
  it('без сторін → fallback case_no (як зараз)', () => {
    const { params } = buildCreateCaseParams({ case_no: '450/2275/25' });
    expect(params.name).toBe('[ЄСІТС] 450/2275/25');
    expect(params.client).toBeNull();
  });
  it('representedPartiesFullNames зберігається top-level для майбутнього backfill', () => {
    const { params } = buildCreateCaseParams({
      case_no: '757/9362/25',
      representedParties: ['Бабенко О.І.'],
      representedPartiesFullNames: ['Бабенко Олена Іванівна'],
    });
    expect(params.representedPartiesFullNames).toEqual(['Бабенко Олена Іванівна']);
  });
  it('без representedPartiesFullNames поле НЕ додається (старі envelope без змін)', () => {
    const { params } = buildCreateCaseParams({ case_no: '450/2275/25', primaryParty: 'X' });
    expect('representedPartiesFullNames' in params).toBe(false);
  });
});

describe('TASK represented_parties — UPDATE існуючої через update_case_identity', () => {
  function makeUpdateDeps(existingCases) {
    const calls = [];
    const cases = existingCases;
    const executeAction = vi.fn(async (agentId, action, params) => {
      calls.push({ agentId, action, params });
      if (action === 'update_case_identity') {
        const c = cases.find(x => x.id === params.caseId);
        if (!c) return { success: false, error: 'not found' };
        if (params.name !== undefined) c.name = params.name;
        if (params.client !== undefined) c.client = params.client;
        if (params.nameSource !== undefined) c.nameSource = params.nameSource;
        return { success: true };
      }
      if (action === 'update_case_ecits_state') return { success: true };
      if (action === 'add_hearing') return { success: true };
      return { success: false, error: `unknown ${action}` };
    });
    return { executeAction, calls, getCases: () => cases };
  }

  function envelopeWithParties(case_no, representedParties) {
    const env = makeEnvelope();
    env.data.cases = [{
      case_no,
      court: 'Суд',
      category: 'civil',
      representedParties,
      hearings: [],
    }];
    return env;
  }

  it('existing auto (за префіксом, без імені) + representedParties → name/client оновлені (кейс Бабенків)', async () => {
    const existing = [{ id: 'c1', name: '[ЄСІТС] 757/9362/25-ц', case_no: '757/9362/25-ц', client: null, hearings: [] }];
    const { executeAction, calls, getCases } = makeUpdateDeps(existing);
    const res = await submitScenarioResult(
      envelopeWithParties('757/9362/25', ['Бабенко О.І.', 'Бабенко П.П.']),
      { executeAction, getCases },
    );
    expect(res.errors).toHaveLength(0);
    const idCall = calls.find(c => c.action === 'update_case_identity');
    expect(idCall).toBeTruthy();
    expect(idCall.params.name).toBe('[ЄСІТС] Бабенко О.І., Бабенко П.П. (757/9362/25)');
    expect(idCall.params.client).toBe('Бабенко О.І., Бабенко П.П.');
    expect(idCall.params.nameSource).toBe('auto');   // court_sync НЕ ставить manual
    expect(idCall.params.source).toBe('court_sync');
    expect(existing[0].name).toBe('[ЄСІТС] Бабенко О.І., Бабенко П.П. (757/9362/25)');
  });

  it('кейс Махді: "[ЄСІТС] Пироженко Є.В. (363/4635/25)" → Махді А.С.', async () => {
    const existing = [{ id: 'c2', name: '[ЄСІТС] Пироженко Є.В. (363/4635/25)', case_no: '363/4635/25', client: 'Пироженко Є.В.', hearings: [] }];
    const { executeAction, getCases } = makeUpdateDeps(existing);
    await submitScenarioResult(
      envelopeWithParties('363/4635/25', ['Махді А.С.']),
      { executeAction, getCases },
    );
    expect(existing[0].name).toBe('[ЄСІТС] Махді А.С. (363/4635/25)');
    expect(existing[0].client).toBe('Махді А.С.');
    expect(existing[0].nameSource).toBe('auto');
  });

  it('existing manual → name/client НЕ чіпаються', async () => {
    const existing = [{ id: 'c3', name: '[ЄСІТС] Стара назва (1/1/25)', nameSource: 'manual', case_no: '1/1/25', client: 'Стара', hearings: [] }];
    const { executeAction, calls, getCases } = makeUpdateDeps(existing);
    await submitScenarioResult(envelopeWithParties('1/1/25', ['Нова Н.Н.']), { executeAction, getCases });
    expect(calls.find(c => c.action === 'update_case_identity')).toBeUndefined();
    expect(existing[0].name).toBe('[ЄСІТС] Стара назва (1/1/25)');
  });

  it('existing без nameSource і без префікса (ручна назва) → НЕ чіпається', async () => {
    const existing = [{ id: 'c4', name: 'Іваненко проти ТОВ', case_no: '2/2/25', client: 'Іваненко', hearings: [] }];
    const { executeAction, calls, getCases } = makeUpdateDeps(existing);
    await submitScenarioResult(envelopeWithParties('2/2/25', ['Хтось Х.Х.']), { executeAction, getCases });
    expect(calls.find(c => c.action === 'update_case_identity')).toBeUndefined();
    expect(existing[0].name).toBe('Іваненко проти ТОВ');
  });

  it('старий envelope БЕЗ representedParties → identity не викликається (поведінка незмінна)', async () => {
    const existing = [{ id: 'c5', name: '[ЄСІТС] 450/2275/25', case_no: '450/2275/25', client: null, hearings: [] }];
    const { executeAction, calls, getCases } = makeUpdateDeps(existing);
    await submitScenarioResult(makeEnvelope(), { executeAction, getCases }); // makeEnvelope має лише primaryParty
    expect(calls.find(c => c.action === 'update_case_identity')).toBeUndefined();
    expect(existing[0].name).toBe('[ЄСІТС] 450/2275/25');
  });

  it('identity вже актуальна → зайвого виклику немає (ідемпотентність)', async () => {
    const existing = [{
      id: 'c6',
      name: '[ЄСІТС] Махді А.С. (363/4635/25)',
      client: 'Махді А.С.',
      nameSource: 'auto',
      case_no: '363/4635/25',
      hearings: [],
    }];
    const { executeAction, calls, getCases } = makeUpdateDeps(existing);
    await submitScenarioResult(envelopeWithParties('363/4635/25', ['Махді А.С.']), { executeAction, getCases });
    expect(calls.find(c => c.action === 'update_case_identity')).toBeUndefined();
  });
});

// ── TASK v12 — Контракт-константи і скелет envelope ────────────────────────
describe('TASK v12 — експорт контракту', () => {
  it('ENVELOPE_VERSION/SCENARIO_ID/SCENARIO_VERSION незмінні (адитивні зміни)', () => {
    expect(ENVELOPE_VERSION).toBe(1);
    expect(SCENARIO_VERSION).toBe(1);
    expect(SCENARIO_ID).toBe('ecits_import_cases_and_hearings');
  });
  it('ADVOCATE_ROLE_VALUES містить рівно 11 канонічних значень', () => {
    expect(ADVOCATE_ROLE_VALUES).toHaveLength(11);
    expect(ADVOCATE_ROLE_VALUES).toContain('plaintiff_rep');
    expect(ADVOCATE_ROLE_VALUES).toContain('defender');
    expect(ADVOCATE_ROLE_VALUES).toContain('representative_unspecified');
  });
  it('ENVELOPE_CATEGORY_VALUES містить 5 значень + null (6 елементів)', () => {
    expect(ENVELOPE_CATEGORY_VALUES).toHaveLength(6);
    expect(ENVELOPE_CATEGORY_VALUES).toContain('civil');
    expect(ENVELOPE_CATEGORY_VALUES).toContain('commercial');
    expect(ENVELOPE_CATEGORY_VALUES).toContain('administrative_offense');
    expect(ENVELOPE_CATEGORY_VALUES).toContain(null);
  });
  it('ENVELOPE_TO_CASE_CATEGORY: administrative→admin, administrative_offense незмінне', () => {
    expect(ENVELOPE_TO_CASE_CATEGORY.administrative).toBe('admin');
    expect(ENVELOPE_TO_CASE_CATEGORY.administrative_offense).toBe('administrative_offense');
    expect(ENVELOPE_TO_CASE_CATEGORY.civil).toBe('civil');
    expect(ENVELOPE_TO_CASE_CATEGORY.commercial).toBe('commercial');
  });
  it('buildEnvelopeSkeleton повертає валідний каркас', () => {
    const sk = buildEnvelopeSkeleton();
    expect(() => validateEnvelope(sk)).not.toThrow();
    expect(sk.envelopeVersion).toBe(ENVELOPE_VERSION);
    expect(sk.scenarioId).toBe(SCENARIO_ID);
    expect(Array.isArray(sk.data.cases)).toBe(true);
  });
});

// ── TASK v12 §1 — Ролі: множинність + fallback ─────────────────────────────
describe('TASK v12 §1 — resolveAdvocateRoles', () => {
  it('масив advocateRoles[] лишається як є', () => {
    const r = resolveAdvocateRoles({ advocateRoles: ['advocate', 'plaintiff_rep'] });
    expect(r.advocateRoles).toEqual(['advocate', 'plaintiff_rep']);
    expect(r.advocateRole).toBe('advocate');
  });
  it('fallback з одного advocateRole у advocateRoles=[role]', () => {
    const r = resolveAdvocateRoles({ advocateRole: 'defender' });
    expect(r.advocateRoles).toEqual(['defender']);
    expect(r.advocateRole).toBe('defender');
  });
  it('нічого немає → пусто', () => {
    const r = resolveAdvocateRoles({});
    expect(r.advocateRoles).toEqual([]);
    expect(r.advocateRole).toBeNull();
  });
  it('невідомі ролі повертаються у unknownRoles, але не валять імпорт', () => {
    const r = resolveAdvocateRoles({ advocateRoles: ['plaintiff_rep', 'nonsense_role'] });
    expect(r.unknownRoles).toEqual(['nonsense_role']);
    expect(r.advocateRoles).toEqual(['plaintiff_rep', 'nonsense_role']);
  });
  it('buildCreateCaseParams виставляє advocateRole і advocateRoles top-level', () => {
    const { params, warnings } = buildCreateCaseParams({
      ecitsCaseId: 'h',
      case_no: '450/2275/25',
      advocateRoles: ['plaintiff_rep'],
    });
    expect(params.advocateRole).toBe('plaintiff_rep');
    expect(params.advocateRoles).toEqual(['plaintiff_rep']);
    expect(warnings).toEqual([]);
  });
  it('buildCreateCaseParams додає warning при невідомій ролі', () => {
    const { params, warnings } = buildCreateCaseParams({
      ecitsCaseId: 'h',
      case_no: '450/2275/25',
      advocateRole: 'ghost_role',
    });
    expect(params.advocateRole).toBe('ghost_role');
    expect(warnings.some((w) => /ghost_role/.test(w))).toBe(true);
  });
});

// ── TASK v12 §2 — Мапа категорій ────────────────────────────────────────────
describe('TASK v12 §2 — resolveCaseCategory + ENVELOPE_TO_CASE_CATEGORY', () => {
  it('administrative → admin (звести один сенс)', () => {
    expect(resolveCaseCategory({ category: 'administrative', case_no: 'x' }).category).toBe('admin');
  });
  it('administrative_offense лишається administrative_offense (≠ admin)', () => {
    expect(resolveCaseCategory({ category: 'administrative_offense', case_no: 'x' }).category)
      .toBe('administrative_offense');
  });
  it('commercial → commercial', () => {
    expect(resolveCaseCategory({ category: 'commercial', case_no: 'x' }).category).toBe('commercial');
  });
  it('null → null без warning', () => {
    const r = resolveCaseCategory({ category: null, case_no: 'x' });
    expect(r.category).toBeNull();
    expect(r.warning).toBeNull();
  });
  it('відсутнє → null без warning', () => {
    const r = resolveCaseCategory({ case_no: 'x' });
    expect(r.category).toBeNull();
    expect(r.warning).toBeNull();
  });
  it('невідоме непорожнє → null + warning', () => {
    const r = resolveCaseCategory({ category: 'mystery', case_no: '450/2275/25' });
    expect(r.category).toBeNull();
    expect(r.warning).toMatch(/mystery/);
    expect(r.warning).toMatch(/450\/2275\/25/);
  });
});

// ── TASK v12 §4 — Дати пласко з envelope → ecitsState ──────────────────────
describe('TASK v12 §4 — firstDocumentDate/lastDocumentDate', () => {
  it('пласко з envelope потрапляють у ecitsState', () => {
    const { params } = buildCreateCaseParams({
      ecitsCaseId: 'h',
      case_no: '450/2275/25',
      firstDocumentDate: '2025-01-15',
      lastDocumentDate: '2026-05-30',
    });
    expect(params.ecitsState.firstDocumentDate).toBe('2025-01-15');
    expect(params.ecitsState.lastDocumentDate).toBe('2026-05-30');
  });
  it('відсутні дати → null у ecitsState', () => {
    const { params } = buildCreateCaseParams({
      ecitsCaseId: 'h',
      case_no: '450/2275/25',
    });
    expect(params.ecitsState.firstDocumentDate).toBeNull();
    expect(params.ecitsState.lastDocumentDate).toBeNull();
  });
});

// ── TASK v12 §3 — likelyNotMine: партиціонування + processDeferredCases ────
describe('TASK v12 §3 — likelyNotMine партиціонування', () => {
  function makeDepsLocal() {
    const cases = [];
    const calls = [];
    const executeAction = vi.fn(async (agentId, action, params) => {
      calls.push({ agentId, action, params });
      if (action === 'create_case') {
        const newCase = {
          id: `case_${cases.length + 1}`,
          ecitsState: params.ecitsState,
          advocateRole: params.advocateRole,
          advocateRoles: params.advocateRoles,
          origin: params.origin,
          hearings: [],
        };
        cases.push(newCase);
        return { success: true, caseId: newCase.id };
      }
      if (action === 'add_hearing') {
        const c = cases.find((x) => x.id === params.caseId);
        if (c) c.hearings.push({ id: `h_${c.hearings.length + 1}`, date: params.date, time: params.time });
        return { success: true };
      }
      if (action === 'update_case_ecits_state') return { success: true };
      return { success: false, error: 'unknown' };
    });
    return { executeAction, calls, cases, getCases: () => cases };
  }

  it('likelyNotMine=true → справа НЕ створюється, потрапляє у pendingReview', async () => {
    const env = makeEnvelope();
    env.data.cases.push({
      ecitsCaseId: 'deferred_hex',
      case_no: '999/9/26',
      court: 'X',
      category: 'civil',
      advocateRole: 'representative_unspecified',
      advocateRoles: ['representative_unspecified'],
      likelyNotMine: true,
      hearings: [],
    });
    const { executeAction, calls, getCases } = makeDepsLocal();
    const res = await submitScenarioResult(env, { executeAction, getCases });

    // Авто-кейс (перший) створений; deferred — НЕ створений.
    expect(res.casesCreated).toBe(1);
    expect(res.pendingReview).toHaveLength(1);
    expect(res.pendingReview[0].ecitsCaseId).toBe('deferred_hex');

    const createCalls = calls.filter((c) => c.action === 'create_case');
    expect(createCalls).toHaveLength(1);
    // Створена тільки авто-справа, deferred-кейс лишається у pendingReview.
    expect(createCalls[0].params.case_no).toBe('450/2275/25');
  });

  it('skipped НЕ збільшується для likelyNotMine (окрема корзина)', async () => {
    const env = makeEnvelope();
    env.data.cases[0].likelyNotMine = true; // зробимо єдиний кейс deferred
    const { executeAction, getCases } = makeDepsLocal();
    const res = await submitScenarioResult(env, { executeAction, getCases });
    expect(res.casesCreated).toBe(0);
    expect(res.skipped).toBe(0);
    expect(res.pendingReview).toHaveLength(1);
  });

  it('processDeferredCases створює обрані кейси (без повторного скрейпінгу)', async () => {
    const env = makeEnvelope();
    env.data.cases[0].likelyNotMine = true;
    const { executeAction, getCases } = makeDepsLocal();
    const res = await submitScenarioResult(env, { executeAction, getCases });
    expect(res.pendingReview).toHaveLength(1);

    const inc = await processDeferredCases(res.pendingReview, { executeAction, getCases });
    expect(inc.casesCreated).toBe(1);
    expect(inc.hearingsAdded).toBe(1); // у makeEnvelope єдиному кейсу — 1 hearing
  });

  it('processDeferredCases на порожньому масиві повертає нульовий результат', async () => {
    const { executeAction, getCases } = makeDepsLocal();
    const inc = await processDeferredCases([], { executeAction, getCases });
    expect(inc.casesCreated).toBe(0);
    expect(inc.hearingsAdded).toBe(0);
  });

  it('processDeferredCases без executeAction кидає', async () => {
    await expect(processDeferredCases([], {})).rejects.toThrow(/executeAction/);
  });
});

// ── TASK v12 §11 — Робастність normalizeEnvelope ───────────────────────────
describe('TASK v12 §11 — normalizeEnvelope', () => {
  it('обгортає top-level cases[] у data', () => {
    const raw = {
      envelopeVersion: 1,
      scenarioId: SCENARIO_ID,
      cases: [{ ecitsCaseId: 'h', case_no: 'x', hearings: [] }],
    };
    const { envelope, normalizationWarnings } = normalizeEnvelope(raw);
    expect(envelope.data).toBeDefined();
    expect(envelope.data.cases).toHaveLength(1);
    expect(normalizationWarnings.some((w) => /data-обгортки/.test(w))).toBe(true);
    expect(() => validateEnvelope(envelope)).not.toThrow();
  });

  it('warnings-об\'єкти → рядки (усуває React #31)', () => {
    const raw = {
      envelopeVersion: 1,
      scenarioId: SCENARIO_ID,
      data: {
        cases: [],
        warnings: [{ case_no: '1/2/26', message: 'щось дивне' }, 'нормальний рядок'],
      },
    };
    const { envelope, normalizationWarnings } = normalizeEnvelope(raw);
    expect(envelope.data.warnings.every((w) => typeof w === 'string')).toBe(true);
    expect(envelope.data.warnings[0]).toBe('1/2/26: щось дивне');
    expect(envelope.data.warnings[1]).toBe('нормальний рядок');
    expect(normalizationWarnings.some((w) => /об'єкти/.test(w))).toBe(true);
  });

  it('відсутні версії/scenarioId → канонічні дефолти + warnings', () => {
    const raw = { data: { cases: [] } };
    const { envelope, normalizationWarnings } = normalizeEnvelope(raw);
    expect(envelope.envelopeVersion).toBe(ENVELOPE_VERSION);
    expect(envelope.scenarioId).toBe(SCENARIO_ID);
    expect(envelope.scenarioVersion).toBe(SCENARIO_VERSION);
    expect(normalizationWarnings.length).toBeGreaterThanOrEqual(3);
  });

  it('повністю битий envelope (null) — не падає, validateEnvelope кине', () => {
    const { envelope } = normalizeEnvelope(null);
    expect(envelope).toBeNull();
    expect(() => validateEnvelope(envelope)).toThrow();
  });

  it('submitScenarioResult приймає envelope без data-обгортки і нормалізує', async () => {
    const raw = {
      envelopeVersion: 1,
      scenarioId: SCENARIO_ID,
      cases: [{
        ecitsCaseId: 'hex_x',
        case_no: '450/2275/25',
        court: 'Київський суд',
        category: 'civil',
        advocateRole: 'plaintiff_rep',
        primaryParty: 'X',
        hearings: [],
      }],
    };
    const executeAction = vi.fn(async (aid, act, p) => {
      if (act === 'create_case') return { success: true, caseId: 'case_1' };
      return { success: true };
    });
    const res = await submitScenarioResult(raw, { executeAction, getCases: () => [] });
    expect(res.casesCreated).toBe(1);
    expect(res.warnings.some((w) => /data-обгортки/.test(w))).toBe(true);
  });
});
