// DP-4 · Модалка вибору коли в 00_INBOX вже є файли а адвокат додає нові
// (мокап Зона 1). Фірмова Modal, НЕ window.confirm.
import { Modal, Button } from '../../UI';

export function InboxConflictModal({ isOpen, inboxCount, newCount, onResolve, onClose }) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="В INBOX уже є файли"
      size="sm"
    >
      <div className="dpv2-modal-text">
        У 00_INBOX уже {inboxCount} файл(ів), ви додаєте ще {newCount}. Як обробити?
      </div>
      <div className="dpv2-modal-stack">
        <Button variant="primary" onClick={() => onResolve('all')}>
          Додати до існуючих, обробити все разом
        </Button>
        <Button variant="secondary" onClick={() => onResolve('new_only')}>
          Обробити тільки нові, файли в INBOX залишити
        </Button>
        <Button variant="ghost" onClick={() => onResolve('later')}>
          Просто залишити в INBOX, повернутись пізніше
        </Button>
      </div>
    </Modal>
  );
}
