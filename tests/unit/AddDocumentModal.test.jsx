// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddDocumentModal } from '../../src/components/CaseDossier/AddDocumentModal.jsx';

const CASE = {
  id: 'case_1',
  proceedings: [
    { id: 'proc_main', title: 'Основне провадження', type: 'first' },
    { id: 'proc_appeal', title: 'Апеляція 03.2024', type: 'appeal' },
  ],
};

function renderModal(props = {}) {
  return render(
    <AddDocumentModal
      isOpen={true}
      onClose={() => {}}
      caseData={CASE}
      onSubmit={() => {}}
      {...props}
    />
  );
}

describe('AddDocumentModal', () => {
  it('рендерить заголовок і всі основні поля', () => {
    renderModal();
    // Заголовок модалки + submit-кнопка обидва містять "Додати документ"
    expect(screen.getAllByText('Додати документ').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Назва документа')).toBeInTheDocument();
    expect(screen.getByText('Тип документа')).toBeInTheDocument();
    expect(screen.getByText('Від кого')).toBeInTheDocument();
    expect(screen.getByText('Провадження')).toBeInTheDocument();
    expect(screen.getByText('Дата документа')).toBeInTheDocument();
    expect(screen.getByText('Позначити як ключовий')).toBeInTheDocument();
  });

  it('не використовує native <select> (інакше Android picker)', () => {
    renderModal();
    expect(document.querySelector('select')).toBeNull();
  });

  it('submit без назви — onSubmit не викликається, з\'являється помилка', async () => {
    const onSubmit = vi.fn();
    renderModal({ onSubmit });
    fireEvent.click(screen.getByRole('button', { name: 'Додати документ' }));
    await waitFor(() => {
      expect(screen.getByText(/Назва обов/i)).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submit з валідною назвою викликає onSubmit з очікуваними полями', async () => {
    const onSubmit = vi.fn().mockResolvedValue();
    const onClose = vi.fn();
    renderModal({ onSubmit, onClose });

    fireEvent.change(screen.getByPlaceholderText(/Позов про стягнення/), {
      target: { value: 'Тестовий документ' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Додати документ' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const arg = onSubmit.mock.calls[0][0];
    expect(arg.name).toBe('Тестовий документ');
    expect(arg.procId).toBe('proc_main');
    expect(arg.isKey).toBe(false);
  });

  it('закриття через Скасувати викликає onClose', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByText('Скасувати'));
    expect(onClose).toHaveBeenCalled();
  });
});
