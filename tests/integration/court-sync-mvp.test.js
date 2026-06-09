// court-sync-mvp.test.js — TASK 0.4 E2E
// Перевіряє повний flow: envelope з Claude for Chrome → scenarioProcessor →
// executeAction → cases[] оновлено + білінг НЕ нараховує (R5 fix).

import { describe, it, expect, vi } from 'vitest';
import { createActions } from '../../src/services/actionsRegistry.js';
import { submitScenarioResult, processDeferredCases } from '../../src/services/ecits/scenarioProcessor.js';
import goldenFixture from '../fixtures/ecits_envelope_2026-06-09.json';

function makeEnvelope() {
  return {
    envelopeVersion: 1,
    scenarioId: 'ecits_import_cases_and_hearings',
    scenarioVersion: 1,
    producedAt: '2026-05-23T10:00:00.000Z',
    producedBy: { provider: 'claude_for_chrome', providerVersion: 'sonnet-4.6' },
    data: {
      ecitsAdvocate: { fullName: 'Левицький В.А.', cabinetIdentifier: null },
      stats: { totalCasesInCabinet: 2, filtered: 2, withHearings2026: 2 },
      cases: [
        {
          ecitsCaseId: 'aa111111111111111111111111111111',
          case_no: '450/2275/25',
          court: 'Київський суд',
          category: 'civil',
          advocateRole: 'plaintiff_rep',
          primaryParty: 'Бабенко О.І.',
          cabinetUrl: 'https://cabinet.court.gov.ua/cases/case=aa1',
          hearings: [
            { date: '2026-05-25', time: '08:50', court: 'Київський суд',
              hearingRoom: '336', proceedingNumber: '6-392/26',
              cabinetUrl: 'https://...', noticeType: 'Судова повістка' },
          ],
        },
        {
          ecitsCaseId: 'bb222222222222222222222222222222',
          case_no: '367/4744/26',
          court: 'Подільський суд',
          category: 'civil',
          advocateRole: 'defendant_rep',
          primaryParty: 'ТОВ "Альфа"',
          cabinetUrl: 'https://cabinet.court.gov.ua/cases/case=bb2',
          hearings: [
            { date: '2026-06-10', time: '10:00', court: 'Подільський суд',
              hearingRoom: '202', proceedingNumber: '6-500/26',
              cabinetUrl: 'https://...', noticeType: 'Ухвала про виклик' },
          ],
        },
      ],
      warnings: [],
      skipped: [],
    },
  };
}

function makeHarness({ initialCases = [] } = {}) {
  let cases = JSON.parse(JSON.stringify(initialCases));
  const auditLog = [];
  const timeEntries = [];
  // Recorder для activityTracker.report — критично для R5 fix перевірки.
  const trackerCalls = [];
  const tracker = {
    report: (action, payload) => trackerCalls.push({ action, payload }),
    startSession: () => null, endSession: () => null,
    startSubtimer: () => null, endSubtimer: () => null,
    updateSubtimer: () => false, assignOfflinePeriod: () => null,
  };

  const { executeAction } = createActions({
    getCases: () => cases,
    setCases: (u) => { cases = typeof u === 'function' ? u(cases) : u; },
    setNotes: () => {},
    setTimeEntries: (u) => { const next = typeof u === 'function' ? u(timeEntries) : u; timeEntries.length = 0; timeEntries.push(...(next || [])); },
    saveNotesToLS: () => {},
    writeAudit: (p) => { auditLog.push(p); return { id: `a_${auditLog.length}` }; },
    checkTenantAccess: () => true,
    checkRolePermission: () => true,
    checkCaseAccess: () => true,
    activityTracker: tracker,
    eventBus: { publish: () => {} },
    deleteDriveFile: async () => {},
    deleteOcrCacheForDocument: async () => {},
    deleteExtendedForDocument: async () => {},
  });

  return {
    executeAction,
    getCases: () => cases,
    getTrackerCalls: () => trackerCalls,
    getAuditLog: () => auditLog,
  };
}

describe('Court Sync MVP — повний flow', () => {
  it('первинна синхронізація: створює 2 справи з origin=ecits_import і додає по 1 засіданню', async () => {
    const h = makeHarness();
    const res = await submitScenarioResult(makeEnvelope(), {
      executeAction: h.executeAction,
      getCases: h.getCases,
    });
    expect(res.casesCreated).toBe(2);
    expect(res.casesUpdated).toBe(0);
    expect(res.hearingsAdded).toBe(2);
    expect(res.errors).toHaveLength(0);

    const cases = h.getCases();
    expect(cases).toHaveLength(2);
    expect(cases.every(c => c.origin === 'ecits_import')).toBe(true);
    expect(cases.every(c => c.ecitsState?.caseId)).toBe(true);
    expect(cases.every(c => c.hearings.length === 1)).toBe(true);
    expect(cases.every(c => c.hearings[0].source === 'court_sync')).toBe(true);
  });

  it('R5 fix: ЖОДНИЙ add_hearing з source=court_sync не нараховує time_entry', async () => {
    const h = makeHarness();
    await submitScenarioResult(makeEnvelope(), {
      executeAction: h.executeAction,
      getCases: h.getCases,
    });
    const hearingReports = h.getTrackerCalls().filter(c => c.action === 'add_hearing');
    expect(hearingReports).toHaveLength(0);
  });

  it('R5 fix: create_case з origin=ecits_import не нараховує time_entry', async () => {
    const h = makeHarness();
    await submitScenarioResult(makeEnvelope(), {
      executeAction: h.executeAction,
      getCases: h.getCases,
    });
    const createReports = h.getTrackerCalls().filter(c => c.action === 'create_case');
    expect(createReports).toHaveLength(0);
  });

  it('контроль: create_case з origin=manual нараховує', async () => {
    const h = makeHarness();
    await h.executeAction('qi_agent', 'create_case', {
      name: 'Ручна справа', case_no: 'M/1/26', origin: 'manual',
    });
    const createReports = h.getTrackerCalls().filter(c => c.action === 'create_case');
    expect(createReports).toHaveLength(1);
  });

  it('контроль: add_hearing з source=manual нараховує', async () => {
    const h = makeHarness({ initialCases: [{
      id: 'case_x', tenantId: 'ab_levytskyi', ownerId: 'vadym', name: 'X',
      hearings: [],
    }] });
    await h.executeAction('qi_agent', 'add_hearing', {
      caseId: 'case_x', date: '2026-06-01', time: '10:00', source: 'manual',
    });
    const reports = h.getTrackerCalls().filter(c => c.action === 'add_hearing');
    expect(reports).toHaveLength(1);
  });

  it('повторна синхронізація того ж envelope: 0 створено, 2 оновлено, 0 нових засідань', async () => {
    const h = makeHarness();
    await submitScenarioResult(makeEnvelope(), {
      executeAction: h.executeAction,
      getCases: h.getCases,
    });
    const res2 = await submitScenarioResult(makeEnvelope(), {
      executeAction: h.executeAction,
      getCases: h.getCases,
    });
    expect(res2.casesCreated).toBe(0);
    expect(res2.casesUpdated).toBe(2);
    expect(res2.hearingsAdded).toBe(0);
  });

  it('додає новий hearing при повторній синхронізації якщо він з\'явився', async () => {
    const h = makeHarness();
    await submitScenarioResult(makeEnvelope(), {
      executeAction: h.executeAction,
      getCases: h.getCases,
    });
    const env2 = makeEnvelope();
    env2.data.cases[0].hearings.push({
      date: '2026-07-15', time: '14:00', court: 'X',
      hearingRoom: '1', proceedingNumber: '6-1/26',
      cabinetUrl: 'https://...', noticeType: 'Повістка',
    });
    const res = await submitScenarioResult(env2, {
      executeAction: h.executeAction,
      getCases: h.getCases,
    });
    expect(res.hearingsAdded).toBe(1);
  });

  it('court_sync_agent НЕ може add_document (заборонено в PERMISSIONS)', async () => {
    const h = makeHarness({ initialCases: [{ id: 'case_x', tenantId: 'ab_levytskyi', ownerId: 'vadym', name: 'X', documents: [] }] });
    const result = await h.executeAction('court_sync_agent', 'add_document', { caseId: 'case_x', document: {} });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Немає повноважень/);
  });

  it('court_sync_agent МОЖЕ create_case (TASK 0.4)', async () => {
    const h = makeHarness();
    const result = await h.executeAction('court_sync_agent', 'create_case', {
      name: 'Test', origin: 'ecits_import',
      ecitsState: { caseId: 'unique_test_hex' },
    });
    expect(result.success).toBe(true);
  });

  it('create_case з ecitsState.caseId що вже існує повертає duplicate_ecits_case', async () => {
    const h = makeHarness();
    await h.executeAction('court_sync_agent', 'create_case', {
      name: 'First', origin: 'ecits_import',
      ecitsState: { caseId: 'dup_hex' },
    });
    const second = await h.executeAction('court_sync_agent', 'create_case', {
      name: 'Second', origin: 'ecits_import',
      ecitsState: { caseId: 'dup_hex' },
    });
    expect(second.success).toBe(false);
    expect(second.error).toBe('duplicate_ecits_case');
    expect(second.existingCaseId).toBeTruthy();
  });
});

// ── TASK v12 — наскрізний імпорт нового envelope ───────────────────────────
describe('TASK v12 — Court Sync MVP з розширеним контрактом', () => {
  function makeV12Envelope() {
    return {
      envelopeVersion: 1,
      scenarioId: 'ecits_import_cases_and_hearings',
      scenarioVersion: 1,
      producedAt: '2026-06-09T10:00:00.000Z',
      producedBy: { provider: 'claude_for_chrome', providerVersion: 'sonnet-4.7' },
      data: {
        ecitsAdvocate: { fullName: 'Левицький В.А.', cabinetIdentifier: null },
        stats: { totalCasesInCabinet: 4, filtered: 4, withHearings2026: 3 },
        cases: [
          // 1. multi-role + dates + new category
          {
            ecitsCaseId: 'v12a000000000000000000000000000a',
            case_no: '450/2275/25',
            court: 'Київський суд',
            category: 'commercial',
            advocateRole: 'advocate',
            advocateRoles: ['advocate', 'plaintiff_rep'],
            primaryParty: 'ТОВ "Альфа"',
            firstDocumentDate: '2025-03-01',
            lastDocumentDate: '2026-05-30',
            cabinetUrl: 'https://cabinet.court.gov.ua/cases/case=v12a',
            hearings: [
              { date: '2026-06-15', time: '10:00', noticeType: 'Повістка', cabinetUrl: '...' },
            ],
          },
          // 2. administrative → admin map
          {
            ecitsCaseId: 'v12b000000000000000000000000000b',
            case_no: '901/100/26',
            court: 'Окружний адмінсуд',
            category: 'administrative',
            advocateRole: 'plaintiff_rep',
            primaryParty: 'Петров П.П.',
            firstDocumentDate: null,
            lastDocumentDate: null,
            cabinetUrl: 'https://...',
            hearings: [],
          },
          // 3. administrative_offense ≠ admin
          {
            ecitsCaseId: 'v12c000000000000000000000000000c',
            case_no: '500/500/26',
            court: 'Місцевий суд',
            category: 'administrative_offense',
            advocateRole: 'advocate',
            primaryParty: 'Іванов І.І.',
            cabinetUrl: 'https://...',
            hearings: [{ date: '2026-07-01', time: '14:00' }],
          },
          // 4. likelyNotMine — пропустити у pendingReview
          {
            ecitsCaseId: 'v12d000000000000000000000000000d',
            case_no: '700/700/26',
            court: 'X',
            category: 'civil',
            advocateRole: 'representative_unspecified',
            advocateRoles: ['representative_unspecified'],
            likelyNotMine: true,
            primaryParty: null,
            primaryPartyFullName: null,
            firstDocumentDate: null,
            lastDocumentDate: null,
            cabinetUrl: 'https://...',
            hearings: [],
          },
        ],
        warnings: [],
        skipped: [],
      },
    };
  }

  it('новий envelope наскрізь: 3 auto-кейси заводяться, likelyNotMine у pendingReview', async () => {
    const h = makeHarness();
    const res = await submitScenarioResult(makeV12Envelope(), {
      executeAction: h.executeAction,
      getCases: h.getCases,
    });
    expect(res.casesCreated).toBe(3);
    expect(res.pendingReview).toHaveLength(1);
    expect(res.pendingReview[0].ecitsCaseId).toBe('v12d000000000000000000000000000d');
    expect(res.errors).toEqual([]);
    expect(res.hearingsAdded).toBe(2); // 1 + 0 + 1
  });

  it('категорії: administrative→admin, commercial→commercial, administrative_offense незмінне', async () => {
    const h = makeHarness();
    await submitScenarioResult(makeV12Envelope(), {
      executeAction: h.executeAction,
      getCases: h.getCases,
    });
    const cases = h.getCases();
    expect(cases.find((c) => c.case_no === '450/2275/25').category).toBe('commercial');
    expect(cases.find((c) => c.case_no === '901/100/26').category).toBe('admin');
    expect(cases.find((c) => c.case_no === '500/500/26').category).toBe('administrative_offense');
  });

  it('ролі: advocateRole і advocateRoles[] зберігаються top-level', async () => {
    const h = makeHarness();
    await submitScenarioResult(makeV12Envelope(), {
      executeAction: h.executeAction,
      getCases: h.getCases,
    });
    const multiRole = h.getCases().find((c) => c.case_no === '450/2275/25');
    expect(multiRole.advocateRole).toBe('advocate');
    expect(multiRole.advocateRoles).toEqual(['advocate', 'plaintiff_rep']);
  });

  it('дати: firstDocumentDate/lastDocumentDate пишуться у ecitsState', async () => {
    const h = makeHarness();
    await submitScenarioResult(makeV12Envelope(), {
      executeAction: h.executeAction,
      getCases: h.getCases,
    });
    const c = h.getCases().find((x) => x.case_no === '450/2275/25');
    expect(c.ecitsState.firstDocumentDate).toBe('2025-03-01');
    expect(c.ecitsState.lastDocumentDate).toBe('2026-05-30');
  });

  it('processDeferredCases створює обрану raніше відкладену справу', async () => {
    const h = makeHarness();
    const res = await submitScenarioResult(makeV12Envelope(), {
      executeAction: h.executeAction,
      getCases: h.getCases,
    });
    const inc = await processDeferredCases(res.pendingReview, {
      executeAction: h.executeAction,
      getCases: h.getCases,
    });
    expect(inc.casesCreated).toBe(1);
    const created = h.getCases().find((c) => c.case_no === '700/700/26');
    expect(created).toBeTruthy();
    expect(created.advocateRole).toBe('representative_unspecified');
  });

  it('зворотна сумісність: старий envelope без нових полів проходить як раніше', async () => {
    const oldEnvelope = makeEnvelope(); // легасі-форма
    const h = makeHarness();
    const res = await submitScenarioResult(oldEnvelope, {
      executeAction: h.executeAction,
      getCases: h.getCases,
    });
    expect(res.casesCreated).toBe(2);
    expect(res.pendingReview).toEqual([]);
    const cases = h.getCases();
    expect(cases.every((c) => c.advocateRoles)).toBe(true);
    expect(cases.every((c) => c.advocateRoles.length === 1)).toBe(true);
  });

  it('NEW: golden fixture (representative) проходить наскрізь без втрат і ручних правок', async () => {
    // Представницький fixture у tests/fixtures/ecits_envelope_2026-06-09.json
    // вкриває УСІ нові поля v12. Реальний 50-справ envelope замінить його
    // тут, коли надійде від екстрактора — той самий тест.
    const h = makeHarness();
    const res = await submitScenarioResult(goldenFixture, {
      executeAction: h.executeAction,
      getCases: h.getCases,
    });
    const expectedDeferred = goldenFixture.data.cases.filter((c) => c.likelyNotMine === true).length;
    const expectedAuto = goldenFixture.data.cases.length - expectedDeferred;
    expect(res.casesCreated).toBe(expectedAuto);
    expect(res.pendingReview).toHaveLength(expectedDeferred);
    expect(res.errors).toEqual([]);
    // Нічого не перепаковано вручну: нормалізаційних warnings бути не має для
    // golden envelope (він уже в канонічній формі).
    expect(res.warnings.filter((w) => /дефолт|обгортки|об'єкти/.test(w))).toEqual([]);
  });
});
