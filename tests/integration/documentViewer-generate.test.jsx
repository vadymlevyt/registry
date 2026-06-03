// @vitest-environment jsdom
// V2-B — генерація AI-варіантів на вимогу у в'ювері. Перевіряє КРИТИЧНУ вимогу:
// перемикання на AI-таб НЕ запускає AI; генерація стартує ВИКЛЮЧНО по кнопці
// «Згенерувати». На успіх variants оновлюється → показ .md; деградація → toast.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';

const getVariantMarkdownMock = vi.fn();
vi.mock('../../src/services/ocrService.js', () => ({
  getCachedText: vi.fn().mockResolvedValue(null),
  getCleanOrRawText: vi.fn().mockResolvedValue(null),
  getDocumentText: vi.fn().mockResolvedValue(''),
  getVariantMarkdown: (...args) => getVariantMarkdownMock(...args),
  getCachedLayout: vi.fn().mockResolvedValue(null),
  localizeOcrError: vi.fn(c => c),
}));
vi.mock('../../src/services/driveAuth.js', () => ({
  driveRequest: vi.fn(),
  forceConsentRefresh: vi.fn(),
}));

import { DocumentViewer } from '../../src/components/DocumentViewer/index.jsx';

const baseCase = {
  id: 'case_1',
  proceedings: [{ id: 'proc_main', type: 'first', title: 'Перша інстанція' }],
  storage: { subFolders: { '02_ОБРОБЛЕНІ': 'folder_proc' } },
};

const scannedDoc = {
  id: 'doc_gen',
  name: 'Позов.pdf',
  procId: 'proc_main',
  documentNature: 'scanned',
  driveId: 'drive_gen',
  variants: { clean: null, digest: null },
};

// Обгортка ≈ CaseDossier: тримає document у state, onGenerateVariant кличе
// executeAction-спай і на успіх оновлює variants (як handleGenerateVariant).
function ViewerHarness({ executeAction, toast }) {
  const [doc, setDoc] = useState(scannedDoc);
  const onGenerateVariant = async (d, mode) => {
    const result = await executeAction('dossier_agent', 'clean_document_text', {
      caseId: baseCase.id,
      documentId: d.id,
      mode,
    });
    if (result?.success) {
      const cleanedAt = '2026-06-03T10:00:00Z';
      setDoc(prev => ({ ...prev, variants: { ...prev.variants, [mode]: cleanedAt } }));
      toast.success('ok');
    } else if (result?.degraded) {
      toast.warning('degraded');
    } else if (!result?.skipped) {
      toast.error('fail');
    }
    return result;
  };
  return (
    <DocumentViewer document={doc} caseData={baseCase} onGenerateVariant={onGenerateVariant} />
  );
}

beforeEach(() => {
  localStorage.clear();
  getVariantMarkdownMock.mockReset();
  getVariantMarkdownMock.mockResolvedValue('# Конспект документа');
});

describe('DocumentViewer — генерація на вимогу (V2-B)', () => {
  it('🔴 перемикання на Конспект НЕ запускає AI; кнопка «Згенерувати» запускає', async () => {
    const executeAction = vi.fn().mockResolvedValue({ success: true, attentionNotes: [] });
    const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };

    render(<ViewerHarness executeAction={executeAction} toast={toast} />);

    // 1. Перемикання на незгенерований Конспект — AI НЕ викликається.
    fireEvent.click(screen.getByRole('tab', { name: /Конспект/ }));
    expect(await screen.findByText(/ще не створено/)).toBeInTheDocument();
    expect(executeAction).not.toHaveBeenCalled();

    // 2. Кнопка «Згенерувати» → executeAction(clean_document_text, mode=digest).
    fireEvent.click(screen.getByRole('button', { name: /Згенерувати/ }));
    await waitFor(() => expect(executeAction).toHaveBeenCalledTimes(1));
    expect(executeAction).toHaveBeenCalledWith(
      'dossier_agent',
      'clean_document_text',
      expect.objectContaining({ documentId: 'doc_gen', mode: 'digest' })
    );

    // 3. variants оновився → показ .md (MarkdownRenderer).
    expect(await screen.findByText(/Конспект документа/)).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalled();
  });

  it('Чистий передає mode=clean у clean_document_text', async () => {
    const executeAction = vi.fn().mockResolvedValue({ success: true, attentionNotes: [] });
    const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };

    render(<ViewerHarness executeAction={executeAction} toast={toast} />);

    fireEvent.click(screen.getByRole('tab', { name: /Чистий/ }));
    expect(executeAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Згенерувати/ }));
    await waitFor(() => expect(executeAction).toHaveBeenCalledTimes(1));
    expect(executeAction.mock.calls[0][2].mode).toBe('clean');
  });

  it('деградація (ok:false) → toast, таб лишається у стані «Згенерувати»', async () => {
    const executeAction = vi.fn().mockResolvedValue({ success: false, degraded: true, warning: 'обрізало' });
    const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };

    render(<ViewerHarness executeAction={executeAction} toast={toast} />);

    fireEvent.click(screen.getByRole('tab', { name: /Конспект/ }));
    fireEvent.click(screen.getByRole('button', { name: /Згенерувати/ }));

    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    // variants НЕ оновився → таб лишається заглушкою з кнопкою «Згенерувати».
    expect(await screen.findByText(/ще не створено/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Згенерувати/ })).toBeInTheDocument();
  });

  it('згенерований варіант → перемикання показує .md БЕЗ повторного AI', async () => {
    const executeAction = vi.fn().mockResolvedValue({ success: true, attentionNotes: [] });
    const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };

    // Документ уже має digest-варіант → одразу ready.
    function ReadyHarness() {
      const doc = { ...scannedDoc, variants: { clean: null, digest: '2026-06-03T10:00:00Z' } };
      return <DocumentViewer document={doc} caseData={baseCase} onGenerateVariant={() => executeAction()} />;
    }
    render(<ReadyHarness />);

    fireEvent.click(screen.getByRole('tab', { name: /Конспект/ }));
    // Готовий → одразу .md, без кнопки «Згенерувати», без executeAction.
    expect(await screen.findByText(/Конспект документа/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Згенерувати/ })).toBeNull();
    expect(executeAction).not.toHaveBeenCalled();
  });
});
