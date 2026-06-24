// @vitest-environment jsdom
// A7.3 — дата на екрані редагування плану нарізки (виняток ii). Доводить:
//   • тумблер «Проставити дати» дефолт OFF → editedPlan.applyAutoDates false,
//     AI-дата у DatePicker НЕ показана (auto + OFF = порожньо);
//   • тумблер ON → applyAutoDates true, AI-дата з'являється у DatePicker;
//   • editedPlan несе СИРУ date+dateSource (ефективну рахує splitDocumentsV3).
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

const CASE = { id: 'case_a73', name: 'A7.3', storage: { subFolders: {} } };

// План на 2 slice-документи з AI-датами (dateSource неявно 'auto').
const PLAN = {
  documents: [
    { documentId: 'd1', name: 'Перший', type: 'pleading', route: 'slice', date: '2026-03-14', fragments: [{ fileId: 'f1', startPage: 1, endPage: 2 }] },
    { documentId: 'd2', name: 'Другий', type: 'court_act', route: 'slice', date: '2026-04-20', fragments: [{ fileId: 'f1', startPage: 3, endPage: 4 }] },
  ],
  unusedPages: [],
};

function makeCtx({ executeRun } = {}) {
  return {
    run: vi.fn(),
    proposeRun: vi.fn().mockResolvedValue({
      ok: true, jobId: 'j1',
      session: {
        pipelineFiles: [{ fileId: 'f1', name: 'том.pdf', driveId: 'tmp1' }],
        accessors: { getStreamedLayout: () => ({ pages: [
          { _text: 'ПОЗОВНА ЗАЯВА' }, { _text: 'стор 2' }, { _text: 'УХВАЛА' }, { _text: 'стор 4' },
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

function renderEditor(ctx) {
  return render(
    <DocumentPipelineContext.Provider value={ctx}>
      <DocumentProcessorV2 caseData={CASE} onExecuteAction={vi.fn()} driveConnected={false} />
    </DocumentPipelineContext.Provider>,
  );
}

describe('A7.3 — дата на екрані редагування плану', () => {
  beforeEach(() => store._resetForTests());

  it('тумблер дефолт OFF: AI-дата прихована; editedPlan.applyAutoDates false', async () => {
    const ctx = makeCtx();
    const { container } = renderEditor(ctx);
    await startSlice(container);
    await screen.findByText(/План нарізки/);

    // Тумблер присутній і вимкнений; AI-дата (14.03.2026) НЕ показана у DatePicker.
    expect(screen.getByText('Проставити дати')).toBeInTheDocument();
    expect(screen.queryByText('14.03.2026')).not.toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Виконати/ })); });
    const [, editedPlan] = ctx.executeRun.mock.calls[0];
    expect(editedPlan.applyAutoDates).toBe(false);
    // Сира date+dateSource доходять (auto) — ефективну дату рахує persist.
    expect(editedPlan.documents[0]).toMatchObject({ date: '2026-03-14', dateSource: 'auto' });
  });

  it('тумблер ON: AI-дата показана; editedPlan.applyAutoDates true', async () => {
    const ctx = makeCtx();
    const { container } = renderEditor(ctx);
    await startSlice(container);
    await screen.findByText(/План нарізки/);

    await act(async () => { fireEvent.click(screen.getByRole('checkbox')); });
    // Тепер AI-дата видима у тригері DatePicker.
    expect(screen.getByText('14.03.2026')).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Виконати/ })); });
    const [, editedPlan] = ctx.executeRun.mock.calls[0];
    expect(editedPlan.applyAutoDates).toBe(true);
    expect(editedPlan.documents.map((d) => d.date)).toEqual(['2026-03-14', '2026-04-20']);
  });
});
