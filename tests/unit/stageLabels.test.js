// G0 — юніт stageLabels: технічна назва стадії → людський підпис.
// Критерій якості тесту: якщо хтось додасть стадію в диригент і забуде
// підпис — тест червоний (UI не покаже "undefined", але мапа має бути повна).
import { describe, it, expect } from 'vitest';
import { STAGE_LABELS, stageLabel } from '../../src/services/documentPipeline/stageLabels.js';
import { DEFAULT_STAGE_ORDER } from '../../src/services/documentPipeline.js';

describe('stageLabels — мапа підписів', () => {
  it('кожна стадія DEFAULT_STAGE_ORDER має непорожній підпис', () => {
    for (const name of DEFAULT_STAGE_ORDER) {
      expect(typeof STAGE_LABELS[name]).toBe('string');
      expect(STAGE_LABELS[name].trim().length).toBeGreaterThan(0);
    }
  });

  it("'ocr' (псевдо-стадія перед диригентом) має підпис", () => {
    expect(STAGE_LABELS.ocr).toBeTruthy();
  });

  it('підписи унікальні (адвокат розрізняє стадії)', () => {
    const vals = Object.values(STAGE_LABELS);
    expect(new Set(vals).size).toBe(vals.length);
  });

  it('stageLabel(невідоме) → повертає саму назву, не кидає', () => {
    expect(stageLabel('totally_unknown')).toBe('totally_unknown');
    expect(stageLabel(null)).toBe('Обробка');
    expect(stageLabel(undefined)).toBe('Обробка');
  });

  it('stageLabel(відоме) → людський підпис', () => {
    expect(stageLabel('detectBoundaries')).toBe('Аналіз структури документів');
    expect(stageLabel('persist')).toBe('Розкладання документів');
  });

  it('STAGE_LABELS заморожена (правило #11 — стабільний контракт)', () => {
    expect(Object.isFrozen(STAGE_LABELS)).toBe(true);
  });
});
