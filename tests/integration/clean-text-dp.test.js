// TASK 3.1 (нова філософія) — DP-очистка ПОСТ-КРОКОМ на готових документах.
// Тумблер «Очистити для читання» = той самий cleanDocument, підключений
// ОСТАННІМ кроком у splitDocumentsV3 (після нарізки/склейки), по кожному
// готовому scanned-документу. Працює однаково для slice і image_merge.
//
// Part A — splitDocumentsV3 пост-крок: викликає cleanFinalizedDocument лише для
//   scanned-документів і лише коли тумблер увімкнено.
// Part B — cleanFinalizedDocument = adapter (buildCleanDocumentDriveDeps) + ядро
//   cleanDocument поверх ocrService-швів: .md персиститься, .txt→архів, .layout
//   видалено, registry textFormat/cleanedAt оновлено, attentionNotes у extended,
//   billAsUserAction:false (без activityTracker як дії).

import { describe, it, expect, vi } from 'vitest';

// Уникаємо завантаження реального ocrService (тягне pdfjs → DOMMatrix у node).
// Adapter все одно отримує наш ocr-стаб через DI; цей mock лише не вантажить
// важкий ланцюг при статичному import у cleanTextDriveAdapter.
vi.mock('../../src/services/ocrService.js', () => ({
  getCachedLayout: vi.fn(), getCachedText: vi.fn(), writeMarkdownArtifact: vi.fn(),
  archiveRawTxt: vi.fn(), deleteLayoutArtifact: vi.fn(),
}));

import { createSplitDocumentsV3 } from '../../src/services/documentPipeline/stages/splitDocumentsV3.js';
import { createWorkerClient } from '../../src/services/documentPipeline/workerClient.js';
import { createMemDrivePort } from '../_memDrivePort.js';
import { makePdfBytes } from '../_pdfFixture.js';
import { cleanDocument } from '../../src/services/cleanTextService.js';
import { buildCleanDocumentDriveDeps } from '../../src/services/cleanTextDriveAdapter.js';

const wc = createWorkerClient({ forceInProcess: true });

async function seedSource(port, fileId, pages) {
  const folder = await port.getOrCreateFolder('_temp', null);
  const bytes = await makePdfBytes(pages);
  const up = await port.uploadBytes(folder.id, `orig_${fileId}.pdf`, bytes, 'application/pdf');
  return up.id;
}

function baseCtx(port, { plan, files }) {
  return {
    job: {
      caseId: 'c1', jobId: 'j1', addedBy: 'system', source: 'manual',
      caseData: { id: 'c1', storage: { subFolders: { '02_ОБРОБЛЕНІ': 'folder02' } } },
    },
    files, documents: [], decisions: [], events: [],
    reconstructionPlan: plan, unusedPages: [],
  };
}

function onePlan() {
  return {
    confirmed: true,
    documents: [{
      documentId: 'd', name: 'Скан', type: 'pleading', category: 'pleading',
      fragments: [{ fileId: 'f1', startPage: 1, endPage: 2 }],
    }],
    unusedPages: [],
  };
}

// ── Part A — splitDocumentsV3 пост-крок гейтинг ─────────────────────────────
describe('DP пост-крок: splitDocumentsV3 викликає cleanFinalizedDocument', () => {
  function makeStage(port, { cleanForReading, cleanFinalizedDocument, documentNature }) {
    return createSplitDocumentsV3({
      runInWorker: wc.runInWorker, drivePort: port,
      uploadFile: vi.fn(async () => 'final_1'),
      createDocument: (m) => ({ id: 'docx', ...m, documentNature }),
      persistDocument: vi.fn(async () => ({ success: true })),
      cleanForReading,
      cleanFinalizedDocument,
    });
  }

  it('тумблер увімкнено + scanned → cleanFinalizedDocument викликано', async () => {
    const port = createMemDrivePort();
    const f1 = await seedSource(port, 'f1', 2);
    const cleanFinalizedDocument = vi.fn(async () => ({ ok: true, markdown: '# md' }));
    const stage = makeStage(port, { cleanForReading: true, cleanFinalizedDocument, documentNature: 'scanned' });
    const res = await stage(baseCtx(port, { plan: onePlan(), files: [{ fileId: 'f1', driveId: f1, skipped: false, metadataTemplate: {} }] }));
    expect(res.ok).toBe(true);
    expect(cleanFinalizedDocument).toHaveBeenCalledTimes(1);
    const arg = cleanFinalizedDocument.mock.calls[0][0];
    expect(arg.document.documentNature).toBe('scanned');
    expect(arg.caseData.id).toBe('c1');
  });

  it('тумблер вимкнено → cleanFinalizedDocument НЕ викликано (лишається .txt)', async () => {
    const port = createMemDrivePort();
    const f1 = await seedSource(port, 'f1', 2);
    const cleanFinalizedDocument = vi.fn();
    const stage = makeStage(port, { cleanForReading: false, cleanFinalizedDocument, documentNature: 'scanned' });
    await stage(baseCtx(port, { plan: onePlan(), files: [{ fileId: 'f1', driveId: f1, skipped: false, metadataTemplate: {} }] }));
    expect(cleanFinalizedDocument).not.toHaveBeenCalled();
  });

  it('searchable документ → пропуск (скоуп тільки scanned)', async () => {
    const port = createMemDrivePort();
    const f1 = await seedSource(port, 'f1', 2);
    const cleanFinalizedDocument = vi.fn();
    const stage = makeStage(port, { cleanForReading: true, cleanFinalizedDocument, documentNature: 'searchable' });
    await stage(baseCtx(port, { plan: onePlan(), files: [{ fileId: 'f1', driveId: f1, skipped: false, metadataTemplate: {} }] }));
    expect(cleanFinalizedDocument).not.toHaveBeenCalled();
  });
});

// ── Part B — cleanFinalizedDocument = adapter + ядро над ocrService ──────────
function aiJson(markdown, notes = []) {
  return { content: [{ type: 'text', text: JSON.stringify({ markdown, attentionNotes: notes }) }], usage: { input_tokens: 1, output_tokens: 2 } };
}

function ocrStub() {
  return {
    getCachedLayout: vi.fn(async () => ({ pages: [{ _text: 'сирий текст сторінки', blocks: [] }] })),
    getCachedText: vi.fn(async () => 'сирий txt'),
    writeMarkdownArtifact: vi.fn(async () => true),
    archiveRawTxt: vi.fn(async () => true),
    deleteLayoutArtifact: vi.fn(async () => true),
  };
}

const scannedDoc = { id: 'doc_1', name: 'Скан.pdf', documentNature: 'scanned', driveId: 'drv_1' };
const caseData = { id: 'c1', storage: { subFolders: { '02_ОБРОБЛЕНІ': 'f02' } } };

describe('cleanFinalizedDocument (adapter + ядро) персиститься у .md', () => {
  it('scanned: .md записано, .txt→архів, .layout видалено, registry+extended оновлено; білінг false', async () => {
    const ocr = ocrStub();
    const extended = { setExtendedForDocument: vi.fn(async () => true) };
    const executeAction = vi.fn(async () => ({ success: true }));
    const activityTracker = { report: vi.fn() };
    const logAiUsage = vi.fn();
    const driveDeps = buildCleanDocumentDriveDeps({
      executeAction, agentId: 'document_processor_agent', ocrService: ocr, documentsExtended: extended,
    });

    const r = await cleanDocument({
      document: scannedDoc, caseData, apiKey: 'k', billAsUserAction: false,
      callAI: vi.fn(async () => aiJson('# Чисто\n\nтекст', [{ page: 1, note: 'увага' }])),
      resolveModel: () => 'claude-haiku-4-5-20251001', logAiUsage, activityTracker,
      ...driveDeps,
    });

    expect(r.ok).toBe(true);
    expect(ocr.writeMarkdownArtifact).toHaveBeenCalledTimes(1);
    expect(ocr.writeMarkdownArtifact.mock.calls[0][1]).toBe('# Чисто\n\nтекст');
    expect(ocr.archiveRawTxt).toHaveBeenCalledTimes(1);
    expect(ocr.deleteLayoutArtifact).toHaveBeenCalledTimes(1);   // використано layout

    // registry: update_document textFormat/cleanedAt через архіваріус.
    expect(executeAction).toHaveBeenCalledWith(
      'document_processor_agent', 'update_document',
      expect.objectContaining({
        caseId: 'c1', documentId: 'doc_1',
        fields: expect.objectContaining({ textFormat: 'md' }),
      }),
    );
    // extended: attentionNotes.
    expect(extended.setExtendedForDocument).toHaveBeenCalledWith(
      'c1', caseData, 'doc_1', { attentionNotes: [{ page: 1, note: 'увага' }] },
    );
    // C7: токени логуються; activityTracker (дія) — НІ (billAsUserAction:false).
    expect(logAiUsage).toHaveBeenCalledTimes(1);
    expect(activityTracker.report).not.toHaveBeenCalled();
  });

  it('searchable документ → скоуп-гард: нічого не пишеться', async () => {
    const ocr = ocrStub();
    const executeAction = vi.fn();
    const driveDeps = buildCleanDocumentDriveDeps({ executeAction, agentId: 'document_processor_agent', ocrService: ocr, documentsExtended: { setExtendedForDocument: vi.fn() } });
    const r = await cleanDocument({
      document: { ...scannedDoc, documentNature: 'searchable' }, caseData, apiKey: 'k',
      callAI: vi.fn(), resolveModel: () => 'h', logAiUsage: vi.fn(), activityTracker: { report: vi.fn() },
      ...driveDeps,
    });
    expect(r).toEqual({ ok: false, skipped: true, reason: 'not_scanned' });
    expect(ocr.writeMarkdownArtifact).not.toHaveBeenCalled();
    expect(executeAction).not.toHaveBeenCalled();
  });
});
