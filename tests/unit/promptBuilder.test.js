// promptBuilder.test.js — TASK 0.4

import { describe, it, expect } from 'vitest';
import {
  buildEcitsImportPrompt,
  extractYearFromCaseNo,
  isAcceptedCaseYear,
  SCENARIO_ID,
  SCENARIO_VERSION,
  ENVELOPE_VERSION,
} from '../../src/services/ecits/promptBuilder.js';

describe('promptBuilder.extractYearFromCaseNo', () => {
  it('повертає 25 з "450/2275/25"', () => {
    expect(extractYearFromCaseNo('450/2275/25')).toBe(25);
  });
  it('повертає 26 з "367/4744/26"', () => {
    expect(extractYearFromCaseNo('367/4744/26')).toBe(26);
  });
  it('повертає 20 з "761/15469/20-ц" (відсікає -ц)', () => {
    expect(extractYearFromCaseNo('761/15469/20-ц')).toBe(20);
  });
  it('повертає null для не-string', () => {
    expect(extractYearFromCaseNo(null)).toBeNull();
    expect(extractYearFromCaseNo(undefined)).toBeNull();
    expect(extractYearFromCaseNo(123)).toBeNull();
  });
  it('повертає null для невалідного формату', () => {
    expect(extractYearFromCaseNo('something else')).toBeNull();
    expect(extractYearFromCaseNo('450/2275')).toBeNull();
  });
});

describe('promptBuilder.isAcceptedCaseYear', () => {
  it('приймає роки 25 і 26', () => {
    expect(isAcceptedCaseYear('450/2275/25')).toBe(true);
    expect(isAcceptedCaseYear('367/4744/26')).toBe(true);
  });
  it('відхиляє старі роки', () => {
    expect(isAcceptedCaseYear('761/15469/20-ц')).toBe(false);
    expect(isAcceptedCaseYear('570/3101/24')).toBe(false);
  });
});

describe('promptBuilder.buildEcitsImportPrompt', () => {
  const prompt = buildEcitsImportPrompt();

  it('містить scenarioId і envelopeVersion як константи', () => {
    expect(prompt).toContain(SCENARIO_ID);
    expect(SCENARIO_VERSION).toBe(1);
    expect(ENVELOPE_VERSION).toBe(1);
  });
  it('пояснює фільтр за роком (25 або 26)', () => {
    expect(prompt).toContain('25 або 26');
    expect(prompt).toContain('450/2275/25');
  });
  it('містить інструкцію дедуплікації засідань', () => {
    expect(prompt.toLowerCase()).toContain('дедуплі');
  });
  it('містить інструкцію повернути JSON у код-блоці', () => {
    expect(prompt).toContain('```json');
  });
  it('вшиває блок безпеки з NEVER_TOUCH', () => {
    expect(prompt).toContain('КАТЕГОРИЧНО НЕ НАТИСКАЙ');
    expect(prompt).toContain('НАДІСЛАТИ');
    expect(prompt).toContain('cabinet.court.gov.ua');
  });
  it('указує цільовий рік засідань 2026 за замовчуванням', () => {
    expect(prompt).toContain('2026');
  });
  it('приймає override targetHearingYear', () => {
    const p = buildEcitsImportPrompt({ targetHearingYear: 2027 });
    expect(p).toContain('2027');
  });
});
