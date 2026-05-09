// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Checkbox } from '../../src/components/UI/Checkbox.jsx';

describe('Checkbox', () => {
  it('рендериться з міткою', () => {
    render(<Checkbox checked={false} onChange={() => {}} label="Виділити" />);
    expect(screen.getByText('Виділити')).toBeInTheDocument();
  });

  it('checked стан додає клас', () => {
    const { container } = render(<Checkbox checked={true} onChange={() => {}} />);
    expect(container.querySelector('.ui-checkbox--checked')).toBeInTheDocument();
  });

  it('onChange викликається з новим boolean', () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="X" />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('indeterminate показує риску замість галочки', () => {
    const { container } = render(<Checkbox checked={false} indeterminate={true} onChange={() => {}} />);
    expect(container.querySelector('.ui-checkbox--indeterminate')).toBeInTheDocument();
    expect(container.querySelector('.ui-checkbox__dash')).toBeInTheDocument();
  });

  it('disabled блокує input', () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} disabled label="X" />);
    const input = screen.getByRole('checkbox');
    expect(input.disabled).toBe(true);
  });
});
