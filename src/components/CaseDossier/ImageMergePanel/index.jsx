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
//
// Структура файлів (Roadmap Фаза 1 + TASK 1A image_merge_unify):
//   ImageMergePanel/   — модалка «1 батч = 1 документ» (специфічне):
//     index.jsx         — головний компонент (цей файл, forwardRef + handleSubmit)
//     PreviewView.jsx   — фаза preview модалки, оркеструє grid/popup/form
//     ProcessingView.jsx — індикатор фази processing
//     SingleFileWarning.jsx — модалка "1 файл — використайте Додати"
//   components/ImageEditor/ — спільне reusable (модалка + майбутній DP image-merge):
//     PreviewPopup.jsx  — full-screen crop editor
//     RenderItem.jsx    — рендер картки grid
//     Thumbnail.jsx     — мініатюра з HEIC-логікою
//     CropperHost.jsx   — react-advanced-cropper з lazy load (export для тестів)
//     ContextMenu.jsx   — right-click menu
//     constants.js      — CATEGORY_OPTIONS, AUTHOR_OPTIONS, MAX_IMAGES_WARN, PHASES, isImageFile
//     grid/             — drag-and-drop (SortableGrid, DndGrid, SortableItem)
//   services/imageDocument/ — чисті сервісні функції (без React):
//     geometry.js       — rotateRectCW / rotateRectCCW
//     pdfRebuild.js     — rebuildFromOcrResults (фінальна збірка PDF)
//   tools/, annotations/, ai/, export/ — ДНК-папки під майбутні розширення модалки

import {
  useState,
  useCallback,
  useEffect,
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
} from 'lucide-react';
import { Button } from '../../UI';
import { ICON_SIZE } from '../../UI/icons.js';
import { toast } from '../../../services/toast.js';
import { convertImagesToPdf } from '../../../services/converter/converterService.js';
import { ensureUniqueName } from '../../../services/sortation/imageSortingAgent.js';
import { detectDocumentEdges } from '../../../services/sortation/edgeDetection.js';
import { MAX_IMAGES_WARN, isImageFile } from '../../ImageEditor/constants.js';
import { ProcessingView } from './ProcessingView.jsx';
import { PreviewView } from './PreviewView.jsx';
import { SingleFileWarning } from './SingleFileWarning.jsx';
import { rebuildFromOcrResults } from '../../../services/imageDocument/pdfRebuild.js';
import { selectRecommendedDuplicateRemovals } from '../../../services/imageDocument/duplicateSelection.js';
import { usePreviewUrls } from '../../ImageEditor/hooks/usePreviewUrls.js';

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // previewUrls — URL до обрізаного/повернутого фото для thumbnail. СПІЛЬНИЙ хук
  // usePreviewUrls (один шлях, нуль дубльованої логіки; борг #33). Хук сам
  // володіє станом previewUrls, чергою revoke і unmount-cleanup. Регенерує при
  // зміні crop/processedBlob/auto-orientation (НЕ при userRotation — той через
  // CSS transform). На новий pipeline (pipelineResult.realFiles змінився) ефект
  // хука reруниться і прев'ю оновлюються — окремий ручний reset не потрібен.
  const previewUrls = usePreviewUrls({
    realFiles: pipelineResult?.realFiles,
    detectedOrientations: pipelineResult?.detectedOrientations,
    userRotation,
    processedBlobs,
    cropOverrides,
    cropProposals,
    cropDisabled,
    cropAppliedSet,
  });

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
          const { driveRequest } = await import('../../../services/driveAuth.js');
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

      // HEIC з телефону (через Drive чи device input) браузер не вміє декодувати
      // у <img src=blob:...>. Після pipeline беремо нормалізовані файли
      // (JPEG після heic2any для HEIC; оригінал для решти) і використовуємо їх
      // ВСЮДИ де потрібен Blob для UI: thumbnails, popup, edge detection,
      // computeRenderedBlob. Без цього thumbnails і enlarged view порожні
      // для HEIC-фото.
      const displayFiles =
        Array.isArray(result.normalizedFiles) &&
        result.normalizedFiles.length === realFiles.length
          ? result.normalizedFiles
          : realFiles;

      for (let i = 0; i < displayFiles.length; i++) {
        if (!thumbUrlsRef.current.has(i)) {
          const f = displayFiles[i];
          if (f instanceof Blob) {
            thumbUrlsRef.current.set(i, URL.createObjectURL(f));
          }
        }
      }

      setPipelineResult({ ...result, realFiles: displayFiles });
      setOrderedIndices(result.finalOrder);
      setUserRotation(new Map());
      setCropProposals(new Map());
      setCropOverrides(new Map());
      setCropDisabled(new Set());
      setCropAppliedSet(new Set());
      setDismissedDuplicateGroupIds(new Set());
      setProcessedBlobs(new Map());
      // previewUrls тепер у спільному хуку usePreviewUrls — він reрунить ефект
      // на зміну pipelineResult.realFiles і сам replace'ить/revoke'ає старі URL.
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
        // Використовуємо displayFiles (post-HEIC) — detectDocumentEdges
        // завантажує у <img>/Canvas, HEIC не декодується.
        console.log('[merge] edge detection START for', displayFiles.length, 'files');
        const proposals = new Map();
        for (let i = 0; i < displayFiles.length; i++) {
          const f = displayFiles[i];
          if (!(f instanceof Blob)) continue;
          try {
            const rect = await detectDocumentEdges(f, f?.name || `#${i}`);
            if (rect) proposals.set(i, rect);
          } catch (e) {
            console.warn('[merge] edge detection failed for idx', i, e);
          }
        }
        console.log('[merge] edge detection DONE: proposals=', proposals.size, 'of', displayFiles.length);
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

  // #12: «Видалити всі дублікати» поважає ручний вибір — чіпає лише незаймані
  // групи (не dismissed і де жоден член не видалений вручну). Спільна логіка
  // у selectRecommendedDuplicateRemovals (та сама що у DP). Присутність члена
  // = він ще в orderedIndices (handleRemoveIndex прибирає звідти видалені).
  const handleKeepAllRecommendedDuplicates = useCallback(() => {
    const groups = pipelineResult?.sortResult?.duplicates || [];
    if (groups.length === 0) return;
    const present = new Set(orderedIndices);
    const removeSet = selectRecommendedDuplicateRemovals(groups, {
      dismissedGroupIds: dismissedDuplicateGroupIds,
      isMemberPresent: (idx) => present.has(idx),
    });
    if (removeSet.size === 0) return;
    setRemovedIndices((prev) => {
      const next = new Set(prev);
      for (const i of removeSet) next.add(i);
      return next;
    });
    setOrderedIndices((prev) => prev.filter((i) => !removeSet.has(i)));
  }, [pipelineResult?.sortResult?.duplicates, dismissedDuplicateGroupIds, orderedIndices]);

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
