// @vitest-environment jsdom
// DP-4 інтеграція — повний UI flow: вибрати файл → «Розпочати» → run
// викликано з input.files + опціями 8 перемикачів → результат у Зоні 3.
// Контракт UI→pipeline (executor — окремо в dp3-streaming.test.js).
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

describe('DP-4 UI flow (вибір → запуск → результат)', () => {
  beforeEach(() => store._resetForTests());

  it('вибраний файл вмикає «Розпочати»; клік викликає run(input,options) і показує документи', async () => {
    // TASK 4 rework · Стадія D — чистий PDF без тумблерів → slice → pipeline.run.
    const run = vi.fn().mockResolvedValue({
      ok: true,
      documents: [{ id: 'd1', name: 'Позовна заява.pdf', category: 'pleading', pageCount: 3 }],
      decisions: [],
      errors: [],
    });
    const ctx = { run, ingestFiles: vi.fn(), addFiles: vi.fn(), cancel: vi.fn(), resume: vi.fn(), keepPartial: vi.fn(), discardAll: vi.fn(), ecitsPending: {} };

    const { container } = render(
      <DocumentPipelineContext.Provider value={ctx}>
        <DocumentProcessorV2 caseData={CASE} onExecuteAction={vi.fn()} driveConnected={false} />
      </DocumentPipelineContext.Provider>,
    );

    const startBtn = screen.getByRole('button', { name: /Розпочати обробку/ });
    expect(startBtn).toBeDisabled();

    const fileInput = container.querySelector('input[type="file"]');
    // ≥1МБ — щоб ворота нарізки (sliceInputGate, за розміром) пускали файл у run.
    const file = new File([new Uint8Array(1024 * 1024)], 'позов.pdf', { type: 'application/pdf' });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    const startBtn2 = screen.getByRole('button', { name: /Розпочати обробку 1 документів/ });
    expect(startBtn2).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(startBtn2);
    });

    expect(run).toHaveBeenCalledTimes(1);
    const [input, options] = run.mock.calls[0];
    expect(input.caseId).toBe('case_dp4');
    expect(input.files).toHaveLength(1);
    expect(input.files[0].name).toBe('позов.pdf');
    // робочі перемикачі + системні опції прокинуті у run (A2 Частина 1 прибрала
    // 5 мертвих тумблерів; V2-A2 раніше прибрав cleanForReading)
    expect(options).toMatchObject({
      compressAll: false,
      updateCaseContext: true,
      autoConfirm: true,
    });
    expect(options).not.toHaveProperty('organizeByProceedings');
    expect(options).not.toHaveProperty('integrityCheck');
    expect(options).not.toHaveProperty('generateSummary');
    expect(options).not.toHaveProperty('suggestDeadlines');
    expect(options).not.toHaveProperty('fillCaseCard');
    expect(options).not.toHaveProperty('cleanForReading');
    expect(options).toHaveProperty('collectDataset');

    // Зона 3 (вкладка Дерево) показує створений документ
    expect(await screen.findByText('Позовна заява.pdf')).toBeInTheDocument();
  });
});
