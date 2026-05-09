import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import './Toast.css';

const VARIANT_ICONS = {
  success: CheckCircle,
  error:   AlertCircle,
  warning: AlertTriangle,
  info:    Info,
};

/**
 * Toast — одне повідомлення.
 *
 * Не керує своїм станом — рендериться через ToastContainer.
 *
 * Props:
 *   variant: 'success' | 'error' | 'warning' | 'info'
 *   title: коротко суть
 *   description: опційний детальний опис
 *   action: { label, onClick } — опційна кнопка дії (закриває toast після кліку)
 *   onDismiss: () => void — закриття × кнопкою або action-кліком
 */
export function Toast({ variant = 'info', title, description, action, onDismiss }) {
  const Icon = VARIANT_ICONS[variant] || Info;

  return (
    <div className={`ui-toast ui-toast--${variant}`} role="alert">
      <Icon className="ui-toast__icon" size={20} />
      <div className="ui-toast__content">
        {title && <div className="ui-toast__title">{title}</div>}
        {description && <div className="ui-toast__description">{description}</div>}
        {action && (
          <button
            type="button"
            className="ui-toast__action"
            onClick={() => { action.onClick?.(); onDismiss?.(); }}
          >
            {action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        className="ui-toast__close"
        onClick={onDismiss}
        aria-label="Закрити"
      >
        <X size={14} />
      </button>
    </div>
  );
}
