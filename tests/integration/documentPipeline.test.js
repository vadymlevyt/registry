// Інтеграційний тест: documentPipeline persist-стадія → СПРАВЖНІЙ
// executeAction('dossier_agent','add_document') через реальний createActions
// (НУЛЬ дублювання ACTION-логіки — поверх _actionsTestSetup, як і інші
// інтеграційні тести). Перевіряє контракт DP-1 ↔ actionsRegistry: документ
// реально лягає у cases[].documents, дублікат → PERSIST_FAILED fatal.
import { describe, it, expect, beforeEach } from 'vitest';
import { createDocumentPipeline } from '../../src/services/documentPipeline.js';
import { createDocument } from '../../src/services/documentFactory.js';
import { createHarness } from './_actionsTestSetup.js';

const CASE = {
  id: 'case_dp',
  name: 'Справа DP',
  tenantId: 'tenant_1',
  ownerId: 'vadym',
  documents: [],
  proceedings: [{ id: 'proc_main', title: 'Основне' }],
};

function makePipeline(h) {
  return createDocumentPipeline({
    // raw-файл: passthrough-конвертер (без реального Drive/мережі)
    convertToPdf: async () => ({
      pdfBlob: { size: 42 }, originalBlob: null, pdfName: 'd', originalName: 'd.pdf',
      originalMime: 'application/pdf', extractedText: null, warnings: [],
      converter: 'passthrough', durationMs: 1,
    }),
    uploadFile: async () => 'drive_dp_1',
    createDocument,                                  // СПРАВЖНЯ канонічна фабрика
    buildDocumentMetadata: ({ driveId }) => ({
      procId: 'proc_main',
      name: 'Позов',
      category: null, author: null,
      documentNature: 'searchable',
      driveId,
      driveUrl: driveId ? `https://drive.google.com/file/d/${driveId}/view` : null,
      folder: '01_ОРИГІНАЛИ',
      addedBy: 'user',
      namingStatus: 'manual',
      source: 'manual',
    }),
    // Персистенція ТІЛЬКИ через справжній executeAction (audit/billing/perm
    // висять там) — диригент сам нічого в стан не пише.
    persistDocument: ({ caseId, document }) =>
      h.executeAction('dossier_agent', 'add_document', { caseId, document }),
    eventBus: { publish: () => {} },
    topics: { DOCUMENT_INGESTED: 'document.ingested', DOCUMENT_BATCH_PROCESSED: 'document.batch_processed' },
    getActor: () => ({ userId: 'vadym', tenantId: 'tenant_1' }),
  });
}

describe('documentPipeline ↔ реальний add_document (інтеграція)', () => {
  let h;
  beforeEach(() => {
    h = createHarness({ initialCases: [structuredClone(CASE)] });
  });

  it('успіх: документ лягає у cases[].documents через справжній ACTION', async () => {
    const res = await makePipeline(h).run({
      caseId: 'case_dp',
      caseData: { id: 'case_dp' },
      files: [{ fileId: 'd', raw: { name: 'a.pdf', size: 5, type: 'application/pdf' } }],
    });
    expect(res.ok).toBe(true);
    expect(res.documents).toHaveLength(1);

    const stored = h.getCases().find(c => c.id === 'case_dp').documents;
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(res.documents[0].id);
    expect(stored[0].source).toBe('manual');
    expect(stored[0].addedBy).toBe('user');
  });

  it('дублікат id → реальний add_document відмовляє → PERSIST_FAILED fatal', async () => {
    const dup = createDocument({
      id: 'doc_dup', name: 'Існуючий', procId: 'proc_main',
      documentNature: 'searchable', addedBy: 'user', source: 'manual',
    });
    await h.executeAction('dossier_agent', 'add_document', { caseId: 'case_dp', document: dup });

    const pipe = createDocumentPipeline({
      convertToPdf: async () => ({
        pdfBlob: { size: 1 }, originalBlob: null, pdfName: 'd', originalName: 'd.pdf',
        originalMime: 'application/pdf', extractedText: null, warnings: [],
        converter: 'passthrough', durationMs: 1,
      }),
      uploadFile: async () => 'drive_dp_2',
      createDocument: () => dup,                      // повертаємо той самий id
      persistDocument: ({ caseId, document }) =>
        h.executeAction('dossier_agent', 'add_document', { caseId, document }),
    });

    const res = await pipe.run({
      caseId: 'case_dp', caseData: { id: 'case_dp' },
      files: [{ fileId: 'd', raw: { name: 'b.pdf', size: 2, type: 'application/pdf' } }],
    });
    expect(res.ok).toBe(false);
    expect(res.stoppedAt).toBe('persist');
    expect(res.errors[0].code).toBe('PERSIST_FAILED');
    // У справі лишився рівно 1 документ (дубль не додано).
    expect(h.getCases().find(c => c.id === 'case_dp').documents).toHaveLength(1);
  });
});
