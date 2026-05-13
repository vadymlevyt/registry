// @vitest-environment jsdom
//
// Юніт-тести imageToPdf — конвертація зображення у PDF Blob.
// jsPDF, heic2any мокаємо: jsdom не має canvas pixel access, але DOM API
// (Image, URL.createObjectURL) є.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock heic2any ──────────────────────────────────────────────────────────
vi.mock('heic2any', () => ({
  default: vi.fn(async ({ blob }) =>
    new Blob(['fake-jpeg-from-heic'], { type: 'image/jpeg' })
  ),
}));

// ── Mock jsPDF ─────────────────────────────────────────────────────────────
const mockAddImage = vi.fn();
const mockOutput = vi.fn(() => new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' }));
const mockJsPDFCtor = vi.fn();

vi.mock('jspdf', () => {
  // function declaration — справжній constructor (підтримує `new`)
  function JsPDFMock(opts) {
    mockJsPDFCtor(opts);
    return {
      addImage: mockAddImage,
      output: mockOutput,
    };
  }
  return { jsPDF: JsPDFMock, default: JsPDFMock };
});

// ── Patch Image (jsdom не завантажує реальне зображення) ───────────────────
// Image.src = ... → onload з фейковими розмірами
beforeEach(() => {
  Object.defineProperty(global.Image.prototype, 'src', {
    configurable: true,
    set(value) {
      // Симулюємо завантаження. Розміри — портрет 800×1200 для тесту.
      this._src = value;
      setTimeout(() => {
        Object.defineProperty(this, 'width', { value: 800, configurable: true });
        Object.defineProperty(this, 'height', { value: 1200, configurable: true });
        if (typeof this.onload === 'function') this.onload();
      }, 0);
    },
    get() {
      return this._src;
    },
  });
  vi.clearAllMocks();
});

// ── Patch canvas.toDataURL (jsdom повертає 'data:,' за замовчуванням) ──────
beforeEach(() => {
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/jpeg;base64,FAKE');
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: vi.fn(),
  }));
});

import { imageToPdf } from '../../src/services/converter/imageToPdf.js';

function jpgFile(name = 'photo.jpg', type = 'image/jpeg') {
  return new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type });
}

function heicFile(name = 'IMG.HEIC', type = 'image/heic') {
  return new File([new Uint8Array([0, 0, 0])], name, { type });
}

describe('imageToPdf', () => {
  it('повертає pdfBlob і warnings контракт', async () => {
    const result = await imageToPdf(jpgFile(), {});
    expect(result).toHaveProperty('pdfBlob');
    expect(result).toHaveProperty('warnings');
    expect(result.pdfBlob).toBeInstanceOf(Blob);
    expect(result.pdfBlob.type).toBe('application/pdf');
  });

  it('HEIC попередньо конвертується — у warnings є повідомлення', async () => {
    const result = await imageToPdf(heicFile(), {});
    expect(result.warnings.some(w => w.includes('HEIC'))).toBe(true);
  });

  it('JPG не запускає HEIC конвертацію', async () => {
    const heic2anyModule = await import('heic2any');
    await imageToPdf(jpgFile(), {});
    expect(heic2anyModule.default).not.toHaveBeenCalled();
  });

  it('викликає jsPDF.addImage з JPEG форматом і розмірами', async () => {
    await imageToPdf(jpgFile(), {});
    expect(mockAddImage).toHaveBeenCalled();
    const args = mockAddImage.mock.calls[0];
    expect(args[1]).toBe('JPEG'); // формат
    expect(typeof args[2]).toBe('number'); // x
    expect(typeof args[3]).toBe('number'); // y
    expect(typeof args[4]).toBe('number'); // width
    expect(typeof args[5]).toBe('number'); // height
  });

  it('orientation portrait для image 800×1200 (height > width)', async () => {
    await imageToPdf(jpgFile(), {});
    expect(mockJsPDFCtor).toHaveBeenCalledWith(
      expect.objectContaining({ orientation: 'portrait' })
    );
  });

  it('кидає помилку коли jsPDF повертає порожній blob', async () => {
    mockOutput.mockReturnValueOnce(new Blob([], { type: 'application/pdf' }));
    await expect(imageToPdf(jpgFile(), {})).rejects.toThrow(/порожній/);
  });

  it('кидає чітку помилку коли HTMLImage завантажується з naturalWidth=0', async () => {
    // Симулюємо випадок коли image «успішно» завантажилось але має 0 розміри
    // (специфічний edge case для деяких progressive JPEG на Android Chrome).
    Object.defineProperty(global.Image.prototype, 'src', {
      configurable: true,
      set() {
        setTimeout(() => {
          Object.defineProperty(this, 'naturalWidth', { value: 0, configurable: true });
          Object.defineProperty(this, 'naturalHeight', { value: 0, configurable: true });
          Object.defineProperty(this, 'width', { value: 0, configurable: true });
          Object.defineProperty(this, 'height', { value: 0, configurable: true });
          this.onload?.();
        }, 0);
      },
    });
    // createImageBitmap також fail у цьому тесті щоб fallback не спрацював.
    const origCreateImageBitmap = global.createImageBitmap;
    global.createImageBitmap = undefined;
    try {
      await expect(imageToPdf(jpgFile(), {})).rejects.toThrow(/декодувати/);
    } finally {
      global.createImageBitmap = origCreateImageBitmap;
    }
  });

  it('використовує createImageBitmap fallback коли HTMLImage не справляється', async () => {
    // HTMLImage імітуємо що падає
    Object.defineProperty(global.Image.prototype, 'src', {
      configurable: true,
      set() {
        setTimeout(() => this.onerror?.(), 0);
      },
    });
    const closeMock = vi.fn();
    global.createImageBitmap = vi.fn(async () => ({
      width: 1000,
      height: 1500,
      close: closeMock,
    }));
    try {
      const result = await imageToPdf(jpgFile(), {});
      expect(global.createImageBitmap).toHaveBeenCalled();
      expect(closeMock).toHaveBeenCalled();
      expect(result.pdfBlob).toBeInstanceOf(Blob);
    } finally {
      delete global.createImageBitmap;
    }
  });

  it('cleanup blob URL виконується навіть якщо завантаження падає', async () => {
    const revokeSpy = vi.spyOn(global.URL, 'revokeObjectURL');
    Object.defineProperty(global.Image.prototype, 'src', {
      configurable: true,
      set() {
        setTimeout(() => this.onerror?.(), 0);
      },
    });
    global.createImageBitmap = vi.fn(async () => { throw new Error('bitmap fail'); });
    try {
      await expect(imageToPdf(jpgFile(), {})).rejects.toThrow();
      expect(revokeSpy).toHaveBeenCalled();
    } finally {
      revokeSpy.mockRestore();
      delete global.createImageBitmap;
    }
  });
});
