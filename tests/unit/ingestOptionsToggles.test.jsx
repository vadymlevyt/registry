// @vitest-environment jsdom
// Юніт-тести спільних тумблерів додавання (TASK 4 rework · Стадія B).
// Контракт: канонічний текст (один для модалки і DP) + проброс checked/onChange.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  OcrToggle, CompressToggle, INGEST_TOGGLE_COPY,
} from '../../src/components/DocumentIngest/IngestOptionsToggles.jsx';

describe('INGEST_TOGGLE_COPY — канонічний текст', () => {
  it('має noOcr і compress з label+description', () => {
    expect(INGEST_TOGGLE_COPY.noOcr.label).toBe('Без розпізнавання тексту');
    expect(INGEST_TOGGLE_COPY.compress.label).toBe('Стиснути файли');
    expect(typeof INGEST_TOGGLE_COPY.noOcr.description).toBe('string');
    expect(typeof INGEST_TOGGLE_COPY.compress.description).toBe('string');
  });
});

describe('OcrToggle', () => {
  it('рендерить канонічний label і description', () => {
    render(<OcrToggle checked={false} onChange={() => {}} />);
    expect(screen.getByText(INGEST_TOGGLE_COPY.noOcr.label)).toBeInTheDocument();
    expect(screen.getByText(INGEST_TOGGLE_COPY.noOcr.description)).toBeInTheDocument();
  });

  it('клік пробрасує onChange', () => {
    const onChange = vi.fn();
    const { container } = render(<OcrToggle checked={false} onChange={onChange} />);
    fireEvent.click(container.querySelector('.ui-toggle'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('CompressToggle', () => {
  it('рендерить канонічний label', () => {
    render(<CompressToggle checked={false} onChange={() => {}} />);
    expect(screen.getByText(INGEST_TOGGLE_COPY.compress.label)).toBeInTheDocument();
  });

  it('checked=true відображає стан', () => {
    const { container } = render(<CompressToggle checked onChange={() => {}} />);
    expect(container.querySelector('.ui-toggle--checked')).toBeInTheDocument();
  });
});
