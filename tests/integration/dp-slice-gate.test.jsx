// @vitest-environment jsdom
// TASK A1 · Частина A — ворота входу НАРІЗКИ у DP UI. Доказ закриття діри:
// у режимі нарізки (тумблер «Нарізати том» ON; A2 — дефолт тепер просто-додати,
// нарізка явна) не-PDF (Word, PDF+DOCX) і малий PDF НЕ
// доходять до pipeline.run — завертаються з warning. Об'ємний сканований PDF
// (≥1МБ) проходить як раніше. Детекція за РОЗМІРОМ файлу (без pdf.js). Інші
// дороги (склейка/додати/розпак) тут не зачіпаються — інваріант A1 §2-bis.
const BIG = 1024 * 1024;
const bigBytes = (n = BIG) => new Uint8Array(n);
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
import { toast } from '../../src/services/toast.js';

const CASE = { id: 'case_gate', name: 'Справа Ворота', storage: { subFolders: {} } };

function renderWithRun() {
  const run = vi.fn().mockResolvedValue({ ok: true, documents: [], decisions: [], errors: [] });
  const ctx = {
    run, ingestFiles: vi.fn(), addFiles: vi.fn(), cancel: vi.fn(), resume: vi.fn(),
    keepPartial: vi.fn(), discardAll: vi.fn(), ecitsPending: {},
  };
  const utils = render(
    <DocumentPipelineContext.Provider value={ctx}>
      <DocumentProcessorV2 caseData={CASE} onExecuteAction={vi.fn()} driveConnected={false} />
    </DocumentPipelineContext.Provider>,
  );
  return { run, ...utils };
}

async function selectAndStart(container, files) {
  const fileInput = container.querySelector('input[type="file"]');
  await act(async () => { fireEvent.change(fileInput, { target: { files } }); });
  // A2: нарізка тепер явний тумблер (дефолт — просто-додати). Вмикаємо режим
  // нарізки, щоб дійти до воріт входу.
  await act(async () => { fireEvent.click(screen.getByText('Нарізати том на документи')); });
  const startBtn = screen.getByRole('button', { name: /Розпочати обробку/ });
  await act(async () => { fireEvent.click(startBtn); });
}

describe('DP-4 ворота нарізки — не-PDF не доходить до pipeline.run', () => {
  beforeEach(() => store._resetForTests());

  it('lone .docx у режимі нарізки → pipeline.run НЕ викликається + warning', async () => {
    const warn = vi.spyOn(toast, 'warning');
    const { run, container } = renderWithRun();
    const docx = new File([new Uint8Array([1, 2, 3])], 'договір.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    await selectAndStart(container, [docx]);
    expect(run).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls.at(-1)[0])).toContain('лише сканований PDF');
    warn.mockRestore();
  });

  it('PDF + DOCX (без фото) у режимі нарізки → pipeline.run НЕ викликається', async () => {
    const { run, container } = renderWithRun();
    const pdf = new File([bigBytes()], 'том.pdf', { type: 'application/pdf' });
    const docx = new File([new Uint8Array([4, 5, 6])], 'додаток.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    await selectAndStart(container, [pdf, docx]);
    expect(run).not.toHaveBeenCalled();
  });

  it('малий PDF (<1МБ) у режимі нарізки → pipeline.run НЕ викликається + warning', async () => {
    const warn = vi.spyOn(toast, 'warning');
    const { run, container } = renderWithRun();
    const small = new File([new Uint8Array(1024)], 'малий.pdf', { type: 'application/pdf' });
    await selectAndStart(container, [small]);
    expect(run).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls.at(-1)[0])).toContain('Малий PDF');
    warn.mockRestore();
  });
});
