// Юніт-тести матриці провайдерів OCR (мікро-TASK ocr metadata extension).
// Перевіряє що selectProviderChain повертає правильний ланцюжок фолбеку
// за mimeType. Принцип — pdfjsLocal для PDF пробується першим бо економить
// виклики Document AI на searchable документах.
import { describe, it, expect } from 'vitest';
import {
  selectProviderChain,
  hasAnyProvider,
  FALLBACK_CHAINS_BY_MIME,
} from '../../src/services/ocr/providerMatrix.js';

describe('selectProviderChain', () => {
  it('PDF: ланцюжок починається з pdfjsLocal (фолбек documentAi → claudeVision)', () => {
    const file = { name: 'doc.pdf', mimeType: 'application/pdf' };
    expect(selectProviderChain(file)).toEqual(['pdfjsLocal', 'documentAi', 'claudeVision']);
  });

  it('PDF за розширенням без mimeType — той самий ланцюжок', () => {
    const file = { name: 'scan.PDF' };
    expect(selectProviderChain(file)).toEqual(['pdfjsLocal', 'documentAi', 'claudeVision']);
  });

  it('зображення (image/jpeg): documentAi → claudeVision', () => {
    const file = { name: 'scan.jpg', mimeType: 'image/jpeg' };
    expect(selectProviderChain(file)).toEqual(['documentAi', 'claudeVision']);
  });

  it('зображення (image/png): documentAi → claudeVision', () => {
    const file = { name: 'page.png', mimeType: 'image/png' };
    expect(selectProviderChain(file)).toEqual(['documentAi', 'claudeVision']);
  });

  it('Google Doc: тільки pdfjsLocal (експорт як text/plain)', () => {
    const file = { name: 'note', mimeType: 'application/vnd.google-apps.document' };
    expect(selectProviderChain(file)).toEqual(['pdfjsLocal']);
  });

  it('text/plain: тільки pdfjsLocal', () => {
    const file = { name: 'readme.txt', mimeType: 'text/plain' };
    expect(selectProviderChain(file)).toEqual(['pdfjsLocal']);
  });

  it('text/markdown: тільки pdfjsLocal', () => {
    const file = { name: 'notes.md', mimeType: 'text/markdown' };
    expect(selectProviderChain(file)).toEqual(['pdfjsLocal']);
  });

  it('html: тільки pdfjsLocal (включно з ЄСІТС ухвалами у windows-1251)', () => {
    const file = { name: 'court_order.html', mimeType: 'text/html' };
    expect(selectProviderChain(file)).toEqual(['pdfjsLocal']);
  });

  it('xhtml: тільки pdfjsLocal', () => {
    const file = { name: 'doc.xhtml', mimeType: 'application/xhtml+xml' };
    expect(selectProviderChain(file)).toEqual(['pdfjsLocal']);
  });

  it('DOCX (непідтримуваний): порожній ланцюжок', () => {
    const file = {
      name: 'contract.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    expect(selectProviderChain(file)).toEqual([]);
  });

  it('null / undefined: порожній ланцюжок', () => {
    expect(selectProviderChain(null)).toEqual([]);
    expect(selectProviderChain(undefined)).toEqual([]);
  });

  it('повертає копію — мутація caller не міняє внутрішній стан', () => {
    const a = selectProviderChain({ name: 'a.pdf', mimeType: 'application/pdf' });
    a.push('mutated');
    const b = selectProviderChain({ name: 'b.pdf', mimeType: 'application/pdf' });
    expect(b).toEqual(['pdfjsLocal', 'documentAi', 'claudeVision']);
  });
});

describe('hasAnyProvider', () => {
  it('true для PDF, image, тексту, HTML', () => {
    expect(hasAnyProvider({ mimeType: 'application/pdf' })).toBe(true);
    expect(hasAnyProvider({ mimeType: 'image/jpeg' })).toBe(true);
    expect(hasAnyProvider({ mimeType: 'text/plain' })).toBe(true);
    expect(hasAnyProvider({ mimeType: 'text/html' })).toBe(true);
  });

  it('false для DOCX, XLSX, PPTX', () => {
    expect(hasAnyProvider({ name: 'doc.docx', mimeType: 'application/octet-stream' })).toBe(false);
    expect(hasAnyProvider({ name: 'table.xlsx' })).toBe(false);
  });

  it('false для null', () => {
    expect(hasAnyProvider(null)).toBe(false);
  });
});

describe('FALLBACK_CHAINS_BY_MIME — структура', () => {
  it('кожен запис має name, test, chain', () => {
    for (const entry of FALLBACK_CHAINS_BY_MIME) {
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.test).toBe('function');
      expect(Array.isArray(entry.chain)).toBe(true);
      expect(entry.chain.length).toBeGreaterThan(0);
    }
  });

  it('усі провайдери в ланцюжках — з відомого набору', () => {
    const known = new Set(['pdfjsLocal', 'documentAi', 'claudeVision']);
    for (const entry of FALLBACK_CHAINS_BY_MIME) {
      for (const provider of entry.chain) {
        expect(known.has(provider)).toBe(true);
      }
    }
  });

  it('PDF-ланцюжок саме pdfjsLocal-first — економія викликів Document AI', () => {
    const pdfEntry = FALLBACK_CHAINS_BY_MIME.find((e) => e.name === 'pdf');
    expect(pdfEntry.chain[0]).toBe('pdfjsLocal');
  });
});
