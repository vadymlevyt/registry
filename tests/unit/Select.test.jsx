// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Select } from '../../src/components/UI/Select.jsx';

const OPTIONS = [
  { value: 'a', label: 'Перший' },
  { value: 'b', label: 'Другий' },
  { value: 'c', label: 'Третій' },
];

describe('Select', () => {
  it('рендерить native select з опціями', () => {
    render(<Select value="a" onChange={() => {}} options={OPTIONS} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('Перший')).toBeInTheDocument();
    expect(screen.getByText('Другий')).toBeInTheDocument();
    expect(screen.getByText('Третій')).toBeInTheDocument();
  });

  it('викликає onChange зі string value', () => {
    const onChange = vi.fn();
    render(<Select value="a" onChange={onChange} options={OPTIONS} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b' } });
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('placeholder додає disabled <option value="">', () => {
    render(<Select value="" onChange={() => {}} options={OPTIONS} placeholder="Оберіть..." />);
    expect(screen.getByText('Оберіть...')).toBeInTheDocument();
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

  it('disabled блокує select', () => {
    const { container } = render(<Select value="a" onChange={() => {}} options={OPTIONS} disabled />);
    expect(container.querySelector('select').disabled).toBe(true);
  });

  it('опція з disabled: true не клікабельна', () => {
    const opts = [{ value: 'a', label: 'Перший' }, { value: 'b', label: 'Заблокований', disabled: true }];
    const { container } = render(<Select value="a" onChange={() => {}} options={opts} />);
    const blocked = container.querySelectorAll('option')[1];
    expect(blocked.disabled).toBe(true);
  });

  it('chevron-індикатор присутній', () => {
    const { container } = render(<Select value="a" onChange={() => {}} options={OPTIONS} />);
    expect(container.querySelector('.ui-select__chevron')).toBeInTheDocument();
  });
});
