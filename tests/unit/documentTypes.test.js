import { describe, it, expect } from 'vitest';
import { isInlineRenderable } from '../../src/utils/documentTypes.js';

describe('isInlineRenderable', () => {
  it('null/undefined документ → false', () => {
    expect(isInlineRenderable(null)).toBe(false);
    expect(isInlineRenderable(undefined)).toBe(false);
    expect(isInlineRenderable({})).toBe(false);
  });

  it('searchable PDF → true (mimeType або .pdf)', () => {
    expect(isInlineRenderable({ mimeType: 'application/pdf', documentNature: 'searchable' })).toBe(true);
    expect(isInlineRenderable({ name: 'doc.pdf', documentNature: 'searchable' })).toBe(true);
  });

  it('scanned PDF → false (потрібен перемикач Скан/Текст)', () => {
    expect(isInlineRenderable({ mimeType: 'application/pdf', documentNature: 'scanned' })).toBe(false);
    expect(isInlineRenderable({ name: 'scan.pdf', documentNature: 'scanned' })).toBe(false);
  });

  it('PDF без documentNature → false (за замовчуванням не інлайн)', () => {
    expect(isInlineRenderable({ mimeType: 'application/pdf' })).toBe(false);
  });

  it('зображення → false', () => {
    expect(isInlineRenderable({ mimeType: 'image/jpeg' })).toBe(false);
    expect(isInlineRenderable({ mimeType: 'image/png' })).toBe(false);
    expect(isInlineRenderable({ mimeType: 'image/heic' })).toBe(false);
    expect(isInlineRenderable({ mimeType: 'image/webp' })).toBe(false);
  });

  it('Office формати (DOCX, XLSX, PPTX) → true', () => {
    expect(isInlineRenderable({
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })).toBe(true);
    expect(isInlineRenderable({
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })).toBe(true);
    expect(isInlineRenderable({
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })).toBe(true);
    // По розширенню теж
    expect(isInlineRenderable({ name: 'позов.docx' })).toBe(true);
    expect(isInlineRenderable({ name: 'reestr.xlsx' })).toBe(true);
    expect(isInlineRenderable({ name: 'презентація.pptx' })).toBe(true);
  });

  it('legacy MS Office (.doc, .xls, .ppt) → true', () => {
    expect(isInlineRenderable({ mimeType: 'application/msword' })).toBe(true);
    expect(isInlineRenderable({ mimeType: 'application/vnd.ms-excel' })).toBe(true);
    expect(isInlineRenderable({ mimeType: 'application/vnd.ms-powerpoint' })).toBe(true);
    expect(isInlineRenderable({ name: 'old.doc' })).toBe(true);
  });

  it('OpenDocument (ODT, ODS, ODP) → true', () => {
    expect(isInlineRenderable({ mimeType: 'application/vnd.oasis.opendocument.text' })).toBe(true);
    expect(isInlineRenderable({ name: 'doc.odt' })).toBe(true);
    expect(isInlineRenderable({ name: 'таблиця.ods' })).toBe(true);
  });

  it('HTML/XHTML → true (для ухвал з ЄСІТС)', () => {
    expect(isInlineRenderable({ mimeType: 'text/html' })).toBe(true);
    expect(isInlineRenderable({ mimeType: 'application/xhtml+xml' })).toBe(true);
    expect(isInlineRenderable({ name: 'ухвала.html' })).toBe(true);
    expect(isInlineRenderable({ name: 'ухвала.htm' })).toBe(true);
  });

  it('текстові формати (TXT, MD, RTF, CSV) → true', () => {
    expect(isInlineRenderable({ mimeType: 'text/plain' })).toBe(true);
    expect(isInlineRenderable({ mimeType: 'text/markdown' })).toBe(true);
    expect(isInlineRenderable({ mimeType: 'application/rtf' })).toBe(true);
    expect(isInlineRenderable({ mimeType: 'text/csv' })).toBe(true);
    expect(isInlineRenderable({ name: 'нотатка.md' })).toBe(true);
    expect(isInlineRenderable({ name: 'export.csv' })).toBe(true);
    expect(isInlineRenderable({ name: 'tab.tsv' })).toBe(true);
  });

  it('Google native (Docs/Sheets/Slides) → true', () => {
    expect(isInlineRenderable({ mimeType: 'application/vnd.google-apps.document' })).toBe(true);
    expect(isInlineRenderable({ mimeType: 'application/vnd.google-apps.spreadsheet' })).toBe(true);
    expect(isInlineRenderable({ mimeType: 'application/vnd.google-apps.presentation' })).toBe(true);
  });

  it('Google folder → false (не плутати з документом)', () => {
    expect(isInlineRenderable({ mimeType: 'application/vnd.google-apps.folder' })).toBe(false);
  });

  it('originalName має пріоритет над name (Drive нормалізує імена)', () => {
    // Приклад: name='Позов' (без розширення в реєстрі), але originalName='Позов.docx'
    expect(isInlineRenderable({ name: 'Позов', originalName: 'Позов.docx' })).toBe(true);
  });

  it('невідомий формат → false', () => {
    expect(isInlineRenderable({ mimeType: 'application/octet-stream', name: 'data.bin' })).toBe(false);
    expect(isInlineRenderable({ name: 'video.mp4', mimeType: 'video/mp4' })).toBe(false);
  });
});
