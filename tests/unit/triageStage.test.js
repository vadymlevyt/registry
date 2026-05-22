// Ф2 — createTriageStage: детермінована сітка, нормалізація плану з .route,
// graceful (нема транспорту / AI кидає / порожньо), passport-вхід.
import { describe, it, expect, vi } from 'vitest';
import { createTriageStage } from '../../src/services/documentPipeline/stages/triageStage.js';

const ctxOf = (files, over = {}) => ({
  job: { caseId: 'c1', jobId: 'j1', addedBy: 'system', source: 'manual' },
  files: files.map((f, i) => ({ fileId: f.fileId || `f${i}`, skipped: false, warnings: [], ...f })),
  documents: [], decisions: [], events: [], ...over,
});

describe('createTriageStage — детермінована сітка', () => {
  it('1 файл-image 1 сторінка → image_merge БЕЗ AI', async () => {
    const triage = vi.fn();
    const stage = createTriageStage({ triage });
    const res = await stage(ctxOf([{ fileId: 'img', name: 'IMG_1.jpg', originalMime: 'image/jpeg', pageCount: 1 }]));
    expect(triage).not.toHaveBeenCalled();
    expect(res.ctx.reconstructionPlan.documents[0].route).toBe('image_merge');
    expect(res.decisions[0].deterministic).toBe(true);
  });

  it('image але >1 сторінка → НЕ тривіально, йде в AI', async () => {
    const triage = vi.fn(async () => ({ documents: [{ documentId: 'd1', route: 'slice', fragments: [{ fileId: 'f0', startPage: 1, endPage: 2 }] }], unusedPages: [] }));
    const stage = createTriageStage({ triage });
    await stage(ctxOf([{ fileId: 'f0', originalMime: 'image/png', pageCount: 3 }]));
    expect(triage).toHaveBeenCalledTimes(1);
  });
});

describe('createTriageStage — нормалізація AI-плану', () => {
  it('кожен документ дістає валідний route + fragments; unusedPages нормалізуються', async () => {
    const triage = vi.fn(async () => ({
      documents: [
        { documentId: 'd1', name: 'Позов', type: 'pleading', route: 'slice', fragments: [{ fileId: 'f0', startPage: 1, endPage: 8 }] },
        { name: 'Додаток', route: 'image_merge', fragments: [{ fileId: 'f1', startPage: '1', endPage: '1' }] },
        { name: 'Сміття', route: 'discard', fragments: [] },
        { name: 'Невідомий route', route: 'wat', fragments: [{ fileId: 'f0', startPage: 9, endPage: 9 }] },
      ],
      unusedPages: [{ fileId: 'f0', startPage: 10, endPage: 10 }],
    }));
    const stage = createTriageStage({ triage });
    const res = await stage(ctxOf([{ fileId: 'f0' }, { fileId: 'f1' }]));
    const docs = res.ctx.reconstructionPlan.documents;
    expect(docs.map((d) => d.route)).toEqual(['slice', 'image_merge', 'discard', 'add_as_is']);
    expect(docs[0].documentId).toBe('d1');
    expect(docs[1].documentId).toBe('doc_2');           // згенерований
    expect(docs[1].fragments[0].startPage).toBe(1);      // "1" → 1
    expect(docs[2].fragments).toEqual([]);               // discard без fragments лишається
    expect(docs[3].route).toBe('add_as_is');             // невалідний route → дефолт
    expect(res.ctx.unusedPages[0].reason).toBeTruthy();  // дефолтна причина
    expect(res.decisions[0].scope).toBe('triage');
  });
});

describe('createTriageStage — graceful', () => {
  it('нема транспорту → passthrough', async () => {
    const res = await createTriageStage({})(ctxOf([{ fileId: 'f0' }]));
    expect(res).toEqual({ ok: true });
  });

  it('AI кидає → НЕ фатально, warning, без плану', async () => {
    const triage = vi.fn(async () => { throw new Error('Triage down'); });
    const res = await createTriageStage({ triage })(ctxOf([{ fileId: 'f0' }]));
    expect(res.ok).toBe(true);
    expect(res.ctx.reconstructionPlan).toBeUndefined();
    expect(res.ctx.files[0].warnings.some((w) => /triage: Triage down/.test(w))).toBe(true);
  });

  it('AI повернув 0 документів → passthrough', async () => {
    const triage = vi.fn(async () => ({ documents: [], unusedPages: [] }));
    const res = await createTriageStage({ triage })(ctxOf([{ fileId: 'f0' }]));
    expect(res).toEqual({ ok: true });
  });

  it('нема live-файлів → passthrough', async () => {
    const res = await createTriageStage({ triage: vi.fn() })(ctxOf([{ fileId: 'f0', skipped: true }]));
    expect(res).toEqual({ ok: true });
  });
});

// ── ФД-T2 ToC препроцесор: реєстр з самого тома → bypass AI Triage ──────────
describe('createTriageStage — ФД-T2 ToC препроцесор (Гілка A)', () => {
  const layoutOf = (texts) => ({ schemaVersion: 1, pages: texts.map((t) => ({ _text: t })) });
  const big30Layout = () => layoutOf(['РЕЄСТР', ...Array.from({ length: 29 }, (_, i) => `документ ${i + 1}`)]);

  it('ToC знайдено → план з реєстру, AI Triage НЕ викликається', async () => {
    const triage = vi.fn();
    const tocDetect = vi.fn(async () => ({
      isToc: true,
      plan: {
        documents: [
          { documentId: 'doc_1', name: 'Постанова', route: 'slice', fragments: [{ fileId: 'f0', startPage: 2, endPage: 5 }] },
          { documentId: 'doc_2', name: 'Протокол', route: 'slice', fragments: [{ fileId: 'f0', startPage: 6, endPage: 10 }] },
        ],
        unusedPages: [{ fileId: 'f0', startPage: 1, endPage: 1, reason: 'реєстр матеріалів' }],
        confirmed: true,
        source: 'toc_detector',
      },
    }));
    const stage = createTriageStage({
      triage, tocDetect,
      getStreamedLayout: () => big30Layout(),
    });
    const res = await stage(ctxOf([{ fileId: 'f0', name: 'big.pdf', originalMime: 'application/pdf', pageCount: 30 }]));
    expect(triage).not.toHaveBeenCalled();
    expect(tocDetect).toHaveBeenCalledTimes(1);
    expect(res.ctx.reconstructionPlan.documents).toHaveLength(2);
    expect(res.ctx.reconstructionPlan.source).toBe('toc_detector');
    expect(res.decisions[0].source).toBe('toc_detector');
    expect(res.decisions[0].deterministic).toBe(true);
    expect(res.decisions[0].message).toMatch(/Реєстр матеріалів/);
  });

  it('ToC не знайдено (isToc:false) → fallback на AI Triage', async () => {
    const tocDetect = vi.fn(async () => ({ isToc: false, reason: 'no_registry_detected' }));
    const triage = vi.fn(async () => ({
      documents: [{ documentId: 'd1', name: 'X', route: 'slice', fragments: [{ fileId: 'f0', startPage: 1, endPage: 5 }] }],
      unusedPages: [],
    }));
    const stage = createTriageStage({
      triage, tocDetect,
      getStreamedLayout: () => big30Layout(),
    });
    const res = await stage(ctxOf([{ fileId: 'f0', originalMime: 'application/pdf', pageCount: 30 }]));
    expect(tocDetect).toHaveBeenCalled();
    expect(triage).toHaveBeenCalled();
    expect(res.ctx.reconstructionPlan.documents).toHaveLength(1);
    expect(res.ctx.reconstructionPlan.source).toBeUndefined();
  });

  it('tocDetect кидає → fallback на AI Triage (graceful, без падіння стадії)', async () => {
    const tocDetect = vi.fn(async () => { throw new Error('boom'); });
    const triage = vi.fn(async () => ({ documents: [{ documentId: 'd1', name: 'X', route: 'slice', fragments: [{ fileId: 'f0', startPage: 1, endPage: 5 }] }], unusedPages: [] }));
    const stage = createTriageStage({
      triage, tocDetect,
      getStreamedLayout: () => big30Layout(),
    });
    const res = await stage(ctxOf([{ fileId: 'f0', originalMime: 'application/pdf', pageCount: 30 }]));
    expect(triage).toHaveBeenCalled();
    expect(res.ctx.reconstructionPlan.documents).toHaveLength(1);
  });

  it('кілька файлів (live.length>1) → ToC пропускається (тільки single-PDF великий том)', async () => {
    const tocDetect = vi.fn();
    const triage = vi.fn(async () => ({ documents: [{ documentId: 'd1', route: 'slice', fragments: [{ fileId: 'f0', startPage: 1, endPage: 2 }] }], unusedPages: [] }));
    const stage = createTriageStage({ triage, tocDetect, getStreamedLayout: () => big30Layout() });
    await stage(ctxOf([
      { fileId: 'f0', originalMime: 'application/pdf', pageCount: 30 },
      { fileId: 'f1', originalMime: 'application/pdf', pageCount: 30 },
    ]));
    expect(tocDetect).not.toHaveBeenCalled();
    expect(triage).toHaveBeenCalled();
  });

  it('image (mime image/*) → ToC пропускається', async () => {
    const tocDetect = vi.fn();
    const triage = vi.fn(async () => ({ documents: [{ documentId: 'd1', route: 'image_merge', fragments: [{ fileId: 'f0', startPage: 1, endPage: 1 }] }], unusedPages: [] }));
    const stage = createTriageStage({ triage, tocDetect, getStreamedLayout: () => big30Layout() });
    await stage(ctxOf([{ fileId: 'f0', originalMime: 'image/png', pageCount: 30 }]));
    expect(tocDetect).not.toHaveBeenCalled();
    expect(triage).toHaveBeenCalled();
  });

  it('малий том (pageCount<10) → ToC пропускається', async () => {
    const tocDetect = vi.fn();
    const triage = vi.fn(async () => ({ documents: [{ documentId: 'd1', route: 'slice', fragments: [{ fileId: 'f0', startPage: 1, endPage: 5 }] }], unusedPages: [] }));
    const stage = createTriageStage({ triage, tocDetect, getStreamedLayout: () => layoutOf(['x', 'y', 'z']) });
    await stage(ctxOf([{ fileId: 'f0', originalMime: 'application/pdf', pageCount: 5 }]));
    expect(tocDetect).not.toHaveBeenCalled();
    expect(triage).toHaveBeenCalled();
  });

  it('нема layout → ToC пропускається', async () => {
    const tocDetect = vi.fn();
    const triage = vi.fn(async () => ({ documents: [{ documentId: 'd1', route: 'slice', fragments: [{ fileId: 'f0', startPage: 1, endPage: 5 }] }], unusedPages: [] }));
    const stage = createTriageStage({ triage, tocDetect, getStreamedLayout: () => null });
    await stage(ctxOf([{ fileId: 'f0', originalMime: 'application/pdf', pageCount: 30 }]));
    expect(tocDetect).not.toHaveBeenCalled();
    expect(triage).toHaveBeenCalled();
  });

  it('нема ін\'єкції tocDetect → пропускаємо ToC (зворотна сумісність)', async () => {
    const triage = vi.fn(async () => ({ documents: [{ documentId: 'd1', route: 'slice', fragments: [{ fileId: 'f0', startPage: 1, endPage: 5 }] }], unusedPages: [] }));
    const stage = createTriageStage({ triage, getStreamedLayout: () => big30Layout() });
    const res = await stage(ctxOf([{ fileId: 'f0', originalMime: 'application/pdf', pageCount: 30 }]));
    expect(triage).toHaveBeenCalled();
    expect(res.ctx.reconstructionPlan.documents).toHaveLength(1);
  });

  it('ToC план з порожніми documents → fallback на AI Triage', async () => {
    const tocDetect = vi.fn(async () => ({ isToc: true, plan: { documents: [], unusedPages: [], source: 'toc_detector' } }));
    const triage = vi.fn(async () => ({ documents: [{ documentId: 'd1', route: 'slice', fragments: [{ fileId: 'f0', startPage: 1, endPage: 5 }] }], unusedPages: [] }));
    const stage = createTriageStage({ triage, tocDetect, getStreamedLayout: () => big30Layout() });
    const res = await stage(ctxOf([{ fileId: 'f0', originalMime: 'application/pdf', pageCount: 30 }]));
    expect(triage).toHaveBeenCalled();
    expect(res.ctx.reconstructionPlan.documents).toHaveLength(1);
  });
});

// ── ЛІНІЯ 2 страховки від зависання ToC-шляху ────────────────────────────────
// Promise.race(tocDetect, sleep(120s)) — гарантований верхній поріг
// preprocessor'а незалежно від внутрішнього retry/timeout callAPI. Якщо
// tocDetect не повернувся за 120с — приймаємо як isToc:false і йдемо у
// звичайний AI Triage. Регресія Нестеренко 273pp: «висне на 0% більше 10 хв»
// через довгий retry-loop tocDetector. ЛІНІЯ 2 — страховка на випадок
// несподіваного зависання поза callAPI (lazy import / зовнішня залежність).
describe('createTriageStage — ЛІНІЯ 2 Promise.race страховка ToC', () => {
  const layoutOf = (texts) => ({ schemaVersion: 1, pages: texts.map((t) => ({ _text: t })) });
  const big30Layout = () => layoutOf(['РЕЄСТР', ...Array.from({ length: 29 }, (_, i) => `документ ${i + 1}`)]);
  const ctxOfLocal = (files, over = {}) => ({
    job: { caseId: 'c1', jobId: 'j1', addedBy: 'system', source: 'manual' },
    files: files.map((f, i) => ({ fileId: f.fileId || `f${i}`, skipped: false, warnings: [], ...f })),
    documents: [], decisions: [], events: [], ...over,
  });

  it('tocDetect зависає на 200с → triageStage виходить за 120с з outer_timeout і викликає AI Triage', async () => {
    vi.useFakeTimers();
    // tocDetect повертає promise що резолвиться лише через 200с — імітація
    // «зависання» preprocessor'а на retry-loop'і callAPI поза TOC_API_OPTIONS.
    const tocDetect = vi.fn(() => new Promise((resolve) => setTimeout(
      () => resolve({ isToc: true, plan: { documents: [{ documentId: 'late', name: 'L', route: 'slice', fragments: [{ fileId: 'f0', startPage: 1, endPage: 5 }] }], unusedPages: [], source: 'toc_detector' } }),
      200000,
    )));
    const triage = vi.fn(async () => ({
      documents: [{ documentId: 'fallback', name: 'F', route: 'slice', fragments: [{ fileId: 'f0', startPage: 1, endPage: 5 }] }],
      unusedPages: [],
    }));
    const stage = createTriageStage({
      triage, tocDetect,
      getStreamedLayout: () => big30Layout(),
    });
    const promise = stage(ctxOfLocal([{ fileId: 'f0', originalMime: 'application/pdf', pageCount: 30 }]));
    // 121с > 120с outer timeout — Promise.race має вирішитись як outer_timeout.
    await vi.advanceTimersByTimeAsync(121000);
    const res = await promise;
    // tocDetect був викликаний (стартував), але AI Triage теж викликаний бо
    // outer_timeout повернув {isToc:false} → fallback.
    expect(tocDetect).toHaveBeenCalledTimes(1);
    expect(triage).toHaveBeenCalledTimes(1);
    expect(res.ctx.reconstructionPlan.documents).toHaveLength(1);
    expect(res.ctx.reconstructionPlan.documents[0].documentId).toBe('fallback');
    expect(res.ctx.reconstructionPlan.source).toBeUndefined();
    vi.useRealTimers();
  });

  it('tocDetect швидко повертає isToc:true → НЕ чекає 120с, бере план ToC', async () => {
    // Sanity-check: страховка НЕ заважає швидкому шляху.
    const tocDetect = vi.fn(async () => ({
      isToc: true,
      plan: {
        documents: [{ documentId: 'fast', name: 'F', route: 'slice', fragments: [{ fileId: 'f0', startPage: 1, endPage: 5 }] }],
        unusedPages: [],
        source: 'toc_detector',
      },
    }));
    const triage = vi.fn();
    const stage = createTriageStage({
      triage, tocDetect,
      getStreamedLayout: () => big30Layout(),
    });
    const res = await stage(ctxOfLocal([{ fileId: 'f0', originalMime: 'application/pdf', pageCount: 30 }]));
    expect(triage).not.toHaveBeenCalled();
    expect(res.ctx.reconstructionPlan.source).toBe('toc_detector');
    expect(res.ctx.reconstructionPlan.documents[0].documentId).toBe('fast');
  });
});

describe('createTriageStage — passport-вхід (вартісна модель §6)', () => {
  it('структурований layout → triage отримує паспорт із дайджестом, не plain', async () => {
    let seen;
    const triage = vi.fn(async ({ artifacts }) => { seen = artifacts; return { documents: [{ documentId: 'd1', route: 'slice', fragments: [{ fileId: 'f0', startPage: 1, endPage: 2 }] }], unusedPages: [] }; });
    const stage = createTriageStage({
      triage,
      getStreamedText: () => 'PLAIN',
      getStreamedLayout: () => ({ schemaVersion: 1, pages: [
        { _text: 'Документ\n12', dimension: { width: 595, height: 842 }, tables: [{}] },
        { _text: 'Інший\n1' },
      ] }),
    });
    await stage(ctxOf([{ fileId: 'f0', name: 'big.pdf', originalMime: 'application/pdf', pageCount: 2 }]));
    expect(seen[0].passport).toContain('=== СТОРІНКА 1 ===');
    expect(seen[0].passport).toContain('СКИДАННЯ-НУМЕРАЦІЇ');
    expect(seen[0].passport).not.toContain('PLAIN');
    expect(seen[0].origin).toBe('pdf');
  });
});

// G3 (bug 1) — plan-level дедуп перекритих діапазонів. Корінь bug 1: Triage
// над-сегментував (квитанція 3 назвами / «Позовна заява» двічі) → дублі у
// реєстрі. Критерій якості: якщо хтось прибере resolveOverlaps — червоний.
describe('createTriageStage — G3 дедуп перекритих діапазонів (bug 1)', () => {
  it('3 документи з тих самих сторінок (різні назви) → лишається 1, dropped=2', async () => {
    const triage = vi.fn(async () => ({
      documents: [
        { documentId: 'd1', name: 'Квитанція про оплату судового збору', route: 'add_as_is', fragments: [{ fileId: 'f0', startPage: 12, endPage: 13 }] },
        { documentId: 'd2', name: 'Платіжна інструкція', route: 'add_as_is', fragments: [{ fileId: 'f0', startPage: 12, endPage: 13 }] },
        { documentId: 'd3', name: 'Платіжна інструкція (судовий збір)', route: 'add_as_is', fragments: [{ fileId: 'f0', startPage: 13, endPage: 13 }] },
      ],
      unusedPages: [],
    }));
    const stage = createTriageStage({ triage });
    const res = await stage(ctxOf([{ fileId: 'f0', name: 'big.pdf', originalMime: 'application/pdf', pageCount: 20 }]));
    expect(res.ctx.reconstructionPlan.documents).toHaveLength(1);
    expect(res.ctx.reconstructionPlan.documents[0].documentId).toBe('d1');
    expect(res.decisions[0].dedupDropped).toBe(2);
    expect(res.decisions[0].message).toContain('Зведено 2');
  });

  it('анти-тиха-втрата: реальний документ перемагає to_fragments на перекритті', async () => {
    const triage = vi.fn(async () => ({
      documents: [
        { documentId: 'cover', name: 'Обкладинка', route: 'to_fragments', fragments: [{ fileId: 'f0', startPage: 1, endPage: 1 }] },
        { documentId: 'real', name: 'Позовна заява', route: 'slice', fragments: [{ fileId: 'f0', startPage: 1, endPage: 5 }] },
      ],
      unusedPages: [],
    }));
    const stage = createTriageStage({ triage });
    const res = await stage(ctxOf([{ fileId: 'f0', name: 'big.pdf', originalMime: 'application/pdf', pageCount: 5 }]));
    const docs = res.ctx.reconstructionPlan.documents;
    expect(docs).toHaveLength(1);
    expect(docs[0].documentId).toBe('real');
    expect(docs[0].route).toBe('slice');
  });

  it('сусідні НЕ перекриті документи лишаються (нормальна нарізка не страждає)', async () => {
    const triage = vi.fn(async () => ({
      documents: [
        { documentId: 'd1', name: 'Позов', route: 'slice', fragments: [{ fileId: 'f0', startPage: 1, endPage: 3 }] },
        { documentId: 'd2', name: 'Ухвала', route: 'slice', fragments: [{ fileId: 'f0', startPage: 4, endPage: 6 }] },
      ],
      unusedPages: [],
    }));
    const stage = createTriageStage({ triage });
    const res = await stage(ctxOf([{ fileId: 'f0', name: 'big.pdf', originalMime: 'application/pdf', pageCount: 6 }]));
    expect(res.ctx.reconstructionPlan.documents).toHaveLength(2);
    expect(res.decisions[0].dedupDropped).toBe(0);
    expect(res.decisions[0].message).not.toContain('Зведено');
  });

  it('перекриття у РІЗНИХ файлах не зводиться (різні фізичні сторінки)', async () => {
    const triage = vi.fn(async () => ({
      documents: [
        { documentId: 'd1', name: 'A', route: 'slice', fragments: [{ fileId: 'f0', startPage: 1, endPage: 2 }] },
        { documentId: 'd2', name: 'B', route: 'slice', fragments: [{ fileId: 'f1', startPage: 1, endPage: 2 }] },
      ],
      unusedPages: [],
    }));
    const stage = createTriageStage({ triage });
    const res = await stage(ctxOf([
      { fileId: 'f0', name: 'a.pdf', originalMime: 'application/pdf', pageCount: 2 },
      { fileId: 'f1', name: 'b.pdf', originalMime: 'application/pdf', pageCount: 2 },
    ]));
    expect(res.ctx.reconstructionPlan.documents).toHaveLength(2);
  });
});
