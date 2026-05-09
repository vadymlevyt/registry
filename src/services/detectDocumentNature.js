// detectDocumentNature — визначає природу документа (scanned/searchable).
//
// Канонічна схема (TASK 1.5) має поле documentNature, але legacy-документи
// створені до v5 його не мають. Без нього Viewer падає в text-режим за
// замовчуванням і показує empty state навіть для PDF які можна спокійно
// показати через Drive iframe.
//
// Цей хелпер дає швидкий синхронний виклик за іменем/MIME (інстант — для UI),
// плюс асинхронний "deep" вибір через pdfjs (читає першу сторінку PDF і
// дивиться на щільність тексту) для випадків коли по імені не зрозуміло.
//
// Використання:
//   const nature = inferNatureFromFile(doc);   // 'scanned' | 'searchable' | null
//   if (!nature) {
//     const deep = await detectNatureFromPdf(blob);
//     // оновити документ через update_document({ documentNature: deep })
//   }

const SCANNED_EXT = ['png', 'jpg', 'jpeg', 'heic', 'heif', 'tif', 'tiff', 'bmp', 'webp'];
const SEARCHABLE_EXT = ['docx', 'doc', 'odt', 'rtf', 'md', 'txt', 'html', 'htm', 'xhtml'];

function getExtension(name) {
  if (!name) return '';
  const m = /\.([^.]+)$/.exec(String(name).toLowerCase());
  return m ? m[1] : '';
}

/**
 * Швидке визначення природи документа за відомими атрибутами.
 *
 * @param {object} doc — об'єкт документа з полями mimeType, name, originalName
 * @returns {'scanned'|'searchable'|null} null якщо потрібна додаткова перевірка
 */
export function inferNatureFromFile(doc) {
  if (!doc) return null;
  if (doc.documentNature === 'scanned' || doc.documentNature === 'searchable') {
    return doc.documentNature;
  }

  const mime = (doc.mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'scanned';
  if (
    mime === 'text/plain' ||
    mime === 'text/markdown' ||
    mime === 'text/html' ||
    mime === 'application/xhtml+xml' ||
    mime === 'application/vnd.google-apps.document' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/msword' ||
    mime === 'application/rtf'
  ) {
    return 'searchable';
  }

  const ext = getExtension(doc.originalName) || getExtension(doc.name);
  if (ext) {
    if (SCANNED_EXT.includes(ext)) return 'scanned';
    if (SEARCHABLE_EXT.includes(ext)) return 'searchable';
    if (ext === 'pdf') {
      // PDF — без deep-сигналу не визначити. UI поки що рендерить як scan
      // (через Drive iframe), а deep-перевірку запускаємо паралельно.
      return null;
    }
  }
  return null;
}

/**
 * Природа за замовчуванням для UI коли точно невідомо.
 * Для PDF — scanned (бо Drive iframe однаково показує і це безпечно).
 * Для всього іншого — text (бо нема як перетворити в зображення).
 */
export function defaultNatureForUI(doc) {
  const inferred = inferNatureFromFile(doc);
  if (inferred) return inferred;

  const mime = (doc?.mimeType || '').toLowerCase();
  const name = (doc?.originalName || doc?.name || '').toLowerCase();
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'scanned';
  return 'searchable';
}

/**
 * Глибока перевірка PDF через pdfjs — читає першу сторінку, дивиться на
 * щільність тексту. Менше 50 символів сирого тексту → 'scanned'.
 *
 * Викликається фасадом detectDocumentNature коли inferNatureFromFile повернув
 * null. Помилки тихо повертають null — UI просто залишає те що видно зараз.
 *
 * @param {Blob} blob — pdf-файл
 * @returns {Promise<'scanned'|'searchable'|null>}
 */
export async function detectNatureFromPdf(blob) {
  if (!blob) return null;
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = await blob.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const text = (content.items || [])
      .map((item) => (typeof item.str === 'string' ? item.str : ''))
      .join('')
      .replace(/\s+/g, '')
      .trim();
    if (text.length < 50) return 'scanned';
    return 'searchable';
  } catch (err) {
    console.warn('[detectDocumentNature] pdf check failed:', err?.message || err);
    return null;
  }
}

/**
 * Високорівневий фасад: повертає природу для документа.
 * Спочатку швидка перевірка, далі (опційно) deep-перевірка через pdfjs.
 *
 * Для UI без I/O використовуйте defaultNatureForUI — він синхронний.
 */
export async function detectDocumentNature(doc, blobLoader) {
  const inferred = inferNatureFromFile(doc);
  if (inferred) return inferred;

  if (typeof blobLoader === 'function') {
    try {
      const blob = await blobLoader();
      const deep = await detectNatureFromPdf(blob);
      if (deep) return deep;
    } catch (err) {
      console.warn('[detectDocumentNature] blob load failed:', err?.message || err);
    }
  }
  return defaultNatureForUI(doc);
}
