import { useState, useEffect, useRef } from 'react';
import {
  Upload,
  Paperclip,
  X,
  FileText,
  Image as ImageIcon,
  ArrowLeft,
} from 'lucide-react';
import { Modal, Input, Select, Toggle, Button, DatePicker } from '../UI';
import { ICON_SIZE } from '../UI/icons.js';
import { toast } from '../../services/toast.js';
import { ImageMergePanel } from './ImageMergePanel/index.jsx';
// Drive-пікер винесено у спільну теку (TASK 4 · етап B) — модалка лишається
// тонким оркестратором, лише дротує DrivePickerSection.
import { DrivePickerSection } from '../DrivePicker/index.jsx';
// Спільні тумблери опцій додавання (TASK 4 rework · Стадія B) — один текст і
// поведінка з Document Processor.
import { OcrToggle, CompressToggle } from '../DocumentIngest/IngestOptionsToggles.jsx';
import './AddDocumentModal.css';
import './ImageMergePanel.css';

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

// Підтримувані типи для кнопки "Додати файл" (single). Збігається з MIME-чеками
// у converterService — PDF / HTML / DOCX / image (HEIC iPhone). Інші формати
// (XLSX, ZIP, MD, TXT) залишаються у списку для passthrough — Drive iframe
// покаже preview, OCR pipeline пропустить їх.
// `image/*` — щоб iOS/iPadOS не сірив HEIC/HEIF (розширення `.heic` без MIME
// там не вмикається у пікері). Покриває всі фото-формати одним махом.
const ACCEPT_FILE_TYPES = '.pdf,image/*,.heic,.heif,.doc,.docx,application/msword,.xlsx,.pptx,.zip,.md,.txt,.html,.htm';

// Дві операційні гілки: одиничний документ vs склейка кількох зображень.
// Mode 'merge' у TASK A — лише плейсхолдер з повідомленням; реалізація у TASK B.
const MODE_SINGLE = 'single';
const MODE_MERGE = 'merge';

const initialState = (caseData) => ({
  name: '',
  category: '',
  author: '',
  procId: caseData?.proceedings?.[0]?.id || '',
  date: '',
  isKey: false,
  file: null,
  // «Без розпізнавання тексту» (ocrMode none) — опція швидкого додавання:
  // розпізнавання не запускається, артефактів немає, лише базові метадані.
  noOcr: false,
  // «Стиснути файли» — фронт-крок: зменшує скани/фото перед додаванням
  // (рушій сам пропускає текстові). Default OFF.
  compress: false,
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
export function AddDocumentModal({ isOpen, onClose, caseData, onSubmit, driveConnected = true }) {
  const [state, setState] = useState(() => initialState(caseData));
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // mode: null = стартовий екран з двома кнопками; 'single' = форма для
  // одного документа; 'merge' (TASK B) = склейка кількох зображень.
  const [mode, setMode] = useState(null);

  // Drive picker — окрема гілка від device file picker. Render-гейт: Drive
  // підключений (driveConnected). Папка справи може бути ще не створена — в такому
  // разі picker стартує з кореня (initialFolderId='root'). Файл з Drive
  // приймається з будь-якого місця, не лише з 01_ОРИГІНАЛИ справи.
  const caseDriveFolderId = caseData?.storage?.subFolders?.['01_ОРИГІНАЛИ'];
  const drivePickerStart = caseDriveFolderId || 'root';
  const [drivePickerOpen, setDrivePickerOpen] = useState(false);

  // Reset стану модалки — ТІЛЬКИ при переході isOpen false→true (відкритті).
  //
  // КРИТИЧНО: caseData свідомо виключено з deps. CaseDossier передає
  // `caseData={{ ...caseData, proceedings }}` — spread створює новий обʼєкт
  // на КОЖНОМУ рендері. Будь-яке оновлення в App.jsx (зокрема sink
  // activityTracker.report → setTimeEntries наприкінці успішного pipeline'у
  // convertImagesToPdf) каскадить як новий caseData референс сюди, і якщо
  // включити його у deps — useEffect скидає mode на null, mid-merge.
  // Адвокат бачить як preview-екран зникає і повертається стартовий
  // екран з двома кнопками.
  //
  // Reset потрібен лише при відкритті модалки, не на парентські ре-рендери.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isOpen) {
      setState(initialState(caseData));
      setTouched(false);
      setSubmitting(false);
      setDragOver(false);
      setDrivePickerOpen(false);
      setMode(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function handleDrivePick(driveFile) {
    // Маркер-обʼєкт який відрізняється від реального File. CaseDossier:onSubmit
    // перевіряє _isDriveSource і пропускає uploadFileLocal — driveId уже відомий.
    setState((s) => ({
      ...s,
      // Назва документа — імʼя файлу без розширення, якщо адвокат ще не ввів
      name: s.name || stripExtension(driveFile.name),
      file: {
        _isDriveSource: true,
        _driveId: driveFile.id,
        name: driveFile.name,
        size: driveFile.size != null ? parseInt(driveFile.size, 10) : 0,
        type: driveFile.mimeType || 'application/octet-stream',
      },
    }));
    setDrivePickerOpen(false);
  }

  function handleStartSingle() {
    setMode(MODE_SINGLE);
  }

  function handleStartMerge() {
    setMode(MODE_MERGE);
    setMergeDrivePickerOpen(false);
  }

  // Drive picker для merge-режиму: окрема state-машина від single-mode picker'а.
  // mergePanelRef.current — імперативний API ImageMergePanel'а ({addDriveFiles}).
  const [mergeDrivePickerOpen, setMergeDrivePickerOpen] = useState(false);
  const mergePanelRef = useRef(null);

  function handleMergeDrivePickMulti(driveFiles) {
    if (mergePanelRef.current?.addDriveFiles) {
      mergePanelRef.current.addDriveFiles(driveFiles);
    }
    setMergeDrivePickerOpen(false);
  }

  function handleBackToStart() {
    setMode(null);
    setState(initialState(caseData));
    setTouched(false);
    setDrivePickerOpen(false);
  }

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
        // «без OCR» → ocrMode 'none'; інакше 'full' (повний OCR, дефолт).
        ocrMode: state.noOcr ? 'none' : 'full',
        // «Стиснути» → фронт-крок стиснення перед додаванням (consumer).
        compress: state.compress,
      });
      onClose();
    } catch (err) {
      console.error('[AddDocumentModal] submit failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleFile = (file) => {
    setState((s) => ({
      ...s,
      // Якщо адвокат ще не ввів назву — дефолт з імені файлу без розширення.
      name: s.name || (file ? stripExtension(file.name) : ''),
      file,
    }));
  };

  // Стартовий екран — дві кнопки. Без кнопки "Додати документ" у footer'і.
  if (mode === null) {
    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Додати документ"
        size="md"
        actions={
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Скасувати
          </Button>
        }
      >
        <div className="add-document-modal__start">
          <StartButton
            icon={<FileText size={28} />}
            title="Додати файл"
            description="PDF, DOCX, HTML, JPG, PNG, HEIC"
            onClick={handleStartSingle}
          />
          <StartButton
            icon={<ImageIcon size={28} />}
            title="Склеїти зображення"
            description="Кілька фото в один PDF"
            onClick={handleStartMerge}
          />
        </div>
      </Modal>
    );
  }

  // Merge mode — рендеримо ImageMergePanel + опційно DrivePickerSection
  // у multi-images mode для додавання файлів з Drive.
  if (mode === MODE_MERGE) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Склеїти зображення" size="lg">
        <div className="add-document-modal__merge">
          <ImageMergePanel
            ref={mergePanelRef}
            caseData={caseData}
            apiKey={(typeof localStorage !== 'undefined' && localStorage.getItem('claude_api_key')) || ''}
            onSubmit={async (payload) => {
              await onSubmit(payload);
              onClose();
            }}
            onCancel={handleBackToStart}
            onOpenDrivePicker={driveConnected ? () => setMergeDrivePickerOpen(true) : null}
            onSingleFileRedirect={(file) => {
              // Переходимо у single mode і одразу прокидаємо вибраний файл
              // (без необхідності повторно його вибирати).
              setState((s) => ({
                ...s,
                file,
                name: s.name || stripExtension(file?.name || ''),
              }));
              setMergeDrivePickerOpen(false);
              setMode(MODE_SINGLE);
            }}
          />

          {mergeDrivePickerOpen && driveConnected && (
            <DrivePickerSection
              isOpen
              initialFolderId={drivePickerStart}
              onToggle={() => setMergeDrivePickerOpen(false)}
              onPick={() => { /* single not used у multi mode */ }}
              onPickMulti={handleMergeDrivePickMulti}
              selectionMode="multi"
              multiFilter="images"
            />
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Додати документ"
      size="md"
      actions={
        <>
          <Button variant="secondary" onClick={handleBackToStart} disabled={submitting}>
            <ArrowLeft size={ICON_SIZE.sm} />
            Назад
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Конвертація і завантаження...' : 'Додати документ'}
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
          <div className="add-document-modal__proceeding-row">
            <div className="add-document-modal__proceeding-select">
              <Select
                label="Провадження"
                value={state.procId}
                onChange={(v) => setState((s) => ({ ...s, procId: v }))}
                options={proceedingOptions}
                placeholder="Оберіть провадження"
              />
            </div>
            {/* TASK A.7: плейсхолдер для майбутньої модалки "Структура справи".
                Точка інтеграції готова — реальне створення провадження зʼявиться
                окремим TASK без перебудови UI. */}
            <button
              type="button"
              className="add-document-modal__new-proceeding"
              onClick={() => toast.show('Створення провадження буде доступним у наступних версіях')}
              title="Створити нове провадження"
            >
              + Нове
            </button>
          </div>
        )}

        <DatePicker
          label="Дата документа"
          value={state.date}
          onChange={(v) => setState((s) => ({ ...s, date: v }))}
        />

        <Toggle
          label="Позначити як ключовий"
          description="Документ буде виділено зірочкою у списку"
          checked={state.isKey}
          onChange={(v) => setState((s) => ({ ...s, isKey: v }))}
        />

        <OcrToggle
          checked={state.noOcr}
          onChange={(v) => setState((s) => ({ ...s, noOcr: v }))}
        />

        <CompressToggle
          checked={state.compress}
          onChange={(v) => setState((s) => ({ ...s, compress: v }))}
        />

        <FileUploadZone
          file={state.file}
          dragOver={dragOver}
          onDragOver={setDragOver}
          onChange={handleFile}
        />

        {driveConnected && !state.file && (
          <DrivePickerSection
            isOpen={drivePickerOpen}
            initialFolderId={drivePickerStart}
            onToggle={() => setDrivePickerOpen((v) => !v)}
            onPick={handleDrivePick}
          />
        )}
      </div>
    </Modal>
  );
}

// ── START SCREEN ─────────────────────────────────────────────────────────────

function StartButton({ icon, title, description, onClick, comingSoon }) {
  return (
    <button
      type="button"
      className={
        'add-document-modal__start-button' +
        (comingSoon ? ' add-document-modal__start-button--soon' : '')
      }
      onClick={onClick}
    >
      <div className="add-document-modal__start-icon">{icon}</div>
      <div className="add-document-modal__start-title">{title}</div>
      <div className="add-document-modal__start-desc">{description}</div>
      {comingSoon && (
        <div className="add-document-modal__start-soon">
          Доступно у наступній версії
        </div>
      )}
    </button>
  );
}

// stripExtension — імʼя файлу без останнього розширення.
// Використовується як дефолт для поля "Назва документа".
function stripExtension(name) {
  if (!name) return '';
  return name.replace(/\.[^.]+$/, '');
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
