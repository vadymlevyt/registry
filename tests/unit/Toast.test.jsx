// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toast } from '../../src/components/UI/Toast.jsx';

describe('Toast', () => {
  it('рендерить title', () => {
    render(<Toast variant="success" title="Збережено" />);
    expect(screen.getByText('Збережено')).toBeInTheDocument();
  });

  it('description показується якщо передано', () => {
    render(<Toast variant="info" title="X" description="детальний опис" />);
    expect(screen.getByText('детальний опис')).toBeInTheDocument();
  });

  it.each([
    ['success'],
    ['error'],
    ['warning'],
    ['info'],
  ])('variant=%s додає клас', (variant) => {
    const { container } = render(<Toast variant={variant} title="X" />);
    expect(container.querySelector(`.ui-toast--${variant}`)).toBeInTheDocument();
  });

  it('role="alert" для accessibility', () => {
    render(<Toast variant="info" title="X" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('× кнопка викликає onDismiss', () => {
    const onDismiss = vi.fn();
    render(<Toast variant="info" title="X" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText('Закрити'));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('action кнопка викликає action.onClick + onDismiss', () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    render(
      <Toast
        variant="error"
        title="X"
        action={{ label: 'Спробувати ще', onClick }}
        onDismiss={onDismiss}
      />
    );
    fireEvent.click(screen.getByText('Спробувати ще'));
    expect(onClick).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('action не рендериться без action prop', () => {
    render(<Toast variant="info" title="X" />);
    expect(screen.queryByRole('button', { name: /Спробувати/ })).not.toBeInTheDocument();
  });

  it('description не рендериться якщо не передано', () => {
    const { container } = render(<Toast variant="info" title="X" />);
    expect(container.querySelector('.ui-toast__description')).not.toBeInTheDocument();
  });
});
