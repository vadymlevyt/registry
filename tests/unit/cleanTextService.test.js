// TASK 3.1 — cleanTextService (спільне ядро очистки тексту → Markdown).
// Покриває: КРОК 1 конденсатор на РЕАЛЬНОМУ Document AI shape (_text +
// boundingPoly посторінково), КРОК 2 AI-поліш (C7 через spy, billAsUserAction),
// КРОК 3 оркестрація cleanDocument (скоуп-гард, fallback, NO_SOURCE, AI-помилка
// → draft, долі артефактів).

import { describe, it, expect, vi } from 'vitest';
import {
  CLEAN_TEXT_SERVICE_VERSION,
  layoutToMarkdownDraft,
  polishToMarkdown,
  cleanDocument,
} from '../../src/services/cleanTextService.js';

// ── Хелпери побудови реального Document AI shape ─────────────────────────────
// Блок з геометрією boundingPoly.normalizedVertices (0..1).
function block(x0, y0, x1, y1) {
  return {
    layout: {
      boundingPoly: {
        normalizedVertices: [
          { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
        ],
      },
    },
  };
}

// Сторінка: _text (надійне джерело) + blocks (геометрія) + optional tables.
function page(text, blocks = [], extra = {}) {
  return { _text: text, blocks, dimension: { width: 595, height: 842 }, ...extra };
}

describe('cleanTextService — версія', () => {
  it('експортує CLEAN_TEXT_SERVICE_VERSION', () => {
    expect(CLEAN_TEXT_SERVICE_VERSION).toBe('2.0');
  });
});

describe('КРОК 1 — layoutToMarkdownDraft (конденсатор, реальний shape)', () => {
  it('порожній / без сторінок → ""', () => {
    expect(layoutToMarkdownDraft(null)).toBe('');
    expect(layoutToMarkdownDraft([])).toBe('');
    expect(layoutToMarkdownDraft({ pages: [] })).toBe('');
  });

  it('читає текст ПОСТОРІНКОВО через page._text (не offset у глобальний txt)', () => {
    const ps = [
      page('Текст першої сторінки.', [block(0.1, 0.4, 0.9, 0.45)]),
      page('Текст другої сторінки.', [block(0.1, 0.4, 0.9, 0.45)]),
    ];
    const draft = layoutToMarkdownDraft(ps);
    expect(draft).toContain('Текст першої сторінки.');
    expect(draft).toContain('Текст другої сторінки.');
    // Сторінки розділені тонким роздільником.
    expect(draft).toContain('\n\n---\n\n');
  });

  it('приймає і .layout.json shape ({ pages: [...] })', () => {
    const layout = { schemaVersion: 1, provider: 'documentAi', pages: [page('Привіт світ.', [block(0.1, 0.4, 0.9, 0.45)])] };
    expect(layoutToMarkdownDraft(layout)).toContain('Привіт світ.');
  });

  it('короткий центрований блок зверху → заголовок ##', () => {
    const ps = [page('УХВАЛА\n\nТекст рішення суду тут.', [
      block(0.35, 0.05, 0.65, 0.09),   // центрований короткий зверху
      block(0.1, 0.2, 0.9, 0.3),
    ])];
    const draft = layoutToMarkdownDraft(ps);
    expect(draft).toContain('## УХВАЛА');
  });

  it('зшиває перенесені дефісом слова (сло-\\nво → слово)', () => {
    const ps = [page('розгля-\nдається справа', [block(0.1, 0.4, 0.9, 0.5)])];
    expect(layoutToMarkdownDraft(ps)).toContain('розглядається справа');
  });

  it('зливає обгорнуті рядки одного абзацу', () => {
    const ps = [page('перший рядок абзацу\nпродовження того ж абзацу.', [block(0.1, 0.4, 0.9, 0.5)])];
    const draft = layoutToMarkdownDraft(ps);
    expect(draft).toContain('перший рядок абзацу продовження того ж абзацу.');
  });

  it('викидає шум — надрукований номер сторінки у футері', () => {
    const ps = [page('Зміст документа.\n\n12', [block(0.1, 0.2, 0.9, 0.3)])];
    const draft = layoutToMarkdownDraft(ps);
    expect(draft).toContain('Зміст документа.');
    // окремий рядок "12" як абзац не лишається
    expect(draft.split('\n').some((l) => l.trim() === '12')).toBe(false);
  });

  it('марковані списки → GFM "- "', () => {
    const ps = [page('• перший пункт\n• другий пункт', [block(0.1, 0.4, 0.9, 0.6)])];
    const draft = layoutToMarkdownDraft(ps);
    expect(draft).toContain('- перший пункт');
    expect(draft).toContain('- другий пункт');
  });

  it('додає підказку AI коли на сторінці є таблиця', () => {
    const ps = [page('Текст з таблицею.', [block(0.1, 0.4, 0.9, 0.5)], { tables: [{ headerRows: [], bodyRows: [] }] })];
    const draft = layoutToMarkdownDraft(ps);
    expect(draft).toContain('таблиц');
  });

  it('сторінка без тексту пропускається', () => {
    const ps = [page('', []), page('Є текст.', [block(0.1, 0.4, 0.9, 0.5)])];
    const draft = layoutToMarkdownDraft(ps);
    expect(draft.trim()).toBe('Є текст.');
  });
});

// ── КРОК 2 — polishToMarkdown ───────────────────────────────────────────────
function aiJsonResponse(markdown, attentionNotes = []) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ markdown, attentionNotes }) }],
    usage: { input_tokens: 100, output_tokens: 200 },
  };
}

function deps(overrides = {}) {
  return {
    callAI: vi.fn(async () => aiJsonResponse('# Готовий\n\nтекст')),
    resolveModel: vi.fn(() => 'claude-haiku-4-5-20251001'),
    logAiUsage: vi.fn(),
    activityTracker: { report: vi.fn() },
    ...overrides,
  };
}

describe('КРОК 2 — polishToMarkdown (AI-поліш + C7)', () => {
  it('нема apiKey → markdown=draft + warning (без AI-виклику)', async () => {
    const d = deps();
    const r = await polishToMarkdown({ draft: 'сирий', apiKey: null, ...d });
    expect(r.markdown).toBe('сирий');
    expect(r.warning).toMatch(/AI недоступний/);
    expect(d.callAI).not.toHaveBeenCalled();
  });

  it('порожня чернетка → markdown="" + warning', async () => {
    const d = deps();
    const r = await polishToMarkdown({ draft: '   ', apiKey: 'k', ...d });
    expect(r.markdown).toBe('');
    expect(d.callAI).not.toHaveBeenCalled();
  });

  it('успіх: парсить JSON {markdown, attentionNotes}', async () => {
    const d = deps({ callAI: vi.fn(async () => aiJsonResponse('# Чисто', [{ page: 2, note: 'розбіжність' }])) });
    const r = await polishToMarkdown({ draft: 'сирий', apiKey: 'k', ...d });
    expect(r.markdown).toBe('# Чисто');
    expect(r.attentionNotes).toEqual([{ page: 2, note: 'розбіжність' }]);
    expect(r.warning).toBeNull();
  });

  it('C7: logAiUsage agentType "text_cleaner", operation "clean_text" (токени завжди)', async () => {
    const d = deps();
    await polishToMarkdown({ draft: 'x', apiKey: 'k', caseId: 'case_1', documentId: 'doc_1', module: 'document_processor', aiUsageSink: vi.fn(), ...d });
    expect(d.logAiUsage).toHaveBeenCalledTimes(1);
    const [params] = d.logAiUsage.mock.calls[0];
    expect(params.agentType).toBe('text_cleaner');
    expect(params.context.operation).toBe('clean_text');
    expect(params.context.caseId).toBe('case_1');
    expect(params.context.documentId).toBe('doc_1');
    expect(params.context.module).toBe('document_processor');
  });

  it('polishToMarkdown НЕ викликає activityTracker (дія — раз на документ у cleanDocument)', async () => {
    const d = deps();
    // activityTracker не приймається polishToMarkdown — перевіряємо, що поліш не
    // тягне його навіть якщо передати (ігнорується).
    const at = { report: vi.fn() };
    await polishToMarkdown({ draft: 'x', apiKey: 'k', activityTracker: at, ...d });
    expect(at.report).not.toHaveBeenCalled();
  });

  it('max_tokens рахується від обсягу (не фіксований 8000) і не перевищує 64000', async () => {
    const d = deps();
    // велика чернетка (>128K симв ≈ >64K ток) → max_tokens впирається у стелю 64000
    await polishToMarkdown({ draft: 'я'.repeat(200000), apiKey: 'k', ...d });
    const [params] = d.callAI.mock.calls[0];
    expect(params.max_tokens).toBeLessThanOrEqual(64000);
    expect(params.max_tokens).toBeGreaterThan(8000);   // не спадковий фіксований 8000
  });

  it('передане maxTokens поважається (у межах стелі)', async () => {
    const d = deps();
    await polishToMarkdown({ draft: 'короткий', apiKey: 'k', maxTokens: 12345, ...d });
    expect(d.callAI.mock.calls[0][0].max_tokens).toBe(12345);
  });

  it('stop_reason=max_tokens → truncated:true + warning', async () => {
    const d = deps({ callAI: vi.fn(async () => ({ ...aiJsonResponse('# обрізано'), stop_reason: 'max_tokens' })) });
    const r = await polishToMarkdown({ draft: 'x', apiKey: 'k', ...d });
    expect(r.truncated).toBe(true);
    expect(r.warning).toMatch(/обрізав/);
  });

  it('callAI кинув → markdown=draft + warning (не падає)', async () => {
    const d = deps({ callAI: vi.fn(async () => { throw new Error('429'); }) });
    const r = await polishToMarkdown({ draft: 'сирий-текст', apiKey: 'k', ...d });
    expect(r.markdown).toBe('сирий-текст');
    expect(r.warning).toMatch(/не вдалась/);
  });

  it('AI повернув не-JSON непорожнє → беремо як plain + warning', async () => {
    const d = deps({ callAI: vi.fn(async () => ({ content: [{ type: 'text', text: 'просто текст без json' }], usage: {} })) });
    const r = await polishToMarkdown({ draft: 'd', apiKey: 'k', ...d });
    expect(r.markdown).toBe('просто текст без json');
    expect(r.warning).toMatch(/не-JSON/);
  });
});

// ── КРОК 3 — cleanDocument (оркестрація) ────────────────────────────────────
function orchDeps(overrides = {}) {
  return {
    callAI: vi.fn(async () => aiJsonResponse('# Очищено\n\nфінал', [{ page: null, note: 'увага' }])),
    resolveModel: vi.fn(() => 'claude-haiku-4-5-20251001'),
    logAiUsage: vi.fn(),
    activityTracker: { report: vi.fn() },
    fetchLayout: vi.fn(async () => ({ pages: [{ _text: 'сирий текст сторінки', blocks: [block(0.1, 0.4, 0.9, 0.5)] }] })),
    fetchRawText: vi.fn(async () => ''),
    saveMarkdown: vi.fn(async () => true),
    moveRawTxtToArchive: vi.fn(async () => true),
    deleteLayout: vi.fn(async () => true),
    updateDocumentMeta: vi.fn(async () => true),
    ...overrides,
  };
}

const scannedDoc = { id: 'doc_1', name: 'Ухвала.pdf', documentNature: 'scanned', driveId: 'drv_1' };

describe('КРОК 3 — cleanDocument (оркестрація)', () => {
  it('скоуп-гард: documentNature !== "scanned" → skipped', async () => {
    const d = orchDeps();
    const r = await cleanDocument({ document: { ...scannedDoc, documentNature: 'searchable' }, apiKey: 'k', ...d });
    expect(r).toEqual({ ok: false, skipped: true, reason: 'not_scanned' });
    expect(d.fetchLayout).not.toHaveBeenCalled();
  });

  it('повний успіх: долі артефактів у CRASH-SAFE порядку (md→meta→txt→layout)', async () => {
    const d = orchDeps();
    const r = await cleanDocument({ document: scannedDoc, caseData: { id: 'case_1' }, apiKey: 'k', ...d });
    expect(r.ok).toBe(true);
    expect(r.markdown).toBe('# Очищено\n\nфінал');
    expect(r.attentionNotes).toEqual([{ page: null, note: 'увага' }]);
    expect(d.saveMarkdown).toHaveBeenCalledWith(scannedDoc, { id: 'case_1' }, '# Очищено\n\nфінал');
    const [, , meta] = d.updateDocumentMeta.mock.calls[0];   // (document, caseData, meta)
    expect(meta.textFormat).toBe('md');
    expect(typeof meta.cleanedAt).toBe('string');
    expect(meta.attentionNotes).toEqual([{ page: null, note: 'увага' }]);
    // CRASH-SAFE порядок: .md → метадані → .txt у архів → .layout видалити.
    const order = (fn) => fn.mock.invocationCallOrder[0];
    expect(order(d.saveMarkdown)).toBeLessThan(order(d.updateDocumentMeta));
    expect(order(d.updateDocumentMeta)).toBeLessThan(order(d.moveRawTxtToArchive));
    expect(order(d.moveRawTxtToArchive)).toBeLessThan(order(d.deleteLayout));
  });

  it('великий документ → ПАЧКУВАННЯ: кілька викликів AI, склейка через роздільник', async () => {
    // 3 сторінки по ~30000 симв (~15000 ток) → пачка ~24000 ток → 3 пачки.
    const bigPage = (n) => ({ _text: `сторінка ${n} `.padEnd(30000, 'я'), blocks: [block(0.1, 0.4, 0.9, 0.5)] });
    let call = 0;
    const callAI = vi.fn(async () => { call += 1; return aiJsonResponse(`# Пачка ${call}`); });
    const d = orchDeps({ callAI, fetchLayout: vi.fn(async () => ({ pages: [bigPage(1), bigPage(2), bigPage(3)] })) });
    const r = await cleanDocument({ document: scannedDoc, caseData: { id: 'c' }, apiKey: 'k', ...d });
    expect(r.ok).toBe(true);
    expect(callAI.mock.calls.length).toBeGreaterThanOrEqual(2);   // кілька пачок
    expect(r.markdown).toContain('---');                          // склейка через роздільник
    expect(r.stats.batches).toBeGreaterThanOrEqual(2);
  });

  it('TRUNCATION-GUARD: одна сторінка обрізана (max_tokens) → джерела НЕДОТОРКАНІ, ok:false', async () => {
    const callAI = vi.fn(async () => ({ ...aiJsonResponse('# обрізок'), stop_reason: 'max_tokens' }));
    const d = orchDeps({ callAI, fetchLayout: vi.fn(async () => ({ pages: [{ _text: 'одна сторінка', blocks: [block(0.1, 0.4, 0.9, 0.5)] }] })) });
    const r = await cleanDocument({ document: scannedDoc, caseData: { id: 'c' }, apiKey: 'k', ...d });
    expect(r.ok).toBe(false);
    expect(r.degraded).toBe(true);
    expect(r.needsRecleaning).toBe(true);
    // НІЧОГО не руйнуємо і не фіналізуємо.
    expect(d.saveMarkdown).not.toHaveBeenCalled();
    expect(d.updateDocumentMeta).not.toHaveBeenCalled();
    expect(d.moveRawTxtToArchive).not.toHaveBeenCalled();
    expect(d.deleteLayout).not.toHaveBeenCalled();
  });

  it('AI кинув → ДЕГРАДОВАНО: джерела недоторкані, .md НЕ фіналізується (ok:false)', async () => {
    const d = orchDeps({ callAI: vi.fn(async () => { throw new Error('boom'); }) });
    const r = await cleanDocument({ document: scannedDoc, caseData: { id: 'c' }, apiKey: 'k', ...d });
    expect(r.ok).toBe(false);
    expect(r.degraded).toBe(true);
    expect(d.saveMarkdown).not.toHaveBeenCalled();
    expect(d.deleteLayout).not.toHaveBeenCalled();
    expect(d.moveRawTxtToArchive).not.toHaveBeenCalled();
  });

  it('нема ключа → ДЕГРАДОВАНО: чернетка не фіналізується, джерела недоторкані', async () => {
    const d = orchDeps();
    const r = await cleanDocument({ document: scannedDoc, caseData: { id: 'c' }, apiKey: null, ...d });
    expect(r.ok).toBe(false);
    expect(r.degraded).toBe(true);
    expect(d.saveMarkdown).not.toHaveBeenCalled();
    expect(d.deleteLayout).not.toHaveBeenCalled();
  });

  it('нема layout, але є сирий .txt → плоска чернетка; deleteLayout НЕ викликається', async () => {
    const d = orchDeps({
      fetchLayout: vi.fn(async () => null),
      fetchRawText: vi.fn(async () => 'сирий txt fallback'),
    });
    const r = await cleanDocument({ document: scannedDoc, caseData: { id: 'c' }, apiKey: 'k', ...d });
    expect(r.ok).toBe(true);
    expect(d.deleteLayout).not.toHaveBeenCalled();            // usedLayout false
    expect(d.saveMarkdown).toHaveBeenCalledTimes(1);
  });

  it('ні layout, ні txt → NO_SOURCE', async () => {
    const d = orchDeps({ fetchLayout: vi.fn(async () => null), fetchRawText: vi.fn(async () => '') });
    const r = await cleanDocument({ document: scannedDoc, apiKey: 'k', ...d });
    expect(r).toEqual({ ok: false, error: 'NO_SOURCE' });
    expect(d.saveMarkdown).not.toHaveBeenCalled();
  });

  it('billAsUserAction:true → activityTracker РАЗ на документ (не на пачку)', async () => {
    // 3 пачки, але дія адвоката рахується ОДИН раз.
    const bigPage = (n) => ({ _text: `с${n} `.padEnd(30000, 'я'), blocks: [block(0.1, 0.4, 0.9, 0.5)] });
    const d = orchDeps({ fetchLayout: vi.fn(async () => ({ pages: [bigPage(1), bigPage(2), bigPage(3)] })) });
    await cleanDocument({ document: scannedDoc, caseData: { id: 'c' }, apiKey: 'k', billAsUserAction: true, ...d });
    expect(d.activityTracker.report).toHaveBeenCalledTimes(1);
    // logAiUsage — на КОЖНУ пачку (точна вартість).
    expect(d.logAiUsage.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('billAsUserAction:false (DP) → activityTracker НЕ викликається; токени логуються', async () => {
    const d = orchDeps();
    await cleanDocument({ document: scannedDoc, caseData: { id: 'c' }, apiKey: 'k', billAsUserAction: false, ...d });
    expect(d.activityTracker.report).not.toHaveBeenCalled();
    expect(d.logAiUsage).toHaveBeenCalled();
  });

  it('module прокидається у logAiUsage і activityTracker', async () => {
    const d = orchDeps();
    await cleanDocument({ document: scannedDoc, caseData: { id: 'c' }, apiKey: 'k', module: 'case_dossier', billAsUserAction: true, ...d });
    expect(d.logAiUsage.mock.calls[0][0].context.module).toBe('case_dossier');
    expect(d.activityTracker.report.mock.calls[0][1].module).toBe('case_dossier');
  });

  it('документ відсутній → NO_DOCUMENT', async () => {
    const r = await cleanDocument({ document: null, apiKey: 'k', ...orchDeps() });
    expect(r).toEqual({ ok: false, error: 'NO_DOCUMENT' });
  });
});
