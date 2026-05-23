// ── HASH ROUTER ──────────────────────────────────────────────────────────────
// Мінімальний hash-based router без зовнішніх пакетів. Один сенс (правило #11):
// "розбирає `location.hash` у `{ module, entityId, view }` і повідомляє про
// зміни підписникам".
//
// Граматика: `#/<module>[/<entityId>][/<view>]`
//   #/court-sync                 → { module:'court-sync', entityId:null, view:null }
//   #/court-sync/import          → { module:'court-sync', entityId:'import', view:null }
//   #/court-sync/settings        → { module:'court-sync', entityId:'settings', view:null }
//   #/case/case_123/documents    → { module:'case', entityId:'case_123', view:'documents' }
//
// Хеші без префікса `#/` (наприклад анкор-посилання `#section`) ІГНОРУЮТЬСЯ —
// це інший сенс хешу і вони не повинні тригерити навігацію модулів.
//
// SPA-агностичний: router не знає про React, не змінює state. Передає подію
// у callback, React-компонент (App.jsx) сам перемикає `tab` / показує
// потрібну вкладку. Не блокує існуючу `useState('dashboard')` навігацію —
// hash-роутинг доповнює, не замінює.
//
// TASK 0.4 закладає інфраструктуру; DP v2 і інші модулі додають свої роути
// через registerRoute() без переписування ядра.

const _routes = new Map();          // moduleId → { onEnter, onLeave? }
const _listeners = new Set();        // generic listeners (для тестів/розширень)
let _currentRoute = null;
let _started = false;

/**
 * Парсить hash-фрагмент у структуру навігації.
 * @param {string} hash повний `location.hash` починаючи з '#'
 * @returns {{ module: string|null, entityId: string|null, view: string|null, raw: string }}
 */
export function parseHash(hash) {
  const raw = typeof hash === 'string' ? hash : '';
  if (!raw.startsWith('#/')) {
    return { module: null, entityId: null, view: null, raw };
  }
  const parts = raw.slice(2).split('/').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { module: null, entityId: null, view: null, raw };
  }
  return {
    module: parts[0] || null,
    entityId: parts[1] || null,
    view: parts[2] || null,
    raw,
  };
}

/**
 * Реєструє hook'и для конкретного модуля. handlers.onEnter викликається
 * щоразу коли активна частина hash починається з #/<moduleId>; onLeave —
 * коли йдемо з нього в інший модуль.
 *
 * @param {string} moduleId
 * @param {{ onEnter: (route) => void, onLeave?: (prev) => void }} handlers
 * @returns {() => void} unregister
 */
export function registerRoute(moduleId, handlers) {
  if (!moduleId || typeof moduleId !== 'string') {
    throw new Error('registerRoute: moduleId is required (string)');
  }
  if (!handlers || typeof handlers.onEnter !== 'function') {
    throw new Error('registerRoute: handlers.onEnter is required (function)');
  }
  _routes.set(moduleId, handlers);
  // Якщо роутер уже запущено і поточний hash веде у цей модуль — одразу
  // дозвонити onEnter (дозволяє реєструватися пізно).
  if (_started && _currentRoute?.module === moduleId) {
    try { handlers.onEnter(_currentRoute); } catch (e) { console.warn(`[hashRouter] onEnter '${moduleId}' threw:`, e); }
  }
  return () => {
    _routes.delete(moduleId);
  };
}

/**
 * Підписатися на будь-яку зміну роуту (всі модулі). Корисно для тестів,
 * аналітики, або глобальних слухачів.
 *
 * @param {(route) => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribe(listener) {
  if (typeof listener !== 'function') return () => {};
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

/**
 * Поточний роут (frozen snapshot). null до start() або коли hash не співпадає
 * з граматикою.
 * @returns {object|null}
 */
export function getCurrentRoute() {
  return _currentRoute ? { ..._currentRoute } : null;
}

/**
 * Програмно змінити hash. Записує `location.hash` — браузер сам тригерить
 * 'hashchange', тож handlers викличуться послідовно (1 розгалуження).
 * @param {string} path шлях БЕЗ префікса '#' (наприклад 'court-sync/import')
 */
export function navigate(path) {
  if (typeof window === 'undefined') return;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (window.location.hash === `#${normalized}`) {
    // hashchange не спрацює — тригернемо явно щоб onEnter все одно викликався.
    _handleHashChange();
    return;
  }
  window.location.hash = normalized;
}

function _handleHashChange() {
  const hash = typeof window !== 'undefined' ? window.location.hash : '';
  const next = parseHash(hash);
  const prev = _currentRoute;
  _currentRoute = next.module ? next : null;

  // onLeave старого модуля (якщо ми йдемо в інший)
  if (prev && prev.module && prev.module !== next.module) {
    const prevHandlers = _routes.get(prev.module);
    if (prevHandlers?.onLeave) {
      try { prevHandlers.onLeave(prev); } catch (e) { console.warn(`[hashRouter] onLeave '${prev.module}' threw:`, e); }
    }
  }

  // onEnter нового
  if (next.module) {
    const handlers = _routes.get(next.module);
    if (handlers?.onEnter) {
      try { handlers.onEnter(next); } catch (e) { console.warn(`[hashRouter] onEnter '${next.module}' threw:`, e); }
    }
  }

  // generic listeners
  _listeners.forEach((l) => {
    try { l(next); } catch (e) { console.warn('[hashRouter] listener threw:', e); }
  });
}

/**
 * Активувати роутер. Слухає 'hashchange' і одразу обробляє поточний hash.
 * Ідемпотентна.
 */
export function start() {
  if (_started) return;
  _started = true;
  if (typeof window === 'undefined') return;
  window.addEventListener('hashchange', _handleHashChange);
  // Обробити початковий hash (на випадок deep-link при завантаженні).
  _handleHashChange();
}

/**
 * Деактивує роутер. Корисно для тестів і unmount у React.
 */
export function stop() {
  if (!_started) return;
  _started = false;
  if (typeof window !== 'undefined') {
    window.removeEventListener('hashchange', _handleHashChange);
  }
}

/**
 * ТІЛЬКИ ДЛЯ ТЕСТІВ: скидає внутрішній стан.
 */
export function __resetForTests() {
  _routes.clear();
  _listeners.clear();
  _currentRoute = null;
  if (_started && typeof window !== 'undefined') {
    window.removeEventListener('hashchange', _handleHashChange);
  }
  _started = false;
}
