import React from 'react';

const overlay = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(0,0,0,0.6)', zIndex: 9999,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const box = {
  background: '#1e2138', border: '1px solid #2e3148', borderRadius: 12,
  padding: '24px 28px', minWidth: 300, maxWidth: 420,
  color: '#e8eaf0', fontSize: 14, lineHeight: 1.6,
};
const btnBase = {
  border: 'none', borderRadius: 8, padding: '8px 20px',
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
};

export default function SystemModal({ open, title, message, onOk, onCancel, okText, cancelText, type }) {
  if (!open) return null;
  const isConfirm = type === 'confirm';
  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget && onCancel) onCancel(); }}>
      <div style={box}>
        {title && <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{title}</div>}
        <div style={{ whiteSpace: 'pre-wrap', marginBottom: 20, color: '#b0b4cc' }}>{message}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          {isConfirm && onCancel && (
            <button style={{ ...btnBase, background: '#2e3148', color: '#9aa0b8' }} onClick={onCancel}>
              {cancelText || 'Скасувати'}
            </button>
          )}
          <button style={{ ...btnBase, background: '#4f7cff', color: '#fff' }} onClick={onOk}>
            {okText || 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Imperative API — drop-in replacement for alert/confirm
let _setModal = null;
let _resolveModal = null;

export function SystemModalRoot() {
  const [state, setState] = React.useState({ open: false });
  React.useEffect(() => { _setModal = setState; return () => { _setModal = null; }; }, []);
  return (
    <SystemModal
      open={state.open}
      title={state.title}
      message={state.message}
      type={state.type}
      okText={state.okText}
      cancelText={state.cancelText}
      onOk={() => { setState({ open: false }); _resolveModal && _resolveModal(true); }}
      onCancel={() => { setState({ open: false }); _resolveModal && _resolveModal(false); }}
    />
  );
}

export function systemAlert(message, title) {
  if (!_setModal) { window.alert(message); return Promise.resolve(true); }
  return new Promise(resolve => {
    _resolveModal = resolve;
    _setModal({ open: true, type: 'alert', message, title: title || '', okText: 'OK' });
  });
}

export function systemConfirm(message, title, okText, cancelText) {
  if (!_setModal) return Promise.resolve(window.confirm(message));
  return new Promise(resolve => {
    _resolveModal = resolve;
    _setModal({ open: true, type: 'confirm', message, title: title || '', okText: okText || 'OK', cancelText: cancelText || 'Скасувати' });
  });
}
