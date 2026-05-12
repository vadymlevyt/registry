// ── DOCX → PDF ───────────────────────────────────────────────────────────────
// Конвертує DOCX файл у PDF Blob з ЗБЕРЕЖЕННЯМ ФОРМАТУВАННЯ через
// mammoth.convertToHtml + pdfLibHtmlRenderer.
//
// Pipeline:
//   1. Прочитати file як ArrayBuffer
//   2. validateDocxSignature — перші байти ZIP (PK\x03\x04). DOCX — це ZIP.
//      Якщо ні — THROW «не є валідним DOCX».
//   3. Паралельно:
//      - mammoth.convertToHtml({ arrayBuffer }, { styleMap, convertImage })
//        → HTML з заголовками, абзацами, вирівнюванням, жирним/курсивом,
//          таблицями, списками і embed'нутими base64 зображеннями.
//      - mammoth.extractRawText → plain-текст для .txt кеша у 02_ОБРОБЛЕНІ
//        (швидкий пошук, передача в AI агенти, копіювання у клієнтський чат).
//      Запускаємо одночасно бо обидві операції незалежні і йдуть по тому ж
//      ArrayBuffer'у.
//   4. pdfLibHtmlRenderer.htmlToPdfViaPdfLib(html) → PDF Blob з selectable
//      text і збереженим форматуванням.
//   5. Повернути { pdfBlob, extractedText, warnings }
//
// Чому convertToHtml а не extractRawText: extractRawText втрачає ВСЕ
// форматування (тільки текст). convertToHtml зберігає структуру:
// h1-h6, p з вирівнюванням, b/i/u, ul/ol, table, img (як data: URI з base64).
// pdfLibHtmlRenderer розпізнає це і відображає у PDF з відповідним стилем.
//
// Trade-off: підмножина HTML/CSS — складні таблиці у таблицях, плавання,
// складна типографія можуть втратитись частково. ~80-90% точності для
// типових адвокатських документів. Для точного формату оригінал DOCX
// лежить поряд як originalDriveId — можна завантажити з Drive і відкрити у Word.
//
// Feature flag CONVERT_DOCX_TO_PDF керується у converterService.js. Якщо false —
// converterService повертає passthrough і ця функція не викликається.

import { htmlToPdfViaPdfLib } from './pdfLibHtmlRenderer.js';

// Мінімальна довжина значущого тексту. 50 символів — це приблизно одне коротке
// речення. Менше — або порожній шаблон, або документ без текстового вмісту
// (тільки зображення без OCR'а). У таких випадках адвокат має додавати
// файл як зображення, а не як DOCX.
const MIN_TEXT_LENGTH = 50;

// mammoth styleMap — переносить Word paragraph.alignment у HTML class.
// Без цього mammoth втрачає alignment у конвертації (позовна заява з
// text-align: justify рендерилась би як left). Класи розпізнає
// pdfLibHtmlRenderer через styleForElement → align-* мапінг.
const MAMMOTH_STYLE_MAP = [
  "p[alignment='justify'] => p.align-justify:fresh",
  "p[alignment='center']  => p.align-center:fresh",
  "p[alignment='right']   => p.align-right:fresh",
  "p[alignment='left']    => p.align-left:fresh",
  // Перенесення runs з Word: r[bold] / r[italic] mammoth уже мапить у <strong>/<em>
  // за дефолтом, додатково не потрібно.
];

export async function docxToPdf(file, _context = {}) {
  const warnings = [];

  // 1. ArrayBuffer
  const arrayBuffer = await readAsArrayBuffer(file);

  // 2. ZIP-сигнатура. DOCX — це zip-архів з [Content_Types].xml + word/*.xml.
  // Якщо перші 4 байти не PK\x03\x04 — це точно не DOCX (можливо .doc, txt
  // з .docx розширенням, або пошкоджений файл).
  if (!hasDocxSignature(arrayBuffer)) {
    throw new Error('Файл не є валідним DOCX. Можливо це старий .doc формат або файл пошкоджений.');
  }

  // 3. Lazy-load mammoth (browser bundle) і паралельно конвертуємо HTML + raw text.
  const mammothModule = await import('mammoth/mammoth.browser.js');
  const mammoth = mammothModule.default || mammothModule;

  let htmlResult, rawTextResult;
  try {
    // convertImage повертає base64 data URI — pdfLibHtmlRenderer embed'ить
    // зображення у PDF через pdfDoc.embedPng/embedJpg.
    const convertImageOpts = mammoth.images && mammoth.images.imgElement
      ? {
          convertImage: mammoth.images.imgElement((image) =>
            image.read('base64').then((b64) => ({
              src: `data:${image.contentType};base64,${b64}`,
            }))
          ),
        }
      : {};
    [htmlResult, rawTextResult] = await Promise.all([
      mammoth.convertToHtml(
        { arrayBuffer },
        { styleMap: MAMMOTH_STYLE_MAP, ...convertImageOpts }
      ),
      mammoth.extractRawText({ arrayBuffer }),
    ]);
  } catch (e) {
    // Mammoth кидає при пошкодженому ZIP, не-DOCX вмісті, нечитабельних
    // потоках. Не показуємо адвокату технічну ZIP-помилку — даємо чесне
    // повідомлення про файл.
    throw new Error(`Не вдалось прочитати DOCX. Файл може бути пошкоджений: ${e?.message || e}`);
  }

  const html = htmlResult?.value || '';
  const extractedText = (rawTextResult?.value || '').trim();
  const mammothMessages = [
    ...(htmlResult?.messages || []),
    ...(rawTextResult?.messages || []),
  ];

  if (extractedText.length < MIN_TEXT_LENGTH) {
    throw new Error(
      `DOCX не містить тексту (${extractedText.length} символів). Якщо документ — сканований, додайте його як зображення.`
    );
  }

  if (!html) {
    throw new Error('DOCX не вдалось конвертувати у HTML для рендеру (порожній результат mammoth).');
  }

  // mammoth warnings (numbering, unrecognized styles, missing image content
  // types) — переносимо у наш результат щоб caller міг залогувати.
  const seen = new Set();
  for (const msg of mammothMessages) {
    if (msg?.type === 'warning' && msg?.message && !seen.has(msg.message)) {
      seen.add(msg.message);
      warnings.push(`mammoth: ${msg.message}`);
    }
  }

  // 4. PDF generation через pdfLibHtmlRenderer. Завантажує 4 шрифти
  // (Regular, Bold, Italic, BoldItalic) один раз за сесію — потім bytes у
  // in-memory cache.
  let pdfBlob;
  try {
    pdfBlob = await htmlToPdfViaPdfLib(html);
  } catch (e) {
    throw new Error(`Не вдалось згенерувати PDF: ${e?.message || e}`);
  }

  if (!(pdfBlob instanceof Blob) || pdfBlob.size === 0) {
    throw new Error('PDF generation повернула порожній результат');
  }

  return { pdfBlob, extractedText, warnings };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// ZIP local file header signature: 0x50 0x4B 0x03 0x04 ("PK\x03\x04").
// Усі DOCX починаються з цієї сигнатури. Інші ZIP-варіанти (порожній архів
// 0x50 0x4B 0x05 0x06, або spanning 0x50 0x4B 0x07 0x08) для DOCX не зустрічаються.
function hasDocxSignature(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength < 4) return false;
  const view = new Uint8Array(arrayBuffer, 0, 4);
  return view[0] === 0x50 && view[1] === 0x4b && view[2] === 0x03 && view[3] === 0x04;
}

function readAsArrayBuffer(file) {
  if (file instanceof ArrayBuffer) return Promise.resolve(file);
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
