// ── HEIC → JPEG ──────────────────────────────────────────────────────────────
// Stub для Коміт 1. Реалізація — у Коміт 3.
//
// План реалізації (Коміт 3):
// 1. heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 }) → Blob
// 2. Обгорнути в File з оригінальним іменем (зміна розширення на .jpg)
// 3. Повернути { jpegFile, warnings }
//
// heic2any падає на не-HEIC файлах — caller (imageToPdf) перевіряє MIME
// або розширення перед викликом.

export async function heicToJpeg(/* file, context */) {
  throw new Error('heicToJpeg not implemented yet (Коміт 3)');
}
