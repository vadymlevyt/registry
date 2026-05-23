// ── COURT SYNC — OVERVIEW TAB ────────────────────────────────────────────────
// Базова статистика модуля. Один сенс (правило #11): "стан синхронізації
// у двох рядках і кнопка перейти до імпорту".
//
// Дані — з tenant.ecits_scenario_history (LIFO 200). Якщо порожньо —
// показуємо запрошення зробити першу синхронізацію.

import React from 'react';
import { ICON_SIZE } from '../UI/icons.js';
import { Download } from 'lucide-react';

export default function OverviewTab({ tenant, cases, onOpenImport }) {
  const history = Array.isArray(tenant?.ecits_scenario_history) ? tenant.ecits_scenario_history : [];
  const last = history[0] || null;

  const syncedCasesCount = Array.isArray(cases)
    ? cases.filter(c => c?.origin === 'ecits_import').length
    : 0;

  const totalSyncs = history.filter(h => h.status === 'completed').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 12,
      }}>
        <StatCard label="Справ з ЄСІТС" value={syncedCasesCount} />
        <StatCard label="Виконано синхронізацій" value={totalSyncs} />
        <StatCard
          label="Остання синхронізація"
          value={last ? formatDateTime(last.startedAt) : '—'}
          small
        />
      </div>

      <button
        onClick={onOpenImport}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 16px',
          background: 'var(--color-accent, #3b82f6)',
          color: 'var(--color-text-inverse, white)',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 500,
          alignSelf: 'flex-start',
        }}
      >
        <Download size={ICON_SIZE.sm} />
        Імпортувати з ЄСІТС
      </button>

      {history.length > 0 && (
        <section style={{
          padding: 16,
          background: 'var(--color-bg-1)',
          border: '1px solid var(--color-border)',
          borderRadius: 4,
        }}>
          <div style={{
            fontFamily: 'var(--font-heading)',
            fontWeight: 'var(--weight-bold)',
            marginBottom: 10,
          }}>
            Історія синхронізацій
          </div>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--color-text-2)' }}>
                <th style={cellHeader}>Час</th>
                <th style={cellHeader}>Транспорт</th>
                <th style={cellHeader}>Статус</th>
                <th style={cellHeader}>Створено</th>
                <th style={cellHeader}>Оновлено</th>
                <th style={cellHeader}>Засідань</th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 20).map(h => (
                <tr key={h.scenarioRunId} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td style={cell}>{formatDateTime(h.startedAt)}</td>
                  <td style={cell}>{h.transport}</td>
                  <td style={cell}>{h.status}</td>
                  <td style={cell}>{h.result?.casesCreated ?? 0}</td>
                  <td style={cell}>{h.result?.casesUpdated ?? 0}</td>
                  <td style={cell}>{h.result?.hearingsAdded ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value, small }) {
  return (
    <div style={{
      padding: 16,
      background: 'var(--color-bg-1)',
      border: '1px solid var(--color-border)',
      borderRadius: 4,
    }}>
      <div style={{ fontSize: 11, color: 'var(--color-text-2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{
        marginTop: 6,
        fontSize: small ? 14 : 22,
        fontWeight: 600,
      }}>{value}</div>
    </div>
  );
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
  } catch { return iso; }
}

const cellHeader = { padding: '6px 8px', fontWeight: 500 };
const cell = { padding: '6px 8px' };
