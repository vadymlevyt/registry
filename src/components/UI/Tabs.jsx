import './Tabs.css';

/**
 * Tabs — горизонтальні вкладки.
 *
 * Контрольований компонент: батько передає activeId і onChange.
 *
 * Props:
 *   tabs: [{ id, label, icon?, badge?, disabled? }]
 *     id: унікальний ідентифікатор
 *     label: текст вкладки
 *     icon: ReactNode (опційно)
 *     badge: string | number (опційно — наприклад "(24)" або "⚠ 3")
 *     disabled: boolean
 *   activeId: string                  — id активної вкладки
 *   onChange: (newId: string) => void
 *   variant: 'default' | 'pills'      — default: підкреслення; pills: pill-стиль
 *   fullWidth: boolean                — заповнити контейнер на повну ширину
 */
export function Tabs({
  tabs = [],
  activeId,
  onChange,
  variant = 'default',
  fullWidth = false,
  className,
  ...rest
}) {
  const cls = [
    'ui-tabs',
    `ui-tabs--${variant}`,
    fullWidth && 'ui-tabs--full',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={cls} role="tablist" {...rest}>
      {tabs.map((tab) => {
        const tabCls = [
          'ui-tabs__tab',
          tab.id === activeId && 'ui-tabs__tab--active',
          tab.disabled && 'ui-tabs__tab--disabled',
        ].filter(Boolean).join(' ');

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === activeId}
            className={tabCls}
            disabled={tab.disabled}
            onClick={() => !tab.disabled && onChange?.(tab.id)}
          >
            {tab.icon && <span className="ui-tabs__icon">{tab.icon}</span>}
            <span className="ui-tabs__label">{tab.label}</span>
            {tab.badge != null && (
              <span className="ui-tabs__badge">{tab.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
