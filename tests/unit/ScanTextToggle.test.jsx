// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScanTextToggle } from '../../src/components/DocumentViewer/ScanTextToggle.jsx';

describe('ScanTextToggle', () => {
  it('рендерить два варіанти Скан / Текст', () => {
    render(<ScanTextToggle mode="scan" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: /Скан/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Текст/ })).toBeInTheDocument();
  });

  it('mode=scan → активний Скан', () => {
    render(<ScanTextToggle mode="scan" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: /Скан/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Текст/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('mode=text → активний Текст', () => {
    render(<ScanTextToggle mode="text" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: /Текст/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Скан/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('клік на Текст викликає onChange("text")', () => {
    const onChange = vi.fn();
    render(<ScanTextToggle mode="scan" onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: /Текст/ }));
    expect(onChange).toHaveBeenCalledWith('text');
  });

  it('клік на Скан викликає onChange("scan")', () => {
    const onChange = vi.fn();
    render(<ScanTextToggle mode="text" onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: /Скан/ }));
    expect(onChange).toHaveBeenCalledWith('scan');
  });

  it('за замовчуванням опція «Точний» прихована', () => {
    render(<ScanTextToggle mode="scan" onChange={() => {}} />);
    expect(screen.queryByRole('tab', { name: /Точний/ })).toBeNull();
  });

  it('showExact=true → з\'являється опція «Точний»', () => {
    render(<ScanTextToggle mode="scan" onChange={() => {}} showExact />);
    expect(screen.getByRole('tab', { name: /Точний/ })).toBeInTheDocument();
  });

  it('mode=exact → активний Точний', () => {
    render(<ScanTextToggle mode="exact" onChange={() => {}} showExact />);
    expect(screen.getByRole('tab', { name: /Точний/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Скан/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('клік на Точний викликає onChange("exact")', () => {
    const onChange = vi.fn();
    render(<ScanTextToggle mode="scan" onChange={onChange} showExact />);
    fireEvent.click(screen.getByRole('tab', { name: /Точний/ }));
    expect(onChange).toHaveBeenCalledWith('exact');
  });
});
