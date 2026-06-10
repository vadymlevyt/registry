// case-delete-persist.test.js — TASK case_delete_persist
//
// Tracking_debt #59/#60: «Видалені ЄСІТС-справи переживають hard-reload» +
// «у тій же сесії повторний імпорт того самого case_no йде по гілці update,
// а не create». Дві причини в одному корені:
//   (1) shrink-guard cases_count_decreased блокував запис на Drive коли
//       видаляли >1 справ.
//   (2) deleteCasePermanently викликав сирий setCases — casesRef лагав, тож
//       within-session повторний імпорт ще бачив справу і йшов update'ом.
//
// Тут перевіряємо обидві гілки:
//   A. Guard з expectIntentionalCasesShrink(n) дозволяє запис ПІСЛЯ свідомого
//      видалення n+1 справ, і скидається на наступному writeRegistry (one-shot).
//   B. casesRef оновлюється СИНХРОННО (через setCasesWithRef-патерн) → submitScenarioResult
//      бачить видалену справу як неіснуючу і йде create_case (casesCreated: 1),
//      не update.
//   C. Дедуп create_case у actionsRegistry бачить актуальний getCases() —
//      повторне створення тієї ж нормалізованої case_no одразу після видалення
//      більше НЕ повертає duplicate_case_no.

import { describe, it, expect, beforeEach } from 'vitest';
import { createActions } from '../../src/services/actionsRegistry.js';
import { submitScenarioResult } from '../../src/services/ecits/scenarioProcessor.js';
import {
  evaluateRegistryWriteGuard,
  expectIntentionalCasesShrink,
  __resetWriteGuardState,
} from '../../src/services/registryWriteGuard.js';

// ── Harness: спільні deps для actionsRegistry, з СИНХРОННИМ casesRef через
//    setCasesWithRef-патерн (як у App.jsx). Без цього within-session тести
//    дедупу не відтворюються: getCases() повертає стейл.
function makeHarness({ initialCases = [] } = {}) {
  let cases = JSON.parse(JSON.stringify(initialCases));
  let timeEntries = [];
  let notes = { cases: [], general: [], content: [], system: [], records: [] };
  const auditLog = [];

  // Дзеркало App.jsx setCasesWithRef: updater пробіг → casesRef одразу
  // оновлений. Тут «ref» — змінна `cases`. Це і є той самий патерн, що
  // App.jsx setCasesWithRef ВНУТРІШНЬО оновлює casesRef.current.
  const setCases = (u) => { cases = typeof u === 'function' ? u(cases) : u; };
  const setNotes = (u) => { notes = typeof u === 'function' ? u(notes) : u; };
  const setTimeEntries = (u) => { timeEntries = typeof u === 'function' ? u(timeEntries) : u; };

  const noopTracker = {
    report: () => {}, startSession: () => null, endSession: () => null,
    startSubtimer: () => null, endSubtimer: () => null,
    updateSubtimer: () => false, assignOfflinePeriod: () => null,
  };

  const { executeAction } = createActions({
    getCases: () => cases,
    setCases,
    setNotes,
    setTimeEntries,
    saveNotesToLS: () => {},
    writeAudit: (params) => { auditLog.push(params); return { id: `audit_${auditLog.length}` }; },
    checkTenantAccess: () => true,
    checkRolePermission: () => true,
    checkCaseAccess: () => true,
    activityTracker: noopTracker,
    eventBus: { publish: () => {} },
    deleteDriveFile: async () => {},
    deleteOcrCacheForDocument: async () => {},
    deleteExtendedForDocument: async () => {},
    deleteDocumentsArtifactsBatch: async () => ({ deletedCount: 0, failedCount: 0 }),
    deleteExtendedForDocuments: async () => 0,
    clearResume: () => {},
  });

  // Симулюємо App.jsx deleteCasePermanently: tombstone → cascade нотатки →
  // setCases (через наш setCases що оновлює casesRef синхронно). Drive/audit
  // частини відрізняються, але для перевірки контракту "casesRef-актуальний"
  // достатньо знаття про видалення.
  const deletedCases = [];
  const performDelete = (caseItem) => {
    deletedCases.push({
      caseId: caseItem.id,
      case_no: caseItem.case_no || null,
      name: caseItem.name || null,
      deletedAt: new Date().toISOString(),
      deletedBy: 'vadym',
    });
    // Cascade нотаток standalone bucket'ів за caseId.
    setNotes(prev => {
      const updated = {};
      for (const cat of Object.keys(prev || {})) {
        updated[cat] = (prev[cat] || []).filter(n => String(n?.caseId || '') !== String(caseItem.id));
      }
      return updated;
    });
    // Один сенс (правило #11): сигнал guard'у про свідомий shrink, споживається
    // на наступному writeRegistry-виклику.
    expectIntentionalCasesShrink(1);
    setCases(prev => prev.filter(c => c.id !== caseItem.id));
  };

  return {
    executeAction,
    performDelete,
    getCases: () => cases,
    getNotes: () => notes,
    getDeletedCases: () => deletedCases,
    getTimeEntries: () => timeEntries,
    getAuditLog: () => auditLog,
  };
}

const ECITS_ENVELOPE_FACTORY = (case_no) => ({
  envelopeVersion: 1,
  scenarioId: 'ecits_import_cases_and_hearings',
  scenarioVersion: 1,
  data: {
    ecitsAdvocate: { name: 'Vadym Levytskyi', identifier: null },
    stats: { totalSeen: 1, accepted: 1, skipped: 0 },
    cases: [
      {
        ecitsCaseId: null,
        case_no,
        court: 'Київський апеляційний суд',
        category: 'civil',
        advocateRole: 'plaintiff_rep',
        primaryParty: 'Іваненко Іван',
        cabinetUrl: 'https://cabinet.court.gov.ua/case/xyz',
        hearings: [],
      },
    ],
    warnings: [],
    skipped: [],
  },
});

beforeEach(() => { __resetWriteGuardState(); });

describe('TASK case_delete_persist — корінь race \"видалена справа повертається\"', () => {
  it('B + C: після performDelete повторний submitScenarioResult з тим самим case_no йде по гілці CREATE (casesCreated=1)', async () => {
    const CASE_NO = '522/12345/26';
    const seed = {
      id: 'case_seed',
      tenantId: 'ab_levytskyi',
      ownerId: 'vadym',
      name: 'Іваненко Іван',
      case_no: CASE_NO,
      hearings: [],
      ecitsState: {},
      origin: 'ecits_import',
    };
    const h = makeHarness({ initialCases: [seed] });

    // 1. Sanity: дедуп працює до видалення — повторний імпорт цього case_no
    //    повинен оновлювати, а не створювати.
    const before = await submitScenarioResult(ECITS_ENVELOPE_FACTORY(CASE_NO), {
      executeAction: h.executeAction,
      getCases: h.getCases,
      appendScenarioHistoryEntry: () => {},
    });
    expect(before.casesUpdated).toBe(1);
    expect(before.casesCreated).toBe(0);

    // 2. Видалити справу. У реальному App.jsx — через setCasesWithRef, тут —
    //    через performDelete що використовує той самий синхронний паттерн.
    h.performDelete(seed);
    expect(h.getCases().find(c => c.case_no === CASE_NO)).toBeUndefined();

    // 3. Повторно імпортувати ТОЙ САМИЙ case_no — без F5, без reload.
    //    Тепер getCases() (через casesRef) НЕ бачить справи → submitScenarioResult
    //    йде по гілці create_case → casesCreated=1.
    const after = await submitScenarioResult(ECITS_ENVELOPE_FACTORY(CASE_NO), {
      executeAction: h.executeAction,
      getCases: h.getCases,
      appendScenarioHistoryEntry: () => {},
    });
    expect(after.casesCreated).toBe(1);
    expect(after.casesUpdated).toBe(0);
    // НЕ duplicate_case_no — actionsRegistry create_case бачить актуальний getCases.
    expect(after.errors.filter(e => /duplicate/.test(e.message))).toHaveLength(0);
  });

  it('A: writeRegistry guard блокує несигналізований мульти-shrink, але дозволяє після expectIntentionalCasesShrink(n)', () => {
    // Симулюємо ситуацію писання payload'у з prev cases=10, new=7 (видалили 3).
    const prev = { cases: 10 };
    const registry = { cases: Array.from({ length: 7 }, () => ({})) };

    // Несигналізовано → блок.
    expect(evaluateRegistryWriteGuard(registry, prev)).toBe('cases_count_decreased');

    // Сигналізуємо 2 — все одно блок (allowedShrink = 3, новий = prev-3 = 7).
    expectIntentionalCasesShrink(2);
    expect(evaluateRegistryWriteGuard(registry, prev)).toBeNull();

    // One-shot скинувся — наступний несигналізований запис того ж payload'у блокується.
    expect(evaluateRegistryWriteGuard(registry, prev)).toBe('cases_count_decreased');
  });

  it('Каскад: performDelete прибирає нотатки справи з standalone bucket', () => {
    const h = makeHarness({
      initialCases: [{
        id: 'case_X',
        tenantId: 'ab_levytskyi',
        ownerId: 'vadym',
        name: 'X',
        case_no: '111/111/26',
        hearings: [],
        ecitsState: {},
      }],
    });
    h.executeAction('qi_agent', 'add_note', {
      caseId: 'case_X',
      text: 'standalone-note-про-справу-X',
      category: 'general',
    });
    // Нотатка лягла у case.notes (бо caseId є) — пересіюємо в bucket напряму,
    // щоб симулювати legacy/standalone випадок: користувач створив нотатку без caseId,
    // потім прив'язав до справи через окреме поле.
    const inBucket = { id: 'n_in_bucket', text: 'bucket-note', caseId: 'case_X', category: 'general' };
    h.getNotes().general.push(inBucket);

    h.performDelete({ id: 'case_X', case_no: '111/111/26', name: 'X' });

    // Caseref: справа знята.
    expect(h.getCases().find(c => c.id === 'case_X')).toBeUndefined();
    // Bucket-нотатка з caseId='case_X' прибрана.
    expect(h.getNotes().general.find(n => n.id === 'n_in_bucket')).toBeUndefined();
    // Tombstone записаний.
    const stones = h.getDeletedCases();
    expect(stones).toHaveLength(1);
    expect(stones[0].caseId).toBe('case_X');
    expect(stones[0].case_no).toBe('111/111/26');
    expect(stones[0].deletedAt).toBeTruthy();
  });
});
