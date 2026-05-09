import { Check } from 'lucide-react';
import './Checkbox.css';

/**
 * Checkbox — фірмовий чекбокс.
 *
 * Прямокутна форма з ✓ (на відміну від Toggle який є switch). Використовується
 * у списках з вибором (архів матеріалів, batch-операції).
 *
 * Props:
 *   checked: boolean
 *   onChange: (newValue: boolean) => void
 *   label: string (опційно)
 *   disabled: boolean
 *   indeterminate: boolean — для "виділено частину" індикації
 */
export function Checkbox({
  checked = false,
  onChange,
  label,
  disabled = false,
  indeterminate = false,
  size = 'md',
  className,
  onClick,
  ...rest
}) {
  const cls = [
    'ui-checkbox',
    `ui-checkbox--${size}`,
    checked && 'ui-checkbox--checked',
    indeterminate && 'ui-checkbox--indeterminate',
    disabled && 'ui-checkbox--disabled',
    className,
  ].filter(Boolean).join(' ');

  return (
    <label className={cls} onClick={onClick} {...rest}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
        disabled={disabled}
        className="ui-checkbox__input"
      />
      <span className="ui-checkbox__box" aria-hidden="true">
        {indeterminate ? (
          <span className="ui-checkbox__dash" />
        ) : checked ? (
          <Check size={size === 'sm' ? 10 : 12} />
        ) : null}
      </span>
      {label && <span className="ui-checkbox__label">{label}</span>}
    </label>
  );
}
