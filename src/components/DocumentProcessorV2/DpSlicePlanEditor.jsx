// ── A7.2 · ЕКРАН РЕДАГУВАННЯ ПЛАНУ НАРІЗКИ (двофазний DP) ────────────────────
// Зона 3 ДО виконання: запропонований Triage план як СТРІЧКА КАРТОК-СТОРІНОК,
// згрупованих по документах (§2.2). Адвокат бачить межі і ЩО рухає:
//   • картка сторінки = перші рядки `page._text` (з session — дешево, миттєво);
//     для сканів — рендер сторінки pdf.js на клік (лінькувато, SlicePagePreview);
//   • межа = роздільник між групами; правка межі = перетягнути картку в сусідню
//     групу (DnD) АБО «Розділити тут» / «Обʼєднати з наступним» (кнопки);
//   • rename + тип (select enum) на документі.
// «Виконати» — ЄДИНА кнопка-гейт → onExecute(editedPlan). До неї на Drive нічого.
//
// ── ЧОМУ НЕ DpImageMergeEditor напряму (Rule of Three) ──────────────────────
// Той самий UX-патерн «картки→групи→перетягування», АЛЕ предмет інший: сторінка
// PDF (fileId+pageNumber, текст) ≠ фото (blob, crop, rotate, дублі). Спільне ще
// не має третього споживача — копіюємо UX-патерн (один DndContext, N
// SortableContext), не машинерію фото. Операції меж — у чистому slicePlanModel.
//
// DnD деградує мʼяко: @dnd-kit вантажиться лінькувато; до завантаження картки
// рендеряться статично, але всі правки доступні кнопками (split/merge/rename/
// type) — UI не блокується очікуванням редактора.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Play, FileText, Scissors, Combine, Trash2, Eye,
} from 'lucide-react';
import { ICON_SIZE } from '../UI/icons.js';
import { Button, Input, Select } from '../UI';
import { toast } from '../../services/toast.js';
import { CATEGORY_OPTIONS } from '../ImageEditor/constants.js';
import { normalizePlan } from '../../services/documentPipeline/stages/triageStage.js';
import {
  pageKey, planToGroups, groupsToPlan,
  renameGroup, setGroupType, splitGroupAt, mergeWithNext, movePage, removeGroup,
} from '../../services/documentPipeline/slicePlanModel.js';
import { SlicePagePreview } from './SlicePagePreview.jsx';

// Item ID кодування для DnD. fileId/docId без "::" (f<ts>_<n>, inbox_<id>) →
// безпечний роздільник. container — drop-ціль усієї групи (вкл. порожню).
function ItemId(docId, fileId, pageNumber) { return `it::${docId}::${fileId}::${pageNumber}`; }
function ContainerId(docId) { return `ct::${docId}`; }
function decodeId(id) {
  let m = /^it::(.+?)::(.+?)::(\d+)$/.exec(id || '');
  if (m) return { kind: 'item', docId: m[1], fileId: m[2], pageNumber: Number(m[3]) };
  m = /^ct::(.+)$/.exec(id || '');
  if (m) return { kind: 'container', docId: m[1] };
  return null;
}

const FIRST_LINES = 4;          // скільки рядків _text показуємо на картці

function firstLines(text, n = FIRST_LINES) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return '';
  return lines.slice(0, n).join('\n');
}

/**
 * @param {object} props
 * @param {object} props.plan — reconstructionPlan з proposeRun
 * @param {(fileId:string, pageNumber:number)=>string} props.getPageText — перші рядки `_text`
 * @param {(fileId:string)=>string|null} props.getFileDriveId — _temp driveId для pdf.js рендеру
 * @param {(fileId:string)=>string} [props.getFileName] — лейбл файла
 * @param {(editedPlan:object)=>Promise<void>} props.onExecute — гейт «Виконати»
 * @param {()=>void} props.onCancel
 * @param {boolean} [props.busy] — виконання триває
 */
export function DpSlicePlanEditor({
  plan, getPageText, getFileDriveId, getFileName,
  onExecute, onCancel, busy = false,
}) {
  const initial = useMemo(() => planToGroups(plan), [plan]);
  const [groups, setGroups] = useState(initial.groups);
  const [unusedPages] = useState(initial.unusedPages);
  const [previewKey, setPreviewKey] = useState(null);   // {fileId,pageNumber} | null

  // ── DnD (lazy @dnd-kit) ───────────────────────────────────────────────────
  const [dndReady, setDndReady] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [core, sortable, utilities] = await Promise.all([
          import('@dnd-kit/core'), import('@dnd-kit/sortable'), import('@dnd-kit/utilities'),
        ]);
        if (cancelled) return;
        setDndReady({
          DndContext: core.DndContext, PointerSensor: core.PointerSensor,
          TouchSensor: core.TouchSensor, useSensor: core.useSensor, useSensors: core.useSensors,
          pointerWithin: core.pointerWithin, rectIntersection: core.rectIntersection,
          useDroppable: core.useDroppable,
          SortableContext: sortable.SortableContext, rectSortingStrategy: sortable.rectSortingStrategy,
          useSortable: sortable.useSortable, CSS: utilities.CSS,
        });
      } catch (e) {
        console.warn('[DpSlicePlanEditor] @dnd-kit lazy load failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Операції (через чистий slicePlanModel) ────────────────────────────────
  const handleRename = useCallback((docId, name) => setGroups((g) => renameGroup(g, docId, name)), []);
  const handleType = useCallback((docId, type) => setGroups((g) => setGroupType(g, docId, type)), []);
  const handleSplit = useCallback((docId, key) => setGroups((g) => splitGroupAt(g, docId, key)), []);
  const handleMerge = useCallback((docId) => setGroups((g) => mergeWithNext(g, docId)), []);
  const handleRemove = useCallback((docId) => setGroups((g) => removeGroup(g, docId)), []);

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const a = decodeId(active.id);
    const o = decodeId(over.id);
    if (!a || a.kind !== 'item' || !o) return;
    const targetDocId = o.docId;
    const beforeKey = o.kind === 'item' ? pageKey(o.fileId, o.pageNumber) : null;
    setGroups((g) => movePage(g, pageKey(a.fileId, a.pageNumber), targetDocId, beforeKey));
  }, []);

  // ── «Виконати» — гейт ─────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const handleExecute = useCallback(async () => {
    if (submitting || busy) return;
    const edited = groupsToPlan(groups, unusedPages);
    // Валідація: реюз normalizePlan/resolveOverlaps (межі у сторінках джерела,
    // без небажаних перекриттів). Невалідне — видимий warning, не тихо (§2.2).
    const normalized = normalizePlan(edited);
    if (normalized.documents.length === 0) {
      toast.error('Порожній план — немає що нарізати. Додайте сторінки у документ.');
      return;
    }
    if (normalized.dedupDropped > 0) {
      toast.warning(`Зведено ${normalized.dedupDropped} перекритих діапазон(и) — ті самі сторінки в кількох документах.`);
    }
    setSubmitting(true);
    try {
      await onExecute(edited);
    } catch (e) {
      console.error('[DpSlicePlanEditor] execute failed:', e);
      toast.error('Не вдалось виконати нарізку', { description: e?.message });
    } finally {
      setSubmitting(false);
    }
  }, [submitting, busy, groups, unusedPages, onExecute]);

  const totalPages = useMemo(() => groups.reduce((s, g) => s + g.pages.length, 0), [groups]);
  const isBusy = submitting || busy;

  const groupSections = groups.map((g, gi) => (
    <SliceGroupSection
      key={g.docId}
      group={g}
      index={gi}
      isLast={gi === groups.length - 1}
      dndReady={dndReady}
      getPageText={getPageText}
      getFileName={getFileName}
      onRename={handleRename}
      onType={handleType}
      onSplit={handleSplit}
      onMerge={handleMerge}
      onRemove={handleRemove}
      onPreview={setPreviewKey}
    />
  ));

  return (
    <div className="dp-slice-editor">
      <div className="dp-image-merge-editor__header">
        <strong>План нарізки — перевірте межі перед виконанням</strong>
        <span className="dpv2-muted">
          {groups.length} {groups.length === 1 ? 'документ' : 'документ(и)'} · {totalPages} стор.
        </span>
      </div>

      <div className="dpv2-muted dp-slice-editor__hint">
        Картка = сторінка джерела (перші рядки тексту). Роздільник між групами —
        межа документа. Перетягніть картку в сусідню групу або скористайтесь
        «Розділити тут» / «Обʼєднати з наступним». До «Виконати» на Drive нічого
        не зберігається.
      </div>

      {dndReady ? (
        <SliceDndZone dndReady={dndReady} onDragEnd={handleDragEnd}>
          {groupSections}
        </SliceDndZone>
      ) : (
        <div className="dp-image-merge-editor__groups">{groupSections}</div>
      )}

      {unusedPages.length > 0 && (
        <div className="dp-slice-editor__unused">
          <div className="dpv2-section-label">Невикористані сторінки ({unusedPages.length})</div>
          {unusedPages.map((u, i) => (
            <div key={i} className="dpv2-list-row">
              <span className="dpv2-grow">Стор. {u.startPage}{u.endPage && u.endPage !== u.startPage ? `-${u.endPage}` : ''}</span>
              <span className="dpv2-list-meta">{u.reason}</span>
            </div>
          ))}
        </div>
      )}

      <div className="dpv2-attention-actions">
        <Button variant="secondary" onClick={onCancel} disabled={isBusy} icon={<ArrowLeft size={ICON_SIZE.sm} />}>
          Скасувати
        </Button>
        <Button
          variant="primary"
          onClick={handleExecute}
          disabled={isBusy || groups.length === 0}
          loading={isBusy}
          icon={<Play size={ICON_SIZE.sm} />}
        >
          {isBusy ? 'Нарізаємо…' : `Виконати: створити ${groups.length} ${groups.length === 1 ? 'документ' : 'документів'}`}
        </Button>
      </div>

      {previewKey && (
        <div
          className="image-editor__progress-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setPreviewKey(null)}
        >
          <div className="dp-slice-editor__preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dp-slice-editor__preview-head">
              <strong>Сторінка {previewKey.pageNumber}</strong>
              <button className="dpv2-iconbtn" onClick={() => setPreviewKey(null)} aria-label="Закрити">✕</button>
            </div>
            <SlicePagePreview driveId={getFileDriveId?.(previewKey.fileId) || null} pageNumber={previewKey.pageNumber} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── DnD-зона: один DndContext, collision як у DpImageMergeEditor ─────────────
function SliceDndZone({ dndReady, onDragEnd, children }) {
  const {
    DndContext, PointerSensor, TouchSensor, useSensor, useSensors,
    pointerWithin, rectIntersection,
  } = dndReady;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );
  const collisionDetection = useCallback((args) => {
    const pointer = pointerWithin(args);
    const base = pointer.length > 0 ? pointer : rectIntersection(args);
    const items = base.filter((c) => !String(c.id).startsWith('ct::'));
    return items.length > 0 ? items : base;
  }, [pointerWithin, rectIntersection]);

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={onDragEnd}>
      <div className="dp-image-merge-editor__groups">{children}</div>
    </DndContext>
  );
}

// ── Секція документа: форма (назва/тип) + стрічка карток-сторінок ────────────
function SliceGroupSection({
  group, index, isLast, dndReady, getPageText, getFileName,
  onRename, onType, onSplit, onMerge, onRemove, onPreview,
}) {
  const itemIds = group.pages.map((p) => ItemId(group.docId, p.fileId, p.pageNumber));
  const containerId = ContainerId(group.docId);

  const droppable = dndReady?.useDroppable
    ? dndReady.useDroppable({ id: containerId })
    : { setNodeRef: undefined, isOver: false };

  const grid = (
    <div
      ref={droppable.setNodeRef}
      className="dp-slice-editor__strip"
      style={droppable.isOver ? {
        outline: '2px dashed var(--color-accent)', outlineOffset: '2px', borderRadius: 'var(--radius-sm)',
      } : undefined}
    >
      {group.pages.map((p, pi) => (
        <SlicePageCard
          key={pageKey(p.fileId, p.pageNumber)}
          docId={group.docId}
          page={p}
          canSplit={pi > 0}
          dndReady={dndReady}
          text={getPageText?.(p.fileId, p.pageNumber) || ''}
          fileLabel={getFileName?.(p.fileId) || null}
          onSplit={() => onSplit(group.docId, pageKey(p.fileId, p.pageNumber))}
          onPreview={() => onPreview({ fileId: p.fileId, pageNumber: p.pageNumber })}
        />
      ))}
      {group.pages.length === 0 && (
        <div className="dpv2-muted dp-image-merge-editor__group-empty">Перетягніть сторінки сюди</div>
      )}
    </div>
  );

  return (
    <section className="dp-image-merge-editor__group">
      <div className="dp-image-merge-editor__group-header">
        <span className="dp-image-merge-editor__group-title">
          Документ {index + 1} · {group.pages.length} {group.pages.length === 1 ? 'стор.' : 'стор.'}
        </span>
        <span className="dp-slice-editor__group-actions">
          {!isLast && (
            <Button variant="ghost" size="sm" icon={<Combine size={ICON_SIZE.sm} />} onClick={() => onMerge(group.docId)} title="Обʼєднати з наступним документом">
              Обʼєднати з наступним
            </Button>
          )}
          <button className="dpv2-iconbtn" onClick={() => onRemove(group.docId)} aria-label="Видалити документ" title="Видалити документ (сторінки стануть невикористаними)">
            <Trash2 size={ICON_SIZE.sm} />
          </button>
        </span>
      </div>

      <div className="dp-image-merge-editor__group-form">
        <Input
          label="Назва документа"
          value={group.name}
          onChange={(v) => onRename(group.docId, v)}
          placeholder="Напр. Позовна заява"
        />
        <Select
          label="Тип"
          value={group.type}
          onChange={(v) => onType(group.docId, v)}
          options={CATEGORY_OPTIONS}
          placeholder="Оберіть тип"
        />
      </div>

      {dndReady?.SortableContext ? (
        <dndReady.SortableContext items={itemIds} strategy={dndReady.rectSortingStrategy}>
          {grid}
        </dndReady.SortableContext>
      ) : grid}
    </section>
  );
}

// ── Картка сторінки ─────────────────────────────────────────────────────────
function SlicePageCard({
  docId, page, canSplit, dndReady, text, fileLabel, onSplit, onPreview,
}) {
  const sortableId = ItemId(docId, page.fileId, page.pageNumber);
  const sortable = dndReady?.useSortable ? dndReady.useSortable({ id: sortableId }) : null;
  const style = sortable
    ? { transform: dndReady.CSS.Transform.toString(sortable.transform), transition: sortable.transition }
    : undefined;

  return (
    <div
      ref={sortable?.setNodeRef}
      style={style}
      className={`dp-slice-editor__card${sortable?.isDragging ? ' dp-slice-editor__card--dragging' : ''}`}
    >
      <div className="dp-slice-editor__card-head" {...(sortable?.listeners || {})} {...(sortable?.attributes || {})}>
        <FileText size={ICON_SIZE.sm} />
        <span className="dp-slice-editor__card-page">стор. {page.pageNumber}</span>
        {fileLabel && <span className="dp-slice-editor__card-file" title={fileLabel}>{fileLabel}</span>}
      </div>
      <div className="dp-slice-editor__card-text">
        {text ? firstLines(text) : <span className="dpv2-muted">текст не розпізнано</span>}
      </div>
      <div className="dp-slice-editor__card-actions">
        <button className="dp-slice-editor__card-btn" onClick={onPreview} title="Показати сторінку">
          <Eye size={ICON_SIZE.sm} /> Сторінка
        </button>
        {canSplit && (
          <button className="dp-slice-editor__card-btn" onClick={onSplit} title="Почати новий документ з цієї сторінки">
            <Scissors size={ICON_SIZE.sm} /> Розділити тут
          </button>
        )}
      </div>
    </div>
  );
}
