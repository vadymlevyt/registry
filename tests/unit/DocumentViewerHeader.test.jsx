// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DocumentViewerHeader } from '../../src/components/DocumentViewer/DocumentViewerHeader.jsx';

const baseDoc = {
  id: 'doc_1',
  name: 'Позов про стягнення.pdf',
  category: 'pleading',
  author: 'ours',
  procId: 'proc_main',
  documentNature: 'searchable',
  isKey: false,
  date: '2026-03-15',
  pageCount: 7,
  size: 2_400_000,
};

const baseCase = {
  proceedings: [{ id: 'proc_main', type: 'first', title: 'Перша інстанція' }],
};

function noop() {}

describe('DocumentViewerHeader', () => {
  it('показує назву і метарядок з усіма полями', () => {
    render(
      <DocumentViewerHeader
        document={baseDoc}
        caseData={baseCase}
        showModeToggle={false}
        mode="text"
        onModeChange={noop}
        onToggleKey={noop}
        onOpenDetails={noop}
        onClose={noop}
      />
    );
    expect(screen.getByText('Позов про стягнення.pdf')).toBeInTheDocument();
    expect(screen.getByText(/Заява по суті/)).toBeInTheDocument();
    expect(screen.getByText(/Наш/)).toBeInTheDocument();
    expect(screen.getByText(/Перша інстанція/)).toBeInTheDocument();
    expect(screen.getByText(/15\.03\.2026/)).toBeInTheDocument();
    expect(screen.getByText(/7 стор/)).toBeInTheDocument();
    expect(screen.getByText(/2\.3 МБ/)).toBeInTheDocument();
  });

  it('показує перемикач тільки коли showModeToggle=true', () => {
    const { rerender } = render(
      <DocumentViewerHeader
        document={baseDoc}
        caseData={baseCase}
        showModeToggle={false}
        mode="text"
        onModeChange={noop}
        onToggleKey={noop}
        onOpenDetails={noop}
        onClose={noop}
      />
    );
    expect(screen.queryByRole('tab', { name: /Скан/ })).toBeNull();

    rerender(
      <DocumentViewerHeader
        document={{ ...baseDoc, documentNature: 'scanned' }}
        caseData={baseCase}
        showModeToggle
        tabs={[{ value: 'scan', label: 'Скан' }, { value: 'digest', label: 'Конспект', ai: true }]}
        mode="scan"
        onModeChange={noop}
        onToggleKey={noop}
        onOpenDetails={noop}
        onClose={noop}
      />
    );
    expect(screen.getByRole('tab', { name: /Скан/ })).toBeInTheDocument();
  });

  it('пропускає відсутні поля метарядка (не показує "невідомо")', () => {
    render(
      <DocumentViewerHeader
        document={{ id: 'doc_2', name: 'Без метаданих.pdf', procId: null, isKey: false }}
        caseData={baseCase}
        showModeToggle={false}
        mode="text"
        onModeChange={noop}
        onToggleKey={noop}
        onOpenDetails={noop}
        onClose={noop}
      />
    );
    expect(screen.queryByText(/невідомо/i)).toBeNull();
    expect(screen.queryByText(/null/i)).toBeNull();
  });

  it('клік на ⭐ викликає onToggleKey з протилежним значенням', () => {
    const onToggleKey = vi.fn();
    render(
      <DocumentViewerHeader
        document={baseDoc}
        caseData={baseCase}
        showModeToggle={false}
        mode="text"
        onModeChange={noop}
        onToggleKey={onToggleKey}
        onOpenDetails={noop}
        onClose={noop}
      />
    );
    fireEvent.click(screen.getByLabelText('Ключовий документ'));
    expect(onToggleKey).toHaveBeenCalledWith(true);
  });

  it('клік на ✕ викликає onClose', () => {
    const onClose = vi.fn();
    render(
      <DocumentViewerHeader
        document={baseDoc}
        caseData={baseCase}
        showModeToggle={false}
        mode="text"
        onModeChange={noop}
        onToggleKey={noop}
        onOpenDetails={noop}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByLabelText('Закрити'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('клік на 🔧 викликає onOpenDetails', () => {
    const onOpenDetails = vi.fn();
    render(
      <DocumentViewerHeader
        document={baseDoc}
        caseData={baseCase}
        showModeToggle={false}
        mode="text"
        onModeChange={noop}
        onToggleKey={noop}
        onOpenDetails={onOpenDetails}
        onClose={noop}
      />
    );
    fireEvent.click(screen.getByLabelText('Деталі'));
    expect(onOpenDetails).toHaveBeenCalledOnce();
  });
});
