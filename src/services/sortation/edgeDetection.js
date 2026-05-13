// ── EDGE DETECTION ───────────────────────────────────────────────────────────
// Один сенс: «взяти Blob зображення → повернути pixel rect документа всередині
// фону, або null якщо не вдалося визначити надійно».
//
// Призначення: пасивний UX обрізки в ImageMergePanel. AI визначає межі
// документа на фото (стіл/підлога/руки навколо) і пропонує адвокату — він
// може вимкнути пропозицію якщо неправильна, або відкоригувати рукоятки.
//
// Гібридний алгоритм — каскад від найдешевшого до найточнішого:
//   1) Brightness-based — документ помітно світліший за фон.
//      Швидкий і робастний для типового кейсу (білий папір на темному столі).
//   2) Variance-based — документ — область з текстом (висока варіація).
//      Спрацьовує для тексту на світлому фоні де brightness не дав контрасту.
//   3) Sobel-based — gradient projection. Шукає РІЗКІ переходи на межі
//      документ↔фон. Робить нелінійну фільтрацію щоб не плутатись з текстом.
//
// Результат прийнято коли area між 25% і 99% (нижче — алгоритм помилився,
// вище — нема сенсу пропонувати).

const DOWNSAMPLE_WIDTH = 320;
const PADDING_PCT = 0.012;
const MIN_AREA_FRACTION = 0.25;
const MAX_AREA_FRACTION = 0.99;
const DEBUG = true; // лишається ON поки UX стабілізується

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

  // Luminance (Rec. 601)
  const lum = new Float32Array(dw * dh);
  for (let i = 0, p = 0; p < pixels.length; p += 4, i++) {
    lum[i] = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
  }

  // Row/col стат
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

  const rowBrightnessRange = arrMax(rowMean) - arrMin(rowMean);
  const colBrightnessRange = arrMax(colMean) - arrMin(colMean);

  // Strategy 1: BRIGHTNESS-BASED
  let detected = null;
  let strategyUsed = null;
  if (rowBrightnessRange > 25 && colBrightnessRange > 25) {
    detected = detectByBrightness(rowMean, colMean, dw, dh);
    if (detected) strategyUsed = 'brightness';
  }

  // Strategy 2: VARIANCE-BASED
  if (!detected) {
    detected = detectByVariance(rowStd, colStd, dw, dh);
    if (detected) strategyUsed = 'variance';
  }

  // Strategy 3: SOBEL-BASED — фолбек коли документ і фон схожі за яскравістю
  // і варіація рівномірна. Sobel шукає РІЗКІ переходи, які зазвичай є саме
  // на межі документ/фон.
  if (!detected) {
    detected = detectBySobel(lum, dw, dh);
    if (detected) strategyUsed = 'sobel';
  }

  if (!detected) {
    if (DEBUG) {
      console.log('[edgeDetect]', debugLabel, 'NO detection',
        'rowBrightnessRange=', rowBrightnessRange.toFixed(0),
        'colBrightnessRange=', colBrightnessRange.toFixed(0));
    }
    return null;
  }

  // Padding + scale назад
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
    if (DEBUG) console.log('[edgeDetect]', debugLabel, 'rejected: area too small', areaFraction.toFixed(2), strategyUsed);
    return null;
  }
  if (areaFraction > MAX_AREA_FRACTION) {
    if (DEBUG) console.log('[edgeDetect]', debugLabel, 'rejected: area too large (nothing to crop)', areaFraction.toFixed(2), strategyUsed);
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
  if (DEBUG) {
    console.log('[edgeDetect]', debugLabel, 'PROPOSAL', result,
      'area=', areaFraction.toFixed(2), 'via', strategyUsed);
  }
  return result;
}

// ── Strategies ─────────────────────────────────────────────────────────────

function detectByBrightness(rowMean, colMean, dw, dh) {
  const rowMin = arrMin(rowMean), rowMax = arrMax(rowMean);
  const colMin = arrMin(colMean), colMax = arrMax(colMean);
  const rowThr = rowMin + (rowMax - rowMin) * 0.55;
  const colThr = colMin + (colMax - colMin) * 0.55;
  return boundsAboveThreshold(rowMean, colMean, rowThr, colThr, dw, dh);
}

function detectByVariance(rowStd, colStd, dw, dh) {
  const rowThr = percentile(rowStd, 0.4);
  const colThr = percentile(colStd, 0.4);
  if (rowThr < 1.0 || colThr < 1.0) return null;
  return boundsAboveThreshold(rowStd, colStd, rowThr, colThr, dw, dh);
}

// Sobel: рахуємо |∂I/∂x| + |∂I/∂y| на даунсемплі. Проектуємо на осі.
// Резкі вертикальні переходи (документ/фон стик) проявляються як піки у
// rowGrad/colGrad. Текст всередині документа теж дає gradient — щоб
// відфільтрувати, дивимось на CONTRAST: rowGrad перших і останніх 10% рядків
// (бордюри зображення) має бути значно НИЖЧИЙ за центральні (= документ).
// Якщо так — границі знайдено. Якщо ні — Sobel не допоможе, повертаємо null.
function detectBySobel(lum, dw, dh) {
  const grad = new Float32Array(dw * dh);
  for (let y = 1; y < dh - 1; y++) {
    for (let x = 1; x < dw - 1; x++) {
      const i = y * dw + x;
      const gx = Math.abs(lum[i + 1] - lum[i - 1]);
      const gy = Math.abs(lum[i + dw] - lum[i - dw]);
      grad[i] = gx + gy;
    }
  }

  const rowGrad = new Float32Array(dh);
  for (let y = 0; y < dh; y++) {
    let s = 0;
    const row = y * dw;
    for (let x = 0; x < dw; x++) s += grad[row + x];
    rowGrad[y] = s / dw;
  }
  const colGrad = new Float32Array(dw);
  for (let x = 0; x < dw; x++) {
    let s = 0;
    for (let y = 0; y < dh; y++) s += grad[y * dw + x];
    colGrad[x] = s / dh;
  }

  // Поріг адаптивний: 60% від медіани (низькі рядки = фон без структури)
  const rowMed = percentile(rowGrad, 0.5);
  const colMed = percentile(colGrad, 0.5);
  // Якщо медіана надто низька (рівномірна сцена) — Sobel не дасть нічого
  // цікавого
  if (rowMed < 2 || colMed < 2) return null;
  const rowThr = rowMed * 0.6;
  const colThr = colMed * 0.6;
  return boundsAboveThreshold(rowGrad, colGrad, rowThr, colThr, dw, dh);
}

function boundsAboveThreshold(rowArr, colArr, rowThr, colThr, dw, dh) {
  let top = -1, bottom = -1, left = -1, right = -1;
  for (let y = 0; y < dh; y++) if (rowArr[y] > rowThr) { top = y; break; }
  for (let y = dh - 1; y >= 0; y--) if (rowArr[y] > rowThr) { bottom = y; break; }
  for (let x = 0; x < dw; x++) if (colArr[x] > colThr) { left = x; break; }
  for (let x = dw - 1; x >= 0; x--) if (colArr[x] > colThr) { right = x; break; }
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

// Math.min(...arr) / Math.max(...arr) має ліміт аргументів і повільний для
// великих TypedArrays. Лінійний прохід — швидше і безпечніше.
function arrMin(arr) {
  let m = Infinity;
  for (let i = 0; i < arr.length; i++) if (arr[i] < m) m = arr[i];
  return m;
}
function arrMax(arr) {
  let m = -Infinity;
  for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
  return m;
}
