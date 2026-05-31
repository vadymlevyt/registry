// @vitest-environment jsdom
//
// Спільний індикатор прогресу ProcessingProgress (борг #34, правило #30).
// Споживачі: модалка ProcessingView (screen + stepper) і DP startup (badge).

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProcessingProgress } from '../../src/components/ImageEditor/ProcessingProgress.jsx';

const STEPS = [
  { key: 'preparing', label: 'Підготовка' },
  { key: 'ocr', label: 'OCR' },
  { key: 'pdf', label: 'PDF' },
];

describe('ProcessingProgress — screen + stepper (модалка)', () => {
  it('лейбл активної фази, лічильник, заповнення бару, стани кроків', () => {
    const { container } = render(
      <ProcessingProgress variant="screen" phase="ocr" done={3} total={10} steps={STEPS} />,
    );
    // Лейбл активної фази (елемент label, не плутати з кроком stepper'а).
    expect(container.querySelector('.image-editor__progress-label').textContent).toMatch(/OCR/);
    expect(screen.getByText('3 / 10')).toBeTruthy();
    const fill = container.querySelector('.image-editor__progress-bar-fill');
    expect(fill.style.width).toBe('30%');
    // Крок до активного — done, активний — active, після — pending.
    expect(container.querySelector('.image-editor__progress-step--done')).toBeTruthy();
    expect(container.querySelector('.image-editor__progress-step--active').textContent).toMatch(/OCR/);
    expect(container.querySelector('.image-editor__progress-step--pending').textContent).toMatch(/PDF/);
  });

  it('done === total → лічильник прихований (фаза завершена)', () => {
    render(<ProcessingProgress variant="screen" phase="pdf" done={10} total={10} steps={STEPS} />);
    expect(screen.queryByText('10 / 10')).toBeNull();
  });
});

describe('ProcessingProgress — badge (DP startup)', () => {
  it('явний лейбл + лічильник + бар, без stepper', () => {
    const { container } = render(
      <ProcessingProgress variant="badge" label="Аналіз країв документів…" done={2} total={5} />,
    );
    expect(screen.getByText('Аналіз країв документів…')).toBeTruthy();
    expect(screen.getByText('2 / 5')).toBeTruthy();
    expect(container.querySelector('.image-editor__progress--badge')).toBeTruthy();
    expect(container.querySelector('.image-editor__progress-stepper')).toBeNull();
    expect(container.querySelector('.image-editor__progress-bar-fill').style.width).toBe('40%');
  });

  it('total === 0 → бар не рендериться, fallback-лейбл', () => {
    const { container } = render(<ProcessingProgress variant="badge" done={0} total={0} />);
    expect(container.querySelector('.image-editor__progress-bar')).toBeNull();
    expect(screen.getByText('Обробка…')).toBeTruthy();
  });
});
