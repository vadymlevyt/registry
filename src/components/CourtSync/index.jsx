// ── COURT SYNC MODULE ────────────────────────────────────────────────────────
// Модуль «Електронний суд». TASK 0.2 — інфраструктурний скелет.
//
// Структура:
//   • ЄСІТС — видима всім (4 підвкладки: Огляд / Журнал / Налаштування / Розбіжності)
//   • Розвідник — видима тільки коли isCurrentUserFounder() === true
//
// Всі підвкладки — заглушки з текстом «У розробці». Реальна логіка з'явиться
// у наступних TASK (ЄСІТС RPA інтеграція, Document Processor v2 для inbox тощо).
//
// Дизайн — тільки існуючі design-токени з styles/tokens.css. Жодних власних
// стилів окрім layout-розкладки (flex). Іконки — з lucide-react через
// components/UI/icons.js (стандарт проекту).

import React, { useState } from 'react';
import { Scale, Search } from 'lucide-react';
import { ICON_SIZE } from '../UI/icons.js';
import { isCurrentUserFounder } from '../../services/tenantService.js';
import Reconnaissance from './Reconnaissance/index.jsx';

// ── Підвкладки ───────────────────────────────────────────────────────────────

const ECITS_SUBTABS = [
  { id: 'overview',     label: 'Огляд' },
  { id: 'log',          label: 'Журнал' },
  { id: 'settings',     label: 'Налаштування' },
  { id: 'discrepancies', label: 'Розбіжності' },
];

const SCOUT_SUBTABS = [
  { id: 'reconnaissance', label: 'Розвідка ЄСІТС' },
];

// ── Заглушка вмісту ──────────────────────────────────────────────────────────

function PlaceholderPanel({ title, hint }) {
  return (
    <div className="empty">
      <div className="empty-text" style={{ fontWeight: 600, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--color-text-3)' }}>{hint}</div>
    </div>
  );
}

// ── Кнопка підвкладки ────────────────────────────────────────────────────────
// Layout-only inline styles, кольори — з design tokens.

function SubtabButton({ active, onClick, icon: Icon, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 14px',
        border: 'none',
        background: 'none',
        color: active ? 'var(--color-text)' : 'var(--color-text-2)',
        cursor: 'pointer',
        fontSize: 12,
        borderBottom: `2px solid ${active ? 'var(--color-text-2)' : 'transparent'}`,
        fontWeight: active ? 500 : 400,
        whiteSpace: 'nowrap',
        transition: 'all 0.15s',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {Icon && <Icon size={ICON_SIZE.sm} />}
      <span>{children}</span>
    </button>
  );
}

// ── Головний компонент ───────────────────────────────────────────────────────

export default function CourtSync() {
  const founder = isCurrentUserFounder();
  // Вкладки верхнього рівня модуля: 'ecits' завжди, 'scout' тільки для засновника.
  const [section, setSection] = useState('ecits');
  const [ecitsSubtab, setEcitsSubtab] = useState('overview');
  const [scoutSubtab, setScoutSubtab] = useState('reconnaissance');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Заголовок модуля */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Scale size={ICON_SIZE.lg} />
        <div>
          <div style={{
            fontFamily: 'var(--font-heading)',
            fontSize: 'var(--text-md)',
            fontWeight: 'var(--weight-bold)',
          }}>
            Електронний суд
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-2)' }}>
            Синхронізація з кабінетом ЄСІТС
          </div>
        </div>
      </div>

      {/* Перемикач секцій (ЄСІТС / Розвідник) — рендериться тільки якщо є
          більше однієї секції. Для не-founder це звичайний модуль ЄСІТС. */}
      {founder && (
        <div style={{
          display: 'flex',
          gap: 2,
          borderBottom: '1px solid var(--color-border)',
        }}>
          <SubtabButton
            active={section === 'ecits'}
            onClick={() => setSection('ecits')}
            icon={Scale}
          >
            ЄСІТС
          </SubtabButton>
          <SubtabButton
            active={section === 'scout'}
            onClick={() => setSection('scout')}
            icon={Search}
          >
            Розвідник
          </SubtabButton>
        </div>
      )}

      {/* Секція ЄСІТС */}
      {section === 'ecits' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{
            display: 'flex',
            gap: 2,
            borderBottom: '1px solid var(--color-border)',
          }}>
            {ECITS_SUBTABS.map(t => (
              <SubtabButton
                key={t.id}
                active={ecitsSubtab === t.id}
                onClick={() => setEcitsSubtab(t.id)}
              >
                {t.label}
              </SubtabButton>
            ))}
          </div>

          {ecitsSubtab === 'overview' && (
            <PlaceholderPanel
              title="Огляд"
              hint="У розробці. Тут буде статус останньої синхронізації, нові надходження та підсумок по справах."
            />
          )}
          {ecitsSubtab === 'log' && (
            <PlaceholderPanel
              title="Журнал"
              hint="У розробці. Тут буде історія синхронізацій і обмін даними з кабінетом ЄСІТС."
            />
          )}
          {ecitsSubtab === 'settings' && (
            <PlaceholderPanel
              title="Налаштування"
              hint="У розробці. Тут буде керування автосинхронізацією, переліком справ і провайдером виконання."
            />
          )}
          {ecitsSubtab === 'discrepancies' && (
            <PlaceholderPanel
              title="Розбіжності"
              hint="У розробці. Тут будуть виявлені невідповідності між реєстром справ і даними ЄСІТС."
            />
          )}
        </div>
      )}

      {/* Секція Розвідник — тільки для засновника */}
      {founder && section === 'scout' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{
            display: 'flex',
            gap: 2,
            borderBottom: '1px solid var(--color-border)',
          }}>
            {SCOUT_SUBTABS.map(t => (
              <SubtabButton
                key={t.id}
                active={scoutSubtab === t.id}
                onClick={() => setScoutSubtab(t.id)}
              >
                {t.label}
              </SubtabButton>
            ))}
          </div>
          {scoutSubtab === 'reconnaissance' && <Reconnaissance />}
        </div>
      )}
    </div>
  );
}
