// Ф3 — splitDocumentsV3 як диспетч за .route. Маршрути add_as_is/slice/
// fragment_reconstruct лишаються наявним buildDocumentPdf-шляхом (покрито
// splitDocumentsV3.test.js); тут — нові гілки: image_merge / to_fragments /
// discard / signature_sidecar / змішаний план / невідомий route.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSplitDocumentsV3 } from '../../src/services/documentPipeline/stages/splitDocumentsV3.js';
import { createWorkerClient } from '../../src/services/documentPipeline/workerClient.js';
import { createMemDrivePort } from '../_memDrivePort.js';
import { makePdfBytes } from '../_pdfFixture.js';

const wc = createWorkerClient({ forceInProcess: true });

async function seedSource(port, fileId, pages, mime = 'application/pdf') {
  const folder = await port.getOrCreateFolder('_temp', null);
  const up = await port.uploadBytes(folder.id, `orig_${fileId}.pdf`, await makePdfBytes(pages), mime);
  return up.id;
}

function mkStage(port, over = {}) {
  return createSplitDocumentsV3({
    runInWorker: wc.runInWorker, drivePort: port,
    uploadFile: over.uploadFile || vi.fn(async () => 'final_drive'),
    createDocument: (m) => ({ id: `doc_${m.name}`, ...m }),
    persistDocument: over.persistDocument,
    ...over.deps,
  });
}

function ctxOf(port, plan, files, fragRootId) {
  return {
    job: {
      caseId: 'c1', jobId: 'j1', addedBy: 'system', source: 'manual',
      caseData: { id: 'c1', storage: { subFolders: fragRootId ? { '03_ФРАГМЕНТИ': fragRootId } : {} } },
    },
    files, documents: [], decisions: [], events: [],
    reconstructionPlan: { confirmed: true, ...plan }, unusedPages: plan.unusedPages || [],
  };
}

describe('splitDocumentsV3 .route — discard / signature_sidecar', () => {
  let port, persistDocument, uploadFile;
  beforeEach(() => {
    port = createMemDrivePort();
    persistDocument = vi.fn(async () => ({ success: true }));
    uploadFile = vi.fn(async () => 'final_drive');
  });

  it('discard → нічого на Drive, без persist, decision', async () => {
    const d = await seedSource(port, 'f0', 2);
    const stage = mkStage(port, { persistDocument, uploadFile });
    const res = await stage(ctxOf(port,
      { documents: [{ documentId: 'd1', name: 'Сміття', route: 'discard', fragments: [{ fileId: 'f0', startPage: 1, endPage: 2 }] }] },
      [{ fileId: 'f0', driveId: d, skipped: false }]));
    expect(res.ok).toBe(true);
    expect(persistDocument).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
    expect(res.decisions.some((x) => x.type === 'document_discarded')).toBe(true);
  });

  it('signature_sidecar → без persist, decision (вже у unpack)', async () => {
    const d = await seedSource(port, 'f0', 1);
    const stage = mkStage(port, { persistDocument, uploadFile });
    const res = await stage(ctxOf(port,
      { documents: [{ documentId: 'd1', name: 'sig.p7s', route: 'signature_sidecar', fragments: [{ fileId: 'f0', startPage: 1, endPage: 1 }] }] },
      [{ fileId: 'f0', driveId: d, skipped: false }]));
    expect(persistDocument).not.toHaveBeenCalled();
    expect(res.decisions.some((x) => x.type === 'signature_sidecar_skipped')).toBe(true);
  });
});

describe('splitDocumentsV3 .route — to_fragments', () => {
  it('сторінки → 03_ФРАГМЕНТИ через saveFragments, НЕ канонічний документ', async () => {
    const port = createMemDrivePort();
    const fragRoot = await port.getOrCreateFolder('03_ФРАГМЕНТИ', null);
    const d = await seedSource(port, 'f0', 3);
    const persistDocument = vi.fn(async () => ({ success: true }));
    const stage = mkStage(port, { persistDocument });
    const res = await stage(ctxOf(port,
      { documents: [{ documentId: 'd1', name: 'Обкладинка', route: 'to_fragments', fragments: [{ fileId: 'f0', startPage: 1, endPage: 2 }] }] },
      [{ fileId: 'f0', driveId: d, skipped: false }], fragRoot.id));
    expect(res.ok).toBe(true);
    expect(persistDocument).not.toHaveBeenCalled();
    expect(res.decisions.some((x) => x.type === 'routed_to_fragments')).toBe(true);
    const saved = res.decisions.find((x) => x.type === 'fragments_saved');
    expect(saved?.count).toBe(1);
    expect(port._allNames().some((n) => /^fragment_001\.pdf$/.test(n))).toBe(true);
  });
});

describe('splitDocumentsV3 .route — image_merge', () => {
  let port, persistDocument, uploadFile;
  beforeEach(async () => {
    port = createMemDrivePort();
    persistDocument = vi.fn(async () => ({ success: true }));
    uploadFile = vi.fn(async () => 'merged_drive');
  });

  it('викликає mergeImagesToPdf із джерелами У ПОРЯДКУ плану → persist', async () => {
    const a = await seedSource(port, 'img_a', 1, 'image/jpeg');
    const b = await seedSource(port, 'img_b', 1, 'image/png');
    const mergeImagesToPdf = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const stage = mkStage(port, { persistDocument, uploadFile, deps: { mergeImagesToPdf } });
    const res = await stage(ctxOf(port,
      { documents: [{ documentId: 'd1', name: 'Договір', type: 'contract', route: 'image_merge', fragments: [{ fileId: 'img_b', startPage: 1, endPage: 1 }, { fileId: 'img_a', startPage: 1, endPage: 1 }] }] },
      [
        { fileId: 'img_a', driveId: a, skipped: false, originalMime: 'image/jpeg', name: 'A.jpg' },
        { fileId: 'img_b', driveId: b, skipped: false, originalMime: 'image/png', name: 'B.png' },
      ]));
    expect(res.ok).toBe(true);
    expect(mergeImagesToPdf).toHaveBeenCalledTimes(1);
    const arg = mergeImagesToPdf.mock.calls[0][0];
    expect(arg.images.map((i) => i.name)).toEqual(['B.png', 'A.jpg']);   // порядок плану
    expect(arg.images.map((i) => i.mime)).toEqual(['image/png', 'image/jpeg']);
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(persistDocument).toHaveBeenCalledTimes(1);
  });

  it('seam не підключено → graceful skip, decision, без persist', async () => {
    const a = await seedSource(port, 'img_a', 1, 'image/jpeg');
    const stage = mkStage(port, { persistDocument, uploadFile });           // без mergeImagesToPdf
    const res = await stage(ctxOf(port,
      { documents: [{ documentId: 'd1', name: 'Фото', route: 'image_merge', fragments: [{ fileId: 'img_a', startPage: 1, endPage: 1 }] }] },
      [{ fileId: 'img_a', driveId: a, skipped: false, originalMime: 'image/jpeg', name: 'A.jpg' }]));
    expect(res.ok).toBe(true);
    expect(persistDocument).not.toHaveBeenCalled();
    expect(res.decisions.some((x) => x.type === 'image_merge_unavailable')).toBe(true);
  });
});

describe('splitDocumentsV3 .route — змішаний план + невідомий route', () => {
  it('add_as_is + to_fragments + discard в одному прогоні → коректне партиціювання', async () => {
    const port = createMemDrivePort();
    const fragRoot = await port.getOrCreateFolder('03_ФРАГМЕНТИ', null);
    const d = await seedSource(port, 'f0', 6);
    const persistDocument = vi.fn(async () => ({ success: true }));
    const stage = mkStage(port, { persistDocument });
    const res = await stage(ctxOf(port, {
      documents: [
        { documentId: 'd1', name: 'Рішення', type: 'court_act', route: 'add_as_is', fragments: [{ fileId: 'f0', startPage: 1, endPage: 4 }] },
        { documentId: 'd2', name: 'Штамп', route: 'to_fragments', fragments: [{ fileId: 'f0', startPage: 5, endPage: 5 }] },
        { documentId: 'd3', name: 'Порожнє', route: 'discard', fragments: [{ fileId: 'f0', startPage: 6, endPage: 6 }] },
      ],
    }, [{ fileId: 'f0', driveId: d, skipped: false }], fragRoot.id));
    expect(res.ok).toBe(true);
    expect(persistDocument).toHaveBeenCalledTimes(1);                       // лише add_as_is
    expect(res.decisions.some((x) => x.type === 'routed_to_fragments')).toBe(true);
    expect(res.decisions.some((x) => x.type === 'document_discarded')).toBe(true);
    expect(res.decisions.find((x) => x.type === 'fragments_saved')?.count).toBe(1);
  });

  it('невідомий route → трактується як add_as_is (buildDocumentPdf)', async () => {
    const port = createMemDrivePort();
    const d = await seedSource(port, 'f0', 2);
    const persistDocument = vi.fn(async () => ({ success: true }));
    const stage = mkStage(port, { persistDocument });
    const res = await stage(ctxOf(port,
      { documents: [{ documentId: 'd1', name: 'X', route: 'wat', fragments: [{ fileId: 'f0', startPage: 1, endPage: 2 }] }] },
      [{ fileId: 'f0', driveId: d, skipped: false }]));
    expect(res.ok).toBe(true);
    expect(persistDocument).toHaveBeenCalledTimes(1);
  });
});
