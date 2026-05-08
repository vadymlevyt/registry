import './Card.css';

/**
 * Card — універсальний контейнер.
 *
 * Props:
 *   variant: 'default' | 'interactive'  — interactive додає hover-ефект і cursor
 *   onClick — якщо передано і variant='interactive' — клікабельна
 *   leftBorderColor — кольоровий лівий бордюр (наприклад, для документів за провадженням)
 *   className — додатковий клас
 *   children
 */
export function Card({
  variant = 'default',
  children,
  onClick,
  className,
  leftBorderColor,
  ...rest
}) {
  const cls = [
    'ui-card',
    variant === 'interactive' && 'ui-card--interactive',
    className,
  ].filter(Boolean).join(' ');

  const style = leftBorderColor
    ? { borderLeftColor: leftBorderColor, borderLeftWidth: '3px' }
    : undefined;

  return (
    <div className={cls} style={style} onClick={onClick} {...rest}>
      {children}
    </div>
  );
}
