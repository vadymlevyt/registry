// ── ACTIVITY TRACKER ─────────────────────────────────────────────────────────
// Центральна служба внутрішнього обліку часу адвоката.
//
// Принципи:
// - Сервіс зберігає тільки підписки і активний стан в пам'яті процесу.
// - Реальне зберігання — у React state у App.jsx (через колбеки sink).
// - Падіння сервісу не блокує юридичну роботу. Усі публічні методи — try/catch.
// - Відрізняється від ai_usage[]: тут — час адвоката в категоріях, не токени.
//
// Узгоджено в TASK Billing Foundation v2.

import { getCurrentTenant, getCurrentUser } from './tenantService.js';
import { ACTIVITY_CATEGORIES, getCategoryDefaults } from './timeStandards.js';
import { MODULES } from './moduleNames.js';

const MAX_TIME_ENTRIES_BUFFER = 100000; // hard cap, реально ротуємо місячно

function makeId(prefix = 'te') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

// ── State (модульний скоп) ──────────────────────────────────────────────────
let _sink = null;        // (entry) => void  — пише в React state (setTimeEntries)
let _patchSink = null;   // (id, patch) => void — оновлює існуючий запис
let _activeSession = null; // { caseId, module, startedAt, sessionId, category, subCategory }
let _activeSubtimer = null; // { id, category, caseId, subCategory, semanticGroup, startedAt, plannedDuration, parentTimerId }
let _hooks = {           // зовнішні слухачі (Master timer, smart return, etc.)
  onSessionStart: [],
  onSessionEnd: [],
  onSubtimerStart: [],
  onSubtimerEnd: [],
  onReport: [],
};

// ── Public: ініціалізація ───────────────────────────────────────────────────
export function configure({ sink, patchSink } = {}) {
  if (typeof sink === 'function') _sink = sink;
  if (typeof patchSink === 'function') _patchSink = patchSink;
}

export function getActiveSession() {
  return _activeSession ? { ..._activeSession } : null;
}

export function getActiveSubtimer() {
  return _activeSubtimer ? { ..._activeSubtimer } : null;
}

// ── Реєстрація хуків (для Master timer і smart return) ──────────────────────
export function on(eventName, fn) {
  if (!_hooks[eventName] || typeof fn !== 'function') return () => {};
  _hooks[eventName].push(fn);
  return () => {
    _hooks[eventName] = _hooks[eventName].filter(h => h !== fn);
  };
}

function emit(eventName, payload) {
  try {
    (_hooks[eventName] || []).forEach(h => {
      try { h(payload); } catch (e) { console.warn(`activityTracker hook ${eventName} error:`, e); }
    });
  } catch (e) {
    console.warn('activityTracker emit error:', e);
  }
}

// ── Публічні методи ─────────────────────────────────────────────────────────

// Базовий звіт про подію. eventType — короткий рядок ("hearing_viewed" і т.д.).
// Повертає створений запис або null.
export function report(eventType, context = {}) {
  try {
    const tenant = getCurrentTenant();
    const user = getCurrentUser();
    const category = context.category || _activeSession?.category || 'system';
    const catDefaults = getCategoryDefaults(category);
    const startTime = context.startTime || nowIso();
    const endTime = context.endTime || startTime;
    const duration = Number.isFinite(context.duration)
      ? context.duration
      : (context.endTime
          ? Math.max(0, Math.round((new Date(endTime) - new Date(startTime)) / 1000))
          : 0);
    const entry = {
      id: makeId('te'),
      tenantId: tenant?.tenantId || null,
      userId: user?.userId || null,
      createdAt: nowIso(),
      type: context.type || 'action',
      module: context.module || _activeSession?.module || MODULES.SYSTEM,
      action: eventType,
      caseId: context.caseId ?? _activeSession?.caseId ?? null,
      hearingId: context.hearingId ?? null,
      documentId: context.documentId ?? null,
      duration,
      startTime,
      endTime,
      category,
      subCategory: context.subCategory ?? null,
      billable: context.billable ?? catDefaults.billable,
      visibleToClient: context.visibleToClient ?? catDefaults.visibleToClient,
      billFactor: context.billFactor ?? catDefaults.billFactor,
      status: context.status || 'confirmed',
      semanticGroup: context.semanticGroup ?? null,
      parentEventId: context.parentEventId ?? null,
      parentEventType: context.parentEventType ?? null,
      parentTimerId: context.parentTimerId ?? null,
      subtimerSessionId: context.subtimerSessionId ?? null,
      direction: context.direction ?? null,
      confidence: context.confidence ?? 'high',
      source: context.source || 'instrumentation',
      originalDuration: context.originalDuration ?? null,
      actualDuration: context.actualDuration ?? null,
      confirmedDuration: context.confirmedDuration ?? null,
      exitedVia: context.exitedVia ?? null,
      resumedAt: context.resumedAt ?? null,
      metadata: context.metadata || {},
    };
    if (typeof _sink === 'function') _sink(entry);
    emit('onReport', entry);
    return entry;
  } catch (e) {
    console.warn('activityTracker.report error:', eventType, e);
    return null;
  }
}

// Запис існує, агент його хоче оновити (наприклад при confirmEvent).
export function patch(id, fields) {
  if (!id || typeof _patchSink !== 'function') return false;
  try {
    _patchSink(id, fields);
    return true;
  } catch (e) {
    console.warn('activityTracker.patch error:', e);
    return false;
  }
}

// Сесія = адвокат відкрив модуль. End — закрив. Звичайна "поточна робота".
export function startSession(caseId, module, options = {}) {
  try {
    if (_activeSession) {
      // Сесія вже активна — закриваємо попередню, починаємо нову.
      endSession({ reason: 'replaced' });
    }
    const sessionId = makeId('sess');
    _activeSession = {
      sessionId,
      caseId: caseId || null,
      module: module || MODULES.SYSTEM,
      startedAt: nowIso(),
      category: options.category || (caseId ? 'case_work' : 'admin'),
      subCategory: options.subCategory || null,
      semanticGroup: options.semanticGroup || 'screen_active',
    };
    emit('onSessionStart', { ..._activeSession });
    return sessionId;
  } catch (e) {
    console.warn('activityTracker.startSession error:', e);
    return null;
  }
}

export function endSession(options = {}) {
  if (!_activeSession) return null;
  try {
    const session = _activeSession;
    _activeSession = null;
    const start = new Date(session.startedAt);
    const end = new Date();
    const duration = Math.max(0, Math.round((end - start) / 1000));
    if (duration > 0) {
      report('session', {
        type: 'session',
        startTime: session.startedAt,
        endTime: end.toISOString(),
        duration,
        caseId: session.caseId,
        module: session.module,
        category: session.category,
        subCategory: session.subCategory,
        semanticGroup: session.semanticGroup,
        metadata: { reason: options.reason || 'user_close', sessionId: session.sessionId },
      });
    }
    emit('onSessionEnd', { ...session, duration, reason: options.reason || 'user_close' });
    return session.sessionId;
  } catch (e) {
    console.warn('activityTracker.endSession error:', e);
    return null;
  }
}

// ── Категоризовані субтаймери (Тези 7-8) ────────────────────────────────────
// Адвокат явно оголошує "іду в X" → стартує субтаймер з категорією і
// semanticGroup. На end — пишеться time_entry.
export function startSubtimer(category, caseId, subCategory, options = {}) {
  try {
    if (_activeSubtimer) {
      endSubtimer({ reason: 'replaced' });
    }
    const id = makeId('sub');
    _activeSubtimer = {
      id,
      category: category || 'case_work',
      caseId: caseId || null,
      subCategory: subCategory || null,
      semanticGroup: options.semanticGroup || (
        ['drafting', 'case_research', 'document_review', 'agent_chat', 'desktop_browsing']
          .includes(subCategory) ? 'screen_active' : 'screen_passive'
      ),
      startedAt: nowIso(),
      plannedDuration: Number.isFinite(options.plannedDuration) ? options.plannedDuration : null,
      parentTimerId: options.parentTimerId || null,
      sessionId: makeId('subsess'),
    };
    emit('onSubtimerStart', { ..._activeSubtimer });
    return id;
  } catch (e) {
    console.warn('activityTracker.startSubtimer error:', e);
    return null;
  }
}

export function updateSubtimer(updates = {}) {
  if (!_activeSubtimer) return false;
  try {
    _activeSubtimer = { ..._activeSubtimer, ...updates };
    return true;
  } catch (e) {
    console.warn('activityTracker.updateSubtimer error:', e);
    return false;
  }
}

export function endSubtimer(options = {}) {
  if (!_activeSubtimer) return null;
  try {
    const sub = _activeSubtimer;
    _activeSubtimer = null;
    const start = new Date(sub.startedAt);
    const end = new Date();
    const duration = Math.max(0, Math.round((end - start) / 1000));
    const entry = report('subtimer', {
      type: 'external',
      startTime: sub.startedAt,
      endTime: end.toISOString(),
      duration,
      caseId: sub.caseId,
      module: MODULES.SUBTIMER,
      category: sub.category,
      subCategory: sub.subCategory,
      semanticGroup: sub.semanticGroup,
      originalDuration: sub.plannedDuration,
      actualDuration: duration,
      confidence: options.confidence || 'high',
      exitedVia: options.exitedVia || 'manual',
      parentTimerId: sub.parentTimerId,
      subtimerSessionId: sub.sessionId,
      status: options.status || 'confirmed',
      metadata: { reason: options.reason || 'user_end' },
    });
    emit('onSubtimerEnd', { ...sub, duration, reason: options.reason || 'user_end' });
    return entry;
  } catch (e) {
    console.warn('activityTracker.endSubtimer error:', e);
    return null;
  }
}

// Адвокат повернувся без оголошення. Створюємо retroactively запис.
// // experimental — review after 1 month
export function assignOfflinePeriod(period, category, caseId, options = {}) {
  try {
    if (!period?.from || !period?.to) return null;
    const start = new Date(period.from);
    const end = new Date(period.to);
    const duration = Math.max(0, Math.round((end - start) / 1000));
    return report('offline_assigned', {
      type: 'external',
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      duration,
      caseId: caseId || null,
      module: MODULES.OFFLINE,
      category: category || 'case_work',
      subCategory: options.subCategory || null,
      semanticGroup: options.semanticGroup || 'screen_passive',
      confidence: options.confidence || 'medium',
      exitedVia: 'unexpected_screen_off',
      status: 'user_corrected',
      source: 'manual_assign',
      metadata: { reason: options.reason || 'retroactive' },
    });
  } catch (e) {
    console.warn('activityTracker.assignOfflinePeriod error:', e);
    return null;
  }
}

// ── Master timer (повна логіка в masterTimer.js, тут тільки делегування) ────
let _masterTimerImpl = null;
export function bindMasterTimer(impl) { _masterTimerImpl = impl; }
export function startMasterTimer(...args) { return _masterTimerImpl?.start?.(...args); }
export function pauseMasterTimer(...args) { return _masterTimerImpl?.pause?.(...args); }
export function resumeMasterTimer(...args) { return _masterTimerImpl?.resume?.(...args); }
export function stopMasterTimer(...args) { return _masterTimerImpl?.stop?.(...args); }
export function getMasterTimerState() { return _masterTimerImpl?.getState?.() || null; }

// ── Хелпер для чистки в тестах і ErrorBoundary recovery ─────────────────────
export function _resetForTests() {
  _sink = null;
  _patchSink = null;
  _activeSession = null;
  _activeSubtimer = null;
  for (const k of Object.keys(_hooks)) _hooks[k] = [];
  _masterTimerImpl = null;
}

export const _internals = { MAX_TIME_ENTRIES_BUFFER, makeId };
