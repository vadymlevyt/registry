// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../../src/components/UI/Button.jsx';

describe('Button', () => {
  it('рендерить текст children', () => {
    render(<Button>Зберегти</Button>);
    expect(screen.getByText('Зберегти')).toBeInTheDocument();
  });

  it('викликає onClick при кліку', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByText('Click'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('НЕ викликає onClick коли disabled', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByText('Click'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('НЕ викликає onClick коли loading', () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByText('Click'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('застосовує клас варіанту (danger)', () => {
    const { container } = render(<Button variant="danger">X</Button>);
    expect(container.querySelector('.ui-button--danger')).toBeInTheDocument();
  });

  it('за замовчуванням variant=primary, size=md', () => {
    const { container } = render(<Button>X</Button>);
    expect(container.querySelector('.ui-button--primary')).toBeInTheDocument();
    expect(container.querySelector('.ui-button--md')).toBeInTheDocument();
  });

  it('застосовує клас розміру (lg)', () => {
    const { container } = render(<Button size="lg">X</Button>);
    expect(container.querySelector('.ui-button--lg')).toBeInTheDocument();
  });

  it('fullWidth додає клас ui-button--full', () => {
    const { container } = render(<Button fullWidth>X</Button>);
    expect(container.querySelector('.ui-button--full')).toBeInTheDocument();
  });

  it('loading рендерить spinner і ховає icon', () => {
    const { container } = render(<Button loading icon={<span data-testid="ic" />}>X</Button>);
    expect(container.querySelector('.ui-button__spinner')).toBeInTheDocument();
    expect(screen.queryByTestId('ic')).not.toBeInTheDocument();
  });

  it('icon і iconRight рендеряться у обгортках', () => {
    render(<Button icon={<span data-testid="left" />} iconRight={<span data-testid="right" />}>X</Button>);
    expect(screen.getByTestId('left')).toBeInTheDocument();
    expect(screen.getByTestId('right')).toBeInTheDocument();
  });

  it('type за замовчуванням button (захист від випадкового submit у формі)', () => {
    const { container } = render(<Button>X</Button>);
    expect(container.querySelector('button').type).toBe('button');
  });

  it('type=submit передається на native button', () => {
    const { container } = render(<Button type="submit">X</Button>);
    expect(container.querySelector('button').type).toBe('submit');
  });

  it('додатковий className мерджиться з ui-button*', () => {
    const { container } = render(<Button className="my-extra">X</Button>);
    const btn = container.querySelector('button');
    expect(btn.className).toContain('ui-button');
    expect(btn.className).toContain('my-extra');
  });
});
