// ── ImageMergePanel · CropperHost ────────────────────────────────────────────
// Оболонка над react-advanced-cropper з lazy load.
// Cropper обробляє жести: pinch-zoom, pan, drag handles на 4 кутах + 4 ребрах.
// Free aspect (stencilProps.aspectRatio={undefined}). Повертає coords у
// natural pixel coords ROTATED image space. Ми конвертуємо назовні через
// rotateRectCCW.
//
// Якщо frameVisible=false — рендеримо просто img без cropper для UX «view
// тільки» (адвокат може закрити без обрізки).
//
// Lazy import — react-advanced-cropper ~30KB gzip, не тягнемо у головний bundle.
//
// userRotation і bakedUserRotationRef передаються як props (раніше були
// dangling references на scope PreviewPopup — ReferenceError при re-open
// попапа після ✓ Готово, коли frameVisible=false і виконувалась гілка
// view-only з CSS-rotation delta). Один сенс на prop (правило #11):
// userRotation — поточний кут адвоката (number 0/90/180/270), bakedUserRotationRef
// — кут запечений у displayUrl-blob, потрібен для delta-розрахунку без
// регенерації blob.
//
// Експортовано для regression-тесту (tests/unit/cropperHost.test.jsx).

import { useState, useEffect } from 'react';

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
