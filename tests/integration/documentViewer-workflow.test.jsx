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

  it('DOCX (inline-renderable) — власний DocxRenderer, перемикача немає', () => {
    const document = {
      id: 'doc_search',
      name: 'Позов.docx',
      procId: 'proc_app',
      documentNature: 'searchable',
      driveId: 'drive_s',
    };

    const { container } = render(<DocumentViewer document={document} caseData={caseData} />);

    // DOCX рендериться через власний DocxRenderer (mammoth → HTML). Drive iframe
    // не використовується — Drive виставляє Google Docs preview що блокує
    // нативне виділення тексту.
    expect(container.querySelector('iframe.document-viewer__iframe')).toBeNull();
    expect(screen.queryByRole('tab', { name: /Скан/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: /Текст/ })).toBeNull();
    // Виведено мітку провадження
    expect(screen.getByText(/Апеляція/)).toBeInTheDocument();
  });

  it('Конвертований DOCX (driveId=PDF) — НЕ DocxRenderer, маршрут на PdfRenderer', () => {
    // Після TASK A driveId конвертованого DOCX вказує на render-PDF, а
    // originalName залишається з .docx розширенням. Раніше Viewer розпізнавав
    // це як DOCX за originalName, DocxRenderer кидав mammoth у PDF-блоб →
    // «Can't find end of central directory». Перевірка: за наявності
    // originalMime ≠ application/pdf маршрут іде на PDF.
    const document = {
      id: 'doc_conv',
      name: 'Позовна заява Кісельової',
      originalName: 'Позовна заява Кісельової.docx',
      originalMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      originalDriveId: 'drive_docx_orig',
      procId: 'proc_main',
      documentNature: 'searchable',
      driveId: 'drive_pdf_42',
    };

    const { container } = render(<DocumentViewer document={document} caseData={caseData} />);

    // PdfRenderer показує власний pdfjs viewer iframe — це канонічний рендер
    // після TASK A. DocxRenderer (який мав би помилку «central directory»)
    // НЕ викликається.
    // Drive fallback iframe не використовується; mammoth DocxRenderer теж не
    // викликається (інакше при невалідному PDF-як-DOCX побачили б empty state
    // «Не вдалось рендерити DOCX»). Замість цього — PdfRenderer показує свій
    // loading state «Завантаження PDF...» (useDriveFileBuffer мокнутий без
    // response, тому buffer лишається в loading-state).
    expect(container.querySelector('iframe.document-viewer__iframe')).toBeNull();
    expect(screen.queryByText(/Не вдалось рендерити DOCX/)).toBeNull();
    expect(screen.getByText(/Завантаження PDF/)).toBeInTheDocument();
  });

  it('Конвертований HTML (originalMime=text/html) — теж маршрут на PdfRenderer', () => {
    const document = {
      id: 'doc_html_conv',
      name: 'Ухвала з ЄСІТС',
      originalName: 'rishennia_2024.html',
      originalMime: 'text/html',
      originalDriveId: null,
      procId: 'proc_main',
      documentNature: 'searchable',
      driveId: 'drive_pdf_html',
    };

    const { container } = render(<DocumentViewer document={document} caseData={caseData} />);

    // Drive fallback iframe не використовується; mammoth DocxRenderer теж не
    // викликається (інакше при невалідному PDF-як-DOCX побачили б empty state
    // «Не вдалось рендерити DOCX»). Замість цього — PdfRenderer показує свій
    // loading state «Завантаження PDF...» (useDriveFileBuffer мокнутий без
    // response, тому buffer лишається в loading-state).
    expect(container.querySelector('iframe.document-viewer__iframe')).toBeNull();
    expect(screen.queryByText(/Не вдалось рендерити DOCX/)).toBeNull();
    expect(screen.getByText(/Завантаження PDF/)).toBeInTheDocument();
  });

  it('Legacy DOCX (без originalMime) — як раніше, через DocxRenderer (іframe Drive не використовується)', () => {
    // Документи додані до TASK A: originalMime = null/undefined, driveId
    // указує на справжній DOCX файл. DocxRenderer працює як раніше.
    const document = {
      id: 'doc_legacy_docx',
      name: 'Старий позов.docx',
      originalName: 'Старий позов.docx',
      originalMime: null,
      driveId: 'drive_legacy_docx',
    };

    const { container } = render(<DocumentViewer document={document} caseData={caseData} />);

    // DocxRenderer показує loading під час завантаження файлу через
    // useDriveFileBuffer. Drive iframe не використовується.
    // PdfRenderer теж не використовується (originalMime null → wasConvertedToPdf=false).
    expect(container.querySelector('iframe.document-viewer__iframe')).toBeNull();
    expect(screen.queryByText(/Завантаження PDF/)).toBeNull();
    expect(screen.getByText(/Завантаження документа/)).toBeInTheDocument();
  });

  it('XLSX (inline-renderable, без власного рендеру) — fallback на Drive iframe', () => {
    const document = {
      id: 'doc_xlsx',
      name: 'Розрахунок.xlsx',
      procId: 'proc_app',
      documentNature: 'searchable',
      driveId: 'drive_xlsx',
    };

    const { container } = render(<DocumentViewer document={document} caseData={caseData} />);

    // Excel/PowerPoint/RTF/TXT — поза скопом мікро-TASK 5.2. Drive iframe як fallback.
    expect(container.querySelector('iframe.document-viewer__iframe')).toBeInTheDocument();
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
