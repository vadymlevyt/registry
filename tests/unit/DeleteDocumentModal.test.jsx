// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeleteDocumentModal } from '../../src/components/CaseDossier/DeleteDocumentModal.jsx';

const DOC = { id: 'doc_1', name: 'Позов початковий' };

function renderModal(props = {}) {
  return render(
    <DeleteDocumentModal
      isOpen={true}
      onClose={() => {}}
      document={DOC}
      onConfirm={() => {}}
      {...props}
    />
  );
}

describe('DeleteDocumentModal', () => {
  it('показує дві опції — архівувати і видалити повністю', () => {
    renderModal();
    expect(screen.getByText('Архівувати документ')).toBeInTheDocument();
    expect(screen.getByText('Видалити повністю')).toBeInTheDocument();
  });

  it('показує назву документа', () => {
    renderModal();
    expect(screen.getByText(/Позов початковий/)).toBeInTheDocument();
  });

  it('за замовчуванням обрано "Архівувати" (найменш руйнівне)', () => {
    renderModal();
    // Кнопка submit — текст "Архівувати"
    const submit = screen.getByRole('button', { name: 'Архівувати' });
    expect(submit).toBeInTheDocument();
  });

  it('перемикання на "Видалити повністю" змінює submit-кнопку на danger', () => {
    renderModal();
    fireEvent.click(screen.getByText('Видалити повністю'));
    const submit = screen.getByRole('button', { name: 'Видалити повністю' });
    expect(submit).toBeInTheDocument();
    expect(submit.className).toMatch(/danger/);
  });

  it('submit викликає onConfirm з обраним mode (archive default)', async () => {
    const onConfirm = vi.fn().mockResolvedValue();
    renderModal({ onConfirm });
    fireEvent.click(screen.getByRole('button', { name: 'Архівувати' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('archive'));
  });

  it('submit з режимом full передає mode="full"', async () => {
    const onConfirm = vi.fn().mockResolvedValue();
    renderModal({ onConfirm });
    fireEvent.click(screen.getByText('Видалити повністю'));
    fireEvent.click(screen.getByRole('button', { name: 'Видалити повністю' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('full'));
  });

  it('Скасувати викликає onClose без onConfirm', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    renderModal({ onConfirm, onClose });
    fireEvent.click(screen.getByText('Скасувати'));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
