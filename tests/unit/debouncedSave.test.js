// P2 (Фаза B, 20.05.2026) — debounced save примітив.
// Контракт: trigger → відкладає N мс; повторний trigger перезводить таймер;
// flush → негайно, якщо є pending; cancel → без виклику.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDebouncedSave } from '../../src/services/debouncedSave.js';

describe('createDebouncedSave', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('10 trigger у 100мс → 1 save (через delay мс тиші)', () => {
    const save = vi.fn();
    const d = createDebouncedSave(save, 800);
    // 10 trigger з інтервалом 10мс — таймер перезводиться щоразу.
    for (let i = 0; i < 10; i++) {
      d.trigger();
      vi.advanceTimersByTime(10);
    }
    // Загальний час 100мс — ще 800мс тиші не минуло, save не викликався.
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(800);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('trigger → wait > delay → save; ще trigger → wait > delay → ще save', () => {
    const save = vi.fn();
    const d = createDebouncedSave(save, 500);
    d.trigger();
    vi.advanceTimersByTime(600);
    expect(save).toHaveBeenCalledTimes(1);
    d.trigger();
    vi.advanceTimersByTime(600);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('flush() з pending → негайний виклик і очищення таймера', () => {
    const save = vi.fn();
    const d = createDebouncedSave(save, 1000);
    d.trigger();
    expect(d.isPending()).toBe(true);
    d.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(d.isPending()).toBe(false);
    // Подальші advance — без додаткового виклику (таймер очищено).
    vi.advanceTimersByTime(2000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush() без pending → no-op (НЕ викликає saveFn зайвий раз)', () => {
    const save = vi.fn();
    const d = createDebouncedSave(save, 500);
    d.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it('cancel() — викидає pending без виклику', () => {
    const save = vi.fn();
    const d = createDebouncedSave(save, 500);
    d.trigger();
    d.cancel();
    vi.advanceTimersByTime(2000);
    expect(save).not.toHaveBeenCalled();
    expect(d.isPending()).toBe(false);
  });

  it('trigger(nextFn) — використовує найсвіжіше замикання', () => {
    const calls = [];
    const d = createDebouncedSave(() => calls.push('initial'), 500);
    d.trigger(() => calls.push('first'));
    vi.advanceTimersByTime(100);
    d.trigger(() => calls.push('second'));      // перезавод з новим fn
    vi.advanceTimersByTime(500);
    expect(calls).toEqual(['second']);
  });

  it('критична дія: flush одразу після trigger → save без затримки', () => {
    const save = vi.fn();
    const d = createDebouncedSave(save, 800);
    // Симуляція: change → trigger → immediately requestImmediateSave (flush).
    d.trigger();
    d.flush();
    expect(save).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(save).toHaveBeenCalledTimes(1);       // повторно не викликається
  });

  it('delay=0 — синхронний taskScheduling через setTimeout(0)', () => {
    const save = vi.fn();
    const d = createDebouncedSave(save, 0);
    d.trigger();
    expect(save).not.toHaveBeenCalled();         // setTimeout(0) асинхронний
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
