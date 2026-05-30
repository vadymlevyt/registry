// TASK DP image parity #1 — спільна обгортка sortImageDocument.
//
// Перевіряємо:
//   • <2 items → null (нема що сортувати/дедупити), sortImages НЕ кликається.
//   • forwards items + опції у sortImages і повертає його результат.
//   • timeout → null (fallback), не кидає.
//   • sortImages кинув → null (fallback), не кидає.
//   • billing передано → C7-логування (ai_usage через sink + activityTracker).
//   • billing НЕ передано (шлях модалки) → жодного логування.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSortImages = vi.fn();
vi.mock('../../src/services/sortation/imageSortingAgent.js', () => ({
  sortImages: (...args) => mockSortImages(...args),
}));

const mockLogAiUsageViaSink = vi.fn();
vi.mock('../../src/services/aiUsageService.js', () => ({
  logAiUsageViaSink: (...args) => mockLogAiUsageViaSink(...args),
}));

const mockReport = vi.fn();
vi.mock('../../src/services/activityTracker.js', () => ({
  report: (...args) => mockReport(...args),
}));

import { sortImageDocument } from '../../src/services/imageDocument/sortImageDocument.js';

const SORT_OK = {
  order: [1, 0],
  duplicates: [{ group: [0, 1], recommended: 0, reason: 'чіткіше' }],
  suggestedName: 'Ухвала',
  warnings: [],
  missing: null,
  model: 'claude-sonnet-4-20250514',
  usage: { inputTokens: 100, outputTokens: 20 },
};

const items2 = [
  { index: 0, name: 'a.jpg', ocrText: 'x' },
  { index: 1, name: 'b.jpg', ocrText: 'y' },
];

beforeEach(() => {
  mockSortImages.mockReset();
  mockLogAiUsageViaSink.mockReset();
  mockReport.mockReset();
});

describe('sortImageDocument — спільна обгортка над sortImages', () => {
  it('<2 items → null, sortImages НЕ кликається', async () => {
    const r1 = await sortImageDocument([], { apiKey: 'k' });
    const r2 = await sortImageDocument([{ index: 0 }], { apiKey: 'k' });
    expect(r1).toBeNull();
    expect(r2).toBeNull();
    expect(mockSortImages).not.toHaveBeenCalled();
  });

  it('forwards items + apiKey/callApi/caseContext у sortImages і повертає результат', async () => {
    mockSortImages.mockResolvedValue(SORT_OK);
    const caseContext = { existingDocumentNames: ['Q'], categoryHint: 'pleading' };
    const result = await sortImageDocument(items2, { apiKey: 'KEY', caseContext });
    expect(result).toBe(SORT_OK);
    expect(mockSortImages).toHaveBeenCalledTimes(1);
    const [passedItems, opts] = mockSortImages.mock.calls[0];
    expect(passedItems).toBe(items2);
    expect(opts.apiKey).toBe('KEY');
    expect(opts.caseContext).toBe(caseContext);
  });

  it('timeout → null (fallback), не кидає', async () => {
    // sortImages зависає → спрацьовує timeoutMs
    mockSortImages.mockImplementation(() => new Promise(() => {}));
    const result = await sortImageDocument(items2, { apiKey: 'k', timeoutMs: 20 });
    expect(result).toBeNull();
  });

  it('sortImages кинув → null (fallback), не кидає', async () => {
    mockSortImages.mockRejectedValue(new Error('Anthropic 429'));
    const result = await sortImageDocument(items2, { apiKey: 'k' });
    expect(result).toBeNull();
  });

  it('billing передано → ai_usage (sink) + activityTracker.report(agent_call)', async () => {
    mockSortImages.mockResolvedValue(SORT_OK);
    const sink = vi.fn();
    await sortImageDocument(items2, {
      apiKey: 'k',
      billing: { caseId: 'case_1', aiUsageSink: sink },
    });
    expect(mockLogAiUsageViaSink).toHaveBeenCalledTimes(1);
    const [usageParams, passedSink] = mockLogAiUsageViaSink.mock.calls[0];
    expect(usageParams.agentType).toBe('image_sorter');
    expect(usageParams.context.caseId).toBe('case_1');
    expect(usageParams.context.operation).toBe('image_sorting');
    expect(passedSink).toBe(sink);
    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(mockReport.mock.calls[0][0]).toBe('agent_call');
    expect(mockReport.mock.calls[0][1].metadata.agentType).toBe('image_sorter');
  });

  it('billing НЕ передано (шлях модалки) → жодного логування', async () => {
    mockSortImages.mockResolvedValue(SORT_OK);
    await sortImageDocument(items2, { apiKey: 'k' });
    expect(mockLogAiUsageViaSink).not.toHaveBeenCalled();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('billing передано, але без aiUsageSink → ai_usage НЕ логується, activity логується', async () => {
    mockSortImages.mockResolvedValue(SORT_OK);
    await sortImageDocument(items2, { apiKey: 'k', billing: { caseId: 'c' } });
    expect(mockLogAiUsageViaSink).not.toHaveBeenCalled();
    expect(mockReport).toHaveBeenCalledTimes(1);
  });
});
