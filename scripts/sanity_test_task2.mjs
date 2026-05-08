// Sanity-tests для TASK 2 — ACTIONS реєстру документів/проваджень + PERMISSIONS.
// Запуск: node scripts/sanity_test_task2.mjs
//
// Стратегія: оскільки ACTIONS і executeAction — closures всередині App-компонента
// (не експортуються), цей тест відтворює ту ж логіку у вигляді чистого мок-середовища
// зі справжніми імпортами documentFactory, validateDocument, AUDIT_ACTIONS.
// Ціль — переконатись що сценарії з критеріїв TASK 2.9 поводяться правильно.

import { createDocument, validateDocument } from '../src/services/documentFactory.js';
import { AUDIT_ACTIONS, shouldAudit } from '../src/services/auditLogService.js';

// ── Repro мок-середовища ───────────────────────────────────────────────────
let cases = [{
  id: 'case_test',
  tenantId: 'tenant_1',
  ownerId: 'vadym',
  documents: [],
  proceedings: [
    { id: 'proc_main', type: 'first', title: 'Основне', parentProcId: null, parentEventId: null, status: 'active' },
    { id: 'proc_sub', type: 'appeal', title: 'Апеляція', parentProcId: 'proc_main', parentEventId: null, status: 'active' },
  ],
}];

const setCases = (fn) => { cases = fn(cases); };

// Скопійовано isProceedingDescendant з App.jsx (інакше impossible to import).
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

const UI_ONLY_ACTIONS = new Set(['delete_document', 'delete_proceeding']);

const PERMISSIONS = {
  qi_agent: ['add_document', 'update_document', 'add_proceeding', 'update_proceeding'],
  dashboard_agent: [],
  dossier_agent: [
    'add_document', 'update_document',
    'add_proceeding', 'update_proceeding',
    'update_processing_context',
  ],
  document_processor_agent: ['add_documents', 'update_processing_context'],
};

// ACTIONS — повторюємо лише потрібні для тестів (логіка ідентична App.jsx).
const ACTIONS = {
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
    setCases(prev => prev.map(c => c.id === caseId ? { ...c, documents: [...(c.documents || []), document] } : c));
    return { success: true, documentId: document.id };
  },

  add_documents: async ({ caseId, documents }) => {
    if (!caseId) return { success: false, error: "caseId обов'язковий" };
    if (!Array.isArray(documents) || documents.length === 0) {
      return { success: false, error: 'documents має бути непорожнім масивом' };
    }
    for (let i = 0; i < documents.length; i++) {
      const { valid, errors } = validateDocument(documents[i]);
      if (!valid) return { success: false, error: `Документ ${i}: ${errors.join(', ')}` };
    }
    const targetCase = cases.find(c => c.id === caseId);
    if (!targetCase) return { success: false, error: `Справу ${caseId} не знайдено` };
    setCases(prev => prev.map(c => c.id === caseId ? { ...c, documents: [...(c.documents || []), ...documents] } : c));
    return { success: true, addedCount: documents.length, documentIds: documents.map(d => d.id) };
  },

  update_document: async ({ caseId, documentId, fields }) => {
    if (!caseId || !documentId || !fields) {
      return { success: false, error: "caseId, documentId, fields обов'язкові" };
    }
    const ALLOWED = ['name','category','author','documentNature','namingStatus','isKey','procId','driveUrl','folder','pageCount','date','icon','status'];
    const invalid = Object.keys(fields).filter(f => !ALLOWED.includes(f));
    if (invalid.length > 0) return { success: false, error: `Заборонено оновлювати поля: ${invalid.join(', ')}` };
    const targetCase = cases.find(c => c.id === caseId);
    if (!targetCase) return { success: false, error: `Справу ${caseId} не знайдено` };
    const docIdx = (targetCase.documents || []).findIndex(d => d.id === documentId);
    if (docIdx === -1) return { success: false, error: `Документ ${documentId} не знайдено` };
    const updated = { ...targetCase.documents[docIdx], ...fields, updatedAt: new Date().toISOString() };
    const { valid, errors } = validateDocument(updated);
    if (!valid) return { success: false, error: `Невалідний документ: ${errors.join(', ')}` };
    setCases(prev => prev.map(c => c.id === caseId ? { ...c, documents: c.documents.map(d => d.id === documentId ? updated : d) } : c));
    return { success: true, documentId, updatedFields: Object.keys(fields) };
  },

  delete_document: async ({ caseId, documentId, mode = 'full' }) => {
    if (!caseId || !documentId) return { success: false, error: "caseId і documentId обов'язкові" };
    const targetCase = cases.find(c => c.id === caseId);
    if (!targetCase) return { success: false, error: `Справу ${caseId} не знайдено` };
    const doc = (targetCase.documents || []).find(d => d.id === documentId);
    if (!doc) return { success: false, error: `Документ ${documentId} не знайдено` };
    if (mode === 'archive') {
      setCases(prev => prev.map(c => c.id === caseId ? { ...c, documents: c.documents.map(d => d.id === documentId ? { ...d, status: 'archived' } : d) } : c));
      return { success: true, mode: 'archive', documentId };
    }
    setCases(prev => prev.map(c => c.id === caseId ? { ...c, documents: c.documents.filter(d => d.id !== documentId) } : c));
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
    if (procs.find(p => p.id === proceeding.id)) return { success: false, error: 'дублікат id' };
    if (procs.find(p => p.title === title)) return { success: false, error: 'дублікат title' };
    if (proceeding.parentProcId && !procs.find(p => p.id === proceeding.parentProcId)) {
      return { success: false, error: `Батьківське провадження ${proceeding.parentProcId} не знайдено` };
    }
    const newProc = { ...proceeding, title, status: proceeding.status || 'active', parentProcId: proceeding.parentProcId || null };
    setCases(prev => prev.map(c => c.id === caseId ? { ...c, proceedings: [...procs, newProc] } : c));
    return { success: true, proceedingId: newProc.id };
  },

  delete_proceeding: async ({ caseId, proceedingId }) => {
    const targetCase = cases.find(c => c.id === caseId);
    if (!targetCase) return { success: false, error: 'no case' };
    const procs = targetCase.proceedings || [];
    if (!procs.find(p => p.id === proceedingId)) return { success: false, error: 'no proc' };
    const children = procs.filter(p => p.parentProcId === proceedingId);
    if (children.length > 0) return { success: false, error: 'has children' };
    const affected = (targetCase.documents || []).filter(d => d.procId === proceedingId).length;
    setCases(prev => prev.map(c => c.id === caseId ? {
      ...c,
      proceedings: c.proceedings.filter(p => p.id !== proceedingId),
      documents: (c.documents || []).map(d => d.procId === proceedingId ? { ...d, procId: null } : d),
    } : c));
    return { success: true, proceedingId, affectedDocumentsCount: affected };
  },

  update_processing_context: async ({ caseId, context }) => {
    if (!caseId || !context) return { success: false, error: "caseId і context обов'язкові" };
    const required = ['processedAt','documentsCount','summary'];
    const missing = required.filter(f => context[f] === undefined || context[f] === null);
    if (missing.length > 0) return { success: false, error: `відсутні: ${missing.join(', ')}` };
    setCases(prev => prev.map(c => c.id === caseId ? { ...c, lastProcessingContext: context } : c));
    return { success: true };
  },

  create_case: async () => ({ success: true, caseId: 'case_new' }),
};

const executeAction = async (agentId, action, params) => {
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
  return await ACTIONS[action](params);
};

// ── Tests ──────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function assert(cond, label, extra = '') {
  if (cond) { console.log(`✓ ${label}`); pass++; }
  else      { console.log(`✗ ${label}  ${extra}`); fail++; }
}

console.log('━━━ TASK 2 sanity-tests ━━━\n');

// AUDIT_ACTIONS
assert(AUDIT_ACTIONS.includes('add_document'), 'AUDIT_ACTIONS має add_document');
assert(AUDIT_ACTIONS.includes('add_documents'), 'AUDIT_ACTIONS має add_documents');
assert(AUDIT_ACTIONS.includes('update_document'), 'AUDIT_ACTIONS має update_document');
assert(AUDIT_ACTIONS.includes('delete_document'), 'AUDIT_ACTIONS має delete_document');
assert(AUDIT_ACTIONS.includes('add_proceeding'), 'AUDIT_ACTIONS має add_proceeding');
assert(AUDIT_ACTIONS.includes('update_proceeding'), 'AUDIT_ACTIONS має update_proceeding');
assert(AUDIT_ACTIONS.includes('delete_proceeding'), 'AUDIT_ACTIONS має delete_proceeding');
assert(!shouldAudit('update_processing_context'), 'update_processing_context НЕ в audit (службова)');
console.log();

// Test 1: add_document — success
const newDoc = createDocument({
  name: 'Test doc',
  driveId: 'fake_drive_id_1',
  size: 100,
  procId: 'proc_main',
  category: 'pleading',
  author: 'ours',
  addedBy: 'lawyer_manual',
});
const r1 = await executeAction('dossier_agent', 'add_document', { caseId: 'case_test', document: newDoc });
assert(r1.success === true, 'Test 1: add_document success', JSON.stringify(r1));

// Test 2: add_documents (batch) — 3 docs
const doc2 = createDocument({ name: 'D2', driveId: 'd2', size: 1, procId: 'proc_main', category: 'evidence', author: 'opponent', addedBy: 'lawyer_via_dp' });
const doc3 = createDocument({ name: 'D3', driveId: 'd3', size: 1, procId: 'proc_main', category: 'court_act', author: 'court', addedBy: 'lawyer_via_dp' });
const doc4 = createDocument({ name: 'D4', driveId: 'd4', size: 1, procId: 'proc_main', category: null, author: null, addedBy: 'lawyer_via_dp' });
const r2 = await executeAction('document_processor_agent', 'add_documents', { caseId: 'case_test', documents: [doc2, doc3, doc4] });
assert(r2.success === true && r2.addedCount === 3, 'Test 2: add_documents batch addedCount=3', JSON.stringify(r2));

// Test 3: update_document — allowed field (isKey)
const r3 = await executeAction('dossier_agent', 'update_document', {
  caseId: 'case_test', documentId: newDoc.id, fields: { isKey: true },
});
assert(r3.success === true, 'Test 3: update_document allowed field (isKey)', JSON.stringify(r3));

// Test 4: update_document — forbidden field (addedBy)
const r4 = await executeAction('dossier_agent', 'update_document', {
  caseId: 'case_test', documentId: newDoc.id, fields: { addedBy: 'fake' },
});
assert(r4.success === false && /addedBy/.test(r4.error || ''), 'Test 4: update_document forbidden field (addedBy)', JSON.stringify(r4));

// Test 5: delete_document без _fromUI
const r5 = await executeAction('dossier_agent', 'delete_document', {
  caseId: 'case_test', documentId: newDoc.id, mode: 'full',
});
assert(r5.success === false && /UI/i.test(r5.error || ''), 'Test 5: delete_document blocked без _fromUI', JSON.stringify(r5));

// Test 6: delete_document з _fromUI (archive)
const r6 = await executeAction('dossier_agent', 'delete_document', {
  caseId: 'case_test', documentId: newDoc.id, mode: 'archive', _fromUI: true,
});
assert(r6.success === true && r6.mode === 'archive', 'Test 6: delete_document _fromUI archive', JSON.stringify(r6));

// Test 7: add_proceeding з parentProcId
const r7 = await executeAction('dossier_agent', 'add_proceeding', {
  caseId: 'case_test',
  proceeding: { id: 'proc_test', type: 'appeal', title: 'Test Appeal', parentProcId: 'proc_main' },
});
assert(r7.success === true, 'Test 7: add_proceeding з parentProcId', JSON.stringify(r7));

// Test 8: delete_proceeding без _fromUI
const r8 = await executeAction('dossier_agent', 'delete_proceeding', {
  caseId: 'case_test', proceedingId: 'proc_test',
});
assert(r8.success === false && /UI/i.test(r8.error || ''), 'Test 8: delete_proceeding blocked без _fromUI', JSON.stringify(r8));

// Test 9: document_processor_agent НЕ може create_case
const r9 = await executeAction('document_processor_agent', 'create_case', { fields: { name: 'X' } });
assert(r9.success === false && /повноважень/i.test(r9.error || ''), 'Test 9: document_processor_agent заблокований на create_case', JSON.stringify(r9));

// Bonus: isProceedingDescendant — циклічна перевірка
assert(isProceedingDescendant(cases[0].proceedings, 'proc_sub', 'proc_main') === true, 'Bonus: isProceedingDescendant proc_sub є нащадком proc_main');
assert(isProceedingDescendant(cases[0].proceedings, 'proc_main', 'proc_sub') === false, 'Bonus: proc_main НЕ нащадок proc_sub');

// Bonus: add_documents — атомарність (один невалідний → нічого не додано)
const docsBeforeBatch = cases[0].documents.length;
const badDoc = { id: 'doc_bad', name: 'bad' }; // без обов'язкових полів
const goodDoc = createDocument({ name: 'good', driveId: 'g', size: 1, procId: null, category: null, author: null, addedBy: 'agent' });
const rBatch = await executeAction('document_processor_agent', 'add_documents', { caseId: 'case_test', documents: [goodDoc, badDoc] });
assert(rBatch.success === false, 'Bonus: add_documents атомарність — батч з невалідним падає', JSON.stringify(rBatch));
assert(cases[0].documents.length === docsBeforeBatch, 'Bonus: жодного документа з провального батчу не додано');

// Bonus: update_processing_context з валідним context
const rCtx = await executeAction('dossier_agent', 'update_processing_context', {
  caseId: 'case_test',
  context: { processedAt: new Date().toISOString(), documentsCount: 5, summary: 'test' },
});
assert(rCtx.success === true, 'Bonus: update_processing_context дозволений dossier_agent');

console.log(`\n━━━ Результат: ${pass} pass, ${fail} fail ━━━`);
process.exit(fail > 0 ? 1 : 0);
