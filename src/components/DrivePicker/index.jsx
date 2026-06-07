// ── DrivePicker (TASK 4 · етап B — винос зі AddDocumentModal) ────────────────
// Спільний inline-браузер Drive з breadcrumb. Винесено з AddDocumentModal.jsx
// без зміни поведінки (модалка стала тонким оркестратором). B2 зведе сюди другу
// копію з DocumentProcessorV2/DrivePicker.jsx (конфіг single/multi, modal/inline).
//
// Три режими (mode):
//   'myDrive'      — навігація по папках Мого Drive (q='<folderId>' in parents)
//   'sharedWithMe' — плоский список (q='sharedWithMe=true')
//   'sharedDrives' — список спільних дисків, потім всередині них
// folderId і sharedDriveCtx — спільні координати "де ми зараз".
// breadcrumb — обчислюється підняттям по parents[] до кореня (правило #8: без
// кирилиці в q=, тут і немає — тільки id-фільтри).
// Параметр selectionMode керує поведінкою:
//   'single'        — один клік по файлу одразу обирає (default, як було)
//   'multi-images'  — checkbox біля файлів, фільтрація mimeType image/*,
//                     кнопка "Обрати N зображень" внизу. onPickMulti(files[])
//                     викликається при підтвердженні. Папки відкриваються
//                     як зазвичай — checkbox тільки на файлах.
import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronDown, Cloud } from 'lucide-react';
import { Button } from '../UI';
import { ICON_SIZE } from '../UI/icons.js';
import { driveRequest } from '../../services/driveAuth.js';
import { SourceSwitcher } from './SourceSwitcher.jsx';
import { Breadcrumb } from './Breadcrumb.jsx';
import { DriveList } from './DriveList.jsx';
import { FOLDER_MIME, PAGE_LIMIT, multiPlural } from './helpers.js';
import './styles.css';

export function DrivePickerSection({ isOpen, initialFolderId, onToggle, onPick, onPickMulti, selectionMode = 'single' }) {
  const [mode, setMode] = useState('myDrive');
  const [folderId, setFolderId] = useState(initialFolderId || 'root');
  const [breadcrumb, setBreadcrumb] = useState([]);
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hitLimit, setHitLimit] = useState(false);
  const [sharedDrivesAvail, setSharedDrivesAvail] = useState(false);
  const [sharedDriveCtx, setSharedDriveCtx] = useState(null);
  // Multi-select state: Map<fileId, file> для збереження metadata вибраних
  // навіть коли адвокат перейшов у іншу папку. Очищується при закритті picker.
  const [selectedFiles, setSelectedFiles] = useState(() => new Map());

  // Reset до дефолту щоразу при розкритті.
  useEffect(() => {
    if (!isOpen) return;
    setMode('myDrive');
    setFolderId(initialFolderId || 'root');
    setSharedDriveCtx(null);
    setSelectedFiles(new Map());
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
    // Multi-images: для файлів — toggle вибору, для папок — звичайна навігація.
    // Файли не-зображення у multi-images mode НЕ кликабельні (filtered у DriveList).
    if (!isFolder && selectionMode === 'multi-images') {
      setSelectedFiles((prev) => {
        const next = new Map(prev);
        if (next.has(item.id)) next.delete(item.id);
        else next.set(item.id, item);
        return next;
      });
      return;
    }
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

  function handleConfirmMulti() {
    if (selectedFiles.size === 0) return;
    if (typeof onPickMulti === 'function') {
      onPickMulti(Array.from(selectedFiles.values()));
    }
    setSelectedFiles(new Map());
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
            selectionMode={selectionMode}
            selectedFiles={selectedFiles}
          />

          {selectionMode === 'multi-images' && (
            <div className="add-document-modal__drive-multi-footer">
              <span className="add-document-modal__drive-multi-count">
                Обрано {selectedFiles.size}
              </span>
              <Button
                variant="primary"
                size="sm"
                onClick={handleConfirmMulti}
                disabled={selectedFiles.size === 0}
              >
                Обрати {selectedFiles.size} зображен{multiPlural(selectedFiles.size)}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
