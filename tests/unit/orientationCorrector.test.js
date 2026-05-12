// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  rotateImageBlob,
  normalizeDegrees,
  extractPageOrientation,
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
