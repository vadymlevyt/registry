import { useState, useEffect, useCallback } from 'react';
import {
  Upload,
  Paperclip,
  X,
  Cloud,
  ChevronRight,
  ChevronDown,
  Folder,
  FileText,
  HardDrive,
  Users,
  Image as ImageIcon,
  ArrowLeft,
} from 'lucide-react';
import { Modal, Input, Select, Toggle, Button } from '../UI';
import { ICON_SIZE } from '../UI/icons.js';
import { driveRequest } from '../../services/driveAuth.js';
import { toast } from '../../services/toast.js';
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

// Підтримувані типи для кнопки "Додати файл" (single). Збігається з MIME-чеками
// у converterService — PDF / HTML / DOCX / image (HEIC iPhone). Інші формати
// (XLSX, ZIP, MD, TXT) залишаються у списку для passthrough — Drive iframe
// покаже preview, OCR pipeline пропустить їх.
const ACCEPT_FILE_TYPES = '.pdf,.jpeg,.jpg,.png,.heic,.webp,.docx,.xlsx,.pptx,.zip,.md,.txt,.html,.htm';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const PAGE_LIMIT = 100;

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
  // mode: null = стартовий екран з двома кнопками; 'single' = форма для
  // одного документа; 'merge' (TASK B) = склейка кількох зображень.
  const [mode, setMode] = useState(null);

  // Drive picker — окрема гілка від device file picker. Render-гейт зберігається:
  // секція з'являється тільки коли в каси є папка 01_ОРИГІНАЛИ (точка дефолту).
  // Сам файломенеджер всередині дозволяє вільно навігувати по всьому Drive.
  const driveFolderId = caseData?.storage?.subFolders?.['01_ОРИГІНАЛИ'];
  const [drivePickerOpen, setDrivePickerOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setState(initialState(caseData));
      setTouched(false);
      setSubmitting(false);
      setDragOver(false);
      setDrivePickerOpen(false);
      setMode(null);
    }
  }, [isOpen, caseData]);

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
    // TASK B — склейка зображень з агентом сортування. Поки що — плейсхолдер.
    toast.show('Склейка зображень буде доступна у наступній версії');
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
            comingSoon
          />
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

        {driveFolderId && !state.file && (
          <DrivePickerSection
            isOpen={drivePickerOpen}
            initialFolderId={driveFolderId}
            onToggle={() => setDrivePickerOpen((v) => !v)}
            onPick={handleDrivePick}
          />
        )}
      </div>
    </Modal>
  );
}

// ── DRIVE PICKER (file manager with breadcrumb) ─────────────────────────────
// Три режими (mode):
//   'myDrive'      — навігація по папках Мого Drive (q='<folderId>' in parents)
//   'sharedWithMe' — плоский список (q='sharedWithMe=true')
//   'sharedDrives' — список спільних дисків, потім всередині них
// folderId і sharedDriveCtx — спільні координати "де ми зараз".
// breadcrumb — обчислюється підняттям по parents[] до кореня (правило #8: без
// кирилиці в q=, тут і немає — тільки id-фільтри).
function DrivePickerSection({ isOpen, initialFolderId, onToggle, onPick }) {
  const [mode, setMode] = useState('myDrive');
  const [folderId, setFolderId] = useState(initialFolderId || 'root');
  const [breadcrumb, setBreadcrumb] = useState([]);
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hitLimit, setHitLimit] = useState(false);
  const [sharedDrivesAvail, setSharedDrivesAvail] = useState(false);
  const [sharedDriveCtx, setSharedDriveCtx] = useState(null);

  // Reset до дефолту щоразу при розкритті.
  useEffect(() => {
    if (!isOpen) return;
    setMode('myDrive');
    setFolderId(initialFolderId || 'root');
    setSharedDriveCtx(null);
  }, [isOpen, initialFolderId]);

  // Одноразова перевірка чи є хоч один Shared Drive — щоб показати/сховати чип.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await driveRequest(
          'https://www.googleapis.com/drive/v3/drives?pageSize=10'
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setSharedDrivesAvail((data.drives || []).length > 0);
      } catch (e) {}
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  const buildBreadcrumb = useCallback(async (fid) => {
    if (mode === 'sharedWithMe' && !fid) {
      setBreadcrumb([{ id: '__sharedWithMe__', name: 'Поділилися зі мною' }]);
      return;
    }
    if (mode === 'sharedDrives' && !sharedDriveCtx) {
      setBreadcrumb([{ id: '__sharedDrives__', name: 'Спільні Drive' }]);
      return;
    }
    if (mode === 'myDrive' && fid === 'root') {
      setBreadcrumb([{ id: 'root', name: 'Мій Drive' }]);
      return;
    }
    // Walk up parents[] від fid до кореня. Зупиняємось на parents.length===0
    // або на помилці запиту (parent поза доступом). reachedRoot — чи дійшли
    // до самого верху My Drive (тоді нормалізуємо назву кореня).
    const path = [];
    let current = fid;
    let safety = 12;
    let reachedRoot = false;
    const sharedParam = sharedDriveCtx ? '&supportsAllDrives=true' : '';
    while (current && safety-- > 0) {
      try {
        const res = await driveRequest(
          `https://www.googleapis.com/drive/v3/files/${current}?fields=id,name,parents${sharedParam}`
        );
        if (!res.ok) break;
        const data = await res.json();
        path.unshift({ id: data.id, name: data.name });
        if (!data.parents || data.parents.length === 0) {
          reachedRoot = true;
          break;
        }
        current = data.parents[0];
      } catch (e) {
        break;
      }
    }
    if (mode === 'sharedDrives' && sharedDriveCtx) {
      setBreadcrumb([
        { id: '__sharedDrives__', name: 'Спільні Drive' },
        ...path,
      ]);
    } else if (mode === 'sharedWithMe') {
      setBreadcrumb([
        { id: '__sharedWithMe__', name: 'Поділилися зі мною' },
        ...path,
      ]);
    } else {
      // myDrive: якщо реально дійшли до кореня — Drive повертає name="My Drive"
      // (або "Мій диск" локалізовано). Нормалізуємо до "Мій Drive" для UX.
      if (reachedRoot && path.length > 0) {
        path[0] = { id: 'root', name: 'Мій Drive' };
      } else if (!reachedRoot) {
        // Walk зупинився раніше (parent поза доступом) — додамо явний "Мій Drive"
        // зверху, щоб користувач міг повернутись на корінь.
        path.unshift({ id: 'root', name: 'Мій Drive' });
      }
      setBreadcrumb(path.length > 0 ? path : [{ id: 'root', name: 'Мій Drive' }]);
    }
  }, [mode, sharedDriveCtx]);

  const loadFolder = useCallback(async (fid) => {
    setLoading(true);
    setError(null);
    setHitLimit(false);
    try {
      const q = `'${fid}' in parents and trashed=false`;
      const sharedParams = sharedDriveCtx
        ? `&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=${sharedDriveCtx.id}`
        : '';
      const url =
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
        `&fields=files(id,name,mimeType,size,modifiedTime)` +
        `&pageSize=${PAGE_LIMIT}&orderBy=folder,name${sharedParams}`;
      const res = await driveRequest(url);
      if (res.status === 401) {
        setError('auth');
        setItems([]);
        return;
      }
      if (!res.ok) {
        setError('http');
        setItems([]);
        return;
      }
      const data = await res.json();
      const files = data.files || [];
      setItems(files);
      setHitLimit(files.length >= PAGE_LIMIT);
    } catch (e) {
      setError('network');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [sharedDriveCtx]);

  const loadSharedWithMe = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHitLimit(false);
    try {
      const q = 'sharedWithMe=true and trashed=false';
      const url =
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
        `&fields=files(id,name,mimeType,size,modifiedTime)` +
        `&pageSize=${PAGE_LIMIT}&orderBy=folder,modifiedTime desc`;
      const res = await driveRequest(url);
      if (res.status === 401) { setError('auth'); setItems([]); return; }
      if (!res.ok) { setError('http'); setItems([]); return; }
      const data = await res.json();
      const files = data.files || [];
      setItems(files);
      setHitLimit(files.length >= PAGE_LIMIT);
    } catch (e) {
      setError('network');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDrivesList = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHitLimit(false);
    try {
      const res = await driveRequest(
        'https://www.googleapis.com/drive/v3/drives?pageSize=100'
      );
      if (res.status === 401) { setError('auth'); setItems([]); return; }
      if (!res.ok) { setError('http'); setItems([]); return; }
      const data = await res.json();
      const drives = (data.drives || []).map((d) => ({
        id: d.id,
        name: d.name,
        mimeType: FOLDER_MIME,
        __isSharedDrive: true,
      }));
      setItems(drives);
    } catch (e) {
      setError('network');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Завантаження після зміни координат (mode/folderId/sharedDriveCtx).
  useEffect(() => {
    if (!isOpen) return;
    if (mode === 'sharedWithMe' && !sharedDriveCtx && folderId === null) {
      loadSharedWithMe();
      buildBreadcrumb(null);
    } else if (mode === 'sharedDrives' && !sharedDriveCtx) {
      loadDrivesList();
      buildBreadcrumb(null);
    } else {
      loadFolder(folderId);
      buildBreadcrumb(folderId);
    }
  }, [isOpen, mode, folderId, sharedDriveCtx, loadFolder, loadSharedWithMe, loadDrivesList, buildBreadcrumb]);

  function handleSourceChange(nextMode) {
    if (nextMode === mode && !sharedDriveCtx) return;
    setMode(nextMode);
    setSharedDriveCtx(null);
    if (nextMode === 'myDrive') setFolderId('root');
    else if (nextMode === 'sharedWithMe') setFolderId(null);
    else if (nextMode === 'sharedDrives') setFolderId(null);
  }

  function handleItemClick(item) {
    const isFolder = item.mimeType === FOLDER_MIME;
    if (!isFolder) {
      onPick(item);
      return;
    }
    if (item.__isSharedDrive) {
      setSharedDriveCtx({ id: item.id, name: item.name });
      setMode('sharedDrives');
      setFolderId(item.id);
      return;
    }
    setFolderId(item.id);
  }

  function handleCrumbClick(crumb) {
    if (crumb.id === '__sharedWithMe__') {
      setMode('sharedWithMe');
      setSharedDriveCtx(null);
      setFolderId(null);
      return;
    }
    if (crumb.id === '__sharedDrives__') {
      setMode('sharedDrives');
      setSharedDriveCtx(null);
      setFolderId(null);
      return;
    }
    // Якщо ми всередині shared drive і клікаємо на ID самого drive root —
    // sharedDriveCtx залишається. Інакше — звичайна my-drive навігація.
    setFolderId(crumb.id);
  }

  function handleRetry() {
    if (mode === 'sharedWithMe' && !sharedDriveCtx) loadSharedWithMe();
    else if (mode === 'sharedDrives' && !sharedDriveCtx) loadDrivesList();
    else loadFolder(folderId);
  }

  return (
    <div className="add-document-modal__drive-section">
      <button
        type="button"
        className="add-document-modal__drive-toggle"
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        {isOpen ? <ChevronDown size={ICON_SIZE.sm} /> : <ChevronRight size={ICON_SIZE.sm} />}
        <Cloud size={ICON_SIZE.sm} />
        <span>Або вибрати файл вже на Drive</span>
      </button>

      {isOpen && (
        <div className="add-document-modal__drive-browser">
          <SourceSwitcher
            mode={mode}
            sharedDrivesAvail={sharedDrivesAvail}
            onChange={handleSourceChange}
          />

          <Breadcrumb crumbs={breadcrumb} onClick={handleCrumbClick} />

          <DriveList
            items={items}
            loading={loading}
            error={error}
            hitLimit={hitLimit}
            onItemClick={handleItemClick}
            onRetry={handleRetry}
          />
        </div>
      )}
    </div>
  );
}

function SourceSwitcher({ mode, sharedDrivesAvail, onChange }) {
  return (
    <div className="add-document-modal__drive-sources" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'myDrive'}
        className={
          'add-document-modal__drive-source-chip' +
          (mode === 'myDrive' ? ' add-document-modal__drive-source-chip--active' : '')
        }
        onClick={() => onChange('myDrive')}
      >
        <HardDrive size={ICON_SIZE.sm} />
        Мій Drive
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'sharedWithMe'}
        className={
          'add-document-modal__drive-source-chip' +
          (mode === 'sharedWithMe' ? ' add-document-modal__drive-source-chip--active' : '')
        }
        onClick={() => onChange('sharedWithMe')}
      >
        <Users size={ICON_SIZE.sm} />
        Поділилися зі мною
      </button>
      {sharedDrivesAvail && (
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'sharedDrives'}
          className={
            'add-document-modal__drive-source-chip' +
            (mode === 'sharedDrives' ? ' add-document-modal__drive-source-chip--active' : '')
          }
          onClick={() => onChange('sharedDrives')}
        >
          <Cloud size={ICON_SIZE.sm} />
          Спільні Drive
        </button>
      )}
    </div>
  );
}

function Breadcrumb({ crumbs, onClick }) {
  if (!crumbs || crumbs.length === 0) return null;
  return (
    <div className="add-document-modal__drive-crumbs" aria-label="Шлях у Drive">
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={`${c.id}-${i}`} className="add-document-modal__drive-crumb-row">
            {i > 0 && (
              <ChevronRight
                size={ICON_SIZE.sm}
                className="add-document-modal__drive-crumb-sep"
              />
            )}
            <button
              type="button"
              className={
                'add-document-modal__drive-crumb' +
                (isLast ? ' add-document-modal__drive-crumb--current' : '')
              }
              onClick={() => onClick(c)}
              disabled={isLast}
              title={c.name}
            >
              {c.name}
            </button>
          </span>
        );
      })}
    </div>
  );
}

function DriveList({ items, loading, error, hitLimit, onItemClick, onRetry }) {
  return (
    <div className="add-document-modal__drive-list">
      {loading && (
        <div className="add-document-modal__drive-empty">Завантаження...</div>
      )}
      {!loading && error === 'auth' && (
        <div className="add-document-modal__drive-empty">
          Перепідключіть Drive — токен застарів.
          <button
            type="button"
            className="add-document-modal__drive-retry"
            onClick={onRetry}
          >
            Спробувати ще
          </button>
        </div>
      )}
      {!loading && error === 'network' && (
        <div className="add-document-modal__drive-empty">
          Не вдалось завантажити список з Drive.
          <button
            type="button"
            className="add-document-modal__drive-retry"
            onClick={onRetry}
          >
            Повторити
          </button>
        </div>
      )}
      {!loading && error === 'http' && (
        <div className="add-document-modal__drive-empty">
          Помилка Drive API.
          <button
            type="button"
            className="add-document-modal__drive-retry"
            onClick={onRetry}
          >
            Повторити
          </button>
        </div>
      )}
      {!loading && !error && items?.length === 0 && (
        <div className="add-document-modal__drive-empty">Папка порожня</div>
      )}
      {!loading && !error && items?.map((item) => (
        <DriveListItem
          key={item.id}
          item={item}
          onClick={() => onItemClick(item)}
        />
      ))}
      {!loading && !error && hitLimit && (
        <div className="add-document-modal__drive-hint">
          Показано {PAGE_LIMIT}. Перейдіть у вкладену папку щоб уточнити.
        </div>
      )}
    </div>
  );
}

function DriveListItem({ item, onClick }) {
  const isFolder = item.mimeType === FOLDER_MIME;
  const sizeLabel = !isFolder && item.size
    ? `${(parseInt(item.size, 10) / 1024).toFixed(0)} КБ`
    : null;
  const dateLabel = item.modifiedTime
    ? new Date(item.modifiedTime).toLocaleDateString('uk-UA', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      })
    : null;
  const meta = [sizeLabel, dateLabel].filter(Boolean).join(' • ');
  return (
    <button
      type="button"
      className={
        'add-document-modal__drive-item' +
        (isFolder ? ' add-document-modal__drive-item--folder' : '')
      }
      onClick={onClick}
    >
      {isFolder ? <Folder size={ICON_SIZE.sm} /> : <FileText size={ICON_SIZE.sm} />}
      <div className="add-document-modal__drive-item-info">
        <div className="add-document-modal__drive-item-name">{item.name}</div>
        {meta && (
          <div className="add-document-modal__drive-item-meta">{meta}</div>
        )}
      </div>
    </button>
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
