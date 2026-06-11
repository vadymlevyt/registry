// ── EXTENSION BRIDGE ─────────────────────────────────────────────────────────
// Глобальний міст між Legal BMS SPA і майбутнім власним Chrome extension
// (Track B розробки). Закладено вже зараз з повним ДНК (принцип ембріона):
// у MVP TASK 0.4 — extension не існує, але вже є фасад і window.LegalBMS API,
// готові прийняти розширення без переписування ядра.
//
// Архітектурний патерн (дзеркало activityTracker): module-scoped мутабельні
// _enabled / _deps / _readyPromise дозволяють configure() ще до hydration
// (App.jsx) і enable() ПІСЛЯ — без race-condition. До enable() жоден виклик
// API не доступний (window.LegalBMS відсутній), тож розширення мусить чекати
// або DOM event 'legalbms:ready', або whenReady() promise.
//
// Один сенс (правило #11): bridge — це КАНАЛ ПЕРЕДАЧІ даних від
// зовнішнього розширення в SPA, не сам процесинг. Процесинг — у
// scenarioProcessor.js, який bridge викликає через deps.submitScenarioResult.
//
// SaaS: getEntitlements() повертає лише spread'нутий tenant-зріз, не sensitive
// дані. Жодних tokens, жодних cases — розширення взаємодіє тільки через
// явні методи, ніколи через прямий доступ до state.

let _enabled = false;
let _deps = null;
let _readyResolvers = [];
let _readyPromise = new Promise((resolve) => {
  _readyResolvers.push(resolve);
});

// API_LEVEL зростає при breaking-зміні форми window.LegalBMS (видалення
// методу, зміна сигнатури). Розширення майбутнього перевірятиме
// `window.LegalBMS.apiLevel >= N` перед використанням нових методів.
const API_LEVEL = 1;
const VERSION = '1.0.0';

/**
 * Конфігурує bridge з реальними залежностями. Викликається з App.jsx
 * на кожному рендері (як createActions) — deps реактивні до поточного
 * render snapshot'у. До enable() цей stash не активний для розширення.
 *
 * deps структура:
 *   - submitScenarioResult(envelope, options) — обробити envelope з ЄСІТС
 *   - eventBus — { subscribe(topic, handler): unsubscribeFn }
 *   - getEntitlementsForExtension() — повертає entitlements зрізаний для extension
 */
export function configure(deps) {
  _deps = deps;
}

/**
 * Активує window.LegalBMS API і емітить 'legalbms:ready' DOM event.
 * Викликається з App.jsx ОДИН раз ПІСЛЯ hydration з Drive — інакше перші
 * виклики розширення можуть перетертися EFFECT-A.
 *
 * Ідемпотентна: повторний enable() — no-op (НЕ переписує window.LegalBMS,
 * щоб не зірвати handlery що вже підписалися).
 */
export function enable() {
  if (_enabled) return;
  _enabled = true;

  if (typeof window !== 'undefined') {
    window.LegalBMS = {
      apiLevel: API_LEVEL,
      version: VERSION,
      isReady: true,
      whenReady: () => _readyPromise,

      // TASK submit_persist_ack: Result містить persisted/persistError —
      // розширення показує «успіх» ЛИШЕ при persisted:true; інакше
      // «не збережено, повторіть» (дедуп ідемпотентний → повтор безпечний).
      submitScenarioResult: async (envelope) => {
        if (!_deps?.submitScenarioResult) {
          throw new Error('LegalBMS bridge not configured: submitScenarioResult unavailable');
        }
        return _deps.submitScenarioResult(envelope, { transport: 'extension' });
      },

      on: (event, handler) => {
        if (!_deps?.eventBus) {
          throw new Error('LegalBMS bridge not configured: eventBus unavailable');
        }
        return _deps.eventBus.subscribe(event, handler);
      },

      getEntitlements: () => {
        if (!_deps?.getEntitlementsForExtension) {
          throw new Error('LegalBMS bridge not configured: getEntitlementsForExtension unavailable');
        }
        return _deps.getEntitlementsForExtension();
      },
      // registerExtension(name, version, capabilities) — НЕ закладено у MVP
      // (YAGNI). Майбутній handshake з підтвердженням провенансу розширення
      // тримається в tracking_debt #ext-1; не вводити без реальної потреби.
    };

    try {
      document.dispatchEvent(new CustomEvent('legalbms:ready', {
        detail: { apiLevel: API_LEVEL, version: VERSION },
      }));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[extensionBridge] failed to dispatch legalbms:ready:', e);
    }
  }

  // Розблоковуємо всіх хто чекав на whenReady().
  _readyResolvers.forEach((resolve) => resolve());
  _readyResolvers = [];
}

/**
 * Повертає поточний стан bridge.
 * @returns {boolean}
 */
export function isEnabled() {
  return _enabled;
}

/**
 * ТІЛЬКИ ДЛЯ ТЕСТІВ: скидає внутрішній стан bridge у початковий.
 * НЕ використовувати в продакшн-коді.
 */
export function __resetForTests() {
  _enabled = false;
  _deps = null;
  _readyResolvers = [];
  _readyPromise = new Promise((resolve) => {
    _readyResolvers.push(resolve);
  });
  if (typeof window !== 'undefined' && window.LegalBMS) {
    delete window.LegalBMS;
  }
}

// Експорт констант для тестів і документації.
export const __API_LEVEL = API_LEVEL;
export const __VERSION = VERSION;
