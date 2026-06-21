// Юніт-тести modelsService — живий список моделей (кеш/TTL/парсинг) + детектор 404.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchAvailableModels,
  getCachedModels,
  isModelNotFoundError,
} from '../../src/services/modelsService.js';

const CACHE_KEY = 'levytskyi_models_cache';

// Мінімальний localStorage-стаб для Node-середовища (vitest node env).
function installLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  return store;
}

describe('modelsService', () => {
  let store;
  beforeEach(() => {
    store = installLocalStorage();
  });
  afterEach(() => {
    delete globalThis.localStorage;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('isModelNotFoundError', () => {
    it('404 + not_found_error → true', () => {
      expect(isModelNotFoundError(404, { error: { type: 'not_found_error' } })).toBe(true);
    });
    it('404 + message «model: …» → true', () => {
      expect(isModelNotFoundError(404, { error: { message: 'model: claude-sonnet-4-20250514' } })).toBe(true);
    });
    it('401 / 429 / 400 → false (інші помилки, інша реакція)', () => {
      expect(isModelNotFoundError(401, { error: { type: 'authentication_error' } })).toBe(false);
      expect(isModelNotFoundError(429, { error: { type: 'rate_limit_error' } })).toBe(false);
      expect(isModelNotFoundError(400, { error: { type: 'invalid_request_error' } })).toBe(false);
    });
    it('404 без розпізнаваного тіла → false', () => {
      expect(isModelNotFoundError(404, {})).toBe(false);
      expect(isModelNotFoundError(404, null)).toBe(false);
    });
  });

  describe('fetchAvailableModels', () => {
    it('успіх → нормалізує елементи і кешує', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8', created_at: '2026-01-01' },
            { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6', created_at: '2025-11-01' },
          ],
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const res = await fetchAvailableModels('key', { force: true });
      expect(res.error).toBeNull();
      expect(res.stale).toBe(false);
      expect(res.models).toHaveLength(2);
      expect(res.models[0]).toEqual({
        id: 'claude-opus-4-8',
        displayName: 'Claude Opus 4.8',
        createdAt: '2026-01-01',
      });
      // кеш записано
      expect(getCachedModels()).toHaveLength(2);
    });

    it('свіжий кеш (< TTL) і !force → без мережі', async () => {
      store.set(CACHE_KEY, JSON.stringify({
        fetchedAt: Date.now(),
        models: [{ id: 'x', displayName: 'X', createdAt: null }],
      }));
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const res = await fetchAvailableModels('key');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(res.stale).toBe(false);
      expect(res.models[0].id).toBe('x');
    });

    it('прострочений кеш → йде в мережу', async () => {
      store.set(CACHE_KEY, JSON.stringify({
        fetchedAt: Date.now() - 25 * 3600 * 1000, // 25 год тому
        models: [{ id: 'old', displayName: 'Old', createdAt: null }],
      }));
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: 'new', display_name: 'New' }] }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const res = await fetchAvailableModels('key');
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(res.models[0].id).toBe('new');
    });

    it('помилка мережі → stale-кеш + error, НЕ кидає', async () => {
      store.set(CACHE_KEY, JSON.stringify({
        fetchedAt: Date.now() - 25 * 3600 * 1000,
        models: [{ id: 'cached', displayName: 'Cached', createdAt: null }],
      }));
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

      const res = await fetchAvailableModels('key');
      expect(res.error).toBeTruthy();
      expect(res.stale).toBe(true);
      expect(res.models[0].id).toBe('cached');
    });

    it('401 без кешу → error + models null', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'invalid x-api-key' } }),
      }));

      const res = await fetchAvailableModels('key', { force: true });
      expect(res.error).toBeTruthy();
      expect(res.models).toBeNull();
    });
  });
});
