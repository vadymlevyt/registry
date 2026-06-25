import { useEffect, useState } from 'react';
import { Modal, Button, Select, DatePicker } from '../UI';
import { CATEGORY_LABELS, AUTHOR_LABELS } from './labels.js';

// DocumentDetailsPanel — панель inline-правки метаданих ОДНОГО документа
// (A7.4, виняток (i)). Редагує три поля: date / author / category.
//
// Запис — НЕ локальний updateCase, а через `onSave(documentId, fields)`, який
// у CaseDossier маршрутизується в executeAction('dossier_agent','update_document')
// (R2: аудит/білінг/permission). Закрив без змін → нічого не пишеться.
//
// Контракт onSave: async (documentId, fields) => { success, error? }. fields
// містить ЛИШЕ змінені поля (порожньо → save взагалі не викликається).

// Порожнє значення Select/DatePicker ('' або undefined) і `null` у схемі —
// той самий сенс «не вказано»; нормалізуємо обидва в null для порівняння і запису.
function normValue(v) {
  return v === '' || v === undefined ? null : v;
}

// computeChangedFields — чисте ядро панелі (юніт-тестоване). Повертає об'єкт
// лише зі зміненими полями (значення вже нормалізовані в null для «не вказано»).
// Порожній об'єкт → правок немає → нічого не писати.
export function computeChangedFields(original, draft) {
  const orig = original || {};
  const changed = {};
  for (const key of ['date', 'author', 'category']) {
    const next = normValue(draft[key]);
    if (next !== normValue(orig[key])) changed[key] = next;
  }
  return changed;
}

const EMPTY_OPTION = { value: '', label: 'Не вказано' };

const AUTHOR_OPTIONS = [
  EMPTY_OPTION,
  ...Object.entries(AUTHOR_LABELS).map(([value, label]) => ({ value, label })),
];

const CATEGORY_OPTIONS = [
  EMPTY_OPTION,
  ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
];

export function DocumentDetailsPanel({ isOpen, document, onClose, onSave }) {
  const [date, setDate] = useState('');
  const [author, setAuthor] = useState('');
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);

  // Перезавантажуємо чернетку при відкритті / зміні документа.
  useEffect(() => {
    if (!isOpen || !document) return;
    setDate(document.date || '');
    setAuthor(document.author || '');
    setCategory(document.category || '');
    setSaving(false);
  }, [isOpen, document?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen || !document) return null;

  const changed = computeChangedFields(document, { date, author, category });
  const hasChanges = Object.keys(changed).length > 0;

  const handleSave = async () => {
    if (!hasChanges || saving) return;
    setSaving(true);
    try {
      const res = await onSave?.(document.id, changed);
      // На успіх — закриваємось; на помилку — лишаємось відкритими
      // (toast показує батько), щоб адвокат міг повторити.
      if (res?.success !== false) onClose?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Деталі документа"
      size="sm"
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Скасувати
          </Button>
          <Button onClick={handleSave} disabled={!hasChanges || saving}>
            {saving ? 'Збереження…' : 'Зберегти'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <DatePicker
          label="Дата документа"
          value={date}
          onChange={setDate}
          placeholder="Без дати"
        />
        <Select
          label="Автор"
          value={author}
          onChange={setAuthor}
          options={AUTHOR_OPTIONS}
        />
        <Select
          label="Категорія"
          value={category}
          onChange={setCategory}
          options={CATEGORY_OPTIONS}
        />
      </div>
    </Modal>
  );
}
