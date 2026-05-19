// Ф3 — renderImageMergeToPdf: композиція orientation→imageToPdf→mergePdf.
// Лез-модулі (orientationCorrector/imageToPdf) мокаємо — тут перевіряємо
// САМЕ оркестрацію (порядок, авто-поворот, best-effort, склейка), а не
// canvas (його покривають orientationCorrector.test.js / imageToPdf.test.js).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rotateImageBlob = vi.fn(async (blob) => blob);
const resolveOrientation = vi.fn(() => ({ degrees: 0 }));
vi.mock('../../src/services/sortation/orientationCorrector.js', () => ({
  readExifOrientation: vi.fn(async () => ({ degrees: 0 })),
  getImageDimensions: vi.fn(async () => ({ width: 100, height: 200 })),
  resolveOrientation: (...a) => resolveOrientation(...a),
  rotateImageBlob: (...a) => rotateImageBlob(...a),
}));
const imageToPdf = vi.fn(async (file) => ({ pdfBlob: new Blob([new Uint8Array([file.name.length])], { type: 'application/pdf' }) }));
vi.mock('../../src/services/converter/imageToPdf.js', () => ({ imageToPdf: (...a) => imageToPdf(...a) }));

const { renderImageMergeToPdf } = await import('../../src/services/sortation/imageMergeRenderer.js');

const img = (name, n = 3) => ({ bytes: new Uint8Array(n).fill(1), mime: 'image/jpeg', name });

describe('renderImageMergeToPdf', () => {
  beforeEach(() => { rotateImageBlob.mockClear(); resolveOrientation.mockClear(); imageToPdf.mockClear(); resolveOrientation.mockReturnValue({ degrees: 0 }); });

  it('нема валідних зображень → null', async () => {
    expect(await renderImageMergeToPdf({ images: [] })).toBeNull();
    expect(await renderImageMergeToPdf({ images: [{ bytes: new Uint8Array(0) }] })).toBeNull();
  });

  it('1 фото → один PDF без mergePdf', async () => {
    const runInWorker = vi.fn();
    const out = await renderImageMergeToPdf({ images: [img('a.jpg')], runInWorker });
    expect(out).toBeInstanceOf(Uint8Array);
    expect(runInWorker).not.toHaveBeenCalled();
    expect(imageToPdf).toHaveBeenCalledTimes(1);
  });

  it('N фото у порядку → imageToPdf по черзі + mergePdf з N буферів', async () => {
    const runInWorker = vi.fn(async () => ({ buffer: new Uint8Array([9, 9]).buffer }));
    const out = await renderImageMergeToPdf({ images: [img('a.jpg'), img('b.jpg'), img('c.jpg')], runInWorker });
    expect(imageToPdf.mock.calls.map((c) => c[0].name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(runInWorker).toHaveBeenCalledWith('mergePdf', { buffers: expect.any(Array) });
    expect(runInWorker.mock.calls[0][1].buffers).toHaveLength(3);
    expect(out).toEqual(new Uint8Array([9, 9]));
  });

  it('авто-поворот: degrees!=0 → rotateImageBlob викликано', async () => {
    resolveOrientation.mockReturnValue({ degrees: 90 });
    await renderImageMergeToPdf({ images: [img('a.jpg')], runInWorker: vi.fn() });
    expect(rotateImageBlob).toHaveBeenCalledTimes(1);
    expect(rotateImageBlob.mock.calls[0][1]).toBe(90);
  });

  it('best-effort: помилка orientation → фото ембедиться як є (без кидка)', async () => {
    resolveOrientation.mockImplementation(() => { throw new Error('exif bad'); });
    const out = await renderImageMergeToPdf({ images: [img('a.jpg')], runInWorker: vi.fn() });
    expect(out).toBeInstanceOf(Uint8Array);
    expect(rotateImageBlob).not.toHaveBeenCalled();
    expect(imageToPdf).toHaveBeenCalledTimes(1);
  });
});
