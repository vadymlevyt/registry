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

// Helper — клікнути "Додати файл" на стартовому екрані, щоб дістатись форми.
function enterSingleMode() {
  fireEvent.click(screen.getByText('Додати файл'));
}

describe('AddDocumentModal — стартовий екран', () => {
  it('показує дві кнопки на старті: Додати файл і Склеїти зображення', () => {
    renderModal();
    expect(screen.getByText('Додати файл')).toBeInTheDocument();
    expect(screen.getByText('Склеїти зображення')).toBeInTheDocument();
  });

  it('"Склеїти зображення" — робоча кнопка без плейсхолдера (TASK B активовано)', () => {
    renderModal();
    // Після TASK B плейсхолдер "Доступно у наступній версії" знято.
    expect(screen.queryByText(/наступній версії/i)).not.toBeInTheDocument();
    expect(screen.getByText('Склеїти зображення')).toBeInTheDocument();
  });

  it('на стартовому екрані немає полів форми', () => {
    renderModal();
    expect(screen.queryByText('Назва документа')).toBeNull();
    expect(screen.queryByText('Тип документа')).toBeNull();
  });

  it('клік на "Додати файл" показує форму', () => {
    renderModal();
    enterSingleMode();
    expect(screen.getByText('Назва документа')).toBeInTheDocument();
    expect(screen.getByText('Тип документа')).toBeInTheDocument();
  });
});

describe('AddDocumentModal — форма', () => {
  it('рендерить заголовок і всі основні поля після кліку "Додати файл"', () => {
    renderModal();
    enterSingleMode();
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
    enterSingleMode();
    expect(document.querySelector('select')).toBeNull();
  });

  it('submit без назви — onSubmit не викликається, з\'являється помилка', async () => {
    const onSubmit = vi.fn();
    renderModal({ onSubmit });
    enterSingleMode();
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
    enterSingleMode();

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
    // Скасувати працює і на стартовому екрані, і у формі
    fireEvent.click(screen.getByText('Скасувати'));
    expect(onClose).toHaveBeenCalled();
  });

  it('кнопка Назад повертає на стартовий екран і чистить форму', () => {
    renderModal();
    enterSingleMode();
    fireEvent.change(screen.getByPlaceholderText(/Позов про стягнення/), {
      target: { value: 'X' },
    });
    fireEvent.click(screen.getByText('Назад'));
    // Знов стартовий екран — нема полів форми
    expect(screen.queryByText('Назва документа')).toBeNull();
    expect(screen.getByText('Додати файл')).toBeInTheDocument();
  });

  it('має плейсхолдер "+ Нове" біля селекту провадження (TASK A.7)', () => {
    renderModal();
    enterSingleMode();
    // Кнопка зʼявляється тільки якщо є хоч одне існуюче провадження
    // (інакше Select взагалі не рендериться)
    expect(screen.getByText('+ Нове')).toBeInTheDocument();
  });

  it('submit в режимі form показує "Конвертація і завантаження..." під час submit', async () => {
    let resolveSubmit;
    const onSubmit = vi.fn(() => new Promise(r => { resolveSubmit = r; }));
    renderModal({ onSubmit });
    enterSingleMode();
    fireEvent.change(screen.getByPlaceholderText(/Позов про стягнення/), {
      target: { value: 'Test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Додати документ' }));
    await waitFor(() => {
      expect(screen.getByText(/Конвертація/i)).toBeInTheDocument();
    });
    resolveSubmit();
  });
});

// ── Drive picker visibility ───────────────────────────────────────────────
// Регресія: Drive picker зник у single mode коли case ще не має 01_ОРИГІНАЛИ
// підпапки. Гейт — driveConnected, не subFolders.
describe('AddDocumentModal — Drive picker visibility', () => {
  it('Drive picker section показано в single mode коли driveConnected=true і немає subFolders', () => {
    renderModal({ driveConnected: true });
    enterSingleMode();
    // Toggle-кнопка з текстом "Або вибрати файл вже на Drive" має бути,
    // навіть якщо case ще не має subFolders['01_ОРИГІНАЛИ'].
    expect(screen.getByText(/вибрати файл вже на Drive/i)).toBeInTheDocument();
  });

  it('Drive picker section ПРИХОВАНО в single mode коли driveConnected=false', () => {
    renderModal({ driveConnected: false });
    enterSingleMode();
    expect(screen.queryByText(/вибрати файл вже на Drive/i)).toBeNull();
  });

  it('Drive picker section показано коли case має subFolders 01_ОРИГІНАЛИ', () => {
    renderModal({
      driveConnected: true,
      caseData: { ...CASE, storage: { subFolders: { '01_ОРИГІНАЛИ': 'folder_abc' } } },
    });
    enterSingleMode();
    expect(screen.getByText(/вибрати файл вже на Drive/i)).toBeInTheDocument();
  });

  it('кнопка "Додати з Drive" у merge mode показана коли driveConnected=true', () => {
    renderModal({ driveConnected: true });
    fireEvent.click(screen.getByText('Склеїти зображення'));
    expect(screen.getByText('Додати з Drive')).toBeInTheDocument();
  });

  it('кнопка "Додати з Drive" у merge mode ПРИХОВАНА коли driveConnected=false', () => {
    renderModal({ driveConnected: false });
    fireEvent.click(screen.getByText('Склеїти зображення'));
    expect(screen.queryByText('Додати з Drive')).toBeNull();
  });
});
