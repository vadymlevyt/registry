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
