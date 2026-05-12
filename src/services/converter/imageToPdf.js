// ── IMAGE → PDF ──────────────────────────────────────────────────────────────
// Stub для Коміт 1. Реалізація — у Коміт 3.
//
// План реалізації (Коміт 3):
// 1. Якщо HEIC — pre-convert через heicToJpeg.js
// 2. Завантажити image у Canvas (потрібно для розмірів і orientation correction)
// 3. Коригувати орієнтацію (EXIF або після Document AI у TASK B)
// 4. jsPDF — створити PDF A4 з вставкою зображення.
//    Орієнтація сторінки (portrait/landscape) — за пропорцією зображення.
// 5. Повернути { pdfBlob, warnings }

export async function imageToPdf(/* file, context */) {
  throw new Error('imageToPdf not implemented yet (Коміт 3)');
}
