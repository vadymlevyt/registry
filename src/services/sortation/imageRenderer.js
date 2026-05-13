// ── IMAGE RENDERER — Single Source of Truth для merge-pipeline ─────────────
//
// Одна функція computeRenderedBlob(ctx, opts) яка повертає правильний Blob
// для конкретного фото з урахуванням усіх існуючих трансформацій. ВСІ шляхи
// рендеру (preview thumbnail, popup display, фінальний PDF rebuild) ходять
// через неї.
//
// Регресія до фіксу: preview useEffect і rebuildFromOcrResults мали дублювати
// логіку. Розсинхрон після ✓ Готово: preview гілки cropOverride застосовувала
// тільки userRotation і пропускала autoRotation → фото оберталось у PDF але
// preview залишався у вихідній орієнтації. Унификація прибирає clones — одне
// місце де живе логіка трансформації.
//
// Послідовність:
//   rawFile → optional crop (rect у raw natural coords) → rotation (auto[+user])
//
// processedBlob fast-path:
//   Адвокат використав straighten slider у попапі → canvas через
//   cropper.getCanvas() містить уже cropped + fine rotation + (auto + user
//   at apply moment). Це не можна "відменити" — використовуємо as-is і
//   застосовуємо лише delta користувацького обертання поверх (user_now -
//   baseUserRotation) коли applyUserRotation=true.
//
// Опції:
//   applyUserRotation (default true):
//     true  — запікаємо user rotation у blob (PDF rebuild)
//     false — без user rotation (thumbnail; CSS transform: rotate(user) дає
//             плавну анімацію коли адвокат тапає ↻; blob URL стабільний)
//
//   applyCrop (default true):
//     true  — запікаємо ефективну crop рамку якщо є (PDF rebuild, preview
//             коли crop фізично застосований через ✓ Готово)
//     false — пропускаємо crop (popup display коли потрібен full image для
//             re-edit рамки)
//
// Параметри ctx:
//   idx                   — індекс фото у realFiles
//   realFiles[]
//   detectedOrientations[] — кут auto-rotation per index (0/90/180/270)
//   userRotation Map<idx, deg>
//   processedBlobs Map<idx, { blob, baseUserRotation }>
//   cropOverrides Map<idx, rect>      — рамка яку зберіг адвокат
//   cropProposals Map<idx, rect>      — AI edge detection пропозиція
//   cropDisabled Set<idx>             — адвокат явно вимкнув обрізку
//   cropAppliedSet Set<idx>           — адвокат тапнув ✓ Готово (apply)
//
// Що враховуємо для effectiveRect:
//   1. Якщо ctx.cropDisabled має idx → rect = null
//   2. Інакше override має пріоритет над proposal
//   3. proposal входить лише коли opts.includeProposalRect=true (final PDF
//      апплаїть AI пропозицію навіть якщо адвокат не підтвердив явно — це
//      існуюча поведінка rebuildFromOcrResults; preview і popup НЕ показують
//      proposal як застосований)

import { rotateImageBlob } from './orientationCorrector.js';
import { cropImageBlob } from './cropHelper.js';

const norm = (deg) => ((((Number.isFinite(deg) ? deg : 0) % 360) + 360) % 360);

/**
 * @param {Object} ctx — стан pipeline (див. шапку файлу)
 * @param {Object} [opts]
 * @param {boolean} [opts.applyUserRotation=true]
 * @param {boolean} [opts.applyCrop=true]
 * @param {boolean} [opts.includeProposalRect=false] — append cropProposal якщо
 *   немає override (final PDF; preview/popup лишають false)
 * @returns {Promise<Blob|null>}
 */
export async function computeRenderedBlob(ctx, opts = {}) {
  const {
    idx,
    realFiles,
    detectedOrientations = [],
    userRotation,
    processedBlobs,
    cropOverrides,
    cropProposals,
    cropDisabled,
    cropAppliedSet,
  } = ctx || {};
  const {
    applyUserRotation = true,
    applyCrop = true,
    includeProposalRect = false,
  } = opts;

  if (!Array.isArray(realFiles)) return null;
  const rawFile = realFiles[idx];
  if (!rawFile) return null;

  const autoDeg = norm(detectedOrientations?.[idx]);
  const userDeg = norm(userRotation?.get?.(idx));

  const proc = processedBlobs?.get?.(idx);
  if (proc?.blob instanceof Blob) {
    // processedBlob тримає (auto + user_at_apply + crop + straighten) baked.
    // applyUserRotation=false → CSS показує (user_now - baseUser) delta поверх.
    // applyUserRotation=true → docking з baseUserRotation у Canvas.
    if (!applyUserRotation) return proc.blob;
    const baseUser = norm(proc.baseUserRotation);
    const delta = norm(userDeg - baseUser);
    return delta !== 0 ? await rotateImageBlob(proc.blob, delta) : proc.blob;
  }

  // Визначаємо чи апплаїти crop для цього виклику.
  // Preview thumbnail: тільки якщо cropAppliedSet.has(idx) — інакше "frame
  // тільки" стан (адвокат адаптував рамку але не підтвердив через ✓ Готово).
  // PDF rebuild: caller передає includeProposalRect=true і ми використовуємо
  // override АБО proposal. Preview/popup передають false → лише override
  // (і тільки якщо applied).
  let effectiveRect = null;
  if (applyCrop && !cropDisabled?.has?.(idx)) {
    const override = cropOverrides?.get?.(idx) || null;
    const proposal = cropProposals?.get?.(idx) || null;
    if (override) {
      // Preview шар: показуємо crop лише коли адвокат підтвердив через ✓ Готово.
      // У rebuild (includeProposalRect=true) ми бекдоор: будь-який override
      // вважаємо застосованим (адвокат явно зберіг рамку у попапі).
      if (includeProposalRect || cropAppliedSet?.has?.(idx)) {
        effectiveRect = override;
      }
    } else if (proposal && includeProposalRect) {
      effectiveRect = proposal;
    }
  }

  let blob = rawFile;
  if (effectiveRect) {
    blob = await cropImageBlob(rawFile, effectiveRect);
  }

  const totalDeg = applyUserRotation ? norm(autoDeg + userDeg) : autoDeg;
  if (totalDeg !== 0) {
    blob = await rotateImageBlob(blob, totalDeg);
  }
  return blob;
}

/**
 * Хелпер для обчислення CSS transform значення для thumbnail коли blob
 * запечений без user rotation. Враховує processedBlob baked rotation.
 *
 * Повертає кут CW (degrees) який потрібно додати CSS-ом поверх blob.
 *
 * @param {Object} ctx — те що і у computeRenderedBlob
 * @param {number} idx
 * @returns {number} 0..359
 */
export function userRotationCssDelta(ctx, idx) {
  const userDeg = norm(ctx?.userRotation?.get?.(idx));
  const proc = ctx?.processedBlobs?.get?.(idx);
  if (proc?.blob instanceof Blob) {
    const baseUser = norm(proc.baseUserRotation);
    return norm(userDeg - baseUser);
  }
  return userDeg;
}
