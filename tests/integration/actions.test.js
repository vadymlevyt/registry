// Інтеграційні тести executeAction з реальним PERMISSIONS, UI_ONLY_ACTIONS
// і ACTIONS-логікою — через справжній createActions (src/services/actionsRegistry.js),
// зведений у _actionsTestSetup.js (ACTIONS винесено з App.jsx, TASK 5).
import { describe, it, expect, beforeEach } from 'vitest';
import { createDocument } from '../../src/services/documentFactory.js';
import { createHarness } from './_actionsTestSetup.js';

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

    // A7.4 — inline-правка метаданів у «Деталях» вʼювера ОБОВʼЯЗКОВО йде через
    // update_document ACTION (R2: аудит/білінг/permission), не локальний updateCase.
    it('A7.4: date/author/category тече через update_document ACTION', async () => {
      const result = await h.executeAction('dossier_agent', 'update_document', {
        caseId: 'case_001', documentId: doc.id,
        fields: { date: '2026-03-14', author: 'opponent', category: 'motion' },
      });
      expect(result.success).toBe(true);
      const updated = h.getCases()[0].documents[0];
      expect(updated.date).toBe('2026-03-14');
      expect(updated.author).toBe('opponent');
      expect(updated.category).toBe('motion');
    });

    it('A7.4: очищення дати (null) через update_document — валідне', async () => {
      await h.executeAction('dossier_agent', 'update_document', {
        caseId: 'case_001', documentId: doc.id, fields: { date: '2026-03-14' },
      });
      const result = await h.executeAction('dossier_agent', 'update_document', {
        caseId: 'case_001', documentId: doc.id, fields: { date: null },
      });
      expect(result.success).toBe(true);
      expect(h.getCases()[0].documents[0].date).toBe(null);
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

    it('mode=full каскадно видаляє і driveId, і originalDriveId з Drive', async () => {
      // Конвертований DOCX: driveId → PDF, originalDriveId → DOCX поряд.
      // Раніше при видаленні видалявся тільки driveId, originalDriveId
      // лишався сиротою на Drive.
      const convertedDoc = createDocument({
        name: 'Позов Кісельової',
        driveId: 'drive_pdf_42',
        originalDriveId: 'drive_docx_orig',
        originalMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 25000,
      });
      await h.executeAction('dossier_agent', 'add_document', {
        caseId: 'case_001', document: convertedDoc,
      });

      const result = await h.executeAction('dossier_agent', 'delete_document', {
        caseId: 'case_001', documentId: convertedDoc.id, mode: 'full', _fromUI: true,
      });

      expect(result.success).toBe(true);
      const deleted = h.getDeletedDriveIds();
      expect(deleted).toContain('drive_pdf_42');
      expect(deleted).toContain('drive_docx_orig');
    });

    it('mode=full без originalDriveId видаляє тільки driveId (нормальний PDF)', async () => {
      // PDF passthrough — originalDriveId null. Перевіряємо що каскад не
      // кидає помилку на null і видаляє лише основний файл.
      const result = await h.executeAction('dossier_agent', 'delete_document', {
        caseId: 'case_001', documentId: doc.id, mode: 'full', _fromUI: true,
      });
      expect(result.success).toBe(true);
      const deleted = h.getDeletedDriveIds();
      expect(deleted).toContain('d');
      expect(deleted).toHaveLength(1); // тільки driveId, не дублюється null
    });
  });

  describe('delete_documents / restore_documents — батч (TASK bulk_delete_unify)', () => {
    let docs;
    beforeEach(async () => {
      docs = [
        createDocument({ name: 'A', driveId: 'da', size: 1 }),
        createDocument({ name: 'B', driveId: 'db', originalDriveId: 'db_orig', size: 1 }),
        createDocument({ name: 'C', driveId: 'dc', size: 1 }),
      ];
      for (const d of docs) {
        await h.executeAction('dossier_agent', 'add_document', { caseId: 'case_001', document: d });
      }
    });

    it('блокується без _fromUI (UI-only)', async () => {
      const r = await h.executeAction('dossier_agent', 'delete_documents', {
        caseId: 'case_001', documentIds: docs.map(d => d.id), mode: 'full',
      });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/UI/);
    });

    it('mode=archive — один прохід виставляє status archived усім', async () => {
      const ids = [docs[0].id, docs[2].id];
      const r = await h.executeAction('dossier_agent', 'delete_documents', {
        caseId: 'case_001', documentIds: ids, mode: 'archive', _fromUI: true,
      });
      expect(r.success).toBe(true);
      expect(r.mode).toBe('archive');
      expect(r.deleted.sort()).toEqual(ids.sort());
      const byId = Object.fromEntries(h.getCases()[0].documents.map(d => [d.id, d.status]));
      expect(byId[docs[0].id]).toBe('archived');
      expect(byId[docs[1].id]).not.toBe('archived');
      expect(byId[docs[2].id]).toBe('archived');
    });

    it('mode=full — прибирає всі id з реєстру і кличе Drive-батч (driveId+originalDriveId)', async () => {
      const ids = docs.map(d => d.id);
      const r = await h.executeAction('dossier_agent', 'delete_documents', {
        caseId: 'case_001', documentIds: ids, mode: 'full', _fromUI: true,
      });
      expect(r.success).toBe(true);
      expect(r.deleted.sort()).toEqual(ids.sort());
      expect(h.getCases()[0].documents).toHaveLength(0);
      const deleted = h.getDeletedDriveIds();
      expect(deleted).toContain('da');
      expect(deleted).toContain('db');
      expect(deleted).toContain('db_orig'); // оригінал поряд
      expect(deleted).toContain('dc');
    });

    it('mode=registry_only — реєстр чистий, Drive не чіпається', async () => {
      const r = await h.executeAction('dossier_agent', 'delete_documents', {
        caseId: 'case_001', documentIds: [docs[0].id], mode: 'registry_only', _fromUI: true,
      });
      expect(r.success).toBe(true);
      expect(h.getCases()[0].documents).toHaveLength(2);
      expect(h.getDeletedDriveIds()).toHaveLength(0);
    });

    it('частковий збіг: неіснуючі id → у failed, наявні видалено', async () => {
      const r = await h.executeAction('dossier_agent', 'delete_documents', {
        caseId: 'case_001', documentIds: [docs[0].id, 'ghost'], mode: 'full', _fromUI: true,
      });
      expect(r.success).toBe(true);
      expect(r.deleted).toEqual([docs[0].id]);
      expect(r.failed).toEqual(['ghost']);
    });

    it('порожній documentIds → error', async () => {
      const r = await h.executeAction('dossier_agent', 'delete_documents', {
        caseId: 'case_001', documentIds: [], mode: 'full', _fromUI: true,
      });
      expect(r.success).toBe(false);
    });

    it('restore_documents — один прохід повертає status active (не UI-only)', async () => {
      const ids = [docs[0].id, docs[1].id];
      // спершу архівуємо
      await h.executeAction('dossier_agent', 'delete_documents', {
        caseId: 'case_001', documentIds: ids, mode: 'archive', _fromUI: true,
      });
      const r = await h.executeAction('dossier_agent', 'restore_documents', {
        caseId: 'case_001', documentIds: ids,
      });
      expect(r.success).toBe(true);
      expect(r.restored.sort()).toEqual(ids.sort());
      const byId = Object.fromEntries(h.getCases()[0].documents.map(d => [d.id, d.status]));
      expect(byId[docs[0].id]).toBe('active');
      expect(byId[docs[1].id]).toBe('active');
    });

    it('time_entries / ai_usage НЕ зачіпаються видаленням документа', async () => {
      // Леджери — свідома межа (B.4). Видалення документа їх не торкає.
      const before = h.getTimeEntries().length;
      await h.executeAction('dossier_agent', 'delete_documents', {
        caseId: 'case_001', documentIds: docs.map(d => d.id), mode: 'full', _fromUI: true,
      });
      expect(h.getTimeEntries().length).toBe(before);
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
