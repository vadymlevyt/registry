// @vitest-environment jsdom
// ImportTabResultDetails.test.jsx — TASK case_ui_and_result_polish §4.
// ResultCard показує згортуваний список «Деталі по справах» під числами.
// Старий result без поля details не падає (адитивність).

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../src/services/ecits/scenarioProcessor.js', () => ({
  submitScenarioResult: vi.fn(),
  processDeferredCases: vi.fn(),
}));
vi.mock('../../src/services/ecits/promptBuilder.js', () => ({
  buildEcitsImportPrompt: () => 'mock prompt',
}));

import ImportTab from '../../src/components/CourtSync/ImportTab.jsx';
import { submitScenarioResult } from '../../src/services/ecits/scenarioProcessor.js';

function pasteAndSubmit() {
  const textarea = screen.getByPlaceholderText(/Вставте сюди JSON-envelope/);
  fireEvent.change(textarea, { target: { value: JSON.stringify({ envelopeVersion: 1, scenarioId: 'x', data: { cases: [] } }) } });
  fireEvent.click(screen.getByRole('button', { name: /Обробити/ }));
}

const baseResult = {
  scenarioRunId: 'scn', casesCreated: 1, casesUpdated: 0, hearingsAdded: 1,
  skipped: 0, errors: [], warnings: [], pendingReview: [],
};

describe('ImportTab ResultCard — деталі по справах (§4)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('рендерить список деталей з case_no, дією і змінами', async () => {
    submitScenarioResult.mockResolvedValueOnce({
      ...baseResult,
      details: [
        { case_no: '450/2275/25', action: 'created', changed: ['нова назва: [ЄСІТС] Бабенко (450/2275/25)', '+1 засідань'] },
      ],
    });
    render(<ImportTab executeAction={vi.fn()} cases={[]} tenant={null} />);
    pasteAndSubmit();

    await waitFor(() => {
      expect(screen.getByTestId('result-details')).toBeInTheDocument();
    });
    expect(screen.getByText(/Деталі по справах \(1\)/)).toBeInTheDocument();
    // case_no присутній і у жирному маркері, і всередині тексту зміни —
    // тому getAllByText (≥1), не getByText (кидає на кількох збігах).
    expect(screen.getAllByText(/450\/2275\/25/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('result-details').textContent).toMatch(/створено/);
    expect(screen.getByTestId('result-details').textContent).toMatch(/\+1 засідань/);
  });

  it('старий result без details не падає і не показує блок деталей', async () => {
    submitScenarioResult.mockResolvedValueOnce({ ...baseResult });
    render(<ImportTab executeAction={vi.fn()} cases={[]} tenant={null} />);
    pasteAndSubmit();

    await waitFor(() => {
      expect(screen.getByText(/Створено справ/)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('result-details')).not.toBeInTheDocument();
  });
});
