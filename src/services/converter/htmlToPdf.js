// ── HTML → PDF ───────────────────────────────────────────────────────────────
// Конвертує HTML файл (від ЄСІТС, з email, з браузера) у PDF Blob.
//
// Pipeline:
//   1. Прочитати file як ArrayBuffer
//   2. detectCharset + decodeHtmlBuffer → UTF-8 рядок (utils/htmlCharsetDetection.js
//      обробляє ЄСІТС-варіант windows-1251 з некоректним meta-charset)
//   3. Створити прихований контейнер у DOM з декодованим HTML і A4 стилями
//   4. html2pdf.js → Blob('application/pdf')
//   5. Cleanup DOM
//
// Контракт результату:
//   { pdfBlob: Blob, warnings: string[] }
//
// Помилки кидаються наверх — converterService повертає їх у виклик AddDocumentModal.

import { decodeHtmlBuffer } from '../../utils/htmlCharsetDetection.js';

// A4 стилі для html2pdf — Times New Roman 12pt, поля 2см/3см/2см/2см
// (стандарт ділового документа). Шрифт fallback на serif для шрифтів які
// браузер не має.
const A4_CSS = `
  font-family: 'Times New Roman', Times, serif;
  font-size: 12pt;
  line-height: 1.4;
  color: #000;
  background: #fff;
  width: 210mm;
  min-height: 297mm;
  padding: 20mm 20mm 20mm 30mm;
  box-sizing: border-box;
`;

// html2pdf-конфіг — однакова для htmlToPdf і docxToPdf.
const HTML2PDF_OPTIONS = {
  margin: 0, // паддінг вже у CSS контейнера
  image: { type: 'jpeg', quality: 0.95 },
  html2canvas: { scale: 2, useCORS: true, logging: false },
  jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
  pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
};

export async function htmlToPdf(file, context = {}) {
  const warnings = [];

  // 1. Прочитати ArrayBuffer
  const arrayBuffer = await readAsArrayBuffer(file);

  // 2. Декодувати HTML з правильним charset (UTF-8 / windows-1251 / cp1251)
  const decoded = decodeHtmlBuffer(arrayBuffer, file?.type || 'text/html');
  if (decoded.charset !== 'utf-8' && decoded.charset !== 'UTF-8') {
    warnings.push(`HTML декодовано як ${decoded.charset}`);
  }

  // 3. Створити контейнер. Прихований через position absolute + opacity 0
  // (display:none ламає html2canvas — він не може зміряти розміри).
  const container = document.createElement('div');
  container.setAttribute('style', `
    position: absolute;
    top: 0;
    left: -10000px;
    opacity: 0;
    pointer-events: none;
    ${A4_CSS}
  `);

  // Витягуємо body content якщо це повний HTML документ — щоб не дублювати
  // CSS і структуру. Якщо це фрагмент — використовуємо як є.
  const bodyMatch = decoded.text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  container.innerHTML = bodyMatch ? bodyMatch[1] : decoded.text;

  document.body.appendChild(container);

  try {
    // 4. html2pdf конвертація. Динамічний імпорт — щоб бандл не тягнув
    // html2pdf при старті аппки, тільки при першій конвертації.
    const html2pdfModule = await import('html2pdf.js');
    const html2pdf = html2pdfModule.default || html2pdfModule;

    const pdfBlob = await html2pdf()
      .from(container)
      .set(HTML2PDF_OPTIONS)
      .outputPdf('blob');

    if (!(pdfBlob instanceof Blob) || pdfBlob.size === 0) {
      throw new Error('html2pdf повернув порожній PDF');
    }

    return { pdfBlob, warnings };
  } finally {
    // 5. Cleanup — завжди видаляємо контейнер, навіть при помилці
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function readAsArrayBuffer(file) {
  // file може бути File, Blob, або ArrayBuffer (у тестах)
  if (file instanceof ArrayBuffer) return Promise.resolve(file);
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
