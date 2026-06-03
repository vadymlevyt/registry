import { Sparkles } from 'lucide-react';
import { ICON_SIZE } from '../UI/icons.js';
import './ScanTextToggle.css';

/**
 * Перемикач режимів перегляду документа (V2-B). Замінює перехідний
 * Скан/Точний/Текст явним набором режимів за типом документа:
 *   scanned    → [ Скан ] [ Точний ] [ Чистий ✨ ] [ Конспект ✨ ]
 *   searchable → [ Документ ] [ Конспект ✨ ]
 *
 * Таб «Текст» прибрано — його поведінки розкладені на явні режими
 * (дайджест → Конспект; сире/механічне → Точний/Скан).
 *
 * Props:
 *   tabs     — масив { value, label, icon, ai?, badge?, ready? }. Набір
 *              визначає DocumentViewer за documentNature + наявністю layout
 *              (Точний) + document.variants (Чистий/Конспект готовність).
 *   mode     — активний value.
 *   onChange — (value) => void. Перемикання ЗАВЖДИ безпечне/безкоштовне — клік
 *              по незгенерованому AI-табі лише показує заглушку, AI НЕ стартує
 *              (генерація — окремою кнопкою у тілі, V2-B.2).
 *
 * ✨ (Sparkles) — маркер AI-режиму (Чистий/Конспект). badge («переказ») —
 * коротка позначка «не дослівно» на Конспекті.
 */
export function ScanTextToggle({ tabs = [], mode, onChange }) {
  return (
    <div className="scan-text-toggle" role="tablist" aria-label="Режим перегляду">
      {tabs.map(tab => {
        const Icon = tab.icon;
        const isActive = mode === tab.value;
        const ungenerated = tab.ai && !tab.ready;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={[
              'scan-text-toggle__option',
              isActive ? 'is-active' : '',
              ungenerated ? 'scan-text-toggle__option--ungenerated' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => onChange(tab.value)}
          >
            {Icon ? <Icon size={ICON_SIZE.sm} /> : null}
            <span>{tab.label}</span>
            {tab.ai && (
              <Sparkles
                size={ICON_SIZE.xs}
                className="scan-text-toggle__ai-mark"
                aria-hidden="true"
              />
            )}
            {tab.badge && (
              <span className="scan-text-toggle__badge">{tab.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
