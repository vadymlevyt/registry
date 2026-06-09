// @vitest-environment jsdom
// ZIP-інгест ЄСІТС · інтеграція з Document Processor. Перевіряє: коли адвокат
// кидає ZIP у DP + вмикає «Просто додати», фронт-крок `unpackArchivesFrontStep`
// розгортає архів у складові файли, відкидає КЕП-підписи, і `pipeline.addFiles`
// отримує ПЛОСКИЙ список (а не ZIP як один файл). Сама розпаковка fflate
// мокається — ми тестуємо ДРОТУВАННЯ, не fflate (це покрите unit-тестами).
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

// Мокаємо фронт-крок цілком — у тесті не запускаємо fflate (це unit-тести).
// Стаб імітує ЄСІТС-ZIP: {2 PDF, 1 .p7s} → 2 PDF + signaturesDropped:1.
// isArchive — мінімальний (за розширенням .zip), щоб модальний guard теж міг
// імпортувати цей мок без розбіжностей.
const unpackArchivesFrontStep = vi.fn(async (files) => {
  const out = [];
  const report = { unpacked: [], signaturesDropped: 0, archivesKept: [] };
  for (const f of files) {
    if (/\.zip$/i.test(f?.name || '')) {
      out.push(new File([new Uint8Array([1])], 'esits_pozov.pdf', { type: 'application/pdf' }));
      out.push(new File([new Uint8Array([2])], 'esits_uhvala.pdf', { type: 'application/pdf' }));
      report.unpacked.push({ archive: f.name, entryCount: 2 });
      report.signaturesDropped += 1;
    } else if (/\.rar$/i.test(f?.name || '')) {
      out.push(f);
      report.archivesKept.push({ name: f.name, kind: 'rar' });
    } else {
      out.push(f);
    }
  }
  return { files: out, report };
});
vi.mock('../../src/services/addFiles/unpackArchivesFrontStep.js', () => ({
  unpackArchivesFrontStep: (...a) => unpackArchivesFrontStep(...a),
  isArchive: (name) => /\.(zip|rar|7z)$/i.test(String(name || '')),
  archiveKind: (name) => (/\.zip$/i.test(name) ? 'zip' : /\.rar$/i.test(name) ? 'rar' : null),
  isSignatureFile: () => false,
}));

import { render, screen, fireEvent, act } from '@testing-library/react';
import { DocumentPipelineContext } from '../../src/contexts/DocumentPipelineContext.jsx';
import DocumentProcessorV2 from '../../src/components/DocumentProcessorV2/index.jsx';
import * as store from '../../src/services/documentPipeline/jobProgressStore.js';

const CASE = { id: 'case_zip', name: 'Справа ZIP-інгест', storage: { subFolders: {} } };

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

beforeEach(() => {
  store._resetForTests();
  unpackArchivesFrontStep.mockClear();
});

describe('DP-ZIP · фронт-крок розпакування ПЕРЕД addFiles', () => {
  it('кинув ZIP + «Просто додати» → addFiles отримав РОЗГОРНУТИЙ список (не ZIP)', async () => {
    const addFiles = vi.fn().mockResolvedValue({
      ok: true, documents: [{ id: 'd1', name: 'esits_pozov' }, { id: 'd2', name: 'esits_uhvala' }],
      files: [], errors: [],
    });
    const { container } = renderDP({ addFiles });

    const fileInput = container.querySelector('input[type="file"]');
    const zip = new File([new Uint8Array([1, 2, 3, 4])], 'esits_dispatch.zip', { type: 'application/zip' });
    await act(async () => { fireEvent.change(fileInput, { target: { files: [zip] } }); });
    await act(async () => { fireEvent.click(screen.getByText('Просто додати файли')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Розпочати обробку/ })); });

    // Фронт-крок викликаний ОДИН РАЗ на сирому списку File.
    expect(unpackArchivesFrontStep).toHaveBeenCalledTimes(1);
    const rawIn = unpackArchivesFrontStep.mock.calls[0][0];
    expect(rawIn).toHaveLength(1);
    expect(rawIn[0].name).toBe('esits_dispatch.zip');

    // addFiles отримав 2 файли з вмісту архіву (не ZIP як один файл).
    expect(addFiles).toHaveBeenCalledTimes(1);
    const [input] = addFiles.mock.calls[0];
    expect(input.files).toHaveLength(2);
    expect(input.files.map(f => f.name)).toEqual(['esits_pozov.pdf', 'esits_uhvala.pdf']);
    expect(input.files[0].raw).toBeInstanceOf(File);
    expect(input.files[0].originalMime).toBe('application/pdf');
  });

  it('мікс ZIP + окремий PDF → addFiles отримав розгорнуте + окремий PDF разом', async () => {
    const addFiles = vi.fn().mockResolvedValue({ ok: true, documents: [{ id: 'd' }], files: [], errors: [] });
    const { container } = renderDP({ addFiles });

    const fileInput = container.querySelector('input[type="file"]');
    const zip = new File([new Uint8Array([1])], 'esits.zip', { type: 'application/zip' });
    const pdf = new File([new Uint8Array([2])], 'standalone.pdf', { type: 'application/pdf' });
    await act(async () => { fireEvent.change(fileInput, { target: { files: [zip, pdf] } }); });
    await act(async () => { fireEvent.click(screen.getByText('Просто додати файли')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Розпочати обробку/ })); });

    expect(addFiles).toHaveBeenCalledTimes(1);
    const [input] = addFiles.mock.calls[0];
    expect(input.files.map(f => f.name)).toEqual(['esits_pozov.pdf', 'esits_uhvala.pdf', 'standalone.pdf']);
  });

  it('RAR → НЕ розпаковується, addFiles отримує RAR як один файл (як є)', async () => {
    const addFiles = vi.fn().mockResolvedValue({ ok: true, documents: [{ id: 'd' }], files: [], errors: [] });
    const { container } = renderDP({ addFiles });

    const fileInput = container.querySelector('input[type="file"]');
    const rar = new File([new Uint8Array([1])], 'esits.rar', { type: 'application/vnd.rar' });
    await act(async () => { fireEvent.change(fileInput, { target: { files: [rar] } }); });
    await act(async () => { fireEvent.click(screen.getByText('Просто додати файли')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Розпочати обробку/ })); });

    expect(unpackArchivesFrontStep).toHaveBeenCalledTimes(1);
    expect(addFiles).toHaveBeenCalledTimes(1);
    const [input] = addFiles.mock.calls[0];
    // RAR didn't unpack → input.files лишився оригінальним (з buildAddAsIsInput).
    expect(input.files).toHaveLength(1);
    expect(input.files[0].raw).toBeInstanceOf(File);
    expect(input.files[0].raw.name).toBe('esits.rar');
  });

  it('БЕЗ архівів (звичайний DOCX) → фронт-крок кликається, але input.files НЕ перебудовується', async () => {
    // Регрес-гард: коли didUnpack=false, ми НЕ перетираємо input.files з
    // buildAddAsIsInput (інакше втратимо mergeArtifacts/metadataTemplate з
    // інших гілок). Тут перевіряємо: ім'я і MIME лишилися від оригінального
    // DOCX-файлу, fileId — від buildAddAsIsInput (s.key='1'), не 'unpack_*'.
    const addFiles = vi.fn().mockResolvedValue({ ok: true, documents: [{ id: 'd' }], files: [], errors: [] });
    const { container } = renderDP({ addFiles });

    const fileInput = container.querySelector('input[type="file"]');
    const docx = new File([new Uint8Array([1])], 'Договір.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    await act(async () => { fireEvent.change(fileInput, { target: { files: [docx] } }); });
    await act(async () => { fireEvent.click(screen.getByText('Просто додати файли')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Розпочати обробку/ })); });

    expect(unpackArchivesFrontStep).toHaveBeenCalledTimes(1);
    expect(addFiles).toHaveBeenCalledTimes(1);
    const [input] = addFiles.mock.calls[0];
    expect(input.files).toHaveLength(1);
    expect(input.files[0].name).toBe('Договір.docx');
    expect(input.files[0].fileId).not.toMatch(/^unpack_/);    // не з гілки перебудови
  });
});
