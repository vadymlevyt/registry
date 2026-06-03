// @vitest-environment jsdom
// V2-A1 — режим «Точний» у в'ювері: live з layout, без зберігання, без AI.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Layout читається з ocrService.getCachedLayout; конденсація — реальна
// layoutToMarkdownDraft (3.1, чиста). Spy на getCachedLayout перевіряє виклик.
const getCachedLayoutMock = vi.fn();
vi.mock('../../src/services/ocrService.js', () => ({
  getCachedText: vi.fn().mockResolvedValue(null),
  getCleanOrRawText: vi.fn().mockResolvedValue(null),
  getVariantMarkdown: vi.fn().mockResolvedValue(null),
  getDocumentText: vi.fn().mockResolvedValue(''),
  getCachedLayout: (...args) => getCachedLayoutMock(...args),
  localizeOcrError: vi.fn(code => code),
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
  id: 'doc_scan',
  name: 'Позов Брановського.pdf',
  procId: 'proc_main',
  category: 'pleading',
  author: 'ours',
  documentNature: 'scanned',
  isKey: false,
  driveId: 'drive_scan',
};

// Мінімальний layout у форматі { pages:[{ _text }] } — як getCachedLayout повертає.
const layoutFixture = {
  schemaVersion: 1,
  provider: 'documentai',
  pages: [
    { _text: 'ПОЗОВНА ЗАЯВА\n\nПозивач звертається до суду з вимогою.' },
  ],
};

beforeEach(() => {
  localStorage.clear();
  getCachedLayoutMock.mockReset();
});

describe('DocumentViewer — режим Точний (V2-A1)', () => {
  it('scanned з layout → з\'являється опція «Точний», клік рендерить текст з layout', async () => {
    getCachedLayoutMock.mockResolvedValue(layoutFixture);

    render(<DocumentViewer document={scannedDoc} caseData={baseCase} />);

    // Опція з'являється після проби layout.
    const exactTab = await screen.findByRole('tab', { name: /Точний/ });
    expect(exactTab).toBeInTheDocument();
    // getCachedLayout викликано з file-контрактом (driveId + subFolders).
    expect(getCachedLayoutMock).toHaveBeenCalled();
    const fileArg = getCachedLayoutMock.mock.calls[0][0];
    expect(fileArg.id).toBe('drive_scan');
    expect(fileArg.subFolders['02_ОБРОБЛЕНІ']).toBe('folder_proc');

    // Клік → рендер тексту з layout через MarkdownRenderer (дослівний зміст).
    fireEvent.click(exactTab);
    expect(await screen.findByText(/Позивач звертається до суду/)).toBeInTheDocument();
    // Скан + AI-режими доступні; «Текст» прибрано (V2-B).
    expect(screen.getByRole('tab', { name: /Скан/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Чистий/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Конспект/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^Текст$/ })).toBeNull();
  });

  it('searchable документ → проба layout не запускається, опції «Точний» немає', async () => {
    getCachedLayoutMock.mockResolvedValue(layoutFixture);

    render(
      <DocumentViewer
        document={{ ...scannedDoc, documentNature: 'searchable' }}
        caseData={baseCase}
      />
    );

    await waitFor(() => {
      expect(getCachedLayoutMock).not.toHaveBeenCalled();
    });
    expect(screen.queryByRole('tab', { name: /Точний/ })).toBeNull();
  });

  it('scanned без layout (null) → опція «Точний» прихована, Скан/Текст є', async () => {
    getCachedLayoutMock.mockResolvedValue(null);

    render(<DocumentViewer document={scannedDoc} caseData={baseCase} />);

    await waitFor(() => {
      expect(getCachedLayoutMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole('tab', { name: /Точний/ })).toBeNull();
    expect(screen.getByRole('tab', { name: /Скан/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Чистий/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Конспект/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^Текст$/ })).toBeNull();
  });

  it('помилка getCachedLayout → опція прихована, в\'ювер не падає', async () => {
    getCachedLayoutMock.mockRejectedValue(new Error('drive 401'));

    render(<DocumentViewer document={scannedDoc} caseData={baseCase} />);

    await waitFor(() => {
      expect(getCachedLayoutMock).toHaveBeenCalled();
    });
    // В'ювер рендериться (заголовок видно), опції Точний нема.
    expect(screen.getByText('Позов Брановського.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Точний/ })).toBeNull();
  });
});
