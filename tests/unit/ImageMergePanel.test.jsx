// @vitest-environment jsdom
//
// Smoke-тести ImageMergePanel — рендер selecting phase з різними props.
// Повний pipeline тестується у tests/integration/multiImageToPdf.test.js.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock convertImagesToPdf — він використовує реальні bin модулі (jspdf, fontkit)
vi.mock('../../src/services/converter/converterService.js', () => ({
  convertImagesToPdf: vi.fn(),
}));

// Mock toast
vi.mock('../../src/services/toast.js', () => ({
  toast: {
    show: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

// Mock ensureUniqueName
vi.mock('../../src/services/sortation/imageSortingAgent.js', () => ({
  ensureUniqueName: (n) => n,
}));

import { ImageMergePanel } from '../../src/components/CaseDossier/ImageMergePanel.jsx';

const CASE_DATA = {
  id: 'case_1',
  proceedings: [{ id: 'proc_main', title: 'Основне провадження' }],
  documents: [],
};

describe('ImageMergePanel — selecting phase', () => {
  it('рендерить кнопки "Додати з пристрою" і "Додати з Drive"', () => {
    render(
      <ImageMergePanel
        caseData={CASE_DATA}
        apiKey="test"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        onOpenDrivePicker={vi.fn()}
      />
    );
    expect(screen.getByText('Додати з пристрою')).toBeInTheDocument();
    expect(screen.getByText('Додати з Drive')).toBeInTheDocument();
  });

  it('не рендерить "Додати з Drive" коли onOpenDrivePicker не передано', () => {
    render(
      <ImageMergePanel
        caseData={CASE_DATA}
        apiKey="test"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        onOpenDrivePicker={null}
      />
    );
    expect(screen.getByText('Додати з пристрою')).toBeInTheDocument();
    expect(screen.queryByText('Додати з Drive')).not.toBeInTheDocument();
  });

  it('кнопка "Створити PDF" disabled коли немає файлів', () => {
    render(
      <ImageMergePanel
        caseData={CASE_DATA}
        apiKey="test"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        onOpenDrivePicker={vi.fn()}
      />
    );
    const submitBtn = screen.getByRole('button', { name: /Створити PDF/i });
    expect(submitBtn).toBeDisabled();
  });

  it('кнопка "Назад" викликає onCancel', () => {
    const onCancel = vi.fn();
    render(
      <ImageMergePanel
        caseData={CASE_DATA}
        apiKey="test"
        onSubmit={vi.fn()}
        onCancel={onCancel}
        onOpenDrivePicker={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Назад/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('текст інструкції про склейку показано', () => {
    render(
      <ImageMergePanel
        caseData={CASE_DATA}
        apiKey="test"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        onOpenDrivePicker={vi.fn()}
      />
    );
    expect(screen.getByText(/Виберіть кілька зображень/i)).toBeInTheDocument();
  });
});
