// @vitest-environment jsdom
// ImportTabPendingReview.test.jsx — TASK v12 §3
// Перевіряє пікер «Можливо не ваші» в ImportTab: рендер, опт-ін поведінка,
// мердж результату processDeferredCases.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Мокаємо submitScenarioResult/processDeferredCases — щоб тест жив у UI-шарі.
vi.mock('../../src/services/ecits/scenarioProcessor.js', () => ({
  submitScenarioResult: vi.fn(),
  processDeferredCases: vi.fn(),
}));

// Лекий мок promptBuilder — нам байдуже що віддасть промпт.
vi.mock('../../src/services/ecits/promptBuilder.js', () => ({
  buildEcitsImportPrompt: () => 'mock prompt',
}));

import ImportTab from '../../src/components/CourtSync/ImportTab.jsx';
import {
  submitScenarioResult,
  processDeferredCases,
} from '../../src/services/ecits/scenarioProcessor.js';

function pasteAndSubmit(envelope) {
  const textarea = screen.getByPlaceholderText(/Вставте сюди JSON-envelope/);
  fireEvent.change(textarea, { target: { value: JSON.stringify(envelope) } });
  fireEvent.click(screen.getByRole('button', { name: /Обробити/ }));
}

describe('ImportTab — pendingReview пікер (TASK v12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('рендерить секцію «Можливо не ваші» коли pendingReview не порожній', async () => {
    submitScenarioResult.mockResolvedValueOnce({
      scenarioRunId: 'scn',
      casesCreated: 0,
      casesUpdated: 0,
      hearingsAdded: 0,
      skipped: 0,
      errors: [],
      warnings: [],
      pendingReview: [
        { ecitsCaseId: 'd1', case_no: '999/9/26', court: 'X', primaryParty: null },
      ],
    });

    render(<ImportTab executeAction={vi.fn()} cases={[]} tenant={null} />);
    pasteAndSubmit({ envelopeVersion: 1, scenarioId: 'x', data: { cases: [] } });

    await waitFor(() => {
      expect(screen.getByTestId('pending-review-picker')).toBeInTheDocument();
    });
    expect(screen.getByText(/999\/9\/26/)).toBeInTheDocument();
  });

  it('за замовчуванням нічого не обрано — кнопка «Додати обрані» disabled', async () => {
    submitScenarioResult.mockResolvedValueOnce({
      scenarioRunId: 'scn',
      casesCreated: 0, casesUpdated: 0, hearingsAdded: 0, skipped: 0,
      errors: [], warnings: [],
      pendingReview: [{ ecitsCaseId: 'd1', case_no: '999/9/26', court: 'X' }],
    });
    render(<ImportTab executeAction={vi.fn()} cases={[]} tenant={null} />);
    pasteAndSubmit({ envelopeVersion: 1, scenarioId: 'x', data: { cases: [] } });

    await waitFor(() => screen.getByTestId('pending-review-picker'));
    const addBtn = screen.getByRole('button', { name: /Додати обрані/ });
    expect(addBtn).toBeDisabled();
  });

  it('після toggle і кліку «Додати обрані» викликає processDeferredCases', async () => {
    submitScenarioResult.mockResolvedValueOnce({
      scenarioRunId: 'scn',
      casesCreated: 0, casesUpdated: 0, hearingsAdded: 0, skipped: 0,
      errors: [], warnings: [],
      pendingReview: [
        { ecitsCaseId: 'd1', case_no: '999/9/26', court: 'X' },
        { ecitsCaseId: 'd2', case_no: '888/8/26', court: 'Y' },
      ],
    });
    processDeferredCases.mockResolvedValueOnce({
      casesCreated: 1, casesUpdated: 0, hearingsAdded: 0, skipped: 0,
      errors: [], warnings: [],
    });

    render(<ImportTab executeAction={vi.fn()} cases={[]} tenant={null} />);
    pasteAndSubmit({ envelopeVersion: 1, scenarioId: 'x', data: { cases: [] } });

    await waitFor(() => screen.getByTestId('pending-review-picker'));
    // Обрати першу справу.
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    const addBtn = screen.getByRole('button', { name: /Додати обрані/ });
    expect(addBtn).not.toBeDisabled();
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(processDeferredCases).toHaveBeenCalledTimes(1);
    });
    const call = processDeferredCases.mock.calls[0];
    expect(call[0]).toHaveLength(1);
    expect(call[0][0].ecitsCaseId).toBe('d1');
  });

  it('warnings/skipped/errors рендеряться навіть якщо приходять як об\'єкти (захист від React #31)', async () => {
    submitScenarioResult.mockResolvedValueOnce({
      scenarioRunId: 'scn',
      casesCreated: 0, casesUpdated: 0, hearingsAdded: 0, skipped: 0,
      // Об'єкти у масивах — наш UI має coerce до рядків.
      errors: [{ case_no: '1/2/26', message: 'щось зламалось' }],
      warnings: [{ case_no: '3/4/26', message: 'дивне поле' }],
      pendingReview: [],
    });
    render(<ImportTab executeAction={vi.fn()} cases={[]} tenant={null} />);
    pasteAndSubmit({ envelopeVersion: 1, scenarioId: 'x', data: { cases: [] } });

    await waitFor(() => {
      // Розкрити <details> щоб помітити список (testing-library не виконує
      // дефолтну поведінку details — відкриваємо вручну).
      const detailsList = screen.getAllByRole('group');
      detailsList.forEach((d) => d.setAttribute('open', ''));
    });
    expect(screen.getByText(/1\/2\/26: щось зламалось/)).toBeInTheDocument();
    expect(screen.getByText(/3\/4\/26: дивне поле/)).toBeInTheDocument();
  });
});
