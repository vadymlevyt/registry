// @vitest-environment jsdom
// V2-C — чип «N поміток» + панель у в'ювері ВИКЛЮЧНО для режиму Чистий.
// Рендеримо DocumentViewerContent напряму (VariantContent) з мокнутим
// ocrService.getVariantMarkdown (текст із ==мітками==).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DocumentViewerContent } from '../../src/components/DocumentViewer/DocumentViewerContent.jsx';

const getVariantMarkdown = vi.fn();
vi.mock('../../src/services/ocrService.js', () => ({
  getCleanOrRawText: vi.fn().mockResolvedValue(null),
  getVariantMarkdown: (...a) => getVariantMarkdown(...a),
  localizeOcrError: vi.fn(c => c),
}));

const caseData = { id: 'c1', storage: { subFolders: { '02_ОБРОБЛЕНІ': 'f02' } } };
const cleanDoc = {
  id: 'doc_1', name: 'Скан.pdf', driveId: 'd1', documentNature: 'scanned',
  variants: { clean: '2026-06-03T00:00:00Z', digest: '2026-06-03T00:00:00Z' },
};

const MARKED = 'Текст ==сумнів А== потім ==сумнів Б== кінець.';

beforeEach(() => {
  getVariantMarkdown.mockReset();
  getVariantMarkdown.mockResolvedValue(MARKED);
});

function renderClean(extra = {}) {
  return render(
    <DocumentViewerContent
      document={cleanDoc}
      caseData={caseData}
      mode="clean"
      onLoadAttentionNotes={vi.fn(async () => [{ note: 'причина А' }, { note: 'причина Б' }])}
      onRemoveAllMarks={vi.fn(async () => true)}
      {...extra}
    />
  );
}

describe('CleanHighlights — чип лише в режимі Чистий (V2-C)', () => {
  it('mode=clean з ==мітками== → чип «2 помітки»', async () => {
    renderClean();
    const chip = await screen.findByRole('button', { name: /2 помітки/ });
    expect(chip).toBeInTheDocument();
  });

  it('mode=digest → чипа НЕМАЄ (навіть якщо текст містить ==)', async () => {
    render(
      <DocumentViewerContent document={cleanDoc} caseData={caseData} mode="digest" />
    );
    // Дочекатись завантаження тексту (badge «переказ» з'являється для digest).
    await screen.findByText(/переказ/);
    expect(screen.queryByRole('button', { name: /помітк/ })).toBeNull();
  });

  it('панель: тап чипа → список пунктів із причинами (порядок) + перемикач + «Зняти всі»', async () => {
    renderClean();
    const chip = await screen.findByRole('button', { name: /2 помітки/ });
    fireEvent.click(chip);
    await waitFor(() => expect(screen.getByText('причина А')).toBeInTheDocument());
    expect(screen.getByText('причина Б')).toBeInTheDocument();
    expect(screen.getByText('Підсвічувати в тексті')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Зняти всі назавжди/ })).toBeInTheDocument();
  });

  it('клік по пункту → пульс на відповідній мітці (data-mark за порядком)', async () => {
    const { container } = renderClean();
    const chip = await screen.findByRole('button', { name: /2 помітки/ });
    fireEvent.click(chip);
    fireEvent.click(screen.getByText('причина Б'));
    const mark2 = container.querySelector('mark.attention[data-mark="2"]');
    expect(mark2).toBeTruthy();
    expect(mark2.classList.contains('is-pulse')).toBe(true);
    // Перша мітка не пульсує.
    expect(container.querySelector('mark.attention[data-mark="1"]').classList.contains('is-pulse')).toBe(false);
  });

  it('перемикач показу → wrapper отримує клас marks-hidden (CSS-приховання)', async () => {
    const { container } = renderClean();
    const chip = await screen.findByRole('button', { name: /2 помітки/ });
    fireEvent.click(chip);
    expect(container.querySelector('.document-viewer__markdown--marks-hidden')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(container.querySelector('.document-viewer__markdown--marks-hidden')).toBeTruthy();
  });

  it('«Зняти всі назавжди» → onRemoveAllMarks(doc, стрипнутий) і чип зникає', async () => {
    const onRemoveAllMarks = vi.fn(async () => true);
    renderClean({ onRemoveAllMarks });
    const chip = await screen.findByRole('button', { name: /2 помітки/ });
    fireEvent.click(chip);
    fireEvent.click(screen.getByRole('button', { name: /Зняти всі назавжди/ }));
    await waitFor(() => {
      expect(onRemoveAllMarks).toHaveBeenCalledTimes(1);
    });
    const [docArg, stripped] = onRemoveAllMarks.mock.calls[0];
    expect(docArg.id).toBe('doc_1');
    expect(stripped).toBe('Текст сумнів А потім сумнів Б кінець.');   // == прибрано
    // Текст оновлено локально → чип зникає (markCount 0).
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /помітк/ })).toBeNull();
    });
  });
});
