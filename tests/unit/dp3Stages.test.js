// DP-3 — стадії V3 (detectBoundariesV3 / confirmBoundaries / extractV3)
// через stageOverrides-контракт. Диригент не залучений (юніт стадій).
import { describe, it, expect, vi } from 'vitest';
import { createDetectBoundariesV3 } from '../../src/services/documentPipeline/stages/detectBoundariesV3.js';
import { createConfirmBoundaries } from '../../src/services/documentPipeline/stages/confirmBoundaries.js';
import { createExtractV3 } from '../../src/services/documentPipeline/stages/extractV3.js';

const ctxOf = (files, over = {}) => ({
  job: { caseId: 'c1', jobId: 'j1', addedBy: 'system', source: 'manual' },
  files: files.map((f, i) => ({ fileId: f.fileId || `f${i}`, skipped: false, warnings: [], ...f })),
  documents: [], decisions: [], events: [], ...over,
});

describe('detectBoundariesV3', () => {
  it('пакет (>1 файл) → reconstructAcrossFiles, propose-only план у ctx', async () => {
    const analyzeFile = vi.fn(async ({ fileId }) => ({
      documents: [{ documentId: `d_${fileId}`, name: 'Док', type: 'pleading', startPage: 1, endPage: 2, open: false }],
      unusedPages: [],
    }));
    const stage = createDetectBoundariesV3({ analyzeFile });
    const res = await stage(ctxOf([{ extractedText: 'a' }, { extractedText: 'b' }]));
    expect(res.ok).toBe(true);
    expect(res.ctx.reconstructionPlan.documents).toHaveLength(2);
    expect(res.decisions[0].type).toBe('document_boundaries');
    expect(res.decisions[0].scope).toBe('multi_file');
  });

  it('один файл — делегує detectSingle (DP-2 поведінка), single-file НЕ регресує', async () => {
    const detectSingle = vi.fn(async () => ({ totalPages: 1, documents: [{ name: 'X', startPage: 1, endPage: 1, type: 'pleading' }] }));
    const stage = createDetectBoundariesV3({ detectSingle });
    const res = await stage(ctxOf([{ extractedText: 't' }]));
    expect(res.ok).toBe(true);
    expect(res.ctx).toBeUndefined(); // <=1 документ → passthrough як DP-1
  });

  it('контракт стадії: інжектований shouldReconstruct шанується (gate — відповідальність caller-а, не стадії)', async () => {
    // Стадія НЕ вирішує сама коли реконструювати — це робить інжектований
    // gate. Перевіряємо саме DI-контракт: якщо caller передав gate що
    // дозволяє 1 файл, стадія реконструює і будує план. (DP-4 BUGFIX, де
    // Provider інжектував `>=1` для single-file, ВІДКОЧЕНО revert-partial;
    // single-file нарізку повертає Smart Triage, ревізія 1.1. Тест
    // лишається бо перевіряє НЕ Provider, а DI-контракт стадії — Triage
    // теж інжектуватиме власний gate.)
    const analyzeFile = vi.fn(async () => ({
      documents: [
        { documentId: 'd1', name: 'Позовна заява', type: 'pleading', startPage: 1, endPage: 8, open: false },
        { documentId: 'd2', name: 'Ухвала', type: 'court_act', startPage: 9, endPage: 12, open: false },
      ],
      unusedPages: [],
    }));
    const stage = createDetectBoundariesV3({
      analyzeFile,
      shouldReconstruct: (ctx) => ctx.files.filter((f) => !f.skipped).length >= 1,
    });
    const res = await stage(ctxOf([{ fileId: 'big', extractedText: 'позов...ухвала...' }]));
    expect(res.ok).toBe(true);
    expect(res.ctx.reconstructionPlan.documents).toHaveLength(2);
    expect(res.decisions[0].type).toBe('document_boundaries');
    expect(analyzeFile).toHaveBeenCalledTimes(1);
  });

  it('помилка AI на файлах — НЕ фатально: 0 документів, сторінки у unusedPages', async () => {
    const analyzeFile = vi.fn(async () => { throw new Error('AI down'); });
    const stage = createDetectBoundariesV3({ analyzeFile });
    const res = await stage(ctxOf([{ extractedText: 'a', pageCount: 2 }, { extractedText: 'b', pageCount: 3 }]));
    expect(res.ok).toBe(true);
    expect(res.ctx.reconstructionPlan.documents).toHaveLength(0);
    expect(res.ctx.unusedPages.length).toBeGreaterThan(0);
    expect(res.ctx.unusedPages.every((u) => /реконструкція не вдалась/.test(u.reason))).toBe(true);
  });

  it('нема транспорту → passthrough (ingest не блокуємо, як DP-2)', async () => {
    const res = await createDetectBoundariesV3({})(ctxOf([{ extractedText: 'a' }, { extractedText: 'b' }]));
    expect(res).toEqual({ ok: true });
  });

  // Ф1: межевий текст іде з посторінковими маркерами (=== СТОРІНКА N ===) і
  // НЕ обрізається. Тест ганяє стадію з ТИМИ deps які ін'єктує Provider
  // (analyzeFile + getStreamedText + getStreamedLayout) — закриває gap DP-4
  // (стадія зелена ізольовано, а Provider не дав deps → тихий злам).
  it('getStreamedLayout ін\'єктований → analyzeFile отримує маркований повний текст', async () => {
    const longPage = (n) => `сторінка ${n} `.repeat(2000); // ~65 стор. >> 50K
    const layoutMap = {
      big: { schemaVersion: 1, pages: Array.from({ length: 65 }, (_, i) => ({ _text: longPage(i + 1) })) },
    };
    let seenText = '';
    const analyzeFile = vi.fn(async ({ text }) => {
      seenText = text;
      return { documents: [{ documentId: 'd1', name: 'A', type: 'pleading', startPage: 1, endPage: 65, open: false }], unusedPages: [] };
    });
    const stage = createDetectBoundariesV3({
      analyzeFile,
      getStreamedText: () => 'PLAIN-БЕЗ-МАРКЕРІВ',
      getStreamedLayout: (id) => layoutMap[id] || null,
      shouldReconstruct: () => true,
    });
    const res = await stage(ctxOf([{ fileId: 'big', pageCount: 65 }]));
    expect(res.ok).toBe(true);
    expect(seenText).toContain('=== СТОРІНКА 1 ===');
    expect(seenText).toContain('=== СТОРІНКА 65 ===');
    expect(seenText.length).toBeGreaterThan(50000); // 50K-обрізки більше нема
    expect(seenText).not.toContain('PLAIN-БЕЗ-МАРКЕРІВ'); // layout має пріоритет
  });

  it('layout неповний (resume) → fallback на plain getStreamedText, без маркерів', async () => {
    let seenText = '';
    const analyzeFile = vi.fn(async ({ text }) => {
      seenText = text;
      return { documents: [], unusedPages: [] };
    });
    const stage = createDetectBoundariesV3({
      analyzeFile,
      getStreamedText: () => 'ПОВНИЙ-OCR-ТЕКСТ-БЕЗ-LAYOUT',
      getStreamedLayout: () => ({ schemaVersion: 1, pages: [{ _text: 'p1' }] }), // 1 != pageCount
      shouldReconstruct: () => true,
    });
    await stage(ctxOf([{ fileId: 'big', pageCount: 65 }]));
    expect(seenText).toBe('ПОВНИЙ-OCR-ТЕКСТ-БЕЗ-LAYOUT');
    expect(seenText).not.toContain('=== СТОРІНКА');
  });

  // Ф0: структурний паспорт (дайджест меж) реально доходить до транспорту
  // через ті самі Provider-shape deps — вартісна модель §6 text-first.
  it('Ф0: структурований layout → analyzeFile отримує дайджест паспорта', async () => {
    let seenText = '';
    const analyzeFile = vi.fn(async ({ text }) => {
      seenText = text;
      return { documents: [{ documentId: 'd1', name: 'А', type: 'court_act', startPage: 1, endPage: 2, open: false }], unusedPages: [] };
    });
    const layout = { schemaVersion: 1, pages: [
      { _text: 'Документ А\n12', dimension: { width: 595, height: 842 }, tables: [{}] },
      { _text: 'Документ Б\n1' },
    ] };
    const stage = createDetectBoundariesV3({
      analyzeFile,
      getStreamedText: () => 'PLAIN',
      getStreamedLayout: () => layout,
      shouldReconstruct: () => true,
    });
    await stage(ctxOf([{ fileId: 'big', pageCount: 2 }]));
    expect(seenText).toContain('формат:портрет');
    expect(seenText).toContain('таблиці');
    expect(seenText).toContain('СКИДАННЯ-НУМЕРАЦІЇ');
    expect(seenText).not.toContain('PLAIN');
  });
});

describe('confirmBoundaries', () => {
  const planCtx = ctxOf([{}], { reconstructionPlan: { documents: [{ documentId: 'd1', name: 'A', fragments: [{ fileId: 'f0', startPage: 1, endPage: 2 }] }], unusedPages: [{ fileId: 'f0', startPage: 3, endPage: 3, reason: 'порожня' }] } });

  it('autoConfirm true (дефолт DP-3) → план confirmed, decisions з unusedPages', async () => {
    const res = await createConfirmBoundaries({})(structuredClone(planCtx));
    expect(res.ctx.reconstructionPlan.confirmed).toBe(true);
    expect(res.ctx.unusedPages).toHaveLength(1);
    expect(res.decisions[0].type).toBe('boundaries_confirmation');
    expect(res.decisions[0].autoConfirmed).toBe(true);
  });

  it('autoConfirm false → план proposed (не confirmed), split не ріже', async () => {
    const res = await createConfirmBoundaries({ autoConfirm: false })(structuredClone(planCtx));
    expect(res.ctx.reconstructionPlan.confirmed).toBe(false);
    expect(res.ok).toBe(true);
  });

  it('нема плану → auto-pass (single-file НЕ регресує)', async () => {
    const res = await createConfirmBoundaries({})(ctxOf([{}]));
    expect(res).toEqual({ ok: true });
  });
});

describe('extractV3', () => {
  it('cleanForReading=true + cleaner → md формат, очищений текст', async () => {
    const cleanText = vi.fn(async (t) => `# ${t.trim()}`);
    const stage = createExtractV3({ cleanForReading: true, cleanText });
    const res = await stage(ctxOf([{ extractedText: 'сирий OCR' }]));
    expect(res.ctx.files[0].processedText).toBe('# сирий OCR');
    expect(res.ctx.files[0].textFormat).toBe('md');
  });

  it('без cleaner → txt, текст як є', async () => {
    const res = await createExtractV3({})(ctxOf([{ extractedText: 'plain' }]));
    expect(res.ctx.files[0].processedText).toBe('plain');
    expect(res.ctx.files[0].textFormat).toBe('txt');
  });

  it('clean кинув — не критично: сирий текст + decision', async () => {
    const stage = createExtractV3({ cleanForReading: true, cleanText: async () => { throw new Error('haiku 429'); } });
    const res = await stage(ctxOf([{ extractedText: 'raw', name: 'a' }]));
    expect(res.ctx.files[0].processedText).toBe('raw');
    expect(res.decisions[0].type).toBe('text_clean_failed');
  });

  it('нема тексту → passthrough (поведінка DP-1)', async () => {
    expect(await createExtractV3({})(ctxOf([{}]))).toEqual({ ok: true });
  });
});
