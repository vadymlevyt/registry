// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  rotateImageBlob,
  normalizeDegrees,
  extractPageOrientation,
  readExifOrientation,
  resolveOrientation,
  analyzeBlockOrientationField,
  analyzeBlockGeometry,
  extractTransformsRotation,
} from '../../src/services/sortation/orientationCorrector.js';

// Helper: створити Document AI page object з n блоків заданого розміру.
// vertices у normalized coords (0-1). dimension — page розміри у pixels.
function makePage({ dimension = { width: 1000, height: 1500 }, blocks = [] } = {}) {
  return {
    dimension,
    paragraphs: blocks.map((b) => ({
      layout: {
        boundingPoly: {
          normalizedVertices: [
            { x: b.x, y: b.y },
            { x: b.x + b.w, y: b.y },
            { x: b.x + b.w, y: b.y + b.h },
            { x: b.x, y: b.y + b.h },
          ],
        },
      },
    })),
  };
}

describe('orientationCorrector.normalizeDegrees', () => {
  it('точні значення повертаються як є', () => {
    expect(normalizeDegrees(0)).toBe(0);
    expect(normalizeDegrees(90)).toBe(90);
    expect(normalizeDegrees(180)).toBe(180);
    expect(normalizeDegrees(270)).toBe(270);
  });

  it('від\'ємні нормалізуються', () => {
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(-180)).toBe(180);
  });

  it('значення >360 нормалізуються по модулю', () => {
    expect(normalizeDegrees(360)).toBe(0);
    expect(normalizeDegrees(450)).toBe(90);
    expect(normalizeDegrees(720)).toBe(0);
  });

  it('довільний angle округлюється до найближчого з {0,90,180,270}', () => {
    expect(normalizeDegrees(17)).toBe(0);
    expect(normalizeDegrees(45)).toBe(0);   // tie-break ranne (closest)
    expect(normalizeDegrees(50)).toBe(90);
    expect(normalizeDegrees(85)).toBe(90);
    expect(normalizeDegrees(170)).toBe(180);
    expect(normalizeDegrees(225)).toBe(180); // tie-break — найближчий
    expect(normalizeDegrees(260)).toBe(270);
    expect(normalizeDegrees(350)).toBe(0);
  });

  it('не-finite → 0', () => {
    expect(normalizeDegrees(NaN)).toBe(0);
    expect(normalizeDegrees(Infinity)).toBe(0);
    expect(normalizeDegrees(undefined)).toBe(0);
  });
});

describe('orientationCorrector.extractPageOrientation', () => {
  it('null/undefined → 0', () => {
    expect(extractPageOrientation(null)).toBe(0);
    expect(extractPageOrientation(undefined)).toBe(0);
    expect(extractPageOrientation({})).toBe(0);
  });

  it('enum 1-based proto: 1=UP, 2=RIGHT, 3=DOWN, 4=LEFT', () => {
    expect(extractPageOrientation({ orientation: 0 })).toBe(0); // UNSPECIFIED або 0-based UP
    expect(extractPageOrientation({ orientation: 1 })).toBe(0); // PAGE_UP (1-based)
    expect(extractPageOrientation({ orientation: 2 })).toBe(270); // PAGE_RIGHT
    expect(extractPageOrientation({ orientation: 3 })).toBe(180); // PAGE_DOWN
    expect(extractPageOrientation({ orientation: 4 })).toBe(90); // PAGE_LEFT
  });

  it('рядок PAGE_UP/PAGE_RIGHT/PAGE_DOWN/PAGE_LEFT — fix angles', () => {
    // PAGE_RIGHT = image rotated 90° CW, fix = 270° CW (90° CCW)
    // PAGE_LEFT = image rotated 270° CW, fix = 90° CW
    expect(extractPageOrientation({ orientation: 'PAGE_UP' })).toBe(0);
    expect(extractPageOrientation({ orientation: 'PAGE_RIGHT' })).toBe(270);
    expect(extractPageOrientation({ orientation: 'PAGE_DOWN' })).toBe(180);
    expect(extractPageOrientation({ orientation: 'PAGE_LEFT' })).toBe(90);
  });

  it('detectedOrientation у градусах', () => {
    expect(extractPageOrientation({ detectedOrientation: 90 })).toBe(90);
    expect(extractPageOrientation({ detectedOrientation: -90 })).toBe(270);
    expect(extractPageOrientation({ detectedOrientation: 360 })).toBe(0);
  });

  it('вкладене у layout.orientation', () => {
    expect(extractPageOrientation({ layout: { orientation: 3 } })).toBe(180); // PAGE_DOWN
    expect(extractPageOrientation({ layout: { orientation: 'PAGE_LEFT' } })).toBe(90);
  });

  it('пріоритет page.orientation над detectedOrientation', () => {
    // Якщо обидва задані — orientation виграє як більш надійне
    expect(extractPageOrientation({ orientation: 'PAGE_LEFT', detectedOrientation: 270 })).toBe(90);
  });

  it('невалідні enum значення → 0 (fallback)', () => {
    expect(extractPageOrientation({ orientation: 99 })).toBe(0);
    expect(extractPageOrientation({ orientation: -1 })).toBe(0);
    expect(extractPageOrientation({ orientation: 'PAGE_UNKNOWN' })).toBe(0);
  });
});

// ── EXIF orientation reader (TASK B fix 2) ─────────────────────────────────
//
// Конструюємо мінімальний JPEG з APP1 EXIF segment що містить Orientation tag.
// Структура:
//   0xFFD8 (SOI)
//   0xFFE1 (APP1) + length + "Exif\0\0" + TIFF header + IFD з Orientation entry
//   0xFFD9 (EOI)

function buildJpegWithExifOrientation(orientationVal, { littleEndian = true } = {}) {
  // Computed sizes:
  //   APP1 segment = "Exif\0\0" (6) + TIFF header (8) + IFD count (2) + 1 entry (12) + next IFD ptr (4) = 32
  //   APP1 length field includes itself = 32 + 2 = 34 bytes
  const buf = new ArrayBuffer(2 + 2 + 2 + 32 + 2);
  const v = new DataView(buf);
  let p = 0;
  v.setUint16(p, 0xFFD8, false); p += 2; // SOI
  v.setUint16(p, 0xFFE1, false); p += 2; // APP1 marker
  v.setUint16(p, 34, false); p += 2;     // segment length (incl. length field)

  // "Exif\0\0"
  v.setUint8(p, 0x45); p += 1; // E
  v.setUint8(p, 0x78); p += 1; // x
  v.setUint8(p, 0x69); p += 1; // i
  v.setUint8(p, 0x66); p += 1; // f
  v.setUint8(p, 0x00); p += 1;
  v.setUint8(p, 0x00); p += 1;

  const tiffStart = p;
  // Byte order
  v.setUint16(p, littleEndian ? 0x4949 : 0x4D4D, false); p += 2;
  // TIFF magic 0x002A
  v.setUint16(p, 0x002A, littleEndian); p += 2;
  // Offset to first IFD = 8 (right after TIFF header)
  v.setUint32(p, 8, littleEndian); p += 4;
  // IFD count = 1
  v.setUint16(p, 1, littleEndian); p += 2;
  // Entry: tag=0x0112 (Orientation), type=3 (SHORT), count=1, value=orientationVal
  v.setUint16(p, 0x0112, littleEndian); p += 2;
  v.setUint16(p, 3, littleEndian); p += 2;
  v.setUint32(p, 1, littleEndian); p += 4;
  v.setUint16(p, orientationVal, littleEndian); p += 2;
  v.setUint16(p, 0, littleEndian); p += 2; // padding to 4 bytes
  // Next IFD offset = 0
  v.setUint32(p, 0, littleEndian); p += 4;

  // EOI
  v.setUint16(p, 0xFFD9, false); p += 2;

  return new Blob([buf], { type: 'image/jpeg' });
}

describe('orientationCorrector.readExifOrientation', () => {
  it('повертає null для не-Blob', async () => {
    expect(await readExifOrientation(null)).toBeNull();
    expect(await readExifOrientation('not a blob')).toBeNull();
  });

  it('повертає null для PNG (mime не jpeg/heic)', async () => {
    const pngBlob = new Blob([new Uint8Array([0x89, 0x50, 0x4E, 0x47])], { type: 'image/png' });
    expect(await readExifOrientation(pngBlob)).toBeNull();
  });

  it('JPEG без EXIF → null', async () => {
    // Просто SOI + EOI без APP1
    const buf = new ArrayBuffer(4);
    const v = new DataView(buf);
    v.setUint16(0, 0xFFD8, false);
    v.setUint16(2, 0xFFD9, false);
    const blob = new Blob([buf], { type: 'image/jpeg' });
    expect(await readExifOrientation(blob)).toBeNull();
  });

  it('EXIF orientation=1 (Normal) → degrees=0', async () => {
    const blob = buildJpegWithExifOrientation(1);
    const result = await readExifOrientation(blob);
    expect(result).toEqual({ degrees: 0, rawTag: 1, mirrored: false });
  });

  it('EXIF orientation=3 (Rotated 180°) → degrees=180', async () => {
    const blob = buildJpegWithExifOrientation(3);
    const result = await readExifOrientation(blob);
    expect(result.degrees).toBe(180);
    expect(result.rawTag).toBe(3);
  });

  it('EXIF orientation=6 (90° CW) → degrees=270 (correction CW)', async () => {
    const blob = buildJpegWithExifOrientation(6);
    const result = await readExifOrientation(blob);
    expect(result.degrees).toBe(270);
    expect(result.rawTag).toBe(6);
  });

  it('EXIF orientation=8 (90° CCW) → degrees=90', async () => {
    const blob = buildJpegWithExifOrientation(8);
    const result = await readExifOrientation(blob);
    expect(result.degrees).toBe(90);
    expect(result.rawTag).toBe(8);
  });

  it('EXIF orientation=2 (mirrored) → degrees=0, mirrored=true', async () => {
    const blob = buildJpegWithExifOrientation(2);
    const result = await readExifOrientation(blob);
    expect(result.degrees).toBe(0);
    expect(result.mirrored).toBe(true);
  });

  it('big-endian EXIF читається правильно', async () => {
    const blob = buildJpegWithExifOrientation(6, { littleEndian: false });
    const result = await readExifOrientation(blob);
    expect(result.rawTag).toBe(6);
    expect(result.degrees).toBe(270);
  });

  it('значення поза 1-8 → null', async () => {
    const blob = buildJpegWithExifOrientation(15);
    const result = await readExifOrientation(blob);
    expect(result).toBeNull();
  });
});

// ── resolveOrientation ───────────────────────────────────────────────────

describe('orientationCorrector.resolveOrientation', () => {
  it('EXIF != 0 — priority over docAi', () => {
    const r = resolveOrientation({
      exifResult: { degrees: 90, rawTag: 8, mirrored: false },
      docAiPage: { orientation: 'PAGE_DOWN' }, // Document AI каже 180
      fileName: 'photo.jpg',
    });
    expect(r.degrees).toBe(90);
    expect(r.source).toBe('exif');
    expect(r.logs.some((l) => l.includes('EXIF tag=8'))).toBe(true);
  });

  it('EXIF = 0, docAi != 0 → docAi', () => {
    const r = resolveOrientation({
      exifResult: { degrees: 0, rawTag: 1, mirrored: false },
      docAiPage: { orientation: 'PAGE_LEFT' }, // 90° fix
      fileName: 'scan.pdf',
    });
    expect(r.degrees).toBe(90);
    expect(r.source).toBe('docAiPageField');
  });

  it('обидва = 0 → none', () => {
    const r = resolveOrientation({
      exifResult: { degrees: 0, rawTag: 1, mirrored: false },
      docAiPage: { orientation: 'PAGE_UP' },
      fileName: 'doc.jpg',
    });
    expect(r.degrees).toBe(0);
    // PAGE_UP без блоків теж триггерить docAiPageField з 0
    expect(['none', 'docAiPageField']).toContain(r.source);
  });

  it('EXIF відсутній, docAi != 0 → docAi', () => {
    const r = resolveOrientation({
      exifResult: null,
      docAiPage: { detectedOrientation: 90 },
      fileName: 'scan.jpg',
    });
    expect(r.degrees).toBe(90);
    expect(r.source).toBe('docAiPageField');
  });

  it('EXIF і docAi обидва відсутні → none', () => {
    const r = resolveOrientation({
      exifResult: null,
      docAiPage: null,
      fileName: 'mystery.jpg',
    });
    expect(r.degrees).toBe(0);
    expect(r.source).toBe('none');
    expect(r.logs.length).toBeGreaterThan(0);
  });

  // ── No-signal cascade (TASK B fix Problem 2 — aspect ratio видалено) ──
  // Aspect ratio fallback прибрано: гірший за нічого. Знав ширину/висоту
  // але не напрямок (90 vs 270 — 50/50 шанс), і не виявляв 180°.
  // Тепер коли всі сигнали мовчать — НЕ обертаємо, ставимо uncertain=true,
  // адвокат виправить вручну через ↻.

  it('всі сигнали порожні + landscape → 0°, source=none, uncertain=true', () => {
    const r = resolveOrientation({
      exifResult: null,
      docAiPage: { orientation: 0 },
      imageDimensions: { width: 1800, height: 1350 },
      fileName: 'photo.jpg',
    });
    expect(r.degrees).toBe(0);
    expect(r.source).toBe('none');
    expect(r.uncertain).toBe(true);
    expect(r.debug.aspect.ratio).toBeCloseTo(1.33, 2);
  });

  it('всі сигнали порожні + portrait → 0°, source=none, uncertain=true', () => {
    const r = resolveOrientation({
      exifResult: null,
      docAiPage: { orientation: 0 },
      imageDimensions: { width: 1350, height: 1800 },
      fileName: 'photo.jpg',
    });
    expect(r.degrees).toBe(0);
    expect(r.source).toBe('none');
    // Без сигналу — не знаємо, помічаємо uncertain=true
    expect(r.uncertain).toBe(true);
  });

  it('EXIF реальний → не торкаємо інші сигнали', () => {
    const r = resolveOrientation({
      exifResult: { degrees: 90, rawTag: 8, mirrored: false },
      docAiPage: { orientation: 0 },
      imageDimensions: { width: 1800, height: 1350 },
      fileName: 'photo.jpg',
    });
    expect(r.degrees).toBe(90);
    expect(r.source).toBe('exif');
    expect(r.uncertain).toBe(false);
  });

  it('page.orientation string → джерело docAiPageField', () => {
    const r = resolveOrientation({
      exifResult: null,
      docAiPage: { orientation: 'PAGE_LEFT' }, // 90° fix
      imageDimensions: { width: 1800, height: 1350 },
      fileName: 'scan.jpg',
    });
    expect(r.degrees).toBe(90);
    expect(r.source).toBe('docAiPageField');
    expect(r.uncertain).toBe(false);
  });

  it('debug містить усі сигнали для діагностики', () => {
    const r = resolveOrientation({
      exifResult: null,
      docAiPage: { orientation: 0, dimension: { width: 1800, height: 1350 } },
      imageDimensions: { width: 1800, height: 1350 },
      fileName: 'IMG-test.jpg',
    });
    expect(r.debug).toBeTruthy();
    expect(r.debug.fileName).toBe('IMG-test.jpg');
    expect(r.debug).toHaveProperty('transforms');
    expect(r.debug).toHaveProperty('blockField');
    expect(r.debug).toHaveProperty('pageField');
    expect(r.debug.aspect).toBeTruthy();
    // blockGeometry прибрано з debug (aspect ratio fallback видалено)
    expect(r.debug).not.toHaveProperty('blockGeometry');
  });
});

describe('orientationCorrector.rotateImageBlob', () => {
  // jsdom не має Canvas API повністю — мокаємо canvas і Image.
  let originalCreateElement;
  let canvasToBlobMock;

  beforeEach(() => {
    originalCreateElement = document.createElement.bind(document);

    canvasToBlobMock = vi.fn((cb) => {
      // Передаємо фейк-Blob у callback
      cb(new Blob(['fake-rotated-jpeg'], { type: 'image/jpeg' }));
    });

    // Мок canvas
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            translate: vi.fn(),
            rotate: vi.fn(),
            drawImage: vi.fn(),
          }),
          toBlob: canvasToBlobMock,
        };
      }
      return originalCreateElement(tag);
    });

    // Мок Image — onload одразу
    global.Image = class {
      constructor() {
        this.width = 100;
        this.height = 200;
        setTimeout(() => this.onload && this.onload(), 0);
      }
    };

    // Мок URL.createObjectURL/revokeObjectURL
    global.URL.createObjectURL = vi.fn(() => 'blob:fake-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  it('degrees=0 → no-op, повертає той самий blob', async () => {
    const input = new Blob(['original'], { type: 'image/jpeg' });
    const result = await rotateImageBlob(input, 0);
    expect(result).toBe(input);
    expect(canvasToBlobMock).not.toHaveBeenCalled();
  });

  it('degrees=90 → обертає, повертає новий JPEG Blob', async () => {
    const input = new Blob(['original'], { type: 'image/jpeg' });
    const result = await rotateImageBlob(input, 90);
    expect(result).not.toBe(input);
    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe('image/jpeg');
    expect(canvasToBlobMock).toHaveBeenCalledOnce();
  });

  it('degrees=180/270 теж обертають', async () => {
    const input = new Blob(['original'], { type: 'image/jpeg' });
    await rotateImageBlob(input, 180);
    expect(canvasToBlobMock).toHaveBeenCalledOnce();
    canvasToBlobMock.mockClear();
    await rotateImageBlob(input, 270);
    expect(canvasToBlobMock).toHaveBeenCalledOnce();
  });

  it('нестандартний angle нормалізується (75 → 90 → обертає)', async () => {
    const input = new Blob(['original'], { type: 'image/jpeg' });
    await rotateImageBlob(input, 75);
    expect(canvasToBlobMock).toHaveBeenCalledOnce();
  });

  it('нестандартний angle (17) нормалізується у 0 → no-op', async () => {
    const input = new Blob(['original'], { type: 'image/jpeg' });
    const result = await rotateImageBlob(input, 17);
    expect(result).toBe(input);
    expect(canvasToBlobMock).not.toHaveBeenCalled();
  });

  it('кидає помилку якщо blob не Blob', async () => {
    await expect(rotateImageBlob('not a blob', 90)).rejects.toThrow(/Blob/);
    await expect(rotateImageBlob(null, 90)).rejects.toThrow(/Blob/);
  });

  it('очищує blob URL після обертання (revokeObjectURL викликається)', async () => {
    const input = new Blob(['original'], { type: 'image/jpeg' });
    await rotateImageBlob(input, 90);
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });

  it('swap dimensions для 90/270 — canvas width = img.height і навпаки', async () => {
    let capturedCanvas = null;
    document.createElement.mockImplementation((tag) => {
      if (tag === 'canvas') {
        capturedCanvas = {
          width: 0,
          height: 0,
          getContext: () => ({
            translate: vi.fn(),
            rotate: vi.fn(),
            drawImage: vi.fn(),
          }),
          toBlob: canvasToBlobMock,
        };
        return capturedCanvas;
      }
      return originalCreateElement(tag);
    });

    await rotateImageBlob(new Blob(['x'], { type: 'image/jpeg' }), 90);
    // Image мок дає width=100, height=200. Після rotate 90: canvas повинен мати 200×100.
    expect(capturedCanvas.width).toBe(200);
    expect(capturedCanvas.height).toBe(100);
  });

  it('180 НЕ міняє dimensions (тільки 90/270 swap)', async () => {
    let capturedCanvas = null;
    document.createElement.mockImplementation((tag) => {
      if (tag === 'canvas') {
        capturedCanvas = {
          width: 0,
          height: 0,
          getContext: () => ({
            translate: vi.fn(),
            rotate: vi.fn(),
            drawImage: vi.fn(),
          }),
          toBlob: canvasToBlobMock,
        };
        return capturedCanvas;
      }
      return originalCreateElement(tag);
    });

    await rotateImageBlob(new Blob(['x'], { type: 'image/jpeg' }), 180);
    expect(capturedCanvas.width).toBe(100);
    expect(capturedCanvas.height).toBe(200);
  });
});

describe('orientationCorrector.resolveOrientation без сигналів (aspect ratio fallback видалено)', () => {
  it('блоки геометрично вертикальні але без orientation field → 0° uncertain', () => {
    // Колишній blockGeometry fallback ловив би це за aspect ratio. Тепер —
    // якщо blocks[].orientation відсутній, не вгадуємо.
    const page = makePage({
      blocks: [
        { x: 0.80, y: 0.1, w: 0.12, h: 0.7 },
        { x: 0.55, y: 0.15, w: 0.10, h: 0.6 },
        { x: 0.35, y: 0.20, w: 0.08, h: 0.5 },
        { x: 0.15, y: 0.25, w: 0.08, h: 0.4 },
      ],
    });
    const r = resolveOrientation({
      exifResult: null,
      docAiPage: page,
      imageDimensions: { width: 1800, height: 1350 },
      fileName: 'test.jpg',
    });
    expect(r.degrees).toBe(0);
    expect(r.source).toBe('none');
    expect(r.uncertain).toBe(true);
  });

  it('блоки з orientation field — каскад спрацьовує', () => {
    const page = {
      dimension: { width: 1000, height: 1500 },
      blocks: [
        { orientation: 'PAGE_RIGHT' },
        { orientation: 'PAGE_RIGHT' },
        { orientation: 'PAGE_RIGHT' },
        { orientation: 'PAGE_RIGHT' },
      ],
    };
    const r = resolveOrientation({
      exifResult: null,
      docAiPage: page,
      imageDimensions: { width: 1800, height: 1350 },
      fileName: 'test.jpg',
    });
    expect(r.degrees).toBe(270);
    expect(r.source).toBe('docAiBlockField');
  });
});

// ── extractTransformsRotation (TASK B fix Problem 2) ──────────────────────
describe('orientationCorrector.extractTransformsRotation', () => {
  // Хелпер: створити decoded matrix object з flat values.
  function matrixFromValues(values) {
    return { rows: 2, cols: 3, type: 5, data: values };
  }

  it('null коли transforms відсутні', () => {
    expect(extractTransformsRotation(null)).toBe(null);
    expect(extractTransformsRotation({})).toBe(null);
    expect(extractTransformsRotation({ transforms: [] })).toBe(null);
  });

  it('identity matrix → 0°', () => {
    const page = { transforms: [matrixFromValues([1, 0, 0, 1, 0, 0])] };
    const r = extractTransformsRotation(page);
    expect(r).not.toBe(null);
    expect(r.degrees).toBe(0);
  });

  it('90° CW matrix [0,-1,1,0,*,*] → 90°', () => {
    const page = { transforms: [matrixFromValues([0, -1, 1, 0, 0, 1800])] };
    const r = extractTransformsRotation(page);
    expect(r).not.toBe(null);
    expect(r.degrees).toBe(90);
  });

  it('180° matrix [-1,0,0,-1,*,*] → 180°', () => {
    const page = { transforms: [matrixFromValues([-1, 0, 0, -1, 1350, 1800])] };
    const r = extractTransformsRotation(page);
    expect(r).not.toBe(null);
    expect(r.degrees).toBe(180);
  });

  it('270° CW matrix [0,1,-1,0,*,*] → 270°', () => {
    const page = { transforms: [matrixFromValues([0, 1, -1, 0, 1350, 0])] };
    const r = extractTransformsRotation(page);
    expect(r).not.toBe(null);
    expect(r.degrees).toBe(270);
  });

  it('non-cardinal matrix → null', () => {
    const page = { transforms: [matrixFromValues([0.7, 0.7, -0.7, 0.7, 0, 0])] }; // 45°
    expect(extractTransformsRotation(page)).toBe(null);
  });

  it('base64-encoded float32 matrix декодується', () => {
    // [0, -1, 1, 0, 0, 1800] як CV_32F (4 байти/значення, little-endian)
    const buf = new ArrayBuffer(24);
    const view = new DataView(buf);
    view.setFloat32(0, 0, true);
    view.setFloat32(4, -1, true);
    view.setFloat32(8, 1, true);
    view.setFloat32(12, 0, true);
    view.setFloat32(16, 0, true);
    view.setFloat32(20, 1800, true);
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');

    const page = { transforms: [{ rows: 2, cols: 3, type: 5, data: b64 }] };
    const r = extractTransformsRotation(page);
    expect(r).not.toBe(null);
    expect(r.degrees).toBe(90);
  });

  it('пропускає невалідну матрицю і йде до наступної', () => {
    const page = {
      transforms: [
        { rows: 0, cols: 0, type: 5, data: '' },        // невалідна
        matrixFromValues([0, 1, -1, 0, 1350, 0]),       // 270°
      ],
    };
    const r = extractTransformsRotation(page);
    expect(r).not.toBe(null);
    expect(r.degrees).toBe(270);
  });
});

// ── analyzeBlockOrientationField (TASK B fix Problem 2) ───────────────────
describe('orientationCorrector.analyzeBlockOrientationField', () => {
  function pageWithOrientations(orientations) {
    return {
      blocks: orientations.map((o) => ({ layout: { orientation: o } })),
    };
  }

  it('null коли немає блоків', () => {
    expect(analyzeBlockOrientationField(null)).toBe(null);
    expect(analyzeBlockOrientationField({})).toBe(null);
    expect(analyzeBlockOrientationField({ blocks: [] })).toBe(null);
  });

  it('null коли блоки без orientation', () => {
    const page = { blocks: [{ layout: {} }, { layout: {} }] };
    expect(analyzeBlockOrientationField(page)).toBe(null);
  });

  it('усі блоки PAGE_RIGHT → 270° fix, high confidence', () => {
    // PAGE_RIGHT означає image rotated 90° CW; фікс 270° CW (= 90° CCW)
    const page = pageWithOrientations(['PAGE_RIGHT', 'PAGE_RIGHT', 'PAGE_RIGHT', 'PAGE_RIGHT', 'PAGE_RIGHT']);
    const r = analyzeBlockOrientationField(page);
    expect(r.degrees).toBe(270);
    expect(r.dominant).toBe('PAGE_RIGHT');
    expect(r.confidence).toBe('high');
    expect(r.dominantCount).toBe(5);
    expect(r.totalCount).toBe(5);
  });

  it('80% PAGE_LEFT → 90° fix, medium confidence', () => {
    // PAGE_LEFT = image rotated 270° CW; фікс 90° CW
    const page = pageWithOrientations(['PAGE_LEFT', 'PAGE_LEFT', 'PAGE_LEFT', 'PAGE_LEFT', 'PAGE_UP']);
    const r = analyzeBlockOrientationField(page);
    expect(r.degrees).toBe(90);
    expect(r.confidence).toBe('medium');
  });

  it('50/50 → null (не домінантна, threshold 60%)', () => {
    const page = pageWithOrientations(['PAGE_UP', 'PAGE_UP', 'PAGE_RIGHT', 'PAGE_RIGHT']);
    expect(analyzeBlockOrientationField(page)).toBe(null);
  });

  it('PAGE_DOWN dominant → 180° fix', () => {
    const page = pageWithOrientations(['PAGE_DOWN', 'PAGE_DOWN', 'PAGE_DOWN', 'PAGE_DOWN']);
    const r = analyzeBlockOrientationField(page);
    expect(r.degrees).toBe(180);
  });

  it('читає block.orientation top-level (не лише layout.orientation)', () => {
    const page = {
      blocks: [
        { orientation: 'PAGE_LEFT' },
        { orientation: 'PAGE_LEFT' },
        { orientation: 'PAGE_LEFT' },
        { orientation: 'PAGE_LEFT' },
      ],
    };
    const r = analyzeBlockOrientationField(page);
    expect(r.degrees).toBe(90); // PAGE_LEFT fix
    expect(r.totalCount).toBe(4);
  });

  it('розподіл повертається у result для діагностики', () => {
    const page = pageWithOrientations(['PAGE_RIGHT', 'PAGE_RIGHT', 'PAGE_RIGHT', 'PAGE_UP']);
    const r = analyzeBlockOrientationField(page);
    expect(r.distribution).toEqual({ PAGE_UP: 1, PAGE_LEFT: 0, PAGE_DOWN: 0, PAGE_RIGHT: 3 });
  });
});

// ── Cascade priority (TASK B fix Problem 2) ───────────────────────────────
describe('orientationCorrector.resolveOrientation cascade priority', () => {
  it('transforms > blockField > blockGeometry > pageField', () => {
    const page = {
      orientation: 'PAGE_LEFT',                 // pageField → 90° fix
      transforms: [{ rows: 2, cols: 3, type: 5, data: [-1, 0, 0, -1, 0, 0] }], // 180°
      blocks: [
        { layout: { orientation: 'PAGE_LEFT' } }, // 90° fix
        { layout: { orientation: 'PAGE_LEFT' } },
        { layout: { orientation: 'PAGE_LEFT' } },
      ],
    };
    const r = resolveOrientation({
      exifResult: null,
      docAiPage: page,
      imageDimensions: { width: 1000, height: 1000 },
      fileName: 't.jpg',
    });
    // transforms виграє
    expect(r.degrees).toBe(180);
    expect(r.source).toBe('docAiTransforms');
  });

  it('blockField обходить blockGeometry і pageField коли transforms = identity', () => {
    const page = {
      orientation: 'PAGE_DOWN',
      transforms: [{ rows: 2, cols: 3, type: 5, data: [1, 0, 0, 1, 0, 0] }], // identity
      blocks: [
        { layout: { orientation: 'PAGE_LEFT' } },
        { layout: { orientation: 'PAGE_LEFT' } },
        { layout: { orientation: 'PAGE_LEFT' } },
      ],
    };
    const r = resolveOrientation({
      exifResult: null,
      docAiPage: page,
      imageDimensions: { width: 1000, height: 1000 },
      fileName: 't.jpg',
    });
    expect(r.degrees).toBe(90); // PAGE_LEFT fix
    expect(r.source).toBe('docAiBlockField');
  });
});

// Helper: вертикальний блок (h >> w) у normalized coords
function tallParagraph(label = null) {
  return {
    layout: {
      ...(label ? { orientation: label } : {}),
      boundingPoly: { normalizedVertices: [
        { x: 0.40, y: 0.05 }, { x: 0.45, y: 0.05 },
        { x: 0.45, y: 0.95 }, { x: 0.40, y: 0.95 },
      ]},
    },
  };
}
// Helper: горизонтальний блок (w >> h)
function wideParagraph(label = null) {
  return {
    layout: {
      ...(label ? { orientation: label } : {}),
      boundingPoly: { normalizedVertices: [
        { x: 0.05, y: 0.40 }, { x: 0.95, y: 0.40 },
        { x: 0.95, y: 0.45 }, { x: 0.05, y: 0.45 },
      ]},
    },
  };
}

describe('orientationCorrector.analyzeBlockGeometry', () => {
  it('повертає null коли blocks порожні', () => {
    expect(analyzeBlockGeometry({ blocks: [] })).toBeNull();
    expect(analyzeBlockGeometry({})).toBeNull();
    expect(analyzeBlockGeometry(null)).toBeNull();
  });

  it('повертає null коли менше 3 блоків з валідним bbox', () => {
    const page = { paragraphs: [tallParagraph(), tallParagraph()] };
    expect(analyzeBlockGeometry(page)).toBeNull();
  });

  it('класифікує блок як tall коли h > 1.6×w', () => {
    const page = { paragraphs: [tallParagraph(), tallParagraph(), tallParagraph()] };
    const r = analyzeBlockGeometry(page);
    expect(r).not.toBeNull();
    expect(r.tall).toBe(3);
    expect(r.wide).toBe(0);
    expect(r.tallFraction).toBe(1);
  });

  it('класифікує блок як wide коли w > 1.6×h', () => {
    const page = { paragraphs: [wideParagraph(), wideParagraph(), wideParagraph()] };
    const r = analyzeBlockGeometry(page);
    expect(r.wide).toBe(3);
    expect(r.tall).toBe(0);
    expect(r.wideFraction).toBe(1);
  });

  it('квадратні блоки потрапляють у square (не tall, не wide)', () => {
    const square = {
      layout: { boundingPoly: { normalizedVertices: [
        { x: 0.4, y: 0.4 }, { x: 0.5, y: 0.4 },
        { x: 0.5, y: 0.5 }, { x: 0.4, y: 0.5 },
      ]}},
    };
    const r = analyzeBlockGeometry({ paragraphs: [square, square, square] });
    expect(r.square).toBe(3);
    expect(r.tall).toBe(0);
    expect(r.wide).toBe(0);
  });

  it('читає bbox з block.boundingPoly без вкладеного layout (старий формат)', () => {
    const page = {
      blocks: [
        { boundingPoly: { normalizedVertices: [
          { x: 0.4, y: 0.05 }, { x: 0.45, y: 0.05 },
          { x: 0.45, y: 0.95 }, { x: 0.4, y: 0.95 },
        ]}},
        { boundingPoly: { normalizedVertices: [
          { x: 0.4, y: 0.05 }, { x: 0.45, y: 0.05 },
          { x: 0.45, y: 0.95 }, { x: 0.4, y: 0.95 },
        ]}},
        { boundingPoly: { normalizedVertices: [
          { x: 0.4, y: 0.05 }, { x: 0.45, y: 0.05 },
          { x: 0.45, y: 0.95 }, { x: 0.4, y: 0.95 },
        ]}},
      ],
    };
    const r = analyzeBlockGeometry(page);
    expect(r.tall).toBe(3);
  });

  it('пропускає блоки без bbox і не падає', () => {
    const page = {
      paragraphs: [
        tallParagraph(),
        { layout: {} }, // no bbox
        tallParagraph(),
        tallParagraph(),
      ],
    };
    const r = analyzeBlockGeometry(page);
    expect(r.total).toBe(3);
    expect(r.tall).toBe(3);
  });
});

describe('orientationCorrector.resolveOrientation з block geometry sanity check', () => {
  it('PAGE_UP домінує + tall blocks → 0° АЛЕ uncertain=true (DocAI ймовірно пропустив orientation)', () => {
    const page = {
      paragraphs: Array.from({ length: 10 }, () => tallParagraph('PAGE_UP')),
    };
    const r = resolveOrientation({
      exifResult: null,
      docAiPage: page,
      imageDimensions: { width: 1800, height: 1350 },
      fileName: 'broken-docai.jpg',
    });
    expect(r.degrees).toBe(0);
    expect(r.source).toBe('docAiBlockField');
    expect(r.uncertain).toBe(true);
    expect(r.logs.some((l) => l.includes('PAGE_UP домінує АЛЕ'))).toBe(true);
  });

  it('PAGE_UP домінує + wide blocks → 0° certain (truly upright doc)', () => {
    const page = {
      paragraphs: Array.from({ length: 10 }, () => wideParagraph('PAGE_UP')),
    };
    const r = resolveOrientation({
      exifResult: null,
      docAiPage: page,
      imageDimensions: { width: 1350, height: 1800 },
      fileName: 'upright.jpg',
    });
    expect(r.degrees).toBe(0);
    expect(r.source).toBe('docAiBlockField');
    expect(r.uncertain).toBe(false);
  });

  it('PAGE_DOWN домінує — geometry не запускається (rotation вже визначена)', () => {
    const page = {
      paragraphs: Array.from({ length: 10 }, () => wideParagraph('PAGE_DOWN')),
    };
    const r = resolveOrientation({
      exifResult: null,
      docAiPage: page,
      imageDimensions: { width: 1350, height: 1800 },
      fileName: 'upside-down.jpg',
    });
    expect(r.degrees).toBe(180);
    expect(r.source).toBe('docAiBlockField');
    expect(r.uncertain).toBe(false);
  });

  it('NONE: блоки без orientation field + tall blocks → 0° uncertain + лог з підказкою', () => {
    const page = {
      paragraphs: Array.from({ length: 10 }, () => tallParagraph(null)),
    };
    const r = resolveOrientation({
      exifResult: null,
      docAiPage: page,
      imageDimensions: { width: 1800, height: 1350 },
      fileName: 'no-orient.jpg',
    });
    expect(r.degrees).toBe(0);
    expect(r.source).toBe('none');
    expect(r.uncertain).toBe(true);
    expect(r.logs.some((l) => l.includes('блоків вертикальні'))).toBe(true);
  });
});
