// ── COURT SYNC MODULE ────────────────────────────────────────────────────────
// Модуль «Електронний суд». TASK 0.4 — Court Sync MVP.
//
// Структура:
//   • ЄСІТС — видима всім. Активні вкладки: Огляд, Імпорт, Налаштування.
//             Журнал і Розбіжності — заглушки (наступні TASK).
//   • Розвідник — видима тільки для founder (isCurrentUserFounder()===true).
//
// Hash-router (TASK 0.4): `#/court-sync/import` deep-link перемикає на
// вкладку Імпорт (також target для майбутнього Chrome extension).
//
// Дизайн — тільки існуючі design-токени з styles/tokens.css. Іконки —
// з lucide-react через components/UI/icons.js. Без емодзі.

import React, { useState, useEffect, useCallback } from 'react';
import { Scale, Search } from 'lucide-react';
import { ICON_SIZE } from '../UI/icons.js';
import { isCurrentUserFounder } from '../../services/tenantService.js';
import * as hashRouter from '../../services/hashRouter.js';
import Reconnaissance from './Reconnaissance/index.jsx';
import ImportTab from './ImportTab.jsx';
import OverviewTab from './OverviewTab.jsx';
import SettingsTab from './SettingsTab.jsx';

// ── Підвкладки ───────────────────────────────────────────────────────────────

const ECITS_SUBTABS = [
  { id: 'overview',      label: 'Огляд' },
  { id: 'import',        label: 'Імпорт' },
  { id: 'log',           label: 'Журнал' },
  { id: 'settings',      label: 'Налаштування' },
  { id: 'discrepancies', label: 'Розбіжності' },
];

const SCOUT_SUBTABS = [
  { id: 'reconnaissance', label: 'Розвідка ЄСІТС' },
];

// ── Заглушка вмісту (для ще не реалізованих вкладок) ─────────────────────────

function PlaceholderPanel({ title, hint }) {
  return (
    <div className="empty">
      <div className="empty-text" style={{ fontWeight: 600, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--color-text-3)' }}>{hint}</div>
    </div>
  );
}

// ── Кнопка підвкладки ────────────────────────────────────────────────────────

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

export default function CourtSync({
  executeAction,
  cases,
  tenant,
  onScenarioHistoryAppend,
}) {
  const founder = isCurrentUserFounder();
  const [section, setSection] = useState('ecits');

  // Початковий підтаб з hash-route (#/court-sync/import → 'import')
  const initialSubtab = useCallback(() => {
    const route = hashRouter.getCurrentRoute?.();
    if (route?.module === 'court-sync' && route.entityId && ECITS_SUBTABS.some(t => t.id === route.entityId)) {
      return route.entityId;
    }
    return 'overview';
  }, []);

  const [ecitsSubtab, setEcitsSubtab] = useState(initialSubtab);
  const [scoutSubtab, setScoutSubtab] = useState('reconnaissance');

  // Підписка на зміну hash (наприклад розширення викликає navigate('/court-sync/import')).
  useEffect(() => {
    const unsubscribe = hashRouter.subscribe((route) => {
      if (route?.module !== 'court-sync') return;
      setSection('ecits');
      if (route.entityId && ECITS_SUBTABS.some(t => t.id === route.entityId)) {
        setEcitsSubtab(route.entityId);
      }
    });
    return unsubscribe;
  }, []);

  const openImport = useCallback(() => {
    setSection('ecits');
    setEcitsSubtab('import');
    hashRouter.navigate?.('court-sync/import');
  }, []);

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
            flexWrap: 'wrap',
          }}>
            {ECITS_SUBTABS.map(t => (
              <SubtabButton
                key={t.id}
                active={ecitsSubtab === t.id}
                onClick={() => {
                  setEcitsSubtab(t.id);
                  hashRouter.navigate?.(`court-sync/${t.id}`);
                }}
              >
                {t.label}
              </SubtabButton>
            ))}
          </div>

          {ecitsSubtab === 'overview' && (
            <OverviewTab
              tenant={tenant}
              cases={cases}
              onOpenImport={openImport}
            />
          )}
          {ecitsSubtab === 'import' && (
            <ImportTab
              executeAction={executeAction}
              cases={cases}
              tenant={tenant}
              onScenarioHistoryAppend={onScenarioHistoryAppend}
            />
          )}
          {ecitsSubtab === 'log' && (
            <PlaceholderPanel
              title="Журнал"
              hint="У розробці. Тут буде детальна історія синхронізацій (зараз короткий зріз — на вкладці Огляд)."
            />
          )}
          {ecitsSubtab === 'settings' && <SettingsTab />}
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
