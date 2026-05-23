// ── DOCUMENT PIPELINE · PAGE MARKERS (Ф1 Smart Triage) ──────────────────────
// Чистий примітив: зі збереженого per-page OCR-layout (Document AI вже
// порахував текст кожної сторінки у `_text`) зібрати текст з ЯВНИМИ
// маркерами `=== СТОРІНКА N ===` перед кожною сторінкою.
//
// Навіщо (корінь зламу DP-4, R5/R6): текст межевого детектора йшов як
// `slice(0,50000)` БЕЗ номерів сторінок → AI не мав на що спертись і
// галюцинував startPage/endPage. Маркери дають реальні якорі; повний текст
// (без 50K-обрізки) дає всю справу.
//
// Один сенс: «текст для пошуку меж з посторінковими якорями». НЕ чистий
// readable-текст (той лишається без маркерів, персиститься окремо у
// 02_ОБРОБЛЕНІ). Ф0 (структурний паспорт) РОЗШИРЮЄ цей примітив — додає
// дайджест геометрії/orientation/dimension до того ж посторінкового обходу,
// НЕ переписує його.

// Номер сторінки = позиція у layoutJson.pages (1-based). pages — суцільний
// впорядкований per-page список файла (streamingExecutor concat по chunk'ах
// у порядку сторінок). На resume layout може бути неповним — тоді source
// неповний і викликач має лишитись на plain-тексті (див. isPagedLayout).

/**
 * Чи покриває layoutJson увесь файл посторінково (для маркерів придатний).
 * @param {object|null} layoutJson — { schemaVersion, pages:[{_text,...}] }
 * @param {number|null} [expectedPageCount] — якщо відомий, звіряємо повноту
 * @returns {boolean}
 */
export function isPagedLayout(layoutJson, expectedPageCount = null) {
  const pages = layoutJson && Array.isArray(layoutJson.pages) ? layoutJson.pages : null;
  if (!pages || pages.length === 0) return false;
  if (expectedPageCount != null && pages.length !== expectedPageCount) return false;
  return true;
}

/**
 * Зібрати посторінково-маркований текст файла.
 * @param {object|null} layoutJson — { schemaVersion, pages:[{_text,...}] }
 * @param {number|null} [expectedPageCount]
 * @returns {string} текст з `=== СТОРІНКА N ===` або '' якщо layout непридатний
 */
export function buildPagedText(layoutJson, expectedPageCount = null) {
  if (!isPagedLayout(layoutJson, expectedPageCount)) return '';
  return layoutJson.pages
    .map((page, i) => `=== СТОРІНКА ${i + 1} ===\n${(page && page._text) || ''}`)
    .join('\n\n');
}

// ── Ф0 · СТРУКТУРНИЙ ПАСПОРТ ────────────────────────────────────────────────
// Розширює примітив вище: до кожного маркера додає КОМПАКТНИЙ дайджест
// структури сторінки зі збереженого Document AI `pageStructure` (нуль
// image-токенів — вартісна модель §6). Сигнали меж документів (consultation
// §4): заголовок (короткий центрований перший блок), футер з номером
// (скидання нумерації = новий документ), orientation, dimension (фото vs
// A4-скан), наявність tables/formFields. Передаються Клоду як text-блок.
//
// Чистий модуль: без Drive/AI/React. Усі поля Document AI — зовнішні дані,
// читаємо захищено (форма сторінки варіюється; відсутні поля → сигнал
// просто не додається, паспорт не падає).

import { extractPageOrientation } from '../sortation/orientationCorrector.js';

// Перша/остання непорожні лінії _text — кандидати заголовка/футера.
function firstLine(text) {
  for (const ln of String(text || '').split('\n')) {
    const t = ln.trim();
    if (t) return t;
  }
  return '';
}
function lastLine(text) {
  const lines = String(text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t) return t;
  }
  return '';
}

// Геометрія блоку: vertical bounds + горизонтальний центр/ширина з
// boundingPoly.normalizedVertices (0..1). null якщо геометрії нема.
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
// page.paragraphs — беремо що є).
function orderedBlocks(page) {
  const raw = Array.isArray(page?.blocks) && page.blocks.length
    ? page.blocks
    : (Array.isArray(page?.paragraphs) ? page.paragraphs : []);
  return raw
    .map((b) => ({ b, box: blockBox(b) }))
    .filter((x) => x.box)
    .sort((a, b) => a.box.top - b.box.top);
}

// Короткий центрований блок зверху сторінки = ймовірний заголовок (початок
// нового документа). Текст беремо з першої лінії _text (offset-математика
// по чанках ненадійна — _text вже посторінковий).
function headingSignal(page) {
  const blocks = orderedBlocks(page);
  if (blocks.length === 0) return null;
  const top = blocks[0].box;
  const centered = top.cx > 0.30 && top.cx < 0.70 && top.w < 0.75 && top.top < 0.30;
  if (!centered) return null;
  const t = firstLine(page._text);
  if (!t || t.length > 90) return null;
  return t;
}

// Останній рядок як футер; повертаємо «надрукований» номер сторінки якщо
// рядок короткий і це переважно число (для детекту скидання нумерації).
function footerNumber(page) {
  const t = lastLine(page._text);
  if (!t || t.length > 24) return null;
  const m = t.match(/(?:^|\s|-|№|стор\.?|page)\s*(\d{1,4})\s*$/i) || t.match(/^\s*(\d{1,4})\s*$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

// Класифікація формату за dimension (width/height). A4-портрет ≈ 0.71.
function formatTag(page) {
  const d = page?.dimension;
  const w = Number(d?.width), h = Number(d?.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  const r = +(w / h).toFixed(2);
  if (r < 0.85) return `формат:портрет(${r})`;     // A4-скан/портрет
  if (r > 1.18) return `формат:альбом(${r})`;
  return `формат:квадрат(${r})`;                    // часто фото
}

// Дайджест однієї сторінки. prevFooter — попередній надрукований номер для
// детекту скидання нумерації (сильний сигнал межі документа).
function pageDigest(page, prevFooter) {
  const tags = [];
  const ori = extractPageOrientation(page);
  if (ori) tags.push(`орієнтація:${ori}°`);
  const fmt = formatTag(page);
  if (fmt) tags.push(fmt);
  if (Array.isArray(page?.tables) && page.tables.length) tags.push('таблиці');
  if (Array.isArray(page?.formFields) && page.formFields.length) tags.push('поля-форми');
  const heading = headingSignal(page);
  if (heading) tags.push(`заголовок:"${heading}"`);
  const fnum = footerNumber(page);
  if (fnum != null) {
    tags.push(`футер-№:${fnum}`);
    if (prevFooter != null && fnum <= prevFooter) tags.push('СКИДАННЯ-НУМЕРАЦІЇ');
  }
  return { line: tags.length ? `[${tags.join(' | ')}]` : '', footer: fnum };
}

/**
 * Зібрати посторінковий СТРУКТУРНИЙ ПАСПОРТ файла: маркер + дайджест
 * структури + текст сторінки. Той самий контракт що buildPagedText
 * (порожнє → caller лишається на plain тексті).
 * @param {object|null} layoutJson — { schemaVersion, pages:[pageStructure] }
 * @param {number|null} [expectedPageCount]
 * @returns {string}
 */
export function buildStructuralPassport(layoutJson, expectedPageCount = null) {
  if (!isPagedLayout(layoutJson, expectedPageCount)) return '';
  let prevFooter = null;
  return layoutJson.pages
    .map((page, i) => {
      const { line, footer } = pageDigest(page || {}, prevFooter);
      if (footer != null) prevFooter = footer;
      const head = `=== СТОРІНКА ${i + 1} ===${line ? `\n${line}` : ''}`;
      return `${head}\n${(page && page._text) || ''}`;
    })
    .join('\n\n');
}

// ── ФД-0 · КОМПАКТНИЙ ПАСПОРТ МЕЖ (для Triage на томах 200-250 стор.) ────────
// buildCompactTriagePassport — паспорт МЕЖ для Triage: на сторінку лише
// сукупність дорадчих сигналів (дайджест структури + краї тексту), які AI
// зважує РАЗОМ. Жоден сигнал не вирішує сам, жоден не жорстке правило.
// НЕ повний readable-текст (той — окремий потік, 02_ОБРОБЛЕНІ).
// Один сенс: «мінімальна достатня сукупність сигналів меж для AI».
//
// Чому окрема функція, а не прапор `compact` на buildStructuralPassport:
// це був би другий сенс на одне ім'я (баг-патерн skipCache, філософія
// «Однозначність»). buildStructuralPassport / buildPagedText / isPagedLayout
// / pageDigest — недоторкані (їх контракт може споживати щось інше; філософія
// «додати, не переписати»). Збагачений дайджест — окремий compactDigest.
//
// Корінь (спека §0): попередній паспорт вкладав ПОВНИЙ _text кожної сторінки
// → на 200-250 стор. промпт Triage переповнював вікно Haiku → тихий
// passthrough (уся справа одним нерізаним документом). Краї тексту замість
// тіла + дайджест сигналів ≈ ~200-280 ток/стор. (проти ~1000-2000).

const QUALITY_JUMP = 0.25;   // |Δ qualityScore| ≥ → ймовірна зміна джерела/документа (стартова точка)
const SPARSE_BLOCKS = 2;     // ≤ стільки текстових блоків — кандидат «розрідженої» сторінки
const SPARSE_CHARS = 200;    // … і ≤ стільки символів _text → «розріджена» (обкладинка/квитанція/штамп)
const TABLE_COVERAGE_DOMINANT = 0.40;  // ФД-D2 §4.2: ≥40% площі під таблицями → кандидат сторінки-реєстру

// ФД-D2 §4.3 — якорі-заголовки української юридичної практики. Підсилюють
// наявний headingSignal(), коли заголовок зверху містить типове слово
// судового документа. Шорт-список покриває ~85% типів; редагується як
// звичайна константа без зміни схеми (це не enum SCHEMA). Один сенс:
// «слова, які майже гарантовано вказують на початок нового документа».
const UA_DOC_HEADERS = [
  'ПОСТАНОВА',
  'УХВАЛА',
  'РІШЕННЯ',
  'ВИРОК',
  'ВИСНОВОК',
  'ПРОТОКОЛ',
  'АКТ',
  'ЗАЯВА',
  'ПОЗОВНА',
  'ДОВІДКА',
  'СВІДОЦТВО',
  'ДЕКЛАРАЦІЯ',
  'ДОГОВІР',
  'ОРДЕР',
  'КЛОПОТАННЯ',
  'СКАРГА',
  'ВИМОГА',
  'ПОВІДОМЛЕННЯ',
  'ВИТЯГ',
  'ЛИСТ',
];

// Налаштовуваний ручник (спека §3.2; дефолти — стартові точки, не остаточні).
const COMPACT_DEFAULTS = Object.freeze({
  headLines: 3,               // перших непорожніх рядків сторінки
  tailLines: 2,               // останніх непорожніх рядків
  headChars: 400,             // cap на head-фрагмент
  tailChars: 200,             // cap на tail-фрагмент
  fullTextIfNoSignal: true,   // дайджест порожній І сторінка коротка → повний _text (вузький fallback)
  ambiguousMaxChars: 1200,    // межа «короткої» для fallback вище
});

// Document AI imageQualityScores.qualityScore ∈ [0,1] (вище = чіткіше скан).
function qualityScore(page) {
  const q = Number(page?.imageQualityScores?.qualityScore);
  return Number.isFinite(q) ? q : null;
}

// ФД-D2 §4.2 — сумарна частка площі сторінки під таблицями. Document AI
// дає `page.tables[].layout.boundingPoly.normalizedVertices` (∈[0,1]).
// Один сенс: «частка площі сторінки, що зайнята таблицями, ∈[0,1]». ≥40% →
// сильний індикатор сторінки-реєстру/змісту (підсилює ToC детектор).
function tableCoverage(page) {
  const tables = Array.isArray(page?.tables) ? page.tables : [];
  if (tables.length === 0) return 0;
  let total = 0;
  for (const t of tables) {
    const v = t?.layout?.boundingPoly?.normalizedVertices;
    if (!Array.isArray(v) || v.length < 4) continue;
    const xs = v.map((p) => Number(p?.x) || 0);
    const ys = v.map((p) => Number(p?.y) || 0);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    total += Math.max(0, Math.min(1, w * h));
  }
  return Math.min(1, total);  // capped [0..1] — таблиці можуть перекриватись
}

// ФД-D2 §4.4 — внутрішня нумерація документа («стор. 1 з 9», «1/9»,
// «Page 1 of 9», «-1-»). Окремо від нумерації аркушів тома (footerNumber).
// Один сенс: «детект внутрішньої посилкової нумерації конкретного документа;
// current=1 → ПОЧАТОК-ДОКУМЕНТА, current==total → КІНЕЦЬ-ДОКУМЕНТА».
function detectDocumentPageNumber(page) {
  const last = lastLine(page?._text);
  if (!last) return null;
  const m =
    last.match(/(\d+)\s*[з\/]\s*(\d+)/i) ||
    last.match(/page\s+(\d+)\s+of\s+(\d+)/i) ||
    last.match(/^[-—]\s*(\d+)\s*[-—]\s*$/);
  if (!m) return null;
  const current = Number(m[1]);
  if (!Number.isFinite(current) || current < 1) return null;
  const total = m[2] ? Number(m[2]) : null;
  return { current, total: Number.isFinite(total) ? total : null };
}

// ФД-D2.5 §4.6 — стрибок дефектів сканування. Document AI повертає
// imageQualityScores.detectedDefects[] з типами `quality/defect_*`. Зміна
// НАБОРУ defects між сусідніми сторінками сильніша за один лиш qualityScore
// delta (нова сесія сканування — інша камера, інше освітлення, інші типи
// дефектів). Один сенс: «детект зміни умов сканування за набором дефектів
// між сторінками».
function detectDefectsSet(page) {
  const defects = page?.imageQualityScores?.detectedDefects;
  if (!Array.isArray(defects)) return null;
  const types = defects.map((d) => d?.type).filter(Boolean);
  return new Set(types);
}

function defectsChanged(prevSet, curSet) {
  if (!prevSet || !curSet) return false;
  if (prevSet.size !== curSet.size) return true;
  for (const t of curSet) if (!prevSet.has(t)) return true;
  return false;
}

// ФД-D2.5 §4.7 — середня OCR-впевненість paragraphs на сторінці. Document
// AI дає Layout.confidence на КОЖНОМУ paragraph. Беремо середнє як проксі
// «надійності тексту». Один сенс: «середня впевненість OCR абзаців на
// сторінці; <0.7 → попередження Triage не довіряти тонким сигналам».
// НЕ сигнал межі — мета-попередження («не створюй короткий документ через
// слабкі сигнали на цій сторінці — це може бути шум OCR»).
function avgParagraphConfidence(page) {
  const ps = Array.isArray(page?.paragraphs) ? page.paragraphs : [];
  if (ps.length === 0) return null;
  const confs = ps.map((p) => Number(p?.layout?.confidence)).filter(Number.isFinite);
  if (confs.length === 0) return null;
  return confs.reduce((a, b) => a + b, 0) / confs.length;
}

const OCR_LOW_THRESHOLD = 0.70;  // нижче — попередження «текст ненадійний» (стартова точка)

// Перша визначена мова сторінки (Document AI detectedLanguages — впорядковані
// за confidence; беремо першу). Слабкий сигнал зміни документа.
function primaryLanguage(page) {
  const dl = page?.detectedLanguages;
  if (Array.isArray(dl) && dl.length) {
    const code = dl[0]?.languageCode;
    return code ? String(code) : null;
  }
  return null;
}

// Дайджест компактного паспорта = сукупність ДОРАДЧИХ сигналів межі (§3.2).
// Жоден сигнал не детермінований гейт — їх зважує AI РАЗОМ. prev — носій
// крос-сторінкового стану (попередній футер/якість/формат/орієнтація/мова)
// для дельта-сигналів. Усі поля Document AI — зовнішні, читаємо захищено
// (відсутність поля = сигнал просто не додається, паспорт не падає).
function compactDigest(page, prev) {
  const tags = [];
  // — наявні сигнали (ті самі чисті хелпери що й структурний паспорт; БЕЗ
  //   мутації спільного pageDigest — buildStructuralPassport недоторканий) —
  const ori = extractPageOrientation(page);
  if (ori) tags.push(`орієнтація:${ori}°`);
  const fmt = formatTag(page);
  if (fmt) tags.push(fmt);
  if (Array.isArray(page?.tables) && page.tables.length) tags.push('таблиці');
  if (Array.isArray(page?.formFields) && page.formFields.length) tags.push('поля-форми');
  const heading = headingSignal(page);
  if (heading) {
    tags.push(`заголовок:"${heading}"`);
    // ФД-D2 §4.3: заголовок зі списку юр. документів → СИЛЬНИЙ сигнал
    // нового документа. Поверх дорадчого `заголовок:"..."`. Перевірка
    // підрядкова (case-insensitive): «Постанова про...», «Позовна заява»,
    // «ВИМОГА слідчого» — усі ловляться через UA_DOC_HEADERS.
    const upper = heading.toUpperCase();
    if (UA_DOC_HEADERS.some((kw) => upper.includes(kw))) {
      tags.push('ЯКІР-ДОКУМЕНТА');
    }
  }
  const fnum = footerNumber(page);
  if (fnum != null) {
    tags.push(`футер-№:${fnum}`);
    if (prev.footer != null && fnum <= prev.footer) tags.push('СКИДАННЯ-НУМЕРАЦІЇ');
  }
  // — нові дорадчі сигнали меж (ФД-0) —
  const ve = Array.isArray(page?.visualElements) ? page.visualElements : [];
  if (ve.length) {
    const types = [...new Set(ve.map((v) => v && v.type).filter(Boolean))];
    tags.push(`печатка/підпис${types.length ? `:${types.join(',')}` : ''}`);
  }
  const q = qualityScore(page);
  if (q != null && prev.quality != null && Math.abs(q - prev.quality) >= QUALITY_JUMP) {
    tags.push(`стрибок-якості:Δ${Math.abs(q - prev.quality).toFixed(2)}`);
  }
  const blocks = orderedBlocks(page).length;
  const textLen = String(page?._text || '').trim().length;
  if (blocks <= SPARSE_BLOCKS && textLen <= SPARSE_CHARS) tags.push('розріджена');
  if (prev.format != null && fmt != null && fmt !== prev.format) tags.push('зміна-формату');
  if (prev.orientation != null && ori !== prev.orientation) tags.push('зміна-орієнтації');
  const lang = primaryLanguage(page);
  if (lang && prev.lang && lang !== prev.lang) tags.push(`зміна-мови:${prev.lang}→${lang}`);

  // ФД-D2 §4.2 — table-coverage. Сильний сигнал «ця сторінка переважно
  // таблиця» (≥40% площі) → кандидат сторінки-реєстру для ToC детектора.
  const tc = tableCoverage(page);
  if (tc >= TABLE_COVERAGE_DOMINANT) {
    tags.push(`таблиця-домінює:${Math.round(tc * 100)}%`);
  }

  // ФД-D2 §4.4 — внутрішня нумерація документа. ПОЧАТОК/КІНЕЦЬ — СИЛЬНІ
  // сигнали меж (один з достатніх для висновку про межу). «док-стор:N/M» —
  // також передає реальну довжину поточного документа (підказує Triage'у
  // де очікувати наступну межу).
  const dn = detectDocumentPageNumber(page);
  if (dn) {
    tags.push(`док-стор:${dn.current}${dn.total != null ? `/${dn.total}` : ''}`);
    if (dn.current === 1) tags.push('ПОЧАТОК-ДОКУМЕНТА');
    if (dn.total != null && dn.current === dn.total) tags.push('КІНЕЦЬ-ДОКУМЕНТА');
  }

  // ФД-D2.5 §4.6 — зміна набору defects vs попередня сторінка. Сильніше за
  // самотній qualityScore-delta (нова камера/освітлення = інші типи defects).
  const defects = detectDefectsSet(page);
  if (defectsChanged(prev.defects, defects)) tags.push('дефекти-зміна');

  // ФД-D2.5 §4.7 — мета-попередження «текст ненадійний». НЕ сигнал межі.
  const conf = avgParagraphConfidence(page);
  if (conf != null && conf < OCR_LOW_THRESHOLD) {
    tags.push(`OCR-низька:${conf.toFixed(2)}`);
  }

  return {
    line: tags.length ? `[${tags.join(' | ')}]` : '',
    next: {
      footer: fnum != null ? fnum : prev.footer,
      quality: q != null ? q : prev.quality,
      format: fmt != null ? fmt : prev.format,
      orientation: ori || prev.orientation,
      lang: lang || prev.lang,
      // Набір defects попередньої сторінки — для дельта-сигналу
      // «дефекти-зміна» на наступному кроці.
      defects: defects || prev.defects,
    },
  };
}

// Краї тексту сторінки: перші headLines / останні tailLines непорожніх
// рядків, кожен край обрізаний по headChars/tailChars. Тіло між ними —
// викинуте (Triage шукає МЕЖІ, не читає зміст; повний текст — окремий потік
// 02_ОБРОБЛЕНІ). Якщо рядків мало (вкладаються у head+tail) — віддаємо їх
// суцільно без розриву (дублювати край безглуздо).
function edgeText(text, o) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return '';
  if (lines.length <= o.headLines + o.tailLines) {
    return lines.join('\n').slice(0, o.headChars + o.tailChars);
  }
  const head = lines.slice(0, o.headLines).join('\n').slice(0, o.headChars);
  const tail = lines.slice(-o.tailLines).join('\n').slice(-o.tailChars);
  return `${head}\n⟨…⟩\n${tail}`;
}

/**
 * Зібрати КОМПАКТНИЙ паспорт меж для Triage (спека §3). Той самий контракт
 * порожнечі що buildPagedText/buildStructuralPassport (непридатний layout →
 * "" → caller лишається на plain тексті). Чиста функція: без Drive/AI/React,
 * без спільного мутабельного стану між викликами (ідемпотентна).
 * @param {object|null} layoutJson — { schemaVersion, pages:[pageStructure] }
 * @param {number|null} [expectedPageCount]
 * @param {object} [opts] — перевизначення COMPACT_DEFAULTS (§3.2)
 * @returns {string}
 */
export function buildCompactTriagePassport(layoutJson, expectedPageCount = null, opts = {}) {
  if (!isPagedLayout(layoutJson, expectedPageCount)) return '';
  const o = { ...COMPACT_DEFAULTS, ...(opts || {}) };
  let prev = { footer: null, quality: null, format: null, orientation: null, lang: null, defects: null };
  return layoutJson.pages
    .map((page, i) => {
      const p = page || {};
      const { line, next } = compactDigest(p, prev);
      prev = next;
      const text = String(p._text || '');
      let body;
      if (!line && o.fullTextIfNoSignal && text.trim().length <= o.ambiguousMaxChars) {
        // Вузький fallback: ані сигналу, ані довгого тексту — не ризикуємо
        // втратити коротку неоднозначну сторінку, віддаємо її повністю.
        body = text.trim();
      } else {
        body = edgeText(text, o);
      }
      const headLine = `=== СТОРІНКА ${i + 1} ===${line ? `\n${line}` : ''}`;
      return body ? `${headLine}\n${body}` : headLine;
    })
    .join('\n\n');
}

/**
 * Єдина точка вибору тексту для пошуку меж / Triage (вартісна модель §6 +
 * масштаб §3.3): КОМПАКТНИЙ паспорт меж → посторінковий текст → plain. Один
 * сенс — «найкращий наявний text-first сигнал меж для цього артефакту».
 *
 * ФД-1: buildStructuralPassport ПРИБРАНО з цього ланцюга (вкладав повний
 * _text кожної сторінки → переповнення вікна Haiku на 200-250 стор. →
 * тихий passthrough, спека §0). Лишається експортованою і недоторканою
 * (grep підтвердив: жодного іншого live-споживача — detectBoundariesV3 не
 * ін'єктується Provider'ом, у слоті DETECT_BOUNDARIES — createTriageStage).
 *
 * ФД-1.1 (валідація адвокатом на Брановському): чисто компактний паспорт
 * втрачав ТІЛО тексту, з якого AI дискримінує межі за змістом фраз. На
 * малому томі це збіднення зайве — вікно Haiku вистачає. Тому щільність
 * адаптивна за обсягом: ≤RICH_PASSPORT_MAX_PAGES стор. → rich profile
 * (head/tail у рази більші, фактично повне тіло короткої OCR-сторінки);
 * вище → стартовий мінімум (краї, не переповнюючи 250-стор. тома).
 * Брановський (65 стор.) повертається до старої точності, 200-250 стор.
 * лишаються в зоні якості.
 * @param {object|null} layoutJson
 * @param {number|null} expectedPageCount
 * @param {string} plainText — fallback (OCR-текст без структури / resume)
 * @returns {string}
 */
export function resolveBoundaryText(layoutJson, expectedPageCount, plainText) {
  const pages = (layoutJson && Array.isArray(layoutJson.pages) ? layoutJson.pages.length : 0)
    || expectedPageCount || 0;
  return buildCompactTriagePassport(layoutJson, expectedPageCount, passportOptsForBudget(pages))
    || buildPagedText(layoutJson, expectedPageCount)
    || String(plainText || '');
}

// Один сенс: «обрати щільність паспорта залежно від обсягу — більше тексту
// коли є бюджет вікна (малий том), стартовий мінімум коли загроза переповнення
// (великий том)». Цифра 100 — стартова точка, обґрунтована: реалістична OCR-
// сторінка ~1500-2500 симв., 100 стор. × 2500 ≈ ~125K токенів (зона якості
// Haiku ≤~150K, при 200K-вікні). Вище — стартовий мінімум обов'язковий.
const RICH_PASSPORT_MAX_PAGES = 100;
const RICH_PASSPORT_OPTS = Object.freeze({
  headLines: 10, tailLines: 10,
  headChars: 1500, tailChars: 1500,
  fullTextIfNoSignal: true, ambiguousMaxChars: 1200,
});
function passportOptsForBudget(pageCount) {
  return pageCount > 0 && pageCount <= RICH_PASSPORT_MAX_PAGES ? RICH_PASSPORT_OPTS : {};
}
