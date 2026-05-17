// DP-4 · Швидка функція «Розпізнати текст». Один файл → готовий OCR pipeline
// (ocrService, БЕЗ повного DP) → текст у viewer з опціями збереження.
import { useState, useRef } from 'react';
import { Modal, Button } from '../../UI';
import { FileText, Copy, Download, Save } from 'lucide-react';
import { ICON_SIZE } from '../../UI/icons.js';
import * as ocrService from '../../../services/ocrService.js';
import { findOrCreateFolder, uploadBytesToDrive } from '../../../services/driveService.js';
import { createDocument } from '../../../services/documentFactory.js';
import { toast } from '../../../services/toast.js';

export function RecognizeTextModal({ isOpen, onClose, caseData, onExecuteAction }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState(null);
  const inputRef = useRef(null);

  const reset = () => { setFile(null); setText(null); setBusy(false); };
  const close = () => { reset(); onClose(); };

  const recognize = async (f) => {
    setFile(f);
    setBusy(true);
    setText(null);
    try {
      const res = await ocrService.extractText(
        { name: f.name, mimeType: f.type || 'application/pdf', localBlob: f },
        { skipCache: true },
      );
      setText(res?.text || '');
      if (!res?.text) toast.warning('Текст не розпізнано', { description: 'Документ може бути порожнім або непідтримуваного формату.' });
    } catch (e) {
      toast.error('Не вдалось розпізнати', { description: ocrService.localizeOcrError(e?.code) });
      setText('');
    } finally {
      setBusy(false);
    }
  };

  const saveDevice = () => {
    const blob = new Blob([text || ''], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(file?.name || 'document').replace(/\.[^/.]+$/, '')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Файл збережено на пристрій');
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(text || ''); toast.success('Скопійовано в буфер'); }
    catch { toast.error('Не вдалось скопіювати'); }
  };

  const saveToCase = async () => {
    if (!text) return;
    setBusy(true);
    try {
      let folderId = caseData?.storage?.subFolders?.['01_ОРИГІНАЛИ'] || null;
      if (!folderId) {
        const f = await findOrCreateFolder('01_ОРИГІНАЛИ', caseData?.storage?.driveFolderId || null, null);
        folderId = f?.id;
      }
      const baseName = `${(file?.name || 'document').replace(/\.[^/.]+$/, '')}_розпізнано.txt`;
      const up = await uploadBytesToDrive(
        folderId, baseName, new TextEncoder().encode(text), 'text/plain',
      );
      const doc = createDocument({
        name: baseName,
        originalName: file?.name || null,
        category: null,
        documentNature: 'searchable',
        folder: '01_ОРИГІНАЛИ',
        driveId: up.id,
        driveUrl: `https://drive.google.com/file/d/${up.id}/view`,
        size: (text || '').length,
        addedBy: 'user',
        source: 'manual',
      });
      const r = await onExecuteAction('document_processor_agent', 'add_documents', {
        caseId: caseData.id, documents: [doc],
      });
      if (r?.success) { toast.success('Збережено у справу як документ'); close(); }
      else toast.error('Не вдалось зберегти у справу', { description: r?.error });
    } catch (e) {
      toast.error('Не вдалось зберегти у справу', { description: e?.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Розпізнати текст"
      size="lg"
      actions={
        text != null ? (
          <>
            <Button variant="ghost" onClick={close}>Закрити без збереження</Button>
            <Button variant="secondary" icon={<Copy size={ICON_SIZE.sm} />} onClick={copy} disabled={!text}>Скопіювати</Button>
            <Button variant="secondary" icon={<Download size={ICON_SIZE.sm} />} onClick={saveDevice} disabled={!text}>На пристрій (.txt)</Button>
            <Button variant="primary" icon={<Save size={ICON_SIZE.sm} />} onClick={saveToCase} disabled={!text || busy}>Зберегти у справу</Button>
          </>
        ) : (
          <Button variant="ghost" onClick={close}>Закрити</Button>
        )
      }
    >
      {text == null && (
        <>
          <div className="dpv2-modal-text">Оберіть один файл для розпізнавання тексту.</div>
          <div className="dpv2-modal-stack">
            <input
              ref={inputRef}
              type="file"
              className="dpv2-hidden-input"
              onChange={(e) => e.target.files?.[0] && recognize(e.target.files[0])}
            />
            <Button
              variant="primary"
              icon={<FileText size={ICON_SIZE.sm} />}
              onClick={() => inputRef.current?.click()}
            >
              Вибрати файл
            </Button>
          </div>
        </>
      )}
      {busy && <div className="dpv2-muted">Розпізнавання…</div>}
      {text != null && !busy && (
        <div className="dpv2-result-viewer">{text || '(порожньо)'}</div>
      )}
    </Modal>
  );
}
