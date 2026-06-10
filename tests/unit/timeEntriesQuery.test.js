// timeEntriesQuery.test.js — TASK case_delete_persist
//
// `getTimeEntries` має новий фільтр `excludeCaseIds`: споживачі активних
// ledger'ів (білінг/звіти/дашборд) виключають caseId'и видалених справ
// (надгробки deletedCases[]), щоб не падати на відсутній live-case і не
// показувати «привидну» активність по знятій справі.
//
// time_entries самі НЕ видаляються — лишаються інертними сиротами в даних.

import { describe, it, expect } from 'vitest';
import { getTimeEntries, getSummary } from '../../src/services/timeEntriesQuery.js';

const makeEntries = () => [
  { id: 't1', caseId: 'caseA', startTime: '2026-06-01T09:00:00Z', duration: 600, billable: true, category: 'case_work' },
  { id: 't2', caseId: 'caseB', startTime: '2026-06-01T10:00:00Z', duration: 1200, billable: true, category: 'case_work' },
  { id: 't3', caseId: 'caseA', startTime: '2026-06-02T11:00:00Z', duration: 900, billable: true, category: 'case_work' },
  { id: 't4', caseId: null, startTime: '2026-06-02T12:00:00Z', duration: 300, billable: false, category: 'admin' },
];

describe('getTimeEntries — excludeCaseIds (TASK case_delete_persist)', () => {
  it('без excludeCaseIds повертає усі активні записи (контракт не змінений)', async () => {
    const out = await getTimeEntries({ activeEntries: makeEntries() });
    expect(out).toHaveLength(4);
  });

  it('виключає записи з caseId зі списку excludeCaseIds', async () => {
    const out = await getTimeEntries({
      activeEntries: makeEntries(),
      query: { excludeCaseIds: ['caseA'] },
    });
    expect(out.map(e => e.id).sort()).toEqual(['t2', 't4']);
  });

  it('excludeCaseIds може містити кілька id (множинне видалення)', async () => {
    const out = await getTimeEntries({
      activeEntries: makeEntries(),
      query: { excludeCaseIds: ['caseA', 'caseB'] },
    });
    expect(out.map(e => e.id)).toEqual(['t4']);
  });

  it('записи без caseId (null/admin) НЕ виключаються excludeCaseIds', async () => {
    const out = await getTimeEntries({
      activeEntries: makeEntries(),
      query: { excludeCaseIds: ['caseA', 'caseB'] },
    });
    expect(out.find(e => e.id === 't4')).toBeTruthy();
  });

  it('порожній/відсутній excludeCaseIds = no-op (правило #11: один сенс, не магія)', async () => {
    const a = await getTimeEntries({ activeEntries: makeEntries(), query: { excludeCaseIds: [] } });
    expect(a).toHaveLength(4);
    const b = await getTimeEntries({ activeEntries: makeEntries(), query: {} });
    expect(b).toHaveLength(4);
  });

  it('excludeCaseIds коректно поєднується з іншими фільтрами (caseId, billable)', async () => {
    const out = await getTimeEntries({
      activeEntries: makeEntries(),
      query: { billable: true, excludeCaseIds: ['caseA'] },
    });
    expect(out.map(e => e.id)).toEqual(['t2']);
  });

  it('getSummary бачить excludeCaseIds (сума пропускає видалені)', async () => {
    const summary = await getSummary({
      activeEntries: makeEntries(),
      query: { excludeCaseIds: ['caseA'] },
    });
    // t2 (1200) + t4 (300) = 1500
    expect(summary.totalDuration).toBe(1500);
    // billable: t2 (1200)
    expect(summary.billableDuration).toBe(1200);
    expect(summary.byCase.caseA).toBeUndefined();
  });
});
