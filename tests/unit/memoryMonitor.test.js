// DP-3 — memoryMonitor: memory-aware chunk advisor + fallback.
import { describe, it, expect } from 'vitest';
import {
  readMemory, memoryPressure, adviseChunkPages, shouldFreeAggressively,
  MIN_CHUNK_PAGES, MAX_CHUNK_PAGES, DEFAULT_CHUNK_PAGES,
} from '../../src/services/documentPipeline/memoryMonitor.js';

const perf = (used, limit) => ({ memory: { usedJSHeapSize: used, totalJSHeapSize: used, jsHeapSizeLimit: limit } });

describe('memoryMonitor — readMemory / pressure', () => {
  it('null коли API недоступне (Safari/iPad/Node)', () => {
    expect(readMemory({})).toBeNull();
    expect(readMemory({ memory: {} })).toBeNull();
    expect(memoryPressure({})).toBeNull();
  });
  it('знімок і тиск коли API є', () => {
    const m = readMemory(perf(50, 100));
    expect(m).toEqual({ limit: 100, used: 50, total: 50 });
    expect(memoryPressure(perf(80, 100))).toBeCloseTo(0.8);
  });
});

describe('memoryMonitor — adviseChunkPages', () => {
  it('fallback (нема API): обмежується розміром файлу і к-стю сторінок', () => {
    const n = adviseChunkPages({ totalPages: 8, fileSizeBytes: 1e6, perf: {} });
    expect(n).toBeGreaterThanOrEqual(MIN_CHUNK_PAGES);
    expect(n).toBeLessThanOrEqual(8 < MIN_CHUNK_PAGES ? MIN_CHUNK_PAGES : 8);
  });
  it('великий файл → менший chunk (байтовий слід поміркований)', () => {
    const big = adviseChunkPages({ totalPages: 300, fileSizeBytes: 300 * 5 * 1024 * 1024, perf: {} });
    expect(big).toBeLessThan(DEFAULT_CHUNK_PAGES);
    expect(big).toBeGreaterThanOrEqual(MIN_CHUNK_PAGES);
  });
  it('високий тиск памʼяті (Chrome) → найменший chunk', () => {
    const n = adviseChunkPages({ totalPages: 300, fileSizeBytes: 1e6, perf: perf(95, 100) });
    expect(n).toBe(MIN_CHUNK_PAGES);
  });
  it('завжди у межах [MIN, MAX]', () => {
    const n = adviseChunkPages({ totalPages: 5000, fileSizeBytes: 1024, perf: {} });
    expect(n).toBeGreaterThanOrEqual(MIN_CHUNK_PAGES);
    expect(n).toBeLessThanOrEqual(MAX_CHUNK_PAGES);
  });
});

describe('memoryMonitor — shouldFreeAggressively', () => {
  it('false коли немає даних (не панікуємо без API)', () => {
    expect(shouldFreeAggressively({})).toBe(false);
  });
  it('true під високим тиском', () => {
    expect(shouldFreeAggressively(perf(90, 100))).toBe(true);
  });
});
