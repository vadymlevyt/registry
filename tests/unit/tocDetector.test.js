// tocDetector — детектор+парсер реєстру/опису матеріалів справи (ФД-T1, TASK ToC).
// Юніти на: 2-кроковий AI-flow, формати аркушів, зміщення нумерації, edge cases
// валідації (overlap, межі тома, покриття), graceful fallback (без throw).
import { describe, it, expect, vi } from 'vitest';
import {
  detectTableOfContents,
  buildDetectPrompt,
  buildParsePrompt,
  validateRegistryItems,
} from '../../src/services/documentBoundary/tocDetector.js';

// ── Хелпери ─────────────────────────────────────────────────────────────────
function layoutOf(textsByPage) {
  return { schemaVersion: 1, pages: textsByPage.map((t) => ({ _text: t })) };
}

// Будує ін'єктовану callAPI яка повертає послідовно задані відповіді.
// queue — масив об'єктів {detect: {...}} / {parse: {...}} / Error / {content: ...}.
function makeCallAPI(responses) {
  let i = 0;
  const calls = [];
  const fn = vi.fn(async (params) => {
    const r = responses[i++];
    calls.push({ params });
    if (r instanceof Error) throw r;
    if (typeof r === 'string') {
      return { content: [{ type: 'text', text: r }], usage: { input_tokens: 10, output_tokens: 5 } };
    }
    return {
      content: [{ type: 'text', text: typeof r === 'string' ? r : JSON.stringify(r) }],
      usage: { input_tokens: 10, output_tokens: 5 },
    };
  });
  fn._calls = calls;
  return fn;
}

// Реалістичний реєстр на 3 стор., 5 документів на аркушах 1-15, після офсету 4-18.
function registryLayoutWith30Documents(totalPages = 35) {
  const lines = ['ОПИС ДОКУМЕНТІВ ЯКІ МІСТЯТЬСЯ В ТОМІ', '№ | Назва документа | Аркуші'];
  for (let i = 1; i <= 30; i++) {
    lines.push(`${i} | Документ № ${i} | ${i}-${i}`);
  }
  const reg = lines.join('\n');
  // 3 сторінки реєстру, потім 30 однотипних сторінок документів.
  return layoutOf([
    reg.slice(0, 300),
    reg.slice(300, 600),
    reg.slice(600),
    ...Array.from({ length: totalPages - 3 }, (_, i) => `документ ${i + 1} тіло`),
  ]);
}

// ── buildDetectPrompt / buildParsePrompt — структурні тести ─────────────────
describe('buildDetectPrompt — структурний', () => {
  it('містить ключові інструкції і JSON-схему', () => {
    const p = buildDetectPrompt({ firstPagesPassport: '=== СТОРІНКА 1 ===\nОпис' });
    expect(p).toContain('реєстр');
    expect(p).toContain('isRegistry');
    expect(p).toContain('registryPages');
    expect(p).toContain('firstDocumentPage');
    expect(p).toContain('ТІЛЬКИ JSON');
    expect(p).toContain('=== СТОРІНКА 1 ===');
  });
  it('без емодзі (#5/§2.9)', () => {
    const p = buildDetectPrompt({ firstPagesPassport: 'x' });
    expect(p).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});

describe('buildParsePrompt — структурний', () => {
  it('інструкція про діапазони / римські цифри / власну нумерацію', () => {
    const p = buildParsePrompt({ registryPassport: 'x' });
    expect(p).toContain('items');
    expect(p).toContain('startLeaf');
    expect(p).toContain('endLeaf');
    expect(p).toMatch(/римські/i);
    expect(p).toContain('зміщення');
    expect(p).toContain('ТІЛЬКИ JSON');
  });
});

// ── validateRegistryItems — формати, offset, edge cases ─────────────────────
describe('validateRegistryItems — діапазони + offset', () => {
  it('звичайні діапазони "1-5", "6", "7-12" зі зміщенням +3', () => {
    const r = validateRegistryItems({
      items: [
        { n: 1, name: 'A', startLeaf: 1, endLeaf: 5 },
        { n: 2, name: 'B', startLeaf: 6, endLeaf: 6 },
        { n: 3, name: 'C', startLeaf: 7, endLeaf: 12 },
      ],
      offset: 3,
      totalPages: 15,
      registryPages: [1, 2, 3],
    });
    expect(r.ok).toBe(true);
    expect(r.items.map((x) => [x.startPage, x.endPage])).toEqual([[4, 8], [9, 9], [10, 15]]);
  });

  it('одна сторінка-документ (startLeaf == endLeaf)', () => {
    const r = validateRegistryItems({
      items: [{ n: 1, name: 'X', startLeaf: 1, endLeaf: 1 }],
      offset: 0,
      totalPages: 1,
      registryPages: [],
    });
    expect(r.ok).toBe(true);
    expect(r.items[0].startPage).toBe(1);
    expect(r.items[0].endPage).toBe(1);
  });

  it('overlap між items → ok:false', () => {
    const r = validateRegistryItems({
      items: [
        { n: 1, name: 'A', startLeaf: 1, endLeaf: 5 },
        { n: 2, name: 'B', startLeaf: 4, endLeaf: 8 },
      ],
      offset: 0,
      totalPages: 8,
      registryPages: [],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/overlap/);
  });

  it('endPage > totalPages → ok:false (range_overflow)', () => {
    const r = validateRegistryItems({
      items: [{ n: 1, name: 'A', startLeaf: 1, endLeaf: 10 }],
      offset: 0,
      totalPages: 5,
      registryPages: [],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('range_overflow');
  });

  it('startPage < 1 (offset від\'ємний) → invalid_range', () => {
    const r = validateRegistryItems({
      items: [{ n: 1, name: 'A', startLeaf: 1, endLeaf: 2 }],
      offset: -5,
      totalPages: 10,
      registryPages: [],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/invalid_range/);
  });

  it('items порожні → empty_items', () => {
    expect(validateRegistryItems({ items: [], offset: 0, totalPages: 5, registryPages: [] }))
      .toMatchObject({ ok: false, reason: 'empty_items' });
    expect(validateRegistryItems({ items: null, offset: 0, totalPages: 5, registryPages: [] }))
      .toMatchObject({ ok: false, reason: 'empty_items' });
  });

  it('нечислові аркуші → non_numeric_leaf', () => {
    const r = validateRegistryItems({
      items: [{ n: 1, name: 'A', startLeaf: 'foo', endLeaf: 'bar' }],
      offset: 0, totalPages: 10, registryPages: [],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('non_numeric_leaf');
  });

  it('покриття НЕ збігається з totalPages (±5% tolerance) → coverage_mismatch', () => {
    // 100 стор. тома, реєстр 3 стор., items сумарно 30 стор. = covered 33,
    // totalPages 100; tolerance = 5, |33-100|=67 > 5 → fail.
    const items = Array.from({ length: 30 }, (_, i) => ({ n: i + 1, name: `D${i}`, startLeaf: i + 1, endLeaf: i + 1 }));
    const r = validateRegistryItems({ items, offset: 3, totalPages: 100, registryPages: [1, 2, 3] });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('coverage_mismatch');
  });

  it('покриття у межах tolerance → ok', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ n: i + 1, name: `D${i}`, startLeaf: i + 1, endLeaf: i + 1 }));
    // 3 рег. + 30 items = 33 ≈ 33 totalPages → ok.
    const r = validateRegistryItems({ items, offset: 3, totalPages: 33, registryPages: [1, 2, 3] });
    expect(r.ok).toBe(true);
    expect(r.items).toHaveLength(30);
  });

  it('items впорядковуються за startPage для перевірки overlap (вхід може бути не за порядком)', () => {
    const r = validateRegistryItems({
      items: [
        { n: 2, name: 'B', startLeaf: 6, endLeaf: 10 },
        { n: 1, name: 'A', startLeaf: 1, endLeaf: 5 },
      ],
      offset: 0,
      totalPages: 10,
      registryPages: [],
    });
    expect(r.ok).toBe(true);
  });
});

// ── detectTableOfContents — end-to-end через ін'єкцію callAPI ───────────────
describe('detectTableOfContents — 2-кроковий AI-flow', () => {
  const fileId = 'f0';

  it('реєстр знайдено + розпарсено → план з усіма items, source toc_detector', async () => {
    const detectResp = {
      isRegistry: true,
      registryHeaderText: 'ОПИС ДОКУМЕНТІВ',
      registryPages: [1, 2, 3],
      firstDocumentPage: 4,
    };
    const items = Array.from({ length: 30 }, (_, i) => ({ n: i + 1, name: `Документ ${i + 1}`, startLeaf: i + 1, endLeaf: i + 1 }));
    const callAPI = makeCallAPI([detectResp, { items }]);
    const out = await detectTableOfContents({
      fileId,
      layoutJson: registryLayoutWith30Documents(33),
      totalPages: 33,
      apiKey: 'k',
      callAPI,
    });
    expect(out.isToc).toBe(true);
    expect(out.plan.source).toBe('toc_detector');
    expect(out.plan.confirmed).toBe(true);
    expect(out.plan.documents).toHaveLength(30);
    // offset 3 (firstDocumentPage 4 → offset 3) — перший документ на фіз. стор. 4.
    expect(out.plan.documents[0].fragments[0].startPage).toBe(4);
    expect(out.plan.documents[29].fragments[0].startPage).toBe(33);
    expect(out.plan.unusedPages[0].reason).toMatch(/реєстр/);
    expect(callAPI).toHaveBeenCalledTimes(2);
  });

  it('AI каже isRegistry:false → isToc:false, parse-крок НЕ викликається', async () => {
    const callAPI = makeCallAPI([{ isRegistry: false, registryHeaderText: null, registryPages: [], firstDocumentPage: null }]);
    const out = await detectTableOfContents({
      fileId,
      layoutJson: layoutOf(['звичайний титульний лист', 'позов', 'продовження']),
      totalPages: 20,
      apiKey: 'k',
      callAPI,
    });
    expect(out.isToc).toBe(false);
    expect(out.reason).toBe('no_registry_detected');
    expect(callAPI).toHaveBeenCalledTimes(1);
  });

  it('detect повернув не-JSON → isToc:false (graceful, без throw)', async () => {
    const callAPI = makeCallAPI(['вибач, не можу']);
    const out = await detectTableOfContents({
      fileId,
      layoutJson: registryLayoutWith30Documents(15),
      totalPages: 15,
      apiKey: 'k',
      callAPI,
    });
    expect(out.isToc).toBe(false);
    expect(out.reason).toMatch(/detect_invalid_json/);
  });

  it('parse повернув items:[] → isToc:false (граничний випадок)', async () => {
    const callAPI = makeCallAPI([
      { isRegistry: true, registryPages: [1], firstDocumentPage: 2 },
      { items: [] },
    ]);
    const out = await detectTableOfContents({
      fileId,
      layoutJson: layoutOf(['ОПИС', 'doc', 'doc2', 'doc3', 'doc4', 'doc5', 'doc6', 'doc7', 'doc8', 'doc9', 'doc10']),
      totalPages: 11,
      apiKey: 'k',
      callAPI,
    });
    expect(out.isToc).toBe(false);
    expect(out.reason).toMatch(/invalid_empty_items/);
  });

  it('parse повернув items з overlap → isToc:false', async () => {
    const callAPI = makeCallAPI([
      { isRegistry: true, registryPages: [1, 2], firstDocumentPage: 3 },
      { items: [
        { n: 1, name: 'A', startLeaf: 1, endLeaf: 5 },
        { n: 2, name: 'B', startLeaf: 4, endLeaf: 7 },
      ] },
    ]);
    const out = await detectTableOfContents({
      fileId,
      layoutJson: layoutOf(Array.from({ length: 15 }, (_, i) => `стор ${i + 1}`)),
      totalPages: 15,
      apiKey: 'k',
      callAPI,
    });
    expect(out.isToc).toBe(false);
    expect(out.reason).toMatch(/invalid_overlap/);
  });

  it('parse повернув endLeaf за межі тома → isToc:false', async () => {
    const callAPI = makeCallAPI([
      { isRegistry: true, registryPages: [1, 2], firstDocumentPage: 3 },
      { items: [{ n: 1, name: 'A', startLeaf: 1, endLeaf: 100 }] },
    ]);
    const out = await detectTableOfContents({
      fileId,
      layoutJson: layoutOf(Array.from({ length: 10 }, () => 'стор')),
      totalPages: 10,
      apiKey: 'k',
      callAPI,
    });
    expect(out.isToc).toBe(false);
    expect(out.reason).toMatch(/invalid_range_overflow/);
  });

  it('AI кинув на detect-кроці → isToc:false, не throw', async () => {
    const callAPI = makeCallAPI([new Error('network down')]);
    const out = await detectTableOfContents({
      fileId,
      layoutJson: registryLayoutWith30Documents(15),
      totalPages: 15,
      apiKey: 'k',
      callAPI,
    });
    expect(out.isToc).toBe(false);
    expect(out.reason).toMatch(/transport.*network/);
  });

  it('firstDocumentPage:null → offset = max(registryPages) (стандартний випадок укр. практики)', async () => {
    const callAPI = makeCallAPI([
      { isRegistry: true, registryPages: [1, 2, 3], firstDocumentPage: null },
      { items: [
        { n: 1, name: 'A', startLeaf: 1, endLeaf: 5 },
        { n: 2, name: 'B', startLeaf: 6, endLeaf: 10 },
      ] },
    ]);
    const out = await detectTableOfContents({
      fileId,
      layoutJson: layoutOf(Array.from({ length: 13 }, () => 'стор')),
      totalPages: 13,
      apiKey: 'k',
      callAPI,
    });
    expect(out.isToc).toBe(true);
    // offset = 3 → перший документ з аркуша 1 = фіз. стор. 4.
    expect(out.plan.documents[0].fragments[0].startPage).toBe(4);
    expect(out.plan.documents[1].fragments[0].endPage).toBe(13);
  });

  it('detectFirstDocumentPage == 1 (реєстру нема всередині тома) → offset 0, документи з фіз. стор. 1', async () => {
    const callAPI = makeCallAPI([
      { isRegistry: true, registryPages: [1], firstDocumentPage: 1 },
      { items: [{ n: 1, name: 'X', startLeaf: 1, endLeaf: 5 }] },
    ]);
    const out = await detectTableOfContents({
      fileId,
      layoutJson: layoutOf(Array.from({ length: 10 }, () => 'стор')),
      totalPages: 10,
      apiKey: 'k',
      // Покриття: items 5 + registryPages 1 = 6, totalPages 10 — поза tolerance 5%.
      // Тому очікуємо coverage_mismatch — це чесна поведінка, реєстр який сам
      // не пов'язаний з томом має fallback'нути на AI Triage.
      callAPI,
    });
    expect(out.isToc).toBe(false);
    expect(out.reason).toMatch(/coverage_mismatch/);
  });

  it('нема apiKey → isToc:false БЕЗ виклику AI (один сенс: фактично не детектор)', async () => {
    const callAPI = makeCallAPI([]);
    const out = await detectTableOfContents({
      fileId,
      layoutJson: registryLayoutWith30Documents(33),
      totalPages: 33,
      callAPI,
    });
    expect(out.isToc).toBe(false);
    expect(out.reason).toBe('no_api_key');
    expect(callAPI).not.toHaveBeenCalled();
  });

  it('нема layout → isToc:false БЕЗ виклику AI', async () => {
    const callAPI = makeCallAPI([]);
    const out = await detectTableOfContents({
      fileId, layoutJson: null, totalPages: 50, apiKey: 'k', callAPI,
    });
    expect(out.isToc).toBe(false);
    expect(out.reason).toBe('no_layout');
    expect(callAPI).not.toHaveBeenCalled();
  });

  it('малий том (<10 стор.) → no AI: економія токенів (стартова точка)', async () => {
    const callAPI = makeCallAPI([]);
    const out = await detectTableOfContents({
      fileId, layoutJson: layoutOf(['x', 'y', 'z']), totalPages: 3, apiKey: 'k', callAPI,
    });
    expect(out.isToc).toBe(false);
    expect(out.reason).toBe('too_small');
    expect(callAPI).not.toHaveBeenCalled();
  });

  it('detect промпт містить лише перші 5 сторінок тома (не весь текст)', async () => {
    const callAPI = makeCallAPI([{ isRegistry: false, registryPages: [], firstDocumentPage: null }]);
    const layout = layoutOf([
      'p1', 'p2', 'p3', 'p4', 'p5',
      'p6-секретний', 'p7-секретний', 'p8-секретний', 'p9-секретний', 'p10-секретний', 'p11-секретний',
    ]);
    await detectTableOfContents({
      fileId, layoutJson: layout, totalPages: 11, apiKey: 'k', callAPI,
    });
    const text = callAPI._calls[0].params.messages[0].content[0].text;
    expect(text).toContain('=== СТОРІНКА 5 ===');
    expect(text).not.toContain('p6-секретний');
    expect(text).not.toContain('p11-секретний');
  });

  it('parse промпт містить тільки сторінки реєстру (за registryPages)', async () => {
    const callAPI = makeCallAPI([
      { isRegistry: true, registryPages: [2, 3], firstDocumentPage: 4 },
      { items: [{ n: 1, name: 'A', startLeaf: 1, endLeaf: 10 }] },
    ]);
    const layout = layoutOf([
      'TITLE p1', 'РЕЄСТР p2', 'РЕЄСТР p3', 'doc4', 'doc5', 'doc6', 'doc7', 'doc8', 'doc9', 'doc10', 'doc11', 'doc12', 'doc13',
    ]);
    await detectTableOfContents({
      fileId, layoutJson: layout, totalPages: 13, apiKey: 'k', callAPI,
    });
    const parseText = callAPI._calls[1].params.messages[0].content[0].text;
    expect(parseText).toContain('РЕЄСТР p2');
    expect(parseText).toContain('РЕЄСТР p3');
    expect(parseText).not.toContain('TITLE p1');
    expect(parseText).not.toContain('doc4');
  });

  it('білінг: aiUsageSink викликається для toc_detect і toc_parse окремими operation', async () => {
    const sink = vi.fn();
    const callAPI = makeCallAPI([
      { isRegistry: true, registryPages: [1, 2], firstDocumentPage: 3 },
      { items: [{ n: 1, name: 'A', startLeaf: 1, endLeaf: 10 }] },
    ]);
    await detectTableOfContents({
      fileId,
      layoutJson: layoutOf([
        'РЕЄСТР', 'РЕЄСТР', 'doc', 'doc', 'doc', 'doc', 'doc', 'doc', 'doc', 'doc', 'doc', 'doc',
      ]),
      totalPages: 12,
      caseId: 'case_x',
      apiKey: 'k',
      callAPI,
      aiUsageSink: sink,
    });
    const operations = sink.mock.calls.map((c) => c[0]?.context?.operation);
    expect(operations).toContain('toc_detect');
    expect(operations).toContain('toc_parse');
  });
});
