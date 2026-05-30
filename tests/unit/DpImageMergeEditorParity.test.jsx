// @vitest-environment jsdom
//
// TASK DP image parity — DpImageMergeEditor: #1 дублі + #9 контроль обрізки
// (паритет з модалкою). Перевіряємо що editor:
//   #1 — отримавши initialDuplicates, малює банер «Знайдено N груп дублікатів»,
//        бейджі «Рекомендую залишити»/«Дублікат» на thumbnail, і «Залишити
//        рекомендовані» прибирає не-рекомендовані фото.
//   #9 — за наявності crop-пропозиції показує банер «Не обрізати жодну»; клік
//        вимикає всі обрізки (банер зникає бо активних crop більше нема).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent, screen } from '@testing-library/react';

// computeRenderedBlob — мок (не лізти у Canvas).
vi.mock('../../src/services/sortation/imageRenderer.js', () => ({
  computeRenderedBlob: vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' })),
  userRotationCssDelta: () => 0,
}));

// edgeDetection — керований per-test (для #9 повертаємо rect).
const mockDetectEdges = vi.fn(async () => null);
vi.mock('../../src/services/sortation/edgeDetection.js', () => ({
  detectDocumentEdges: (...args) => mockDetectEdges(...args),
}));

vi.mock('../../src/services/toast.js', () => ({
  toast: { show: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

beforeEach(() => {
  mockDetectEdges.mockReset();
  mockDetectEdges.mockResolvedValue(null);
  if (!global.URL.createObjectURL) global.URL.createObjectURL = vi.fn(() => 'blob:fake');
  if (!global.URL.revokeObjectURL) global.URL.revokeObjectURL = vi.fn();
});

async function importEditor() {
  const mod = await import('../../src/components/DocumentProcessorV2/DpImageMergeEditor.jsx');
  return mod.DpImageMergeEditor;
}

function makePre(n) {
  return {
    normalizedFiles: Array.from({ length: n }, (_, i) =>
      new File([new Uint8Array(50)], `IMG_${i}.jpg`, { type: 'image/jpeg' })),
    ocrResults: Array.from({ length: n }, () => ({ text: 'ocr', pageStructure: null, warnings: [] })),
    detectedOrientations: Array.from({ length: n }, () => 0),
    orientationDebug: Array.from({ length: n }, () => null),
    uncertainOrientationIndices: [],
    warnings: [],
  };
}

describe('DpImageMergeEditor — #1 дублі (паритет з модалкою)', () => {
  it('initialDuplicates → банер «Знайдено N групи дублікатів» + бейджі на thumbnail', async () => {
    const DpImageMergeEditor = await importEditor();
    render(
      <DpImageMergeEditor
        caseData={{ id: 'c1', proceedings: [] }}
        proceedings={[]}
        pre={makePre(2)}
        initialGroups={[{ pages: [0, 1], type: null, suggestedName: 'Doc' }]}
        initialDuplicates={[{ group: [0, 1], recommended: 0, reason: 'чіткіше' }]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    // Банер не залежить від dndReady.
    expect(await screen.findByText(/Знайдено 1 групу дублікатів/)).toBeTruthy();
    expect(screen.getByText('Залишити рекомендовані')).toBeTruthy();
    // Thumbnail бейджі — після dndReady (grid рендериться).
    await waitFor(() => {
      expect(screen.getByText('Рекомендую залишити')).toBeTruthy();
      expect(screen.getByText('Дублікат')).toBeTruthy();
    });
  });

  it('«Залишити рекомендовані» прибирає не-рекомендоване фото (idx 1)', async () => {
    const DpImageMergeEditor = await importEditor();
    render(
      <DpImageMergeEditor
        caseData={{ id: 'c1', proceedings: [] }}
        proceedings={[]}
        pre={makePre(2)}
        initialGroups={[{ pages: [0, 1], type: null, suggestedName: 'Doc' }]}
        initialDuplicates={[{ group: [0, 1], recommended: 0, reason: 'чіткіше' }]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByText('Дублікат')).toBeTruthy());
    fireEvent.click(screen.getByText('Залишити рекомендовані'));
    // Не-рекомендований дублікат (idx 1) прибрано → бейдж «Дублікат» зникає.
    await waitFor(() => expect(screen.queryByText('Дублікат')).toBeNull());
  });

  it('без initialDuplicates → банера дублів немає', async () => {
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
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText(/груп.* дублікатів/)).toBeNull();
  });
});

describe('DpImageMergeEditor — #9 контроль обрізки (банер «Не обрізати жодну»)', () => {
  it('crop-пропозиція → банер «Не обрізати жодну»; клік вимикає всі обрізки', async () => {
    // edge detection повертає rect для обох фото → cropState 'active'.
    mockDetectEdges.mockResolvedValue({ x: 5, y: 5, width: 40, height: 40 });
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
    // Банер зʼявляється коли edge detection виставив cropProposals.
    const disableBtn = await screen.findByText('Не обрізати жодну');
    expect(disableBtn).toBeTruthy();
    expect(screen.getByText(/Обрізку буде застосовано до 2/)).toBeTruthy();
    fireEvent.click(disableBtn);
    // Усі crop вимкнено → активних 0 → банер зникає.
    await waitFor(() => expect(screen.queryByText('Не обрізати жодну')).toBeNull());
  });
});
