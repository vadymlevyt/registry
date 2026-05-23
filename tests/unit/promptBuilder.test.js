// promptBuilder.test.js — TASK 0.4 + TASK 0.4.1 (фільтр ролей, primaryParty,
// кримінальні з кількома обвинуваченими, економія кроків, checkpoint)

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

// ── TASK 0.4.1 — 5 нових блоків промпту ────────────────────────────────────
describe('promptBuilder.buildEcitsImportPrompt — TASK 0.4.1 блоки', () => {
  const prompt = buildEcitsImportPrompt();

  // Блок 1 — Детермінований фільтр ролей
  it("Блок 1: інструкція пропускати справи з ролі рівно одне слово 'Представник'", () => {
    expect(prompt).toContain("РІВНО ОДНЕ СЛОВО \"Представник\"");
    expect(prompt).toContain('довіреність');
    expect(prompt).toContain('skipped');
  });
  it("Блок 1: 'Адвокат' і 'Захисник' помічені як САМОСТІЙНІ конкретні ролі (беруться)", () => {
    expect(prompt).toContain('"Адвокат" (самостійна роль');
    expect(prompt).toContain('"Захисник"');
    // Уточнення що це самостійні ролі
    expect(prompt).toContain('"Адвокат" і');
    expect(prompt).toContain('самостійні конкретні ролі');
  });
  it('Блок 1: подвійний фільтр (рік + роль) ПЕРЕД заходом у справу', () => {
    expect(prompt).toContain('ОБИДВА фільтри');
    expect(prompt).toContain('ПЕРШ НІЖ заходити');
  });

  // Блок 2 — Мапінг роль → primaryParty
  it('Блок 2: мапінг конкретних ролей → сторона (primaryParty)', () => {
    expect(prompt).toContain('"Представник позивача"');
    expect(prompt).toContain('позивач');
    expect(prompt).toContain('"Представник відповідача"');
    expect(prompt).toContain('відповідач');
    expect(prompt).toContain('"Захисник"');
    expect(prompt).toContain('обвинувачений');
  });
  it('Блок 2: формат "Прізвище І.П." і повна назва для юросіб', () => {
    expect(prompt).toContain('"Прізвище І.П."');
    expect(prompt).toContain('ТОВ/ПП/ФОП/АТ');
  });

  // Блок 3 — Кримінальні з кількома обвинуваченими
  it('Блок 3: кримінальні з кількома обвинуваченими → warning, primaryParty=case_no, не вгадувати', () => {
    expect(prompt).toContain('КІЛЬКА обвинувачених');
    expect(prompt).toContain('НЕ вгадуй');
    expect(prompt).toContain('primaryParty залиш = case_no');
    expect(prompt).toContain('warnings');
    expect(prompt).toContain('Уточніть кого захищає');
  });

  // Блок 4 — Економія кроків
  it('Блок 4: extract text як ПЕРШИЙ вибір, screenshot тільки коли треба', () => {
    expect(prompt).toContain('Extract page text');
    expect(prompt).toContain('ПЕРШИЙ вибір');
    expect(prompt).toContain('Take screenshot');
  });
  it('Блок 4: пріоритет точність > економія (явно прописано)', () => {
    expect(prompt).toContain('точність > економія');
    expect(prompt).toContain('НЕ скоротити');
  });
  it("Блок 4: 'Інформація про справу' відкривати ОДИН раз", () => {
    expect(prompt).toContain('"Інформація про справу" ОДИН раз');
  });

  // Блок 5 — Checkpoint
  it('Блок 5: проміжний JSON КОЖНІ 5 справ + фінальний JSON в кінці', () => {
    expect(prompt).toContain('КОЖНИХ 5 ОБРОБЛЕНИХ СПРАВ');
    expect(prompt).toContain('[ПРОМІЖНИЙ РЕЗУЛЬТАТ');
    expect(prompt).toContain('[ФІНАЛЬНИЙ РЕЗУЛЬТАТ]');
  });
  it('Блок 5: проміжний/фінальний — повний envelope (не дельта); дедуплікація через ecitsCaseId', () => {
    expect(prompt).toContain('не дельта');
    expect(prompt).toContain('Дедуплікація в Legal BMS через');
    expect(prompt).toContain('ecitsCaseId');
  });

  // Загальна структура — порядок блоків (стиль роботи ВИЩЕ за крокові інструкції)
  it('структура: блок СТИЛЬ РОБОТИ розташований ПЕРЕД ФІЛЬТРАЦІЄЮ', () => {
    const styleIdx = prompt.indexOf('СТИЛЬ РОБОТИ');
    const filterIdx = prompt.indexOf('ФІЛЬТРАЦІЯ СПРАВ');
    expect(styleIdx).toBeGreaterThan(-1);
    expect(filterIdx).toBeGreaterThan(-1);
    expect(styleIdx).toBeLessThan(filterIdx);
  });
  it('структура: ФІЛЬТРАЦІЯ ПЕРЕД КРОК 3 (витягуванням полів справи)', () => {
    const filterIdx = prompt.indexOf('ФІЛЬТРАЦІЯ СПРАВ');
    const step3Idx = prompt.indexOf('КРОК 3 — Витягни поля');
    expect(filterIdx).toBeLessThan(step3Idx);
  });

  // Безпека збережена
  it('safety block ВСЕ ЩЕ присутній (TASK 0.4.1 не видаляє жорсткі обмеження)', () => {
    expect(prompt).toContain('КАТЕГОРИЧНО НЕ НАТИСКАЙ');
    expect(prompt).toContain('КАТЕГОРИЧНО НЕ РОБИ');
  });
});
