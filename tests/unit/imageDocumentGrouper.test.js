// @vitest-environment jsdom
//
// TASK 1B image_merge_unify — imageDocumentGrouper unit tests.
// Перевіряє: JSON parsing (три варіанти), валідація груп, fallback, обов'язкове
// білінгове логування (закриває C7 — DEVELOPMENT_PHILOSOPHY §«Народження модуля»).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Мокаємо білінгові sink'и ДО імпорту grouper'а — модуль захоплює референси.
const mockAiUsageSink = vi.fn();
const mockActivityReport = vi.fn();
vi.mock('../../src/services/activityTracker.js', () => ({
  report: (...args) => mockActivityReport(...args),
}));

import {
  groupImagesIntoDocuments,
  parseAgentResponse,
  __test__,
} from '../../src/services/sortation/imageDocumentGrouper.js';

const { validateGroups, KNOWN_TYPES } = __test__;

function mockApiResponse(parsedOrText, opts = {}) {
  return vi.fn(async () => ({
    content: [{
      text: typeof parsedOrText === 'string' ? parsedOrText : JSON.stringify(parsedOrText),
    }],
    usage: { input_tokens: opts.input ?? 100, output_tokens: opts.output ?? 60 },
  }));
}

function imageItem(index, text = '', name = `IMG_${index}.jpg`) {
  return { index, name, mime: 'image/jpeg', ocrText: text };
}

beforeEach(() => {
  mockAiUsageSink.mockClear();
  mockActivityReport.mockClear();
});

// ── parseAgentResponse ─────────────────────────────────────────────────────

describe('imageDocumentGrouper.parseAgentResponse', () => {
  it('чистий JSON', () => {
    const r = parseAgentResponse('{"groups":[{"pages":[0,1],"type":"pleading","suggestedName":"Позов"}]}');
    expect(r).toEqual({
      groups: [{ pages: [0, 1], type: 'pleading', suggestedName: 'Позов' }],
    });
  });

  it('markdown fence ```json ... ```', () => {
    const raw = 'Result:\n```json\n{"groups":[{"pages":[0],"type":"other"}]}\n```';
    const r = parseAgentResponse(raw);
    expect(r?.groups?.[0]?.pages).toEqual([0]);
  });

  it('inline {...} у prose', () => {
    const raw = 'Here is the answer: {"groups":[{"pages":[0,1,2]}]} thanks.';
    const r = parseAgentResponse(raw);
    expect(r?.groups?.[0]?.pages).toEqual([0, 1, 2]);
  });

  it('повертає null для невалідного', () => {
    expect(parseAgentResponse('not json at all')).toBeNull();
    expect(parseAgentResponse('')).toBeNull();
    expect(parseAgentResponse(null)).toBeNull();
  });
});

// ── validateGroups ─────────────────────────────────────────────────────────

describe('imageDocumentGrouper.validateGroups', () => {
  it('чиста відповідь — passthrough з валідними полями', () => {
    const groups = validateGroups(
      [{ pages: [0, 1], type: 'pleading', suggestedName: 'A' },
       { pages: [2], type: 'identification', suggestedName: 'Паспорт' }],
      [0, 1, 2],
    );
    expect(groups).toEqual([
      { pages: [0, 1], type: 'pleading', suggestedName: 'A' },
      { pages: [2], type: 'identification', suggestedName: 'Паспорт' },
    ]);
  });

  it('пропущений індекс — додається у останню групу (анти-«тиха втрата»)', () => {
    const groups = validateGroups(
      [{ pages: [0], type: 'pleading', suggestedName: 'A' },
       { pages: [1], type: 'other', suggestedName: 'B' }],
      [0, 1, 2, 3],
    );
    // 2 і 3 пропущені AI — обидва осідають у останню групу
    expect(groups[1].pages).toEqual([1, 2, 3]);
  });

  it('повторний індекс — лишається перше входження', () => {
    const groups = validateGroups(
      [{ pages: [0, 1], suggestedName: 'A' },
       { pages: [1, 2], suggestedName: 'B' }],
      [0, 1, 2],
    );
    expect(groups[0].pages).toEqual([0, 1]);
    expect(groups[1].pages).toEqual([2]);
  });

  it('out-of-range індекс — ігнорується', () => {
    const groups = validateGroups(
      [{ pages: [0, 999, 1], suggestedName: 'A' }],
      [0, 1],
    );
    expect(groups[0].pages).toEqual([0, 1]);
  });

  it('порожній/невалідний вхід → один документ з усіх індексів', () => {
    const groups = validateGroups([], [0, 1, 2]);
    expect(groups).toEqual([{ pages: [0, 1, 2], type: null, suggestedName: '' }]);
  });

  it('невідомий type → null', () => {
    const groups = validateGroups(
      [{ pages: [0], type: 'invented_type', suggestedName: 'X' }],
      [0],
    );
    expect(groups[0].type).toBeNull();
  });

  it('KNOWN_TYPES містить канонічні enums', () => {
    expect(KNOWN_TYPES.has('pleading')).toBe(true);
    expect(KNOWN_TYPES.has('court_act')).toBe(true);
    expect(KNOWN_TYPES.has('identification')).toBe(true);
    expect(KNOWN_TYPES.has('other')).toBe(true);
    expect(KNOWN_TYPES.has('random_type')).toBe(false);
  });
});

// ── groupImagesIntoDocuments ───────────────────────────────────────────────

describe('imageDocumentGrouper.groupImagesIntoDocuments', () => {
  it('1 image → fallback skipped (агент не викликається)', async () => {
    const callApi = vi.fn();
    const items = [imageItem(0, 'single page')];
    const result = await groupImagesIntoDocuments(items, { apiKey: 'test', callApi });
    expect(callApi).not.toHaveBeenCalled();
    expect(result.skipped).toBe(true);
    expect(result.groups).toEqual([{ pages: [0], type: null, suggestedName: '' }]);
  });

  it('N images → AI повертає 2 групи', async () => {
    const callApi = mockApiResponse({
      groups: [
        { pages: [0, 1, 2], type: 'pleading', suggestedName: 'Позовна заява' },
        { pages: [3], type: 'identification', suggestedName: 'Паспорт' },
      ],
    });
    const items = [
      imageItem(0, 'page 1 of pleading'),
      imageItem(1, 'page 2 of pleading'),
      imageItem(2, 'page 3 of pleading'),
      imageItem(3, 'passport scan'),
    ];
    const result = await groupImagesIntoDocuments(items, { apiKey: 'test', callApi });

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].pages).toEqual([0, 1, 2]);
    expect(result.groups[0].type).toBe('pleading');
    expect(result.groups[1].pages).toEqual([3]);
    expect(result.groups[1].type).toBe('identification');
    expect(result.fallback).toBeFalsy();
  });

  it('AI повертає не-JSON → fallback один документ з усіх', async () => {
    const callApi = vi.fn(async () => ({
      content: [{ text: 'Sorry, I cannot help with this.' }],
      usage: { input_tokens: 50, output_tokens: 10 },
    }));
    const items = [imageItem(0, 'a'), imageItem(1, 'b'), imageItem(2, 'c')];
    const result = await groupImagesIntoDocuments(items, { apiKey: 'test', callApi });

    expect(result.fallback).toBe(true);
    expect(result.fallbackReason).toBe('agent_invalid_json');
    expect(result.groups).toEqual([
      { pages: [0, 1, 2], type: null, suggestedName: '' },
    ]);
  });

  it('AI throw (мережа/429) → fallback один документ + groups лишається доступним', async () => {
    const callApi = vi.fn(async () => { throw new Error('Anthropic 429'); });
    const items = [imageItem(0), imageItem(1)];
    const result = await groupImagesIntoDocuments(items, { apiKey: 'test', callApi });

    expect(result.fallback).toBe(true);
    expect(result.fallbackReason).toMatch(/ai_call_failed/);
    expect(result.groups[0].pages).toEqual([0, 1]);
  });

  it('БІЛІНГ: logAiUsageViaSink викликається при успішному виклику (закриває C7)', async () => {
    const callApi = mockApiResponse(
      { groups: [{ pages: [0, 1], type: 'other' }] },
      { input: 150, output: 80 },
    );
    const items = [imageItem(0, 'x'), imageItem(1, 'y')];
    const aiUsageSink = vi.fn();
    await groupImagesIntoDocuments(items, {
      apiKey: 'test',
      callApi,
      caseId: 'case_42',
      aiUsageSink,
    });

    expect(aiUsageSink).toHaveBeenCalledTimes(1);
    const entry = aiUsageSink.mock.calls[0][0];
    expect(entry.agentType).toBe('image_document_grouper');
    expect(entry.inputTokens).toBe(150);
    expect(entry.outputTokens).toBe(80);
    expect(entry.context.caseId).toBe('case_42');
    expect(entry.context.operation).toBe('image_document_grouping');
  });

  it('БІЛІНГ: activityTracker.report викликається з agent_call (час адвоката)', async () => {
    const callApi = mockApiResponse({ groups: [{ pages: [0, 1] }] });
    const items = [imageItem(0), imageItem(1)];
    await groupImagesIntoDocuments(items, {
      apiKey: 'test',
      callApi,
      caseId: 'case_99',
    });

    expect(mockActivityReport).toHaveBeenCalledTimes(1);
    const [eventName, payload] = mockActivityReport.mock.calls[0];
    expect(eventName).toBe('agent_call');
    expect(payload.caseId).toBe('case_99');
    expect(payload.metadata.agentType).toBe('image_document_grouper');
    expect(payload.metadata.operation).toBe('image_document_grouping');
  });

  it('БІЛІНГ: при AI fail logAiUsageViaSink НЕ викликається (нема token info), але activityTracker таки', async () => {
    const callApi = vi.fn(async () => { throw new Error('timeout'); });
    const items = [imageItem(0), imageItem(1)];
    const aiUsageSink = vi.fn();
    await groupImagesIntoDocuments(items, {
      apiKey: 'test',
      callApi,
      caseId: 'case_77',
      aiUsageSink,
    });

    expect(aiUsageSink).not.toHaveBeenCalled();
    // activityTracker — час адвоката, спрацьовує і на fail (адвокат витратив час
    // на запит який провалився; білінг §12: не дублюємо поля з ai_usage)
    expect(mockActivityReport).toHaveBeenCalledTimes(1);
  });

  it('apiKey відсутній і callApi теж → throws (захист від тихого fail)', async () => {
    const items = [imageItem(0), imageItem(1)];
    await expect(groupImagesIntoDocuments(items, {})).rejects.toThrow(/apiKey required/);
  });

  it('items=[] → throws', async () => {
    await expect(groupImagesIntoDocuments([], { apiKey: 'x' })).rejects.toThrow(/непорожнім/);
  });

  it('truncate OCR text: дуже довгий текст обрізається у user message', () => {
    const longText = 'A'.repeat(5000);
    const items = [imageItem(0, longText), imageItem(1, 'short')];
    const msg = __test__.buildUserMessage(items);
    expect(msg.length).toBeLessThan(5000 + 200); // truncate works
    expect(msg).toContain('[...skipped');
  });
});
