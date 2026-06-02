// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DocumentViewer } from '../../src/components/DocumentViewer/index.jsx';

vi.mock('../../src/services/ocrService.js', () => ({
  getCachedText: vi.fn().mockResolvedValue(null),
  getCleanOrRawText: vi.fn().mockResolvedValue(null),
  getCachedLayout: vi.fn().mockResolvedValue(null),
  localizeOcrError: vi.fn(code => code),
}));
vi.mock('../../src/services/driveAuth.js', () => ({
  driveRequest: vi.fn(),
  forceConsentRefresh: vi.fn(),
}));

const baseCase = {
  id: 'case_1',
  proceedings: [{ id: 'proc_main', type: 'first', title: 'Перша інстанція' }],
  storage: { subFolders: { '02_ОБРОБЛЕНІ': 'folder_proc' } },
};

const baseDoc = {
  id: 'doc_1',
  name: 'Позов.pdf',
  procId: 'proc_main',
  category: 'pleading',
  author: 'ours',
  documentNature: 'searchable',
  isKey: false,
  driveId: 'drive_abc',
};

beforeEach(() => {
  localStorage.clear();
});

describe('DocumentViewer', () => {
  it('document=null → empty state', () => {
    render(<DocumentViewer document={null} caseData={baseCase} />);
    expect(screen.getByText(/Оберіть документ/)).toBeInTheDocument();
  });

  it('searchable документ → перемикач прихований', () => {
    render(<DocumentViewer document={baseDoc} caseData={baseCase} />);
    expect(screen.queryByRole('tab', { name: /Скан/ })).toBeNull();
  });

  it('scanned документ → перемикач видимий', () => {
    render(
      <DocumentViewer
        document={{ ...baseDoc, documentNature: 'scanned' }}
        caseData={baseCase}
      />
    );
    expect(screen.getByRole('tab', { name: /Скан/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Текст/ })).toBeInTheDocument();
  });

  it('клік на ✕ викликає onClose', () => {
    const onClose = vi.fn();
    render(<DocumentViewer document={baseDoc} caseData={baseCase} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Закрити'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('клік на ⭐ викликає onUpdate з isKey:true', () => {
    const onUpdate = vi.fn();
    render(
      <DocumentViewer document={baseDoc} caseData={baseCase} onUpdate={onUpdate} />
    );
    fireEvent.click(screen.getByLabelText('Ключовий документ'));
    expect(onUpdate).toHaveBeenCalledWith('doc_1', { isKey: true });
  });

  it('перемикання scanned → text зберігається в localStorage', () => {
    const scanned = { ...baseDoc, documentNature: 'scanned' };
    render(<DocumentViewer document={scanned} caseData={baseCase} />);
    fireEvent.click(screen.getByRole('tab', { name: /Текст/ }));
    expect(localStorage.getItem('viewer_mode_doc_1')).toBe('text');
  });

  it('searchable PDF → власний PdfRenderer, перемикач прихований (text-плашка не потрібна)', () => {
    localStorage.setItem('viewer_mode_doc_1', 'text');
    const { container } = render(
      <DocumentViewer
        document={{ ...baseDoc, mimeType: 'application/pdf' }}
        caseData={baseCase}
      />
    );
    // Searchable PDF тепер рендериться власним PdfRenderer (canvas + textLayer
    // для нативного виділення), а не Drive iframe. У тестовому середовищі
    // driveRequest замокано без response — рендерер показує "Завантаження PDF..."
    // або empty state. Drive iframe не повинен з'явитися.
    expect(container.querySelector('iframe.document-viewer__iframe')).toBeNull();
    expect(screen.queryByRole('tab', { name: /Скан/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: /Текст/ })).toBeNull();
  });

  it('legacy PDF без documentNature → ефективна природа scanned, видно перемикач', () => {
    const legacy = { ...baseDoc, documentNature: undefined, name: 'doc.pdf', mimeType: 'application/pdf' };
    render(<DocumentViewer document={legacy} caseData={baseCase} />);
    expect(screen.getByRole('tab', { name: /Скан/ })).toBeInTheDocument();
  });

  it('legacy без documentNature з .png іменем → автоматично scanned і fire-and-forget update', () => {
    const onUpdate = vi.fn();
    const legacy = { ...baseDoc, documentNature: undefined, name: 'photo.png' };
    render(<DocumentViewer document={legacy} caseData={baseCase} onUpdate={onUpdate} />);
    // Інференція впевнена → одразу onUpdate з documentNature:'scanned'
    expect(onUpdate).toHaveBeenCalledWith('doc_1', { documentNature: 'scanned' });
  });

  it('кнопка кошика 🗑 показується якщо передано onDelete', () => {
    const onDelete = vi.fn();
    render(<DocumentViewer document={baseDoc} caseData={baseCase} onDelete={onDelete} />);
    const trash = screen.getByLabelText('Видалити');
    expect(trash).toBeInTheDocument();
    fireEvent.click(trash);
    expect(onDelete).toHaveBeenCalled();
  });

  it('кнопка кошика прихована якщо onDelete не передано', () => {
    render(<DocumentViewer document={baseDoc} caseData={baseCase} />);
    expect(screen.queryByLabelText('Видалити')).toBeNull();
  });
});
