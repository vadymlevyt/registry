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

/**
 * Декодує buffer у текст з виявленим charset. Якщо TextDecoder не підтримує
 * charset — fallback на utf-8 з прапором 'low' confidence.
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
  return { text, ...detection, fallbackUsed };
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
