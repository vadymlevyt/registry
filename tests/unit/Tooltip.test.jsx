// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Tooltip } from '../../src/components/UI/Tooltip.jsx';

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('показує content після hover з затримкою', () => {
    render(
      <Tooltip content="Підказка" delay={500}>
        <button>Trigger</button>
      </Tooltip>
    );
    // одразу — нічого
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByText('Trigger').parentElement);
    // ще нічого до закінчення delay
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByText('Підказка')).toBeInTheDocument();
  });

  it('mouseLeave ховає tooltip', () => {
    const { container } = render(
      <Tooltip content="X" delay={100}>
        <button>T</button>
      </Tooltip>
    );
    const wrapper = container.querySelector('.ui-tooltip-wrapper');
    fireEvent.mouseEnter(wrapper);
    act(() => { vi.advanceTimersByTime(100); });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('placement додає відповідний клас', () => {
    const { container } = render(
      <Tooltip content="X" delay={0} placement="bottom">
        <button>T</button>
      </Tooltip>
    );
    fireEvent.mouseEnter(container.querySelector('.ui-tooltip-wrapper'));
    act(() => { vi.advanceTimersByTime(0); });
    expect(container.querySelector('.ui-tooltip--bottom')).toBeInTheDocument();
  });

  it('за замовчуванням placement=top', () => {
    const { container } = render(
      <Tooltip content="X" delay={0}>
        <button>T</button>
      </Tooltip>
    );
    fireEvent.mouseEnter(container.querySelector('.ui-tooltip-wrapper'));
    act(() => { vi.advanceTimersByTime(0); });
    expect(container.querySelector('.ui-tooltip--top')).toBeInTheDocument();
  });

  it('disabled=true НЕ показує tooltip', () => {
    const { container } = render(
      <Tooltip content="X" delay={0} disabled>
        <button>T</button>
      </Tooltip>
    );
    fireEvent.mouseEnter(container.querySelector('.ui-tooltip-wrapper'));
    act(() => { vi.advanceTimersByTime(100); });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('focus показує tooltip (a11y — клавіатура)', () => {
    const { container } = render(
      <Tooltip content="X" delay={0}>
        <button>T</button>
      </Tooltip>
    );
    fireEvent.focus(container.querySelector('.ui-tooltip-wrapper'));
    act(() => { vi.advanceTimersByTime(0); });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('blur ховає tooltip', () => {
    const { container } = render(
      <Tooltip content="X" delay={0}>
        <button>T</button>
      </Tooltip>
    );
    const wrapper = container.querySelector('.ui-tooltip-wrapper');
    fireEvent.focus(wrapper);
    act(() => { vi.advanceTimersByTime(0); });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.blur(wrapper);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('mouseLeave до закінчення delay скасовує показ (cleanup timera)', () => {
    const { container } = render(
      <Tooltip content="X" delay={500}>
        <button>T</button>
      </Tooltip>
    );
    const wrapper = container.querySelector('.ui-tooltip-wrapper');
    fireEvent.mouseEnter(wrapper);
    act(() => { vi.advanceTimersByTime(200); });
    fireEvent.mouseLeave(wrapper);
    act(() => { vi.advanceTimersByTime(500); });
    // tooltip не з'явився, бо timer скасовано
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('children рендеряться завжди', () => {
    render(
      <Tooltip content="X">
        <button>тригер</button>
      </Tooltip>
    );
    expect(screen.getByText('тригер')).toBeInTheDocument();
  });
});
