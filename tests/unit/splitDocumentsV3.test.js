// DP-3 — splitDocumentsV3 (persist override): реальний split + saveFragments
// + datasetCollector. Контракт стадії DP-1 збережено.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSplitDocumentsV3 } from '../../src/services/documentPipeline/stages/splitDocumentsV3.js';
import { createWorkerClient } from '../../src/services/documentPipeline/workerClient.js';
import { createMemDrivePort } from '../_memDrivePort.js';
import { makePdfBytes } from '../_pdfFixture.js';

const wc = createWorkerClient({ forceInProcess: true });

async function seedSource(port, fileId, pages) {
  const folder = await port.getOrCreateFolder('_temp', null);
  const bytes = await makePdfBytes(pages);
  const up = await port.uploadBytes(folder.id, `orig_${fileId}.pdf`, bytes, 'application/pdf');
  return up.id;
}

function baseCtx(port, { plan, files, unusedPages = [] }) {
  return {
    job: {
      caseId: 'c1', jobId: 'j1', addedBy: 'system', source: 'manual',
      caseData: { id: 'c1', storage: { subFolders: {} } },
    },
    files, documents: [], decisions: [], events: [],
    reconstructionPlan: plan, unusedPages,
  };
}

describe('splitDocumentsV3 — A. plan-based split', () => {
  let port, persistDocument, created;
  beforeEach(() => {
    port = createMemDrivePort();
    created = [];
    persistDocument = vi.fn(async ({ document }) => { created.push(document); return { success: true }; });
  });

  it('мультифайловий документ: фрагменти з 2 файлів → 1 PDF, 1 canonical запис', async () => {
    const d1 = await seedSource(port, 'f1', 6);
    const d2 = await seedSource(port, 'f2', 4);
    const plan = {
      confirmed: true,
      documents: [{
        documentId: 'doc1', name: 'Позов', type: 'pleading', category: 'pleading',
        fragments: [{ fileId: 'f1', startPage: 1, endPage: 3 }, { fileId: 'f2', startPage: 1, endPage: 2 }],
      }],
      unusedPages: [],
    };
    const stage = createSplitDocumentsV3({
      runInWorker: wc.runInWorker, drivePort: port,
      uploadFile: vi.fn(async () => 'final_drive_1'),
      createDocument: (m) => ({ id: 'docx1', ...m }),
      persistDocument,
    });
    const ctx = baseCtx(port, {
      plan,
      files: [
        { fileId: 'f1', driveId: d1, skipped: false, metadataTemplate: {} },
        { fileId: 'f2', driveId: d2, skipped: false, metadataTemplate: {} },
      ],
    });
    const res = await stage(ctx);
    expect(res.ok).toBe(true);
    expect(res.ctx.documents).toHaveLength(1);
    expect(persistDocument).toHaveBeenCalledTimes(1);
    expect(created[0].name).toBe('Позов.pdf');
    expect(created[0].category).toBe('pleading');
  });

  it('persistDocument fail → PERSIST_FAILED fatal (контракт DP-1)', async () => {
    const d1 = await seedSource(port, 'f1', 4);
    const stage = createSplitDocumentsV3({
      runInWorker: wc.runInWorker, drivePort: port,
      uploadFile: async () => 'x',
      createDocument: (m) => ({ id: 'd', ...m }),
      persistDocument: async () => ({ success: false, error: 'dup id' }),
    });
    const res = await stage(baseCtx(port, {
      plan: { confirmed: true, documents: [{ documentId: 'd1', name: 'A', fragments: [{ fileId: 'f1', startPage: 1, endPage: 2 }] }] },
      files: [{ fileId: 'f1', driveId: d1, skipped: false, metadataTemplate: {} }],
    }));
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('PERSIST_FAILED');
    expect(res.error.fatal).toBe(true);
  });
});

describe('splitDocumentsV3 — B. fallback (нема плану, behavior-preserving)', () => {
  it('один файл без плану → persist як один документ', async () => {
    const port = createMemDrivePort();
    const persistDocument = vi.fn(async () => ({ success: true }));
    const stage = createSplitDocumentsV3({
      runInWorker: wc.runInWorker, drivePort: port,
      uploadFile: async () => 'drv',
      createDocument: (m) => ({ id: 'd1', ...m }),
      persistDocument,
    });
    const res = await stage(baseCtx(port, {
      plan: null,
      files: [{ fileId: 'f0', uploadedFile: { name: 'a.pdf', arrayBuffer: async () => new ArrayBuffer(8) }, skipped: false, metadataTemplate: {} }],
    }));
    expect(res.ok).toBe(true);
    expect(res.ctx.documents).toHaveLength(1);
    expect(persistDocument).toHaveBeenCalledTimes(1);
  });
});

describe('splitDocumentsV3 — 1C.3 warning text_slice_fallback логіка (whole-file vs partial-slice)', () => {
  // Контракт 1C.3 (фінальний):
  //   • text-layer PDF самодостатній → `.txt` для нього НЕ пишеться у 02_ОБРОБЛЕНІ.
  //     `.txt` потрібен ТІЛЬКИ для сканів (де нема тексту в файлі).
  //   • Але warning `text_slice_fallback` раніше спрацьовував для будь-якого
  //     usedFallback — це false-positive для whole-file add_as_is text-PDF
  //     (нормальна поведінка, не помилка). Подавляємо warning у такому випадку.
  //   • Реальний slicing (multi-fragment або частковий діапазон) із
  //     fallback-текстом — warning лишається (регресія від bug 2 не повернулась).

  it('plan add_as_is whole-file, text-layer (без layoutJson) → БЕЗ warning text_slice_fallback', async () => {
    const port = createMemDrivePort();
    const d1 = await seedSource(port, 'f1', 3);
    const writeText02 = vi.fn(async () => {});
    const writeLayout02 = vi.fn(async () => {});
    const stage = createSplitDocumentsV3({
      runInWorker: wc.runInWorker, drivePort: port,
      uploadFile: async () => 'drv',
      createDocument: (m) => ({ id: 'doc1', driveId: 'drv', ...m }),
      persistDocument: async () => ({ success: true }),
      writeText02, writeLayout02,
    });
    const res = await stage(baseCtx(port, {
      plan: { confirmed: true, documents: [{
        documentId: 'd1', name: 'TextPdf', route: 'add_as_is',
        fragments: [{ fileId: 'f1', startPage: 1, endPage: 3 }],
      }], unusedPages: [] },
      files: [{
        fileId: 'f1', driveId: d1, skipped: false, metadataTemplate: {},
        processedText: 'Це text-layer PDF з витягнутим текстом адвокатом.',
        layoutJson: null,                                     // text-PDF: layout відсутній
        pageCount: 3,
      }],
    }));
    expect(res.ok).toBe(true);
    expect(writeLayout02).not.toHaveBeenCalled();             // text-PDF не має layout
    const fallbackDecision = (res.decisions || []).find((x) => x.type === 'text_slice_fallback');
    expect(fallbackDecision).toBeUndefined();                 // ключова перевірка 1C.3
  });

  it('OCR (layoutJson.pages непорожній) → пишеться ТІЛЬКИ .layout.json, БЕЗ .txt (V2-A2)', async () => {
    const port = createMemDrivePort();
    const d1 = await seedSource(port, 'f1', 2);
    const writeText02 = vi.fn(async () => {});
    const writeLayout02 = vi.fn(async () => {});
    const stage = createSplitDocumentsV3({
      runInWorker: wc.runInWorker, drivePort: port,
      uploadFile: async () => 'drv',
      createDocument: (m) => ({ id: 'doc1', driveId: 'drv', ...m }),
      persistDocument: async () => ({ success: true }),
      writeText02, writeLayout02,
    });
    const res = await stage(baseCtx(port, {
      plan: { confirmed: true, documents: [{
        documentId: 'd1', name: 'Scan', route: 'add_as_is',
        fragments: [{ fileId: 'f1', startPage: 1, endPage: 2 }],
      }], unusedPages: [] },
      files: [{
        fileId: 'f1', driveId: d1, skipped: false, metadataTemplate: {},
        layoutJson: { schemaVersion: 1, pages: [
          { _text: 'page 1 text', dimension: { width: 595, height: 842 } },
          { _text: 'page 2 text', dimension: { width: 595, height: 842 } },
        ] },
        pageCount: 2,
      }],
    }));
    expect(res.ok).toBe(true);
    // V2-A2: layout є → .txt НЕ пишемо (вірний текст із layout); лише .layout.json.
    expect(writeText02).not.toHaveBeenCalled();
    expect(writeLayout02).toHaveBeenCalledTimes(1);
    const fallbackDecision = (res.decisions || []).find((x) => x.type === 'text_slice_fallback');
    expect(fallbackDecision).toBeUndefined();
  });

  it('реальний slicing (частковий діапазон) з fallback-текстом → warning ВСЕ Ж публікується (захист від bug 2)', async () => {
    // 1 фрагмент 1..2 при pageCount=5 — це slice, а не whole-file. usedFallback
    // тут небезпечний (можемо помилково записати весь текст для 2 сторінок).
    const port = createMemDrivePort();
    const d1 = await seedSource(port, 'f1', 5);
    const writeText02 = vi.fn(async () => {});
    const stage = createSplitDocumentsV3({
      runInWorker: wc.runInWorker, drivePort: port,
      uploadFile: async () => 'drv',
      createDocument: (m) => ({ id: 'd1', driveId: 'drv', ...m }),
      persistDocument: async () => ({ success: true }),
      writeText02,
    });
    const res = await stage(baseCtx(port, {
      plan: { confirmed: true, documents: [{
        documentId: 'd1', name: 'PartialSlice', route: 'slice',
        fragments: [{ fileId: 'f1', startPage: 1, endPage: 2 }],
      }], unusedPages: [] },
      files: [{
        fileId: 'f1', driveId: d1, skipped: false, metadataTemplate: {},
        processedText: 'big whole text дуже багато',
        layoutJson: null,
        pageCount: 5,
      }],
    }));
    expect(res.ok).toBe(true);
    const fallbackDecision = (res.decisions || []).find((x) => x.type === 'text_slice_fallback');
    expect(fallbackDecision).toBeDefined();
    expect(fallbackDecision.documentName).toBe('PartialSlice.pdf');
  });
});

describe('splitDocumentsV3 — DP-4 bugfix (Bug 6/7 + класифікація)', () => {
  let port;
  beforeEach(() => { port = createMemDrivePort(); });

  it('Bug 7: fallback без плану — байти з _temp driveId перезаливаються через uploadFile (не reuse temp id)', async () => {
    const temp = await seedSource(port, 'f1', 4);          // лежить у _temp
    const uploadFile = vi.fn(async () => 'persistent_01');
    const created = [];
    const stage = createSplitDocumentsV3({
      runInWorker: wc.runInWorker, drivePort: port, uploadFile,
      createDocument: (m) => ({ id: 'd1', ...m }),
      persistDocument: async ({ document }) => { created.push(document); return { success: true }; },
    });
    const res = await stage(baseCtx(port, {
      plan: null,
      files: [{ fileId: 'f1', name: 'Скан.pdf', driveId: temp, skipped: false, metadataTemplate: {} }],
    }));
    expect(res.ok).toBe(true);
    expect(uploadFile).toHaveBeenCalledTimes(1);            // перезалив, не reuse
    expect(created[0].driveId).toBe('persistent_01');       // персистентний, не temp
    expect(created[0].driveId).not.toBe(temp);
  });

  it('Bug 6: точний дублікат (назва+pageCount) → пропуск + decision duplicate_skipped', async () => {
    const d1 = await seedSource(port, 'f1', 3);
    const persistDocument = vi.fn(async () => ({ success: true }));
    const stage = createSplitDocumentsV3({
      runInWorker: wc.runInWorker, drivePort: port,
      uploadFile: vi.fn(async () => 'drv'),
      createDocument: (m) => ({ id: 'dX', ...m }),
      persistDocument,
    });
    const ctx = baseCtx(port, {
      plan: { confirmed: true, documents: [{ documentId: 'd1', name: 'Позов', type: 'pleading', fragments: [{ fileId: 'f1', startPage: 1, endPage: 3 }] }], unusedPages: [] },
      files: [{ fileId: 'f1', driveId: d1, skipped: false, metadataTemplate: {} }],
    });
    ctx.job.caseData.documents = [{ id: 'old', name: 'Позов.pdf', pageCount: 3 }];
    const res = await stage(ctx);
    expect(res.ok).toBe(true);
    expect(persistDocument).not.toHaveBeenCalled();
    expect(res.decisions.some((x) => x.type === 'duplicate_skipped')).toBe(true);
  });

  it('Bug 6: схожа назва, інший pageCount → додається + decision duplicate_review', async () => {
    const d1 = await seedSource(port, 'f1', 3);
    const persistDocument = vi.fn(async () => ({ success: true }));
    const stage = createSplitDocumentsV3({
      runInWorker: wc.runInWorker, drivePort: port,
      uploadFile: vi.fn(async () => 'drv'),
      createDocument: (m) => ({ id: 'dX', ...m }),
      persistDocument,
    });
    const ctx = baseCtx(port, {
      plan: { confirmed: true, documents: [{ documentId: 'd1', name: 'Позов', type: 'pleading', fragments: [{ fileId: 'f1', startPage: 1, endPage: 3 }] }], unusedPages: [] },
      files: [{ fileId: 'f1', driveId: d1, skipped: false, metadataTemplate: {} }],
    });
    ctx.job.caseData.documents = [{ id: 'old', name: 'Позов.pdf', pageCount: 99 }];
    const res = await stage(ctx);
    expect(persistDocument).toHaveBeenCalledTimes(1);
    expect(res.decisions.some((x) => x.type === 'duplicate_review')).toBe(true);
  });

  it('класифікація: category виводиться з doc.type коли doc.category відсутня', async () => {
    const d1 = await seedSource(port, 'f1', 2);
    const created = [];
    const stage = createSplitDocumentsV3({
      runInWorker: wc.runInWorker, drivePort: port,
      uploadFile: vi.fn(async () => 'drv'),
      createDocument: (m) => ({ id: 'dX', ...m }),
      persistDocument: async ({ document }) => { created.push(document); return { success: true }; },
    });
    const res = await stage(baseCtx(port, {
      plan: { confirmed: true, documents: [{ documentId: 'd1', name: 'Ухвала', type: 'court_act', fragments: [{ fileId: 'f1', startPage: 1, endPage: 2 }] }], unusedPages: [] },
      files: [{ fileId: 'f1', driveId: d1, skipped: false, metadataTemplate: {} }],
    }));
    expect(res.ok).toBe(true);
    expect(created[0].category).toBe('court_act');
  });
});

describe('splitDocumentsV3 — saveFragments + dataset', () => {
  it('unusedPages → 03_ФРАГМЕНТИ + подія DOCUMENT_FRAGMENT_SAVED', async () => {
    const port = createMemDrivePort();
    const d1 = await seedSource(port, 'f1', 8);
    const fragFolder = await port.getOrCreateFolder('03_ФРАГМЕНТИ', null);
    const published = [];
    const stage = createSplitDocumentsV3({
      runInWorker: wc.runInWorker, drivePort: port,
      uploadFile: async () => 'drv',
      createDocument: (m) => ({ id: 'd1', ...m }),
      persistDocument: async () => ({ success: true }),
      eventBus: { publish: (t, p) => published.push({ t, p }) },
      topics: { DOCUMENT_FRAGMENT_SAVED: 'document.fragment_saved' },
    });
    const ctx = baseCtx(port, {
      plan: { confirmed: true, documents: [{ documentId: 'd1', name: 'A', fragments: [{ fileId: 'f1', startPage: 1, endPage: 4 }] }] },
      files: [{ fileId: 'f1', driveId: d1, skipped: false, metadataTemplate: {} }],
      unusedPages: [{ fileId: 'f1', startPage: 7, endPage: 7, reason: 'порожня сторінка' }],
    });
    ctx.job.caseData.storage.subFolders['03_ФРАГМЕНТИ'] = fragFolder.id;
    const res = await stage(ctx);
    expect(res.ok).toBe(true);
    expect(res.decisions.some((d) => d.type === 'fragments_saved' && d.count === 1)).toBe(true);
    expect(port._allNames().some((n) => /^fragment_001\.pdf$/.test(n))).toBe(true);
    expect(port._allNames()).toContain('fragments_log.json');
    expect(published.some((e) => e.t === 'document.fragment_saved')).toBe(true);
  });

  it('datasetCollector викликається лише коли gated toggle on', async () => {
    const port = createMemDrivePort();
    const d1 = await seedSource(port, 'f1', 3);
    const collect = vi.fn(async () => ({ written: true, exampleCount: 1 }));
    const stage = createSplitDocumentsV3({
      runInWorker: wc.runInWorker, drivePort: port,
      uploadFile: async () => 'drv',
      createDocument: (m) => ({ id: 'd1', ...m }),
      persistDocument: async () => ({ success: true }),
      datasetCollector: { collect },
    });
    const res = await stage(baseCtx(port, {
      plan: { confirmed: true, documents: [{ documentId: 'd1', name: 'A', fragments: [{ fileId: 'f1', startPage: 1, endPage: 2 }] }], unusedPages: [] },
      files: [{ fileId: 'f1', driveId: d1, skipped: false, metadataTemplate: {} }],
    }));
    expect(collect).toHaveBeenCalledTimes(1);
    expect(res.decisions.some((d) => d.type === 'dataset_collected')).toBe(true);
  });
});
