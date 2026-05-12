// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { cropImageBlob, normalizedToPixels } from '../../src/services/sortation/cropHelper.js';

describe('cropHelper.normalizedToPixels', () => {
  it('перетворює 0..1 координати у piксельні', () => {
    const r = normalizedToPixels({ x: 0.1, y: 0.2, width: 0.5, height: 0.6 }, 1000, 2000);
    expect(r).toEqual({ x: 100, y: 400, width: 500, height: 1200 });
  });

  it('повертає round-ed значення', () => {
    const r = normalizedToPixels({ x: 0.123, y: 0.456, width: 0.789, height: 0.012 }, 100, 100);
    expect(r.x).toBe(12);
    expect(r.y).toBe(46);
    expect(r.width).toBe(79);
    expect(r.height).toBe(1);
  });
});

describe('cropHelper.cropImageBlob', () => {
  let canvasToBlobMock;
  let drawImageMock;
  let lastCanvas;

  beforeEach(() => {
    canvasToBlobMock = vi.fn((cb) => {
      cb(new Blob(['fake-cropped-jpeg'], { type: 'image/jpeg' }));
    });
    drawImageMock = vi.fn();

    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'canvas') {
        lastCanvas = {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: drawImageMock,
          }),
          toBlob: canvasToBlobMock,
        };
        return lastCanvas;
      }
      return origCreateElement(tag);
    });

    global.Image = class {
      constructor() {
        this.naturalWidth = 2000;
        this.naturalHeight = 1500;
        setTimeout(() => this.onload && this.onload(), 0);
      }
    };

    global.URL.createObjectURL = vi.fn(() => 'blob:fake-crop');
    global.URL.revokeObjectURL = vi.fn();
  });

  it('кидає коли blob не Blob', async () => {
    await expect(cropImageBlob(null, { x: 0, y: 0, width: 100, height: 100 })).rejects.toThrow(/Blob/);
    await expect(cropImageBlob('not blob', { x: 0, y: 0, width: 100, height: 100 })).rejects.toThrow(/Blob/);
  });

  it('кидає коли rect невалідний', async () => {
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    await expect(cropImageBlob(blob, null)).rejects.toThrow(/rect/);
    await expect(cropImageBlob(blob, { x: 0, y: 0, width: 0, height: 100 })).rejects.toThrow(/нульової/);
  });

  it('обрізає коректно — canvas розмір = rect size', async () => {
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    const result = await cropImageBlob(blob, { x: 100, y: 200, width: 800, height: 600 });
    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe('image/jpeg');
    expect(lastCanvas.width).toBe(800);
    expect(lastCanvas.height).toBe(600);
    expect(drawImageMock).toHaveBeenCalledWith(
      expect.anything(), 100, 200, 800, 600, 0, 0, 800, 600
    );
  });

  it('клампить координати у межах natural image', async () => {
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    // Запит у координати за межами 2000×1500
    await cropImageBlob(blob, { x: 1900, y: 1400, width: 500, height: 500 });
    // x=1900 OK (1900 < 1999), width clamp до 100 (2000-1900), height=100 (1500-1400)
    expect(lastCanvas.width).toBe(100);
    expect(lastCanvas.height).toBe(100);
  });

  it('очищує blob URL після crop', async () => {
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    await cropImageBlob(blob, { x: 0, y: 0, width: 100, height: 100 });
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-crop');
  });
});
