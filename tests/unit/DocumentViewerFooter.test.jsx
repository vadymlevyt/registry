// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../src/services/ocrService.js', () => ({
  getCachedText: vi.fn().mockResolvedValue(null),
  getDocumentText: vi.fn().mockResolvedValue(''),
  localizeOcrError: vi.fn(code => code),
}));
vi.mock('../../src/services/driveAuth.js', () => ({
  driveRequest: vi.fn(),
  forceConsentRefresh: vi.fn(),
}));

import { DocumentViewerFooter } from '../../src/components/DocumentViewer/DocumentViewerFooter.jsx';

const docSearchable = {
  id: 'doc_1',
  name: 'Позов.pdf',
  driveId: 'drive_abc',
  documentNature: 'searchable',
};

const docScanned = { ...docSearchable, documentNature: 'scanned' };
const caseData = { storage: { subFolders: { '02_ОБРОБЛЕНІ': 'folder_proc' } } };

function withoutShare(fn) {
  const original = navigator.share;
  // Зробити navigator.share undefined тимчасово
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: undefined,
  });
  try {
    fn();
  } finally {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: original,
    });
  }
}

describe('DocumentViewerFooter', () => {
  beforeEach(() => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('searchable документ → 5 кнопок (без Перерозпізнати) коли немає Web Share', () => {
    withoutShare(() => {
      render(
        <DocumentViewerFooter
          document={docSearchable}
          caseData={caseData}
          mode="text"
          onDiscussWithAgent={() => {}}
          onReprocess={() => {}}
        />
      );
      const buttons = screen.getAllByRole('button');
      expect(buttons).toHaveLength(4); // Drive, Завантажити, Копіювати, Обговорити
    });
  });

  it('scanned документ → додається кнопка Перерозпізнати', () => {
    withoutShare(() => {
      render(
        <DocumentViewerFooter
          document={docScanned}
          caseData={caseData}
          mode="scan"
          onDiscussWithAgent={() => {}}
          onReprocess={() => {}}
        />
      );
      expect(screen.getByRole('button', { name: /Перерозпізнати/ })).toBeInTheDocument();
    });
  });

  it('Копіювати disabled у режимі scan', () => {
    withoutShare(() => {
      render(
        <DocumentViewerFooter
          document={docScanned}
          caseData={caseData}
          mode="scan"
          onDiscussWithAgent={() => {}}
          onReprocess={() => {}}
        />
      );
      const btn = screen.getByRole('button', { name: /Копіювати/ });
      expect(btn).toBeDisabled();
    });
  });

  it('Drive button відкриває drive.google.com', () => {
    withoutShare(() => {
      render(
        <DocumentViewerFooter
          document={docSearchable}
          caseData={caseData}
          mode="text"
          onDiscussWithAgent={() => {}}
          onReprocess={() => {}}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /Drive/ }));
      expect(window.open).toHaveBeenCalledWith(
        expect.stringContaining('drive.google.com/file/d/drive_abc'),
        '_blank',
        'noopener,noreferrer'
      );
    });
  });

  it('Обговорити викликає onDiscussWithAgent з документом', () => {
    withoutShare(() => {
      const onDiscussWithAgent = vi.fn();
      render(
        <DocumentViewerFooter
          document={docSearchable}
          caseData={caseData}
          mode="text"
          onDiscussWithAgent={onDiscussWithAgent}
          onReprocess={() => {}}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /Обговорити/ }));
      expect(onDiscussWithAgent).toHaveBeenCalledWith(docSearchable);
    });
  });

  it('Перерозпізнати викликає onReprocess з документом', () => {
    withoutShare(() => {
      const onReprocess = vi.fn();
      render(
        <DocumentViewerFooter
          document={docScanned}
          caseData={caseData}
          mode="scan"
          onDiscussWithAgent={() => {}}
          onReprocess={onReprocess}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /Перерозпізнати/ }));
      expect(onReprocess).toHaveBeenCalledWith(docScanned);
    });
  });

  it('кнопки Drive і Завантажити disabled коли немає driveId', () => {
    withoutShare(() => {
      render(
        <DocumentViewerFooter
          document={{ ...docSearchable, driveId: null }}
          caseData={caseData}
          mode="text"
          onDiscussWithAgent={() => {}}
          onReprocess={() => {}}
        />
      );
      expect(screen.getByRole('button', { name: /Drive/ })).toBeDisabled();
      expect(screen.getByRole('button', { name: /Завантажити/ })).toBeDisabled();
    });
  });
});
