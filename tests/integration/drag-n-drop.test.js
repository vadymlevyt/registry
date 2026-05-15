// Інтеграційний тест drag-n-drop workflow в досьє:
//  адвокат перетягнув файл → uploadFileLocal (mock) → createDocument →
//  add_document через executeAction → запис у cases[].documents[] з ⚠ маркером.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDocument, needsReview } from '../../src/services/documentFactory.js';
import { createHarness } from './_actionsTestSetup.js';

// Імітуємо логіку drag-n-drop циклу з CaseDossier:1942-1985 — точкова копія
// без UI, щоб перевірити саме контракт між UI і executeAction.
async function processDropQueue({ files, caseId, executeAction, uploadFileLocal }) {
  const results = [];
  for (const file of files) {
    try {
      const driveId = await uploadFileLocal(file);
      const newDoc = createDocument({
        driveId: driveId || null,
        driveUrl: driveId ? `https://drive.google.com/file/d/${driveId}/view` : null,
        name: file.name,
        originalName: file.name,
        size: file.size,
        folder: '01_ОРИГІНАЛИ',
        addedBy: 'lawyer_manual',
        namingStatus: 'pending',
        category: null,
        author: null,
        procId: null,
      });
      const result = await executeAction('dossier_agent', 'add_document', {
        caseId, document: newDoc,
      });
      results.push({ file: file.name, success: result.success, error: result.error, doc: newDoc });
    } catch (err) {
      results.push({ file: file.name, success: false, error: err.message });
    }
  }
  return results;
}

describe('drag-n-drop workflow', () => {
  let h;
  beforeEach(() => {
    h = createHarness({
      initialCases: [{
        id: 'case_001', name: 'Test',
        documents: [], hearings: [], proceedings: [], deadlines: [], notes: [], pinnedNoteIds: [],
      }],
    });
  });

  it('1 файл успішно додається в реєстр з ⚠ маркером', async () => {
    const upload = vi.fn(async () => 'fake_drive_id_1');
    const results = await processDropQueue({
      files: [{ name: 'позов.pdf', size: 1024 }],
      caseId: 'case_001',
      executeAction: h.executeAction,
      uploadFileLocal: upload,
    });
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(h.getCases()[0].documents).toHaveLength(1);
    // Маркер ⚠ — category/author/procId = null
    expect(needsReview(h.getCases()[0].documents[0])).toBe(true);
  });

  it('3 файли по черзі — всі додаються (race-safe через функціональні setCases)', async () => {
    const upload = vi.fn(async (f) => `drv_${f.name}`);
    const files = [
      { name: 'a.pdf', size: 100 },
      { name: 'b.pdf', size: 200 },
      { name: 'c.pdf', size: 300 },
    ];
    const results = await processDropQueue({
      files, caseId: 'case_001',
      executeAction: h.executeAction, uploadFileLocal: upload,
    });
    expect(results.every(r => r.success)).toBe(true);
    expect(h.getCases()[0].documents).toHaveLength(3);
    // Усі IDs унікальні
    const ids = h.getCases()[0].documents.map(d => d.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('Якщо upload одного файлу падає — інші все одно додаються', async () => {
    const upload = vi.fn(async (f) => {
      if (f.name === 'bad.pdf') throw new Error('Upload failed');
      return `drv_${f.name}`;
    });
    const files = [
      { name: 'a.pdf', size: 100 },
      { name: 'bad.pdf', size: 200 },
      { name: 'c.pdf', size: 300 },
    ];
    const results = await processDropQueue({
      files, caseId: 'case_001',
      executeAction: h.executeAction, uploadFileLocal: upload,
    });
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[2].success).toBe(true);
    expect(h.getCases()[0].documents).toHaveLength(2);
    expect(h.getCases()[0].documents.map(d => d.name)).toEqual(['a.pdf', 'c.pdf']);
  });

  it('Файл без Drive (offline) теж додається — driveId=null', async () => {
    const upload = vi.fn(async () => null);
    const results = await processDropQueue({
      files: [{ name: 'offline.pdf', size: 100 }],
      caseId: 'case_001',
      executeAction: h.executeAction,
      uploadFileLocal: upload,
    });
    expect(results[0].success).toBe(true);
    expect(h.getCases()[0].documents[0].driveId).toBeNull();
  });

  it('TASK 2 patch — використовує add_document, НЕ update_case_field', async () => {
    // Перевіряємо що update_case_field з полем "documents" заборонений.
    const result = await h.executeAction('dossier_agent', 'update_case_field', {
      caseId: 'case_001',
      field: 'documents',
      value: [],
    });
    // Реальний update_case_field на забороненому полі повертає { error } БЕЗ
    // success:false (на відміну від сусідніх ACTIONS — латентна неконсистентність,
    // tracking_debt). Старий _actionsHarness додавав success:false від себе.
    // TASK 5 (behavior-preserving): ACTION не чіпаємо, асерт вирівняно на
    // фактичну форму, інтент незмінний (відмова = не-успіх + повідомлення).
    expect(result.success).toBeFalsy();
    expect(result.error).toMatch(/documents.*не дозволено|не дозволено.*documents/);
  });
});
