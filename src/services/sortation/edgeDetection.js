// ── EDGE DETECTION ───────────────────────────────────────────────────────────
// Один сенс: «взяти Blob зображення → повернути pixel rect документа всередині
// фону, або null якщо не вдалося визначити надійно».
//
// Призначення: пасивний UX обрізки в ImageMergePanel. AI визначає межі
// документа на фото (стіл/підлога/руки навколо) і пропонує адвокату — він
// може вимкнути пропозицію якщо неправильна, або відкоригувати рукоятки.
//
// Алгоритм: row/col variance projection. Документ зазвичай має текст або
// контрастні елементи всередині, фон навколо — більш однорідний. Стандартне
// відхилення яскравості в рядку/колонці = індикатор присутності контенту.
//
// Робимо на ДАУНСЕМПЛІ (≤300px по ширині) бо нам потрібні відносні межі, не
// piксельна точність. Швидкий і не блокує UI.
//
// Повертає координати у natural image space (масштабовано назад до повного
// розміру). Якщо знайдена область < 30% або > 92% площі → null
// (10% = відрізок очевидно неправильний; 92% = майже нічого не обрізаємо).

const DOWNSAMPLE_WIDTH = 300;
// Поріг std deviation відносно глобального медіанного — рядок/колонка
// вважається «контентом» якщо stddev > медіана × MULTIPLIER. Емпірично
// 0.35 дає стабільний результат на фото судових документів.
const VARIANCE_MULTIPLIER = 0.35;
// Скільки відсотків площі (від downsampled) лишити як padding навколо
// знайдених меж. 2% — комфортно щоб не відрізати дрібні елементи з краю.
const PADDING_PCT = 0.02;
// Мінімальна частка площі для валідної пропозиції. Менше — алгоритм скоріш
// за все знайшов випадковий «шум», не справжній документ.
const MIN_AREA_FRACTION = 0.30;
// Максимальна частка площі. Більше — нема сенсу пропонувати crop, документ
// заповнює майже весь кадр.
const MAX_AREA_FRACTION = 0.92;

/**
 * @param {Blob} blob — вхідне зображення (JPEG/PNG/WEBP)
 * @returns {Promise<{x:number,y:number,width:number,height:number}|null>}
 *   pixel rect у natural image space, або null якщо межі не визначені
 *   надійно (фон шумний / документ заповнює кадр / помилка декодування).
 */
export async function detectDocumentEdges(blob) {
  if (!(blob instanceof Blob)) return null;

  let img;
  const url = URL.createObjectURL(blob);
  try {
    img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('image decode'));
      im.src = url;
    });
  } catch {
    URL.revokeObjectURL(url);
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }

  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  if (naturalW < 100 || naturalH < 100) return null;

  const scale = Math.min(1, DOWNSAMPLE_WIDTH / naturalW);
  const dw = Math.max(64, Math.round(naturalW * scale));
  const dh = Math.max(64, Math.round(naturalH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, dw, dh);

  let pixels;
  try {
    pixels = ctx.getImageData(0, 0, dw, dh).data;
  } catch {
    return null;
  }

  // Per-pixel luminance (Rec. 601). Зберігаємо у Float32Array для швидкості.
  const lum = new Float32Array(dw * dh);
  for (let i = 0, p = 0; p < pixels.length; p += 4, i++) {
    lum[i] = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
  }

  const rowStd = new Float32Array(dh);
  for (let y = 0; y < dh; y++) {
    let sum = 0, sumSq = 0;
    const row = y * dw;
    for (let x = 0; x < dw; x++) {
      const v = lum[row + x];
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / dw;
    const variance = Math.max(0, sumSq / dw - mean * mean);
    rowStd[y] = Math.sqrt(variance);
  }

  const colStd = new Float32Array(dw);
  for (let x = 0; x < dw; x++) {
    let sum = 0, sumSq = 0;
    for (let y = 0; y < dh; y++) {
      const v = lum[y * dw + x];
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / dh;
    const variance = Math.max(0, sumSq / dh - mean * mean);
    colStd[x] = Math.sqrt(variance);
  }

  const rowThreshold = median(rowStd) * VARIANCE_MULTIPLIER;
  const colThreshold = median(colStd) * VARIANCE_MULTIPLIER;

  // Якщо всюди фон без структури — медіана буде нульова. Тоді detection
  // безглуздий.
  if (rowThreshold < 0.5 || colThreshold < 0.5) return null;

  let top = -1, bottom = -1;
  for (let y = 0; y < dh; y++) {
    if (rowStd[y] > rowThreshold) { top = y; break; }
  }
  for (let y = dh - 1; y >= 0; y--) {
    if (rowStd[y] > rowThreshold) { bottom = y; break; }
  }

  let left = -1, right = -1;
  for (let x = 0; x < dw; x++) {
    if (colStd[x] > colThreshold) { left = x; break; }
  }
  for (let x = dw - 1; x >= 0; x--) {
    if (colStd[x] > colThreshold) { right = x; break; }
  }

  if (top < 0 || bottom < 0 || left < 0 || right < 0) return null;
  if (bottom <= top || right <= left) return null;

  const padX = Math.round(dw * PADDING_PCT);
  const padY = Math.round(dh * PADDING_PCT);
  const dLeft = Math.max(0, left - padX);
  const dTop = Math.max(0, top - padY);
  const dRight = Math.min(dw - 1, right + padX);
  const dBottom = Math.min(dh - 1, bottom + padY);
  const dWidth = dRight - dLeft + 1;
  const dHeight = dBottom - dTop + 1;

  const areaFraction = (dWidth * dHeight) / (dw * dh);
  if (areaFraction < MIN_AREA_FRACTION || areaFraction > MAX_AREA_FRACTION) {
    return null;
  }

  const sx = naturalW / dw;
  const sy = naturalH / dh;
  return {
    x: Math.round(dLeft * sx),
    y: Math.round(dTop * sy),
    width: Math.round(dWidth * sx),
    height: Math.round(dHeight * sy),
  };
}

function median(arr) {
  if (!arr || arr.length === 0) return 0;
  const sorted = Array.from(arr).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
