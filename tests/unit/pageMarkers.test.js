// Ф1 Smart Triage — pageMarkers: чистий примітив посторінкових маркерів.
// Покриває корінь R5/R6 (немає якорів сторінок → AI галюцинує межі).
import { describe, it, expect } from 'vitest';
import { buildPagedText, isPagedLayout } from '../../src/services/documentPipeline/pageMarkers.js';

const layout = (texts) => ({ schemaVersion: 1, pages: texts.map((t) => ({ _text: t })) });

describe('pageMarkers.isPagedLayout', () => {
  it('null / порожні pages → false', () => {
    expect(isPagedLayout(null)).toBe(false);
    expect(isPagedLayout({})).toBe(false);
    expect(isPagedLayout({ pages: [] })).toBe(false);
  });

  it('непорожні pages → true', () => {
    expect(isPagedLayout(layout(['a', 'b']))).toBe(true);
  });

  it('expectedPageCount розбіжний (resume — неповний layout) → false', () => {
    expect(isPagedLayout(layout(['a', 'b']), 3)).toBe(false);
    expect(isPagedLayout(layout(['a', 'b', 'c']), 3)).toBe(true);
  });
});

describe('pageMarkers.buildPagedText', () => {
  it('маркер === СТОРІНКА N === перед кожною сторінкою, 1-based', () => {
    const out = buildPagedText(layout(['Позовна заява', 'Ухвала суду']));
    expect(out).toBe('=== СТОРІНКА 1 ===\nПозовна заява\n\n=== СТОРІНКА 2 ===\nУхвала суду');
  });

  it('усі сторінки присутні (НЕ обрізається) — велика справа', () => {
    const big = Array.from({ length: 65 }, (_, i) => `сторінка ${i + 1} `.repeat(1500));
    const out = buildPagedText(layout(big));
    expect(out).toContain('=== СТОРІНКА 1 ===');
    expect(out).toContain('=== СТОРІНКА 65 ===');
    expect(out.length).toBeGreaterThan(50000); // стара 50K-обрізка прибрана
  });

  it('layout непридатний (resume / нема структури) → "" (caller лишається на plain тексті)', () => {
    expect(buildPagedText(null)).toBe('');
    expect(buildPagedText(layout(['a', 'b']), 5)).toBe('');
  });

  it('порожній _text сторінки → маркер без тексту (порожня сторінка лишається видимою AI)', () => {
    const out = buildPagedText({ schemaVersion: 1, pages: [{ _text: '' }, { _text: 'X' }] });
    expect(out).toBe('=== СТОРІНКА 1 ===\n\n\n=== СТОРІНКА 2 ===\nX');
  });
});
