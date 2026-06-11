// @vitest-environment jsdom
// InlineEditableText — inline-редагування name/client справи
// (TASK represented_parties_and_manual_edit, Зміна C).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineEditableText } from '../../src/components/UI/InlineEditableText.jsx';

describe('InlineEditableText', () => {
  it('рендерить значення як текст (не input)', () => {
    const { container } = render(<InlineEditableText value="Бабенко О.І." onSave={() => {}} />);
    expect(screen.getByText('Бабенко О.І.')).toBeInTheDocument();
    expect(container.querySelector('input')).toBeNull();
  });

  it('порожнє значення → placeholder', () => {
    render(<InlineEditableText value={null} placeholder="клієнт не вказаний" onSave={() => {}} />);
    expect(screen.getByText('клієнт не вказаний')).toBeInTheDocument();
  });

  it('клік → input з поточним значенням', () => {
    const { container } = render(<InlineEditableText value="Стара назва" onSave={() => {}} ariaLabel="Назва" />);
    fireEvent.click(screen.getByText('Стара назва'));
    const input = container.querySelector('input');
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('Стара назва');
  });

  it('Enter зберігає нове значення через onSave', () => {
    const onSave = vi.fn();
    const { container } = render(<InlineEditableText value="Стара" onSave={onSave} />);
    fireEvent.click(screen.getByText('Стара'));
    const input = container.querySelector('input');
    fireEvent.change(input, { target: { value: 'Нова' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith('Нова');
    expect(container.querySelector('input')).toBeNull(); // вийшли з редагування
  });

  it('blur теж зберігає', () => {
    const onSave = vi.fn();
    const { container } = render(<InlineEditableText value="Стара" onSave={onSave} />);
    fireEvent.click(screen.getByText('Стара'));
    const input = container.querySelector('input');
    fireEvent.change(input, { target: { value: 'Через blur' } });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledWith('Через blur');
  });

  it('Esc скасовує БЕЗ збереження', () => {
    const onSave = vi.fn();
    const { container } = render(<InlineEditableText value="Стара" onSave={onSave} />);
    fireEvent.click(screen.getByText('Стара'));
    const input = container.querySelector('input');
    fireEvent.change(input, { target: { value: 'Не зберігати' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onSave).not.toHaveBeenCalled();
    expect(container.querySelector('input')).toBeNull();
    expect(screen.getByText('Стара')).toBeInTheDocument();
  });

  it('незмінене значення не викликає onSave (нуль порожніх правок)', () => {
    const onSave = vi.fn();
    const { container } = render(<InlineEditableText value="Та сама" onSave={onSave} />);
    fireEvent.click(screen.getByText('Та сама'));
    fireEvent.keyDown(container.querySelector('input'), { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('allowEmpty=false: порожній draft скасовує (захист name від стирання)', () => {
    const onSave = vi.fn();
    const { container } = render(<InlineEditableText value="Назва" onSave={onSave} allowEmpty={false} />);
    fireEvent.click(screen.getByText('Назва'));
    const input = container.querySelector('input');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('allowEmpty=true (default): можна очистити client', () => {
    const onSave = vi.fn();
    const { container } = render(<InlineEditableText value="Клієнт" onSave={onSave} />);
    fireEvent.click(screen.getByText('Клієнт'));
    const input = container.querySelector('input');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith('');
  });
});
