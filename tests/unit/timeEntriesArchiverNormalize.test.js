// TASK 2: lazy-on-load нормалізація архівних time_entries.
// Старі архіви (_archives/time_entries_YYYY-MM.json) містять legacy 'source';
// жива схема — captureMethod. Архіви на диску НЕ переписуються — читач
// нормалізує на льоту. Тут тестуємо чисту функцію напряму (без Drive).
import { describe, it, expect } from 'vitest';
import { normalizeArchivedTimeEntries } from '../../src/services/timeEntriesArchiver.js';

describe('timeEntriesArchiver.normalizeArchivedTimeEntries', () => {
  it('старий запис із source → captureMethod, source прибрано', () => {
    const out = normalizeArchivedTimeEntries([
      { id: 'te_1', duration: 60, source: 'instrumentation' },
      { id: 'te_2', duration: 30, source: 'legacy_import', caseId: 'case_2' },
    ]);
    expect(out[0]).toEqual({ id: 'te_1', duration: 60, captureMethod: 'instrumentation' });
    expect('source' in out[0]).toBe(false);
    expect(out[1].captureMethod).toBe('legacy_import');
    expect(out[1].caseId).toBe('case_2');
  });

  it('запис уже з captureMethod — без змін; stray source прибирається', () => {
    const out = normalizeArchivedTimeEntries([
      { id: 'a', captureMethod: 'timer' },
      { id: 'b', captureMethod: 'manual', source: 'manual' },
    ]);
    expect(out[0]).toEqual({ id: 'a', captureMethod: 'timer' });
    expect('source' in out[1]).toBe(false);
    expect(out[1].captureMethod).toBe('manual');
  });

  it('запис без обох полів і не-масив — повертаються як є', () => {
    expect(normalizeArchivedTimeEntries([{ id: 'c', duration: 5 }])[0]).toEqual({ id: 'c', duration: 5 });
    expect(normalizeArchivedTimeEntries(null)).toBe(null);
    expect(normalizeArchivedTimeEntries(undefined)).toBe(undefined);
  });

  it('ідемпотентна: повторний прогін стабільний', () => {
    const once = normalizeArchivedTimeEntries([{ id: 'te', source: 'manual_assign' }]);
    const twice = normalizeArchivedTimeEntries(once);
    expect(twice).toEqual(once);
    expect(twice[0]).toEqual({ id: 'te', captureMethod: 'manual_assign' });
  });
});
