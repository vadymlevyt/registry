import { useState } from 'react';
import './InlineEditableText.css';

/**
 * InlineEditableText — текст, що редагується на місці (TASK represented_parties).
 *
 * Поведінка: клік по тексту (або іконці ✎) → input з курсором →
 * Enter або blur зберігає, Esc скасовує без збереження.
 *
 * Props:
 *   value       — поточне значення (string | null)
 *   onSave      — (newValue: string) => void; викликається ТІЛЬКИ якщо
 *                 значення реально змінилось
 *   placeholder — текст коли value порожнє (default '—')
 *   allowEmpty  — чи дозволено зберегти порожній рядок (default true;
 *                 false — порожній draft скасовує редагування, як Esc)
 *   ariaLabel   — підпис поля для доступності/тестів
 *   className   — додатковий клас на контейнер (успадкування типографіки)
 */
export function InlineEditableText({
  value,
  onSave,
  placeholder = '—',
  allowEmpty = true,
  ariaLabel,
  className,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const startEdit = () => {
    setDraft(value || '');
    setEditing(true);
  };

  const commit = () => {
    if (!editing) return;
    setEditing(false);
    const next = draft.trim();
    if (!next && !allowEmpty) return;       // порожнє заборонено → як Esc
    if (next === (value || '')) return;      // без змін — не зберігаємо
    onSave?.(next);
  };

  const cancel = () => setEditing(false);

  if (editing) {
    return (
      <input
        className={['ui-inline-edit__input', className].filter(Boolean).join(' ')}
        aria-label={ariaLabel}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <span
      className={['ui-inline-edit', className].filter(Boolean).join(' ')}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      title="Натисніть, щоб редагувати"
      onClick={(e) => { e.stopPropagation(); startEdit(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); startEdit(); } }}
    >
      <span className={value ? undefined : 'ui-inline-edit__placeholder'}>
        {value || placeholder}
      </span>
      <span className="ui-inline-edit__pen" aria-hidden="true">{'✎'}</span>
    </span>
  );
}
