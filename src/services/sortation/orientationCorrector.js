// ── ORIENTATION CORRECTOR ────────────────────────────────────────────────────
// Обертання зображення через Canvas API на 0/90/180/270 градусів.
//
// TASK B вимагає: Document AI повертає orientation у pageStructure
// (0/90/180/270). Якщо orientation != 0 — обертаємо зображення перед
// склейкою у фінальний PDF. Якщо orientation == 0 — нічого не робимо
// (принцип Розумної економії).
//
// Один сенс: «взяти Blob зображення + бажаний кут → повернути Blob
// зображення з виправленою орієнтацією». Без OCR, без агентів — тільки
// механічне обертання у пам'яті.
//
// Контракт:
//   rotateImageBlob(blob, degrees) → Promise<Blob>
//     - degrees ∈ {0, 90, 180, 270} (округлюється з допустимих angle)
//     - degrees=0 → повертає той самий blob (no-op)
//     - повертає JPEG Blob (image/jpeg, quality 0.92)
//
//   extractPageOrientation(pageStructure) → 0|90|180|270
//     - читає orientation з різних варіантів які може повернути Document AI:
//       page.orientation (enum 0-3 → 0,90,180,270), page.detectedOrientation
//       (degrees), або orientation у layout
//     - fallback 0 якщо нічого не знайдено
//
// Чому тільки 4 кути: Document AI повертає лише ці значення (PAGE_UP,
// PAGE_RIGHT, PAGE_DOWN, PAGE_LEFT). Адвокатські фото зазвичай повертаються
// рівно на 90/180/270 (вертикальна камера). Нестандартні angles (наприклад
// 45°) — раритет; округлюємо до найближчого з 4.

const ALLOWED_DEGREES = new Set([0, 90, 180, 270]);

// ── EXIF orientation reader ─────────────────────────────────────────────────
// Фото з телефону (iPhone, Android camera) зберігають EXIF orientation tag
// 0x0112 (decimal 274) у TIFF marker всередині JPEG. Document AI часто
// НЕ повертає orientation для таких фото — текст детектується нормально,
// але самих метаданих orientation у відповіді немає. EXIF — єдине надійне
// джерело правди про фізичну орієнтацію сенсором.
//
// EXIF orientation values (стандарт):
//   1 = Normal (0°)
//   2 = Mirrored horizontally
//   3 = Rotated 180°
//   4 = Mirrored vertically
//   5 = Mirrored + 90° CCW
//   6 = Rotated 90° CW (телефон тримали вертикально під landscape сцену)
//   7 = Mirrored + 90° CW
//   8 = Rotated 90° CCW
//
// Ми мапимо у необхідний кут ОБЕРТАННЯ для виправлення (CW degrees):
//   1 → 0     (нормально)
//   3 → 180
//   6 → 270   (треба обернути CCW = +270 CW щоб виправити)
//   8 → 90    (треба обернути CW)
//   2/4/5/7 → 0 (mirroring ігноруємо — рідкісне для фото документів)
//
// Читання — мінімальний binary parser перших 64 KB JPEG. Без сторонніх
// бібліотек (екзотика на 5-10 KB не виправдана для одного 16-bit поля).

const EXIF_TO_CORRECTION_DEG = {
  1: 0,
  3: 180,
  6: 270,
  8: 90,
};

/**
 * Читає EXIF orientation tag з JPEG/HEIC Blob. Повертає кут обертання у
 * градусах (CW) необхідний для виправлення, або null якщо EXIF не знайдено
 * чи формат не JPEG.
 *
 * @param {Blob|File} blob — вхідне зображення
 * @returns {Promise<{ degrees: 0|90|180|270, rawTag: number, mirrored: boolean } | null>}
 */
export async function readExifOrientation(blob) {
  if (!(blob instanceof Blob)) return null;
  // Не-JPEG (PNG, WEBP) — EXIF немає або у іншому форматі. PNG ігноруємо
  // (стандартно PNG не має orientation метаданих).
  const type = (blob.type || '').toLowerCase();
  // HEIC має свій формат EXIF. heic2any зазвичай вже виправляє orientation
  // при конвертації — для HEIC після конверсії у JPEG він буде в EXIF.
  if (type && !type.includes('jpeg') && !type.includes('jpg') && !type.includes('heic') && !type.includes('heif')) {
    return null;
  }

  // Зчитуємо перші 64 KB — EXIF знаходиться у APP1 marker (0xFFE1) одразу
  // після SOI (0xFFD8). У реальних JPEG-файлах вкладається у перші 1-10 KB.
  const head = await blob.slice(0, 65536).arrayBuffer();
  const view = new DataView(head);

  // SOI marker = 0xFFD8
  if (view.byteLength < 4) return null;
  if (view.getUint16(0, false) !== 0xFFD8) return null;

  let offset = 2;
  while (offset < view.byteLength - 1) {
    if (view.getUint8(offset) !== 0xFF) return null;
    const marker = view.getUint8(offset + 1);
    // APP1 = 0xE1 — починається EXIF блок
    if (marker === 0xE1) {
      const segmentLength = view.getUint16(offset + 2, false);
      const exifStart = offset + 4;
      // "Exif\0\0" header
      if (
        view.byteLength < exifStart + 6 ||
        view.getUint32(exifStart, false) !== 0x45786966 || // "Exif"
        view.getUint16(exifStart + 4, false) !== 0x0000
      ) {
        return null;
      }
      const tiffStart = exifStart + 6;
      // Byte order: II = little-endian (0x4949), MM = big-endian (0x4D4D)
      const endian = view.getUint16(tiffStart, false);
      const littleEndian = endian === 0x4949;
      if (!littleEndian && endian !== 0x4D4D) return null;
      // TIFF magic = 0x002A
      if (view.getUint16(tiffStart + 2, littleEndian) !== 0x002A) return null;
      // Offset до першого IFD (від tiffStart)
      const ifdOffset = view.getUint32(tiffStart + 4, littleEndian);
      const ifdStart = tiffStart + ifdOffset;
      if (view.byteLength < ifdStart + 2) return null;
      const entriesCount = view.getUint16(ifdStart, littleEndian);
      for (let i = 0; i < entriesCount; i++) {
        const entryOffset = ifdStart + 2 + i * 12;
        if (view.byteLength < entryOffset + 12) break;
        const tag = view.getUint16(entryOffset, littleEndian);
        if (tag === 0x0112) {
          // Orientation: SHORT type, value у перших 2 байтах value field
          const orientationVal = view.getUint16(entryOffset + 8, littleEndian);
          if (orientationVal >= 1 && orientationVal <= 8) {
            const mirrored = [2, 4, 5, 7].includes(orientationVal);
            const degrees = EXIF_TO_CORRECTION_DEG[orientationVal] ?? 0;
            return { degrees, rawTag: orientationVal, mirrored };
          }
        }
      }
      return null;
    }
    // Інакше — пропускаємо segment довжини segmentLength
    if (marker === 0xD8 || marker === 0xD9) return null; // SOI/EOI
    const len = view.getUint16(offset + 2, false);
    if (len < 2) return null;
    offset += 2 + len;
  }
  return null;
}

/**
 * Завантажує Image з Blob, повертає природні розміри. Використовується
 * resolveOrientation для aspect-ratio heuristic.
 */
export async function getImageDimensions(blob) {
  if (!(blob instanceof Blob)) return null;
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('image load fail'));
      im.src = url;
    });
    return { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Об'єднує EXIF orientation і три сигнали Document AI у фінальний кут.
 *
 * НОВИЙ КАСКАД (TASK B fix Problem 2 — ПРИБРАНО aspect ratio fallback):
 *   1. EXIF (фізична орієнтація сенсором — найнадійніше для фото з телефону).
 *      Telegram/WhatsApp/Viber/Signal зазвичай strip EXIF → null.
 *   2. Document AI page.transforms (НОВЕ — найточніший метод):
 *      Document AI ВЖЕ зробив висновок про орієнтацію щоб розпізнати текст,
 *      і повернув матриці обертання. Просто читаємо їх. Якщо identity —
 *      orientation вже правильна.
 *   3. Document AI block.layout.orientation (per-block enum, dominant >50%):
 *      DocAI оцінив orientation КОЖНОГО текстового блоку. Більшість одного
 *      кута → застосовуємо.
 *   4. Document AI block geometry (bbox aspect ratio): fallback heuristic коли
 *      DocAI блок-orientation поле відсутнє/неоднозначне.
 *   5. Document AI page.orientation (page-level enum): останній DocAI сигнал.
 *   6. NONE — повертаємо 0° + uncertain=true. UI показує warning «Орієнтація
 *      не визначена, виправ вручну через ↻».
 *
 * Aspect ratio heuristic ВИДАЛЕНО — гірший за нічого. Він знав ШИРИНУ>ВИСОТУ
 * але не знав НА ЯКУ СТОРОНУ повертати (90 vs 270, 50/50 шанс), і не виявляв
 * 180°. Принцип: краще не обертати ніж обернути неправильно.
 *
 * @param {Object} opts
 * @param {Object|null} opts.exifResult — результат readExifOrientation
 * @param {Object|null} opts.docAiPage — перша сторінка Document AI pageStructure
 * @param {{ width, height }|null} opts.imageDimensions — для логів (не для рішення)
 * @param {string} opts.fileName
 * @returns {{
 *   degrees: 0|90|180|270,
 *   source: 'exif'|'docAiTransforms'|'docAiBlockField'|'docAiBlockGeometry'|'docAiPageField'|'none',
 *   uncertain: boolean,
 *   debug: object,
 *   logs: string[]
 * }}
 */
export function resolveOrientation({ exifResult, docAiPage, imageDimensions, fileName }) {
  const logs = [];
  const tag = `[orientation:${fileName || '?'}]`;

  const debug = {
    fileName: fileName || null,
    exif: exifResult ? { rawTag: exifResult.rawTag, degrees: exifResult.degrees, mirrored: exifResult.mirrored } : null,
    transforms: null,
    blockField: null,
    blockGeometry: null,
    pageField: null,
    aspect: null,
  };

  // Завжди фіксуємо aspect для логу (не для рішення — щоб бачити чи фото landscape/portrait)
  if (imageDimensions && Number.isFinite(imageDimensions.width) && Number.isFinite(imageDimensions.height)) {
    debug.aspect = {
      width: imageDimensions.width,
      height: imageDimensions.height,
      ratio: Math.round((imageDimensions.width / imageDimensions.height) * 100) / 100,
    };
  }

  // 1. EXIF
  if (exifResult && Number.isFinite(exifResult.degrees) && exifResult.degrees !== 0) {
    logs.push(`${tag} EXIF tag=${exifResult.rawTag} → rotate ${exifResult.degrees}°`);
    return { degrees: exifResult.degrees, source: 'exif', uncertain: false, debug, logs };
  }

  // 2. page.transforms — affine matrix які DocAI ЗАСТОСУВАВ при OCR
  const tResult = extractTransformsRotation(docAiPage);
  if (tResult) {
    debug.transforms = tResult;
    if (tResult.degrees !== 0) {
      logs.push(
        `${tag} page.transforms matrix=[${(tResult.matrix || []).slice(0, 4).map((v) => v.toFixed(2)).join(',')}] → rotate ${tResult.degrees}°`
      );
      return { degrees: tResult.degrees, source: 'docAiTransforms', uncertain: false, debug, logs };
    }
    logs.push(`${tag} page.transforms = identity → orientation already correct (no rotation)`);
  } else if (docAiPage && Array.isArray(docAiPage.transforms)) {
    logs.push(`${tag} page.transforms є але не вдалось декодувати (count=${docAiPage.transforms.length})`);
  } else if (docAiPage) {
    logs.push(`${tag} page.transforms відсутній у Document AI відповіді`);
  }

  // 3. block.layout.orientation — per-block enum
  const blockField = analyzeBlockOrientationField(docAiPage);
  if (blockField) {
    debug.blockField = blockField;
    if (blockField.degrees !== 0) {
      logs.push(
        `${tag} block field: ${blockField.dominantCount}/${blockField.totalCount} блоків ` +
        `орієнтація=${blockField.dominant} → rotate ${blockField.degrees}° (${blockField.confidence})`
      );
      return {
        degrees: blockField.degrees,
        source: 'docAiBlockField',
        uncertain: blockField.confidence === 'low',
        debug, logs,
      };
    }
    logs.push(`${tag} block field: більшість PAGE_UP — orientation вже правильна`);
  }

  // 4. block geometry — fallback по bbox aspect ratio
  const blockGeo = analyzeBlockGeometry(docAiPage);
  if (blockGeo) {
    debug.blockGeometry = blockGeo.debug;
    if (blockGeo.degrees !== 0) {
      logs.push(
        `${tag} block geometry: medianAspect=${blockGeo.debug.medianAspect.toFixed(2)} ` +
        `(${blockGeo.debug.blockCount} блоків) → rotate ${blockGeo.degrees}° (${blockGeo.confidence})`
      );
      return {
        degrees: blockGeo.degrees,
        source: 'docAiBlockGeometry',
        uncertain: blockGeo.confidence === 'low',
        debug, logs,
      };
    }
    logs.push(
      `${tag} block geometry: medianAspect=${blockGeo.debug.medianAspect.toFixed(2)} ` +
      `(${blockGeo.debug.blockCount} блоків) — text horizontal`
    );
  }

  // 5. page.orientation field
  const docAiDeg = extractPageOrientation(docAiPage);
  if (docAiPage && typeof docAiPage === 'object') {
    debug.pageField = {
      orientation: docAiPage.orientation ?? null,
      detectedOrientation: docAiPage.detectedOrientation ?? null,
      layoutOrientation: docAiPage.layout?.orientation ?? null,
    };
  }
  if (docAiDeg !== 0) {
    logs.push(`${tag} page.orientation field → rotate ${docAiDeg}°`);
    return { degrees: docAiDeg, source: 'docAiPageField', uncertain: false, debug, logs };
  }

  // 6. NONE — нічого не визначено. Не обертаємо. Адвокат побачить warning і
  //    виправить через ↻ якщо потрібно.
  const aspectStr = debug.aspect ? `aspect=${debug.aspect.ratio}` : 'aspect=?';
  logs.push(
    `${tag} жоден сигнал не дав orientation (${aspectStr}). НЕ обертаємо — uncertain=true. ` +
    `Адвокат виправить вручну через ↻ якщо потрібно.`
  );
  return { degrees: 0, source: 'none', uncertain: true, debug, logs };
}

/**
 * Нормалізує довільний кут у градусах до одного з 0/90/180/270.
 * Виправляє: -90 → 270, 360 → 0, 450 → 90, 17 → 0 (closest), 75 → 90.
 */
export function normalizeDegrees(angle) {
  if (!Number.isFinite(angle)) return 0;
  // Зведення у [0, 360)
  let a = angle % 360;
  if (a < 0) a += 360;
  // Найближче з {0, 90, 180, 270}
  const candidates = [0, 90, 180, 270];
  let best = 0;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.min(Math.abs(a - c), 360 - Math.abs(a - c));
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

// ── Document AI page.transforms ─────────────────────────────────────────────
//
// Document AI повертає affine transformation matrices які він ЗАСТОСУВАВ до
// зображення щоб правильно розпізнати текст. Це найточніший сигнал orientation
// — DocAI бачить літери і знає що зробив для їх читання.
//
// Формат у JSON відповіді:
//   page.transforms = [
//     { rows, cols, type, data: <base64 string> | <number[]> }
//   ]
// data — base64-закодовані bytes значень (CV_32F=4 байти/float, CV_64F=8 байт)
// у column-major порядку для affine 2×3 матриці.
//
// Конвенція матриці (column-major flat 6 значень [a,b,c,d,e,f]):
//   x' = a*x + c*y + e
//   y' = b*x + d*y + f
//
// Кардинальні обертання:
//   identity      [1, 0, 0, 1, *, *]  → 0°
//   90° CW        [0,-1, 1, 0, *, *]  → 90°
//   180°          [-1,0, 0,-1, *, *]  → 180°
//   270° CW       [0, 1,-1, 0, *, *]  → 270°
//
// Той самий кут який DocAI застосував — той ми і застосовуємо до raw image
// для виправлення.

const ROTATION_MATRIX_TOLERANCE = 0.05;

function decodeMatrix(matrix) {
  if (!matrix || matrix.data == null) return null;
  const rows = Number.isFinite(matrix.rows) ? matrix.rows : 2;
  const cols = Number.isFinite(matrix.cols) ? matrix.cols : 3;
  const total = rows * cols;
  if (total <= 0) return null;

  // Випадок 1: data — масив чисел (Google іноді так серіалізує)
  if (Array.isArray(matrix.data)) {
    if (matrix.data.length < 4) return null;
    return { values: matrix.data.slice(0, total), rows, cols };
  }

  // Випадок 2: data — base64 string
  if (typeof matrix.data !== 'string') return null;

  let bytes;
  try {
    if (typeof atob === 'function') {
      const raw = atob(matrix.data);
      bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    } else if (typeof Buffer !== 'undefined') {
      const buf = Buffer.from(matrix.data, 'base64');
      bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } else {
      return null;
    }
  } catch (e) {
    return null;
  }

  const type = matrix.type;
  // OpenCV типи: 5=CV_32FC1, 6=CV_64FC1. За замовчуванням припускаємо float32
  // (DocAI використовує саме його у більшості випадків).
  let bytesPerVal;
  let readFn;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === 6 || type === 14 || type === 22) { // CV_64FC1 чи варіанти
    bytesPerVal = 8;
    readFn = (off) => view.getFloat64(off, true);
  } else {
    bytesPerVal = 4;
    readFn = (off) => view.getFloat32(off, true);
  }

  if (bytes.byteLength < total * bytesPerVal) return null;
  const values = new Array(total);
  for (let i = 0; i < total; i++) values[i] = readFn(i * bytesPerVal);
  return { values, rows, cols };
}

function rotationFromAffineFlat(values) {
  if (!Array.isArray(values) || values.length < 4) return null;
  const T = ROTATION_MATRIX_TOLERANCE;
  const [a, b, c, d] = values;
  if (Math.abs(a - 1) < T && Math.abs(b) < T && Math.abs(c) < T && Math.abs(d - 1) < T) return 0;
  if (Math.abs(a) < T && Math.abs(b + 1) < T && Math.abs(c - 1) < T && Math.abs(d) < T) return 90;
  if (Math.abs(a + 1) < T && Math.abs(b) < T && Math.abs(c) < T && Math.abs(d + 1) < T) return 180;
  if (Math.abs(a) < T && Math.abs(b - 1) < T && Math.abs(c + 1) < T && Math.abs(d) < T) return 270;
  return null;
}

/**
 * Читає page.transforms з відповіді Document AI і витягає кут обертання який
 * DocAI застосував. Повертає той самий кут — він і є fix-кут для raw image.
 *
 * @param {Object|null} page — Document AI page
 * @returns {{ degrees: 0|90|180|270, matrix: number[] }|null}
 *   null коли немає transforms АБО не вдалось декодувати АБО матриця не
 *   відповідає кардинальному куту.
 */
export function extractTransformsRotation(page) {
  if (!page || typeof page !== 'object') return null;
  if (!Array.isArray(page.transforms) || page.transforms.length === 0) return null;
  for (const matrix of page.transforms) {
    const decoded = decodeMatrix(matrix);
    if (!decoded) continue;
    const deg = rotationFromAffineFlat(decoded.values);
    if (deg !== null) return { degrees: deg, matrix: decoded.values };
  }
  return null;
}

// ── Document AI block-level orientation field ──────────────────────────────
//
// Document AI повертає orientation КОЖНОГО block.layout (PAGE_UP/RIGHT/DOWN/
// LEFT). Якщо більшість блоків мають однакову не-UP орієнтацію — ймовірно
// зображення повернуте.

const ENUM_TO_DEG = { 0: 0, 1: 90, 2: 180, 3: 270 };
const STR_TO_DEG = {
  PAGE_UP: 0, PAGE_RIGHT: 90, PAGE_DOWN: 180, PAGE_LEFT: 270,
  page_up: 0, page_right: 90, page_down: 180, page_left: 270,
};

function readOrientationValue(v) {
  if (typeof v === 'number' && ENUM_TO_DEG[v] !== undefined) return ENUM_TO_DEG[v];
  if (typeof v === 'string' && STR_TO_DEG[v] !== undefined) return STR_TO_DEG[v];
  return null;
}

/**
 * Аналізує block.layout.orientation у всіх блоках/параграфах сторінки.
 * Повертає домінантну орієнтацію якщо >50% блоків з нею узгоджуються.
 *
 * @param {Object|null} page
 * @returns {{degrees:0|90|180|270, dominant:string, dominantCount:number, totalCount:number, confidence:'high'|'medium'|'low'}|null}
 */
export function analyzeBlockOrientationField(page) {
  if (!page || typeof page !== 'object') return null;
  const blocks = []
    .concat(Array.isArray(page.blocks) ? page.blocks : [])
    .concat(Array.isArray(page.paragraphs) ? page.paragraphs : []);
  if (blocks.length === 0) return null;

  const counts = { 0: 0, 90: 0, 180: 0, 270: 0 };
  let total = 0;
  for (const b of blocks) {
    const ori = b?.layout?.orientation;
    const deg = readOrientationValue(ori);
    if (deg !== null) {
      counts[deg]++;
      total++;
    }
  }
  if (total === 0) return null;

  let bestDeg = 0;
  let bestCount = 0;
  for (const deg of [0, 90, 180, 270]) {
    if (counts[deg] > bestCount) { bestCount = counts[deg]; bestDeg = deg; }
  }
  const fraction = bestCount / total;
  if (fraction <= 0.5) return null; // не домінантна

  const STR_FROM_DEG = { 0: 'PAGE_UP', 90: 'PAGE_RIGHT', 180: 'PAGE_DOWN', 270: 'PAGE_LEFT' };
  let confidence;
  if (fraction >= 0.85 && total >= 5) confidence = 'high';
  else if (fraction >= 0.7) confidence = 'medium';
  else confidence = 'low';

  return {
    degrees: bestDeg,
    dominant: STR_FROM_DEG[bestDeg],
    dominantCount: bestCount,
    totalCount: total,
    confidence,
  };
}

/**
 * Аналізує геометрію bounding boxes paragraphs/blocks з Document AI page.
 * Якщо більшість блоків вертикальні (height > width) у системі координат
 * IMAGE, текст йде боком → зображення повернуте на 90 або 270 градусів.
 *
 * Алгоритм:
 *   1. Витягуємо bbox кожного paragraph (fallback: block, line).
 *   2. Обчислюємо aspect = width/height для кожного.
 *   3. Median aspect:
 *      - > 1.5: текст ГОРИЗОНТАЛЬНИЙ (рядки йдуть зліва направо у image)
 *        → image upright (0°) — рідко 180° (потребує семантичного аналізу,
 *          ми його не робимо).
 *      - < 0.7: текст ВЕРТИКАЛЬНИЙ — image повернуте 90 або 270 CW.
 *        Розрізняємо 90 vs 270 за положенням НАЙБІЛЬШОГО блоку у X
 *        (зазвичай «шапка»/header документа найбільша і вгорі):
 *        - cx у правій половині → image повернуте 90 CW → fix +270 CW
 *        - cx у лівій половині → image повернуте 270 CW → fix +90 CW
 *      - 0.7..1.5: ambiguous (рукописний / складна верстка) — null.
 *
 * Confidence:
 *   - 'high': медіана сильно за порогами (<0.5 або >2.0) + 5+ блоків
 *   - 'medium': медіана у нормі (<0.7 або >1.5) + 3+ блоки
 *   - 'low': мало блоків або медіана близько до межі — uncertain=true
 *
 * @param {Object|null} page — Document AI page object
 * @returns {{degrees:0|90|180|270, confidence:'high'|'medium'|'low', debug:Object}|null}
 *   null коли немає достатньо блоків або медіана ambiguous.
 */
export function analyzeBlockGeometry(page) {
  if (!page || typeof page !== 'object') return null;
  const boxes = extractBlockBoxes(page);
  if (boxes.length < 3) return null;

  // Aspect ratio кожного блоку у image coords
  const aspects = boxes.map((b) => b.w / b.h).filter((a) => Number.isFinite(a) && a > 0);
  if (aspects.length < 3) return null;
  aspects.sort((a, b) => a - b);
  const medianAspect = aspects[Math.floor(aspects.length / 2)];

  const debug = {
    blockCount: boxes.length,
    medianAspect,
    pageWidth: page.dimension?.width || null,
    pageHeight: page.dimension?.height || null,
  };

  // Текст ГОРИЗОНТАЛЬНИЙ — image upright (0°). 180° потребувало б семантичного
  // аналізу (порядок літер у словах), не реалізуємо тут.
  if (medianAspect > 1.5) {
    return {
      degrees: 0,
      confidence: medianAspect > 2.5 && boxes.length >= 5 ? 'high' : 'medium',
      debug,
    };
  }

  // Текст ВЕРТИКАЛЬНИЙ — image повернуте 90 або 270.
  if (medianAspect < 0.7) {
    // Знайти найбільший блок (за площею) — зазвичай це основний текстовий блок
    // або header. Його X-центр відносно ширини сторінки скаже куди було
    // повернуто.
    const largest = boxes.reduce((a, b) => (a.w * a.h > b.w * b.h ? a : b));
    const pageW = page.dimension?.width || maxBy(boxes, (b) => b.x + b.w);
    const cx = largest.x + largest.w / 2;
    const xRatio = pageW > 0 ? cx / pageW : 0.5;
    debug.largestBlock = { x: largest.x, y: largest.y, w: largest.w, h: largest.h, cxRatio: xRatio };

    // Якщо largest block у правій половині image — image повернуте 90 CW
    // (header опинився справа) → fix потрібен +270 CW (= -90).
    // У лівій половині — image повернуте 270 CW → fix +90 CW.
    let degrees;
    let confidence;
    if (xRatio > 0.55) {
      degrees = 270;
      confidence = medianAspect < 0.5 && boxes.length >= 5 ? 'high' : 'medium';
    } else if (xRatio < 0.45) {
      degrees = 90;
      confidence = medianAspect < 0.5 && boxes.length >= 5 ? 'high' : 'medium';
    } else {
      // Центральний — невизначений. За замовчуванням 270 (найчастіше при
      // вертикальній камері), але mark як low confidence.
      degrees = 270;
      confidence = 'low';
    }
    return { degrees, confidence, debug };
  }

  // Ambiguous — текст не явно горизонтальний і не явно вертикальний.
  return null;
}

// Витягує bounding boxes з paragraphs (fallback на blocks, потім lines).
// Підтримує і normalizedVertices (0-1), і pixel vertices.
function extractBlockBoxes(page) {
  const tryArr = page.paragraphs || page.blocks || page.lines;
  if (!Array.isArray(tryArr) || tryArr.length === 0) {
    // Запасний шлях — глянути layout якщо є
    return [];
  }
  const pageW = page.dimension?.width || 0;
  const pageH = page.dimension?.height || 0;
  const boxes = [];
  for (const item of tryArr) {
    const poly = item?.layout?.boundingPoly;
    if (!poly) continue;
    const verts = poly.normalizedVertices || poly.vertices;
    if (!Array.isArray(verts) || verts.length < 3) continue;
    const xs = verts.map((v) => Number(v.x) || 0);
    const ys = verts.map((v) => Number(v.y) || 0);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    // Якщо це normalizedVertices, масштабуємо у pixel coords (потрібно для
    // largest-block X position). Якщо немає dimension — лишаємо у 0-1.
    let x, y, w, h;
    if (poly.normalizedVertices && pageW && pageH) {
      x = minX * pageW;
      y = minY * pageH;
      w = (maxX - minX) * pageW;
      h = (maxY - minY) * pageH;
    } else {
      x = minX;
      y = minY;
      w = maxX - minX;
      h = maxY - minY;
    }
    if (w > 0 && h > 0) boxes.push({ x, y, w, h });
  }
  return boxes;
}

function maxBy(arr, fn) {
  let m = -Infinity;
  for (const item of arr) {
    const v = fn(item);
    if (v > m) m = v;
  }
  return m;
}

/**
 * Витягає orientation з pageStructure (Document AI page object).
 * Підтримуємо кілька варіантів структури — Document AI міняв формат
 * між версіями, OCR провайдери можуть різнитись:
 *   - page.orientation (число 0-3 — enum PAGE_UP/RIGHT/DOWN/LEFT)
 *   - page.orientation (рядок 'PAGE_UP'/'PAGE_RIGHT'/'PAGE_DOWN'/'PAGE_LEFT')
 *   - page.detectedOrientation (число у градусах)
 *   - page.layout.orientation (вкладений)
 *
 * Завжди повертає 0/90/180/270.
 */
export function extractPageOrientation(page) {
  if (!page || typeof page !== 'object') return 0;

  // Варіант 1: enum 0-3
  const ENUM_TO_DEG = { 0: 0, 1: 90, 2: 180, 3: 270 };
  const STR_TO_DEG = {
    PAGE_UP: 0, PAGE_RIGHT: 90, PAGE_DOWN: 180, PAGE_LEFT: 270,
    page_up: 0, page_right: 90, page_down: 180, page_left: 270,
  };

  if (typeof page.orientation === 'number' && ENUM_TO_DEG[page.orientation] !== undefined) {
    return ENUM_TO_DEG[page.orientation];
  }
  if (typeof page.orientation === 'string' && STR_TO_DEG[page.orientation] !== undefined) {
    return STR_TO_DEG[page.orientation];
  }

  // Варіант 2: detectedOrientation у градусах
  if (Number.isFinite(page.detectedOrientation)) {
    return normalizeDegrees(page.detectedOrientation);
  }

  // Варіант 3: layout.orientation (вкладений)
  if (page.layout && typeof page.layout === 'object') {
    if (typeof page.layout.orientation === 'number' && ENUM_TO_DEG[page.layout.orientation] !== undefined) {
      return ENUM_TO_DEG[page.layout.orientation];
    }
    if (typeof page.layout.orientation === 'string' && STR_TO_DEG[page.layout.orientation] !== undefined) {
      return STR_TO_DEG[page.layout.orientation];
    }
  }

  return 0;
}

function loadImage(blobUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не вдалося завантажити зображення для обертання'));
    img.src = blobUrl;
  });
}

/**
 * Обертає Blob зображення на заданий кут і повертає новий JPEG Blob.
 * degrees=0 → повертає вхідний blob як є (no-op за принципом Розумної економії).
 *
 * @param {Blob} blob — вхідне зображення
 * @param {number} degrees — кут обертання (нормалізується до 0/90/180/270)
 * @returns {Promise<Blob>} — JPEG Blob (або вхідний blob при degrees=0)
 */
export async function rotateImageBlob(blob, degrees) {
  if (!(blob instanceof Blob)) {
    throw new Error('rotateImageBlob: blob має бути Blob');
  }
  const angle = normalizeDegrees(degrees);
  if (angle === 0) return blob; // No-op

  const blobUrl = URL.createObjectURL(blob);
  let img;
  try {
    img = await loadImage(blobUrl);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }

  // Розміри canvas після обертання: 90/270 міняють місцями, 180 не міняють.
  const swap = angle === 90 || angle === 270;
  const canvasW = swap ? img.height : img.width;
  const canvasH = swap ? img.width : img.height;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');

  // Обертання: переміщаємо origin у центр, обертаємо, малюємо центровано.
  ctx.translate(canvasW / 2, canvasH / 2);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);

  // Повертаємо JPEG (адвокатські сканування — фото з тексту, quality 0.92)
  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (out) => {
        if (out) resolve(out);
        else reject(new Error('Canvas.toBlob повернув null'));
      },
      'image/jpeg',
      0.92
    );
  });
}

// Експорт для тестів — внутрішні хелпери теж доступні
export const __test__ = {
  ALLOWED_DEGREES,
};
