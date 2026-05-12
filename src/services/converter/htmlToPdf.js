// ── HTML → PDF ───────────────────────────────────────────────────────────────
// Stub для Коміт 1. Реалізація — у Коміт 2.
//
// План реалізації (Коміт 2):
// 1. Прочитати file як ArrayBuffer
// 2. detectCharset + decodeHtmlBuffer з utils/htmlCharsetDetection.js → UTF-8 рядок
// 3. Створити тимчасовий контейнер у DOM з декодованим HTML і A4 стилями
//    (Times New Roman 12pt, поля 2см/3см/2см/2см)
// 4. html2pdf.js → Blob('application/pdf')
// 5. Cleanup DOM, повернути { pdfBlob, warnings }

export async function htmlToPdf(/* file, context */) {
  throw new Error('htmlToPdf not implemented yet (Коміт 2)');
}
