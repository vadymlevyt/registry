// @vitest-environment jsdom
// TASK 4 · етап C — DP «просто додати» на всі типи + комбо.
// Тумблер «Просто додати файли» (skipPdfSlicing) + будь-який НЕ-PDF / комбо
// → ingestFiles(input, { mode:'add_as_is' }); кожен файл = один документ,
// без нарізки. all-PDF лишається на стрім-шляху (mode не виставляється).
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

const CASE = { id: 'case_aai', name: 'Справа add-as-is', storage: { subFolders: {} } };

function renderDP(ingestFiles) {
  const ctx = { run: vi.fn(), ingestFiles, cancel: vi.fn(), resume: vi.fn(), keepPartial: vi.fn(), discardAll: vi.fn(), ecitsPending: {} };
  return render(
    <DocumentPipelineContext.Provider value={ctx}>
      <DocumentProcessorV2 caseData={CASE} onExecuteAction={vi.fn()} driveConnected={false} />
    </DocumentPipelineContext.Provider>,
  );
}

describe('DP-4 · «просто додати» (add_as_is) маршрутизація', () => {
  beforeEach(() => store._resetForTests());

  it('toggle ON + НЕ-PDF (DOCX) → ingestFiles з mode:add_as_is і raw-файлом', async () => {
    const ingestFiles = vi.fn().mockResolvedValue({
      ok: true, documents: [{ id: 'd1', name: 'Договір', category: null }], decisions: [], errors: [], files: [],
    });
    const { container } = renderDP(ingestFiles);

    // Додаємо DOCX (не-PDF, не-image — без downscale/canvas у jsdom).
    const fileInput = container.querySelector('input[type="file"]');
    const docx = new File([new Uint8Array([1, 2, 3])], 'Договір.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [docx] } });
    });

    // Вмикаємо тумблер «Просто додати файли».
    await act(async () => {
      fireEvent.click(screen.getByText('Просто додати файли'));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Розпочати обробку/ }));
    });

    expect(ingestFiles).toHaveBeenCalledTimes(1);
    const [input, options] = ingestFiles.mock.calls[0];
    expect(options.mode).toBe('add_as_is');
    expect(options.skipPdfSlicing).toBe(true);
    expect(input.files).toHaveLength(1);
    expect(input.files[0].raw).toBeInstanceOf(File);
    expect(input.files[0].name).toBe('Договір.docx');
    // add_as_is вхід несе module/conversionContext для converterService.
    expect(input.module).toBeTruthy();
    expect(input.conversionContext).toBeTruthy();
  });

  it('toggle ON + all-PDF → стрім-шлях (mode НЕ виставляється)', async () => {
    const ingestFiles = vi.fn().mockResolvedValue({
      ok: true, documents: [{ id: 'd1', name: 'Позов.pdf' }], decisions: [], errors: [],
    });
    const { container } = renderDP(ingestFiles);

    const fileInput = container.querySelector('input[type="file"]');
    const pdf = new File([new Uint8Array([1, 2, 3])], 'позов.pdf', { type: 'application/pdf' });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [pdf] } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Просто додати файли'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Розпочати обробку/ }));
    });

    expect(ingestFiles).toHaveBeenCalledTimes(1);
    const [, options] = ingestFiles.mock.calls[0];
    // all-PDF: нарізку пропускає triage (skipPdfSlicing), але труба — slice.
    expect(options.skipPdfSlicing).toBe(true);
    expect(options.mode).toBeUndefined();
  });
});
