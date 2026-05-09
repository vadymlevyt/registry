import { useEffect, useState } from 'react';
import { Archive, Trash2 } from 'lucide-react';
import { Modal, Button } from '../UI';
import { ICON_SIZE } from '../UI/icons.js';
import './DeleteDocumentModal.css';

/**
 * DeleteDocumentModal — модалка видалення документа з двома режимами.
 *
 * Архівувати (default, найменш руйнівне):
 *   document.status = 'archived'
 *   файли на Drive лишаються, можна відновити
 *
 * Видалити повністю:
 *   запис з cases[].documents видаляється
 *   файл з 01_ОРИГІНАЛИ і 02_ОБРОБЛЕНІ видаляються
 *   після цього відновлення неможливе
 *
 * Третій режим (registry_only) свідомо не показуємо в UI — плутає адвоката.
 *
 * Props:
 *   isOpen, onClose
 *   document — об'єкт документа (потрібен name)
 *   onConfirm(mode: 'archive'|'full') — викликається при підтвердженні
 */
export function DeleteDocumentModal({ isOpen, onClose, document, onConfirm }) {
  const [mode, setMode] = useState('archive');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMode('archive');
      setBusy(false);
    }
  }, [isOpen]);

  if (!document) return null;

  const handleSubmit = async () => {
    setBusy(true);
    try {
      await onConfirm(mode);
      onClose();
    } catch (err) {
      console.error('[DeleteDocumentModal] confirm failed:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Видалити документ"
      size="md"
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Скасувати
          </Button>
          <Button
            variant={mode === 'full' ? 'danger' : 'primary'}
            onClick={handleSubmit}
            disabled={busy}
          >
            {busy
              ? 'Виконуємо...'
              : mode === 'full'
                ? 'Видалити повністю'
                : 'Архівувати'}
          </Button>
        </>
      }
    >
      <p className="delete-document-modal__intro">
        Документ <strong>«{document.name}»</strong>
      </p>

      <div className="delete-document-modal__options">
        <DeleteOption
          mode="archive"
          selected={mode === 'archive'}
          onSelect={() => setMode('archive')}
          icon={<Archive size={ICON_SIZE.md} />}
          title="Архівувати документ"
          description="Документ зникне зі списку матеріалів справи, але залишиться у режимі «Архів». Файл на Drive не зачепиться. Можна відновити будь-коли."
          variant="info"
        />

        <DeleteOption
          mode="full"
          selected={mode === 'full'}
          onSelect={() => setMode('full')}
          icon={<Trash2 size={ICON_SIZE.md} />}
          title="Видалити повністю"
          description="Документ зникне зі списку справи І сам файл буде видалено з Drive. Після цього відновити документ неможливо."
          variant="danger"
        />
      </div>
    </Modal>
  );
}

function DeleteOption({ selected, onSelect, icon, title, description, variant }) {
  return (
    <button
      type="button"
      className={[
        'delete-option',
        `delete-option--${variant}`,
        selected && 'delete-option--selected',
      ].filter(Boolean).join(' ')}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="delete-option__icon">{icon}</span>
      <span className="delete-option__content">
        <span className="delete-option__title">{title}</span>
        <span className="delete-option__description">{description}</span>
      </span>
      <span className="delete-option__radio" aria-hidden="true">
        {selected ? <span className="delete-option__radio-dot" /> : null}
      </span>
    </button>
  );
}
