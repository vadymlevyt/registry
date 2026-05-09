import { useEffect, useRef, useState } from 'react';
import './Select.css';

/**
 * Select — фірмовий dropdown.
 *
 * Раніше використовувався native <select>, що на Android відкриває системний
 * picker — це порушує дизайн і ламає UX (модалка, в якій з'являється
 * чужорідний android-екран). Тепер це власний button + popover з опціями.
 *
 * API сумісний з попередньою реалізацією:
 *   value, onChange (string value, не event)
 *   options: [{ value, label, disabled? }]
 *   placeholder, label, error, hint, disabled
 *
 * Доступність:
 *   - role="combobox" / aria-expanded / aria-haspopup="listbox"
 *   - стрілки ↑/↓ переміщують виділення, Enter/Space обирають
 *   - Escape закриває
 *   - клік поза списком закриває
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
  id,
  name,
}) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const wrapperRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);

  const selectedOption = options.find((o) => o.value === value);
  const displayLabel = selectedOption?.label || placeholder || '';

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex((o) => o.value === value);
    setFocusIdx(idx >= 0 ? idx : 0);
  }, [open, options, value]);

  const handleToggle = () => {
    if (disabled) return;
    setOpen((p) => !p);
  };

  const selectAt = (idx) => {
    const opt = options[idx];
    if (!opt || opt.disabled) return;
    onChange?.(opt.value);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onButtonKeyDown = (e) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen((p) => !p);
    }
  };

  const onListKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIdx((idx) => {
        for (let i = 1; i <= options.length; i++) {
          const next = (idx + i) % options.length;
          if (!options[next]?.disabled) return next;
        }
        return idx;
      });
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIdx((idx) => {
        for (let i = 1; i <= options.length; i++) {
          const next = (idx - i + options.length) % options.length;
          if (!options[next]?.disabled) return next;
        }
        return idx;
      });
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectAt(focusIdx);
    }
  };

  const cls = [
    'ui-select',
    open && 'ui-select--open',
    error && 'ui-select--error',
    disabled && 'ui-select--disabled',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={cls} ref={wrapperRef}>
      {label && (
        <label
          className="ui-select__label"
          htmlFor={id}
          onClick={() => buttonRef.current?.focus()}
        >
          {label}
        </label>
      )}
      <div className="ui-select__field">
        <button
          ref={buttonRef}
          type="button"
          id={id}
          name={name}
          className="ui-select__control"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-disabled={disabled}
          disabled={disabled}
          onClick={handleToggle}
          onKeyDown={onButtonKeyDown}
        >
          <span
            className={
              selectedOption
                ? 'ui-select__value'
                : 'ui-select__value ui-select__value--placeholder'
            }
          >
            {displayLabel}
          </span>
          <span className="ui-select__chevron" aria-hidden="true">▾</span>
        </button>
        {open && (
          <ul
            ref={listRef}
            className="ui-select__listbox"
            role="listbox"
            tabIndex={-1}
            onKeyDown={onListKeyDown}
            // listbox має фокус для клавіатурної навігації — autoFocus через ref
            autoFocus
          >
            {options.map((opt, idx) => (
              <li
                key={opt.value}
                role="option"
                aria-selected={opt.value === value}
                aria-disabled={!!opt.disabled}
                className={[
                  'ui-select__option',
                  opt.value === value && 'ui-select__option--selected',
                  idx === focusIdx && 'ui-select__option--focused',
                  opt.disabled && 'ui-select__option--disabled',
                ].filter(Boolean).join(' ')}
                onMouseEnter={() => !opt.disabled && setFocusIdx(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectAt(idx);
                }}
              >
                {opt.label}
              </li>
            ))}
            {options.length === 0 && (
              <li className="ui-select__empty">Немає опцій</li>
            )}
          </ul>
        )}
      </div>
      {error && <div className="ui-select__error">{error}</div>}
      {!error && hint && <div className="ui-select__hint">{hint}</div>}
    </div>
  );
}
