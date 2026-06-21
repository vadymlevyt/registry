// Юніт-тести modelResolver — ієрархія user → tenant → system для вибору моделі.
import { describe, it, expect, afterEach } from 'vitest';
import {
  SYSTEM_DEFAULTS,
  resolveModel,
  ROLE_LABELS,
  withModelPreference,
  withoutModelPreference,
} from '../../src/services/modelResolver.js';
import { setActiveTenant, getCurrentTenant, DEFAULT_TENANT } from '../../src/services/tenantService.js';

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

  describe('tenant override через живе джерело (read-path §4.6)', () => {
    // Скидаємо живе джерело tenant до дефолту після кожного тесту, щоб не текло.
    afterEach(() => setActiveTenant(DEFAULT_TENANT));

    it('tenant.modelPreferences перекриває SYSTEM_DEFAULTS', () => {
      setActiveTenant(withModelPreference(DEFAULT_TENANT, 'qiAgent', 'claude-opus-4-8'));
      expect(resolveModel('qiAgent')).toBe('claude-opus-4-8');
    });

    it('clear (null) повертає до SYSTEM_DEFAULTS', () => {
      setActiveTenant(withModelPreference(DEFAULT_TENANT, 'qiAgent', 'claude-opus-4-8'));
      expect(resolveModel('qiAgent')).toBe('claude-opus-4-8');
      setActiveTenant(withoutModelPreference(getCurrentTenant(), 'qiAgent'));
      expect(resolveModel('qiAgent')).toBe(SYSTEM_DEFAULTS.qiAgent);
    });

    it('override працює і для ролі поза tenant.modelPreferences (imageSorter)', () => {
      setActiveTenant(withModelPreference(DEFAULT_TENANT, 'imageSorter', 'claude-opus-4-8'));
      expect(resolveModel('imageSorter')).toBe('claude-opus-4-8');
    });
  });

  describe('хелпери immutable + ROLE_LABELS', () => {
    it('withModelPreference не мутує вхідний tenant', () => {
      const t = { modelPreferences: { qiAgent: 'a' } };
      const t2 = withModelPreference(t, 'qiAgent', 'b');
      expect(t.modelPreferences.qiAgent).toBe('a'); // вхідний незмінний
      expect(t2.modelPreferences.qiAgent).toBe('b');
    });

    it('ROLE_LABELS покриває всі ключі SYSTEM_DEFAULTS', () => {
      for (const key of Object.keys(SYSTEM_DEFAULTS)) {
        expect(ROLE_LABELS[key], `нема людської назви для ролі ${key}`).toBeTruthy();
      }
    });
  });
});
