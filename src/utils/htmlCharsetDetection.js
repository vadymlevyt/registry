// ── HTML CHARSET DETECTION ─────────────────────────────────────────────────
// detectCharset(arrayBuffer, contentType) — повертає charset для TextDecoder.
//
// Алгоритм у порядку пріоритету (кожен наступний крок виконується тільки
// якщо попередній не дав впевненої відповіді):
//
//   1. BOM (Byte Order Mark) — найнадійніше:
//      EF BB BF       → utf-8
//      FE FF          → utf-16be
//      FF FE          → utf-16le
//
//   2. Content-Type header від Drive:
//      "text/html; charset=windows-1251" → windows-1251
//
//   3. <meta charset="..."> або
//      <meta http-equiv="Content-Type" content="text/html; charset=...">
//      Сканується перші ~4 KB як ASCII (ключові слова латиницею).
//
//   4. Fallback: utf-8 (найпоширеніше зараз; для українських старих файлів
//      ЄСІТС адвокат отримає попередження "схоже на windows-1251" якщо текст
//      не декодується — але детекція без heuristic-аналізу частот гарантовано
//      не помиляється на коректних UTF-8 файлах).
//
// Тип повернення: { charset, confidence, source }
//   charset: рядок для new TextDecoder(charset)
//   confidence: 'high' (BOM) | 'medium' (header / meta) | 'low' (fallback)
//   source: 'bom' | 'http-header' | 'meta-charset' | 'meta-http-equiv' | 'default'

const KNOWN_CHARSETS = new Set([
  'utf-8', 'utf-16', 'utf-16be', 'utf-16le',
  'windows-1251', 'windows-1252',
  'iso-8859-1', 'iso-8859-2', 'iso-8859-5',
  'cp1251', 'cp1252', 'koi8-r', 'koi8-u',
]);

function normalizeCharset(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().trim().replace(/['"]/g, '');
  // alias mapping
  if (s === 'cp1251') return 'windows-1251';
  if (s === 'cp1252') return 'windows-1252';
  if (s === 'utf8') return 'utf-8';
  if (KNOWN_CHARSETS.has(s)) return s;
  // Невідомі — повертаємо як є, TextDecoder викине RangeError якщо не підтримує.
  return s;
}

function detectFromBom(arrayBuffer) {
  const view = new Uint8Array(arrayBuffer.slice(0, 4));
  if (view.length >= 3 && view[0] === 0xEF && view[1] === 0xBB && view[2] === 0xBF) {
    return 'utf-8';
  }
  if (view.length >= 2 && view[0] === 0xFE && view[1] === 0xFF) return 'utf-16be';
  if (view.length >= 2 && view[0] === 0xFF && view[1] === 0xFE) return 'utf-16le';
  return null;
}

function detectFromContentType(contentType) {
  if (!contentType) return null;
  const m = /charset\s*=\s*([^;,\s]+)/i.exec(contentType);
  return m ? normalizeCharset(m[1]) : null;
}

function detectFromMetaTag(arrayBuffer) {
  // Перші 4 KB як ASCII — meta-теги завжди в ASCII-діапазоні незалежно від
  // реального charset документа. TextDecoder з 'latin1' дає 1-to-1 мапінг
  // байтів → код-поінтів, безпечно і без помилок на будь-яких послідовностях.
  const head = new Uint8Array(arrayBuffer.slice(0, 4096));
  let headText = '';
  try {
    headText = new TextDecoder('latin1').decode(head);
  } catch (e) {
    return null;
  }

  // Перебираємо meta-теги по одному щоб не сплутати <meta charset=...> з
  // charset, який лежить всередині content="..." у http-equiv формі.
  const metas = headText.matchAll(/<meta\s+([^>]+?)\/?>/gi);
  for (const m of metas) {
    const attrs = m[1];

    // <meta charset="..."> — charset як перший атрибут (HTML5 form).
    const directCharset = /^\s*charset\s*=\s*["']?([^"'>\s/]+)/i.exec(attrs);
    if (directCharset) {
      return { charset: normalizeCharset(directCharset[1]), source: 'meta-charset' };
    }

    // <meta http-equiv="Content-Type" content="text/html; charset=...">
    if (/\bhttp-equiv\s*=\s*["']?content-type/i.test(attrs)) {
      const contentMatch = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(attrs);
      if (contentMatch) {
        const inner = /\bcharset\s*=\s*([^;,\s"']+)/i.exec(contentMatch[1]);
        if (inner) {
          return { charset: normalizeCharset(inner[1]), source: 'meta-http-equiv' };
        }
      }
    }
  }

  return null;
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @param {string} [contentType]
 * @returns {{ charset: string, confidence: 'high'|'medium'|'low', source: string }}
 */
export function detectCharset(arrayBuffer, contentType) {
  const bom = detectFromBom(arrayBuffer);
  if (bom) return { charset: bom, confidence: 'high', source: 'bom' };

  const fromHeader = detectFromContentType(contentType);
  if (fromHeader) return { charset: fromHeader, confidence: 'medium', source: 'http-header' };

  const fromMeta = detectFromMetaTag(arrayBuffer);
  if (fromMeta?.charset) return { charset: fromMeta.charset, confidence: 'medium', source: fromMeta.source };

  return { charset: 'utf-8', confidence: 'low', source: 'default' };
}

// Content-based heuristic: коли detectCharset повернув low/medium confidence
// (немає BOM, або meta-charset бреше — типово для старих ЄСІТС файлів),
// перевіряємо якість декодування і пробуємо windows-1251 як fallback.
//
// Signals що декодування невірне:
//   - багато � (replacement character) — UTF-8 декодер не зміг прочитати байт
//   - багато байтів у range 0x80-0xFF які при utf-8 декоді стають �,
//     але при cp1251 декоді стають кириличними літерами

const REPLACEMENT_RATIO_THRESHOLD = 0.005; // > 0.5% � = підозріло
const MIN_CYRILLIC_AFTER_CP1251 = 30;       // мінімум кириличних літер у перших 4 KB
const SAMPLE_LENGTH = 4000;

function countReplacementChars(text) {
  let count = 0;
  const len = Math.min(text.length, SAMPLE_LENGTH);
  for (let i = 0; i < len; i++) {
    if (text.charCodeAt(i) === 0xFFFD) count++;
  }
  return count;
}

function countCyrillicChars(text) {
  let count = 0;
  const len = Math.min(text.length, SAMPLE_LENGTH);
  for (let i = 0; i < len; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x0400 && code <= 0x04FF) count++;
  }
  return count;
}

// Чи має сенс перевіряти windows-1251 fallback для даної детекції.
// confidence='high' (BOM) — не чіпаємо.
// charset уже = windows-1251 — теж не чіпаємо (вже декодували cp1251).
function shouldTryCp1251Fallback(detection, decodedText) {
  if (detection.confidence === 'high') return false;
  if (detection.charset === 'windows-1251') return false;
  if (!decodedText || decodedText.length === 0) return false;
  const replacements = countReplacementChars(decodedText);
  const sample = Math.min(decodedText.length, SAMPLE_LENGTH);
  const ratio = replacements / sample;
  return ratio > REPLACEMENT_RATIO_THRESHOLD;
}

/**
 * Декодує buffer у текст з виявленим charset. Якщо TextDecoder не підтримує
 * charset — fallback на utf-8 з прапором 'low' confidence.
 *
 * Додатково: якщо первинна детекція дала low/medium confidence І результат
 * декодування містить багато replacement-символів (�) — пробуємо
 * windows-1251 і обираємо той варіант де більше кириличних літер.
 *
 * @param {ArrayBuffer} arrayBuffer
 * @param {string} [contentType]
 * @returns {{ text: string, charset: string, confidence: string, source: string, fallbackUsed: boolean }}
 */
export function decodeHtmlBuffer(arrayBuffer, contentType) {
  const detection = detectCharset(arrayBuffer, contentType);
  let text = '';
  let fallbackUsed = false;
  try {
    text = new TextDecoder(detection.charset, { fatal: false }).decode(arrayBuffer);
  } catch (e) {
    // RangeError: charset не підтримується браузером → fallback utf-8.
    text = new TextDecoder('utf-8').decode(arrayBuffer);
    fallbackUsed = true;
  }

  // Content-based heuristic — пробуємо cp1251 якщо UTF-8 дало багато �.
  if (shouldTryCp1251Fallback(detection, text)) {
    try {
      const cp1251Text = new TextDecoder('windows-1251', { fatal: false }).decode(arrayBuffer);
      const cp1251Cyrillic = countCyrillicChars(cp1251Text);
      const cp1251Replacements = countReplacementChars(cp1251Text);
      // Приймаємо cp1251 якщо: (1) достатньо кирилиці, (2) replacement chars менше або немає.
      if (cp1251Cyrillic >= MIN_CYRILLIC_AFTER_CP1251 && cp1251Replacements < countReplacementChars(text)) {
        return {
          text: cp1251Text,
          charset: 'windows-1251',
          confidence: 'medium',
          source: 'content-heuristic',
          fallbackUsed: true,
        };
      }
    } catch (e) { /* cp1251 не підтримується — лишаємось на utf-8 */ }
  }

  return { text, ...detection, fallbackUsed };
}

/**
 * Готує HTML до вставки у iframe srcdoc.
 *
 * Проблема: після decodeHtmlBuffer (Windows-1251 → UTF-16 JS-string) у тексті
 * лишається старий <meta charset="windows-1251">. Браузер при парсингу srcdoc
 * читає цей meta і пробує повторно інтерпретувати рядок як CP1251 → ромбіки
 * замість літер.
 *
 * Рішення: видалити будь-які старі charset-meta, вставити <meta charset="utf-8">
 * на початок <head>. Опційно — інжектнути <style> для форсу чорного на білому
 * (документ як паперовий, незалежно від теми додатку).
 *
 * Опція wrapPage=true обгортає body content у <div class="html-page"> щоб
 * стилі (з extraStyle) могли намалювати білий аркуш A4 на сірому фоні.
 *
 * @param {string} html — декодований HTML
 * @param {string} [extraStyle] — необов'язковий CSS для <style> блоку
 * @param {{ wrapPage?: boolean }} [options]
 * @returns {string}
 */
export function prepareHtmlForIframe(html, extraStyle, options = {}) {
  if (typeof html !== 'string' || html.length === 0) return html;

  // 1. Видаляємо ВСІ існуючі meta-charset і meta http-equiv Content-Type
  //    щоб не лишити суперечливе оголошення кодування.
  let cleaned = html.replace(
    /<meta\s+(?:[^>]*?\s+)?charset\s*=\s*["']?[^"'>\s/]+["']?[^>]*\/?>/gi,
    ''
  );
  cleaned = cleaned.replace(
    /<meta\s+(?:[^>]*?\s+)?http-equiv\s*=\s*["']?content-type[^>]*\/?>/gi,
    ''
  );

  // 2. Обгортка body у .html-page для page-like layout (білий аркуш на сірому).
  //    Регексп на пара <body>...</body>; вкладене </body> у HTML недопустиме.
  if (options.wrapPage) {
    if (/<body\b[^>]*>[\s\S]*?<\/body>/i.test(cleaned)) {
      cleaned = cleaned.replace(
        /<body([^>]*)>([\s\S]*?)<\/body>/i,
        (m, attrs, content) => `<body${attrs}><div class="html-page">${content}</div></body>`
      );
    } else {
      // body немає — обгортаємо все що є після потенційного <head>.
      // Безпечно і для голого вмісту без <html>/<body>.
      cleaned = cleaned.replace(
        /(<\/head>|^)([\s\S]*)$/i,
        (m, headEnd, rest) => `${headEnd}<div class="html-page">${rest}</div>`
      );
    }
  }

  // 3. Інжекція UTF-8 charset (+ опційно стилі) у <head>.
  const injection =
    '<meta charset="utf-8">' +
    (extraStyle ? `<style>${extraStyle}</style>` : '');

  if (/<head\b[^>]*>/i.test(cleaned)) {
    cleaned = cleaned.replace(/<head\b[^>]*>/i, m => `${m}${injection}`);
  } else if (/<html\b[^>]*>/i.test(cleaned)) {
    cleaned = cleaned.replace(
      /<html\b[^>]*>/i,
      m => `${m}<head>${injection}</head>`
    );
  } else {
    cleaned = `<head>${injection}</head>${cleaned}`;
  }

  return cleaned;
}

/**
 * Витягує meta-теги (key/value) зі старого формату ЄСІТС: HTML де реальний
 * зміст документа — у <meta name="..." content="..."> а не в <body>.
 * Повертає масив пар {name, content} або пустий якщо нічого специфічного нема.
 *
 * Корисно для HtmlRenderer щоб показати дані як таблицю коли body порожній
 * (рядки на кшталт judges, sides, addresses).
 *
 * @param {string} html
 * @returns {Array<{name:string, content:string}>}
 */
export function extractEcitsMetaPairs(html) {
  if (typeof html !== 'string') return [];
  const pairs = [];
  const re = /<meta\s+([^>]+)\/?>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const nameMatch = /name\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const contentMatch = /content\s*=\s*["']([^"']*)["']/i.exec(attrs);
    if (nameMatch && contentMatch) {
      const name = nameMatch[1].trim();
      // Пропускаємо стандартні: viewport, charset, http-equiv, generator, robots.
      if (/^(viewport|charset|generator|robots|description|keywords|author)$/i.test(name)) continue;
      pairs.push({ name, content: contentMatch[1].trim() });
    }
  }
  return pairs;
}
