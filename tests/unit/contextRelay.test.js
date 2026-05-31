// Юніт-тести чистих вирішувачів естафети «DP → генератор контексту».
// Покривають §4.2 TASK: allExpectedDocsLanded (порожній/частковий/повний/надлишок)
// + supporting-вирішувачі derivePendingRegen і shouldStartContextRegen.
import { describe, it, expect } from 'vitest';
import {
  allExpectedDocsLanded,
  derivePendingRegen,
  shouldStartContextRegen,
} from '../../src/components/CaseDossier/services/contextRelay.js';

const docs = (...ids) => ids.map((id) => ({ id }));

describe('allExpectedDocsLanded', () => {
  it('порожній expected → true (вакуумна істина, чекати нема на що)', () => {
    expect(allExpectedDocsLanded(docs('a', 'b'), [])).toBe(true);
    expect(allExpectedDocsLanded([], [])).toBe(true);
  });

  it('частковий збіг → false (не всі приземлились)', () => {
    expect(allExpectedDocsLanded(docs('a'), ['a', 'b'])).toBe(false);
    expect(allExpectedDocsLanded([], ['a'])).toBe(false);
  });

  it('повний збіг → true', () => {
    expect(allExpectedDocsLanded(docs('a', 'b'), ['a', 'b'])).toBe(true);
  });

  it('надлишкові документи у справі не заважають → true', () => {
    expect(allExpectedDocsLanded(docs('a', 'b', 'c', 'd'), ['b', 'c'])).toBe(true);
  });

  it('стійкий до null/undefined і документів без id', () => {
    expect(allExpectedDocsLanded(null, ['a'])).toBe(false);
    expect(allExpectedDocsLanded(undefined, [])).toBe(true);
    expect(allExpectedDocsLanded([{ name: 'no-id' }], ['a'])).toBe(false);
    expect(allExpectedDocsLanded(docs('a'), null)).toBe(true);
  });
});

describe('derivePendingRegen', () => {
  const base = {
    caseId: 'case_1',
    documentIds: ['d1', 'd2'],
    updateCaseContext: true,
    scenarioRunId: 'run_7',
  };

  it('валідна подія для поточної справи → паличка з expectedDocIds', () => {
    expect(derivePendingRegen(base, 'case_1')).toEqual({
      caseId: 'case_1',
      expectedDocIds: ['d1', 'd2'],
      scenarioRunId: 'run_7',
    });
  });

  it('тумблер вимкнено (updateCaseContext !== true) → null', () => {
    expect(derivePendingRegen({ ...base, updateCaseContext: false }, 'case_1')).toBe(null);
    expect(derivePendingRegen({ ...base, updateCaseContext: undefined }, 'case_1')).toBe(null);
  });

  it('чужа справа → null', () => {
    expect(derivePendingRegen(base, 'case_OTHER')).toBe(null);
  });

  it('відсутній payload → null', () => {
    expect(derivePendingRegen(null, 'case_1')).toBe(null);
    expect(derivePendingRegen(undefined, 'case_1')).toBe(null);
  });

  it('відсутній documentIds → expectedDocIds []', () => {
    const p = derivePendingRegen({ caseId: 'case_1', updateCaseContext: true }, 'case_1');
    expect(p.expectedDocIds).toEqual([]);
    expect(p.scenarioRunId).toBe(null);
  });
});

describe('shouldStartContextRegen', () => {
  const pending = { caseId: 'case_1', expectedDocIds: ['d1', 'd2'] };

  it('палички нема → false', () => {
    expect(shouldStartContextRegen({
      pendingContextRegen: null, caseId: 'case_1', documents: docs('d1', 'd2'), isCreatingContext: false,
    })).toBe(false);
  });

  it('документи ще не приземлились → false', () => {
    expect(shouldStartContextRegen({
      pendingContextRegen: pending, caseId: 'case_1', documents: docs('d1'), isCreatingContext: false,
    })).toBe(false);
  });

  it('усі приземлились і генерація не біжить → true', () => {
    expect(shouldStartContextRegen({
      pendingContextRegen: pending, caseId: 'case_1', documents: docs('d1', 'd2'), isCreatingContext: false,
    })).toBe(true);
  });

  it('генерація вже біжить → false (не дублюємо)', () => {
    expect(shouldStartContextRegen({
      pendingContextRegen: pending, caseId: 'case_1', documents: docs('d1', 'd2'), isCreatingContext: true,
    })).toBe(false);
  });

  it('паличка для іншої справи → false', () => {
    expect(shouldStartContextRegen({
      pendingContextRegen: pending, caseId: 'case_2', documents: docs('d1', 'd2'), isCreatingContext: false,
    })).toBe(false);
  });
});
