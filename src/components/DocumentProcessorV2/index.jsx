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
import { readDriveFileBytes, findOrCreateFolder, uploadBytesToDrive } from '../../services/driveService.js';
import { getSplitterDatasetEnabled, setSplitterDatasetEnabled, getCurrentUserId, getCurrentTenantId } from '../../services/tenantService.js';
import * as eventBus from '../../services/eventBus.js';
import { DOCUMENT_BATCH_PROCESSED } from '../../services/eventBusTopics.js';
import { useDocumentPipeline } from '../../contexts/DocumentPipelineContext.jsx';
import { DrivePicker } from '../DrivePicker/index.jsx';
import { RecognizeTextModal } from './modals/RecognizeTextModal.jsx';
import { CompressFilesModal } from './modals/CompressFilesModal.jsx';
import { InboxConflictModal } from './modals/InboxConflictModal.jsx';
import { CancelDecisionModal } from './modals/CancelDecisionModal.jsx';
import { DpImageMergeEditor } from './DpImageMergeEditor.jsx';
import { isImageFile } from '../ImageEditor/constants.js';
import { ProcessingProgress } from '../ImageEditor/ProcessingProgress.jsx';
import { prepareImagesForMerge } from '../../services/imageDocument/prepareImagesForMerge.js';
import { downscaleImage } from '../../services/imageDocument/downscaleImage.js';
import { groupImagesIntoDocuments } from '../../services/sortation/imageDocumentGrouper.js';
import { sortImageDocument } from '../../services/imageDocument/sortImageDocument.js';
import { rebuildFromOcrResults } from '../../services/imageDocument/pdfRebuild.js';
import { MODULES } from '../../services/moduleNames.js';
import { createDocument } from '../../services/documentFactory.js';
import { ensureUniqueName } from '../../services/sortation/imageSortingAgent.js';
import * as ocrService from '../../services/ocrService.js';
import { estimateCompressedSize, DEFAULT_COMPRESSION_PRESET } from '../../services/compression/imageCompressor.js';
import './styles.css';

function getApiKey() {
  try { return localStorage.getItem('claude_api_key'); } catch { return null; }
}

const INBOX_FOLDER = '00_INBOX_СПРАВИ';

const DEFAULT_SETTINGS = {
  organizeByProceedings: true,   // 1
  integrityCheck: true,          // 2
  // V2-A2: «Очистити для читання» прибрано — DP більше не чистить текст
  // (очистка стала справою в'ювера/ACTION на вимогу, parent §DP БІЛЬШЕ НЕ ЧИСТИТЬ).
  generateSummary: true,         // 3
  compressAll: false,            // 4
  suggestDeadlines: false,       // 5
  updateCaseContext: true,       // 6
  fillCaseCard: false,           // 7
  // 1C.2 — skipPdfSlicing: пропустити AI-нарізку (Triage) і per-file
  // маршрутизувати кожен живий файл: фото → image_merge solo, інше →
  // add_as_is solo. Працює і у міксі PDF+фото (інакше AI Triage поріже
  // PDF попри toggle). НЕ вимикає OCR, метадані, класифікацію.
  skipPdfSlicing: false,         // 9
  // TASK 4 етап D — skipOcr: «без OCR». Дійсний ЛИШЕ разом зі «Просто додати»
  // (add_as_is) — до НАРІЗКИ не застосовується (там OCR обов'язковий для меж).
  // Vision читає 1-2 стор. → пропонує метадані; артефактів у 02 не створюється.
  skipOcr: false,                // 10
};

let keySeq = 0;
const nextKey = () => `f${Date.now()}_${keySeq++}`;

function humanSize(b) {
  if (!b) return '';
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} КБ`;
  return `${(b / 1024 / 1024).toFixed(1)} МБ`;
}

// Фази важкої фото-обробки image-merge (для повноекранного ProcessingProgress).
// Ключі збігаються з phase із prepareImagesForMerge.onProgress
// (heic/downscale/ocr/rotate) + два кроки index.jsx після prepare
// (grouper/sort) — їх живимо вручну.
const IMAGE_MERGE_PHASES = [
  { key: 'heic', label: 'HEIC → JPEG' },
  { key: 'downscale', label: 'Зменшення' },
  { key: 'ocr', label: 'OCR' },
  { key: 'rotate', label: 'Орієнтація' },
  { key: 'grouper', label: 'Групування' },
  { key: 'sort', label: 'Сортування сторінок' },
];

export default function DocumentProcessorV2({ caseData, onExecuteAction, driveConnected, aiUsageSink }) {
  const pipeline = useDocumentPipeline();

  const [selected, setSelected] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [resultTab, setResultTab] = useState('tree');
  const [dragOver, setDragOver] = useState(false);

  const [inboxFiles, setInboxFiles] = useState([]);
  const [inboxChecked, setInboxChecked] = useState(() => new Set());
  const [datasetEnabled, setDatasetEnabled] = useState(() => getSplitterDatasetEnabled());

  const toggleDataset = (v) => { setSplitterDatasetEnabled(v); setDatasetEnabled(v); };

  const [drivePickerOpen, setDrivePickerOpen] = useState(false);
  const [recognizeOpen, setRecognizeOpen] = useState(false);
  const [compressOpen, setCompressOpen] = useState(false);
  const [inboxConflict, setInboxConflict] = useState(null); // {newCount} | null
  const [cancelInfo, setCancelInfo] = useState(null);        // {jobId,readyCount} | null

  // TASK 4 E крок 5 — прогноз розміру після стиснення. Map key→{applicable,
  // estimatedBytes}. Рахуємо ЛИШЕ коли тумблер УВІМК: стискаємо СЕМПЛ перших
  // 1-2 стор. → екстраполяція × pageCount (естимат з «~»). Тільки device-PDF
  // (Drive-source блоба не має — борг #40). Browser-only (canvas): у тесті/без
  // canvas тихо лишається без естимату (best-effort).
  const [sizeEstimates, setSizeEstimates] = useState({});
  // Дзеркало sizeEstimates у ref — щоб ефект-розрахунку перевіряв «вже пораховано»
  // БЕЗ sizeEstimates у своїх deps. Інакше кожен записаний естимат перезапускав
  // ефект → шторм паралельних pdfjs-рендерів (контенція/пам'ять → «через раз»).
  const sizeEstimatesRef = useRef({});

  // ── 1B image_merge_unify: окремий під-флоу для all-image вхідного набору ──
  // Коли всі обрані файли — image/*, DP перехоплює запуск ДО pipeline.run і
  // веде у власний редактор (prepareImagesForMerge + imageDocumentGrouper +
  // N-doc editor). PERSIST виконується ТІЛЬКИ після «Виконати» (правка плану
  // адвокатом — §4.1 DP візії, локально для image-merge сценарію). Стан
  // imageMerge={pre, groups, files, …} активний поки адвокат у редакторі;
  // null = звичайний DP flow (нарізка PDF / мікс).
  const [imageMerge, setImageMerge] = useState(null);
  // mergeProgress — видимий прогрес важкої фото-обробки (prepare/grouper/sort)
  // для image-merge режиму. { phase, done, total } | null. Локальний оверлей з
  // ProcessingProgress (variant="screen") — НЕ через jobProgressStore: image-merge
  // обходить pipeline.run, тож jobs порожні і Зона 4 (топбар/ProgressFullScreen)
  // тут інертна; цей оверлей заповнює прогалину, не дублюючи їх.
  const [mergeProgress, setMergeProgress] = useState(null);

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

  // TASK 4 E крок 5 — фоновий розрахунок прогнозу розміру для device-PDF, коли
  // тумблер «Стиснути» УВІМК. Семпл перших 1-2 стор. → екстраполяція. Скип:
  // вже пораховане (guard по key через ref, НЕ через deps), Drive-source (нема
  // блоба), не-PDF (рушій однаково пропустить). cancelled-прапор гасить race при
  // швидкій зміні набору.
  //
  // sizeEstimates СВІДОМО поза deps: інакше кожен записаний естимат перезапускав
  // ефект → шторм паралельних pdfjs-рендерів (контенція/пам'ять → нестабільний
  // прогноз «через раз / треба оновити»). Перевірка «вже пораховано» — через
  // sizeEstimatesRef (live-дзеркало). Рахується раз на файл, стабільно.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!settings.compressAll) return undefined;
    let cancelled = false;
    (async () => {
      for (const s of selected) {
        if (cancelled) return;
        if (sizeEstimatesRef.current[s.key]) continue;
        const isPdf = s.mime === 'application/pdf' || /\.pdf$/i.test(s.name || '');
        if (s.origin !== 'device' || !s.file || !isPdf) continue;
        try {
          const ab = await s.file.arrayBuffer();
          const est = await estimateCompressedSize(ab, { preset: DEFAULT_COMPRESSION_PRESET });
          if (cancelled) return;
          sizeEstimatesRef.current = { ...sizeEstimatesRef.current, [s.key]: est };
          setSizeEstimates((prev) => ({ ...prev, [s.key]: est }));
        } catch (e) {
          // best-effort: лишаємо файл без естимату, але не ковтаємо тихо
          console.warn('[DPv2] size estimate failed for', s.name, e);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [settings.compressAll, selected]);

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

  // B2: спільний DrivePicker віддає СИРІ Drive-обʼєкти ({id,name,mimeType,size}).
  // Мапимо у внутрішню форму selected[] (driveId/mime), яку читають buildRunInput
  // і startImageMergeProcessing. Толерантні до обох форм (raw і старої нормалізованої).
  const addDriveFiles = (picked) => {
    setSelected((prev) => [
      ...prev,
      ...picked.map((p) => ({
        key: nextKey(),
        name: p.name,
        size: Number(p.size) || 0,
        mime: p.mimeType || p.mime || null,
        origin: 'drive',
        driveId: p.id || p.driveId,
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

  // TASK 4 E крок 5 — підсумок прогнозу стиснення для пакета (сума по selected).
  // applicable естимат → estimatedBytes; інакше (текстовий/Drive/ще не пораховано)
  // → поточний розмір. Показуємо лише коли тумблер УВІМК і є хоч один естимат.
  const compressionForecast = useMemo(() => {
    if (!settings.compressAll || selected.length === 0) return null;
    let current = 0;
    let projected = 0;
    let hasEstimate = false;
    for (const s of selected) {
      const sz = Number(s.size) || 0;
      current += sz;
      const est = sizeEstimates[s.key];
      if (est && est.applicable && Number.isFinite(est.estimatedBytes)) {
        projected += est.estimatedBytes;
        hasEstimate = true;
      } else {
        projected += sz;
      }
    }
    return hasEstimate ? { current, projected } : null;
  }, [settings.compressAll, selected, sizeEstimates]);

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

  // ── 1C «просто додати» (add_as_is) · вхід для non-streaming труби ────────
  // Кожен файл → raw File (converterService приводить до PDF: HTML/DOCX →
  // searchable PDF, фото → imageToPdf, PDF → passthrough). Фото проходять
  // downscale (≤2400px) перед конвертацією — менший PDF, нижчий пік памʼяті.
  // Drive/INBOX-файли матеріалізуються у File (конвертер очікує File/Blob, а
  // не лише driveId — інакше DOCX/фото з Drive не сконвертувались би).
  const buildAddAsIsInput = async () => {
    const files = [];
    const materialize = async (origin) => {
      // origin: { key, name, mime, file?, driveId? } | INBOX {id,name,mimeType}
      let rawFile = null;
      if (origin.file) {
        rawFile = origin.file;
      } else if (origin.driveId || origin.id) {
        const id = origin.driveId || origin.id;
        const res = await driveRequest(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
        if (!res.ok) throw new Error(`Drive HTTP ${res.status} (${origin.name})`);
        const blob = await res.blob();
        rawFile = new File([blob], origin.name, {
          type: origin.mime || origin.mimeType || blob.type || 'application/octet-stream',
        });
      }
      if (!rawFile) return null;
      // Downscale лише для фото (no-op якщо вже ≤ maxDim).
      if (isImageFile({ name: rawFile.name, type: rawFile.type })) {
        try {
          const ds = await downscaleImage(rawFile);
          if (ds && ds !== rawFile) {
            rawFile = new File([ds], rawFile.name, { type: ds.type || rawFile.type || 'image/jpeg' });
          }
        } catch (e) {
          console.warn('[buildAddAsIsInput] downscale failed (non-fatal):', e?.message || e);
        }
      }
      return rawFile;
    };

    for (const s of selected) {
      const rawFile = await materialize({
        name: s.name, mime: s.mime, file: s.origin === 'device' ? s.file : null, driveId: s.driveId,
      });
      if (!rawFile) continue;
      files.push({
        fileId: s.key, name: rawFile.name, size: rawFile.size,
        originalMime: rawFile.type || s.mime || null, raw: rawFile,
      });
    }
    for (const f of inboxSelected) {
      const rawFile = await materialize({ id: f.id, name: f.name, mimeType: f.mimeType });
      if (!rawFile) continue;
      files.push({
        fileId: `inbox_${f.id}`, name: rawFile.name, size: rawFile.size,
        originalMime: rawFile.type || f.mimeType || null, raw: rawFile,
      });
    }
    return {
      caseId: caseData.id,
      caseData,
      agentId: 'document_processor_agent',
      source: 'manual',
      addedBy: 'user',
      module: MODULES.DOCUMENT_PROCESSOR,
      operation: 'add_document',
      conversionContext: {
        caseId: caseData.id,
        module: MODULES.DOCUMENT_PROCESSOR,
        operation: 'add_document',
      },
      files,
    };
  };

  // ── 1B image_merge_unify: чи весь батч — фото? ─────────────────────────
  // Детермінований вибір сценарію НА ВХОДІ. Корінь падіння який лагодимо:
  // streamingExecutor.streamFile жене кожен файл через chunk-OCR PDF до
  // вибору route — фото нема PDF header → крах «No PDF header found».
  // Фікс: для all-image обходимо весь pipeline.run і ведемо у DP image-merge
  // editor (prepareImagesForMerge + imageDocumentGrouper).
  const isAllImagesInput = () => {
    if (selected.length === 0) return false;
    // INBOX зараз ігноруємо у image-merge детекції: дозволяємо тільки чисті
    // device/drive батчі фото. Якщо адвокат відмітив щось з INBOX — звичайний
    // pipeline (mix scope боргу — див. tracking_debt).
    if (inboxSelected.length > 0) return false;
    return selected.every((s) => isImageFile({ name: s.name, type: s.mime }));
  };
  const hasAnyImage = () => selected.some((s) => isImageFile({ name: s.name, type: s.mime }))
    || inboxSelected.some((f) => isImageFile({ name: f.name, type: f.mimeType }));
  const hasAnyNonImage = () => selected.some((s) => !isImageFile({ name: s.name, type: s.mime }))
    || inboxSelected.some((f) => !isImageFile({ name: f.name, type: f.mimeType }));

  // 1C — чи це PDF (mime або розширення). Маршрутизація «просто додати»:
  // all-PDF → стрім-шлях (нарізка пропускається triage'ем, behavior-preserve);
  // будь-який не-PDF / комбо → non-streaming add_as_is (усі типи за раз).
  const isPdfLike = ({ name, mime }) =>
    (typeof mime === 'string' && mime === 'application/pdf')
    || /\.pdf$/i.test(String(name || ''));
  const hasAnyNonPdf = () => selected.some((s) => !isPdfLike({ name: s.name, mime: s.mime }))
    || inboxSelected.some((f) => !isPdfLike({ name: f.name, mime: f.mimeType }));

  // ── 1B: запуск image-merge сценарію (повз pipeline.run) ─────────────────
  const startImageMergeProcessing = async () => {
    if (running) return;
    // Конфлікт INBOX: тимчасово веземо новий батч у image-merge, лишаємо INBOX
    // як є (адвокат потім окремо).
    setRunning(true);
    setResult(null);
    setImageMerge(null);
    setMergeProgress({ phase: 'heic', done: 0, total: 0 });
    pipeline.expandProgress?.();
    try {
      // Конвертуємо selected у File[] (device → file; drive → blob).
      const files = [];
      for (const s of selected) {
        if (s.origin === 'device' && s.file) {
          files.push(s.file);
        } else if (s.driveId) {
          try {
            const res = await driveRequest(
              `https://www.googleapis.com/drive/v3/files/${s.driveId}?alt=media`,
            );
            if (!res.ok) throw new Error(`Drive HTTP ${res.status}`);
            const blob = await res.blob();
            const file = new File([blob], s.name, { type: s.mime || blob.type || 'image/jpeg' });
            files.push(file);
          } catch (e) {
            toast.error(`Не вдалось завантажити з Drive: ${s.name}`, { description: e?.message });
            setRunning(false);
            pipeline.minimizeProgress?.();
            return;
          }
        }
      }
      if (files.length === 0) {
        toast.warning('Немає фото для обробки');
        setRunning(false);
        pipeline.minimizeProgress?.();
        return;
      }

      // Phase 1 — pre-assembly (HEIC + OCR + orientation) у спільному сервісі.
      // onProgress (phase=heic/ocr/rotate, done/total) живить видимий
      // ProcessingProgress-оверлей (mergeProgress). Job-система не задіяна —
      // image-merge обходить pipeline.run (див. коментар біля mergeProgress).
      const pre = await prepareImagesForMerge(files, {
        onProgress: (phase, done, total) => {
          setMergeProgress({ phase, done, total });
        },
      });

      // Phase 2 — grouper (Haiku). Якщо API ключа немає / агент падає —
      // fallback один документ з усіх фото (адвокат поділить вручну).
      // total:0 → ProcessingProgress показує spinner+лейбл без бару (один await).
      setMergeProgress({ phase: 'grouper', done: 0, total: 0 });
      const apiKey = getApiKey();
      let grouperResult;
      try {
        const items = pre.normalizedFiles.map((f, i) => ({
          index: i,
          name: f?.name || `IMG_${i + 1}.jpg`,
          mime: f?.type || 'image/jpeg',
          ocrText: pre.ocrResults[i]?.text || '',
        }));
        grouperResult = await groupImagesIntoDocuments(items, {
          apiKey,
          caseId: caseData?.id,
          aiUsageSink,
        });
      } catch (e) {
        console.warn('[DP image-merge] grouper failed, single-group fallback:', e?.message);
        grouperResult = {
          groups: [{ pages: pre.normalizedFiles.map((_, i) => i), type: null, suggestedName: '' }],
          fallback: true,
          fallbackReason: e?.message || 'unknown',
        };
      }
      if (grouperResult.fallback) {
        toast.info('AI не зміг визначити межі — один документ з усіх фото; розділіть вручну.');
      }

      // Phase 3 — сортування сторінок + виявлення дублів ПЕР-ГРУПА через спільну
      // обгортку sortImageDocument (той самий шлях що модалка, правило #11 +
      // Rule of Three). До цього TASK DP цього кроку не робив узагалі — тому в
      // DP не було ні дублів, ні сортування сторінок усередині документа.
      // Кличемо лише для груп >1 фото (нема що сортувати/дедупити у 1-фото).
      // Виклики свідомо додають AI-вартість (логуються C7 через обгортку) —
      // рішення адвоката 2026-05-30 заради паритету з модалкою.
      const initialDuplicates = [];
      // Прогрес sort — лише по групах що реально сортуються (>1 фото).
      const groupsToSort = grouperResult.groups.filter(
        (g) => (Array.isArray(g.pages) ? g.pages.length : 0) >= 2,
      ).length;
      let sortedCount = 0;
      if (groupsToSort > 0) setMergeProgress({ phase: 'sort', done: 0, total: groupsToSort });
      try {
        for (const g of grouperResult.groups) {
          const pages = Array.isArray(g.pages) ? g.pages : [];
          if (pages.length < 2) continue;
          const groupItems = pages.map((origIdx) => ({
            index: origIdx,
            name: pre.normalizedFiles[origIdx]?.name || `IMG_${origIdx + 1}.jpg`,
            mime: pre.normalizedFiles[origIdx]?.type || 'image/jpeg',
            sizeBytes: pre.normalizedFiles[origIdx]?.size,
            ocrText: pre.ocrResults[origIdx]?.text || '',
            pageStructure: pre.ocrResults[origIdx]?.pageStructure || null,
            // detectedOrientations уже пораховано у prepareImagesForMerge —
            // НЕ перераховуємо (Розумна економія).
            orientation: pre.detectedOrientations[origIdx] || 0,
          }));
          const sortRes = await sortImageDocument(groupItems, {
            apiKey,
            caseContext: {
              existingDocumentNames: (caseData?.documents || []).map((d) => d.name).filter(Boolean),
              categoryHint: g.type || null,
            },
            billing: {
              caseId: caseData?.id || null,
              module: MODULES.DOCUMENT_PROCESSOR,
              aiUsageSink,
            },
          });
          sortedCount += 1;
          setMergeProgress({ phase: 'sort', done: sortedCount, total: groupsToSort });
          if (!sortRes) continue; // fallback (агент впав/timeout) — лишаємо порядок групи
          // Застосовуємо порядок сторінок усередині документа (валідна
          // перестановка індексів цієї групи).
          if (Array.isArray(sortRes.order)
              && sortRes.order.length === pages.length
              && sortRes.order.every((i) => pages.includes(i))) {
            g.pages = sortRes.order;
          }
          // suggestedName зі sort — лише як fallback, коли grouper не дав назви.
          if (!g.suggestedName && sortRes.suggestedName) {
            g.suggestedName = sortRes.suggestedName;
          }
          // Дублі (global indices) — у спільний список для editor'а.
          for (const d of sortRes.duplicates || []) {
            if (Array.isArray(d.group) && d.group.length >= 2) {
              initialDuplicates.push({ group: d.group, recommended: d.recommended, reason: d.reason });
            }
          }
        }
      } catch (e) {
        console.warn('[DP image-merge] per-group sort failed (non-fatal):', e?.message);
      }

      setImageMerge({ files, pre, initialGroups: grouperResult.groups, initialDuplicates });
      pipeline.minimizeProgress?.();
    } catch (e) {
      console.error('[DP image-merge] startup failed:', e);
      toast.error('Не вдалось підготувати фото', { description: e?.message });
    } finally {
      setRunning(false);
      setMergeProgress(null);
    }
  };

  // ── 1B: «Виконати» з image-merge editor ────────────────────────────────
  // Для кожної групи: rebuildFromOcrResults у PDF → upload у 01_ОРИГІНАЛИ →
  // executeAction('document_processor_agent','add_documents'). Текст і layout
  // у 02_ОБРОБЛЕНІ (best-effort, не блокує).
  const handleImageMergeSubmit = async ({
    groups, userRotation, cropOverrides, cropProposals, cropDisabled,
    cropAppliedSet, processedBlobs, pre,
  }) => {
    if (!onExecuteAction) {
      throw new Error('Немає onExecuteAction — додавання неможливе');
    }
    const existingNames = (caseData?.documents || []).map((d) => d.name).filter(Boolean);
    const documents = [];
    const usedNames = new Set(existingNames);

    // 01_ОРИГІНАЛИ folder ID (per case)
    let originalsFolderId = caseData?.storage?.subFolders?.['01_ОРИГІНАЛИ'] || null;
    if (!originalsFolderId) {
      const root = caseData?.storage?.driveFolderId || null;
      const f = await findOrCreateFolder('01_ОРИГІНАЛИ', root, null);
      originalsFolderId = f?.id;
    }
    if (!originalsFolderId) throw new Error('Не знайдено папку 01_ОРИГІНАЛИ');

    for (const g of groups) {
      if (g.pageIndices.length === 0) continue;
      const rebuilt = await rebuildFromOcrResults({
        orderedIndices: g.pageIndices,
        realFiles: pre.normalizedFiles,
        ocrResults: pre.ocrResults,
        detectedOrientations: pre.detectedOrientations,
        userRotation,
        cropOverrides,
        cropProposals,
        cropDisabled,
        cropAppliedSet,
        processedBlobs,
      });
      const baseName = (g.name || '').trim() || 'Документ';
      const uniqueName = ensureUniqueName(baseName, Array.from(usedNames));
      usedNames.add(uniqueName);
      const pdfName = `${uniqueName}.pdf`;

      // Upload PDF
      const bytes = new Uint8Array(await rebuilt.pdfBlob.arrayBuffer());
      const up = await uploadBytesToDrive(originalsFolderId, pdfName, bytes, 'application/pdf');
      const driveId = up.id;

      // 02_ОБРОБЛЕНІ best-effort — ЛИШЕ layout. TASK 4 §7.1: `.txt` не пишемо.
      // Фото-склейка має layoutJson (page._text) → вірне джерело для
      // getDocumentText/getCleanOrRawText. Без layout текст дістається з
      // текстового шару PDF на вимогу (extractTextLayer).
      try {
        if (rebuilt.layoutJson) {
          const layoutObj = typeof rebuilt.layoutJson === 'string'
            ? JSON.parse(rebuilt.layoutJson)
            : rebuilt.layoutJson;
          await ocrService.writeLayoutArtifact(
            { id: driveId, name: pdfName, subFolders: caseData?.storage?.subFolders },
            layoutObj,
          );
        }
      } catch (e) {
        console.warn('[DP image-merge] 02_ОБРОБЛЕНІ write failed (non-fatal):', e?.message);
      }

      const document = createDocument({
        name: uniqueName,
        category: g.type || null,
        author: g.author || null,
        procId: g.procId || null,
        date: g.date || null,
        isKey: !!g.isKey,
        driveId,
        driveUrl: `https://drive.google.com/file/d/${driveId}/view`,
        size: bytes.byteLength,
        pageCount: g.pageIndices.length,
        originalName: pdfName,
        originalDriveId: null,
        originalMime: 'application/pdf',
        folder: '01_ОРИГІНАЛИ',
        addedBy: 'user',
        namingStatus: g.name ? 'manual' : 'auto',
        documentNature: 'scanned',
        source: 'manual',
      });
      documents.push(document);
    }

    if (documents.length === 0) {
      toast.warning('Жодного документа не створено');
      return;
    }

    const res = await onExecuteAction('document_processor_agent', 'add_documents', {
      caseId: caseData.id, documents,
    });
    if (!res?.success) {
      throw new Error(res?.error || 'add_documents failed');
    }
    toast.success(`Додано ${documents.length} ${documents.length === 1 ? 'документ' : 'документ(и)'}`);

    // #5 — фото-шлях (image-merge) обходить pipeline.run → emitStage НЕ
    // публікує DOCUMENT_BATCH_PROCESSED. Публікуємо тут вручну тією самою
    // формою (як emitStage у documentPipeline.js), щоб для ФОТО теж спрацював
    // слухач контексту у CaseDossier: оновлення нарису + сигнал. Прапор
    // updateCaseContext — зі стану тумблера тієї ж DP-сесії. Ізольовано від
    // успіху додавання (publish не валить UX).
    try {
      eventBus.publish(DOCUMENT_BATCH_PROCESSED, {
        caseId: caseData.id,
        documentIds: documents.map((d) => d.id),
        count: documents.length,
        tenantId: getCurrentTenantId() || null,
        userId: getCurrentUserId() || null,
        updateCaseContext: settings.updateCaseContext === true,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[DP image-merge] publish DOCUMENT_BATCH_PROCESSED failed:', e?.message || e);
    }

    setImageMerge(null);
    setSelected([]);
    setInboxChecked(new Set());
    loadInbox();
  };

  const cancelImageMerge = () => {
    setImageMerge(null);
  };

  const startProcessing = async () => {
    if (totalCount === 0 || running) return;
    // Конфлікт INBOX: є нові (device/drive) файли і INBOX непорожній.
    if (selected.length > 0 && inboxFiles.length > 0 && !inboxConflict?.resolved) {
      setInboxConflict({ newCount: selected.length });
      return;
    }
    // Маршрутизація сценаріїв (детермінований вибір НА ВХОДІ):
    //   • all-image + toggle OFF → DP image-merge editor (склейка авто).
    //   • toggle ON «Просто додати» → ЗАВЖДИ addFiles (простий per-file додаток),
    //     НІКОЛИ нарізка/стрім-блоки — незалежно від типу і OCR-режиму.
    //     Повний OCR розпізнає кожен файл ЦІЛИМ документом (layout у 02), але
    //     НЕ ріже на шматки. «Без OCR» — лише 01, без артефактів.
    //   • toggle OFF + мікс photo+PDF → toast (нарізка-мікс поза scope; для
    //     комбо адвокат вмикає «Просто додати»).
    //   • toggle OFF + all-PDF / mix без фото → стрім-шлях з AI Triage (нарізка).
    if (isAllImagesInput() && !settings.skipPdfSlicing) {
      await startImageMergeProcessing();
      return;
    }
    // «Просто додати» (skipPdfSlicing) → ЗАВЖДИ простий додаток без нарізки.
    // Виправлення (рішення власника): раніше all-PDF+повний OCR з увімкненим
    // «Просто додати» все одно йшов у стрім-нарізку (блоки/OCR) — «знову полізли
    // в процесор». Тепер тумблер однозначний: увімкнено → ніякої нарізки.
    const useAddAsIs = settings.skipPdfSlicing === true;
    if (!useAddAsIs && hasAnyImage() && hasAnyNonImage()) {
      // Мікс фото+PDF у режимі НАРІЗКИ (toggle OFF) — поза scope. Підказуємо
      // увімкнути «Просто додати» для комбо без нарізки.
      toast.warning('Мікс фото + PDF: увімкніть «Просто додати файли» для комбо', {
        description: 'Нарізка працює лише для чистих наборів. Для змішаного набору без нарізки — тумблер «Просто додати файли».',
      });
      return;
    }
    setRunning(true);
    setResult(null);
    pipeline.expandProgress?.();        // новий run → повноекранний прогрес (не топбар)
    try {
      const input = useAddAsIs ? await buildAddAsIsInput() : await buildRunInput();
      if (input.files.length === 0) { toast.warning('Немає файлів для обробки'); setRunning(false); return; }
      // TASK 4 (rework) · Стадія D — маршрут: add_as_is → ОКРЕМИЙ сервіс
      // addFiles (нуль звʼязку з нарізкою; стиснення/OCR-пост-крок усередині);
      // slice → стрім-нарізка (pipeline.run). «без OCR» дійсний ЛИШЕ у add_as_is.
      let res;
      if (useAddAsIs) {
        res = await pipeline.addFiles(input, {
          ocrMode: settings.skipOcr ? 'none' : 'full',
          compress: settings.compressAll === true,
          updateCaseContext: settings.updateCaseContext === true,
        });
      } else {
        res = await pipeline.run(input, {
          ...settings,
          autoConfirm: true,
          collectDataset: getSplitterDatasetEnabled(),
          fragmentsCombined: false,
          // Стиснення scanned PDF ПЕРЕД нарізкою — КРИТИЧНО для §3.2 (slice-able).
          compress: settings.compressAll === true,
        });
      }
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
      // Скидаємо режимні тумблери після прогону — щоб режим не лишався «липким»
      // (минулого разу скан «не нарізався», бо «Просто додати» лишався увімкненим).
      setSettings((s) => ({ ...s, skipPdfSlicing: false, skipOcr: false, compressAll: false }));
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
  // triage_whole_volume — свідомий halt Triage (стадія не змогла визначити
  // межі), нейтральне «питання що потребує ручної дії», не помилка системи.
  // Рендериться через ту саму dpv2-attention-card без --error.
  const ATTENTION_TYPES = ['text_clean_failed', 'document_split_skipped', 'duplicate_skipped', 'duplicate_review', 'triage_whole_volume'];
  const attentionDecisions = decisions.filter((d) => ATTENTION_TYPES.includes(d.type));
  const attentionCount = errors.length + attentionDecisions.length;

  // ── 1B image_merge_unify — рендеримо DP image-merge editor поверх Zone 3 ─
  // Editor показується ПОВЕРХ звичайного DP UI, коли imageMerge активний.
  // Адвокат у Editor може натиснути «Назад» (cancelImageMerge) → повернутись
  // до звичайного DP UI, або «Виконати» → handleImageMergeSubmit створить
  // N документів і вийде з editor'а.
  if (imageMerge) {
    return (
      <div className="dpv2">
        <div className="dpv2-header">
          <span className="dpv2-title">
            <Wrench size={ICON_SIZE.md} aria-hidden="true" />
            Робота з документами · склейка фото
          </span>
        </div>
        <DpImageMergeEditor
          caseData={caseData}
          proceedings={caseData?.proceedings || []}
          pre={imageMerge.pre}
          initialGroups={imageMerge.initialGroups}
          initialDuplicates={imageMerge.initialDuplicates || []}
          onSubmit={handleImageMergeSubmit}
          onCancel={cancelImageMerge}
        />
      </div>
    );
  }

  return (
    <div className="dpv2">
      {/* Видимий прогрес важкої фото-обробки image-merge (борг #34, фото-частина).
          Повноекранний оверлей зі спільним ProcessingProgress. Показується поки
          mergeProgress активний (prepare/grouper/sort), до маунту редактора. */}
      {mergeProgress && (
        <div className="image-editor__progress-overlay" role="dialog" aria-modal="true">
          <ProcessingProgress
            variant="screen"
            phase={mergeProgress.phase}
            done={mergeProgress.done}
            total={mergeProgress.total}
            steps={IMAGE_MERGE_PHASES}
          />
        </div>
      )}

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
                    <span className="dpv2-list-meta">
                      {humanSize(s.size)}
                      {settings.compressAll && sizeEstimates[s.key]?.applicable
                        && Number.isFinite(sizeEstimates[s.key]?.estimatedBytes) && (
                        <> {'→'} ~{humanSize(sizeEstimates[s.key].estimatedBytes)}</>
                      )}
                    </span>
                    <button className="dpv2-iconbtn" onClick={() => removeSelected(s.key)} aria-label="Прибрати">
                      <Trash2 size={ICON_SIZE.sm} />
                    </button>
                  </div>
                ))}
              </div>
              {compressionForecast && (
                <div className="dpv2-muted">
                  Орієнтовно після стиснення: ~{humanSize(compressionForecast.projected)}
                  {' '}(зараз {humanSize(compressionForecast.current)})
                </div>
              )}
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
            <Toggle
              label="Просто додати файли"
              description="кожен PDF — окремий документ, без AI-нарізки"
              checked={settings.skipPdfSlicing}
              onChange={setToggle('skipPdfSlicing')}
            />
            <Toggle
              label="Без розпізнавання тексту"
              description="лише з «Просто додати»: AI прочитає перші сторінки і запропонує дані, повне розпізнавання — пізніше"
              checked={settings.skipOcr}
              disabled={!settings.skipPdfSlicing}
              onChange={setToggle('skipOcr')}
            />
          </div>
          <div className="dpv2-settings-group">
            <div className="dpv2-section-label">ЯКІСТЬ ТЕКСТУ</div>
            <Toggle label="Згенерувати короткий зміст" checked={settings.generateSummary} onChange={setToggle('generateSummary')} />
          </div>
          <div className="dpv2-settings-group">
            <div className="dpv2-section-label">ДОДАТКОВІ ДІЇ</div>
            <Toggle
              label="Стиснути всі файли пакета"
              description="лише скановані PDF (на основі зображень); текстові PDF проходять як є"
              checked={settings.compressAll}
              onChange={setToggle('compressAll')}
            />
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
                ? `Оцінка обробки: ~${estimate.minMin}-${estimate.maxMin} хвилин`
                : 'Оцінка часу та вартості зʼявиться після вибору файлів у Зоні 1'}
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
                  {attentionDecisions.length === 0 && (
                    <div className="dpv2-muted">Питань немає.</div>
                  )}
                  {attentionDecisions.map((d, i) => (
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

      {/* Зона 4 · Повноекранний прогрес — рендериться глобально
          (GlobalProgressScreen у App, керується DocumentPipelineContext),
          щоб топбар і повний екран не дублювались (Bug 2/3). */}

      <DrivePicker
        isOpen={drivePickerOpen}
        onClose={() => setDrivePickerOpen(false)}
        presentation="modal"
        selectionMode="multi"
        multiFilter="all"
        onPickMulti={addDriveFiles}
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
