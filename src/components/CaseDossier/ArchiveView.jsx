import { ArrowLeft, ArchiveRestore, Trash2 } from 'lucide-react';
import { Button, Checkbox, BulkActionBar, useSelection } from '../UI';
import { ICON_SIZE } from '../UI/icons.js';
import './ArchiveView.css';

/**
 * ArchiveView — режим архіву матеріалів справи.
 *
 * Показується замість стандартного списку коли showArchived=true. Архівні
 * картки НЕ відкриваються у Viewer'і — для перегляду спочатку треба
 * відновити документ. Це свідоме розмежування: Viewer працює з активними
 * документами, Архів — окремий простір для управління архівом.
 *
 * Мультивибір — через СПІЛЬНІ useSelection + BulkActionBar (TASK
 * bulk_delete_unify): ті самі хук і панель, що в Реєстрі. Верхніх кнопок
 * «Відновити всі»/«Видалити всі» більше немає — select-all + батч-бар їх
 * повністю замінюють.
 *
 * Дві категорії дій:
 *   - над одним документом: «Відновити» / «Видалити» (на картці)
 *   - над виділеними: «Відновити обрані» / «Видалити обрані» (батч-бар)
 *
 * onRestoreSelected(ids) / onDeleteSelected(ids) отримують масив id вибору.
 */
export function ArchiveView({
  archived,
  onExit,
  onRestoreOne,
  onRestoreSelected,
  onDeleteOne,
  onDeleteSelected,
}) {
  const total = archived.length;
  const allIds = archived.map((d) => d.id);
  const sel = useSelection(allIds);

  return (
    <div className="archive-view">
      <div className="archive-view__header">
        <button
          type="button"
          className="archive-view__back"
          onClick={onExit}
          aria-label="Повернутись до матеріалів"
        >
          <ArrowLeft size={ICON_SIZE.sm} />
          <span>Повернутись до матеріалів</span>
        </button>
      </div>

      {total === 0 ? (
        <div className="archive-view__empty">
          <Archive />
          <p>Архів порожній</p>
        </div>
      ) : (
        <>
          <BulkActionBar
            total={total}
            selectedCount={sel.count}
            allSelected={sel.allSelected}
            someSelected={sel.someSelected}
            onToggleSelectAll={(checked) => (checked ? sel.selectAll() : sel.clear())}
          >
            <Button
              variant="primary"
              size="sm"
              icon={<ArchiveRestore size={ICON_SIZE.sm} />}
              onClick={() => onRestoreSelected(Array.from(sel.selectedIds))}
            >
              Відновити обрані ({sel.count})
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 size={ICON_SIZE.sm} />}
              onClick={() => onDeleteSelected(Array.from(sel.selectedIds))}
            >
              Видалити обрані ({sel.count})
            </Button>
          </BulkActionBar>

          <div className="archive-view__list">
            {archived.map((doc) => (
              <ArchiveCard
                key={doc.id}
                document={doc}
                selected={sel.isSelected(doc.id)}
                onToggleSelected={(value) => sel.toggle(doc.id, value)}
                onRestore={() => onRestoreOne(doc)}
                onDelete={() => onDeleteOne(doc)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ArchiveCard({ document, selected, onToggleSelected, onRestore, onDelete }) {
  return (
    <div className={`archive-card ${selected ? 'archive-card--selected' : ''}`}>
      <Checkbox checked={selected} onChange={onToggleSelected} />
      <div className="archive-card__content">
        <div className="archive-card__icon">{document.icon || '📄'}</div>
        <div className="archive-card__main">
          <div className="archive-card__name">{document.name}</div>
          <div className="archive-card__meta">
            {document.date ? <span>{document.date}</span> : null}
            <span className="archive-card__badge">архівний</span>
          </div>
        </div>
      </div>
      <div className="archive-card__actions">
        <Button
          variant="secondary"
          size="sm"
          icon={<ArchiveRestore size={ICON_SIZE.sm} />}
          onClick={onRestore}
        >
          Відновити
        </Button>
        <button
          type="button"
          className="archive-card__delete"
          onClick={onDelete}
          aria-label="Видалити повністю"
        >
          <Trash2 size={ICON_SIZE.sm} />
        </button>
      </div>
    </div>
  );
}

function Archive() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="2" y="4" width="20" height="5" rx="1" />
      <path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" />
      <path d="M10 13h4" />
    </svg>
  );
}
