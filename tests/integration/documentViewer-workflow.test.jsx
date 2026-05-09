// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../src/services/ocrService.js', () => ({
  getCachedText: vi.fn().mockResolvedValue(null),
  localizeOcrError: vi.fn(c => c),
}));
vi.mock('../../src/services/driveAuth.js', () => ({
  driveRequest: vi.fn(),
  forceConsentRefresh: vi.fn(),
}));

import { DocumentViewer } from '../../src/components/DocumentViewer/index.jsx';

const caseData = {
  id: 'case_1',
  proceedings: [
    { id: 'proc_main', type: 'first', title: 'Перша інстанція' },
    { id: 'proc_app', type: 'appeal', title: 'Апеляція' },
  ],
  storage: { subFolders: { '02_ОБРОБЛЕНІ': 'folder_proc' } },
};

beforeEach(() => {
  localStorage.clear();
});

describe('DocumentViewer workflow', () => {
  it('повний шлях: відкриття → ⭐ → перемикач → закриття', () => {
    const onUpdate = vi.fn();
    const onClose = vi.fn();
    const document = {
      id: 'doc_42',
      name: 'Скан рішення.pdf',
      procId: 'proc_main',
      category: 'court_act',
      author: 'court',
      documentNature: 'scanned',
      isKey: false,
      driveId: 'drive_42',
    };

    render(
      <DocumentViewer
        document={document}
        caseData={caseData}
        onUpdate={onUpdate}
        onClose={onClose}
      />
    );

    // 1. Default mode = scan для scanned
    expect(screen.getByRole('tab', { name: /Скан/ })).toHaveAttribute('aria-selected', 'true');

    // 2. ⭐ → onUpdate з isKey: true
    fireEvent.click(screen.getByLabelText('Ключовий документ'));
    expect(onUpdate).toHaveBeenCalledWith('doc_42', { isKey: true });

    // 3. Перемикач на Текст → збереження в localStorage
    fireEvent.click(screen.getByRole('tab', { name: /Текст/ }));
    expect(localStorage.getItem('viewer_mode_doc_42')).toBe('text');

    // 4. Закриття
    fireEvent.click(screen.getByLabelText('Закрити'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Перерозпізнати викликає onReprocess з документом', () => {
    const onReprocess = vi.fn();
    const document = {
      id: 'doc_x',
      name: 'Скан.pdf',
      procId: 'proc_main',
      documentNature: 'scanned',
      driveId: 'drive_x',
    };

    render(
      <DocumentViewer
        document={document}
        caseData={caseData}
        onReprocess={onReprocess}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Перерозпізнати/ }));
    expect(onReprocess).toHaveBeenCalledWith(document);
  });

  it('searchable документ — режим text, перемикача немає', () => {
    const document = {
      id: 'doc_search',
      name: 'Позов.docx',
      procId: 'proc_app',
      documentNature: 'searchable',
      driveId: 'drive_s',
    };

    render(<DocumentViewer document={document} caseData={caseData} />);

    expect(screen.queryByRole('tab', { name: /Скан/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: /Текст/ })).toBeNull();
    // Виведено мітку провадження
    expect(screen.getByText(/Апеляція/)).toBeInTheDocument();
  });

  it('localStorage LRU — обмежено 100 ключами (через saveModePreference напряму)', async () => {
    const { saveModePreference } = await import('../../src/components/DocumentViewer/index.jsx');
    for (let i = 0; i < 105; i++) {
      saveModePreference(`doc_${i}`, 'text');
    }
    const indexRaw = localStorage.getItem('viewer_mode_index');
    const index = JSON.parse(indexRaw);
    expect(index.length).toBeLessThanOrEqual(100);
    // Найдавніші витіснені
    expect(localStorage.getItem('viewer_mode_doc_0')).toBeNull();
    // Найновіші збережені
    expect(localStorage.getItem('viewer_mode_doc_104')).toBe('text');
  });
});
