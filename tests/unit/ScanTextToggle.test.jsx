// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Image, AlignLeft, Wand2, ScrollText } from 'lucide-react';
import { ScanTextToggle } from '../../src/components/DocumentViewer/ScanTextToggle.jsx';

// Набори вкладок V2-B (DocumentViewer рахує їх; тут передаємо напряму).
const scannedTabs = [
  { value: 'scan', label: 'Скан', icon: Image },
  { value: 'exact', label: 'Точний', icon: AlignLeft },
  { value: 'clean', label: 'Чистий', icon: Wand2, ai: true, ready: false },
  { value: 'digest', label: 'Конспект', icon: ScrollText, ai: true, ready: false, badge: 'переказ' },
];

describe('ScanTextToggle (V2-B — перемикач режимів)', () => {
  it('рендерить переданий набір вкладок, без «Текст»', () => {
    render(<ScanTextToggle tabs={scannedTabs} mode="scan" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: /Скан/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Точний/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Чистий/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Конспект/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^Текст$/ })).toBeNull();
  });

  it('mode визначає активну вкладку', () => {
    render(<ScanTextToggle tabs={scannedTabs} mode="exact" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: /Точний/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Скан/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('клік по вкладці викликає onChange зі значенням value', () => {
    const onChange = vi.fn();
    render(<ScanTextToggle tabs={scannedTabs} mode="scan" onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: /Конспект/ }));
    expect(onChange).toHaveBeenCalledWith('digest');
  });

  it('badge «переказ» показується на Конспекті', () => {
    render(<ScanTextToggle tabs={scannedTabs} mode="scan" onChange={() => {}} />);
    expect(screen.getByText('переказ')).toBeInTheDocument();
  });

  it('searchable-набір: лише Документ + Конспект', () => {
    const searchableTabs = [
      { value: 'scan', label: 'Документ', icon: Image },
      { value: 'digest', label: 'Конспект', icon: ScrollText, ai: true, ready: false, badge: 'переказ' },
    ];
    render(<ScanTextToggle tabs={searchableTabs} mode="scan" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: /Документ/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Конспект/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Скан/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: /Точний/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: /Чистий/ })).toBeNull();
  });

  it('порожній tabs → нічого не падає', () => {
    render(<ScanTextToggle tabs={[]} mode="scan" onChange={() => {}} />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });
});
