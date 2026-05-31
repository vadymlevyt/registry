// Розмір/розкладка рамки дублів у DP (продовження #10).
//
// РЕГРЕС: коміт #10 додав рамку через `grid-column: 1 / -1` на
// `.dp-image-merge-editor__dup-group` → група дублів розтягувалась на весь
// рядок auto-fill сітки, а її flex-члени (flex:1 1 0) виростали ширшими за
// одиночні аркуші. Адвокат хоче: усі аркуші однакового розміру (як у модалці),
// рамка лише обіймає суміжні клітинки стандартного треку, не розтягуючи рядок.
//
// Інваріант (звірка з модалкою): жодна з рамок дублів не змінює ширину треку
// сітки — у модалці `.image-merge-panel__dup-group` НЕ має `grid-column`, тож і
// DP-варіант не має повноширинного `grid-column: 1 / -1`.
//
// Цей сторож читає CSS-файли як текст (jsdom не рахує grid-layout) і падає поки
// DP-рамка тягнеться на весь рядок.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dpCss = readFileSync(
  fileURLToPath(new URL('../../src/components/DocumentProcessorV2/styles.css', import.meta.url)),
  'utf8'
);
const modalCss = readFileSync(
  fileURLToPath(new URL('../../src/components/CaseDossier/ImageMergePanel.css', import.meta.url)),
  'utf8'
);

// Витягує тіло { ... } для селектора (перше входження).
function ruleBody(css, selector) {
  const i = css.indexOf(selector);
  if (i === -1) return null;
  const open = css.indexOf('{', i);
  const close = css.indexOf('}', open);
  if (open === -1 || close === -1) return null;
  return css.slice(open + 1, close);
}

describe('DP рамка дублів — розмір клітинок (продовження #10)', () => {
  it('.dp-image-merge-editor__dup-group НЕ розтягується на весь рядок (grid-column:1/-1)', () => {
    const body = ruleBody(dpCss, '.dp-image-merge-editor__dup-group');
    // Рамка може взагалі не мати власного правила (тоді вона звичайна клітинка
    // треку — ідеально). Якщо правило є — у ньому не має бути повноширинного
    // grid-column: 1 / -1.
    if (body !== null) {
      expect(body).not.toMatch(/grid-column\s*:\s*1\s*\/\s*-1/);
    }
  });

  it('модаль-еталон: .image-merge-panel__dup-group не задає grid-column (член = ширина треку)', () => {
    const body = ruleBody(modalCss, '.image-merge-panel__dup-group {');
    expect(body).not.toBeNull();
    expect(body).not.toMatch(/grid-column/);
  });

  it('тіло рамки лишається flex-контейнером (спільний клас, члени стандартного розміру)', () => {
    // Спільний body-клас керує розміром членів однаково для модалки і DP.
    const body = ruleBody(modalCss, '.image-merge-panel__dup-group-body ');
    expect(body).toMatch(/display\s*:\s*flex/);
  });
});
