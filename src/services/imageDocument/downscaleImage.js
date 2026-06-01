// ── DOWNSCALE IMAGE ──────────────────────────────────────────────────────────
// Зменшує РОЗДІЛЬНІСТЬ фото перед OCR і збіркою PDF, щоб збити пік памʼяті
// браузера на важких пакетах. Фото з телефона ~12 МП (4032×3024): розпакований
// растр у RAM = W×H×4 байти ≈ 48 МБ кожне — головний тиск на памʼять. Після
// downscale до ~2400px по довшій стороні: ~12 МБ растр, файл 2.5 МБ → ~300-600 КБ.
//
// PREMISE (TASK image_downscale_blob_hygiene): фото — викидна сировина, не
// оригінал. «Оригінал» для Legal BMS — оброблений PDF у 01_ОРИГІНАЛИ. Тому
// downscale до роздільності, достатньої для OCR і читабельного PDF, нічого
// цінного не втрачає.
//
// Один сенс: «взяти Blob зображення → повернути Blob тієї ж картинки,
// зменшеної так, щоб довша сторона ≤ maxDim, з upright-пікселями (EXIF-
// орієнтація врахована при декодуванні); або ТОЙ САМИЙ Blob якщо зменшувати
// нічого (вже ≤ maxDim по обох сторонах)».
//
// GUARD ЗА РОЗДІЛЬНІСТЮ (пікселі), НЕ за вагою КБ: тиск на памʼять = W×H×4,
// незалежно від ваги JPEG. «Легкий» (600 КБ) але hi-res (4032×3024) кадр у RAM
// = ~48 МБ і його ТРЕБА зменшити; реально мала за пікселями картинка
// (1500×1100) пропускається (no-op) навіть якщо файл «важкий».
//
// EXIF-ОРІЄНТАЦІЯ: перемальовка в canvas скидає EXIF-тег. Щоб після redraw
// фото не «лягло боком», декодуємо через createImageBitmap з
// imageOrientation:'from-image' — браузер віддає вже upright-бітмап (усі 8
// EXIF-орієнтацій, включно з дзеркальними), незалежно від тега. Це знімає
// ризик подвійного повороту (ручне множення кутів + авто-орієнтація drawImage
// дало б подвійний оберт). Подальший крок orientation у prepareImagesForMerge
// працює на однорідній upright-базі: OCR теж бачить upright → PAGE_UP → 0°.
// Малі (no-op) фото повертаються незмінними з EXIF-тегом — їх орієнтацію
// доводить крок 3 як раніше.

const DEFAULT_MAX_DIM = 2400; // довша сторона, px (~170 DPI для A4 — DocAI читає без проблем)
const DEFAULT_QUALITY = 0.82; // JPEG quality для перекодованого (зменшеного) кадру

/**
 * Декодує Blob у джерело для drawImage з upright-пікселями (EXIF враховано).
 * Основний шлях — createImageBitmap({imageOrientation:'from-image'}); fallback
 * на <img> (evergreen-браузери авто-орієнтують drawImage за дефолтом
 * image-orientation:from-image).
 *
 * @param {Blob} blob
 * @returns {Promise<ImageBitmap|HTMLImageElement>}
 */
async function decodeUprightSource(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      // Деякі движки не приймають options dict — пробуємо без нього.
      try {
        return await createImageBitmap(blob);
      } catch {
        /* падаємо у <img> fallback нижче */
      }
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('downscaleImage: не вдалося декодувати зображення'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sourceDimensions(src) {
  // ImageBitmap: width/height. HTMLImageElement: naturalWidth/Height (з fallback).
  const w = Number(src?.naturalWidth || src?.width || 0);
  const h = Number(src?.naturalHeight || src?.height || 0);
  return { w, h };
}

/**
 * Зменшує роздільність зображення до maxDim по довшій стороні, зберігаючи
 * пропорції. Якщо обидві сторони вже ≤ maxDim — повертає вхідний Blob як є
 * (no-op, без перекодування → нуль втрати якості/CPU, EXIF-тег збережено).
 *
 * @param {Blob} blob — вхідне зображення (очікується JPEG/PNG після HEIC→JPEG)
 * @param {{ maxDim?: number, quality?: number }} [options]
 *   maxDim — гранична довша сторона у пікселях (default 2400).
 *   quality — JPEG quality для зменшеного кадру (default 0.82).
 * @returns {Promise<Blob>} — зменшений JPEG Blob, або вхідний blob при no-op
 *   / запобіжниках (не вдалось виміряти, результат не легший за оригінал).
 */
export async function downscaleImage(blob, options = {}) {
  if (!(blob instanceof Blob)) {
    throw new Error('downscaleImage: blob має бути Blob');
  }
  const maxDim = Number.isFinite(options.maxDim) && options.maxDim > 0 ? options.maxDim : DEFAULT_MAX_DIM;
  const quality = Number.isFinite(options.quality) ? options.quality : DEFAULT_QUALITY;

  const source = await decodeUprightSource(blob);
  const { w: srcW, h: srcH } = sourceDimensions(source);

  // Не змогли виміряти роздільність — лишаємо оригінал (no-op).
  if (!(srcW > 0) || !(srcH > 0)) {
    if (typeof source.close === 'function') source.close();
    return blob;
  }

  // GUARD за роздільністю: вже ≤ maxDim по обох сторонах → no-op.
  if (srcW <= maxDim && srcH <= maxDim) {
    if (typeof source.close === 'function') source.close();
    return blob;
  }

  const scale = maxDim / Math.max(srcW, srcH);
  const dstW = Math.max(1, Math.round(srcW * scale));
  const dstH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, dstW, dstH);
  if (typeof source.close === 'function') source.close();

  const out = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('downscaleImage: canvas.toBlob повернув null'));
      },
      'image/jpeg',
      quality,
    );
  });

  // Запобіжник: якщо зменшений blob раптом ≥ оригіналу (рідко — уже малий або
  // вже сильно стиснений) — лишаємо оригінал.
  if (out.size >= blob.size) return blob;
  return out;
}

// Експорт для тестів
export const __test__ = {
  DEFAULT_MAX_DIM,
  DEFAULT_QUALITY,
  decodeUprightSource,
  sourceDimensions,
};
