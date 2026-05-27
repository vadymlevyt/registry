// promptBuilder.test.js — TASK 0.4 + TASK 0.4.1 (фільтр ролей, primaryParty,
// кримінальні з кількома обвинуваченими, економія кроків, checkpoint)
// + TASK 0.4.2 (точка рішення адвоката: збір питань, текстовий список,
// обробка відповіді "обох", нагадування у ПОЧИНАЙ)

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
  // (TASK 0.4.2 — оновлено: тихий warning замінено на точку рішення)
  it('Блок 3: кримінальні з кількома обвинуваченими → точка рішення, primaryParty=case_no, не вгадувати, не зупиняти обхід', () => {
    expect(prompt).toContain('КІЛЬКА обвинувачених');
    expect(prompt).toContain('НЕ вгадуй');
    expect(prompt).toContain('primaryParty тимчасово = case_no');
    expect(prompt).toContain('ПОТРЕБУЄ РІШЕННЯ АДВОКАТА');
    expect(prompt).toContain('ТОЧКИ РІШЕННЯ');
    expect(prompt).toContain('НЕ зупиняй обхід');
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

// ── TASK 0.4.2 — точка рішення адвоката ───────────────────────────────────
describe('promptBuilder.buildEcitsImportPrompt — TASK 0.4.2 (точка рішення)', () => {
  const prompt = buildEcitsImportPrompt();

  it('містить окремий блок ТОЧКА РІШЕННЯ АДВОКАТА', () => {
    expect(prompt).toContain('ТОЧКА РІШЕННЯ АДВОКАТА');
    expect(prompt).toContain('перед фінальним JSON');
  });

  it('інструктує НЕ зупиняти обхід заради одного питання', () => {
    // Принцип: агент не перебиває роботу по кожній неоднозначності
    expect(prompt).toContain('НЕ зупиняй обхід');
    expect(prompt).toContain('НЕ перебивай обхід');
  });

  it('інструктує збирати всі питання в один список наприкінці', () => {
    expect(prompt).toContain('збираються в одну фінальну точку');
    expect(prompt).toContain('ОДНИМ блоком');
    expect(prompt).toContain('ЧЕКАЙ його відповідь');
  });

  it('містить шаблон питання з форматом відповіді', () => {
    expect(prompt).toContain('Перш ніж завершити — потрібні твої рішення');
    expect(prompt).toContain('Кого з них захищає Левицький');
    expect(prompt).toContain('Відповідай номером і вибором');
  });

  it('містить обробку відповіді "обох" — primaryParty = перший + notes', () => {
    expect(prompt).toContain('"обох"');
    expect(prompt).toContain('primaryParty = перший обвинувачений');
    expect(prompt).toContain('Захист обох обвинувачених');
  });

  it('розрізняє два сценарії: НЕМАЄ питань → одразу фінальний; Є питання → спочатку список', () => {
    expect(prompt).toContain('ЯКЩО таких питань НЕМАЄ');
    expect(prompt).toContain('ЯКЩО питання Є');
    expect(prompt).toContain('НЕ видавай фінальний JSON одразу');
  });

  it('передбачає майбутні типи неоднозначностей (екстенсійний майбутньостійкий блок)', () => {
    expect(prompt).toContain('інші типи неоднозначностей');
  });

  it('блок ПОЧИНАЙ містить нагадування про точку рішення', () => {
    const startIdx = prompt.lastIndexOf('ПОЧИНАЙ');
    expect(startIdx).toBeGreaterThan(-1);
    const tail = prompt.slice(startIdx);
    expect(tail).toContain('кілька обвинувачених');
    expect(tail).toContain('не зупиняйся');
    expect(tail).toContain('ТОЧКА РІШЕННЯ');
  });

  it('структура: ТОЧКА РІШЕННЯ розташована ПІСЛЯ ПРОМІЖНІ РЕЗУЛЬТАТИ і ПЕРЕД СТРУКТУРА ENVELOPE', () => {
    const intermediateIdx = prompt.indexOf('ПРОМІЖНІ РЕЗУЛЬТАТИ');
    const decisionIdx = prompt.indexOf('ТОЧКА РІШЕННЯ АДВОКАТА');
    const envelopeIdx = prompt.indexOf('СТРУКТУРА ENVELOPE');
    expect(intermediateIdx).toBeGreaterThan(-1);
    expect(decisionIdx).toBeGreaterThan(-1);
    expect(envelopeIdx).toBeGreaterThan(-1);
    expect(intermediateIdx).toBeLessThan(decisionIdx);
    expect(decisionIdx).toBeLessThan(envelopeIdx);
  });

  it('решта структури з 0.4.1 збережена (фільтр ролей, checkpoint, безпека)', () => {
    expect(prompt).toContain("РІВНО ОДНЕ СЛОВО \"Представник\"");
    expect(prompt).toContain('КОЖНИХ 5 ОБРОБЛЕНИХ СПРАВ');
    expect(prompt).toContain('КАТЕГОРИЧНО НЕ НАТИСКАЙ');
    expect(prompt).toContain('"Адвокат" і');
  });

  it('сигнатура buildEcitsImportPrompt не змінилась (override targetHearingYear досі працює)', () => {
    const p = buildEcitsImportPrompt({ targetHearingYear: 2027 });
    expect(p).toContain('2027');
    expect(p).toContain('ТОЧКА РІШЕННЯ АДВОКАТА');
  });
});
