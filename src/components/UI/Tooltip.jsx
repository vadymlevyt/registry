import { useState, useRef, useEffect } from 'react';
import './Tooltip.css';

/**
 * Tooltip — підказка при hover/focus.
 *
 * Wrapper-компонент: обгортає дочірній елемент, показує tooltip коли курсор
 * наведено на дочку (або фокус). Прибирає коли курсор/фокус йде.
 *
 * Props:
 *   content: string | ReactNode               — текст підказки
 *   placement: 'top' | 'right' | 'bottom' | 'left'  — позиція (default 'top')
 *   delay: number                              — затримка перед показом у ms (default 500)
 *   children: тригер-елемент
 *   disabled: boolean                          — не показувати tooltip
 */
export function Tooltip({
  content,
  placement = 'top',
  delay = 500,
  children,
  disabled = false,
}) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);

  const show = () => {
    if (disabled || !content) return;
    timerRef.current = setTimeout(() => setVisible(true), delay);
  };

  const hide = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  };

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return (
    <span
      className="ui-tooltip-wrapper"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && content && (
        <span className={`ui-tooltip ui-tooltip--${placement}`} role="tooltip">
          {content}
        </span>
      )}
    </span>
  );
}
