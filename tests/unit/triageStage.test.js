// Ф2 — createTriageStage: детермінована сітка, нормалізація плану з .route,
// graceful (нема транспорту / AI кидає / порожньо), passport-вхід.
import { describe, it, expect, vi } from 'vitest';
import { createTriageStage, isDegeneratePlan } from '../../src/services/documentPipeline/stages/triageStage.js';
import { _setRichPassportMaxPages } from '../../src/services/documentPipeline/pageMarkers.js';

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

// 1B image_merge_unify — allImagesRoute видалено як мертвий код. DP перехоплює
// all-image вхід ДО pipeline.run (DocumentProcessorV2.startProcessing вмикає
// окремий під-флоу з prepareImagesForMerge + imageDocumentGrouper + per-group
// rebuild). triageStage більше не зустрічає all-image батчі — якщо хтось
// зробить це поза DP, AI Triage спрацює як для PDF (поведінка fallback, не
// крах). Тести на all-image поведінку triageStage не потрібні — це сценарій
// якого більше нема. trivialImagePlan лишається (legacy single-image у
// випадку ecitsInboxWatcher / runtime fallback).
describe('createTriageStage — all-image fallback (без allImagesRoute, 1B)', () => {
  it('all-image вхід (N≥2) → AI Triage викликається як для PDF (DP перехоплює раніше)', async () => {
    // Сценарій якого не повинно бути у нормальній роботі: DP перехоплює
    // all-image у DocumentProcessorV2. Якщо все ж дійшло сюди — AI Triage
    // не падає, повертає що-небудь або passthrough.
    const triage = vi.fn(async () => ({ documents: [], unusedPages: [] }));
    const stage = createTriageStage({ triage });
    await stage(ctxOf([
      { fileId: 'p1', name: 'IMG_1.jpg', originalMime: 'image/jpeg', pageCount: 1 },
      { fileId: 'p2', name: 'IMG_2.png', originalMime: 'image/png', pageCount: 1 },
    ]));
    expect(triage).toHaveBeenCalledTimes(1);
  });

  it('усі PDF (немає image) → детермінована сітка не спрацьовує, AI Triage', async () => {
    const triage = vi.fn(async () => ({ documents: [], unusedPages: [] }));
    const stage = createTriageStage({ triage });
    await stage(ctxOf([
      { fileId: 'pdf1', name: 'a.pdf', originalMime: 'application/pdf', pageCount: 2 },
      { fileId: 'pdf2', name: 'b.pdf', originalMime: 'application/pdf', pageCount: 5 },
    ]));
    expect(triage).toHaveBeenCalledTimes(1);
  });
});

describe('createTriageStage — 1C.2 skipPdfSlicing тумблер (per-file)', () => {
  it('skipPdfSlicing=true + чистий PDF набір → per-file add_as_is, AI Triage пропущено', async () => {
    const triage = vi.fn();
    const stage = createTriageStage({ triage, skipPdfSlicing: true });
    const res = await stage(ctxOf([
      { fileId: 'pdf1', name: 'a.pdf', originalMime: 'application/pdf', pageCount: 3 },
      { fileId: 'pdf2', name: 'b.pdf', originalMime: 'application/pdf', pageCount: 7 },
    ]));
    expect(triage).not.toHaveBeenCalled();
    const docs = res.ctx.reconstructionPlan.documents;
    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.route)).toEqual(['add_as_is', 'add_as_is']);
    expect(docs[0].fragments[0]).toEqual({ fileId: 'pdf1', startPage: 1, endPage: 3 });
    expect(docs[1].fragments[0]).toEqual({ fileId: 'pdf2', startPage: 1, endPage: 7 });
    expect(docs[0].name).toBe('a.pdf');
    expect(res.decisions[0].deterministic).toBe(true);
    expect(res.decisions[0].message).toMatch(/Просто додати файли/);
  });

  it('skipPdfSlicing=true + мікс PDF+фото → per-file (фото→image_merge, PDF→add_as_is), AI Triage пропущено', async () => {
    // Ключовий кейс правки: у міксі toggle повинен спрацювати, інакше AI
    // Triage поріже PDF попри toggle. Кожен файл → свій документ зі своїм
    // route (image_merge для image/*, add_as_is для решти).
    const triage = vi.fn();
    const stage = createTriageStage({ triage, skipPdfSlicing: true });
    const res = await stage(ctxOf([
      { fileId: 'p1', name: 'photo.jpg', originalMime: 'image/jpeg', pageCount: 1 },
      { fileId: 'pdf1', name: 'doc.pdf', originalMime: 'application/pdf', pageCount: 5 },
      { fileId: 'p2', name: 'photo2.heic', originalMime: 'image/heic', pageCount: 1 },
    ]));
    expect(triage).not.toHaveBeenCalled();
    const docs = res.ctx.reconstructionPlan.documents;
    expect(docs).toHaveLength(3);
    expect(docs.map((d) => d.route)).toEqual(['image_merge', 'add_as_is', 'image_merge']);
    expect(docs[1].fragments[0]).toEqual({ fileId: 'pdf1', startPage: 1, endPage: 5 });
  });

  it('skipPdfSlicing=true + усі image → per-file image_merge, кожне фото окремий документ', async () => {
    // Toggle ON каже «не різати, не групувати — кожен файл окремо як є».
    // У DP-сценарії all-image зазвичай перехоплюється ДО pipeline.run (DP image-
    // merge editor — 1B), але toggle ON має пріоритет: адвокат явно вимкнув
    // групування, тому навіть якщо щось дійшло до triageStage, тут per-file.
    const triage = vi.fn();
    const stage = createTriageStage({ triage, skipPdfSlicing: true });
    const res = await stage(ctxOf([
      { fileId: 'p1', name: 'photo1.jpg', originalMime: 'image/jpeg', pageCount: 1 },
      { fileId: 'p2', name: 'photo2.png', originalMime: 'image/png', pageCount: 1 },
    ]));
    expect(triage).not.toHaveBeenCalled();
    const docs = res.ctx.reconstructionPlan.documents;
    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.route)).toEqual(['image_merge', 'image_merge']);
  });

  it('skipPdfSlicing=false (default) + PDF → AI Triage викликається як раніше', async () => {
    const triage = vi.fn(async () => ({ documents: [], unusedPages: [] }));
    const stage = createTriageStage({ triage });
    await stage(ctxOf([
      { fileId: 'pdf1', name: 'a.pdf', originalMime: 'application/pdf', pageCount: 3 },
    ]));
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
  it('нема транспорту → passthrough (+ DIAG decision)', async () => {
    const res = await createTriageStage({})(ctxOf([{ fileId: 'f0' }]));
    expect(res.ok).toBe(true);
    expect(res.ctx?.reconstructionPlan).toBeUndefined();
    expect(res.decisions[0].type).toBe('triage_skipped');
  });

  it('AI кидає → НЕ фатально, warning, без плану', async () => {
    const triage = vi.fn(async () => { throw new Error('Triage down'); });
    const res = await createTriageStage({ triage })(ctxOf([{ fileId: 'f0' }]));
    expect(res.ok).toBe(true);
    expect(res.ctx.reconstructionPlan).toBeUndefined();
    expect(res.ctx.files[0].warnings.some((w) => /triage: Triage down/.test(w))).toBe(true);
  });

  it('AI повернув 0 документів → passthrough (+ DIAG decision)', async () => {
    const triage = vi.fn(async () => ({ documents: [], unusedPages: [] }));
    const res = await createTriageStage({ triage })(ctxOf([{ fileId: 'f0' }]));
    expect(res.ok).toBe(true);
    expect(res.ctx?.reconstructionPlan).toBeUndefined();
    expect(res.decisions[0].type).toBe('triage_empty');
  });

  it('нема live-файлів → passthrough', async () => {
    const res = await createTriageStage({ triage: vi.fn() })(ctxOf([{ fileId: 'f0', skipped: true }]));
    expect(res).toEqual({ ok: true });
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

// ── isDegeneratePlan (TASK degenerate-plan) ─────────────────────────────────
// Сітка покриває обидва нові фільтри (route + обсяг). Критерій якості:
// якщо хтось прибере DEGENERATE_MIN_PAGES або DEGENERATE_ELIGIBLE_ROUTES —
// частина цих тестів стане червоною (regression).
describe('isDegeneratePlan — критерій + фільтри обсягу і route', () => {
  const planOf = (route, fragments) => ({ documents: [{ documentId: 'd1', route, fragments }], unusedPages: [] });

  it('1 файл 80 стор., add_as_is покриває все → true', () => {
    const plan = planOf('add_as_is', [{ fileId: 'f0', startPage: 1, endPage: 80 }]);
    expect(isDegeneratePlan(plan, [{ fileId: 'f0', pageCount: 80 }])).toBe(true);
  });

  it('1 файл 80 стор., slice покриває все → true', () => {
    const plan = planOf('slice', [{ fileId: 'f0', startPage: 1, endPage: 80 }]);
    expect(isDegeneratePlan(plan, [{ fileId: 'f0', pageCount: 80 }])).toBe(true);
  });

  it('фільтр обсягу: 1 файл 3 стор., add_as_is → false (happy-path малого PDF)', () => {
    const plan = planOf('add_as_is', [{ fileId: 'f0', startPage: 1, endPage: 3 }]);
    expect(isDegeneratePlan(plan, [{ fileId: 'f0', pageCount: 3 }])).toBe(false);
  });

  it('фільтр обсягу: 1 файл 69 стор. (на самій межі) → false', () => {
    const plan = planOf('add_as_is', [{ fileId: 'f0', startPage: 1, endPage: 69 }]);
    expect(isDegeneratePlan(plan, [{ fileId: 'f0', pageCount: 69 }])).toBe(false);
  });

  it('фільтр route: image_merge 100 стор. → false (дизайн route)', () => {
    const plan = planOf('image_merge', [{ fileId: 'f0', startPage: 1, endPage: 100 }]);
    expect(isDegeneratePlan(plan, [{ fileId: 'f0', pageCount: 100 }])).toBe(false);
  });

  it('фільтр route: fragment_reconstruct 100 стор. → false (дизайн route)', () => {
    const plan = planOf('fragment_reconstruct', [{ fileId: 'f0', startPage: 1, endPage: 100 }]);
    expect(isDegeneratePlan(plan, [{ fileId: 'f0', pageCount: 100 }])).toBe(false);
  });

  it('фільтр route: discard → false (службовий)', () => {
    const plan = { documents: [{ documentId: 'd1', route: 'discard', fragments: [] }], unusedPages: [] };
    expect(isDegeneratePlan(plan, [{ fileId: 'f0', pageCount: 100 }])).toBe(false);
  });

  it('1 файл 100 стор., 2 add_as_is документи → false (два документи — не degenerate)', () => {
    const plan = { documents: [
      { documentId: 'd1', route: 'add_as_is', fragments: [{ fileId: 'f0', startPage: 1, endPage: 60 }] },
      { documentId: 'd2', route: 'add_as_is', fragments: [{ fileId: 'f0', startPage: 61, endPage: 100 }] },
    ], unusedPages: [] };
    expect(isDegeneratePlan(plan, [{ fileId: 'f0', pageCount: 100 }])).toBe(false);
  });

  it('2 файли по 50 стор. (total 100), add_as_is покриває обидва → true', () => {
    const plan = planOf('add_as_is', [
      { fileId: 'f0', startPage: 1, endPage: 50 },
      { fileId: 'f1', startPage: 1, endPage: 50 },
    ]);
    expect(isDegeneratePlan(plan, [
      { fileId: 'f0', pageCount: 50 },
      { fileId: 'f1', pageCount: 50 },
    ])).toBe(true);
  });

  it('2 файли по 50 стор., план покриває тільки file1 → false', () => {
    const plan = planOf('add_as_is', [{ fileId: 'f0', startPage: 1, endPage: 50 }]);
    expect(isDegeneratePlan(plan, [
      { fileId: 'f0', pageCount: 50 },
      { fileId: 'f1', pageCount: 50 },
    ])).toBe(false);
  });

  it('план з 0 документів → false', () => {
    expect(isDegeneratePlan({ documents: [], unusedPages: [] }, [{ fileId: 'f0', pageCount: 100 }])).toBe(false);
  });
});

// _setRichPassportMaxPages — round-trip override hook (тестовий/калібровочний).
describe('_setRichPassportMaxPages — round-trip', () => {
  it('override впливає на резолвер richMaxPages (через resolveBoundaryText)', async () => {
    const { resolveBoundaryText, buildCompactTriagePassport } = await import('../../src/services/documentPipeline/pageMarkers.js');
    const make = (n) => ({ schemaVersion: 1, pages: Array.from({ length: n }, () => ({
      _text: Array.from({ length: 30 }, (_, k) => `рядок ${k + 1} достатньо інформативний для тесту`).join('\n'),
      dimension: { width: 595, height: 842 },
    })) });
    // Дефолт 70 → 65 стор. — це rich profile (>2x вище за дефолтний компактний).
    _setRichPassportMaxPages(50);    // override нижче — 65 стор. вже понад → дефолти.
    try {
      const out = resolveBoundaryText(make(65), null, '');
      const def = buildCompactTriagePassport(make(65));
      expect(out).toBe(def);          // тепер 65 > override 50 → дефолти компактного
    } finally {
      _setRichPassportMaxPages(null);  // повертаємо штатну поведінку
    }
  });
});

// Симетрія порогів: DEGENERATE_MIN_PAGES (у triageStage) ≡
// RICH_PASSPORT_MAX_PAGES_DEFAULT (у pageMarkers). Правило #11 — одна цифра,
// один сенс «межа якості Haiku вікна». Якщо одну зміниш — впаде reminder,
// синхронно зміни іншу.
describe('Симетрія порогів — нагадувач правила #11', () => {
  it('DEGENERATE_MIN_PAGES = RICH_PASSPORT_MAX_PAGES_DEFAULT (одна цифра, один сенс)', () => {
    // Поведінкова перевірка через граничні значення:
    // - 70 стор. add_as_is → degenerate (≥ DEGENERATE_MIN_PAGES)
    // - 69 стор. add_as_is → НЕ degenerate
    // Якщо одна з цифр у коді розійдеться — або degenerate захопить 69, або
    // не захопить 70, → цей тест червоніє.
    const at70 = isDegeneratePlan(
      { documents: [{ documentId: 'd1', route: 'add_as_is', fragments: [{ fileId: 'f0', startPage: 1, endPage: 70 }] }] },
      [{ fileId: 'f0', pageCount: 70 }],
    );
    const at69 = isDegeneratePlan(
      { documents: [{ documentId: 'd1', route: 'add_as_is', fragments: [{ fileId: 'f0', startPage: 1, endPage: 69 }] }] },
      [{ fileId: 'f0', pageCount: 69 }],
    );
    expect(at70).toBe(true);
    expect(at69).toBe(false);
    // Якщо RICH_PASSPORT_MAX_PAGES_DEFAULT зміниться — синхронно змінити
    // DEGENERATE_MIN_PAGES і числа в цьому тесті.
  });
});
