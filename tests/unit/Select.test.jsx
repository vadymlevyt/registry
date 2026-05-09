// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Select } from '../../src/components/UI/Select.jsx';

const OPTIONS = [
  { value: 'a', label: 'Перший' },
  { value: 'b', label: 'Другий' },
  { value: 'c', label: 'Третій' },
];

describe('Select (custom dropdown)', () => {
  it('рендерить кнопку combobox замість native select', () => {
    render(<Select value="a" onChange={() => {}} options={OPTIONS} />);
    // має бути власний button з aria-haspopup="listbox", без native <select>
    const trigger = screen.getByRole('button');
    expect(trigger).toBeInTheDocument();
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    // native <select> більше не використовується щоб уникати Android picker
    expect(document.querySelector('select')).toBeNull();
  });

  it('показує мітку обраного значення на кнопці', () => {
    render(<Select value="a" onChange={() => {}} options={OPTIONS} />);
    expect(screen.getByRole('button')).toHaveTextContent('Перший');
  });

  it('клік відкриває listbox з опціями', () => {
    render(<Select value="a" onChange={() => {}} options={OPTIONS} />);
    fireEvent.click(screen.getByRole('button'));
    const listbox = screen.getByRole('listbox');
    expect(listbox).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('вибір опції викликає onChange зі string value', () => {
    const onChange = vi.fn();
    render(<Select value="a" onChange={onChange} options={OPTIONS} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.mouseDown(screen.getByText('Другий'));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('placeholder показується якщо value порожнє', () => {
    render(<Select value="" onChange={() => {}} options={OPTIONS} placeholder="Оберіть..." />);
    expect(screen.getByRole('button')).toHaveTextContent('Оберіть...');
  });

  it('label рендериться', () => {
    render(<Select value="a" onChange={() => {}} options={OPTIONS} label="Категорія" />);
    expect(screen.getByText('Категорія')).toBeInTheDocument();
  });

  it('error додає клас і повідомлення', () => {
    const { container } = render(<Select value="a" onChange={() => {}} options={OPTIONS} error="бах" />);
    expect(container.querySelector('.ui-select--error')).toBeInTheDocument();
    expect(screen.getByText('бах')).toBeInTheDocument();
  });

  it('hint показується якщо немає error', () => {
    render(<Select value="a" onChange={() => {}} options={OPTIONS} hint="оберіть зі списку" />);
    expect(screen.getByText('оберіть зі списку')).toBeInTheDocument();
  });

  it('disabled блокує trigger', () => {
    render(<Select value="a" onChange={() => {}} options={OPTIONS} disabled />);
    const trigger = screen.getByRole('button');
    expect(trigger).toBeDisabled();
  });

  it('опція з disabled: true не клікабельна', () => {
    const onChange = vi.fn();
    const opts = [
      { value: 'a', label: 'Перший' },
      { value: 'b', label: 'Заблокований', disabled: true },
    ];
    render(<Select value="a" onChange={onChange} options={opts} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.mouseDown(screen.getByText('Заблокований'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('chevron-індикатор присутній', () => {
    const { container } = render(<Select value="a" onChange={() => {}} options={OPTIONS} />);
    expect(container.querySelector('.ui-select__chevron')).toBeInTheDocument();
  });
});
