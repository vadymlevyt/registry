// DP-3 — jobProgressStore: спостережуваний transient-UI стор топбару.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as store from '../../src/services/documentPipeline/jobProgressStore.js';

describe('jobProgressStore', () => {
  beforeEach(() => store._resetForTests());

  it('топбар відсутній поки немає jobs; зʼявляється на startJob', () => {
    expect(store.hasActiveJobs()).toBe(false);
    store.startJob({ jobId: 'j1', caseId: 'c1', title: 'T', total: 4 });
    expect(store.hasActiveJobs()).toBe(true);
    expect(store.getActiveJobs()).toHaveLength(1);
  });

  it('subscribe одразу віддає знімок і отримує оновлення', () => {
    const seen = [];
    const un = store.subscribe((s) => seen.push(s.length));
    expect(seen[0]).toBe(0);
    store.startJob({ jobId: 'j1', title: 'T', total: 2 });
    expect(seen[seen.length - 1]).toBe(1);
    un();
    store.startJob({ jobId: 'j2', title: 'T2' });
    expect(seen[seen.length - 1]).toBe(1); // відписаний — не отримує
  });

  it('updateJob рахує ratio; finishJob прибирає (топбар зникає)', () => {
    store.startJob({ jobId: 'j1', title: 'T', total: 4 });
    store.updateJob('j1', { done: 2 });
    expect(store.getActiveJobs()[0].ratio).toBe(0.5);
    store.finishJob('j1');
    expect(store.hasActiveJobs()).toBe(false);
  });

  it('attachDrivePolling доганяє прогрес лише вперед, не відкочує', async () => {
    vi.useFakeTimers();
    store.startJob({ jobId: 'j1', caseId: 'c1', title: 'T', total: 10 });
    store.updateJob('j1', { done: 5 });
    const loadState = vi.fn(async () => ({
      chunks: Array.from({ length: 10 }, (_, i) => ({ status: i < 3 ? 'done' : 'pending' })),
      stoppedAt: null,
    }));
    store.attachDrivePolling({ loadState, intervalMs: 5000 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(loadState).toHaveBeenCalled();
    expect(store.getActiveJobs()[0].done).toBe(5); // poll(3) не відкочує push(5)
    vi.useRealTimers();
  });

  it('polling зупиняється коли jobs порожні (нуль трафіку без потреби)', async () => {
    vi.useFakeTimers();
    store.startJob({ jobId: 'j1', caseId: 'c1', title: 'T', total: 1 });
    const loadState = vi.fn(async () => null);
    store.attachDrivePolling({ loadState, intervalMs: 1000 });
    store.finishJob('j1');
    store.reconcilePolling();
    await vi.advanceTimersByTimeAsync(3000);
    const callsAfterEmpty = loadState.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(loadState.mock.calls.length).toBe(callsAfterEmpty);
    vi.useRealTimers();
  });
});
