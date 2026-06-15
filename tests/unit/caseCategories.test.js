// caseCategories.test.js — TASK case_ui_and_result_polish §2/§3.
// Перевіряє централізований словник назв категорій (правило #11):
// людиночитні назви для всіх enum + «Не визначено» для null/невідомого,
// опції селектора і фільтр-табів, лінива нормалізація military→admin.

import { describe, it, expect } from 'vitest';
import {
  CATEGORY_LABELS,
  CATEGORY_LABELS_SHORT,
  UNKNOWN_CATEGORY_LABEL,
  categoryLabel,
  CATEGORY_SELECT_OPTIONS,
  CATEGORY_FILTER_VALUES,
  normalizeCategoryValue,
} from '../../src/services/caseCategories.js';
import { CANONICAL_CASE_FIELDS } from '../../src/schemas/caseSchema.js';

describe('categoryLabel — людиночитні назви (§2)', () => {
  it('повертає правильні укр-назви для всіх enum', () => {
    expect(categoryLabel('civil')).toBe('Цивільна');
    expect(categoryLabel('criminal')).toBe('Кримінальна');
    expect(categoryLabel('administrative')).toBe('Адміністративна');
    expect(categoryLabel('admin')).toBe('Адміністративна');
    expect(categoryLabel('commercial')).toBe('Господарська');
    expect(categoryLabel('administrative_offense')).toBe('Справа про адміністративне правопорушення');
  });

  it('null / undefined / порожнє / невідоме → «Не визначено»', () => {
    expect(categoryLabel(null)).toBe(UNKNOWN_CATEGORY_LABEL);
    expect(categoryLabel(undefined)).toBe(UNKNOWN_CATEGORY_LABEL);
    expect(categoryLabel('')).toBe(UNKNOWN_CATEGORY_LABEL);
    expect(categoryLabel('zzz_unknown')).toBe(UNKNOWN_CATEGORY_LABEL);
    expect(UNKNOWN_CATEGORY_LABEL).toBe('Не визначено');
  });

  it('short-варіант коротшає лише адмінправопорушення', () => {
    expect(categoryLabel('administrative_offense', { short: true })).toBe('Адмінправопорушення');
    expect(categoryLabel('civil', { short: true })).toBe('Цивільна');
    expect(categoryLabel(null, { short: true })).toBe(UNKNOWN_CATEGORY_LABEL);
  });

  it('military свідомо ВІДСУТНЯ у словнику показу (§3)', () => {
    expect(CATEGORY_LABELS.military).toBeUndefined();
    expect(CATEGORY_LABELS_SHORT.military).toBeUndefined();
    // показ legacy-стрічкового military (до нормалізації) — м'яко «Не визначено»
    expect(categoryLabel('military')).toBe(UNKNOWN_CATEGORY_LABEL);
  });
});

describe('CATEGORY_SELECT_OPTIONS — селектор create/edit (§3)', () => {
  it('пропонує civil/criminal/admin/commercial/administrative_offense, без military', () => {
    const values = CATEGORY_SELECT_OPTIONS.map((o) => o.value);
    expect(values).toEqual(['civil', 'criminal', 'admin', 'commercial', 'administrative_offense']);
    expect(values).not.toContain('military');
  });

  it('кожна опція має непорожній людиночитний підпис', () => {
    for (const o of CATEGORY_SELECT_OPTIONS) {
      expect(typeof o.label).toBe('string');
      expect(o.label.length).toBeGreaterThan(0);
    }
  });
});

describe('CATEGORY_FILTER_VALUES — фільтр-таби (§3)', () => {
  it('містить commercial/administrative_offense, не містить military', () => {
    expect(CATEGORY_FILTER_VALUES).toContain('commercial');
    expect(CATEGORY_FILTER_VALUES).toContain('administrative_offense');
    expect(CATEGORY_FILTER_VALUES).not.toContain('military');
  });
});

describe('caseSchema enum — без military (§3)', () => {
  it('canonical enum категорії не містить military, містить нові', () => {
    const e = CANONICAL_CASE_FIELDS.category.enum;
    expect(e).not.toContain('military');
    expect(e).toContain('admin');
    expect(e).toContain('commercial');
    expect(e).toContain('administrative_offense');
  });
});

describe('normalizeCategoryValue — military→admin (§3)', () => {
  it('переводить military → admin', () => {
    expect(normalizeCategoryValue('military')).toBe('admin');
  });

  it('інші значення лишає незмінними (ідемпотентність)', () => {
    expect(normalizeCategoryValue('admin')).toBe('admin');
    expect(normalizeCategoryValue('civil')).toBe('civil');
    expect(normalizeCategoryValue('commercial')).toBe('commercial');
    expect(normalizeCategoryValue('administrative_offense')).toBe('administrative_offense');
    expect(normalizeCategoryValue(null)).toBe(null);
    expect(normalizeCategoryValue(undefined)).toBe(undefined);
  });
});
