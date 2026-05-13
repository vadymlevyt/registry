// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

import {
  sortImages,
  parseAgentResponse,
  ensureUniqueName,
  __test__,
} from '../../src/services/sortation/imageSortingAgent.js';

const { truncateOcrText, buildUserMessage, MAX_OCR_TEXT_PER_IMAGE } = __test__;

// ── Helpers ────────────────────────────────────────────────────────────────

function mockApiResponse(parsedJson, opts = {}) {
  return vi.fn(async () => ({
    content: [{ text: typeof parsedJson === 'string' ? parsedJson : JSON.stringify(parsedJson) }],
    usage: { input_tokens: opts.input ?? 100, output_tokens: opts.output ?? 50 },
  }));
}

function imageItem(index, text, name = `IMG_${index}.jpg`) {
  return { index, name, mime: 'image/jpeg', sizeBytes: 100000, ocrText: text };
}

// ── parseAgentResponse ─────────────────────────────────────────────────────

describe('imageSortingAgent.parseAgentResponse', () => {
  it('чистий JSON', () => {
    const r = parseAgentResponse('{"order":[1,0],"warnings":[],"missing":null,"suggestedName":"Ухвала"}');
    expect(r.order).toEqual([1, 0]);
    expect(r.suggestedName).toBe('Ухвала');
  });

  it('JSON у markdown ```json блоці', () => {
    const r = parseAgentResponse('```json\n{"order":[0],"warnings":[]}\n```');
    expect(r.order).toEqual([0]);
  });

  it('JSON у звичайному ``` блоці', () => {
    const r = parseAgentResponse('```\n{"order":[0]}\n```');
    expect(r.order).toEqual([0]);
  });

  it('JSON всередині prose', () => {
    const r = parseAgentResponse('Here is the result: {"order":[2,1,0]} done.');
    expect(r.order).toEqual([2, 1, 0]);
  });

  it('невалідний JSON → null', () => {
    expect(parseAgentResponse('not json at all')).toBeNull();
    expect(parseAgentResponse('')).toBeNull();
    expect(parseAgentResponse(null)).toBeNull();
  });

  it('JSON без } у тексті → null', () => {
    expect(parseAgentResponse('order is [1,2,3]')).toBeNull();
  });
});

// ── ensureUniqueName ───────────────────────────────────────────────────────

describe('imageSortingAgent.ensureUniqueName', () => {
  it('унікальна — повертає як є', () => {
    expect(ensureUniqueName('Ухвала про відкриття', [])).toBe('Ухвала про відкриття');
    expect(ensureUniqueName('Адвокатський запит', ['Інше', 'Позов'])).toBe('Адвокатський запит');
  });

  it('існує — додає (2)', () => {
    expect(ensureUniqueName('Адвокатський запит', ['Адвокатський запит'])).toBe('Адвокатський запит (2)');
  });

  it('case-insensitive порівняння', () => {
    expect(ensureUniqueName('Адвокатський запит', ['АДВОКАТСЬКИЙ ЗАПИТ'])).toBe('Адвокатський запит (2)');
    expect(ensureUniqueName('Адвокатський запит', ['адвокатський запит'])).toBe('Адвокатський запит (2)');
  });

  it('ігнорує trailing/leading whitespace', () => {
    expect(ensureUniqueName('  Адвокатський запит  ', ['Адвокатський запит'])).toBe('Адвокатський запит (2)');
    expect(ensureUniqueName('Адвокатський запит', ['  Адвокатський запит  '])).toBe('Адвокатський запит (2)');
  });

  it('послідовні дублікати — (2), (3), (4)', () => {
    const existing = ['Адвокатський запит'];
    const r2 = ensureUniqueName('Адвокатський запит', existing);
    expect(r2).toBe('Адвокатський запит (2)');
    existing.push(r2);
    const r3 = ensureUniqueName('Адвокатський запит', existing);
    expect(r3).toBe('Адвокатський запит (3)');
    existing.push(r3);
    const r4 = ensureUniqueName('Адвокатський запит', existing);
    expect(r4).toBe('Адвокатський запит (4)');
  });

  it('заповнення дірок — пропущений (2), беремо саме (2) бо вільний', () => {
    // У адвоката є "X" і "X (3)" — наступна копія має бути "X (2)" (заповнюємо дірку)
    expect(ensureUniqueName('X', ['X', 'X (3)'])).toBe('X (2)');
  });

  it('імʼя уже має (N) і існує → шукаємо наступний', () => {
    expect(ensureUniqueName('X (2)', ['X', 'X (2)'])).toBe('X (3)');
  });

  it('порожнє/null/undefined → повертає як є', () => {
    expect(ensureUniqueName('', ['anything'])).toBe('');
    expect(ensureUniqueName(null, ['anything'])).toBe(null);
    expect(ensureUniqueName(undefined, [])).toBe(undefined);
  });

  it('тільки пробіли → повертає порожнє', () => {
    expect(ensureUniqueName('   ', ['X'])).toBe('');
  });
});

// ── truncateOcrText ────────────────────────────────────────────────────────

describe('imageSortingAgent.__test__.truncateOcrText', () => {
  it('короткий текст не торкається', () => {
    expect(truncateOcrText('short text')).toBe('short text');
  });

  it('довгий текст truncates до head + tail з маркером', () => {
    const text = 'A'.repeat(MAX_OCR_TEXT_PER_IMAGE + 500);
    const out = truncateOcrText(text);
    expect(out.length).toBeLessThan(text.length);
    expect(out).toContain('[...skipped');
    expect(out.startsWith('A')).toBe(true);
    expect(out.endsWith('A')).toBe(true);
  });

  it('текст рівно MAX_OCR_TEXT_PER_IMAGE — без truncate', () => {
    const text = 'B'.repeat(MAX_OCR_TEXT_PER_IMAGE);
    expect(truncateOcrText(text)).toBe(text);
    expect(truncateOcrText(text)).not.toContain('skipped');
  });

  it('null/undefined/number → порожній рядок', () => {
    expect(truncateOcrText(null)).toBe('');
    expect(truncateOcrText(undefined)).toBe('');
    expect(truncateOcrText(42)).toBe('');
  });
});

// ── buildUserMessage ───────────────────────────────────────────────────────

describe('imageSortingAgent.__test__.buildUserMessage', () => {
  it('включає кількість зображень і всі індекси', () => {
    const msg = buildUserMessage(
      [imageItem(0, 'text 0'), imageItem(1, 'text 1'), imageItem(2, 'text 2')],
      null
    );
    expect(msg).toContain('Кількість зображень: 3');
    expect(msg).toContain('index: 0');
    expect(msg).toContain('index: 1');
    expect(msg).toContain('index: 2');
  });

  it('включає existingDocumentNames у промпт', () => {
    const msg = buildUserMessage([imageItem(0, 'text')], {
      existingDocumentNames: ['Адвокатський запит', 'Позов'],
    });
    expect(msg).toContain('Існуючі назви документів');
    expect(msg).toContain('Адвокатський запит');
  });

  it('обмежує existingDocumentNames до 50', () => {
    const names = Array.from({ length: 100 }, (_, i) => `Doc ${i}`);
    const msg = buildUserMessage([imageItem(0, 'text')], { existingDocumentNames: names });
    expect(msg).toContain('Doc 0');
    expect(msg).toContain('Doc 49');
    expect(msg).not.toContain('Doc 50');
  });

  it('категорійний hint включається', () => {
    const msg = buildUserMessage([imageItem(0, 'text')], { categoryHint: 'Ухвала' });
    expect(msg).toContain('Орієнтовний тип документа: Ухвала');
  });

  it('orientation != 0 включається', () => {
    const msg = buildUserMessage([{ ...imageItem(0, 'text'), orientation: 90 }], null);
    expect(msg).toContain('orientation: 90°');
  });

  it('orientation == 0 НЕ включається (не засмічує контекст)', () => {
    const msg = buildUserMessage([{ ...imageItem(0, 'text'), orientation: 0 }], null);
    expect(msg).not.toContain('orientation: 0');
  });

  it('OCR truncates у buildUserMessage коли текст довгий', () => {
    const longText = 'X'.repeat(MAX_OCR_TEXT_PER_IMAGE + 500);
    const msg = buildUserMessage([imageItem(0, longText)], null);
    expect(msg).toContain('[...skipped');
  });

  it('порожній OCR помічається явно', () => {
    const msg = buildUserMessage([imageItem(0, '')], null);
    expect(msg).toContain('фото без розпізнаного тексту');
  });
});

// ── sortImages: degenerate cases ──────────────────────────────────────────

describe('imageSortingAgent.sortImages — degenerate cases', () => {
  it('1 зображення — агент НЕ викликається, повертає identity order', async () => {
    const callApi = vi.fn();
    const result = await sortImages([imageItem(0, 'text')], { apiKey: 'x', callApi });
    expect(callApi).not.toHaveBeenCalled();
    expect(result.order).toEqual([0]);
    expect(result.skipped).toBe(true);
    expect(result.usage.inputTokens).toBe(0);
  });

  it('порожній items → throws', async () => {
    await expect(sortImages([], { apiKey: 'x' })).rejects.toThrow(/items/);
  });

  it('без apiKey і callApi → throws', async () => {
    await expect(sortImages([imageItem(0, 't'), imageItem(1, 't')], {})).rejects.toThrow(/apiKey/);
  });
});

// ── sortImages: успішні виклики ───────────────────────────────────────────

describe('imageSortingAgent.sortImages — happy path', () => {
  it('агент повертає валідний JSON — order/warnings/missing/suggestedName', async () => {
    const callApi = mockApiResponse({
      order: [2, 0, 1, 3],
      warnings: [{ index: 4, reason: 'Інший документ' }],
      missing: 'Сторінка 3 відсутня',
      suggestedName: 'Ухвала про відкриття провадження',
    });
    const items = [0, 1, 2, 3, 4].map((i) => imageItem(i, `text ${i}`));
    const result = await sortImages(items, { apiKey: 'x', callApi });
    expect(callApi).toHaveBeenCalledOnce();
    // order має включати всі 5 індексів (агент повернув 4, ми доповнили відсутній 4)
    expect(result.order.length).toBe(5);
    expect(new Set(result.order)).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].index).toBe(4);
    expect(result.missing).toBe('Сторінка 3 відсутня');
    expect(result.suggestedName).toBe('Ухвала про відкриття провадження');
  });

  it('передає модель і токени у usage', async () => {
    const callApi = mockApiResponse(
      { order: [0, 1], warnings: [], missing: null, suggestedName: 'Документ' },
      { input: 500, output: 100 }
    );
    const items = [imageItem(0, 't'), imageItem(1, 't')];
    const result = await sortImages(items, { apiKey: 'x', callApi });
    expect(result.usage).toEqual({ inputTokens: 500, outputTokens: 100 });
    expect(result.model).toBeTruthy();
  });

  it('suggestedName унікалізується через existingDocumentNames', async () => {
    const callApi = mockApiResponse({
      order: [0, 1],
      warnings: [],
      missing: null,
      suggestedName: 'Адвокатський запит',
    });
    const items = [imageItem(0, 't'), imageItem(1, 't')];
    const result = await sortImages(items, {
      apiKey: 'x',
      callApi,
      caseContext: { existingDocumentNames: ['Адвокатський запит'] },
    });
    expect(result.suggestedName).toBe('Адвокатський запит (2)');
  });
});

// ── sortImages: fallback на невалідний JSON ────────────────────────────────

describe('imageSortingAgent.sortImages — fallback', () => {
  it('агент повернув не-JSON → identity order, fallback=true', async () => {
    const callApi = vi.fn(async () => ({
      content: [{ text: 'I am not JSON, sorry.' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }));
    const items = [imageItem(0, 't'), imageItem(1, 't'), imageItem(2, 't')];
    const result = await sortImages(items, { apiKey: 'x', callApi });
    expect(result.fallback).toBe(true);
    expect(result.fallbackReason).toBe('agent_invalid_json');
    expect(result.order).toEqual([0, 1, 2]);
    expect(result.warnings).toEqual([]);
    expect(result.suggestedName).toBe('');
  });

  it('order з невалідними індексами нормалізується', async () => {
    const callApi = mockApiResponse({
      order: [99, 0, 0, -1, 1], // 99 і -1 невалідні, 0 двічі
      warnings: [],
      missing: null,
      suggestedName: 'X',
    });
    const items = [imageItem(0, 't'), imageItem(1, 't'), imageItem(2, 't')];
    const result = await sortImages(items, { apiKey: 'x', callApi });
    // 0, 1 — валідні; 2 — додався автоматично
    expect(new Set(result.order)).toEqual(new Set([0, 1, 2]));
    expect(result.fallback).toBe(true);
    expect(result.fallbackReason).toBe('order_normalized');
  });

  it('order відсутній → identity', async () => {
    const callApi = mockApiResponse({
      warnings: [],
      missing: null,
      suggestedName: 'Y',
    });
    const items = [imageItem(0, 't'), imageItem(1, 't')];
    const result = await sortImages(items, { apiKey: 'x', callApi });
    expect(result.order).toEqual([0, 1]);
    expect(result.fallbackReason).toBe('order_missing');
  });

  it('warnings з невалідною структурою фільтруються', async () => {
    const callApi = mockApiResponse({
      order: [0, 1],
      warnings: [
        { index: 0, reason: 'OK' },
        { index: 99, reason: 'out of range' },
        { reason: 'no index' },
        'not an object',
        null,
      ],
      missing: null,
      suggestedName: 'X',
    });
    const items = [imageItem(0, 't'), imageItem(1, 't')];
    const result = await sortImages(items, { apiKey: 'x', callApi });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].index).toBe(0);
  });

  it('missing порожнє/whitespace → null', async () => {
    const callApi = mockApiResponse({
      order: [0, 1],
      warnings: [],
      missing: '   ',
      suggestedName: 'X',
    });
    const items = [imageItem(0, 't'), imageItem(1, 't')];
    const result = await sortImages(items, { apiKey: 'x', callApi });
    expect(result.missing).toBe(null);
  });
});

// ── sortImages: duplicates (TASK B fix 1) ──────────────────────────────────

describe('imageSortingAgent.sortImages — duplicates', () => {
  it('агент повертає duplicates з валідною групою — приходить у результат', async () => {
    const callApi = mockApiResponse({
      order: [0, 1, 2, 3, 4],
      duplicates: [
        { group: [3, 5], recommended: 3, reason: 'Фото 3 чіткіше' },
      ],
      warnings: [],
      missing: null,
      suggestedName: 'Ухвала',
    });
    const items = [0, 1, 2, 3, 4, 5].map((i) => imageItem(i, `text ${i}`));
    const result = await sortImages(items, { apiKey: 'x', callApi });
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].group).toEqual([3, 5]);
    expect(result.duplicates[0].recommended).toBe(3);
    expect(result.duplicates[0].reason).toBe('Фото 3 чіткіше');
  });

  it('duplicates відсутні → пустий масив у результаті', async () => {
    const callApi = mockApiResponse({
      order: [0, 1],
      warnings: [],
      missing: null,
      suggestedName: 'Документ',
    });
    const items = [imageItem(0, 't'), imageItem(1, 't')];
    const result = await sortImages(items, { apiKey: 'x', callApi });
    expect(result.duplicates).toEqual([]);
  });

  it('група з менш ніж 2 елементами — відфільтрована', async () => {
    const callApi = mockApiResponse({
      order: [0, 1, 2],
      duplicates: [
        { group: [0], recommended: 0, reason: 'тільки один' },
        { group: [1, 2], recommended: 1, reason: 'OK' },
      ],
      warnings: [],
      missing: null,
      suggestedName: 'X',
    });
    const items = [imageItem(0, 't'), imageItem(1, 't'), imageItem(2, 't')];
    const result = await sortImages(items, { apiKey: 'x', callApi });
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].group).toEqual([1, 2]);
  });

  it('recommended поза групою — нормалізується на перший з group', async () => {
    const callApi = mockApiResponse({
      order: [0, 1, 2],
      duplicates: [
        { group: [0, 1], recommended: 99, reason: 'invalid recommended' },
      ],
      warnings: [],
      missing: null,
      suggestedName: 'X',
    });
    const items = [imageItem(0, 't'), imageItem(1, 't'), imageItem(2, 't')];
    const result = await sortImages(items, { apiKey: 'x', callApi });
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].recommended).toBe(0);
  });

  it('index поза allowed → пропущений', async () => {
    const callApi = mockApiResponse({
      order: [0, 1],
      duplicates: [
        { group: [0, 99, 1], recommended: 0, reason: 'мікс валід/невалід' },
      ],
      warnings: [],
      missing: null,
      suggestedName: 'X',
    });
    const items = [imageItem(0, 't'), imageItem(1, 't')];
    const result = await sortImages(items, { apiKey: 'x', callApi });
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].group).toEqual([0, 1]);
  });

  it('перетин між групами — index у першій залишається, у другій випадає', async () => {
    const callApi = mockApiResponse({
      order: [0, 1, 2, 3],
      duplicates: [
        { group: [0, 1], recommended: 0, reason: 'перша група' },
        { group: [1, 2], recommended: 1, reason: 'друга група використовує 1' },
      ],
      warnings: [],
      missing: null,
      suggestedName: 'X',
    });
    const items = [imageItem(0, 't'), imageItem(1, 't'), imageItem(2, 't'), imageItem(3, 't')];
    const result = await sortImages(items, { apiKey: 'x', callApi });
    // Друга група після виключення 1 має тільки [2] → < 2, тому випадає
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].group).toEqual([0, 1]);
  });

  it('reason відсутній → дефолтний', async () => {
    const callApi = mockApiResponse({
      order: [0, 1],
      duplicates: [{ group: [0, 1], recommended: 0 }],
      warnings: [],
      missing: null,
      suggestedName: 'X',
    });
    const items = [imageItem(0, 't'), imageItem(1, 't')];
    const result = await sortImages(items, { apiKey: 'x', callApi });
    expect(result.duplicates[0].reason).toBeTruthy();
    expect(typeof result.duplicates[0].reason).toBe('string');
  });

  it('1 зображення — duplicates всегда пустий', async () => {
    const result = await sortImages([imageItem(0, 't')], { apiKey: 'x', callApi: vi.fn() });
    expect(result.duplicates).toEqual([]);
  });

  it('fallback при невалідному JSON — duplicates пустий', async () => {
    const callApi = vi.fn(async () => ({
      content: [{ text: 'not json' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }));
    const items = [imageItem(0, 't'), imageItem(1, 't')];
    const result = await sortImages(items, { apiKey: 'x', callApi });
    expect(result.fallback).toBe(true);
    expect(result.duplicates).toEqual([]);
  });

  // ── Stable ordering (TASK B fix Problem 4) ───────────────────────────
  // Адвокат натиснув «Створити PDF» двічі для однакового набору фото.
  // Очікуємо що duplicates групи у однаковому порядку з однаковим
  // внутрішнім сортуванням. AI може повернути порядок як завгодно — ми
  // нормалізуємо.

  it('group items сортуються за original index (deterministic)', async () => {
    const callApi = mockApiResponse({
      order: [0, 1, 2, 3, 4, 5],
      duplicates: [
        { group: [5, 2, 4], recommended: 2, reason: 'mixed order from AI' },
      ],
      warnings: [],
      missing: null,
      suggestedName: 'X',
    });
    const items = [0, 1, 2, 3, 4, 5].map((i) => imageItem(i, `t${i}`));
    const result = await sortImages(items, { apiKey: 'x', callApi });
    expect(result.duplicates).toHaveLength(1);
    // Сортовано за index — recommended може бути будь-яким з групи
    expect(result.duplicates[0].group).toEqual([2, 4, 5]);
    expect(result.duplicates[0].recommended).toBe(2);
  });

  it('duplicates[] масив сортується за min(group)', async () => {
    const callApi = mockApiResponse({
      order: [0, 1, 2, 3, 4, 5, 6, 7],
      duplicates: [
        { group: [6, 7], recommended: 6, reason: 'high indices first' },
        { group: [2, 3], recommended: 2, reason: 'low indices second' },
        { group: [4, 5], recommended: 4, reason: 'mid' },
      ],
      warnings: [],
      missing: null,
      suggestedName: 'X',
    });
    const items = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => imageItem(i, `t${i}`));
    const result = await sortImages(items, { apiKey: 'x', callApi });
    expect(result.duplicates).toHaveLength(3);
    // Сортовано за min(group) — [2,3], [4,5], [6,7]
    expect(result.duplicates[0].group).toEqual([2, 3]);
    expect(result.duplicates[1].group).toEqual([4, 5]);
    expect(result.duplicates[2].group).toEqual([6, 7]);
  });
});

// ── sortImages: API errors ────────────────────────────────────────────────

describe('imageSortingAgent.sortImages — API errors', () => {
  it('кидає при HTTP помилці', async () => {
    const callApi = vi.fn(async () => {
      const err = new Error('Anthropic API 429: rate limit');
      err.status = 429;
      throw err;
    });
    const items = [imageItem(0, 't'), imageItem(1, 't')];
    await expect(sortImages(items, { apiKey: 'x', callApi })).rejects.toThrow(/429/);
  });
});
