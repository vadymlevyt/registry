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
