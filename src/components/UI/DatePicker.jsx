import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './DatePicker.css';

// ── DatePicker ───────────────────────────────────────────────────────────────
// Фірмовий picker дати. Замінює <input type="date"> щоб уніфікувати вигляд
// між iOS / Android / Windows (де нативні пікери виглядають геть по-різному).
//
// Контракт:
//   value:    'YYYY-MM-DD' | '' — ISO формат (той самий що нативний input
//             повертав, отже зміни у решті коду мінімальні).
//   onChange: (iso: string) => void
//   label, placeholder, error, hint, disabled — як у <Input>
//   minDate / maxDate: 'YYYY-MM-DD' — опційні межі (дні поза межами
//             блокуються, прев/нект місяці теж).
//   inline:   true → render календаря inline без кнопки/попапу
//             (для DateTimePicker де календар завжди видимий).
//   autoCloseOnSelect: default true — після вибору дня попап закривається.
//
// Внутрішні стани:
//   open:      visibility попапа
//   viewYear / viewMonth:  поточно показаний місяць у календарі (можна
//             перегортати незалежно від value)
//   mode:     'days' | 'months' | 'years' — три екрани навігації
//
// Чому власна реалізація без бібліотеки: всі open-source picker'и (react-day
// picker, react-datepicker) тягнуть 30-100KB + локалізацію, і ще їх стиль
// довелось би переписувати через CSS overrides. Наш case простий — 4 функції
// генерації, 200 рядків CSS на токенах, повний контроль і нуль deps.
//
// Локаль: тільки українська (повний `intl.DateTimeFormat('uk-UA')` для назв
// місяців/днів — стандартна Intl без зовнішніх бібліотек).

const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
const MONTH_NAMES = [
  'Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
  'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень',
];
const MONTH_NAMES_SHORT = [
  'Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер',
  'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру',
];

// ── Format / parse helpers ──────────────────────────────────────────────────

const pad2 = (n) => String(n).padStart(2, '0');

export function toISODate(year, month0, day) {
  if (!Number.isFinite(year) || !Number.isFinite(month0) || !Number.isFinite(day)) return '';
  return `${year}-${pad2(month0 + 1)}-${pad2(day)}`;
}

export function parseISODate(iso) {
  if (typeof iso !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const d = new Date(year, month, day);
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
  return { year, month, day, date: d };
}

export function formatDateDisplay(iso) {
  const parsed = parseISODate(iso);
  if (!parsed) return '';
  return `${pad2(parsed.day)}.${pad2(parsed.month + 1)}.${parsed.year}`;
}

// Будує 42 клітинки (6 тижнів × 7 днів) для місяця. Перший день тижня —
// понеділок (юридична культура UA — наш стандарт). Прев/нект місяць
// заповнює крайові клітинки і помічений isOtherMonth: true.
export function buildCalendarGrid(viewYear, viewMonth) {
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  // JS getDay: 0=Sun, 1=Mon, ..., 6=Sat. Зміщуємо щоб 0=Mon.
  const weekdayOfFirst = (firstOfMonth.getDay() + 6) % 7;
  const startDate = new Date(viewYear, viewMonth, 1 - weekdayOfFirst);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
    cells.push({
      year: d.getFullYear(),
      month: d.getMonth(),
      day: d.getDate(),
      iso: toISODate(d.getFullYear(), d.getMonth(), d.getDate()),
      isOtherMonth: d.getMonth() !== viewMonth || d.getFullYear() !== viewYear,
    });
  }
  return cells;
}

function todayISO() {
  const d = new Date();
  return toISODate(d.getFullYear(), d.getMonth(), d.getDate());
}

function clampInRange(iso, minISO, maxISO) {
  if (minISO && iso < minISO) return false;
  if (maxISO && iso > maxISO) return false;
  return true;
}

// ── Component ───────────────────────────────────────────────────────────────

export function DatePicker({
  value,
  onChange,
  label,
  placeholder = 'Оберіть дату',
  error,
  hint,
  disabled = false,
  minDate,
  maxDate,
  inline = false,
  autoCloseOnSelect = true,
  className,
  id,
}) {
  const [open, setOpen] = useState(inline);
  const parsedValue = parseISODate(value);
  const today = useMemo(() => todayISO(), []);
  const initialView = parsedValue || parseISODate(today) || { year: new Date().getFullYear(), month: new Date().getMonth() };
  const [viewYear, setViewYear] = useState(initialView.year);
  const [viewMonth, setViewMonth] = useState(initialView.month);
  const [mode, setMode] = useState('days');

  const wrapperRef = useRef(null);
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);

  // Position popoveру у viewport coords коли він рендериться через портал.
  // Раніше попап був position:absolute усередині wrapper'а, тому коли DatePicker
  // знаходився всередині Modal (.ui-modal має overflow:hidden + max-height:90vh),
  // календар обрізався. Тепер портал прокидує попап у document.body і
  // position:fixed з обчисленими bounds — обмежень contining block немає,
  // календар видно повністю незалежно від батьківського overflow.
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (inline || !open || !buttonRef.current) return undefined;
    const updatePos = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (!r) return;
      // За замовчуванням попап під кнопкою. Якщо не вистачає місця знизу
      // (calendar ~360px), показуємо над кнопкою.
      const popoverH = popoverRef.current?.offsetHeight || 360;
      const popoverW = popoverRef.current?.offsetWidth || 300;
      const margin = 8;
      let top = r.bottom + margin;
      if (top + popoverH > window.innerHeight - margin) {
        // Не влазить знизу — пробуємо зверху
        const topAbove = r.top - margin - popoverH;
        top = topAbove >= margin ? topAbove : Math.max(margin, window.innerHeight - popoverH - margin);
      }
      let left = r.left;
      if (left + popoverW > window.innerWidth - margin) {
        left = Math.max(margin, window.innerWidth - popoverW - margin);
      }
      setPopoverPos({ top, left });
    };
    updatePos();
    // Перепозиціонуємо на scroll/resize — Modal scrolling, viewport resize.
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open, inline, mode]);

  // Якщо value змінюється ззовні — підлаштуємо view (щоб після перевідкриття
  // календар показував місяць обраної дати, а не куди адвокат до того клікнув).
  useEffect(() => {
    if (!parsedValue) return;
    setViewYear(parsedValue.year);
    setViewMonth(parsedValue.month);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // Закриваємо попап при кліку поза ним. popoverRef перевіряється окремо бо
  // після порталізації popover не належить до wrapperRef піддерева.
  useEffect(() => {
    if (inline || !open) return undefined;
    const handler = (e) => {
      const wr = wrapperRef.current;
      const pop = popoverRef.current;
      if (wr && wr.contains(e.target)) return;
      if (pop && pop.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [inline, open]);

  // ESC закриває попап
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

  const goToPrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };
  const goToNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleSelectDay = (cell) => {
    if (disabled) return;
    if (!clampInRange(cell.iso, minDate, maxDate)) return;
    onChange?.(cell.iso);
    if (cell.isOtherMonth) {
      setViewYear(cell.year);
      setViewMonth(cell.month);
    }
    if (!inline && autoCloseOnSelect) {
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  const handleSelectMonth = (m) => {
    setViewMonth(m);
    setMode('days');
  };

  const handleSelectYear = (y) => {
    setViewYear(y);
    setMode('months');
  };

  const handleToday = () => {
    const parsed = parseISODate(today);
    setViewYear(parsed.year);
    setViewMonth(parsed.month);
    if (clampInRange(today, minDate, maxDate)) {
      onChange?.(today);
      if (!inline && autoCloseOnSelect) {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
  };

  const handleClear = () => {
    onChange?.('');
    if (!inline && autoCloseOnSelect) {
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  const cells = useMemo(() => buildCalendarGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  const cls = [
    'ui-datepicker',
    open && !inline && 'ui-datepicker--open',
    error && 'ui-datepicker--error',
    disabled && 'ui-datepicker--disabled',
    inline && 'ui-datepicker--inline',
    className,
  ].filter(Boolean).join(' ');

  const renderCalendar = () => (
    <div className="ui-datepicker__calendar" role="dialog" aria-label="Календар">
      <div className="ui-datepicker__cal-header">
        <button
          type="button"
          className="ui-datepicker__nav"
          onClick={mode === 'years' ? () => setViewYear((y) => y - 12) : goToPrevMonth}
          aria-label="Попередній період"
          disabled={mode === 'months'}
        >‹</button>
        <button
          type="button"
          className="ui-datepicker__cal-title"
          onClick={() => setMode((m) => (m === 'days' ? 'months' : m === 'months' ? 'years' : 'days'))}
          aria-label="Перемкнути режим перегляду"
        >
          {mode === 'days' && (
            <>
              <span className="ui-datepicker__cal-title-month">{MONTH_NAMES[viewMonth]}</span>
              <span className="ui-datepicker__cal-title-year">{viewYear}</span>
            </>
          )}
          {mode === 'months' && <span>{viewYear}</span>}
          {mode === 'years' && (
            <span>
              {viewYear - 6} — {viewYear + 5}
            </span>
          )}
        </button>
        <button
          type="button"
          className="ui-datepicker__nav"
          onClick={mode === 'years' ? () => setViewYear((y) => y + 12) : goToNextMonth}
          aria-label="Наступний період"
          disabled={mode === 'months'}
        >›</button>
      </div>

      {mode === 'days' && (
        <>
          <div className="ui-datepicker__weekdays">
            {WEEKDAYS_SHORT.map((w, i) => (
              <div
                key={w}
                className={
                  'ui-datepicker__weekday' +
                  (i >= 5 ? ' ui-datepicker__weekday--weekend' : '')
                }
              >
                {w}
              </div>
            ))}
          </div>
          <div className="ui-datepicker__days">
            {cells.map((cell, i) => {
              const inRange = clampInRange(cell.iso, minDate, maxDate);
              const isToday = cell.iso === today;
              const isSelected = parsedValue && cell.iso === value;
              const isWeekend = i % 7 >= 5;
              const dayCls = [
                'ui-datepicker__day',
                cell.isOtherMonth && 'ui-datepicker__day--other',
                isToday && 'ui-datepicker__day--today',
                isSelected && 'ui-datepicker__day--selected',
                isWeekend && 'ui-datepicker__day--weekend',
                !inRange && 'ui-datepicker__day--disabled',
              ].filter(Boolean).join(' ');
              return (
                <button
                  type="button"
                  key={cell.iso}
                  className={dayCls}
                  onClick={() => handleSelectDay(cell)}
                  disabled={!inRange}
                  aria-pressed={isSelected || undefined}
                  aria-label={`${cell.day} ${MONTH_NAMES[cell.month]} ${cell.year}`}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>
        </>
      )}

      {mode === 'months' && (
        <div className="ui-datepicker__months">
          {MONTH_NAMES_SHORT.map((mName, m) => (
            <button
              type="button"
              key={mName}
              className={
                'ui-datepicker__month-cell' +
                (m === viewMonth ? ' ui-datepicker__month-cell--selected' : '')
              }
              onClick={() => handleSelectMonth(m)}
            >
              {mName}
            </button>
          ))}
        </div>
      )}

      {mode === 'years' && (
        <div className="ui-datepicker__years">
          {Array.from({ length: 12 }, (_, i) => viewYear - 6 + i).map((y) => (
            <button
              type="button"
              key={y}
              className={
                'ui-datepicker__year-cell' +
                (y === viewYear ? ' ui-datepicker__year-cell--selected' : '')
              }
              onClick={() => handleSelectYear(y)}
            >
              {y}
            </button>
          ))}
        </div>
      )}

      <div className="ui-datepicker__cal-footer">
        <button
          type="button"
          className="ui-datepicker__footer-btn"
          onClick={handleToday}
        >
          Сьогодні
        </button>
        {parsedValue && (
          <button
            type="button"
            className="ui-datepicker__footer-btn"
            onClick={handleClear}
          >
            Очистити
          </button>
        )}
      </div>
    </div>
  );

  if (inline) {
    return (
      <div className={cls} ref={wrapperRef}>
        {label && <label className="ui-datepicker__label">{label}</label>}
        {renderCalendar()}
        {error && <div className="ui-datepicker__error">{error}</div>}
        {!error && hint && <div className="ui-datepicker__hint">{hint}</div>}
      </div>
    );
  }

  return (
    <div className={cls} ref={wrapperRef}>
      {label && (
        <label
          className="ui-datepicker__label"
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
        className="ui-datepicker__trigger"
        onClick={() => !disabled && setOpen((p) => !p)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span
          className={
            parsedValue
              ? 'ui-datepicker__trigger-value'
              : 'ui-datepicker__trigger-value ui-datepicker__trigger-value--placeholder'
          }
        >
          {parsedValue ? formatDateDisplay(value) : placeholder}
        </span>
        <span className="ui-datepicker__trigger-icon" aria-hidden="true">📅</span>
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          className="ui-datepicker__popover ui-datepicker__popover--portaled"
          style={{ top: popoverPos.top, left: popoverPos.left }}
        >
          {renderCalendar()}
        </div>,
        document.body
      )}
      {error && <div className="ui-datepicker__error">{error}</div>}
      {!error && hint && <div className="ui-datepicker__hint">{hint}</div>}
    </div>
  );
}

// Експорт хелперів для DateTimePicker і тестів.
export const __test__ = {
  WEEKDAYS_SHORT,
  MONTH_NAMES,
  todayISO,
};
