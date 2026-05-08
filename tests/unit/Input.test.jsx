// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from '../../src/components/UI/Input.jsx';

describe('Input', () => {
  it('рендерить input', () => {
    const { container } = render(<Input placeholder="email" />);
    expect(container.querySelector('input')).toBeInTheDocument();
  });

  it('label рендериться коли передано', () => {
    render(<Input label="Email" />);
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('викликає onChange зі значенням (string), не event', () => {
    const onChange = vi.fn();
    const { container } = render(<Input onChange={onChange} />);
    fireEvent.change(container.querySelector('input'), { target: { value: 'привіт' } });
    expect(onChange).toHaveBeenCalledWith('привіт');
  });

  it('value контрольоване', () => {
    const { container } = render(<Input value="abc" onChange={() => {}} />);
    expect(container.querySelector('input').value).toBe('abc');
  });

  it('placeholder рендериться', () => {
    render(<Input placeholder="Введіть текст" />);
    expect(screen.getByPlaceholderText('Введіть текст')).toBeInTheDocument();
  });

  it('error додає клас ui-input--error і показує повідомлення', () => {
    const { container } = render(<Input error="Невалідний email" />);
    expect(container.querySelector('.ui-input--error')).toBeInTheDocument();
    expect(screen.getByText('Невалідний email')).toBeInTheDocument();
  });

  it('hint показується якщо немає error', () => {
    render(<Input hint="до 100 символів" />);
    expect(screen.getByText('до 100 символів')).toBeInTheDocument();
  });

  it('error має пріоритет над hint', () => {
    render(<Input error="error" hint="hint" />);
    expect(screen.getByText('error')).toBeInTheDocument();
    expect(screen.queryByText('hint')).not.toBeInTheDocument();
  });

  it('disabled додає клас і блокує input', () => {
    const { container } = render(<Input disabled />);
    expect(container.querySelector('.ui-input--disabled')).toBeInTheDocument();
    expect(container.querySelector('input').disabled).toBe(true);
  });

  it('multiline рендерить textarea', () => {
    const { container } = render(<Input multiline rows={5} />);
    const ta = container.querySelector('textarea');
    expect(ta).toBeInTheDocument();
    expect(ta.rows).toBe(5);
  });

  it('focus додає клас ui-input--focused, blur знімає', () => {
    const { container } = render(<Input />);
    const input = container.querySelector('input');
    fireEvent.focus(input);
    expect(container.querySelector('.ui-input--focused')).toBeInTheDocument();
    fireEvent.blur(input);
    expect(container.querySelector('.ui-input--focused')).not.toBeInTheDocument();
  });

  it('icon рендериться ліворуч від поля', () => {
    render(<Input icon={<span data-testid="ic" />} />);
    expect(screen.getByTestId('ic')).toBeInTheDocument();
  });

  it('type=date передається на native input', () => {
    const { container } = render(<Input type="date" />);
    expect(container.querySelector('input').type).toBe('date');
  });
});
