// @vitest-environment jsdom
// TASK 4 · етап C — runAddAsIs (non-streaming труба «просто додати») через
// DocumentPipelineProvider.ingestFiles({ mode:'add_as_is' }). Перевіряємо:
// конверт→persist→emit per file, persist через executeAction add_documents,
// дефолтні канонічні метадані, deferOcr пропускає OCR-enrich.
import { describe, it, expect, vi } from 'vitest';
vi.mock('../../src/services/ocrService.js', () => ({
  extractText: vi.fn(async () => ({ text: '', pageStructure: null })),
  localizeOcrError: () => 'помилка',
  writeExtractedTextArtifact: vi.fn(async () => true),
  writeLayoutArtifact: vi.fn(async () => true),
  getCachedText: vi.fn(async () => null),
  hasOcrSupport: () => true,
  extractTextBatch: vi.fn(async () => []),
}));
vi.mock('../../src/services/converter/converterService.js', () => ({
  convertToPdf: vi.fn(async (file) => ({
    converter: file?.type === 'application/pdf' ? 'passthrough' : 'docxToPdf',
    originalMime: file?.type || 'application/pdf',
    pdfBlob: file,
    pdfName: (file?.name || 'doc').replace(/\.[^.]+$/, ''),
    originalName: file?.name || 'doc',
    originalBlob: null,
    extractedText: file?.type === 'application/pdf' ? null : 'витягнутий текст',
    warnings: [],
  })),
  convertImagesToPdf: vi.fn(),
  CONVERT_DOCX_TO_PDF: true,
}));
import { render, act } from '@testing-library/react';
import {
  DocumentPipelineProvider, useDocumentPipeline,
} from '../../src/contexts/DocumentPipelineContext.jsx';

function makeFile(name, type) {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe('runAddAsIs (add_as_is труба)', () => {
  it('persist через document_processor_agent/add_documents + дефолтні метадані; deferOcr пропускає OCR', async () => {
    const executeAction = vi.fn(async (agent, action) => ({ success: true }));
    let api;
    function Capture() { api = useDocumentPipeline(); return null; }
    render(
      <DocumentPipelineProvider executeAction={executeAction}>
        <Capture />
      </DocumentPipelineProvider>,
    );

    const caseData = { id: 'case_x', storage: { subFolders: { '01_ОРИГІНАЛИ': 'folder1', '02_ОБРОБЛЕНІ': 'folder2' } } };
    let res;
    await act(async () => {
      res = await api.ingestFiles(
        {
          caseId: 'case_x', caseData,
          agentId: 'document_processor_agent', source: 'manual', addedBy: 'user',
          files: [{ fileId: 'f1', raw: makeFile('Договір.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), name: 'Договір.docx' }],
        },
        // uploadFile застублено → без реального driveService. deferOcr=true →
        // OCR-enrich пропускається (інакше потягне ocrService write-и).
        { mode: 'add_as_is', deferOcr: true, uploadFile: async () => 'drive_1' },
      );
    });

    expect(res.ok).toBe(true);
    expect(res.documents).toHaveLength(1);
    const persistCall = executeAction.mock.calls.find((c) => c[1] === 'add_documents');
    expect(persistCall).toBeTruthy();
    expect(persistCall[0]).toBe('document_processor_agent');
    const doc = persistCall[2].documents[0];
    expect(doc.name).toBe('Договір');                    // ім'я без розширення
    expect(doc.driveId).toBe('drive_1');
    expect(doc.documentNature).toBe('searchable');       // DOCX-конвертер → searchable
    expect(doc.folder).toBe('01_ОРИГІНАЛИ');
    expect(doc.source).toBe('manual');
  });

  it('кілька файлів за раз (комбо) → кілька документів, кожен окремо', async () => {
    const executeAction = vi.fn(async () => ({ success: true }));
    let api;
    function Capture() { api = useDocumentPipeline(); return null; }
    render(
      <DocumentPipelineProvider executeAction={executeAction}>
        <Capture />
      </DocumentPipelineProvider>,
    );
    const caseData = { id: 'case_y', storage: { subFolders: { '01_ОРИГІНАЛИ': 'f1' } } };
    let res;
    await act(async () => {
      res = await api.ingestFiles(
        {
          caseId: 'case_y', caseData, agentId: 'document_processor_agent', source: 'manual', addedBy: 'user',
          files: [
            { fileId: 'a', raw: makeFile('позов.pdf', 'application/pdf'), name: 'позов.pdf' },
            { fileId: 'b', raw: makeFile('довідка.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), name: 'довідка.docx' },
          ],
        },
        { mode: 'add_as_is', deferOcr: true, uploadFile: async () => 'drv' },
      );
    });
    expect(res.ok).toBe(true);
    expect(res.documents).toHaveLength(2);
    const persists = executeAction.mock.calls.filter((c) => c[1] === 'add_documents');
    expect(persists).toHaveLength(2);  // кожен файл — окремий add_documents
  });
});
