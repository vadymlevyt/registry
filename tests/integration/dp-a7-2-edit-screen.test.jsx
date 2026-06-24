// @vitest-environment jsdom
// A7.2 — екран редагування плану нарізки + СПРАВЖНІЙ ГЕЙТ. Доводить наскрізь UI:
//   • slice → proposeRun (Фаза 1); екран плану показано; executeRun ЩЕ не кликнуто
//     (гейт «до Виконати на Drive нічого»);
//   • правка плану на екрані (перейменування + «Обʼєднати з наступним») доходить
//     у executeRun як ВІДРЕДАГОВАНИЙ editedPlan;
//   • «Скасувати» закриває екран без executeRun.
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../src/services/ocrService.js', () => ({
  extractText: vi.fn(async () => ({ text: '', pageStructure: null })),
  localizeOcrError: () => 'помилка',
  writeExtractedTextArtifact: vi.fn(async () => true),
  writeLayoutArtifact: vi.fn(async () => true),
  getCachedText: vi.fn(async () => null),
  hasOcrSupport: () => true,
  extractTextBatch: vi.fn(async () => []),
}));
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DocumentPipelineContext } from '../../src/contexts/DocumentPipelineContext.jsx';
import DocumentProcessorV2 from '../../src/components/DocumentProcessorV2/index.jsx';
import * as store from '../../src/services/documentPipeline/jobProgressStore.js';

const CASE = { id: 'case_a72', name: 'A7.2', storage: { subFolders: {} } };

// План на 2 slice-документи з одного файла (межа між стор.2 і стор.3).
const PLAN = {
  documents: [
    { documentId: 'd1', name: 'Перший', type: 'pleading', route: 'slice', fragments: [{ fileId: 'f1', startPage: 1, endPage: 2 }] },
    { documentId: 'd2', name: 'Другий', type: 'court_act', route: 'slice', fragments: [{ fileId: 'f1', startPage: 3, endPage: 4 }] },
  ],
  unusedPages: [],
};

function makeCtx({ proposeRun, executeRun } = {}) {
  return {
    run: vi.fn(),
    proposeRun: proposeRun || vi.fn().mockResolvedValue({
      ok: true, jobId: 'j1',
      session: {
        pipelineFiles: [{ fileId: 'f1', name: 'том.pdf', driveId: 'tmp1' }],
        accessors: { getStreamedLayout: () => ({ pages: [
          { _text: 'ПОЗОВНА ЗАЯВА\nрядок 2' }, { _text: 'стор 2' },
          { _text: 'УХВАЛА СУДУ\nрядок 2' }, { _text: 'стор 4' },
        ] }) },
      },
      plan: PLAN,
    }),
    executeRun: executeRun || vi.fn().mockResolvedValue({ ok: true, documents: [{ id: 'x', name: 'ok' }], decisions: [], errors: [] }),
    addFiles: vi.fn(), ingestFiles: vi.fn(), cancel: vi.fn(), resume: vi.fn(),
    keepPartial: vi.fn(), discardAll: vi.fn(), ecitsPending: {},
    minimizeProgress: vi.fn(), expandProgress: vi.fn(),
  };
}

async function startSlice(container) {
  const fileInput = container.querySelector('input[type="file"]');
  const pdf = new File([new Uint8Array(1024 * 1024)], 'том.pdf', { type: 'application/pdf' });
  await act(async () => { fireEvent.change(fileInput, { target: { files: [pdf] } }); });
  await act(async () => { fireEvent.click(screen.getByText('Нарізати / склеїти')); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Розпочати обробку/ })); });
}

describe('A7.2 — екран редагування плану + гейт', () => {
  beforeEach(() => store._resetForTests());

  it('ГЕЙТ: proposeRun → екран плану; executeRun не викликано до «Виконати»', async () => {
    const ctx = makeCtx();
    const { container } = render(
      <DocumentPipelineContext.Provider value={ctx}>
        <DocumentProcessorV2 caseData={CASE} onExecuteAction={vi.fn()} driveConnected={false} />
      </DocumentPipelineContext.Provider>,
    );
    await startSlice(container);

    expect(ctx.proposeRun).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/План нарізки/)).toBeInTheDocument();
    // Два документи з плану + текст карток із session layout.
    expect(screen.getByDisplayValue('Перший')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Другий')).toBeInTheDocument();
    expect(screen.getByText(/ПОЗОВНА ЗАЯВА/)).toBeInTheDocument();
    expect(screen.getByText(/УХВАЛА СУДУ/)).toBeInTheDocument();
    // Гейт: жодного executeRun до «Виконати».
    expect(ctx.executeRun).not.toHaveBeenCalled();
  });

  it('правка (rename + Обʼєднати з наступним) доходить у executeRun як editedPlan', async () => {
    const ctx = makeCtx();
    const { container } = render(
      <DocumentPipelineContext.Provider value={ctx}>
        <DocumentProcessorV2 caseData={CASE} onExecuteAction={vi.fn()} driveConnected={false} />
      </DocumentPipelineContext.Provider>,
    );
    await startSlice(container);
    await screen.findByText(/План нарізки/);

    // Перейменувати перший документ.
    const nameInput = screen.getByDisplayValue('Перший');
    await act(async () => { fireEvent.change(nameInput, { target: { value: 'Об’єднаний' } }); });

    // Обʼєднати перший з наступним → один документ з усіма 4 сторінками.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Обʼєднати з наступним/ })); });

    // «Виконати» — гейт спрацьовує.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Виконати/ })); });

    expect(ctx.executeRun).toHaveBeenCalledTimes(1);
    const [session, editedPlan] = ctx.executeRun.mock.calls[0];
    // session — той самий непрозорий handle, що повернув proposeRun (RAM-«шухляда»).
    expect(session).toBeTruthy();
    expect(Array.isArray(session.pipelineFiles)).toBe(true);
    // ВІДРЕДАГОВАНИЙ план: один документ, нова назва, 4 сторінки одним діапазоном.
    expect(editedPlan.documents).toHaveLength(1);
    expect(editedPlan.documents[0].name).toBe('Об’єднаний');
    expect(editedPlan.documents[0].fragments).toEqual([{ fileId: 'f1', startPage: 1, endPage: 4 }]);
  });

  it('«Скасувати» закриває екран без executeRun', async () => {
    const ctx = makeCtx();
    const { container } = render(
      <DocumentPipelineContext.Provider value={ctx}>
        <DocumentProcessorV2 caseData={CASE} onExecuteAction={vi.fn()} driveConnected={false} />
      </DocumentPipelineContext.Provider>,
    );
    await startSlice(container);
    await screen.findByText(/План нарізки/);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Скасувати/ })); });

    expect(ctx.executeRun).not.toHaveBeenCalled();
    // Повернулись у звичайний DP UI (Зона 1).
    expect(await screen.findByText(/Зона 1 · Вхідна/)).toBeInTheDocument();
  });

  it('«Розділити тут» збільшує кількість документів і доходить у editedPlan', async () => {
    const ctx = makeCtx();
    const { container } = render(
      <DocumentPipelineContext.Provider value={ctx}>
        <DocumentProcessorV2 caseData={CASE} onExecuteAction={vi.fn()} driveConnected={false} />
      </DocumentPipelineContext.Provider>,
    );
    await startSlice(container);
    await screen.findByText(/План нарізки/);

    // У першому документі (стор.1-2) — «Розділити тут» на 2-й картці → 3 документи.
    const splitBtns = screen.getAllByRole('button', { name: /Розділити тут/ });
    expect(splitBtns.length).toBeGreaterThan(0);
    await act(async () => { fireEvent.click(splitBtns[0]); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Виконати/ })); });
    const [, editedPlan] = ctx.executeRun.mock.calls[0];
    expect(editedPlan.documents).toHaveLength(3);
  });
});
