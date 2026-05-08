// Інтеграційні тести executeAction з реальним PERMISSIONS, UI_ONLY_ACTIONS
// і ACTIONS-логікою (через _actionsHarness — поки ACTIONS не винесено
// в окремий модуль).
import { describe, it, expect, beforeEach } from 'vitest';
import { createDocument } from '../../src/services/documentFactory.js';
import { createHarness } from './_actionsHarness.js';

describe('executeAction integration', () => {
  let h;
  beforeEach(() => {
    h = createHarness({
      initialCases: [{
        id: 'case_001',
        name: 'Тестова справа',
        tenantId: 'tenant_1', ownerId: 'vadym',
        documents: [], hearings: [], proceedings: [{ id: 'proc_main', type: 'first', title: 'Основне', parentProcId: null }],
        deadlines: [], notes: [], pinnedNoteIds: [],
      }],
    });
  });

  describe('add_document', () => {
    it('успішно додає документ для dossier_agent', async () => {
      const doc = createDocument({ name: 'Test', driveId: 'fake', size: 100, addedBy: 'lawyer_manual' });
      const result = await h.executeAction('dossier_agent', 'add_document', { caseId: 'case_001', document: doc });
      expect(result.success).toBe(true);
      expect(h.getCases()[0].documents).toHaveLength(1);
      expect(h.getCases()[0].documents[0].id).toBe(doc.id);
    });

    it('блокується для dashboard_agent (немає дозволу)', async () => {
      const doc = createDocument({ name: 'Test', driveId: 'fake', size: 100 });
      const result = await h.executeAction('dashboard_agent', 'add_document', { caseId: 'case_001', document: doc });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Немає повноважень/);
      expect(h.getCases()[0].documents).toHaveLength(0);
    });

    it('відмовляє при невалідному документі (відсутні required поля)', async () => {
      const result = await h.executeAction('dossier_agent', 'add_document', {
        caseId: 'case_001',
        document: { id: 'd', name: 'X' }, // без size, addedBy, тощо
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Невалідний документ/);
    });

    it('відмовляє при дублюванні id', async () => {
      const doc = createDocument({ name: 'A', driveId: 'a', size: 1 });
      await h.executeAction('dossier_agent', 'add_document', { caseId: 'case_001', document: doc });
      const result = await h.executeAction('dossier_agent', 'add_document', { caseId: 'case_001', document: doc });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/вже існує/);
    });
  });

  describe('add_documents (batch)', () => {
    it('document_processor_agent додає batch з 3 документів', async () => {
      const docs = [
        createDocument({ name: 'A', driveId: 'a', size: 1, addedBy: 'lawyer_via_dp' }),
        createDocument({ name: 'B', driveId: 'b', size: 1, addedBy: 'lawyer_via_dp' }),
        createDocument({ name: 'C', driveId: 'c', size: 1, addedBy: 'lawyer_via_dp' }),
      ];
      const result = await h.executeAction('document_processor_agent', 'add_documents', { caseId: 'case_001', documents: docs });
      expect(result.success).toBe(true);
      expect(result.addedCount).toBe(3);
      expect(h.getCases()[0].documents).toHaveLength(3);
    });

    it('атомарна валідація: один невалідний → нічого не додано', async () => {
      const docs = [
        createDocument({ name: 'OK', driveId: 'a', size: 1 }),
        { name: 'Bad' }, // без обовʼязкових полів
      ];
      const result = await h.executeAction('document_processor_agent', 'add_documents', { caseId: 'case_001', documents: docs });
      expect(result.success).toBe(false);
      expect(h.getCases()[0].documents).toHaveLength(0);
    });

    it('document_processor_agent НЕ може create_case', async () => {
      const result = await h.executeAction('document_processor_agent', 'create_case', { fields: { name: 'X' } });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Немає повноважень/);
    });
  });

  describe('update_document', () => {
    let doc;
    beforeEach(async () => {
      doc = createDocument({ name: 'X', driveId: 'd', size: 1 });
      await h.executeAction('dossier_agent', 'add_document', { caseId: 'case_001', document: doc });
    });

    it('дозволене поле (isKey) → success', async () => {
      const result = await h.executeAction('dossier_agent', 'update_document', {
        caseId: 'case_001', documentId: doc.id, fields: { isKey: true },
      });
      expect(result.success).toBe(true);
      expect(h.getCases()[0].documents[0].isKey).toBe(true);
    });

    it('заборонене поле (addedBy) → error', async () => {
      const result = await h.executeAction('dossier_agent', 'update_document', {
        caseId: 'case_001', documentId: doc.id, fields: { addedBy: 'fake' },
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/addedBy/);
    });
  });

  describe('delete_document — UI-only через _fromUI', () => {
    let doc;
    beforeEach(async () => {
      doc = createDocument({ name: 'X', driveId: 'd', size: 1 });
      await h.executeAction('dossier_agent', 'add_document', { caseId: 'case_001', document: doc });
    });

    it('блокується без _fromUI навіть для dossier_agent', async () => {
      const result = await h.executeAction('dossier_agent', 'delete_document', {
        caseId: 'case_001', documentId: doc.id, mode: 'full',
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/UI/);
    });

    it('проходить з _fromUI: true → archive', async () => {
      const result = await h.executeAction('dossier_agent', 'delete_document', {
        caseId: 'case_001', documentId: doc.id, mode: 'archive', _fromUI: true,
      });
      expect(result.success).toBe(true);
      expect(result.mode).toBe('archive');
      expect(h.getCases()[0].documents[0].status).toBe('archived');
    });
  });

  describe('add_hearing', () => {
    it('успішно додає засідання для dossier_agent', async () => {
      const result = await h.executeAction('dossier_agent', 'add_hearing', {
        caseId: 'case_001', date: '2026-05-15', time: '10:00',
      });
      expect(result.success).toBe(true);
      expect(h.getCases()[0].hearings).toHaveLength(1);
    });

    it('відмовляє без часу', async () => {
      const result = await h.executeAction('dossier_agent', 'add_hearing', {
        caseId: 'case_001', date: '2026-05-15',
      });
      expect(result.success).toBe(false);
    });

    it('dashboard_agent теж може додати засідання', async () => {
      const result = await h.executeAction('dashboard_agent', 'add_hearing', {
        caseId: 'case_001', date: '2026-05-15', time: '10:00',
      });
      expect(result.success).toBe(true);
    });
  });
});
