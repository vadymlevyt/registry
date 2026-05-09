import { describe, it, expect } from 'vitest';
import {
  CATEGORY_LABELS,
  AUTHOR_LABELS,
  proceedingColor,
  formatDate,
  formatFileSize,
} from '../../src/components/DocumentViewer/labels.js';

describe('DocumentViewer labels', () => {
  describe('CATEGORY_LABELS', () => {
    it('покриває всі canonical категорії', () => {
      const expected = [
        'pleading',
        'motion',
        'court_act',
        'evidence',
        'contract',
        'correspondence',
        'identification',
        'other',
      ];
      for (const k of expected) {
        expect(CATEGORY_LABELS[k]).toBeTruthy();
      }
    });
  });

  describe('AUTHOR_LABELS', () => {
    it('покриває canonical авторів', () => {
      expect(AUTHOR_LABELS.ours).toBe('Наш');
      expect(AUTHOR_LABELS.opponent).toBe('Опонент');
      expect(AUTHOR_LABELS.court).toBe('Суд');
      expect(AUTHOR_LABELS.third_party).toBe('Третя сторона');
    });
  });

  describe('proceedingColor', () => {
    it('first → first-token', () => {
      expect(proceedingColor('first')).toBe('var(--color-proceeding-first)');
    });
    it('first_instance → first-token (alias)', () => {
      expect(proceedingColor('first_instance')).toBe('var(--color-proceeding-first)');
    });
    it('appeal → appeal-token (синій)', () => {
      expect(proceedingColor('appeal')).toBe('var(--color-proceeding-appeal)');
    });
    it('cassation → cassation-token', () => {
      expect(proceedingColor('cassation')).toBe('var(--color-proceeding-cassation)');
    });
    it('невідомий тип → other-token', () => {
      expect(proceedingColor('weird')).toBe('var(--color-proceeding-other)');
      expect(proceedingColor(undefined)).toBe('var(--color-proceeding-other)');
    });
  });

  describe('formatDate', () => {
    it('ISO yyyy-mm-dd → dd.mm.yyyy', () => {
      expect(formatDate('2026-03-15')).toBe('15.03.2026');
    });
    it('пустий → пустий', () => {
      expect(formatDate(null)).toBe('');
      expect(formatDate('')).toBe('');
    });
    it('людський рядок → повертається як є', () => {
      expect(formatDate('березень 2023')).toBe('березень 2023');
    });
  });

  describe('formatFileSize', () => {
    it('байти', () => {
      expect(formatFileSize(0)).toBe('0 Б');
      expect(formatFileSize(500)).toBe('500 Б');
    });
    it('кілобайти', () => {
      expect(formatFileSize(2_000)).toBe('2 КБ');
      expect(formatFileSize(900_000)).toBe('879 КБ');
    });
    it('мегабайти', () => {
      expect(formatFileSize(2_400_000)).toBe('2.3 МБ');
      expect(formatFileSize(10_500_000)).toBe('10.0 МБ');
    });
    it('null/undefined → пустий', () => {
      expect(formatFileSize(null)).toBe('');
      expect(formatFileSize(undefined)).toBe('');
    });
  });
});
