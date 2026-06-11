// @vitest-environment jsdom
// ImportTabPersistAck.test.jsx — TASK submit_persist_ack
// ResultCard чесно показує статус персисту: «Збережено на Drive» лише при
// persisted:true; «НЕ збережено: <persistError> — повторіть» при false.
// Зелений «успіх»-вигляд — лише при підтвердженому персисті.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../src/services/ecits/scenarioProcessor.js', () => ({
  submitScenarioResult: vi.fn(),
  processDeferredCases: vi.fn(),
}));

vi.mock('../../src/services/ecits/promptBuilder.js', () => ({
  buildEcitsImportPrompt: () => 'mock prompt',
}));

import ImportTab from '../../src/components/CourtSync/ImportTab.jsx';
import { submitScenarioResult } from '../../src/services/ecits/scenarioProcessor.js';

function baseResult(overrides = {}) {
  return {
    scenarioRunId: 'scn_test',
    casesCreated: 1,
    casesUpdated: 0,
    hearingsAdded: 1,
    skipped: 0,
    errors: [],
    warnings: [],
    pendingReview: [],
    ...overrides,
  };
}

function pasteAndSubmit() {
  const textarea = screen.getByPlaceholderText(/Вставте сюди JSON-envelope/);
  fireEvent.change(textarea, { target: { value: '{"envelopeVersion":1}' } });
  fireEvent.click(screen.getByRole('button', { name: /Обробити/ }));
}

describe('ImportTab — persisted у ResultCard (TASK submit_persist_ack)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persisted:true → «Збережено на Drive»', async () => {
    submitScenarioResult.mockResolvedValueOnce(baseResult({ persisted: true, persistError: null }));
    render(<ImportTab executeAction={vi.fn()} cases={[]} tenant={null} />);
    pasteAndSubmit();
    expect(await screen.findByText('Збережено на Drive')).toBeInTheDocument();
    expect(screen.queryByText(/НЕ збережено/)).toBeNull();
  });

  it('persisted:false → «НЕ збережено: <persistError> — повторіть»', async () => {
    submitScenarioResult.mockResolvedValueOnce(baseResult({ persisted: false, persistError: 'guard_blocked' }));
    render(<ImportTab executeAction={vi.fn()} cases={[]} tenant={null} />);
    pasteAndSubmit();
    expect(await screen.findByText(/НЕ збережено: guard_blocked — повторіть/)).toBeInTheDocument();
    expect(screen.queryByText('Збережено на Drive')).toBeNull();
  });

  it('persisted:false (таймаут) → показує persist_timeout', async () => {
    submitScenarioResult.mockResolvedValueOnce(baseResult({ persisted: false, persistError: 'persist_timeout' }));
    render(<ImportTab executeAction={vi.fn()} cases={[]} tenant={null} />);
    pasteAndSubmit();
    expect(await screen.findByText(/НЕ збережено: persist_timeout — повторіть/)).toBeInTheDocument();
  });

  it('ImportTab прокидає awaitPersistAck у deps submitScenarioResult', async () => {
    submitScenarioResult.mockResolvedValueOnce(baseResult({ persisted: true, persistError: null }));
    const awaitPersistAck = vi.fn();
    render(<ImportTab executeAction={vi.fn()} cases={[]} tenant={null} awaitPersistAck={awaitPersistAck} />);
    pasteAndSubmit();
    await screen.findByText('Збережено на Drive');
    expect(submitScenarioResult).toHaveBeenCalledTimes(1);
    expect(submitScenarioResult.mock.calls[0][1].awaitPersistAck).toBe(awaitPersistAck);
  });

  it('legacy result без поля persisted (backward) → трактується як збережено', async () => {
    submitScenarioResult.mockResolvedValueOnce(baseResult());
    render(<ImportTab executeAction={vi.fn()} cases={[]} tenant={null} />);
    pasteAndSubmit();
    expect(await screen.findByText('Збережено на Drive')).toBeInTheDocument();
  });
});
