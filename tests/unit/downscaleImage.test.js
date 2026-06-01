// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { downscaleImage } from '../../src/services/imageDocument/downscaleImage.js';
import { readExifOrientation } from '../../src/services/sortation/orientationCorrector.js';

// ── EXIF JPEG builder (мінімальний JPEG з APP1 Orientation tag) ─────────────
// Копія з orientationCorrector.test.js — конструює реальний JPEG-blob, який
// readExifOrientation уміє прочитати. Потрібен для no-op гілки (перевіряємо
// що downscale НЕ стер EXIF у малого фото).
function buildJpegWithExifOrientation(orientationVal, { littleEndian = true } = {}) {
  const buf = new ArrayBuffer(2 + 2 + 2 + 32 + 2);
  const v = new DataView(buf);
  let p = 0;
  v.setUint16(p, 0xFFD8, false); p += 2; // SOI
  v.setUint16(p, 0xFFE1, false); p += 2; // APP1 marker
  v.setUint16(p, 34, false); p += 2;     // segment length
  // "Exif\0\0"
  v.setUint8(p, 0x45); p += 1;
  v.setUint8(p, 0x78); p += 1;
  v.setUint8(p, 0x69); p += 1;
  v.setUint8(p, 0x66); p += 1;
  v.setUint8(p, 0x00); p += 1;
  v.setUint8(p, 0x00); p += 1;
  const tiffStart = p;
  v.setUint16(p, littleEndian ? 0x4949 : 0x4D4D, false); p += 2;
  v.setUint16(p, 0x002A, littleEndian); p += 2;
  v.setUint32(p, 8, littleEndian); p += 4;
  v.setUint16(p, 1, littleEndian); p += 2;
  v.setUint16(p, 0x0112, littleEndian); p += 2;
  v.setUint16(p, 3, littleEndian); p += 2;
  v.setUint32(p, 1, littleEndian); p += 4;
  v.setUint16(p, orientationVal, littleEndian); p += 2;
  v.setUint16(p, 0, littleEndian); p += 2;
  v.setUint32(p, 0, littleEndian); p += 4;
  void tiffStart;
  v.setUint16(p, 0xFFD9, false); p += 2; // EOI
  return new Blob([buf], { type: 'image/jpeg' });
}

// ── Canvas / createImageBitmap моки ─────────────────────────────────────────
// jsdom не має повного Canvas API. Мокаємо createImageBitmap (повертає бітмап
// заданих розмірів — імітує upright-декод з EXIF-від-from-image), canvas
// (фіксуємо встановлені width/height) і toBlob (керований розмір виходу).

describe('downscaleImage', () => {
  let lastCanvas;
  let originalCreateElement;
  let bitmapDims;
  let bitmapCloseSpy;
  let createImageBitmapOpts;
  let toBlobSize;

  beforeEach(() => {
    lastCanvas = undefined;
    bitmapDims = { width: 100, height: 100 };
    toBlobSize = 300; // менший за вхід (1000) за дефолтом → реальний downscale
    bitmapCloseSpy = vi.fn();
    createImageBitmapOpts = undefined;

    originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'canvas') {
        lastCanvas = {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage: vi.fn() }),
          toBlob: (cb) => cb(new Blob([new Uint8Array(toBlobSize)], { type: 'image/jpeg' })),
        };
        return lastCanvas;
      }
      return originalCreateElement(tag);
    });

    global.createImageBitmap = vi.fn(async (_blob, opts) => {
      createImageBitmapOpts = opts;
      return { width: bitmapDims.width, height: bitmapDims.height, close: bitmapCloseSpy };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete global.createImageBitmap;
  });

  function jpeg(size = 1000) {
    return new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
  }

  it('кидає помилку якщо вхід не Blob', async () => {
    await expect(downscaleImage(null)).rejects.toThrow(/Blob/);
    await expect(downscaleImage('x')).rejects.toThrow(/Blob/);
  });

  it('вхід > maxDim → зменшує: довша сторона = maxDim, пропорції збережено', async () => {
    bitmapDims = { width: 4032, height: 3024 }; // 12 МП landscape, ratio 4:3
    const input = jpeg(1000);
    const out = await downscaleImage(input, { maxDim: 2400 });

    // повернувся новий (зменшений) blob, не оригінал
    expect(out).not.toBe(input);
    expect(out.size).toBe(300);

    // canvas: довша сторона = maxDim, коротша масштабована пропорційно
    expect(Math.max(lastCanvas.width, lastCanvas.height)).toBe(2400);
    expect(lastCanvas.width).toBe(2400);
    expect(lastCanvas.height).toBe(1800);
    const srcRatio = 4032 / 3024;
    const dstRatio = lastCanvas.width / lastCanvas.height;
    expect(Math.abs(dstRatio - srcRatio)).toBeLessThan(0.01);

    expect(bitmapCloseSpy).toHaveBeenCalled();
  });

  it('вхід ≤ maxDim по обох сторонах → no-op (той самий blob, без перекодування)', async () => {
    bitmapDims = { width: 1500, height: 1100 }; // вже мале — нижче maxDim
    const input = jpeg(1000);
    const out = await downscaleImage(input, { maxDim: 2400 });

    expect(out).toBe(input);          // той самий референс
    expect(lastCanvas).toBeUndefined(); // canvas навіть не створювався
  });

  it('кастомний maxDim змінює поріг no-op', async () => {
    bitmapDims = { width: 1500, height: 1100 };
    const input = jpeg(1000);
    const out = await downscaleImage(input, { maxDim: 1000 }); // 1500 > 1000 → зменшує
    expect(out).not.toBe(input);
    expect(Math.max(lastCanvas.width, lastCanvas.height)).toBe(1000);
  });

  it('EXIF (велике фото з rotation-тегом) → upright-запечений, не боком', async () => {
    // createImageBitmap(from-image) віддає вже upright-бітмап: сенсор був
    // landscape 4032×3024, EXIF=90 → upright portrait 3024×4032.
    bitmapDims = { width: 3024, height: 4032 };
    const input = jpeg(1000);
    const out = await downscaleImage(input, { maxDim: 2400 });

    // делегуємо орієнтацію браузеру через imageOrientation:'from-image'
    expect(createImageBitmapOpts).toEqual({ imageOrientation: 'from-image' });

    // вихід portrait (upright), НЕ боком: висота > ширина, довша сторона = maxDim
    expect(out).not.toBe(input);
    expect(lastCanvas.height).toBeGreaterThan(lastCanvas.width);
    expect(lastCanvas.height).toBe(2400);
    expect(lastCanvas.width).toBe(1800);
  });

  it('EXIF (мале фото ≤ maxDim) → незмінене, EXIF-тег збережено', async () => {
    // Реальний EXIF-JPEG (orientation=6). createImageBitmap повертає малі дими
    // → downscale no-op → має повернути ОРИГІНАЛ з EXIF на місці.
    const input = buildJpegWithExifOrientation(6);
    bitmapDims = { width: 1100, height: 1500 }; // ≤ maxDim
    const out = await downscaleImage(input, { maxDim: 2400 });

    expect(out).toBe(input); // оригінал, не перекодований
    const exif = await readExifOrientation(out);
    expect(exif).not.toBeNull();
    expect(exif.rawTag).toBe(6); // тег НЕ стерто
  });

  it('запобіжник: зменшений blob ≥ оригіналу → лишає оригінал', async () => {
    bitmapDims = { width: 4032, height: 3024 };
    toBlobSize = 5000; // вихід важчий за вхід (1000)
    const input = jpeg(1000);
    const out = await downscaleImage(input, { maxDim: 2400 });
    expect(out).toBe(input);
  });

  it('не змогли виміряти роздільність (0×0) → no-op', async () => {
    bitmapDims = { width: 0, height: 0 };
    const input = jpeg(1000);
    const out = await downscaleImage(input);
    expect(out).toBe(input);
  });

  it('portrait-джерело зберігає пропорції (висока сторона = maxDim)', async () => {
    bitmapDims = { width: 3024, height: 4032 };
    const input = jpeg(1000);
    await downscaleImage(input, { maxDim: 2400 });
    expect(lastCanvas.height).toBe(2400);
    expect(lastCanvas.width).toBe(1800);
  });
});
