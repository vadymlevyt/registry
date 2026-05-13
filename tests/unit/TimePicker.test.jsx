// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  TimePicker, parseHHMM, toHHMM, formatTimeDisplay, __test__,
} from '../../src/components/UI/TimePicker.jsx';

describe('TimePicker.parseHHMM', () => {
  it('null для невалідного', () => {
    expect(parseHHMM(null)).toBeNull();
    expect(parseHHMM('')).toBeNull();
    expect(parseHHMM('25:00')).toBeNull();
    expect(parseHHMM('12:60')).toBeNull();
    expect(parseHHMM('not a time')).toBeNull();
  });
  it('обʼєкт для валідного HH:MM', () => {
    expect(parseHHMM('09:30')).toEqual({ hour: 9, minute: 30 });
    expect(parseHHMM('23:59')).toEqual({ hour: 23, minute: 59 });
    expect(parseHHMM('00:00')).toEqual({ hour: 0, minute: 0 });
  });
  it('допускає одну цифру у годинах (H:MM)', () => {
    expect(parseHHMM('9:30')).toEqual({ hour: 9, minute: 30 });
  });
});

describe('TimePicker.toHHMM', () => {
  it('padded HH:MM', () => {
    expect(toHHMM(9, 5)).toBe('09:05');
    expect(toHHMM(23, 59)).toBe('23:59');
  });
  it('порожній для невалідного', () => {
    expect(toHHMM(NaN, 0)).toBe('');
    expect(toHHMM(undefined, 0)).toBe('');
  });
});

describe('TimePicker.formatTimeDisplay', () => {
  it('форматує валідний', () => {
    expect(formatTimeDisplay('9:30')).toBe('09:30');
  });
  it('порожній рядок для невалідного', () => {
    expect(formatTimeDisplay('bad')).toBe('');
  });
});

describe('TimePicker.__test__.buildMinutes', () => {
  it('крок 1 — 60 елементів', () => {
    expect(__test__.buildMinutes(1).length).toBe(60);
  });
  it('крок 5 — 12 елементів', () => {
    expect(__test__.buildMinutes(5).length).toBe(12);
    expect(__test__.buildMinutes(5)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  });
  it('крок 15 — 4 елементи', () => {
    expect(__test__.buildMinutes(15)).toEqual([0, 15, 30, 45]);
  });
  it('некоректний крок — fallback до 1', () => {
    expect(__test__.buildMinutes(0).length).toBe(60);
    expect(__test__.buildMinutes(-5).length).toBe(60);
  });
});

describe('TimePicker — UI', () => {
  it('рендерить trigger з placeholder', () => {
    render(<TimePicker placeholder="Оберіть час" />);
    expect(screen.getByText('Оберіть час')).toBeInTheDocument();
  });
  it('рендерить trigger з форматованим часом', () => {
    render(<TimePicker value="14:30" />);
    expect(screen.getByText('14:30')).toBeInTheDocument();
  });
  it('тап на trigger відкриває wheel', () => {
    render(<TimePicker />);
    expect(screen.queryAllByRole('listbox')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /оберіть час/i }));
    expect(screen.getAllByRole('listbox').length).toBe(2);
  });
  it('inline=true показує wheels одразу', () => {
    render(<TimePicker inline />);
    expect(screen.getAllByRole('listbox').length).toBe(2);
  });
  it('клік по елементу години викликає onChange', () => {
    const onChange = vi.fn();
    render(<TimePicker value="09:00" onChange={onChange} inline />);
    // Знайдемо одну з годин — wheel рендерить кнопки з padded числами.
    // 14 у форматі '14' існує точно у вheel'ї годин.
    const hourBtns = screen.getAllByRole('option');
    const fourteen = hourBtns.find((b) => b.textContent === '14');
    expect(fourteen).toBeTruthy();
    fireEvent.click(fourteen);
    expect(onChange).toHaveBeenCalledWith('14:00');
  });
  it('disabled блокує відкриття', () => {
    render(<TimePicker disabled />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryAllByRole('listbox')).toHaveLength(0);
  });
  it('label рендериться', () => {
    render(<TimePicker label="Час" />);
    expect(screen.getByText('Час')).toBeInTheDocument();
  });
});
