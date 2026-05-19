// Ф2 — buildTriagePrompt: структурний тест (промпт новий, НЕ verbatim-снапшот).
import { describe, it, expect } from 'vitest';
import { buildTriagePrompt } from '../../src/services/documentBoundary/triagePrompt.js';

describe('buildTriagePrompt', () => {
  const artifacts = [
    { fileId: 'f0', name: 'IMG_001.jpg', origin: 'was-image', pageCount: 1, passport: '=== СТОРІНКА 1 ===\nфото' },
    { fileId: 'f1', name: 'sprava.pdf', origin: 'pdf', pageCount: 65, passport: '=== СТОРІНКА 1 ===\n[заголовок:"РІШЕННЯ"]\nтекст' },
  ];

  it('містить усі route з enum', () => {
    const p = buildTriagePrompt({ artifacts });
    for (const r of ['add_as_is', 'slice', 'image_merge', 'fragment_reconstruct', 'to_fragments', 'discard']) {
      expect(p).toContain(`"${r}"`);
    }
  });

  it('перелічує артефакти з fileId/name/origin/pageCount/passport', () => {
    const p = buildTriagePrompt({ artifacts });
    expect(p).toContain('fileId: f0');
    expect(p).toContain('name: IMG_001.jpg');
    expect(p).toContain('origin: was-image');
    expect(p).toContain('pageCount: 65');
    expect(p).toContain('=== СТОРІНКА 1 ===');
  });

  it('інструктує JSON-only + маркери + userHint', () => {
    const p = buildTriagePrompt({ artifacts, userHint: 'цивільна справа' });
    expect(p).toContain('ТІЛЬКИ JSON');
    expect(p).toMatch(/ВИКЛЮЧНО за маркерами/);
    expect(p).toContain('Контекст: цивільна справа');
  });

  it('без емодзі (§2.9)', () => {
    const p = buildTriagePrompt({ artifacts });
    expect(p).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('порожній passport → явна позначка', () => {
    const p = buildTriagePrompt({ artifacts: [{ fileId: 'f0', name: 'x', passport: '' }] });
    expect(p).toContain('(порожній');
  });

  // G5 (bug 4): квитанція судового збору приклеювалась до титулу/позову.
  // Промпт явно інструктує її як окремий документ + посилює сигнали меж.
  it('G5: інструкція про квитанцію судового збору як окремий документ', () => {
    const p = buildTriagePrompt({ artifacts });
    expect(p).toMatch(/судов(ого|ий) збор/i);
    expect(p).toMatch(/ОКРЕМИЙ документ/);
    expect(p).toMatch(/НІКОЛИ не приклеюй/);
    expect(p).toContain('СКИДАННЯ-НУМЕРАЦІЇ');
    expect(p).toMatch(/to_fragments/);
  });

  it('G5: нова інструкція без емодзі (§2.9)', () => {
    const p = buildTriagePrompt({ artifacts });
    expect(p).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});
