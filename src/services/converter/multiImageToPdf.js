// ── MULTI-IMAGE → PDF ────────────────────────────────────────────────────────
// Склейка кількох зображень у один PDF з семантичним сортуванням агентом.
//
// Сценарій: адвокат сфотографував сторінки документа окремо (рішення суду
// з 5 сторінок = 5 фото), або має скани у різних файлах. Pipeline:
//
//   1. Pre-conversion HEIC → JPEG (heicToJpeg)
//   2. OCR кожне зображення ОДИН РАЗ через ocrService.extractText
//      (паралельно, обмеження concurrency=3 щоб не вдарити Document AI rate limit)
//   3. Якщо items.length > 1: sortImages (Sonnet JSON output) → order + warnings
//      + suggestedName + missing. Якщо items.length == 1: skip агент.
//   4. Корекція orientation для кожного зображення (Canvas rotate) — лише якщо
//      Document AI повернув orientation != 0. Інакше no-op.
//   5. Склейка у jsPDF у фінальному порядку. Per-page orientation
//      (portrait/landscape) за пропорцією після rotation.
//   6. Повертаємо контракт з PDF Blob + .txt + .layout.json артефактами
//      (caller записує у 02_ОБРОБЛЕНІ).
//
// ── КРИТИЧНО: ОДИН OCR НА ЗОБРАЖЕННЯ ────────────────────────────────────────
// Pipeline ВИКЛИКАЄ ocrService.extractText лише ОДИН РАЗ для КОЖНОГО зображення.
// Результати (text + pageStructure) використовуються для усього:
//   - семантичного сортування агентом
//   - extractPageOrientation для rotation correction
//   - .txt у 02_ОБРОБЛЕНІ (об'єднання текстів у фінальному порядку)
//   - .layout.json у 02_ОБРОБЛЕНІ (об'єднання pageStructure з оновленими
//     pageNumber у фінальному порядку)
//
// ПОВТОРНИЙ OCR на склеєному PDF — НЕ запускати. Це порушення Розумної економії
// (зайва витрата Document AI токенів і часу). Тести підтверджують це
// (multiImageToPdf.integration.test.js перевіряє рівно N викликів extractText).
//
// ── Контракт ────────────────────────────────────────────────────────────────
// convertImages({ files, context }) → {
//   pdfBlob: Blob('application/pdf'),
//   pdfName: string,                  // imʼя для PDF (без .pdf)
//   extractedText: string,            // об'єднаний text усіх сторінок
//   layoutJson: string,               // JSON pageStructure об'єднана
//   ocrResults: Array<{ index, text, pageStructure, warnings }>, // raw OCR
//   sortResult: SortResult | null,    // null коли 1 image
//   finalOrder: Array<number>,        // індекси у фінальному порядку
//   normalizedFiles: Array<File|Object>, // post-HEIC файли у тому самому
//     // порядку що вхідні files. JPEG для конвертованих HEIC, оригінал
//     // для решти. Для HEIC fail — placeholder {_heicFailed}. UI бере
//     // звідси Blob для thumbnails/preview (браузер не вміє <img src=HEIC>).
//   warnings: Array<string>,
//   converter: 'multiImageToPdf',
//   durationMs: number,
// }
//
// Caller передає progress callback (onProgress) для UI прогрес-бара.

import { heicToJpeg } from './heicToJpeg.js';
import * as ocrService from '../ocrService.js';
import { sortImages, ensureUniqueName } from '../sortation/imageSortingAgent.js';
import {
  extractPageOrientation,
  rotateImageBlob,
  readExifOrientation,
  resolveOrientation,
  getImageDimensions,
} from '../sortation/orientationCorrector.js';

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const A4_MARGIN_MM = 10;
const PX_TO_MM = 0.264583; // 1px ≈ 0.264583 мм (72 dpi)
const JPEG_QUALITY = 0.92;

const OCR_CONCURRENCY = 3; // Б2=B: 3-5 паралельних, обираємо 3 як безпечний baseline

// ── HEIC pre-conversion ────────────────────────────────────────────────────

function isHeic(file) {
  const name = (file?.name || '').toLowerCase();
  const mime = (file?.type || '').toLowerCase();
  return mime === 'image/heic' || mime === 'image/heif' || /\.heic$/i.test(name);
}

async function preConvertHeic(files) {
  const out = [];
  for (const f of files) {
    if (isHeic(f)) {
      try {
        const conv = await heicToJpeg(f);
        out.push(conv.jpegFile);
      } catch (e) {
        // HEIC fail — пропускаємо файл, caller бачить у warnings
        out.push({ ...f, _heicFailed: e?.message || 'HEIC conversion failed' });
      }
    } else {
      out.push(f);
    }
  }
  return out;
}

// ── Concurrency-обмежений OCR ──────────────────────────────────────────────

/**
 * Запускає таск-функції з обмеженням concurrency. Кожен таск отримує (item, idx).
 * Повертає масив результатів у тому ж порядку що вхідні items.
 * onProgress(doneCount, totalCount) викликається при завершенні кожного.
 */
async function runWithConcurrency(items, taskFn, concurrency, onProgress) {
  const results = new Array(items.length);
  let cursor = 0;
  let done = 0;
  async function worker() {
    while (true) {
      const myIdx = cursor++;
      if (myIdx >= items.length) return;
      try {
        results[myIdx] = await taskFn(items[myIdx], myIdx);
      } catch (e) {
        results[myIdx] = { __error: e };
      }
      done++;
      if (typeof onProgress === 'function') {
        try { onProgress(done, items.length); } catch {}
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ── OCR pipeline для одного зображення ─────────────────────────────────────

/**
 * Обгортка над ocrService.extractText. Файл який ще НЕ на Drive (адвокат
 * вибрав з пристрою) — у нас немає driveId. Передаємо локальний blob через
 * file.localBlob = file. ocrService.documentAi уміє це у extract().
 *
 * Якщо файл уже на Drive (з multi-select picker'а) — передаємо `id` + `mimeType`.
 */
async function ocrOneImage(file, options) {
  const ocrFile = file._isDriveSource && file._driveId
    ? {
        id: file._driveId,
        name: file.name,
        mimeType: file.type,
        // subFolders не передаємо — кеш у 02_ОБРОБЛЕНІ робить інакше
        // (по сесії merge — спочатку OCR кожне у пам'яті, потім єдиний .txt)
      }
    : {
        // Локальний файл — ocrService витягне через FileReader / Document AI
        id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        mimeType: file.type || 'image/jpeg',
        localBlob: file,
      };
  // skipCache=true — не читаємо .txt з 02_ОБРОБЛЕНІ. Файл щойно адвокат вибрав,
  // у нас немає persistent ID. Запис кеша теж пропускаємо (caller сам напише
  // об'єднаний .txt після склейки).
  return await ocrService.extractText(ocrFile, {
    skipCache: true,
    skipCacheWrite: true,
    ...options,
  });
}

// ── jsPDF склейка ──────────────────────────────────────────────────────────

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не вдалося завантажити image blob'));
    };
    img.src = url;
  });
}

async function buildPdfFromImages(orderedBlobs) {
  const jspdfModule = await import('jspdf');
  const JsPDF = jspdfModule.jsPDF || jspdfModule.default;

  // jsPDF потребує початкової orientation — задаємо за першим зображенням.
  if (orderedBlobs.length === 0) {
    throw new Error('Нема зображень для склейки');
  }
  const firstImg = await loadImageFromBlob(orderedBlobs[0]);
  const firstOrient = firstImg.width > firstImg.height ? 'landscape' : 'portrait';
  const pdf = new JsPDF({ unit: 'mm', format: 'a4', orientation: firstOrient });

  for (let i = 0; i < orderedBlobs.length; i++) {
    const img = i === 0 ? firstImg : await loadImageFromBlob(orderedBlobs[i]);
    const orientation = img.width > img.height ? 'landscape' : 'portrait';

    if (i > 0) {
      pdf.addPage('a4', orientation);
    }

    const pageW = orientation === 'landscape' ? A4_HEIGHT_MM : A4_WIDTH_MM;
    const pageH = orientation === 'landscape' ? A4_WIDTH_MM : A4_HEIGHT_MM;
    const usableW = pageW - 2 * A4_MARGIN_MM;
    const usableH = pageH - 2 * A4_MARGIN_MM;

    const imgWmm = img.width * PX_TO_MM;
    const imgHmm = img.height * PX_TO_MM;
    const ratio = Math.min(usableW / imgWmm, usableH / imgHmm);
    const drawW = imgWmm * ratio;
    const drawH = imgHmm * ratio;
    const offsetX = (pageW - drawW) / 2;
    const offsetY = (pageH - drawH) / 2;

    // Канвас → JPEG data URL (jsPDF приймає data URL)
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);

    pdf.addImage(dataUrl, 'JPEG', offsetX, offsetY, drawW, drawH);
  }

  const blob = pdf.output('blob');
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error('jsPDF повернув порожній PDF');
  }
  return blob;
}

// ── Layout serialize ──────────────────────────────────────────────────────

const STRIPPED_LAYOUT_FIELDS = ['image', 'tokens'];

function stripHeavyFields(pageStructure) {
  if (!Array.isArray(pageStructure)) return pageStructure;
  return pageStructure.map((p) => {
    if (!p || typeof p !== 'object') return p;
    const copy = { ...p };
    for (const f of STRIPPED_LAYOUT_FIELDS) delete copy[f];
    return copy;
  });
}

/**
 * Об'єднує pageStructure з кількох OCR-результатів у одну у фінальному
 * порядку. Перенумеровує pageNumber починаючи з 1.
 */
function mergeLayouts(ocrResults, finalOrder) {
  const merged = [];
  let pageNum = 1;
  for (const origIdx of finalOrder) {
    const ocr = ocrResults[origIdx];
    if (!ocr || !ocr.pageStructure) continue;
    const pages = Array.isArray(ocr.pageStructure) ? ocr.pageStructure : [];
    for (const p of pages) {
      if (!p || typeof p !== 'object') continue;
      merged.push({ ...p, pageNumber: pageNum });
      pageNum++;
    }
  }
  return merged;
}

function serializeMergedLayout(pageStructure, provider) {
  return JSON.stringify({
    schemaVersion: 1,
    provider: provider || 'documentAi',
    generatedAt: new Date().toISOString(),
    pages: stripHeavyFields(pageStructure),
  });
}

// ── Main pipeline ──────────────────────────────────────────────────────────

/**
 * @typedef {Object} ConvertImagesOptions
 * @property {string} apiKey — для imageSortingAgent
 * @property {Object} context — { caseId, module, operation, existingDocumentNames }
 * @property {Function} onProgress — (phase, doneCount, totalCount, extra) => void
 *           phase: 'heic' | 'ocr' | 'sort' | 'rotate' | 'pdf'
 */

/**
 * @param {File[]} files — масив зображень (з пристрою або Drive blobs)
 * @param {ConvertImagesOptions} options
 */
export async function convertImagesToPdf(files, options = {}) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('convertImagesToPdf: files має бути непорожнім масивом');
  }

  const t0 = Date.now();
  const warnings = [];
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};

  // 1. HEIC pre-conversion
  onProgress('heic', 0, files.length);
  const normalized = await preConvertHeic(files);
  for (const f of normalized) {
    if (f._heicFailed) warnings.push(`HEIC ${f.name}: ${f._heicFailed}`);
  }
  onProgress('heic', files.length, files.length);

  // 2. OCR кожне зображення (один раз) з обмеженням concurrency
  onProgress('ocr', 0, normalized.length);
  const ocrTaskFn = async (file, idx) => {
    if (file._heicFailed) {
      return { text: '', pageStructure: null, warnings: [`HEIC fail: ${file._heicFailed}`] };
    }
    try {
      const result = await ocrOneImage(file, options.ocrOptions);
      return result;
    } catch (e) {
      // Г1=A: OCR fail для одного → продовжуємо з рештою, text=""
      warnings.push(`OCR fail для ${file.name}: ${e?.message || e}`);
      return { text: '', pageStructure: null, warnings: [`OCR failed: ${e?.message || e}`] };
    }
  };
  const ocrResultsRaw = await runWithConcurrency(
    normalized,
    ocrTaskFn,
    OCR_CONCURRENCY,
    (done, total) => onProgress('ocr', done, total)
  );
  // Перевіряємо що жоден результат не залишився __error (runWithConcurrency
  // ловить throw — додатковий захист)
  const ocrResults = ocrResultsRaw.map((r, i) =>
    r && r.__error
      ? { text: '', pageStructure: null, warnings: [`OCR error: ${r.__error.message}`] }
      : (r || { text: '', pageStructure: null, warnings: [] })
  );

  // 3. Семантичне сортування агентом (якщо >1)
  onProgress('sort', 0, 1);
  let sortResult = null;
  if (normalized.length > 1) {
    const items = normalized.map((file, idx) => ({
      index: idx,
      name: file.name,
      mime: file.type,
      sizeBytes: file.size,
      ocrText: ocrResults[idx]?.text || '',
      pageStructure: ocrResults[idx]?.pageStructure || null,
      orientation: extractPageOrientation(
        Array.isArray(ocrResults[idx]?.pageStructure)
          ? ocrResults[idx].pageStructure[0]
          : null
      ),
    }));
    try {
      // Hard timeout щоб stale Anthropic call не зависив pipeline. 90 сек
      // вистачає для 50 зображень (~1.5 KB ocrText кожне × 50 ≈ 75 KB вхід).
      // Якщо агент не відповів — fallback identity order, pipeline продовжує.
      const SORT_TIMEOUT_MS = 90_000;
      sortResult = await Promise.race([
        sortImages(items, {
          apiKey: options.apiKey,
          callApi: options.callApi, // для тестів
          caseContext: {
            existingDocumentNames: options.context?.existingDocumentNames || [],
            categoryHint: options.context?.categoryHint || null,
          },
        }),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error(`sortImages timeout after ${SORT_TIMEOUT_MS}ms`)), SORT_TIMEOUT_MS)
        ),
      ]);
    } catch (e) {
      console.warn('[multiImageToPdf] sort agent failed, falling back to identity order:', e?.message);
      warnings.push(`Sorting agent fail: ${e?.message || e}`);
      sortResult = null;
    }
  }
  onProgress('sort', 1, 1);

  const finalOrder = sortResult?.order || normalized.map((_, i) => i);

  // 4. Корекція orientation per image — тільки якщо != 0 (Розумна економія)
  // Пріоритет: EXIF (фото з телефону) → Document AI orientation → aspect heuristic → 0.
  //
  // КОРІНЬ ПРОБЛЕМИ TASK B fix round 1: фото надіслані через месенджер
  // (Telegram/WhatsApp/Viber/Signal) — strip EXIF при пересилці. JFIF без
  // APP1 marker. Тому EXIF parser коректно повертає null. Document AI
  // часто теж не повертає orientation для таких фото. Залишається тільки
  // aspect ratio як остання heuristic — якщо image landscape, а юридичний
  // документ зазвичай A4 portrait, пропонуємо 270° з marker uncertain=true,
  // який UI показує адвокату як warning "Перевірте — кнопка ↻ виправить".
  //
  // detectedOrientations повертається наверх щоб ImageMergePanel міг скласти
  // фінальну rotation = (autoOrientation + userRotation) mod 360 у preview.
  // orientationDebug повертається теж — для debug toggle у UI.
  onProgress('rotate', 0, normalized.length);
  const rotatedBlobs = new Array(normalized.length);
  const detectedOrientations = new Array(normalized.length).fill(0);
  const orientationDebug = new Array(normalized.length).fill(null);
  const uncertainOrientationIndices = [];
  for (let i = 0; i < normalized.length; i++) {
    const file = normalized[i];
    if (file._heicFailed) {
      rotatedBlobs[i] = null; // буде пропущено у склейці
      onProgress('rotate', i + 1, normalized.length);
      continue;
    }
    let exifResult = null;
    try {
      exifResult = await readExifOrientation(file);
    } catch (e) {
      console.warn(`[multiImageToPdf] EXIF read fail для ${file.name}:`, e?.message || e);
    }
    // Aspect ratio — потрібен для heuristic коли EXIF/docAi провалюються
    let imageDimensions = null;
    try {
      imageDimensions = await getImageDimensions(file);
    } catch (e) {
      console.warn(`[multiImageToPdf] image dimensions fail для ${file.name}:`, e?.message || e);
    }
    const firstPage = Array.isArray(ocrResults[i]?.pageStructure)
      ? ocrResults[i].pageStructure[0]
      : null;
    const resolved = resolveOrientation({
      exifResult,
      docAiPage: firstPage,
      imageDimensions,
      fileName: file.name,
    });
    for (const line of resolved.logs) console.log(line);
    detectedOrientations[i] = resolved.degrees;
    orientationDebug[i] = {
      source: resolved.source,
      degrees: resolved.degrees,
      uncertain: resolved.uncertain,
      ...resolved.debug,
    };
    if (resolved.uncertain) uncertainOrientationIndices.push(i);
    try {
      rotatedBlobs[i] = resolved.degrees !== 0
        ? await rotateImageBlob(file, resolved.degrees)
        : file;
    } catch (e) {
      warnings.push(`Rotation fail для ${file.name}: ${e?.message || e}. Залишаємо без обертання.`);
      rotatedBlobs[i] = file;
    }
    onProgress('rotate', i + 1, normalized.length);
  }

  // 5. Склейка у jsPDF у фінальному порядку (виключаємо null/heic-failed)
  onProgress('pdf', 0, 1);
  const orderedBlobs = finalOrder
    .map((idx) => rotatedBlobs[idx])
    .filter((b) => b instanceof Blob);
  console.log('[multiImageToPdf] pdf assembly: orderedBlobs=', orderedBlobs.length);
  if (orderedBlobs.length === 0) {
    throw new Error('Жодне зображення не вдалось підготувати для склейки');
  }
  let pdfBlob;
  try {
    pdfBlob = await buildPdfFromImages(orderedBlobs);
  } catch (e) {
    console.error('[multiImageToPdf] buildPdfFromImages failed:', e);
    throw new Error(`PDF assembly failed: ${e?.message || e}`);
  }
  if (!(pdfBlob instanceof Blob) || pdfBlob.size === 0) {
    throw new Error('buildPdfFromImages повернув порожній blob');
  }
  console.log('[multiImageToPdf] pdf assembled:', pdfBlob.size, 'bytes');
  onProgress('pdf', 1, 1);

  // 6. Об'єднаний text + layout у фінальному порядку
  const extractedText = finalOrder
    .map((idx) => ocrResults[idx]?.text || '')
    .filter((t) => t && t.trim())
    .join('\n\n--- Page break ---\n\n');

  let layoutJson = null;
  try {
    const mergedLayout = mergeLayouts(ocrResults, finalOrder);
    if (mergedLayout.length > 0) {
      layoutJson = serializeMergedLayout(mergedLayout, ocrResults[finalOrder[0]]?.provider || 'documentAi');
    }
  } catch (e) {
    console.warn('[multiImageToPdf] layout serialization failed (non-fatal):', e?.message);
    warnings.push(`Layout serialize fail: ${e?.message || e}`);
  }

  const suggestedName = sortResult?.suggestedName || '';
  const existingNames = options.context?.existingDocumentNames;
  const finalName = Array.isArray(existingNames) && existingNames.length > 0
    ? ensureUniqueName(suggestedName, existingNames)
    : suggestedName;

  return {
    pdfBlob,
    pdfName: finalName || 'merged_document',
    suggestedName: finalName,
    extractedText,
    layoutJson,
    ocrResults,
    sortResult,
    finalOrder,
    normalizedFiles: normalized,
    detectedOrientations,
    orientationDebug,
    uncertainOrientationIndices,
    warnings,
    converter: 'multiImageToPdf',
    durationMs: Date.now() - t0,
  };
}

// Експорт для тестів
export const __test__ = {
  OCR_CONCURRENCY,
  preConvertHeic,
  runWithConcurrency,
  mergeLayouts,
  serializeMergedLayout,
  buildPdfFromImages,
};
