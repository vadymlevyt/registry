// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArchiveView } from '../../src/components/CaseDossier/ArchiveView.jsx';

const ARCHIVED = [
  { id: 'd1', name: 'Стара версія договору', icon: '📄', date: '2024-01-15' },
  { id: 'd2', name: 'Чорновик клопотання', icon: '📝', date: '2024-02-10' },
  { id: 'd3', name: 'Зайвий лист', icon: '✉️', date: '2024-03-01' },
];

function renderView(overrides = {}) {
  const props = {
    archived: ARCHIVED,
    selectedIds: new Set(),
    onSelectAll: () => {},
    onToggleSelected: () => {},
    onExit: () => {},
    onRestoreOne: () => {},
    onRestoreAll: () => {},
    onRestoreSelected: () => {},
    onDeleteOne: () => {},
    onDeleteAll: () => {},
    onDeleteSelected: () => {},
    ...overrides,
  };
  return render(<ArchiveView {...props} />);
}

describe('ArchiveView', () => {
  it('рендерить заголовок з кнопкою повернення', () => {
    renderView();
    expect(screen.getByText('Повернутись до матеріалів')).toBeInTheDocument();
  });

  it('показує всі архівні документи', () => {
    renderView();
    for (const d of ARCHIVED) {
      expect(screen.getByText(d.name)).toBeInTheDocument();
    }
  });

  it('кнопки "Відновити всі / Видалити всі" з лічильником', () => {
    renderView();
    expect(screen.getByText('Відновити всі (3)')).toBeInTheDocument();
    expect(screen.getByText('Видалити всі (3)')).toBeInTheDocument();
  });

  it('порожній архів — empty state', () => {
    renderView({ archived: [] });
    expect(screen.getByText('Архів порожній')).toBeInTheDocument();
  });

  it('клік "Повернутись" викликає onExit', () => {
    const onExit = vi.fn();
    renderView({ onExit });
    fireEvent.click(screen.getByText('Повернутись до матеріалів'));
    expect(onExit).toHaveBeenCalled();
  });

  it('клік "Відновити всі" викликає onRestoreAll', () => {
    const onRestoreAll = vi.fn();
    renderView({ onRestoreAll });
    fireEvent.click(screen.getByText('Відновити всі (3)'));
    expect(onRestoreAll).toHaveBeenCalled();
  });

  it('selectedIds показує batch-bar з лічильником обраних', () => {
    renderView({ selectedIds: new Set(['d1', 'd2']) });
    expect(screen.getByText('Виділено: 2 з 3')).toBeInTheDocument();
    expect(screen.getByText('Відновити обрані (2)')).toBeInTheDocument();
    expect(screen.getByText('Видалити обрані (2)')).toBeInTheDocument();
  });

  it('"Відновити" на картці викликає onRestoreOne з документом', () => {
    const onRestoreOne = vi.fn();
    renderView({ onRestoreOne });
    fireEvent.click(screen.getAllByText('Відновити')[0]);
    expect(onRestoreOne).toHaveBeenCalledWith(ARCHIVED[0]);
  });

  it('кнопка "Виділити всі" з лічильником', () => {
    renderView();
    expect(screen.getByText('Виділити всі (3)')).toBeInTheDocument();
  });

  it('повне виділення викликає onSelectAll(true)', () => {
    const onSelectAll = vi.fn();
    const { container } = renderView({ onSelectAll });
    // Перший чекбокс — "Виділити всі"
    const firstCheckbox = container.querySelectorAll('input[type="checkbox"]')[0];
    fireEvent.click(firstCheckbox);
    expect(onSelectAll).toHaveBeenCalledWith(true);
  });

  it('"Виділити всі" indeterminate коли частина обрана', () => {
    const { container } = renderView({ selectedIds: new Set(['d1']) });
    const checkboxes = container.querySelectorAll('.ui-checkbox');
    expect(checkboxes[0].className).toMatch(/indeterminate/);
  });
});
