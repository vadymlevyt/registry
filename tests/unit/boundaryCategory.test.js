// Мапа boundary-type → canonical category. Винесено з classifyV2 при чистці
// мертвих поколінь пошуку меж (A1, Частина B): класифікатор createClassifyV2
// видалено, єдина жива функція categoryFromBoundaryType переїхала у власний
// тонкий модуль boundaryCategory.js (живий споживач — splitDocumentsV3).
import { describe, it, expect } from 'vitest';
import { categoryFromBoundaryType } from '../../src/services/documentPipeline/stages/boundaryCategory.js';

describe('boundaryCategory — мапа boundary-type → canonical category', () => {
  it('відповідає словнику documentBoundary/prompt', () => {
    expect(categoryFromBoundaryType('pleading')).toBe('pleading');
    expect(categoryFromBoundaryType('court_act')).toBe('court_act');
    expect(categoryFromBoundaryType('certificate')).toBe('identification');
    expect(categoryFromBoundaryType('court_cover')).toBe('other');
    expect(categoryFromBoundaryType('невідоме')).toBe('other');
  });
});
