// ── IMAGE → PDF ──────────────────────────────────────────────────────────────
// Конвертує одне зображення (JPG/PNG/HEIC/WEBP) у PDF Blob.
//
// Pipeline:
//   1. Якщо HEIC — pre-convert через heicToJpeg
//   2. Завантажити image у HTMLImageElement (через blob URL)
//   3. Обрати орієнтацію A4 за пропорцією зображення (portrait/landscape)
//   4. jsPDF — створити PDF A4 з вставкою зображення з масштабом fit
//   5. Cleanup blob URL
//
// Контракт результату:
//   { pdfBlob: Blob, warnings: string[] }
//
// TASK B розширить це: orientation correction через Document AI orientation
// метадані, склейка кількох зображень у один PDF.

import { heicToJpeg } from './heicToJpeg.js';

// A4 розміри у мм
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const A4_MARGIN_MM = 10; // 1см поля з усіх сторін

function isHeic(file) {
  const name = (file?.name || '').toLowerCase();
  const mime = (file?.type || '').toLowerCase();
  return mime === 'image/heic' || mime === 'image/heif' || /\.heic$/i.test(name);
}

function loadImage(blobUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не вдалося завантажити зображення'));
    img.src = blobUrl;
  });
}

export async function imageToPdf(file, context = {}) {
  const warnings = [];
  let workingFile = file;

  // 1. HEIC → JPEG (iPhone фото)
  if (isHeic(file)) {
    const conv = await heicToJpeg(file, context);
    workingFile = conv.jpegFile;
    warnings.push('HEIC конвертовано у JPEG');
  }

  // 2. Завантажити зображення для виміру розмірів
  const blobUrl = URL.createObjectURL(workingFile);
  let img;
  try {
    img = await loadImage(blobUrl);
  } finally {
    // Cleanup blob URL — img вже має пікселі у пам'яті, URL не потрібен
    // (cleanup ПІСЛЯ передачі data до jsPDF — на цьому етапі ще ні)
  }

  // 3. Орієнтація PDF — за пропорцією
  const orientation = img.width > img.height ? 'landscape' : 'portrait';
  const pageW = orientation === 'landscape' ? A4_HEIGHT_MM : A4_WIDTH_MM;
  const pageH = orientation === 'landscape' ? A4_WIDTH_MM : A4_HEIGHT_MM;
  const usableW = pageW - 2 * A4_MARGIN_MM;
  const usableH = pageH - 2 * A4_MARGIN_MM;

  // Fit: пропорційно вписати у usableW x usableH
  const ratio = Math.min(usableW / (img.width * 0.264583), usableH / (img.height * 0.264583));
  // 1px ≈ 0.264583 мм (72 dpi). jsPDF приймає мм.
  const drawW = img.width * 0.264583 * ratio;
  const drawH = img.height * 0.264583 * ratio;
  const offsetX = (pageW - drawW) / 2;
  const offsetY = (pageH - drawH) / 2;

  // 4. Канвас для PNG/JPG data URL (jsPDF приймає або data URL, або Image)
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

  // Cleanup blob URL
  URL.revokeObjectURL(blobUrl);

  // 5. jsPDF створення документа
  const jspdfModule = await import('jspdf');
  const JsPDF = jspdfModule.jsPDF || jspdfModule.default;
  const pdf = new JsPDF({ unit: 'mm', format: 'a4', orientation });
  pdf.addImage(dataUrl, 'JPEG', offsetX, offsetY, drawW, drawH);

  const pdfBlob = pdf.output('blob');
  if (!(pdfBlob instanceof Blob) || pdfBlob.size === 0) {
    throw new Error('jsPDF повернув порожній PDF');
  }

  return { pdfBlob, warnings };
}
