// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Card } from '../../src/components/UI/Card.jsx';

describe('Card', () => {
  it('рендерить children', () => {
    render(<Card>Текст карти</Card>);
    expect(screen.getByText('Текст карти')).toBeInTheDocument();
  });

  it('default variant — клас ui-card без --interactive', () => {
    const { container } = render(<Card>x</Card>);
    expect(container.querySelector('.ui-card')).toBeInTheDocument();
    expect(container.querySelector('.ui-card--interactive')).not.toBeInTheDocument();
  });

  it('variant=interactive додає клас і робить клікабельною', () => {
    const onClick = vi.fn();
    const { container } = render(
      <Card variant="interactive" onClick={onClick}>x</Card>
    );
    expect(container.querySelector('.ui-card--interactive')).toBeInTheDocument();
    fireEvent.click(container.querySelector('.ui-card'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('додатковий className мерджиться', () => {
    const { container } = render(<Card className="мій-клас">x</Card>);
    const card = container.querySelector('.ui-card');
    expect(card.className).toContain('мій-клас');
  });

  it('leftBorderColor встановлює borderLeftColor у style', () => {
    const { container } = render(
      <Card leftBorderColor="var(--color-proceeding-appeal)">x</Card>
    );
    const card = container.querySelector('.ui-card');
    expect(card.style.borderLeftColor).toBeTruthy();
    expect(card.style.borderLeftWidth).toBe('3px');
  });

  it('без leftBorderColor — style не задається', () => {
    const { container } = render(<Card>x</Card>);
    const card = container.querySelector('.ui-card');
    expect(card.style.borderLeftColor).toBe('');
  });

  it('rest props (data-*) пробрасуються', () => {
    const { container } = render(<Card data-testid="my-card">x</Card>);
    expect(container.querySelector('[data-testid="my-card"]')).toBeInTheDocument();
  });
});
