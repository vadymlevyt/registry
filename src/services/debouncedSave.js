// ── DEBOUNCED SAVE PRIMITIVE ────────────────────────────────────────────────
// Один сенс (правило #11): "відкласти виклик saveFn на N мс тиші; повторний
// trigger перевзводить таймер; flush — викликати негайно і скасувати таймер".
//
// Чому окремий примітив, а не inline у useEffect: тестується з fake timers
// без mountу App.jsx (тест P2: 10 trigger у 100ms → 1 save; через 1500ms
// нова → ще 1 save).
//
// Контракт:
//   - trigger(): зводить таймер на delay мс. Якщо вже зведено — перезводить.
//   - flush(): якщо є відкладений виклик — викликає одразу і чистить таймер.
//     Якщо немає — no-op (НЕ викликає saveFn зайвий раз).
//   - cancel(): чистить таймер без виклику saveFn.
//
// Критично: saveFn ЗАВЖДИ викликається з актуальним замиканням caller'а,
// тому що caller перевикликає trigger() при кожній зміні стану — таймер
// тримає лише посилання на останню зведену функцію (через рефреш у trigger).
export function createDebouncedSave(saveFn, delay = 800) {
  if (typeof saveFn !== 'function') {
    throw new Error('createDebouncedSave: saveFn має бути функцією');
  }
  const ms = Math.max(0, Number(delay) || 0);
  let timerId = null;
  // pendingFn — найсвіжіше замикання, яке має виконатись при flush/timeout.
  // Дозволяє caller'у передавати оновлене замикання при кожному trigger().
  let pendingFn = null;

  function fire() {
    timerId = null;
    const fn = pendingFn;
    pendingFn = null;
    if (fn) fn();
  }

  function trigger(nextFn) {
    pendingFn = typeof nextFn === 'function' ? nextFn : saveFn;
    if (timerId !== null) clearTimeout(timerId);
    timerId = setTimeout(fire, ms);
  }

  function flush() {
    if (timerId === null) return;
    clearTimeout(timerId);
    fire();
  }

  function cancel() {
    if (timerId === null) return;
    clearTimeout(timerId);
    timerId = null;
    pendingFn = null;
  }

  function isPending() {
    return timerId !== null;
  }

  return { trigger, flush, cancel, isPending };
}
