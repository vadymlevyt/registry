// ── ECITS PROMPT BUILDER ─────────────────────────────────────────────────────
// Будує промпт для Claude for Chrome що адвокат копіює і вставляє в sidebar
// браузера. Promпт інструктує: зайди в кабінет ЄСІТС, відфільтруй активні
// справи (за роком у case_no), збери засідання 2026 року, поверни JSON
// envelope у чат.
//
// Один сенс (правило #11): "інструкція агенту що збирати і у якій формі
// повернути". НЕ безпекові обмеження (це safety.js, вшивається сюди як
// блок), НЕ обробка результату (це scenarioProcessor.js).
//
// Фільтр справ — за роком у case_no (НЕ за статусом справи в кабінеті,
// бо ЄСІТС-кабінет показує справи з 2014 року включно і немає простого
// способу відрізнити "активна" vs "архівна" через UI). Адвокат веде ЛИШЕ
// справи 25-26 років — це достатня евристика для MVP. Майбутнє: явні
// фільтри в UI кабінета або власне розширення з доступом до status field.
//
// Логіка дедуплікації засідань (одна дата = одне засідання, навіть якщо
// прийшло кілька повісток) — пояснена прикладом у промпті. Claude for
// Chrome виконує дедуплікацію сам у списку повісток одної справи.

import { buildSafetyBlock } from './safety.js';

/**
 * Constants для тестів і документації.
 */
export const SCENARIO_ID = 'ecits_import_cases_and_hearings';
export const SCENARIO_VERSION = 1;
export const ENVELOPE_VERSION = 1;

/**
 * Парсить рік з case_no формату NNN/NNNNN/NN[-X].
 * Цифри після ДРУГОГО слешу = рік.
 *
 * @param {string} caseNo
 * @returns {number|null} 0-99, або null якщо не вдалось розпарсити
 */
export function extractYearFromCaseNo(caseNo) {
  if (typeof caseNo !== 'string') return null;
  const parts = caseNo.split('/');
  if (parts.length < 3) return null;
  // Третій сегмент: 'NN' або 'NN-X' (літера після дефіса = тип проваження)
  const yearSegment = parts[2].split('-')[0].trim();
  if (!/^\d{1,2}$/.test(yearSegment)) return null;
  return parseInt(yearSegment, 10);
}

/**
 * Чи беремо справу за роком у case_no. MVP: тільки 25 і 26 (активні роки
 * адвокатської практики). Зростатиме з часом (додавати 27, 28 …).
 *
 * @param {string} caseNo
 * @returns {boolean}
 */
export function isAcceptedCaseYear(caseNo) {
  const year = extractYearFromCaseNo(caseNo);
  return year === 25 || year === 26;
}

/**
 * Будує промпт для Claude for Chrome.
 *
 * @param {object} [options]
 * @param {number} [options.targetHearingYear=2026]  рік засідань що збираємо
 * @param {number[]} [options.acceptedCaseYears=[25,26]]  які роки case_no приймаємо
 * @returns {string}
 */
export function buildEcitsImportPrompt(options = {}) {
  const targetHearingYear = options.targetHearingYear || 2026;
  const acceptedCaseYears = options.acceptedCaseYears || [25, 26];
  const yearsList = acceptedCaseYears.map((y) => String(y)).join(' або ');

  const safetyBlock = buildSafetyBlock();

  return `# Сценарій: Імпорт справ і засідань з кабінету ЄСІТС

Ти — асистент адвоката Левицького Вадима. Зараз ти бачиш кабінет ЄСІТС
(cabinet.court.gov.ua). Твоя задача — пройти по справах, зібрати інформацію
і повернути JSON у визначеному форматі.

## КРОК 1 — Знайди список справ

Перейди в розділ "Мої справи" або еквівалентний (де список усіх справ).

## КРОК 2 — Відфільтруй активні справи за РОКОМ у номері справи

Номер справи має формат \`NNN/NNNNN/NN-X\` (наприклад \`450/2275/25\`).
Цифри ПІСЛЯ ДРУГОГО СЛЕШУ = РІК справи.

ПРИКЛАДИ:
- 450/2275/25     → рік 25 → беремо
- 359/12899/25    → рік 25 → беремо
- 367/4744/26     → рік 26 → беремо
- 761/15469/20-ц  → рік 20 → ПРОПУСКАЄМО
- 570/3101/24     → рік 24 → ПРОПУСКАЄМО

Беремо ТІЛЬКИ справи де рік ${yearsList}. Решту пропусти.

## КРОК 3 — Для кожної прийнятої справи витягни поля

Зайди у справу. Витягни:

- \`ecitsCaseId\` — 32-символьний hex з URL виду \`/cases/case=<hex>\`
- \`case_no\` — повний номер справи з заголовка
- \`court\` — повна назва суду
- \`category\` — за літерою після слешу в case_no або за типом провадження:
  - "ц" → "civil"
  - "к" → "criminal"
  - "а" → "administrative"
  - "г" або "м" → "civil"
  - якщо літери немає — спробуй визначити з типу провадження
- \`advocateRole\` — роль Левицького Вадима у справі:
  - "plaintiff_rep" (представник позивача)
  - "defendant_rep" (представник відповідача)
  - "third_party_rep" (представник третьої особи)
  - "defender" (захисник у кримінальній)
- \`primaryParty\` — основна сторона за роллю адвоката, формат "Прізвище І.П."
  (для юридичних осіб — повна назва без скорочення)
- \`primaryPartyFullName\` — повне ім'я тієї ж сторони (для довідки)
- \`cabinetUrl\` — пряме посилання на справу в кабінеті

## КРОК 4 — Збери засідання ${targetHearingYear} року

Зайди в хронологію документів справи (документи від суду). Йди ВПЕРЕД у часі.

Для КОЖНОГО документа про засідання (повістка, ухвала про виклик, внесення
дат слухання):
1. Витягни дату, час, зал, провадження
2. Перевір ЧИ ВЖЕ Є ця дата у твоєму списку для цієї справи
3. Якщо нова — додай
4. Якщо вже є — ПРОПУСТИ (дублікат повістки, не нове засідання)

ПРИКЛАД дедуплікації:
- Документ #1: повістка на 1 квітня → додай
- Документ #2: повістка на 1 квітня → ПРОПУСТИ (вже є)
- Документ #3: повістка на 7 квітня → додай
- Документ #4: повістка на 7 квітня → ПРОПУСТИ (вже є)

Беремо ТІЛЬКИ засідання ${targetHearingYear} року — минулі і майбутні в межах
року. Засідання інших років (минулих або наступних) — пропусти.

Для кожного засідання витягни:
- \`date\`         — ISO дата "${targetHearingYear}-MM-DD"
- \`time\`         — "HH:MM"
- \`court\`        — повна назва суду
- \`hearingRoom\`  — номер залу
- \`proceedingNumber\` — номер провадження (наприклад "6-392/26")
- \`cabinetUrl\`   — посилання на повістку
- \`noticeType\`   — тип документа звідки витягли (наприклад
                    "Судова повістка про виклик в суд")

## КРОК 5 — Поверни JSON envelope

Поверни ОДНИМ JSON-об'єктом такої форми (без додаткового тексту, тільки JSON,
загорни у код-блок \`\`\`json):

\`\`\`json
{
  "envelopeVersion": ${ENVELOPE_VERSION},
  "scenarioId": "${SCENARIO_ID}",
  "scenarioVersion": ${SCENARIO_VERSION},
  "producedAt": "<ISO datetime зараз>",
  "producedBy": {
    "provider": "claude_for_chrome",
    "providerVersion": "<яка модель ти>"
  },
  "data": {
    "ecitsAdvocate": {
      "fullName": "Левицький Вадим Андрійович",
      "cabinetIdentifier": "<РНОКПП адвоката якщо видно в кабінеті, інакше null>"
    },
    "stats": {
      "totalCasesInCabinet": <скільки взагалі в кабінеті>,
      "filtered": <скільки відфільтровано за роком>,
      "withHearings2026": <скільки мають засідання ${targetHearingYear}>
    },
    "cases": [
      {
        "ecitsCaseId": "<32-hex>",
        "case_no": "<NNN/NNNNN/NN>",
        "court": "...",
        "category": "civil|criminal|administrative",
        "advocateRole": "plaintiff_rep|defendant_rep|third_party_rep|defender",
        "primaryParty": "Прізвище І.П.",
        "primaryPartyFullName": "Прізвище Імʼя По-батькові",
        "cabinetUrl": "https://cabinet.court.gov.ua/...",
        "hearings": [
          {
            "date": "${targetHearingYear}-05-25",
            "time": "08:50",
            "court": "...",
            "hearingRoom": "336",
            "proceedingNumber": "6-392/26",
            "cabinetUrl": "https://cabinet.court.gov.ua/...",
            "noticeType": "Судова повістка про виклик в суд"
          }
        ]
      }
    ],
    "warnings": ["<рядок попередження якщо щось дивне>"],
    "skipped": [{ "case_no": "...", "reason": "..." }]
  }
}
\`\`\`

Якщо справа без засідань ${targetHearingYear} року — все одно включи її (з
порожнім масивом hearings), нам корисно мати ecitsCaseId для дедуплікації
майбутніх синхронізацій.

## БЕЗПЕКА

${safetyBlock}

## ПОЧИНАЙ

Підтверди коротко що зрозумів задачу і починай. Прогрес коментуй стисло
(одна-дві фрази на справу). Фінальний JSON — у код-блоку.`;
}
