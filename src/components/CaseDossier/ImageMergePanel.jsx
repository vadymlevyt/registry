// ── IMAGE MERGE PANEL ────────────────────────────────────────────────────────
// Компонент для склейки кількох зображень у один PDF (TASK B).
//
// 3 фази:
//   selecting — вибір файлів (device input multiple + Drive multi-select picker)
//   processing — OCR + sortImages (з прогрес-баром у наступному коміті B.6)
//   preview — grid з drag-and-drop, warnings, видалити, форма метаданих
//
// Інтеграція з CaseDossier:
//   onSubmit({ name, category, author, procId, date, isKey,
//              file: pdfFileFromMerge,
//              mergeArtifacts: { extractedText, layoutJson, sortResult } })
//   CaseDossier бачить mergeArtifacts і:
//     - file (PDF Blob) — passthrough через convertToPdf
//     - НЕ запускає повторний OCR (extractedText уже є)
//     - Пише .txt + .layout.json у 02_ОБРОБЛЕНІ напряму
//
// Drag-and-drop через @dnd-kit/core + @dnd-kit/sortable (touch + a11y).
// Lazy-loaded чанк при першому відкритті preview.

import { useState, useCallback, useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import {
  Image as ImageIcon,
  Upload,
  Cloud,
  X,
  ArrowLeft,
  AlertTriangle,
  Trash2,
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
 *                       (parent відкриває DrivePickerSection у selectionMode='multi-images'
 *                        і повертає вибрані файли через addDriveFiles())
 */
export const ImageMergePanel = forwardRef(function ImageMergePanel(
  { caseData, apiKey, onSubmit, onCancel, onOpenDrivePicker },
  ref
) {
  // Phase: 'selecting' | 'processing' | 'preview'
  const [phase, setPhase] = useState('selecting');
  // Список зібраних файлів (device + Drive). File або Drive-marker object.
  const [files, setFiles] = useState([]);
  // Метаданих pipeline-результат після OCR + sort
  const [pipelineResult, setPipelineResult] = useState(null);
  // Поточний порядок індексів у preview (можна перетягувати)
  const [orderedIndices, setOrderedIndices] = useState([]);
  // Видалені індекси (адвокат натиснув X на thumbnail)
  const [removedIndices, setRemovedIndices] = useState(() => new Set());
  // Прогрес фази
  const [progress, setProgress] = useState({ phase: '', done: 0, total: 0 });
  // Form
  const [form, setForm] = useState({
    name: '',
    category: '',
    author: '',
    procId: caseData?.proceedings?.[0]?.id || '',
    date: '',
    isKey: false,
  });
  const [submitting, setSubmitting] = useState(false);
  // Тумбнейли (URL.createObjectURL) — створюємо у processing, очищуємо на unmount
  const thumbUrlsRef = useRef(new Map()); // index → blobUrl

  // Reset state коли компонент монтуєтсья
  useEffect(() => {
    return () => {
      // Cleanup blob URLs
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
    e.target.value = ''; // дозволяємо повторно вибрати ті ж файли
  };

  const addDriveFiles = useCallback((driveFiles) => {
    // Drive-файли треба завантажити як Blob і обернути у File. Робимо це
    // лінь-завантаження у processing фазі (тут — тільки додаємо до списку
    // зі маркером _isDriveSource + _driveId).
    const mapped = driveFiles.map((df) => ({
      _isDriveSource: true,
      _driveId: df.id,
      name: df.name,
      size: df.size ? parseInt(df.size, 10) : 0,
      type: df.mimeType || 'image/jpeg',
    }));
    setFiles((prev) => [...prev, ...mapped]);
  }, []);

  // Expose addDriveFiles для parent через ref не потрібно — parent сам тримає
  // collback через onOpenDrivePicker.

  const removeFile = (idx) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleStartProcessing = async () => {
    if (files.length === 0) {
      toast.error('Додайте хоча б одне зображення');
      return;
    }
    // А1=A: при 50+ зображеннях — confirmation з оцінкою часу.
    if (files.length > MAX_IMAGES_WARN) {
      const minutes = Math.ceil(files.length / 25); // ~25 фото/хв для OCR + agent
      const ok = window.confirm(
        `Великий обсяг: ${files.length} зображень.\n` +
        `Обробка займе приблизно ${minutes} хв.\n\n` +
        `Продовжити?`
      );
      if (!ok) return;
    }

    // Завантажуємо Drive файли як Blob → File перед pipeline
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
        durationMs: result?.durationMs,
      });

      // Захист від невалідного результату pipeline. Якщо pdfBlob відсутній —
      // дальше неможливо ні preview, ні submit. Кидаємо явну помилку щоб
      // адвокат побачив toast замість заглухлого 'processing'.
      if (!(result?.pdfBlob instanceof Blob) || result.pdfBlob.size === 0) {
        throw new Error('Pipeline повернув порожній PDF');
      }
      if (!Array.isArray(result.finalOrder) || result.finalOrder.length === 0) {
        throw new Error('Pipeline повернув порожній finalOrder');
      }

      // Створюємо blob URLs для thumbnails
      for (let i = 0; i < realFiles.length; i++) {
        if (!thumbUrlsRef.current.has(i)) {
          thumbUrlsRef.current.set(i, URL.createObjectURL(realFiles[i]));
        }
      }

      setPipelineResult({ ...result, realFiles });
      setOrderedIndices(result.finalOrder);
      setForm((prev) => ({
        ...prev,
        name: result.suggestedName || result.pdfName || prev.name,
      }));
      setPhase('preview');
    } catch (e) {
      console.error('[merge] pipeline failed:', e);
      toast.error('Не вдалось обробити зображення', { description: e?.message });
      setPhase('selecting');
    }
  };

  const handleRemoveIndex = (origIdx) => {
    setRemovedIndices((prev) => {
      const next = new Set(prev);
      next.add(origIdx);
      return next;
    });
    setOrderedIndices((prev) => prev.filter((i) => i !== origIdx));
  };

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
      // Якщо адвокат залишив тільки частину зображень — перебудовуємо PDF
      // у новому порядку. Якщо все як було і порядок не мінявся — re-use готовий.
      const orderUnchanged =
        orderedIndices.length === pipelineResult.finalOrder.length &&
        orderedIndices.every((v, i) => v === pipelineResult.finalOrder[i]);

      let finalPdfBlob;
      let finalText;
      let finalLayout;

      if (orderUnchanged && removedIndices.size === 0) {
        finalPdfBlob = pipelineResult.pdfBlob;
        finalText = pipelineResult.extractedText;
        finalLayout = pipelineResult.layoutJson;
      } else {
        // Адвокат перепорядкував/видалив. Перебудовуємо PDF + .txt + .layout
        // ТІЛЬКИ з тих індексів що залишились, у новому порядку.
        // OCR НЕ запускаємо — використовуємо вже отримані ocrResults з пам'яті.
        const rebuilt = await rebuildFromOcrResults({
          orderedIndices,
          realFiles: pipelineResult.realFiles,
          ocrResults: pipelineResult.ocrResults,
        });
        finalPdfBlob = rebuilt.pdfBlob;
        finalText = rebuilt.extractedText;
        finalLayout = rebuilt.layoutJson;
      }

      // Унікалізуємо назву серед документів справи (адвокат міг змінити)
      const existingNames = (caseData?.documents || []).map((d) => d.name).filter(Boolean);
      const uniqueName = ensureUniqueName(form.name.trim(), existingNames);

      // Конвертуємо PDF blob у File для передачі через onSubmit
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

  // Imperative API для parent: addDriveFiles(driveFiles[]) додає файли у чергу.
  // Parent викликає її коли Drive picker (multi-images mode) повертає selection.
  useImperativeHandle(ref, () => ({
    addDriveFiles,
  }), [addDriveFiles]);

  if (phase === 'processing') {
    return (
      <ProcessingView progress={progress} />
    );
  }

  if (phase === 'preview') {
    return (
      <PreviewView
        pipelineResult={pipelineResult}
        orderedIndices={orderedIndices}
        removedIndices={removedIndices}
        thumbUrls={thumbUrlsRef.current}
        form={form}
        setForm={setForm}
        onReorder={setOrderedIndices}
        onRemove={handleRemoveIndex}
        onRemoveAllSuspicious={handleRemoveAllSuspicious}
        proceedings={caseData?.proceedings || []}
        onSubmit={handleSubmit}
        onCancel={onCancel}
        submitting={submitting}
      />
    );
  }

  // phase === 'selecting'
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
    </div>
  );
});

// ── Processing view (OCR + sort progress) ─────────────────────────────────
//
// Stepper показує ВСІ фази у послідовності. Поточна фаза підсвічена
// (icon active), завершені — чекмарк, наступні — приглушені. Адвокат бачить
// що було і що залишилось.
//
// Особлива поведінка: фаза 'preparing' (завантаження Drive blobs)
// показується тільки коли всі файли підготовлено, інакше pre-phase.

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

      {/* Stepper з усіма фазами — адвокат бачить що залишилось */}
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

// ── Preview view (drag-and-drop + form) ──────────────────────────────────

function PreviewView({
  pipelineResult,
  orderedIndices,
  removedIndices,
  thumbUrls,
  form,
  setForm,
  onReorder,
  onRemove,
  onRemoveAllSuspicious,
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

  const hasSuspicious = (pipelineResult?.sortResult?.warnings || []).length > 0;
  const missing = pipelineResult?.sortResult?.missing;

  const proceedingOptions = (proceedings || []).map((p) => ({ value: p.id, label: p.title }));

  return (
    <div className="image-merge-panel__preview">
      <SortableGrid
        orderedIndices={orderedIndices}
        thumbUrls={thumbUrls}
        warningsByIndex={warningsByIndex}
        onReorder={onReorder}
        onRemove={onRemove}
      />

      {(missing || hasSuspicious) && (
        <div className="image-merge-panel__alerts">
          {missing && (
            <div className="image-merge-panel__alert image-merge-panel__alert--info">
              <AlertTriangle size={ICON_SIZE.sm} />
              <span>{missing}</span>
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
    </div>
  );
}

// ── SortableGrid: @dnd-kit drag-and-drop ──────────────────────────────────
// Lazy-import @dnd-kit щоб main bundle не тягнув ~15 KB. Завантажується
// тільки при першому показі preview.

function SortableGrid({ orderedIndices, thumbUrls, warningsByIndex, onReorder, onRemove }) {
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
    // Fallback — статичний grid без drag-and-drop поки модуль завантажується
    return (
      <div className="image-merge-panel__grid image-merge-panel__grid--loading">
        {orderedIndices.map((origIdx, position) => (
          <Thumbnail
            key={origIdx}
            origIdx={origIdx}
            position={position}
            url={thumbUrls.get(origIdx)}
            warning={warningsByIndex.get(origIdx) || null}
            onRemove={() => onRemove(origIdx)}
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
      onReorder={onReorder}
      onRemove={onRemove}
    />
  );
}

function DndGrid({ dndReady, orderedIndices, thumbUrls, warningsByIndex, onReorder, onRemove }) {
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
              onRemove={() => onRemove(origIdx)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableThumbnail({ dndReady, origIdx, position, url, warning, onRemove }) {
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
        onRemove={onRemove}
        sortable={{
          listeners: sortable.listeners,
          attributes: sortable.attributes,
          isDragging: sortable.isDragging,
        }}
      />
    </div>
  );
}

// ── Rebuild PDF після перепорядкування/видалення (БЕЗ повторного OCR) ─────
//
// Адвокат у preview може:
//   - перетягнути сторінку у інше місце (orderedIndices змінився)
//   - видалити сторінку (orderedIndices коротший, removedIndices містить її)
//
// У цій ситуації перебудовуємо тільки PDF + об'єднаний text + layout у
// новому порядку. OCR НЕ викликаємо повторно — використовуємо ocrResults
// з пам'яті (КРИТИЧНА вимога TASK B: один OCR на зображення).
//
// Артефакти будуються відповідно до фінального порядку orderedIndices.
async function rebuildFromOcrResults({ orderedIndices, realFiles, ocrResults }) {
  // Об'єднаний text у новому порядку
  const extractedText = orderedIndices
    .map((idx) => ocrResults[idx]?.text || '')
    .filter((t) => t && t.trim())
    .join('\n\n--- Page break ---\n\n');

  // Layout merge з оновленими pageNumber (1..N у новому порядку)
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

  // PDF rebuild — Rotation з пам'яті pageStructure, jsPDF склейка.
  const { extractPageOrientation, rotateImageBlob } = await import('../../services/sortation/orientationCorrector.js');
  const jspdfMod = await import('jspdf');
  const JsPDF = jspdfMod.jsPDF || jspdfMod.default;

  const pdf = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const A4W = 210, A4H = 297, M = 10;
  const PX_TO_MM = 0.264583;

  for (let i = 0; i < orderedIndices.length; i++) {
    const origIdx = orderedIndices[i];
    const file = realFiles[origIdx];
    const firstPage = Array.isArray(ocrResults[origIdx]?.pageStructure)
      ? ocrResults[origIdx].pageStructure[0]
      : null;
    const degrees = extractPageOrientation(firstPage);
    const blob = degrees !== 0 ? await rotateImageBlob(file, degrees) : file;

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

function Thumbnail({ origIdx, position, url, warning, onRemove, sortable }) {
  const cls =
    'image-merge-panel__thumb' +
    (warning ? ' image-merge-panel__thumb--warn' : '') +
    (sortable?.isDragging ? ' image-merge-panel__thumb--dragging' : '');
  return (
    <div className={cls}>
      <div className="image-merge-panel__thumb-drag-handle"
           {...(sortable?.listeners || {})}
           {...(sortable?.attributes || {})}
           aria-label="Перетягнути для зміни порядку"
      >
        {url ? (
          <img src={url} alt={`Сторінка ${position + 1}`} className="image-merge-panel__thumb-img" />
        ) : (
          <div className="image-merge-panel__thumb-placeholder">
            <ImageIcon size={32} />
          </div>
        )}
        <span className="image-merge-panel__thumb-pos">#{position + 1}</span>
      </div>
      <button
        type="button"
        className="image-merge-panel__thumb-remove"
        onClick={onRemove}
        aria-label="Видалити"
      >
        <X size={ICON_SIZE.sm} />
      </button>
      {warning && (
        <div className="image-merge-panel__thumb-warning" title={warning}>
          <AlertTriangle size={12} />
          <span>{warning}</span>
        </div>
      )}
    </div>
  );
}
