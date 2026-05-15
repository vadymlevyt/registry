// Паритет-тести documentBoundary (TASK 1 salvage).
// splitPdf — поведінка = legacy splitPDFByDocuments (DocumentProcessor:108-141).
// buildBoundaryPrompt — снапшот = legacy промпт (DocumentProcessor:189-222)
// дослівно; regression-guard від ненавмисного дрейфу інституційного тексту.
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { splitPdf } from '../../src/services/documentBoundary/splitPdf.js';
import { buildBoundaryPrompt } from '../../src/services/documentBoundary/prompt.js';

async function makePdf(pages) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([100, 100]);
  return doc.save({ useObjectStreams: true });
}

describe('documentBoundary.splitPdf — паритет з legacy splitPDFByDocuments', () => {
  it('ріже PDF на діапазони з очікуваним pageCount і метаданими', async () => {
    const src = await makePdf(10);
    const out = await splitPdf(src, [
      { name: 'A', type: 'pleading', startPage: 1, endPage: 3 },
      { name: 'B', type: 'evidence', startPage: 4, endPage: 10 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].pageCount).toBe(3);
    expect(out[1].pageCount).toBe(7);
    expect(out[0].name).toBe('A');
    expect(out[0].type).toBe('pleading');
    expect(typeof out[0].sizeMB).toBe('string');
    const a = await PDFDocument.load(out[0].data);
    expect(a.getPageCount()).toBe(3);
  });

  it('endPage > totalPages → clamp (legacy рядок 116)', async () => {
    const src = await makePdf(5);
    const out = await splitPdf(src, [{ name: 'X', type: 'other', startPage: 3, endPage: 99 }]);
    expect(out).toHaveLength(1);
    expect(out[0].pageCount).toBe(3); // сторінки 3,4,5
  });

  it('startPage поза межами → skip (legacy рядок 118)', async () => {
    const src = await makePdf(4);
    const out = await splitPdf(src, [
      { name: 'keep', type: 'other', startPage: 1, endPage: 2 },
      { name: 'skip', type: 'other', startPage: 99, endPage: 100 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('keep');
  });
});

describe('documentBoundary.buildBoundaryPrompt — снапшот legacy дослівно', () => {
  // Тіло промпту (частина після інтерпольованого рядка hint). Дослівно з
  // DocumentProcessor:191-222.
  const PROMPT_BODY = `Прочитай весь документ і визнач де починається кожен окремий документ.
Шукай: нові заголовки, печатки, підписи, нову нумерацію сторінок, зміну типу документа.

Поверни ТІЛЬКИ JSON без жодного тексту до або після:
{
  "totalPages": 65,
  "documents": [
    {
      "name": "Титульна сторінка судової справи",
      "startPage": 1,
      "endPage": 1,
      "type": "court_cover"
    },
    {
      "name": "Позовна заява Брановської Л.Б.",
      "startPage": 2,
      "endPage": 8,
      "type": "pleading"
    }
  ]
}

Типи документів (type):
- court_cover: титульна сторінка справи
- pleading: позовна заява, відзив, заперечення
- court_act: ухвала, рішення, постанова суду
- evidence: докази, додатки, довідки
- certificate: свідоцтво, витяг з реєстру
- contract: договір, угода
- other: інше

ВАЖЛИВО: визначай межі тільки на основі реального вмісту. Не вигадуй документи яких немає.`;

  // Legacy шаблон: `Це PDF файл судової справи. ${hint ? "Контекст: "+hint : ""}\n\n` + body.
  // Порожній hint лишає кінцевий пробіл після "справи." (артефакт інтерполяції) — навмисно дослівно.
  const LEGACY_NO_HINT = 'Це PDF файл судової справи. \n\n' + PROMPT_BODY;
  const LEGACY_WITH_HINT = 'Це PDF файл судової справи. Контекст: справа Брановського\n\n' + PROMPT_BODY;

  it('без hint — дослівно як legacy (з кінцевим пробілом після "справи.")', () => {
    expect(buildBoundaryPrompt('')).toBe(LEGACY_NO_HINT);
  });

  it('з hint — дослівно як legacy з блоком "Контекст: <hint>"', () => {
    expect(buildBoundaryPrompt('справа Брановського')).toBe(LEGACY_WITH_HINT);
  });
});
