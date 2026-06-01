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
${String(draft).slice(0, 120000)}`;
}

/**
 * КРОК 2 — AI-поліш. Чернетка → фінальний Markdown + attentionNotes.
 * C7-логування один шлях (logAiUsage завжди при usage; activityTracker лише
 * коли billAsUserAction — окрема оплачувана дія адвоката, parent §C7).
 *
 * @returns {Promise<{markdown, attentionNotes, warning, usage}>}
 *   markdown=draft + warning якщо нема ключа / AI кинув / повернув порожнє.
 */
export async function polishToMarkdown({
  draft,
  fileName = '',
  apiKey,
  caseId = null,
  documentId = null,
  module = MODULES.DOCUMENT_PROCESSOR,
  billAsUserAction = true,
  aiUsageSink = null,
  // DI-шви (дефолти — реальні; тести стабують):
  callAI = defaultCallAPIWithRetry,
  resolveModel = defaultResolveModel,
  logAiUsage = defaultLogAiUsage,
  activityTracker = defaultActivityTracker,
} = {}) {
  const draftStr = String(draft || '');
  if (!apiKey) {
    return { markdown: draftStr, attentionNotes: [], warning: 'AI недоступний — збережено чернетку без поліша', usage: null };
  }
  if (!draftStr.trim()) {
    return { markdown: '', attentionNotes: [], warning: 'Порожня чернетка', usage: null };
  }

  const model = resolveModel(TEXT_CLEANER_AGENT) || FALLBACK_MODEL;
  let res;
  try {
    res = await callAI({
      model,
      max_tokens: 8000,
      messages: [{ role: 'user', content: buildCleanPrompt(draftStr, fileName) }],
    }, { apiKey });
  } catch (err) {
    return {
      markdown: draftStr,
      attentionNotes: [],
      warning: `Очистка не вдалась (${err?.message || err}) — збережено чернетку`,
      usage: null,
    };
  }

  // C7 — токени пишемо завжди коли є usage; activityTracker лише при
  // billAsUserAction (окрема дія адвоката). Один шлях на всіх споживачів.
  const usage = res?.usage || null;
  try {
    logAiUsage({
      agentType: TEXT_CLEANER_USAGE_AGENT,
      model,
      inputTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
      context: { caseId, module, operation: 'clean_text', documentId },
    }, aiUsageSink);
    if (billAsUserAction) {
      activityTracker.report('agent_call', {
        caseId,
        module,
        category: categoryForCase(caseId),
        metadata: { agentType: TEXT_CLEANER_USAGE_AGENT, operation: 'clean_text', documentId },
      });
    }
  } catch { /* телеметрія не критична */ }

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
    return { markdown: parsed.markdown, attentionNotes: notes, warning: null, usage };
  }

  // AI повернув не-JSON або порожнє: якщо є непорожній сирий текст — взяти його
  // (краще ніж нічого), інакше fallback на чернетку.
  if (rawText.trim()) {
    return { markdown: rawText, attentionNotes: [], warning: 'AI повернув не-JSON — збережено як plain', usage };
  }
  return { markdown: draftStr, attentionNotes: [], warning: 'Очистка повернула порожнє — збережено чернетку', usage };
}

// ── КРОК 3 · ОРКЕСТРАЦІЯ (cleanDocument) ────────────────────────────────────

function noop() {}

/**
 * cleanDocument — оркестрація очистки ОДНОГО документа (DI, без React-стану).
 * Скоуп-гард scanned → fetch layout/txt → КРОК1 конденсатор → КРОК2 AI-поліш
 * → долі артефактів (.md створити, .txt → _raw_txt/, .layout.json видалити)
 * → оновити метадані (textFormat:'md', cleanedAt, attentionNotes).
 *
 * DI-шви Drive (fetchLayout/fetchRawText/saveMarkdown/moveRawTxtToArchive/
 * deleteLayout/updateDocumentMeta) — БЕЗ дефолтів: реальне Drive-під'єднання
 * робить споживач (3.2 кнопки). 3.1 покриває оркестрацію тестами через spy.
 * AI/телеметрія-шви мають реальні дефолти.
 *
 * @returns {Promise<object>}
 *   {ok:true, markdown, attentionNotes, warning, stats}
 *   {ok:false, skipped:true, reason:'not_scanned'}
 *   {ok:false, error:'NO_SOURCE'|...}
 */
export async function cleanDocument({
  document,
  caseData = null,
  apiKey,
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

  // 1. Джерело: layout → конденсатор; інакше сирий .txt → плоска чернетка.
  onProgress('Готую текст...');
  let draft = '';
  let usedLayout = false;
  let layout = null;
  if (typeof fetchLayout === 'function') {
    try { layout = await fetchLayout(document, caseData); } catch { layout = null; }
  }
  if (layout && pagesOf(layout).length > 0) {
    draft = layoutToMarkdownDraft(layout);
    usedLayout = true;
  }
  if (!draft.trim() && typeof fetchRawText === 'function') {
    let raw = '';
    try { raw = await fetchRawText(document, caseData); } catch { raw = ''; }
    if (raw && String(raw).trim()) draft = String(raw);
  }
  if (!draft.trim()) {
    return { ok: false, error: 'NO_SOURCE' };
  }

  // 2. AI-поліш (КРОК 2). Нема ключа / AI кинув → markdown=draft + warning.
  onProgress('Очищаю...');
  const polished = await polishToMarkdown({
    draft,
    fileName,
    apiKey,
    caseId: caseData?.id || null,
    documentId: document.id || null,
    billAsUserAction,
    aiUsageSink,
    callAI,
    resolveModel,
    logAiUsage,
    activityTracker,
  });

  const markdown = polished.markdown || draft;
  const attentionNotes = polished.attentionNotes || [];
  const cleanedAt = new Date().toISOString();

  // 3. Долі артефактів (через DI-шви; кожен ізольований).
  onProgress('Зберігаю...');
  if (typeof saveMarkdown === 'function') {
    await saveMarkdown(document, caseData, markdown);
  }
  if (typeof moveRawTxtToArchive === 'function') {
    try { await moveRawTxtToArchive(document, caseData); } catch { /* страховка не критична */ }
  }
  if (usedLayout && typeof deleteLayout === 'function') {
    try { await deleteLayout(document, caseData); } catch { /* паливо відпрацювало */ }
  }
  if (typeof updateDocumentMeta === 'function') {
    await updateDocumentMeta(document, { textFormat: 'md', cleanedAt, attentionNotes });
  }

  return {
    ok: true,
    markdown,
    attentionNotes,
    warning: polished.warning || null,
    stats: { usedLayout, hadApiKey: !!apiKey, draftChars: draft.length, mdChars: markdown.length },
  };
}
