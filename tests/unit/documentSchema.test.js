// Юніт-тести канонічної схеми документа.
// Виявляють регресії: випадкове видалення поля, зміну enum'у, неузгодження з фабрикою.
import { describe, it, expect } from 'vitest';
import {
  CANONICAL_DOCUMENT_FIELDS,
  EXTENDED_DOCUMENT_FIELDS,
  CRITICAL_FIELDS_FOR_WARNING,
  CURRENT_SCHEMA_VERSION,
} from '../../src/schemas/documentSchema.js';

describe('documentSchema', () => {
  describe('CANONICAL_DOCUMENT_FIELDS', () => {
    it('містить 21 поле (TASK 0.2 додав source як 21-ше)', () => {
      // 21 = id, name, originalName, category, author, documentNature, namingStatus, isKey,
      //      procId, driveId, driveUrl, folder, pageCount, size, icon, date,
      //      addedAt, updatedAt, addedBy, status, source
      // source — канал надходження (manual_upload / ecits / telegram / email / null),
      // nullable, default null. Старі документи отримують null без schema bump.
      expect(Object.keys(CANONICAL_DOCUMENT_FIELDS)).toHaveLength(21);
    });

    it('має ідентифікаційні поля: id, name, originalName', () => {
      expect(CANONICAL_DOCUMENT_FIELDS.id).toBeDefined();
      expect(CANONICAL_DOCUMENT_FIELDS.name).toBeDefined();
      expect(CANONICAL_DOCUMENT_FIELDS.originalName).toBeDefined();
    });

    it('має класифікаційні поля: category, author, documentNature, namingStatus, isKey', () => {
      expect(CANONICAL_DOCUMENT_FIELDS.category).toBeDefined();
      expect(CANONICAL_DOCUMENT_FIELDS.author).toBeDefined();
      expect(CANONICAL_DOCUMENT_FIELDS.documentNature).toBeDefined();
      expect(CANONICAL_DOCUMENT_FIELDS.namingStatus).toBeDefined();
      expect(CANONICAL_DOCUMENT_FIELDS.isKey).toBeDefined();
    });

    it('має Drive-поля: driveId, driveUrl, folder', () => {
      expect(CANONICAL_DOCUMENT_FIELDS.driveId).toBeDefined();
      expect(CANONICAL_DOCUMENT_FIELDS.driveUrl).toBeDefined();
      expect(CANONICAL_DOCUMENT_FIELDS.folder).toBeDefined();
    });

    it('має audit-поля: addedAt, updatedAt, addedBy', () => {
      expect(CANONICAL_DOCUMENT_FIELDS.addedAt).toBeDefined();
      expect(CANONICAL_DOCUMENT_FIELDS.updatedAt).toBeDefined();
      expect(CANONICAL_DOCUMENT_FIELDS.addedBy).toBeDefined();
    });
  });

  describe('Енами', () => {
    it('category: 8 валідних значень + null', () => {
      const cat = CANONICAL_DOCUMENT_FIELDS.category.enum;
      expect(cat).toContain('pleading');
      expect(cat).toContain('motion');
      expect(cat).toContain('court_act');
      expect(cat).toContain('evidence');
      expect(cat).toContain('contract');
      expect(cat).toContain('correspondence');
      expect(cat).toContain('identification');
      expect(cat).toContain('other');
      expect(cat).toContain(null);
    });

    it('author: ours/opponent/court/third_party/null (без legacy "opp")', () => {
      const auth = CANONICAL_DOCUMENT_FIELDS.author.enum;
      expect(auth).toEqual(['ours', 'opponent', 'court', 'third_party', null]);
      expect(auth).not.toContain('opp');
    });

    it('documentNature: searchable / scanned (без null)', () => {
      expect(CANONICAL_DOCUMENT_FIELDS.documentNature.enum).toEqual(['searchable', 'scanned']);
    });

    it('namingStatus: auto / manual / pending', () => {
      expect(CANONICAL_DOCUMENT_FIELDS.namingStatus.enum).toEqual(['auto', 'manual', 'pending']);
    });

    it('addedBy enum включає migration і lawyer_via_dp', () => {
      const ab = CANONICAL_DOCUMENT_FIELDS.addedBy.enum;
      expect(ab).toContain('lawyer_manual');
      expect(ab).toContain('lawyer_via_dp');
      expect(ab).toContain('migration');
      expect(ab).toContain('agent');
      expect(ab).toContain('ecits');
    });

    it('folder enum — 6 підпапок з 00_INBOX_СПРАВИ до 05_ЗОВНІШНІ', () => {
      expect(CANONICAL_DOCUMENT_FIELDS.folder.enum).toEqual([
        '00_INBOX_СПРАВИ', '01_ОРИГІНАЛИ', '02_ОБРОБЛЕНІ',
        '03_ФРАГМЕНТИ', '04_ПОЗИЦІЯ', '05_ЗОВНІШНІ',
      ]);
    });
  });

  describe('Required + nullable rules', () => {
    it('category — required + nullable (маркер ⚠)', () => {
      expect(CANONICAL_DOCUMENT_FIELDS.category.required).toBe(true);
      expect(CANONICAL_DOCUMENT_FIELDS.category.nullable).toBe(true);
    });

    it('driveId — required + nullable', () => {
      expect(CANONICAL_DOCUMENT_FIELDS.driveId.required).toBe(true);
      expect(CANONICAL_DOCUMENT_FIELDS.driveId.nullable).toBe(true);
    });

    it('size — required без nullable', () => {
      expect(CANONICAL_DOCUMENT_FIELDS.size.required).toBe(true);
      expect(CANONICAL_DOCUMENT_FIELDS.size.nullable).toBeUndefined();
    });
  });

  describe('EXTENDED_DOCUMENT_FIELDS', () => {
    it('містить 7 полів (documentId + 6 важких)', () => {
      expect(Object.keys(EXTENDED_DOCUMENT_FIELDS)).toHaveLength(7);
    });

    it('має tags, notes, annotations, processingHistory, extractedTextSummary, customFields', () => {
      expect(EXTENDED_DOCUMENT_FIELDS.tags).toBeDefined();
      expect(EXTENDED_DOCUMENT_FIELDS.notes).toBeDefined();
      expect(EXTENDED_DOCUMENT_FIELDS.annotations).toBeDefined();
      expect(EXTENDED_DOCUMENT_FIELDS.processingHistory).toBeDefined();
      expect(EXTENDED_DOCUMENT_FIELDS.extractedTextSummary).toBeDefined();
      expect(EXTENDED_DOCUMENT_FIELDS.customFields).toBeDefined();
    });
  });

  describe('CRITICAL_FIELDS_FOR_WARNING', () => {
    it('містить procId, category, author', () => {
      expect(CRITICAL_FIELDS_FOR_WARNING).toEqual(['procId', 'category', 'author']);
    });
  });

  describe('CURRENT_SCHEMA_VERSION', () => {
    it('=== 5 (Phase 1.5)', () => {
      expect(CURRENT_SCHEMA_VERSION).toBe(5);
    });
  });
});
