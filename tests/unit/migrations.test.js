// Юніт-тести міграції v4 → v5 канонічної схеми документів.
import { describe, it, expect } from 'vitest';
import {
  migrateRegistryV4toV5,
  splitDocumentV4toV5,
} from '../../src/services/migrations/v4ToV5.js';
import { validateDocument } from '../../src/services/documentFactory.js';

describe('v4ToV5 migration', () => {
  describe('splitDocumentV4toV5', () => {
    it('повертає canonical (валідний) і extended', () => {
      const old = { id: 'doc_1', name: 'Test', size: 100, driveId: 'd1' };
      const { canonical, extended } = splitDocumentV4toV5(old);
      expect(validateDocument(canonical).valid).toBe(true);
      expect(extended).toBeNull(); // тут жодних extended-полів
    });

    it("converts number id у string у форматі canonical", () => {
      const old = { id: 12345, name: 'X' };
      const { canonical } = splitDocumentV4toV5(old);
      expect(typeof canonical.id).toBe('string');
      expect(canonical.id).toBe('12345');
    });

    it('legacy author "opp" → canonical "opponent"', () => {
      const old = { id: 'd', name: 'X', author: 'opp' };
      const { canonical } = splitDocumentV4toV5(old);
      expect(canonical.author).toBe('opponent');
    });

    it('тег "key" → isKey: true і прибирається з tags', () => {
      const old = { id: 'd', name: 'X', tags: ['key', 'urgent'] };
      const { canonical, extended } = splitDocumentV4toV5(old);
      expect(canonical.isKey).toBe(true);
      expect(extended.tags).toEqual(['urgent']);
    });

    it('тег "ключовий" → isKey: true (українська legacy)', () => {
      const old = { id: 'd', name: 'X', tags: ['ключовий'] };
      const { canonical } = splitDocumentV4toV5(old);
      expect(canonical.isKey).toBe(true);
    });

    it('scanned: true → documentNature: scanned', () => {
      const old = { id: 'd', name: 'X', scanned: true };
      const { canonical } = splitDocumentV4toV5(old);
      expect(canonical.documentNature).toBe('scanned');
    });

    it('legacy date (text "березень 2023") → customFields.legacyDateText, canonical.date=null', () => {
      const old = { id: 'd', name: 'X', date: 'березень 2023' };
      const { canonical, extended } = splitDocumentV4toV5(old);
      expect(canonical.date).toBeNull();
      expect(extended.customFields.legacyDateText).toBe('березень 2023');
    });

    it('ISO date зберігається в canonical.date', () => {
      const old = { id: 'd', name: 'X', date: '2024-03-15' };
      const { canonical, extended } = splitDocumentV4toV5(old);
      expect(canonical.date).toBe('2024-03-15');
      expect(extended).toBeNull();
    });

    it('невідомі поля → extended.customFields', () => {
      const old = { id: 'd', name: 'X', someUnknownField: 'value', anotherOne: 42 };
      const { extended } = splitDocumentV4toV5(old);
      expect(extended.customFields.someUnknownField).toBe('value');
      expect(extended.customFields.anotherOne).toBe(42);
    });

    it('addedBy за замовчуванням migration', () => {
      const old = { id: 'd', name: 'X' };
      const { canonical } = splitDocumentV4toV5(old);
      expect(canonical.addedBy).toBe('migration');
    });

    it('extended.notes / annotations / processingHistory зберігаються', () => {
      const old = {
        id: 'd', name: 'X',
        notes: 'мої замітки',
        annotations: [{ x: 1 }],
        processingHistory: [{ event: 'ocr' }],
      };
      const { extended } = splitDocumentV4toV5(old);
      expect(extended.notes).toBe('мої замітки');
      expect(extended.annotations).toEqual([{ x: 1 }]);
      expect(extended.processingHistory).toEqual([{ event: 'ocr' }]);
    });
  });

  describe('migrateRegistryV4toV5', () => {
    it('schemaVersion: 4 → 5 + settingsVersion оновлюється', () => {
      const reg = {
        schemaVersion: 4,
        cases: [{ id: 'c1', documents: [{ id: 'd', name: 'X' }] }],
      };
      const result = migrateRegistryV4toV5(reg);
      expect(result.didMigrate).toBe(true);
      expect(result.fromVersion).toBe(4);
      expect(result.toVersion).toBe(5);
      expect(result.registry.schemaVersion).toBe(5);
      expect(result.registry.settingsVersion).toBe('5.0_canonical_documents');
    });

    it('ідемпотентна — повторний запуск з v5 не змінює реєстр', () => {
      const reg = {
        schemaVersion: 5,
        settingsVersion: '5.0_canonical_documents',
        cases: [],
      };
      const result = migrateRegistryV4toV5(reg);
      expect(result.didMigrate).toBe(false);
    });

    it('документи всіх справ переводяться на canonical', () => {
      const reg = {
        schemaVersion: 4,
        cases: [
          { id: 'c1', documents: [{ id: 'd1', name: 'A' }, { id: 'd2', name: 'B' }] },
          { id: 'c2', documents: [{ id: 'd3', name: 'C' }] },
        ],
      };
      const { registry } = migrateRegistryV4toV5(reg);
      expect(registry.cases[0].documents.every(d => validateDocument(d).valid)).toBe(true);
      expect(registry.cases[1].documents.every(d => validateDocument(d).valid)).toBe(true);
    });

    it('extendedByCase містить мапу caseId → { docId → extended }', () => {
      const reg = {
        schemaVersion: 4,
        cases: [{
          id: 'c1',
          documents: [{ id: 'd1', name: 'X', tags: ['urgent'], notes: 'note' }],
        }],
      };
      const { extendedByCase } = migrateRegistryV4toV5(reg);
      expect(extendedByCase.c1).toBeDefined();
      expect(extendedByCase.c1.d1).toBeDefined();
      expect(extendedByCase.c1.d1.tags).toEqual(['urgent']);
      expect(extendedByCase.c1.d1.notes).toBe('note');
    });

    it('реєстр без cases не падає', () => {
      const reg = { schemaVersion: 4 };
      expect(() => migrateRegistryV4toV5(reg)).not.toThrow();
    });

    it('cases без documents — справа лишається без змін', () => {
      const reg = {
        schemaVersion: 4,
        cases: [{ id: 'c1', name: 'Без доків' }],
      };
      const { registry } = migrateRegistryV4toV5(reg);
      expect(registry.cases[0].id).toBe('c1');
    });
  });
});
