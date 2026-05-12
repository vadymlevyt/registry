// ── CROP HELPER ──────────────────────────────────────────────────────────────
// Один сенс: «взяти Blob зображення + прямокутник (у piксельних координатах
// natural image) → повернути новий JPEG Blob тільки з цієї області».
//
// Координати crop в нативних пікселях зображення (НЕ display size), щоб
// crop був стабільним при будь-якому масштабі попапа.
//
// Використовується ImageMergePanel у попапі перегляду коли адвокат обрізає
// фото документа (відрізає стіл навколо). Збережений blob використовується
// замість оригіналу при склейці фінального PDF.

const JPEG_QUALITY = 0.92;

/**
 * Обрізає Blob зображення по pixel rectangle.
 *
 * @param {Blob} blob — вхідне зображення (JPEG/PNG/WEBP)
 * @param {{ x: number, y: number, width: number, height: number }} rect
 *        — pixel координати у natural image space
 * @returns {Promise<Blob>} JPEG Blob тільки з обраної області
 */
export async function cropImageBlob(blob, rect) {
  if (!(blob instanceof Blob)) {
    throw new Error('cropImageBlob: blob має бути Blob');
  }
  if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
    throw new Error('cropImageBlob: rect має валідні width/height');
  }
  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error('cropImageBlob: rect не може бути нульової площі');
  }

  const url = URL.createObjectURL(blob);
  let img;
  try {
    img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('Не вдалося завантажити зображення для обрізки'));
      im.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }

  // Кліп координат у межі natural image (захист від округлень з react-easy-crop)
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  const x = Math.max(0, Math.min(rect.x, nw - 1));
  const y = Math.max(0, Math.min(rect.y, nh - 1));
  const w = Math.max(1, Math.min(rect.width, nw - x));
  const h = Math.max(1, Math.min(rect.height, nh - y));

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w);
  canvas.height = Math.round(h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);

  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (out) => {
        if (out) resolve(out);
        else reject(new Error('Canvas.toBlob повернув null'));
      },
      'image/jpeg',
      JPEG_QUALITY
    );
  });
}

/**
 * Helper для конвертації нормалізованих координат (0..1) у pixel coords.
 * react-easy-crop повертає piксельні координати у onCropComplete як
 * { croppedAreaPixels: { x, y, width, height } } — їх можна передавати напряму
 * у cropImageBlob. Цей хелпер на випадок ручної обрізки через інші джерела.
 */
export function normalizedToPixels(normalized, naturalWidth, naturalHeight) {
  return {
    x: Math.round(normalized.x * naturalWidth),
    y: Math.round(normalized.y * naturalHeight),
    width: Math.round(normalized.width * naturalWidth),
    height: Math.round(normalized.height * naturalHeight),
  };
}
