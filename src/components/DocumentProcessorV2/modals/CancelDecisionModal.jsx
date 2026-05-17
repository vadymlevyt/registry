// DP-4 · Скасування з вибором: «зберегти N готових / видалити все».
// Логіка keepPartial/discardAll готова у streamingExecutor (DP-3); тут лише UI.
import { Modal, Button } from '../../UI';

export function CancelDecisionModal({ isOpen, readyCount, onKeep, onDiscard, onClose }) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Обробку скасовано"
      size="sm"
      closeOnBackdrop={false}
    >
      <div className="dpv2-modal-text">
        Готових документів: {readyCount}. Зберегти їх чи видалити все?
      </div>
      <div className="dpv2-modal-stack">
        <Button variant="primary" onClick={onKeep}>
          Зберегти {readyCount} готових
        </Button>
        <Button variant="danger" onClick={onDiscard}>
          Видалити все
        </Button>
      </div>
    </Modal>
  );
}
