// TASK 4 — інтеграційні тести update_document_source (через справжній
// createActions, зведений у _actionsTestSetup.js).
// Покриває: canOverwrite дозволено/заборонено, alternativeSources fallback,
// permission gating, валідація. eventBus/billing — стаби в test-setup (як і для
// решти v7 source-aware ACTIONS), перевіряється структурним паритетом.
import { describe, it, expect, beforeEach } from 'vitest';
import { createDocument } from '../../src/services/documentFactory.js';
import { createHarness } from './_actionsTestSetup.js';

function caseWith(docOverrides) {
  return [{
    id: 'case_1',
    documents: [createDocument({ id: 'doc_1', name: 'Док', ...docOverrides })],
  }];
}

describe('update_document_source — canOverwrite політика', () => {
  it('overwrite ДОЗВОЛЕНО (existing нижчий пріоритет): source змінюється', async () => {
    const h = createHarness({ initialCases: caseWith({ source: 'unknown' }) });
    const r = await h.executeAction('court_sync_agent', 'update_document_source', {
      caseId: 'case_1', documentId: 'doc_1',
      source: 'court_sync', sourceConfidence: 'high', extractedAt: '2026-05-15T10:00:00.000Z',
    });
    expect(r.success).toBe(true);
    expect(r.overwriteSkipped).toBe(false);
    const d = h.getCases()[0].documents[0];
    expect(d.source).toBe('court_sync');
    expect(d.sourceConfidence).toBe('high');
    expect(d.extractedAt).toBe('2026-05-15T10:00:00.000Z');
  });

  it('overwrite ЗАБОРОНЕНО (manual→court_sync) + alternativeSource: source цілий, провенанс додано', async () => {
    const h = createHarness({ initialCases: caseWith({ source: 'manual' }) });
    const r = await h.executeAction('court_sync_agent', 'update_document_source', {
      caseId: 'case_1', documentId: 'doc_1',
      source: 'court_sync',
      alternativeSource: { source: 'court_sync', sourceConfidence: 'high', data: { ecitsId: 'X' } },
    });
    expect(r.success).toBe(true);
    expect(r.overwriteSkipped).toBe(true);
    const d = h.getCases()[0].documents[0];
    expect(d.source).toBe('manual'); // НЕ downgrade
    expect(Array.isArray(d.alternativeSources)).toBe(true);
    expect(d.alternativeSources).toHaveLength(1);
    expect(d.alternativeSources[0].source).toBe('court_sync');
    expect(typeof d.alternativeSources[0].dataHash).toBe('string');
  });

  it('overwrite ЗАБОРОНЕНО без alternativeSource: source цілий, нічого не додано', async () => {
    const h = createHarness({ initialCases: caseWith({ source: 'manual' }) });
    const r = await h.executeAction('court_sync_agent', 'update_document_source', {
      caseId: 'case_1', documentId: 'doc_1', source: 'telegram',
    });
    expect(r.success).toBe(true);
    expect(r.overwriteSkipped).toBe(true);
    const d = h.getCases()[0].documents[0];
    expect(d.source).toBe('manual');
    expect(d.alternativeSources || []).toHaveLength(0);
  });

  it('existing source відсутній → canOverwrite дозволяє перший запис', async () => {
    const h = createHarness({ initialCases: [{ id: 'case_1', documents: [{ id: 'doc_1', name: 'X' }] }] });
    const r = await h.executeAction('court_sync_agent', 'update_document_source', {
      caseId: 'case_1', documentId: 'doc_1', source: 'court_sync',
    });
    expect(r.success).toBe(true);
    expect(h.getCases()[0].documents[0].source).toBe('court_sync');
  });
});

describe('update_document_source — permission gating', () => {
  it('court_sync_agent і document_processor_agent — дозволено', async () => {
    for (const agent of ['court_sync_agent', 'document_processor_agent']) {
      const h = createHarness({ initialCases: caseWith({ source: 'unknown' }) });
      const r = await h.executeAction(agent, 'update_document_source', {
        caseId: 'case_1', documentId: 'doc_1', source: 'court_sync',
      });
      expect(r.success).toBe(true);
    }
  });

  it('dossier_agent і qi_agent — заборонено (немає в allowlist)', async () => {
    for (const agent of ['dossier_agent', 'qi_agent']) {
      const h = createHarness({ initialCases: caseWith({ source: 'unknown' }) });
      const r = await h.executeAction(agent, 'update_document_source', {
        caseId: 'case_1', documentId: 'doc_1', source: 'court_sync',
      });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/повноважень/i);
    }
  });
});

describe('update_document_source — валідація', () => {
  it('відсутній source → помилка', async () => {
    const h = createHarness({ initialCases: caseWith({ source: 'unknown' }) });
    const r = await h.executeAction('court_sync_agent', 'update_document_source', {
      caseId: 'case_1', documentId: 'doc_1',
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/source/i);
  });

  it('відсутній caseId/documentId → помилка', async () => {
    const h = createHarness({ initialCases: caseWith({ source: 'unknown' }) });
    const r = await h.executeAction('court_sync_agent', 'update_document_source', { source: 'court_sync' });
    expect(r.success).toBe(false);
  });

  it('документ не знайдено → помилка', async () => {
    const h = createHarness({ initialCases: caseWith({ source: 'unknown' }) });
    const r = await h.executeAction('court_sync_agent', 'update_document_source', {
      caseId: 'case_1', documentId: 'NOPE', source: 'court_sync',
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/не знайдено/i);
  });
});
