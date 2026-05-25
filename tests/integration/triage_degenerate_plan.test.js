// Integration — degenerate plan halt-канал через справжній createDocumentPipeline.
// Прогін повного диригента з override на detectBoundaries (createTriageStage з
// стабом triage). Перевіряє §3.1 + §3.2 в зв'язці:
//   - degenerate raw → halt → ctx.errors порожній, decision у Зону 3,
//     PERSIST не виконався, stoppedAt = 'detectBoundaries', ok:false.
//   - нормальний 2-документний план → ok:true, regression на continue.
//   - triage кидає виняток → catch у triageStage = ok:true з warning,
//     PERSIST продовжує штатно (regression на silent-fallback).
//   - малий PDF (< DEGENERATE_MIN_PAGES) → НЕ degenerate, regression.
//
// Замітка про pageCount: documentPipeline.makeContext (DP-1) не нормалізує
// pageCount у ctx.files (Provider додає його через streamingExecutor після
// OCR-chunk'ів). У unit-стилі тут не запускаємо реальний streaming — тому
// загортаємо createTriageStage у тонкий адаптер, що підставляє pageCount
// з in-memory lookup-таблиці. Це залишає logic triageStage недоторканою
// (тестуємо ту саму чисту функцію, що в production), просто доносячи дані.
import { describe, it, expect, vi } from 'vitest';
import { createDocumentPipeline } from '../../src/services/documentPipeline.js';
import { createTriageStage } from '../../src/services/documentPipeline/stages/triageStage.js';

const BIG_PAGES = 100;       // > DEGENERATE_MIN_PAGES (70) → потрапляє у фільтр
const SMALL_PAGES = 3;        // < DEGENERATE_MIN_PAGES → НЕ degenerate

// Адаптер: підставляє pageCount з lookup-таблиці у ctx.files, потім кличе
// справжній triageStage. Поведінка triageStage / isDegeneratePlan — реальна.
function wrappedTriage({ triageRaw, throwOnTriage, pageCounts }) {
  const inner = createTriageStage({
    triage: throwOnTriage
      ? async () => { throw new Error('Triage API down'); }
      : async () => triageRaw,
  });
  return async (ctx) => {
    const enriched = {
      ...ctx,
      files: ctx.files.map((f) => ({ ...f, pageCount: pageCounts[f.fileId] ?? f.pageCount ?? 1 })),
    };
    return inner(enriched);
  };
}

function buildPipeline({ triageRaw, throwOnTriage, persistSpy, pageCounts }) {
  return createDocumentPipeline({
    stageOverrides: {
      detectBoundaries: wrappedTriage({ triageRaw, throwOnTriage, pageCounts }),
      persist: persistSpy,
    },
    convertToPdf: async () => ({
      pdfBlob: { size: 1 }, originalBlob: null, pdfName: 'd', originalName: 'd.pdf',
      originalMime: 'application/pdf', extractedText: null, warnings: [],
      converter: 'passthrough', durationMs: 1,
    }),
    uploadFile: async () => 'drive_x',
    createDocument: (m) => ({ id: `doc_${Math.random().toString(36).slice(2, 8)}`, ...m }),
    persistDocument: async () => ({ success: true }),
    eventBus: { publish: () => {} },
    topics: { DOCUMENT_INGESTED: 'document.ingested', DOCUMENT_BATCH_PROCESSED: 'document.batch_processed' },
    getActor: () => ({ userId: 'vadym', tenantId: 'tenant_1' }),
  });
}

const bigInput = () => ({
  caseId: 'case_x',
  caseData: { id: 'case_x' },
  files: [{ fileId: 'big', raw: { name: 'big.pdf', size: BIG_PAGES * 1500, type: 'application/pdf' } }],
});

describe('triage degenerate plan → halt + decision в Зоні 3 (інтеграція)', () => {
  it('degenerate raw (1 doc × 100% на великому томі) → halt, decision триаж, ctx.errors порожній, PERSIST не виконано', async () => {
    const persistSpy = vi.fn(async () => ({ ok: true }));
    const pipe = buildPipeline({
      triageRaw: {
        documents: [{
          documentId: 'd1', route: 'add_as_is',
          fragments: [{ fileId: 'big', startPage: 1, endPage: BIG_PAGES }],
        }],
        unusedPages: [],
      },
      persistSpy,
      pageCounts: { big: BIG_PAGES },
    });
    const result = await pipe.run(bigInput());
    expect(result.stoppedAt).toBe('detectBoundaries');
    expect(result.errors).toEqual([]);
    expect(result.documents).toEqual([]);
    expect(result.ok).toBe(false);
    const att = result.decisions.find((d) => d.type === 'triage_whole_volume');
    expect(att).toBeTruthy();
    expect(att.scope).toBe('triage');
    expect(att.message).toMatch(/не вдалось визначити межі/i);
    expect(att.meta.liveFileCount).toBe(1);
    expect(att.meta.totalPages).toBe(BIG_PAGES);
    expect(persistSpy).not.toHaveBeenCalled();
  });

  it('нормальний 2-документний план → ok:true, regression на continue', async () => {
    const persistSpy = vi.fn(async (ctx) => ({
      ok: true,
      ctx: { ...ctx, documents: [...ctx.documents, { id: 'd1' }, { id: 'd2' }] },
    }));
    const pipe = buildPipeline({
      triageRaw: {
        documents: [
          { documentId: 'd1', route: 'slice', fragments: [{ fileId: 'big', startPage: 1, endPage: 50 }] },
          { documentId: 'd2', route: 'slice', fragments: [{ fileId: 'big', startPage: 51, endPage: BIG_PAGES }] },
        ],
        unusedPages: [],
      },
      persistSpy,
      pageCounts: { big: BIG_PAGES },
    });
    const result = await pipe.run(bigInput());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.stoppedAt).toBeNull();
    expect(result.documents).toHaveLength(2);
    expect(persistSpy).toHaveBeenCalled();
    expect(result.decisions.some((d) => d.type === 'triage_whole_volume')).toBe(false);
  });

  it('triage кидає → catch у triageStage → ok:true з warning, PERSIST виконано (regression silent-fallback)', async () => {
    const persistSpy = vi.fn(async (ctx) => ({
      ok: true,
      ctx: { ...ctx, documents: [...ctx.documents, { id: 'pass' }] },
    }));
    const pipe = buildPipeline({ throwOnTriage: true, persistSpy, pageCounts: { big: BIG_PAGES } });
    const result = await pipe.run(bigInput());
    expect(result.errors).toEqual([]);
    expect(result.stoppedAt).toBeNull();
    expect(persistSpy).toHaveBeenCalled();
    expect(result.decisions.some((d) => d.type === 'triage_whole_volume')).toBe(false);
  });

  it('малий PDF (3 стор., < DEGENERATE_MIN_PAGES) single doc add_as_is → НЕ degenerate, regression happy-path', async () => {
    const persistSpy = vi.fn(async (ctx) => ({
      ok: true,
      ctx: { ...ctx, documents: [...ctx.documents, { id: 'small' }] },
    }));
    const pipe = buildPipeline({
      triageRaw: {
        documents: [{
          documentId: 'd1', route: 'add_as_is',
          fragments: [{ fileId: 'small', startPage: 1, endPage: SMALL_PAGES }],
        }],
        unusedPages: [],
      },
      persistSpy,
      pageCounts: { small: SMALL_PAGES },
    });
    const result = await pipe.run({
      caseId: 'case_x', caseData: { id: 'case_x' },
      files: [{ fileId: 'small', raw: { name: 'small.pdf', size: 4500, type: 'application/pdf' } }],
    });
    expect(result.ok).toBe(true);
    expect(result.stoppedAt).toBeNull();
    expect(persistSpy).toHaveBeenCalled();
    expect(result.decisions.some((d) => d.type === 'triage_whole_volume')).toBe(false);
  });
});
