import { useState } from 'react';
import './Select.css';

/**
 * Select — стандартний dropdown зі списком опцій.
 *
 * Native <select> обгорнуто у стилізований wrapper для консистентності з
 * Input. Searchable / async — окремий TASK у майбутньому.
 *
 * Props:
 *   value, onChange (отримує string value, не event)
 *   options: [{ value, label, disabled? }]
 *   placeholder — рядок який показується коли value порожній
 *   label, error, hint, disabled — аналогічно Input
 */
export function Select({
  value,
  onChange,
  options = [],
  placeholder,
  label,
  error,
  hint,
  disabled = false,
  className,
  ...rest
}) {
  const [focused, setFocused] = useState(false);

  const cls = [
    'ui-select',
    focused && 'ui-select--focused',
    error && 'ui-select--error',
    disabled && 'ui-select--disabled',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={cls}>
      {label && <label className="ui-select__label">{label}</label>}
      <div className="ui-select__field">
        <select
          className="ui-select__control"
          value={value ?? ''}
          onChange={(e) => onChange?.(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          disabled={disabled}
          {...rest}
        >
          {placeholder && (
            <option value="" disabled>{placeholder}</option>
          )}
          {options.map((opt) => (
            <option
              key={opt.value}
              value={opt.value}
              disabled={opt.disabled}
            >
              {opt.label}
            </option>
          ))}
        </select>
        <span className="ui-select__chevron" aria-hidden="true">▾</span>
      </div>
      {error && <div className="ui-select__error">{error}</div>}
      {!error && hint && <div className="ui-select__hint">{hint}</div>}
    </div>
  );
}
