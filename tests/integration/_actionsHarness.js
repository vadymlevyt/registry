// Shared harness для інтеграційних тестів executeAction/ACTIONS/PERMISSIONS.
//
// ВАЖЛИВО: ACTIONS і PERMISSIONS наразі живуть як closures всередині App.jsx —
// винести в окремий файл `src/services/actionsRegistry.js` — окремий TASK
// (див. discovered_issues_during_task4.md). Поки що цей harness повторює
// САМЕ ТУ логіку що в App.jsx — точкові методи які тестують інтеграційні файли.
//
// Контракт: createHarness({ initialCases }) → { executeAction, getCases, ... }.
// Кожен тест отримує свій ізольований state.
import { validateDocument, createDocument } from '../../src/services/documentFactory.js';
import { deleteExtendedForDocument } from '../../src/services/documentsExtended.js';

const PERMISSIONS = {
  qi_agent: [
    'create_case', 'close_case', 'restore_case',
    'update_case_field',
    'add_deadline', 'update_deadline', 'delete_deadline',
    'add_hearing', 'update_hearing', 'delete_hearing',
    'add_note', 'update_note', 'delete_note', 'pin_note', 'unpin_note',
    'add_document', 'update_document',
    'add_proceeding', 'update_proceeding',
  ],
  dashboard_agent: [
    'add_hearing', 'update_hearing', 'delete_hearing',
    'add_note', 'update_note', 'delete_note',
  ],
  dossier_agent: [
    'create_case', 'close_case', 'restore_case',
    'update_case_field',
    'add_deadline', 'update_deadline', 'delete_deadline',
    'add_hearing', 'update_hearing', 'delete_hearing',
    'add_note', 'update_note', 'delete_note', 'pin_note', 'unpin_note',
    'add_document', 'update_document',
    'add_proceeding', 'update_proceeding',
    'update_processing_context',
  ],
  document_processor_agent: [
    'add_documents', 'update_processing_context',
  ],
};

const UI_ONLY_ACTIONS = new Set(['delete_document', 'delete_proceeding']);

function isProceedingDescendant(proceedings, candidateId, ancestorId) {
  if (!Array.isArray(proceedings)) return false;
  let current = proceedings.find(p => p.id === candidateId);
  const visited = new Set();
  while (current && current.parentProcId) {
    if (visited.has(current.id)) return false;
    visited.add(current.id);
    if (current.parentProcId === ancestorId) return true;
    current = proceedings.find(p => p.id === current.parentProcId);
  }
  return false;
}

export function createHarness({ initialCases = [] } = {}) {
  let cases = JSON.parse(JSON.stringify(initialCases));
  const auditLog = [];
  // Реєстр видалених driveId — harness не робить HTTP виклики, але треба
  // тестувати що delete_document з mode='full' каскадно видаляє driveId і
  // originalDriveId. Тести читають через getDeletedDriveIds.
  const deletedDriveIds = [];

  const setCases = (updater) => {
    cases = typeof updater === 'function' ? updater(cases) : updater;
  };

  const ACTIONS = {
    create_case: ({ fields }) => {
      const newCase = {
        id: `case_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        tenantId: 'tenant_1',
        ownerId: 'vadym',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        hearings: [], deadlines: [], documents: [], proceedings: [],
        notes: [], pinnedNoteIds: [], agentHistory: [],
        ...fields,
      };
      setCases(prev => [...prev, newCase]);
      return { success: true, caseId: newCase.id };
    },

    update_case_field: ({ caseId, field, value }) => {
      const allowed = ['name', 'client', 'court', 'case_no', 'category', 'next_action', 'notes', 'judge', 'status'];
      if (!allowed.includes(field)) {
        return { success: false, error: `Поле "${field}" не дозволено змінювати через агента` };
      }
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, [field]: value, updatedAt: new Date().toISOString() }
          : c
      ));
      return { success: true };
    },

    close_case: ({ caseId }) => {
      setCases(prev => prev.map(c =>
        c.id === caseId ? { ...c, status: 'closed', updatedAt: new Date().toISOString() } : c
      ));
      return { success: true };
    },

    restore_case: ({ caseId }) => {
      setCases(prev => prev.map(c =>
        c.id === caseId ? { ...c, status: 'active', updatedAt: new Date().toISOString() } : c
      ));
      return { success: true };
    },

    add_hearing: ({ caseId, date, time, duration = 120, type = null }) => {
      if (!date) return { success: false, error: "Дата засідання обов'язкова" };
      if (!time || !String(time).trim()) return { success: false, error: "Час засідання обов'язковий" };
      const hearing = { id: `hrg_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, date, time, duration, status: 'scheduled', type };
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, hearings: [...(c.hearings || []), hearing], updatedAt: new Date().toISOString() }
          : c
      ));
      return { success: true, hearingId: hearing.id };
    },

    update_hearing: ({ caseId, hearingId, date, time, duration, type }) => {
      setCases(prev => prev.map(c => {
        if (c.id !== caseId) return c;
        return {
          ...c,
          hearings: (c.hearings || []).map(h =>
            h.id === hearingId
              ? { ...h, date: date ?? h.date, time: time ?? h.time, duration: duration ?? h.duration, type: type ?? h.type }
              : h
          ),
        };
      }));
      return { success: true };
    },

    delete_hearing: ({ caseId, hearingId }) => {
      const targetCase = cases.find(c => c.id === caseId);
      if (!targetCase) return { success: false, error: `Справу ${caseId} не знайдено` };
      const exists = (targetCase.hearings || []).some(h => h.id === hearingId);
      if (!exists) return { success: false, error: `Засідання ${hearingId} не знайдено` };
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, hearings: c.hearings.filter(h => h.id !== hearingId) }
          : c
      ));
      return { success: true };
    },

    add_deadline: ({ caseId, name, date }) => {
      if (!name || !date) return { success: false, error: "name і date обов'язкові" };
      const deadline = { id: `dl_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, name, date };
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, deadlines: [...(c.deadlines || []), deadline] }
          : c
      ));
      return { success: true, deadlineId: deadline.id };
    },

    add_note: ({ caseId, text, category = 'general' }) => {
      const note = {
        id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        text, category, caseId,
      };
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, notes: [...(c.notes || []), note] }
          : c
      ));
      return { success: true, noteId: note.id };
    },

    pin_note: ({ noteId, caseId }) => {
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, pinnedNoteIds: [...new Set([...(c.pinnedNoteIds || []), String(noteId)])] }
          : c
      ));
      return { success: true };
    },

    add_document: async ({ caseId, document }) => {
      if (!caseId)   return { success: false, error: "caseId обов'язковий" };
      if (!document) return { success: false, error: "document обов'язковий" };
      const { valid, errors } = validateDocument(document);
      if (!valid) return { success: false, error: `Невалідний документ: ${errors.join(', ')}` };
      const targetCase = cases.find(c => c.id === caseId);
      if (!targetCase) return { success: false, error: `Справу ${caseId} не знайдено` };
      if ((targetCase.documents || []).find(d => d.id === document.id)) {
        return { success: false, error: `Документ ${document.id} вже існує у справі` };
      }
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, documents: [...(c.documents || []), document], updatedAt: new Date().toISOString() }
          : c
      ));
      return { success: true, documentId: document.id };
    },

    add_documents: async ({ caseId, documents }) => {
      if (!caseId) return { success: false, error: "caseId обов'язковий" };
      if (!Array.isArray(documents) || documents.length === 0) {
        return { success: false, error: 'documents має бути непорожнім масивом' };
      }
      const validationErrors = [];
      for (let i = 0; i < documents.length; i++) {
        const { valid, errors } = validateDocument(documents[i]);
        if (!valid) validationErrors.push(`Документ ${i}: ${errors.join(', ')}`);
      }
      if (validationErrors.length > 0) {
        return { success: false, error: `Валідація не пройдена для ${validationErrors.length} документів`, errors: validationErrors };
      }
      const targetCase = cases.find(c => c.id === caseId);
      if (!targetCase) return { success: false, error: `Справу ${caseId} не знайдено` };
      const existingIds = new Set((targetCase.documents || []).map(d => d.id));
      const dup = documents.filter(d => existingIds.has(d.id));
      if (dup.length > 0) return { success: false, error: `${dup.length} дублікатів`, duplicates: dup.map(d => d.id) };
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, documents: [...(c.documents || []), ...documents], updatedAt: new Date().toISOString() }
          : c
      ));
      return { success: true, addedCount: documents.length, documentIds: documents.map(d => d.id) };
    },

    update_document: async ({ caseId, documentId, fields }) => {
      if (!caseId || !documentId || !fields) return { success: false, error: "caseId, documentId, fields обов'язкові" };
      const allowed = ['name', 'category', 'author', 'documentNature', 'namingStatus', 'isKey', 'procId', 'driveUrl', 'folder', 'pageCount', 'date', 'icon', 'status', 'lastOcrAt'];
      const invalid = Object.keys(fields).filter(f => !allowed.includes(f));
      if (invalid.length > 0) return { success: false, error: `Заборонено оновлювати поля: ${invalid.join(', ')}` };
      const targetCase = cases.find(c => c.id === caseId);
      if (!targetCase) return { success: false, error: `Справу ${caseId} не знайдено` };
      const docIdx = (targetCase.documents || []).findIndex(d => d.id === documentId);
      if (docIdx === -1) return { success: false, error: `Документ ${documentId} не знайдено` };
      const updated = { ...targetCase.documents[docIdx], ...fields, updatedAt: new Date().toISOString() };
      const { valid, errors } = validateDocument(updated);
      if (!valid) return { success: false, error: `Невалідний документ: ${errors.join(', ')}` };
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, documents: c.documents.map(d => d.id === documentId ? updated : d) }
          : c
      ));
      return { success: true, documentId, updatedFields: Object.keys(fields) };
    },

    delete_document: async ({ caseId, documentId, mode = 'full' }) => {
      if (!caseId || !documentId) return { success: false, error: "caseId і documentId обов'язкові" };
      if (!['full', 'registry_only', 'archive'].includes(mode)) {
        return { success: false, error: `Невідомий режим: ${mode}` };
      }
      const targetCase = cases.find(c => c.id === caseId);
      if (!targetCase) return { success: false, error: `Справу ${caseId} не знайдено` };
      const doc = (targetCase.documents || []).find(d => d.id === documentId);
      if (!doc) return { success: false, error: `Документ ${documentId} не знайдено` };

      if (mode === 'archive') {
        setCases(prev => prev.map(c =>
          c.id === caseId
            ? { ...c, documents: c.documents.map(d => d.id === documentId ? { ...d, status: 'archived' } : d) }
            : c
        ));
        return { success: true, mode: 'archive', documentId };
      }
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, documents: c.documents.filter(d => d.id !== documentId) }
          : c
      ));
      // mode === 'full' — каскадне видалення з Drive. Harness не робить
      // реальних HTTP викликів — реєструє які driveId були видалені, тест
      // перевіряє цей список через getDeletedDriveIds.
      if (mode === 'full') {
        if (doc.driveId) deletedDriveIds.push(doc.driveId);
        if (doc.originalDriveId) deletedDriveIds.push(doc.originalDriveId);
      }
      return { success: true, mode, documentId };
    },

    add_proceeding: async ({ caseId, proceeding }) => {
      if (!caseId || !proceeding) return { success: false, error: "caseId і proceeding обов'язкові" };
      const title = proceeding.title || proceeding.name;
      if (!proceeding.id || !title || !proceeding.type) {
        return { success: false, error: 'proceeding має мати id, title (або name), type' };
      }
      const targetCase = cases.find(c => c.id === caseId);
      if (!targetCase) return { success: false, error: `Справу ${caseId} не знайдено` };
      const procs = targetCase.proceedings || [];
      if (procs.find(p => p.id === proceeding.id)) return { success: false, error: `Провадження ${proceeding.id} вже існує` };
      if (procs.find(p => p.title === title)) return { success: false, error: `Провадження "${title}" вже існує` };
      if (proceeding.parentProcId && !procs.find(p => p.id === proceeding.parentProcId)) {
        return { success: false, error: `Батьківське провадження ${proceeding.parentProcId} не знайдено` };
      }
      const newProc = { ...proceeding, title, status: proceeding.status || 'active', parentProcId: proceeding.parentProcId || null };
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, proceedings: [...procs, newProc] }
          : c
      ));
      return { success: true, proceedingId: newProc.id };
    },

    update_processing_context: async ({ caseId, context }) => {
      if (!caseId || !context) return { success: false, error: "caseId і context обов'язкові" };
      const required = ['processedAt', 'documentsCount', 'summary'];
      const missing = required.filter(f => context[f] === undefined || context[f] === null);
      if (missing.length > 0) return { success: false, error: `У context відсутні поля: ${missing.join(', ')}` };
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, lastProcessingContext: context }
          : c
      ));
      return { success: true };
    },
  };

  const executeAction = async (agentId, action, params, _userId) => {
    if (UI_ONLY_ACTIONS.has(action)) {
      if (!params?._fromUI) {
        return { success: false, error: `Дія ${action} доступна лише через UI` };
      }
    } else {
      const allowed = PERMISSIONS[agentId] || [];
      if (!allowed.includes(action)) {
        return { success: false, error: `Немає повноважень: ${action}` };
      }
    }
    if (!ACTIONS[action]) return { success: false, error: `Невідома дія: ${action}` };
    try {
      return await ACTIONS[action](params);
    } catch (e) {
      return { success: false, error: e.message };
    }
  };

  return {
    executeAction,
    getCases: () => cases,
    getAuditLog: () => auditLog,
    getDeletedDriveIds: () => [...deletedDriveIds],
    PERMISSIONS,
    UI_ONLY_ACTIONS,
  };
}
