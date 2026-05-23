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
  Square as FrameIcon,
} from 'lucide-react';
import { Input, Select, Toggle, Button, DatePicker } from '../UI';
import { ICON_SIZE } from '../UI/icons.js';
import { toast } from '../../services/toast.js';
import { convertImagesToPdf } from '../../services/converter/converterService.js';
import { ensureUniqueName } from '../../services/sortation/imageSortingAgent.js';
import { detectDocumentEdges } from '../../services/sortation/edgeDetection.js';

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
  // Passive crop UX (правило #11 — кожна Map має один сенс):
  // cropProposals: AI результат edge detection. Set ОДИН раз після pipeline,
  //   далі immutable. Pixel rect у natural image space. null/відсутність
  //   запису = AI не зміг визначити межі надійно.
  // cropOverrides: ручне коригування адвоката (потягнув рукоятки у попапі).
  //   Якщо є — wins над proposal. Pixel rect у тих самих coords.
  // cropDisabled: адвокат натиснув "Скасувати обрізку" (на іконці thumb або
  //   у попапі). Index у цьому Set'і означає що жоден crop НЕ застосовується
  //   для цієї сторінки, навіть якщо є proposal/override.
  const [cropProposals, setCropProposals] = useState(() => new Map());
  const [cropOverrides, setCropOverrides] = useState(() => new Map());
  const [cropDisabled, setCropDisabled] = useState(() => new Set());
  // cropAppliedSet — індекси для яких адвокат тапнув ✓ Готово (явний crop).
  // Розділення від cropOverrides потрібне для сценарію коли адвокат "тільки
  // налаштував рамку" і закрив попап через ✕: рамка зберігається у
  // cropOverrides (для фінального PDF), але preview thumbnail показує full
  // image — не cropped. Apply через ✓ Готово додає idx сюди і preview/popup
  // показують cropped варіант. Final PDF rebuild ігнорує cropAppliedSet
  // (завжди апплаїть rect якщо є — це існуюча поведінка перед фіксом).
  const [cropAppliedSet, setCropAppliedSet] = useState(() => new Set());
  // dismissedDuplicateGroupIds (TASK B fix Problem 4): адвокат натиснув
  // "Це не дублікати" біля групи — група розпадається, члени стають окремими
  // sortable items на їхніх початкових позиціях у orderedIndices. Set ID
  // груп (індекси у sortResult.duplicates).
  const [dismissedDuplicateGroupIds, setDismissedDuplicateGroupIds] = useState(() => new Set());
  // processedBlobs (TASK B fix Addition 3): коли адвокат застосовує crop із
  // straighten-rotation у попапі, ми викликаємо cropper.getCanvas() і
  // отримуємо повністю-оброблений blob (crop + straighten уже застосовані).
  // Зберігаємо його разом із baseUserRotation на момент створення.
  // Map<origIdx, { blob: Blob, baseUserRotation: number }>.
  // У rebuild цей blob використовується напряму (зі delta userRotation якщо
  // адвокат повертав ↻ після Apply).
  const [processedBlobs, setProcessedBlobs] = useState(() => new Map());
  // previewUrls (TASK B fix Problem 1 round 2): URL до обрізаного фото для
  // thumbnail. Генерується автоматично коли cropOverride або processedBlob
  // змінюється для idx. Дає візуальний фідбек що адвокат застосував обрізку.
  // Map<origIdx, string>. Старі URL revoke'аються при заміні чи на cleanup.
  const [previewUrls, setPreviewUrls] = useState(() => new Map());
  const previewUrlsToRevokeRef = useRef([]);
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
      // Cleanup preview URLs (acumulated через previewUrls life)
      for (const u of previewUrlsToRevokeRef.current) {
        try { URL.revokeObjectURL(u); } catch {}
      }
      previewUrlsToRevokeRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Preview URL generation (TASK B fix Problem 1 round 2) ──────────────
  // Коли cropOverride/processedBlob/userRotation змінюється для idx —
  // регенеруємо preview blob (cropped + rotated) і зберігаємо URL для
  // thumbnail. Адвокат бачить обрізаний/повернутий результат у preview
  // одразу після ✓ Готово, а не лише ✂️ icon.
  //
  // Стратегія:
  //   1. Збираємо набір "потребує preview": idx з processedBlob АБО з
  //      cropOverride (без processedBlob)
  //   2. Для кожного — async generation: processed → rotation delta only;
  //      cropOverride → cropImageBlob + rotateImageBlob (userRotation)
  //   3. Атомарно встановлюємо новий previewUrls Map; старі URL revoke'аються
  //      окремо через previewUrlsToRevokeRef (delayed), щоб displayed image
  //      не зникало під час swap.
  //   4. Cropper proposals (cropProposals без override) НЕ генерують preview —
  //      адвокат їх ще не підтвердив.
  useEffect(() => {
    const realFiles = pipelineResult?.realFiles;
    const detectedOrientations = pipelineResult?.detectedOrientations || [];
    if (!Array.isArray(realFiles) || realFiles.length === 0) return;

    // Контекст для unified renderer (computeRenderedBlob). Один об'єкт зі
    // всім станом → одна реалізація логіки трансформації, ніяких локальних
    // дублікатів формул.
    const ctx = {
      realFiles,
      detectedOrientations,
      userRotation,
      processedBlobs,
      cropOverrides,
      cropProposals,
      cropDisabled,
      cropAppliedSet,
    };

    // Збираємо набір індексів які потребують rotated/cropped preview blob.
    // Користувацька rotation у preview НЕ запікається у blob — застосовується
    // через CSS transform для плавної анімації. Тому генеруємо preview blob
    // лише коли є зміна на blob-рівні: auto rotation, crop (applied), або
    // processedBlob. Якщо ні — фолбек на сирий thumbUrl + CSS rotation.
    const targets = new Set();
    for (let i = 0; i < realFiles.length; i++) {
      const autoDeg = Number.isFinite(detectedOrientations[i]) ? detectedOrientations[i] : 0;
      const hasProc = processedBlobs.has(i);
      const hasAppliedCrop = cropAppliedSet.has(i) && cropOverrides.has(i) && !cropDisabled.has(i);
      if (autoDeg !== 0 || hasProc || hasAppliedCrop) targets.add(i);
    }

    let cancelled = false;
    (async () => {
      const { computeRenderedBlob } = await import('../../services/sortation/imageRenderer.js');
      const newUrls = new Map();
      for (const idx of targets) {
        if (cancelled) break;
        try {
          // applyUserRotation:false — user rotation шарується через CSS
          // transform у Thumbnail. applyCrop:true — crop запікається лише
          // якщо cropAppliedSet.has(idx) (логіка всередині computeRenderedBlob).
          const blob = await computeRenderedBlob(
            { ...ctx, idx },
            { applyUserRotation: false, applyCrop: true, includeProposalRect: false }
          );
          if (cancelled) break;
          if (blob && blob !== realFiles[idx]) {
            newUrls.set(idx, URL.createObjectURL(blob));
          }
        } catch (e) {
          console.warn('[preview] generation failed for idx', idx, e);
        }
      }
      if (cancelled) {
        for (const u of newUrls.values()) { try { URL.revokeObjectURL(u); } catch {} }
        return;
      }
      // Replace previewUrls atomically. Old URLs queued for delayed revoke
      // (after React paints with new URLs).
      setPreviewUrls((prev) => {
        for (const [, oldUrl] of prev) previewUrlsToRevokeRef.current.push(oldUrl);
        return newUrls;
      });
      setTimeout(() => {
        const toRevoke = previewUrlsToRevokeRef.current;
        previewUrlsToRevokeRef.current = [];
        for (const u of toRevoke) { try { URL.revokeObjectURL(u); } catch {} }
      }, 1000);
    })();
    return () => { cancelled = true; };
  }, [
    cropOverrides, cropProposals, cropDisabled, cropAppliedSet,
    processedBlobs,
    pipelineResult?.realFiles, pipelineResult?.detectedOrientations,
  ]);
  // ВАЖЛИВО: userRotation НЕ у deps. Preview blob запікається БЕЗ user rotation
  // (тільки auto + crop), а user rotation шарується через CSS transform у
  // Thumbnail для плавної анімації. Тому зміна userRotation не повинна
  // регенерувати blob URL — це б ламало CSS transition.

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
      setCropProposals(new Map());
      setCropOverrides(new Map());
      setCropDisabled(new Set());
      setCropAppliedSet(new Set());
      setDismissedDuplicateGroupIds(new Set());
      setProcessedBlobs(new Map());
      // Revoke попередніх preview URL якщо були (функціональний setState
       // щоб отримати latest map)
      setPreviewUrls((prev) => {
        for (const u of prev.values()) { try { URL.revokeObjectURL(u); } catch {} }
        return new Map();
      });
      setForm((prev) => ({
        ...prev,
        name: result.suggestedName || result.pdfName || prev.name,
      }));
      setPhase('preview');

      // Edge detection — пасивна пропозиція AI. Запускаємо у фоні після
      // preview бо це не блокує адвоката: він уже бачить thumbnails, а
      // іконки ✂️ зʼявляться по мірі готовності. На випадок помилки —
      // просто пропускаємо файл (proposal лишається відсутнім).
      (async () => {
        console.log('[merge] edge detection START for', realFiles.length, 'files');
        const proposals = new Map();
        for (let i = 0; i < realFiles.length; i++) {
          try {
            const rect = await detectDocumentEdges(realFiles[i], realFiles[i]?.name || `#${i}`);
            if (rect) proposals.set(i, rect);
          } catch (e) {
            console.warn('[merge] edge detection failed for idx', i, e);
          }
        }
        console.log('[merge] edge detection DONE: proposals=', proposals.size, 'of', realFiles.length);
        setCropProposals(proposals);
      })();

      // Debug toast info якщо включений debugMode. Формат рядка показує всі
      // сигнали каскаду (TASK B fix Problem 2):
      //   <file>: EXIF=<x>, transforms=<y>, blockField=<z>, blockGeo=<w>,
      //           pageField=<v>, aspect=<r> → <deg>° (<source>)
      // Обгорнуто у try/catch ОКРЕМО від основного pipeline catch'у —
      // діагностичний toast не може ламати pipeline (адвокат уже у
      // phase=preview, помилка форматування рядка не повинна повертати у
      // phase=selecting з «merge failed»).
      if (debugMode && Array.isArray(result.orientationDebug)) {
        try {
          const lines = result.orientationDebug
            .map((d, i) => {
              if (!d) return null;
              const file = realFiles[i]?.name || `#${i}`;
              const parts = [];
              parts.push(d.exif
                ? `EXIF=${d.exif.rawTag}(${d.exif.degrees}°)`
                : 'EXIF=none');
              parts.push(d.transforms
                ? `transforms=${d.transforms.degrees}°`
                : 'transforms=none');
              parts.push(d.blockField
                ? `blockField=${d.blockField.dominant}(${d.blockField.dominantCount}/${d.blockField.totalCount})`
                : 'blockField=none');
              parts.push(d.blockGeometry
                // analyzeBlockGeometry повертає {tall, wide, square, total,
                // tallFraction, wideFraction} — раніше тут було посилання на
                // d.blockGeometry.medianAspect.toFixed(2) і .blockCount, яких
                // не існувало у returned shape.
                ? `blockGeo=tall${d.blockGeometry.tall ?? 0}/wide${d.blockGeometry.wide ?? 0}/total${d.blockGeometry.total ?? 0} (${Math.round((d.blockGeometry.tallFraction ?? 0) * 100)}% vert)`
                : 'blockGeo=none');
              parts.push(d.pageField && d.pageField.orientation != null
                ? `pageField=${d.pageField.orientation}`
                : 'pageField=none');
              parts.push(d.aspect ? `ratio=${d.aspect.ratio}` : 'aspect=none');
              return `${file}: ${parts.join(', ')} → ${d.degrees}° (${d.source}${d.uncertain ? ', uncertain' : ''})`;
            })
            .filter(Boolean);
          toast.show('Orientation діагностика', {
            description: lines.join('\n'),
            duration: 14000,
          });
        } catch (debugErr) {
          console.warn('[merge] debug toast format failed (non-fatal):', debugErr);
        }
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

  // Адвокат тапнув по іконці ✂️ на thumbnail АБО натиснув "Скасувати обрізку"
  // у попапі. Перемикає disabled-стан: якщо був enabled — стає disabled, і
  // навпаки. Працює тільки коли є що перемикати (proposal або override існує).
  const handleToggleCropDisabled = useCallback((origIdx) => {
    setCropDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(origIdx)) next.delete(origIdx);
      else next.add(origIdx);
      return next;
    });
  }, []);

  // Адвокат потягнув рукоятки у попапі — зберігаємо нову rect. Якщо rect
  // null — скидаємо override (повертаємо до proposal якщо є). Якщо адвокат
  // обрізав через ручний crop без proposal — override стає єдиним джерелом.
  //
  // applied прапор:
  //   true  — викликано через ✓ Готово (apply). Preview thumbnail показує
  //           cropped варіант, popup при наступному відкритті теж cropped.
  //   false — викликано через ✕ Cancel після того як адвокат рухав рукоятки
  //           (scenario 2: "тільки налаштував рамку, не обрізав"). Preview
  //           thumbnail показує full image, рамка збережена для фінального
  //           PDF rebuild і для re-edit у попапі.
  const handleCropOverride = useCallback((origIdx, rect, opts = {}) => {
    const applied = opts.applied === true;
    setCropOverrides((prev) => {
      const next = new Map(prev);
      if (rect === null) next.delete(origIdx);
      else next.set(origIdx, rect);
      return next;
    });
    setCropAppliedSet((prev) => {
      const next = new Set(prev);
      if (rect === null) next.delete(origIdx);
      else if (applied) next.add(origIdx);
      else next.delete(origIdx); // явне зняття applied: повертаємо у frame-only
      return next;
    });
    // Якщо адвокат вручну редагує — це сигнал що він ХОЧЕ обрізку. Знімаємо
    // disabled (якщо був). Цей шлях: ручний crop у попапі без proposal, або
    // ре-енейбл після disable з подальшим коригуванням.
    if (rect !== null) {
      setCropDisabled((prev) => {
        if (!prev.has(origIdx)) return prev;
        const next = new Set(prev);
        next.delete(origIdx);
        return next;
      });
    }
  }, []);

  // Кнопка "Не обрізати жодну" у header preview. Вимикає всі AI пропозиції.
  // Адвокат може повернути окремі через тап на іконку ✂️.
  const handleDisableAllCrops = useCallback(() => {
    setCropDisabled((prev) => {
      const next = new Set(prev);
      for (const idx of cropProposals.keys()) next.add(idx);
      for (const idx of cropOverrides.keys()) next.add(idx);
      return next;
    });
  }, [cropProposals, cropOverrides]);

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

  // Зберігаємо processed blob (crop + straighten вже застосовано) для
  // конкретної сторінки. baseUserRotation — userRotation на момент Apply,
  // щоб коректно обчислити delta при наступних ↻.
  const handleProcessedBlobSave = useCallback((origIdx, blob, baseUserRotation) => {
    setProcessedBlobs((prev) => {
      const next = new Map(prev);
      next.set(origIdx, { blob, baseUserRotation });
      return next;
    });
    // Очищаємо застарілі crop overrides — їх перебиває processed blob.
    setCropOverrides((prev) => {
      if (!prev.has(origIdx)) return prev;
      const next = new Map(prev);
      next.delete(origIdx);
      return next;
    });
  }, []);

  // "Це не дублікати" — група розпадається, члени стають окремими.
  // gIdx = індекс групи у pipelineResult.sortResult.duplicates.
  const handleDismissDuplicateGroup = useCallback((gIdx) => {
    setDismissedDuplicateGroupIds((prev) => {
      const next = new Set(prev);
      next.add(gIdx);
      return next;
    });
  }, []);

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

      // Чи є хоч одна сторінка з активним crop? Це визначає чи треба rebuild
      // замість використання готового pipelineResult.pdfBlob. computeRenderedBlob
      // вирішує per-idx (override застосовується якщо applied; proposal —
      // includeProposalRect=true у rebuild), тому ми лише детектимо наявність.
      const hasCrops =
        Array.from(cropOverrides.keys()).some((idx) => !cropDisabled.has(idx) && orderedIndices.includes(idx)) ||
        Array.from(cropProposals.keys()).some((idx) => !cropDisabled.has(idx) && !cropOverrides.has(idx) && orderedIndices.includes(idx));
      const hasProcessed = processedBlobs.size > 0;

      if (orderUnchanged && removedIndices.size === 0 && !hasUserRotation && !hasCrops && !hasProcessed) {
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
          cropOverrides,
          cropProposals,
          cropDisabled,
          cropAppliedSet,
          processedBlobs,
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
        thumbUrls={thumbUrlsRef.current}
        previewUrls={previewUrls}
        realFiles={pipelineResult?.realFiles || []}
        userRotation={userRotation}
        cropProposals={cropProposals}
        cropOverrides={cropOverrides}
        cropDisabled={cropDisabled}
        cropAppliedSet={cropAppliedSet}
        dismissedDuplicateGroupIds={dismissedDuplicateGroupIds}
        processedBlobs={processedBlobs}
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
        onToggleCropDisabled={handleToggleCropDisabled}
        onCropOverride={handleCropOverride}
        onDisableAllCrops={handleDisableAllCrops}
        onRemoveAllSuspicious={handleRemoveAllSuspicious}
        onKeepRecommendedDuplicate={handleKeepRecommendedDuplicates}
        onKeepAllRecommendedDuplicates={handleKeepAllRecommendedDuplicates}
        onDismissDuplicateGroup={handleDismissDuplicateGroup}
        onProcessedBlobSave={handleProcessedBlobSave}
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
  thumbUrls,
  previewUrls,
  realFiles,
  userRotation,
  cropProposals,
  cropOverrides,
  cropDisabled,
  cropAppliedSet,
  dismissedDuplicateGroupIds,
  processedBlobs,
  debugMode,
  setDebugMode,
  form,
  setForm,
  onReorder,
  onRemove,
  onRotate,
  onToggleCropDisabled,
  onCropOverride,
  onDisableAllCrops,
  onRemoveAllSuspicious,
  onKeepRecommendedDuplicate,
  onKeepAllRecommendedDuplicates,
  onDismissDuplicateGroup,
  onProcessedBlobSave,
  proceedings,
  onSubmit,
  onCancel,
  submitting,
}) {
  // Map origIdx → CSS rotation degrees для thumbnail transform. Preview blob
  // в previewUrls запікається БЕЗ user rotation (тільки auto + crop), тому
  // user rotation шарується через CSS transform — плавна анімація 0.3s ease.
  //
  // Якщо є processedBlob, voн уже має (auto + user_at_apply + crop +
  // straighten) baked. CSS dialect: (userNow - baseUserRot) — delta з
  // моменту apply. Без processedBlob: повний user rotation.
  const cssRotationMap = useMemo(() => {
    const m = new Map();
    const total = (pipelineResult?.realFiles?.length) || 0;
    for (let i = 0; i < total; i++) {
      const userDeg = userRotation?.get?.(i) || 0;
      const proc = processedBlobs?.get?.(i);
      const baseUser = proc?.baseUserRotation || 0;
      m.set(i, (((userDeg - baseUser) % 360) + 360) % 360);
    }
    return m;
  }, [userRotation, processedBlobs, pipelineResult?.realFiles?.length]);

  // Маппінг origIdx → crop state ('none' | 'active' | 'disabled' | 'applied').
  // 'none'     = немає proposal/override → іконка не показується.
  // 'active'   = є rect і не disabled, НЕ applied → сіра ✂️ (стан 2).
  // 'disabled' = адвокат вимкнув → іконка тьмяна, обрізка НЕ застосовується.
  // 'applied'  = адвокат тапнув ✓ Готово АБО processedBlob через straighten
  //              → зелена ✓ замість ✂️. Sources of truth: cropAppliedSet
  //              (явний крок адвоката) і processedBlobs (canvas-baked crop).
  const cropStateByIndex = useMemo(() => {
    const map = new Map();
    const allIds = new Set([
      ...(cropProposals?.keys?.() || []),
      ...(cropOverrides?.keys?.() || []),
      ...(processedBlobs?.keys?.() || []),
    ]);
    for (const idx of allIds) {
      if (cropAppliedSet?.has?.(idx) || processedBlobs?.has?.(idx)) {
        map.set(idx, 'applied');
      } else if (cropDisabled?.has?.(idx)) {
        map.set(idx, 'disabled');
      } else {
        map.set(idx, 'active');
      }
    }
    return map;
  }, [cropProposals, cropOverrides, cropDisabled, cropAppliedSet, processedBlobs]);

  const activeCropCount = useMemo(() => {
    let n = 0;
    for (const state of cropStateByIndex.values()) {
      if (state === 'active') n++;
    }
    return n;
  }, [cropStateByIndex]);
  const warningsByIndex = useMemo(() => {
    const map = new Map();
    for (const w of pipelineResult?.sortResult?.warnings || []) {
      map.set(w.index, w.reason);
    }
    return map;
  }, [pipelineResult?.sortResult?.warnings]);

  // Мапа origIdx → { groupId, recommended, reason }. groupId — порядковий
  // номер групи у sortResult.duplicates. Виключаємо dismissed групи —
  // адвокат натиснув «Це не дублікати», вважаємо що це окремі сторінки.
  const duplicateMembership = useMemo(() => {
    const map = new Map();
    const groups = pipelineResult?.sortResult?.duplicates || [];
    groups.forEach((g, groupId) => {
      if (dismissedDuplicateGroupIds?.has?.(groupId)) return;
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
  }, [pipelineResult?.sortResult?.duplicates, dismissedDuplicateGroupIds]);

  // ── DisplayItems (TASK B fix Problem 4) ──────────────────────────────
  // Перетворюємо плоский orderedIndices у список items де дублікати йдуть
  // ОДНИМ item-групою. Це дає:
  //   - Стабільне розташування: дублікати завжди разом
  //   - Drag-and-drop по групі: тягнемо всю групу одним рухом
  //   - Стабільне сортування групи: за original index (deterministic)
  //
  // Item shape:
  //   { type: 'single', id: 'single_<idx>', idx }
  //   { type: 'group',  id: 'group_<gIdx>', gIdx, indices: [origIdx,...],
  //                     recommended, reason }
  //
  // Stability: коли AI повторює запуск і повертає різні order, групи лишаються
  // разом + члени всередині відсортовані за origIdx. Однаковий вхід → той самий
  // displayItems.
  const displayItems = useMemo(() => {
    const groups = pipelineResult?.sortResult?.duplicates || [];
    const activeGroups = groups
      .map((g, gIdx) => ({ g, gIdx }))
      .filter(({ gIdx }) => !dismissedDuplicateGroupIds?.has?.(gIdx));

    if (activeGroups.length === 0) {
      return orderedIndices.map((idx) => ({ type: 'single', id: `single_${idx}`, idx }));
    }

    // index → group meta
    const indexToGroup = new Map();
    for (const { g, gIdx } of activeGroups) {
      for (const idx of g.group) indexToGroup.set(idx, { gIdx, g });
    }

    const items = [];
    const seenGroups = new Set();
    for (const idx of orderedIndices) {
      const meta = indexToGroup.get(idx);
      if (!meta) {
        items.push({ type: 'single', id: `single_${idx}`, idx });
        continue;
      }
      if (seenGroups.has(meta.gIdx)) continue;
      seenGroups.add(meta.gIdx);
      // Stable order у групі: за original index (deterministic)
      const sortedMembers = [...meta.g.group]
        .filter((i) => orderedIndices.includes(i))
        .sort((a, b) => a - b);
      items.push({
        type: 'group',
        id: `group_${meta.gIdx}`,
        gIdx: meta.gIdx,
        indices: sortedMembers,
        recommended: meta.g.recommended,
        reason: meta.g.reason,
      });
    }
    return items;
  }, [orderedIndices, pipelineResult?.sortResult?.duplicates, dismissedDuplicateGroupIds]);

  // Конвертує displayItems зворотньо у плоский array оригінальних індексів —
  // використовується drag-and-drop handler'ом коли треба зберегти новий
  // порядок у orderedIndices.
  const flattenItems = useCallback((items) => {
    const flat = [];
    for (const it of items) {
      if (it.type === 'single') flat.push(it.idx);
      else flat.push(...it.indices);
    }
    return flat;
  }, []);

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
        displayItems={displayItems}
        orderedIndices={orderedIndices}
        thumbUrls={thumbUrls}
        previewUrls={previewUrls}
        warningsByIndex={warningsByIndex}
        duplicateMembership={duplicateMembership}
        userRotation={cssRotationMap}
        uncertainSet={uncertainSet}
        cropStateByIndex={cropStateByIndex}
        onReorder={(newItems) => onReorder(flattenItems(newItems))}
        onRemove={onRemove}
        onRotate={onRotate}
        onToggleCropDisabled={onToggleCropDisabled}
        onOpenPopup={handleOpenPopup}
        onContextMenu={handleContextMenu}
        onKeepRecommendedDuplicate={onKeepRecommendedDuplicate}
        onDismissDuplicateGroup={onDismissDuplicateGroup}
      />

      {(missing || hasSuspicious || duplicateGroupsCount > 0 || uncertainIndices.length > 0 || activeCropCount > 0) && (
        <div className="image-merge-panel__alerts">
          {activeCropCount > 0 && (
            <div className="image-merge-panel__alert image-merge-panel__alert--crop">
              <CropIcon size={ICON_SIZE.sm} />
              <span>
                Обрізку буде застосовано до {activeCropCount} {activeCropCount === 1 ? 'сторінки' : 'сторінок'} (іконка ✂️ на thumbnail). Тапни на іконку щоб вимкнути для окремої.
              </span>
              <button
                type="button"
                className="image-merge-panel__remove-suspicious image-merge-panel__remove-suspicious--crop"
                onClick={onDisableAllCrops}
              >
                <X size={14} />
                Не обрізати жодну
              </button>
            </div>
          )}
          {uncertainIndices.length > 0 && (
            <div className="image-merge-panel__alert image-merge-panel__alert--orient">
              <AlertTriangle size={ICON_SIZE.sm} />
              <span>
                Орієнтація {uncertainIndices.length} {uncertainIndices.length === 1 ? 'сторінки' : 'сторінок'} не визначена автоматично (EXIF немає, Document AI не повернув жодного сигналу). Перевір — кнопка ↻ виправить.
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

        <DatePicker
          label="Дата документа"
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
          key={popupOrigIdx}
          origIdx={popupOrigIdx}
          url={thumbUrls.get(popupOrigIdx)}
          sourceBlob={realFiles?.[popupOrigIdx] || null}
          // ВАЖЛИВО: автообертання і user обертання передаються ОКРЕМО.
          // Popup сам комбінує їх у total для displayUrl/cropper math, але
          // baseUserRotation для processedBlob — це user рівень тільки,
          // інакше delta-логіка плутається. Раніше передавали (auto + user)
          // як єдине поле — це ламало processedBlob delta після ↻ всередині
          // попапу (baseUserRotation == auto + user_at_apply, тоді як
          // computeRenderedBlob чекає user рівень).
          autoRotation={Number.isFinite(pipelineResult?.detectedOrientations?.[popupOrigIdx])
            ? pipelineResult.detectedOrientations[popupOrigIdx]
            : 0}
          userRotation={userRotation.get(popupOrigIdx) || 0}
          cropApplied={cropAppliedSet.has(popupOrigIdx)}
          processedEntry={processedBlobs?.get?.(popupOrigIdx) || null}
          onProcessedBlobSave={(blob, baseUserRotation) => onProcessedBlobSave(popupOrigIdx, blob, baseUserRotation)}
          position={orderedIndices.indexOf(popupOrigIdx)}
          total={orderedIndices.length}
          warning={warningsByIndex.get(popupOrigIdx) || null}
          duplicateInfo={duplicateMembership.get(popupOrigIdx) || null}
          isUncertain={uncertainSet?.has?.(popupOrigIdx) || false}
          cropProposal={cropProposals?.get?.(popupOrigIdx) || null}
          cropOverride={cropOverrides?.get?.(popupOrigIdx) || null}
          cropDisabled={cropDisabled?.has?.(popupOrigIdx) || false}
          onClose={handleClosePopup}
          onPrev={() => handlePopupNav(-1)}
          onNext={() => handlePopupNav(1)}
          onRotate={() => onRotate(popupOrigIdx)}
          onCropOverride={(rect, opts) => onCropOverride(popupOrigIdx, rect, opts)}
          onToggleCropDisabled={() => onToggleCropDisabled(popupOrigIdx)}
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

// ── SortableGrid: @dnd-kit drag-and-drop по displayItems ───────────────────
//
// displayItems — list of { type: 'single'|'group', id, ... } (see PreviewView).
// Sortable одиниці — items (не плоскі індекси). Drag-and-drop переміщує single
// АБО всю групу одним рухом. Адвокат не може перетягти один член групи
// окремо — це правильно бо дублікати мають лишатись поруч.

function SortableGrid({
  displayItems,
  thumbUrls,
  previewUrls,
  warningsByIndex,
  duplicateMembership,
  userRotation,
  uncertainSet,
  cropStateByIndex,
  onReorder,
  onRemove,
  onRotate,
  onToggleCropDisabled,
  onOpenPopup,
  onContextMenu,
  onKeepRecommendedDuplicate,
  onDismissDuplicateGroup,
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

  // Помічник: для одиночного thumbnail position у плоскому списку
  // (для відображення «#N» лейбла). Для group items — масив positions членів.
  const computeFlatPositions = useCallback(() => {
    const map = new Map();
    let pos = 0;
    for (const item of displayItems) {
      if (item.type === 'single') {
        map.set(item.idx, pos++);
      } else {
        for (const idx of item.indices) map.set(idx, pos++);
      }
    }
    return map;
  }, [displayItems]);
  const flatPositions = computeFlatPositions();

  if (!dndReady) {
    return (
      <div className="image-merge-panel__grid image-merge-panel__grid--loading">
        {displayItems.map((item) => (
          <RenderItem
            key={item.id}
            item={item}
            thumbUrls={thumbUrls}
            previewUrls={previewUrls}
            warningsByIndex={warningsByIndex}
            duplicateMembership={duplicateMembership}
            userRotation={userRotation}
            uncertainSet={uncertainSet}
            cropStateByIndex={cropStateByIndex}
            flatPositions={flatPositions}
            onRemove={onRemove}
            onRotate={onRotate}
            onToggleCropDisabled={onToggleCropDisabled}
            onOpenPopup={onOpenPopup}
            onContextMenu={onContextMenu}
            onKeepRecommendedDuplicate={onKeepRecommendedDuplicate}
            onDismissDuplicateGroup={onDismissDuplicateGroup}
            sortableRef={null}
            sortableStyle={null}
            sortableListeners={null}
            sortableAttributes={null}
            isDragging={false}
          />
        ))}
      </div>
    );
  }

  return (
    <DndGrid
      dndReady={dndReady}
      displayItems={displayItems}
      thumbUrls={thumbUrls}
      previewUrls={previewUrls}
      warningsByIndex={warningsByIndex}
      duplicateMembership={duplicateMembership}
      userRotation={userRotation}
      uncertainSet={uncertainSet}
      cropStateByIndex={cropStateByIndex}
      flatPositions={flatPositions}
      onReorder={onReorder}
      onRemove={onRemove}
      onRotate={onRotate}
      onToggleCropDisabled={onToggleCropDisabled}
      onOpenPopup={onOpenPopup}
      onContextMenu={onContextMenu}
      onKeepRecommendedDuplicate={onKeepRecommendedDuplicate}
      onDismissDuplicateGroup={onDismissDuplicateGroup}
    />
  );
}

function DndGrid({
  dndReady, displayItems, thumbUrls, previewUrls, warningsByIndex, duplicateMembership, userRotation, uncertainSet,
  cropStateByIndex, flatPositions,
  onReorder, onRemove, onRotate, onToggleCropDisabled, onOpenPopup, onContextMenu,
  onKeepRecommendedDuplicate, onDismissDuplicateGroup,
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
    const ids = displayItems.map((it) => it.id);
    const oldIndex = ids.indexOf(active.id);
    const newIndex = ids.indexOf(over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(displayItems, oldIndex, newIndex));
  }

  const sortableIds = displayItems.map((it) => it.id);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
        <div className="image-merge-panel__grid">
          {displayItems.map((item) => (
            <SortableItem
              key={item.id}
              dndReady={dndReady}
              item={item}
              thumbUrls={thumbUrls}
              previewUrls={previewUrls}
              warningsByIndex={warningsByIndex}
              duplicateMembership={duplicateMembership}
              userRotation={userRotation}
              uncertainSet={uncertainSet}
              cropStateByIndex={cropStateByIndex}
              flatPositions={flatPositions}
              onRemove={onRemove}
              onRotate={onRotate}
              onToggleCropDisabled={onToggleCropDisabled}
              onOpenPopup={onOpenPopup}
              onContextMenu={onContextMenu}
              onKeepRecommendedDuplicate={onKeepRecommendedDuplicate}
              onDismissDuplicateGroup={onDismissDuplicateGroup}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableItem({
  dndReady, item, thumbUrls, previewUrls, warningsByIndex, duplicateMembership, userRotation, uncertainSet,
  cropStateByIndex, flatPositions,
  onRemove, onRotate, onToggleCropDisabled, onOpenPopup, onContextMenu,
  onKeepRecommendedDuplicate, onDismissDuplicateGroup,
}) {
  const { useSortable, CSS } = dndReady;
  const sortable = useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    // Group items span more grid cells (group.indices.length × default cell width)
    gridColumn: item.type === 'group' ? `span ${Math.min(item.indices.length, 3)}` : undefined,
  };
  return (
    <RenderItem
      item={item}
      thumbUrls={thumbUrls}
      previewUrls={previewUrls}
      warningsByIndex={warningsByIndex}
      duplicateMembership={duplicateMembership}
      userRotation={userRotation}
      uncertainSet={uncertainSet}
      cropStateByIndex={cropStateByIndex}
      flatPositions={flatPositions}
      onRemove={onRemove}
      onRotate={onRotate}
      onToggleCropDisabled={onToggleCropDisabled}
      onOpenPopup={onOpenPopup}
      onContextMenu={onContextMenu}
      onKeepRecommendedDuplicate={onKeepRecommendedDuplicate}
      onDismissDuplicateGroup={onDismissDuplicateGroup}
      sortableRef={sortable.setNodeRef}
      sortableStyle={style}
      sortableListeners={sortable.listeners}
      sortableAttributes={sortable.attributes}
      isDragging={sortable.isDragging}
    />
  );
}

// Render single thumbnail OR group card with multiple thumbnails inside.
function RenderItem({
  item, thumbUrls, previewUrls, warningsByIndex, duplicateMembership, userRotation, uncertainSet,
  cropStateByIndex, flatPositions,
  onRemove, onRotate, onToggleCropDisabled, onOpenPopup, onContextMenu,
  onKeepRecommendedDuplicate, onDismissDuplicateGroup,
  sortableRef, sortableStyle, sortableListeners, sortableAttributes, isDragging,
}) {
  if (item.type === 'single') {
    const origIdx = item.idx;
    const previewUrl = previewUrls?.get?.(origIdx);
    const displayUrl = previewUrl || thumbUrls.get(origIdx);
    // isProcessed — preview blob існує (auto-rotation АБО crop запечений).
    // Залишений тільки для CSS; зелена ✓ керується cropState === 'applied'
    // (одне джерело правди у cropStateByIndex).
    const isProcessed = !!previewUrl;
    return (
      <div ref={sortableRef} style={sortableStyle}>
        <Thumbnail
          origIdx={origIdx}
          position={flatPositions.get(origIdx) ?? 0}
          url={displayUrl}
          isProcessed={isProcessed}
          warning={warningsByIndex.get(origIdx) || null}
          duplicateInfo={duplicateMembership.get(origIdx) || null}
          rotation={userRotation.get(origIdx) || 0}
          isUncertain={uncertainSet?.has?.(origIdx) || false}
          cropState={cropStateByIndex?.get?.(origIdx) || 'none'}
          onRemove={() => onRemove(origIdx)}
          onRotate={() => onRotate(origIdx)}
          onToggleCropDisabled={() => onToggleCropDisabled(origIdx)}
          onOpenPopup={() => onOpenPopup(origIdx)}
          onContextMenu={(e) => onContextMenu(e, origIdx)}
          onKeepRecommendedDuplicate={onKeepRecommendedDuplicate}
          sortable={sortableListeners ? {
            listeners: sortableListeners,
            attributes: sortableAttributes,
            isDragging,
          } : null}
        />
      </div>
    );
  }

  // Group: rendering wrapper + multiple thumbnails inside (not individually
  // sortable — group drags as one unit).
  return (
    <div
      ref={sortableRef}
      style={sortableStyle}
      className={
        'image-merge-panel__dup-group' +
        (isDragging ? ' image-merge-panel__dup-group--dragging' : '')
      }
    >
      <div className="image-merge-panel__dup-group-header">
        <span className="image-merge-panel__dup-group-label">
          Дублікати ({item.indices.length}) — рекомендую залишити зелений
        </span>
        <button
          type="button"
          className="image-merge-panel__dup-group-dismiss"
          onClick={() => onDismissDuplicateGroup(item.gIdx)}
          title="Якщо це насправді різні сторінки — розгрупувати"
        >
          <X size={12} />
          Це не дублікати
        </button>
      </div>
      <div
        className="image-merge-panel__dup-group-body"
        {...(sortableListeners || {})}
        {...(sortableAttributes || {})}
      >
        {item.indices.map((origIdx) => {
          const previewUrl = previewUrls?.get?.(origIdx);
          return (
            <Thumbnail
              key={origIdx}
              origIdx={origIdx}
              position={flatPositions.get(origIdx) ?? 0}
              url={previewUrl || thumbUrls.get(origIdx)}
              isProcessed={!!previewUrl}
              warning={warningsByIndex.get(origIdx) || null}
              duplicateInfo={duplicateMembership.get(origIdx) || null}
              rotation={userRotation.get(origIdx) || 0}
              isUncertain={uncertainSet?.has?.(origIdx) || false}
              cropState={cropStateByIndex?.get?.(origIdx) || 'none'}
              onRemove={() => onRemove(origIdx)}
              onRotate={() => onRotate(origIdx)}
              onToggleCropDisabled={() => onToggleCropDisabled(origIdx)}
              onOpenPopup={() => onOpenPopup(origIdx)}
              onContextMenu={(e) => onContextMenu(e, origIdx)}
              onKeepRecommendedDuplicate={onKeepRecommendedDuplicate}
              sortable={null}
              inGroup={true}
            />
          );
        })}
      </div>
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
  cropOverrides,
  cropProposals,
  cropDisabled,
  cropAppliedSet,
  processedBlobs,
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

  const { computeRenderedBlob } = await import('../../services/sortation/imageRenderer.js');
  const jspdfMod = await import('jspdf');
  const JsPDF = jspdfMod.jsPDF || jspdfMod.default;

  const pdf = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const A4W = 210, A4H = 297, M = 10;
  const PX_TO_MM = 0.264583;

  // Один контекст на весь rebuild — computeRenderedBlob отримує idx і вирішує
  // який шлях (processedBlob fast-path vs raw → crop → rotate). includeProposalRect:
  // true для PDF — фінальний документ застосовує proposal навіть якщо адвокат
  // не підтвердив через ✓ Готово (зберегли існуючу поведінку preview-rebuild
  // де effectiveCrops збирав override||proposal).
  const renderCtx = {
    realFiles,
    detectedOrientations: detectedOrientations || [],
    userRotation: userRotation || new Map(),
    processedBlobs: processedBlobs || new Map(),
    cropOverrides: cropOverrides || new Map(),
    cropProposals: cropProposals || new Map(),
    cropDisabled: cropDisabled || new Set(),
    cropAppliedSet: cropAppliedSet || new Set(),
  };

  for (let i = 0; i < orderedIndices.length; i++) {
    const origIdx = orderedIndices[i];
    const blob = await computeRenderedBlob(
      { ...renderCtx, idx: origIdx },
      { applyUserRotation: true, applyCrop: true, includeProposalRect: true }
    );
    if (!blob) continue;

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
  origIdx, position, url, isProcessed = false, warning, duplicateInfo, rotation, isUncertain,
  cropState, inGroup = false,
  onRemove, onRotate, onToggleCropDisabled, onOpenPopup, onContextMenu, onKeepRecommendedDuplicate, sortable,
}) {
  const isDuplicateRecommended = duplicateInfo && duplicateInfo.recommended === origIdx;
  const isDuplicateOther = duplicateInfo && duplicateInfo.recommended !== origIdx;

  // cropApplied — єдине джерело правди для зеленого індикатора. cropState
  // === 'applied' встановлюється у cropStateByIndex коли cropAppliedSet.has
  // або processedBlobs.has — тобто адвокат явно тапнув ✓ Готово АБО straighten
  // canvas baked повний результат.
  const cropApplied = cropState === 'applied';
  const cls =
    'image-merge-panel__thumb' +
    (warning ? ' image-merge-panel__thumb--warn' : '') +
    (duplicateInfo && !inGroup ? ' image-merge-panel__thumb--dup' : '') +
    (isDuplicateRecommended ? ' image-merge-panel__thumb--dup-recommended' : '') +
    (isDuplicateOther && !inGroup ? ' image-merge-panel__thumb--dup-other' : '') +
    (inGroup ? ' image-merge-panel__thumb--in-group' : '') +
    (cropApplied ? ' image-merge-panel__thumb--processed' : '') +
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
            // CSS rotation завжди застосовується для USER rotation — blob у
            // previewUrls запікається без неї (тільки auto + crop), щоб ↻
            // тапи давали плавну CSS transition анімацію 0.3s ease на transform.
            // Якщо є processedBlob — rotation = (userNow - baseUserRot), тобто
            // delta з моменту apply (бо processedBlob уже має user_at_apply
            // запечений). Без processedBlob — rotation = повний user рівень.
            style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
          />
        ) : (
          <div className="image-merge-panel__thumb-placeholder">
            <ImageIcon size={32} />
          </div>
        )}
        <span className="image-merge-panel__thumb-pos">#{position + 1}</span>
        {cropApplied && (
          <span className="image-merge-panel__thumb-processed-badge" title="Обрізку застосовано">
            <Check size={11} />
          </span>
        )}
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
          <span className="image-merge-panel__thumb-orient-badge" title="Орієнтація не визначена автоматично. Перевір і виправ кнопкою ↻ якщо треба.">
            <AlertTriangle size={10} /> Перевір орієнтацію
          </span>
        )}
        {/* ✂️ показуємо ТІЛЬКИ у станах 'active' (AI/manual frame не applied)
            і 'disabled'. При 'applied' замість ✂️ показується зелена ✓ вище.
            Один індикатор у певний момент — стан користувацький однозначний. */}
        {(cropState === 'active' || cropState === 'disabled') && (
          <button
            type="button"
            className={
              'image-merge-panel__thumb-crop-badge' +
              (cropState === 'disabled' ? ' image-merge-panel__thumb-crop-badge--disabled' : '')
            }
            onClick={(e) => {
              e.stopPropagation();
              onToggleCropDisabled && onToggleCropDisabled();
            }}
            title={
              cropState === 'active'
                ? 'Є рамка обрізки. Тап — вимкнути для цього фото.'
                : 'Обрізку вимкнено. Тап — увімкнути назад.'
            }
            aria-label="Перемкнути обрізку"
          >
            <CropIcon size={12} />
          </button>
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

      {duplicateInfo && isDuplicateRecommended && !inGroup && (
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

// ── Preview popup — FULL-SCREEN crop editor (TASK B fix Problem 1+5) ──────
//
// Стандартний mobile-style crop editor (Apple Photos/Google Photos UX):
//   - Full-screen overlay (займає весь viewport)
//   - Top bar: ✕ Cancel (закрити без застосування), title, ✓ Apply
//                (застосувати рамку і закрити)
//   - Main: react-advanced-cropper (pinch-zoom + pan + drag handles на 4
//                кутах і 4 ребрах одночасно) — або просто image якщо frame
//                схований
//   - Bottom bar: ‹ Попередня · ↻ ✂️ 🗑 · Наступна ›
//
// Інваріанти:
//   - cropRect parent state у RAW natural image coords (до userRotation).
//   - Cropper працює на ROTATED display blob (генерується з userRotation).
//     Отже coords з cropper.getCoordinates() — у rotated coord space.
//     При onChange конвертуємо назад через rotateRectCCW.
//   - pendingRect — local state, оновлюється onChange. Записується у parent
//     через onCropOverride ТІЛЬКИ при ✓ Apply. Cancel/✕ → discard.
//   - frameVisible — derived from parent props (cropDisabled + наявність rect).
//     ✂️ toggle parent state одразу (не залежить від apply).

function PreviewPopup({
  origIdx, url, sourceBlob, autoRotation: autoRotationProp, userRotation: userRotationOnly,
  position, total, warning, duplicateInfo,
  isUncertain, cropProposal, cropOverride, cropDisabled, cropApplied, processedEntry,
  onClose, onPrev, onNext, onRotate, onCropOverride, onToggleCropDisabled, onRemove,
  onProcessedBlobSave,
}) {
  const autoRotation = (((autoRotationProp || 0) % 360) + 360) % 360;
  const userRotation = (((userRotationOnly || 0) % 360) + 360) % 360;
  // Сума авто і користувацького обертання — спільний кут для displayUrl
  // rotation і cropper math (rotateRectCW/CCW конверсій coords). Popup
  // показує фото у фінальній орієнтації (як preview і як піде у PDF).
  const rotation = (((autoRotation + userRotation) % 360) + 360) % 360;
  const effectiveRect = cropOverride || cropProposal || null;
  // frameVisible: рамка з рукоятками показується тільки коли є rect, рамка
  // не вимкнена явно, і crop НЕ ще застосований. Після ✓ Готово (cropApplied
  // = true) popup переходить у "view cropped" mode без рукояток — адвокат
  // може ↻ або закрити, але re-edit рамки потребує спершу зняти apply.
  const frameVisible = !!effectiveRect && !cropDisabled && !cropApplied;
  // Track чи адвокат фізично рухав рукоятки під час сесії — для scenario 2
  // (save frame on ✕ Cancel якщо frame був адаптований).
  const pendingRectChangedRef = useRef(false);

  const isFirst = position === 0;
  const isLast = position === total - 1;

  // ── Straighten slider (TASK B fix Addition 3) ──────────────────────────
  // ВАЖЛИВО (fix React crash): fineRotation НЕ зберігається у React state.
  // Раніше mix React-controlled label `{fineRotation}°` + direct DOM mutation
  // (labelRef.textContent) ламав React reconciliation: React очікував N
  // child text nodes у span, а DOM мав 1 → `insertBefore` помилка при
  // наступному render'і.
  //
  // Нова стратегія — slider повністю поза React-tree:
  //   - fineRotationRef — поточне значення (не triggerит re-render)
  //   - labelRef.textContent — оновлюється напряму, span у JSX порожній
  //   - resetBtnRef.classList — toggle 'hidden' клас, button завжди у DOM
  //   - sliderInputRef.value — uncontrolled, set на 0 при reset
  //   - handleApply читає fineRotationRef.current
  // PreviewPopup НЕ re-renderиться під час drag'у — DOM стабільна, помилки
  // insertBefore немає.
  const fineRotationRef = useRef(0);
  const cropperRef = useRef(null);
  const lastFineRotation = useRef(0);
  const labelRef = useRef(null);
  const resetBtnRef = useRef(null);
  const sliderInputRef = useRef(null);
  // ↻ всередині попапу — instant feedback через cropper.rotateImage(90)
  // плюс update parent userRotation. Цей lock запобігає тому щоб
  // displayUrl effect не регенерував blob URL з нуля (повільно, ремонт
  // cropper'а, втрачає cropper internal rotation).
  // Один тап ↻ → lock=true → effect skip → cropper instant rotate.
  // Зовнішні зміни rotation (теоретично — якщо архітектурно з'являться)
  // НЕ ставлять lock → effect виконується.
  const popupRotationLockRef = useRef(false);

  // Bug 9 — userRotation, ЗАПЕЧЕНИЙ у поточний displayUrl-blob. Поки cropper
  // НЕ змонтований (view-only, cropApplied) ↻ раніше регенерував baked-blob і
  // міняв <img src> → стрибок без анімації (а з рамкою cropper анімував сам →
  // «інколи плавно, інколи стрибок»). Тепер у view-only обертання — CSS
  // transform delta (userRotation - baked), blob НЕ регенерується (лок), як
  // і в thumbnail-стратегії «user rotation — CSS-only».
  const bakedUserRotationRef = useRef(userRotation);

  // Природні розміри оригіналу — для конверсії coords ↔ rotated space.
  const [naturalDims, setNaturalDims] = useState(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const im = new Image();
    im.onload = () => {
      if (cancelled) return;
      setNaturalDims({ width: im.naturalWidth, height: im.naturalHeight });
    };
    im.onerror = () => {};
    im.src = url;
    return () => { cancelled = true; };
  }, [url]);

  // displayUrl — що показуємо у cropper. Через ОДИН unified renderer
  // (computeRenderedBlob) щоб popup показував те саме що preview thumbnail
  // і фінальний PDF — без дублікатів логіки.
  //
  // applyUserRotation=true — user rotation baked у blob (popup завжди
  //   показує фінальну орієнтацію; на відміну від preview thumbnail який
  //   використовує CSS transform для плавної анімації).
  // applyCrop=cropApplied — якщо адвокат тапнув ✓ Готово, popup показує
  //   обрізаний варіант (сценарій 4). Інакше — full image з рамкою.
  // includeProposalRect=cropApplied — proposal не вважається застосованим
  //   допоки адвокат явно не підтвердив через ✓ Готово.
  //
  // Lock pattern зберігається: ↻ всередині попапу робить cropper.rotateImage(90)
  // напряму, parent userRotation інкрементується — lock пропускає цей цикл
  // useEffect'у щоб не подвоїти обертання.
  const [displayUrl, setDisplayUrl] = useState(url);
  useEffect(() => {
    if (popupRotationLockRef.current) {
      popupRotationLockRef.current = false;
      return;
    }
    let cancelled = false;
    let createdUrl = null;
    (async () => {
      try {
        const { computeRenderedBlob } = await import('../../services/sortation/imageRenderer.js');
        // Контекст для renderer'у складаємо тут — у popup props ми отримали
        // все потрібне (sourceBlob як raw, cropOverride, processedEntry).
        // userRotation і detectedOrientations — обгортки Map/Array з одним
        // елементом по індексу 0, бо renderer працює per-batch.
        const userRotationMap = new Map();
        userRotationMap.set(0, userRotation);
        const procMap = new Map();
        if (processedEntry?.blob instanceof Blob) procMap.set(0, processedEntry);
        const overrideMap = new Map();
        if (cropOverride) overrideMap.set(0, cropOverride);
        const proposalMap = new Map();
        if (cropProposal) proposalMap.set(0, cropProposal);
        const disabledSet = new Set();
        if (cropDisabled) disabledSet.add(0);
        const appliedSet = new Set();
        if (cropApplied) appliedSet.add(0);

        const blob = await computeRenderedBlob(
          {
            idx: 0,
            realFiles: [sourceBlob],
            detectedOrientations: [autoRotation],
            userRotation: userRotationMap,
            processedBlobs: procMap,
            cropOverrides: overrideMap,
            cropProposals: proposalMap,
            cropDisabled: disabledSet,
            cropAppliedSet: appliedSet,
          },
          {
            applyUserRotation: true,
            applyCrop: cropApplied,
            includeProposalRect: cropApplied,
          }
        );
        if (cancelled) return;
        // Blob перегенеровано саме під цей userRotation → стає новим baseline
        // для CSS-delta (поки lock не пропустить наступний ↻ у view-only).
        bakedUserRotationRef.current = userRotation;
        if (blob) {
          createdUrl = URL.createObjectURL(blob);
          setDisplayUrl(createdUrl);
        } else {
          setDisplayUrl(url);
        }
      } catch (e) {
        console.warn('[PreviewPopup] displayUrl render failed:', e);
        if (!cancelled) { bakedUserRotationRef.current = userRotation; setDisplayUrl(url); }
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [
    autoRotation, userRotation, sourceBlob, url, processedEntry,
    cropOverride, cropProposal, cropDisabled, cropApplied,
  ]);

  // Local pending state — чекає на ✓ Apply.
  const [pendingRect, setPendingRect] = useState(effectiveRect || null);
  // Reset тільки якщо parent state змінився (наприклад toggle frame). НЕ
  // скидаємо при rotation — користувацькі adjustments повинні зберігатись
  // через ↻.
  useEffect(() => {
    setPendingRect(effectiveRect || null);
  }, [effectiveRect]);

  // Початковий rect для cropper у ROTATED coord space. Використовуємо
  // pendingRect (preserves user's adjustments across rotation) → fallback на
  // effectiveRect.
  const initialCropperCoords = useMemo(() => {
    const rectToUse = pendingRect || effectiveRect;
    if (!rectToUse || !naturalDims) return null;
    const r = rotateRectCW(rectToUse, naturalDims.width, naturalDims.height, rotation);
    return { left: r.x, top: r.y, width: r.width, height: r.height };
  }, [pendingRect, effectiveRect, naturalDims, rotation]);

  // Slider оновлення UI — все через DOM refs, без React re-render.
  // Спрацьовує на onInput (continous drag) і не triggerит reconciliation.
  const pendingFineAngleRef = useRef(null);
  const rafIdRef = useRef(null);

  const updateSliderUI = useCallback((angle) => {
    fineRotationRef.current = angle;
    if (labelRef.current) {
      const sign = angle > 0 ? '+' : '';
      labelRef.current.textContent = `${sign}${angle.toFixed(1)}°`;
    }
    if (resetBtnRef.current) {
      if (angle !== 0) {
        resetBtnRef.current.classList.remove('image-merge-panel__popup-straighten-reset--hidden');
      } else {
        resetBtnRef.current.classList.add('image-merge-panel__popup-straighten-reset--hidden');
      }
    }
  }, []);

  const handleFineRotationChange = useCallback((newAngle) => {
    pendingFineAngleRef.current = newAngle;
    // Instant DOM update (label + reset button visibility) без re-render
    updateSliderUI(newAngle);
    if (rafIdRef.current != null) return; // already scheduled this frame
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const target = pendingFineAngleRef.current;
      pendingFineAngleRef.current = null;
      if (target == null) return;
      const delta = target - lastFineRotation.current;
      if (Math.abs(delta) > 0.0001 && cropperRef.current) {
        try {
          cropperRef.current.rotateImage(delta, {
            transitions: false,
            normalize: false,
            immediately: true,
            interaction: false,
          });
        } catch (e) {
          try { cropperRef.current.rotateImage(delta); } catch {}
        }
        lastFineRotation.current = target;
      }
    });
  }, [updateSliderUI]);

  // Cleanup pending rAF на unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current != null) {
        try { cancelAnimationFrame(rafIdRef.current); } catch {}
        rafIdRef.current = null;
      }
    };
  }, []);

  // ↻ у попапі: обертає cropper на 90° з анімацією (default transitions
  // на Cropper) + оновлює parent userRotation для persistence (якщо адвокат
  // закриє попап). displayUrl effect skip через popupRotationLockRef.
  const handleRotateInPopup = useCallback(() => {
    if (cropperRef.current) {
      // Cropper mounted → робимо visual rotation через нього (анімація 0.3s
      // built-in), ставимо lock щоб displayUrl effect не подвоїв обертання
      // регенерацією blob URL з новим userRotation. Lock відкидається на
      // наступному запуску ефекту.
      try { cropperRef.current.rotateImage(90); } catch {}
      popupRotationLockRef.current = true;
    } else {
      // Cropper НЕ mounted (cropApplied → frameVisible=false → plain img):
      // лочимо регенерацію blob, обертання покаже CSS transform delta на
      // <img> (плавно, з transition) — без стрибка-підміни src (Bug 9).
      popupRotationLockRef.current = true;
    }
    onRotate();
  }, [onRotate]);

  const resetFineRotation = useCallback(() => {
    if (sliderInputRef.current) sliderInputRef.current.value = '0';
    handleFineRotationChange(0);
  }, [handleFineRotationChange]);

  // Скидаємо fineRotation коли popup перевідкривається АБО коли slider
  // ремонтується (frameVisible toggle). Без React state — через DOM refs
  // (slider input value, label text, reset button class).
  useEffect(() => {
    lastFineRotation.current = 0;
    fineRotationRef.current = 0;
    pendingFineAngleRef.current = null;
    if (sliderInputRef.current) sliderInputRef.current.value = '0';
    if (labelRef.current) labelRef.current.textContent = '0.0°';
    if (resetBtnRef.current) {
      resetBtnRef.current.classList.add('image-merge-panel__popup-straighten-reset--hidden');
    }
  }, [origIdx, frameVisible]);

  // ✓ Готово (Apply) — три гілки залежно від стану:
  //   1. fineRotation != 0 → беремо canvas з cropper (всі трансформи вже
  //      застосовані бібліотекою) → blob → onProcessedBlobSave. Рebuild
  //      використовує цей blob напряму.
  //   2. fineRotation == 0 і frameVisible → onCropOverride(pendingRect,
  //      {applied: true}) — рамка зберігається І preview thumbnail показує
  //      cropped варіант.
  //   3. !frameVisible → нічого не зберігаємо, просто закриваємо.
  //
  // baseUserRotation для onProcessedBlobSave — це USER rotation на момент
  // apply (НЕ rotation prop який = auto + user). Інакше delta-логіка у
  // computeRenderedBlob/userRotationCssDelta давала б помилку: коли адвокат
  // обертає ↻ після apply, ми обчислюємо (user_now - baseUser) — baseUser
  // має бути user рівень, не сума з auto.
  const handleApply = useCallback(async () => {
    if (!frameVisible) {
      onClose();
      return;
    }
    const fineRotation = fineRotationRef.current;
    if (fineRotation !== 0 && cropperRef.current && onProcessedBlobSave) {
      try {
        const canvas = cropperRef.current.getCanvas({
          imageSmoothingQuality: 'high',
        });
        if (canvas) {
          const blob = await new Promise((resolve) => {
            canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92);
          });
          if (blob) {
            // baseUserRotation = USER component тільки (без auto). delta-логіка
            // у computeRenderedBlob/userRotationCssDelta очікує саме user рівень.
            onProcessedBlobSave(blob, userRotation);
            onClose();
            return;
          }
        }
      } catch (e) {
        console.warn('[PreviewPopup] getCanvas failed, fallback to rect:', e);
      }
    }
    if (pendingRect) {
      onCropOverride(pendingRect, { applied: true });
    }
    onClose();
  }, [frameVisible, pendingRect, userRotation, onCropOverride, onProcessedBlobSave, onClose]);

  // ✕ Cancel — сценарій 2: якщо адвокат рухав рукоятки рамки під час сесії
  // (pendingRect відрізняється від ефективного rect що був на момент відкриття),
  // зберігаємо нову рамку як "frame-only" (НЕ applied). Інакше — просто
  // закриваємо.
  const handleCancel = useCallback(() => {
    if (pendingRect && pendingRectChangedRef.current && frameVisible) {
      onCropOverride(pendingRect, { applied: false });
    }
    onClose();
  }, [pendingRect, frameVisible, onCropOverride, onClose]);

  // ✂️ Toggle frame:
  //   cropApplied=true → "розблокувати редагування" (clear applied,
  //     зберігаємо rect; frame повертається на повне фото).
  //   frameVisible=true → ховаємо через cropDisabled.
  //   has effectiveRect (disabled) → знімаємо disabled.
  //   немає rect → створюємо центральну рамку 80%.
  const handleToggleCrop = useCallback(() => {
    if (cropApplied && effectiveRect) {
      onCropOverride(effectiveRect, { applied: false });
      return;
    }
    if (frameVisible) {
      onToggleCropDisabled();
      return;
    }
    if (effectiveRect) {
      onToggleCropDisabled();
      return;
    }
    if (!naturalDims) return;
    const margin = 0.1;
    const defaultRect = {
      x: Math.round(naturalDims.width * margin),
      y: Math.round(naturalDims.height * margin),
      width: Math.round(naturalDims.width * (1 - 2 * margin)),
      height: Math.round(naturalDims.height * (1 - 2 * margin)),
    };
    onCropOverride(defaultRect);
  }, [cropApplied, frameVisible, effectiveRect, naturalDims, onToggleCropDisabled, onCropOverride]);

  return (
    <div className="image-merge-panel__popup-overlay image-merge-panel__popup-overlay--full" role="dialog" aria-modal="true">
      <div className="image-merge-panel__popup image-merge-panel__popup--full">
        <div className="image-merge-panel__popup-topbar">
          <button
            type="button"
            className="image-merge-panel__popup-topbtn"
            onClick={handleCancel}
            aria-label="Закрити (зберегти рамку)"
            title="Закрити (рамка збережеться для фінального PDF) (Esc)"
          >
            <X size={22} />
          </button>
          <div className="image-merge-panel__popup-topcenter">
            <span className="image-merge-panel__popup-position">
              Сторінка {position + 1} з {total}
            </span>
            {duplicateInfo && (
              <span className="image-merge-panel__popup-tag image-merge-panel__popup-tag--dup">
                {duplicateInfo.recommended === origIdx ? 'Рекомендований' : 'Дублікат'}
              </span>
            )}
            {warning && (
              <span className="image-merge-panel__popup-tag image-merge-panel__popup-tag--warn">
                <AlertTriangle size={12} /> Підозрілий
              </span>
            )}
            {isUncertain && !warning && (
              <span className="image-merge-panel__popup-tag image-merge-panel__popup-tag--warn">
                <AlertTriangle size={12} /> Орієнтація?
              </span>
            )}
          </div>
          <button
            type="button"
            className="image-merge-panel__popup-topbtn image-merge-panel__popup-topbtn--primary"
            onClick={handleApply}
            aria-label="Готово (застосувати обрізку)"
            title="Готово — застосувати"
          >
            <Check size={22} />
            <span className="image-merge-panel__popup-topbtn-label">Готово</span>
          </button>
        </div>

        <div className="image-merge-panel__popup-body">
          <CropperHost
            cropperRef={cropperRef}
            displayUrl={displayUrl}
            initialCoords={initialCropperCoords}
            frameVisible={frameVisible}
            userRotation={userRotation}
            bakedUserRotationRef={bakedUserRotationRef}
            onChange={(rotatedRect) => {
              if (!naturalDims) return;
              const original = rotateRectCCW(
                rotatedRect, naturalDims.width, naturalDims.height, rotation
              );
              const nextRect = {
                x: Math.round(original.x),
                y: Math.round(original.y),
                width: Math.round(original.width),
                height: Math.round(original.height),
              };
              setPendingRect(nextRect);
              pendingRectChangedRef.current = true;
            }}
          />
        </div>

        {/* Straighten slider (-45° до +45°) — повністю DOM-керований щоб
            уникнути React reconciliation crashes від частих state updates.
            Mount/unmount controlled by frameVisible (rare event), внутрішні
            оновлення (label text, reset button class, slider value) — через
            refs (updateSliderUI). PreviewPopup НЕ re-renderиться під час
            drag'у, що виключає insertBefore-DOM конфлікти.

            Static JSX content для label (`0.0°`) і reset button (з hidden
            класом за замовчуванням) — React НЕ торкається їх text nodes
            і visibility після mount. */}
        {frameVisible && (
          <div className="image-merge-panel__popup-straighten">
            <span className="image-merge-panel__popup-straighten-label">
              Вирівняти
            </span>
            <input
              ref={sliderInputRef}
              type="range"
              min={-45}
              max={45}
              step={0.5}
              defaultValue={0}
              key={origIdx}
              onInput={(e) => handleFineRotationChange(parseFloat(e.target.value))}
              className="image-merge-panel__popup-straighten-input"
              aria-label="Вирівняти фото"
            />
            <span
              ref={labelRef}
              className="image-merge-panel__popup-straighten-value"
            >
              0.0°
            </span>
            <button
              ref={resetBtnRef}
              type="button"
              className="image-merge-panel__popup-straighten-reset image-merge-panel__popup-straighten-reset--hidden"
              onClick={resetFineRotation}
              title="Скинути до 0°"
            >
              Скинути
            </button>
          </div>
        )}

        <div className="image-merge-panel__popup-toolbar">
          <button
            type="button"
            className="image-merge-panel__popup-nav"
            onClick={onPrev}
            disabled={isFirst}
            title="Попередня (←)"
            aria-label="Попередня"
          >
            ‹
          </button>
          <div className="image-merge-panel__popup-tools">
            <button
              type="button"
              className="image-merge-panel__popup-tool"
              onClick={handleRotateInPopup}
              title="Повернути на 90° (R)"
            >
              <RotateCw size={18} />
              <span>Повернути</span>
            </button>
            <button
              type="button"
              className={
                'image-merge-panel__popup-tool' +
                (frameVisible ? ' image-merge-panel__popup-tool--active' : '')
              }
              onClick={handleToggleCrop}
              title={frameVisible ? 'Прибрати рамку обрізки' : 'Показати рамку обрізки'}
              disabled={!naturalDims}
            >
              <FrameIcon size={18} />
              <span>Рамка</span>
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
            ›
          </button>
        </div>
      </div>
    </div>
  );
}

// ── CropperHost: оболонка над react-advanced-cropper з lazy load ──────────
// Cropper обробляє жести: pinch-zoom, pan, drag handles на 4 кутах + 4 ребрах.
// Free aspect (stencilProps.aspectRatio={undefined}). Повертає coords у
// natural pixel coords ROTATED image space. Ми конвертуємо назовні.
//
// Якщо frameVisible=false — рендеримо просто img без cropper для UX «view
// тільки» (адвокат може закрити без обрізки).
//
// Lazy import — react-advanced-cropper ~30KB gzip, не тягнемо у головний bundle.

// userRotation і bakedUserRotationRef передаються як props (раніше були
// dangling references на scope PreviewPopup — ReferenceError при re-open
// попапа після ✓ Готово, коли frameVisible=false і виконувалась гілка
// view-only з CSS-rotation delta). Один сенс на prop (правило #11):
// userRotation — поточний кут адвоката (number 0/90/180/270), bakedUserRotationRef
// — кут запечений у displayUrl-blob, потрібен для delta-розрахунку без
// регенерації blob.
//
// Експортовано для regression-тесту (tests/unit/cropperHost.test.jsx).
export function CropperHost({ cropperRef, displayUrl, initialCoords, frameVisible, onChange, userRotation, bakedUserRotationRef }) {
  const [cropperLib, setCropperLib] = useState(null);

  useEffect(() => {
    if (cropperLib) return;
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('react-advanced-cropper');
        await import('react-advanced-cropper/dist/style.css');
        if (cancelled) return;
        setCropperLib({ Cropper: mod.Cropper });
      } catch (e) {
        console.warn('[CropperHost] lazy load failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [cropperLib]);

  if (!frameVisible) {
    // View-only: image fit-to-container (object-fit: contain), без рамки.
    // Bug 9 — обертання як CSS transform delta (поточний userRotation мінус
    // запечений у blob), нормалізований у [-180,180] для короткої анімації;
    // CSS transition робить її плавною ЗАВЖДИ (не «інколи»).
    let rotDelta = ((userRotation - bakedUserRotationRef.current) % 360 + 360) % 360;
    if (rotDelta > 180) rotDelta -= 360;
    return (
      <div className="image-merge-panel__popup-canvas">
        <img
          src={displayUrl}
          alt="Перегляд сторінки"
          className="image-merge-panel__popup-fitimg"
          style={{ transform: `translate(-50%, -50%) rotate(${rotDelta}deg)` }}
          draggable={false}
        />
      </div>
    );
  }

  if (!cropperLib) {
    return (
      <div className="image-merge-panel__popup-canvas">
        <div style={{ color: '#fff', padding: 20 }}>Завантаження редактора…</div>
      </div>
    );
  }

  const { Cropper } = cropperLib;
  // key={displayUrl} — force re-mount при зміні зображення (після rotate),
  // інакше library ігнорує нові defaultCoordinates після першого mount.
  return (
    <div className="image-merge-panel__popup-canvas">
      <Cropper
        ref={cropperRef}
        key={displayUrl}
        src={displayUrl}
        defaultCoordinates={initialCoords || undefined}
        stencilProps={{
          aspectRatio: undefined,
          movable: true,
          resizable: true,
          handlers: true,
          lines: true,
        }}
        // Transitions enabled (default) — плавна анімація для ↻ button.
        // Slider передає `transitions: false` per-call для instant feedback.
        transitions={{ duration: 280, timingFunction: 'ease-out' }}
        backgroundClassName="image-merge-panel__cropper-bg"
        className="image-merge-panel__cropper"
        onChange={(cropper) => {
          const c = cropper.getCoordinates();
          if (!c || !c.width || !c.height) return;
          onChange({
            x: c.left,
            y: c.top,
            width: c.width,
            height: c.height,
          });
        }}
      />
    </div>
  );
}

// rotateRectCW: rect (x,y,w,h) у (natW × natH) → новий rect у (rotated dims).
// 90: (natH - y - h, x, h, w) у (natH × natW) space.
// 180: (natW - x - w, natH - y - h, w, h) у (natW × natH).
// 270: (y, natW - x - w, h, w) у (natH × natW).
function rotateRectCW(rect, natW, natH, deg) {
  const a = ((deg % 360) + 360) % 360;
  if (a === 0) return { ...rect };
  if (a === 90) return {
    x: natH - rect.y - rect.height,
    y: rect.x,
    width: rect.height,
    height: rect.width,
  };
  if (a === 180) return {
    x: natW - rect.x - rect.width,
    y: natH - rect.y - rect.height,
    width: rect.width,
    height: rect.height,
  };
  if (a === 270) return {
    x: rect.y,
    y: natW - rect.x - rect.width,
    width: rect.height,
    height: rect.width,
  };
  return { ...rect };
}

// Inverse: rect у rotated space → rect у raw natural space (natW × natH).
// Робимо CW(360 - deg) у rotated dims.
function rotateRectCCW(rotatedRect, natW, natH, deg) {
  const a = ((deg % 360) + 360) % 360;
  if (a === 0) return { ...rotatedRect };
  // Rotated dims:
  const rotW = (a === 90 || a === 270) ? natH : natW;
  const rotH = (a === 90 || a === 270) ? natW : natH;
  return rotateRectCW(rotatedRect, rotW, rotH, 360 - a);
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
