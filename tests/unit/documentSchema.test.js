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
    it('містить 23 поля (TASK A додав originalDriveId / originalMime)', () => {
      // 23 = id, name, originalName, category, author, documentNature, namingStatus, isKey,
      //      procId, driveId, driveUrl, folder, pageCount, size, icon, date,
      //      addedAt, updatedAt, addedBy, status, source, originalDriveId, originalMime
      // originalDriveId / originalMime — оригінал поряд з PDF (DOCX→PDF).
      // Nullable, default null. Додано без schema bump (за прецедентом source).
      expect(Object.keys(CANONICAL_DOCUMENT_FIELDS)).toHaveLength(23);
    });

    it('має поля originalDriveId / originalMime (TASK A)', () => {
      expect(CANONICAL_DOCUMENT_FIELDS.originalDriveId).toBeDefined();
      expect(CANONICAL_DOCUMENT_FIELDS.originalDriveId.nullable).toBe(true);
      expect(CANONICAL_DOCUMENT_FIELDS.originalDriveId.required).toBe(false);
      expect(CANONICAL_DOCUMENT_FIELDS.originalMime).toBeDefined();
      expect(CANONICAL_DOCUMENT_FIELDS.originalMime.nullable).toBe(true);
      expect(CANONICAL_DOCUMENT_FIELDS.originalMime.required).toBe(false);
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

    it("addedBy enum — user/agent/system (TASK 0.3.4 cleanup, без legacy)", () => {
      const ab = CANONICAL_DOCUMENT_FIELDS.addedBy.enum;
      expect(ab).toEqual(['user', 'agent', 'system']);
      // legacy значення прибрано — розщеплено з document.source (правило #11)
      expect(ab).not.toContain('lawyer_manual');
      expect(ab).not.toContain('lawyer_via_dp');
      expect(ab).not.toContain('migration');
      expect(ab).not.toContain('ecits');
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
