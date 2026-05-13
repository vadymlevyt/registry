import { useEffect, useState } from 'react';
import { DatePicker, parseISODate, formatDateDisplay } from './DatePicker.jsx';
import { TimePicker, parseHHMM, formatTimeDisplay } from './TimePicker.jsx';
import { Modal } from './Modal.jsx';
import { Button } from './Button.jsx';
import './DateTimePicker.css';

// ── DateTimePicker ───────────────────────────────────────────────────────────
// Об'єднаний modal-picker для випадків де ОБОВ'ЯЗКОВО потрібні і дата, і час
// разом (передусім — створення засідань: без часу засідання нема сенсу).
//
// Контракт (controlled):
//   isOpen: boolean
//   onClose: () => void                       — Скасувати / клік на backdrop
//   onSave: ({ date, time }) => void          — Зберегти (обидва обов'язкові)
//   initialDate?: 'YYYY-MM-DD'                — стартове значення (опційно)
//   initialTime?: 'HH:MM'                     — стартове значення (опційно)
//   title: string                             — заголовок модалки
//   saveLabel?: 'Зберегти'                    — текст кнопки
//   minuteStep?: 1                            — крок хвилин (передається у TimePicker)
//
// Чому одна модалка для дати+часу: раніше у CaseDossier для нового засідання
// викликались ДВІ послідовні системні модалки (systemPrompt для дати, потім
// для часу з підписом «можна не додавати»). Це ламало UX (дві модалки одна
// за одною) і дозволяло створити засідання без часу — попри те що адвокат
// мусить знати точний час щоб з'явитись у суді. Тут об'єднано: одна модалка,
// дата і час обидва обов'язкові, кнопка Зберегти disabled поки не заповнено.

export function DateTimePicker({
  isOpen,
  onClose,
  onSave,
  initialDate = '',
  initialTime = '',
  title = 'Оберіть дату і час',
  saveLabel = 'Зберегти',
  cancelLabel = 'Скасувати',
  minuteStep = 1,
}) {
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);

  // Скидаємо local state коли модалка відкривається з новими initial values.
  // Без цього перевідкриття залишило б старі значення з попередньої сесії.
  useEffect(() => {
    if (isOpen) {
      setDate(initialDate || '');
      setTime(initialTime || '');
    }
  }, [isOpen, initialDate, initialTime]);

  const dateValid = !!parseISODate(date);
  const timeValid = !!parseHHMM(time);
  const canSave = dateValid && timeValid;

  const handleSave = () => {
    if (!canSave) return;
    onSave?.({ date, time });
  };

  const summary = canSave
    ? `${formatDateDisplay(date)} · ${formatTimeDisplay(time)}`
    : (dateValid ? formatDateDisplay(date) : 'Дата не обрана') +
      ' · ' +
      (timeValid ? formatTimeDisplay(time) : 'час не обрано');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="md"
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={!canSave}>
            {saveLabel}
          </Button>
        </>
      }
    >
      <div className="ui-datetimepicker">
        <div
          className={
            'ui-datetimepicker__summary' +
            (canSave ? ' ui-datetimepicker__summary--complete' : '')
          }
          aria-live="polite"
        >
          {summary}
        </div>
        <div className="ui-datetimepicker__panes">
          <div className="ui-datetimepicker__pane ui-datetimepicker__pane--date">
            <DatePicker
              value={date}
              onChange={setDate}
              inline
              label="Дата"
            />
          </div>
          <div className="ui-datetimepicker__pane ui-datetimepicker__pane--time">
            <TimePicker
              value={time}
              onChange={setTime}
              inline
              minuteStep={minuteStep}
              label="Час"
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
