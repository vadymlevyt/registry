// @vitest-environment jsdom
// TASK degenerate-plan §4.4 — UI snapshot для triage_whole_volume.
// Перевіряє, що нейтральний halt-decision з triageStage:
//   - рендериться у блоці «Питання» (через ATTENTION_TYPES.includes);
//   - блок «Помилки» показує «Помилок немає» (errors[] порожній).
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

const CASE = { id: 'case_dp4', name: 'Справа DP-4', storage: { subFolders: {} } };

describe('DP-4 UI — triage_whole_volume у «Питання» (TASK degenerate-plan)', () => {
  beforeEach(() => store._resetForTests());

  it('halt-decision рендериться у блоці «Питання»; блок «Помилки» порожній', async () => {
    const run = vi.fn().mockResolvedValue({
      ok: false,
      stoppedAt: 'detectBoundaries',
      documents: [],
      decisions: [{
        type: 'triage_whole_volume',
        scope: 'triage',
        message: 'Не вдалось визначити межі документів — том пропонується як один шматок. Потрібна ручна нарізка або повторний прогін меншими частинами.',
        meta: { liveFileCount: 1, totalPages: 100 },
      }],
      errors: [],
    });
    // TASK 4 rework · Стадія D — slice-шлях кличе pipeline.run напряму.
    const ctx = { run, ingestFiles: vi.fn(), addFiles: vi.fn(), cancel: vi.fn(), resume: vi.fn(), keepPartial: vi.fn(), discardAll: vi.fn(), ecitsPending: {} };

    const { container } = render(
      <DocumentPipelineContext.Provider value={ctx}>
        <DocumentProcessorV2 caseData={CASE} onExecuteAction={vi.fn()} driveConnected={false} />
      </DocumentPipelineContext.Provider>,
    );

    const fileInput = container.querySelector('input[type="file"]');
    // ≥1МБ — щоб ворота нарізки (sliceInputGate, за розміром) пускали файл у run.
    const file = new File([new Uint8Array(1024 * 1024)], 'big.pdf', { type: 'application/pdf' });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    // A2: нарізка — явний тумблер (дефолт просто-додати); вмикаємо для pipeline.run.
    await act(async () => { fireEvent.click(screen.getByText('Нарізати том на документи')); });
    const startBtn = screen.getByRole('button', { name: /Розпочати обробку 1 документів/ });
    await act(async () => { fireEvent.click(startBtn); });

    // Після halt'а DP-4 авто-перемикає вкладку результату на 'attention'
    // (бо documents порожній і attentionCount > 0 завдяки decision).
    // Якщо не перемикає сам — клікнемо вручну.
    const attentionTab = await screen.findByRole('tab', { name: /Потребує уваги/ });
    if (attentionTab.getAttribute('aria-selected') !== 'true') {
      await act(async () => { fireEvent.click(attentionTab); });
    }

    // Питання — наше повідомлення є.
    expect(await screen.findByText(/Не вдалось визначити межі документів/i)).toBeInTheDocument();
    // Помилки — порожньо, бо halt не пише в ctx.errors.
    expect(screen.getByText(/Помилок немає/i)).toBeInTheDocument();
  });
});
