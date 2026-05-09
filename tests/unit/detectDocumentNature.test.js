import { describe, it, expect } from 'vitest';
import {
  inferNatureFromFile,
  defaultNatureForUI,
} from '../../src/services/detectDocumentNature.js';

describe('detectDocumentNature', () => {
  describe('inferNatureFromFile', () => {
    it('повертає вже задане значення якщо є', () => {
      expect(inferNatureFromFile({ documentNature: 'scanned' })).toBe('scanned');
      expect(inferNatureFromFile({ documentNature: 'searchable' })).toBe('searchable');
    });

    it('image MIME → scanned', () => {
      expect(inferNatureFromFile({ mimeType: 'image/jpeg' })).toBe('scanned');
      expect(inferNatureFromFile({ mimeType: 'image/png' })).toBe('scanned');
    });

    it('docx MIME → searchable', () => {
      expect(inferNatureFromFile({
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })).toBe('searchable');
    });

    it('text/markdown MIME → searchable', () => {
      expect(inferNatureFromFile({ mimeType: 'text/markdown' })).toBe('searchable');
    });

    it('розширення .png у name → scanned', () => {
      expect(inferNatureFromFile({ name: 'document.png' })).toBe('scanned');
      expect(inferNatureFromFile({ name: 'scan.HEIC' })).toBe('scanned');
    });

    it('розширення .docx → searchable', () => {
      expect(inferNatureFromFile({ name: 'позов.docx' })).toBe('searchable');
    });

    it('PDF без явних сигналів → null (потрібна deep-перевірка)', () => {
      expect(inferNatureFromFile({ name: 'doc.pdf' })).toBeNull();
      expect(inferNatureFromFile({ name: 'doc.pdf', mimeType: 'application/pdf' })).toBeNull();
    });

    it('originalName має пріоритет над name', () => {
      expect(inferNatureFromFile({
        originalName: 'scan.png',
        name: 'якась-назва-без-розширення',
      })).toBe('scanned');
    });

    it('null/невідомі дані → null', () => {
      expect(inferNatureFromFile(null)).toBeNull();
      expect(inferNatureFromFile({})).toBeNull();
      expect(inferNatureFromFile({ name: 'file.xyz' })).toBeNull();
    });
  });

  describe('defaultNatureForUI', () => {
    it('PDF без сигналів → scanned (Drive iframe однаково покаже)', () => {
      expect(defaultNatureForUI({ name: 'doc.pdf' })).toBe('scanned');
      expect(defaultNatureForUI({ mimeType: 'application/pdf' })).toBe('scanned');
    });

    it('зрозумілі сигнали проходять через інференцію', () => {
      expect(defaultNatureForUI({ name: 'photo.jpg' })).toBe('scanned');
      expect(defaultNatureForUI({ name: 'pleading.docx' })).toBe('searchable');
    });

    it('усе невідоме → searchable (text-mode не падає)', () => {
      expect(defaultNatureForUI({})).toBe('searchable');
      expect(defaultNatureForUI({ name: 'unknown.xyz' })).toBe('searchable');
    });
  });
});
