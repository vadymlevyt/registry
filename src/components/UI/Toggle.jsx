import './Toggle.css';

/**
 * Toggle — перемикач увімк/вимк (switch).
 *
 * Props:
 *   checked: boolean
 *   onChange: (newValue: boolean) => void
 *   disabled: boolean
 *   label: string         — текст ліворуч/праворуч від перемикача
 *   description: string   — додатковий опис під label (для опцій)
 *   size: 'sm' | 'md'     — компактний / стандартний
 */
export function Toggle({
  checked = false,
  onChange,
  disabled = false,
  label,
  description,
  size = 'md',
  className,
  ...rest
}) {
  const cls = [
    'ui-toggle',
    `ui-toggle--${size}`,
    checked && 'ui-toggle--checked',
    disabled && 'ui-toggle--disabled',
    className,
  ].filter(Boolean).join(' ');

  return (
    <label className={cls} {...rest}>
      <span className="ui-toggle__control">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onChange?.(!checked)}
          disabled={disabled}
          className="ui-toggle__input"
        />
        <span className="ui-toggle__track">
          <span className="ui-toggle__thumb" />
        </span>
      </span>
      {(label || description) && (
        <span className="ui-toggle__text">
          {label && <span className="ui-toggle__label">{label}</span>}
          {description && <span className="ui-toggle__description">{description}</span>}
        </span>
      )}
    </label>
  );
}
