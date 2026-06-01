// ── CLEAN TEXT SERVICE (спільне ядро очистки тексту → Markdown) ─────────────
// TASK 3.1. ОДНЕ ядро очистки сирого OCR-тексту сканованого документа у
// гарний читабельний Markdown — кілька споживачів тягнуть звідси (Rule of
// Three / #11): Document Processor (тумблер «Очистити для читання», 3.1),
// кнопки ретроактивної очистки (3.2), мультивибір у реєстрі (3.3).
//
// Скоуп (наскрізний, перевірено по коду): ТІЛЬКИ documentNature==='scanned'
// (скани/фото через Document AI — мають layout). searchable (DOCX/HTML/
// текстовий PDF) — ПОВНІСТЮ ПОЗА функцією: у них уже чистий цифровий текст.
//
// Архітектура — 3-кроковий гібрид (mermaid flow_clean_text.md):
//   КРОК 1 — layoutToMarkdownDraft: детермінований конденсатор (0 токенів AI).
//            Читає layout ПОСТОРІНКОВО через page._text + геометрія boundingPoly.
//            НЕ offset'и в глобальний .txt (ненадійні на сканах >25 стор. —
//            documentAi.js:428-435 перебазовує лише pageNumber). Дзеркало
//            pageMarkers.js (blockBox/orderedBlocks/footerNumber).
//   КРОК 2 — polishToMarkdown: AI-поліш (Haiku, консервативний). Чернетка →
//            фінальний .md + attentionNotes[]. НЕ міняє зміст (§6 design).
//            JSON depth-counter парсинг. C7-логування (один шлях на всіх
//            споживачів: logAiUsage завжди; activityTracker лише коли
//            billAsUserAction — окрема оплачувана дія адвоката).
//   КРОК 3 — cleanDocument: оркестрація (DI, без React-стану). Скоуп-гард →
//            fetch layout/txt → КРОК1 → КРОК2 → долі артефактів (.md створити,
//            .txt → _raw_txt/, .layout.json видалити) → оновити метадані.
//
// ОБМЕЖЕННЯ конденсатора (по коду documentAi.extractPageText): блок/таблиця
// layout.textAnchor.textSegments індексують ТЕКСТ ЧАНКА, який не зберігається
// у .layout.json — лишається тільки page._text. Тому per-block/per-cell текст
// з offset'ів НЕ відновлюється; конденсатор будує з _text, а геометрію
// (boundingPoly) використовує як СТРУКТУРНІ ПІДКАЗКИ (заголовок/футер) і
// маркер наявності таблиці. Фінальне форматування таблиць — за AI-полішем.

import { callAPIWithRetry as defaultCallAPIWithRetry } from './toolUseRunner.js';
import { resolveModel as defaultResolveModel } from './modelResolver.js';
import { logAiUsage as defaultLogAiUsage } from './aiUsageService.js';
import * as defaultActivityTracker from './activityTracker.js';
import { MODULES, categoryForCase } from './moduleNames.js';

export const CLEAN_TEXT_SERVICE_VERSION = '2.0';

// Дефолтна модель — Haiku (структурна задача, дешева). agentType 'textCleaner'
// у SYSTEM_DEFAULTS (modelResolver). logAiUsage пише agentType 'text_cleaner'
// (snake_case — як решта context-у ai_usage[]).
const TEXT_CLEANER_AGENT = 'textCleaner';
const TEXT_CLEANER_USAGE_AGENT = 'text_cleaner';
const FALLBACK_MODEL = 'claude-haiku-4-5-20251001';

// ── Бюджети токенів (flow_clean_text_chunking.md) ───────────────────────────
// Два РІЗНІ ліміти: ВХІД (читання, вікно Haiku 200K) і ВИХІД (генерація, стеля
// Haiku 4.5 = 64K — API відхилить >64000). Очистку обмежує менший — ВИХІД,
// тому документ чистимо ПАЧКАМИ сторінок під вихідну стелю.
const HAIKU_MAX_OUTPUT_TOKENS = 64000;   // стеля Haiku 4.5 — НЕ перевищувати (API відхилить)
const MAX_BATCH_OUTPUT_TOKENS = 24000;   // цільовий вихід однієї пачки (~8-15 стор.)
const CYRILLIC_CHARS_PER_TOKEN = 2;      // щільність кирилиці (passport_scale дослідження)
const OUTPUT_HEADROOM = 1.5;             // markdown додає форматування → запас на max_tokens
const MIN_OUTPUT_TOKENS = 2000;          // floor max_tokens (коротка пачка)
const INPUT_CHAR_CAP = 200000;           // безпечний cap входу (~100K ток, під вікно 200K)

// Оцінка вихідних токенів для тексту (кирилиця ~2 симв/ток).
function estimateTokens(str) {
  return Math.ceil(String(str || '').length / CYRILLIC_CHARS_PER_TOKEN);
}
function estimatePageTokens(page) {
  return estimateTokens(page && page._text);
}
// max_tokens під обсяг пачки: оцінка × запас + буфер, у межах [MIN, 64000].
function maxTokensForEstimate(estTok) {
  const v = Math.ceil((estTok || 0) * OUTPUT_HEADROOM) + 1000;
  return Math.max(MIN_OUTPUT_TOKENS, Math.min(HAIKU_MAX_OUTPUT_TOKENS, v));
}
// Пакування сторінок у пачки за вихідним бюджетом (лік плаває за щільністю).
function packPagesIntoBatches(pages) {
  const batches = [];
  let cur = [];
  let curTok = 0;
  for (const p of pages) {
    const t = estimatePageTokens(p);
    if (cur.length > 0 && curTok + t > MAX_BATCH_OUTPUT_TOKENS) {
      batches.push(cur); cur = []; curTok = 0;
    }
    cur.push(p); curTok += t;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

// ── КРОК 1 · КОНДЕНСАТОР (детермінований, 0 токенів) ────────────────────────

// Геометрія блоку: vertical bounds + горизонтальний центр/ширина з
// boundingPoly.normalizedVertices (0..1). null якщо геометрії нема.
// Дзеркало pageMarkers.blockBox (локальна копія — cleanTextService
// самодостатній сервіс; винос у спільний layoutGeometry — tracking_debt).
function blockBox(block) {
  const v = block?.layout?.boundingPoly?.normalizedVertices;
  if (!Array.isArray(v) || v.length === 0) return null;
  const xs = v.map((p) => Number(p?.x) || 0);
  const ys = v.map((p) => Number(p?.y) || 0);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, w: maxX - minX, top: minY, bottom: maxY };
}

// Блоки сторінки впорядковані зверху-вниз (Document AI: page.blocks або
// page.paragraphs). Дзеркало pageMarkers.orderedBlocks.
function orderedBlocks(page) {
  const raw = Array.isArray(page?.blocks) && page.blocks.length
    ? page.blocks
    : (Array.isArray(page?.paragraphs) ? page.paragraphs : []);
  return raw
    .map((b) => ({ b, box: blockBox(b) }))
    .filter((x) => x.box)
    .sort((a, b) => a.box.top - b.box.top);
}

function firstNonEmptyLine(text) {
  for (const ln of String(text || '').split('\n')) {
    const t = ln.trim();
    if (t) return t;
  }
  return '';
}

// Останній рядок — кандидат футера. Повертає рядок якщо він короткий і це
// переважно «надрукований» номер сторінки (шум, викидаємо). Дзеркало
// pageMarkers.footerNumber, але повертаємо сам рядок для матчингу у _text.
function pageNumberFooterLine(text) {
  const lines = String(text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (!t) continue;
    if (t.length > 24) return null;
    const m = t.match(/(?:^|\s|-|№|стор\.?|page)\s*(\d{1,4})\s*$/i) || t.match(/^\s*(\d{1,4})\s*$/);
    return m ? t : null;
  }
  return null;
}

// Чи перший блок сторінки — короткий центрований (ймовірний заголовок).
// Дзеркало pageMarkers.headingSignal-геометрії.
function topBlockIsHeading(page, firstLine) {
  const blocks = orderedBlocks(page);
  if (blocks.length === 0) return false;
  const top = blocks[0].box;
  const centered = top.cx > 0.30 && top.cx < 0.70 && top.w < 0.75 && top.top < 0.30;
  if (!centered) return false;
  return !!firstLine && firstLine.length <= 90;
}

// Нормалізація inline-тексту сторінки (з WIP-чернетки, адаптовано під _text):
//   • зшити перенесені дефісом слова (сло-\nво → слово);
//   • схлопнути послідовні пробіли/таби;
//   • злити «обгорнуті» рядки одного абзацу (рядок без термінального розділового
//     + наступний з малої/продовження) у суцільний абзац;
//   • порожній рядок = межа абзацу.
// Повертає масив абзаців (рядків Markdown).
function normalizeInlineText(text) {
  const raw = String(text || '').replace(/\r\n?/g, '\n');
  // Зшити переноси дефісом на кінці рядка: «сло-\nво» → «слово».
  const dehyphenated = raw.replace(/(\p{L})-\n(\p{L})/gu, '$1$2');
  const lines = dehyphenated.split('\n');

  const paragraphs = [];
  let buf = '';
  const flush = () => {
    const p = buf.replace(/[ \t]+/g, ' ').trim();
    if (p) paragraphs.push(p);
    buf = '';
  };

  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line) { flush(); continue; }
    if (!buf) { buf = line; continue; }
    // Якщо попередній буфер не закінчився термінальним знаком і поточний
    // рядок продовжує речення — приєднуємо до того ж абзацу.
    const prevEndsSentence = /[.!?:;»"”)]$/.test(buf);
    const startsNewBlock = /^[••\-\*\d]/.test(line) && /^[••\-\*]\s|^\d+[.)]\s/.test(line);
    if (prevEndsSentence || startsNewBlock) {
      flush();
      buf = line;
    } else {
      buf += ' ' + line;
    }
  }
  flush();
  return paragraphs;
}

// Перетворити абзац у Markdown-рядок: марковані/нумеровані списки → GFM-списки.
function paragraphToMarkdown(p) {
  const bullet = p.match(/^[••\-\*]\s+(.*)$/);
  if (bullet) return `- ${bullet[1].trim()}`;
  const numbered = p.match(/^(\d+)[.)]\s+(.*)$/);
  if (numbered) return `${numbered[1]}. ${numbered[2].trim()}`;
  return p;
}

// Нормалізувати вхід у масив сторінок: приймає РЕАЛЬНИЙ Document AI
// pageStructure (масив Google-pages з _text) АБО .layout.json shape
// ({ schemaVersion, provider, pages:[...] }).
function pagesOf(pageStructure) {
  if (Array.isArray(pageStructure)) return pageStructure;
  if (pageStructure && Array.isArray(pageStructure.pages)) return pageStructure.pages;
  return [];
}

/**
 * КРОК 1 — конденсатор. layout → компактна Markdown-чернетка. Pure, 0 токенів.
 * Читає ПОСТОРІНКОВО через page._text; структуру виводить з геометрії
 * boundingPoly + наявності page.tables. НЕ читає offset'и в глобальний .txt.
 *
 * @param {Array|object} pageStructure — Document AI pages[] або .layout.json
 * @param {object} [options]
 *   options.pageSeparators (default true) — додавати тонкий роздільник між сторінками
 * @returns {string} Markdown-чернетка (порожній рядок якщо нема тексту)
 */
export function layoutToMarkdownDraft(pageStructure, options = {}) {
  const pages = pagesOf(pageStructure);
  if (pages.length === 0) return '';
  const withSep = options.pageSeparators !== false;

  const pageBlocks = [];
  for (const page of pages) {
    const text = (page && page._text) || '';
    if (!String(text).trim()) continue;

    const firstLine = firstNonEmptyLine(text);
    const footerNoise = pageNumberFooterLine(text);
    const headingFirst = topBlockIsHeading(page, firstLine);

    const paragraphs = normalizeInlineText(text);
    const out = [];
    paragraphs.forEach((p, idx) => {
      // Викидаємо рядок-шум «надрукований номер сторінки» (футер).
      if (footerNoise && p.trim() === footerNoise) return;
      if (idx === 0 && headingFirst && p === firstLine) {
        out.push(`## ${p}`);
      } else {
        out.push(paragraphToMarkdown(p));
      }
    });

    // Підказка AI: на цій сторінці є таблиця — зберегти табличну структуру.
    if (Array.isArray(page?.tables) && page.tables.length > 0) {
      out.push('<!-- увага: на цій сторінці таблиця — збережи табличну структуру у GFM -->');
    }

    if (out.length > 0) pageBlocks.push(out.join('\n\n'));
  }

  if (pageBlocks.length === 0) return '';
  return withSep ? pageBlocks.join('\n\n---\n\n') : pageBlocks.join('\n\n');
}

// ── КРОК 2 · AI-ПОЛІШ (Haiku, консервативний) ───────────────────────────────

// Парсинг JSON depth-counter (НЕ regex — зупиняється на першій }).
function extractJsonObject(text) {
  if (!text) return null;
  const s = text.indexOf('{');
  if (s < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = s; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) { esc = false; }
      else if (ch === '\\') { esc = true; }
      else if (ch === '"') { inStr = false; }
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(s, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

// Консервативний промпт (перенесено + посилено з inline aiCleanText DP).
// §6 design: AI чистить ФОРМАТУВАННЯ, НЕ зміст. Повертає JSON {markdown,
// attentionNotes}. attentionNotes — що привернуло увагу БЕЗ зміни документа.
// Вхід обмежений INPUT_CHAR_CAP (безпека під вікно 200K; пачкування тримає
// реальні чернетки малими — cap спрацьовує лише на патологічно великий flat-txt).
function buildCleanPrompt(draft, fileName) {
  return `Ти форматуєш сирий OCR-текст судового документа${fileName ? ` "${fileName}"` : ''} у гарний читабельний Markdown.

ЖОРСТКІ ПРАВИЛА (НЕПОРУШНІ):
1. Ти чистиш ТІЛЬКИ форматування. НЕ змінюй юридичний зміст.
2. НЕ виправляй цитати, суми, дати, імена, номери, формулювання — навіть якщо здається помилкою. Краще лишити сміття, ніж змінити зміст всупереч оригіналу.
3. Прибери сміття розпізнавання (артефакти сканування, дублі, розірвані переноси), віднови абзаци, заголовки, списки, таблиці (GFM) близько до оригіналу.
4. Якщо щось привернуло увагу (можлива розбіжність, дивне формулювання) — НЕ виправляй, а відміть у attentionNotes. Документ лишається як є.
5. Збережи ВЕСЬ змістовний текст. Не скорочуй, не переказуй.

Поверни ВИКЛЮЧНО JSON такої форми (без коментарів до/після):
{
  "markdown": "<очищений документ у Markdown>",
  "attentionNotes": [ { "page": <номер сторінки або null>, "note": "<що привернуло увагу>" } ]
}
Якщо нічого не привернуло увагу — "attentionNotes": [].

Сира чернетка тексту:
${String(draft).slice(0, INPUT_CHAR_CAP)}`;
}

/**
 * КРОК 2 — AI-поліш ОДНІЄЇ пачки. Чернетка → фінальний Markdown + attentionNotes.
 * max_tokens рахується від обсягу пачки (caller), стеля HAIKU_MAX_OUTPUT_TOKENS.
 * Детектує обрізання (stop_reason==='max_tokens') → truncated:true.
 *
 * C7: logAiUsage (токени) ЗАВЖДИ при usage. activityTracker (оплачувана ДІЯ
 * адвоката) тут НЕ викликається — він раз на документ у cleanDocument (інакше
 * пачкування над-рахувало б одну дію як N).
 *
 * @returns {Promise<{markdown, attentionNotes, warning, usage, truncated}>}
 *   markdown=draft + warning якщо нема ключа / AI кинув / порожнє.
 */
export async function polishToMarkdown({
  draft,
  fileName = '',
  apiKey,
  caseId = null,
  documentId = null,
  module = MODULES.DOCUMENT_PROCESSOR,
  maxTokens = null,
  aiUsageSink = null,
  // DI-шви (дефолти — реальні; тести стабують):
  callAI = defaultCallAPIWithRetry,
  resolveModel = defaultResolveModel,
  logAiUsage = defaultLogAiUsage,
} = {}) {
  const draftStr = String(draft || '');
  if (!apiKey) {
    return { markdown: draftStr, attentionNotes: [], warning: 'AI недоступний — збережено чернетку без поліша', usage: null, truncated: false };
  }
  if (!draftStr.trim()) {
    return { markdown: '', attentionNotes: [], warning: 'Порожня чернетка', usage: null, truncated: false };
  }

  const model = resolveModel(TEXT_CLEANER_AGENT) || FALLBACK_MODEL;
  // max_tokens: переданий caller'ом (пачка) або оцінений від чернетки; стеля 64K.
  const max_tokens = Math.min(
    HAIKU_MAX_OUTPUT_TOKENS,
    maxTokens || maxTokensForEstimate(estimateTokens(draftStr)),
  );

  let res;
  try {
    res = await callAI({
      model,
      max_tokens,
      messages: [{ role: 'user', content: buildCleanPrompt(draftStr, fileName) }],
    }, { apiKey });
  } catch (err) {
    return {
      markdown: draftStr,
      attentionNotes: [],
      warning: `Очистка не вдалась (${err?.message || err}) — збережено чернетку`,
      usage: null,
      truncated: false,
    };
  }

  // C7 — токени пишемо завжди коли є usage (на КОЖЕН виклик пачки — точна вартість).
  const usage = res?.usage || null;
  try {
    logAiUsage({
      agentType: TEXT_CLEANER_USAGE_AGENT,
      model,
      inputTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
      context: { caseId, module, operation: 'clean_text', documentId },
    }, aiUsageSink);
  } catch { /* телеметрія не критична */ }

  const truncated = res?.stop_reason === 'max_tokens';
  const out = res?.content?.[0]?.text || res?.content || '';
  const rawText = typeof out === 'string' ? out : '';
  const parsed = extractJsonObject(rawText);

  if (parsed && typeof parsed.markdown === 'string' && parsed.markdown.trim()) {
    const notes = Array.isArray(parsed.attentionNotes)
      ? parsed.attentionNotes
          .filter((n) => n && (typeof n === 'object'))
          .map((n) => ({ page: n.page ?? null, note: String(n.note || '').trim() }))
          .filter((n) => n.note)
      : [];
    return {
      markdown: parsed.markdown,
      attentionNotes: notes,
      warning: truncated ? 'AI обрізав вивід (max_tokens)' : null,
      usage,
      truncated,
    };
  }

  // AI повернув не-JSON або порожнє: якщо є непорожній сирий текст — взяти його
  // (краще ніж нічого), інакше fallback на чернетку.
  if (rawText.trim()) {
    return { markdown: rawText, attentionNotes: [], warning: 'AI повернув не-JSON — збережено як plain', usage, truncated };
  }
  return { markdown: draftStr, attentionNotes: [], warning: 'Очистка повернула порожнє — збережено чернетку', usage, truncated };
}

// ── КРОК 3 · ОРКЕСТРАЦІЯ (cleanDocument) ────────────────────────────────────

function noop() {}

// Склейка частин документа через роздільник сторінок (межі зберігаються).
const PAGE_SEP = '\n\n---\n\n';

/**
 * cleanDocument — оркестрація очистки ОДНОГО документа (DI, без React-стану).
 * Скоуп-гард scanned → fetch layout/txt → ПАЧКОВЕ очищення (КРОК1 конденсатор
 * + КРОК2 поліш на КОЖНУ пачку сторінок під вихідну стелю Haiku, з halving-retry
 * при обрізанні) → склейка через роздільник → долі артефактів (CRASH-SAFE,
 * тільки при ПОВНОМУ успіху).
 *
 * Долі артефактів виконуються ТІЛЬКИ при повному успіху (AI відпрацював, не
 * обрізало, не fallback на чернетку). Порядок crash-safe (метадані ДО руйнівних
 * кроків; .layout видаляється ОСТАННІМ — він надмножина .txt і паливо повторної
 * очистки): 1) saveMarkdown → 2) updateDocumentMeta → 3) moveRawTxtToArchive →
 * 4) deleteLayout. При будь-якій проблемі джерела (.txt/.layout) НЕДОТОРКАНІ.
 *
 * DI-шви Drive (fetchLayout/fetchRawText/saveMarkdown/moveRawTxtToArchive/
 * deleteLayout/updateDocumentMeta) — ін'єктує споживач (DP пост-крок / кнопки 3.2
 * через cleanTextDriveAdapter). AI/телеметрія-шви мають реальні дефолти.
 *
 * @returns {Promise<object>}
 *   {ok:true, markdown, attentionNotes, warning, stats}
 *   {ok:false, skipped:true, reason:'not_scanned'}
 *   {ok:false, error:'NO_SOURCE'|'NO_DOCUMENT'}
 *   {ok:false, degraded:true, needsRecleaning:true, warning, markdown, stats}
 */
export async function cleanDocument({
  document,
  caseData = null,
  apiKey,
  module = MODULES.DOCUMENT_PROCESSOR,
  onProgress = noop,
  aiUsageSink = null,
  billAsUserAction = true,
  // Drive DI-шви (ін'єктує споживач):
  fetchLayout,
  fetchRawText,
  saveMarkdown,
  moveRawTxtToArchive,
  deleteLayout,
  updateDocumentMeta,
  // AI / телеметрія DI-шви (дефолти реальні):
  callAI = defaultCallAPIWithRetry,
  resolveModel = defaultResolveModel,
  logAiUsage = defaultLogAiUsage,
  activityTracker = defaultActivityTracker,
} = {}) {
  if (!document || typeof document !== 'object') {
    return { ok: false, error: 'NO_DOCUMENT' };
  }

  // 0. СКОУП-ГАРД — тільки scanned. searchable повністю поза функцією.
  if (document.documentNature !== 'scanned') {
    return { ok: false, skipped: true, reason: 'not_scanned' };
  }

  const fileName = document.name || document.originalName || document.driveId || '';
  const caseId = caseData?.id || null;
  const documentId = document.id || null;

  // 1. Джерело: layout (посторінково, пачкуємо) → інакше сирий .txt (одна пачка).
  onProgress('Готую текст...');
  let layout = null;
  if (typeof fetchLayout === 'function') {
    try { layout = await fetchLayout(document, caseData); } catch { layout = null; }
  }
  const pages = layout ? pagesOf(layout) : [];
  const usedLayout = pages.length > 0;

  let flatDraft = '';
  if (!usedLayout && typeof fetchRawText === 'function') {
    try { const raw = await fetchRawText(document, caseData); if (raw && String(raw).trim()) flatDraft = String(raw); }
    catch { flatDraft = ''; }
  }
  if (!usedLayout && !flatDraft.trim()) {
    return { ok: false, error: 'NO_SOURCE' };
  }

  // Спільний поліш-виклик для пачки/тексту (КРОК 2), з оцінкою max_tokens.
  const polishOne = (draftStr, estTok) => polishToMarkdown({
    draft: draftStr,
    fileName,
    apiKey,
    caseId,
    documentId,
    module,
    maxTokens: maxTokensForEstimate(estTok),
    aiUsageSink,
    callAI,
    resolveModel,
    logAiUsage,
  });

  // Рекурсивна очистка пачки сторінок: при обрізанні (truncated) і >1 сторінки —
  // ділимо пачку навпіл і повторюємо (доки 1 сторінка). КРОК1 конденсатор +
  // КРОК2 поліш. Повертає { markdown, attentionNotes, degraded, warning, aiCalled }.
  async function cleanBatch(batchPages) {
    const draftStr = layoutToMarkdownDraft(batchPages);
    if (!draftStr.trim()) {
      return { markdown: '', attentionNotes: [], degraded: false, warning: null, aiCalled: false, empty: true };
    }
    if (!apiKey) {
      return { markdown: draftStr, attentionNotes: [], degraded: true, warning: 'AI недоступний', aiCalled: false };
    }
    const estTok = batchPages.reduce((s, p) => s + estimatePageTokens(p), 0);
    const r = await polishOne(draftStr, estTok);
    if (r.truncated && batchPages.length > 1) {
      const mid = Math.ceil(batchPages.length / 2);
      const a = await cleanBatch(batchPages.slice(0, mid));
      const b = await cleanBatch(batchPages.slice(mid));
      return {
        markdown: [a.markdown, b.markdown].filter((s) => s && s.trim()).join(PAGE_SEP),
        attentionNotes: [...a.attentionNotes, ...b.attentionNotes],
        degraded: a.degraded || b.degraded,
        warning: a.warning || b.warning,
        aiCalled: true,
      };
    }
    return {
      markdown: r.markdown,
      attentionNotes: r.attentionNotes,
      degraded: !!(r.truncated || r.warning),
      warning: r.warning || (r.truncated ? 'AI обрізав вивід (max_tokens)' : null),
      aiCalled: true,
    };
  }

  // 2. Пачкове очищення.
  onProgress('Очищаю...');
  const parts = [];
  const allNotes = [];
  let degraded = false;
  let warning = null;
  let aiCalledAny = false;

  if (usedLayout) {
    const batches = packPagesIntoBatches(pages);
    let i = 0;
    for (const batch of batches) {
      i += 1;
      onProgress(`Очищаю пачку ${i}/${batches.length}...`);
      const res = await cleanBatch(batch);
      if (res.empty) continue;
      if (res.markdown && res.markdown.trim()) parts.push(res.markdown);
      allNotes.push(...res.attentionNotes);
      if (res.aiCalled) aiCalledAny = true;
      if (res.degraded) { degraded = true; warning = warning || res.warning; }
    }
  } else {
    // Flat .txt fallback (старий скан без layout): одна пачка, без посторінкового
    // halving (нема меж сторінок). Обрізало → degraded (джерела недоторкані).
    if (!apiKey) {
      parts.push(flatDraft); degraded = true; warning = 'AI недоступний';
    } else {
      const r = await polishOne(flatDraft, estimateTokens(flatDraft));
      aiCalledAny = true;
      if (r.markdown && r.markdown.trim()) parts.push(r.markdown);
      allNotes.push(...r.attentionNotes);
      if (r.truncated || r.warning) { degraded = true; warning = r.warning || 'AI обрізав вивід (max_tokens)'; }
    }
  }

  const markdown = parts.join(PAGE_SEP);
  const fullSuccess = !!apiKey && aiCalledAny && !degraded && !!markdown.trim();
  const stats = { usedLayout, pageCount: pages.length, batches: usedLayout ? packPagesIntoBatches(pages).length : 1, degraded, mdChars: markdown.length };

  // 3a. ДЕГРАДОВАНО — джерела (.txt/.layout) НЕДОТОРКАНІ, .md НЕ фіналізуємо.
  if (!fullSuccess) {
    return {
      ok: false,
      degraded: true,
      needsRecleaning: true,
      warning: warning || 'Очистка не завершена — джерела збережено для повтору',
      markdown,
      attentionNotes: allNotes,
      stats,
    };
  }

  // 3b. ПОВНИЙ УСПІХ — долі артефактів у crash-safe порядку.
  //   1) .md → 2) метадані (факт успіху) → 3) .txt у архів → 4) .layout видалити.
  onProgress('Зберігаю...');
  const cleanedAt = new Date().toISOString();
  if (typeof saveMarkdown === 'function') {
    await saveMarkdown(document, caseData, markdown);
  }
  if (typeof updateDocumentMeta === 'function') {
    await updateDocumentMeta(document, caseData, { textFormat: 'md', cleanedAt, attentionNotes: allNotes });
  }
  if (typeof moveRawTxtToArchive === 'function') {
    try { await moveRawTxtToArchive(document, caseData); } catch { /* страховка не критична */ }
  }
  if (usedLayout && typeof deleteLayout === 'function') {
    try { await deleteLayout(document, caseData); } catch { /* паливо відпрацювало */ }
  }

  // C7 — оплачувана ДІЯ адвоката РАЗ на документ (не на пачку), лише при
  // billAsUserAction (кнопки/ACTION). DP пост-крок передає false (автопродовження).
  if (billAsUserAction) {
    try {
      activityTracker.report('agent_call', {
        caseId,
        module,
        category: categoryForCase(caseId),
        metadata: { agentType: TEXT_CLEANER_USAGE_AGENT, operation: 'clean_text', documentId },
      });
    } catch { /* телеметрія не критична */ }
  }

  return {
    ok: true,
    markdown,
    attentionNotes: allNotes,
    warning: null,
    stats,
  };
}
