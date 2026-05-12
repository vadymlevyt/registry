// Юніт-тести modelResolver — ієрархія user → tenant → system для вибору моделі.
import { describe, it, expect } from 'vitest';
import { SYSTEM_DEFAULTS, resolveModel } from '../../src/services/modelResolver.js';

describe('modelResolver', () => {
  describe('SYSTEM_DEFAULTS', () => {
    it('містить ключі для основних агентів', () => {
      expect(SYSTEM_DEFAULTS.dossierAgent).toBeTruthy();
      expect(SYSTEM_DEFAULTS.qiAgent).toBeTruthy();
      expect(SYSTEM_DEFAULTS.dashboardAgent).toBeTruthy();
      expect(SYSTEM_DEFAULTS.documentProcessor).toBeTruthy();
    });

    it('imageSorter — закладено для майбутнього TASK B (склейка зображень)', () => {
      // TASK A.7 закладає точку розширення modelResolver. Реальне використання
      // — у TASK B (image merge з агентом сортування через Sonnet).
      expect(SYSTEM_DEFAULTS.imageSorter).toBeDefined();
      expect(typeof SYSTEM_DEFAULTS.imageSorter).toBe('string');
      // За замовчуванням — Sonnet. Premium tenants пізніше зможуть обрати Opus.
      expect(SYSTEM_DEFAULTS.imageSorter).toContain('sonnet');
    });

    it('deepAnalysis — Opus (для глибокого аналізу)', () => {
      expect(SYSTEM_DEFAULTS.deepAnalysis).toContain('opus');
    });
  });

  describe('resolveModel — fallback chain', () => {
    it('повертає system default для відомого agentType', () => {
      expect(resolveModel('dossierAgent')).toBe(SYSTEM_DEFAULTS.dossierAgent);
      expect(resolveModel('imageSorter')).toBe(SYSTEM_DEFAULTS.imageSorter);
    });

    it('повертає fallback model для невідомого agentType', () => {
      const model = resolveModel('totally_unknown_agent');
      // Не undefined, не порожньо — реальна модель.
      expect(typeof model).toBe('string');
      expect(model.length).toBeGreaterThan(0);
    });
  });
});
