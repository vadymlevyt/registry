import { useEffect } from 'react';
import './Modal.css';

/**
 * Modal — фірмова модалка.
 *
 * Замінює window.alert/confirm/prompt у системі. Використовується для
 * підтверджень, форм, повідомлень. Сама не керує власним станом —
 * isOpen контролюється зовні.
 *
 * Props:
 *   isOpen: boolean
 *   onClose: () => void
 *   title: string             — заголовок (опційно)
 *   size: 'sm' | 'md' | 'lg'  — 400 / 600 / 900px
 *   children: контент тіла
 *   actions: ReactNode        — нижній ряд кнопок (зазвичай 2-3 Button)
 *   closeOnBackdrop: boolean (default true)
 *   closeOnEscape: boolean (default true)
 */
export function Modal({
  isOpen,
  onClose,
  title,
  size = 'md',
  children,
  actions,
  closeOnBackdrop = true,
  closeOnEscape = true,
}) {
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;
    const handler = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, closeOnEscape, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="ui-modal-backdrop"
      onClick={closeOnBackdrop ? onClose : undefined}
      role="presentation"
    >
      <div
        className={`ui-modal ui-modal--${size}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'ui-modal-title' : undefined}
      >
        {title && (
          <div className="ui-modal__header">
            <h2 id="ui-modal-title" className="ui-modal__title">{title}</h2>
            <button
              className="ui-modal__close"
              onClick={onClose}
              aria-label="Закрити"
              type="button"
            >×</button>
          </div>
        )}
        <div className="ui-modal__body">
          {children}
        </div>
        {actions && (
          <div className="ui-modal__actions">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
