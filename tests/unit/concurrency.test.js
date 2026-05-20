// Unit — runWithConcurrency. Концурентність обмежена ліміт-параметром,
// результати у вхідному порядку, окремий throw → { __error } на позиції.
import { describe, it, expect } from 'vitest';
import { runWithConcurrency } from '../../src/services/concurrency.js';

describe('runWithConcurrency', () => {
  it('повертає [] на порожній вхід', async () => {
    const r = await runWithConcurrency([], async () => 1, 5);
    expect(r).toEqual([]);
  });

  it('результати у тому самому порядку що вхідні items', async () => {
    const r = await runWithConcurrency([1, 2, 3, 4, 5], async (n) => n * 10, 2);
    expect(r).toEqual([10, 20, 30, 40, 50]);
  });

  it('обмежує пік одночасних викликів до concurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    const r = await runWithConcurrency(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      async (n) => {
        inFlight++;
        if (inFlight > peak) peak = inFlight;
        await new Promise((res) => setTimeout(res, 15));
        inFlight--;
        return n;
      },
      3,
    );
    expect(r).toHaveLength(10);
    expect(peak).toBeGreaterThan(1);                   // паралельність реальна
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('throw у task → __error на позиції, інші продовжують', async () => {
    const r = await runWithConcurrency([1, 2, 3], async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    }, 2);
    expect(r[0]).toBe(1);
    expect(r[1]?.__error?.message).toBe('boom');
    expect(r[2]).toBe(3);
  });

  it('concurrency > items.length → не "роздуває" worker-пул', async () => {
    let peak = 0;
    let inFlight = 0;
    await runWithConcurrency([1, 2], async () => {
      inFlight++;
      if (inFlight > peak) peak = inFlight;
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return 'ok';
    }, 100);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('onProgress(done,total) викликається після кожного таска', async () => {
    const events = [];
    await runWithConcurrency([1, 2, 3, 4], async (n) => n, 2,
      (done, total) => events.push([done, total]),
    );
    expect(events).toHaveLength(4);
    expect(events[events.length - 1]).toEqual([4, 4]);
  });

  it('concurrency=1 (серіально) — для регресії "було послідовно, стало паралельно"', async () => {
    const order = [];
    let inFlight = 0;
    let peak = 0;
    await runWithConcurrency([1, 2, 3], async (n) => {
      inFlight++;
      if (inFlight > peak) peak = inFlight;
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      order.push(n);
      return n;
    }, 1);
    expect(peak).toBe(1);                              // не паралельно
    expect(order).toEqual([1, 2, 3]);
  });
});
