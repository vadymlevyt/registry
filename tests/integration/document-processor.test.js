// Інтеграційний тест-заглушка для майбутнього TASK Document Processor v2.
// Перевіряє контракт PERMISSIONS.document_processor_agent + add_documents
// атомарність — щоб коли DP мігруватиме на Tool Use, базис був надійний.
import { describe, it, expect, beforeEach } from 'vitest';
import { createDocument } from '../../src/services/documentFactory.js';
import { createHarness } from './_actionsTestSetup.js';

describe('document_processor_agent integration', () => {
  let h;
  beforeEach(() => {
    h = createHarness({
      initialCases: [{
        id: 'case_001', name: 'Test',
        documents: [], hearings: [], proceedings: [], deadlines: [], notes: [], pinnedNoteIds: [],
      }],
    });
  });

  it('add_documents — успішно додає batch з 3 документів', async () => {
    const docs = [
      createDocument({ name: 'Позов', driveId: 'a', size: 100, addedBy: 'lawyer_via_dp', namingStatus: 'auto' }),
      createDocument({ name: 'Відзив', driveId: 'b', size: 200, addedBy: 'lawyer_via_dp', namingStatus: 'auto' }),
      createDocument({ name: 'Ухвала', driveId: 'c', size: 300, addedBy: 'lawyer_via_dp', namingStatus: 'auto' }),
    ];
    const result = await h.executeAction('document_processor_agent', 'add_documents', {
      caseId: 'case_001', documents: docs,
    });
    expect(result.success).toBe(true);
    expect(result.addedCount).toBe(3);
    expect(h.getCases()[0].documents).toHaveLength(3);
  });

  it('add_documents атомарність — невалідний документ → нічого не додано', async () => {
    const docs = [
      createDocument({ name: 'OK1', driveId: 'a', size: 1 }),
      { id: 'bad', name: 'Bad' }, // без обов'язкових полів
      createDocument({ name: 'OK2', driveId: 'c', size: 1 }),
    ];
    const result = await h.executeAction('document_processor_agent', 'add_documents', {
      caseId: 'case_001', documents: docs,
    });
    expect(result.success).toBe(false);
    expect(h.getCases()[0].documents).toHaveLength(0);
  });

  it('add_documents відмовляє при дублюванні id у batch або з існуючими', async () => {
    const doc = createDocument({ name: 'X', driveId: 'a', size: 1, addedBy: 'lawyer_via_dp' });
    await h.executeAction('document_processor_agent', 'add_documents', {
      caseId: 'case_001', documents: [doc],
    });
    // Спробуємо повторно додати той самий
    const result = await h.executeAction('document_processor_agent', 'add_documents', {
      caseId: 'case_001', documents: [doc],
    });
    expect(result.success).toBe(false);
    // Реальний add_documents (actionsRegistry) повертає "…вже існують у справі".
    // Старий _actionsHarness мав власне формулювання "дублікатів" — TASK 5
    // перевів тест на справжній ACTION, асерт вирівняно на фактичний текст.
    expect(result.error).toMatch(/вже існують/i);
  });

  it('document_processor_agent заблокований на create_case', async () => {
    const result = await h.executeAction('document_processor_agent', 'create_case', { fields: { name: 'X' } });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Немає повноважень/);
  });

  it('document_processor_agent заблокований на add_hearing (не зона DP)', async () => {
    const result = await h.executeAction('document_processor_agent', 'add_hearing', {
      caseId: 'case_001', date: '2026-05-15', time: '10:00',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Немає повноважень/);
  });

  it('document_processor_agent дозволено update_processing_context', async () => {
    const result = await h.executeAction('document_processor_agent', 'update_processing_context', {
      caseId: 'case_001',
      context: { processedAt: new Date().toISOString(), documentsCount: 5, summary: 'тест' },
    });
    expect(result.success).toBe(true);
    expect(h.getCases()[0].lastProcessingContext).toBeDefined();
    expect(h.getCases()[0].lastProcessingContext.documentsCount).toBe(5);
  });

  it('update_processing_context відмовляє при відсутніх обов\'язкових полях context', async () => {
    const result = await h.executeAction('document_processor_agent', 'update_processing_context', {
      caseId: 'case_001',
      context: { processedAt: 'now' }, // без documentsCount, summary
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/відсутні поля/);
  });
});
