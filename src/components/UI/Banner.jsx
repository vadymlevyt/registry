import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { Button } from './Button.jsx';
import './Banner.css';

const VARIANT_ICONS = {
  success: CheckCircle,
  error:   AlertCircle,
  warning: AlertTriangle,
  info:    Info,
};

/**
 * Banner — inline-попередження в межах секції.
 *
 * На відміну від Toast — не зникає автоматично. Прив'язаний до місця в UI:
 * вгорі вкладки «Огляд», над списком документів тощо. Закривається лише
 * адвокатом або зникає коли причина вирішена.
 *
 * Props:
 *   variant: 'success' | 'error' | 'warning' | 'info'
 *   title: коротко суть
 *   description: опційно, 1-2 речення
 *   actions: [{ label, onClick, variant? }] — список Button
 *   dismissible: boolean — показує × кнопку
 *   onDismiss: () => void
 */
export function Banner({
  variant = 'info',
  title,
  description,
  actions,
  dismissible = false,
  onDismiss,
  className,
  ...rest
}) {
  const Icon = VARIANT_ICONS[variant] || Info;
  const cls = [
    'ui-banner',
    `ui-banner--${variant}`,
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={cls} role="status" {...rest}>
      <Icon className="ui-banner__icon" size={18} />
      <div className="ui-banner__content">
        {title && <div className="ui-banner__title">{title}</div>}
        {description && <div className="ui-banner__description">{description}</div>}
        {actions && actions.length > 0 && (
          <div className="ui-banner__actions">
            {actions.map((a, i) => (
              <Button
                key={i}
                variant={a.variant || 'secondary'}
                size="sm"
                onClick={a.onClick}
              >
                {a.label}
              </Button>
            ))}
          </div>
        )}
      </div>
      {dismissible && (
        <button
          type="button"
          className="ui-banner__close"
          onClick={onDismiss}
          aria-label="Закрити"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
