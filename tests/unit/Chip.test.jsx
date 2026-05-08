// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Chip } from '../../src/components/UI/Chip.jsx';

describe('Chip', () => {
  it('рендерить текст children', () => {
    render(<Chip>Тег</Chip>);
    expect(screen.getByText('Тег')).toBeInTheDocument();
  });

  it('за замовчуванням variant=default, size=sm', () => {
    const { container } = render(<Chip>x</Chip>);
    expect(container.querySelector('.ui-chip--default')).toBeInTheDocument();
    expect(container.querySelector('.ui-chip--sm')).toBeInTheDocument();
  });

  it.each(['default', 'accent', 'success', 'warning', 'danger'])('variant=%s додає клас', (variant) => {
    const { container } = render(<Chip variant={variant}>x</Chip>);
    expect(container.querySelector(`.ui-chip--${variant}`)).toBeInTheDocument();
  });

  it('size=md додає клас', () => {
    const { container } = render(<Chip size="md">x</Chip>);
    expect(container.querySelector('.ui-chip--md')).toBeInTheDocument();
  });

  it('removable=true показує × кнопку', () => {
    render(<Chip removable onRemove={() => {}}>Tag</Chip>);
    expect(screen.getByLabelText('Видалити')).toBeInTheDocument();
  });

  it('removable=false → без × кнопки', () => {
    render(<Chip>Tag</Chip>);
    expect(screen.queryByLabelText('Видалити')).not.toBeInTheDocument();
  });

  it('клік на × викликає onRemove', () => {
    const onRemove = vi.fn();
    render(<Chip removable onRemove={onRemove}>Tag</Chip>);
    fireEvent.click(screen.getByLabelText('Видалити'));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('клік на × НЕ тригерить onClick (stopPropagation)', () => {
    const onClick = vi.fn();
    const onRemove = vi.fn();
    render(<Chip onClick={onClick} removable onRemove={onRemove}>Tag</Chip>);
    fireEvent.click(screen.getByLabelText('Видалити'));
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('onClick робить chip clickable (клас + виклик)', () => {
    const onClick = vi.fn();
    const { container } = render(<Chip onClick={onClick}>Tag</Chip>);
    expect(container.querySelector('.ui-chip--clickable')).toBeInTheDocument();
    fireEvent.click(container.querySelector('.ui-chip'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('proceeding variant з color встановлює CSS-змінну --chip-color', () => {
    const { container } = render(<Chip variant="proceeding" color="#22c55e">Перша</Chip>);
    const chip = container.querySelector('.ui-chip--proceeding');
    expect(chip.style.getPropertyValue('--chip-color')).toBe('#22c55e');
  });

  it('icon рендериться у обгортці', () => {
    render(<Chip icon={<span data-testid="ic" />}>Tag</Chip>);
    expect(screen.getByTestId('ic')).toBeInTheDocument();
  });
});
