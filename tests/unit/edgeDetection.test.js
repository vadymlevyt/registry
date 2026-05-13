// @vitest-environment node
// Юніт-тести для edgeDetection. detectDocumentEdges потребує JPEG decoding
// (Canvas + Image API) — не тестується тут. Тестуємо чисту логіку
// boundsAboveThreshold через __test__ експорт.

import { describe, it, expect } from 'vitest';
import { __test__ } from '../../src/services/sortation/edgeDetection.js';

const { boundsAboveThreshold, MIN_AREA_FRACTION, MAX_AREA_FRACTION, BRIGHTNESS_ENTRY_THRESHOLD } = __test__;

describe('edgeDetection.boundsAboveThreshold (TASK B fix Problem 3b)', () => {
  // Хелпер: масив значень довжини N, з певних індексів вище порогу.
  function arr(n, aboveIndices, aboveVal = 100, baseVal = 0) {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = baseVal;
    for (const i of aboveIndices) a[i] = aboveVal;
    return a;
  }

  it('всі 4 сторони знайдено → повертає правильний bbox', () => {
    const dw = 100, dh = 100;
    // Документ з row 20-80, col 30-70
    const rowAbove = [];
    for (let i = 20; i <= 80; i++) rowAbove.push(i);
    const colAbove = [];
    for (let i = 30; i <= 70; i++) colAbove.push(i);
    const r = boundsAboveThreshold(arr(dh, rowAbove), arr(dw, colAbove), 50, 50, dw, dh);
    expect(r).not.toBe(null);
    expect(r.top).toBe(20);
    expect(r.bottom).toBe(80);
    expect(r.left).toBe(30);
    expect(r.right).toBe(70);
  });

  it('документ упирається в лівий край → left=0, інші знайдено', () => {
    const dw = 100, dh = 100;
    // Документ row 20-80, col 0-70 (упирається у left edge)
    const rowAbove = [];
    for (let i = 20; i <= 80; i++) rowAbove.push(i);
    const colAbove = [];
    for (let i = 0; i <= 70; i++) colAbove.push(i);
    const r = boundsAboveThreshold(arr(dh, rowAbove), arr(dw, colAbove), 50, 50, dw, dh);
    expect(r).not.toBe(null);
    expect(r.top).toBe(20);
    expect(r.bottom).toBe(80);
    expect(r.left).toBe(0);
    expect(r.right).toBe(70);
  });

  it('документ упирається в верхній і правий край → top=0, right=dw-1', () => {
    const dw = 100, dh = 100;
    const rowAbove = [];
    for (let i = 0; i <= 80; i++) rowAbove.push(i);
    const colAbove = [];
    for (let i = 30; i <= 99; i++) colAbove.push(i);
    const r = boundsAboveThreshold(arr(dh, rowAbove), arr(dw, colAbove), 50, 50, dw, dh);
    expect(r).not.toBe(null);
    expect(r.top).toBe(0);
    expect(r.bottom).toBe(80);
    expect(r.left).toBe(30);
    expect(r.right).toBe(99);
  });

  it('документ упирається у 2 суміжні краї (left+top) → знайдено інші 2', () => {
    const dw = 100, dh = 100;
    // row 0-70, col 0-50 — упирається у top і left
    const rowAbove = [];
    for (let i = 0; i <= 70; i++) rowAbove.push(i);
    const colAbove = [];
    for (let i = 0; i <= 50; i++) colAbove.push(i);
    const r = boundsAboveThreshold(arr(dh, rowAbove), arr(dw, colAbove), 50, 50, dw, dh);
    expect(r).not.toBe(null);
    expect(r.top).toBe(0);
    expect(r.bottom).toBe(70);
    expect(r.left).toBe(0);
    expect(r.right).toBe(50);
  });

  it('тільки 1 сторона знайдена → null (мінімум 2)', () => {
    const dw = 100, dh = 100;
    // Тільки центральна row знайдена, по cols все нижче порогу
    const r = boundsAboveThreshold(arr(dh, [50]), arr(dw, []), 50, 50, dw, dh);
    expect(r).toBe(null);
  });

  it('знайдено тільки horizontal (top+bottom) без vertical → null', () => {
    const dw = 100, dh = 100;
    // По cols все нижче порогу — невідомо де ліво/право
    const rowAbove = [];
    for (let i = 20; i <= 80; i++) rowAbove.push(i);
    const r = boundsAboveThreshold(arr(dh, rowAbove), arr(dw, []), 50, 50, dw, dh);
    expect(r).toBe(null);
  });

  it('знайдено тільки vertical (left+right) без horizontal → null', () => {
    const dw = 100, dh = 100;
    const colAbove = [];
    for (let i = 30; i <= 70; i++) colAbove.push(i);
    const r = boundsAboveThreshold(arr(dh, []), arr(dw, colAbove), 50, 50, dw, dh);
    expect(r).toBe(null);
  });

  it('документ заповнює 95% кадру (тонкий border тільки по top і left) → детектується', () => {
    // Доки 1+ horizontal і 1+ vertical знайдено, повертаємо bbox.
    // Top/left зрозумілі по містах, bottom/right упираються у край.
    const dw = 100, dh = 100;
    const rowAbove = [];
    for (let i = 5; i <= 99; i++) rowAbove.push(i);
    const colAbove = [];
    for (let i = 5; i <= 99; i++) colAbove.push(i);
    const r = boundsAboveThreshold(arr(dh, rowAbove), arr(dw, colAbove), 50, 50, dw, dh);
    expect(r).not.toBe(null);
    expect(r.top).toBe(5);
    expect(r.left).toBe(5);
    // bottom/right розпізнаються природно бо є сигнал на цих позиціях
    expect(r.bottom).toBe(99);
    expect(r.right).toBe(99);
  });

  it('all-zero arrays → null', () => {
    const dw = 100, dh = 100;
    const r = boundsAboveThreshold(arr(dh, []), arr(dw, []), 50, 50, dw, dh);
    expect(r).toBe(null);
  });
});

describe('edgeDetection константи (TASK B fix Problem 3a)', () => {
  it('MAX_AREA_FRACTION пом\'якшено до 0.995 для tight framing', () => {
    expect(MAX_AREA_FRACTION).toBeGreaterThanOrEqual(0.99);
    expect(MAX_AREA_FRACTION).toBeLessThan(1);
  });

  it('MIN_AREA_FRACTION знижено до 0.15', () => {
    expect(MIN_AREA_FRACTION).toBeLessThanOrEqual(0.2);
    expect(MIN_AREA_FRACTION).toBeGreaterThan(0);
  });

  it('BRIGHTNESS_ENTRY_THRESHOLD знижено для слабкого контрасту', () => {
    expect(BRIGHTNESS_ENTRY_THRESHOLD).toBeLessThanOrEqual(20);
    expect(BRIGHTNESS_ENTRY_THRESHOLD).toBeGreaterThan(0);
  });
});
