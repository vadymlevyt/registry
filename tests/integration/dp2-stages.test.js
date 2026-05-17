// DP-2 — інтеграція стадій через СПРАВЖНІЙ createDocumentPipeline (диригент
// DP-1, незмінений) + СПРАВЖНІЙ createActions (поверх _actionsTestSetup, нуль
// дублювання ACTION-логіки). Доводить: архів з ЄСІТС розгортається у N
// документів, кожен лягає у cases[].documents через реальний
// document_processor_agent → add_documents; класифікація застосовується;
// підпис КЕП НЕ персиститься; не-архівний файл проходить як у DP-1.
import { describe, it, expect, beforeEach } from 'vitest';
import { createDocumentPipeline, STAGE } from '../../src/services/documentPipeline.js';
import { createDocument } from '../../src/services/documentFactory.js';
import { createIntakeWithUnpack } from '../../src/services/documentPipeline/stages/unpack.js';
import { createDetectBoundariesV2 } from '../../src/services/documentPipeline/stages/detectBoundariesV2.js';
import { createClassifyV2 } from '../../src/services/documentPipeline/stages/classifyV2.js';
import { createHarness } from './_actionsTestSetup.js';

const CASE = {
  id: 'case_dp2', name: 'Справа DP-2', tenantId: 'tenant_1', ownerId: 'vadym',
  documents: [], proceedings: [{ id: 'proc_main', title: 'Основне' }],
};

const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const U8 = (n = 3) => new Uint8Array(Array.from({ length: n }, (_, i) => i + 1));
const makeFile = ({ name, data, type }) => ({ name, size: data.length, type, _bytes: data, arrayBuffer: async () => data });

function build({ unzipArchive, classify }) {
  return {
    stageOverrides: {
      [STAGE.INTAKE]: createIntakeWithUnpack({ unzipArchive, makeFile }),
      [STAGE.DETECT_BOUNDARIES]: createDetectBoundariesV2({}),       // default gate → passthrough
      [STAGE.CLASSIFY]: createClassifyV2({ classify }),
    },
    convertToPdf: async () => ({
      pdfBlob: { size: 42 }, originalBlob: null, pdfName: 'd', originalName: 'd.pdf',
      originalMime: 'application/pdf', extractedText: null, warnings: [],
      converter: 'passthrough', durationMs: 1,
    }),
    uploadFile: async () => 'drive_dp2',
    createDocument,
    buildDocumentMetadata: ({ item, driveId }) => ({
      procId: 'proc_main',
      name: item.name,
      documentNature: 'searchable',
      folder: '01_ОРИГІНАЛИ',
      addedBy: 'system',
      source: 'court_sync',
      driveId,
      driveUrl: driveId ? `https://drive.google.com/file/d/${driveId}/view` : null,
      size: item.size || 0,
      ...(item.metadataTemplate || {}),               // класифікація DP-2 сюди влилась
    }),
    eventBus: { publish: () => {} },
    topics: { DOCUMENT_INGESTED: 'document.ingested', DOCUMENT_BATCH_PROCESSED: 'document.batch_processed' },
    getActor: () => ({ userId: 'vadym', tenantId: 'tenant_1' }),
  };
}

describe('DP-2 інтеграція — архів ЄСІТС → N документів через справжній шар', () => {
  let h;
  beforeEach(() => { h = createHarness({ initialCases: [structuredClone(CASE)] }); });

  it('ZIP(2 pdf + .p7s + sidecar) → 2 документи у справі, класифіковані, підпис не персиститься', async () => {
    const unzipArchive = async () => ([
      { name: 'pozov.pdf', data: U8(5) },
      { name: 'pozov.pdf.p7s', data: U8(2) },
      { name: 'uhvala.pdf', data: U8(6) },
      { name: 'metadataSidecar.json', data: enc({ source: 'court_sync', ecitsContext: { caseType: 'civil', summary: 'позов і ухвала' } }) },
    ]);
    const classify = async () => ({ category: 'court_act', author: 'court', confidence: 'high' });

    const deps = build({ unzipArchive, classify });
    deps.persistDocument = ({ caseId, document }) =>
      h.executeAction('document_processor_agent', 'add_documents', { caseId, documents: [document] });

    const res = await createDocumentPipeline(deps).run({
      caseId: 'case_dp2',
      caseData: { id: 'case_dp2' },
      agentId: 'document_processor_agent',
      source: 'court_sync',
      addedBy: 'system',
      files: [{ fileId: 'arc', raw: { _bytes: U8() }, name: 'inbox.zip', type: 'application/zip', size: 9 }],
    });

    expect(res.ok).toBe(true);
    expect(res.documents).toHaveLength(2);

    const stored = h.getCases().find(c => c.id === 'case_dp2').documents;
    expect(stored).toHaveLength(2);
    expect(stored.map(d => d.name).sort()).toEqual(['pozov.pdf', 'uhvala.pdf']);
    // Класифікація DP-2 долетіла крізь persist у канонічний запис.
    expect(stored.every(d => d.category === 'court_act' && d.author === 'court')).toBe(true);
    expect(stored.every(d => d.source === 'court_sync' && d.addedBy === 'system')).toBe(true);
    // Підпис КЕП не став документом.
    expect(stored.some(d => /\.p7s$/.test(d.name))).toBe(false);
    // sidecar теж не документ.
    expect(stored.some(d => /sidecar/i.test(d.name))).toBe(false);
  });

  it('не-архівний файл з людською класифікацією → проходить як DP-1 (1 документ, без AI)', async () => {
    let classifyCalls = 0;
    const deps = build({
      unzipArchive: async () => { throw new Error('unzip не має викликатись для pdf'); },
      classify: async () => { classifyCalls++; return { category: 'x', confidence: 'high' }; },
    });
    deps.persistDocument = ({ caseId, document }) =>
      h.executeAction('document_processor_agent', 'add_documents', { caseId, documents: [document] });

    const res = await createDocumentPipeline(deps).run({
      caseId: 'case_dp2',
      caseData: { id: 'case_dp2' },
      agentId: 'document_processor_agent',
      files: [{
        fileId: 'd', raw: { _bytes: U8() }, name: 'odyn.pdf', type: 'application/pdf', size: 3,
        // адвокат у модалці вже обрав тип/автора → classify має бути passthrough
        metadataTemplate: { category: 'pleading', author: 'ours' },
      }],
    });

    expect(res.ok).toBe(true);
    expect(res.documents).toHaveLength(1);
    expect(classifyCalls).toBe(0);                    // gated passthrough — нуль AI
    const stored = h.getCases().find(c => c.id === 'case_dp2').documents;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ name: 'odyn.pdf', category: 'pleading', author: 'ours' });
  });
});
