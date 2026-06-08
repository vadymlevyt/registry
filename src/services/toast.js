// ── TOAST SERVICE ────────────────────────────────────────────────────────────
// Імперативне API для коротких статусних повідомлень. Викликається з будь-
// якого місця коду без передачі state через props. ToastContainer (у точці
// входу App) підписується через subscribeToToasts і рендерить.
//
// Принципи (з контекстного файлу 1.3 «Помилки людською мовою»):
//   • title — коротко суть (3-5 слів)
//   • description — причина і пропозиція дії (1 речення)
//   • action — опціональна кнопка («Спробувати ще», «Налаштування»)
//
// Жодного технічного жаргону у title/description. Технічні деталі — у
// console.error для розробника.
//
// Використання:
//   import { toast } from '@/services/toast.js';
//   toast.success('Документ збережено');
//   toast.error('Не вдалось зв\'язатись з Drive', {
//     description: 'Перевірте підключення',
//     action: { label: 'Спробувати ще', onClick: () => retry() },
//   });
//   const id = toast.info('Обробка PDF...', { persistent: true });
//   toast.dismiss(id);

const subscribers = new Set();
let nextId = 1;

export const toast = {
  success(title, options = {}) { return show({ variant: 'success', title, ...options }); },
  error(title, options = {})   { return show({ variant: 'error',   title, ...options }); },
  warning(title, options = {}) { return show({ variant: 'warning', title, ...options }); },
  info(title, options = {})    { return show({ variant: 'info',    title, ...options }); },

  // Показати готовий об'єкт повідомлення (зі словника messages.js).
  // Зручно: toast.show(messages.drive.saveFailed(filename), { onAction: retry })
  show(msg, { onAction } = {}) {
    if (!msg || typeof msg !== 'object') return null;
    return show({
      variant: msg.variant || 'info',
      title: msg.title,
      description: msg.description,
      action: msg.action && onAction
        ? { label: msg.action.label, onClick: onAction }
        : undefined,
    });
  },

  dismiss(id) {
    if (id == null) return;
    subscribers.forEach(fn => fn({ type: 'dismiss', id }));
  },

  // Оновити наявний toast НА МІСЦІ (без dismiss+add — без мерехтіння). Для
  // прогресу довгих операцій: один toast «виїхав» і лічильник тікає в ньому до
  // кінця. patch — часткові поля (зазвичай { title }). Невідомий id — no-op.
  update(id, patch = {}) {
    if (id == null) return;
    subscribers.forEach(fn => fn({ type: 'update', id, patch }));
  },

  clear() {
    subscribers.forEach(fn => fn({ type: 'clear' }));
  },
};

function show({ variant, title, description, action, duration, persistent }) {
  if (!title && !description) return null;
  const id = nextId++;
  const message = {
    id,
    variant: variant || 'info',
    title: title || '',
    description: description || null,
    action: action || null,
    duration: duration ?? (variant === 'error' ? 6000 : 3500),
    persistent: persistent ?? false,
    createdAt: Date.now(),
  };
  subscribers.forEach(fn => fn({ type: 'add', message }));
  return id;
}

// Внутрішнє API для ToastContainer.
export function subscribeToToasts(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
