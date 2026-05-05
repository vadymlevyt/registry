// ── MASTER TIMER ─────────────────────────────────────────────────────────────
// State machine майстер-таймера. Тікає у фоні поки адвокат працює.
//
// States: stopped | active | paused | idle
//   stopped → active   startMasterTimer()
//   active  → paused   pauseMasterTimer('manual')
//   active  → idle     auto через Idle Detection / Page Visibility
//   paused  → active   resumeMasterTimer()
//   idle    → active   resume after activity / visibilitychange
//   *       → stopped  stopMasterTimer()
//
// Persistence: state зберігається в registry.master_timer_state кожні 60 сек.
// Recovery: при reload активність відновлюється з lastActivityAt (з порогом 30 хв).
// Cross-tab: BroadcastChannel('legalbms_master_timer'); fallback — localStorage events.
//
// UI поки немає — налаштування autoStart живе в user.preferences.

import * as activityTracker from './activityTracker.js';
import { getCurrentUser } from './tenantService.js';

const PERSIST_INTERVAL_MS = 60 * 1000;
const TICK_INTERVAL_MS = 1000;
const RECOVERY_THRESHOLD_MS = 30 * 60 * 1000; // 30 хв
const DEFAULT_IDLE_TIMEOUT_MIN = 5;
const BROADCAST_CHANNEL = 'legalbms_master_timer';

let _state = createInitialState();
let _stateSink = null;
let _tickHandle = null;
let _persistHandle = null;
let _channel = null;
let _idleHandle = null;
let _idleTimeoutMin = DEFAULT_IDLE_TIMEOUT_MIN;
let _onVisibilityChange = null;
let _onActivity = null;

function createInitialState() {
  return {
    isActive: false,
    isPaused: false,
    state: 'stopped',
    startedAt: null,
    pausedAt: null,
    totalSecondsToday: 0,
    lastActivityAt: null,
    activeCaseId: null,
    activeCategory: null,
    lastIdleCheck: null,
  };
}

function pushState() {
  if (typeof _stateSink === 'function') {
    try { _stateSink({ ..._state }); } catch (e) { console.warn('masterTimer sink error:', e); }
  }
}

function getIdleTimeoutMin() {
  try {
    const u = getCurrentUser();
    const v = u?.preferences?.idleTimeoutMinutes;
    if (Number.isFinite(v) && v > 0) return v;
  } catch {}
  return _idleTimeoutMin;
}

// ── Public ─────────────────────────────────────────────────────────────────
export function configure({ stateSink, idleTimeoutMin } = {}) {
  if (typeof stateSink === 'function') _stateSink = stateSink;
  if (Number.isFinite(idleTimeoutMin) && idleTimeoutMin > 0) {
    _idleTimeoutMin = idleTimeoutMin;
  }
}

export function getState() {
  return { ..._state };
}

export function setState(newState) {
  if (newState && typeof newState === 'object') {
    _state = { ..._state, ...newState };
    pushState();
  }
}

// Recovery з registry.master_timer_state. Викликається на завантаженні.
export function recover(persistedState) {
  if (!persistedState || typeof persistedState !== 'object') return;
  try {
    const last = persistedState.lastActivityAt ? new Date(persistedState.lastActivityAt) : null;
    const elapsed = last ? (Date.now() - last.getTime()) : Infinity;
    if (elapsed > RECOVERY_THRESHOLD_MS) {
      // Більше 30 хв — скидаємо в stopped, але залишаємо totalSecondsToday якщо сьогодні.
      const todayStr = new Date().toISOString().split('T')[0];
      const lastDay = last ? last.toISOString().split('T')[0] : null;
      _state = {
        ...createInitialState(),
        totalSecondsToday: todayStr === lastDay ? (persistedState.totalSecondsToday || 0) : 0,
      };
    } else {
      _state = { ...createInitialState(), ...persistedState };
    }
    pushState();
  } catch (e) {
    console.warn('masterTimer.recover error:', e);
  }
}

export function start({ caseId = null, category = null, autoStart = false } = {}) {
  try {
    if (_state.state === 'active') return;
    const now = new Date();
    _state = {
      ..._state,
      isActive: true,
      isPaused: false,
      state: 'active',
      startedAt: _state.startedAt || now.toISOString(),
      pausedAt: null,
      lastActivityAt: now.toISOString(),
      activeCaseId: caseId,
      activeCategory: category,
      lastIdleCheck: now.toISOString(),
    };
    pushState();
    _ensureLifecycleAttached();
    _broadcast('start', { reason: autoStart ? 'auto' : 'manual' });
  } catch (e) {
    console.warn('masterTimer.start error:', e);
  }
}

export function pause(reason = 'manual') {
  try {
    if (_state.state !== 'active') return;
    const now = new Date();
    _state = {
      ..._state,
      state: 'paused',
      isPaused: true,
      pausedAt: now.toISOString(),
      lastActivityAt: now.toISOString(),
    };
    pushState();
    _broadcast('pause', { reason });
  } catch (e) {
    console.warn('masterTimer.pause error:', e);
  }
}

export function resume() {
  try {
    if (_state.state !== 'paused' && _state.state !== 'idle') return;
    const now = new Date();
    _state = {
      ..._state,
      state: 'active',
      isPaused: false,
      pausedAt: null,
      lastActivityAt: now.toISOString(),
    };
    pushState();
    _broadcast('resume', {});
  } catch (e) {
    console.warn('masterTimer.resume error:', e);
  }
}

export function stop() {
  try {
    _state = {
      ..._state,
      isActive: false,
      isPaused: false,
      state: 'stopped',
      pausedAt: null,
      activeCaseId: null,
      activeCategory: null,
    };
    pushState();
    _broadcast('stop', {});
  } catch (e) {
    console.warn('masterTimer.stop error:', e);
  }
}

export function markActivity() {
  if (_state.state === 'stopped') return;
  if (_state.state === 'idle') {
    resume();
    return;
  }
  _state = { ..._state, lastActivityAt: new Date().toISOString() };
  // не штовхаємо state-sink на кожен рух миші, лиш оновлюємо in-memory
}

// ── Internal lifecycle ─────────────────────────────────────────────────────
let _attached = false;
function _ensureLifecycleAttached() {
  if (_attached || typeof window === 'undefined') return;
  _attached = true;

  // Tick — для idle перевірки кожну секунду.
  _tickHandle = setInterval(_tick, TICK_INTERVAL_MS);

  // Persist — кожні 60 сек.
  _persistHandle = setInterval(() => pushState(), PERSIST_INTERVAL_MS);

  // Page Visibility.
  _onVisibilityChange = () => {
    try {
      if (document.hidden) {
        if (_state.state === 'active') pause('visibility_hidden');
      } else {
        if (_state.state === 'paused' && _state.pausedAt) {
          // Якщо пауза була від visibility — відновлюємо.
          resume();
        }
      }
    } catch (e) { console.warn('masterTimer visibility error:', e); }
  };
  document.addEventListener('visibilitychange', _onVisibilityChange);

  // Активність користувача — пишемо lastActivityAt.
  _onActivity = () => markActivity();
  ['mousemove', 'keydown', 'pointerdown', 'touchstart', 'wheel'].forEach(ev => {
    window.addEventListener(ev, _onActivity, { passive: true });
  });

  // Cross-tab sync.
  try {
    if (typeof BroadcastChannel === 'function') {
      _channel = new BroadcastChannel(BROADCAST_CHANNEL);
      _channel.onmessage = (msg) => _handleRemote(msg?.data);
    } else {
      window.addEventListener('storage', (e) => {
        if (e.key === BROADCAST_CHANNEL && e.newValue) {
          try { _handleRemote(JSON.parse(e.newValue)); } catch {}
        }
      });
    }
  } catch (e) {
    console.warn('masterTimer broadcast init error:', e);
  }

  // Idle Detection (Chromium only).
  try {
    if (typeof window.IdleDetector === 'function') {
      window.IdleDetector.requestPermission().then(permission => {
        if (permission !== 'granted') return;
        const detector = new window.IdleDetector();
        detector.addEventListener('change', () => {
          try {
            if (detector.userState === 'idle' && _state.state === 'active') {
              pause('idle_detected');
              _state = { ..._state, state: 'idle' };
              pushState();
            } else if (detector.userState === 'active' && _state.state === 'idle') {
              resume();
            }
          } catch (e) { console.warn('IdleDetector handler error:', e); }
        });
        detector.start({ threshold: getIdleTimeoutMin() * 60 * 1000 });
        _idleHandle = detector;
      }).catch(() => { /* permission denied — фолбек на _tick */ });
    }
  } catch (e) {
    console.warn('IdleDetector init error:', e);
  }
}

function _tick() {
  try {
    if (_state.state !== 'active' || !_state.lastActivityAt) return;
    const idleMs = Date.now() - new Date(_state.lastActivityAt).getTime();
    const limit = getIdleTimeoutMin() * 60 * 1000;
    if (idleMs > limit) {
      // Тихий перехід в idle.
      _state = { ..._state, state: 'idle', isPaused: true, pausedAt: new Date().toISOString() };
      pushState();
      _broadcast('idle', { idleMs });
    } else {
      // Тікаємо: + 1 сек до сьогоднішнього часу.
      _state = { ..._state, totalSecondsToday: (_state.totalSecondsToday || 0) + 1 };
      // Не штовхаємо sink кожну секунду — persist робиться через PERSIST_INTERVAL_MS.
    }
  } catch (e) {
    console.warn('masterTimer tick error:', e);
  }
}

function _broadcast(action, data) {
  try {
    const msg = { action, data, ts: Date.now(), origin: getInstanceId() };
    if (_channel) {
      _channel.postMessage(msg);
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(BROADCAST_CHANNEL, JSON.stringify(msg));
    }
  } catch (e) {
    console.warn('masterTimer broadcast error:', e);
  }
}

let _instanceId = null;
function getInstanceId() {
  if (_instanceId) return _instanceId;
  _instanceId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return _instanceId;
}

function _handleRemote(msg) {
  if (!msg || !msg.action || msg.origin === getInstanceId()) return;
  // Інша вкладка діє — синхронізуємо стан без вторинного broadcast.
  switch (msg.action) {
    case 'start':
      _state = { ..._state, state: 'active', isActive: true, isPaused: false };
      pushState();
      break;
    case 'pause':
    case 'idle':
      _state = { ..._state, state: msg.action, isPaused: true, pausedAt: new Date().toISOString() };
      pushState();
      break;
    case 'resume':
      _state = { ..._state, state: 'active', isPaused: false, pausedAt: null };
      pushState();
      break;
    case 'stop':
      _state = { ..._state, state: 'stopped', isActive: false, isPaused: false };
      pushState();
      break;
  }
}

export function _detach() {
  if (!_attached) return;
  if (_tickHandle) clearInterval(_tickHandle);
  if (_persistHandle) clearInterval(_persistHandle);
  if (_onVisibilityChange) document.removeEventListener('visibilitychange', _onVisibilityChange);
  if (_onActivity) {
    ['mousemove', 'keydown', 'pointerdown', 'touchstart', 'wheel'].forEach(ev => {
      window.removeEventListener(ev, _onActivity);
    });
  }
  if (_channel) { try { _channel.close(); } catch {} }
  _channel = null;
  _attached = false;
}

// Хелпер для bind у App.jsx
export function bindToActivityTracker() {
  activityTracker.bindMasterTimer({
    start, pause, resume, stop, getState,
  });
}
