// @vitest-environment jsdom
// TASK 4 · етап D (фоллов-ап швидкість) — «без OCR» (ocrMode='none') у add_as_is.
// Перевіряємо, що Vision-метадані читаються з ЛОКАЛЬНОГО блоба (файл уже в
// памʼяті add-флоу), а НЕ повторно завантажуються з Drive: extractMetadata
// отримує ocrFile.localBlob (instanceof Blob) із того самого файлу.
import { describe, it, expect, vi } from 'vitest';

// extractMetadata/canVisionMetadata — для шляху «без OCR». Решта — як у
// runAddAsIs.test.jsx (щоб модуль контексту імпортувався без мережі/Drive).
// vi.hoisted — щоб mock-фабрика (теж піднята) бачила цей шпигун.
const { extractMetadata } = vi.hoisted(() => ({
  extractMetadata: vi.fn(async () => ({
    date: '2026-01-15', category: 'motion', author: 'court', name: 'Ухвала', gist: null,
  })),
}));
vi.mock('../../src/services/ocrService.js', () => ({
  extractText: vi.fn(async () => ({ text: '', pageStructure: null })),
  localizeOcrError: () => 'помилка',
  writeExtractedTextArtifact: vi.fn(async () => true),
  writeLayoutArtifact: vi.fn(async () => true),
  getCachedText: vi.fn(async () => null),
  hasOcrSupport: () => true,
  extractTextBatch: vi.fn(async () => []),
  extractMetadata,
  canVisionMetadata: () => true,
}));
vi.mock('../../src/services/converter/converterService.js', () => ({
  convertToPdf: vi.fn(async (file) => ({
    converter: 'passthrough',
    originalMime: 'application/pdf',
    pdfBlob: file,
    pdfName: (file?.name || 'doc').replace(/\.[^.]+$/, ''),
    originalName: file?.name || 'doc',
    originalBlob: null,
    extractedText: null,
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
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type });
}

describe('runAddAsIs «без OCR» — Vision з локального блоба (без re-download)', () => {
  it('ocrMode=none → extractMetadata отримує ocrFile.localBlob (Blob), не Drive id-only', async () => {
    const executeAction = vi.fn(async () => ({ success: true }));
    let api;
    function Capture() { api = useDocumentPipeline(); return null; }
    render(
      <DocumentPipelineProvider executeAction={executeAction}>
        <Capture />
      </DocumentPipelineProvider>,
    );

    const caseData = { id: 'case_d', storage: { subFolders: { '01_ОРИГІНАЛИ': 'f1' } } };
    await act(async () => {
      await api.ingestFiles(
        {
          caseId: 'case_d', caseData,
          agentId: 'document_processor_agent', source: 'manual', addedBy: 'user',
          files: [{ fileId: 'p1', raw: makeFile('позов.pdf', 'application/pdf'), name: 'позов.pdf' }],
        },
        // deferOcr НЕ передаємо → DP робить власний пост-крок; ocrMode='none' →
        // metadataEnrichAddAsIs (Vision-метадані без 02). uploadFile застублено.
        { mode: 'add_as_is', ocrMode: 'none', uploadFile: async () => 'drive_d' },
      );
    });

    expect(extractMetadata).toHaveBeenCalledTimes(1);
    const ocrFile = extractMetadata.mock.calls[0][0];
    expect(ocrFile.id).toBe('drive_d');                 // Drive id присутній (fallback-шлях)
    expect(ocrFile.localBlob).toBeInstanceOf(Blob);     // але байти беруться з памʼяті
  });
});
