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
