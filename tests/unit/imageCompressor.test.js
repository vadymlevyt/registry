// TASK 4 E — imageCompressor: пресети, resolvePreset, scanned-guard (чисті
// функції). Render-цикл (canvas/pdf.js) браузерний — у Node не виконується;
// реальний обсяг стиснення перевіряє адвокат на пристрої (не юніт-тест).
import { describe, it, expect } from 'vitest';
import {
  COMPRESSION_PRESETS,
  DEFAULT_COMPRESSION_PRESET,
  resolvePreset,
  isCompressibleNature,
} from '../../src/services/compression/imageCompressor.js';

describe('imageCompressor — пресети', () => {
  it('три пресети зі стандартними значеннями (§4.1 doctrine)', () => {
    expect(COMPRESSION_PRESETS.weak).toEqual({ longEdge: 2200, quality: 0.8 });
    expect(COMPRESSION_PRESETS.medium).toEqual({ longEdge: 1800, quality: 0.7 });
    expect(COMPRESSION_PRESETS.strong).toEqual({ longEdge: 1600, quality: 0.65 });
  });

  it('дефолт = Середній (стандарт системи)', () => {
    expect(DEFAULT_COMPRESSION_PRESET).toBe('medium');
    expect(COMPRESSION_PRESETS[DEFAULT_COMPRESSION_PRESET]).toEqual({ longEdge: 1800, quality: 0.7 });
  });
});

describe('imageCompressor — resolvePreset', () => {
  it('назва пресета → параметри', () => {
    expect(resolvePreset('weak')).toEqual({ longEdge: 2200, quality: 0.8 });
    expect(resolvePreset('strong')).toEqual({ longEdge: 1600, quality: 0.65 });
  });

  it('невідома назва / undefined → дефолт Середній', () => {
    expect(resolvePreset('xxx')).toEqual({ longEdge: 1800, quality: 0.7 });
    expect(resolvePreset(undefined)).toEqual({ longEdge: 1800, quality: 0.7 });
    expect(resolvePreset(null)).toEqual({ longEdge: 1800, quality: 0.7 });
  });

  it('готовий обʼєкт {longEdge,quality} проходить як є', () => {
    expect(resolvePreset({ longEdge: 1500, quality: 0.5 })).toEqual({ longEdge: 1500, quality: 0.5 });
  });

  it('частковий/невалідний обʼєкт → дефолт', () => {
    expect(resolvePreset({ longEdge: 1500 })).toEqual({ longEdge: 1800, quality: 0.7 });
  });
});

describe('imageCompressor — isCompressibleNature (scanned-guard, одна детекція)', () => {
  it('scanned documentNature → true', () => {
    expect(isCompressibleNature({ documentNature: 'scanned' })).toBe(true);
  });

  it('searchable documentNature → false (текст/вектори, растрів нема)', () => {
    expect(isCompressibleNature({ documentNature: 'searchable' })).toBe(false);
  });

  it('image MIME / розширення → true', () => {
    expect(isCompressibleNature({ mimeType: 'image/jpeg' })).toBe(true);
    expect(isCompressibleNature({ name: 'scan.PNG' })).toBe(true);
    expect(isCompressibleNature({ name: 'photo.heic' })).toBe(true);
  });

  it('PDF без відомого nature → null (потрібна deep-детекція буфера)', () => {
    expect(isCompressibleNature({ mimeType: 'application/pdf' })).toBeNull();
    expect(isCompressibleNature({ name: 'doc.pdf' })).toBeNull();
  });

  it('не-PDF не-зображення (DOCX/HTML/txt) → false (pass-through)', () => {
    expect(isCompressibleNature({ name: 'позов.docx' })).toBe(false);
    expect(isCompressibleNature({ mimeType: 'text/html' })).toBe(false);
    expect(isCompressibleNature({ name: 'нотатка.txt' })).toBe(false);
  });

  it('порожній вхід → false', () => {
    expect(isCompressibleNature({})).toBe(false);
    expect(isCompressibleNature()).toBe(false);
  });
});
