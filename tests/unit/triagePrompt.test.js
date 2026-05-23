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

  // ── ФД-D3 — оновлення triagePrompt інструкціями про сукупність сигналів ────
  describe('ФД-D3: категорії сигналів (СИЛЬНІ / СИЛЬНІ-АНТИ / ДОРАДЧІ / МЕТА)', () => {
    it('інструктує зважувати сигнали РАЗОМ, жоден сам не вирішує', () => {
      const p = buildTriagePrompt({ artifacts });
      expect(p).toMatch(/зважуй РАЗОМ/i);
      expect(p).toMatch(/жоден сигнал САМ не вирішує/i);
    });

    it('розділ СИЛЬНІ містить ПОЧАТОК-ДОКУМЕНТА, КІНЕЦЬ-ДОКУМЕНТА, СКИДАННЯ-НУМЕРАЦІЇ, ЯКІР-ДОКУМЕНТА', () => {
      const p = buildTriagePrompt({ artifacts });
      expect(p).toMatch(/СИЛЬНІ/);
      expect(p).toContain('ПОЧАТОК-ДОКУМЕНТА');
      expect(p).toContain('КІНЕЦЬ-ДОКУМЕНТА');
      expect(p).toContain('СКИДАННЯ-НУМЕРАЦІЇ');
      expect(p).toContain('ЯКІР-ДОКУМЕНТА');
    });

    it('ЯКІР-ДОКУМЕНТА перелічує типові українські юр. заголовки (невичерпний список)', () => {
      const p = buildTriagePrompt({ artifacts });
      // Кілька представників з UA_DOC_HEADERS
      expect(p).toContain('ПОСТАНОВА');
      expect(p).toContain('УХВАЛА');
      expect(p).toContain('ПРОТОКОЛ');
      expect(p).toContain('ВИМОГА');
      // Явна позначка про невичерпність (AI може кваліфікувати інший заголовок)
      expect(p).toMatch(/невичерпний/i);
    });

    it('розділ СИЛЬНІ-АНТИ містить продовження-абзацу з поясненням', () => {
      const p = buildTriagePrompt({ artifacts });
      expect(p).toMatch(/СИЛЬНІ-АНТИ/);
      expect(p).toContain('продовження-абзацу');
      expect(p).toMatch(/НЕ ставити boundary/i);
    });

    it('розділ ДОРАДЧІ містить нові сигнали (table-domінує, дефекти-зміна, печатка/підпис, док-стор)', () => {
      const p = buildTriagePrompt({ artifacts });
      expect(p).toMatch(/ДОРАДЧІ/);
      expect(p).toContain('таблиця-домінює');
      expect(p).toContain('дефекти-зміна');
      expect(p).toContain('печатка/підпис');
      expect(p).toContain('стрибок-якості');
      expect(p).toContain('розріджена');
      expect(p).toContain('зміна-формату');
      expect(p).toContain('зміна-мови');
      expect(p).toContain('док-стор:N/M');
      expect(p).toContain('можливий-абзацний-розрив');
    });

    it('розділ МЕТАІНФОРМАЦІЯ містить OCR-низька з прозорим попередженням', () => {
      const p = buildTriagePrompt({ artifacts });
      expect(p).toMatch(/МЕТАІНФОРМАЦІЯ/);
      expect(p).toContain('OCR-низька');
      expect(p).toMatch(/не сигнал межі|НЕ сигнал межі/);
      expect(p).toMatch(/шум OCR/i);
    });

    it('українські судові патерни — коротких документів НЕ зливати в один (крим/адмін специфіка)', () => {
      const p = buildTriagePrompt({ artifacts });
      expect(p).toMatch(/коротк.*документ.*кримінал|кримінал.*коротк/i);
      expect(p).toMatch(/НЕ\s+зливай/i);
    });

    it('без емодзі і після ФД-D3 (§2.9 правило #5)', () => {
      const p = buildTriagePrompt({ artifacts });
      expect(p).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    });
  });
});
