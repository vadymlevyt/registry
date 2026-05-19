// ── Ф3 · IMAGE-MERGE RENDERER (виконавець route image_merge) ────────────────
// Композиція ЛИШЕ наявних модулів (нуль винаходження, CLAUDE.md §13:
// "переюз sortation/*, НЕ відроджувати TASK B"):
//   orientationCorrector (EXIF → авто-кут) → imageToPdf (1 фото = 1 стор.)
//   → workerClient.mergePdf (склейка у багатосторінковий PDF).
// Сирі байти фото доступні у PERSIST бо streamingExecutor тримає оригінал у
// _temp (orig_<fileId>, originalMime збережено) — EXIF ще на місці.
// Рішення адвоката Ф3: АВТО-поворот; crop/ручний порядок — propose→confirm
// UI (Ф4). Тому resolveOrientation БЕЗ docAiPage (EXIF + геометрія), crop НЕ
// застосовується. Порядок сторінок = порядок fragments плану Triage.
//
// Best-effort orientation: будь-яка помилка визначення кута → ембедимо фото
// як є (краще документ без авто-повороту ніж втрачений документ — філософія
// ingest не блокуємо). runInWorker ін'єктується (чистий seam).

import { readExifOrientation, getImageDimensions, resolveOrientation, rotateImageBlob } from './orientationCorrector.js';
import { imageToPdf } from '../converter/imageToPdf.js';

function toFileLike(blob, name) {
  if (typeof File !== 'undefined') {
    try { return new File([blob], name, { type: blob.type || 'image/jpeg' }); } catch { /* fallthrough */ }
  }
  return { name, type: blob.type || 'image/jpeg', size: blob.size || 0, arrayBuffer: () => blob.arrayBuffer() };
}

/**
 * @param {object} args
 * @param {Array<{bytes:ArrayBuffer|Uint8Array, mime?:string, name?:string}>} args.images
 *        — джерела у порядку плану Triage.
 * @param {Function} args.runInWorker — workerClient.runInWorker (mergePdf).
 * @returns {Promise<Uint8Array|null>} склеєний PDF або null якщо нема сторінок.
 */
export async function renderImageMergeToPdf({ images = [], runInWorker } = {}) {
  const pageBuffers = [];
  for (const img of images) {
    const u8 = img.bytes instanceof Uint8Array ? img.bytes : new Uint8Array(img.bytes || []);
    if (u8.byteLength === 0) continue;
    const blob = new Blob([u8], { type: img.mime || 'image/jpeg' });
    let toEmbed = blob;
    try {
      const exifResult = await readExifOrientation(blob);
      const imageDimensions = await getImageDimensions(blob);
      const r = resolveOrientation({ exifResult, docAiPage: null, imageDimensions, fileName: img.name || '' });
      const deg = r?.degrees || 0;
      if (deg) toEmbed = await rotateImageBlob(blob, deg);
    } catch { /* orientation best-effort — ембедимо як є */ }
    const { pdfBlob } = await imageToPdf(toFileLike(toEmbed, img.name || 'image.jpg'), {});
    if (pdfBlob) pageBuffers.push(await pdfBlob.arrayBuffer());
  }
  if (pageBuffers.length === 0) return null;
  if (pageBuffers.length === 1) return new Uint8Array(pageBuffers[0]);
  const { buffer } = await runInWorker('mergePdf', { buffers: pageBuffers });
  return new Uint8Array(buffer);
}
