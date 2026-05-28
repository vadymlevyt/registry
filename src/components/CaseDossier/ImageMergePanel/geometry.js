// ── ImageMergePanel · geometry helpers ───────────────────────────────────────
// Конверсії crop rect між raw natural image space і rotated image space.
// Без React, чисті функції.

// rotateRectCW: rect (x,y,w,h) у (natW × natH) → новий rect у (rotated dims).
// 90: (natH - y - h, x, h, w) у (natH × natW) space.
// 180: (natW - x - w, natH - y - h, w, h) у (natW × natH).
// 270: (y, natW - x - w, h, w) у (natH × natW).
export function rotateRectCW(rect, natW, natH, deg) {
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
export function rotateRectCCW(rotatedRect, natW, natH, deg) {
  const a = ((deg % 360) + 360) % 360;
  if (a === 0) return { ...rotatedRect };
  // Rotated dims:
  const rotW = (a === 90 || a === 270) ? natH : natW;
  const rotH = (a === 90 || a === 270) ? natW : natH;
  return rotateRectCW(rotatedRect, rotW, rotH, 360 - a);
}
