import { useState } from 'react';
import './Input.css';

/**
 * Input — універсальне текстове поле.
 *
 * Підтримує: text / number / date / email / search через type, або textarea
 * через multiline=true.
 *
 * Props:
 *   type: 'text' | 'number' | 'date' | 'email' | 'search'
 *   value, onChange (отримує string, не event)
 *   placeholder, disabled, autoFocus
 *   label   — підпис над полем
 *   error   — повідомлення про помилку (червона рамка + червоний текст під)
 *   hint    — підказка під полем
 *   icon    — ReactNode ліворуч від поля
 *   multiline — рендериться як textarea
 *   rows    — кількість рядків для textarea (default 4)
 */
export function Input({
  type = 'text',
  value,
  onChange,
  placeholder,
  disabled = false,
  label,
  error,
  hint,
  icon,
  multiline = false,
  rows = 4,
  autoFocus = false,
  className,
  ...rest
}) {
  const [focused, setFocused] = useState(false);

  const cls = [
    'ui-input',
    focused && 'ui-input--focused',
    error && 'ui-input--error',
    disabled && 'ui-input--disabled',
    className,
  ].filter(Boolean).join(' ');

  const InputElement = multiline ? 'textarea' : 'input';

  return (
    <div className={cls}>
      {label && <label className="ui-input__label">{label}</label>}
      <div className="ui-input__field">
        {icon && <span className="ui-input__icon">{icon}</span>}
        <InputElement
          type={multiline ? undefined : type}
          rows={multiline ? rows : undefined}
          value={value ?? ''}
          onChange={(e) => onChange?.(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          className="ui-input__control"
          {...rest}
        />
      </div>
      {error && <div className="ui-input__error">{error}</div>}
      {!error && hint && <div className="ui-input__hint">{hint}</div>}
    </div>
  );
}
