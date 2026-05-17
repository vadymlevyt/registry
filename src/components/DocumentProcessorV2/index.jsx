// ── DP-4 · DOCUMENT PROCESSOR V2 (4 зони) ───────────────────────────────────
// Перша зустріч адвоката з новим pipeline. Уся DP-1/2/3 інфраструктура
// підключена через useDocumentPipeline() (DocumentPipelineProvider). Тільки
// CSS-токени (styles.css), іконки lucide-react, нуль inline-стилів, нуль
// hardcoded preview — усі стани з реальних даних (run result / jobProgressStore).
//
// Behavior-preserve: AddDocumentModal single-file flow ЖИВЕ у вкладці
// «Матеріали» і НЕ зачіпається — DP v2 це ОКРЕМА вкладка «Робота з документами».
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Wrench, Upload, FolderOpen, FileText, FileArchive, Play, Trash2,
  Check, AlertCircle,
} from 'lucide-react';
import { ICON_SIZE } from '../UI/icons.js';
import { Button, Toggle, Tabs } from '../UI';
import { toast } from '../../services/toast.js';
import { driveRequest } from '../../services/driveAuth.js';
import { readDriveFileBytes } from '../../services/driveService.js';
import { getSplitterDatasetEnabled, setSplitterDatasetEnabled } from '../../services/tenantService.js';
import { useDocumentPipeline } from '../../contexts/DocumentPipelineContext.jsx';
import { useJobProgress } from './useJobProgress.js';
import { ProgressFullScreen } from './ProgressFullScreen.jsx';
import { DrivePicker } from './DrivePicker.jsx';
import { RecognizeTextModal } from './modals/RecognizeTextModal.jsx';
import { CompressFilesModal } from './modals/CompressFilesModal.jsx';
import { InboxConflictModal } from './modals/InboxConflictModal.jsx';
import { CancelDecisionModal } from './modals/CancelDecisionModal.jsx';
import './styles.css';

const INBOX_FOLDER = '00_INBOX_СПРАВИ';

const DEFAULT_SETTINGS = {
  organizeByProceedings: true,   // 1
  integrityCheck: true,          // 2
  cleanForReading: true,         // 3 → extractV3
  generateSummary: true,         // 4
  compressAll: false,            // 5
  suggestDeadlines: false,       // 6
  updateCaseContext: true,       // 7
  fillCaseCard: false,           // 8
};

let keySeq = 0;
const nextKey = () => `f${Date.now()}_${keySeq++}`;

function humanSize(b) {
  if (!b) return '';
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} КБ`;
  return `${(b / 1024 / 1024).toFixed(1)} МБ`;
}

export default function DocumentProcessorV2({ caseData, onExecuteAction, driveConnected }) {
  const pipeline = useDocumentPipeline();
  const jobs = useJobProgress();
  const activeJob = useMemo(
    () => jobs.find((j) => j.caseId === caseData?.id) || null,
    [jobs, caseData],
  );

  const [selected, setSelected] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [resultTab, setResultTab] = useState('tree');
  const [dragOver, setDragOver] = useState(false);
  const [minimized, setMinimized] = useState(false);

  const [inboxFiles, setInboxFiles] = useState([]);
  const [inboxChecked, setInboxChecked] = useState(() => new Set());
  const [datasetEnabled, setDatasetEnabled] = useState(() => getSplitterDatasetEnabled());

  const toggleDataset = (v) => { setSplitterDatasetEnabled(v); setDatasetEnabled(v); };

  const [drivePickerOpen, setDrivePickerOpen] = useState(false);
  const [recognizeOpen, setRecognizeOpen] = useState(false);
  const [compressOpen, setCompressOpen] = useState(false);
  const [inboxConflict, setInboxConflict] = useState(null); // {newCount} | null
  const [cancelInfo, setCancelInfo] = useState(null);        // {jobId,readyCount} | null

  const fileInputRef = useRef(null);

  // ── INBOX list (00_INBOX_СПРАВИ) ──────────────────────────────────────────
  const loadInbox = useCallback(async () => {
    const folderId = caseData?.storage?.subFolders?.[INBOX_FOLDER];
    if (!folderId || !driveConnected) { setInboxFiles([]); return; }
    try {
      const q = `'${folderId}' in parents and trashed=false`;
      const res = await driveRequest(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size)&pageSize=1000`,
      );
      if (!res.ok) return;
      const data = await res.json();
      setInboxFiles((data.files || []).filter((f) => f.mimeType !== 'application/vnd.google-apps.folder'));
    } catch { /* INBOX порожній/недоступний — не критично */ }
  }, [caseData, driveConnected]);

  useEffect(() => { loadInbox(); }, [loadInbox]);

  // ── Зона 1 · додавання файлів ─────────────────────────────────────────────
  const addDeviceFiles = (fileList) => {
    const arr = Array.from(fileList || []);
    if (arr.length === 0) return;
    setSelected((prev) => [
      ...prev,
      ...arr.map((f) => ({
        key: nextKey(), name: f.name, size: f.size, mime: f.type,
        origin: 'device', file: f,
      })),
    ]);
  };

  const addDriveFiles = (picked) => {
    setSelected((prev) => [
      ...prev,
      ...picked.map((p) => ({
        key: nextKey(), name: p.name, size: p.size, mime: p.mime,
        origin: 'drive', driveId: p.driveId,
      })),
    ]);
  };

  const removeSelected = (key) => setSelected((prev) => prev.filter((s) => s.key !== key));

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) addDeviceFiles(e.dataTransfer.files);
  };

  const toggleInbox = (id) => {
    setInboxChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Файли для запуску: selected + відмічені INBOX.
  const inboxSelected = inboxFiles.filter((f) => inboxChecked.has(f.id));
  const totalCount = selected.length + inboxSelected.length;

  // ── Зона 2 · оцінка часу/вартості ─────────────────────────────────────────
  const estimate = useMemo(() => {
    if (totalCount === 0) return null;
    const minMin = Math.max(1, Math.round(1 + totalCount * 0.5));
    const maxMin = Math.max(minMin, Math.round(1 + totalCount * 0.9));
    const cost = (totalCount * 0.05).toFixed(2);
    return { minMin, maxMin, cost };
  }, [totalCount]);

  const setToggle = (k) => (v) => setSettings((s) => ({ ...s, [k]: v }));

  // ── Запуск обробки ────────────────────────────────────────────────────────
  const buildRunInput = async () => {
    const files = [];
    for (const s of selected) {
      if (s.origin === 'device') {
        files.push({
          fileId: s.key, name: s.name, size: s.size,
          originalMime: s.mime || null, raw: s.file,
        });
      } else if (s.driveId) {
        const ab = await readDriveFileBytes(s.driveId);
        files.push({
          fileId: s.key, name: s.name, size: s.size,
          originalMime: s.mime || 'application/pdf', arrayBuffer: ab,
        });
      }
    }
    for (const f of inboxSelected) {
      const ab = await readDriveFileBytes(f.id);
      files.push({
        fileId: `inbox_${f.id}`, name: f.name, size: Number(f.size) || 0,
        originalMime: f.mimeType || 'application/pdf', arrayBuffer: ab,
      });
    }
    return {
      caseId: caseData.id,
      caseData,
      agentId: 'document_processor_agent',
      source: 'manual',
      addedBy: 'user',
      files,
    };
  };

  const startProcessing = async () => {
    if (totalCount === 0 || running) return;
    // Конфлікт INBOX: є нові (device/drive) файли і INBOX непорожній.
    if (selected.length > 0 && inboxFiles.length > 0 && !inboxConflict?.resolved) {
      setInboxConflict({ newCount: selected.length });
      return;
    }
    setRunning(true);
    setResult(null);
    setMinimized(false);
    try {
      const input = await buildRunInput();
      if (input.files.length === 0) { toast.warning('Немає файлів для обробки'); setRunning(false); return; }
      const options = {
        ...settings,
        autoConfirm: true,
        collectDataset: getSplitterDatasetEnabled(),
        fragmentsCombined: false,
      };
      const res = await pipeline.run(input, options);
      if (res?.cancelled) {
        setCancelInfo({ jobId: res.jobId, readyCount: (res.readyDocuments || []).length });
      } else if (res?.blocked) {
        toast.error('Недостатньо місця на Drive', { description: res.error?.message });
      } else if (res?.ok) {
        setResult(res);
        setResultTab('tree');
        toast.success(`Оброблено: ${res.documents?.length || 0} документів`);
        setSelected([]);
        setInboxChecked(new Set());
        loadInbox();
      } else {
        setResult(res);
        setResultTab('attention');
        toast.error('Обробка завершилась з помилками', {
          description: res?.errors?.[0]?.message,
        });
      }
    } catch (e) {
      toast.error('Не вдалось запустити обробку', { description: e?.message });
    } finally {
      setRunning(false);
    }
  };

  const resolveInboxConflict = (choice) => {
    setInboxConflict(null);
    if (choice === 'later') return;                 // лишити в INBOX
    if (choice === 'new_only') setInboxChecked(new Set());  // не чіпати INBOX
    // 'all' → нічого не змінюємо (відмічені INBOX лишаються)
    setInboxConflict({ resolved: true });
    setTimeout(() => startProcessing(), 0);
  };

  const onCancelJob = (jobId) => { pipeline.cancel(jobId); };

  const finishCancel = async (mode) => {
    const info = cancelInfo;
    setCancelInfo(null);
    if (!info) return;
    try {
      if (mode === 'keep') await pipeline.keepPartial(caseData.id, info.jobId);
      else await pipeline.discardAll(caseData.id, info.jobId);
      toast.success(mode === 'keep' ? 'Готові документи збережено' : 'Усе видалено');
    } catch (e) {
      toast.error('Не вдалось завершити скасування', { description: e?.message });
    }
  };

  // ── Зона 3 дані ───────────────────────────────────────────────────────────
  const docs = result?.documents || [];
  const decisions = result?.decisions || [];
  const errors = result?.errors || [];
  const unusedPages = useMemo(() => {
    const d = decisions.find((x) => Array.isArray(x.unusedPages) && x.unusedPages.length > 0);
    return d?.unusedPages || [];
  }, [decisions]);
  const attentionCount = errors.length
    + decisions.filter((d) => d.type === 'text_clean_failed' || d.type === 'document_split_skipped').length;

  const showProgress = (running || activeJob) && !minimized;

  return (
    <div className="dpv2">
      {/* Header — Wrench + назва + швидкі функції (Варіант 1) */}
      <div className="dpv2-header">
        <span className="dpv2-title">
          <Wrench size={ICON_SIZE.md} aria-hidden="true" />
          Робота з документами
        </span>
        <span className="dpv2-quick">
          <Button variant="secondary" size="sm" icon={<FileText size={ICON_SIZE.sm} />} onClick={() => setRecognizeOpen(true)}>
            Розпізнати текст
          </Button>
          <Button variant="secondary" size="sm" icon={<FileArchive size={ICON_SIZE.sm} />} onClick={() => setCompressOpen(true)}>
            Стиснути файл(и)
          </Button>
        </span>
      </div>

      <div className="dpv2-body">
        {/* ── Зона 1 · Вхідна ──────────────────────────────────────────── */}
        <section className="dpv2-zone" aria-label="Вхідна">
          <div className="dpv2-zone-title">Зона 1 · Вхідна</div>
          <div
            className={`dpv2-dropzone${dragOver ? ' dpv2-dropzone--over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
          >
            <div className="dpv2-dropzone-icon"><Upload size={ICON_SIZE.xl} /></div>
            <div>Перетягніть файли сюди або натисніть щоб вибрати</div>
            <div className="dpv2-dropzone-hint">PDF, JPG, PNG, HEIC, DOCX, XLSX, PPTX, RTF, ODT, TXT, MD, ZIP, RAR, 7z</div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="dpv2-hidden-input"
            onChange={(e) => { addDeviceFiles(e.target.files); e.target.value = ''; }}
          />
          <div className="dpv2-input-buttons">
            <Button variant="secondary" size="sm" icon={<Upload size={ICON_SIZE.sm} />} onClick={() => fileInputRef.current?.click()}>
              Вибрати файли
            </Button>
            <Button variant="secondary" size="sm" icon={<FolderOpen size={ICON_SIZE.sm} />} disabled={!driveConnected} onClick={() => setDrivePickerOpen(true)}>
              З Google Drive
            </Button>
          </div>

          {selected.length > 0 && (
            <>
              <div className="dpv2-section-label">Вибрані файли ({selected.length})</div>
              <div className="dpv2-list">
                {selected.map((s) => (
                  <div key={s.key} className="dpv2-list-row">
                    <FileText size={ICON_SIZE.sm} />
                    <span className="dpv2-grow">{s.name}</span>
                    <span className="dpv2-list-meta">{humanSize(s.size)}</span>
                    <button className="dpv2-iconbtn" onClick={() => removeSelected(s.key)} aria-label="Прибрати">
                      <Trash2 size={ICON_SIZE.sm} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {inboxFiles.length > 0 && (
            <>
              <div className="dpv2-section-label">00_INBOX справи ({inboxFiles.length})</div>
              <div className="dpv2-list">
                {inboxFiles.map((f) => (
                  <label key={f.id} className="dpv2-list-row" style={{ cursor: 'pointer' }}>
                    <input type="checkbox" checked={inboxChecked.has(f.id)} onChange={() => toggleInbox(f.id)} />
                    <FileText size={ICON_SIZE.sm} />
                    <span className="dpv2-grow">{f.name}</span>
                    <span className="dpv2-list-meta">{humanSize(Number(f.size) || 0)}</span>
                  </label>
                ))}
              </div>
            </>
          )}
          {inboxFiles.length === 0 && selected.length === 0 && (
            <div className="dpv2-muted">Жодного файлу не вибрано.</div>
          )}
        </section>

        {/* ── Зона 2 · Налаштування ────────────────────────────────────── */}
        <section className="dpv2-zone" aria-label="Налаштування">
          <div className="dpv2-zone-title">Зона 2 · Налаштування</div>

          <div className="dpv2-settings-group">
            <div className="dpv2-section-label">ОРГАНІЗАЦІЯ</div>
            <Toggle label="Розкласти по провадженнях" checked={settings.organizeByProceedings} onChange={setToggle('organizeByProceedings')} />
            <Toggle label="Перевірка цілісності перед обробкою" checked={settings.integrityCheck} onChange={setToggle('integrityCheck')} />
          </div>
          <div className="dpv2-settings-group">
            <div className="dpv2-section-label">ЯКІСТЬ ТЕКСТУ</div>
            <Toggle label="Очистити для читання" description="через Haiku" checked={settings.cleanForReading} onChange={setToggle('cleanForReading')} />
            <Toggle label="Згенерувати короткий зміст" checked={settings.generateSummary} onChange={setToggle('generateSummary')} />
          </div>
          <div className="dpv2-settings-group">
            <div className="dpv2-section-label">ДОДАТКОВІ ДІЇ</div>
            <Toggle label="Стиснути всі файли пакета" checked={settings.compressAll} onChange={setToggle('compressAll')} />
            <Toggle label="Запропонувати дедлайни з документів" checked={settings.suggestDeadlines} onChange={setToggle('suggestDeadlines')} />
            <Toggle label="Оновити case_context.md" checked={settings.updateCaseContext} onChange={setToggle('updateCaseContext')} />
            <Toggle label="Заповнити картку справи з документів" checked={settings.fillCaseCard} onChange={setToggle('fillCaseCard')} />
          </div>

          <div className="dpv2-settings-group">
            <div className="dpv2-section-label">ВЛАСНА МОДЕЛЬ НАРІЗКИ</div>
            <Toggle
              label="Накопичувати приклади нарізки для тренування власної моделі"
              checked={datasetEnabled}
              onChange={toggleDataset}
            />
            {datasetEnabled && (
              <div className="dpv2-counter">
                Збір увімкнено — приклади додаються у _datasets після кожної обробки.
              </div>
            )}
            <div className="dpv2-disclaimer">
              Увімкнувши збір датасету, ви зберігаєте розпізнаний текст, межі і
              метадані документів цієї справи для майбутнього навчання власного
              спліттера. Дані містять зміст матеріалів справи. Відповідальність
              за дотримання адвокатської таємниці і правомірність використання
              цих даних несе адвокат. Технічної анонімізації не виконується.
            </div>
          </div>

          <div className="dpv2-preview">
            <span>
              {estimate
                ? `~${estimate.minMin}-${estimate.maxMin} хвилин`
                : 'Оберіть файли для оцінки'}
            </span>
            {estimate && <strong>~${estimate.cost}</strong>}
          </div>
          <Button
            variant="primary"
            fullWidth
            disabled={totalCount === 0 || running}
            loading={running}
            icon={<Play size={ICON_SIZE.sm} />}
            onClick={startProcessing}
          >
            Розпочати обробку {totalCount > 0 ? `${totalCount} документів` : ''}
          </Button>
        </section>

        {/* ── Зона 3 · Аналіз і результат ──────────────────────────────── */}
        <section className="dpv2-zone dpv2-zone--results" aria-label="Аналіз і результат">
          <div className="dpv2-zone-title">Зона 3 · Аналіз і результат</div>
          <Tabs
            tabs={[
              { id: 'tree', label: 'Дерево' },
              { id: 'cutting', label: 'Нарізка' },
              { id: 'attention', label: 'Потребує уваги', badge: attentionCount || undefined },
            ]}
            activeId={resultTab}
            onChange={setResultTab}
          />
          <div className="dpv2-tabcontent">
            {!result && (
              <div className="dpv2-empty">
                <FileText size={32} />
                <span>Результат з'явиться після обробки.</span>
              </div>
            )}

            {result && resultTab === 'tree' && (
              <>
                <div className="dpv2-placeholder">
                  Дерево проваджень буде доступне після DP-6 (категоризація справи
                  і шаблони). Зараз — плоский список нарізаних документів.
                </div>
                {docs.map((d) => (
                  <div key={d.id} className="dpv2-list-row">
                    {d.isKey ? <span aria-hidden="true">⭐</span> : <FileText size={ICON_SIZE.sm} />}
                    <span className="dpv2-grow">{d.name}</span>
                    <span className="dpv2-list-meta">{d.category || '—'}</span>
                  </div>
                ))}
                {docs.length === 0 && <div className="dpv2-muted">Документів не створено.</div>}
              </>
            )}

            {result && resultTab === 'cutting' && (
              <>
                {docs.map((d) => (
                  <div key={d.id} className="dpv2-attention-card">
                    <strong>{d.name}</strong>
                    <div className="dpv2-muted">{d.category || 'тип не визначено'} · {d.pageCount || '?'} стор.</div>
                    <div className="dpv2-attention-actions">
                      <Button variant="secondary" size="sm" onClick={() => setCompressOpen(true)}>Стиснути</Button>
                      <Button variant="ghost" size="sm" disabled title="Інтерактивна нарізка — DP-6">Розділити</Button>
                      <Button variant="ghost" size="sm" disabled title="Об'єднання документів — DP-6">Об'єднати з…</Button>
                    </div>
                  </div>
                ))}
                {unusedPages.length > 0 && (
                  <>
                    <div className="dpv2-section-label">Невикористані сторінки ({unusedPages.length})</div>
                    {unusedPages.map((u, i) => (
                      <div key={i} className="dpv2-list-row">
                        <span className="dpv2-grow">Стор. {u.startPage}{u.endPage && u.endPage !== u.startPage ? `-${u.endPage}` : ''}</span>
                        <span className="dpv2-list-meta">{u.reason}</span>
                      </div>
                    ))}
                  </>
                )}
                <div className="dpv2-muted">Фрагменти зберігаються у 03_ФРАГМЕНТИ.</div>
              </>
            )}

            {result && resultTab === 'attention' && (
              <>
                <div className="dpv2-attention-group">
                  <div className="dpv2-section-label">Питання</div>
                  {decisions.filter((d) => d.type === 'text_clean_failed' || d.type === 'document_split_skipped').length === 0 && (
                    <div className="dpv2-muted">Питань немає.</div>
                  )}
                  {decisions
                    .filter((d) => d.type === 'text_clean_failed' || d.type === 'document_split_skipped')
                    .map((d, i) => (
                      <div key={i} className="dpv2-attention-card">{d.message}</div>
                    ))}
                </div>
                <div className="dpv2-attention-group">
                  <div className="dpv2-section-label">Помилки</div>
                  {errors.length === 0 && <div className="dpv2-muted">Помилок немає.</div>}
                  {errors.map((e, i) => (
                    <div key={i} className="dpv2-attention-card dpv2-attention-card--error">
                      <strong>{e.code}</strong>
                      <div>{e.message}</div>
                    </div>
                  ))}
                </div>
                {(errors.length > 0) && (
                  <div className="dpv2-attention-actions">
                    <Button variant="ghost" onClick={() => { setResult(null); }}>Залишити на потім</Button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </div>

      {/* ── Зона 4 · Повноекранний прогрес ───────────────────────────────── */}
      {showProgress && (
        <ProgressFullScreen
          job={activeJob || { jobId: 'pending', caseId: caseData?.id, title: 'Підготовка…', done: 0, total: 0, ratio: 0, status: 'running' }}
          caseData={caseData}
          onCancel={onCancelJob}
          onMinimize={() => setMinimized(true)}
        />
      )}

      <DrivePicker
        isOpen={drivePickerOpen}
        onClose={() => setDrivePickerOpen(false)}
        onPick={addDriveFiles}
        initialFolderId={caseData?.storage?.driveFolderId || 'root'}
      />
      <RecognizeTextModal
        isOpen={recognizeOpen}
        onClose={() => setRecognizeOpen(false)}
        caseData={caseData}
        onExecuteAction={onExecuteAction}
      />
      <CompressFilesModal
        isOpen={compressOpen}
        onClose={() => setCompressOpen(false)}
        caseData={caseData}
      />
      <InboxConflictModal
        isOpen={!!inboxConflict && !inboxConflict.resolved}
        inboxCount={inboxFiles.length}
        newCount={inboxConflict?.newCount || selected.length}
        onResolve={resolveInboxConflict}
        onClose={() => setInboxConflict(null)}
      />
      <CancelDecisionModal
        isOpen={!!cancelInfo}
        readyCount={cancelInfo?.readyCount || 0}
        onKeep={() => finishCancel('keep')}
        onDiscard={() => finishCancel('discard')}
        onClose={() => setCancelInfo(null)}
      />
    </div>
  );
}
