// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from '../../src/components/UI/Modal.jsx';

describe('Modal', () => {
  it('isOpen=false → не рендериться', () => {
    const { container } = render(
      <Modal isOpen={false} onClose={() => {}}>зміст</Modal>
    );
    expect(container.firstChild).toBeNull();
  });

  it('isOpen=true → рендериться backdrop + modal + body', () => {
    render(
      <Modal isOpen onClose={() => {}}>контент</Modal>
    );
    expect(screen.getByText('контент')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('title рендериться як <h2>', () => {
    render(<Modal isOpen onClose={() => {}} title="Підтвердження">x</Modal>);
    expect(screen.getByRole('heading', { name: 'Підтвердження' })).toBeInTheDocument();
  });

  it('actions рендеряться внизу', () => {
    render(
      <Modal isOpen onClose={() => {}} actions={<button data-testid="ok">OK</button>}>
        x
      </Modal>
    );
    expect(screen.getByTestId('ok')).toBeInTheDocument();
  });

  it('клік на × викликає onClose', () => {
    const onClose = vi.fn();
    render(<Modal isOpen onClose={onClose} title="Title">x</Modal>);
    fireEvent.click(screen.getByLabelText('Закрити'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('клік на backdrop викликає onClose (якщо closeOnBackdrop=true default)', () => {
    const onClose = vi.fn();
    const { container } = render(<Modal isOpen onClose={onClose}>x</Modal>);
    fireEvent.click(container.querySelector('.ui-modal-backdrop'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closeOnBackdrop=false → клік на backdrop НЕ закриває', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal isOpen onClose={onClose} closeOnBackdrop={false}>x</Modal>
    );
    fireEvent.click(container.querySelector('.ui-modal-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('клік усередині modal НЕ закриває (stopPropagation)', () => {
    const onClose = vi.fn();
    render(<Modal isOpen onClose={onClose}>контент</Modal>);
    fireEvent.click(screen.getByText('контент'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape key викликає onClose', () => {
    const onClose = vi.fn();
    render(<Modal isOpen onClose={onClose}>x</Modal>);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closeOnEscape=false → Escape НЕ закриває', () => {
    const onClose = vi.fn();
    render(<Modal isOpen onClose={onClose} closeOnEscape={false}>x</Modal>);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('size додає клас (sm/md/lg)', () => {
    const { container, rerender } = render(<Modal isOpen onClose={() => {}} size="sm">x</Modal>);
    expect(container.querySelector('.ui-modal--sm')).toBeInTheDocument();
    rerender(<Modal isOpen onClose={() => {}} size="lg">x</Modal>);
    expect(container.querySelector('.ui-modal--lg')).toBeInTheDocument();
  });
});
