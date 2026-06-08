// Юніт-тести фасаду converterService — маршрутизація за MIME-типом.
// Реальні конвертери (html/docx/image) тестуються окремо у Комітах 2-4.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock activityTracker щоб не вимагати hydration і tenantService
vi.mock('../../src/services/activityTracker.js', () => ({
  report: vi.fn(() => null),
}));

import { convertToPdf, canConvert, CONVERT_DOCX_TO_PDF } from '../../src/services/converter/converterService.js';
import { report as reportActivity } from '../../src/services/activityTracker.js';

function fakeFile(name, type) {
  // Тести виконуються у jsdom — File конструктор доступний
  return new File(['fake-content'], name, { type });
}

describe('converterService — маршрутизація за типом файла', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('canConvert', () => {
    it('PDF підтримується (passthrough)', () => {
      expect(canConvert(fakeFile('doc.pdf', 'application/pdf'))).toBe(true);
    });

    it('HTML підтримується', () => {
      expect(canConvert(fakeFile('page.html', 'text/html'))).toBe(true);
      expect(canConvert(fakeFile('page.htm', ''))).toBe(true);
    });

    it('DOCX підтримується', () => {
      expect(canConvert(fakeFile('court.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))).toBe(true);
      expect(canConvert(fakeFile('court.docx', ''))).toBe(true);
    });

    it('Зображення підтримуються', () => {
      expect(canConvert(fakeFile('scan.jpg', 'image/jpeg'))).toBe(true);
      expect(canConvert(fakeFile('scan.png', 'image/png'))).toBe(true);
      expect(canConvert(fakeFile('scan.heic', 'image/heic'))).toBe(true);
      expect(canConvert(fakeFile('scan.heic', ''))).toBe(true); // HEIC без MIME (Android)
      expect(canConvert(fakeFile('scan.webp', 'image/webp'))).toBe(true);
    });

    // Regression guard: для розширення .jpeg адвокат бачив що PDF не
    // створюється (тільки .txt/.layout.json), а для .jpg все працювало.
    // Тести замикають усі варіанти регістру/розширення + порожній MIME
    // (Android-picker для .jpeg часом повертає type='' замість image/jpeg).
    it('Зображення з усіма варіантами регістру і MIME підтримуються', () => {
      expect(canConvert(fakeFile('scan.jpeg', 'image/jpeg'))).toBe(true);
      expect(canConvert(fakeFile('scan.JPG', 'image/jpeg'))).toBe(true);
      expect(canConvert(fakeFile('scan.JPEG', 'image/jpeg'))).toBe(true);
      expect(canConvert(fakeFile('scan.PNG', 'image/png'))).toBe(true);
      expect(canConvert(fakeFile('scan.WEBP', 'image/webp'))).toBe(true);
      // Порожній MIME — fallback на extension
      expect(canConvert(fakeFile('scan.jpeg', ''))).toBe(true);
      expect(canConvert(fakeFile('scan.jpg', ''))).toBe(true);
      expect(canConvert(fakeFile('scan.png', ''))).toBe(true);
      // application/octet-stream (некоректний MIME з деяких пікерів)
      expect(canConvert(fakeFile('scan.jpeg', 'application/octet-stream'))).toBe(true);
      expect(canConvert(fakeFile('scan.jpg', 'application/octet-stream'))).toBe(true);
    });

    it('Невідомий тип — false', () => {
      expect(canConvert(fakeFile('archive.zip', 'application/zip'))).toBe(false);
      expect(canConvert(fakeFile('book.epub', 'application/epub+zip'))).toBe(false);
    });
  });

  describe('convertToPdf — passthrough для PDF', () => {
    it('PDF повертається як є, без виклику конвертера', async () => {
      const file = fakeFile('rishennia.pdf', 'application/pdf');
      const result = await convertToPdf(file, { caseId: 'case_1', module: 'add_document_modal' });
      expect(result.converter).toBe('passthrough');
      expect(result.pdfBlob).toBe(file);
      expect(result.originalBlob).toBeNull();
      expect(result.originalMime).toBe('application/pdf');
      expect(result.pdfName).toBe('rishennia');
      expect(result.originalName).toBe('rishennia.pdf');
      // passthrough НЕ репортує — це не конвертація
      expect(reportActivity).not.toHaveBeenCalled();
    });

    it('PDF без MIME-типу але з розширенням — теж passthrough', async () => {
      const file = fakeFile('doc.pdf', '');
      const result = await convertToPdf(file, {});
      expect(result.converter).toBe('passthrough');
    });
  });

  describe('convertToPdf — невідомий тип', () => {
    it('ZIP повертається як passthrough з warning', async () => {
      const file = fakeFile('archive.zip', 'application/zip');
      const result = await convertToPdf(file, {});
      expect(result.converter).toBe('passthrough');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('не конвертується');
      expect(reportActivity).not.toHaveBeenCalled();
    });

    it('старий .doc (application/msword) → passthrough, НЕ docx (mammoth його не вміє)', async () => {
      // Регресія: .doc маршрутизувався в docxToPdf → hasDocxSignature кидав →
      // CONVERT_FAILED → документ не додавався. Тепер .doc іде у passthrough
      // (заливається як є; Drive показує превʼю). canConvert для .doc → false.
      expect(canConvert(fakeFile('лист.doc', 'application/msword'))).toBe(false);
      const result = await convertToPdf(fakeFile('лист.doc', 'application/msword'), {});
      expect(result.converter).toBe('passthrough');
      expect(result.pdfName).toBe('лист');
    });
  });

  describe('convertToPdf — image routing (regression guard для .jpeg)', () => {
    // imageToPdf тестується окремо; тут тільки перевіряємо що ВСІ варіанти
    // розширень/MIME для зображень потрапляють у image-гілку (converter='imageToPdf')
    // а не у passthrough. Раніше .jpeg з порожнім MIME міг потрапити у passthrough
    // якщо MIME-перевірка зачинала на name.endsWith('.jpg') а не на /\.jpe?g/.
    beforeEach(() => {
      vi.resetModules();
      vi.doMock('../../src/services/converter/imageToPdf.js', () => ({
        imageToPdf: vi.fn(async () => ({
          pdfBlob: new Blob(['fake-pdf'], { type: 'application/pdf' }),
          warnings: [],
        })),
      }));
    });

    async function route(name, type) {
      const { convertToPdf: cvt } = await import('../../src/services/converter/converterService.js');
      const file = new File(['fake'], name, { type });
      const r = await cvt(file, {});
      return r.converter;
    }

    it('.jpeg з image/jpeg → imageToPdf', async () => {
      expect(await route('photo.jpeg', 'image/jpeg')).toBe('imageToPdf');
    });
    it('.jpg з image/jpeg → imageToPdf', async () => {
      expect(await route('photo.jpg', 'image/jpeg')).toBe('imageToPdf');
    });
    it('.JPEG (uppercase) з image/jpeg → imageToPdf', async () => {
      expect(await route('photo.JPEG', 'image/jpeg')).toBe('imageToPdf');
    });
    it('.JPG (uppercase) з image/jpeg → imageToPdf', async () => {
      expect(await route('photo.JPG', 'image/jpeg')).toBe('imageToPdf');
    });
    it('.png з image/png → imageToPdf', async () => {
      expect(await route('scan.png', 'image/png')).toBe('imageToPdf');
    });
    it('.PNG (uppercase) → imageToPdf', async () => {
      expect(await route('scan.PNG', 'image/png')).toBe('imageToPdf');
    });
    it('.jpeg з порожнім MIME (Android picker quirk) → imageToPdf (не passthrough)', async () => {
      expect(await route('photo.jpeg', '')).toBe('imageToPdf');
    });
    it('.jpg з порожнім MIME → imageToPdf', async () => {
      expect(await route('photo.jpg', '')).toBe('imageToPdf');
    });
    it('.jpeg з application/octet-stream → imageToPdf (нормалізуємо MIME)', async () => {
      expect(await route('photo.jpeg', 'application/octet-stream')).toBe('imageToPdf');
    });
    it('.webp → imageToPdf', async () => {
      expect(await route('photo.webp', 'image/webp')).toBe('imageToPdf');
    });
    it('originalMime нормалізується у image/* навіть коли file.type порожній', async () => {
      const { convertToPdf: cvt } = await import('../../src/services/converter/converterService.js');
      const file = new File(['fake'], 'photo.jpeg', { type: '' });
      const r = await cvt(file, {});
      expect(r.originalMime).toBe('image/jpeg');
    });
  });

  describe('convertToPdf — інструментація activityTracker', () => {
    it('Невідомий тип через passthrough — без report', async () => {
      await convertToPdf(fakeFile('archive.zip', 'application/zip'), { caseId: 'case_1' });
      expect(reportActivity).not.toHaveBeenCalled();
    });

    // Решта типів (html/docx/image) тестуються разом з реальною реалізацією
    // у Комітах 2-4, де перевіряється що activityTracker.report викликається з
    // правильною категорією, billable=true для caseId, тощо.
  });

  describe('CONVERT_DOCX_TO_PDF feature flag', () => {
    it('експортується як константа', () => {
      expect(typeof CONVERT_DOCX_TO_PDF).toBe('boolean');
    });

    it('за замовчуванням true (DOCX конвертується)', () => {
      // Відкат до false має бути свідомим рішенням адвоката після
      // тестування — не може мовчазно зʼявитись через випадковий мерж.
      expect(CONVERT_DOCX_TO_PDF).toBe(true);
    });
  });
});
