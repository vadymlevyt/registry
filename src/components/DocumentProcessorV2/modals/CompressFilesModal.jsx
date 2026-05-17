// DP-4 · Швидка функція «Стиснути файл(и)». Обгортка над готовим
// standaloneCompressor (DP-3, §4.12). Email/messenger — заглушки DP-3
// (not_implemented), показуємо чесно.
import { useState, useRef } from 'react';
import { Modal, Button } from '../../UI';
import { FileArchive, Download, Save } from 'lucide-react';
import { ICON_SIZE } from '../../UI/icons.js';
import { createStandaloneCompressor } from '../../../services/standaloneCompressor.js';
import { createDefaultDrivePort } from '../../../services/documentPipeline/drivePort.js';
import { toast } from '../../../services/toast.js';

export function CompressFilesModal({ isOpen, onClose, caseData }) {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [reports, setReports] = useState(null);
  const inputRef = useRef(null);

  const close = () => { setFiles([]); setReports(null); setBusy(false); onClose(); };

  const compressor = createStandaloneCompressor({
    drivePort: createDefaultDrivePort(),
    saveLocal: async (name, bytes) => {
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    },
    // sendEmail / sendMessenger свідомо не передані → not_implemented (DP-3).
  });

  const run = async (target) => {
    if (files.length === 0) return;
    setBusy(true);
    try {
      const opts = target === 'drive'
        ? { folderName: '01_ОРИГІНАЛИ', parentId: caseData?.storage?.driveFolderId || null }
        : {};
      const res = await compressor.compress(files, { target, options: opts });
      setReports(res.reports);
      const stub = res.reports.find((r) => r.reason === 'not_implemented');
      if (stub) {
        toast.warning('Ще не реалізовано', { description: 'Надсилання email/messenger буде в наступному TASK.' });
      } else {
        toast.success(`Стиснуто файлів: ${res.count}`);
      }
    } catch (e) {
      toast.error('Не вдалось стиснути', { description: e?.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Стиснути файл(и)"
      size="md"
      actions={<Button variant="ghost" onClick={close}>Закрити</Button>}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="application/pdf"
        className="dpv2-hidden-input"
        onChange={(e) => setFiles(Array.from(e.target.files || []))}
      />
      <Button
        variant="secondary"
        icon={<FileArchive size={ICON_SIZE.sm} />}
        onClick={() => inputRef.current?.click()}
      >
        Вибрати PDF файли
      </Button>
      {files.length > 0 && (
        <div className="dpv2-counter">Обрано: {files.length} файл(ів)</div>
      )}

      <div className="dpv2-section-label">Куди зберегти результат</div>
      <div className="dpv2-modal-stack">
        <Button variant="primary" disabled={files.length === 0 || busy} icon={<Save size={ICON_SIZE.sm} />} onClick={() => run('drive')}>
          У поточну справу (01_ОРИГІНАЛИ)
        </Button>
        <Button variant="secondary" disabled={files.length === 0 || busy} icon={<Download size={ICON_SIZE.sm} />} onClick={() => run('download')}>
          На пристрій (downloads)
        </Button>
        <Button variant="ghost" disabled={files.length === 0 || busy} onClick={() => run('email')}>
          Надіслати email
        </Button>
        <Button variant="ghost" disabled={files.length === 0 || busy} onClick={() => run('messenger')}>
          Надіслати в messenger
        </Button>
      </div>

      {busy && <div className="dpv2-muted">Стиснення…</div>}
      {reports && (
        <div className="dpv2-list" style={{ marginTop: 'var(--space-3)' }}>
          {reports.map((r, i) => (
            <div key={i} className="dpv2-list-row">
              <span className="dpv2-grow">{r.name}</span>
              <span className="dpv2-list-meta">
                {r.saved
                  ? `${Math.round((r.before || 0) / 1024)}КБ → ${Math.round((r.after || 0) / 1024)}КБ`
                  : (r.reason === 'not_implemented' ? 'заглушка' : (r.error || 'не збережено'))}
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
