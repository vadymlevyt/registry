import { useState, useEffect } from 'react';
import { Upload, Paperclip, X } from 'lucide-react';
import { Modal, Input, Select, Toggle, Button } from '../UI';
import { ICON_SIZE } from '../UI/icons.js';
import './AddDocumentModal.css';

const CATEGORY_OPTIONS = [
  { value: 'pleading', label: 'Заява по суті' },
  { value: 'motion', label: 'Клопотання' },
  { value: 'court_act', label: 'Судовий акт' },
  { value: 'evidence', label: 'Доказ' },
  { value: 'contract', label: 'Договір' },
  { value: 'correspondence', label: 'Кореспонденція' },
  { value: 'identification', label: 'Документ особи' },
  { value: 'other', label: 'Інше' },
];

const AUTHOR_OPTIONS = [
  { value: 'ours', label: 'Наш' },
  { value: 'opponent', label: 'Опонент' },
  { value: 'court', label: 'Суд' },
  { value: 'third_party', label: 'Третя сторона' },
];

const ACCEPT_FILE_TYPES = '.pdf,.jpeg,.jpg,.png,.heic,.docx,.xlsx,.pptx,.zip,.md,.txt,.html,.htm';

const initialState = (caseData) => ({
  name: '',
  category: '',
  author: '',
  procId: caseData?.proceedings?.[0]?.id || '',
  date: '',
  isKey: false,
  file: null,
});

/**
 * AddDocumentModal — фірмова модалка додавання документа в справу.
 *
 * Замінює стару модалку з native <select>, яка на Android відкривала системний
 * picker. Усі поля — фірмові компоненти UI/. Drag-n-drop зона для файла.
 *
 * Props:
 *   isOpen, onClose
 *   caseData — справа (для списку proceedings)
 *   onSubmit({ name, category, author, procId, date, isKey, file }) — callback
 *      викликається коли адвокат натискає "Додати документ"
 */
export function AddDocumentModal({ isOpen, onClose, caseData, onSubmit }) {
  const [state, setState] = useState(() => initialState(caseData));
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Сброс при відкритті — щоб не було залишків з попереднього виклику.
  useEffect(() => {
    if (isOpen) {
      setState(initialState(caseData));
      setTouched(false);
      setSubmitting(false);
      setDragOver(false);
    }
  }, [isOpen, caseData]);

  const proceedingOptions = (caseData?.proceedings || []).map((p) => ({
    value: p.id,
    label: p.title,
  }));

  const nameError = touched && !state.name.trim() ? 'Назва обовʼязкова' : null;

  const handleSubmit = async () => {
    setTouched(true);
    if (!state.name.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: state.name.trim(),
        category: state.category || null,
        author: state.author || null,
        procId: state.procId || null,
        date: state.date.trim() || null,
        isKey: state.isKey,
        file: state.file,
      });
      onClose();
    } catch (err) {
      console.error('[AddDocumentModal] submit failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleFile = (file) => {
    setState((s) => ({ ...s, file }));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Додати документ"
      size="md"
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Скасувати
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Додаємо...' : 'Додати документ'}
          </Button>
        </>
      }
    >
      <div className="add-document-modal__form">
        <Input
          label="Назва документа"
          value={state.name}
          onChange={(v) => setState((s) => ({ ...s, name: v }))}
          placeholder="Напр. Позов про стягнення коштів"
          error={nameError}
          autoFocus
        />

        <div className="add-document-modal__row">
          <Select
            label="Тип документа"
            value={state.category}
            onChange={(v) => setState((s) => ({ ...s, category: v }))}
            options={CATEGORY_OPTIONS}
            placeholder="Оберіть тип"
          />
          <Select
            label="Від кого"
            value={state.author}
            onChange={(v) => setState((s) => ({ ...s, author: v }))}
            options={AUTHOR_OPTIONS}
            placeholder="Оберіть автора"
          />
        </div>

        {proceedingOptions.length > 0 && (
          <Select
            label="Провадження"
            value={state.procId}
            onChange={(v) => setState((s) => ({ ...s, procId: v }))}
            options={proceedingOptions}
            placeholder="Оберіть провадження"
          />
        )}

        <Input
          label="Дата документа"
          type="date"
          value={state.date}
          onChange={(v) => setState((s) => ({ ...s, date: v }))}
        />

        <Toggle
          label="Позначити як ключовий"
          description="Документ буде виділено зірочкою у списку"
          checked={state.isKey}
          onChange={(v) => setState((s) => ({ ...s, isKey: v }))}
        />

        <FileUploadZone
          file={state.file}
          dragOver={dragOver}
          onDragOver={setDragOver}
          onChange={handleFile}
        />
      </div>
    </Modal>
  );
}

function FileUploadZone({ file, dragOver, onDragOver, onChange }) {
  const inputId = 'add-document-modal-file-input';

  const handleDrop = (e) => {
    e.preventDefault();
    onDragOver(false);
    const dropped = e.dataTransfer?.files?.[0];
    if (dropped) onChange(dropped);
  };

  const handleClear = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onChange(null);
  };

  if (file) {
    return (
      <div className="add-document-modal__file-card">
        <Paperclip size={ICON_SIZE.sm} />
        <div className="add-document-modal__file-info">
          <div className="add-document-modal__file-name">{file.name}</div>
          <div className="add-document-modal__file-size">
            {(file.size / 1024).toFixed(0)} КБ
          </div>
        </div>
        <button
          type="button"
          className="add-document-modal__file-clear"
          onClick={handleClear}
          aria-label="Прибрати файл"
        >
          <X size={ICON_SIZE.sm} />
        </button>
      </div>
    );
  }

  return (
    <label
      htmlFor={inputId}
      className={
        'add-document-modal__dropzone' +
        (dragOver ? ' add-document-modal__dropzone--over' : '')
      }
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver(true);
      }}
      onDragLeave={() => onDragOver(false)}
      onDrop={handleDrop}
    >
      <Upload size={28} />
      <div className="add-document-modal__dropzone-title">
        Перетягніть файл або натисніть
      </div>
      <div className="add-document-modal__dropzone-hint">
        PDF, JPEG, PNG, HEIC, Word, HTML
      </div>
      <input
        id={inputId}
        type="file"
        accept={ACCEPT_FILE_TYPES}
        className="add-document-modal__file-input"
        onChange={(e) => onChange(e.target.files?.[0] || null)}
      />
    </label>
  );
}
