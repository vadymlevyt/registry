// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs } from '../../src/components/UI/Tabs.jsx';

const TABS = [
  { id: 'overview', label: 'Огляд' },
  { id: 'materials', label: 'Матеріали', badge: 24 },
  { id: 'work', label: 'Робота', disabled: true },
];

describe('Tabs', () => {
  it('рендерить усі вкладки', () => {
    render(<Tabs tabs={TABS} activeId="overview" onChange={() => {}} />);
    expect(screen.getByText('Огляд')).toBeInTheDocument();
    expect(screen.getByText('Матеріали')).toBeInTheDocument();
    expect(screen.getByText('Робота')).toBeInTheDocument();
  });

  it('badge рендериться біля вкладки', () => {
    render(<Tabs tabs={TABS} activeId="overview" onChange={() => {}} />);
    expect(screen.getByText('24')).toBeInTheDocument();
  });

  it('aria-selected=true тільки на активній вкладці', () => {
    render(<Tabs tabs={TABS} activeId="materials" onChange={() => {}} />);
    const active = screen.getByText('Матеріали').closest('button');
    const inactive = screen.getByText('Огляд').closest('button');
    expect(active.getAttribute('aria-selected')).toBe('true');
    expect(inactive.getAttribute('aria-selected')).toBe('false');
  });

  it('активна вкладка має клас --active', () => {
    const { container } = render(<Tabs tabs={TABS} activeId="overview" onChange={() => {}} />);
    expect(container.querySelector('.ui-tabs__tab--active')).toBeInTheDocument();
  });

  it('клік на вкладку викликає onChange з її id', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} activeId="overview" onChange={onChange} />);
    fireEvent.click(screen.getByText('Матеріали'));
    expect(onChange).toHaveBeenCalledWith('materials');
  });

  it('disabled tab не клікабельна — onChange не викликається', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} activeId="overview" onChange={onChange} />);
    fireEvent.click(screen.getByText('Робота'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disabled tab отримує клас --disabled', () => {
    const { container } = render(<Tabs tabs={TABS} activeId="overview" onChange={() => {}} />);
    expect(container.querySelector('.ui-tabs__tab--disabled')).toBeInTheDocument();
  });

  it('variant=pills додає клас і вимикає bottom-border', () => {
    const { container } = render(<Tabs tabs={TABS} activeId="overview" onChange={() => {}} variant="pills" />);
    expect(container.querySelector('.ui-tabs--pills')).toBeInTheDocument();
  });

  it('за замовчуванням variant=default', () => {
    const { container } = render(<Tabs tabs={TABS} activeId="overview" onChange={() => {}} />);
    expect(container.querySelector('.ui-tabs--default')).toBeInTheDocument();
  });

  it('fullWidth додає клас --full', () => {
    const { container } = render(<Tabs tabs={TABS} activeId="overview" onChange={() => {}} fullWidth />);
    expect(container.querySelector('.ui-tabs--full')).toBeInTheDocument();
  });

  it('icon рендериться у обгортці', () => {
    const tabs = [{ id: 'x', label: 'X', icon: <span data-testid="ic" /> }];
    render(<Tabs tabs={tabs} activeId="x" onChange={() => {}} />);
    expect(screen.getByTestId('ic')).toBeInTheDocument();
  });

  it('role="tablist" і role="tab" виставлені', () => {
    const { container } = render(<Tabs tabs={TABS} activeId="overview" onChange={() => {}} />);
    expect(container.querySelector('[role="tablist"]')).toBeInTheDocument();
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(3);
  });
});
