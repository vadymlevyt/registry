// @vitest-environment jsdom
// V2-C — спільні хелпери підсвіток уваги (count / strip / scroll-to-mark).

import { describe, it, expect } from 'vitest';
import { countMarks, stripMarks, scrollToMark } from '../../src/components/DocumentViewer/attentionMarks.js';

describe('countMarks (V2-C)', () => {
  it('рахує ==мітки==', () => {
    expect(countMarks('==a== текст ==b==')).toBe(2);
    expect(countMarks('одна ==мітка== тут')).toBe(1);
  });
  it('без міток / null → 0', () => {
    expect(countMarks('звичайний текст')).toBe(0);
    expect(countMarks(null)).toBe(0);
    expect(countMarks('')).toBe(0);
  });
});

describe('stripMarks (V2-C)', () => {
  it('прибирає делімітери, лишає внутрішній текст ДОСЛІВНО', () => {
    expect(stripMarks('перед ==фраза== після')).toBe('перед фраза після');
    expect(stripMarks('==a== і ==b==')).toBe('a і b');
  });
  it('текст без міток лишається як є; null → ""', () => {
    expect(stripMarks('чисто без міток')).toBe('чисто без міток');
    expect(stripMarks(null)).toBe('');
  });
});

describe('scrollToMark (V2-C)', () => {
  it('додає клас is-pulse саме на мітку N (1-based)', () => {
    const div = document.createElement('div');
    div.innerHTML = '<mark class="attention" data-mark="1">a</mark><mark class="attention" data-mark="2">b</mark>';
    scrollToMark(div, 2);
    expect(div.querySelector('[data-mark="1"]').classList.contains('is-pulse')).toBe(false);
    expect(div.querySelector('[data-mark="2"]').classList.contains('is-pulse')).toBe(true);
  });
  it('нема контейнера/мітки → no-op (не кидає)', () => {
    expect(() => scrollToMark(null, 1)).not.toThrow();
    const div = document.createElement('div');
    expect(() => scrollToMark(div, 5)).not.toThrow();
  });
});
