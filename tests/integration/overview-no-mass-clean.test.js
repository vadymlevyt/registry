// V2-C — Огляд БЕЗ масової очистки текстів. Кнопку «Очистити тексти»,
// handleCleanAllTexts і services/cleanTextCycle.js прибрано (масовий AI = «годинна»
// проблема; Огляд = тільки Точний, AI-режими — у в'ювері по одному документу).
// Регресія-гард на рівні джерела + перевірка, що сервіс циклу видалено.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

const dossierSrc = readFileSync(
  new URL('../../src/components/CaseDossier/index.jsx', import.meta.url),
  'utf8',
);

describe('V2-C — прибрано Огляд-кнопку «Очистити тексти»', () => {
  it('CaseDossier не містить кнопки / handler / cycle / ResultCard масової очистки', () => {
    expect(dossierSrc).not.toContain('Очистити тексти');
    expect(dossierSrc).not.toContain('handleCleanAllTexts');
    expect(dossierSrc).not.toContain('cleanTextCycle');
    expect(dossierSrc).not.toContain('partitionForCleaning');
    expect(dossierSrc).not.toContain('runCleanCycle');
    expect(dossierSrc).not.toContain('CleanResultCard');
  });

  it('сервіс cleanTextCycle.js видалено (більше ніким не вживається)', () => {
    const cyclePath = new URL(
      '../../src/components/CaseDossier/services/cleanTextCycle.js',
      import.meta.url,
    );
    expect(existsSync(cyclePath)).toBe(false);
  });

  it('CaseDossier має V2-C-шви підсвіток (load notes + remove-all marks)', () => {
    expect(dossierSrc).toContain('handleLoadAttentionNotes');
    expect(dossierSrc).toContain('handleRemoveAllMarks');
    expect(dossierSrc).toContain('onLoadAttentionNotes');
    expect(dossierSrc).toContain('onRemoveAllMarks');
  });
});
