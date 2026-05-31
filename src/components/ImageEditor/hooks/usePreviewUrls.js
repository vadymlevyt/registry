// ── ImageEditor · hooks · usePreviewUrls ─────────────────────────────────────
// СПІЛЬНИЙ хук генерації preview-blob URL для сітки image-editor (модалка + DP).
// Винесено дослівно з двох майже-однакових копій (борг #33 / правило #11):
//   ImageMergePanel/index.jsx (~174-253) та DocumentProcessorV2/DpImageMergeEditor.jsx.
//
// ЩО РОБИТЬ: коли для фото змінюється crop/processedBlob/auto-orientation —
// генерує ЗАПЕЧЕНИЙ blob (auto-rotation + applied crop) через unified
// computeRenderedBlob і кладе його URL у previewUrls (Map<origIdx, blobUrl>).
// Сітка показує обрізане/повернуте у thumbnail так само як попап.
//
// USER ROTATION НЕ ЗАПІКАЄТЬСЯ — шарується через CSS transform у Thumbnail
// (плавна анімація 0.3s). Тому userRotation НЕ у deps: зміна повороту не
// регенерує blob (інакше ламає CSS transition). Той самий принцип в обох
// споживачах.
//
// CROP PROPOSALS НЕ У DEPS: proposal-only (без cropAppliedSet) НЕ запікається у
// blob (applyCrop спрацьовує лише коли cropAppliedSet.has(idx)). Тримати
// cropProposals у deps спричиняло ЗАЙВИЙ повторний прогін коли async
// edge-detection дозаповнює proposals — той самий blob генерувався двічі.
// cropProposals у ctx (read-only) лишається — не тригер.
//
// Старі URL — у delayed-revoke черзі (1s), щоб зображення не зникало під час
// React swap'у. На unmount revoke'аються і активні URL, і черга (без leak).

import { useState, useEffect, useRef } from 'react';

export function usePreviewUrls({
  realFiles,
  detectedOrientations = [],
  userRotation,
  processedBlobs,
  cropOverrides,
  cropProposals,
  cropDisabled,
  cropAppliedSet,
}) {
  const [previewUrls, setPreviewUrls] = useState(() => new Map());
  const toRevokeRef = useRef([]);
  // Дзеркало активного previewUrls для unmount-cleanup (React не дає прочитати
  // останній state у cleanup unmount-only ефекту).
  const urlsRef = useRef(new Map());
  useEffect(() => { urlsRef.current = previewUrls; }, [previewUrls]);

  useEffect(() => {
    if (!Array.isArray(realFiles) || realFiles.length === 0) return;

    // Контекст для unified renderer — ОДНЕ місце де живе логіка трансформації
    // (правило #11 — один сенс на «що бачить адвокат»).
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

    // Targets: лише фото з реальною трансформацією на blob-рівні —
    // auto-rotation != 0 АБО processedBlob АБО applied crop. Proposal-only
    // (адвокат ще не підтвердив через ✓ Готово) — preview лишається сирим.
    const targets = new Set();
    for (let i = 0; i < realFiles.length; i++) {
      const autoDeg = Number.isFinite(detectedOrientations[i]) ? detectedOrientations[i] : 0;
      const hasProc = processedBlobs?.has?.(i);
      const hasAppliedCrop = cropAppliedSet?.has?.(i) && cropOverrides?.has?.(i) && !cropDisabled?.has?.(i);
      if (autoDeg !== 0 || hasProc || hasAppliedCrop) targets.add(i);
    }

    let cancelled = false;
    (async () => {
      const { computeRenderedBlob } = await import('../../../services/sortation/imageRenderer.js');
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
          if (blob && blob !== realFiles[idx]) {
            newUrls.set(idx, URL.createObjectURL(blob));
          }
        } catch (e) {
          console.warn('[usePreviewUrls] preview generation failed for idx', idx, e);
        }
      }
      if (cancelled) {
        for (const u of newUrls.values()) { try { URL.revokeObjectURL(u); } catch { /* noop */ } }
        return;
      }
      // Atomic replace — старі URL у delayed-revoke черзі (1s).
      setPreviewUrls((prev) => {
        for (const [, oldUrl] of prev) toRevokeRef.current.push(oldUrl);
        return newUrls;
      });
      setTimeout(() => {
        const toRevoke = toRevokeRef.current;
        toRevokeRef.current = [];
        for (const u of toRevoke) { try { URL.revokeObjectURL(u); } catch { /* noop */ } }
      }, 1000);
    })();
    return () => { cancelled = true; };
    // userRotation і cropProposals свідомо НЕ у deps (див. модульний коментар).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropOverrides, cropDisabled, cropAppliedSet, processedBlobs, realFiles, detectedOrientations]);

  // Unmount-only cleanup: revoke і активні URL з Map'а, і ще-не-revoke'нуті з
  // delayed-черги. Без цього blob URL живуть у пам'яті браузера до закриття
  // вкладки. Деп-масив порожній — спрацьовує саме на unmount.
  useEffect(() => {
    return () => {
      for (const url of urlsRef.current.values()) {
        try { URL.revokeObjectURL(url); } catch { /* noop */ }
      }
      urlsRef.current = new Map();
      for (const url of toRevokeRef.current) {
        try { URL.revokeObjectURL(url); } catch { /* noop */ }
      }
      toRevokeRef.current = [];
    };
  }, []);

  return previewUrls;
}
