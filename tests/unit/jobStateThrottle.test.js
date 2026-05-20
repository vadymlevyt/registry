// P4 (Фаза B, 20.05.2026) — saveStateThrottled: ≤1 upload/throttleMs,
// останній виклик у вікні — найсвіжіший стан; flushPendingSave/saveState
// (immediate)/clearState скасовують pending throttled.
//
// Реальний кейс: streamingExecutor.js:139 per-chunk save → ~120/DP-run.
// До P4: 120 Drive POST × 100-200мс = ~12-24 сек прихованої роботи.
// Після P4 (throttle 10 сек): ≤ N/10 saves де N — тривалість job у сек.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createJobStateStore, makeInitialJobState, JOBSTATE_THROTTLE_MS } from '../../src/services/documentPipeline/jobState.js';
import { createMemDrivePort } from '../_memDrivePort.js';

function uploadCount(port) {
  return port._countFilesNamed('job_state.json');
}

function makeState(chunkIdx = 0) {
  const st = makeInitialJobState({ jobId: 'jT', caseId: 'cT', files: [] });
  st.chunks = Array.from({ length: chunkIdx }, (_, i) => ({ fileId: 'f', index: i, status: 'done' }));
  return st;
}

describe('jobState — saveStateThrottled', () => {
  let port, store;
  beforeEach(() => {
    vi.useFakeTimers();
    port = createMemDrivePort();
    // Короткий throttle для тестів (1 сек замість 10).
    store = createJobStateStore(port, { throttleMs: 1000 });
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('30 saveStateThrottled у 500мс → 1 leading upload; через throttleMs trailing з найсвіжішим станом', async () => {
    // 30 викликів з оновлюваним станом (chunkIdx 1..30).
    for (let i = 1; i <= 30; i++) {
      // первий виклик буде leading (sinceLast >= throttleMs з epoch).
      await store.saveStateThrottled(makeState(i));
      await vi.advanceTimersByTimeAsync(15);          // 30 × 15мс = 450мс < 1000мс
    }
    // Leading upload зробився одразу на 1-му виклику.
    expect(uploadCount(port)).toBe(1);

    // До 1000мс — trailing не спрацював.
    await vi.advanceTimersByTimeAsync(500);
    expect(uploadCount(port)).toBeLessThanOrEqual(2);

    // Після throttleMs — trailing спрацював з найсвіжішим станом (30).
    await vi.advanceTimersByTimeAsync(1000);
    // crash-safe save видаляє попередній і кладе новий → завжди 1 файл.
    expect(uploadCount(port)).toBe(1);
    const loaded = await store.loadState('cT', 'jT');
    expect(loaded.chunks.length).toBe(30);            // найсвіжіший стан
  });

  it('saveStateThrottled → leading (перший) + trailing (останній); проміжні не пишуться', async () => {
    // throttleMs = 1000.
    await store.saveStateThrottled(makeState(1));      // leading
    await vi.advanceTimersByTimeAsync(100);
    await store.saveStateThrottled(makeState(2));      // → pending
    await vi.advanceTimersByTimeAsync(100);
    await store.saveStateThrottled(makeState(3));      // → pending (overwrite)
    await vi.advanceTimersByTimeAsync(100);
    await store.saveStateThrottled(makeState(4));      // → pending (overwrite)
    // 1 leading writе на цей момент.
    expect(port._countFilesNamed('job_state.json')).toBe(1);
    let loaded = await store.loadState('cT', 'jT');
    expect(loaded.chunks.length).toBe(1);              // leading був chunkIdx=1

    // Trailing спрацює на t=throttleMs (1000мс після першого виклику).
    await vi.advanceTimersByTimeAsync(800);            // total t=1100 — trailing виконано
    loaded = await store.loadState('cT', 'jT');
    expect(loaded.chunks.length).toBe(4);              // trailing — найсвіжіший
  });

  it('saveState (immediate) скасовує pending throttled (immediate перебиває)', async () => {
    await store.saveStateThrottled(makeState(1));      // leading upload
    await vi.advanceTimersByTimeAsync(100);
    await store.saveStateThrottled(makeState(2));      // → pending
    await store.saveState(makeState(99));              // immediate, скасовує pending
    // Pending скасовано — trailing не виконається навіть через 1000мс.
    await vi.advanceTimersByTimeAsync(2000);
    const loaded = await store.loadState('cT', 'jT');
    expect(loaded.chunks.length).toBe(99);             // саме immediate
  });

  it('flushPendingSave — викликає pending зараз і скасовує таймер', async () => {
    await store.saveStateThrottled(makeState(1));      // leading
    await vi.advanceTimersByTimeAsync(100);
    await store.saveStateThrottled(makeState(5));      // → pending
    await store.flushPendingSave();
    const loaded = await store.loadState('cT', 'jT');
    expect(loaded.chunks.length).toBe(5);
    // Подальший advance — НЕ створює зайвий upload.
    await vi.advanceTimersByTimeAsync(2000);
    const loaded2 = await store.loadState('cT', 'jT');
    expect(loaded2.chunks.length).toBe(5);             // той самий
  });

  it('flushPendingSave без pending — no-op (НЕ викликає _writeState зайвий раз)', async () => {
    await store.flushPendingSave();
    expect(uploadCount(port)).toBe(0);
  });

  it('clearState скасовує pending throttled (leak-fix)', async () => {
    await store.saveStateThrottled(makeState(1));      // leading upload
    await vi.advanceTimersByTimeAsync(100);
    await store.saveStateThrottled(makeState(5));      // → pending
    await store.clearState('cT', 'jT');
    // Pending скасовано — після throttleMs job_state.json НЕ відновлюється.
    await vi.advanceTimersByTimeAsync(2000);
    expect(uploadCount(port)).toBe(0);
    expect(await store.loadState('cT', 'jT')).toBeNull();
  });

  it('JOBSTATE_THROTTLE_MS = 10_000 (контракт спеки)', () => {
    expect(JOBSTATE_THROTTLE_MS).toBe(10_000);
  });

  it('throttleMs override через options', async () => {
    const port2 = createMemDrivePort();
    const fast = createJobStateStore(port2, { throttleMs: 100 });
    await fast.saveStateThrottled(makeState(1));       // leading
    await vi.advanceTimersByTimeAsync(50);
    await fast.saveStateThrottled(makeState(2));       // pending
    await vi.advanceTimersByTimeAsync(60);             // > 100мс від leading → trailing fires
    const loaded = await fast.loadState('cT', 'jT');
    expect(loaded.chunks.length).toBe(2);
  });
});
