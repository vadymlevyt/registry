import { useEffect, useState, useRef } from 'react';
import { Toast } from './Toast.jsx';
import { subscribeToToasts } from '../../services/toast.js';

/**
 * ToastContainer — рендерить активні toast-повідомлення.
 *
 * Підключається на верхньому рівні App.jsx один раз. Toast-повідомлення
 * приходять через subscribeToToasts (event-bus стиль) — не через props.
 */
export function ToastContainer() {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map()); // id → setTimeout handle

  useEffect(() => {
    const unsubscribe = subscribeToToasts((event) => {
      if (event.type === 'add') {
        const m = event.message;
        setToasts(prev => [...prev, m]);
        if (!m.persistent) {
          const handle = setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== m.id));
            timersRef.current.delete(m.id);
          }, m.duration);
          timersRef.current.set(m.id, handle);
        }
      } else if (event.type === 'dismiss') {
        const handle = timersRef.current.get(event.id);
        if (handle) { clearTimeout(handle); timersRef.current.delete(event.id); }
        setToasts(prev => prev.filter(t => t.id !== event.id));
      } else if (event.type === 'update') {
        // Оновлення НА МІСЦІ (прогрес довгих операцій) — без мерехтіння.
        // Таймер не чіпаємо (persistent не має; non-persistent лишає свій).
        setToasts(prev => prev.map(t => (t.id === event.id ? { ...t, ...event.patch } : t)));
      } else if (event.type === 'clear') {
        timersRef.current.forEach(h => clearTimeout(h));
        timersRef.current.clear();
        setToasts([]);
      }
    });
    return () => {
      unsubscribe();
      timersRef.current.forEach(h => clearTimeout(h));
      timersRef.current.clear();
    };
  }, []);

  const dismiss = (id) => {
    const handle = timersRef.current.get(id);
    if (handle) { clearTimeout(handle); timersRef.current.delete(id); }
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  if (toasts.length === 0) return null;

  return (
    <div className="ui-toast-container" role="region" aria-label="Сповіщення">
      {toasts.map(t => (
        <Toast
          key={t.id}
          variant={t.variant}
          title={t.title}
          description={t.description}
          action={t.action}
          onDismiss={() => dismiss(t.id)}
        />
      ))}
    </div>
  );
}
