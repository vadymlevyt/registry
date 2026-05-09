// @vitest-environment jsdom
/**
 * Responsive sanity tests — TASK 9.
 *
 * jsdom не виконує @media правил при getComputedStyle, тому тут
 * перевіряємо наявність media query текстом у завантаженому CSS.
 * Цього достатньо як guard від випадкового видалення.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const cssDir = path.resolve(__dirname, '../../src/components/UI');

function readCss(name) {
  return fs.readFileSync(path.join(cssDir, name), 'utf8');
}

describe('Responsive media queries у UI компонентах', () => {
  it('Toast.css — bottom/left full-width на <768px', () => {
    const css = readCss('Toast.css');
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*768px/);
    expect(css).toMatch(/\.ui-toast-container[\s\S]*?left:\s*var\(--space-4\)/);
  });

  it('Modal.css — 95vw на <768px', () => {
    const css = readCss('Modal.css');
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*768px/);
    expect(css).toMatch(/95vw/);
  });

  it('Banner.css — vertical actions на <480px', () => {
    const css = readCss('Banner.css');
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*480px/);
    expect(css).toMatch(/\.ui-banner__actions[\s\S]*?flex-direction:\s*column/);
  });

  it('Button.css — min-height 44px на <768px', () => {
    const css = readCss('Button.css');
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*768px/);
    expect(css).toMatch(/min-height:\s*44px/);
  });

  it('Input.css — min-height 44px і font-size 16px на <768px', () => {
    const css = readCss('Input.css');
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*768px/);
    expect(css).toMatch(/min-height:\s*44px/);
    expect(css).toMatch(/font-size:\s*16px/);
  });

  it('Select.css — min-height 44px і font-size 16px на <768px', () => {
    const css = readCss('Select.css');
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*768px/);
    expect(css).toMatch(/min-height:\s*44px/);
    expect(css).toMatch(/font-size:\s*16px/);
  });

  it('Tabs.css — overflow-x scroll на <768px', () => {
    const css = readCss('Tabs.css');
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*768px/);
    expect(css).toMatch(/overflow-x:\s*auto/);
  });

  it('Tooltip.css — приховано на touch (hover: none)', () => {
    const css = readCss('Tooltip.css');
    expect(css).toMatch(/@media\s*\(\s*hover:\s*none/);
    expect(css).toMatch(/display:\s*none/);
  });
});

describe('Tokens в використанні — CaseDossier', () => {
  it('CaseDossier не використовує fontFamily Segoe UI', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/components/CaseDossier/index.jsx'),
      'utf8'
    );
    expect(src).not.toMatch(/Segoe UI/);
  });

  it('CaseDossier не містить hex кольорів окрім #fff та винятків', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/components/CaseDossier/index.jsx'),
      'utf8'
    );
    const hexes = src.match(/#[0-9a-fA-F]{3,8}/g) || [];
    const allowedHexes = new Set(['#fff', '#a855f7']);
    const unexpected = hexes.filter(h => !allowedHexes.has(h.toLowerCase()));
    expect(unexpected).toEqual([]);
  });
});
