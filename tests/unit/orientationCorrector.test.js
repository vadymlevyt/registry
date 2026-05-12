// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  rotateImageBlob,
  normalizeDegrees,
  extractPageOrientation,
  readExifOrientation,
  resolveOrientation,
} from '../../src/services/sortation/orientationCorrector.js';

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

  it('enum 0-3 → 0/90/180/270', () => {
    expect(extractPageOrientation({ orientation: 0 })).toBe(0);
    expect(extractPageOrientation({ orientation: 1 })).toBe(90);
    expect(extractPageOrientation({ orientation: 2 })).toBe(180);
    expect(extractPageOrientation({ orientation: 3 })).toBe(270);
  });

  it('рядок PAGE_UP/PAGE_RIGHT/PAGE_DOWN/PAGE_LEFT', () => {
    expect(extractPageOrientation({ orientation: 'PAGE_UP' })).toBe(0);
    expect(extractPageOrientation({ orientation: 'PAGE_RIGHT' })).toBe(90);
    expect(extractPageOrientation({ orientation: 'PAGE_DOWN' })).toBe(180);
    expect(extractPageOrientation({ orientation: 'PAGE_LEFT' })).toBe(270);
  });

  it('detectedOrientation у градусах', () => {
    expect(extractPageOrientation({ detectedOrientation: 90 })).toBe(90);
    expect(extractPageOrientation({ detectedOrientation: -90 })).toBe(270);
    expect(extractPageOrientation({ detectedOrientation: 360 })).toBe(0);
  });

  it('вкладене у layout.orientation', () => {
    expect(extractPageOrientation({ layout: { orientation: 2 } })).toBe(180);
    expect(extractPageOrientation({ layout: { orientation: 'PAGE_LEFT' } })).toBe(270);
  });

  it('пріоритет page.orientation над detectedOrientation', () => {
    // Якщо обидва задані — orientation виграє як більш надійне
    expect(extractPageOrientation({ orientation: 1, detectedOrientation: 270 })).toBe(90);
  });

  it('невалідні enum значення → 0 (fallback)', () => {
    expect(extractPageOrientation({ orientation: 4 })).toBe(0);
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
      docAiPage: { orientation: 2 }, // Document AI каже 180
      fileName: 'photo.jpg',
    });
    expect(r.degrees).toBe(90);
    expect(r.source).toBe('exif');
    expect(r.logs.some((l) => l.includes('EXIF tag=8'))).toBe(true);
  });

  it('EXIF = 0, docAi != 0 → docAi', () => {
    const r = resolveOrientation({
      exifResult: { degrees: 0, rawTag: 1, mirrored: false },
      docAiPage: { orientation: 1 }, // 90°
      fileName: 'scan.pdf',
    });
    expect(r.degrees).toBe(90);
    expect(r.source).toBe('docAi');
  });

  it('обидва = 0 → none', () => {
    const r = resolveOrientation({
      exifResult: { degrees: 0, rawTag: 1, mirrored: false },
      docAiPage: { orientation: 0 },
      fileName: 'doc.jpg',
    });
    expect(r.degrees).toBe(0);
    expect(r.source).toBe('none');
  });

  it('EXIF відсутній, docAi != 0 → docAi', () => {
    const r = resolveOrientation({
      exifResult: null,
      docAiPage: { detectedOrientation: 90 },
      fileName: 'scan.jpg',
    });
    expect(r.degrees).toBe(90);
    expect(r.source).toBe('docAi');
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

  // ── Aspect ratio heuristic (TASK B fix 2 round 2) ────────────────────
  // Фото з месенджерів strip EXIF; Document AI часто не повертає orientation.
  // Якщо image landscape (width > height) — пропонуємо 270° з uncertain=true.

  it('EXIF strip + docAi=0 + image landscape → heuristic 270°, uncertain=true', () => {
    const r = resolveOrientation({
      exifResult: null,
      docAiPage: { orientation: 0 },
      imageDimensions: { width: 1800, height: 1350 },
      fileName: 'photo.jpg',
    });
    expect(r.degrees).toBe(270);
    expect(r.source).toBe('aspect');
    expect(r.uncertain).toBe(true);
    expect(r.debug.aspect.ratio).toBeCloseTo(1.33, 2);
  });

  it('image portrait → no rotation, source=none, uncertain=false', () => {
    const r = resolveOrientation({
      exifResult: null,
      docAiPage: { orientation: 0 },
      imageDimensions: { width: 1350, height: 1800 },
      fileName: 'photo.jpg',
    });
    expect(r.degrees).toBe(0);
    expect(r.source).toBe('none');
    expect(r.uncertain).toBe(false);
  });

  it('image майже квадрат (ratio <= 1.1) → no rotation', () => {
    const r = resolveOrientation({
      exifResult: null,
      docAiPage: { orientation: 0 },
      imageDimensions: { width: 1100, height: 1000 },
      fileName: 'photo.jpg',
    });
    expect(r.degrees).toBe(0);
    expect(r.source).toBe('none');
    expect(r.uncertain).toBe(false);
  });

  it('EXIF реальний → не торкаємо heuristic навіть для landscape', () => {
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

  it('docAi реальний → heuristic не запускається', () => {
    const r = resolveOrientation({
      exifResult: null,
      docAiPage: { orientation: 1 }, // 90°
      imageDimensions: { width: 1800, height: 1350 },
      fileName: 'scan.jpg',
    });
    expect(r.degrees).toBe(90);
    expect(r.source).toBe('docAi');
    expect(r.uncertain).toBe(false);
  });

  it('debug містить exif/docAi/aspect для діагностики', () => {
    const r = resolveOrientation({
      exifResult: null,
      docAiPage: { orientation: 0, dimension: { width: 1800, height: 1350 } },
      imageDimensions: { width: 1800, height: 1350 },
      fileName: 'IMG-test.jpg',
    });
    expect(r.debug).toBeTruthy();
    expect(r.debug.fileName).toBe('IMG-test.jpg');
    expect(r.debug.docAi).toBeTruthy();
    expect(r.debug.aspect).toBeTruthy();
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
