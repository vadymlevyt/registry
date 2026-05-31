// ── ImageMergePanel · PreviewView ────────────────────────────────────────────
// Сторінка preview (третя фаза). Оркеструє:
//   - SortableGrid з displayItems (single або group)
//   - Alerts (uncertain orientation, missing pages, duplicates, suspicious, crops)
//   - Форму метаданих (name, category, author, proceeding, date, isKey)
//   - PreviewPopup для full-screen перегляду одного thumbnail
//   - ContextMenu для right-click
//   - Кнопки Назад / Створити PDF
//   - Toggle для діагностики orientation

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X, AlertTriangle, Trash2, Check, ArrowLeft,
  Crop as CropIcon, Copy as CopyIcon,
} from 'lucide-react';
import { Input, Select, Toggle, Button, DatePicker } from '../../UI';
import { ICON_SIZE } from '../../UI/icons.js';
import { CATEGORY_OPTIONS, AUTHOR_OPTIONS } from '../../ImageEditor/constants.js';
import { SortableGrid } from '../../ImageEditor/grid/SortableGrid.jsx';
import { PreviewPopup } from '../../ImageEditor/PreviewPopup.jsx';
import { ContextMenu } from '../../ImageEditor/ContextMenu.jsx';
import {
  buildDuplicateMembership,
  buildDisplayItems,
  flattenDisplayItems,
} from '../../ImageEditor/grid/displayItems.js';

export function PreviewView({
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

  // Мапа origIdx → { groupId, recommended, reason }. Спільна логіка
  // (buildDuplicateMembership) — те саме джерело що DP. Виключає dismissed групи.
  const duplicateMembership = useMemo(
    () => buildDuplicateMembership(
      pipelineResult?.sortResult?.duplicates,
      dismissedDuplicateGroupIds,
    ),
    [pipelineResult?.sortResult?.duplicates, dismissedDuplicateGroupIds],
  );

  // displayItems — плоский orderedIndices у список items, де дублікати йдуть
  // ОДНИМ item-групою (стабільно разом, члени відсортовані за origIdx). Спільна
  // логіка (buildDisplayItems) — те саме джерело що DP.
  const displayItems = useMemo(
    () => buildDisplayItems(
      orderedIndices,
      pipelineResult?.sortResult?.duplicates,
      dismissedDuplicateGroupIds,
    ),
    [orderedIndices, pipelineResult?.sortResult?.duplicates, dismissedDuplicateGroupIds],
  );

  // displayItems → плоский array оригінальних індексів (для drag-and-drop
  // reorder). Спільна логіка (flattenDisplayItems).
  const flattenItems = useCallback((items) => flattenDisplayItems(items), []);

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
