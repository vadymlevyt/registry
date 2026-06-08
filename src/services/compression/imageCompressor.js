// ── TASK 4 · E · IMAGE COMPRESSOR (реальний downscale-рушій) ─────────────────
// РЕАЛЬНЕ стиснення сканованих PDF — перенесено БАЙТ-У-БАЙТ зі стенда
// `public/lab/pdf-recompress.html` (функція `processFile`). Кожну сторінку
// рендеримо у canvas нормалізовано по СТЕЛІ ПІКСЕЛІВ на довгій стороні (а НЕ
// фіксований DPI — айфонівські PDF брешуть про pt-розмір), → JPEG → pdf-lib
// `embedJpg`+`addPage`+`drawImage` → `save({useObjectStreams})`.
//
// 🚨 ЦЕ НЕ `compressionService.compressPdf` (слабкий pdf-lib re-save, 1-2%).
// Тут вага падає у растрах сторінок: 200→79 МБ на реальних томах.
//
// 🔑 Складання — pdf-lib (НЕ jsPDF). Кожна сторінка дістає ВЛАСНИЙ словник
// ресурсів зі своїм зображенням → конвеєрна нарізка (`copyPages` у
// splitPdf) ріже ПРОПОРЦІЙНО. jsPDF клав усі зображення в один спільний
// `/Resources` → нарізка тягла ВСІ зображення в кожен чанк → чанк ≈ весь
// файл → Document AI «>40 МБ» (доктрина §3.2, коміт b76ba04). Тому стиснення
// на вході існує і ДЛЯ ТОГО, щоб потім нарізалось.
//
// Єдина адаптація проти стенда: CDN-бібліотеки → npm `pdfjs-dist`+`pdf-lib`
// (вже в застосунку). Worker pdfjs ініціалізується в App.jsx
// (GlobalWorkerOptions) — переюзуємо наявну конфігурацію, тут просто імпорт.
// Render-цикл (canvas/toBlob) браузерний — на сервері/у Node не виконується
// (тести покривають пресети+guard+детекцію; реальний обсяг — на пристрої).

import { PDFDocument } from 'pdf-lib';

// pdfjs-dist — LAZY import (як detectDocumentNature/actionsRegistry): top-level
// import тягне DOMMatrix, недоступний у Node-тест-середовищі. Це той самий
// module-singleton, що App.jsx (GlobalWorkerOptions worker уже налаштований) —
// переюзуємо наявну конфігурацію, не дублюємо. Кешуємо проміс.
let _pdfjsPromise = null;
function getPdfjs() {
  if (!_pdfjsPromise) _pdfjsPromise = import('pdfjs-dist');
  return _pdfjsPromise;
}

// ── Пресети (§4.1 doctrine) ─────────────────────────────────────────────────
// Один сенс на пресет: стеля пікселів довгої сторони + JPEG-якість. Параметри —
// в ОДНІЙ константі (зміна = деплой, не через UI; за зразком CONVERT_DOCX_TO_PDF).
// Середній = підтверджений стандарт системи (розділ 3). Підлога — 1400/0.6,
// нижче не йдемо (текст починає «пливти»).
export const COMPRESSION_PRESETS = Object.freeze({
  weak: Object.freeze({ longEdge: 2200, quality: 0.8 }),   // мінімум стиснення, максимум якості
  medium: Object.freeze({ longEdge: 1800, quality: 0.7 }), // СТАНДАРТ системи (дефолт)
  strong: Object.freeze({ longEdge: 1600, quality: 0.65 }),// максимум економії (не нижче підлоги)
});

// Дефолтний пресет = Середній (стандарт). DP-труба кличе з фіксованим Середнім;
// «Інструменти» (поза E) дадуть вибір пресета поверх того самого рушія.
export const DEFAULT_COMPRESSION_PRESET = 'medium';

// Запобіжник проти екстремального апскейлу дрібних сторінок (зі стенда).
const MAX_SCALE = 6;

// Поріг «текст на сторінці» для детекції scanned↔searchable. Дзеркало
// detectDocumentNature.detectNatureFromPdf (<50 символів сирого тексту на
// 1-й стор. → scanned). Один критерій по всій системі (доктрина: «scanned ↔
// інше — ОДНА детекція»).
const SCANNED_TEXT_THRESHOLD = 50;

// resolvePreset — назва пресета ('weak'|'medium'|'strong') або готовий
// {longEdge,quality} → нормалізований {longEdge,quality}. Невідома назва →
// дефолт (Середній). Один сенс: «дай параметри рендеру».
export function resolvePreset(preset) {
  if (preset && typeof preset === 'object'
      && Number.isFinite(preset.longEdge) && Number.isFinite(preset.quality)) {
    return { longEdge: preset.longEdge, quality: preset.quality };
  }
  const key = typeof preset === 'string' ? preset : DEFAULT_COMPRESSION_PRESET;
  return COMPRESSION_PRESETS[key] || COMPRESSION_PRESETS[DEFAULT_COMPRESSION_PRESET];
}

// isCompressibleNature — file-level scanned-guard (детермінований, без I/O).
// Стискаємо ЛИШЕ скановані (на основі зображень) PDF і зображення; усе інше
// (HTML/DOC/текст-PDF) проходить як є. Той самий критерій що documentNature.
// Для PDF без відомого nature повертає null (потрібна deep-детекція буфера).
//   { documentNature?, mimeType?, name? } → true | false | null
export function isCompressibleNature({ documentNature, mimeType, name } = {}) {
  if (documentNature === 'scanned') return true;
  if (documentNature === 'searchable') return false;
  const mime = (mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  const lname = (name || '').toLowerCase();
  const ext = /\.([^.]+)$/.exec(lname)?.[1] || '';
  if (['png', 'jpg', 'jpeg', 'heic', 'heif', 'tif', 'tiff', 'bmp', 'webp'].includes(ext)) return true;
  const isPdf = mime === 'application/pdf' || ext === 'pdf';
  if (isPdf) return null;       // невідомо без читання вмісту → deep-детекція
  return false;                 // не-PDF не-зображення → не стискаємо
}

// canvas → JPEG-байти (Uint8Array) для pdf-lib.embedJpg. Через toBlob (а не
// toDataURL): без base64-роздування проміжного рядка → менший memory peak.
// Перенесено зі стенда як є.
function canvasToJpegBytes(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('canvas.toBlob повернув null')); return; }
      blob.arrayBuffer().then((ab) => resolve(new Uint8Array(ab))).catch(reject);
    }, 'image/jpeg', quality);
  });
}

const yield_ = () => new Promise((r) => setTimeout(r, 0));

// detectScannedFromLoadedPdf — deep-детекція scanned↔searchable по 1-й стор.
// уже відкритого pdf.js-документа (без повторного парсингу). <50 символів
// тексту → 'scanned'. Помилка → 'scanned' (консервативно: краще спробувати
// стиснути на основі зображень, ніж відмовити; рендер однаково безпечний).
async function detectScannedFromLoadedPdf(pdf) {
  try {
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const text = (content.items || [])
      .map((it) => (typeof it.str === 'string' ? it.str : ''))
      .join('')
      .replace(/\s+/g, '')
      .trim();
    return text.length < SCANNED_TEXT_THRESHOLD ? 'scanned' : 'searchable';
  } catch {
    return 'scanned';
  }
}

// toArrayBuffer — нормалізувати вхід (ArrayBuffer | Uint8Array) до ArrayBuffer
// для pdf.js getDocument (yе детачить вхід — копія безпечна).
function toArrayBuffer(input) {
  if (input instanceof ArrayBuffer) return input;
  if (input && input.buffer instanceof ArrayBuffer) {
    return input.buffer.slice(input.byteOffset || 0, (input.byteOffset || 0) + input.byteLength);
  }
  return input;
}

/**
 * Стиснути сканований PDF реальним downscale-рушієм (рендер→JPEG→pdf-lib).
 *
 * @param {ArrayBuffer|Uint8Array} input — вхідний PDF
 * @param {object} [opts]
 *   preset       — 'weak'|'medium'|'strong' або {longEdge,quality}; дефолт Середній
 *   scannedGuard — true (дефолт): searchable PDF НЕ чіпаємо (pass-through)
 *   onProgress   — (done,total) колбек по сторінках (опц.)
 * @returns {Promise<{bytes:Uint8Array, compressed:boolean, skipped:boolean,
 *   reason?:string, inBytes:number, outBytes:number, pageCount:number,
 *   maxMP:number, firstPt:string, totalMs:number}>}
 *   skipped:true (compressed:false) → searchable: bytes = вхід незмінним.
 *   Не кидає на guard-skip; кидає лише на фатальній помилці рендеру.
 */
export async function compressPdfBuffer(input, opts = {}) {
  const { longEdge, quality } = resolvePreset(opts.preset);
  const scannedGuard = opts.scannedGuard !== false;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const ab = toArrayBuffer(input);
  const inBytes = ab.byteLength ?? input.byteLength ?? 0;
  const inputU8 = input instanceof Uint8Array ? input : new Uint8Array(ab);

  const pdfjsLib = await getPdfjs();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
  const pageCount = pdf.numPages;

  // scanned-guard: текстовий (searchable) PDF — вага у тексті/векторах, растрів
  // нема, стискати нічого. Pass-through (bytes = вхід), не кидаємо.
  if (scannedGuard) {
    const nature = await detectScannedFromLoadedPdf(pdf);
    if (nature === 'searchable') {
      try { pdf.destroy(); } catch { /* noop */ }
      return {
        bytes: inputU8,
        compressed: false,
        skipped: true,
        reason: 'searchable',
        inBytes,
        outBytes: inBytes,
        pageCount,
        maxMP: 0,
        firstPt: '',
        totalMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
      };
    }
  }

  // pdf-lib: кожна addPage+drawImage дає сторінці ВЛАСНІ ресурси → copyPages у
  // конвеєрі ріже пропорційно (на відміну від jsPDF — доктрина §3.2).
  const outDoc = await PDFDocument.create();
  let firstPt = '';
  let maxMP = 0;

  for (let p = 1; p <= pageCount; p++) {
    const page = await pdf.getPage(p);
    const vp1 = page.getViewport({ scale: 1 });        // pt-розмір (як декларує PDF)
    const longPt = Math.max(vp1.width, vp1.height);
    // нормалізація до СТЕЛІ ПІКСЕЛІВ по довгій стороні (а НЕ фіксований DPI)
    const scale = Math.min(longEdge / longPt, MAX_SCALE);
    const vp = page.getViewport({ scale });

    if (p === 1) firstPt = `${Math.round(vp1.width)}×${Math.round(vp1.height)}`;

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const mp = (canvas.width * canvas.height) / 1e6;
    if (mp > maxMP) maxMP = mp;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    await page.render({ canvasContext: ctx, viewport: vp }).promise;

    const jpegBytes = await canvasToJpegBytes(canvas, quality);

    // Розмір сторінки — у pt (як декларує оригінал); зображення накриває всю
    // сторінку. vp1.width/height від pdf.js при scale:1 = пункти PDF.
    const img = await outDoc.embedJpg(jpegBytes);
    const outPage = outDoc.addPage([vp1.width, vp1.height]);
    outPage.drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });

    // прибирання, щоб не накопичувати пам'ять (зі стенда)
    canvas.width = 0; canvas.height = 0;
    page.cleanup();

    if (onProgress) { try { onProgress(p, pageCount); } catch { /* ізольовано */ } }
    await yield_();
  }

  const outU8 = await outDoc.save({ useObjectStreams: true });
  try { pdf.destroy(); } catch { /* noop */ }

  return {
    bytes: outU8,
    compressed: true,
    skipped: false,
    inBytes,
    outBytes: outU8.byteLength,
    pageCount,
    maxMP,
    firstPt,
    totalMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
  };
}

/**
 * Оцінити РОЗМІР після стиснення на семплі перших сторінок (TASK 4 E крок 5,
 * прогноз «→ ~X МБ»). Стискаємо ПЕРШІ samplePages → екстраполяція × pageCount.
 * Дешевша за повний прогон; оцінка приблизна (тому UI показує з «~»).
 *
 * @param {ArrayBuffer|Uint8Array} input
 * @param {object} [opts] preset, samplePages (дефолт 2)
 * @returns {Promise<{applicable:boolean, reason?:string, estimatedBytes:number,
 *   inBytes:number, pageCount:number, sampledPages:number}>}
 *   applicable:false → searchable (стиснення не застосовне) або помилка.
 */
export async function estimateCompressedSize(input, opts = {}) {
  const { longEdge, quality } = resolvePreset(opts.preset);
  const samplePages = Math.max(1, opts.samplePages || 2);
  const ab = toArrayBuffer(input);
  const inBytes = ab.byteLength ?? input.byteLength ?? 0;

  let pdf;
  try {
    const pdfjsLib = await getPdfjs();
    pdf = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
  } catch (e) {
    return { applicable: false, reason: 'parse_error', estimatedBytes: inBytes, inBytes, pageCount: 0, sampledPages: 0 };
  }
  const pageCount = pdf.numPages;

  const nature = await detectScannedFromLoadedPdf(pdf);
  if (nature === 'searchable') {
    try { pdf.destroy(); } catch { /* noop */ }
    return { applicable: false, reason: 'searchable', estimatedBytes: inBytes, inBytes, pageCount, sampledPages: 0 };
  }

  const n = Math.min(samplePages, pageCount);
  let sampledBytes = 0;
  try {
    const sampleDoc = await PDFDocument.create();
    for (let p = 1; p <= n; p++) {
      const page = await pdf.getPage(p);
      const vp1 = page.getViewport({ scale: 1 });
      const longPt = Math.max(vp1.width, vp1.height);
      const scale = Math.min(longEdge / longPt, MAX_SCALE);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: false });
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const jpegBytes = await canvasToJpegBytes(canvas, quality);
      sampledBytes += jpegBytes.byteLength;
      canvas.width = 0; canvas.height = 0;
      page.cleanup();
      await yield_();
    }
  } catch (e) {
    try { pdf.destroy(); } catch { /* noop */ }
    return { applicable: false, reason: 'render_error', estimatedBytes: inBytes, inBytes, pageCount, sampledPages: 0 };
  }
  try { pdf.destroy(); } catch { /* noop */ }

  // Екстраполяція: середня вага семпл-сторінки × pageCount + невеликий
  // структурний оверхед pdf-lib (~частки відсотка, доктрина §3.2).
  const perPage = n > 0 ? sampledBytes / n : 0;
  const estimatedBytes = Math.round(perPage * pageCount * 1.02);
  return { applicable: true, estimatedBytes, inBytes, pageCount, sampledPages: n };
}
