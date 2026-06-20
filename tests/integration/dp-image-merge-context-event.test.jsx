// @vitest-environment jsdom
//
// TASK DP context fixes #5 — фото-шлях (image-merge) публікує
// DOCUMENT_BATCH_PROCESSED після add_documents, щоб для ФОТО теж спрацював
// слухач контексту у CaseDossier (оновлення нарису + сигнал). До фіксу
// image-merge обходив pipeline.run → emitStage НЕ публікував подію → контекст
// для фото мовчки не оновлювався.
//
// Перевіряємо РЕАЛЬНИЙ код-шлях handleImageMergeSubmit (DocumentProcessorV2):
// монтуємо DP, входимо в image-merge режим (важкі image-залежності
// замоковані), мок-редактор тригерить onSubmit → asserts eventBus.publish.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Важкі image/Drive/OCR залежності — стаби (нас цікавить лише publish події).
vi.mock('../../src/services/imageDocument/prepareImagesForMerge.js', () => ({
  prepareImagesForMerge: vi.fn(async (files) => ({
    normalizedFiles: files,
    ocrResults: files.map((f) => ({ text: `ocr ${f.name}` })),
    detectedOrientations: [],
  })),
}));
vi.mock('../../src/services/sortation/imageDocumentGrouper.js', () => ({
  groupImagesIntoDocuments: vi.fn(async () => ({
    groups: [{ pages: [0, 1], type: 'pleading', suggestedName: 'Ухвала' }],
    fallback: false,
  })),
}));
vi.mock('../../src/services/imageDocument/pdfRebuild.js', () => ({
  rebuildFromOcrResults: vi.fn(async () => ({
    pdfBlob: new Blob([new Uint8Array([1, 2, 3])], { type: 'application/pdf' }),
    extractedText: 'текст документа',
    layoutJson: null,
  })),
}));
vi.mock('../../src/services/driveService.js', () => ({
  readDriveFileBytes: vi.fn(async () => new Uint8Array()),
  findOrCreateFolder: vi.fn(async () => ({ id: 'orig_id' })),
  uploadBytesToDrive: vi.fn(async () => ({ id: 'drive_new' })),
}));
vi.mock('../../src/services/ocrService.js', () => ({
  writeExtractedTextArtifact: vi.fn(async () => true),
  writeLayoutArtifact: vi.fn(async () => true),
  extractText: vi.fn(async () => ({ text: '' })),
  localizeOcrError: () => 'помилка',
}));
vi.mock('../../src/services/documentFactory.js', () => ({
  createDocument: vi.fn((m) => ({ id: `doc_${m.name}`, ...m })),
}));
vi.mock('../../src/services/sortation/imageSortingAgent.js', () => ({
  ensureUniqueName: (base) => base,
}));

// Мок-редактор: одразу дає кнопку «submit», яка кличе handleImageMergeSubmit
// (onSubmit) з мінімальними аргументами (groups з pageIndices, pre з props).
vi.mock('../../src/components/DocumentProcessorV2/DpImageMergeEditor.jsx', () => ({
  DpImageMergeEditor: ({ pre, initialGroups, onSubmit }) => (
    <button
      type="button"
      data-testid="do-submit"
      onClick={() => onSubmit({
        groups: (initialGroups || []).map((g) => ({
          pageIndices: g.pages, name: g.suggestedName, type: g.type,
          author: null, procId: null, date: null, isKey: false,
        })),
        userRotation: {}, cropOverrides: {}, cropProposals: {},
        cropDisabled: {}, cropAppliedSet: new Set(), processedBlobs: {}, pre,
      })}
    >submit</button>
  ),
}));

import { render, screen, fireEvent, act } from '@testing-library/react';
import { DocumentPipelineContext } from '../../src/contexts/DocumentPipelineContext.jsx';
import DocumentProcessorV2 from '../../src/components/DocumentProcessorV2/index.jsx';
import * as eventBus from '../../src/services/eventBus.js';
import { DOCUMENT_BATCH_PROCESSED } from '../../src/services/eventBusTopics.js';

const CASE = {
  id: 'case_dp_im',
  name: 'Справа фото',
  storage: { driveFolderId: 'root_id', subFolders: { '01_ОРИГІНАЛИ': 'orig_id' } },
  documents: [],
};

const PIPELINE_CTX = {
  run: vi.fn(), cancel: vi.fn(), resume: vi.fn(), keepPartial: vi.fn(),
  discardAll: vi.fn(), ecitsPending: {},
  expandProgress: vi.fn(), minimizeProgress: vi.fn(),
};

async function enterMergeAndSubmit(onExecuteAction) {
  const { container } = render(
    <DocumentPipelineContext.Provider value={PIPELINE_CTX}>
      <DocumentProcessorV2 caseData={CASE} onExecuteAction={onExecuteAction} driveConnected={false} />
    </DocumentPipelineContext.Provider>,
  );
  // Вибрати 2 фото → all-image вхід. A2: склейка живе в режимі нарізки (дефолт —
  // просто-додати, де all-image йде в addFiles) → вмикаємо «Нарізати том».
  const fileInput = container.querySelector('input[type="file"]');
  const f1 = new File([new Uint8Array([1])], 'p1.jpg', { type: 'image/jpeg' });
  const f2 = new File([new Uint8Array([2])], 'p2.jpg', { type: 'image/jpeg' });
  await act(async () => { fireEvent.change(fileInput, { target: { files: [f1, f2] } }); });
  await act(async () => { fireEvent.click(screen.getByText('Нарізати / склеїти')); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Розпочати обробку/ })); });
  // Тепер у image-merge режимі — мок-редактор дав кнопку submit.
  await act(async () => { fireEvent.click(screen.getByTestId('do-submit')); });
}

describe('TASK DP context fixes #5 — image-merge публікує DOCUMENT_BATCH_PROCESSED', () => {
  beforeEach(() => { eventBus.clear(); vi.clearAllMocks(); });

  it('після add_documents публікує подію з updateCaseContext (тумблер ON за дефолтом)', async () => {
    const received = [];
    eventBus.subscribe(DOCUMENT_BATCH_PROCESSED, (p) => received.push(p));
    const onExecuteAction = vi.fn(async () => ({ success: true }));

    await enterMergeAndSubmit(onExecuteAction);

    // add_documents справді викликано (фото додано)
    expect(onExecuteAction).toHaveBeenCalledWith(
      'document_processor_agent', 'add_documents',
      expect.objectContaining({ caseId: 'case_dp_im' }),
    );
    // подія опублікована тим самим топіком, який слухає CaseDossier
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      caseId: 'case_dp_im',
      updateCaseContext: true,   // дефолт тумблера DEFAULT_SETTINGS.updateCaseContext
      count: 1,
    });
    expect(Array.isArray(received[0].documentIds)).toBe(true);
  });

  it('не публікує якщо add_documents не вдалося (publish лише після успіху)', async () => {
    const received = [];
    eventBus.subscribe(DOCUMENT_BATCH_PROCESSED, (p) => received.push(p));
    const onExecuteAction = vi.fn(async () => ({ success: false, error: 'fail' }));

    await act(async () => {
      try { await enterMergeAndSubmit(onExecuteAction); } catch { /* handleImageMergeSubmit кидає */ }
    });

    expect(received).toHaveLength(0);
  });
});
