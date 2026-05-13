// ── IMAGE → PDF ──────────────────────────────────────────────────────────────
// Конвертує одне зображення (JPG/PNG/HEIC/WEBP) у PDF Blob.
//
// Pipeline:
//   1. Якщо HEIC — pre-convert через heicToJpeg
//   2. Завантажити image у HTMLImageElement (через blob URL). Fallback на
//      createImageBitmap якщо HTMLImage не справляється (рідкісні progressive
//      JPEG corner cases на деяких Android-браузерах).
//   3. Обрати орієнтацію A4 за пропорцією зображення (portrait/landscape)
//   4. Canvas → JPEG dataURL (RGB, quality 0.92 — кольори зберігаються).
//   5. jsPDF додає JPEG dataURL у A4 PDF з fit-масштабом.
//   6. Cleanup blob URL у finally (раніше revoke виконувався тільки на
//      happy-path, при помилці blob URL leak'ився).
//
// Контракт результату:
//   { pdfBlob: Blob, warnings: string[] }
//
// КОЛЬОРИ: канвас з'являється у sRGB режимі за замовчуванням, ctx.drawImage
// копіює пікселі 1:1 включно з усіма каналами (R/G/B). canvas.toDataURL
// 'image/jpeg' зберігає 3 канали (без альфа). Жодного grayscale-конвертування
// у цьому пайплайні немає — адвокат бачить точно ту саму кольорову картинку
// яку завантажив, тільки запаковану у PDF контейнер.

import { heicToJpeg } from './heicToJpeg.js';

// A4 розміри у мм
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const A4_MARGIN_MM = 10; // 1см поля з усіх сторін
const PX_TO_MM = 0.264583; // 1px ≈ 0.264583 мм (72 dpi)

// Мінімальний прийнятний розмір PDF з зображенням ~A4. PDF-заголовок + одна
// сторінка без image — ~1-2KB. Зображення JPEG quality 0.92 будь-якого
// розумного розміру дає принаймні 20-50KB. Все що менше 4KB — підозра що
// addImage тихо провалився.
const MIN_PDF_BYTES = 4 * 1024;

function isHeic(file) {
  const name = (file?.name || '').toLowerCase();
  const mime = (file?.type || '').toLowerCase();
  return mime === 'image/heic' || mime === 'image/heif' || /\.heic$/i.test(name);
}

// Завантаження HTMLImage з fallback на createImageBitmap. HTMLImage реалізація
// у деяких Chrome для Android має edge cases з progressive JPEG (фото з
// Samsung Galaxy камер) — повертає resolve але img.naturalWidth=0, або
// resolve до того як ПОВНІ pixel data доступні (canvas.drawImage потім
// малює порожній/частковий image).
//
// Тому послідовність:
//   1. Image.src = blobUrl
//   2. await img.decode() якщо доступно — стандартний API який резолвиться
//      коли image ПОВНІСТЮ декодована (не просто завантажена). Це закриває
//      progressive JPEG race коли onload firing до завершення decoding.
//   3. Якщо decode() не підтримує — fallback на onload event listener.
//   4. Перевірка naturalWidth > 0 після всього — sanity gate.
//   5. Якщо все ламається — createImageBitmap fallback (працює напряму з Blob,
//      decode у воркері, надійніше для нестандартних JPEG варіантів).
async function loadImageFromBlob(blob, blobUrl) {
  try {
    const im = new Image();
    im.src = blobUrl;
    // img.decode() (Chromium-based, Safari 16+) — резолвиться коли pixel data
    // повністю готова. Без цього на progressive JPEG canvas.drawImage може
    // намалювати порожнє/часткове зображення → PDF з порожньою сторінкою.
    if (typeof im.decode === 'function') {
      try {
        await im.decode();
      } catch (decodeErr) {
        // decode() може throw 'EncodingError' для нестандартних JPEG;
        // fallback на onload patternу.
        await new Promise((resolve, reject) => {
          if (im.complete && (im.naturalWidth || im.width) > 0) return resolve();
          im.onload = resolve;
          im.onerror = () => reject(new Error('HTMLImage onerror after decode fail'));
        });
      }
    } else {
      // Старі браузери без decode() — чекаємо onload.
      await new Promise((resolve, reject) => {
        if (im.complete && (im.naturalWidth || im.width) > 0) return resolve();
        im.onload = resolve;
        im.onerror = () => reject(new Error('HTMLImage onerror'));
      });
    }
    const w = im.naturalWidth || im.width;
    const h = im.naturalHeight || im.height;
    if (!(w > 0 && h > 0)) {
      throw new Error(`HTMLImage завантажено але розміри невалідні (${w}×${h})`);
    }
    return { source: im, width: w, height: h };
  } catch (htmlImageErr) {
    // Fallback: createImageBitmap працює напряму з Blob і обробляє більше
    // форматів/варіантів JPEG. Доступний у всіх сучасних браузерах.
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(blob);
        return { source: bitmap, width: bitmap.width, height: bitmap.height };
      } catch (bitmapErr) {
        throw new Error(
          `Не вдалось завантажити зображення: HTMLImage="${htmlImageErr.message}", createImageBitmap="${bitmapErr.message}"`
        );
      }
    }
    throw new Error(`Не вдалось завантажити зображення: ${htmlImageErr.message}`);
  }
}

export async function imageToPdf(file, context = {}) {
  const warnings = [];
  let workingFile = file;

  // 1. HEIC → JPEG (iPhone фото)
  if (isHeic(file)) {
    try {
      const conv = await heicToJpeg(file, context);
      workingFile = conv.jpegFile;
      warnings.push('HEIC конвертовано у JPEG');
    } catch (e) {
      throw new Error(`HEIC → JPEG конвертація провалилась: ${e?.message || e}`);
    }
  }

  // 2. Завантажити зображення (img або ImageBitmap)
  const blobUrl = URL.createObjectURL(workingFile);
  let loaded;
  try {
    try {
      loaded = await loadImageFromBlob(workingFile, blobUrl);
    } catch (e) {
      throw new Error(`Не вдалось декодувати зображення (${workingFile.type || 'unknown'}): ${e?.message || e}`);
    }
    const { source, width, height } = loaded;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error(`Невалідні розміри зображення: ${width}×${height}`);
    }

    // 3. Орієнтація PDF — за пропорцією
    const orientation = width > height ? 'landscape' : 'portrait';
    const pageW = orientation === 'landscape' ? A4_HEIGHT_MM : A4_WIDTH_MM;
    const pageH = orientation === 'landscape' ? A4_WIDTH_MM : A4_HEIGHT_MM;
    const usableW = pageW - 2 * A4_MARGIN_MM;
    const usableH = pageH - 2 * A4_MARGIN_MM;

    const imgWmm = width * PX_TO_MM;
    const imgHmm = height * PX_TO_MM;
    const ratio = Math.min(usableW / imgWmm, usableH / imgHmm);
    const drawW = imgWmm * ratio;
    const drawH = imgHmm * ratio;
    const offsetX = (pageW - drawW) / 2;
    const offsetY = (pageH - drawH) / 2;

    // 4. Канвас → JPEG dataURL (RGB, без альфа). Жодного grayscale —
    // ctx.drawImage копіює всі канали, toDataURL зберігає кольори оригіналу.
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context недоступний');
    }
    try {
      ctx.drawImage(source, 0, 0);
    } catch (e) {
      throw new Error(`Canvas.drawImage провалився: ${e?.message || e}`);
    }
    // ImageBitmap після використання краще close — звільнити GPU memory.
    if (source && typeof source.close === 'function') {
      try { source.close(); } catch {}
    }

    let dataUrl;
    try {
      dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    } catch (e) {
      throw new Error(`Canvas.toDataURL провалився: ${e?.message || e}`);
    }
    if (!dataUrl || !dataUrl.startsWith('data:image/jpeg')) {
      throw new Error(`Canvas.toDataURL повернув некорректний dataURL (length=${dataUrl?.length || 0})`);
    }

    // 5. jsPDF — створити PDF, додати JPEG
    const jspdfModule = await import('jspdf');
    const JsPDF = jspdfModule.jsPDF || jspdfModule.default;
    const pdf = new JsPDF({ unit: 'mm', format: 'a4', orientation });
    try {
      pdf.addImage(dataUrl, 'JPEG', offsetX, offsetY, drawW, drawH);
    } catch (e) {
      throw new Error(`jsPDF.addImage провалився: ${e?.message || e}`);
    }

    let pdfBlob;
    try {
      pdfBlob = pdf.output('blob');
    } catch (e) {
      throw new Error(`jsPDF.output('blob') провалився: ${e?.message || e}`);
    }
    if (!(pdfBlob instanceof Blob) || pdfBlob.size === 0) {
      throw new Error(`jsPDF повернув порожній PDF`);
    }
    if (pdfBlob.size < MIN_PDF_BYTES) {
      // Підозріло малий PDF — addImage могла тихо створити порожню сторінку.
      // Не кидаємо (буває для дуже маленьких зображень), але попереджаємо.
      warnings.push(`PDF unusually small (${pdfBlob.size} bytes) — перевір вміст`);
    }

    return { pdfBlob, warnings };
  } finally {
    // Cleanup blob URL — виконується ЗАВЖДИ (включно з помилкою). Раніше
    // revoke був на happy-path, при exception лишався URL leak.
    URL.revokeObjectURL(blobUrl);
  }
}
