// @vitest-environment jsdom
// DP-4/A7.2 інтеграція — slice UI flow двофазний: вибрати файл → «Розпочати» →
// proposeRun(input, options) → екран редагування плану (Фаза 1, нічого на Drive).
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

  it('вибраний файл вмикає «Розпочати»; клік викликає proposeRun(input,options) і показує екран плану', async () => {
    // A7.2 · чистий PDF + «Нарізати / склеїти» ON → slice → двофазно (proposeRun).
    const proposeRun = vi.fn().mockResolvedValue({
      ok: true, jobId: 'j1',
      session: { pipelineFiles: [{ fileId: 'f', name: 'позов.pdf', driveId: 'tmp1' }], accessors: { getStreamedLayout: () => null } },
      plan: { documents: [{ documentId: 'd1', name: 'Позовна заява', type: 'pleading', route: 'slice', fragments: [{ fileId: 'f', startPage: 1, endPage: 3 }] }], unusedPages: [] },
    });
    const executeRun = vi.fn();
    const ctx = {
      run: vi.fn(), proposeRun, executeRun, ingestFiles: vi.fn(), addFiles: vi.fn(),
      cancel: vi.fn(), resume: vi.fn(), keepPartial: vi.fn(), discardAll: vi.fn(), ecitsPending: {},
      minimizeProgress: vi.fn(), expandProgress: vi.fn(),
    };

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

    // A2: вмикаємо нарізку, щоб дійти до pipeline.run.
    await act(async () => {
      fireEvent.click(screen.getByText('Нарізати / склеїти'));
    });

    await act(async () => {
      fireEvent.click(startBtn2);
    });

    expect(proposeRun).toHaveBeenCalledTimes(1);
    const [input, options] = proposeRun.mock.calls[0];
    expect(input.caseId).toBe('case_dp4');
    expect(input.files).toHaveLength(1);
    expect(input.files[0].name).toBe('позов.pdf');
    // робочі перемикачі + системні опції прокинуті у proposeRun (A2 прибрала
    // 5 мертвих тумблерів; V2-A2 раніше прибрав cleanForReading)
    expect(options).toMatchObject({
      compressAll: false,
      updateCaseContext: true,
      autoConfirm: true,
    });
    expect(options).not.toHaveProperty('organizeByProceedings');
    expect(options).not.toHaveProperty('cleanForReading');
    expect(options).toHaveProperty('collectDataset');

    // A7.2 ГЕЙТ: екран редагування плану зʼявився, executeRun ЩЕ не викликано
    // (на Drive нічого до «Виконати»).
    expect(await screen.findByText(/План нарізки/)).toBeInTheDocument();
    expect(await screen.findByDisplayValue('Позовна заява')).toBeInTheDocument();
    expect(executeRun).not.toHaveBeenCalled();
  });
});
