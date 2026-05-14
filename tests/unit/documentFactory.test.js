// Юніт-тести фабрики документів.
// Покриває createDocument / validateDocument / needsReview / getMissingCriticalFields.
import { describe, it, expect, vi } from 'vitest';
import {
  createDocument,
  validateDocument,
  needsReview,
  getMissingCriticalFields,
} from '../../src/services/documentFactory.js';

describe('documentFactory', () => {
  describe('createDocument', () => {
    it('генерує валідний документ з мінімальних метаданих', () => {
      const doc = createDocument({ name: 'Test', driveId: 'fake_id', size: 100 });
      const { valid, errors } = validateDocument(doc);
      expect(valid).toBe(true);
      expect(errors).toEqual([]);
    });

    it('генерує унікальні ID для кожного виклику', () => {
      const a = createDocument({ name: 'A' });
      const b = createDocument({ name: 'B' });
      expect(a.id).not.toBe(b.id);
      expect(a.id).toMatch(/^doc_\d+_[a-z0-9]+$/);
    });

    it('зберігає переданий ID без перегенерації', () => {
      const doc = createDocument({ id: 'doc_explicit', name: 'X' });
      expect(doc.id).toBe('doc_explicit');
    });

    it('має дефолти: status=active, isKey=false, namingStatus=pending, folder=01_ОРИГІНАЛИ', () => {
      const doc = createDocument({ name: 'X' });
      expect(doc.status).toBe('active');
      expect(doc.isKey).toBe(false);
      expect(doc.namingStatus).toBe('pending');
      expect(doc.folder).toBe('01_ОРИГІНАЛИ');
    });

    it('addedAt і updatedAt — ISO timestamp', () => {
      const doc = createDocument({ name: 'X' });
      expect(doc.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(doc.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('category/author/procId за замовчуванням null (маркер ⚠)', () => {
      const doc = createDocument({ name: 'X' });
      expect(doc.category).toBeNull();
      expect(doc.author).toBeNull();
      expect(doc.procId).toBeNull();
    });

    it('detectNature: scanned для метаданих з ocrProvider', () => {
      const doc = createDocument({ name: 'X.pdf', fromOCR: true });
      expect(doc.documentNature).toBe('scanned');
    });

    it('detectNature: searchable для docx/html/md', () => {
      const docDocx = createDocument({ name: 'X.docx' });
      const docHtml = createDocument({ name: 'X.html' });
      expect(docDocx.documentNature).toBe('searchable');
      expect(docHtml.documentNature).toBe('searchable');
    });

    it('icon обирається за category', () => {
      expect(createDocument({ name: 'X', category: 'pleading' }).icon).toBe('📋');
      expect(createDocument({ name: 'X', category: 'court_act' }).icon).toBe('⚖');
      expect(createDocument({ name: 'X', category: 'evidence' }).icon).toBe('📑');
    });

    it("addedBy за замовчуванням 'user' (TASK 0.3.4)", () => {
      expect(createDocument({ name: 'X' }).addedBy).toBe('user');
    });

    it("normalizeAddedBy: lawyer_via_dp / lawyer_manual → 'user'", () => {
      expect(createDocument({ name: 'X', addedBy: 'lawyer_via_dp' }).addedBy).toBe('user');
      expect(createDocument({ name: 'X', addedBy: 'lawyer_manual' }).addedBy).toBe('user');
    });

    it("normalizeAddedBy: migration / ecits → 'system'", () => {
      expect(createDocument({ name: 'X', addedBy: 'migration' }).addedBy).toBe('system');
      expect(createDocument({ name: 'X', addedBy: 'ecits' }).addedBy).toBe('system');
    });

    it("normalizeAddedBy: agent → 'agent' (без зміни)", () => {
      expect(createDocument({ name: 'X', addedBy: 'agent' }).addedBy).toBe('agent');
    });

    it("normalizeAddedBy: невідоме значення → 'user' з warning", () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(createDocument({ name: 'X', addedBy: 'garbage_value' }).addedBy).toBe('user');
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('garbage_value'));
      spy.mockRestore();
    });

    it('originalDriveId / originalMime — null за замовчуванням', () => {
      const doc = createDocument({ name: 'X' });
      expect(doc.originalDriveId).toBeNull();
      expect(doc.originalMime).toBeNull();
    });

    it('зберігає originalDriveId і originalMime коли передано (кейс DOCX→PDF)', () => {
      const doc = createDocument({
        name: 'Позовна заява',
        driveId: 'pdf_123',
        originalDriveId: 'docx_456',
        originalMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      expect(doc.driveId).toBe('pdf_123');
      expect(doc.originalDriveId).toBe('docx_456');
      expect(doc.originalMime).toContain('wordprocessingml');
    });

    it("source приймає manual (з AddDocumentModal v7)", () => {
      const doc = createDocument({ name: 'X', source: 'manual' });
      expect(doc.source).toBe('manual');
    });

    it("normalizeSource: legacy 'manual_upload' → 'manual'", () => {
      const doc = createDocument({ name: 'X', source: 'manual_upload' });
      expect(doc.source).toBe('manual');
    });

    it("normalizeSource: legacy 'ecits' → 'court_sync'", () => {
      const doc = createDocument({ name: 'X', source: 'ecits' });
      expect(doc.source).toBe('court_sync');
    });

    it("normalizeSource: невідоме значення → 'unknown' з warning", () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const doc = createDocument({ name: 'X', source: 'garbage_channel' });
      expect(doc.source).toBe('unknown');
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('garbage_channel'));
      spy.mockRestore();
    });

    it("v7 поля створюються з безпечними дефолтами", () => {
      const doc = createDocument({ name: 'X' });
      expect(doc.sourceConfidence).toBe('high');
      expect(doc.extractedAt).toBeNull();
      expect(doc.ecitsSource).toBeNull();
      expect(doc.movementCard).toBeNull();
      expect(doc.alternativeSources).toEqual([]);
    });
  });

  describe('validateDocument', () => {
    it('валідний документ → valid=true', () => {
      const doc = createDocument({ name: 'X' });
      expect(validateDocument(doc).valid).toBe(true);
    });

    it("ловить відсутність required поля name", () => {
      const doc = createDocument({});
      delete doc.name;
      const { valid, errors } = validateDocument(doc);
      expect(valid).toBe(false);
      expect(errors.some(e => /name/.test(e))).toBe(true);
    });

    it('ловить enum violation у category', () => {
      const doc = createDocument({ name: 'X', category: 'pleading' });
      doc.category = 'invalid_category';
      const { valid, errors } = validateDocument(doc);
      expect(valid).toBe(false);
      expect(errors.some(e => /category/.test(e))).toBe(true);
    });

    it('ловить enum violation у author', () => {
      const doc = createDocument({ name: 'X' });
      doc.author = 'opp'; // legacy → не дозволяємо
      expect(validateDocument(doc).valid).toBe(false);
    });

    it('дозволяє null для category/author/procId/driveId', () => {
      const doc = createDocument({ name: 'X' });
      // category/author/procId/driveId null за замовчуванням
      expect(validateDocument(doc).valid).toBe(true);
    });

    it('ловить невалідний тип size (string замість number)', () => {
      const doc = createDocument({ name: 'X' });
      doc.size = 'not a number';
      expect(validateDocument(doc).valid).toBe(false);
    });
  });

  describe('needsReview', () => {
    it('true якщо category=null', () => {
      const doc = createDocument({ name: 'X' });
      expect(needsReview(doc)).toBe(true);
    });

    it('false коли всі критичні поля заповнені', () => {
      const doc = createDocument({
        name: 'X', category: 'pleading', author: 'ours', procId: 'proc_main',
      });
      expect(needsReview(doc)).toBe(false);
    });

    it('false для null/undefined входу', () => {
      expect(needsReview(null)).toBe(false);
      expect(needsReview(undefined)).toBe(false);
    });
  });

  describe('getMissingCriticalFields', () => {
    it('повертає українські лейбли для відсутніх критичних полів', () => {
      const doc = createDocument({ name: 'X' });
      const missing = getMissingCriticalFields(doc);
      expect(missing).toContain('тип');
      expect(missing).toContain('автор');
      expect(missing).toContain('провадження');
    });

    it('порожній масив коли всі критичні поля заповнені', () => {
      const doc = createDocument({
        name: 'X', category: 'pleading', author: 'ours', procId: 'proc_main',
      });
      expect(getMissingCriticalFields(doc)).toEqual([]);
    });
  });
});
