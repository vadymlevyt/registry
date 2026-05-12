// ── IMAGE MERGE PANEL ────────────────────────────────────────────────────────
// Компонент для склейки кількох зображень у один PDF (TASK B).
//
// 3 фази:
//   selecting — вибір файлів (device input multiple + Drive multi-select picker)
//   processing — OCR + sortImages + orientation detection + PDF assembly
//   preview — grid з drag-and-drop, warnings, duplicates, manual rotation,
//             попап перегляду з pinch-zoom, форма метаданих
//
// Інтеграція з CaseDossier — як і раніше: onSubmit передає файл + mergeArtifacts.
//
// Drag-and-drop через @dnd-kit/core + @dnd-kit/sortable (touch + a11y).
// Попап перегляду через react-zoom-pan-pinch (lazy chunk).

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  forwardRef,
  useImperativeHandle,
} from 'react';
import {
  Image as ImageIcon,
  Upload,
  Cloud,
  X,
  ArrowLeft,
  AlertTriangle,
  Trash2,
  RotateCw,
  Eye,
  GripVertical,
  Check,
  Copy as CopyIcon,
  Crop as CropIcon,
} from 'lucide-react';
import { Modal, Input, Select, Toggle, Button } from '../UI';
import { ICON_SIZE } from '../UI/icons.js';
import { toast } from '../../services/toast.js';
import { convertImagesToPdf } from '../../services/converter/converterService.js';
import { ensureUniqueName } from '../../services/sortation/imageSortingAgent.js';

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

const MAX_IMAGES_WARN = 50;

function isImageFile(file) {
  if (!file) return false;
  const mime = (file.type || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  const name = (file.name || '').toLowerCase();
  return /\.(jpe?g|png|heic|heif|webp|gif|bmp)$/i.test(name);
}

/**
 * @param {{caseData, onSubmit, onCancel, onOpenDrivePicker}} props
 *   onOpenDrivePicker — викликаємо коли адвокат натискає "Додати з Drive"
 */
export const ImageMergePanel = forwardRef(function ImageMergePanel(
  { caseData, apiKey, onSubmit, onCancel, onOpenDrivePicker, onSingleFileRedirect },
  ref
) {
  const [phase, setPhase] = useState('selecting');
  const [files, setFiles] = useState([]);
  // Модалка-попередження коли адвокат натиснув "Створити PDF" з 1 файлом.
  // null = не показана, File = показана з посиланням на цей файл.
  const [singleFileWarning, setSingleFileWarning] = useState(null);
  const [pipelineResult, setPipelineResult] = useState(null);
  const [orderedIndices, setOrderedIndices] = useState([]);
  const [removedIndices, setRemovedIndices] = useState(() => new Set());
  // userRotation[origIdx] = 0|90|180|270 — додатковий кут CW який накладається
  // ПОВЕРХ автодетектованої orientation (EXIF/Document AI). Стартує з 0 для
  // усіх. Кнопка ↻ збільшує на 90° (mod 360). Застосовується у submit-rebuild.
  // ОКРЕМЕ ім'я бо це окремий намір (правило #11): автодетект — спроба системи,
  // userRotation — корекція адвоката. Не змішуємо в одне поле.
  const [userRotation, setUserRotation] = useState(() => new Map());
  // userCrops[origIdx] = Blob — обрізаний варіант зображення замість оригіналу.
  // Використовується замість realFiles[origIdx] при rebuild PDF і для thumbnail
  // у preview. Окрема Map бо crop — окремий намір від rotation (правило #11):
  // обертання змінює орієнтацію, crop вирізає область. Можуть співіснувати:
  // адвокат спершу повертає, потім обрізає (або навпаки).
  const [userCrops, setUserCrops] = useState(() => new Map());
  // Debug toggle (TASK B fix 1 round 2) — увімкнення показує адвокату
  // діагностичну інформацію orientation у toast info після склейки. Перський
  // зберігається у localStorage щоб адвокат не вмикав щоразу.
  const [debugMode, setDebugMode] = useState(() => {
    try {
      return localStorage.getItem('levytskyi_image_merge_debug') === '1';
    } catch { return false; }
  });
  const [progress, setProgress] = useState({ phase: '', done: 0, total: 0 });
  const [form, setForm] = useState({
    name: '',
    category: '',
    author: '',
    procId: caseData?.proceedings?.[0]?.id || '',
    date: '',
    isKey: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const thumbUrlsRef = useRef(new Map());

  useEffect(() => {
    return () => {
      for (const url of thumbUrlsRef.current.values()) {
        try { URL.revokeObjectURL(url); } catch {}
      }
      thumbUrlsRef.current.clear();
    };
  }, []);

  const handleDeviceFiles = (e) => {
    const picked = Array.from(e.target.files || []);
    const validImages = picked.filter(isImageFile);
    const skipped = picked.length - validImages.length;
    if (skipped > 0) {
      toast.show(`Пропущено ${skipped} не-зображень`);
    }
    setFiles((prev) => [...prev, ...validImages]);
    e.target.value = '';
  };

  const addDriveFiles = useCallback((driveFiles) => {
    const mapped = driveFiles.map((df) => ({
      _isDriveSource: true,
      _driveId: df.id,
      name: df.name,
      size: df.size ? parseInt(df.size, 10) : 0,
      type: df.mimeType || 'image/jpeg',
    }));
    setFiles((prev) => [...prev, ...mapped]);
  }, []);

  const removeFile = (idx) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleStartProcessing = async () => {
    if (files.length === 0) {
      toast.error('Додайте хоча б одне зображення');
      return;
    }
    // Захист від запуску повного pipeline (OCR + агент сортування + орієнтація
    // + склейка) для одного файлу — нема що сортувати, нема що склеювати.
    // Розумна економія: AI токени і час адвоката.
    if (files.length === 1) {
      setSingleFileWarning(files[0]);
      return;
    }
    if (files.length > MAX_IMAGES_WARN) {
      const minutes = Math.ceil(files.length / 25);
      const ok = window.confirm(
        `Великий обсяг: ${files.length} зображень.\n` +
        `Обробка займе приблизно ${minutes} хв.\n\n` +
        `Продовжити?`
      );
      if (!ok) return;
    }

    setPhase('processing');
    setProgress({ phase: 'preparing', done: 0, total: files.length });

    const realFiles = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f._isDriveSource && f._driveId) {
        try {
          const { driveRequest } = await import('../../services/driveAuth.js');
          const res = await driveRequest(
            `https://www.googleapis.com/drive/v3/files/${f._driveId}?alt=media`
          );
          if (!res.ok) throw new Error(`Drive HTTP ${res.status}`);
          const blob = await res.blob();
          const file = new File([blob], f.name, { type: f.type || blob.type || 'image/jpeg' });
          realFiles.push(file);
        } catch (e) {
          toast.error(`Не вдалось завантажити з Drive: ${f.name}`, { description: e?.message });
          setPhase('selecting');
          return;
        }
      } else {
        realFiles.push(f);
      }
      setProgress({ phase: 'preparing', done: i + 1, total: files.length });
    }

    try {
      console.log('[merge] pipeline start, files=', realFiles.length);
      const result = await convertImagesToPdf(realFiles, {
        apiKey,
        caseId: caseData?.id,
        module: 'add_form',
        operation: 'merge_images',
        existingDocumentNames: (caseData?.documents || []).map((d) => d.name).filter(Boolean),
        categoryHint: null,
        onProgress: (phase, done, total) => setProgress({ phase, done, total }),
      });
      console.log('[merge] pipeline returned:', {
        hasPdfBlob: result?.pdfBlob instanceof Blob,
        pdfBytes: result?.pdfBlob?.size,
        finalOrderLen: result?.finalOrder?.length,
        suggestedName: result?.suggestedName,
        warningsCount: result?.warnings?.length,
        duplicatesCount: result?.sortResult?.duplicates?.length || 0,
        detectedOrientations: result?.detectedOrientations,
        durationMs: result?.durationMs,
      });

      if (!(result?.pdfBlob instanceof Blob) || result.pdfBlob.size === 0) {
        throw new Error('Pipeline повернув порожній PDF');
      }
      if (!Array.isArray(result.finalOrder) || result.finalOrder.length === 0) {
        throw new Error('Pipeline повернув порожній finalOrder');
      }

      for (let i = 0; i < realFiles.length; i++) {
        if (!thumbUrlsRef.current.has(i)) {
          thumbUrlsRef.current.set(i, URL.createObjectURL(realFiles[i]));
        }
      }

      setPipelineResult({ ...result, realFiles });
      setOrderedIndices(result.finalOrder);
      setUserRotation(new Map());
      setUserCrops(new Map());
      setForm((prev) => ({
        ...prev,
        name: result.suggestedName || result.pdfName || prev.name,
      }));
      setPhase('preview');

      // Debug toast info якщо включений debugMode
      if (debugMode && Array.isArray(result.orientationDebug)) {
        const lines = result.orientationDebug
          .map((d, i) => {
            if (!d) return null;
            const file = realFiles[i]?.name || `#${i}`;
            const exif = d.exif
              ? `EXIF=${d.exif.rawTag}(${d.exif.degrees}°)`
              : 'EXIF=none';
            const docAi = d.docAi
              ? `docAi=${d.docAi.orientation ?? d.docAi.detectedOrientation ?? 0}`
              : 'docAi=none';
            const aspect = d.aspect ? `ratio=${d.aspect.ratio}` : 'aspect=none';
            return `${file}: ${exif}, ${docAi}, ${aspect} → ${d.degrees}° (${d.source}${d.uncertain ? ', uncertain' : ''})`;
          })
          .filter(Boolean);
        toast.show('Orientation діагностика', {
          description: lines.join('\n'),
          duration: 12000,
        });
      }
    } catch (e) {
      console.error('[merge] pipeline failed:', e);
      toast.error('Не вдалось обробити зображення', { description: e?.message });
      setPhase('selecting');
    }
  };

  const handleRemoveIndex = useCallback((origIdx) => {
    setRemovedIndices((prev) => {
      const next = new Set(prev);
      next.add(origIdx);
      return next;
    });
    setOrderedIndices((prev) => prev.filter((i) => i !== origIdx));
  }, []);

  const handleRotateIndex = useCallback((origIdx) => {
    setUserRotation((prev) => {
      const next = new Map(prev);
      const cur = next.get(origIdx) || 0;
      next.set(origIdx, (cur + 90) % 360);
      return next;
    });
  }, []);

  // Застосовує crop до origIdx: створює новий Blob через cropHelper,
  // оновлює thumbnail URL (revoke старий), зберігає у userCrops Map.
  // Якщо croppedBlob === null — скидає crop до повного.
  const handleApplyCrop = useCallback(async (origIdx, croppedBlob) => {
    if (croppedBlob === null) {
      // Скидання — повернутися до оригіналу
      setUserCrops((prev) => {
        const next = new Map(prev);
        next.delete(origIdx);
        return next;
      });
      // Оновлюємо thumb URL на оригінал
      const realFile = pipelineResult?.realFiles?.[origIdx];
      if (realFile) {
        const oldUrl = thumbUrlsRef.current.get(origIdx);
        if (oldUrl) try { URL.revokeObjectURL(oldUrl); } catch {}
        thumbUrlsRef.current.set(origIdx, URL.createObjectURL(realFile));
      }
      return;
    }
    if (!(croppedBlob instanceof Blob)) return;
    setUserCrops((prev) => {
      const next = new Map(prev);
      next.set(origIdx, croppedBlob);
      return next;
    });
    // Оновлюємо thumb URL на обрізаний blob — revoke старий
    const oldUrl = thumbUrlsRef.current.get(origIdx);
    if (oldUrl) try { URL.revokeObjectURL(oldUrl); } catch {}
    thumbUrlsRef.current.set(origIdx, URL.createObjectURL(croppedBlob));
  }, [pipelineResult?.realFiles]);

  const handleRemoveAllSuspicious = () => {
    if (!pipelineResult?.sortResult?.warnings) return;
    const suspicious = new Set(pipelineResult.sortResult.warnings.map((w) => w.index));
    setRemovedIndices((prev) => {
      const next = new Set(prev);
      for (const i of suspicious) next.add(i);
      return next;
    });
    setOrderedIndices((prev) => prev.filter((i) => !suspicious.has(i)));
  };

  // Видалити всі дублікати залишаючи тільки recommended кожної групи.
  const handleKeepRecommendedDuplicates = useCallback((groupIndices, recommended) => {
    const toRemove = groupIndices.filter((i) => i !== recommended);
    if (toRemove.length === 0) return;
    setRemovedIndices((prev) => {
      const next = new Set(prev);
      for (const i of toRemove) next.add(i);
      return next;
    });
    setOrderedIndices((prev) => prev.filter((i) => !toRemove.includes(i)));
  }, []);

  const handleKeepAllRecommendedDuplicates = useCallback(() => {
    const groups = pipelineResult?.sortResult?.duplicates || [];
    if (groups.length === 0) return;
    const toRemove = [];
    for (const g of groups) {
      for (const i of g.group) {
        if (i !== g.recommended) toRemove.push(i);
      }
    }
    if (toRemove.length === 0) return;
    const removeSet = new Set(toRemove);
    setRemovedIndices((prev) => {
      const next = new Set(prev);
      for (const i of removeSet) next.add(i);
      return next;
    });
    setOrderedIndices((prev) => prev.filter((i) => !removeSet.has(i)));
  }, [pipelineResult?.sortResult?.duplicates]);

  const handleSubmit = async () => {
    if (submitting) return;
    if (!form.name.trim()) {
      toast.error('Назва обовʼязкова');
      return;
    }
    if (orderedIndices.length === 0) {
      toast.error('Додайте хоча б одне зображення');
      return;
    }
    if (!pipelineResult) return;

    setSubmitting(true);
    try {
      const orderUnchanged =
        orderedIndices.length === pipelineResult.finalOrder.length &&
        orderedIndices.every((v, i) => v === pipelineResult.finalOrder[i]);

      const hasUserRotation = Array.from(userRotation.values()).some((d) => d !== 0);

      let finalPdfBlob;
      let finalText;
      let finalLayout;

      const hasUserCrops = userCrops.size > 0;

      if (orderUnchanged && removedIndices.size === 0 && !hasUserRotation && !hasUserCrops) {
        finalPdfBlob = pipelineResult.pdfBlob;
        finalText = pipelineResult.extractedText;
        finalLayout = pipelineResult.layoutJson;
      } else {
        const rebuilt = await rebuildFromOcrResults({
          orderedIndices,
          realFiles: pipelineResult.realFiles,
          ocrResults: pipelineResult.ocrResults,
          detectedOrientations: pipelineResult.detectedOrientations || [],
          userRotation,
          userCrops,
        });
        finalPdfBlob = rebuilt.pdfBlob;
        finalText = rebuilt.extractedText;
        finalLayout = rebuilt.layoutJson;
      }

      const existingNames = (caseData?.documents || []).map((d) => d.name).filter(Boolean);
      const uniqueName = ensureUniqueName(form.name.trim(), existingNames);

      const pdfFile = new File(
        [finalPdfBlob],
        `${uniqueName}.pdf`,
        { type: 'application/pdf' }
      );

      await onSubmit({
        name: uniqueName,
        category: form.category || null,
        author: form.author || null,
        procId: form.procId || null,
        date: form.date.trim() || null,
        isKey: form.isKey,
        file: pdfFile,
        mergeArtifacts: {
          extractedText: finalText,
          layoutJson: finalLayout,
          imageCount: orderedIndices.length,
          sortResult: pipelineResult.sortResult,
        },
      });
    } catch (e) {
      console.error('[merge] submit failed:', e);
      toast.error('Не вдалось зберегти документ', { description: e?.message });
    } finally {
      setSubmitting(false);
    }
  };

  useImperativeHandle(ref, () => ({
    addDriveFiles,
  }), [addDriveFiles]);

  if (phase === 'processing') {
    return <ProcessingView progress={progress} />;
  }

  if (phase === 'preview') {
    return (
      <PreviewView
        pipelineResult={pipelineResult}
        orderedIndices={orderedIndices}
        removedIndices={removedIndices}
        thumbUrls={thumbUrlsRef.current}
        userRotation={userRotation}
        userCrops={userCrops}
        realFiles={pipelineResult?.realFiles || []}
        debugMode={debugMode}
        setDebugMode={(v) => {
          setDebugMode(v);
          try { localStorage.setItem('levytskyi_image_merge_debug', v ? '1' : '0'); } catch {}
        }}
        form={form}
        setForm={setForm}
        onReorder={setOrderedIndices}
        onRemove={handleRemoveIndex}
        onRotate={handleRotateIndex}
        onApplyCrop={handleApplyCrop}
        onRemoveAllSuspicious={handleRemoveAllSuspicious}
        onKeepRecommendedDuplicate={handleKeepRecommendedDuplicates}
        onKeepAllRecommendedDuplicates={handleKeepAllRecommendedDuplicates}
        proceedings={caseData?.proceedings || []}
        onSubmit={handleSubmit}
        onCancel={onCancel}
        submitting={submitting}
      />
    );
  }

  return (
    <div className="image-merge-panel__selecting">
      <p className="image-merge-panel__hint">
        Виберіть кілька зображень одного документа (сторінок). Система склеїть їх у один PDF,
        автоматично визначить порядок і запропонує назву.
      </p>

      <div className="image-merge-panel__sources">
        <label className="image-merge-panel__source-btn">
          <Upload size={ICON_SIZE.md} />
          <span>Додати з пристрою</span>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={handleDeviceFiles}
            style={{ display: 'none' }}
          />
        </label>
        {onOpenDrivePicker && (
          <button
            type="button"
            className="image-merge-panel__source-btn"
            onClick={() => onOpenDrivePicker()}
          >
            <Cloud size={ICON_SIZE.md} />
            <span>Додати з Drive</span>
          </button>
        )}
      </div>

      {files.length > 0 && (
        <div className="image-merge-panel__queue">
          <div className="image-merge-panel__queue-header">
            <span>Обрано {files.length}</span>
            {files.length > MAX_IMAGES_WARN && (
              <span className="image-merge-panel__queue-warn">
                Великий обсяг — обробка займе ~2 хв
              </span>
            )}
          </div>
          <ul className="image-merge-panel__queue-list">
            {files.map((f, idx) => (
              <li key={`${f.name}-${idx}`} className="image-merge-panel__queue-item">
                <ImageIcon size={ICON_SIZE.sm} />
                <span className="image-merge-panel__queue-name">{f.name}</span>
                {f._isDriveSource && (
                  <span className="image-merge-panel__queue-source">Drive</span>
                )}
                <button
                  type="button"
                  className="image-merge-panel__queue-remove"
                  onClick={() => removeFile(idx)}
                  aria-label="Видалити"
                >
                  <X size={ICON_SIZE.sm} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="image-merge-panel__actions">
        <Button variant="secondary" onClick={onCancel}>
          <ArrowLeft size={ICON_SIZE.sm} />
          Назад
        </Button>
        <Button
          variant="primary"
          onClick={handleStartProcessing}
          disabled={files.length === 0}
        >
          Створити PDF з {files.length} зображень
        </Button>
      </div>

      {singleFileWarning && (
        <SingleFileWarning
          file={singleFileWarning}
          canRedirect={!!onSingleFileRedirect}
          onRedirect={() => {
            const f = singleFileWarning;
            setSingleFileWarning(null);
            if (onSingleFileRedirect) onSingleFileRedirect(f);
          }}
          onAddMore={() => setSingleFileWarning(null)}
          onCancel={() => setSingleFileWarning(null)}
        />
      )}
    </div>
  );
});

// ── Processing view (OCR + sort progress) ─────────────────────────────────

const PHASES = [
  { key: 'preparing', label: 'Підготовка' },
  { key: 'heic', label: 'HEIC → JPEG' },
  { key: 'ocr', label: 'OCR' },
  { key: 'sort', label: 'Сортування' },
  { key: 'rotate', label: 'Орієнтація' },
  { key: 'pdf', label: 'PDF' },
];

function ProcessingView({ progress }) {
  const currentIdx = PHASES.findIndex((p) => p.key === progress.phase);
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const currentPhase = PHASES[currentIdx] || PHASES[0];

  return (
    <div className="image-merge-panel__processing">
      <div className="image-merge-panel__processing-spinner" aria-hidden="true" />

      <div className="image-merge-panel__processing-label">
        {currentPhase.label}
        {progress.total > 1 && progress.done < progress.total && (
          <span className="image-merge-panel__processing-counter">
            {' '}{progress.done} / {progress.total}
          </span>
        )}
      </div>

      <div className="image-merge-panel__processing-bar" role="progressbar" aria-valuenow={pct}>
        <div
          className="image-merge-panel__processing-bar-fill"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="image-merge-panel__phase-stepper">
        {PHASES.map((phase, idx) => {
          const state =
            idx < currentIdx ? 'done' :
            idx === currentIdx ? 'active' :
            'pending';
          return (
            <div
              key={phase.key}
              className={`image-merge-panel__phase-step image-merge-panel__phase-step--${state}`}
            >
              <span className="image-merge-panel__phase-step-dot" aria-hidden="true">
                {state === 'done' ? '✓' : (idx + 1)}
              </span>
              <span className="image-merge-panel__phase-step-label">{phase.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Preview view (drag-and-drop + form + duplicates + popup) ──────────────

function PreviewView({
  pipelineResult,
  orderedIndices,
  removedIndices,
  thumbUrls,
  userRotation,
  userCrops,
  realFiles,
  debugMode,
  setDebugMode,
  form,
  setForm,
  onReorder,
  onRemove,
  onRotate,
  onApplyCrop,
  onRemoveAllSuspicious,
  onKeepRecommendedDuplicate,
  onKeepAllRecommendedDuplicates,
  proceedings,
  onSubmit,
  onCancel,
  submitting,
}) {
  const warningsByIndex = useMemo(() => {
    const map = new Map();
    for (const w of pipelineResult?.sortResult?.warnings || []) {
      map.set(w.index, w.reason);
    }
    return map;
  }, [pipelineResult?.sortResult?.warnings]);

  // Мапа origIdx → { groupId, recommended, reason }. groupId це порядковий
  // номер групи дублікатів (для UI — кольори/підписи).
  const duplicateMembership = useMemo(() => {
    const map = new Map();
    const groups = pipelineResult?.sortResult?.duplicates || [];
    groups.forEach((g, groupId) => {
      for (const idx of g.group) {
        map.set(idx, {
          groupId,
          recommended: g.recommended,
          reason: g.reason,
          groupIndices: g.group,
        });
      }
    });
    return map;
  }, [pipelineResult?.sortResult?.duplicates]);

  const hasSuspicious = (pipelineResult?.sortResult?.warnings || []).length > 0;
  const duplicateGroupsCount = (pipelineResult?.sortResult?.duplicates || []).length;
  const missing = pipelineResult?.sortResult?.missing;

  // Індекси з невпевненою orientation (aspect heuristic) — показуємо warning
  // адвокату щоб він перевірив візуально і обернув вручну якщо треба.
  const uncertainIndices = useMemo(() => {
    return pipelineResult?.uncertainOrientationIndices || [];
  }, [pipelineResult?.uncertainOrientationIndices]);
  const uncertainSet = useMemo(() => new Set(uncertainIndices), [uncertainIndices]);

  const proceedingOptions = (proceedings || []).map((p) => ({ value: p.id, label: p.title }));

  // Попап перегляду
  const [popupOrigIdx, setPopupOrigIdx] = useState(null);
  // Контекстне меню (desktop right-click)
  const [contextMenu, setContextMenu] = useState(null);

  const handleOpenPopup = useCallback((origIdx) => {
    setPopupOrigIdx(origIdx);
    setContextMenu(null);
  }, []);

  const handleClosePopup = useCallback(() => {
    setPopupOrigIdx(null);
  }, []);

  const handlePopupNav = useCallback((direction) => {
    if (popupOrigIdx == null) return;
    const pos = orderedIndices.indexOf(popupOrigIdx);
    if (pos < 0) return;
    const nextPos = pos + direction;
    if (nextPos < 0 || nextPos >= orderedIndices.length) return;
    setPopupOrigIdx(orderedIndices[nextPos]);
  }, [popupOrigIdx, orderedIndices]);

  // Клавіатурні скорочення (десктоп). Працюють лише коли модалка активна.
  // R — повернути ТЕКУЩИЙ open-popup thumbnail АБО перший виділений (для grid).
  // Delete — видалити open-popup thumbnail.
  // ←/→ у popup — навігація.
  // Esc — закрити popup.
  useEffect(() => {
    function onKey(e) {
      if (popupOrigIdx != null) {
        if (e.key === 'Escape') { e.preventDefault(); handleClosePopup(); return; }
        if (e.key === 'ArrowLeft') { e.preventDefault(); handlePopupNav(-1); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); handlePopupNav(1); return; }
        if (e.key === 'r' || e.key === 'R') { e.preventDefault(); onRotate(popupOrigIdx); return; }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          const cur = popupOrigIdx;
          const pos = orderedIndices.indexOf(cur);
          const nextIdx = pos >= 0 && pos < orderedIndices.length - 1
            ? orderedIndices[pos + 1]
            : (pos > 0 ? orderedIndices[pos - 1] : null);
          onRemove(cur);
          setPopupOrigIdx(nextIdx);
          return;
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [popupOrigIdx, orderedIndices, handleClosePopup, handlePopupNav, onRotate, onRemove]);

  // Закриття контекстного меню по кліку поза ним або Esc
  useEffect(() => {
    if (!contextMenu) return;
    function onDoc(e) {
      // Якщо клік всередині меню — не закриваємо
      if (e.target.closest('.image-merge-panel__ctxmenu')) return;
      setContextMenu(null);
    }
    function onKey(e) {
      if (e.key === 'Escape') setContextMenu(null);
    }
    window.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  const handleContextMenu = useCallback((e, origIdx) => {
    e.preventDefault();
    setContextMenu({
      origIdx,
      x: e.clientX,
      y: e.clientY,
    });
  }, []);

  return (
    <div className="image-merge-panel__preview">
      <SortableGrid
        orderedIndices={orderedIndices}
        thumbUrls={thumbUrls}
        warningsByIndex={warningsByIndex}
        duplicateMembership={duplicateMembership}
        userRotation={userRotation}
        uncertainSet={uncertainSet}
        onReorder={onReorder}
        onRemove={onRemove}
        onRotate={onRotate}
        onOpenPopup={handleOpenPopup}
        onContextMenu={handleContextMenu}
        onKeepRecommendedDuplicate={onKeepRecommendedDuplicate}
      />

      {(missing || hasSuspicious || duplicateGroupsCount > 0 || uncertainIndices.length > 0) && (
        <div className="image-merge-panel__alerts">
          {uncertainIndices.length > 0 && (
            <div className="image-merge-panel__alert image-merge-panel__alert--orient">
              <AlertTriangle size={ICON_SIZE.sm} />
              <span>
                Орієнтація {uncertainIndices.length} {uncertainIndices.length === 1 ? 'сторінки' : 'сторінок'} визначена за пропорціями (EXIF та Document AI не дали orientation). Перевір — кнопка ↻ виправить.
              </span>
            </div>
          )}
          {missing && (
            <div className="image-merge-panel__alert image-merge-panel__alert--info">
              <AlertTriangle size={ICON_SIZE.sm} />
              <span>{missing}</span>
            </div>
          )}
          {duplicateGroupsCount > 0 && (
            <div className="image-merge-panel__alert image-merge-panel__alert--dup">
              <CopyIcon size={ICON_SIZE.sm} />
              <span>
                Знайдено {duplicateGroupsCount} групи дублікатів (жовта рамка). Рекомендовані варіанти позначені зеленим.
              </span>
              <button
                type="button"
                className="image-merge-panel__remove-suspicious image-merge-panel__remove-suspicious--dup"
                onClick={onKeepAllRecommendedDuplicates}
              >
                <Check size={14} />
                Залишити рекомендовані
              </button>
            </div>
          )}
          {hasSuspicious && (
            <div className="image-merge-panel__alert image-merge-panel__alert--warn">
              <AlertTriangle size={ICON_SIZE.sm} />
              <span>
                Виявлено {pipelineResult.sortResult.warnings.length} підозрілих
                сторінок (червона рамка)
              </span>
              <button
                type="button"
                className="image-merge-panel__remove-suspicious"
                onClick={onRemoveAllSuspicious}
              >
                <Trash2 size={14} />
                Видалити всі підозрілі
              </button>
            </div>
          )}
        </div>
      )}

      <div className="image-merge-panel__form">
        <Input
          label="Назва документа"
          value={form.name}
          onChange={(v) => setForm((s) => ({ ...s, name: v }))}
          placeholder="Напр. Ухвала про відкриття провадження"
          autoFocus
        />

        <div className="image-merge-panel__form-row">
          <Select
            label="Тип документа"
            value={form.category}
            onChange={(v) => setForm((s) => ({ ...s, category: v }))}
            options={CATEGORY_OPTIONS}
            placeholder="Оберіть тип"
          />
          <Select
            label="Від кого"
            value={form.author}
            onChange={(v) => setForm((s) => ({ ...s, author: v }))}
            options={AUTHOR_OPTIONS}
            placeholder="Оберіть автора"
          />
        </div>

        {proceedingOptions.length > 0 && (
          <Select
            label="Провадження"
            value={form.procId}
            onChange={(v) => setForm((s) => ({ ...s, procId: v }))}
            options={proceedingOptions}
            placeholder="Оберіть провадження"
          />
        )}

        <Input
          label="Дата документа"
          type="date"
          value={form.date}
          onChange={(v) => setForm((s) => ({ ...s, date: v }))}
        />

        <Toggle
          label="Позначити як ключовий"
          description="Документ буде виділено зірочкою у списку"
          checked={form.isKey}
          onChange={(v) => setForm((s) => ({ ...s, isKey: v }))}
        />
      </div>

      <div className="image-merge-panel__actions">
        <Button variant="secondary" onClick={onCancel} disabled={submitting}>
          <ArrowLeft size={ICON_SIZE.sm} />
          Назад
        </Button>
        <Button variant="primary" onClick={onSubmit} disabled={submitting || orderedIndices.length === 0}>
          {submitting ? 'Збереження...' : `Створити PDF з ${orderedIndices.length} стор.`}
        </Button>
      </div>

      <label className="image-merge-panel__debug-toggle">
        <input
          type="checkbox"
          checked={debugMode}
          onChange={(e) => setDebugMode(e.target.checked)}
        />
        <span>Показувати діагностику orientation після склейки</span>
      </label>

      {popupOrigIdx != null && (
        <PreviewPopup
          origIdx={popupOrigIdx}
          url={thumbUrls.get(popupOrigIdx)}
          sourceBlob={userCrops?.get?.(popupOrigIdx) || realFiles?.[popupOrigIdx] || null}
          rotation={userRotation.get(popupOrigIdx) || 0}
          position={orderedIndices.indexOf(popupOrigIdx)}
          total={orderedIndices.length}
          warning={warningsByIndex.get(popupOrigIdx) || null}
          duplicateInfo={duplicateMembership.get(popupOrigIdx) || null}
          isUncertain={uncertainSet?.has?.(popupOrigIdx) || false}
          hasCrop={userCrops?.has?.(popupOrigIdx) || false}
          onClose={handleClosePopup}
          onPrev={() => handlePopupNav(-1)}
          onNext={() => handlePopupNav(1)}
          onRotate={() => onRotate(popupOrigIdx)}
          onApplyCrop={(blob) => onApplyCrop(popupOrigIdx, blob)}
          onRemove={() => {
            const cur = popupOrigIdx;
            const pos = orderedIndices.indexOf(cur);
            const nextIdx = pos >= 0 && pos < orderedIndices.length - 1
              ? orderedIndices[pos + 1]
              : (pos > 0 ? orderedIndices[pos - 1] : null);
            onRemove(cur);
            setPopupOrigIdx(nextIdx);
          }}
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onView={() => { handleOpenPopup(contextMenu.origIdx); setContextMenu(null); }}
          onRotate={() => { onRotate(contextMenu.origIdx); setContextMenu(null); }}
          onRemove={() => { onRemove(contextMenu.origIdx); setContextMenu(null); }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

// ── SortableGrid: @dnd-kit drag-and-drop ──────────────────────────────────

function SortableGrid({
  orderedIndices,
  thumbUrls,
  warningsByIndex,
  duplicateMembership,
  userRotation,
  uncertainSet,
  onReorder,
  onRemove,
  onRotate,
  onOpenPopup,
  onContextMenu,
  onKeepRecommendedDuplicate,
}) {
  const [dndReady, setDndReady] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [core, sortable, utilities] = await Promise.all([
          import('@dnd-kit/core'),
          import('@dnd-kit/sortable'),
          import('@dnd-kit/utilities'),
        ]);
        if (cancelled) return;
        setDndReady({
          DndContext: core.DndContext,
          PointerSensor: core.PointerSensor,
          TouchSensor: core.TouchSensor,
          useSensor: core.useSensor,
          useSensors: core.useSensors,
          closestCenter: core.closestCenter,
          SortableContext: sortable.SortableContext,
          rectSortingStrategy: sortable.rectSortingStrategy,
          arrayMove: sortable.arrayMove,
          useSortable: sortable.useSortable,
          CSS: utilities.CSS,
        });
      } catch (e) {
        console.warn('[ImageMergePanel] @dnd-kit lazy load failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!dndReady) {
    return (
      <div className="image-merge-panel__grid image-merge-panel__grid--loading">
        {orderedIndices.map((origIdx, position) => (
          <Thumbnail
            key={origIdx}
            origIdx={origIdx}
            position={position}
            url={thumbUrls.get(origIdx)}
            warning={warningsByIndex.get(origIdx) || null}
            duplicateInfo={duplicateMembership.get(origIdx) || null}
            rotation={userRotation.get(origIdx) || 0}
            isUncertain={uncertainSet?.has?.(origIdx) || false}
            onRemove={() => onRemove(origIdx)}
            onRotate={() => onRotate(origIdx)}
            onOpenPopup={() => onOpenPopup(origIdx)}
            onContextMenu={(e) => onContextMenu(e, origIdx)}
            onKeepRecommendedDuplicate={onKeepRecommendedDuplicate}
            sortable={null}
          />
        ))}
      </div>
    );
  }

  return (
    <DndGrid
      dndReady={dndReady}
      orderedIndices={orderedIndices}
      thumbUrls={thumbUrls}
      warningsByIndex={warningsByIndex}
      duplicateMembership={duplicateMembership}
      userRotation={userRotation}
      uncertainSet={uncertainSet}
      onReorder={onReorder}
      onRemove={onRemove}
      onRotate={onRotate}
      onOpenPopup={onOpenPopup}
      onContextMenu={onContextMenu}
      onKeepRecommendedDuplicate={onKeepRecommendedDuplicate}
    />
  );
}

function DndGrid({
  dndReady, orderedIndices, thumbUrls, warningsByIndex, duplicateMembership, userRotation, uncertainSet,
  onReorder, onRemove, onRotate, onOpenPopup, onContextMenu, onKeepRecommendedDuplicate,
}) {
  const {
    DndContext, PointerSensor, TouchSensor, useSensor, useSensors, closestCenter,
    SortableContext, rectSortingStrategy, arrayMove,
  } = dndReady;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedIndices.indexOf(active.id);
    const newIndex = orderedIndices.indexOf(over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(orderedIndices, oldIndex, newIndex));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={orderedIndices} strategy={rectSortingStrategy}>
        <div className="image-merge-panel__grid">
          {orderedIndices.map((origIdx, position) => (
            <SortableThumbnail
              key={origIdx}
              dndReady={dndReady}
              origIdx={origIdx}
              position={position}
              url={thumbUrls.get(origIdx)}
              warning={warningsByIndex.get(origIdx) || null}
              duplicateInfo={duplicateMembership.get(origIdx) || null}
              rotation={userRotation.get(origIdx) || 0}
              isUncertain={uncertainSet?.has?.(origIdx) || false}
              onRemove={() => onRemove(origIdx)}
              onRotate={() => onRotate(origIdx)}
              onOpenPopup={() => onOpenPopup(origIdx)}
              onContextMenu={(e) => onContextMenu(e, origIdx)}
              onKeepRecommendedDuplicate={onKeepRecommendedDuplicate}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableThumbnail({
  dndReady, origIdx, position, url, warning, duplicateInfo, rotation, isUncertain,
  onRemove, onRotate, onOpenPopup, onContextMenu, onKeepRecommendedDuplicate,
}) {
  const { useSortable, CSS } = dndReady;
  const sortable = useSortable({ id: origIdx });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  return (
    <div ref={sortable.setNodeRef} style={style}>
      <Thumbnail
        origIdx={origIdx}
        position={position}
        url={url}
        warning={warning}
        duplicateInfo={duplicateInfo}
        rotation={rotation}
        isUncertain={isUncertain}
        onRemove={onRemove}
        onRotate={onRotate}
        onOpenPopup={onOpenPopup}
        onContextMenu={onContextMenu}
        onKeepRecommendedDuplicate={onKeepRecommendedDuplicate}
        sortable={{
          listeners: sortable.listeners,
          attributes: sortable.attributes,
          isDragging: sortable.isDragging,
        }}
      />
    </div>
  );
}

// ── Rebuild PDF (з urotation + autoOrientation композицією) ──────────────
//
// Фінальний кут обертання = (autoOrientation + userRotation) mod 360. Тобто
// сума того що визначила система автоматично і того що адвокат докрутив рукою.
// Це коректно бо обидва кути — у CW напрямку (rotateImageBlob уніфікований).

async function rebuildFromOcrResults({
  orderedIndices,
  realFiles,
  ocrResults,
  detectedOrientations,
  userRotation,
  userCrops,
}) {
  const extractedText = orderedIndices
    .map((idx) => ocrResults[idx]?.text || '')
    .filter((t) => t && t.trim())
    .join('\n\n--- Page break ---\n\n');

  const mergedPages = [];
  let pageNum = 1;
  for (const idx of orderedIndices) {
    const ps = ocrResults[idx]?.pageStructure;
    if (Array.isArray(ps)) {
      for (const p of ps) {
        if (p && typeof p === 'object') {
          const copy = { ...p, pageNumber: pageNum };
          delete copy.image;
          delete copy.tokens;
          mergedPages.push(copy);
          pageNum++;
        }
      }
    }
  }
  const layoutJson = mergedPages.length > 0
    ? JSON.stringify({
        schemaVersion: 1,
        provider: ocrResults[orderedIndices[0]]?.provider || 'documentAi',
        generatedAt: new Date().toISOString(),
        pages: mergedPages,
      })
    : null;

  const { rotateImageBlob } = await import('../../services/sortation/orientationCorrector.js');
  const jspdfMod = await import('jspdf');
  const JsPDF = jspdfMod.jsPDF || jspdfMod.default;

  const pdf = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const A4W = 210, A4H = 297, M = 10;
  const PX_TO_MM = 0.264583;

  for (let i = 0; i < orderedIndices.length; i++) {
    const origIdx = orderedIndices[i];
    // Якщо адвокат обрізав — використовуємо обрізаний blob, інакше оригінал.
    // На обрізаному autoDeg вже застосовано НЕ було (адвокат побачив повне
    // зображення, повернув його тільки через userRotation), тому autoDeg для
    // cropped = 0.
    const cropBlob = userCrops?.get?.(origIdx);
    const sourceFile = cropBlob || realFiles[origIdx];
    const autoDeg = cropBlob
      ? 0
      : (Number.isFinite(detectedOrientations?.[origIdx]) ? detectedOrientations[origIdx] : 0);
    const userDeg = userRotation?.get?.(origIdx) || 0;
    const totalDeg = (autoDeg + userDeg) % 360;
    // ВАЖЛИВО: автообертання вже зашите у pipeline pdf, але тут ми будуємо
    // НОВИЙ PDF з оригінальних realFiles. Тому застосовуємо ПОВНИЙ totalDeg.
    const blob = totalDeg !== 0 ? await rotateImageBlob(sourceFile, totalDeg) : sourceFile;

    const url = URL.createObjectURL(blob);
    let img;
    try {
      img = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error('image load'));
        im.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }

    const orient = img.width > img.height ? 'landscape' : 'portrait';
    if (i > 0) pdf.addPage('a4', orient);
    const pageW = orient === 'landscape' ? A4H : A4W;
    const pageH = orient === 'landscape' ? A4W : A4H;
    const usableW = pageW - 2 * M;
    const usableH = pageH - 2 * M;
    const imgWmm = img.width * PX_TO_MM;
    const imgHmm = img.height * PX_TO_MM;
    const r = Math.min(usableW / imgWmm, usableH / imgHmm);
    const drawW = imgWmm * r;
    const drawH = imgHmm * r;
    const offX = (pageW - drawW) / 2;
    const offY = (pageH - drawH) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    pdf.addImage(dataUrl, 'JPEG', offX, offY, drawW, drawH);
  }

  const pdfBlob = pdf.output('blob');
  return { pdfBlob, extractedText, layoutJson };
}

// ── Thumbnail ──────────────────────────────────────────────────────────────

function Thumbnail({
  origIdx, position, url, warning, duplicateInfo, rotation, isUncertain,
  onRemove, onRotate, onOpenPopup, onContextMenu, onKeepRecommendedDuplicate, sortable,
}) {
  const isDuplicateRecommended = duplicateInfo && duplicateInfo.recommended === origIdx;
  const isDuplicateOther = duplicateInfo && duplicateInfo.recommended !== origIdx;

  const cls =
    'image-merge-panel__thumb' +
    (warning ? ' image-merge-panel__thumb--warn' : '') +
    (duplicateInfo ? ' image-merge-panel__thumb--dup' : '') +
    (isDuplicateRecommended ? ' image-merge-panel__thumb--dup-recommended' : '') +
    (isDuplicateOther ? ' image-merge-panel__thumb--dup-other' : '') +
    (sortable?.isDragging ? ' image-merge-panel__thumb--dragging' : '');

  const handleClick = (e) => {
    // Простий клік по картинці — теж відкриває попап (touch UX:
    // адвокат тапнув по картинці = хоче розглянути).
    // Drag-and-drop спрацьовує тільки якщо рух > activationConstraint distance.
    if (e.target.closest('button')) return; // клік по кнопці — окремий handler
    onOpenPopup();
  };

  return (
    <div
      className={cls}
      onContextMenu={onContextMenu}
    >
      <div className="image-merge-panel__thumb-image-wrap"
           {...(sortable?.listeners || {})}
           {...(sortable?.attributes || {})}
           role="button"
           tabIndex={0}
           onClick={handleClick}
           aria-label={`Сторінка ${position + 1}. Тап — переглянути, утримуйте для перетягування.`}
      >
        {url ? (
          <img
            src={url}
            alt={`Сторінка ${position + 1}`}
            className="image-merge-panel__thumb-img"
            style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
          />
        ) : (
          <div className="image-merge-panel__thumb-placeholder">
            <ImageIcon size={32} />
          </div>
        )}
        <span className="image-merge-panel__thumb-pos">#{position + 1}</span>
        {isDuplicateRecommended && (
          <span className="image-merge-panel__thumb-dup-badge image-merge-panel__thumb-dup-badge--recommended">
            <Check size={12} />
            Рекомендую залишити
          </span>
        )}
        {isDuplicateOther && (
          <span className="image-merge-panel__thumb-dup-badge">
            Дублікат
          </span>
        )}
        {isUncertain && !duplicateInfo && (
          <span className="image-merge-panel__thumb-orient-badge" title="Орієнтація визначена за пропорціями. Перевір кнопкою ↻.">
            <AlertTriangle size={10} /> Перевір орієнтацію
          </span>
        )}
        <span
          className="image-merge-panel__thumb-handle"
          aria-hidden="true"
          title="Перетягніть для зміни порядку"
        >
          <GripVertical size={16} />
        </span>
      </div>

      {/* Кнопки під картинкою — окремий рядок */}
      <div className="image-merge-panel__thumb-actions">
        <button
          type="button"
          className="image-merge-panel__thumb-action"
          onClick={onOpenPopup}
          title="Переглянути збільшено"
          aria-label="Переглянути"
        >
          <Eye size={ICON_SIZE.sm} />
        </button>
        <button
          type="button"
          className="image-merge-panel__thumb-action"
          onClick={onRotate}
          title="Повернути на 90°"
          aria-label="Повернути"
        >
          <RotateCw size={ICON_SIZE.sm} />
        </button>
        <button
          type="button"
          className="image-merge-panel__thumb-action image-merge-panel__thumb-action--danger"
          onClick={onRemove}
          title="Видалити"
          aria-label="Видалити"
        >
          <X size={ICON_SIZE.sm} />
        </button>
      </div>

      {duplicateInfo && isDuplicateRecommended && (
        <button
          type="button"
          className="image-merge-panel__thumb-keep-dup"
          onClick={() => onKeepRecommendedDuplicate(duplicateInfo.groupIndices, duplicateInfo.recommended)}
          title={duplicateInfo.reason}
        >
          Залишити цей, видалити інші
        </button>
      )}

      {warning && (
        <div className="image-merge-panel__thumb-warning" title={warning}>
          <AlertTriangle size={12} />
          <span>{warning}</span>
        </div>
      )}
    </div>
  );
}

// ── Preview popup (lazy react-zoom-pan-pinch) ─────────────────────────────

function PreviewPopup({
  origIdx, url, sourceBlob, rotation, position, total, warning, duplicateInfo,
  isUncertain, hasCrop, onClose, onPrev, onNext, onRotate, onApplyCrop, onRemove,
}) {
  // 'view' = переглядаємо з zoom/pan; 'crop' = обрізаємо.
  const [popupMode, setPopupMode] = useState('view');
  const [zoomReady, setZoomReady] = useState(null);
  const [cropReady, setCropReady] = useState(null);

  // Lazy-load обох бібліотек
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('react-zoom-pan-pinch');
        if (cancelled) return;
        setZoomReady({
          TransformWrapper: mod.TransformWrapper,
          TransformComponent: mod.TransformComponent,
        });
      } catch (e) {
        console.warn('[ImageMergePanel] react-zoom-pan-pinch lazy load failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (popupMode !== 'crop' || cropReady) return;
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('react-easy-crop');
        if (cancelled) return;
        setCropReady({ Cropper: mod.default || mod.Cropper });
      } catch (e) {
        console.warn('[ImageMergePanel] react-easy-crop lazy load failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [popupMode, cropReady]);

  const TransformWrapper = zoomReady?.TransformWrapper;
  const TransformComponent = zoomReady?.TransformComponent;
  const Cropper = cropReady?.Cropper;

  const isFirst = position === 0;
  const isLast = position === total - 1;

  // Crop state — react-easy-crop потребує controlled crop/zoom і onCropComplete
  // який передає piксельні координати. Зберігаємо у ref щоб handleCropApply
  // мав останній знімок без зайвих re-renders.
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const cropAreaRef = useRef(null);

  function handleCropChange(c) { setCrop(c); }
  function handleZoomChange(z) { setZoom(z); }
  function handleCropComplete(_area, areaPixels) {
    cropAreaRef.current = areaPixels;
  }

  async function handleCropApply() {
    if (!cropAreaRef.current || !sourceBlob) {
      setPopupMode('view');
      return;
    }
    try {
      const { cropImageBlob } = await import('../../services/sortation/cropHelper.js');
      const cropped = await cropImageBlob(sourceBlob, cropAreaRef.current);
      onApplyCrop(cropped);
      setPopupMode('view');
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    } catch (e) {
      console.error('[ImageMergePanel] crop apply failed:', e);
      toast.error('Не вдалось обрізати зображення', { description: e?.message });
    }
  }

  function handleCropCancel() {
    setPopupMode('view');
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  }

  function handleCropReset() {
    onApplyCrop(null); // скидаємо у parent
    setPopupMode('view');
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  }

  // Клавіатурні скорочення у режимі crop: Enter=apply, Esc=cancel
  // (Esc-handler глобальний у PreviewView вже закриває попап, тому тут окремий
  // case коли popupMode='crop' — Esc скасовує crop не закриваючи попап).
  useEffect(() => {
    if (popupMode !== 'crop') return;
    function onKey(e) {
      if (e.key === 'Enter') { e.preventDefault(); handleCropApply(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); handleCropCancel(); }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popupMode, sourceBlob]);

  return (
    <div className="image-merge-panel__popup-overlay" role="dialog" aria-modal="true">
      <div className="image-merge-panel__popup">
        <div className="image-merge-panel__popup-header">
          <span className="image-merge-panel__popup-position">
            Сторінка {position + 1} з {total}
          </span>
          {duplicateInfo && (
            <span className="image-merge-panel__popup-tag image-merge-panel__popup-tag--dup">
              {duplicateInfo.recommended === origIdx ? 'Рекомендований варіант' : 'Дублікат'}
            </span>
          )}
          {warning && (
            <span className="image-merge-panel__popup-tag image-merge-panel__popup-tag--warn">
              <AlertTriangle size={14} /> Підозрілий
            </span>
          )}
          {isUncertain && !warning && (
            <span className="image-merge-panel__popup-tag image-merge-panel__popup-tag--warn">
              <AlertTriangle size={14} /> Перевір орієнтацію
            </span>
          )}
          {hasCrop && popupMode === 'view' && (
            <span className="image-merge-panel__popup-tag">
              <CropIcon size={12} /> Обрізано
            </span>
          )}
          {popupMode === 'crop' && (
            <span className="image-merge-panel__popup-tag image-merge-panel__popup-tag--dup">
              <CropIcon size={12} /> Режим обрізки
            </span>
          )}
          <button
            type="button"
            className="image-merge-panel__popup-close"
            onClick={onClose}
            aria-label="Закрити"
            title="Закрити (Esc)"
          >
            <X size={20} />
          </button>
        </div>

        <div className="image-merge-panel__popup-body">
          {popupMode === 'crop' ? (
            <div className="image-merge-panel__crop-host">
              {Cropper ? (
                <Cropper
                  image={url}
                  crop={crop}
                  zoom={zoom}
                  rotation={rotation}
                  aspect={null}
                  restrictPosition={false}
                  showGrid={true}
                  onCropChange={handleCropChange}
                  onZoomChange={handleZoomChange}
                  onCropComplete={handleCropComplete}
                />
              ) : (
                <div style={{ color: '#fff', padding: 20 }}>Завантаження crop-модуля…</div>
              )}
            </div>
          ) : TransformWrapper ? (
            <TransformWrapper
              initialScale={1}
              minScale={0.5}
              maxScale={6}
              doubleClick={{ mode: 'reset' }}
              wheel={{ activationKeys: ['Control'] }}
              pinch={{ step: 5 }}
              panning={{ velocityDisabled: true }}
            >
              <TransformComponent
                wrapperClass="image-merge-panel__popup-zoom-wrap"
                contentClass="image-merge-panel__popup-zoom-content"
              >
                <img
                  src={url}
                  alt={`Сторінка ${position + 1}`}
                  className="image-merge-panel__popup-img"
                  style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
                  draggable={false}
                />
              </TransformComponent>
            </TransformWrapper>
          ) : (
            <div className="image-merge-panel__popup-zoom-wrap image-merge-panel__popup-zoom-wrap--loading">
              <img
                src={url}
                alt={`Сторінка ${position + 1}`}
                className="image-merge-panel__popup-img"
                style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
                draggable={false}
              />
            </div>
          )}
        </div>

        {popupMode === 'crop' ? (
          <>
            <div className="image-merge-panel__popup-toolbar">
              <button
                type="button"
                className="image-merge-panel__popup-nav"
                onClick={handleCropCancel}
                title="Скасувати (Esc)"
              >
                Скасувати
              </button>
              <div className="image-merge-panel__popup-tools">
                {hasCrop && (
                  <button
                    type="button"
                    className="image-merge-panel__popup-tool"
                    onClick={handleCropReset}
                    title="Скинути до повного зображення"
                  >
                    <span>Скинути до повного</span>
                  </button>
                )}
              </div>
              <button
                type="button"
                className="image-merge-panel__popup-nav image-merge-panel__popup-nav--primary"
                onClick={handleCropApply}
                title="Застосувати (Enter)"
              >
                Застосувати ✓
              </button>
            </div>
            <div className="image-merge-panel__popup-hint">
              Тягни кути або сторони рамки. Pinch — zoom фото. Enter — застосувати, Esc — скасувати.
            </div>
          </>
        ) : (
          <>
            <div className="image-merge-panel__popup-toolbar">
              <button
                type="button"
                className="image-merge-panel__popup-nav"
                onClick={onPrev}
                disabled={isFirst}
                title="Попередня (←)"
                aria-label="Попередня"
              >
                ‹ Попередня
              </button>
              <div className="image-merge-panel__popup-tools">
                <button
                  type="button"
                  className="image-merge-panel__popup-tool"
                  onClick={onRotate}
                  title="Повернути на 90° (R)"
                >
                  <RotateCw size={18} />
                  <span>Повернути</span>
                </button>
                <button
                  type="button"
                  className="image-merge-panel__popup-tool"
                  onClick={() => setPopupMode('crop')}
                  title="Обрізати"
                  disabled={!sourceBlob}
                >
                  <CropIcon size={18} />
                  <span>Обрізати</span>
                </button>
                <button
                  type="button"
                  className="image-merge-panel__popup-tool image-merge-panel__popup-tool--danger"
                  onClick={onRemove}
                  title="Видалити (Delete)"
                >
                  <Trash2 size={18} />
                  <span>Видалити</span>
                </button>
              </div>
              <button
                type="button"
                className="image-merge-panel__popup-nav"
                onClick={onNext}
                disabled={isLast}
                title="Наступна (→)"
                aria-label="Наступна"
              >
                Наступна ›
              </button>
            </div>

            <div className="image-merge-panel__popup-hint">
              Pinch / Ctrl+scroll — zoom · Драг — pan · Подвійний тап / клік — скинути
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Context menu (desktop right-click) ───────────────────────────────────

function ContextMenu({ x, y, onView, onRotate, onRemove }) {
  // Корекція позиції щоб меню не вилазило за межі екрану.
  const adjX = typeof window !== 'undefined'
    ? Math.min(x, window.innerWidth - 220)
    : x;
  const adjY = typeof window !== 'undefined'
    ? Math.min(y, window.innerHeight - 200)
    : y;
  return (
    <div
      className="image-merge-panel__ctxmenu"
      style={{ left: adjX, top: adjY }}
      role="menu"
    >
      <button type="button" className="image-merge-panel__ctxmenu-item" onClick={onView}>
        <Eye size={ICON_SIZE.sm} /> Переглянути
      </button>
      <button type="button" className="image-merge-panel__ctxmenu-item" onClick={onRotate}>
        <RotateCw size={ICON_SIZE.sm} /> Повернути на 90°
      </button>
      <button
        type="button"
        className="image-merge-panel__ctxmenu-item image-merge-panel__ctxmenu-item--danger"
        onClick={onRemove}
      >
        <Trash2 size={ICON_SIZE.sm} /> Видалити
      </button>
    </div>
  );
}

// ── Single file warning (TASK B fix 4) ───────────────────────────────────

function SingleFileWarning({ file, canRedirect, onRedirect, onAddMore, onCancel }) {
  return (
    <div className="image-merge-panel__sfw-overlay" role="dialog" aria-modal="true">
      <div className="image-merge-panel__sfw">
        <div className="image-merge-panel__sfw-icon">
          <AlertTriangle size={32} />
        </div>
        <h3 className="image-merge-panel__sfw-title">Вибрано один файл</h3>
        <p className="image-merge-panel__sfw-text">
          Склейка має сенс для двох або більше зображень. Для додавання одного
          документа використайте кнопку «Додати файл» — це швидше і не запускає
          сортування.
        </p>
        <div className="image-merge-panel__sfw-file">
          <ImageIcon size={ICON_SIZE.sm} />
          <span>{file?.name || 'Без імені'}</span>
        </div>
        <div className="image-merge-panel__sfw-actions">
          {canRedirect && (
            <Button variant="primary" onClick={onRedirect}>
              Перейти до «Додати файл»
            </Button>
          )}
          <Button variant="secondary" onClick={onAddMore}>
            Додати ще зображень
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Скасувати
          </Button>
        </div>
      </div>
    </div>
  );
}
