// TASK V2-A2 — DP БІЛЬШЕ НЕ ЧИСТИТЬ текст (пост-крок прибрано повністю).
// Очистка стала справою в'ювера/ACTION clean_document_text (по одному документу
// на вимогу). Ядро cleanTextService.cleanDocument + adapter лишаються — їх кличе
// в'ювер/3.2, не DP.
//
// Part A — splitDocumentsV3 НЕ запускає очистку: навіть якщо передати застарілі
//   cleanForReading/cleanFinalizedDocument — стадія їх ІГНОРУЄ (проводку прибрано).
// Part B — cleanFinalizedDocument-аналог (adapter + ядро) персиститься у .md
//   за суфіксом режиму; .layout і .txt ЗБЕРІГАЮТЬСЯ (deleteLayout/archive скасовано).

import { describe, it, expect, vi } from 'vitest';

// Уникаємо завантаження реального ocrService (тягне pdfjs → DOMMatrix у node).
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

// ── Part A — DP більше НЕ запускає очистку (пост-крок прибрано) ──────────────
describe('DP без пост-кроку: splitDocumentsV3 НЕ чистить текст', () => {
  function makeStage(port, { cleanForReading, cleanFinalizedDocument, documentNature }) {
    return createSplitDocumentsV3({
      runInWorker: wc.runInWorker, drivePort: port,
      uploadFile: vi.fn(async () => 'final_1'),
      createDocument: (m) => ({ id: 'docx', ...m, documentNature }),
      persistDocument: vi.fn(async () => ({ success: true })),
      // Застарілі ключі — стадія їх більше не читає.
      cleanForReading,
      cleanFinalizedDocument,
    });
  }

  it('навіть з cleanForReading:true + scanned — cleanFinalizedDocument НЕ викликано (проводку прибрано)', async () => {
    const port = createMemDrivePort();
    const f1 = await seedSource(port, 'f1', 2);
    const cleanFinalizedDocument = vi.fn(async () => ({ ok: true, markdown: '# md' }));
    const stage = makeStage(port, { cleanForReading: true, cleanFinalizedDocument, documentNature: 'scanned' });
    const res = await stage(baseCtx(port, { plan: onePlan(), files: [{ fileId: 'f1', driveId: f1, skipped: false, metadataTemplate: {} }] }));
    expect(res.ok).toBe(true);
    expect(cleanFinalizedDocument).not.toHaveBeenCalled();
  });
});

// ── Part B — adapter + ядро над ocrService: .md за суфіксом, .layout/.txt цілі ─
// V2-B2 «Спосіб C»: голий Markdown [+ роздільник + JSON-масив поміток].
function aiJson(markdown, notes = []) {
  let text = String(markdown);
  if (notes && notes.length) text += `\n\n---ПОМІТКИ---\n${JSON.stringify(notes)}`;
  return { content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 2 } };
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

describe('adapter + ядро персиститься у .md за суфіксом (V2-A2)', () => {
  it('scanned digest: .digest.md записано; .layout/.txt НЕ чіпаємо; registry+extended+variants; білінг false', async () => {
    const ocr = ocrStub();
    const extended = { setExtendedForDocument: vi.fn(async () => true) };
    const executeAction = vi.fn(async () => ({ success: true }));
    const activityTracker = { report: vi.fn() };
    const logAiUsage = vi.fn();
    const driveDeps = buildCleanDocumentDriveDeps({
      executeAction, agentId: 'dossier_agent', ocrService: ocr, documentsExtended: extended,
    });

    const r = await cleanDocument({
      document: scannedDoc, caseData, apiKey: 'k', billAsUserAction: false, mode: 'digest',
      callAI: vi.fn(async () => aiJson('# Чисто\n\nтекст', [{ note: 'увага' }])),
      resolveModel: () => 'claude-haiku-4-5-20251001', logAiUsage, activityTracker,
      ...driveDeps,
    });

    expect(r.ok).toBe(true);
    // .md записано з суфіксом режиму (mode — 3-й арг writeMarkdownArtifact).
    expect(ocr.writeMarkdownArtifact).toHaveBeenCalledTimes(1);
    expect(ocr.writeMarkdownArtifact.mock.calls[0][1]).toBe('# Чисто\n\nтекст');
    expect(ocr.writeMarkdownArtifact.mock.calls[0][2]).toBe('digest');
    // V2-A2: .layout і .txt ЗБЕРІГАЮТЬСЯ.
    expect(ocr.archiveRawTxt).not.toHaveBeenCalled();
    expect(ocr.deleteLayoutArtifact).not.toHaveBeenCalled();

    // registry: update_document textFormat/cleanedAt/variants через архіваріус.
    expect(executeAction).toHaveBeenCalledWith(
      'dossier_agent', 'update_document',
      expect.objectContaining({
        caseId: 'c1', documentId: 'doc_1',
        fields: expect.objectContaining({
          textFormat: 'md',
          variants: expect.objectContaining({ digest: expect.any(String), clean: null }),
        }),
      }),
    );
    // extended: attentionNotes.
    expect(extended.setExtendedForDocument).toHaveBeenCalledWith(
      'c1', caseData, 'doc_1', { attentionNotes: [{ note: 'увага' }] },
    );
    // C7: токени логуються; activityTracker (дія) — НІ (billAsUserAction:false).
    expect(logAiUsage).toHaveBeenCalledTimes(1);
    expect(activityTracker.report).not.toHaveBeenCalled();
  });

  it("mode 'clean' → .clean.md суфікс і variants.clean", async () => {
    const ocr = ocrStub();
    const executeAction = vi.fn(async () => ({ success: true }));
    const driveDeps = buildCleanDocumentDriveDeps({
      executeAction, agentId: 'dossier_agent', ocrService: ocr, documentsExtended: { setExtendedForDocument: vi.fn() },
    });
    const r = await cleanDocument({
      document: scannedDoc, caseData, apiKey: 'k', mode: 'clean',
      callAI: vi.fn(async () => aiJson('# Дослівно')), resolveModel: () => 'h',
      logAiUsage: vi.fn(), activityTracker: { report: vi.fn() }, ...driveDeps,
    });
    expect(r.ok).toBe(true);
    expect(ocr.writeMarkdownArtifact.mock.calls[0][2]).toBe('clean');
    expect(executeAction.mock.calls[0][2].fields.variants).toEqual(
      expect.objectContaining({ clean: expect.any(String), digest: null }),
    );
  });

  it('searchable + clean → скоуп-гард (V2-B): нічого не пишеться', async () => {
    // Чистий (clean) лишається scanned-only. Конспект (digest) для searchable —
    // окремий шлях (див. cleanTextService/clean_document_text тести).
    const ocr = ocrStub();
    const executeAction = vi.fn();
    const driveDeps = buildCleanDocumentDriveDeps({ executeAction, agentId: 'dossier_agent', ocrService: ocr, documentsExtended: { setExtendedForDocument: vi.fn() } });
    const r = await cleanDocument({
      document: { ...scannedDoc, documentNature: 'searchable' }, caseData, apiKey: 'k', mode: 'clean',
      callAI: vi.fn(), resolveModel: () => 'h', logAiUsage: vi.fn(), activityTracker: { report: vi.fn() },
      ...driveDeps,
    });
    expect(r).toEqual({ ok: false, skipped: true, reason: 'not_scanned' });
    expect(ocr.writeMarkdownArtifact).not.toHaveBeenCalled();
    expect(executeAction).not.toHaveBeenCalled();
  });
});
