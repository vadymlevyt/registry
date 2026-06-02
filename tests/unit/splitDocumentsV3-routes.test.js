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

  // B3 (20.05.2026) — корінь: один кривий байт-документ у image_merge валив
  // ВЕСЬ pipeline через {fatal: true}. Реальний симптом (скріншот адвоката
  // 17:28): "HTMLImage→createImageBitmap decode failed" на конкретному
  // паспорті → жоден з 25 документів не зберігся через fatal-flag.
  it('mergeImagesToPdf кидає → decision image_merge_failed, інші документи продовжуються', async () => {
    const a = await seedSource(port, 'img_a', 1, 'image/jpeg');
    const b = await seedSource(port, 'img_b', 1, 'image/jpeg');
    const c = await seedSource(port, 'img_c', 1, 'image/jpeg');
    // mergeImagesToPdf кидає для документа 'Паспорт', успішно для 'Договір'.
    const mergeImagesToPdf = vi.fn(async ({ docName }) => {
      if (docName === 'Паспорт') throw new Error('decode failed: source image could not be decoded');
      return new Uint8Array([1, 2, 3]);
    });
    const stage = mkStage(port, { persistDocument, uploadFile, deps: { mergeImagesToPdf } });
    const res = await stage(ctxOf(port,
      { documents: [
        { documentId: 'd1', name: 'Паспорт', route: 'image_merge', fragments: [{ fileId: 'img_a', startPage: 1, endPage: 1 }] },
        { documentId: 'd2', name: 'Договір', route: 'image_merge', fragments: [{ fileId: 'img_b', startPage: 1, endPage: 1 }, { fileId: 'img_c', startPage: 1, endPage: 1 }] },
      ] },
      [
        { fileId: 'img_a', driveId: a, skipped: false, originalMime: 'image/jpeg', name: 'paspot.jpg' },
        { fileId: 'img_b', driveId: b, skipped: false, originalMime: 'image/jpeg', name: 'dog_1.jpg' },
        { fileId: 'img_c', driveId: c, skipped: false, originalMime: 'image/jpeg', name: 'dog_2.jpg' },
      ]));
    // Pipeline ok:true (НЕ fatal).
    expect(res.ok).toBe(true);
    // 1 невдалий → decision image_merge_failed з documentName.
    const failed = res.decisions.find((x) => x.type === 'image_merge_failed');
    expect(failed).toBeDefined();
    expect(failed.documentName).toBe('Паспорт');
    expect(failed.message).toMatch(/decode failed/);
    // 1 успішний → persistDocument викликано РАЗ (не двічі — паспорт пропущено).
    expect(persistDocument).toHaveBeenCalledTimes(1);
    expect(persistDocument.mock.calls[0][0].document.name).toBe('Договір.pdf');
  });

  it('mergeImagesToPdf повертає null/empty → decision, інші продовжуються', async () => {
    // Граничний кейс — функція не кинула, але повернула null (нема валідних
    // зображень). Уже зашитий path "document_split_skipped" — лишається.
    const a = await seedSource(port, 'img_a', 1, 'image/jpeg');
    const mergeImagesToPdf = vi.fn(async () => null);
    const stage = mkStage(port, { persistDocument, uploadFile, deps: { mergeImagesToPdf } });
    const res = await stage(ctxOf(port,
      { documents: [{ documentId: 'd1', name: 'Пусто', route: 'image_merge', fragments: [{ fileId: 'img_a', startPage: 1, endPage: 1 }] }] },
      [{ fileId: 'img_a', driveId: a, skipped: false, originalMime: 'image/jpeg', name: 'A.jpg' }]));
    expect(res.ok).toBe(true);
    expect(persistDocument).not.toHaveBeenCalled();
    expect(res.decisions.some((x) => x.type === 'document_split_skipped')).toBe(true);
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

  // V2-A2: коли layout повний — .txt НЕ пишемо (writeText02 не викликається);
  // зрізаний per-document текст тепер у per-document .layout.json (page._text).
  // Перевіряємо зріз через writeLayout02 (вірне джерело для getDocumentText).
  function joinLayoutText(layoutJson) {
    return (layoutJson?.pages || []).map((p) => p._text || '').join('\n');
  }

  it('slice 1 файл → 2 документи: кожен .layout лише свій діапазон сторінок (БЕЗ .txt, V2-A2)', async () => {
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
    // layout повний → .txt НЕ пишемо; зріз — у per-document .layout.json.
    expect(writeText02).not.toHaveBeenCalled();
    expect(writeLayout02).toHaveBeenCalledTimes(2);
    const [l1, l2] = writeLayout02.mock.calls.map((c) => c[0].layoutJson);
    expect(l1.pages).toHaveLength(3);
    expect(l2.pages).toHaveLength(3);
    const t1 = joinLayoutText(l1);
    const t2 = joinLayoutText(l2);
    // d1 = стор 1-3, БЕЗ тексту стор 4-6.
    expect(t1).toContain('ТЕКСТ-СТОРІНКИ-1');
    expect(t1).toContain('ТЕКСТ-СТОРІНКИ-3');
    expect(t1).not.toContain('ТЕКСТ-СТОРІНКИ-4');
    // d2 = стор 4-6, БЕЗ стор 1-3.
    expect(t2).toContain('ТЕКСТ-СТОРІНКИ-4');
    expect(t2).toContain('ТЕКСТ-СТОРІНКИ-6');
    expect(t2).not.toContain('ТЕКСТ-СТОРІНКИ-3');
    expect((res.decisions || []).some((x) => x.type === 'text_slice_fallback')).toBe(false);
  });

  it('multi-fragment (fragment_reconstruct по 2 файлах) → .layout конкатиться у порядку фрагментів (БЕЗ .txt)', async () => {
    const port = createMemDrivePort();
    const a = await seedSource(port, 'f0', 3);
    const b = await seedSource(port, 'f1', 2);
    const writeText02 = vi.fn(async () => {});
    const writeLayout02 = vi.fn(async () => {});
    const stage = mkStage(port, {
      persistDocument: vi.fn(async () => ({ success: true })),
      uploadFile: vi.fn(async () => 'drv'),
      deps: { writeText02, writeLayout02 },
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
    expect(writeText02).not.toHaveBeenCalled();   // layout повний → без .txt
    const t = joinLayoutText(writeLayout02.mock.calls[0][0].layoutJson);
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

// G2 (bug 6): PERSIST емітить під-прогрес «Документ i з N» через
// ін'єктований deps.onSubProgress (2-й арг диригента). Без нього — no-op
// (behavior-preserving: усі наявні stage(ctx)-виклики не падають).
describe('splitDocumentsV3 G2 — під-прогрес персисту (bug 6)', () => {
  it('branch A: onSubProgress по документу плану (1..N, total=N)', async () => {
    const port = createMemDrivePort();
    const d = await seedSource(port, 'big', 6);
    const onSubProgress = vi.fn();
    const stage = mkStage(port, {
      persistDocument: vi.fn(async () => ({ success: true })),
      uploadFile: vi.fn(async (f) => `drv_${f.name}`),
      deps: { writeText02: async () => {} },
    });
    const ctx = ctxOf(port, { documents: [
      { documentId: 'd1', name: 'A', route: 'slice', fragments: [{ fileId: 'big', startPage: 1, endPage: 3 }] },
      { documentId: 'd2', name: 'B', route: 'slice', fragments: [{ fileId: 'big', startPage: 4, endPage: 6 }] },
    ] }, [{ fileId: 'big', driveId: d, skipped: false, pageCount: 6, layoutJson: { schemaVersion: 1, pages: Array.from({ length: 6 }, (_, i) => ({ _text: `p${i + 1}` })) } }]);
    const res = await stage(ctx, { onSubProgress });
    expect(res.ok).toBe(true);
    expect(onSubProgress.mock.calls.map((c) => c[0])).toEqual([
      { done: 1, total: 2, label: 'Документ' },
      { done: 2, total: 2, label: 'Документ' },
    ]);
  });

  it('відсутній deps.onSubProgress → no-op (наявні stage(ctx)-виклики цілі)', async () => {
    const port = createMemDrivePort();
    const d = await seedSource(port, 'f0', 2);
    const stage = mkStage(port, { persistDocument: vi.fn(async () => ({ success: true })) });
    const res = await stage(ctxOf(port,
      { documents: [{ documentId: 'd1', name: 'X', route: 'add_as_is', fragments: [{ fileId: 'f0', startPage: 1, endPage: 2 }] }] },
      [{ fileId: 'f0', driveId: d, skipped: false }]));   // 2-й арг навмисно відсутній
    expect(res.ok).toBe(true);
  });
});

// G3 (bug 1) — дедуп бачить документи, збережені РАНІШЕ в ЦЬОМУ Ж job.
// Корінь: findDuplicate читав лише заморожений знімок ctx.job.caseData →
// повтори в межах одного прогону не ловились (дублі у реєстрі).
describe('splitDocumentsV3 G3 — same-job дедуп (bug 1)', () => {
  it('два однойменні документи однакового pageCount у ОДНОМУ job → 2-й exact-skip', async () => {
    const port = createMemDrivePort();
    const d = await seedSource(port, 'big', 6);
    const persistDocument = vi.fn(async () => ({ success: true }));
    const stage = mkStage(port, {
      persistDocument,
      uploadFile: vi.fn(async (f) => `drv_${f.name}`),
      deps: { writeText02: async () => {} },
    });
    // План (повз triageStage → resolveOverlaps тут не діє): однакова назва+
    // pageCount, РІЗНІ непересічні сторінки. caseData ПОРОЖНІЙ — раніше обидва
    // персистились; тепер 2-й бачить 1-й через registryView ∪ newDocuments.
    const ctx = ctxOf(port, { documents: [
      { documentId: 'd1', name: 'Ухвала', route: 'slice', fragments: [{ fileId: 'big', startPage: 1, endPage: 3 }] },
      { documentId: 'd2', name: 'Ухвала', route: 'slice', fragments: [{ fileId: 'big', startPage: 4, endPage: 6 }] },
    ] }, [{ fileId: 'big', driveId: d, skipped: false, pageCount: 6 }]);
    const res = await stage(ctx, {});
    expect(res.ok).toBe(true);
    expect(persistDocument).toHaveBeenCalledTimes(1);                 // не двічі
    expect(res.decisions.some((x) => x.type === 'duplicate_skipped')).toBe(true);
  });

  it('наявний у реєстрі (знімок) документ так само ловиться (поведінка збережена)', async () => {
    const port = createMemDrivePort();
    const d = await seedSource(port, 'f0', 2);
    const persistDocument = vi.fn(async () => ({ success: true }));
    const stage = mkStage(port, { persistDocument, uploadFile: vi.fn(async () => 'drv'), deps: { writeText02: async () => {} } });
    const ctx = ctxOf(port, { documents: [
      { documentId: 'd1', name: 'Позов', route: 'add_as_is', fragments: [{ fileId: 'f0', startPage: 1, endPage: 2 }] },
    ] }, [{ fileId: 'f0', driveId: d, skipped: false, pageCount: 2 }]);
    ctx.job.caseData.documents = [{ id: 'old', name: 'Позов.pdf', pageCount: 2 }];  // вже у справі
    const res = await stage(ctx, {});
    expect(persistDocument).not.toHaveBeenCalled();
    expect(res.decisions.some((x) => x.type === 'duplicate_skipped')).toBe(true);
  });
});

// G4 (bug 3) — джерело ріжеться ОДИН раз з усіма діапазонами, не повний
// re-parse 21МБ на кожен документ (корінь 46 хв). Критерій якості: якщо
// хтось поверне per-document splitPdf — splitPdfCalls зросте, тест червоний.
describe('splitDocumentsV3 G4 — splitPdf один раз на джерело (bug 3)', () => {
  function countingWorker(counter) {
    return (op, payload, transfer) => {
      counter[op] = (counter[op] || 0) + 1;
      return wc.runInWorker(op, payload, transfer);
    };
  }

  it('3 документи з ОДНОГО файла → splitPdf 1 раз (було 3), 3 персисти', async () => {
    const port = createMemDrivePort();
    const d = await seedSource(port, 'big', 6);
    const counter = {};
    const persistDocument = vi.fn(async () => ({ success: true }));
    const stage = mkStage(port, {
      persistDocument,
      uploadFile: vi.fn(async (f) => `drv_${f.name}`),
      deps: { runInWorker: countingWorker(counter), writeText02: async () => {} },
    });
    const res = await stage(ctxOf(port, { documents: [
      { documentId: 'a', name: 'Позов', route: 'slice', fragments: [{ fileId: 'big', startPage: 1, endPage: 2 }] },
      { documentId: 'b', name: 'Ухвала', route: 'slice', fragments: [{ fileId: 'big', startPage: 3, endPage: 4 }] },
      { documentId: 'c', name: 'Довідка', route: 'slice', fragments: [{ fileId: 'big', startPage: 5, endPage: 6 }] },
    ] }, [{ fileId: 'big', driveId: d, skipped: false, pageCount: 6 }]));
    expect(res.ok).toBe(true);
    expect(persistDocument).toHaveBeenCalledTimes(3);
    expect(counter.splitPdf).toBe(1);                  // ОДИН парс джерела
    expect(counter.mergePdf || 0).toBe(0);             // single-fragment — без merge
  });

  it('fragment_reconstruct по 2 файлах → splitPdf 2 (по файлу), mergePdf 1', async () => {
    const port = createMemDrivePort();
    const a = await seedSource(port, 'f0', 3);
    const b = await seedSource(port, 'f1', 2);
    const counter = {};
    const stage = mkStage(port, {
      persistDocument: vi.fn(async () => ({ success: true })),
      uploadFile: vi.fn(async () => 'drv'),
      deps: { runInWorker: countingWorker(counter), writeText02: async () => {} },
    });
    const res = await stage(ctxOf(port, { documents: [
      { documentId: 'd1', name: 'Експертиза', route: 'fragment_reconstruct', fragments: [
        { fileId: 'f0', startPage: 1, endPage: 3 }, { fileId: 'f1', startPage: 1, endPage: 2 },
      ] },
    ] }, [
      { fileId: 'f0', driveId: a, skipped: false, pageCount: 3 },
      { fileId: 'f1', driveId: b, skipped: false, pageCount: 2 },
    ]));
    expect(res.ok).toBe(true);
    expect(counter.splitPdf).toBe(2);                  // раз на КОЖЕН файл-джерело
    expect(counter.mergePdf).toBe(1);                  // 2 фрагменти → склейка
  });
});
