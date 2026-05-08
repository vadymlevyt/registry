import './Button.css';

/**
 * Button — універсальна кнопка.
 *
 * Варіанти:
 *   primary    — основна дія (синій акцент)
 *   secondary  — другорядна дія (прозорий з бордюром)
 *   ghost      — мінімалістична (тільки текст з hover-фоном)
 *   danger     — небезпечна дія (червоний, для видалень)
 *
 * Розміри:
 *   sm  — компактна (для inline дій, метаданих)
 *   md  — стандартна (default)
 *   lg  — велика (для CTA)
 *
 * Props:
 *   variant: 'primary' | 'secondary' | 'ghost' | 'danger'
 *   size: 'sm' | 'md' | 'lg'
 *   icon, iconRight: ReactNode  — іконки ліворуч/праворуч від тексту
 *   loading: boolean            — показує spinner і блокує клік
 *   disabled: boolean
 *   fullWidth: boolean
 *   children: текст кнопки
 *   onClick, type, ...rest
 */
export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  disabled = false,
  fullWidth = false,
  children,
  onClick,
  type = 'button',
  className,
  ...rest
}) {
  const cls = [
    'ui-button',
    `ui-button--${variant}`,
    `ui-button--${size}`,
    fullWidth && 'ui-button--full',
    loading && 'ui-button--loading',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button
      type={type}
      className={cls}
      disabled={disabled || loading}
      onClick={onClick}
      {...rest}
    >
      {loading && <span className="ui-button__spinner" aria-hidden="true" />}
      {!loading && icon && <span className="ui-button__icon">{icon}</span>}
      <span className="ui-button__label">{children}</span>
      {!loading && iconRight && <span className="ui-button__icon">{iconRight}</span>}
    </button>
  );
}
