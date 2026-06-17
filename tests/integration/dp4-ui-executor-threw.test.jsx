// @vitest-environment jsdom
// TASK executor_threw_visible_in_zone3 §4.4 — UI snapshot для catch-return.
// Перевіряє, що після вирівнювання shape `executor.run` при exception
// (повертає `errors:[{code,message}]` замість сингулярного `error`):
//   - блок «Помилки» Зони 3 показує `errors[0].code` (<strong>) і `message`;
//   - блок «Питання» — «Питань немає» (decisions порожні).
// Семантично-двійник `dp4-ui-triage-whole-volume.test.jsx`, але навпаки:
// там halt-decision у «Питання», тут — exception у «Помилки».
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

const CASE = { id: 'case_dp4_exec', name: 'Справа DP-4 exec', storage: { subFolders: {} } };

describe('DP-4 UI — EXECUTOR_THREW у «Помилки» Зони 3 (TASK executor_threw_visible_in_zone3)', () => {
  beforeEach(() => store._resetForTests());

  it('catch-return executor рендериться у блоці «Помилки»; блок «Питання» порожній', async () => {
    const run = vi.fn().mockResolvedValue({
      ok: false,
      jobId: 'jE1',
      resumable: true,
      stoppedAt: 'streaming',
      documents: [],
      decisions: [],
      errors: [{
        code: 'EXECUTOR_THREW',
        message: 'OCR chunk 4: Document AI вичерпано retry',
        stage: 'streaming',
      }],
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
    const file = new File([new Uint8Array(1024 * 1024)], 'tom2.pdf', { type: 'application/pdf' });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    const startBtn = screen.getByRole('button', { name: /Розпочати обробку 1 документів/ });
    await act(async () => { fireEvent.click(startBtn); });

    const attentionTab = await screen.findByRole('tab', { name: /Потребує уваги/ });
    if (attentionTab.getAttribute('aria-selected') !== 'true') {
      await act(async () => { fireEvent.click(attentionTab); });
    }

    // «Помилки» — код збою (<strong>) + читабельний текст звідки впало.
    expect(await screen.findByText('EXECUTOR_THREW')).toBeInTheDocument();
    expect(screen.getByText(/Document AI вичерпано retry/i)).toBeInTheDocument();
    // «Питання» — порожньо, бо decisions=[].
    expect(screen.getByText(/Питань немає/i)).toBeInTheDocument();
    // Жодного «Помилок немає» бути не має — блок наповнений.
    expect(screen.queryByText(/Помилок немає/i)).not.toBeInTheDocument();
  });
});
