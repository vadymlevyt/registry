// ── DOCX → PDF ───────────────────────────────────────────────────────────────
// Stub для Коміт 1. Реалізація — у Коміт 4.
//
// Конвертація керується feature flag CONVERT_DOCX_TO_PDF у converterService.js.
// Коли вимкнено — converterService.convertToPdf повертає passthrough,
// тут код не виконується.
//
// План реалізації (Коміт 4):
// 1. Прочитати file як ArrayBuffer
// 2. mammoth.convertToHtml({ arrayBuffer }) → HTML
// 3. Створити тимчасовий контейнер у DOM з HTML і A4 стилями
//    (Times New Roman 12pt, поля 2см/3см/2см/2см)
// 4. html2pdf.js → Blob('application/pdf')
// 5. Cleanup DOM, повернути { pdfBlob, warnings }
//
// Реальний DOCX оригінал зберігається у converterService у originalBlob —
// тут ми лише виробляємо PDF.

export async function docxToPdf(/* file, context */) {
  throw new Error('docxToPdf not implemented yet (Коміт 4)');
}
