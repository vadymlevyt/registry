// TASK 3.2 — інтеграційні тести ACTION clean_document_text.
// Перевіряє: PERMISSIONS (dossier_agent ✓, інші агенти ✗), scanned-гард,
// виклик ядра з module=case_dossier + billAsUserAction:true, маппінг результату
// (success / degraded / error / skipped), білінг без подвійного звіту
// (SELF_BILLING_ACTIONS — ядро звітує саме, executeAction-hook не дублює).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHarness } from './_actionsTestSetup.js';
import { createDocument } from '../../src/services/documentFactory.js';

function caseWith(documents) {
  return {
    id: 'case_001',
    name: 'Тестова справа',
    tenantId: 'ab_levytskyi',
    ownerId: 'vadym',
    documents,
  };
}

describe('clean_document_text ACTION (TASK 3.2)', () => {
  let cleanSpy;
  let buildDepsSpy;
  let h;
  let scannedDoc;
  let searchableDoc;
  let mdDoc;

  beforeEach(() => {
    scannedDoc = createDocument({ name: 'Скан.pdf', driveId: 'd1', size: 10, documentNature: 'scanned' });
    searchableDoc = createDocument({ name: 'Договір.docx', driveId: 'd2', size: 10, documentNature: 'searchable' });
    mdDoc = createDocument({ name: 'Очищений.pdf', driveId: 'd3', size: 10, documentNature: 'scanned' });
    mdDoc.textFormat = 'md';

    // Стаб ядра: за замовчуванням повний успіх.
    cleanSpy = vi.fn(async () => ({ ok: true, markdown: '# Гарно', attentionNotes: [{ page: 1, note: 'дивна сума' }], warning: null }));
    buildDepsSpy = vi.fn(() => ({ fetchLayout: () => null }));

    h = createHarness({
      initialCases: [caseWith([scannedDoc, searchableDoc, mdDoc])],
      cleanDeps: {
        getApiKey: () => 'test-key',
        cleanDocument: cleanSpy,
        buildCleanDocumentDriveDeps: buildDepsSpy,
      },
    });
  });

  it('dossier_agent + scanned → success; ядро викликане з case_dossier + billAsUserAction:true', async () => {
    const r = await h.executeAction('dossier_agent', 'clean_document_text', {
      caseId: 'case_001', documentId: scannedDoc.id,
    });
    expect(r.success).toBe(true);
    expect(r.attentionNotes).toEqual([{ page: 1, note: 'дивна сума' }]);
    expect(cleanSpy).toHaveBeenCalledTimes(1);
    const arg = cleanSpy.mock.calls[0][0];
    expect(arg.module).toBe('case_dossier');
    expect(arg.billAsUserAction).toBe(true);
    expect(arg.apiKey).toBe('test-key');
    expect(arg.document.id).toBe(scannedDoc.id);
    // Drive-шви будуються від імені dossier_agent (має дозвіл update_document).
    expect(buildDepsSpy).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'dossier_agent' }));
  });

  it('гард (V2-B): clean + searchable → skipped, ядро НЕ викликане', async () => {
    const r = await h.executeAction('dossier_agent', 'clean_document_text', {
      caseId: 'case_001', documentId: searchableDoc.id, mode: 'clean',
    });
    expect(r.success).toBe(false);
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('not_scanned');
    expect(cleanSpy).not.toHaveBeenCalled();
  });

  it('гард (V2-B): digest + searchable → НЕ skipped, ядро викликане з mode=digest', async () => {
    // Конспект універсальний — searchable допускається (parent §ТРИ РЕЖИМИ).
    const r = await h.executeAction('dossier_agent', 'clean_document_text', {
      caseId: 'case_001', documentId: searchableDoc.id, mode: 'digest',
    });
    expect(r.success).toBe(true);
    expect(cleanSpy).toHaveBeenCalledTimes(1);
    expect(cleanSpy.mock.calls[0][0].mode).toBe('digest');
    expect(cleanSpy.mock.calls[0][0].document.id).toBe(searchableDoc.id);
  });

  it('PERMISSIONS: document_processor_agent не має дозволу → blocked', async () => {
    const r = await h.executeAction('document_processor_agent', 'clean_document_text', {
      caseId: 'case_001', documentId: scannedDoc.id,
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/повноважень/);
    expect(cleanSpy).not.toHaveBeenCalled();
  });

  it('PERMISSIONS: court_sync_agent не має дозволу → blocked', async () => {
    const r = await h.executeAction('court_sync_agent', 'clean_document_text', {
      caseId: 'case_001', documentId: scannedDoc.id,
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/повноважень/);
  });

  it('деградація ядра → {degraded, needsRecleaning}', async () => {
    cleanSpy.mockResolvedValueOnce({ ok: false, degraded: true, needsRecleaning: true, warning: 'AI обрізав вивід' });
    const r = await h.executeAction('dossier_agent', 'clean_document_text', {
      caseId: 'case_001', documentId: scannedDoc.id,
    });
    expect(r.success).toBe(false);
    expect(r.degraded).toBe(true);
    expect(r.needsRecleaning).toBe(true);
    expect(r.warning).toMatch(/обрізав/);
  });

  it('помилка ядра (NO_SOURCE) → {success:false, error}', async () => {
    cleanSpy.mockResolvedValueOnce({ ok: false, error: 'NO_SOURCE' });
    const r = await h.executeAction('dossier_agent', 'clean_document_text', {
      caseId: 'case_001', documentId: scannedDoc.id,
    });
    expect(r.success).toBe(false);
    expect(r.error).toBe('NO_SOURCE');
  });

  it('неіснуючий документ → error', async () => {
    const r = await h.executeAction('dossier_agent', 'clean_document_text', {
      caseId: 'case_001', documentId: 'doc_missing',
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/не знайдено/);
    expect(cleanSpy).not.toHaveBeenCalled();
  });

  it('обовʼязкові параметри', async () => {
    const r = await h.executeAction('dossier_agent', 'clean_document_text', { caseId: 'case_001' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/обов/);
  });

  it('білінг: executeAction-hook НЕ дублює generic-звіт (SELF_BILLING_ACTIONS)', async () => {
    await h.executeAction('dossier_agent', 'clean_document_text', {
      caseId: 'case_001', documentId: scannedDoc.id,
    });
    const generic = h.getTrackerCalls().filter(c => c.action === 'clean_document_text');
    expect(generic).toHaveLength(0);
  });

  it('контраст: звичайна дія (add_note) ПОТРАПЛЯЄ в generic-звіт', async () => {
    await h.executeAction('dossier_agent', 'add_note', {
      caseId: 'case_001', note: { text: 'тест' },
    });
    const generic = h.getTrackerCalls().filter(c => c.action === 'add_note');
    expect(generic.length).toBeGreaterThan(0);
  });
});
