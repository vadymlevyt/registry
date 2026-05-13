// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateTimePicker } from '../../src/components/UI/DateTimePicker.jsx';

describe('DateTimePicker', () => {
  it('не рендериться коли isOpen=false', () => {
    render(<DateTimePicker isOpen={false} onClose={() => {}} onSave={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('рендериться коли isOpen=true з заголовком і кнопками', () => {
    render(
      <DateTimePicker
        isOpen
        onClose={() => {}}
        onSave={() => {}}
        title="Нове засідання"
      />
    );
    expect(screen.getByText('Нове засідання')).toBeInTheDocument();
    expect(screen.getByText(/скасувати/i)).toBeInTheDocument();
    expect(screen.getByText(/зберегти/i)).toBeInTheDocument();
  });

  it('кнопка Зберегти disabled коли дата або час порожні', () => {
    render(<DateTimePicker isOpen onClose={() => {}} onSave={() => {}} />);
    const saveBtn = screen.getByText(/зберегти/i).closest('button');
    expect(saveBtn).toBeDisabled();
  });

  it('кнопка Зберегти active коли обидва значення задані через initial', () => {
    render(
      <DateTimePicker
        isOpen
        onClose={() => {}}
        onSave={() => {}}
        initialDate="2026-05-13"
        initialTime="09:30"
      />
    );
    const saveBtn = screen.getByText(/зберегти/i).closest('button');
    expect(saveBtn).not.toBeDisabled();
  });

  it('onSave викликається з { date, time } при натисканні Зберегти', () => {
    const onSave = vi.fn();
    render(
      <DateTimePicker
        isOpen
        onClose={() => {}}
        onSave={onSave}
        initialDate="2026-05-13"
        initialTime="09:30"
      />
    );
    fireEvent.click(screen.getByText(/зберегти/i));
    expect(onSave).toHaveBeenCalledWith({ date: '2026-05-13', time: '09:30' });
  });

  it('onClose викликається при натисканні Скасувати', () => {
    const onClose = vi.fn();
    render(<DateTimePicker isOpen onClose={onClose} onSave={() => {}} />);
    fireEvent.click(screen.getByText(/скасувати/i));
    expect(onClose).toHaveBeenCalled();
  });

  it('резюме показує "не обрана" коли значення порожні', () => {
    render(<DateTimePicker isOpen onClose={() => {}} onSave={() => {}} />);
    expect(screen.getByText(/не обрана/i)).toBeInTheDocument();
  });

  it('резюме показує і дату і час коли обидва задані', () => {
    render(
      <DateTimePicker
        isOpen
        onClose={() => {}}
        onSave={() => {}}
        initialDate="2026-05-13"
        initialTime="09:30"
      />
    );
    expect(screen.getByText(/13\.05\.2026/)).toBeInTheDocument();
    expect(screen.getByText(/09:30/)).toBeInTheDocument();
  });

  it('saveLabel перевизначає текст кнопки', () => {
    render(
      <DateTimePicker
        isOpen
        onClose={() => {}}
        onSave={() => {}}
        saveLabel="Додати засідання"
        initialDate="2026-05-13"
        initialTime="09:30"
      />
    );
    expect(screen.getByText('Додати засідання')).toBeInTheDocument();
  });
});
