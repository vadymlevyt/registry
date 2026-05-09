// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Banner } from '../../src/components/UI/Banner.jsx';

describe('Banner', () => {
  it('рендерить title і description', () => {
    render(<Banner variant="warning" title="Drive не підключено" description="Підключіть у налаштуваннях" />);
    expect(screen.getByText('Drive не підключено')).toBeInTheDocument();
    expect(screen.getByText('Підключіть у налаштуваннях')).toBeInTheDocument();
  });

  it.each(['success', 'error', 'warning', 'info'])('variant=%s додає клас', (variant) => {
    const { container } = render(<Banner variant={variant} title="X" />);
    expect(container.querySelector(`.ui-banner--${variant}`)).toBeInTheDocument();
  });

  it('за замовчуванням variant=info', () => {
    const { container } = render(<Banner title="X" />);
    expect(container.querySelector('.ui-banner--info')).toBeInTheDocument();
  });

  it('actions рендеряться як Button', () => {
    const onClick = vi.fn();
    render(
      <Banner
        variant="warning"
        title="X"
        actions={[{ label: 'Підключити', onClick }]}
      />
    );
    fireEvent.click(screen.getByText('Підключити'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('кілька actions рендеряться', () => {
    render(
      <Banner
        variant="warning"
        title="X"
        actions={[
          { label: 'А', onClick: () => {} },
          { label: 'Б', onClick: () => {} },
        ]}
      />
    );
    expect(screen.getByText('А')).toBeInTheDocument();
    expect(screen.getByText('Б')).toBeInTheDocument();
  });

  it('dismissible=false → × НЕ показується', () => {
    render(<Banner title="X" />);
    expect(screen.queryByLabelText('Закрити')).not.toBeInTheDocument();
  });

  it('dismissible=true → × показується і викликає onDismiss', () => {
    const onDismiss = vi.fn();
    render(<Banner title="X" dismissible onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText('Закрити'));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('role="status"', () => {
    render(<Banner title="X" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
