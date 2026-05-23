// ── DOCUMENT BOUNDARY · ToC DETECTOR (TASK ToC Гілка A) ─────────────────────
// tocDetector — знайти і розпарсити табличний реєстр/опис матеріалів справи
// на перших ~5 сторінках тома. Якщо знайшов і розпарсив — повертає
// детермінований план нарізки (обходить AI Triage). Інакше — null.
// Один сенс (правило #11): «прочитати готовий план нарізки з самого тома,
// якщо адвокат/канцелярія його вже склали — не вгадувати».
//
// Чому препроцесор у triageStage, а НЕ нова стадія диригента (обмеження №4):
// диригент заморожений. ToC — це детермінований обхід AI Triage, який лягає
// у той самий слот DETECT_BOUNDARIES (як trivialImagePlan); транзитний план
// у ctx.reconstructionPlan, без зміни схеми (обмеження №5).
//
// Два кроки Haiku (вартісна модель — Haiku, не Sonnet; білінг §12):
//   1. detect: дати перші ~5 сторінок повним _text → AI каже чи це реєстр і
//      визначає registryPages[] + firstDocumentPage (физ. сторінка ПЕРШОГО
//      документа після реєстру; кодує offset).
//   2. parse: якщо isRegistry — дати _text сторінок реєстру → AI парсить
//      таблицю → items[{n, name, startLeaf, endLeaf}].
//   3. valid+build: застосувати offset, валідація (overlap, межі тома,
//      покриття) → {documents, unusedPages, confirmed:true, source:'toc_detector'}.
//
// Будь-яка помилка на КОЖНОМУ кроці (нема ключа / AI кинуло / не-JSON /
// невалідний реєстр) — повертаємо {isToc:false, reason} БЕЗ throw. Caller
// (triageStage) трактує як «реєстру нема, йдемо у AI Triage з збагаченим
// дайджестом» — fallback не випадковий, він кращий за зламану нарізку.
//
// Чистий модуль: без Drive/React. AI-транспорт (callAPI) ін'єктується для
// тестів; за дефолтом callAPIWithRetry з toolUseRunner.

import { resolveModel } from '../modelResolver.js';
import { logAiUsageViaSink } from '../aiUsageService.js';
import * as activityTracker from '../activityTracker.js';
import { MODULES, categoryForCase } from '../moduleNames.js';
import { callAPIWithRetry } from '../toolUseRunner.js';

// ── JSON-парс (depth counter, як analyzeTriageViaToolUse) ───────────────────
function extractJson(text) {
  if (typeof text !== 'string') return null;
  const s = text.indexOf('{');
  if (s < 0) return null;
  let depth = 0;
  for (let i = s; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) { try { return JSON.parse(text.slice(s, i + 1)); } catch { return null; } }
    }
  }
  return null;
}

// Скільки перших сторінок дивимось у Кроці 1 (detect). Стартова точка: 5.
// Реєстр у судових томах майже завжди на 1-3 стор., 5 з запасом.
const DETECT_FIRST_PAGES = 5;
// Максимальний обсяг тексту реєстру для Кроку 2 (parse), щоб не переповнити
// вікно при випадковому ToC на 10 сторінок (рідко, але можливо).
const PARSE_MAX_CHARS = 80000;

// Зібрати посторінковий текст перших N сторінок з маркерами.
function firstPagesText(layoutJson, n) {
  const pages = layoutJson?.pages || [];
  const slice = pages.slice(0, Math.min(n, pages.length));
  return slice
    .map((p, i) => `=== СТОРІНКА ${i + 1} ===\n${(p && p._text) || ''}`)
    .join('\n\n');
}

// Зібрати текст лише вказаних сторінок (1-based).
function pagesByNumbers(layoutJson, pageNumbers) {
  const pages = layoutJson?.pages || [];
  const lines = [];
  for (const n of pageNumbers) {
    const idx = Number(n) - 1;
    if (idx < 0 || idx >= pages.length) continue;
    lines.push(`=== СТОРІНКА ${n} ===\n${(pages[idx] && pages[idx]._text) || ''}`);
  }
  return lines.join('\n\n').slice(0, PARSE_MAX_CHARS);
}

// ── Промпти (структурні; НЕ verbatim-снапшоти) ──────────────────────────────

export function buildDetectPrompt({ firstPagesPassport }) {
  return `Подивись на текст перших сторінок тома судової справи. Тут МОЖЕ бути табличний реєстр (опис, перелік, зміст) документів які містяться в томі: з номерами і аркушами (фізичними сторінками).

Заголовок такого реєстру варіюється: "Опис документів які містяться в томі", "Реєстр матеріалів справи", "Перелік матеріалів", "Зміст тома", "Опис вкладень", "Перелік документів" та подібне. Перелік невичерпний — якщо бачиш інший очевидний заголовок-реєстр, кваліфікуй як реєстр.

Реєстр виглядає як таблиця: колонки "№ / Назва документа / Аркуші" (або синоніми). Звичайний текстовий зміст БЕЗ нумерації документів і діапазонів аркушів — це НЕ реєстр.

Поверни ТІЛЬКИ JSON БЕЗ тексту до/після:
{
  "isRegistry": true | false,
  "registryHeaderText": "точний заголовок з документа або null",
  "registryPages": [n, ...] (фізичні сторінки самого реєстру, 1-based, у порядку),
  "firstDocumentPage": n (фізична сторінка ПЕРШОГО документа ПІСЛЯ реєстру; null якщо невідомо)
}

Якщо реєстру нема — isRegistry:false і решта null/[].

${firstPagesPassport}`;
}

export function buildParsePrompt({ registryPassport }) {
  return `Це сторінки реєстру/опису матеріалів судової справи. Розпарсь таблицю — для КОЖНОГО рядка реєстру (один документ = один рядок) поверни: номер, повна назва документа, діапазон аркушів (фізичних сторінок тома).

Аркуші можуть бути:
- "1-5", "6-12" — діапазон;
- "6", "12" — одна сторінка;
- "I-III", "IV" — римські цифри (поверни як арабські числа);
- "1, 3, 5" — несуцільні (рідко; об'єднай у мінімальний діапазон start-end).

Якщо реєстр використовує власну нумерацію (аркуш 1 у таблиці = ПЕРШИЙ документ після реєстру) — це нормально, повертай як є. Зовнішня логіка застосує зміщення (offset).

Поверни ТІЛЬКИ JSON БЕЗ тексту до/після:
{
  "items": [
    {"n": 1, "name": "Постанова про порушення кримінальної справи", "startLeaf": 1, "endLeaf": 3},
    {"n": 2, "name": "Протокол огляду місця події", "startLeaf": 4, "endLeaf": 12}
  ]
}

Якщо рядки реєстру нечитабельні / реєстру не видно — items: [].

${registryPassport}`;
}

// ── Білінг (try/catch, не валить детектор) ──────────────────────────────────
function reportUsage(data, model, caseId, operation, aiUsageSink) {
  try {
    logAiUsageViaSink({
      agentType: 'document_parser',
      model,
      inputTokens: data?.usage?.input_tokens,
      outputTokens: data?.usage?.output_tokens,
      context: { caseId: caseId || null, module: MODULES.DOCUMENT_PROCESSOR, operation },
    }, aiUsageSink);
    activityTracker.report('agent_call', {
      caseId: caseId || null,
      module: MODULES.DOCUMENT_PROCESSOR,
      category: categoryForCase(caseId),
      metadata: { agentType: 'document_parser', operation },
    });
  } catch { /* білінг не валить детектор */ }
}

// Один Haiku-виклик + JSON-парс. callAPI ін'єкція дозволяє тестам не мокати
// global fetch. На failure повертає {ok:false, reason}, ніколи не throw.
async function askHaiku({ prompt, apiKey, callAPI, model, maxTokens }) {
  try {
    const data = await callAPI({
      model,
      max_tokens: maxTokens || 1500,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    }, { apiKey });
    if (data?.error) return { ok: false, reason: `api_error:${data.error?.message || 'unknown'}` };
    const out = data?.content?.[0]?.text;
    const parsed = extractJson(typeof out === 'string' ? out : '');
    if (!parsed) return { ok: false, reason: 'invalid_json' };
    return { ok: true, parsed, usage: data?.usage };
  } catch (err) {
    return { ok: false, reason: `transport:${err?.message || String(err)}` };
  }
}

// ── Валідація реєстру + побудова детермінованого плану ──────────────────────

// Внутрішня нумерація аркушів реєстру нерідко зміщена відносно фізичних
// сторінок: реєстр сам на стор. 1-3, а аркуш "1" = ПЕРША фізична сторінка
// документа № 1. firstDocumentPage кодує offset = firstDocumentPage - 1.
//
// Якщо firstDocumentPage невідомий (AI повернув null) — припускаємо offset
// = max(registryPages) (реєстр займає перші стор., перший документ — одразу
// після). Це безпечне припущення для українських томів.
function computeOffset({ firstDocumentPage, registryPages }) {
  const fdp = Number(firstDocumentPage);
  if (Number.isFinite(fdp) && fdp >= 1) return fdp - 1;
  if (Array.isArray(registryPages) && registryPages.length) {
    const max = Math.max(...registryPages.map((x) => Number(x) || 0));
    if (Number.isFinite(max) && max >= 1) return max;
  }
  return 0;
}

export function validateRegistryItems({ items, offset, totalPages, registryPages }) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, reason: 'empty_items' };
  }
  const normalized = [];
  for (const it of items) {
    const startLeaf = Number(it?.startLeaf);
    const endLeaf = Number(it?.endLeaf);
    if (!Number.isFinite(startLeaf) || !Number.isFinite(endLeaf)) {
      return { ok: false, reason: 'non_numeric_leaf' };
    }
    const start = startLeaf + offset;
    const end = endLeaf + offset;
    if (start < 1 || end < start) {
      return { ok: false, reason: 'invalid_range' };
    }
    if (Number.isFinite(totalPages) && end > totalPages) {
      return { ok: false, reason: 'range_overflow' };
    }
    normalized.push({
      n: Number(it.n) || normalized.length + 1,
      name: typeof it.name === 'string' ? it.name.trim() : '',
      startPage: start,
      endPage: end,
    });
  }
  // Сортуємо за startPage для перевірки overlap.
  const sorted = [...normalized].sort((a, b) => a.startPage - b.startPage);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startPage <= sorted[i - 1].endPage) {
      return { ok: false, reason: 'overlap_between_items' };
    }
  }
  // Покриття: сума діапазонів + сторінки реєстру ≈ totalPages (±5%, мінімум 1).
  if (Number.isFinite(totalPages) && totalPages > 0) {
    const itemPages = sorted.reduce((s, it) => s + (it.endPage - it.startPage + 1), 0);
    const regPages = Array.isArray(registryPages) ? registryPages.length : 0;
    const covered = itemPages + regPages;
    const tolerance = Math.max(1, Math.round(totalPages * 0.05));
    if (Math.abs(covered - totalPages) > tolerance) {
      return { ok: false, reason: 'coverage_mismatch', covered, totalPages };
    }
  }
  return { ok: true, items: normalized };
}

function buildPlan({ fileId, items, registryPages }) {
  const documents = items.map((it, i) => ({
    documentId: `doc_${i + 1}`,
    name: it.name || null,
    type: null,
    route: 'slice',
    fragments: [{ fileId, startPage: it.startPage, endPage: it.endPage }],
    open: false,
  }));
  const unusedPages = [];
  if (Array.isArray(registryPages) && registryPages.length) {
    const min = Math.min(...registryPages);
    const max = Math.max(...registryPages);
    unusedPages.push({
      fileId,
      startPage: min,
      endPage: max,
      reason: 'реєстр матеріалів',
    });
  }
  return {
    documents,
    unusedPages,
    confirmed: true,
    source: 'toc_detector',
  };
}

// ── Публічна функція ────────────────────────────────────────────────────────

/**
 * Детектор + парсер реєстру/опису матеріалів справи.
 * @param {object} args
 * @param {string} args.fileId — fileId артефакту (для plan.fragments).
 * @param {object|null} args.layoutJson — { pages:[{_text,...}] }.
 * @param {number|null} args.totalPages — загальна к-сть сторінок тома.
 * @param {string|null} args.caseId
 * @param {string} args.apiKey
 * @param {Function} [args.aiUsageSink]
 * @param {Function} [args.callAPI] — ін'єкція AI-транспорту (default — callAPIWithRetry).
 * @returns {Promise<{isToc: boolean, plan: object|null, reason?: string}>}
 */
export async function detectTableOfContents({
  fileId,
  layoutJson,
  totalPages,
  caseId = null,
  apiKey,
  aiUsageSink,
  callAPI = callAPIWithRetry,
} = {}) {
  // Без ключа — не детектор, fallback на AI Triage.
  if (!apiKey) return { isToc: false, reason: 'no_api_key' };
  // Без layout — нема що читати; не падаємо.
  if (!layoutJson || !Array.isArray(layoutJson.pages) || layoutJson.pages.length === 0) {
    return { isToc: false, reason: 'no_layout' };
  }
  // Малі томи (≤ ~10 стор.) — реєстр зазвичай не потрібен; ціль ToC —
  // великі томи. Дешева пре-фільтрація економить 2 виклики Haiku на дрібних
  // вхідних (стартова точка, не жорстке правило).
  const totalPagesNum = Number.isFinite(totalPages) ? totalPages : layoutJson.pages.length;
  if (totalPagesNum < 10) return { isToc: false, reason: 'too_small' };

  const model = resolveModel('qiParserDocument');

  // ── Крок 1: detect ───────────────────────────────────────────────────────
  const firstPagesPassport = firstPagesText(layoutJson, DETECT_FIRST_PAGES);
  if (!firstPagesPassport.trim()) return { isToc: false, reason: 'empty_first_pages' };

  const detectRes = await askHaiku({
    prompt: buildDetectPrompt({ firstPagesPassport }),
    apiKey,
    callAPI,
    model,
    maxTokens: 800,
  });
  if (detectRes.usage) reportUsage({ usage: detectRes.usage }, model, caseId, 'toc_detect', aiUsageSink);
  if (!detectRes.ok) return { isToc: false, reason: `detect_${detectRes.reason}` };

  const detect = detectRes.parsed;
  if (!detect || detect.isRegistry !== true) {
    return { isToc: false, reason: 'no_registry_detected' };
  }
  const registryPages = Array.isArray(detect.registryPages)
    ? detect.registryPages.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 1)
    : [];
  if (registryPages.length === 0) {
    return { isToc: false, reason: 'no_registry_pages' };
  }

  // ── Крок 2: parse ────────────────────────────────────────────────────────
  const registryPassport = pagesByNumbers(layoutJson, registryPages);
  if (!registryPassport.trim()) return { isToc: false, reason: 'empty_registry_text' };

  const parseRes = await askHaiku({
    prompt: buildParsePrompt({ registryPassport }),
    apiKey,
    callAPI,
    model,
    maxTokens: 4000,
  });
  if (parseRes.usage) reportUsage({ usage: parseRes.usage }, model, caseId, 'toc_parse', aiUsageSink);
  if (!parseRes.ok) return { isToc: false, reason: `parse_${parseRes.reason}` };

  // ── Крок 3: валідація + offset + побудова плану ─────────────────────────
  const offset = computeOffset({ firstDocumentPage: detect.firstDocumentPage, registryPages });
  const valid = validateRegistryItems({
    items: parseRes.parsed?.items,
    offset,
    totalPages: totalPagesNum,
    registryPages,
  });
  if (!valid.ok) return { isToc: false, reason: `invalid_${valid.reason}` };

  const plan = buildPlan({ fileId, items: valid.items, registryPages });
  return { isToc: true, plan };
}
