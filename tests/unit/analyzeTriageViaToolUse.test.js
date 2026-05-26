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

  // TASK triage_maxtokens_diagnostic §4.1 — max_tokens піднято з 4000 до
  // 16000 для томів з 50-74 документами (план ≈ 5900 токенів) щоб Haiku
  // не видавав «здавальницький» план через limit.
  it('body містить max_tokens: 16000 (підвищено з 4000)', async () => {
    const cap = {};
    stubFetchReturning({ documents: [], unusedPages: [] }, cap);
    await analyzeTriageViaToolUse({ artifacts, apiKey: 'k' });
    expect(cap.body.max_tokens).toBe(16000);
  });

  // §4.2 — console.info лог діагностики токенів після API виклику.
  it('console.info логує [Triage] з реальними input/output токенами', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    stubFetchReturning({ documents: [], unusedPages: [] });
    await analyzeTriageViaToolUse({
      artifacts: [{ fileId: 'f0', name: 'a.pdf', pageCount: 285, passport: 'p' }],
      apiKey: 'k',
    });
    const calls = spy.mock.calls.map((c) => c[0]);
    const triageLog = calls.find((m) => typeof m === 'string' && m.includes('[Triage]'));
    expect(triageLog).toBeTruthy();
    expect(triageLog).toMatch(/artifacts=1/);
    expect(triageLog).toMatch(/pages=285/);
    expect(triageLog).toMatch(/input=10t/);
    expect(triageLog).toMatch(/output=5t/);
    expect(triageLog).toMatch(/model=/);
    spy.mockRestore();
  });

  // §4.3 — лог ізольований: відсутність usage не валить pipeline.
  it('відсутність data.usage не валить pipeline (try/catch ізолює лог)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify({ documents: [], unusedPages: [] }) }],
      // usage свідомо відсутній
    }), { status: 200 })));
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const out = await analyzeTriageViaToolUse({ artifacts, apiKey: 'k' });
    expect(out.documents).toEqual([]);
    // Лог все одно викликається, просто з undefined значеннями — це ок,
    // try/catch захищає тільки від throw, а не від undefined в строці.
    const triageLog = spy.mock.calls.map((c) => c[0]).find((m) => typeof m === 'string' && m.includes('[Triage]'));
    expect(triageLog).toBeTruthy();
    expect(triageLog).toMatch(/input=undefinedt/);
    spy.mockRestore();
  });
});
