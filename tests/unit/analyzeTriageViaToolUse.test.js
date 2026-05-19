// Ф2 — analyzeTriageViaToolUse: транспорт Triage (Haiku, JSON-parse,
// graceful). fetch мокаємо глобально (патерн toolUseRunner/analyzeViaToolUse).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeTriageViaToolUse } from '../../src/services/documentBoundary/analyzeTriageViaToolUse.js';

const artifacts = [{ fileId: 'f0', name: 'a.pdf', origin: 'pdf', pageCount: 2, passport: '=== СТОРІНКА 1 ===\nтекст' }];

function stubFetchReturning(planJson, capture) {
  vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
    if (capture) capture.body = JSON.parse(opts.body);
    return new Response(JSON.stringify({
      content: [{ type: 'text', text: typeof planJson === 'string' ? planJson : JSON.stringify(planJson) }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }), { status: 200 });
  }));
}

describe('analyzeTriageViaToolUse', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  it('нема apiKey → кидає (createTriageStage трактує НЕ фатально)', async () => {
    await expect(analyzeTriageViaToolUse({ artifacts })).rejects.toThrow(/API ключа/);
  });

  it('модель — Haiku (resolveModel qiParserDocument, R8-фікс — не Sonnet)', async () => {
    const cap = {};
    stubFetchReturning({ documents: [], unusedPages: [] }, cap);
    await analyzeTriageViaToolUse({ artifacts, apiKey: 'k', caseId: 'c1' });
    expect(cap.body.model).toBe('claude-haiku-4-5-20251001');
    expect(cap.body.model).not.toMatch(/sonnet/);
  });

  it('парсить план із content[0].text', async () => {
    stubFetchReturning({
      documents: [{ documentId: 'd1', name: 'Позов', route: 'slice', fragments: [{ fileId: 'f0', startPage: 1, endPage: 2 }] }],
      unusedPages: [],
    });
    const out = await analyzeTriageViaToolUse({ artifacts, apiKey: 'k' });
    expect(out.documents[0].route).toBe('slice');
    expect(out.unusedPages).toEqual([]);
  });

  it('JSON у markdown-обгортці теж парситься (depth-counter)', async () => {
    stubFetchReturning('Ось план:\n```json\n{"documents":[{"documentId":"d1","route":"add_as_is","fragments":[]}],"unusedPages":[]}\n```');
    const out = await analyzeTriageViaToolUse({ artifacts, apiKey: 'k' });
    expect(out.documents[0].route).toBe('add_as_is');
  });

  it('не-JSON відповідь → кидає (createTriageStage → passthrough)', async () => {
    stubFetchReturning('вибач, не можу');
    await expect(analyzeTriageViaToolUse({ artifacts, apiKey: 'k' })).rejects.toThrow(/не-JSON/);
  });
});
