import './Chip.css';
import { X } from 'lucide-react';

/**
 * Chip — компактний елемент для тегів, фільтрів, статусів.
 *
 * Варіанти:
 *   default     — нейтральний (теги документів)
 *   accent      — синій акцент (активні фільтри)
 *   success     — зелений (статус "active")
 *   warning     — помаранчевий (попередження)
 *   danger      — червоний (помилки)
 *   proceeding  — для проваджень (колір передається через `color` prop)
 *
 * Розміри: sm (default) / md.
 *
 * Props:
 *   variant: 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'proceeding'
 *   size: 'sm' | 'md'
 *   color: string         — для variant='proceeding' (CSS-змінна або hex)
 *   removable: boolean    — показує × кнопку
 *   onRemove: () => void  — обробник кліку по ×
 *   onClick: () => void   — клік по самому chip (interactive)
 *   icon: ReactNode       — іконка зліва
 *   children: текст
 */
export function Chip({
  variant = 'default',
  size = 'sm',
  color,
  removable = false,
  onRemove,
  onClick,
  icon,
  children,
  className,
  ...rest
}) {
  const cls = [
    'ui-chip',
    `ui-chip--${variant}`,
    `ui-chip--${size}`,
    onClick && 'ui-chip--clickable',
    className,
  ].filter(Boolean).join(' ');

  const style = variant === 'proceeding' && color
    ? { '--chip-color': color }
    : undefined;

  return (
    <span
      className={cls}
      style={style}
      onClick={onClick}
      {...rest}
    >
      {icon && <span className="ui-chip__icon">{icon}</span>}
      <span className="ui-chip__label">{children}</span>
      {removable && (
        <button
          type="button"
          className="ui-chip__remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
          aria-label="Видалити"
        >
          <X size={12} />
        </button>
      )}
    </span>
  );
}
