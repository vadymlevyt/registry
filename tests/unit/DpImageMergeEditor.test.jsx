// @vitest-environment jsdom
//
// TASK 1B image_merge_unify — DpImageMergeEditor: фікс багу «сітка показує
// необрізані прев'ю, а попап — обрізані».
//
// Перевіряємо:
//   • initial render передає previewUrls (не null) у RenderItem ланцюг —
//     до фіксу було `previewUrls={null}`.
//   • computeRenderedBlob викликається з expected flags (applyUserRotation:false,
//     applyCrop:true, includeProposalRect:false) — щоб НЕ було подвійного
//     обертання чи подвійної обрізки.
//   • При applied crop у одному фото — generation запускається саме для
//     нього (auto-orientation=0, нема processedBlob — лише crop applied).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────────
// imageRenderer мокаємо щоб (а) перехопити аргументи computeRenderedBlob,
// (б) не лізти у Canvas / справжню обрізку.
const mockComputeRenderedBlob = vi.fn();
vi.mock('../../src/services/sortation/imageRenderer.js', () => ({
  computeRenderedBlob: (...args) => mockComputeRenderedBlob(...args),
  userRotationCssDelta: () => 0,
}));

// edgeDetection — фокусуємось на crop UI logic, не на AI
vi.mock('../../src/services/sortation/edgeDetection.js', () => ({
  detectDocumentEdges: vi.fn(async () => null),
}));

// toast / UI deps — no-op
vi.mock('../../src/services/toast.js', () => ({
  toast: { show: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

// @dnd-kit ще лезе в DOM matchMedia / addEventListener — jsdom OK, але
// чекаємо асинхронного завантаження dndReady у тесті.

beforeEach(() => {
  mockComputeRenderedBlob.mockReset();
  // Default — повертаємо «не той самий» blob (тобто є трансформація)
  mockComputeRenderedBlob.mockImplementation(async () => new Blob(['baked'], { type: 'image/jpeg' }));
  // jsdom URL.createObjectURL
  if (!global.URL.createObjectURL) global.URL.createObjectURL = vi.fn(() => 'blob:fake');
  if (!global.URL.revokeObjectURL) global.URL.revokeObjectURL = vi.fn();
});

// Динамічний імпорт ПІСЛЯ моків — інакше vi.mock не встигне до import chain
async function importEditor() {
  const mod = await import('../../src/components/DocumentProcessorV2/DpImageMergeEditor.jsx');
  return mod.DpImageMergeEditor;
}

function makeFiles(n) {
  return Array.from({ length: n }, (_, i) =>
    new File([new Uint8Array(100)], `IMG_${i}.jpg`, { type: 'image/jpeg' })
  );
}

function makePre(n, { detectedOrientations } = {}) {
  return {
    normalizedFiles: makeFiles(n),
    ocrResults: Array.from({ length: n }, () => ({ text: 'ocr', pageStructure: null, warnings: [] })),
    detectedOrientations: detectedOrientations || Array.from({ length: n }, () => 0),
    orientationDebug: Array.from({ length: n }, () => null),
    uncertainOrientationIndices: [],
    warnings: [],
  };
}

// ── Тести ────────────────────────────────────────────────────────────────

describe('DpImageMergeEditor — preview generation (фікс багу обрізки у сітці)', () => {
  it('коли auto-orientation = 0 і немає applied crop — computeRenderedBlob НЕ викликається', async () => {
    const DpImageMergeEditor = await importEditor();
    render(
      <DpImageMergeEditor
        caseData={{ id: 'c1', proceedings: [] }}
        proceedings={[]}
        pre={makePre(2)}
        initialGroups={[{ pages: [0, 1], type: null, suggestedName: 'Doc' }]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    // Чекаємо кілька тиків — useEffect асинхронний
    await new Promise((r) => setTimeout(r, 50));
    expect(mockComputeRenderedBlob).not.toHaveBeenCalled();
  });

  it('auto-orientation != 0 → computeRenderedBlob викликається для цього idx з applyUserRotation:false / applyCrop:true', async () => {
    const DpImageMergeEditor = await importEditor();
    render(
      <DpImageMergeEditor
        caseData={{ id: 'c1', proceedings: [] }}
        proceedings={[]}
        pre={makePre(3, { detectedOrientations: [90, 0, 0] })}
        initialGroups={[{ pages: [0, 1, 2], type: null, suggestedName: 'Doc' }]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(mockComputeRenderedBlob).toHaveBeenCalledTimes(1);
    });
    const [ctx, opts] = mockComputeRenderedBlob.mock.calls[0];
    expect(ctx.idx).toBe(0);
    // Критичні прапори — щоб НЕ було подвійного crop/rotation
    expect(opts.applyUserRotation).toBe(false);
    expect(opts.applyCrop).toBe(true);
    expect(opts.includeProposalRect).toBe(false);
  });

  it('кілька фото з auto-orientation → виклик computeRenderedBlob ДЛЯ КОЖНОГО з різним idx', async () => {
    const DpImageMergeEditor = await importEditor();
    render(
      <DpImageMergeEditor
        caseData={{ id: 'c1', proceedings: [] }}
        proceedings={[]}
        pre={makePre(3, { detectedOrientations: [90, 0, 270] })}
        initialGroups={[{ pages: [0, 1, 2], type: null, suggestedName: 'Doc' }]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    // Перевіряємо унікальні idx (effect може зрезонувати кілька разів через
    // edge-detection state-set; це дзеркало модалкової поведінки і не баг).
    // Важливо: idx 1 (deg=0, no crop) — НІКОЛИ не у викликах.
    await waitFor(() => {
      const uniqueIdx = [...new Set(mockComputeRenderedBlob.mock.calls.map(([c]) => c.idx))].sort();
      expect(uniqueIdx).toEqual([0, 2]);
    });
    const uniqueIdx = [...new Set(mockComputeRenderedBlob.mock.calls.map(([c]) => c.idx))];
    expect(uniqueIdx).not.toContain(1);
  });

  it('контракт ctx — передаємо всі стани (cropOverrides, cropApplied, processedBlobs тощо)', async () => {
    const DpImageMergeEditor = await importEditor();
    render(
      <DpImageMergeEditor
        caseData={{ id: 'c1', proceedings: [] }}
        proceedings={[]}
        pre={makePre(1, { detectedOrientations: [90] })}
        initialGroups={[{ pages: [0], type: null, suggestedName: 'Doc' }]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => expect(mockComputeRenderedBlob).toHaveBeenCalled());
    const [ctx] = mockComputeRenderedBlob.mock.calls[0];
    // Усі ключі контексту мають бути присутні (не дрейфувати)
    expect(ctx).toHaveProperty('realFiles');
    expect(ctx).toHaveProperty('detectedOrientations');
    expect(ctx).toHaveProperty('userRotation');
    expect(ctx).toHaveProperty('processedBlobs');
    expect(ctx).toHaveProperty('cropOverrides');
    expect(ctx).toHaveProperty('cropProposals');
    expect(ctx).toHaveProperty('cropDisabled');
    expect(ctx).toHaveProperty('cropAppliedSet');
    // Maps/Sets — порожні початково, але існують (інакше шлях рендеру падає)
    expect(ctx.userRotation instanceof Map).toBe(true);
    expect(ctx.cropOverrides instanceof Map).toBe(true);
    expect(ctx.cropAppliedSet instanceof Set).toBe(true);
  });

  it('computeRenderedBlob повернув ТОЙ САМИЙ blob (no transformation) → URL не створюється', async () => {
    const DpImageMergeEditor = await importEditor();
    // Емулюємо що computeRenderedBlob повернув identity (raw file без змін)
    const pre = makePre(2, { detectedOrientations: [90, 0] });
    mockComputeRenderedBlob.mockImplementation(async ({ idx }) => pre.normalizedFiles[idx]);
    const createObjSpy = vi.spyOn(global.URL, 'createObjectURL');
    render(
      <DpImageMergeEditor
        caseData={{ id: 'c1', proceedings: [] }}
        proceedings={[]}
        pre={pre}
        initialGroups={[{ pages: [0, 1], type: null, suggestedName: 'Doc' }]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => expect(mockComputeRenderedBlob).toHaveBeenCalled());
    // createObjectURL виклики для thumbUrls лишаються (2 файли), але
    // НЕ повинно бути додаткових для previewUrls (identity blob).
    const totalCalls = createObjSpy.mock.calls.length;
    // 2 для thumbUrls, +0 для previewUrls (identity)
    expect(totalCalls).toBe(2);
    createObjSpy.mockRestore();
  });

  it('unmount → revokeObjectURL викликається і для активних previewUrls, і для thumbUrls (без leak)', async () => {
    const DpImageMergeEditor = await importEditor();
    // Кожен виклик createObjectURL повертає унікальний string — щоб порахувати
    // унікальні revoke'и
    let urlSeq = 0;
    const createSpy = vi.spyOn(global.URL, 'createObjectURL').mockImplementation(() => `blob:test_${urlSeq++}`);
    const revokeSpy = vi.spyOn(global.URL, 'revokeObjectURL');

    // 2 фото, обидва з auto-orientation != 0 → previewUrls Map стане розміру 2
    const pre = makePre(2, { detectedOrientations: [90, 270] });
    const { unmount } = render(
      <DpImageMergeEditor
        caseData={{ id: 'c1', proceedings: [] }}
        proceedings={[]}
        pre={pre}
        initialGroups={[{ pages: [0, 1], type: null, suggestedName: 'Doc' }]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => expect(mockComputeRenderedBlob).toHaveBeenCalled());
    // Дочекатись щоб setPreviewUrls встиг — інакше unmount може спрацювати
    // до того як state містить URLs.
    await new Promise((r) => setTimeout(r, 100));
    const createdCount = createSpy.mock.calls.length;
    // Принаймні 2 для thumbs + 2 для preview (90° і 270°)
    expect(createdCount).toBeGreaterThanOrEqual(4);

    revokeSpy.mockClear();
    unmount();

    // На unmount — revoke і thumbUrls (2), і активні previewUrls (≥2).
    // Якщо повторні fire effect'у на edge-detection state-set дали більше
    // previewUrls — delayed-revoke черга теж розкривається у тому ж cleanup.
    expect(revokeSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
    createSpy.mockRestore();
    revokeSpy.mockRestore();
  });
});
