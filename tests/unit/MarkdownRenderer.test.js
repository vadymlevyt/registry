// V2-C — рендер інлайн-міток уваги ==фраза== у MarkdownRenderer.
// ==x== → <mark class="attention" data-mark="N"> на ВЖЕ екранованому тексті
// (XSS-safe), N — порядковий номер у документі (пара до списку панелі в'ювера).

import { describe, it, expect } from 'vitest';
import { markdownToHtml } from '../../src/components/DocumentViewer/MarkdownRenderer.jsx';

describe('MarkdownRenderer — підсвітки уваги ==мітка== (V2-C)', () => {
  it('==x== → <mark class="attention" data-mark="1">x</mark>', () => {
    const html = markdownToHtml('Текст ==сумнів== далі');
    expect(html).toContain('<mark class="attention" data-mark="1">сумнів</mark>');
  });

  it('кілька міток нумеруються за ПОРЯДКОМ (1,2,3) через абзаци', () => {
    const html = markdownToHtml('==перша==\n\n==друга==\n\nкінець ==третя==');
    expect(html).toContain('data-mark="1">перша<');
    expect(html).toContain('data-mark="2">друга<');
    expect(html).toContain('data-mark="3">третя<');
  });

  it('нумерація скидається між рендерами (повторний виклик знову з 1)', () => {
    markdownToHtml('==a== ==b==');           // лічильник дійшов до 2
    const html = markdownToHtml('==c==');    // новий рендер → з 1
    expect(html).toContain('data-mark="1">c<');
    expect(html).not.toContain('data-mark="2"');
  });

  it('XSS-safe: вміст мітки екранується (як решта inline)', () => {
    const html = markdownToHtml('==<script>alert(1)</script>==');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('data-mark="1"');
  });

  it('без міток — жодного <mark>', () => {
    expect(markdownToHtml('звичайний текст без позначок')).not.toContain('<mark');
  });

  it('мітка у комірці таблиці рахується у глобальному порядку документа', () => {
    const md = '==поза== таблицею\n\n| A | B |\n| --- | --- |\n| ==вкомірці== | x |';
    const html = markdownToHtml(md);
    expect(html).toContain('data-mark="1">поза<');
    expect(html).toContain('data-mark="2">вкомірці<');
  });
});
