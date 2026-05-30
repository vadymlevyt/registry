// ── DP IMAGE MERGE EDITOR (TASK 1B image_merge_unify) ───────────────────────
// N-документна склейка фото у DocumentProcessorV2 (Зона 3). Адвокат закидає N
// фото = M документів (паспорт 4 + договір 5 + квитанція 1 = 10 фото / 3 doc);
// editor дає правити пропозицію `imageDocumentGrouper` (Haiku) — перетягувати
// фото між групами, обертати, обрізати, видаляти дублі, перейменовувати, тип.
// «Виконати» → для кожної групи rebuildFromOcrResults → upload → add_documents.
//
// ── ЧОМУ ОКРЕМИЙ ОРКЕСТРАТОР DND (а не SortableGrid модалки) ────────────────
// SortableGrid (ImageEditor/grid/) — single-container DnD «1 батч = 1 документ».
// Тут N контейнерів (груп) з drag МІЖ ними — інший намір (правило #11).
// Reuse — на атомарному рівні: RenderItem (через свій SortableItem-обгортку),
// Thumbnail, PreviewPopup, CropperHost. ContextMenu — теж reuse.
//
// ── СТРАТЕГІЯ DND ────────────────────────────────────────────────────────────
// ONE DndContext, N SortableContexts (по одному на групу). Items ID кодує
// containerId (=docId) і origIdx: `g_<docId>::p_<origIdx>`. У onDragEnd ми
// парсимо обидва ID → визначаємо source/target групи:
//   • same group → reorder у межах групи (arrayMove)
//   • different group → move item у target group (видалити з source, вставити
//     у target за позицією drop'а)
//
// ── PERSIST — ТІЛЬКИ на «Виконати» ──────────────────────────────────────────
// Адвокат-диригент (§4.1/§6.1 DP візії): pre-persist пропозиція, нічого не
// записується на Drive поки адвокат не натиснув. Це — головний продуктовий
// результат 1B (image-merge editing у DP). Нарізка PDF не зачіпається — там
// autoConfirm:true лишається (Фаза 5).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Play, Plus, Trash2, AlertTriangle, Crop as CropIcon,
  X, Check, Copy as CopyIcon,
} from 'lucide-react';
import { ICON_SIZE } from '../UI/icons.js';
import { Button, Input, Select, Toggle, DatePicker } from '../UI';
import { toast } from '../../services/toast.js';
import { CATEGORY_OPTIONS, AUTHOR_OPTIONS } from '../ImageEditor/constants.js';
import { PreviewPopup } from '../ImageEditor/PreviewPopup.jsx';
import { ContextMenu } from '../ImageEditor/ContextMenu.jsx';
import { RenderItem } from '../ImageEditor/RenderItem.jsx';
import { detectDocumentEdges } from '../../services/sortation/edgeDetection.js';

let docIdSeq = 0;
const nextDocId = () => `dpg_${Date.now()}_${docIdSeq++}`;

function ItemIdEncode(docId, origIdx) {
  return `g::${docId}::p::${origIdx}`;
}
function ItemIdDecode(id) {
  // Format: g::<docId>::p::<origIdx>
  const m = /^g::(.+?)::p::(\d+)$/.exec(id || '');
  if (!m) return null;
  return { docId: m[1], origIdx: Number(m[2]) };
}

/**
 * @param {object} props
 * @param {object} props.caseData
 * @param {Array} props.proceedings
 * @param {{
 *   normalizedFiles: Array, ocrResults: Array, detectedOrientations: number[],
 *   orientationDebug: Array, uncertainOrientationIndices: number[], warnings: string[]
 * }} props.pre — output of prepareImagesForMerge
 * @param {Array<{pages: number[], type: string|null, suggestedName: string}>} props.initialGroups
 *        — output of imageDocumentGrouper
 * @param {Array<{group: number[], recommended: number, reason: string}>} [props.initialDuplicates]
 *        — групи дублів (global indices) зі spільної обгортки sortImageDocument
 *          (per-group sortImages). Editor малює жовту рамку/зелений рекомендований
 *          (як модалка) і дає зняти/залишити. Порожньо — дублів нема.
 * @param {Function} props.onSubmit — async ({ groups, userRotation, cropOverrides, cropProposals, cropDisabled, cropAppliedSet, processedBlobs }) => void
 * @param {Function} props.onCancel
 */
export function DpImageMergeEditor({
  caseData,
  proceedings = [],
  pre,
  initialGroups,
  initialDuplicates = [],
  onSubmit,
  onCancel,
}) {
  const normalizedFiles = pre?.normalizedFiles || [];
  const ocrResults = pre?.ocrResults || [];
  const detectedOrientations = pre?.detectedOrientations || [];
  const orientationDebug = pre?.orientationDebug || [];
  const uncertainOrientationIndices = pre?.uncertainOrientationIndices || [];

  // ── Стан груп ─────────────────────────────────────────────────────────────
  // groups: Array<{docId, name, type, procId, date, isKey, pageIndices: number[]}>
  // pageIndices — упорядкований масив original indices фото які належать групі.
  const [groups, setGroups] = useState(() => {
    const defaultProcId = proceedings?.[0]?.id || '';
    return (initialGroups || []).map((g) => ({
      docId: nextDocId(),
      name: g.suggestedName || '',
      type: g.type || '',
      author: '',
      procId: defaultProcId,
      date: '',
      isKey: false,
      pageIndices: Array.isArray(g.pages) ? [...g.pages] : [],
    })).filter((g) => g.pageIndices.length > 0);
  });

  // Crop/rotation/duplicate стани — глобальні (одне фото = один origIdx у одній
  // групі за один момент часу; стан per-origIdx).
  const [userRotation, setUserRotation] = useState(() => new Map());
  const [cropProposals, setCropProposals] = useState(() => new Map());
  const [cropOverrides, setCropOverrides] = useState(() => new Map());
  const [cropDisabled, setCropDisabled] = useState(() => new Set());
  const [cropAppliedSet, setCropAppliedSet] = useState(() => new Set());
  const [processedBlobs, setProcessedBlobs] = useState(() => new Map());
  // dismissedDuplicateGroupIds — групи дублів, які адвокат позначив «це не
  // дублікати» (groupId = індекс у initialDuplicates). Виключаються з
  // duplicateMembership і з банера. Той самий сенс що у модалці (PreviewView).
  const [dismissedDuplicateGroupIds, setDismissedDuplicateGroupIds] = useState(() => new Set());

  // previewUrls (баг 2026-05-29 round 2): для сітки Zone 3 показуємо ЗАПЕЧЕНІ
  // baked blob'и так само як модалка ImageMergePanel. Без них сітка показувала
  // СИРИЙ файл, тоді як попап (CropperHost) — обрізаний. Виправлення дзеркалить
  // модалковий patern (`PreviewView` через `computeRenderedBlob` у
  // ImageMergePanel/index.jsx). User rotation НЕ запікається — лишається CSS
  // transform (плавна анімація 0.3s); baked лише auto-rotation + applied crop.
  // Map<origIdx, blobUrl>. Старі URL revoke'аються через 1000ms delayed (щоб
  // displayed image не зникало під час swap).
  const [previewUrls, setPreviewUrls] = useState(() => new Map());
  const previewUrlsToRevokeRef = useRef([]);

  // Thumb URLs — створюємо ОДИН раз для всіх фото
  const thumbUrlsRef = useRef(new Map());
  useEffect(() => {
    for (let i = 0; i < normalizedFiles.length; i++) {
      if (thumbUrlsRef.current.has(i)) continue;
      const f = normalizedFiles[i];
      if (f instanceof Blob) {
        try { thumbUrlsRef.current.set(i, URL.createObjectURL(f)); } catch { /* noop */ }
      }
    }
    const map = thumbUrlsRef.current;
    return () => {
      for (const url of map.values()) {
        try { URL.revokeObjectURL(url); } catch { /* noop */ }
      }
      map.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // previewUrlsRef — дзеркало активного `previewUrls` стану для unmount-cleanup.
  // React не дає прочитати останній state у cleanup-функції unmount-only ефекту;
  // тримаємо ref що оновлюється на КОЖНУ зміну previewUrls. На unmount cleanup
  // нижче читає з ref'у і revoke'ає всі активні blob URL — інакше leak (модалка
  // має аналогічну діру, тут робимо чистіше).
  const previewUrlsRef = useRef(new Map());
  useEffect(() => { previewUrlsRef.current = previewUrls; }, [previewUrls]);

  // Unmount-only cleanup для previewUrls: revoke і активні URL з Map'а, і
  // ще-не-revoke'нуті URL з delayed-черги (`previewUrlsToRevokeRef`). Без цього
  // адвокат закриває editor → blob URLs лишаються в пам'яті браузера до
  // повного зачинення вкладки. Деп-масив порожній — спрацьовує саме на
  // unmount, не на кожен render.
  useEffect(() => {
    return () => {
      for (const url of previewUrlsRef.current.values()) {
        try { URL.revokeObjectURL(url); } catch { /* noop */ }
      }
      previewUrlsRef.current = new Map();
      for (const url of previewUrlsToRevokeRef.current) {
        try { URL.revokeObjectURL(url); } catch { /* noop */ }
      }
      previewUrlsToRevokeRef.current = [];
    };
  }, []);

  // Edge detection — пасивна пропозиція AI у фоні (така ж як у модалці).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const proposals = new Map();
      for (let i = 0; i < normalizedFiles.length; i++) {
        if (cancelled) return;
        const f = normalizedFiles[i];
        if (!(f instanceof Blob)) continue;
        try {
          const rect = await detectDocumentEdges(f, f.name || `#${i}`);
          if (rect) proposals.set(i, rect);
        } catch (e) {
          console.warn('[DpImageMergeEditor] edge detection failed for idx', i, e);
        }
      }
      if (!cancelled) setCropProposals(proposals);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Preview URL generation (баг 2026-05-29 round 2) ────────────────────
  // Дзеркало модалкового useEffect (`ImageMergePanel/index.jsx` ~173-252):
  // коли cropOverride/processedBlob/applied-crop змінюється для idx — згенерувати
  // baked blob (auto-rotation + crop) і покласти URL у previewUrls. Сітка Zone 3
  // отримує `previewUrls` (замість `null` як було до фіксу) і відображає
  // обрізане/повернуте у thumbnail так само як попап. User rotation НЕ запікається
  // — лишається CSS transform у Thumbnail (плавна анімація). Тому userRotation
  // НЕ в deps — зміна userRotation не регенерує blob.
  //
  // Стратегія targets: тільки фото з реальною трансформацією на blob-рівні —
  // auto-rotation != 0 АБО processedBlob АБО applied crop. Без proposal-only
  // (адвокат ще не підтвердив через ✓ Готово — preview лишається сирим).
  // Cropper proposals (cropProposals без override) НЕ генерують preview.
  useEffect(() => {
    if (!Array.isArray(normalizedFiles) || normalizedFiles.length === 0) return;

    // Контекст для unified renderer — той самий що модалка. ОДНЕ місце де живе
    // логіка трансформації (правило #11 — один сенс на «що бачить адвокат»).
    const ctx = {
      realFiles: normalizedFiles,
      detectedOrientations,
      userRotation,
      processedBlobs,
      cropOverrides,
      cropProposals,
      cropDisabled,
      cropAppliedSet,
    };

    const targets = new Set();
    for (let i = 0; i < normalizedFiles.length; i++) {
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
          // applyUserRotation:false — user rotation шарується через CSS у Thumbnail.
          // applyCrop:true з includeProposalRect:false — crop запікається ЛИШЕ
          // коли cropAppliedSet.has(idx) (логіка всередині computeRenderedBlob).
          const blob = await computeRenderedBlob(
            { ...ctx, idx },
            { applyUserRotation: false, applyCrop: true, includeProposalRect: false },
          );
          if (cancelled) break;
          if (blob && blob !== normalizedFiles[idx]) {
            newUrls.set(idx, URL.createObjectURL(blob));
          }
        } catch (e) {
          console.warn('[DpImageMergeEditor] preview generation failed for idx', idx, e);
        }
      }
      if (cancelled) {
        for (const u of newUrls.values()) { try { URL.revokeObjectURL(u); } catch { /* noop */ } }
        return;
      }
      // Atomic replace — старі URL у delayed-revoke черзі (1s) щоб не зникало
      // зображення під час React swap'у. Той самий patern що модалка.
      setPreviewUrls((prev) => {
        for (const [, oldUrl] of prev) previewUrlsToRevokeRef.current.push(oldUrl);
        return newUrls;
      });
      setTimeout(() => {
        const toRevoke = previewUrlsToRevokeRef.current;
        previewUrlsToRevokeRef.current = [];
        for (const u of toRevoke) { try { URL.revokeObjectURL(u); } catch { /* noop */ } }
      }, 1000);
    })();
    return () => { cancelled = true; };
  }, [
    cropOverrides, cropProposals, cropDisabled, cropAppliedSet,
    processedBlobs,
    normalizedFiles, detectedOrientations,
  ]);
  // userRotation НЕ у deps — запікаємо БЕЗ user rotation (тільки auto + crop).
  // Зміна userRotation не повинна регенерувати blob URL — це б ламало CSS
  // transition. Той самий принцип що модалка.

  // ── Drag-and-drop (lazy @dnd-kit) ─────────────────────────────────────────
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
          DragOverlay: core.DragOverlay,
          SortableContext: sortable.SortableContext,
          rectSortingStrategy: sortable.rectSortingStrategy,
          arrayMove: sortable.arrayMove,
          useSortable: sortable.useSortable,
          CSS: utilities.CSS,
        });
      } catch (e) {
        console.warn('[DpImageMergeEditor] @dnd-kit lazy load failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── DnD handlers ──────────────────────────────────────────────────────────
  // Multi-container: active.id і over.id обидва кодують docId і origIdx.
  // Same group → arrayMove. Different group → видалити з source, вставити у
  // target за позицією drop'а.
  const handleDragEnd = useCallback((event) => {
    if (!dndReady) return;
    const { active, over } = event;
    if (!over) return;
    const a = ItemIdDecode(active.id);
    const b = ItemIdDecode(over.id);
    if (!a) return;
    // Якщо drop на сам контейнер групи (порожня група-droppable) — over.id буде
    // спецключем `g::<docId>::container`; обробляємо нижче.
    let targetDocId = b?.docId || null;
    let targetIdx = b?.origIdx ?? null;
    const containerMatch = /^g::(.+)::container$/.exec(over.id || '');
    if (containerMatch) {
      targetDocId = containerMatch[1];
      targetIdx = null;
    }
    if (!targetDocId) return;
    if (a.docId === targetDocId && a.origIdx === targetIdx) return;

    setGroups((prev) => {
      const next = prev.map((g) => ({ ...g, pageIndices: [...g.pageIndices] }));
      const sourceGroup = next.find((g) => g.docId === a.docId);
      const targetGroup = next.find((g) => g.docId === targetDocId);
      if (!sourceGroup || !targetGroup) return prev;

      const sourceIdx = sourceGroup.pageIndices.indexOf(a.origIdx);
      if (sourceIdx < 0) return prev;

      // Remove from source
      sourceGroup.pageIndices.splice(sourceIdx, 1);

      if (sourceGroup === targetGroup) {
        // Same group reorder: insert at target position
        const insertAt = targetIdx == null
          ? targetGroup.pageIndices.length
          : Math.max(0, targetGroup.pageIndices.indexOf(targetIdx));
        targetGroup.pageIndices.splice(insertAt, 0, a.origIdx);
      } else {
        // Cross-group: insert у target за позицією
        const insertAt = targetIdx == null
          ? targetGroup.pageIndices.length
          : Math.max(0, targetGroup.pageIndices.indexOf(targetIdx));
        targetGroup.pageIndices.splice(insertAt, 0, a.origIdx);
      }

      // Видаляємо порожні групи (адвокат міг витягнути всі фото)
      return next.filter((g) => g.pageIndices.length > 0);
    });
  }, [dndReady]);

  // ── Per-photo actions ─────────────────────────────────────────────────────
  const handleRotate = useCallback((origIdx) => {
    setUserRotation((prev) => {
      const next = new Map(prev);
      const cur = next.get(origIdx) || 0;
      next.set(origIdx, (cur + 90) % 360);
      return next;
    });
  }, []);

  const handleRemove = useCallback((origIdx) => {
    setGroups((prev) => prev
      .map((g) => ({ ...g, pageIndices: g.pageIndices.filter((i) => i !== origIdx) }))
      .filter((g) => g.pageIndices.length > 0));
  }, []);

  const handleToggleCropDisabled = useCallback((origIdx) => {
    setCropDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(origIdx)) next.delete(origIdx); else next.add(origIdx);
      return next;
    });
  }, []);

  // #9 — «Не обрізати жодну»: вимикає всі AI-пропозиції обрізки (proposal +
  // override). Адвокат може повернути окремі тапом на ✂️. Дзеркало модалки
  // (ImageMergePanel handleDisableAllCrops). Фінальна збірка PDF
  // (rebuildFromOcrResults) ігнорує rect для idx у cropDisabled → той самий
  // PDF що модалка за тих самих умов.
  const handleDisableAllCrops = useCallback(() => {
    setCropDisabled((prev) => {
      const next = new Set(prev);
      for (const idx of cropProposals.keys()) next.add(idx);
      for (const idx of cropOverrides.keys()) next.add(idx);
      return next;
    });
  }, [cropProposals, cropOverrides]);

  // #1 — обробка дублів (дзеркало модалки ImageMergePanel). «Видалити з групи»
  // у DP = прибрати origIdx з pageIndices своєї групи (та сама механіка що
  // handleRemove). Порожні групи відсіюються.
  const removeIndicesFromGroups = useCallback((toRemoveSet) => {
    if (!toRemoveSet || toRemoveSet.size === 0) return;
    setGroups((prev) => prev
      .map((g) => ({ ...g, pageIndices: g.pageIndices.filter((i) => !toRemoveSet.has(i)) }))
      .filter((g) => g.pageIndices.length > 0));
  }, []);

  // «Залишити цей, видалити інші» (на рекомендованому thumbnail) — прибирає
  // не-рекомендовані фото групи дублів.
  const handleKeepRecommendedDuplicate = useCallback((groupIndices, recommended) => {
    const toRemove = new Set((groupIndices || []).filter((i) => i !== recommended));
    removeIndicesFromGroups(toRemove);
  }, [removeIndicesFromGroups]);

  // «Залишити рекомендовані» (банер) — для всіх НЕ-dismissed груп лишає тільки
  // recommended, решту прибирає.
  const handleKeepAllRecommendedDuplicates = useCallback(() => {
    const toRemove = new Set();
    (initialDuplicates || []).forEach((g, groupId) => {
      if (dismissedDuplicateGroupIds.has(groupId)) return;
      for (const i of g.group) if (i !== g.recommended) toRemove.add(i);
    });
    removeIndicesFromGroups(toRemove);
  }, [initialDuplicates, dismissedDuplicateGroupIds, removeIndicesFromGroups]);

  // «Це не дублікати» — група розпадається (перестає показуватись як дублі).
  const handleDismissDuplicateGroup = useCallback((groupId) => {
    setDismissedDuplicateGroupIds((prev) => {
      const next = new Set(prev);
      next.add(groupId);
      return next;
    });
  }, []);

  const handleCropOverride = useCallback((origIdx, rect, opts = {}) => {
    const applied = opts.applied === true;
    setCropOverrides((prev) => {
      const next = new Map(prev);
      if (rect === null) next.delete(origIdx); else next.set(origIdx, rect);
      return next;
    });
    setCropAppliedSet((prev) => {
      const next = new Set(prev);
      if (rect === null) next.delete(origIdx);
      else if (applied) next.add(origIdx);
      else next.delete(origIdx);
      return next;
    });
    if (rect !== null) {
      setCropDisabled((prev) => {
        if (!prev.has(origIdx)) return prev;
        const next = new Set(prev);
        next.delete(origIdx);
        return next;
      });
    }
  }, []);

  const handleProcessedBlobSave = useCallback((origIdx, blob, baseUserRotation) => {
    setProcessedBlobs((prev) => {
      const next = new Map(prev);
      next.set(origIdx, { blob, baseUserRotation });
      return next;
    });
    setCropOverrides((prev) => {
      if (!prev.has(origIdx)) return prev;
      const next = new Map(prev);
      next.delete(origIdx);
      return next;
    });
  }, []);

  // ── Group-level actions ───────────────────────────────────────────────────
  const updateGroup = useCallback((docId, field, value) => {
    setGroups((prev) => prev.map((g) => (g.docId === docId ? { ...g, [field]: value } : g)));
  }, []);

  const addEmptyGroup = useCallback(() => {
    setGroups((prev) => [...prev, {
      docId: nextDocId(),
      name: '',
      type: '',
      author: '',
      procId: proceedings?.[0]?.id || '',
      date: '',
      isKey: false,
      pageIndices: [],
    }]);
  }, [proceedings]);

  const removeGroup = useCallback((docId) => {
    setGroups((prev) => {
      const g = prev.find((x) => x.docId === docId);
      if (g && g.pageIndices.length > 0) {
        // Не дозволяємо видалити непорожню — спершу витягнути фото
        toast.warning('Спочатку перенесіть або видаліть фото з групи');
        return prev;
      }
      return prev.filter((x) => x.docId !== docId);
    });
  }, []);

  // ── Popup ─────────────────────────────────────────────────────────────────
  const [popupOrigIdx, setPopupOrigIdx] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const allOrderedIndices = useMemo(
    () => groups.flatMap((g) => g.pageIndices),
    [groups],
  );

  const openPopup = useCallback((origIdx) => { setPopupOrigIdx(origIdx); setContextMenu(null); }, []);
  const closePopup = useCallback(() => setPopupOrigIdx(null), []);
  const navPopup = useCallback((dir) => {
    if (popupOrigIdx == null) return;
    const pos = allOrderedIndices.indexOf(popupOrigIdx);
    if (pos < 0) return;
    const np = pos + dir;
    if (np < 0 || np >= allOrderedIndices.length) return;
    setPopupOrigIdx(allOrderedIndices[np]);
  }, [popupOrigIdx, allOrderedIndices]);

  // ── Submit ────────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const handleSubmitClick = async () => {
    if (submitting) return;
    if (groups.length === 0 || groups.every((g) => g.pageIndices.length === 0)) {
      toast.error('Жодної групи з фото — нема що додавати');
      return;
    }
    const unnamed = groups.find((g) => g.pageIndices.length > 0 && !g.name.trim());
    if (unnamed) {
      toast.error(`Введіть назву для документа з ${unnamed.pageIndices.length} стор.`);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        groups,
        userRotation,
        cropOverrides,
        cropProposals,
        cropDisabled,
        cropAppliedSet,
        processedBlobs,
        pre,
      });
    } catch (e) {
      console.error('[DpImageMergeEditor] submit failed:', e);
      toast.error('Не вдалось зберегти документи', { description: e?.message });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const cssRotationMap = useMemo(() => {
    const m = new Map();
    for (let i = 0; i < normalizedFiles.length; i++) {
      const userDeg = userRotation.get(i) || 0;
      const proc = processedBlobs.get(i);
      const baseUser = proc?.baseUserRotation || 0;
      m.set(i, (((userDeg - baseUser) % 360) + 360) % 360);
    }
    return m;
  }, [userRotation, processedBlobs, normalizedFiles.length]);

  const cropStateByIndex = useMemo(() => {
    const map = new Map();
    const allIds = new Set([
      ...cropProposals.keys(),
      ...cropOverrides.keys(),
      ...processedBlobs.keys(),
    ]);
    for (const idx of allIds) {
      if (cropAppliedSet.has(idx) || processedBlobs.has(idx)) map.set(idx, 'applied');
      else if (cropDisabled.has(idx)) map.set(idx, 'disabled');
      else map.set(idx, 'active');
    }
    return map;
  }, [cropProposals, cropOverrides, cropDisabled, cropAppliedSet, processedBlobs]);

  // duplicateMembership: origIdx → { groupId, recommended, reason, groupIndices }.
  // Дзеркало модалки (PreviewView:119). Виключаємо dismissed групи. Grid
  // (Thumbnail/RenderItem) уже малює жовту рамку на дублях і зелений на
  // recommended за цим props — DP лише постачає дані.
  const duplicateMembership = useMemo(() => {
    const map = new Map();
    (initialDuplicates || []).forEach((g, groupId) => {
      if (dismissedDuplicateGroupIds.has(groupId)) return;
      if (!Array.isArray(g.group)) return;
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
  }, [initialDuplicates, dismissedDuplicateGroupIds]);

  // Кількість фото з активною (не вимкненою, не застосованою) обрізкою — для
  // тексту банера #9. Той самий підрахунок що модалка (PreviewView activeCropCount).
  const activeCropCount = useMemo(() => {
    let n = 0;
    for (const state of cropStateByIndex.values()) if (state === 'active') n++;
    return n;
  }, [cropStateByIndex]);

  // Кількість активних (не-dismissed) груп дублів — для банера #1.
  const activeDuplicateGroupsCount = useMemo(
    () => (initialDuplicates || []).filter((_, gid) => !dismissedDuplicateGroupIds.has(gid)).length,
    [initialDuplicates, dismissedDuplicateGroupIds],
  );

  const uncertainSet = useMemo(() => new Set(uncertainOrientationIndices), [uncertainOrientationIndices]);
  const proceedingOptions = useMemo(
    () => (proceedings || []).map((p) => ({ value: p.id, label: p.title })),
    [proceedings],
  );

  const totalPhotos = allOrderedIndices.length;

  return (
    <div className="dp-image-merge-editor">
      <div className="dp-image-merge-editor__header">
        <strong>Склейка фото у документи</strong>
        <span className="dpv2-muted">
          {groups.length} {groups.length === 1 ? 'документ' : 'документ(и)'} ·{' '}
          {totalPhotos} фото
        </span>
      </div>

      {uncertainOrientationIndices.length > 0 && (
        <div className="dpv2-attention-card">
          <AlertTriangle size={ICON_SIZE.sm} />
          <span>
            Орієнтація {uncertainOrientationIndices.length}{' '}
            {uncertainOrientationIndices.length === 1 ? 'фото' : 'фото'} не визначена —
            перевірте, кнопка ↻ виправить.
          </span>
        </div>
      )}

      {!dndReady ? (
        <div className="dpv2-muted">Завантаження редактора…</div>
      ) : (
        <DndOrchestrator
          dndReady={dndReady}
          groups={groups}
          thumbUrls={thumbUrlsRef.current}
          previewUrls={previewUrls}
          warningsByIndex={new Map()}
          duplicateMembership={duplicateMembership}
          userRotation={cssRotationMap}
          uncertainSet={uncertainSet}
          cropStateByIndex={cropStateByIndex}
          onDragEnd={handleDragEnd}
          onRemove={handleRemove}
          onRotate={handleRotate}
          onToggleCropDisabled={handleToggleCropDisabled}
          onKeepRecommendedDuplicate={handleKeepRecommendedDuplicate}
          onDismissDuplicateGroup={handleDismissDuplicateGroup}
          onOpenPopup={openPopup}
          onContextMenu={(e, origIdx) => {
            e.preventDefault();
            setContextMenu({ origIdx, x: e.clientX, y: e.clientY });
          }}
          updateGroup={updateGroup}
          removeGroup={removeGroup}
          proceedingOptions={proceedingOptions}
        />
      )}

      {(activeCropCount > 0 || activeDuplicateGroupsCount > 0) && (
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
                onClick={handleDisableAllCrops}
              >
                <X size={14} />
                Не обрізати жодну
              </button>
            </div>
          )}
          {activeDuplicateGroupsCount > 0 && (
            <div className="image-merge-panel__alert image-merge-panel__alert--dup">
              <CopyIcon size={ICON_SIZE.sm} />
              <span>
                Знайдено {activeDuplicateGroupsCount} {activeDuplicateGroupsCount === 1 ? 'групу' : 'групи'} дублікатів (жовта рамка). Рекомендовані варіанти позначені зеленим.
              </span>
              <button
                type="button"
                className="image-merge-panel__remove-suspicious image-merge-panel__remove-suspicious--dup"
                onClick={handleKeepAllRecommendedDuplicates}
              >
                <Check size={14} />
                Залишити рекомендовані
              </button>
            </div>
          )}
        </div>
      )}

      <div className="dp-image-merge-editor__add-group">
        <Button variant="ghost" size="sm" onClick={addEmptyGroup} icon={<Plus size={ICON_SIZE.sm} />}>
          Додати порожню групу
        </Button>
      </div>

      <div className="dpv2-attention-actions">
        <Button variant="secondary" onClick={onCancel} disabled={submitting} icon={<ArrowLeft size={ICON_SIZE.sm} />}>
          Назад
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmitClick}
          disabled={submitting || groups.every((g) => g.pageIndices.length === 0)}
          icon={<Play size={ICON_SIZE.sm} />}
        >
          {submitting
            ? 'Зберігаємо…'
            : `Виконати: створити ${groups.filter((g) => g.pageIndices.length > 0).length} документів`}
        </Button>
      </div>

      {popupOrigIdx != null && (
        <PreviewPopup
          key={popupOrigIdx}
          origIdx={popupOrigIdx}
          url={thumbUrlsRef.current.get(popupOrigIdx)}
          sourceBlob={normalizedFiles?.[popupOrigIdx] || null}
          autoRotation={Number.isFinite(detectedOrientations[popupOrigIdx]) ? detectedOrientations[popupOrigIdx] : 0}
          userRotation={userRotation.get(popupOrigIdx) || 0}
          cropApplied={cropAppliedSet.has(popupOrigIdx)}
          processedEntry={processedBlobs.get(popupOrigIdx) || null}
          onProcessedBlobSave={(blob, baseUserRotation) => handleProcessedBlobSave(popupOrigIdx, blob, baseUserRotation)}
          position={allOrderedIndices.indexOf(popupOrigIdx)}
          total={allOrderedIndices.length}
          warning={null}
          duplicateInfo={duplicateMembership.get(popupOrigIdx) || null}
          isUncertain={uncertainSet.has(popupOrigIdx)}
          cropProposal={cropProposals.get(popupOrigIdx) || null}
          cropOverride={cropOverrides.get(popupOrigIdx) || null}
          cropDisabled={cropDisabled.has(popupOrigIdx)}
          onClose={closePopup}
          onPrev={() => navPopup(-1)}
          onNext={() => navPopup(1)}
          onRotate={() => handleRotate(popupOrigIdx)}
          onCropOverride={(rect, opts) => handleCropOverride(popupOrigIdx, rect, opts)}
          onToggleCropDisabled={() => handleToggleCropDisabled(popupOrigIdx)}
          onRemove={() => {
            const cur = popupOrigIdx;
            const pos = allOrderedIndices.indexOf(cur);
            const nextIdx = pos >= 0 && pos < allOrderedIndices.length - 1
              ? allOrderedIndices[pos + 1]
              : (pos > 0 ? allOrderedIndices[pos - 1] : null);
            handleRemove(cur);
            setPopupOrigIdx(nextIdx);
          }}
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onView={() => { openPopup(contextMenu.origIdx); setContextMenu(null); }}
          onRotate={() => { handleRotate(contextMenu.origIdx); setContextMenu(null); }}
          onRemove={() => { handleRemove(contextMenu.origIdx); setContextMenu(null); }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

// ── DndOrchestrator: один DndContext, N SortableContext (по групі) ─────────
function DndOrchestrator({
  dndReady, groups, thumbUrls, previewUrls, warningsByIndex, duplicateMembership,
  userRotation, uncertainSet, cropStateByIndex,
  onDragEnd, onRemove, onRotate, onToggleCropDisabled,
  onKeepRecommendedDuplicate, onDismissDuplicateGroup, onOpenPopup, onContextMenu,
  updateGroup, removeGroup, proceedingOptions,
}) {
  const {
    DndContext, PointerSensor, TouchSensor, useSensor, useSensors, closestCenter,
  } = dndReady;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  // flatPositions — позиція кожного origIdx у єдиному списку для лейбла #N.
  const flatPositions = useMemo(() => {
    const map = new Map();
    let pos = 0;
    for (const g of groups) {
      for (const idx of g.pageIndices) map.set(idx, pos++);
    }
    return map;
  }, [groups]);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <div className="dp-image-merge-editor__groups">
        {groups.map((g, gIdx) => (
          <GroupSection
            key={g.docId}
            group={g}
            groupIndex={gIdx}
            dndReady={dndReady}
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
            onKeepRecommendedDuplicate={onKeepRecommendedDuplicate}
            onDismissDuplicateGroup={onDismissDuplicateGroup}
            onOpenPopup={onOpenPopup}
            onContextMenu={onContextMenu}
            updateGroup={updateGroup}
            removeGroup={removeGroup}
            proceedingOptions={proceedingOptions}
          />
        ))}
      </div>
    </DndContext>
  );
}

// ── GroupSection: header (форма) + SortableContext (фото) ──────────────────
function GroupSection({
  group, groupIndex, dndReady, thumbUrls, previewUrls, warningsByIndex, duplicateMembership,
  userRotation, uncertainSet, cropStateByIndex, flatPositions,
  onRemove, onRotate, onToggleCropDisabled,
  onKeepRecommendedDuplicate, onDismissDuplicateGroup, onOpenPopup, onContextMenu,
  updateGroup, removeGroup, proceedingOptions,
}) {
  const { SortableContext, rectSortingStrategy } = dndReady;
  const itemIds = group.pageIndices.map((origIdx) => ItemIdEncode(group.docId, origIdx));

  return (
    <section className="dp-image-merge-editor__group">
      <div className="dp-image-merge-editor__group-header">
        <span className="dp-image-merge-editor__group-title">
          Документ {groupIndex + 1} · {group.pageIndices.length}{' '}
          {group.pageIndices.length === 1 ? 'фото' : 'фото'}
        </span>
        <button
          type="button"
          className="dpv2-iconbtn"
          onClick={() => removeGroup(group.docId)}
          aria-label="Видалити групу"
          title="Видалити порожню групу"
          disabled={group.pageIndices.length > 0}
        >
          <Trash2 size={ICON_SIZE.sm} />
        </button>
      </div>

      <div className="dp-image-merge-editor__group-form">
        <Input
          label="Назва документа"
          value={group.name}
          onChange={(v) => updateGroup(group.docId, 'name', v)}
          placeholder="Напр. Паспорт громадянина"
        />
        <div className="dp-image-merge-editor__group-form-row">
          <Select
            label="Тип"
            value={group.type}
            onChange={(v) => updateGroup(group.docId, 'type', v)}
            options={CATEGORY_OPTIONS}
            placeholder="Оберіть тип"
          />
          <Select
            label="Від кого"
            value={group.author}
            onChange={(v) => updateGroup(group.docId, 'author', v)}
            options={AUTHOR_OPTIONS}
            placeholder="Оберіть автора"
          />
        </div>
        {proceedingOptions.length > 0 && (
          <Select
            label="Провадження"
            value={group.procId}
            onChange={(v) => updateGroup(group.docId, 'procId', v)}
            options={proceedingOptions}
            placeholder="Оберіть провадження"
          />
        )}
        <DatePicker
          label="Дата документа"
          value={group.date}
          onChange={(v) => updateGroup(group.docId, 'date', v)}
        />
        <Toggle
          label="Позначити як ключовий"
          checked={group.isKey}
          onChange={(v) => updateGroup(group.docId, 'isKey', v)}
        />
      </div>

      <SortableContext items={itemIds} strategy={rectSortingStrategy}>
        <div className="dp-image-merge-editor__group-grid image-merge-panel__grid">
          {group.pageIndices.map((origIdx) => (
            <DpSortableItem
              key={`${group.docId}::${origIdx}`}
              docId={group.docId}
              origIdx={origIdx}
              dndReady={dndReady}
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
              onKeepRecommendedDuplicate={onKeepRecommendedDuplicate}
              onDismissDuplicateGroup={onDismissDuplicateGroup}
              onOpenPopup={onOpenPopup}
              onContextMenu={onContextMenu}
            />
          ))}
          {group.pageIndices.length === 0 && (
            <div className="dpv2-muted dp-image-merge-editor__group-empty">
              Перетягніть фото сюди
            </div>
          )}
        </div>
      </SortableContext>
    </section>
  );
}

// ── DpSortableItem: обгортка над RenderItem зі своїм useSortable ───────────
function DpSortableItem({
  docId, origIdx, dndReady, thumbUrls, previewUrls, warningsByIndex, duplicateMembership,
  userRotation, uncertainSet, cropStateByIndex, flatPositions,
  onRemove, onRotate, onToggleCropDisabled,
  onKeepRecommendedDuplicate, onDismissDuplicateGroup, onOpenPopup, onContextMenu,
}) {
  const { useSortable, CSS } = dndReady;
  const sortable = useSortable({ id: ItemIdEncode(docId, origIdx) });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  const item = { type: 'single', id: `single_${origIdx}`, idx: origIdx };
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
