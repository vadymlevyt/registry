// ── MODEL SETTINGS ───────────────────────────────────────────────────────────
// Окрема модалка «Моделі агентів» (добровільний шар вибору). Список ролей з
// SYSTEM_DEFAULTS + поточна розв'язана модель (resolveModel) + позначка джерела
// (обрано вручну / дефолт). «Змінити» відкриває ModelPicker (через onPick App),
// «Скинути» прибирає override (onReset App). Це «другий шар» — той самий
// механізм, що й аварійна модалка, лише ініційований адвокатом.
//
// TASK Model Picker, Фаза 1.
import React from 'react';
import { SYSTEM_DEFAULTS, ROLE_LABELS, resolveModel } from '../../services/modelResolver.js';

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9000,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
};
const cardStyle = {
  background: 'var(--bg2,#1b1f27)', color: 'var(--text,#e8eaed)',
  border: '1px solid var(--line,#2c313c)', borderRadius: 10,
  width: 'min(620px,100%)', maxHeight: '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
};

export default function ModelSettings({ tenant, onPick, onReset, onClose }) {
  const roles = Object.keys(SYSTEM_DEFAULTS);
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line,#2c313c)' }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Моделі агентів</div>
          <div style={{ fontSize: 12, color: 'var(--text3,#9aa0aa)', marginTop: 4 }}>
            Яку модель кличе кожен агент. Вибір зберігається і синхронізується між пристроями.
          </div>
        </div>

        <div style={{ padding: 8, overflowY: 'auto', flex: 1 }}>
          {roles.map((agentType) => {
            const resolved = resolveModel(agentType);
            const override = tenant?.modelPreferences?.[agentType];
            return (
              <div key={agentType} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', marginBottom: 4, borderRadius: 8, background: 'var(--bg3,#232831)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{ROLE_LABELS[agentType] || agentType}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3,#9aa0aa)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {resolved} <span style={{ fontFamily: 'inherit' }}>{override ? '· обрано вручну' : '· дефолт'}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button className="btn-sm btn-ghost" onClick={() => onPick(agentType, resolved)}>Змінити</button>
                  {override ? <button className="btn-sm btn-ghost" onClick={() => onReset(agentType)} title="Повернути системний дефолт">Скинути</button> : null}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line,#2c313c)', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn-sm btn-ghost" onClick={onClose}>Закрити</button>
        </div>
      </div>
    </div>
  );
}
