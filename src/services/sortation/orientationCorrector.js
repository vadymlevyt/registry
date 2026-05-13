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
 * Завантажує Image з Blob, повертає природні розміри. Використовується тільки
 * для діагностичного логу у resolveOrientation (не впливає на рішення).
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
 * Об'єднує EXIF orientation і Document AI сигнали у фінальний кут обертання.
 *
 * КАСКАД:
 *   1. EXIF (фізична орієнтація сенсором — найнадійніше для фото з телефону).
 *      Telegram/WhatsApp/Viber/Signal зазвичай strip EXIF → null.
 *   2. Document AI page.transforms (affine matrix що DocAI застосував при OCR).
 *      Якщо identity → orientation вже правильна. Якщо кардинальне обертання
 *      → той самий кут і застосовуємо до raw image.
 *   3. Document AI blocks[].orientation (per-block enum, dominant >60%):
 *      DocAI оцінив orientation КОЖНОГО текстового блоку. Якщо >60% блоків
 *      мають однакову orientation != PAGE_UP — застосовуємо відповідне
 *      обертання. PAGE_UP домінує → 0° (image upright). Перед тим як повірити
 *      PAGE_UP робимо sanity check — block geometry: якщо >70% блоків
 *      вертикальні (h > 1.6 × w), DocAI ймовірно помилився; auto-rotate
 *      все одно не робимо (без content analysis напрямок 90 vs 270 невідомий),
 *      але повертаємо uncertain=true щоб UI попередив.
 *   4. Document AI page.orientation (page-level enum): останній DocAI сигнал
 *      коли блоків немає (тільки meta на рівні сторінки).
 *   5. NONE — повертаємо 0° + uncertain=true. Перед тим перевіряємо block
 *      geometry — якщо більшість блоків вертикальні, додаємо це у лог щоб
 *      адвокат розумів причину warning'у. UI показує «Перевір орієнтацію».
 *
 * Aspect ratio heuristic ПРИБРАНО (image-level — width vs height): вона
 * знала що ШИРИНУ > ВИСОТУ але не НА ЯКУ СТОРОНУ повертати, і не виявляла
 * 180°. Натомість block-level geometry (height vs width КОЖНОГО блоку
 * тексту) — інформативніше: вона ловить вертикальний text layout
 * (signal для 90/270 rotation) НЕЗАЛЕЖНО від aspect ratio самого фото
 * (адвокат може зробити квадратне фото повернутого документа).
 *
 * @param {Object} opts
 * @param {Object|null} opts.exifResult — результат readExifOrientation
 * @param {Object|null} opts.docAiPage — перша сторінка Document AI pageStructure
 * @param {{ width, height }|null} opts.imageDimensions — тільки для діагностичних логів
 * @param {string} opts.fileName
 * @returns {{
 *   degrees: 0|90|180|270,
 *   source: 'exif'|'docAiTransforms'|'docAiBlockField'|'docAiPageField'|'none',
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
    pageField: null,
    aspect: null,
  };

  // Завжди фіксуємо aspect для логу (тільки діагностика — не впливає на рішення)
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

  // 3. blocks[].orientation — per-block enum.
  // ОСНОВНИЙ метод. Якщо >60% блоків мають однакову orientation — застосовуємо.
  // PAGE_UP домінує → 0° (image upright), STOP cascade.
  const blockField = analyzeBlockOrientationField(docAiPage);
  if (blockField) {
    debug.blockField = blockField;
    const dist = blockField.distribution;
    const pct = Math.round((blockField.dominantCount / blockField.totalCount) * 100);
    logs.push(
      `${tag} blocks[].orientation: ${blockField.totalCount} блоків, розподіл ` +
      `[UP=${dist.PAGE_UP}, RIGHT=${dist.PAGE_RIGHT}, DOWN=${dist.PAGE_DOWN}, LEFT=${dist.PAGE_LEFT}], ` +
      `домінант ${blockField.dominant} ${pct}% (${blockField.dominantCount}/${blockField.totalCount}, ${blockField.confidence})`
    );
    if (blockField.degrees !== 0) {
      logs.push(`${tag} → rotate ${blockField.degrees}° CW (виправити ${blockField.dominant})`);
      return {
        degrees: blockField.degrees,
        source: 'docAiBlockField',
        uncertain: blockField.confidence === 'low',
        debug, logs,
      };
    }
    // PAGE_UP домінує. Перевіряємо block geometry — sanity check на випадок
    // коли DocAI помилково мітить вертикальний текст як PAGE_UP (бачив на
    // реальних фото з мессенджерів — landscape image, текст біжить
    // вертикально, але всі layout.orientation = PAGE_UP). Якщо більшість
    // блоків вертикальні — піднімаємо uncertain, адвокат побачить warning.
    const geo = analyzeBlockGeometry(docAiPage);
    if (geo) debug.blockGeometry = geo;
    if (geo && geo.tallFraction >= 0.7 && geo.total >= 5) {
      logs.push(
        `${tag} ⚠ PAGE_UP домінує АЛЕ block geometry: ${geo.tall}/${geo.total} блоків ` +
        `вертикальні (${Math.round(geo.tallFraction * 100)}%, h>1.6w). DocAI ймовірно ` +
        `пропустив orientation. Не обертаємо автоматично (без text content analysis ` +
        `напрямок 90 vs 270 невідомий), але показуємо warning «Перевір орієнтацію».`
      );
      return { degrees: 0, source: 'docAiBlockField', uncertain: true, debug, logs };
    }
    if (geo) {
      logs.push(
        `${tag} block geometry sanity check: ${geo.wide}/${geo.total} блоків горизонтальні, ` +
        `${geo.tall}/${geo.total} вертикальні — узгоджується з PAGE_UP. → 0°.`
      );
    } else {
      logs.push(`${tag} → 0° (PAGE_UP домінує, image upright; geometry даних замало для перевірки)`);
    }
    return {
      degrees: 0,
      source: 'docAiBlockField',
      uncertain: blockField.confidence === 'low',
      debug, logs,
    };
  }
  logs.push(`${tag} blocks[].orientation: блоки порожні або без orientation поля`);

  // 4. page.orientation field — останній DocAI сигнал (page-level meta)
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

  // 5. NONE — нічого не визначено. Не обертаємо. Адвокат побачить warning і
  //    виправить через ↻ якщо потрібно. Аspect ratio (image-level) ПРИБРАНО,
  //    але block geometry дає корисний сигнал у лог (якщо текст вертикальний,
  //    адвокат бачить ЧОМУ uncertain — підказка робити ↻).
  const aspectStr = debug.aspect ? `aspect=${debug.aspect.ratio}` : 'aspect=?';
  const geoNone = analyzeBlockGeometry(docAiPage);
  if (geoNone) debug.blockGeometry = geoNone;
  if (geoNone && geoNone.tallFraction >= 0.7 && geoNone.total >= 5) {
    logs.push(
      `${tag} жоден orientation сигнал не дано (${aspectStr}). АЛЕ block geometry: ` +
      `${geoNone.tall}/${geoNone.total} блоків вертикальні (${Math.round(geoNone.tallFraction * 100)}%). ` +
      `Ймовірно 90°/270° оберт — напрямок неоднозначний без content analysis. ` +
      `НЕ обертаємо — uncertain=true. Адвокат виправить через ↻.`
    );
  } else {
    logs.push(
      `${tag} жоден сигнал не дав orientation (${aspectStr}). НЕ обертаємо — uncertain=true. ` +
      `Адвокат виправить вручну через ↻ якщо потрібно.`
    );
  }
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
  // OpenCV типи: 5=CV_32FC1, 6=CV_64FC1. Document AI частіше повертає
  // float64 (doubles) — за результатом перевірки реального layout.json.
  // Default — float64; явні float32 типи перемикають на 4 байти/value.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  function tryRead(bytesPerVal, readFn) {
    if (bytes.byteLength < total * bytesPerVal) return null;
    const values = new Array(total);
    for (let i = 0; i < total; i++) values[i] = readFn(i * bytesPerVal);
    return values;
  }

  let primary, fallback;
  if (type === 5 || type === 13 || type === 21) { // явний CV_32FC*
    primary = tryRead(4, (off) => view.getFloat32(off, true));
    fallback = tryRead(8, (off) => view.getFloat64(off, true));
  } else {
    // Default float64 — DocAI standard
    primary = tryRead(8, (off) => view.getFloat64(off, true));
    fallback = tryRead(4, (off) => view.getFloat32(off, true));
  }

  // Перевага primary, але якщо primary дає NaN/Infinity — fallback.
  if (primary && primary.every((v) => Number.isFinite(v))) {
    return { values: primary, rows, cols };
  }
  if (fallback && fallback.every((v) => Number.isFinite(v))) {
    return { values: fallback, rows, cols };
  }
  return null;
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
// Document AI повертає orientation КОЖНОГО блоку (PAGE_UP/RIGHT/DOWN/LEFT).
// Якщо більшість блоків мають однакову не-UP орієнтацію — фото повернуте.
//
// СЕМАНТИКА (виправлено round 3):
//   PAGE_UP    — текст у правильній орієнтації; image upright; фікс = 0°
//   PAGE_RIGHT — текст хилиться вправо (тілт голови вправо щоб читати);
//                image rotated 90° CW від upright; фікс = 270° CW (= 90° CCW)
//   PAGE_DOWN  — text upside down; фікс = 180°
//   PAGE_LEFT  — текст хилиться вліво; image rotated 270° CW від upright;
//                фікс = 90° CW
//
// Раніше було INVERTED (PAGE_RIGHT→90, PAGE_LEFT→270) — перевернуло б фото
// у НЕправильний бік. Перевірено за реальним layout.json з photos з Viber.
//
// Numeric enum підтримуємо обидва варіанти (Document AI proto vs JSON):
//   0-based: 0=UP, 1=RIGHT, 2=DOWN, 3=LEFT
//   1-based (proto): 1=UP, 2=RIGHT, 3=DOWN, 4=LEFT, 0=UNSPECIFIED

const ENUM_TO_DEG = {
  0: 0,   // UNSPECIFIED або 0-based PAGE_UP — обидва трактуємо як upright
  1: 0,   // 1-based PAGE_UP
  2: 270, // PAGE_RIGHT (or 0-based PAGE_DOWN — collision; trust 1-based since Document AI is proto)
  3: 180, // PAGE_DOWN (1-based) or PAGE_LEFT (0-based)
  4: 90,  // PAGE_LEFT (1-based)
};
// Note: enum 2 may mean PAGE_RIGHT (1-based) OR PAGE_DOWN (0-based).
// Strings безпечніше — вони однозначні. Numeric — рідкість у JSON відповідях.

const STR_TO_DEG = {
  PAGE_UP: 0,
  PAGE_RIGHT: 270, // image rotated 90° CW → fix 270° CW (= 90° CCW)
  PAGE_DOWN: 180,
  PAGE_LEFT: 90,   // image rotated 270° CW → fix 90° CW
  page_up: 0,
  page_right: 270,
  page_down: 180,
  page_left: 90,
};

function readOrientationValue(v) {
  if (typeof v === 'string' && STR_TO_DEG[v] !== undefined) return STR_TO_DEG[v];
  if (typeof v === 'number' && ENUM_TO_DEG[v] !== undefined) return ENUM_TO_DEG[v];
  return null;
}

const DOMINANT_THRESHOLD = 0.6; // user spec — >60% блоків з однією orientation

/**
 * Аналізує orientation у всіх блоках/параграфах сторінки. Читає
 * `block.orientation` І `block.layout.orientation` (DocAI віддає в обох
 * формах залежно від версії API).
 *
 * Повертає домінантну орієнтацію якщо >60% блоків з нею узгоджуються.
 *
 * @param {Object|null} page
 * @returns {{degrees:0|90|180|270, dominant:string, dominantCount:number, totalCount:number, confidence:'high'|'medium'|'low', distribution:object}|null}
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
    // Підтримуємо обидва шляхи — top-level і всередині layout
    const ori = b?.orientation ?? b?.layout?.orientation;
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
  if (fraction < DOMINANT_THRESHOLD) return null; // не домінантна

  const STR_FROM_DEG = { 0: 'PAGE_UP', 90: 'PAGE_LEFT', 180: 'PAGE_DOWN', 270: 'PAGE_RIGHT' };
  let confidence;
  if (fraction >= 0.85 && total >= 5) confidence = 'high';
  else if (fraction >= 0.7) confidence = 'medium';
  else confidence = 'low';

  const distribution = {
    PAGE_UP: counts[0],
    PAGE_LEFT: counts[90],
    PAGE_DOWN: counts[180],
    PAGE_RIGHT: counts[270],
  };

  return {
    degrees: bestDeg,
    dominant: STR_FROM_DEG[bestDeg],
    dominantCount: bestCount,
    totalCount: total,
    confidence,
    distribution,
  };
}

// ── Block geometry sanity check ─────────────────────────────────────────────
//
// На реальних фото з мессенджерів (Telegram/WhatsApp strip EXIF) траплялись
// випадки коли Document AI повертав ВСІ blocks[].layout.orientation = PAGE_UP
// для landscape-фото з вертикальним текстом — тобто DocAI не помітив що фото
// повернуте, але блоки які він вирізав були ВИСОКИМИ і ВУЗЬКИМИ (бо текст
// біг вертикально у image coords). Block bbox geometry — додатковий sanity
// check: рахуємо скільки блоків таких, що h > 1.6×w (suttєво вищі за ширші).
//
// Ratio 1.6 обраний емпірично: типовий paragraph horizontal text дає
// w/h ≈ 3-10 (широкий і не дуже високий); vertical text у тих же блоках —
// w/h ≈ 0.1-0.3. Поріг 1/1.6 = 0.625 чітко відсікає горизонтальні від
// вертикальних, з мізерним overlap зони (квадратні блоки типу штампів —
// мала група).
//
// Цей сигнал виявляє 90° vs 270° (text running vertically), НЕ виявляє 180°
// (текст усе ще горизонтальний, лише перевернутий). Для 180° треба покладатись
// на blocks[].orientation field з DocAI або content analysis.

/**
 * Аналізує bounding box geometry блоків. Повертає статистику горизонтальних
 * vs вертикальних блоків. Використовується як sanity check для PAGE_UP-
 * домінантного blocks[].orientation і для NONE-гілки каскаду.
 *
 * @param {Object|null} page
 * @returns {{tall:number, wide:number, square:number, total:number, tallFraction:number, wideFraction:number}|null}
 *   null коли блоків замало для статистики (<3 з валідним bbox) або page відсутній.
 */
export function analyzeBlockGeometry(page) {
  if (!page || typeof page !== 'object') return null;
  const blocks = []
    .concat(Array.isArray(page.blocks) ? page.blocks : [])
    .concat(Array.isArray(page.paragraphs) ? page.paragraphs : []);
  if (blocks.length === 0) return null;

  let tall = 0, wide = 0, square = 0;
  for (const b of blocks) {
    const poly = b?.layout?.boundingPoly || b?.boundingPoly;
    if (!poly) continue;
    const verts = Array.isArray(poly.normalizedVertices) && poly.normalizedVertices.length > 0
      ? poly.normalizedVertices
      : (Array.isArray(poly.vertices) ? poly.vertices : null);
    if (!verts || verts.length === 0) continue;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const v of verts) {
      const x = Number(v?.x ?? 0);
      const y = Number(v?.y ?? 0);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const w = maxX - minX;
    const h = maxY - minY;
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) continue;
    const ratio = w / h;
    if (ratio < 1 / 1.6) tall++;
    else if (ratio > 1.6) wide++;
    else square++;
  }
  const total = tall + wide + square;
  if (total < 3) return null;
  return {
    tall, wide, square, total,
    tallFraction: tall / total,
    wideFraction: wide / total,
  };
}

/**
 * Витягає orientation з pageStructure (Document AI page object).
 * Підтримуємо кілька варіантів структури — Document AI міняв формат
 * між версіями, OCR провайдери можуть різнитись:
 *   - page.orientation (число enum PAGE_UP/RIGHT/DOWN/LEFT)
 *   - page.orientation (рядок 'PAGE_UP'/'PAGE_RIGHT'/'PAGE_DOWN'/'PAGE_LEFT')
 *   - page.detectedOrientation (число у градусах)
 *   - page.layout.orientation (вкладений)
 *
 * Семантика виправлена round 3:
 *   PAGE_RIGHT → 270° CW (image rotated 90° CW від upright; фікс — 90° CCW)
 *   PAGE_LEFT  → 90°  CW (image rotated 270° CW; фікс — 90° CW)
 *
 * Завжди повертає 0/90/180/270.
 */
export function extractPageOrientation(page) {
  if (!page || typeof page !== 'object') return 0;

  // Top-level orientation
  const topDeg = readOrientationValue(page.orientation);
  if (topDeg !== null) return topDeg;

  // detectedOrientation у градусах (рідкісний варіант)
  if (Number.isFinite(page.detectedOrientation)) {
    return normalizeDegrees(page.detectedOrientation);
  }

  // Nested layout.orientation
  if (page.layout && typeof page.layout === 'object') {
    const nested = readOrientationValue(page.layout.orientation);
    if (nested !== null) return nested;
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
