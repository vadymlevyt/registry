// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DocumentViewer, buildViewerTabs } from '../../src/components/DocumentViewer/index.jsx';

vi.mock('../../src/services/ocrService.js', () => ({
  getCachedText: vi.fn().mockResolvedValue(null),
  getCleanOrRawText: vi.fn().mockResolvedValue(null),
  getVariantMarkdown: vi.fn().mockResolvedValue(null),
  getDocumentText: vi.fn().mockResolvedValue(''),
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

  it('searchable документ → перемикач [Документ][Конспект] (V2-B), без Скан/Текст', () => {
    render(<DocumentViewer document={baseDoc} caseData={baseCase} />);
    expect(screen.getByRole('tab', { name: /Документ/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Конспект/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^Скан$/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: /^Текст$/ })).toBeNull();
  });

  it('scanned документ → перемикач [Скан][Чистий][Конспект] (без layout — без Точного), без Текст', () => {
    render(
      <DocumentViewer
        document={{ ...baseDoc, documentNature: 'scanned' }}
        caseData={baseCase}
      />
    );
    expect(screen.getByRole('tab', { name: /Скан/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Чистий/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Конспект/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^Текст$/ })).toBeNull();
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

  it('перемикання scanned → Конспект зберігається в localStorage (digest)', () => {
    const scanned = { ...baseDoc, documentNature: 'scanned' };
    render(<DocumentViewer document={scanned} caseData={baseCase} />);
    fireEvent.click(screen.getByRole('tab', { name: /Конспект/ }));
    expect(localStorage.getItem('viewer_mode_doc_1')).toBe('digest');
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

describe('buildViewerTabs (V2-B — набір вкладок)', () => {
  const values = tabs => tabs.map(t => t.value);

  it('scanned без layout/variants → [Скан][Чистий][Конспект], без exact/text', () => {
    const tabs = buildViewerTabs({ isScanned: true, exactReady: false, variants: null });
    expect(values(tabs)).toEqual(['scan', 'clean', 'digest']);
    expect(values(tabs)).not.toContain('text');
    expect(values(tabs)).not.toContain('exact');
    // AI-маркери на clean/digest; badge на digest.
    expect(tabs.find(t => t.value === 'clean').ai).toBe(true);
    expect(tabs.find(t => t.value === 'digest').badge).toBe('переказ');
  });

  it('scanned + exactReady → з\'являється Точний (між Скан і Чистий)', () => {
    const tabs = buildViewerTabs({ isScanned: true, exactReady: true, variants: null });
    expect(values(tabs)).toEqual(['scan', 'exact', 'clean', 'digest']);
  });

  it('variants позначають готовність AI-вкладок (ready)', () => {
    const tabs = buildViewerTabs({
      isScanned: true,
      exactReady: false,
      variants: { clean: '2026-06-03T00:00:00Z', digest: null },
    });
    expect(tabs.find(t => t.value === 'clean').ready).toBe(true);
    expect(tabs.find(t => t.value === 'digest').ready).toBe(false);
  });

  it('searchable → [Документ][Конспект]; без Скан/Точний/Чистий/Текст', () => {
    const tabs = buildViewerTabs({ isScanned: false, exactReady: false, variants: { digest: 'ts' } });
    expect(values(tabs)).toEqual(['scan', 'digest']);
    expect(tabs[0].label).toBe('Документ');
    expect(tabs.find(t => t.value === 'digest').ready).toBe(true);
    // Жодного Чистого/Точного для searchable (нема OCR-сміття/layout).
    expect(values(tabs)).not.toContain('clean');
    expect(values(tabs)).not.toContain('exact');
    expect(values(tabs)).not.toContain('text');
  });

  it('жоден набір не містить старого режиму «text»', () => {
    const scanned = buildViewerTabs({ isScanned: true, exactReady: true, variants: { clean: 'a', digest: 'b' } });
    const searchable = buildViewerTabs({ isScanned: false, exactReady: false, variants: null });
    expect(values(scanned)).not.toContain('text');
    expect(values(searchable)).not.toContain('text');
  });
});
