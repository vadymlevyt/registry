// ── EDGE DETECTION ───────────────────────────────────────────────────────────
// Один сенс: «взяти Blob зображення → повернути pixel rect документа всередині
// фону, або null якщо не вдалося визначити надійно».
//
// Призначення: пасивний UX обрізки в ImageMergePanel. AI визначає межі
// документа на фото (стіл/підлога/руки навколо) і пропонує адвокату — він
// може вимкнути пропозицію якщо неправильна, або відкоригувати рукоятки.
//
// Гібридний алгоритм:
//   1) Brightness-based: документ — світла область на темнішому фоні
//      (типовий випадок: біле A4 на дерев'яному столі). Швидкий і робастний.
//   2) Variance-based fallback: документ — область з текстом (висока варіація
//      яскравості). Спрацьовує для тексту на світлому фоні.
//
// Робимо на ДАУНСЕМПЛІ (≤300px по ширині) бо нам потрібні відносні межі.
//
// Повертає координати у natural image space. null коли:
// — не вдалося декодувати зображення
// — знайдена область < 25% площі (явно неправильно)
// — знайдена область > 97% площі (нема сенсу пропонувати, документ заповнює кадр)

const DOWNSAMPLE_WIDTH = 300;
const PADDING_PCT = 0.015;
const MIN_AREA_FRACTION = 0.25;
const MAX_AREA_FRACTION = 0.97;
// Включити для діагностики у браузерній консолі. Не лишати true у production
// бо для 30 фото буде 30 рядків логів.
const DEBUG = true;

/**
 * @param {Blob} blob — вхідне зображення (JPEG/PNG/WEBP)
 * @param {string} [debugLabel] — лейбл для логів (імʼя файлу)
 * @returns {Promise<{x:number,y:number,width:number,height:number}|null>}
 */
export async function detectDocumentEdges(blob, debugLabel = '') {
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
  } catch (e) {
    URL.revokeObjectURL(url);
    if (DEBUG) console.warn('[edgeDetect]', debugLabel, 'image decode failed:', e);
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }

  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  if (naturalW < 100 || naturalH < 100) {
    if (DEBUG) console.warn('[edgeDetect]', debugLabel, 'image too small:', naturalW, naturalH);
    return null;
  }

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
  } catch (e) {
    if (DEBUG) console.warn('[edgeDetect]', debugLabel, 'getImageData failed:', e);
    return null;
  }

  // Per-pixel luminance (Rec. 601).
  const lum = new Float32Array(dw * dh);
  for (let i = 0, p = 0; p < pixels.length; p += 4, i++) {
    lum[i] = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
  }

  // Row/col статистика
  const rowMean = new Float32Array(dh);
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
    rowMean[y] = mean;
    rowStd[y] = Math.sqrt(Math.max(0, sumSq / dw - mean * mean));
  }

  const colMean = new Float32Array(dw);
  const colStd = new Float32Array(dw);
  for (let x = 0; x < dw; x++) {
    let sum = 0, sumSq = 0;
    for (let y = 0; y < dh; y++) {
      const v = lum[y * dw + x];
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / dh;
    colMean[x] = mean;
    colStd[x] = Math.sqrt(Math.max(0, sumSq / dh - mean * mean));
  }

  // Strategy 1: BRIGHTNESS-BASED
  // Документ зазвичай світліший за фон. Якщо є чіткий контраст яскравості
  // (range > 25 з 255), використовуємо brightness як основний сигнал.
  const rowBrightnessRange = Math.max(...rowMean) - Math.min(...rowMean);
  const colBrightnessRange = Math.max(...colMean) - Math.min(...colMean);

  let detected = null;
  if (rowBrightnessRange > 25 && colBrightnessRange > 25) {
    detected = detectByBrightness(rowMean, colMean, dw, dh);
    if (DEBUG && detected) {
      console.log('[edgeDetect]', debugLabel, 'brightness OK', detected, 'range=', rowBrightnessRange.toFixed(0), colBrightnessRange.toFixed(0));
    }
  }

  // Strategy 2: VARIANCE-BASED fallback
  if (!detected) {
    detected = detectByVariance(rowStd, colStd, dw, dh);
    if (DEBUG && detected) {
      console.log('[edgeDetect]', debugLabel, 'variance OK', detected);
    }
  }

  if (!detected) {
    if (DEBUG) {
      console.log('[edgeDetect]', debugLabel, 'NO detection: brightnessRange=',
        rowBrightnessRange.toFixed(0), colBrightnessRange.toFixed(0));
    }
    return null;
  }

  // Padding + scale назад до natural
  const padX = Math.round(dw * PADDING_PCT);
  const padY = Math.round(dh * PADDING_PCT);
  const dLeft = Math.max(0, detected.left - padX);
  const dTop = Math.max(0, detected.top - padY);
  const dRight = Math.min(dw - 1, detected.right + padX);
  const dBottom = Math.min(dh - 1, detected.bottom + padY);
  const dWidth = dRight - dLeft + 1;
  const dHeight = dBottom - dTop + 1;

  const areaFraction = (dWidth * dHeight) / (dw * dh);
  if (areaFraction < MIN_AREA_FRACTION) {
    if (DEBUG) console.log('[edgeDetect]', debugLabel, 'rejected: area too small', areaFraction.toFixed(2));
    return null;
  }
  if (areaFraction > MAX_AREA_FRACTION) {
    if (DEBUG) console.log('[edgeDetect]', debugLabel, 'rejected: area too large (nothing to crop)', areaFraction.toFixed(2));
    return null;
  }

  const sx = naturalW / dw;
  const sy = naturalH / dh;
  const result = {
    x: Math.round(dLeft * sx),
    y: Math.round(dTop * sy),
    width: Math.round(dWidth * sx),
    height: Math.round(dHeight * sy),
  };
  if (DEBUG) console.log('[edgeDetect]', debugLabel, 'PROPOSAL', result, 'area=', areaFraction.toFixed(2));
  return result;
}

// Знайти діапазон рядків/колонок з яскравістю > порогу (порог = 60% від
// діапазону між min і max). Працює коли документ помітно світліший за фон.
function detectByBrightness(rowMean, colMean, dw, dh) {
  const rowMin = Math.min(...rowMean), rowMax = Math.max(...rowMean);
  const colMin = Math.min(...colMean), colMax = Math.max(...colMean);
  // Поріг між фоном (низьке) і документом (високе). 0.55 — близько до midpoint
  // зміщене у бік документа щоб слабкий шум не зачепило.
  const rowThr = rowMin + (rowMax - rowMin) * 0.55;
  const colThr = colMin + (colMax - colMin) * 0.55;

  let top = -1, bottom = -1, left = -1, right = -1;
  for (let y = 0; y < dh; y++) if (rowMean[y] > rowThr) { top = y; break; }
  for (let y = dh - 1; y >= 0; y--) if (rowMean[y] > rowThr) { bottom = y; break; }
  for (let x = 0; x < dw; x++) if (colMean[x] > colThr) { left = x; break; }
  for (let x = dw - 1; x >= 0; x--) if (colMean[x] > colThr) { right = x; break; }

  if (top < 0 || bottom < 0 || left < 0 || right < 0) return null;
  if (bottom <= top || right <= left) return null;
  return { top, bottom, left, right };
}

// Знайти діапазон рядків/колонок з варіацією > порогу (= з текстом / структурою).
// Використовується коли brightness-based не дав чіткого результату.
function detectByVariance(rowStd, colStd, dw, dh) {
  const rowThr = percentile(rowStd, 0.4); // 40th percentile — фон зазвичай нижче
  const colThr = percentile(colStd, 0.4);
  if (rowThr < 1.0 || colThr < 1.0) return null;

  let top = -1, bottom = -1, left = -1, right = -1;
  for (let y = 0; y < dh; y++) if (rowStd[y] > rowThr) { top = y; break; }
  for (let y = dh - 1; y >= 0; y--) if (rowStd[y] > rowThr) { bottom = y; break; }
  for (let x = 0; x < dw; x++) if (colStd[x] > colThr) { left = x; break; }
  for (let x = dw - 1; x >= 0; x--) if (colStd[x] > colThr) { right = x; break; }

  if (top < 0 || bottom < 0 || left < 0 || right < 0) return null;
  if (bottom <= top || right <= left) return null;
  return { top, bottom, left, right };
}

function percentile(arr, p) {
  if (!arr || arr.length === 0) return 0;
  const sorted = Array.from(arr).sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}
