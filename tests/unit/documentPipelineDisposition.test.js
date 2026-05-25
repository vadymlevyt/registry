// classifyDisposition — ЄДИНА політика диригента documentPipeline.
// Покриває нову диспозицію 'halt' (TASK degenerate-plan) + regression на
// три наявні: 'continue' / 'fatal' / 'skip'. Якщо хтось пересуне
// перевірку halt'а під ok-перевірку — впаде тест "halt вище ok"; якщо
// прибере fallback на fatal — впаде "ok:false без полів → fatal".
import { describe, it, expect } from 'vitest';
import { classifyDisposition } from '../../src/services/documentPipeline.js';

describe('classifyDisposition — нова диспозиція halt', () => {
  it('halt:true → "halt"', () => {
    expect(classifyDisposition({ halt: true })).toBe('halt');
  });

  it('halt:true разом з ok:false → "halt" (halt має пріоритет над ok)', () => {
    expect(classifyDisposition({ halt: true, ok: false })).toBe('halt');
  });

  it('halt:true разом з ok:true → "halt" (halt вище ok)', () => {
    expect(classifyDisposition({ halt: true, ok: true })).toBe('halt');
  });
});

describe('classifyDisposition — regression на три наявні диспозиції', () => {
  it('ok:true → "continue"', () => {
    expect(classifyDisposition({ ok: true })).toBe('continue');
  });

  it('ok:false з error.fatal → "fatal"', () => {
    expect(classifyDisposition({ ok: false, error: { fatal: true } })).toBe('fatal');
  });

  it('ok:false з error.file_skipped → "skip"', () => {
    expect(classifyDisposition({ ok: false, error: { file_skipped: true } })).toBe('skip');
  });

  it('ok:false без полів → "fatal" (інваріант: невідома форма = fatal)', () => {
    expect(classifyDisposition({ ok: false })).toBe('fatal');
  });

  it('null / undefined → "fatal" (захист від відсутнього результату)', () => {
    expect(classifyDisposition(null)).toBe('fatal');
    expect(classifyDisposition(undefined)).toBe('fatal');
  });
});
