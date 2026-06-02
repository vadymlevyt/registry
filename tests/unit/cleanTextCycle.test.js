// TASK 3.2 — юніт-тести логіки Огляд-циклу (partitionForCleaning / runCleanCycle).
// Фільтр скоупу (scanned + сирий), пропуск searchable/вже-.md/архівних, прогрес,
// агрегація success/degraded/error, групування attentionNotes.

import { describe, it, expect, vi } from 'vitest';
import { partitionForCleaning, runCleanCycle } from '../../src/components/CaseDossier/services/cleanTextCycle.js';

const doc = (over) => ({ id: 'x', name: 'Doc', documentNature: 'scanned', textFormat: 'txt', status: 'active', ...over });

describe('partitionForCleaning (TASK 3.2)', () => {
  it('бере лише scanned з сирим текстом; пропускає searchable / вже-.md / архівні', () => {
    const docs = [
      doc({ id: 's1' }),                                        // scanned сирий → queue
      doc({ id: 's2' }),                                        // scanned сирий → queue
      doc({ id: 'd1', documentNature: 'searchable' }),          // searchable → skip
      doc({ id: 'm1', textFormat: 'md' }),                      // вже .md → skip
      doc({ id: 'a1', status: 'archived' }),                    // архівний → не рахуємо
    ];
    const { queue, skippedCount } = partitionForCleaning(docs);
    expect(queue.map(d => d.id)).toEqual(['s1', 's2']);
    // skippedCount рахує активні поза скоупом (searchable + вже-md), без архівних.
    expect(skippedCount).toBe(2);
  });

  it('порожній / невалідний вхід → порожня черга', () => {
    expect(partitionForCleaning(undefined)).toEqual({ queue: [], skippedCount: 0 });
    expect(partitionForCleaning([]).queue).toEqual([]);
  });
});

describe('runCleanCycle (TASK 3.2)', () => {
  it('викликає clean_document_text по кожному з черги; прогрес N/M; агрегує', async () => {
    const docs = [doc({ id: 's1', name: 'A' }), doc({ id: 's2', name: 'B' }), doc({ id: 'd1', documentNature: 'searchable' })];
    const calls = [];
    const executeAction = vi.fn(async (agentId, action, params) => {
      calls.push(params.documentId);
      return { success: true, attentionNotes: [{ note: `увага ${params.documentId}` }] };
    });
    const progress = [];
    const res = await runCleanCycle({
      documents: docs, caseId: 'case_001', executeAction,
      onProgress: (t, i, total) => progress.push([i, total]),
    });

    expect(executeAction).toHaveBeenCalledTimes(2); // лише scanned-сирі
    expect(calls).toEqual(['s1', 's2']);
    expect(executeAction).toHaveBeenCalledWith('dossier_agent', 'clean_document_text', { caseId: 'case_001', documentId: 's1' });
    expect(res.cleaned).toBe(2);
    expect(res.skipped).toBe(1); // searchable
    expect(res.degraded).toBe(0);
    expect(res.errors).toBe(0);
    expect(res.attentionNotes).toEqual([
      { docName: 'A', note: 'увага s1' },
      { docName: 'B', note: 'увага s2' },
    ]);
    expect(progress).toEqual([[1, 2], [2, 2]]);
  });

  it('рахує деградовані і помилки окремо; помилка одного не валить цикл', async () => {
    const docs = [doc({ id: 's1' }), doc({ id: 's2' }), doc({ id: 's3' }), doc({ id: 's4' })];
    const executeAction = vi.fn(async (agentId, action, params) => {
      switch (params.documentId) {
        case 's1': return { success: true, attentionNotes: [] };
        case 's2': return { success: false, degraded: true, needsRecleaning: true };
        case 's3': throw new Error('мережа впала');
        case 's4': return { success: false, error: 'NO_SOURCE' };
        default: return { success: false };
      }
    });
    const res = await runCleanCycle({ documents: docs, caseId: 'case_001', executeAction });
    expect(res.cleaned).toBe(1);
    expect(res.degraded).toBe(1);
    expect(res.errors).toBe(2); // throw + NO_SOURCE
    expect(executeAction).toHaveBeenCalledTimes(4);
  });

  it('skipped від ядра-гарда не рахується як помилка', async () => {
    const docs = [doc({ id: 's1' })];
    const executeAction = vi.fn(async () => ({ success: false, skipped: true, reason: 'not_scanned' }));
    const res = await runCleanCycle({ documents: docs, caseId: 'case_001', executeAction });
    expect(res.cleaned).toBe(0);
    expect(res.degraded).toBe(0);
    expect(res.errors).toBe(0);
  });
});
