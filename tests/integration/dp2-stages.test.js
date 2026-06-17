// DP — інтеграція через СПРАВЖНІЙ createDocumentPipeline (диригент DP-1,
// незмінений) + СПРАВЖНІЙ createActions (поверх _actionsTestSetup, нуль
// дублювання ACTION-логіки). Доводить: архів з ЄСІТС розгортається у N
// документів, кожен лягає у cases[].documents через реальний
// document_processor_agent → add_documents; підпис КЕП НЕ персиститься;
// не-архівний файл з людськими метаданими проходить як у DP-1.
//
// A1-B: мертві стадії DP-2 (createDetectBoundariesV2 / createClassifyV2)
// знесено; цей тест тепер ганяє INTAKE(unpack) → дефолтні passthrough-стадії →
// PERSIST. Класифікаційні стадії покриває живий шлях Triage (dp-triage.test.js).
import { describe, it, expect, beforeEach } from 'vitest';
import { createDocumentPipeline, STAGE } from '../../src/services/documentPipeline.js';
import { createDocument } from '../../src/services/documentFactory.js';
import { createIntakeWithUnpack } from '../../src/services/documentPipeline/stages/unpack.js';
import { createHarness } from './_actionsTestSetup.js';

const CASE = {
  id: 'case_dp2', name: 'Справа DP-2', tenantId: 'tenant_1', ownerId: 'vadym',
  documents: [], proceedings: [{ id: 'proc_main', title: 'Основне' }],
};

const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const U8 = (n = 3) => new Uint8Array(Array.from({ length: n }, (_, i) => i + 1));
const makeFile = ({ name, data, type }) => ({ name, size: data.length, type, _bytes: data, arrayBuffer: async () => data });

function build({ unzipArchive }) {
  return {
    stageOverrides: {
      [STAGE.INTAKE]: createIntakeWithUnpack({ unzipArchive, makeFile }),
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
      ...(item.metadataTemplate || {}),               // людські метадані сюди влились
    }),
    eventBus: { publish: () => {} },
    topics: { DOCUMENT_INGESTED: 'document.ingested', DOCUMENT_BATCH_PROCESSED: 'document.batch_processed' },
    getActor: () => ({ userId: 'vadym', tenantId: 'tenant_1' }),
  };
}

describe('DP інтеграція — архів ЄСІТС → N документів через справжній шар', () => {
  let h;
  beforeEach(() => { h = createHarness({ initialCases: [structuredClone(CASE)] }); });

  it('ZIP(2 pdf + .p7s + sidecar) → 2 документи у справі, підпис не персиститься', async () => {
    const unzipArchive = async () => ([
      { name: 'pozov.pdf', data: U8(5) },
      { name: 'pozov.pdf.p7s', data: U8(2) },
      { name: 'uhvala.pdf', data: U8(6) },
      { name: 'metadataSidecar.json', data: enc({ source: 'court_sync', ecitsContext: { caseType: 'civil', summary: 'позов і ухвала' } }) },
    ]);

    const deps = build({ unzipArchive });
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
    expect(stored.every(d => d.source === 'court_sync' && d.addedBy === 'system')).toBe(true);
    // Підпис КЕП не став документом.
    expect(stored.some(d => /\.p7s$/.test(d.name))).toBe(false);
    // sidecar теж не документ.
    expect(stored.some(d => /sidecar/i.test(d.name))).toBe(false);
  });

  it('не-архівний файл з людськими метаданими → проходить як DP-1 (1 документ)', async () => {
    const deps = build({
      unzipArchive: async () => { throw new Error('unzip не має викликатись для pdf'); },
    });
    deps.persistDocument = ({ caseId, document }) =>
      h.executeAction('document_processor_agent', 'add_documents', { caseId, documents: [document] });

    const res = await createDocumentPipeline(deps).run({
      caseId: 'case_dp2',
      caseData: { id: 'case_dp2' },
      agentId: 'document_processor_agent',
      files: [{
        fileId: 'd', raw: { _bytes: U8() }, name: 'odyn.pdf', type: 'application/pdf', size: 3,
        // адвокат у модалці вже обрав тип/автора → метадані пролітають крізь persist
        metadataTemplate: { category: 'pleading', author: 'ours' },
      }],
    });

    expect(res.ok).toBe(true);
    expect(res.documents).toHaveLength(1);
    const stored = h.getCases().find(c => c.id === 'case_dp2').documents;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ name: 'odyn.pdf', category: 'pleading', author: 'ours' });
  });
});
