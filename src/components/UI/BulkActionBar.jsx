import { Checkbox } from './Checkbox.jsx';
import './BulkActionBar.css';

/**
 * BulkActionBar — спільна презентаційна панель масових дій.
 *
 * Один стиль і одна структура для всіх місць з мультивибором (Архів, Реєстр —
 * TASK bulk_delete_unify). Ядро не дублюється: кнопки дій передаються зовні
 * через `children` (архів кладе «Відновити/Видалити обрані», реєстр —
 * «Архівувати/Видалити обрані повністю»).
 *
 * Тільки дизайн-токени (--color-*, --space-*, --radius-*), жодних hex.
 *
 * Props:
 *   total: number            — скільки всього елементів у списку
 *   selectedCount: number    — скільки обрано
 *   allSelected: boolean     — усі обрані (checked)
 *   someSelected: boolean    — обрана частина (indeterminate)
 *   onToggleSelectAll: (checked:boolean) => void
 *   children                 — кнопки дій (показуються коли selectedCount > 0)
 */
export function BulkActionBar({
  total,
  selectedCount,
  allSelected,
  someSelected,
  onToggleSelectAll,
  children,
}) {
  return (
    <div className="bulk-action-bar" role="toolbar">
      <Checkbox
        checked={allSelected}
        indeterminate={someSelected}
        onChange={onToggleSelectAll}
        label={`Виділено: ${selectedCount} з ${total}`}
      />
      {selectedCount > 0 && (
        <div className="bulk-action-bar__actions">{children}</div>
      )}
    </div>
  );
}
