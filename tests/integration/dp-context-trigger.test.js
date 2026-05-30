// Інтеграційний тест DP-тригера перегенерації case_context.md (TASK 2, Вісь A,
// варіант A — через подію). Перевіряє КОНТРАКТ producer↔consumer:
//   • справжній documentPipeline.emit кладе payload.updateCaseContext у подію
//     DOCUMENT_BATCH_PROCESSED (true коли deps.updateCaseContext; інакше false);
//   • слухач (дзеркало гарду CaseDossier) викликає contextGenerator ТІЛЬКИ коли
//     updateCaseContext===true і подія для ПОТОЧНОЇ справи; false / чужа справа → ні.
// Так гарантуємо: тумблер «Оновити case_context.md» реально керує перегенерацією,
// а вимкнений / чужий — нарис не чіпає.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDocumentPipeline } from '../../src/services/documentPipeline.js';
import * as eventBus from '../../src/services/eventBus.js';

const TOPICS = { DOCUMENT_INGESTED: 'document.ingested', DOCUMENT_BATCH_PROCESSED: 'document.batch_processed' };

function makePipeline(over = {}) {
  return createDocumentPipeline({
    convertToPdf: async () => ({
      pdfBlob: { size: 10 }, originalBlob: null, pdfName: 'd', originalName: 'd.pdf',
      originalMime: 'application/pdf', extractedText: null, warnings: [],
      converter: 'passthrough', durationMs: 1,
    }),
    uploadFile: async () => 'drive_X',
    createDocument: (m) => ({ id: 'doc_1', name: m.name || 'd', source: m.source || 'manual', ...m }),
    persistDocument: async () => ({ success: true }),
    eventBus,
    topics: TOPICS,
    getActor: () => ({ userId: 'u1', tenantId: 't1' }),
    ...over,
  });
}

const INPUT = {
  caseId: 'case_dp_ctx',
  caseData: { id: 'case_dp_ctx' },
  files: [{ fileId: 'doc', raw: { name: 'a.pdf', size: 5, type: 'application/pdf' } }],
};

// Дзеркало гарду CaseDossier dpContextHandlerRef.current — те саме рішення.
function attachConsumer({ currentCaseId, generateSpy }) {
  return eventBus.subscribe(TOPICS.DOCUMENT_BATCH_PROCESSED, (payload) => {
    if (!payload || payload.updateCaseContext !== true) return;
    if (payload.caseId !== currentCaseId) return;
    generateSpy(payload);
  });
}

describe('DP-тригер case_context — producer payload', () => {
  beforeEach(() => { eventBus.clear(); });

  it('deps.updateCaseContext=true → payload.updateCaseContext=true', async () => {
    const seen = [];
    const unsub = eventBus.subscribe(TOPICS.DOCUMENT_BATCH_PROCESSED, (p) => seen.push(p));
    await makePipeline({ updateCaseContext: true }).run(INPUT);
    unsub();
    expect(seen).toHaveLength(1);
    expect(seen[0].updateCaseContext).toBe(true);
    expect(seen[0].caseId).toBe('case_dp_ctx');
  });

  it('без deps.updateCaseContext → payload.updateCaseContext=false (дефолт, manual add)', async () => {
    const seen = [];
    const unsub = eventBus.subscribe(TOPICS.DOCUMENT_BATCH_PROCESSED, (p) => seen.push(p));
    await makePipeline().run(INPUT);
    unsub();
    expect(seen).toHaveLength(1);
    expect(seen[0].updateCaseContext).toBe(false);
  });
});

describe('DP-тригер case_context — consumer гард', () => {
  beforeEach(() => { eventBus.clear(); });

  it('updateCaseContext=true + поточна справа → contextGenerator викликано', async () => {
    const generateSpy = vi.fn();
    const unsub = attachConsumer({ currentCaseId: 'case_dp_ctx', generateSpy });
    await makePipeline({ updateCaseContext: true }).run(INPUT);
    unsub();
    expect(generateSpy).toHaveBeenCalledOnce();
    expect(generateSpy.mock.calls[0][0]).toMatchObject({ caseId: 'case_dp_ctx', updateCaseContext: true });
  });

  it('updateCaseContext=false → contextGenerator НЕ викликано (тумблер вимкнено)', async () => {
    const generateSpy = vi.fn();
    const unsub = attachConsumer({ currentCaseId: 'case_dp_ctx', generateSpy });
    await makePipeline().run(INPUT);   // дефолт false
    unsub();
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it('updateCaseContext=true але подія для ЧУЖОЇ справи → НЕ викликано (ізоляція)', async () => {
    const generateSpy = vi.fn();
    const unsub = attachConsumer({ currentCaseId: 'інша_справа', generateSpy });
    await makePipeline({ updateCaseContext: true }).run(INPUT);
    unsub();
    expect(generateSpy).not.toHaveBeenCalled();
  });
});
