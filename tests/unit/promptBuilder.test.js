// promptBuilder.test.js — TASK 0.4 + TASK 0.4.1 (фільтр ролей, primaryParty,
// кримінальні з кількома обвинуваченими, економія кроків, checkpoint)
// + TASK 0.4.2 (точка рішення адвоката: збір питань, текстовий список,
// обробка відповіді "обох", нагадування у ПОЧИНАЙ)
// + TASK 0.4.3 (фільтр активних справ: рік 26 → завжди, рік 25 → лише з
// засіданнями 2026; швидкий вихід у skipped без витягування реквізитів)
// + TASK 0.4.4 (зовнішня пам'ять: журнал кожні 5 справ у чат + фіналізація
// з журналу замість стиснутої пам'яті; null замість вигадки)

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

  // Блок 5 — Checkpoint (TASK 0.4.4 перетворив [ПРОМІЖНИЙ РЕЗУЛЬТАТ] на
  // [ЖУРНАЛ — справи N..N+4], але зобов'язання "кожні 5 справ" збережено)
  it('Блок 5: журнал КОЖНІ 5 справ + фінальний JSON в кінці', () => {
    expect(prompt).toContain('КОЖНИХ 5 справ');
    expect(prompt).toContain('[ЖУРНАЛ — справи N..N+4]');
    expect(prompt).toContain('[ФІНАЛЬНИЙ РЕЗУЛЬТАТ]');
  });
  it('Блок 5: журнал зберігається дослівно (TASK 0.4.4 — зовнішня пам\'ять у чаті)', () => {
    // TASK 0.4.4 переформулював: замість «не дельта / дедуплікація через
    // ecitsCaseId» тепер — журнал як надійне сховище, бо повідомлення в
    // чаті не стискаються compacting'ом
    expect(prompt).toContain('compacting НЕ СТИСКАЄ');
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
  it('структура: ФІЛЬТРАЦІЯ ПЕРЕД КРОК 3 (перевірка активності + поля справи)', () => {
    const filterIdx = prompt.indexOf('ФІЛЬТРАЦІЯ СПРАВ');
    // TASK 0.4.3 — КРОК 3 перейменовано: "Перевір активність і витягни поля"
    const step3Idx = prompt.indexOf('КРОК 3 — Перевір активність');
    expect(filterIdx).toBeGreaterThan(-1);
    expect(step3Idx).toBeGreaterThan(-1);
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

  it('структура: ТОЧКА РІШЕННЯ розташована ПІСЛЯ ЗОВНІШНЬОЇ ПАМ\'ЯТІ і ПЕРЕД СТРУКТУРА ENVELOPE', () => {
    // TASK 0.4.4 — блок ПРОМІЖНІ РЕЗУЛЬТАТИ перейменовано на ЗОВНІШНЯ ПАМ'ЯТЬ
    const memoryIdx = prompt.indexOf("ЗОВНІШНЯ ПАМ'ЯТЬ");
    const decisionIdx = prompt.indexOf('ТОЧКА РІШЕННЯ АДВОКАТА');
    const envelopeIdx = prompt.indexOf('СТРУКТУРА ENVELOPE');
    expect(memoryIdx).toBeGreaterThan(-1);
    expect(decisionIdx).toBeGreaterThan(-1);
    expect(envelopeIdx).toBeGreaterThan(-1);
    expect(memoryIdx).toBeLessThan(decisionIdx);
    expect(decisionIdx).toBeLessThan(envelopeIdx);
  });

  it('решта структури з 0.4.1 збережена (фільтр ролей, checkpoint, безпека)', () => {
    expect(prompt).toContain("РІВНО ОДНЕ СЛОВО \"Представник\"");
    // TASK 0.4.4 переформулював checkpoint, але зобов'язання "кожні 5" збережено
    expect(prompt).toContain('КОЖНИХ 5 справ');
    expect(prompt).toContain('КАТЕГОРИЧНО НЕ НАТИСКАЙ');
    expect(prompt).toContain('"Адвокат" і');
  });

  it('сигнатура buildEcitsImportPrompt не змінилась (override targetHearingYear досі працює)', () => {
    const p = buildEcitsImportPrompt({ targetHearingYear: 2027 });
    expect(p).toContain('2027');
    expect(p).toContain('ТОЧКА РІШЕННЯ АДВОКАТА');
  });
});

// ── TASK 0.4.3 — фільтр активних справ ─────────────────────────────────────
describe('promptBuilder.buildEcitsImportPrompt — TASK 0.4.3 (фільтр активних справ)', () => {
  const prompt = buildEcitsImportPrompt();

  it('видалено рядок "включи навіть без засідань" (першопричина переповнення)', () => {
    expect(prompt).not.toContain('все одно включи її');
    expect(prompt).not.toContain('з порожнім масивом hearings');
  });

  it('КРОК 3 починається зі швидкої перевірки активності', () => {
    expect(prompt).toContain('КРОК 3 — Перевір активність');
    expect(prompt).toContain('ПЕРШИМ ділом — швидка перевірка активності');
    expect(prompt).toContain('Не витрачай кроки на повні реквізити доки не переконався');
  });

  it('логіка: рік 26 → беремо ЗАВЖДИ (свіжа справа)', () => {
    expect(prompt).toContain('ЯКЩО рік справи = 26');
    expect(prompt).toContain('Справа СВІЖА → беремо ЗАВЖДИ');
  });

  it('логіка: рік 25 → беремо ТІЛЬКИ якщо є засідання 2026', () => {
    expect(prompt).toContain('ЯКЩО рік справи = 25');
    expect(prompt).toContain('Є ХОЧА Б ОДНЕ засідання');
    expect(prompt).toContain('будь-яка інстанція');
  });

  it('швидкий вихід у skipped для неактивних 25 (БЕЗ витягування реквізитів)', () => {
    expect(prompt).toContain('НЕМАЄ жодного засідання');
    expect(prompt).toContain('справа 2025 без засідань 2026 — неактивна');
    expect(prompt).toContain('РЕКВІЗИТИ НЕ ВИТЯГУЙ');
  });

  it('пріоритет "Внесення дат слухання" перед повістками збережено', () => {
    expect(prompt).toContain('"Внесення дат слухання"');
    expect(prompt).toContain('структурована дата');
  });

  it('явно вказує що інстанція/провадження не має значення для активності', () => {
    expect(prompt).toContain('Інстанція не має значення');
  });

  it('КРОК 4 — тільки для АКТИВНИХ справ (порожній hearings допустимий для 26 року)', () => {
    expect(prompt).toContain('тільки для АКТИВНИХ справ');
    expect(prompt).toContain('Для свіжої справи 26 року hearings може бути порожнім');
  });

  it('структура envelope: пояснено куди йдуть неактивні справи', () => {
    expect(prompt).toContain('У cases[] потрапляють ТІЛЬКИ активні справи');
    expect(prompt).toContain('у skipped[]');
  });

  it('решта 0.4.1/0.4.2 збережена (фільтр ролей, checkpoint, точка рішення, безпека)', () => {
    expect(prompt).toContain("РІВНО ОДНЕ СЛОВО \"Представник\"");
    // TASK 0.4.4 переформулював checkpoint у журнал, зобов'язання "кожні 5" лишилось
    expect(prompt).toContain('КОЖНИХ 5 справ');
    expect(prompt).toContain('ТОЧКА РІШЕННЯ АДВОКАТА');
    expect(prompt).toContain('КАТЕГОРИЧНО НЕ НАТИСКАЙ');
  });

  it('сигнатура buildEcitsImportPrompt не змінилась; targetHearingYear override прокидається у reason', () => {
    const p = buildEcitsImportPrompt({ targetHearingYear: 2027 });
    expect(p).toContain('справа 2025 без засідань 2027 — неактивна');
    expect(p).toContain('Перевір активність');
  });

  it('структура: КРОК 3 (активність + поля) ПЕРЕД КРОК 4 (засідання)', () => {
    const step3Idx = prompt.indexOf('КРОК 3 — Перевір активність');
    const step4Idx = prompt.indexOf('КРОК 4 — Збери засідання');
    expect(step3Idx).toBeGreaterThan(-1);
    expect(step4Idx).toBeGreaterThan(-1);
    expect(step3Idx).toBeLessThan(step4Idx);
  });
});

// ── TASK 0.4.4 — зовнішня пам'ять і фіналізація з журналу ─────────────────
describe('promptBuilder.buildEcitsImportPrompt — TASK 0.4.4 (зовнішня пам\'ять)', () => {
  const prompt = buildEcitsImportPrompt();

  it("містить окремий блок ЗОВНІШНЯ ПАМ'ЯТЬ (замінив ПРОМІЖНІ РЕЗУЛЬТАТИ)", () => {
    expect(prompt).toContain("ЗОВНІШНЯ ПАМ'ЯТЬ");
    expect(prompt).toContain("ОБОВ'ЯЗКОВІ ПРОМІЖНІ ЗАПИСИ ЖУРНАЛУ");
    // Старий заголовок не повинен лишитись
    expect(prompt).not.toContain('ПРОМІЖНІ РЕЗУЛЬТАТИ (страховка від ліміту)');
    expect(prompt).not.toContain('[ПРОМІЖНИЙ РЕЗУЛЬТАТ —');
  });

  it("пояснює механіку: compacting стискає робочу пам'ять, але не повідомлення у чаті", () => {
    expect(prompt).toContain('compacting');
    expect(prompt).toContain('compacting НЕ СТИСКАЄ');
  });

  it("жорстке зобов'язання журналу: 'НЕ продовжуй обхід доки не виписав'", () => {
    expect(prompt).toContain("НЕ продовжуй обхід наступних справ доки");
    expect(prompt).toContain("ЦЕ НЕ МОЖНА ПРОПУСКАТИ");
    expect(prompt).toContain("обов'язкове, не опція");
  });

  it("мітка журналу [ЖУРНАЛ — справи N..N+4] (не плутати з фінальним)", () => {
    expect(prompt).toContain('[ЖУРНАЛ — справи N..N+4]');
    expect(prompt).toContain('[ФІНАЛЬНИЙ РЕЗУЛЬТАТ]');
    // Старі мітки прибрано
    expect(prompt).not.toContain('[ПРОМІЖНИЙ РЕЗУЛЬТАТ —');
  });

  it("інструкція дослівно: 'імена і час точно як у кабінеті'", () => {
    expect(prompt).toContain('ДОСЛІВНО');
    // Текст промпту може мати перенесення рядка між "точно" і "як у кабінеті" —
    // нормалізуємо пробіли перед збігом
    const normalized = prompt.replace(/\s+/g, ' ');
    expect(normalized).toContain('точно як у кабінеті');
  });

  it("обробка хвоста: випиши журнал навіть якщо лишилось < 5 справ", () => {
    expect(prompt).toContain('менше 5 в кінці');
    expect(prompt).toContain('за ті що');
  });

  it("містить окремий блок ФІНАЛІЗАЦІЯ — ЗБИРАЙ З ЖУРНАЛУ, НЕ З ПАМ'ЯТІ", () => {
    expect(prompt).toContain("ФІНАЛІЗАЦІЯ — ЗБИРАЙ З ЖУРНАЛУ, НЕ З ПАМ'ЯТІ");
  });

  it("фіналізація: процедура збору з журнальних повідомлень", () => {
    expect(prompt).toContain('ПЕРЕЧИТАЙ свої попередні повідомлення');
    expect(prompt).toContain('[ЖУРНАЛ — справи N..N+4]');
    expect(prompt).toContain('копіюй кожне поле');
    expect(prompt).toContain('буква в букву');
  });

  it("при розбіжності — 'вір ЖУРНАЛУ' (він точніший за пам'ять)", () => {
    expect(prompt).toContain('вір ЖУРНАЛУ');
    expect(prompt).toContain('точніший за пам\'ять');
  });

  it("заборона вигадувати: null замість вигадки якщо немає в журналі", () => {
    expect(prompt).toContain('НЕ вигадуй');
    expect(prompt).toContain('Краще null ніж вигадка');
  });

  it("блок ПОЧИНАЙ нагадує про журнал як джерело правди", () => {
    const startIdx = prompt.lastIndexOf('ПОЧИНАЙ');
    expect(startIdx).toBeGreaterThan(-1);
    const tail = prompt.slice(startIdx);
    expect(tail).toContain("обов'язковий [ЖУРНАЛ]");
    expect(tail).toContain('З ЖУРНАЛУ');
    expect(tail).toContain("джерело правди");
    expect(tail).toContain('null');
  });

  it("структура: ЗОВНІШНЯ ПАМ'ЯТЬ перед ФІНАЛІЗАЦІЯ; ФІНАЛІЗАЦІЯ перед СТРУКТУРА ENVELOPE", () => {
    const memoryIdx = prompt.indexOf("ЗОВНІШНЯ ПАМ'ЯТЬ — ОБОВ'ЯЗКОВІ");
    const finalizeIdx = prompt.indexOf('ФІНАЛІЗАЦІЯ — ЗБИРАЙ З ЖУРНАЛУ');
    const envelopeIdx = prompt.indexOf('СТРУКТУРА ENVELOPE (формат повернення)');
    expect(memoryIdx).toBeGreaterThan(-1);
    expect(finalizeIdx).toBeGreaterThan(-1);
    expect(envelopeIdx).toBeGreaterThan(-1);
    expect(memoryIdx).toBeLessThan(finalizeIdx);
    expect(finalizeIdx).toBeLessThan(envelopeIdx);
  });

  it("ТОЧКА РІШЕННЯ і далі ФІНАЛІЗАЦІЯ — узгоджений потік 'питання → збір з журналу'", () => {
    const decisionIdx = prompt.indexOf('ТОЧКА РІШЕННЯ АДВОКАТА');
    const finalizeIdx = prompt.indexOf('ФІНАЛІЗАЦІЯ — ЗБИРАЙ З ЖУРНАЛУ');
    expect(decisionIdx).toBeGreaterThan(-1);
    expect(finalizeIdx).toBeGreaterThan(-1);
    expect(decisionIdx).toBeLessThan(finalizeIdx);
  });

  it("сигнатура buildEcitsImportPrompt не змінилась (override targetHearingYear досі прокидається)", () => {
    const p = buildEcitsImportPrompt({ targetHearingYear: 2027 });
    expect(p).toContain('2027');
    expect(p).toContain("ЗОВНІШНЯ ПАМ'ЯТЬ");
    expect(p).toContain('ФІНАЛІЗАЦІЯ — ЗБИРАЙ З ЖУРНАЛУ');
  });

  it("решта 0.4.1-0.4.3 збережена (фільтр ролей, активність, точка рішення, безпека)", () => {
    expect(prompt).toContain("РІВНО ОДНЕ СЛОВО \"Представник\"");
    expect(prompt).toContain('КРОК 3 — Перевір активність');
    expect(prompt).toContain('ТОЧКА РІШЕННЯ АДВОКАТА');
    expect(prompt).toContain('справа 2025 без засідань 2026 — неактивна');
    expect(prompt).toContain('КАТЕГОРИЧНО НЕ НАТИСКАЙ');
  });
});
