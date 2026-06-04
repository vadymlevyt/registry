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
  streamingMarkdownView,
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
// V2-B2 «Спосіб C»: модель віддає голий Markdown [+ роздільник + JSON-масив
// поміток]. Хелпер будує саме такий вихід (раніше була JSON-обгортка).
const ATTENTION_SEPARATOR = '---ПОМІТКИ---';
function aiResponseText(markdown, attentionNotes = []) {
  let text = String(markdown);
  if (attentionNotes && attentionNotes.length) {
    text += `\n\n${ATTENTION_SEPARATOR}\n${JSON.stringify(attentionNotes)}`;
  }
  return text;
}
function aiJsonResponse(markdown, attentionNotes = []) {
  return {
    content: [{ type: 'text', text: aiResponseText(markdown, attentionNotes) }],
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

  it('успіх (Спосіб C): markdown + роздільник + помітки; форма {note} без page (V2-C)', async () => {
    // AI міг лишити legacy {page,note} у хвості — parse дропає page (форма {note}).
    const d = deps({ callAI: vi.fn(async () => aiJsonResponse('# Чисто', [{ page: 2, note: 'розбіжність' }])) });
    const r = await polishToMarkdown({ draft: 'сирий', apiKey: 'k', ...d });
    expect(r.markdown).toBe('# Чисто');
    expect(r.attentionNotes).toEqual([{ note: 'розбіжність' }]);
    expect(r.attentionNotes[0]).not.toHaveProperty('page');
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

  it('Спосіб C: вихід без роздільника → весь текст = markdown, нотатки [] (graceful)', async () => {
    // Модель не поставила роздільник (digest або певний Чистий) → весь вивід —
    // готовий markdown; вірність тексту збережена, без warning.
    const d = deps({ callAI: vi.fn(async () => ({ content: [{ type: 'text', text: '# Документ\n\nтіло без роздільника' }], usage: {} })) });
    const r = await polishToMarkdown({ draft: 'd', apiKey: 'k', ...d });
    expect(r.markdown).toBe('# Документ\n\nтіло без роздільника');
    expect(r.attentionNotes).toEqual([]);
    expect(r.warning).toBeNull();
  });

  // ── РЕЖИМИ ПРОМТУ (V2-A2) ─────────────────────────────────────────────────
  function promptOf(callAI) {
    return callAI.mock.calls[0][0].messages[0].content;
  }

  it("mode 'clean' (default через відсутність) → строгий промт із заборонами (особа/рід/слово)", async () => {
    const d = deps();
    await polishToMarkdown({ draft: 'сирий', apiKey: 'k', mode: 'clean', ...d });
    const p = promptOf(d.callAI);
    // Залізні заборони Чистого — урок Брановського.
    expect(p).toMatch(/НЕ переставляй/i);
    expect(p).toMatch(/НЕ скороч/i);
    expect(p).toMatch(/НЕ переказуй/i);
    expect(p).toMatch(/особу|рід/i);
    expect(p).toMatch(/НЕ міняй ЖОДНОГО слова/i);
  });

  it("mode 'clean' → промт містить інструкцію ==мітки== уваги + порядок + форму {note} (V2-C)", async () => {
    const d = deps();
    await polishToMarkdown({ draft: 'сирий', apiKey: 'k', mode: 'clean', ...d });
    const p = promptOf(d.callAI);
    // Інлайн-маркер ==фраза== і вимога порядку (мітка ↔ запис).
    expect(p).toMatch(/==фраза==/);
    expect(p).toMatch(/ПОРЯДОК/i);
    // JSON-форма attentionNotes — { note } БЕЗ page.
    expect(p).toMatch(/"note":/);
    expect(p).not.toMatch(/"page":/);
  });

  it("mode 'digest' (default) → промт Конспекту (структурує/переказує, без заборони особи/роду, БЕЗ міток)", async () => {
    const d = deps();
    await polishToMarkdown({ draft: 'сирий', apiKey: 'k', ...d });   // default digest
    const p = promptOf(d.callAI);
    expect(p).toMatch(/читабельн/i);
    // Конспект НЕ має жорсткої заборони зміни особи/роду (це Чистий).
    expect(p).not.toMatch(/НЕ міняй особу/i);
    // Конспект НЕ ставить інлайн-міток і не має page у формі нотатки.
    expect(p).toMatch(/НЕ став інлайн-міток/i);
    expect(p).not.toMatch(/"page":/);
  });
});

// ── КРОК 3 — cleanDocument (оркестрація) ────────────────────────────────────
function orchDeps(overrides = {}) {
  return {
    callAI: vi.fn(async () => aiJsonResponse('# Очищено\n\nфінал', [{ note: 'увага' }])),
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
  it('скоуп-гард (V2-B): clean + не-scanned → skipped (ядро не торкає Drive)', async () => {
    const d = orchDeps();
    const r = await cleanDocument({ document: { ...scannedDoc, documentNature: 'searchable' }, mode: 'clean', apiKey: 'k', ...d });
    expect(r).toEqual({ ok: false, skipped: true, reason: 'not_scanned' });
    expect(d.fetchLayout).not.toHaveBeenCalled();
  });

  it('скоуп-гард (V2-B): digest + searchable → НЕ skipped (Конспект універсальний)', async () => {
    // digest допускає searchable: layout нема → fetchRawText (.txt) → поліш.
    const d = orchDeps({
      fetchLayout: vi.fn(async () => null),
      fetchRawText: vi.fn(async () => 'цифровий текст документа'),
    });
    const r = await cleanDocument({ document: { ...scannedDoc, documentNature: 'searchable' }, mode: 'digest', apiKey: 'k', ...d });
    expect(r.ok).toBe(true);
    expect(d.fetchRawText).toHaveBeenCalled();
    expect(d.saveMarkdown).toHaveBeenCalled();
  });

  it('скоуп-гард (V2-B): digest default + scanned → працює як раніше', async () => {
    const d = orchDeps();
    const r = await cleanDocument({ document: scannedDoc, mode: 'digest', apiKey: 'k', ...d });
    expect(r.ok).toBe(true);
    expect(d.fetchLayout).toHaveBeenCalled();
  });

  it('повний успіх (V2-A2): .md за суфіксом + метадані; .layout/.txt НЕ чіпаємо', async () => {
    const d = orchDeps();
    const r = await cleanDocument({ document: scannedDoc, caseData: { id: 'case_1' }, apiKey: 'k', ...d });
    expect(r.ok).toBe(true);
    expect(r.markdown).toBe('# Очищено\n\nфінал');
    expect(r.attentionNotes).toEqual([{ note: 'увага' }]);
    // saveMarkdown отримує 4-й арг mode (default 'digest').
    expect(d.saveMarkdown).toHaveBeenCalledWith(scannedDoc, { id: 'case_1' }, '# Очищено\n\nфінал', 'digest');
    const [, , meta] = d.updateDocumentMeta.mock.calls[0];   // (document, caseData, meta)
    expect(meta.textFormat).toBe('md');
    expect(typeof meta.cleanedAt).toBe('string');
    expect(meta.mode).toBe('digest');
    expect(meta.attentionNotes).toEqual([{ note: 'увага' }]);
    // V2-A2: .layout/.txt ЗБЕРІГАЮТЬСЯ — жодного moveRawTxtToArchive/deleteLayout.
    expect(d.moveRawTxtToArchive).not.toHaveBeenCalled();
    expect(d.deleteLayout).not.toHaveBeenCalled();
    // Порядок: .md → метадані.
    const order = (fn) => fn.mock.invocationCallOrder[0];
    expect(order(d.saveMarkdown)).toBeLessThan(order(d.updateDocumentMeta));
  });

  it("mode 'clean' пробрасується у saveMarkdown суфікс і meta.mode", async () => {
    const d = orchDeps();
    await cleanDocument({ document: scannedDoc, caseData: { id: 'c' }, apiKey: 'k', mode: 'clean', ...d });
    expect(d.saveMarkdown).toHaveBeenCalledWith(scannedDoc, { id: 'c' }, '# Очищено\n\nфінал', 'clean');
    expect(d.updateDocumentMeta.mock.calls[0][2].mode).toBe('clean');
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

// ── V2-B2 — стрім (Спосіб C) ─────────────────────────────────────────────────
describe('V2-B2 — streamingMarkdownView (показ ДО роздільника)', () => {
  it('без роздільника → весь текст', () => {
    expect(streamingMarkdownView('# Текст\n\nабзац')).toBe('# Текст\n\nабзац');
  });
  it('ховає роздільник і JSON-хвіст поміток', () => {
    expect(streamingMarkdownView('# Текст\n\n---ПОМІТКИ---\n[{"note":"x"}]')).toBe('# Текст');
  });
  it('гасить ХВОСТОВИЙ частковий роздільник (≥ «---П») під час потоку', () => {
    expect(streamingMarkdownView('# Текст\n\n---ПОМІ')).toBe('# Текст');
  });
  it('плоский «---» (межа сторінок / лінія) НЕ обрізається', () => {
    expect(streamingMarkdownView('# А\n\n---')).toBe('# А\n\n---');
  });
});

describe('V2-B2 — polishToMarkdown (стрім opt-in)', () => {
  it('onStreamDelta присутній → callAIStream (стрім), НЕ callAI; емітить markdown без JSON-хвоста', async () => {
    const callAI = vi.fn();
    const callAIStream = vi.fn(async (_params, opts) => {
      // дельти приходять як raw-акумульований (markdown + початок хвоста).
      opts.onDelta('# Чи', '# Чи');
      opts.onDelta('сто', '# Чисто');
      opts.onDelta('\n\n---ПОМІТКИ--', '# Чисто\n\n---ПОМІТКИ--');
      return aiJsonResponse('# Чисто', [{ note: 'увага' }]);
    });
    const seen = [];
    const r = await polishToMarkdown({
      draft: 'd', apiKey: 'k', mode: 'clean',
      onStreamDelta: (md) => seen.push(md),
      callAI, callAIStream, resolveModel: () => 'm', logAiUsage: vi.fn(),
    });
    expect(callAIStream).toHaveBeenCalledTimes(1);
    expect(callAI).not.toHaveBeenCalled();
    expect(r.markdown).toBe('# Чисто');
    expect(r.attentionNotes).toEqual([{ note: 'увага' }]);
    // Хвостовий частковий роздільник у стрімі прихований (показуємо лише markdown).
    expect(seen).toEqual(['# Чи', '# Чисто', '# Чисто']);
    // idleTimeoutMs передається у стрім (не total-timeout).
    expect(callAIStream.mock.calls[0][1]).toHaveProperty('idleTimeoutMs');
  });

  it('без onStreamDelta → callAI (нестрімовий), callAIStream НЕ чіпається', async () => {
    const callAI = vi.fn(async () => aiJsonResponse('# Готово'));
    const callAIStream = vi.fn();
    await polishToMarkdown({ draft: 'd', apiKey: 'k', callAI, callAIStream, resolveModel: () => 'm', logAiUsage: vi.fn() });
    expect(callAI).toHaveBeenCalledTimes(1);
    expect(callAIStream).not.toHaveBeenCalled();
    // нестрімовий шлях передає requestTimeoutMs (total), НЕ idleTimeoutMs.
    expect(callAI.mock.calls[0][1]).toHaveProperty('requestTimeoutMs');
  });
});

describe('V2-B2 — cleanDocument (стрім між пачками)', () => {
  it('onStreamDelta акумулює markdown готових пачок + живої пачки', async () => {
    const bigPage = (n) => ({ _text: `с${n} `.padEnd(30000, 'я'), blocks: [block(0.1, 0.4, 0.9, 0.5)] });
    let call = 0;
    const callAIStream = vi.fn(async (_params, opts) => {
      call += 1;
      opts.onDelta(`# П${call}`, `# П${call}`);
      return aiJsonResponse(`# П${call}`);
    });
    const d = orchDeps({ callAIStream, fetchLayout: vi.fn(async () => ({ pages: [bigPage(1), bigPage(2)] })) });
    const seen = [];
    const r = await cleanDocument({ document: scannedDoc, caseData: { id: 'c' }, apiKey: 'k', onStreamDelta: (md) => seen.push(md), ...d });
    expect(r.ok).toBe(true);
    expect(callAIStream.mock.calls.length).toBeGreaterThanOrEqual(2);   // стрім на КОЖНУ пачку
    // остання емісія несе ОБИДВІ пачки, склеєні роздільником сторінки.
    const last = seen[seen.length - 1];
    expect(last).toContain('# П1');
    expect(last).toContain('# П2');
    expect(last).toContain('---');
  });

  it('без onStreamDelta → нестрімовий callAI, callAIStream НЕ викликається', async () => {
    const callAIStream = vi.fn();
    const d = orchDeps({ callAIStream });
    await cleanDocument({ document: scannedDoc, caseData: { id: 'c' }, apiKey: 'k', ...d });
    expect(callAIStream).not.toHaveBeenCalled();
    expect(d.callAI).toHaveBeenCalled();
  });

  it('долі артефактів незмінні: повний успіх через стрім → .md збережено', async () => {
    const callAIStream = vi.fn(async (_params, opts) => { opts.onDelta('# Готово', '# Готово'); return aiJsonResponse('# Готово'); });
    const d = orchDeps({ callAIStream });
    const r = await cleanDocument({ document: scannedDoc, caseData: { id: 'c' }, apiKey: 'k', onStreamDelta: () => {}, ...d });
    expect(r.ok).toBe(true);
    expect(d.saveMarkdown).toHaveBeenCalledTimes(1);
    expect(d.updateDocumentMeta).toHaveBeenCalledTimes(1);
  });
});
