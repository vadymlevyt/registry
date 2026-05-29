// ── ImageEditor · PreviewPopup ───────────────────────────────────────────────
// Full-screen crop editor (Apple Photos/Google Photos UX):
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

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  X, Check, AlertTriangle, RotateCw, Trash2,
  Square as FrameIcon,
} from 'lucide-react';
import { CropperHost } from './CropperHost.jsx';
import { rotateRectCW, rotateRectCCW } from '../../services/imageDocument/geometry.js';

export function PreviewPopup({
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
