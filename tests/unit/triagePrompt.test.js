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

  // ── Філософія: думай у сукупності, інструкції — орієнтир не догма ───────────
  // Промпт переосмислено: замість жорстких категорій «СИЛЬНІ / СИЛЬНІ-АНТИ /
  // ДОРАДЧІ» (де один сигнал міг блокувати/форсити рішення) — фрейм «зважуй
  // у сукупності, перевіряй сам». Списки сигналів — підказки досвіду
  // адвоката, не правила виконання.
  describe('філософія промпта (думай, не виконуй буквально)', () => {
    it('інструктує аналізувати сигнали у сукупності; жоден сам не вирішує', () => {
      const p = buildTriagePrompt({ artifacts });
      expect(p).toMatch(/в\s+сукупності/i);
      expect(p).toMatch(/жоден сигнал сам не вирішує/i);
    });

    it('пояснює природу метаданих Document AI як сирого матеріалу для аналізу', () => {
      const p = buildTriagePrompt({ artifacts });
      expect(p).toMatch(/ЩО ТИ БАЧИШ НА ВХОДІ/);
      expect(p).toMatch(/метадан[іи].*Document AI/i);
      expect(p).toMatch(/сирий матеріал|сирого матеріалу/i);
      expect(p).toMatch(/не\s+готовий вердикт/i);
    });

    it('послідовність сторінок поданa як орієнтир, не як аксіома (дозволяє image_merge / fragment_reconstruct)', () => {
      const p = buildTriagePrompt({ artifacts });
      // Послідовність — типовий випадок з якого корисно починати
      expect(p).toMatch(/як правило|зазвичай.*послідов|типов/i);
      // Але явно дозволяється що сторінки можуть бути розкидані
      expect(p).toMatch(/розкидан|переплутан|у різні спроби|в різні спроби/i);
      // image_merge / fragment_reconstruct — підказки що сторінки одного
      // документа МОЖУТЬ бути розкидані по файлах
      expect(p).toContain('image_merge');
      expect(p).toContain('fragment_reconstruct');
    });

    it('секція "ПРИНЦИП РІШЕННЯ" явно дозволяє відхилення від орієнтирів', () => {
      const p = buildTriagePrompt({ artifacts });
      expect(p).toMatch(/ПРИНЦИП РІШЕННЯ/);
      expect(p).toMatch(/Думай/);
      expect(p).toMatch(/орієнтир.*не\s+догма/i);
      expect(p).toMatch(/Усе перевіряй сам/i);
    });
  });

  describe('орієнтири початку документа (ПОЧАТОК-ДОКУМЕНТА / ЯКІР / СКИДАННЯ-НУМЕРАЦІЇ)', () => {
    it('перелічує всі сигнали початку нового документа', () => {
      const p = buildTriagePrompt({ artifacts });
      expect(p).toMatch(/ОРІЄНТИРИ ПОЧАТКУ/);
      expect(p).toContain('ЯКІР-ДОКУМЕНТА');
      expect(p).toContain('ПОЧАТОК-ДОКУМЕНТА');
      expect(p).toContain('СКИДАННЯ-НУМЕРАЦІЇ');
    });

    it('ЯКІР-ДОКУМЕНТА перелічує типові українські юр. заголовки (невичерпний список)', () => {
      const p = buildTriagePrompt({ artifacts });
      expect(p).toContain('ПОСТАНОВА');
      expect(p).toContain('УХВАЛА');
      expect(p).toContain('ПРОТОКОЛ');
      expect(p).toContain('ВИМОГА');
      expect(p).toMatch(/невичерпний/i);
    });
  });

  describe('орієнтири кінця документа (КІНЕЦЬ-ДОКУМЕНТА / підпис+розріджена)', () => {
    it('містить сигнали кінця документа з поясненням комбінації', () => {
      const p = buildTriagePrompt({ artifacts });
      expect(p).toMatch(/ОРІЄНТИРИ КІНЦЯ/);
      expect(p).toContain('КІНЕЦЬ-ДОКУМЕНТА');
      expect(p).toContain('печатка/підпис:signature');
      expect(p).toContain('розріджена');
    });

    it('застерігає що сама печатка/підпис без комбінації — недостатньо', () => {
      const p = buildTriagePrompt({ artifacts });
      // Експертиза з печаткою на кожній сторінці — класична пастка
      expect(p).toMatch(/недостатньо|сам.*підпис|сама.*печатка/i);
      expect(p).toMatch(/КОМБІНАЦІЯ|комбінаці/);
    });
  });

  describe('допоміжні сигнали і метаінформація', () => {
    it('допоміжні сигнали перелічені (таблиця-домінює, дефекти-зміна, стрибок-якості, мова тощо)', () => {
      const p = buildTriagePrompt({ artifacts });
      expect(p).toMatch(/ДОПОМІЖНІ СИГНАЛИ/);
      expect(p).toContain('таблиця-домінює');
      expect(p).toContain('дефекти-зміна');
      expect(p).toContain('печатка/підпис');
      expect(p).toContain('стрибок-якості');
      expect(p).toContain('розріджена');
      expect(p).toContain('зміна-формату');
      expect(p).toContain('зміна-мови');
      expect(p).toContain('док-стор:N/M');
    });

    it('видалені сигнали (абзацна евристика) не згадуються', () => {
      const p = buildTriagePrompt({ artifacts });
      expect(p).not.toContain('продовження-абзацу');
      expect(p).not.toContain('можливий-абзацний-розрив');
      expect(p).not.toMatch(/СИЛЬНІ-АНТИ/);
    });

    it('секція МЕТАІНФОРМАЦІЯ описує OCR-низька як попередження, не сигнал межі', () => {
      const p = buildTriagePrompt({ artifacts });
      expect(p).toMatch(/МЕТАІНФОРМАЦІЯ/);
      expect(p).toContain('OCR-низька');
      expect(p).toMatch(/НЕ сигнал межі/);
      expect(p).toMatch(/шум OCR/i);
    });
  });

  describe('українські судові патерни', () => {
    it('коротких документів у крим/адмін НЕ зливати в один', () => {
      const p = buildTriagePrompt({ artifacts });
      expect(p).toMatch(/коротк.*документ.*кримінал|кримінал.*коротк/i);
      expect(p).toMatch(/НЕ\s+зливай/i);
    });

    it('без емодзі після переписання (§2.9 правило #5)', () => {
      const p = buildTriagePrompt({ artifacts });
      expect(p).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    });
  });
});
