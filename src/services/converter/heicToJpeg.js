// ── HEIC → JPEG ──────────────────────────────────────────────────────────────
// Обгортка над heic2any. HEIC формат використовується iPhone — браузерні
// Canvas API його не вміють декодувати, тому конвертуємо у JPEG перед
// будь-якою подальшою обробкою (imageToPdf, Document AI OCR).
//
// Контракт результату:
//   { jpegFile: File('image/jpeg'), warnings: string[] }
//
// Caller (imageToPdf) перевіряє MIME/розширення перед викликом. heic2any
// падає на не-HEIC файлах.

export async function heicToJpeg(file, context = {}) {
  if (!file) {
    throw new Error('heicToJpeg: file required');
  }

  // Динамічний імпорт — bundle тягне heic2any лише при першій конвертації
  const heic2anyModule = await import('heic2any');
  const heic2any = heic2anyModule.default || heic2anyModule;

  let blob;
  try {
    blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
  } catch (e) {
    // heic2any кидає {code, message} — нормалізуємо до Error
    const msg = e?.message || e?.code || 'HEIC конвертація не вдалася';
    throw new Error(msg);
  }

  // heic2any може повернути масив Blob (для multi-image HEIC) — беремо перший
  const jpegBlob = Array.isArray(blob) ? blob[0] : blob;

  const newName = (file.name || 'image.heic').replace(/\.heic$/i, '.jpg');
  const jpegFile = new File([jpegBlob], newName, { type: 'image/jpeg' });

  return { jpegFile, warnings: [] };
}
