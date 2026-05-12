// @vitest-environment jsdom
//
// Юніт-тести heicToJpeg — обгортка над heic2any.
// Реальну heic2any не запускаємо (для HEIC потрібен бінарний код).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHeic2any = vi.fn();

vi.mock('heic2any', () => ({
  default: (opts) => mockHeic2any(opts),
}));

import { heicToJpeg } from '../../src/services/converter/heicToJpeg.js';

function heicFile(name = 'photo.heic', type = 'image/heic') {
  return new File([new Uint8Array([0, 0, 0, 0])], name, { type });
}

describe('heicToJpeg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('повертає JPEG File з правильним іменем і MIME', async () => {
    const jpegBlob = new Blob(['fake-jpeg'], { type: 'image/jpeg' });
    mockHeic2any.mockResolvedValueOnce(jpegBlob);

    const result = await heicToJpeg(heicFile('IMG_1234.HEIC'));
    expect(result.jpegFile).toBeInstanceOf(File);
    expect(result.jpegFile.name).toBe('IMG_1234.jpg');
    expect(result.jpegFile.type).toBe('image/jpeg');
  });

  it('викликає heic2any з правильними параметрами', async () => {
    mockHeic2any.mockResolvedValueOnce(new Blob([], { type: 'image/jpeg' }));
    const file = heicFile();
    await heicToJpeg(file);
    expect(mockHeic2any).toHaveBeenCalledWith({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.85,
    });
  });

  it('обробляє масив Blob (multi-image HEIC) — бере перший', async () => {
    const b1 = new Blob(['first'], { type: 'image/jpeg' });
    const b2 = new Blob(['second'], { type: 'image/jpeg' });
    mockHeic2any.mockResolvedValueOnce([b1, b2]);
    const result = await heicToJpeg(heicFile());
    expect(result.jpegFile.size).toBe(b1.size);
  });

  it('кидає Error з повідомленням коли heic2any падає', async () => {
    mockHeic2any.mockRejectedValueOnce({ code: 1, message: 'ERR_USER_INPUT_INVALID' });
    await expect(heicToJpeg(heicFile())).rejects.toThrow(/ERR_USER_INPUT_INVALID/);
  });

  it('кидає Error коли передано null/undefined', async () => {
    await expect(heicToJpeg(null)).rejects.toThrow(/required/);
    await expect(heicToJpeg(undefined)).rejects.toThrow(/required/);
  });
});
