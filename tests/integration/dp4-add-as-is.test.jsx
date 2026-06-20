// @vitest-environment jsdom
// TASK 4 (rework) · Стадія D — DP «просто додати» на ОКРЕМИЙ сервіс addFiles.
// A2: просто-додати тепер ДЕФОЛТ (тумблер «Нарізати том» OFF) → будь-який
// НЕ-PDF / комбо / all-PDF → pipeline.addFiles(input, { ocrMode, compress }).
// Нарізка (pipeline.run) вмикається лише явним тумблером «Нарізати том».
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

function renderDP({ addFiles, run } = {}) {
  const ctx = {
    run: run || vi.fn().mockResolvedValue({ ok: true, documents: [], decisions: [], errors: [] }),
    addFiles: addFiles || vi.fn().mockResolvedValue({ ok: true, documents: [], files: [], errors: [] }),
    ingestFiles: vi.fn(),
    cancel: vi.fn(), resume: vi.fn(), keepPartial: vi.fn(), discardAll: vi.fn(), ecitsPending: {},
  };
  return render(
    <DocumentPipelineContext.Provider value={ctx}>
      <DocumentProcessorV2 caseData={CASE} onExecuteAction={vi.fn()} driveConnected={false} />
    </DocumentPipelineContext.Provider>,
  );
}

describe('DP-4 · «просто додати» (add_as_is) маршрутизація', () => {
  beforeEach(() => store._resetForTests());

  it('toggle ON + НЕ-PDF (DOCX) → addFiles з raw-файлом (повний OCR за дефолтом)', async () => {
    const addFiles = vi.fn().mockResolvedValue({
      ok: true, documents: [{ id: 'd1', name: 'Договір', category: null }], files: [], errors: [],
    });
    const { container } = renderDP({ addFiles });

    // Додаємо DOCX (не-PDF, не-image — без downscale/canvas у jsdom).
    const fileInput = container.querySelector('input[type="file"]');
    const docx = new File([new Uint8Array([1, 2, 3])], 'Договір.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [docx] } });
    });

    // A2: просто-додати — дефолт, тумблер «Нарізати том» лишаємо OFF.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Розпочати обробку/ }));
    });

    expect(addFiles).toHaveBeenCalledTimes(1);
    const [input, options] = addFiles.mock.calls[0];
    expect(options.ocrMode).toBe('full');
    expect(input.files).toHaveLength(1);
    expect(input.files[0].raw).toBeInstanceOf(File);
    expect(input.files[0].name).toBe('Договір.docx');
    // add_as_is вхід несе module/conversionContext для converterService.
    expect(input.module).toBeTruthy();
    expect(input.conversionContext).toBeTruthy();
  });

  it('toggle ON + «без OCR» + DOCX → ocrMode:none (без Vision)', async () => {
    const addFiles = vi.fn().mockResolvedValue({
      ok: true, documents: [{ id: 'd1', name: 'Договір' }], files: [], errors: [],
    });
    const { container } = renderDP({ addFiles });

    const fileInput = container.querySelector('input[type="file"]');
    const docx = new File([new Uint8Array([1, 2, 3])], 'Договір.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [docx] } });
    });
    // A2: просто-додати — дефолт; «Без розпізнавання тексту» доступний без нарізки
    // (disabled лише коли «Нарізати том» ON).
    await act(async () => {
      fireEvent.click(screen.getByText('Без розпізнавання тексту'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Розпочати обробку/ }));
    });

    expect(addFiles).toHaveBeenCalledTimes(1);
    const [, options] = addFiles.mock.calls[0];
    expect(options.ocrMode).toBe('none');
  });

  it('дефолт (просто-додати) + all-PDF + повний OCR → addFiles (НЕ нарізка), ocrMode full', async () => {
    // A2: просто-додати = ДЕФОЛТ (тумблер «Нарізати том» OFF) → ЗАВЖДИ простий
    // додаток без нарізки. all-PDF+повний OCR без увімкненої нарізки → addFiles,
    // кожен PDF цілим документом; pipeline.run НЕ викликається.
    const addFiles = vi.fn().mockResolvedValue({
      ok: true, documents: [{ id: 'd1', name: 'Позов.pdf' }], files: [], errors: [],
    });
    const run = vi.fn();
    const { container } = renderDP({ run, addFiles });

    const fileInput = container.querySelector('input[type="file"]');
    const pdf = new File([new Uint8Array([1, 2, 3])], 'позов.pdf', { type: 'application/pdf' });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [pdf] } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Розпочати обробку/ }));
    });

    expect(addFiles).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    const [, options] = addFiles.mock.calls[0];
    expect(options.ocrMode).toBe('full');
  });

  it('toggle ON + all-PDF + «без OCR» → addFiles з ocrMode:none (чистий PDF окремою лінією)', async () => {
    // Корінь повільності A: раніше чистий PDF з «без OCR» НЕ потрапляв в
    // add_as_is (умова вимагала НЕ-PDF) → ішов на нарізку. Тепер «без OCR»
    // маршрутизує будь-який вхід (вкл. чистий PDF) у addFiles.
    const addFiles = vi.fn().mockResolvedValue({
      ok: true, documents: [{ id: 'd1', name: 'Позов' }], files: [], errors: [],
    });
    const { container } = renderDP({ addFiles });

    const fileInput = container.querySelector('input[type="file"]');
    const pdf = new File([new Uint8Array([1, 2, 3])], 'позов.pdf', { type: 'application/pdf' });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [pdf] } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Без розпізнавання тексту'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Розпочати обробку/ }));
    });

    expect(addFiles).toHaveBeenCalledTimes(1);
    const [input, options] = addFiles.mock.calls[0];
    expect(options.ocrMode).toBe('none');        // без OCR
    expect(input.files).toHaveLength(1);
    expect(input.files[0].raw).toBeInstanceOf(File);
  });

  it('A2 ДЕФОЛТ — новий run без жодного тумблера → addFiles (просто-додати), НЕ нарізка', async () => {
    // Інверсія дефолту: стартовий стан DP = просто-додати. Без жодної взаємодії
    // з тумблерами один PDF → addFiles, pipeline.run НЕ викликається.
    const addFiles = vi.fn().mockResolvedValue({
      ok: true, documents: [{ id: 'd1', name: 'Позов' }], files: [], errors: [],
    });
    const run = vi.fn();
    const { container } = renderDP({ run, addFiles });

    const fileInput = container.querySelector('input[type="file"]');
    const pdf = new File([new Uint8Array([1, 2, 3])], 'позов.pdf', { type: 'application/pdf' });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [pdf] } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Розпочати обробку/ }));
    });

    expect(addFiles).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it('A2 двері нарізки — «Нарізати том» ON + об’ємний скан-PDF → pipeline.run (нарізка)', async () => {
    // Явний тумблер «Нарізати / склеїти» → стрім-шлях нарізки. Об’ємний
    // (≥1МБ) сканований PDF проходить ворота входу → pipeline.run, НЕ addFiles.
    const run = vi.fn().mockResolvedValue({ ok: true, documents: [], decisions: [], errors: [] });
    const addFiles = vi.fn();
    const { container } = renderDP({ run, addFiles });

    const fileInput = container.querySelector('input[type="file"]');
    const pdf = new File([new Uint8Array(1024 * 1024)], 'том.pdf', { type: 'application/pdf' });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [pdf] } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Нарізати / склеїти'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Розпочати обробку/ }));
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(addFiles).not.toHaveBeenCalled();
  });
});
