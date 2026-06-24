// A7.2 — чисті примітиви редагування плану нарізки (slicePlanModel).
import { describe, it, expect } from 'vitest';
import {
  pageKey, parsePageKey, collapsePagesToFragments,
  planToGroups, groupsToPlan,
  renameGroup, setGroupType, setGroupDate, splitGroupAt, mergeWithNext, movePage, removeGroup,
  isIsoDate, resolveEffectiveDate,
} from '../../src/services/documentPipeline/slicePlanModel.js';

const PLAN = {
  documents: [
    { documentId: 'd1', name: 'Позов', type: 'pleading', route: 'slice', fragments: [{ fileId: 'a', startPage: 1, endPage: 3 }] },
    { documentId: 'd2', name: 'Ухвала', type: 'court_act', route: 'slice', fragments: [{ fileId: 'a', startPage: 4, endPage: 5 }] },
  ],
  unusedPages: [{ fileId: 'a', startPage: 6, endPage: 6, reason: 'порожня' }],
};

describe('pageKey / parsePageKey', () => {
  it('round-trip', () => {
    const k = pageKey('inbox_x9', 7);
    expect(k).toBe('inbox_x9::7');
    expect(parsePageKey(k)).toEqual({ fileId: 'inbox_x9', pageNumber: 7 });
  });
  it('fileId з "::" не ламає parse (бере останній роздільник)', () => {
    // fileId зазвичай без "::", але lastIndexOf робить parse стійким.
    expect(parsePageKey('a::3')).toEqual({ fileId: 'a', pageNumber: 3 });
  });
  it('невалідне → null', () => {
    expect(parsePageKey('abc')).toBeNull();
    expect(parsePageKey('')).toBeNull();
  });
});

describe('collapsePagesToFragments', () => {
  it('суцільний пробіг одного файла → один діапазон', () => {
    const pages = [{ fileId: 'a', pageNumber: 1 }, { fileId: 'a', pageNumber: 2 }, { fileId: 'a', pageNumber: 3 }];
    expect(collapsePagesToFragments(pages)).toEqual([{ fileId: 'a', startPage: 1, endPage: 3 }]);
  });
  it('пропуск номера розриває діапазон', () => {
    const pages = [{ fileId: 'a', pageNumber: 1 }, { fileId: 'a', pageNumber: 3 }];
    expect(collapsePagesToFragments(pages)).toEqual([
      { fileId: 'a', startPage: 1, endPage: 1 },
      { fileId: 'a', startPage: 3, endPage: 3 },
    ]);
  });
  it('зміна файла розриває діапазон', () => {
    const pages = [{ fileId: 'a', pageNumber: 1 }, { fileId: 'b', pageNumber: 1 }];
    expect(collapsePagesToFragments(pages)).toEqual([
      { fileId: 'a', startPage: 1, endPage: 1 },
      { fileId: 'b', startPage: 1, endPage: 1 },
    ]);
  });
});

describe('planToGroups / groupsToPlan round-trip', () => {
  it('розгортає у сторінки і згортає назад у канонічний план', () => {
    const { groups, unusedPages } = planToGroups(PLAN);
    expect(groups).toHaveLength(2);
    expect(groups[0].pages).toEqual([
      { fileId: 'a', pageNumber: 1 }, { fileId: 'a', pageNumber: 2 }, { fileId: 'a', pageNumber: 3 },
    ]);
    expect(groups[1].pages).toHaveLength(2);
    const plan = groupsToPlan(groups, unusedPages);
    expect(plan.documents).toHaveLength(2);
    expect(plan.documents[0]).toMatchObject({
      documentId: 'd1', name: 'Позов', type: 'pleading', route: 'slice',
      fragments: [{ fileId: 'a', startPage: 1, endPage: 3 }],
    });
    expect(plan.unusedPages).toEqual(PLAN.unusedPages);
  });
  it('порожня група відкидається у groupsToPlan', () => {
    const groups = [{ docId: 'd1', name: '', type: '', route: 'slice', pages: [] }];
    expect(groupsToPlan(groups).documents).toHaveLength(0);
  });
  it('порожня назва → null у плані', () => {
    const groups = [{ docId: 'd1', name: '   ', type: '', route: 'slice', pages: [{ fileId: 'a', pageNumber: 1 }] }];
    expect(groupsToPlan(groups).documents[0].name).toBeNull();
  });
});

describe('rename / setType', () => {
  it('міняє лише цільову групу', () => {
    const { groups } = planToGroups(PLAN);
    const r = renameGroup(groups, 'd2', 'Нова назва');
    expect(r[1].name).toBe('Нова назва');
    expect(r[0].name).toBe('Позов');
    const t = setGroupType(r, 'd2', 'evidence');
    expect(t[1].type).toBe('evidence');
  });
});

describe('splitGroupAt', () => {
  it('розділяє межу: голова лишається, хвіст — новий документ одразу після', () => {
    const { groups } = planToGroups(PLAN);
    const r = splitGroupAt(groups, 'd1', pageKey('a', 2));   // стор.2 стає новим документом
    expect(r).toHaveLength(3);
    expect(r[0].pages).toEqual([{ fileId: 'a', pageNumber: 1 }]);
    expect(r[1].pages).toEqual([{ fileId: 'a', pageNumber: 2 }, { fileId: 'a', pageNumber: 3 }]);
    expect(r[1].name).toBe('');                              // новий документ без назви
    expect(r[1].route).toBe('slice');                        // успадкований route
    expect(r[2].docId).toBe('d2');                           // d2 лишився далі
  });
  it('розділ на першій сторінці — no-op', () => {
    const { groups } = planToGroups(PLAN);
    expect(splitGroupAt(groups, 'd1', pageKey('a', 1))).toBe(groups);
  });
  it('план після split згортається у 3 документи з коректними діапазонами', () => {
    const { groups } = planToGroups(PLAN);
    const r = splitGroupAt(groups, 'd1', pageKey('a', 2));
    const plan = groupsToPlan(r);
    expect(plan.documents.map((d) => d.fragments)).toEqual([
      [{ fileId: 'a', startPage: 1, endPage: 1 }],
      [{ fileId: 'a', startPage: 2, endPage: 3 }],
      [{ fileId: 'a', startPage: 4, endPage: 5 }],
    ]);
  });
});

describe('mergeWithNext', () => {
  it('конкатить сторінки сусідів, межа зникає', () => {
    const { groups } = planToGroups(PLAN);
    const r = mergeWithNext(groups, 'd1');
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('Позов');                         // назва першого
    expect(r[0].pages).toHaveLength(5);
    const plan = groupsToPlan(r);
    expect(plan.documents[0].fragments).toEqual([{ fileId: 'a', startPage: 1, endPage: 5 }]);
  });
  it('останній документ — no-op', () => {
    const { groups } = planToGroups(PLAN);
    expect(mergeWithNext(groups, 'd2')).toBe(groups);
  });
});

describe('movePage', () => {
  it('переносить сторінку межі у сусідній документ (зсув межі)', () => {
    const { groups } = planToGroups(PLAN);
    // стор.4 (перша у d2) → у кінець d1: межа зсувається на одну сторінку.
    const r = movePage(groups, pageKey('a', 4), 'd1', null);
    expect(r[0].pages.map((p) => p.pageNumber)).toEqual([1, 2, 3, 4]);
    expect(r[1].pages.map((p) => p.pageNumber)).toEqual([5]);
  });
  it('вставка ПЕРЕД конкретною сторінкою цілі', () => {
    const { groups } = planToGroups(PLAN);
    const r = movePage(groups, pageKey('a', 4), 'd1', pageKey('a', 1));
    expect(r[0].pages.map((p) => p.pageNumber)).toEqual([4, 1, 2, 3]);
  });
  it('спорожніла група-джерело прибирається', () => {
    const groups = [
      { docId: 'd1', name: 'A', type: '', route: 'slice', pages: [{ fileId: 'a', pageNumber: 1 }] },
      { docId: 'd2', name: 'B', type: '', route: 'slice', pages: [{ fileId: 'a', pageNumber: 2 }] },
    ];
    const r = movePage(groups, pageKey('a', 2), 'd1', null);
    expect(r).toHaveLength(1);
    expect(r[0].pages.map((p) => p.pageNumber)).toEqual([1, 2]);
  });
  it('сторінки немає — no-op', () => {
    const { groups } = planToGroups(PLAN);
    expect(movePage(groups, pageKey('zzz', 9), 'd1', null)).toBe(groups);
  });
});

describe('removeGroup', () => {
  it('видаляє документ', () => {
    const { groups } = planToGroups(PLAN);
    const r = removeGroup(groups, 'd1');
    expect(r).toHaveLength(1);
    expect(r[0].docId).toBe('d2');
  });
});

// ── A7.3 · дата вузла (виняток ii) ──────────────────────────────────────────
describe('isIsoDate', () => {
  it('валідна ISO-дата', () => {
    expect(isIsoDate('2026-03-14')).toBe(true);
  });
  it('невалідне → false', () => {
    expect(isIsoDate('14.03.2026')).toBe(false);
    expect(isIsoDate('')).toBe(false);
    expect(isIsoDate(null)).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });
});

describe('resolveEffectiveDate (manual завжди перемагає; auto лише при тумблері)', () => {
  it('manual з датою → дата, незалежно від тумблера', () => {
    const node = { date: '2026-03-14', dateSource: 'manual' };
    expect(resolveEffectiveDate(node, false)).toBe('2026-03-14');
    expect(resolveEffectiveDate(node, true)).toBe('2026-03-14');
  });
  it('manual-null (явне «без дати») → null навіть при тумблері ON', () => {
    const node = { date: '', dateSource: 'manual' };
    expect(resolveEffectiveDate(node, true)).toBeNull();
    expect(resolveEffectiveDate(node, false)).toBeNull();
  });
  it('auto: тумблер ON → AI-дата; OFF → null', () => {
    const node = { date: '2026-03-14', dateSource: 'auto' };
    expect(resolveEffectiveDate(node, true)).toBe('2026-03-14');
    expect(resolveEffectiveDate(node, false)).toBeNull();
  });
  it('auto без дати → null у будь-якому стані', () => {
    const node = { date: null, dateSource: 'auto' };
    expect(resolveEffectiveDate(node, true)).toBeNull();
    expect(resolveEffectiveDate(node, false)).toBeNull();
  });
});

describe('planToGroups / groupsToPlan — date + dateSource', () => {
  it('AI-дата з плану → вузол з dateSource auto', () => {
    const plan = { documents: [
      { documentId: 'd1', name: 'Ухвала', route: 'add_as_is', date: '2026-03-14', fragments: [{ fileId: 'a', startPage: 1, endPage: 1 }] },
    ], unusedPages: [] };
    const { groups } = planToGroups(plan);
    expect(groups[0].date).toBe('2026-03-14');
    expect(groups[0].dateSource).toBe('auto');
  });
  it('без дати у плані → date "" + auto', () => {
    const { groups } = planToGroups(PLAN);
    expect(groups[0].date).toBe('');
    expect(groups[0].dateSource).toBe('auto');
  });
  it('applyAutoDates їде на рівні плану; вузли несуть сиру date+dateSource', () => {
    const { groups } = planToGroups({ documents: [
      { documentId: 'd1', name: 'X', route: 'add_as_is', date: '2026-01-02', fragments: [{ fileId: 'a', startPage: 1, endPage: 1 }] },
    ], unusedPages: [] });
    const planOff = groupsToPlan(groups, [], false);
    expect(planOff.applyAutoDates).toBe(false);
    expect(planOff.documents[0]).toMatchObject({ date: '2026-01-02', dateSource: 'auto' });
    const planOn = groupsToPlan(groups, [], true);
    expect(planOn.applyAutoDates).toBe(true);
  });
  it('groupsToPlan default applyAutoDates = false (behavior-preserving)', () => {
    const { groups, unusedPages } = planToGroups(PLAN);
    expect(groupsToPlan(groups, unusedPages).applyAutoDates).toBe(false);
  });
});

describe('setGroupDate', () => {
  it('поставити дату → manual', () => {
    const { groups } = planToGroups(PLAN);
    const r = setGroupDate(groups, 'd1', '2026-05-01');
    expect(r[0]).toMatchObject({ date: '2026-05-01', dateSource: 'manual' });
    expect(r[1].dateSource).toBe('auto');                 // лише цільову
  });
  it('явне «без дати» ("") → manual-null', () => {
    const { groups } = planToGroups(PLAN);
    const r = setGroupDate(groups, 'd1', '');
    expect(r[0]).toMatchObject({ date: '', dateSource: 'manual' });
  });
  it('невалідна дата → "" + manual', () => {
    const { groups } = planToGroups(PLAN);
    const r = setGroupDate(groups, 'd1', '14.05.2026');
    expect(r[0]).toMatchObject({ date: '', dateSource: 'manual' });
  });
});

describe('splitGroupAt / mergeWithNext — дата', () => {
  it('хвіст split — новий документ без успадкованої дати (auto, порожньо)', () => {
    const plan = { documents: [
      { documentId: 'd1', name: 'A', route: 'slice', date: '2026-03-14', fragments: [{ fileId: 'a', startPage: 1, endPage: 3 }] },
    ], unusedPages: [] };
    const { groups } = planToGroups(plan);
    const r = splitGroupAt(groups, 'd1', pageKey('a', 2));
    expect(r[0].date).toBe('2026-03-14');                 // голова лишає дату
    expect(r[1]).toMatchObject({ date: '', dateSource: 'auto' });  // хвіст — без дати
  });
  it('merge зберігає дату/джерело першого документа', () => {
    const { groups } = planToGroups(PLAN);
    const withDate = setGroupDate(groups, 'd1', '2026-02-02');
    const r = mergeWithNext(withDate, 'd1');
    expect(r[0]).toMatchObject({ date: '2026-02-02', dateSource: 'manual' });
  });
});
