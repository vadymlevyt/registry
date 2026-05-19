// Ф1 Smart Triage — pageMarkers: чистий примітив посторінкових маркерів.
// Покриває корінь R5/R6 (немає якорів сторінок → AI галюцинує межі).
import { describe, it, expect } from 'vitest';
import { buildPagedText, isPagedLayout, buildStructuralPassport } from '../../src/services/documentPipeline/pageMarkers.js';

// Реалістичний об'єкт сторінки Document AI (форма як persist у .layout.json).
const centeredTopBlock = (text) => ({
  layout: { boundingPoly: { normalizedVertices: [
    { x: 0.35, y: 0.05 }, { x: 0.65, y: 0.05 }, { x: 0.65, y: 0.10 }, { x: 0.35, y: 0.10 },
  ] } },
});
const wideBlock = () => ({
  layout: { boundingPoly: { normalizedVertices: [
    { x: 0.05, y: 0.20 }, { x: 0.95, y: 0.20 }, { x: 0.95, y: 0.40 }, { x: 0.05, y: 0.40 },
  ] } },
});

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

describe('pageMarkers.buildStructuralPassport (Ф0)', () => {
  it('контракт як buildPagedText: непридатний layout → ""', () => {
    expect(buildStructuralPassport(null)).toBe('');
    expect(buildStructuralPassport({ pages: [] })).toBe('');
    expect(buildStructuralPassport({ schemaVersion: 1, pages: [{ _text: 'a' }] }, 3)).toBe('');
  });

  it('маркер + текст сторінки завжди присутні (дайджест — додатковий рядок)', () => {
    const out = buildStructuralPassport({ schemaVersion: 1, pages: [{ _text: 'Тіло документа' }] });
    expect(out).toContain('=== СТОРІНКА 1 ===');
    expect(out).toContain('Тіло документа');
  });

  it('заголовок: короткий центрований верхній блок → [заголовок:"..."]', () => {
    const out = buildStructuralPassport({ schemaVersion: 1, pages: [
      { _text: 'РІШЕННЯ\nІменем України...', blocks: [centeredTopBlock(), wideBlock()] },
    ] });
    expect(out).toMatch(/\[.*заголовок:"РІШЕННЯ".*\]/);
  });

  it('широкий некороткий перший блок → без заголовка', () => {
    const out = buildStructuralPassport({ schemaVersion: 1, pages: [
      { _text: 'довгий суцільний абзац тексту без ознак заголовка ' .repeat(4), blocks: [wideBlock()] },
    ] });
    expect(out).not.toContain('заголовок:');
  });

  it('детект скидання нумерації: футер 12 → футер 1 на наступній = СКИДАННЯ-НУМЕРАЦІЇ', () => {
    const out = buildStructuralPassport({ schemaVersion: 1, pages: [
      { _text: 'Документ А, остання сторінка\n12' },
      { _text: 'Документ Б, перша сторінка\n1' },
    ] });
    const p1 = out.split('=== СТОРІНКА 2 ===')[0];
    const p2 = '=== СТОРІНКА 2 ===' + out.split('=== СТОРІНКА 2 ===')[1];
    expect(p1).toContain('футер-№:12');
    expect(p1).not.toContain('СКИДАННЯ-НУМЕРАЦІЇ');
    expect(p2).toContain('футер-№:1');
    expect(p2).toContain('СКИДАННЯ-НУМЕРАЦІЇ');
  });

  it('orientation + dimension + tables + formFields у дайджесті', () => {
    const out = buildStructuralPassport({ schemaVersion: 1, pages: [{
      _text: 'таблична сторінка',
      layout: { orientation: 'PAGE_RIGHT' },
      dimension: { width: 595, height: 842, unit: 'POINTS' }, // A4-портрет ≈ 0.71
      tables: [{}],
      formFields: [{}],
    }] });
    expect(out).toContain('орієнтація:270°');
    expect(out).toContain('формат:портрет(0.71)');
    expect(out).toContain('таблиці');
    expect(out).toContain('поля-форми');
  });

  it('захищеність: відсутні структурні поля → дайджесту нема, паспорт не падає', () => {
    const out = buildStructuralPassport({ schemaVersion: 1, pages: [{ _text: 'лише текст' }] });
    expect(out).toBe('=== СТОРІНКА 1 ===\nлише текст');
  });

  it('повна справа (>50K) не обрізається; кожна сторінка має маркер', () => {
    const pages = Array.from({ length: 65 }, (_, i) => ({ _text: `сторінка ${i + 1} `.repeat(1200) }));
    const out = buildStructuralPassport({ schemaVersion: 1, pages });
    expect(out).toContain('=== СТОРІНКА 1 ===');
    expect(out).toContain('=== СТОРІНКА 65 ===');
    expect(out.length).toBeGreaterThan(50000);
  });
});
