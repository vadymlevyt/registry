// ── IMAGE SORTING AGENT ──────────────────────────────────────────────────────
// Семантичний агент сортування сторінок одного документа сфотографованих/
// сканованих окремо. Працює через Anthropic API з простим JSON output
// (НЕ tool use — простіше парсити, прозоріше для адвоката).
//
// Контракт:
//   sortImages(items, options) → Promise<SortResult>
//
//   items: Array<{ index, name, mime, sizeBytes, ocrText, pageStructure?, orientation? }>
//     - index: оригінальний індекс зображення у списку (0-based)
//     - ocrText: повний текст витягнутий через ocrService.extractText (один раз)
//     - pageStructure?: метадані Document AI (опційно — для додаткового контексту)
//     - orientation?: 0/90/180/270 (вже визначене extractPageOrientation)
//
//   options:
//     - apiKey: ключ Anthropic API (з localStorage у production)
//     - caseContext?: { categoryHint?, existingDocumentNames?: string[] }
//         existingDocumentNames — для перевірки унікальності suggestedName.
//
//   SortResult:
//     {
//       order: [2, 0, 1, 3, 4],            // permutation original indices у фінальному порядку
//       warnings: [                         // підозрілі сторінки
//         { index: 4, reason: "Сторінка з іншого документа: інша тематика" }
//       ],
//       missing: string | null,             // "Можливо відсутня сторінка 3" або null
//       suggestedName: "Ухвала про відкриття провадження",  // уже унікалізована
//       model: "claude-sonnet-4-20250514",
//       usage: { inputTokens, outputTokens }
//     }
//
// ── ЧОМУ JSON OUTPUT, НЕ TOOL USE ───────────────────────────────────────────
// 1. Адвокат у TASK явно вимагає JSON. Простіше дебажити.
// 2. Sonnet 4.x з system prompt "RESPOND ONLY WITH JSON" дає ~99% надійність.
// 3. Tool use додає overhead і складність — для simple permutation не потрібно.
// 4. Fallback при невалідному JSON: повертаємо порядок вибору адвоката,
//    suggestedName="" (адвокат напише вручну).
//
// ── ШАБЛОН НАЗВИ ────────────────────────────────────────────────────────────
// Назва — коротка функціональна (3-7 слів), відповідає на питання
// «Що це за документ серед інших у цій справі?». Не повторюємо контекст
// справи (суд, сторони) — це й так відомо.
// Орієнтири у системному промпті: правильні приклади + неправильні
// (як кращий стандарт для майбутнього Document Processor v2).
//
// ── УНІКАЛЬНІСТЬ НАЗВИ В СПРАВІ ─────────────────────────────────────────────
// Якщо suggestedName уже існує у справі (case-insensitive, trim) — додаємо
// порядковий індекс у дужках: "X" → "X (2)" → "X (3)" і т.д.
// Та сама логіка застосовується якщо адвокат вручну написав уже існуюче імʼя
// (це робить caller через ensureUniqueName helper).

import { resolveModel } from '../modelResolver.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const MAX_OUTPUT_TOKENS = 1500;
const MAX_OCR_TEXT_PER_IMAGE = 1500; // chars (узгоджено: Г4=1500 замість 800)
const HEAD_PORTION = 1000;            // beginning preserved verbatim
const TAIL_PORTION = 500;             // ending preserved verbatim

const SYSTEM_PROMPT = `Ти агент сортування сторінок одного документа сфотографованих чи сканованих окремо.

ЗАВДАННЯ:
1. Визначити правильний порядок сторінок (як вони мали йти у вихідному документі).
2. Виявити підозрілі сторінки які НЕ належать до цього документа (інша тематика, інші реквізити, інший суд, інша справа).
3. Запропонувати коротку функціональну назву документа.
4. Зазначити пропущені сторінки якщо помітно (наприклад нумерація йде 1-2-4 — пропущено 3).

СИГНАЛИ ДЛЯ СОРТУВАННЯ:
- Колонтитули: "Справа № X" на сторінках одного документа
- Номери сторінок: "стор. 1", "стор. 2", "Page 1 of 5"
- Реквізити які повторюються (суд, сторони, дата)
- Тематика тексту (рішення про X → текст продовжує тему X)
- Імена сторін
- Резолютивна частина зазвичай у кінці
- Заголовок зазвичай на першій сторінці

ШАБЛОН НАЗВИ ДОКУМЕНТА (suggestedName):
- КОРОТКА (3-7 слів), функціональна
- Відповідає на питання "Що це за документ серед інших у цій справі?"
- НЕ повторюй контекст справи (суд, сторони, дата) — адвокат це й так знає
- Тип документа + про що коротко + інстанція тільки якщо релевантно

ПРАВИЛЬНІ ПРИКЛАДИ:
- "Ухвала про відкриття провадження"
- "Ухвала про відкриття апеляційного провадження"
- "Позовна заява про поділ майна"
- "Адвокатський запит" (або "Адвокатський запит до Держспоживслужби" тільки якщо у справі багато запитів)
- "Повістка про виклик у судове засідання"
- "Заперечення на позовну заяву"
- "Постанова касаційної інстанції"
- "Рішення суду першої інстанції"

НЕПРАВИЛЬНІ:
- ЗАДОВГІ: "Ухвала Львівського апеляційного суду про відкриття провадження від 10.03.2026"
- НЕЧІТКІ: "Документ суду", "Файл з ухвалою"
- ТЕХНІЧНІ: "Стор. 1 текст", "Документ від 10.03.2026"
- З ФОРМАТОМ: "Позовна заява.pdf"

ФОРМАТ ВІДПОВІДІ:
RESPOND ONLY WITH VALID JSON, NO PROSE, NO MARKDOWN, NO EXPLANATIONS.

JSON SCHEMA:
{
  "order": [<original_index_first>, <original_index_second>, ...],
  "warnings": [
    {"index": <original_index>, "reason": "коротке пояснення"}
  ],
  "missing": <string or null — наприклад "Можливо відсутня сторінка 3" або null>,
  "suggestedName": "<коротка назва документа>"
}

ПРАВИЛА для order:
- Усі надіслані індекси мають зʼявитись у order рівно по одному разі (permutation)
- Не додавай нові індекси, не дублюй наявні
- Якщо є підозрілі — все одно вклади у order (вирішить адвокат, чи видалити)

ПРАВИЛА для warnings:
- ТІЛЬКИ для дуже підозрілих сторінок (інший документ, інша справа, скріншот соцмережі тощо)
- НЕ попереджай про чисто формальні відмінності
- Якщо все нормально — пустий масив []`;

/**
 * Truncate OCR text to keep head + tail portions for the agent.
 * Saving колонтитули (top of page) і footers (bottom) — основні сигнали
 * сортування. Середина обрізається.
 */
function truncateOcrText(text, maxLen = MAX_OCR_TEXT_PER_IMAGE) {
  if (typeof text !== 'string') return '';
  if (text.length <= maxLen) return text;
  const head = text.slice(0, HEAD_PORTION);
  const tail = text.slice(text.length - TAIL_PORTION);
  return `${head}\n[...skipped ${text.length - HEAD_PORTION - TAIL_PORTION} chars...]\n${tail}`;
}

/**
 * Будує user message для агента: список зображень з усім контекстом.
 * НЕ передаємо base64 зображень — тільки text + metadata.
 */
function buildUserMessage(items, caseContext) {
  const lines = [];
  lines.push(`Кількість зображень: ${items.length}`);
  if (caseContext?.categoryHint) {
    lines.push(`Орієнтовний тип документа: ${caseContext.categoryHint}`);
  }
  if (caseContext?.existingDocumentNames && caseContext.existingDocumentNames.length > 0) {
    lines.push(
      `Існуючі назви документів у цій справі (не повторюй слово-в-слово): ${caseContext.existingDocumentNames.slice(0, 50).join(', ')}`
    );
  }
  lines.push('');
  lines.push('ЗОБРАЖЕННЯ:');

  for (const it of items) {
    lines.push(`---`);
    lines.push(`index: ${it.index}`);
    if (it.name) lines.push(`name: ${it.name}`);
    if (it.mime) lines.push(`mime: ${it.mime}`);
    if (Number.isFinite(it.sizeBytes)) lines.push(`size: ${it.sizeBytes} bytes`);
    if (Number.isFinite(it.orientation) && it.orientation !== 0) {
      lines.push(`orientation: ${it.orientation}°`);
    }
    const truncText = truncateOcrText(it.ocrText || '');
    if (truncText) {
      lines.push(`ocr_text:\n${truncText}`);
    } else {
      lines.push(`ocr_text: (порожній — фото без розпізнаного тексту)`);
    }
  }
  return lines.join('\n');
}

/**
 * Намагається витягнути JSON з відповіді LLM. Підтримує:
 *   - Чистий JSON (ідеальний випадок)
 *   - JSON у markdown code block ```json...```
 *   - JSON всередині prose ("Here is the result: { ... }")
 * Повертає parsed object або null.
 */
export function parseAgentResponse(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) return null;

  // 1. Чистий JSON
  try {
    return JSON.parse(rawText.trim());
  } catch {
    // fallthrough
  }

  // 2. Markdown code block ```json ... ``` або ``` ... ```
  const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // fallthrough
    }
  }

  // 3. Перший {...} блок у тексті
  const braceMatch = rawText.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch {
      // fallthrough
    }
  }

  return null;
}

/**
 * Валідація order — має бути permutation [0..N-1].
 * Повертає { valid, normalizedOrder, warnings[] }.
 * Якщо order містить duplicates або out-of-range — нормалізуємо до
 * identity [0..N-1] (без сортування).
 */
function validateOrder(order, n) {
  if (!Array.isArray(order)) {
    return { valid: false, normalizedOrder: identityRange(n), reason: 'order не масив' };
  }
  if (order.length !== n) {
    return { valid: false, normalizedOrder: identityRange(n), reason: `order length=${order.length}, очікувалось ${n}` };
  }
  const seen = new Set();
  for (const v of order) {
    if (!Number.isInteger(v) || v < 0 || v >= n) {
      return { valid: false, normalizedOrder: identityRange(n), reason: `невалідний index ${v}` };
    }
    if (seen.has(v)) {
      return { valid: false, normalizedOrder: identityRange(n), reason: `дубль index ${v}` };
    }
    seen.add(v);
  }
  return { valid: true, normalizedOrder: order };
}

function identityRange(n) {
  return Array.from({ length: n }, (_, i) => i);
}

/**
 * Перевірка унікальності назви у справі. Додає " (2)", " (3)", ...
 * якщо name (нормалізована lowercase+trim) уже існує у existingNames.
 *
 * Case-insensitive порівняння. Ігнорує trailing/leading whitespace.
 * Якщо name закінчується на " (N)" а base без суфіксу не унікальний —
 * шукаємо наступний вільний N.
 */
export function ensureUniqueName(name, existingNames) {
  if (!name || typeof name !== 'string') return name;
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  if (!Array.isArray(existingNames) || existingNames.length === 0) return trimmed;

  const normalize = (s) => s.trim().toLowerCase();
  const existingSet = new Set(existingNames.map((n) => normalize(n)));

  // Відокремлюємо base name від наявного " (N)" суфікса
  const suffixMatch = trimmed.match(/^(.*?)\s*\((\d+)\)\s*$/);
  const baseName = suffixMatch ? suffixMatch[1].trim() : trimmed;

  // Якщо вхідне ім'я без " (N)" і воно унікальне — повертаємо як є
  if (!suffixMatch && !existingSet.has(normalize(trimmed))) {
    return trimmed;
  }

  // Шукаємо мінімальний N >= 2 такий що "base (N)" не існує
  let n = 2;
  while (true) {
    const candidate = `${baseName} (${n})`;
    if (!existingSet.has(normalize(candidate))) {
      return candidate;
    }
    n++;
    if (n > 10000) {
      // Захист від нескінченного циклу — поверни з timestamp
      return `${baseName} (${Date.now()})`;
    }
  }
}

/**
 * Виклик Anthropic API.
 * Окрема функція — у тестах мокаємо global.fetch.
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
 * Public API. Сортує items через Sonnet з JSON output.
 * Якщо items.length < 2 → fallback (агент не викликається).
 */
export async function sortImages(items, options = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('sortImages: items має бути непорожнім масивом');
  }
  const n = items.length;

  // Degenerate case — для 1 зображення агент не потрібен
  if (n === 1) {
    return {
      order: [items[0].index ?? 0],
      warnings: [],
      missing: null,
      suggestedName: '',
      model: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      skipped: true,
    };
  }

  const { apiKey, caseContext, callApi } = options;
  if (!apiKey && !callApi) {
    throw new Error('sortImages: apiKey required (або callApi для тестів)');
  }

  const model = options.model || resolveModel('imageSorter');
  const userMessage = buildUserMessage(items, caseContext);

  // dependency injection для тестів: callApi мокаємо замість fetch
  const apiFn = callApi || callAnthropic;
  const apiResp = await apiFn({
    apiKey,
    model,
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    maxTokens: MAX_OUTPUT_TOKENS,
  });

  const rawText = apiResp?.content?.[0]?.text || apiResp?.text || '';
  const parsed = parseAgentResponse(rawText);

  const inputTokens = apiResp?.usage?.input_tokens ?? 0;
  const outputTokens = apiResp?.usage?.output_tokens ?? 0;

  // Fallback при невалідному JSON: identity order, no warnings, name=""
  if (!parsed || typeof parsed !== 'object') {
    return {
      order: items.map((it) => it.index ?? 0),
      warnings: [],
      missing: null,
      suggestedName: '',
      model,
      usage: { inputTokens, outputTokens },
      fallback: true,
      fallbackReason: 'agent_invalid_json',
    };
  }

  // Map original indices → позиція у items[] (на випадок якщо items вже з
  // зміщеними індексами). Якщо item.index = original index у списку, то
  // order повертає original indices, що нам і треба.
  const allowedIndices = new Set(items.map((it) => it.index ?? items.indexOf(it)));

  // Перевіряємо що order містить permutation з допустимих індексів
  let order = parsed.order;
  let fallbackReason = null;
  if (!Array.isArray(order)) {
    order = items.map((it) => it.index ?? items.indexOf(it));
    fallbackReason = 'order_missing';
  } else {
    // Залишаємо тільки допустимі індекси, без дублів, у порядку повернення агента
    const cleaned = [];
    const seen = new Set();
    for (const v of order) {
      if (allowedIndices.has(v) && !seen.has(v)) {
        cleaned.push(v);
        seen.add(v);
      }
    }
    // Якщо щось пропущено — добавляємо missing у кінець за оригінальним порядком
    if (cleaned.length !== items.length) {
      for (const it of items) {
        const idx = it.index ?? items.indexOf(it);
        if (!seen.has(idx)) cleaned.push(idx);
      }
      fallbackReason = 'order_normalized';
    }
    order = cleaned;
  }

  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings
        .filter((w) => w && typeof w === 'object' && Number.isInteger(w.index) && typeof w.reason === 'string')
        .filter((w) => allowedIndices.has(w.index))
    : [];

  const missing = typeof parsed.missing === 'string' && parsed.missing.trim() ? parsed.missing.trim() : null;

  // suggestedName — з агента, потім робимо унікальним у справі через ensureUniqueName.
  // Caller (multiImageToPdf) повторно викликає ensureUniqueName коли адвокат
  // змінює назву вручну.
  let suggestedName = typeof parsed.suggestedName === 'string' ? parsed.suggestedName.trim() : '';
  if (suggestedName && caseContext?.existingDocumentNames) {
    suggestedName = ensureUniqueName(suggestedName, caseContext.existingDocumentNames);
  }

  return {
    order,
    warnings,
    missing,
    suggestedName,
    model,
    usage: { inputTokens, outputTokens },
    fallback: !!fallbackReason,
    fallbackReason,
  };
}

// Експорт для тестів
export const __test__ = {
  SYSTEM_PROMPT,
  MAX_OUTPUT_TOKENS,
  MAX_OCR_TEXT_PER_IMAGE,
  truncateOcrText,
  buildUserMessage,
  validateOrder,
};
