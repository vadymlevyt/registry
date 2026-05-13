import { useEffect, useRef, useState, useCallback } from 'react';
import './TimePicker.css';

// ── TimePicker ───────────────────────────────────────────────────────────────
// Фірмовий picker часу. Замінює <input type="time"> щоб уніфікувати вигляд
// між iOS / Android / Windows.
//
// Контракт:
//   value:    'HH:MM' | '' — 24-годинний формат (той самий що нативний input)
//   onChange: (hhmm: string) => void
//   label, placeholder, error, hint, disabled — як у <Input>
//   inline:   true → render wheel inline без кнопки/попапа (для
//             DateTimePicker де час завжди видимий поряд із календарем)
//   minuteStep: default 1 — крок хвилин (1 / 5 / 15 / 30). Адвокат може
//             точно ввести час засідання 09:23 коли voor courthouse system
//             потрібна 1-хвилинна точність; стандартно 1.
//
// UI:
//   Дві вертикальні колонки (години 00-23, хвилини 00-59 з кроком minuteStep).
//   Скролл-снап до центрального положення. Центральна смуга з підсвіткою
//   позначає поточно обране значення. Тап по елементу прокручує до нього.
//
// Чому wheel, а не сітка кнопок: на запит адвоката (для часу — wheel, не
// grid). Touch-frendly, традиційний UI з iOS/Android system picker'ів,
// займає мало висоти у модалці.
//
// Чому не нативний type="time": на Android відкривається системний модальний
// діалог який ламає дизайн (як з нативним select — див. UI/Select.jsx).

const pad2 = (n) => String(n).padStart(2, '0');

const ITEM_HEIGHT = 44; // px, узгоджено з CSS .ui-timepicker__wheel-item
const VISIBLE_ITEMS = 5; // непарне число щоб був центральний

// ── Format / parse ──────────────────────────────────────────────────────────

export function parseHHMM(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function toHHMM(hour, minute) {
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '';
  return `${pad2(hour)}:${pad2(minute)}`;
}

export function formatTimeDisplay(hhmm) {
  const parsed = parseHHMM(hhmm);
  if (!parsed) return '';
  return toHHMM(parsed.hour, parsed.minute);
}

function buildMinutes(step) {
  const safe = Number.isFinite(step) && step >= 1 && step <= 30 ? Math.floor(step) : 1;
  const out = [];
  for (let m = 0; m < 60; m += safe) out.push(m);
  return out;
}

// ── WheelColumn ─────────────────────────────────────────────────────────────

function WheelColumn({ items, value, onChange, ariaLabel }) {
  const ref = useRef(null);
  const scrollTimer = useRef(null);
  // Захист від циклу: коли value змінюється від нашого scroll-end-snap,
  // ефект НЕ повинен знову програмно скролити (інакше snap «застрягає»
  // і користувач не може посунути далі). isProgrammaticRef = true підіймає
  // прапор на час scrollTo, scroll handler його ігнорує.
  const isProgrammaticRef = useRef(false);

  // Програмний scrollTo до індексу. Без smooth — instant, інакше swipe
  // переривається анімацією і виглядає лагливо.
  const scrollToIndex = useCallback((idx) => {
    if (!ref.current) return;
    isProgrammaticRef.current = true;
    ref.current.scrollTop = idx * ITEM_HEIGHT;
    // Скидаємо прапорець після того як scroll events устигнуть пройти
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { isProgrammaticRef.current = false; });
    });
  }, []);

  // Підрівнюємо скрол коли value змінюється ззовні (DateTimePicker reset,
  // або клік на елемент який програмно scrollToIndex). Якщо вже на правильній
  // позиції — no-op (не triggerимо scroll handler без потреби).
  useEffect(() => {
    const idx = items.indexOf(value);
    if (idx < 0 || !ref.current) return;
    const expected = idx * ITEM_HEIGHT;
    if (Math.abs(ref.current.scrollTop - expected) > 1) {
      scrollToIndex(idx);
    }
  }, [value, items, scrollToIndex]);

  const handleScroll = () => {
    if (isProgrammaticRef.current) return;
    // Debounce: коли користувач відпускає палець, scroll triggerится
    // багато разів. Чекаємо тишу 80мс щоб остаточно зафіксувати позицію.
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      if (!ref.current) return;
      const idx = Math.round(ref.current.scrollTop / ITEM_HEIGHT);
      const clampedIdx = Math.max(0, Math.min(items.length - 1, idx));
      const newVal = items[clampedIdx];
      // Snap до округленої позиції (на випадок якщо браузер не зробив snap)
      const targetScroll = clampedIdx * ITEM_HEIGHT;
      if (Math.abs(ref.current.scrollTop - targetScroll) > 0.5) {
        scrollToIndex(clampedIdx);
      }
      if (newVal !== value) onChange?.(newVal);
    }, 80);
  };

  const handleItemClick = (idx) => {
    scrollToIndex(idx);
    const newVal = items[idx];
    if (newVal !== value) onChange?.(newVal);
  };

  return (
    <div
      className="ui-timepicker__wheel"
      role="listbox"
      aria-label={ariaLabel}
    >
      <div
        className="ui-timepicker__wheel-scroller"
        ref={ref}
        onScroll={handleScroll}
        tabIndex={0}
      >
        <div className="ui-timepicker__wheel-pad" />
        {items.map((item, i) => (
          <button
            type="button"
            key={item}
            role="option"
            className={
              'ui-timepicker__wheel-item' +
              (item === value ? ' ui-timepicker__wheel-item--selected' : '')
            }
            onClick={() => handleItemClick(i)}
            tabIndex={-1}
            aria-selected={item === value}
          >
            {pad2(item)}
          </button>
        ))}
        <div className="ui-timepicker__wheel-pad" />
      </div>
      <div className="ui-timepicker__wheel-center" aria-hidden="true" />
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────────────

export function TimePicker({
  value,
  onChange,
  label,
  placeholder = 'Оберіть час',
  error,
  hint,
  disabled = false,
  inline = false,
  minuteStep = 1,
  className,
  id,
}) {
  const [open, setOpen] = useState(inline);
  const wrapperRef = useRef(null);
  const buttonRef = useRef(null);

  const parsed = parseHHMM(value);
  const hour = parsed?.hour;
  const minute = parsed?.minute;

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = buildMinutes(minuteStep);

  // Якщо value не валідне і немає parsed — default до 09:00 (поширений час
  // судових засідань), але НЕ викликаємо onChange (адвокат не вибирав ще).
  const wheelHour = Number.isFinite(hour) ? hour : 9;
  const wheelMinute = Number.isFinite(minute) ? minute : 0;

  useEffect(() => {
    if (inline || !open) return undefined;
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
  }, [inline, open]);

  useEffect(() => {
    if (inline || !open) return undefined;
    const handler = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [inline, open]);

  const handleHourChange = (h) => {
    onChange?.(toHHMM(h, wheelMinute));
  };
  const handleMinuteChange = (m) => {
    onChange?.(toHHMM(wheelHour, m));
  };

  const cls = [
    'ui-timepicker',
    open && !inline && 'ui-timepicker--open',
    error && 'ui-timepicker--error',
    disabled && 'ui-timepicker--disabled',
    inline && 'ui-timepicker--inline',
    className,
  ].filter(Boolean).join(' ');

  const renderWheels = () => (
    <div className="ui-timepicker__wheels">
      <WheelColumn
        items={hours}
        value={wheelHour}
        onChange={handleHourChange}
        ariaLabel="Години"
      />
      <span className="ui-timepicker__colon" aria-hidden="true">:</span>
      <WheelColumn
        items={minutes}
        value={wheelMinute}
        onChange={handleMinuteChange}
        ariaLabel="Хвилини"
      />
    </div>
  );

  if (inline) {
    return (
      <div className={cls} ref={wrapperRef}>
        {label && <label className="ui-timepicker__label">{label}</label>}
        {renderWheels()}
        {error && <div className="ui-timepicker__error">{error}</div>}
        {!error && hint && <div className="ui-timepicker__hint">{hint}</div>}
      </div>
    );
  }

  return (
    <div className={cls} ref={wrapperRef}>
      {label && (
        <label
          className="ui-timepicker__label"
          htmlFor={id}
          onClick={() => buttonRef.current?.focus()}
        >
          {label}
        </label>
      )}
      <button
        ref={buttonRef}
        type="button"
        id={id}
        className="ui-timepicker__trigger"
        onClick={() => !disabled && setOpen((p) => !p)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span
          className={
            parsed
              ? 'ui-timepicker__trigger-value'
              : 'ui-timepicker__trigger-value ui-timepicker__trigger-value--placeholder'
          }
        >
          {parsed ? formatTimeDisplay(value) : placeholder}
        </span>
        <span className="ui-timepicker__trigger-icon" aria-hidden="true">🕒</span>
      </button>
      {open && (
        <div className="ui-timepicker__popover">
          {renderWheels()}
        </div>
      )}
      {error && <div className="ui-timepicker__error">{error}</div>}
      {!error && hint && <div className="ui-timepicker__hint">{hint}</div>}
    </div>
  );
}

export const __test__ = {
  ITEM_HEIGHT,
  VISIBLE_ITEMS,
  buildMinutes,
};
