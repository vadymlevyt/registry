// P3 (Фаза B, 20.05.2026) — driveRequest з explicit timeout.
// Без таймауту fetch до Drive міг висіти на повільній/нестабільній мережі
// десятки хвилин (на планшеті адвоката — реальний симптом DP-pipeline
// зависання). Тепер AbortError через DRIVE_TIMEOUT_MS (60с дефолт).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { driveRequest, DRIVE_TIMEOUT_MS } from '../../src/services/driveAuth.js';

describe('driveRequest — explicit timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', {
      getItem: () => 'test-token',
      setItem: () => {},
    });
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fetch що не повертається → AbortError через DRIVE_TIMEOUT_MS', async () => {
    // Mock fetch що НІКОЛИ не повертає, але реагує на abort signal.
    const fetchMock = vi.fn((url, opts) => new Promise((_, reject) => {
      if (opts?.signal) {
        opts.signal.addEventListener('abort', () => {
          reject(opts.signal.reason || new DOMException('aborted', 'AbortError'));
        });
      }
    }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = driveRequest('https://www.googleapis.com/drive/v3/files');
    // Захоплюємо rejection одразу щоб не лишити unhandled (відмова прийде
    // тільки після advanceTimersByTimeAsync — посилаємось на promise двічі).
    const captured = promise.catch((e) => e);
    await vi.advanceTimersByTimeAsync(DRIVE_TIMEOUT_MS + 1000);
    const err = await captured;
    expect(err?.name).toBe('AbortError');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callOpts = fetchMock.mock.calls[0][1];
    expect(callOpts.signal).toBeDefined();
  });

  it("options.signal від caller → НЕ нав'язуємо власний timeout (caller сам контролює)", async () => {
    const fetchMock = vi.fn(async (url, opts) => {
      // Зафіксувати чи signal це caller-овий.
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const callerCtrl = new AbortController();
    await driveRequest('https://www.googleapis.com/drive/v3/files', { signal: callerCtrl.signal });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const opts = fetchMock.mock.calls[0][1];
    expect(opts.signal).toBe(callerCtrl.signal);
  });

  it('options.timeoutMs override → коротший таймаут', async () => {
    const fetchMock = vi.fn((url, opts) => new Promise((_, reject) => {
      if (opts?.signal) {
        opts.signal.addEventListener('abort', () => {
          reject(opts.signal.reason || new DOMException('aborted', 'AbortError'));
        });
      }
    }));
    vi.stubGlobal('fetch', fetchMock);
    const promise = driveRequest('https://www.googleapis.com/drive/v3/files', { timeoutMs: 5000 });
    const captured = promise.catch((e) => e);
    await vi.advanceTimersByTimeAsync(5500);
    const err = await captured;
    expect(err?.name).toBe('AbortError');
  });

  it('успішний fetch < timeout → response повертається нормально', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":1}', { status: 200 })));
    const r = await driveRequest('https://www.googleapis.com/drive/v3/files');
    expect(r.status).toBe(200);
  });

  it('options.timeoutMs НЕ потрапляє у fetch options (не валідний fetch-параметр)', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await driveRequest('https://www.googleapis.com/drive/v3/files', { timeoutMs: 30_000 });
    const opts = fetchMock.mock.calls[0][1];
    expect(opts.timeoutMs).toBeUndefined();
  });

  it('DRIVE_TIMEOUT_MS = 60_000 (контракт спеки)', () => {
    expect(DRIVE_TIMEOUT_MS).toBe(60_000);
  });
});
