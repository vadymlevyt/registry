// A7.4 — юніт-тести ядра панелі «Деталі документа»: computeChangedFields.
// Гарантує, що порожня/незмінена правка нічого не повертає (→ нічого не пишеться),
// а '' / undefined / null трактуються як єдиний сенс «не вказано».
import { describe, it, expect } from 'vitest';
import { computeChangedFields } from '../../src/components/DocumentViewer/DocumentDetailsPanel.jsx';

describe('computeChangedFields (A7.4 деталі документа)', () => {
  it('без змін → порожній обʼєкт (нічого не пишемо)', () => {
    const doc = { date: '2026-01-01', author: 'ours', category: 'pleading' };
    const draft = { date: '2026-01-01', author: 'ours', category: 'pleading' };
    expect(computeChangedFields(doc, draft)).toEqual({});
  });

  it('зміна дати → лише поле date', () => {
    const doc = { date: '2026-01-01', author: 'ours', category: 'pleading' };
    const draft = { date: '2026-02-02', author: 'ours', category: 'pleading' };
    expect(computeChangedFields(doc, draft)).toEqual({ date: '2026-02-02' });
  });

  it('зміна author + category → два поля', () => {
    const doc = { date: '2026-01-01', author: 'ours', category: 'pleading' };
    const draft = { date: '2026-01-01', author: 'court', category: 'court_act' };
    expect(computeChangedFields(doc, draft)).toEqual({ author: 'court', category: 'court_act' });
  });

  it("очищення дати (порожнє проти існуючого) → date: null", () => {
    const doc = { date: '2026-01-01', author: 'ours', category: 'pleading' };
    const draft = { date: '', author: 'ours', category: 'pleading' };
    expect(computeChangedFields(doc, draft)).toEqual({ date: null });
  });

  it("'' проти null трактуються однаково → змін немає", () => {
    const doc = { date: null, author: null, category: null };
    const draft = { date: '', author: '', category: '' };
    expect(computeChangedFields(doc, draft)).toEqual({});
  });

  it('встановлення author з порожнього → лише author', () => {
    const doc = { date: null, author: null, category: null };
    const draft = { date: '', author: 'opponent', category: '' };
    expect(computeChangedFields(doc, draft)).toEqual({ author: 'opponent' });
  });

  it('original=undefined не падає (нові/неповні документи)', () => {
    const draft = { date: '2026-05-05', author: '', category: '' };
    expect(computeChangedFields(undefined, draft)).toEqual({ date: '2026-05-05' });
  });
});
