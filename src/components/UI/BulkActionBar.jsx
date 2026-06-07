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
 *   children                 — кнопки дій (контейнер завжди в DOM для
 *                              стабільної висоти бара; ховається через
 *                              visibility:hidden коли selectedCount === 0)
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
      {/* Контейнер дій завжди в DOM — резервує висоту бара. Коли нічого не
          виділено: visibility:hidden + pointer-events:none ховає кнопки і
          виводить їх з focus/AT, але layout не змінюється. Без цього
          умовний рендер міняв висоту бара між 0↔>0 (на mobile actions
          переносяться на другий рядок через width:100%), список нижче
          (flex:1) перераховував висоту, і webkit на планшеті глючив
          reflow — список схлопувався до видимого remount'у вкладки. */}
      <div
        className={`bulk-action-bar__actions${selectedCount === 0 ? ' bulk-action-bar__actions--empty' : ''}`}
        aria-hidden={selectedCount === 0}
      >
        {children}
      </div>
    </div>
  );
}
