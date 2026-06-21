// ── MODEL PICKER ─────────────────────────────────────────────────────────────
// Модалка вибору моделі для агента. ДВА рівноправні входи (правило дублювання
// інтерфейсів): аварійний (mode='unavailable', з події ai.model_unavailable) і
// добровільний (mode='change', з екрана Налаштувань моделей).
//
// Живий список — з modelsService (кеш миттєво, fetch оновлює). Вибір повертається
// через onSelect(modelId); персист (tenant.modelPreferences → Drive) робить App.
//
// TASK Model Picker, Фаза 1.
import React, { useEffect, useState, useCallback } from 'react';
import { fetchAvailableModels, getCachedModels } from '../../services/modelsService.js';
import { ROLE_LABELS } from '../../services/modelResolver.js';

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9100,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
};
const cardStyle = {
  background: 'var(--bg2,#1b1f27)', color: 'var(--text,#e8eaed)',
  border: '1px solid var(--line,#2c313c)', borderRadius: 10,
  width: 'min(560px,100%)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
};

function sortModels(list) {
  return [...(list || [])].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function rowStyle(active) {
  return {
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
    width: '100%', textAlign: 'left', padding: '10px 12px', marginBottom: 4, borderRadius: 8,
    border: '1px solid ' + (active ? 'var(--accent,#5b8def)' : 'transparent'),
    background: active ? 'rgba(91,141,239,0.14)' : 'var(--bg3,#232831)', color: 'inherit', cursor: 'pointer',
  };
}

export default function ModelPicker({ agentType, currentModel, mode = 'change', onSelect, onClose }) {
  const [models, setModels] = useState(() => sortModels(getCachedModels() || []));
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (force) => {
    const apiKey = (() => { try { return localStorage.getItem('claude_api_key') || ''; } catch { return ''; } })();
    setLoading(true);
    const res = await fetchAvailableModels(apiKey, { force });
    if (res.models) setModels(sortModels(res.models));
    setStale(!!res.stale);
    setError(res.error);
    setLoading(false);
  }, []);

  useEffect(() => { load(false); }, [load]);

  const roleLabel = ROLE_LABELS[agentType] || agentType;
  const title = mode === 'unavailable' ? `Модель недоступна` : 'Вибір моделі';
  const subtitle = mode === 'unavailable'
    ? `Модель «${currentModel}» для «${roleLabel}» виведена з обігу. Оберіть актуальну — вибір збережеться і синхронізується між пристроями.`
    : `Роль: ${roleLabel}. Поточна: ${currentModel}.`;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line,#2c313c)' }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--text3,#9aa0aa)', marginTop: 4, lineHeight: 1.4 }}>{subtitle}</div>
        </div>

        <div style={{ padding: 8, overflowY: 'auto', flex: 1 }}>
          {loading && models.length === 0 && (
            <div style={{ padding: 16, fontSize: 13, color: 'var(--text3,#9aa0aa)' }}>Завантаження списку моделей…</div>
          )}
          {!loading && models.length === 0 && (
            <div style={{ padding: 16, fontSize: 13, color: '#e07a5f' }}>
              Не вдалося отримати список моделей{error ? `: ${error}` : ''}. Перевірте API-ключ і зв'язок.
            </div>
          )}
          {models.map((m) => (
            <button key={m.id} onClick={() => onSelect(m.id)} style={rowStyle(m.id === currentModel)}>
              <span style={{ fontWeight: 600 }}>{m.displayName}</span>
              <span style={{ fontSize: 11, color: 'var(--text3,#9aa0aa)', fontFamily: 'monospace' }}>{m.id}</span>
            </button>
          ))}
        </div>

        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line,#2c313c)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text3,#9aa0aa)' }}>
            {stale ? 'кешований список' : ''}{stale && error ? ' · оновлення не вдалося' : ''}
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn-sm btn-ghost" onClick={() => load(true)} disabled={loading}>Оновити список</button>
            <button className="btn-sm btn-ghost" onClick={onClose}>Закрити</button>
          </span>
        </div>
      </div>
    </div>
  );
}
