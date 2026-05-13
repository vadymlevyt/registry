// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  DatePicker, parseISODate, formatDateDisplay, toISODate, buildCalendarGrid,
} from '../../src/components/UI/DatePicker.jsx';

describe('DatePicker.parseISODate', () => {
  it('повертає null для не-рядка / порожнього', () => {
    expect(parseISODate(null)).toBeNull();
    expect(parseISODate(undefined)).toBeNull();
    expect(parseISODate('')).toBeNull();
    expect(parseISODate(123)).toBeNull();
  });

  it('повертає null для невалідного формату', () => {
    expect(parseISODate('2026-13-01')).toBeNull();
    expect(parseISODate('2026/01/01')).toBeNull();
    expect(parseISODate('26-01-01')).toBeNull();
    expect(parseISODate('not-a-date')).toBeNull();
  });

  it('повертає null для неіснуючої дати (31 лютого)', () => {
    expect(parseISODate('2026-02-31')).toBeNull();
  });

  it('повертає об\'єкт для валідного YYYY-MM-DD', () => {
    const r = parseISODate('2026-05-13');
    expect(r).toEqual(expect.objectContaining({ year: 2026, month: 4, day: 13 }));
    expect(r.date).toBeInstanceOf(Date);
  });
});

describe('DatePicker.toISODate', () => {
  it('форматує y/m0/d у YYYY-MM-DD з padded', () => {
    expect(toISODate(2026, 0, 5)).toBe('2026-01-05');
    expect(toISODate(2026, 11, 31)).toBe('2026-12-31');
  });

  it('повертає порожній рядок для невалідного вводу', () => {
    expect(toISODate(NaN, 0, 1)).toBe('');
    expect(toISODate(2026, undefined, 1)).toBe('');
  });
});

describe('DatePicker.formatDateDisplay', () => {
  it('форматує у DD.MM.YYYY', () => {
    expect(formatDateDisplay('2026-05-13')).toBe('13.05.2026');
    expect(formatDateDisplay('2026-01-01')).toBe('01.01.2026');
  });
  it('повертає порожній рядок для невалідного ISO', () => {
    expect(formatDateDisplay('')).toBe('');
    expect(formatDateDisplay('garbage')).toBe('');
  });
});

describe('DatePicker.buildCalendarGrid', () => {
  it('повертає 42 клітинки', () => {
    expect(buildCalendarGrid(2026, 4)).toHaveLength(42);
  });

  it('перший день — понеділок незалежно від місяця', () => {
    // Травень 2026 починається у пʼятницю. Перший рядок має починатись з
    // понеділка попереднього тижня (27 квітня 2026).
    const cells = buildCalendarGrid(2026, 4);
    expect(cells[0].day).toBe(27);
    expect(cells[0].month).toBe(3); // квітень
    expect(cells[0].isOtherMonth).toBe(true);
  });

  it('середні клітинки належать поточному місяцю', () => {
    const cells = buildCalendarGrid(2026, 4);
    const may = cells.filter((c) => c.month === 4);
    expect(may.length).toBeGreaterThanOrEqual(28);
    expect(may[0].day).toBe(1);
  });
});

describe('DatePicker — UI', () => {
  it('рендерить trigger з placeholder коли value порожній', () => {
    render(<DatePicker placeholder="Оберіть" />);
    expect(screen.getByText('Оберіть')).toBeInTheDocument();
  });

  it('рендерить trigger з форматованою датою коли value валідний', () => {
    render(<DatePicker value="2026-05-13" />);
    expect(screen.getByText('13.05.2026')).toBeInTheDocument();
  });

  it('label рендериться', () => {
    render(<DatePicker label="Дата" />);
    expect(screen.getByText('Дата')).toBeInTheDocument();
  });

  it('тап на trigger відкриває календар', () => {
    render(<DatePicker />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /оберіть/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('inline=true одразу показує календар без trigger', () => {
    render(<DatePicker inline />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText(/оберіть дату/i)).not.toBeInTheDocument();
  });

  it('клік по дню викликає onChange з ISO рядком', () => {
    const onChange = vi.fn();
    render(<DatePicker value="2026-05-13" onChange={onChange} inline />);
    // Знайти кнопку для 15 травня (aria-label містить "15 Травень 2026")
    const day15 = screen.getByLabelText('15 Травень 2026');
    fireEvent.click(day15);
    expect(onChange).toHaveBeenCalledWith('2026-05-15');
  });

  it('disabled блокує відкриття', () => {
    render(<DatePicker disabled />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('error додає клас ui-datepicker--error', () => {
    const { container } = render(<DatePicker error="bad" />);
    expect(container.querySelector('.ui-datepicker--error')).toBeInTheDocument();
    expect(screen.getByText('bad')).toBeInTheDocument();
  });

  it('minDate блокує вибір дня раніше за межу', () => {
    const onChange = vi.fn();
    render(
      <DatePicker
        value="2026-05-13"
        minDate="2026-05-10"
        onChange={onChange}
        inline
      />
    );
    const day5 = screen.getByLabelText('5 Травень 2026');
    expect(day5).toBeDisabled();
    fireEvent.click(day5);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('сьогоднішня дата отримує клас ui-datepicker__day--today', () => {
    const today = new Date();
    const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const { container } = render(<DatePicker value={todayISO} inline />);
    expect(container.querySelector('.ui-datepicker__day--today')).toBeInTheDocument();
  });
});
