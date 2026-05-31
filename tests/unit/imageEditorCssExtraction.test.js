// Інваріант розділення CSS редактора зображень (TASK imageeditor_css_extraction).
//
// КОРІНЬ ПРОБЛЕМИ (доведено в попередній сесії): JSX редактора винесли у спільний
// `src/components/ImageEditor/*`, а CSS лишили в `CaseDossier/ImageMergePanel.css`,
// який вантажиться ЛИШЕ через модалку (`AddDocumentModal.jsx`). Тому документ-
// процесор (`DpImageMergeEditor`) рендерив спільний `Thumbnail`/`RenderItem` без
// володіння стилями → клітинки різної висоти, якщо модалку не відкривали.
//
// Цей сторож фіксує ІСТИННЕ розділення (reproduce-first — був би червоний до
// рефактора, бо imageEditor.css ще не існував і правил у ньому не було):
//   1. Спільні правила живуть у ImageEditor/imageEditor.css.
//   2. Їх НЕМАЄ більше в модалковому ImageMergePanel.css (не «копія», а перенос).
//   3. Спільний компонент (Thumbnail.jsx) сам імпортує imageEditor.css.
//   4. .image-merge-panel__grid має align-items:start (рамка дублів не розтягує
//      сусідні одиночні клітинки в рядку — остання причина «різної висоти»).
//   5. Модалковий хром (черга/форма/sfw) лишився у ImageMergePanel.css і НЕ
//      протік у спільний файл.
//
// Читаємо файли як текст (стиль наявного dpDuplicateFrameLayout.test.js) — DOM
// не потрібен.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sharedCss = readFileSync(
  fileURLToPath(new URL('../../src/components/ImageEditor/imageEditor.css', import.meta.url)),
  'utf8'
);
const modalCss = readFileSync(
  fileURLToPath(new URL('../../src/components/CaseDossier/ImageMergePanel.css', import.meta.url)),
  'utf8'
);
const thumbnailJsx = readFileSync(
  fileURLToPath(new URL('../../src/components/ImageEditor/Thumbnail.jsx', import.meta.url)),
  'utf8'
);

// Витягує тіло { ... } для першого входження селектора (рівно перший рівень дужок).
function ruleBody(css, selector) {
  const i = css.indexOf(selector);
  if (i === -1) return null;
  const open = css.indexOf('{', i);
  if (open === -1) return null;
  let depth = 0;
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, j);
    }
  }
  return null;
}

// Спільні класи, що реферясь зі спільного шару (ImageEditor/*) та/або документ-
// процесора (DpImageMergeEditor) — мусять жити у imageEditor.css.
const SHARED_SELECTORS = [
  '.image-merge-panel__grid',
  '.image-merge-panel__grid--loading',
  '.image-merge-panel__thumb',
  '.image-merge-panel__thumb-img',
  '.image-merge-panel__thumb-image-wrap',
  '.image-merge-panel__thumb-actions',
  '.image-merge-panel__dup-group',
  '.image-merge-panel__dup-group-body',
  '.image-merge-panel__popup-overlay',
  '.image-merge-panel__popup-canvas',
  '.image-merge-panel__popup-fitimg',
  '.image-merge-panel__cropper',
  '.image-merge-panel__ctxmenu',
  '.image-merge-panel__alert',
  '.image-merge-panel__alert--dup',
  '.image-merge-panel__remove-suspicious',
];

// Модалковий хром — лишається в ImageMergePanel.css, НЕ протікає у спільний.
const MODAL_ONLY_SELECTORS = [
  '.image-merge-panel__queue',
  '.image-merge-panel__source-btn',
  '.image-merge-panel__phase-stepper',
  '.image-merge-panel__form',
  '.image-merge-panel__sfw',
];

describe('CSS-розділення редактора зображень', () => {
  it('спільний компонент Thumbnail.jsx сам імпортує imageEditor.css', () => {
    expect(thumbnailJsx).toMatch(/import\s+['"]\.\/imageEditor\.css['"]/);
  });

  it('спільні правила присутні в imageEditor.css і прибрані з ImageMergePanel.css', () => {
    for (const sel of SHARED_SELECTORS) {
      // Має існувати у спільному файлі…
      expect(ruleBody(sharedCss, sel + ' '), `${sel} відсутній у imageEditor.css`).not.toBeNull();
      // …і НЕ лишитися визначеним у модалковому (true separation, не копія).
      // Перевіряємо саме оголошення правила `<sel> {` або `<sel>,`/`<sel>{`.
      const definedInModal =
        new RegExp(sel.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '\\s*[{,]').test(modalCss);
      expect(definedInModal, `${sel} ще визначений у ImageMergePanel.css (має бути перенесений)`).toBe(false);
    }
  });

  it('.image-merge-panel__thumb-img у спільному файлі задає фіксовану height (рівні клітинки)', () => {
    const body = ruleBody(sharedCss, '.image-merge-panel__thumb-img {');
    expect(body).not.toBeNull();
    expect(body).toMatch(/height\s*:\s*140px/);
    expect(body).toMatch(/object-fit\s*:\s*cover/);
  });

  it('.image-merge-panel__grid у спільному файлі має align-items:start', () => {
    const body = ruleBody(sharedCss, '.image-merge-panel__grid {');
    expect(body).not.toBeNull();
    expect(body).toMatch(/align-items\s*:\s*start/);
  });

  it('модалковий хром лишився в ImageMergePanel.css і НЕ протік у imageEditor.css', () => {
    for (const sel of MODAL_ONLY_SELECTORS) {
      expect(ruleBody(modalCss, sel), `${sel} зник з ImageMergePanel.css`).not.toBeNull();
      const inShared =
        new RegExp(sel.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '\\s*[{,]').test(sharedCss);
      expect(inShared, `${sel} помилково потрапив у imageEditor.css`).toBe(false);
    }
  });
});
