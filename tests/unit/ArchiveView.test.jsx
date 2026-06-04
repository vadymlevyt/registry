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
    onExit: () => {},
    onRestoreOne: () => {},
    onRestoreSelected: () => {},
    onDeleteOne: () => {},
    onDeleteSelected: () => {},
    ...overrides,
  };
  return render(<ArchiveView {...props} />);
}

describe('ArchiveView (TASK bulk_delete_unify — спільний мультивибір)', () => {
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

  it('НЕ містить верхніх кнопок «Відновити всі»/«Видалити всі» (прибрані)', () => {
    renderView();
    expect(screen.queryByText(/Відновити всі/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Видалити всі/)).not.toBeInTheDocument();
  });

  it('показує спільний BulkActionBar з лейблом вибору', () => {
    renderView();
    expect(screen.getByText('Виділено: 0 з 3')).toBeInTheDocument();
  });

  it('порожній архів — empty state, без панелі', () => {
    renderView({ archived: [] });
    expect(screen.getByText('Архів порожній')).toBeInTheDocument();
    expect(screen.queryByText(/Виділено:/)).not.toBeInTheDocument();
  });

  it('клік "Повернутись" викликає onExit', () => {
    const onExit = vi.fn();
    renderView({ onExit });
    fireEvent.click(screen.getByText('Повернутись до матеріалів'));
    expect(onExit).toHaveBeenCalled();
  });

  it('"Відновити" на картці викликає onRestoreOne з документом', () => {
    const onRestoreOne = vi.fn();
    renderView({ onRestoreOne });
    fireEvent.click(screen.getAllByText('Відновити')[0]);
    expect(onRestoreOne).toHaveBeenCalledWith(ARCHIVED[0]);
  });

  it('select-all → зʼявляються батч-кнопки з лічильником', () => {
    const { container } = renderView();
    // Перший чекбокс — select-all у BulkActionBar.
    const selectAll = container.querySelectorAll('input[type="checkbox"]')[0];
    fireEvent.click(selectAll);
    expect(screen.getByText('Відновити обрані (3)')).toBeInTheDocument();
    expect(screen.getByText('Видалити обрані (3)')).toBeInTheDocument();
    expect(screen.getByText('Виділено: 3 з 3')).toBeInTheDocument();
  });

  it('select-all → «Видалити обрані» викликає onDeleteSelected з усіма id', () => {
    const onDeleteSelected = vi.fn();
    const { container } = renderView({ onDeleteSelected });
    const selectAll = container.querySelectorAll('input[type="checkbox"]')[0];
    fireEvent.click(selectAll);
    fireEvent.click(screen.getByText('Видалити обрані (3)'));
    expect(onDeleteSelected).toHaveBeenCalledTimes(1);
    expect(onDeleteSelected.mock.calls[0][0].sort()).toEqual(['d1', 'd2', 'd3']);
  });

  it('вибір одного рядка → onRestoreSelected з одним id', () => {
    const onRestoreSelected = vi.fn();
    const { container } = renderView({ onRestoreSelected });
    // checkbox[0] = select-all, [1] = перша картка.
    const rowCheckbox = container.querySelectorAll('input[type="checkbox"]')[1];
    fireEvent.click(rowCheckbox);
    fireEvent.click(screen.getByText('Відновити обрані (1)'));
    expect(onRestoreSelected).toHaveBeenCalledWith(['d1']);
  });

  it('часткове виділення → select-all indeterminate', () => {
    const { container } = renderView();
    const rowCheckbox = container.querySelectorAll('input[type="checkbox"]')[1];
    fireEvent.click(rowCheckbox);
    const selectAllBox = container.querySelectorAll('.ui-checkbox')[0];
    expect(selectAllBox.className).toMatch(/indeterminate/);
  });
});
