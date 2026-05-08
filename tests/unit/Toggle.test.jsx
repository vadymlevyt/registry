// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toggle } from '../../src/components/UI/Toggle.jsx';

describe('Toggle', () => {
  it('рендерить label коли передано', () => {
    render(<Toggle checked={false} onChange={() => {}} label="Drive sync" />);
    expect(screen.getByText('Drive sync')).toBeInTheDocument();
  });

  it('description показується разом з label', () => {
    render(
      <Toggle
        checked={false}
        onChange={() => {}}
        label="Voice"
        description="Активувати голосовий ввід"
      />
    );
    expect(screen.getByText('Voice')).toBeInTheDocument();
    expect(screen.getByText('Активувати голосовий ввід')).toBeInTheDocument();
  });

  it('checked=true додає клас --checked', () => {
    const { container } = render(<Toggle checked onChange={() => {}} />);
    expect(container.querySelector('.ui-toggle--checked')).toBeInTheDocument();
  });

  it('клік викликає onChange зі зміненим boolean (false → true)', () => {
    const onChange = vi.fn();
    const { container } = render(<Toggle checked={false} onChange={onChange} />);
    fireEvent.click(container.querySelector('input'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('клік викликає onChange (true → false)', () => {
    const onChange = vi.fn();
    const { container } = render(<Toggle checked={true} onChange={onChange} />);
    fireEvent.click(container.querySelector('input'));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('disabled=true блокує input і додає клас', () => {
    const onChange = vi.fn();
    const { container } = render(<Toggle checked={false} onChange={onChange} disabled />);
    expect(container.querySelector('.ui-toggle--disabled')).toBeInTheDocument();
    expect(container.querySelector('input').disabled).toBe(true);
  });

  it('size=sm додає клас', () => {
    const { container } = render(<Toggle checked onChange={() => {}} size="sm" />);
    expect(container.querySelector('.ui-toggle--sm')).toBeInTheDocument();
  });

  it('за замовчуванням size=md', () => {
    const { container } = render(<Toggle checked onChange={() => {}} />);
    expect(container.querySelector('.ui-toggle--md')).toBeInTheDocument();
  });
});
