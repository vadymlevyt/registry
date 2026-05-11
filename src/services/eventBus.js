// ── EVENT BUS ────────────────────────────────────────────────────────────────
// Простий pub/sub для крос-модульної комунікації в межах одного tenant'а.
//
// Інфраструктура для модулів які реагують на події інших модулів без прямих
// імпортів (наприклад, Dashboard підпишеться на ecits.documents_received щоб
// підсвітити нові надходження).
//
// На етапі TASK 0.2 — тільки інфраструктура: ніхто реально не публікує.
// Топіки документовано в eventBusTopics.js.
//
// SaaS-готовність: зараз глобальний, in-memory. При справжньому multi-tenant
// SaaS — інстансуватиметься per tenant без зміни публічного API.

const subscribers = new Map(); // topic → Set<handler>

/**
 * Підписатися на топік.
 * @param {string} eventName — топік з eventBusTopics.js
 * @param {(payload: any) => void} handler
 * @returns {() => void} — функція скасування підписки
 */
export function subscribe(eventName, handler) {
  if (typeof eventName !== 'string' || !eventName) {
    throw new Error('eventBus.subscribe: eventName must be a non-empty string');
  }
  if (typeof handler !== 'function') {
    throw new Error('eventBus.subscribe: handler must be a function');
  }
  if (!subscribers.has(eventName)) {
    subscribers.set(eventName, new Set());
  }
  const set = subscribers.get(eventName);
  set.add(handler);
  return function unsubscribe() {
    const current = subscribers.get(eventName);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) subscribers.delete(eventName);
  };
}

/**
 * Опублікувати подію. Помилки в handler'ах не блокують інших підписників і
 * не злітають вгору — щоб падіння одного слухача не валило публікатора.
 */
export function publish(eventName, payload) {
  const set = subscribers.get(eventName);
  if (!set || set.size === 0) return;
  for (const handler of Array.from(set)) {
    try {
      handler(payload);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[eventBus] handler error for '${eventName}':`, err);
    }
  }
}

/**
 * Очистити всі підписки. Використовується тільки в тестах.
 */
export function clear() {
  subscribers.clear();
}

/**
 * Кількість підписників на топік. Для тестів і діагностики.
 */
export function subscriberCount(eventName) {
  const set = subscribers.get(eventName);
  return set ? set.size : 0;
}
