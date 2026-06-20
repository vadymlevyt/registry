// @vitest-environment jsdom
//
// Борг #34 (фото-частина): під час важкої фото-обробки image-merge у
// DocumentProcessorV2 показується видимий повноекранний ProcessingProgress
// (prepare → grouper → sort), а не лише console.log. Перевіряємо, що оверлей
// зʼявляється поки prepareImagesForMerge у роботі і зникає після завершення.

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

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  group: vi.fn(),
  sort: vi.fn(),
}));
vi.mock('../../src/services/imageDocument/prepareImagesForMerge.js', () => ({
  prepareImagesForMerge: mocks.prepare,
}));
vi.mock('../../src/services/sortation/imageDocumentGrouper.js', () => ({
  groupImagesIntoDocuments: mocks.group,
}));
vi.mock('../../src/services/imageDocument/sortImageDocument.js', () => ({
  sortImageDocument: mocks.sort,
}));

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { DocumentPipelineContext } from '../../src/contexts/DocumentPipelineContext.jsx';
import DocumentProcessorV2 from '../../src/components/DocumentProcessorV2/index.jsx';

const CASE = { id: 'case_im', name: 'Справа', storage: { subFolders: {} }, proceedings: [] };

beforeEach(() => {
  mocks.prepare.mockReset();
  mocks.group.mockReset();
  mocks.sort.mockReset();
  if (!global.URL.createObjectURL) global.URL.createObjectURL = vi.fn(() => 'blob:x');
  if (!global.URL.revokeObjectURL) global.URL.revokeObjectURL = vi.fn();
});

function ctx() {
  return {
    run: vi.fn(), cancel: vi.fn(), resume: vi.fn(), keepPartial: vi.fn(), discardAll: vi.fn(),
    ecitsPending: {}, expandProgress: vi.fn(), minimizeProgress: vi.fn(),
  };
}

describe('DP image-merge — видимий прогрес важкої фото-обробки (#34)', () => {
  it('оверлей ProcessingProgress зʼявляється під час prepare і зникає після завершення', async () => {
    let capturedFiles = null;
    let resolvePrepare;
    mocks.prepare.mockImplementation((files, opts) => {
      capturedFiles = files;
      // Емітимо фазу прогресу синхронно — оверлей має показати «OCR · 1 / 3».
      opts?.onProgress?.('ocr', 1, 3);
      return new Promise((res) => { resolvePrepare = res; });
    });
    mocks.group.mockResolvedValue({
      groups: [{ pages: [0], type: null, suggestedName: 'Doc' }],
    });
    mocks.sort.mockResolvedValue(null);

    const { container } = render(
      <DocumentPipelineContext.Provider value={ctx()}>
        <DocumentProcessorV2 caseData={CASE} onExecuteAction={vi.fn()} driveConnected={false} />
      </DocumentPipelineContext.Provider>,
    );

    // Обираємо ФОТО (all-image вхід → image-merge сценарій).
    const fileInput = container.querySelector('input[type="file"]');
    const photo = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [photo] } });
    });

    // A2: склейка all-image живе в режимі нарізки (дефолт — просто-додати, де
    // all-image йде в addFiles). Вмикаємо «Нарізати том», щоб дійти до склейки.
    await act(async () => {
      fireEvent.click(screen.getByText('Нарізати том на документи'));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Розпочати обробку/ }));
    });

    // prepare ще у роботі → оверлей видимий з лічильником поточної фази.
    const overlay = container.querySelector('.image-editor__progress-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toMatch(/1 \/ 3/);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);

    // Завершуємо prepare → grouper → sort → редактор; оверлей зникає.
    await act(async () => {
      resolvePrepare({
        normalizedFiles: capturedFiles,
        ocrResults: capturedFiles.map(() => ({ text: '', pageStructure: null })),
        detectedOrientations: capturedFiles.map(() => 0),
        orientationDebug: capturedFiles.map(() => null),
        uncertainOrientationIndices: [],
        warnings: [],
      });
    });

    await waitFor(() =>
      expect(container.querySelector('.image-editor__progress-overlay')).toBeNull(),
    );
  });
});
