// DP-4 · Компактний Drive-пікер для Зони 1 (вибір файлів з Google Drive).
// AddDocumentModal має власний DrivePickerSection, але він НЕ експортований і
// зв'язаний з його single-file flow (behavior-preserve — не чіпаємо). Тут —
// окремий мінімальний браузер папок з мульти-вибором (той самий driveRequest
// API-патерн, правило #8: лише id-фільтри у q=, нуль кирилиці).
import { useState, useEffect, useCallback } from 'react';
import { Modal, Button } from '../UI';
import { Folder, FileText, ChevronLeft, Check } from 'lucide-react';
import { ICON_SIZE } from '../UI/icons.js';
import { driveRequest } from '../../services/driveAuth.js';

export function DrivePicker({ isOpen, onClose, onPick, initialFolderId = 'root' }) {
  const [folderId, setFolderId] = useState(initialFolderId || 'root');
  const [stack, setStack] = useState([]);
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(() => new Map());

  const load = useCallback(async (fid) => {
    setLoading(true); setError(null);
    try {
      const q = `'${fid}' in parents and trashed=false`;
      const res = await driveRequest(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size)&pageSize=1000&orderBy=folder,name`,
      );
      if (!res.ok) throw new Error(`Drive ${res.status}`);
      const data = await res.json();
      setItems(data.files || []);
    } catch (e) {
      setError(e?.message || 'Помилка Drive');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setFolderId(initialFolderId || 'root');
    setStack([]);
    setSelected(new Map());
  }, [isOpen, initialFolderId]);

  useEffect(() => {
    if (isOpen) load(folderId);
  }, [isOpen, folderId, load]);

  const isFolder = (it) => it.mimeType === 'application/vnd.google-apps.folder';

  const toggle = (it) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(it.id)) next.delete(it.id);
      else next.set(it.id, it);
      return next;
    });
  };

  const enter = (it) => {
    setStack((s) => [...s, folderId]);
    setFolderId(it.id);
  };
  const goBack = () => {
    setStack((s) => {
      if (s.length === 0) return s;
      const copy = [...s];
      const prev = copy.pop();
      setFolderId(prev);
      return copy;
    });
  };

  const confirm = () => {
    const picked = Array.from(selected.values()).map((f) => ({
      driveId: f.id,
      name: f.name,
      size: Number(f.size) || 0,
      mime: f.mimeType || null,
    }));
    onPick(picked);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Вибір файлів з Google Drive"
      size="lg"
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>Скасувати</Button>
          <Button
            variant="primary"
            disabled={selected.size === 0}
            icon={<Check size={ICON_SIZE.sm} />}
            onClick={confirm}
          >
            Обрати {selected.size > 0 ? selected.size : ''}
          </Button>
        </>
      }
    >
      <div className="dpv2-input-buttons" style={{ marginBottom: 'var(--space-2)' }}>
        <Button
          variant="ghost"
          size="sm"
          disabled={stack.length === 0}
          icon={<ChevronLeft size={ICON_SIZE.sm} />}
          onClick={goBack}
        >
          Назад
        </Button>
      </div>
      {loading && <div className="dpv2-muted">Завантаження…</div>}
      {error && <div className="dpv2-attention-card dpv2-attention-card--error">{error}</div>}
      {!loading && items && (
        <div className="dpv2-list">
          {items.length === 0 && <div className="dpv2-muted">Папка порожня</div>}
          {items.map((it) => (
            isFolder(it) ? (
              <button
                key={it.id}
                className="dpv2-list-row"
                onClick={() => enter(it)}
                style={{ cursor: 'pointer', textAlign: 'left' }}
              >
                <Folder size={ICON_SIZE.sm} />
                <span className="dpv2-grow">{it.name}</span>
              </button>
            ) : (
              <label key={it.id} className="dpv2-list-row" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={selected.has(it.id)}
                  onChange={() => toggle(it)}
                />
                <FileText size={ICON_SIZE.sm} />
                <span className="dpv2-grow">{it.name}</span>
              </label>
            )
          ))}
        </div>
      )}
    </Modal>
  );
}
