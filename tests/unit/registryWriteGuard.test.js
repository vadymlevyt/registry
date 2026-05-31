// Юніт-тести shrink-guard для registry_data.json.
// Контекст: ai_usage[] на живому Drive було тихо затерто до 1 запису (сесія
// зберегла порожній in-memory масив поверх повної історії). Guard має ловити
// саме такий колапс, але НЕ заважати легітимним сценаріям (ріст, ротація
// time_entries, свіжий старт, закриття справи).
import { describe, it, expect } from 'vitest';
import {
  evaluateRegistryWriteGuard,
  GUARD_MIN_HISTORY,
  arrLen,
} from '../../src/services/registryWriteGuard.js';

// Хелпер: масив заданої довжини (вміст неважливий — guard рахує лише length).
const ofLen = (n) => Array.from({ length: n }, (_, i) => ({ i }));

describe('registryWriteGuard', () => {
  describe('ai_usage shrink (головний кейс)', () => {
    it('блокує колапс ai_usage з повної історії до 1 запису', () => {
      const registry = { ai_usage: ofLen(1) };
      const reason = evaluateRegistryWriteGuard(registry, { ai_usage: 6000 });
      expect(reason).toBe('ai_usage_collapsed');
    });

    it('блокує спорожнення ai_usage (N → 0)', () => {
      const reason = evaluateRegistryWriteGuard({ ai_usage: [] }, { ai_usage: 6000 });
      expect(reason).toBe('ai_usage_emptied');
    });

    it('блокує спорожнення навіть коли поле взагалі відсутнє в новому payload', () => {
      const reason = evaluateRegistryWriteGuard({}, { ai_usage: 6000 });
      expect(reason).toBe('ai_usage_emptied');
    });

    it('НЕ блокує нормальний ріст ai_usage', () => {
      const reason = evaluateRegistryWriteGuard({ ai_usage: ofLen(6010) }, { ai_usage: 6000 });
      expect(reason).toBeNull();
    });

    it('НЕ блокує стабільну LIFO-стелю (50000 → 50000)', () => {
      const reason = evaluateRegistryWriteGuard({ ai_usage: ofLen(50000) }, { ai_usage: 50000 });
      expect(reason).toBeNull();
    });

    it('НЕ судить про колапс дрібної історії (< GUARD_MIN_HISTORY)', () => {
      // prev=10 (< 20): падіння до 1 не блокується — мала історія, мала шкода.
      const reason = evaluateRegistryWriteGuard({ ai_usage: ofLen(1) }, { ai_usage: 10 });
      expect(reason).toBeNull();
      expect(GUARD_MIN_HISTORY).toBe(20);
    });
  });

  describe('time_entries — СВІДОМО поза guard (місячна ротація)', () => {
    it('НЕ блокує різке зменшення time_entries при стабільних інших полях', () => {
      // 1-го числа: time_entries 5329 → 40 (ротація у _archives/), решта стабільна.
      const registry = {
        cases: ofLen(33),
        ai_usage: ofLen(6000),
        auditLog: ofLen(120),
        users: ofLen(1),
        tenants: ofLen(1),
        time_entries: ofLen(40),
      };
      const prev = { cases: 33, ai_usage: 6000, auditLog: 120, users: 1, tenants: 1 };
      expect(evaluateRegistryWriteGuard(registry, prev)).toBeNull();
    });
  });

  describe('свіжий старт (prev = 0) — нічого не блокується', () => {
    it('порожній prev не блокує жоден payload', () => {
      const registry = { cases: ofLen(33), ai_usage: ofLen(500), auditLog: ofLen(10), users: ofLen(1), tenants: ofLen(1) };
      expect(evaluateRegistryWriteGuard(registry, {})).toBeNull();
    });

    it('перший запис на чистий стан (усе порожнє → дані) не блокується', () => {
      const registry = { cases: ofLen(5), ai_usage: ofLen(3) };
      expect(evaluateRegistryWriteGuard(registry, { cases: 0, ai_usage: 0 })).toBeNull();
    });
  });

  describe('cases — спец-семантика (−1 дозволено)', () => {
    it('НЕ блокує закриття однієї справи (33 → 32)', () => {
      expect(evaluateRegistryWriteGuard({ cases: ofLen(32) }, { cases: 33 })).toBeNull();
    });

    it('блокує падіння більш ніж на 1 (33 → 30)', () => {
      expect(evaluateRegistryWriteGuard({ cases: ofLen(30) }, { cases: 33 })).toBe('cases_count_decreased');
    });
  });

  describe('auditLog / users / tenants', () => {
    it('блокує колапс auditLog значущої історії', () => {
      expect(evaluateRegistryWriteGuard({ auditLog: ofLen(2) }, { auditLog: 120 })).toBe('auditLog_collapsed');
    });

    it('блокує спорожнення users (критичний масив)', () => {
      expect(evaluateRegistryWriteGuard({ users: [] }, { users: 2 })).toBe('users_emptied');
    });

    it('НЕ блокує дрібну зміну users (2 → 1) — не повне спорожнення', () => {
      expect(evaluateRegistryWriteGuard({ users: ofLen(1) }, { users: 2 })).toBeNull();
    });

    it('блокує спорожнення tenants', () => {
      expect(evaluateRegistryWriteGuard({ tenants: [] }, { tenants: 1 })).toBe('tenants_emptied');
    });
  });

  describe('arrLen', () => {
    it('повертає 0 для не-масивів', () => {
      expect(arrLen(null)).toBe(0);
      expect(arrLen(undefined)).toBe(0);
      expect(arrLen({})).toBe(0);
      expect(arrLen(ofLen(3))).toBe(3);
    });
  });
});
