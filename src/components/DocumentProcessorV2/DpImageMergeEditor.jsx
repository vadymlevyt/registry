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
import { ProcessingProgress } from '../ImageEditor/ProcessingProgress.jsx';
import {
  buildDuplicateMembership,
  buildDisplayItems,
  buildFlatPositions,
  countActiveDuplicateGroups,
} from '../ImageEditor/grid/displayItems.js';
import {
  buildCropStateByIndex,
  countActiveCrop,
  buildUncertainSet,
} from '../../services/imageDocument/cropState.js';
import { detectDocumentEdges } from '../../services/sortation/edgeDetection.js';
import { selectRecommendedDuplicateRemovals } from '../../services/imageDocument/duplicateSelection.js';
import { usePreviewUrls } from '../ImageEditor/hooks/usePreviewUrls.js';

let docIdSeq = 0;
const nextDocId = () => `dpg_${Date.now()}_${docIdSeq++}`;

// ── Item ID кодування для DnD ────────────────────────────────────────────────
// Одиниця сортування = displayItem (single АБО група дублів), не завжди фото.
//   single → g::<docId>::p::<origIdx>
//   group  → g::<docId>::grp::<gIdx>   (gIdx — індекс групи у initialDuplicates)
// Жодної логіки дублів тут — лише (де)серіалізація id. Групування/membership
// живуть у СПІЛЬНОМУ grid/displayItems.js (buildDisplayItems/buildDuplicateMembership).
function ItemIdEncode(docId, origIdx) {
  return `g::${docId}::p::${origIdx}`;
}
function GroupIdEncode(docId, gIdx) {
  return `g::${docId}::grp::${gIdx}`;
}
// Контейнер документа як drop-ціль (для вільного перетягування у порожню/будь-яку
// групу — борг #36/#28). over.id === цей id → handleDragEnd додає у КІНЕЦЬ групи.
function GroupContainerId(docId) {
  return `g::${docId}::container`;
}
function ItemIdDecode(id) {
  let m = /^g::(.+?)::p::(\d+)$/.exec(id || '');
  if (m) return { kind: 'single', docId: m[1], origIdx: Number(m[2]) };
  m = /^g::(.+?)::grp::(\d+)$/.exec(id || '');
  if (m) return { kind: 'group', docId: m[1], gIdx: Number(m[2]) };
  m = /^g::(.+)::container$/.exec(id || '');
  if (m) return { kind: 'container', docId: m[1] };
  return null;
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

  // duplicateMembership: origIdx → { groupId, recommended, reason, groupIndices }.
  // СПІЛЬНА логіка (buildDuplicateMembership) — те саме джерело що модалка. DP НЕ
  // обчислює членство сам. Оголошено тут (до handleDragEnd), бо drag-юніт групи
  // читає членство щоб перенести всіх членів разом.
  const duplicateMembership = useMemo(
    () => buildDuplicateMembership(initialDuplicates, dismissedDuplicateGroupIds),
    [initialDuplicates, dismissedDuplicateGroupIds],
  );

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

  // edgeProgress — прогрес стартового аналізу країв (фото-обробка startup, #34).
  // { done, total }: total>0 і done<total → показуємо неблокуючий бейдж через
  // спільний ProcessingProgress. Edge detection НЕ блокує редагування — бейдж
  // лише інформує що ✂️-пропозиції ще дозавантажуються.
  const [edgeProgress, setEdgeProgress] = useState({ done: 0, total: 0 });

  // Edge detection — пасивна пропозиція AI у фоні (така ж як у модалці).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const total = normalizedFiles.length;
      setEdgeProgress({ done: 0, total });
      const proposals = new Map();
      for (let i = 0; i < normalizedFiles.length; i++) {
        if (cancelled) return;
        const f = normalizedFiles[i];
        if (f instanceof Blob) {
          try {
            const rect = await detectDocumentEdges(f, f.name || `#${i}`);
            if (rect) proposals.set(i, rect);
          } catch (e) {
            console.warn('[DpImageMergeEditor] edge detection failed for idx', i, e);
          }
        }
        if (!cancelled) setEdgeProgress({ done: i + 1, total });
      }
      if (!cancelled) {
        setCropProposals(proposals);
        setEdgeProgress({ done: total, total });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // previewUrls (баг 2026-05-29 round 2): для сітки Zone 3 показуємо ЗАПЕЧЕНІ
  // baked blob'и так само як модалка ImageMergePanel — СПІЛЬНИЙ хук usePreviewUrls
  // (один шлях, нуль дубльованої логіки; борг #33). Baked лише auto-rotation +
  // applied crop; user rotation шарується через CSS transform у Thumbnail.
  const previewUrls = usePreviewUrls({
    realFiles: normalizedFiles,
    detectedOrientations,
    userRotation,
    processedBlobs,
    cropOverrides,
    cropProposals,
    cropDisabled,
    cropAppliedSet,
  });

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
          pointerWithin: core.pointerWithin,
          rectIntersection: core.rectIntersection,
          useDroppable: core.useDroppable,
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
  // Multi-container: drag МІЖ документами лишається (один DndContext). Одиниця
  // перетягування = displayItem: фото (single) АБО ціла група дублів (group).
  // Коли тягнуть групу — переносимо ВСІХ її членів разом (членство читаємо зі
  // СПІЛЬНОГО duplicateMembership; DP не визначає групи сам). Дублі-група
  // консолідується поруч у точці drop'а.
  const handleDragEnd = useCallback((event) => {
    if (!dndReady) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const a = ItemIdDecode(active.id);
    const o = ItemIdDecode(over.id);
    if (!a || a.kind === 'container') return;
    const targetDocId = o?.docId || null;
    if (!targetDocId) return;

    setGroups((prev) => {
      const next = prev.map((g) => ({ ...g, pageIndices: [...g.pageIndices] }));
      const sourceGroup = next.find((g) => g.docId === a.docId);
      const targetGroup = next.find((g) => g.docId === targetDocId);
      if (!sourceGroup || !targetGroup) return prev;

      // Які origIdx рухаються: фото → одне; група → всі її члени у цьому документі.
      const movedIndices = a.kind === 'group'
        ? sourceGroup.pageIndices.filter((i) => duplicateMembership.get(i)?.groupId === a.gIdx)
        : [a.origIdx];
      if (movedIndices.length === 0) return prev;

      // Якір у target (вставляємо ПЕРЕД ним): фото → саме воно; група → перший
      // присутній член тієї групи; container/порожньо → у кінець.
      let anchorIdx = null;
      if (o.kind === 'single') anchorIdx = o.origIdx;
      else if (o.kind === 'group') {
        const found = targetGroup.pageIndices.find(
          (i) => duplicateMembership.get(i)?.groupId === o.gIdx,
        );
        anchorIdx = found === undefined ? null : found;
      }
      // No-op: drop юніта самого на себе.
      if (anchorIdx != null && movedIndices.includes(anchorIdx)) return prev;

      const movedSet = new Set(movedIndices);
      // sourceGroup===targetGroup коли той самий документ — це один об'єкт у next,
      // тож target бачить уже відфільтрований масив.
      sourceGroup.pageIndices = sourceGroup.pageIndices.filter((i) => !movedSet.has(i));

      const insertAt = anchorIdx == null
        ? targetGroup.pageIndices.length
        : Math.max(0, targetGroup.pageIndices.indexOf(anchorIdx));
      targetGroup.pageIndices.splice(insertAt, 0, ...movedIndices);

      // Прибираємо ЛИШЕ source-групу, якщо вона спорожніла внаслідок переносу.
      // Інші порожні групи (свідомо додані як drop-цілі — борг #36) лишаються:
      // адвокат додав їх щоб перетягнути аркуші в новий документ. Прибрати
      // зайву порожню можна кнопкою-кошиком.
      return next.filter((g) => g.docId !== a.docId || g.pageIndices.length > 0);
    });
  }, [dndReady, duplicateMembership]);

  // ── Per-photo actions ─────────────────────────────────────────────────────
  const handleRotate = useCallback((origIdx) => {
    setUserRotation((prev) => {
      const next = new Map(prev);
      const cur = next.get(origIdx) || 0;
      next.set(origIdx, (cur + 90) % 360);
      return next;
    });
  }, []);

  // Видалення фото: прибираємо групу автоматично ЛИШЕ якщо вона спорожніла через
  // видалення цього (останнього) фото. Інші порожні групи (свідомо додані як
  // drop-цілі — борг #36) лишаються недоторканими.
  const handleRemove = useCallback((origIdx) => {
    setGroups((prev) => prev.reduce((acc, g) => {
      if (!g.pageIndices.includes(origIdx)) { acc.push(g); return acc; }
      const pageIndices = g.pageIndices.filter((i) => i !== origIdx);
      if (pageIndices.length > 0) acc.push({ ...g, pageIndices });
      return acc;
    }, []));
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
  // handleRemove). Прибираємо групу ЛИШЕ якщо вона спорожніла внаслідок цього
  // видалення; свідомо додані порожні drop-цілі (борг #36) лишаються.
  const removeIndicesFromGroups = useCallback((toRemoveSet) => {
    if (!toRemoveSet || toRemoveSet.size === 0) return;
    setGroups((prev) => prev.reduce((acc, g) => {
      const hadAny = g.pageIndices.some((i) => toRemoveSet.has(i));
      if (!hadAny) { acc.push(g); return acc; }
      const pageIndices = g.pageIndices.filter((i) => !toRemoveSet.has(i));
      if (pageIndices.length > 0) acc.push({ ...g, pageIndices });
      return acc;
    }, []));
  }, []);

  // «Залишити цей, видалити інші» (на рекомендованому thumbnail) — прибирає
  // не-рекомендовані фото групи дублів.
  const handleKeepRecommendedDuplicate = useCallback((groupIndices, recommended) => {
    const toRemove = new Set((groupIndices || []).filter((i) => i !== recommended));
    removeIndicesFromGroups(toRemove);
  }, [removeIndicesFromGroups]);

  // «Залишити рекомендовані» (банер) — #12: поважає і dismissed-групи, і
  // ручний вибір. Спільна логіка selectRecommendedDuplicateRemovals (та сама
  // що у модалці). Присутність члена = він ще у якійсь групі (allOrderedIndices
  // через groups.pageIndices); видалений вручну (handleRemove) → відсутній →
  // вся група пропускається.
  const handleKeepAllRecommendedDuplicates = useCallback(() => {
    const present = new Set(groups.flatMap((g) => g.pageIndices));
    const toRemove = selectRecommendedDuplicateRemovals(initialDuplicates, {
      dismissedGroupIds: dismissedDuplicateGroupIds,
      isMemberPresent: (idx) => present.has(idx),
    });
    removeIndicesFromGroups(toRemove);
  }, [groups, initialDuplicates, dismissedDuplicateGroupIds, removeIndicesFromGroups]);

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

  // Видалити цілу секцію-документ разом з її фото. Фото зникають з усіх груп →
  // виключаються зі склейки (та сама модель, що видалення по одному в handleRemove,
  // лише одним рухом). Захист від випадкового зносу багатофотної секції — two-tap
  // arm на кнопці-кошику (GroupSection), тож тут безумовно.
  const removeGroup = useCallback((docId) => {
    setGroups((prev) => prev.filter((x) => x.docId !== docId));
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

  // СПІЛЬНА логіка (buildCropStateByIndex) — те саме джерело що модалка
  // (PreviewView). Інлайн-копію видалено (борг #33). Семантику станів — у cropState.js.
  const cropStateByIndex = useMemo(
    () => buildCropStateByIndex(cropProposals, cropOverrides, cropDisabled, cropAppliedSet, processedBlobs),
    [cropProposals, cropOverrides, cropDisabled, cropAppliedSet, processedBlobs],
  );

  // Кількість фото з активною обрізкою — банер #9. СПІЛЬНА логіка (countActiveCrop).
  const activeCropCount = useMemo(() => countActiveCrop(cropStateByIndex), [cropStateByIndex]);

  // Кількість активних (не-dismissed) груп дублів — банер #1. СПІЛЬНА логіка
  // (countActiveDuplicateGroups), те саме джерело що модалка.
  const activeDuplicateGroupsCount = useMemo(
    () => countActiveDuplicateGroups(initialDuplicates, dismissedDuplicateGroupIds),
    [initialDuplicates, dismissedDuplicateGroupIds],
  );

  const uncertainSet = useMemo(() => buildUncertainSet(uncertainOrientationIndices), [uncertainOrientationIndices]);
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

      {/* Стартовий прогрес фото-обробки (#34) — неблокуючий бейдж, поки фоновий
          аналіз країв дозаповнює ✂️-пропозиції. Спільний ProcessingProgress. */}
      {edgeProgress.total > 0 && edgeProgress.done < edgeProgress.total && (
        <div className="dp-image-merge-editor__startup-progress">
          <ProcessingProgress
            variant="badge"
            label="Аналіз країв документів…"
            done={edgeProgress.done}
            total={edgeProgress.total}
          />
        </div>
      )}

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
          duplicateGroups={initialDuplicates}
          dismissedGroupIds={dismissedDuplicateGroupIds}
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
  duplicateGroups, dismissedGroupIds,
  userRotation, uncertainSet, cropStateByIndex,
  onDragEnd, onRemove, onRotate, onToggleCropDisabled,
  onKeepRecommendedDuplicate, onDismissDuplicateGroup, onOpenPopup, onContextMenu,
  updateGroup, removeGroup, proceedingOptions,
}) {
  const {
    DndContext, PointerSensor, TouchSensor, useSensor, useSensors,
    pointerWithin, rectIntersection, DragOverlay,
  } = dndReady;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  // Collision detection (борг #36): даємо пріоритет конкретному фото/групі під
  // курсором (reorder / вставка перед), а коли курсор над порожнім місцем групи
  // (вкл. порожню групу) — падаємо на контейнер (`...::container`) → drop у
  // КІНЕЦЬ цієї групи. closestCenter сам не таргетив порожні групи (нема
  // sortable-елементів), тому порожня група була марною drop-ціллю.
  const collisionDetection = useCallback((args) => {
    const pointer = pointerWithin(args);
    const base = pointer.length > 0 ? pointer : rectIntersection(args);
    const items = base.filter((c) => !String(c.id).endsWith('::container'));
    return items.length > 0 ? items : base;
  }, [pointerWithin, rectIntersection]);

  // activeId — id одиниці, що зараз тягнеться (для DragOverlay прев'ю). Чистимо
  // на end/cancel.
  const [activeId, setActiveId] = useState(null);

  // displayItems кожної групи — СПІЛЬНА логіка групування (buildDisplayItems),
  // та сама що модалка. Обчислюємо ОДИН раз тут і прокидаємо у GroupSection
  // (раніше GroupSection рахував сам — щоб flatPositions і рендер не розходились).
  const groupDisplayItems = useMemo(
    () => groups.map((g) => buildDisplayItems(g.pageIndices, duplicateGroups, dismissedGroupIds)),
    [groups, duplicateGroups, dismissedGroupIds],
  );

  // Активна одиниця для DragOverlay — знаходимо displayItem за decoded activeId.
  const activeItem = useMemo(() => {
    const dec = ItemIdDecode(activeId);
    if (!dec || dec.kind === 'container') return null;
    const gi = groups.findIndex((g) => g.docId === dec.docId);
    if (gi < 0) return null;
    const items = groupDisplayItems[gi] || [];
    return dec.kind === 'group'
      ? items.find((it) => it.type === 'group' && it.gIdx === dec.gIdx) || null
      : items.find((it) => it.type === 'single' && it.idx === dec.origIdx) || null;
  }, [activeId, groups, groupDisplayItems]);

  // flatPositions — позиція кожного origIdx у єдиному списку для лейбла #N.
  // СПІЛЬНА логіка (buildFlatPositions) над глобальним displayItems: нумерація
  // йде ВІЗУАЛЬНИМ порядком сітки (члени групи дублів стягнуті разом), а не сирим
  // порядком pageIndices — те саме джерело що модалка (SortableGrid).
  const flatPositions = useMemo(
    () => buildFlatPositions(groupDisplayItems.flat()),
    [groupDisplayItems],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={(e) => setActiveId(e.active.id)}
      onDragEnd={(e) => { setActiveId(null); onDragEnd(e); }}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="dp-image-merge-editor__groups">
        {groups.map((g, gIdx) => (
          <GroupSection
            key={g.docId}
            group={g}
            groupIndex={gIdx}
            displayItems={groupDisplayItems[gIdx]}
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

      {/* Прев'ю одиниці, що тягнеться (борг #36) — поверх сітки, спільний
          RenderItem без sortable-обгорток. */}
      <DragOverlay>
        {activeItem ? (
          <div className="dp-image-merge-editor__drag-overlay">
            <RenderItem
              item={activeItem}
              thumbUrls={thumbUrls}
              previewUrls={previewUrls}
              warningsByIndex={warningsByIndex}
              duplicateMembership={duplicateMembership}
              userRotation={userRotation}
              uncertainSet={uncertainSet}
              cropStateByIndex={cropStateByIndex}
              flatPositions={flatPositions}
              onRemove={() => {}}
              onRotate={() => {}}
              onToggleCropDisabled={() => {}}
              onOpenPopup={() => {}}
              onContextMenu={() => {}}
              onKeepRecommendedDuplicate={() => {}}
              onDismissDuplicateGroup={() => {}}
              sortableRef={null}
              sortableStyle={null}
              sortableListeners={null}
              sortableAttributes={null}
              isDragging={false}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ── GroupSection: header (форма) + SortableContext (фото) ──────────────────
function GroupSection({
  group, groupIndex, displayItems, dndReady, thumbUrls, previewUrls, warningsByIndex, duplicateMembership,
  userRotation, uncertainSet, cropStateByIndex, flatPositions,
  onRemove, onRotate, onToggleCropDisabled,
  onKeepRecommendedDuplicate, onDismissDuplicateGroup, onOpenPopup, onContextMenu,
  updateGroup, removeGroup, proceedingOptions,
}) {
  const { SortableContext, rectSortingStrategy, useDroppable } = dndReady;

  // displayItems — СПІЛЬНА логіка групування (buildDisplayItems у DndOrchestrator,
  // та сама що модалка). Дублі (навіть розкидані по pageIndices) стягуються в ОДИН
  // group-item; решта — single. Жодного власного розкладу сегментів у DP.

  // Sortable-одиниці = displayItems: фото-single за id фото, група за id групи
  // (тягнеться як одне ціле; члени всередині поодинці не сортуються).
  const itemIds = displayItems.map((it) => (
    it.type === 'group'
      ? GroupIdEncode(group.docId, it.gIdx)
      : ItemIdEncode(group.docId, it.idx)
  ));

  // Контейнер групи як drop-ціль (борг #36/#28): робить ВСЮ область сітки (вкл.
  // порожню групу) придатною ціллю. Раніше drop працював лише НА фото, тож у
  // порожню/нову групу нічого не перетягувалось. over.id === containerId →
  // handleDragEnd додає у кінець групи.
  const containerId = GroupContainerId(group.docId);
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({ id: containerId });

  // Видалення секції: порожня — одразу; непорожня — two-tap arm (перший тап
  // «озброює» кнопку червоним + підказка, другий тап у межах 3с видаляє разом з
  // фото). Захищає багатофотний документ від випадкового зносу одним тапом на
  // сенсорному екрані. Авто-роззброєння через 3с.
  const [deleteArmed, setDeleteArmed] = useState(false);
  const armTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(armTimerRef.current), []);
  const hasPhotos = group.pageIndices.length > 0;
  const handleTrashClick = useCallback(() => {
    if (!hasPhotos) { removeGroup(group.docId); return; }
    if (deleteArmed) {
      clearTimeout(armTimerRef.current);
      setDeleteArmed(false);
      removeGroup(group.docId);
      return;
    }
    setDeleteArmed(true);
    clearTimeout(armTimerRef.current);
    armTimerRef.current = setTimeout(() => setDeleteArmed(false), 3000);
  }, [hasPhotos, deleteArmed, removeGroup, group.docId]);

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
          onClick={handleTrashClick}
          aria-label={deleteArmed ? 'Тапніть ще раз, щоб видалити документ' : 'Видалити документ'}
          title={
            deleteArmed
              ? `Тапніть ще раз, щоб видалити документ і ${group.pageIndices.length} фото`
              : (hasPhotos ? 'Видалити документ (разом з фото)' : 'Видалити порожню групу')
          }
          style={deleteArmed ? { color: '#e74c3c' } : undefined}
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
        <div
          ref={setDroppableRef}
          className="dp-image-merge-editor__group-grid image-merge-panel__grid"
          // Підсвічування активної drop-цілі — інлайн (клас dp-* у styles.css поза
          // смугою B). Тонка рамка акцентом, коли курсор над цією групою.
          style={isOver ? {
            outline: '2px dashed var(--color-accent)',
            outlineOffset: '2px',
            borderRadius: 'var(--radius-sm)',
          } : undefined}
        >
          {displayItems.map((item) => (
            <DpSortableItem
              key={item.id}
              docId={group.docId}
              item={item}
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

// ── DpSortableItem: обгортка над спільним RenderItem зі своїм useSortable ───
// item — displayItem (single АБО group) зі спільного buildDisplayItems. Group
// рендериться спільним RenderItem (type:'group') — рамка + заголовок «Дублікати
// (N)» + «Це не дублікати» + члени всередині. Жодного власного групового JSX у DP.
function DpSortableItem({
  docId, item, dndReady, thumbUrls, previewUrls, warningsByIndex, duplicateMembership,
  userRotation, uncertainSet, cropStateByIndex, flatPositions,
  onRemove, onRotate, onToggleCropDisabled,
  onKeepRecommendedDuplicate, onDismissDuplicateGroup, onOpenPopup, onContextMenu,
}) {
  const { useSortable, CSS } = dndReady;
  const sortableId = item.type === 'group'
    ? GroupIdEncode(docId, item.gIdx)
    : ItemIdEncode(docId, item.idx);
  const sortable = useSortable({ id: sortableId });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
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
