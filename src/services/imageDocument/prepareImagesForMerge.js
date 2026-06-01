// ── PREPARE IMAGES FOR MERGE ─────────────────────────────────────────────────
// Спільна phase-1 pre-assembly для всіх image-merge сценаріїв (модалка
// «🖼 Склеїти зображення» у CaseDossier і DP image-merge у DocumentProcessorV2).
//
// Кроки (TASK 1B image_merge_unify + крок 1.5 image_downscale_blob_hygiene):
//   1. HEIC → JPEG (heic2any) — браузер не вміє декодувати HEIC у <img>.
//   1.5. Downscale роздільності (downscaleImage) — ПІСЛЯ HEIC→JPEG, ПЕРЕД OCR.
//      Замінює normalizedFiles[i] на зменшений upright-blob → і OCR, і збірка
//      PDF беруть легку версію (один шов, обидва споживачі виграють памʼять/
//      швидкість). Guard за роздільністю всередині: малі фото лишаються як є.
//      Drive-source файли пропускаються (їх OCR читає з Drive за id, не з
//      локального blob — локальне запікання орієнтації розсинхронізувало б
//      сигнал кроку 3).
//   2. OCR кожного зображення ОДИН раз (Document AI через ocrService),
//      concurrency=3 — Розумна економія + захист від rate-limit.
//   3. Orientation detection per image (EXIF → Document AI → aspect heuristic)
//      БЕЗ застосування — degrees повертаються наверх, споживач сам вирішує
//      коли і де крутити (модалка крутить ДО склейки PDF; DP крутить per-group
//      у rebuildFromOcrResults на «Виконати»).
//
// ЧОГО ТУТ НЕМАЄ (свідомо):
//   • Сортування (imageSortingAgent) — модалка сортує глобально, DP сортує
//     В МЕЖАХ кожної групи. Різний сенс → різні хвости (правило #11).
//   • Збірка PDF (jsPDF / buildPdfFromImages) — модалка збирає 1 PDF, DP збирає
//     N PDF після правки адвоката. Різні моменти і різні набори сторінок.
//   • imageDocumentGrouper (Haiku, межі між документами) — це DP-only хвіст,
//     модалці він не потрібен (1 батч = 1 документ за визначенням).
//   • activityTracker.report — це робить хвіст (модалка: images_merged через
//     convertImagesToPdf; DP: image_document_grouping через grouper). Тут нема
//     сценарієвого сенсу для білінгу — це pure utility.
//
// Контракт результату:
//   {
//     normalizedFiles,           // Array<File|{_heicFailed}> — pre-HEIC файли у вхідному порядку
//     ocrResults,                // Array<{text, pageStructure, warnings, provider?}>
//     detectedOrientations,      // Array<number> — 0/90/180/270 per file
//     orientationDebug,          // Array<object|null> — діагностика resolveOrientation
//     uncertainOrientationIndices, // Array<number> — індекси з uncertain=true
//     warnings,                  // Array<string> — non-fatal попередження
//   }
//
// Усі помилки (HEIC fail, OCR fail, rotation fail) — НЕ фатальні: ставиться
// маркер у відповідному масиві і pipeline продовжує. Жодне зображення не
// блокує обробку решти. Це дзеркалить існуючу поведінку multiImageToPdf.js до
// виносу (behavior-preserving для модалки).

import { heicToJpeg } from '../converter/heicToJpeg.js';
import * as ocrService from '../ocrService.js';
import { downscaleImage } from './downscaleImage.js';
import {
  readExifOrientation,
  resolveOrientation,
  getImageDimensions,
} from '../sortation/orientationCorrector.js';

const OCR_CONCURRENCY = 3; // Б2=B: 3-5 паралельних, обираємо 3 як безпечний baseline.

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

// ── Blob → File (збереження метаданих після downscale) ─────────────────────

/**
 * Обгортає зменшений Blob у File, переносячи name/type/lastModified з оригіналу,
 * щоб downstream (OCR читає file.name/type; orientation логує file.name) бачив
 * звичний File. Кастомні маркери (_isDriveSource/_driveId) теж переносяться —
 * на випадок майбутнього розширення; зараз downscale їх не зачіпає (drive-
 * source пропускається до виклику).
 *
 * @param {Blob} blob — зменшений blob
 * @param {File|Blob} original — вхідний файл (джерело name/type)
 * @returns {File|Blob}
 */
function blobToNamedFile(blob, original) {
  const name = original?.name || 'image.jpg';
  const type = blob.type || original?.type || 'image/jpeg';
  let out;
  try {
    out = new File([blob], name, { type, lastModified: original?.lastModified || Date.now() });
  } catch {
    out = blob; // середовища без File-конструктора — лишаємо Blob
  }
  if (original && typeof original === 'object') {
    for (const key of ['_isDriveSource', '_driveId']) {
      if (original[key] !== undefined) {
        try { out[key] = original[key]; } catch { /* noop */ }
      }
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
    // eslint-disable-next-line no-constant-condition
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
        try { onProgress(done, items.length); } catch { /* noop */ }
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
 *
 * skipCache=true + skipCacheWrite=true: файл щойно адвокат вибрав, у нас немає
 * persistent ID; запис об'єднаного .txt у 02_ОБРОБЛЕНІ робить caller після
 * фінальної збірки (модалка: один .txt; DP: один .txt на групу).
 */
async function ocrOneImage(file, options) {
  const ocrFile = file._isDriveSource && file._driveId
    ? {
        id: file._driveId,
        name: file.name,
        mimeType: file.type,
      }
    : {
        id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        mimeType: file.type || 'image/jpeg',
        localBlob: file,
      };
  return await ocrService.extractText(ocrFile, {
    skipCache: true,
    skipCacheWrite: true,
    ...options,
  });
}

// ── Main pre-assembly pipeline ─────────────────────────────────────────────

/**
 * @typedef {Object} PrepareImagesOptions
 * @property {Function} [onProgress] — (phase, doneCount, totalCount) => void
 *           phase: 'heic' | 'downscale' | 'ocr' | 'rotate'
 * @property {object} [ocrOptions] — додаткові опції для ocrService.extractText
 */

/**
 * @param {File[]} files — масив зображень (з пристрою або Drive blobs)
 * @param {PrepareImagesOptions} [options]
 * @returns {Promise<{
 *   normalizedFiles: Array<File|object>,
 *   ocrResults: Array<{text:string, pageStructure:any, warnings:string[], provider?:string}>,
 *   detectedOrientations: number[],
 *   orientationDebug: Array<object|null>,
 *   uncertainOrientationIndices: number[],
 *   warnings: string[],
 * }>}
 */
export async function prepareImagesForMerge(files, options = {}) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('prepareImagesForMerge: files має бути непорожнім масивом');
  }

  const warnings = [];
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};

  // 1. HEIC pre-conversion
  onProgress('heic', 0, files.length);
  const normalizedFiles = await preConvertHeic(files);
  for (const f of normalizedFiles) {
    if (f._heicFailed) warnings.push(`HEIC ${f.name}: ${f._heicFailed}`);
  }
  onProgress('heic', files.length, files.length);

  // 1.5. Downscale роздільності (памʼять/швидкість). ПІСЛЯ HEIC→JPEG (працюємо
  //      на JPEG), ПЕРЕД OCR (і OCR, і збірка PDF беруть легку upright-версію).
  //      Drive-source пропускаємо: OCR читає такий файл з Drive за id, не з
  //      локального blob, тож локальне запікання upright розсинхронізувало б
  //      orientation-сигнал кроку 3. Downscale fail — не фатально (лишаємо
  //      оригінал). Guard за роздільністю — всередині downscaleImage.
  onProgress('downscale', 0, normalizedFiles.length);
  for (let i = 0; i < normalizedFiles.length; i++) {
    const f = normalizedFiles[i];
    if (!f || f._heicFailed || !(f instanceof Blob) || f._isDriveSource) {
      onProgress('downscale', i + 1, normalizedFiles.length);
      continue;
    }
    try {
      const reduced = await downscaleImage(f);
      if (reduced !== f) normalizedFiles[i] = blobToNamedFile(reduced, f);
    } catch (e) {
      warnings.push(`Downscale fail для ${f.name || 'image'}: ${e?.message || e}`);
    }
    onProgress('downscale', i + 1, normalizedFiles.length);
  }
  onProgress('downscale', normalizedFiles.length, normalizedFiles.length);

  // 2. OCR кожне зображення (один раз) з обмеженням concurrency
  onProgress('ocr', 0, normalizedFiles.length);
  const ocrTaskFn = async (file) => {
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
    normalizedFiles,
    ocrTaskFn,
    OCR_CONCURRENCY,
    (done, total) => onProgress('ocr', done, total),
  );
  const ocrResults = ocrResultsRaw.map((r) =>
    r && r.__error
      ? { text: '', pageStructure: null, warnings: [`OCR error: ${r.__error.message}`] }
      : (r || { text: '', pageStructure: null, warnings: [] }),
  );

  // 3. Orientation detection per image (БЕЗ застосування — лише визначення).
  //    Пріоритет: EXIF (фото з телефону) → Document AI → aspect heuristic → 0.
  //    Це той самий каскад resolveOrientation що раніше — лише без
  //    rotateImageBlob (повертати чи не повертати blob — рішення хвоста).
  //
  //    КОРІНЬ ПРОБЛЕМИ (TASK B fix round 1): фото з месенджерів strip EXIF.
  //    Document AI часто теж не повертає orientation. Залишається тільки
  //    aspect ratio з marker uncertain=true → UI показує warning адвокату.
  onProgress('rotate', 0, normalizedFiles.length);
  const detectedOrientations = new Array(normalizedFiles.length).fill(0);
  const orientationDebug = new Array(normalizedFiles.length).fill(null);
  const uncertainOrientationIndices = [];
  for (let i = 0; i < normalizedFiles.length; i++) {
    const file = normalizedFiles[i];
    if (file._heicFailed) {
      onProgress('rotate', i + 1, normalizedFiles.length);
      continue;
    }
    let exifResult = null;
    try {
      exifResult = await readExifOrientation(file);
    } catch (e) {
      console.warn(`[prepareImagesForMerge] EXIF read fail для ${file.name}:`, e?.message || e);
    }
    let imageDimensions = null;
    try {
      imageDimensions = await getImageDimensions(file);
    } catch (e) {
      console.warn(`[prepareImagesForMerge] image dimensions fail для ${file.name}:`, e?.message || e);
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
    onProgress('rotate', i + 1, normalizedFiles.length);
  }

  return {
    normalizedFiles,
    ocrResults,
    detectedOrientations,
    orientationDebug,
    uncertainOrientationIndices,
    warnings,
  };
}

// Експорт для тестів
export const __test__ = {
  OCR_CONCURRENCY,
  preConvertHeic,
  runWithConcurrency,
  isHeic,
};
