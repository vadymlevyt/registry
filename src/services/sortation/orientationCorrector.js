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
 * Об'єднує EXIF orientation і Document AI orientation у фінальний кут
 * обертання. Пріоритет:
 *   1. EXIF (фізична орієнтація сенсором — найнадійніше для фото з телефону)
 *   2. Document AI orientation (для відсканованих PDF/зображень де EXIF немає)
 *   3. 0 (no-op)
 *
 * Логує своє рішення у консоль для діагностики (TASK B fix 2).
 *
 * @param {Object} opts
 * @param {Object|null} opts.exifResult — результат readExifOrientation
 * @param {Object|null} opts.docAiPage — перша сторінка Document AI pageStructure
 * @param {string} opts.fileName — для лог-повідомлень
 * @returns {{ degrees: 0|90|180|270, source: 'exif'|'docAi'|'none', logs: string[] }}
 */
export function resolveOrientation({ exifResult, docAiPage, fileName }) {
  const logs = [];
  const tag = `[orientation:${fileName || '?'}]`;

  if (exifResult && Number.isFinite(exifResult.degrees) && exifResult.degrees !== 0) {
    logs.push(`${tag} EXIF tag=${exifResult.rawTag} → rotate ${exifResult.degrees}°`);
    return { degrees: exifResult.degrees, source: 'exif', logs };
  }

  const docAiDeg = extractPageOrientation(docAiPage);
  if (docAiDeg !== 0) {
    logs.push(`${tag} Document AI orientation → rotate ${docAiDeg}°`);
    return { degrees: docAiDeg, source: 'docAi', logs };
  }

  // Обидва == 0
  if (exifResult) {
    logs.push(`${tag} EXIF tag=${exifResult.rawTag} (normal), Document AI=0 → no rotation`);
  } else if (docAiPage) {
    logs.push(`${tag} EXIF none, Document AI=0 → no rotation`);
  } else {
    logs.push(`${tag} no EXIF, no Document AI page → no rotation`);
  }
  return { degrees: 0, source: 'none', logs };
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
