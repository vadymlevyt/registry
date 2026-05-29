// ── IMAGE DOCUMENT GROUPER ───────────────────────────────────────────────────
// AI-агент межі ДОКУМЕНТІВ між фото у DP image-merge сценарії (TASK 1B
// image_merge_unify). Адвокат фотографує N сторінок = M документів (наприклад
// паспорт 4 фото + договір 5 фото + квитанція 1 фото = 10 фото / 3 документи);
// grouper пропонує які фото складають один документ.
//
// ── ОДНА ВІДПОВІДАЛЬНІСТЬ (правило #11) ─────────────────────────────────────
// imageDocumentGrouper — ТІЛЬКИ межі між документами. Окремий агент від:
//   • imageSortingAgent — сортує/дедупить В МЕЖАХ одного документа (інший
//     намір; не міксуємо «який документ» з «який порядок сторінок»).
//   • imageMergePanel — UI «1 батч = 1 документ» (з'явилась до 1B);
//     grouper викликається ТІЛЬКИ з DP image-merge, не з модалки.
// Розширення imageSortingAgent двома значеннями `order` (перелік) + `groups`
// (документи) було б анти-патерн з §«ОДНОЗНАЧНІСТЬ» — дві відповіді на один
// промпт. Тому окремий агент.
//
// ── МОДЕЛЬ — Haiku ───────────────────────────────────────────────────────────
// Структурна задача (pattern matching: реквізити, теми, нумерація), без
// глибокого reasoning. Haiku × ~1/3 ціни Sonnet, швидше. resolveModel
// ('imageDocumentGrouper') → SYSTEM_DEFAULTS Haiku.
//
// ── БІЛІНГ — ОБОВ'ЯЗКОВЕ ЛОГУВАННЯ (закриває C7) ────────────────────────────
// logAiUsageViaSink + activityTracker.report('agent_call', …) — паралельно,
// БЕЗ дублювання полів. Це закриває діру C7 для НОВОГО агента (грунт-таблиця:
// existing imageSortingAgent логується агреговано через convertImagesToPdf
// 'images_merged'; новий grouper отримує свою точку одразу — DEVELOPMENT_
// PHILOSOPHY §«ПРАВИЛО НАРОДЖЕННЯ МОДУЛЯ».
//
// ── JSON OUTPUT ─────────────────────────────────────────────────────────────
// RESPOND ONLY WITH JSON. Та ж стратегія що imageSortingAgent: SYSTEM_PROMPT
// явно вимагає чистий JSON; parseAgentResponse (depth-counter) ловить три
// варіанти (чистий / ``` ``` / inline). Fallback при невалідному JSON —
// один великий документ з усіма фото (адвокат сам поділить у редакторі).

import { resolveModel } from '../modelResolver.js';
import { logAiUsageViaSink } from '../aiUsageService.js';
import * as activityTracker from '../activityTracker.js';
import { MODULES, categoryForCase } from '../moduleNames.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const MAX_OUTPUT_TOKENS = 2500;
// Той самий ліміт що imageSortingAgent (Г4): grouper приймає той самий OCR
// текст, що sortImages — головою/хвостом — економимо токени і даємо моделі
// одне і те ж бачення сторінок (правило #11: один сенс на «що бачить агент»).
const MAX_OCR_TEXT_PER_IMAGE = 1500;
const HEAD_PORTION = 1000;
const TAIL_PORTION = 500;

const SYSTEM_PROMPT = `Ти агент межі ДОКУМЕНТІВ між фотографіями.

ЗАВДАННЯ:
Адвокат сфотографував матеріали і прислав N зображень. Це насправді M окремих документів (наприклад 10 фото = паспорт 4 стор + договір 5 стор + квитанція 1 стор). Твоя робота — визначити ЯКІ фото складають ОДИН документ.

ЩО ТИ НЕ РОБИШ:
- НЕ сортуєш сторінки всередині одного документа (це інший агент)
- НЕ виявляєш дублікати (це інший агент)
- НЕ редагуєш ipss фото
- ТІЛЬКИ межі між документами

СИГНАЛИ ДЛЯ МЕЖІ ДОКУМЕНТІВ:
- РІЗКА зміна тематики: позовна заява → паспорт → квитанція
- Зміна реквізитів: інший суд, інша справа, інші ПІБ сторін, інший номер
- Зміна типу документа: текстовий лист → таблиця → штрих-код
- Зміна шаблону колонтитулу
- Зміна шрифту/розмітки що вказує на інше джерело
- Різний рік дати, різна організація
- Логічна замкненість: документ закінчився підписом і резолюцією

СИГНАЛИ ЩО ФОТО — ПРОДОВЖЕННЯ ОДНОГО ДОКУМЕНТА:
- Однакові колонтитули "Справа № X" продовжуються
- Нумерація сторінок 1, 2, 3 послідовна
- Тематика тексту йде логічно
- Реквізити (суд, сторони, дата) повторюються
- Той самий формат і шаблон

ТИП ДОКУМЕНТА (для поля type у відповіді):
- pleading — позовна, апеляційна, касаційна, заперечення
- motion — клопотання, заява
- court_act — рішення, ухвала, постанова, лист суду
- evidence — доказ (договір третьої сторони, акт, фото, скрін)
- contract — договір, угода
- correspondence — лист, відповідь з установи
- identification — паспорт, посвідчення, документ що посвідчує особу
- other — все що не вписалось

ШАБЛОН НАЗВИ ДОКУМЕНТА:
- Коротка функціональна (3-7 слів)
- Тип + про що коротко
- НЕ дублюй контекст справи
- НЕ додавай рік, суд, ПІБ (це й так знає адвокат)

ПРАВИЛЬНІ ПРИКЛАДИ:
- "Паспорт громадянина"
- "Договір купівлі-продажу"
- "Квитанція про сплату судового збору"
- "Ухвала про відкриття провадження"

ФОРМАТ ВІДПОВІДІ:
RESPOND ONLY WITH VALID JSON, NO PROSE, NO MARKDOWN, NO EXPLANATIONS.

JSON SCHEMA:
{
  "groups": [
    {
      "pages": [<image_index>, <image_index>, ...],
      "type": "<pleading|motion|court_act|evidence|contract|correspondence|identification|other>",
      "suggestedName": "<коротка назва>"
    }
  ]
}

ПРАВИЛА:
- Кожен image_index з вхідного набору МУСИТЬ зʼявитись у groups РІВНО ОДИН раз
- pages у групі — original indices (0-based) у тому порядку, що ти вважаєш правильним для документа
- groups має бути ≥1 (мінімум — один документ з усіх фото)
- Якщо не впевнений — ОДИН документ з усіх фото краще ніж розрив посеред документа (адвокат розділить вручну у редакторі)`;

/**
 * Truncate OCR text — той самий метод що imageSortingAgent (правило #11:
 * один сенс «що бачить агент про сторінку»).
 */
function truncateOcrText(text, maxLen = MAX_OCR_TEXT_PER_IMAGE) {
  if (typeof text !== 'string') return '';
  if (text.length <= maxLen) return text;
  const head = text.slice(0, HEAD_PORTION);
  const tail = text.slice(text.length - TAIL_PORTION);
  return `${head}\n[...skipped ${text.length - HEAD_PORTION - TAIL_PORTION} chars...]\n${tail}`;
}

function buildUserMessage(items) {
  const lines = [];
  lines.push(`Кількість фотографій: ${items.length}`);
  lines.push('');
  lines.push('ФОТОГРАФІЇ:');

  for (const it of items) {
    lines.push('---');
    lines.push(`index: ${it.index}`);
    if (it.name) lines.push(`name: ${it.name}`);
    if (it.mime) lines.push(`mime: ${it.mime}`);
    const truncText = truncateOcrText(it.ocrText || '');
    if (truncText) {
      lines.push(`ocr_text:\n${truncText}`);
    } else {
      lines.push('ocr_text: (порожній)');
    }
  }
  return lines.join('\n');
}

/**
 * Парсимо JSON з відповіді LLM. Підтримує: чистий JSON, ``` ``` блок,
 * інлайн {...}. Той самий depth-counter як CLAUDE.md §«ACTION_JSON парсинг».
 */
export function parseAgentResponse(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) return null;

  try { return JSON.parse(rawText.trim()); } catch { /* fallthrough */ }

  const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* fallthrough */ }
  }

  const start = rawText.indexOf('{');
  if (start >= 0) {
    let depth = 0;
    for (let i = start; i < rawText.length; i++) {
      if (rawText[i] === '{') depth++;
      else if (rawText[i] === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(rawText.slice(start, i + 1)); } catch { return null; }
        }
      }
    }
  }
  return null;
}

const KNOWN_TYPES = new Set([
  'pleading', 'motion', 'court_act', 'evidence', 'contract',
  'correspondence', 'identification', 'other',
]);

/**
 * Валідуємо groups. Кожен валідний індекс мусить зʼявитись рівно один раз.
 * Якщо AI пропустив індекс — додаємо у останню групу (краще документ з
 * зайвою сторінкою ніж тиха втрата).
 * Якщо AI повторив індекс — лишаємо перше входження.
 * Якщо груп нема — один документ з усіх індексів.
 */
function validateGroups(parsedGroups, allIndices) {
  const allSet = new Set(allIndices);
  const seen = new Set();
  const groups = [];

  if (Array.isArray(parsedGroups)) {
    for (const g of parsedGroups) {
      if (!g || typeof g !== 'object') continue;
      const pages = Array.isArray(g.pages) ? g.pages : [];
      const cleanPages = [];
      for (const v of pages) {
        if (!Number.isInteger(v)) continue;
        if (!allSet.has(v)) continue;
        if (seen.has(v)) continue;
        cleanPages.push(v);
        seen.add(v);
      }
      if (cleanPages.length === 0) continue;
      const type = KNOWN_TYPES.has(g.type) ? g.type : null;
      const suggestedName = typeof g.suggestedName === 'string' && g.suggestedName.trim()
        ? g.suggestedName.trim()
        : '';
      groups.push({ pages: cleanPages, type, suggestedName });
    }
  }

  // Пропущені AI індекси — у останню групу (або у нову якщо груп ще нема).
  const missing = allIndices.filter((i) => !seen.has(i));
  if (missing.length > 0) {
    if (groups.length === 0) {
      groups.push({ pages: [...missing], type: null, suggestedName: '' });
    } else {
      groups[groups.length - 1].pages.push(...missing);
    }
  }

  return groups;
}

/**
 * Виклик Anthropic API. Окрема функція для DI у тестах (mock global.fetch).
 */
async function callAnthropic({ apiKey, model, systemPrompt, userMessage, maxTokens }) {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return await res.json();
}

/**
 * Public API. Групує items у документи через Haiku.
 *
 * @param {Array<{index, name?, mime?, ocrText?}>} items — розпізнані фото.
 *        Якщо items.length < 2 — fallback (агент не викликається).
 * @param {object} options
 * @param {string} [options.apiKey]
 * @param {Function} [options.callApi] — DI для тестів.
 * @param {string|null} [options.caseId]
 * @param {Function} [options.aiUsageSink] — sink для logAiUsageViaSink.
 * @returns {Promise<{groups: Array<{pages, type, suggestedName}>, model, usage, fallback?, fallbackReason?}>}
 */
export async function groupImagesIntoDocuments(items, options = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('groupImagesIntoDocuments: items має бути непорожнім масивом');
  }

  const allIndices = items.map((it, i) => (Number.isInteger(it?.index) ? it.index : i));

  // Degenerate case: 1 фото = 1 документ (AI не потрібен).
  if (items.length === 1) {
    return {
      groups: [{ pages: [allIndices[0]], type: null, suggestedName: '' }],
      model: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      skipped: true,
    };
  }

  const { apiKey, callApi, caseId = null, aiUsageSink } = options;
  if (!apiKey && !callApi) {
    throw new Error('groupImagesIntoDocuments: apiKey required (або callApi для тестів)');
  }

  const model = options.model || resolveModel('imageDocumentGrouper');
  const userMessage = buildUserMessage(items);

  const apiFn = callApi || callAnthropic;
  let apiResp;
  let callError = null;
  try {
    apiResp = await apiFn({
      apiKey,
      model,
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      maxTokens: MAX_OUTPUT_TOKENS,
    });
  } catch (e) {
    callError = e;
  }

  // ── Білінг (закриває C7) — паралельно через паралельні структури:
  // ai_usage[] (оператор SaaS, токени) і time_entries[] (адвокат, час). НЕ
  // дублювати поля між ними. Усе в try/catch — не валить роботу адвоката.
  try {
    if (apiResp?.usage) {
      logAiUsageViaSink({
        agentType: 'image_document_grouper',
        model,
        inputTokens: apiResp.usage.input_tokens,
        outputTokens: apiResp.usage.output_tokens,
        context: {
          caseId,
          module: MODULES.DOCUMENT_PROCESSOR,
          operation: 'image_document_grouping',
        },
      }, aiUsageSink);
    }
    activityTracker.report('agent_call', {
      caseId,
      module: MODULES.DOCUMENT_PROCESSOR,
      category: categoryForCase(caseId),
      metadata: {
        agentType: 'image_document_grouper',
        operation: 'image_document_grouping',
      },
    });
  } catch (e) {
    console.warn('[imageDocumentGrouper] billing log failed (non-fatal):', e?.message);
  }

  if (callError) {
    // AI fail → fallback: один документ з усіх фото. Адвокат поділить у
    // редакторі вручну. Краще ніж блокувати DP UI.
    console.warn('[imageDocumentGrouper] AI call failed:', callError?.message);
    return {
      groups: [{ pages: [...allIndices], type: null, suggestedName: '' }],
      model,
      usage: { inputTokens: 0, outputTokens: 0 },
      fallback: true,
      fallbackReason: `ai_call_failed: ${callError?.message || callError}`,
    };
  }

  const rawText = apiResp?.content?.[0]?.text || apiResp?.text || '';
  const parsed = parseAgentResponse(rawText);

  const inputTokens = apiResp?.usage?.input_tokens ?? 0;
  const outputTokens = apiResp?.usage?.output_tokens ?? 0;

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.groups)) {
    return {
      groups: [{ pages: [...allIndices], type: null, suggestedName: '' }],
      model,
      usage: { inputTokens, outputTokens },
      fallback: true,
      fallbackReason: 'agent_invalid_json',
    };
  }

  const groups = validateGroups(parsed.groups, allIndices);

  return {
    groups,
    model,
    usage: { inputTokens, outputTokens },
  };
}

// Експорт для тестів
export const __test__ = {
  SYSTEM_PROMPT,
  MAX_OUTPUT_TOKENS,
  MAX_OCR_TEXT_PER_IMAGE,
  truncateOcrText,
  buildUserMessage,
  validateGroups,
  KNOWN_TYPES,
};
