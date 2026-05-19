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

/**
 * Єдина точка вибору тексту для пошуку меж / Triage (вартісна модель §6):
 * структурний паспорт → посторінковий текст → plain. Один сенс — «найкращий
 * наявний text-first сигнал меж для цього артефакту».
 * @param {object|null} layoutJson
 * @param {number|null} expectedPageCount
 * @param {string} plainText — fallback (OCR-текст без структури / resume)
 * @returns {string}
 */
export function resolveBoundaryText(layoutJson, expectedPageCount, plainText) {
  return buildStructuralPassport(layoutJson, expectedPageCount)
    || buildPagedText(layoutJson, expectedPageCount)
    || String(plainText || '');
}
