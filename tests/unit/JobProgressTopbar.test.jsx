// @vitest-environment jsdom
// DP-3 — JobProgressTopbar: зʼявляється лише при активних jobs, прогрес,
// розгортання, скасування. Responsive — CSS (тут — логіка/рендер).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import JobProgressTopbar from '../../src/components/JobProgressTopbar/index.jsx';
import * as store from '../../src/services/documentPipeline/jobProgressStore.js';

describe('JobProgressTopbar', () => {
  beforeEach(() => store._resetForTests());

  it('нема jobs → топбар відсутній (нічого не рендерить)', () => {
    const { container } = render(<JobProgressTopbar />);
    expect(container.firstChild).toBeNull();
  });

  it('активний job → показує назву, відсоток, ETA', () => {
    store.startJob({ jobId: 'j1', caseId: 'c1', title: 'Пакет: 3 файлів', total: 4 });
    store.updateJob('j1', { done: 1, etaMs: 90000 });
    render(<JobProgressTopbar />);
    expect(screen.getByText(/Пакет: 3 файлів/)).toBeInTheDocument();
    expect(screen.getByText(/25%/)).toBeInTheDocument();
    expect(screen.getByText(/~1 хв/)).toBeInTheDocument();
  });

  it('кілька jobs → агрегат (+N)', () => {
    store.startJob({ jobId: 'j1', title: 'A', total: 2 });
    store.startJob({ jobId: 'j2', title: 'B', total: 2 });
    render(<JobProgressTopbar />);
    expect(screen.getByText(/A \(\+1\)/)).toBeInTheDocument();
  });

  it('Розгорнути → викликає onExpand (повний екран — окремий компонент)', () => {
    store.startJob({ jobId: 'j1', title: 'Том 250 стор', total: 10 });
    store.updateJob('j1', { done: 5 });
    const onExpand = vi.fn();
    render(<JobProgressTopbar onExpand={onExpand} />);
    fireEvent.click(screen.getByText('Розгорнути'));
    expect(onExpand).toHaveBeenCalled();
    // Стара заглушка-модалка більше не існує (Bug 2/3).
    expect(screen.queryByText('Фонова обробка')).toBeNull();
  });

  it('onCancel рендериться лише коли передано; клік передає jobId', () => {
    store.startJob({ jobId: 'jX', title: 'T', total: 1 });
    const onCancel = vi.fn();
    const { rerender } = render(<JobProgressTopbar />);
    expect(screen.queryByText('Скасувати')).toBeNull();         // нема handler — нема контролу
    rerender(<JobProgressTopbar onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Скасувати'));
    expect(onCancel).toHaveBeenCalledWith('jX');
  });

  it('finishJob прибирає → топбар зникає', () => {
    store.startJob({ jobId: 'j1', title: 'T', total: 1 });
    const { container } = render(<JobProgressTopbar />);
    expect(container.firstChild).not.toBeNull();
    act(() => store.finishJob('j1'));
    expect(container.firstChild).toBeNull();
  });
});
