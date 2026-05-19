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

// G1 (bug 2): артефакт 02_ОБРОБЛЕНІ зрізається за діапазоном сторінок
// документа, НЕ пишеться текст усього файла. Критерій якості: якщо хтось
// через 3 міс поверне whole-file у writeProcessedArtifacts — цей тест
// червоний (адвокат бачив змішаний текст саме через це).
describe('splitDocumentsV3 G1 — page-precise текст/layout 02_ОБРОБЛЕНІ', () => {
  function layout6() {
    return { schemaVersion: 1, pages: Array.from({ length: 6 }, (_, i) => ({ _text: `ТЕКСТ-СТОРІНКИ-${i + 1}` })) };
  }

  it('slice 1 файл → 2 документи: кожен TXT лише свій діапазон сторінок', async () => {
    const port = createMemDrivePort();
    const d = await seedSource(port, 'big', 6);
    const persistDocument = vi.fn(async () => ({ success: true }));
    const writeText02 = vi.fn(async () => {});
    const writeLayout02 = vi.fn(async () => {});
    const stage = mkStage(port, {
      persistDocument,
      uploadFile: vi.fn(async (file) => `drv_${file.name}`),
      deps: { writeText02, writeLayout02 },
    });
    const res = await stage(ctxOf(port, {
      documents: [
        { documentId: 'd1', name: 'Позов', route: 'slice', fragments: [{ fileId: 'big', startPage: 1, endPage: 3 }] },
        { documentId: 'd2', name: 'Ухвала', route: 'slice', fragments: [{ fileId: 'big', startPage: 4, endPage: 6 }] },
      ],
    }, [{ fileId: 'big', driveId: d, skipped: false, layoutJson: layout6(), pageCount: 6, processedText: 'ВЕСЬ-ФАЙЛ-65-СТОРІНОК' }]));

    expect(res.ok).toBe(true);
    expect(writeText02).toHaveBeenCalledTimes(2);
    const [c1, c2] = writeText02.mock.calls.map((c) => c[0]);
    // d1 = стор 1-3, БЕЗ тексту стор 4-6 і БЕЗ whole-file.
    expect(c1.text).toContain('ТЕКСТ-СТОРІНКИ-1');
    expect(c1.text).toContain('ТЕКСТ-СТОРІНКИ-3');
    expect(c1.text).not.toContain('ТЕКСТ-СТОРІНКИ-4');
    expect(c1.text).not.toContain('ВЕСЬ-ФАЙЛ-65');
    // d2 = стор 4-6, БЕЗ стор 1-3.
    expect(c2.text).toContain('ТЕКСТ-СТОРІНКИ-4');
    expect(c2.text).toContain('ТЕКСТ-СТОРІНКИ-6');
    expect(c2.text).not.toContain('ТЕКСТ-СТОРІНКИ-3');
    // layout зрізаний паралельно (3 сторінки на документ).
    expect(writeLayout02.mock.calls[0][0].layoutJson.pages).toHaveLength(3);
    expect((res.decisions || []).some((x) => x.type === 'text_slice_fallback')).toBe(false);
  });

  it('multi-fragment (fragment_reconstruct по 2 файлах) → текст конкатиться у порядку фрагментів', async () => {
    const port = createMemDrivePort();
    const a = await seedSource(port, 'f0', 3);
    const b = await seedSource(port, 'f1', 2);
    const writeText02 = vi.fn(async () => {});
    const stage = mkStage(port, {
      persistDocument: vi.fn(async () => ({ success: true })),
      uploadFile: vi.fn(async () => 'drv'),
      deps: { writeText02 },
    });
    const res = await stage(ctxOf(port, {
      documents: [{ documentId: 'd1', name: 'Експертиза', route: 'fragment_reconstruct', fragments: [
        { fileId: 'f0', startPage: 2, endPage: 3 }, { fileId: 'f1', startPage: 1, endPage: 1 },
      ] }],
    }, [
      { fileId: 'f0', driveId: a, skipped: false, pageCount: 3, layoutJson: { schemaVersion: 1, pages: [{ _text: 'A1' }, { _text: 'A2' }, { _text: 'A3' }] } },
      { fileId: 'f1', driveId: b, skipped: false, pageCount: 2, layoutJson: { schemaVersion: 1, pages: [{ _text: 'B1' }, { _text: 'B2' }] } },
    ]));
    expect(res.ok).toBe(true);
    const t = writeText02.mock.calls[0][0].text;
    expect(t).toContain('A2'); expect(t).toContain('A3'); expect(t).toContain('B1');
    expect(t).not.toContain('A1'); expect(t).not.toContain('B2');
    expect(t.indexOf('A2')).toBeLessThan(t.indexOf('B1'));   // порядок фрагментів
  });

  it('layout неповний (resume) → цілий текст + decision text_slice_fallback (не тихо хибно)', async () => {
    const port = createMemDrivePort();
    const d = await seedSource(port, 'big', 6);
    const writeText02 = vi.fn(async () => {});
    const stage = mkStage(port, {
      persistDocument: vi.fn(async () => ({ success: true })),
      uploadFile: vi.fn(async () => 'drv'),
      deps: { writeText02 },
    });
    const res = await stage(ctxOf(port, {
      documents: [{ documentId: 'd1', name: 'Позов', route: 'slice', fragments: [{ fileId: 'big', startPage: 1, endPage: 3 }] }],
    }, [{ fileId: 'big', driveId: d, skipped: false, pageCount: 6, layoutJson: { schemaVersion: 1, pages: [{ _text: 'лише1' }] }, processedText: 'ЦІЛИЙ-OCR' }]));
    expect(res.ok).toBe(true);
    expect(writeText02.mock.calls[0][0].text).toBe('ЦІЛИЙ-OCR');
    expect(res.decisions.some((x) => x.type === 'text_slice_fallback')).toBe(true);
  });
});
