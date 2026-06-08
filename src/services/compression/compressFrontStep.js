// ── TASK 4 (rework) · ФРОНТ-КРОК СТИСНЕННЯ ──────────────────────────────────
// Стиснення живе ОКРЕМО — не вшите ні в нарізку, ні в «просто додати». Це
// ПЕРШИЙ крок: стискає ті файли, що можуть стиснутися, і нічого сам не
// запускає. Коли файли стиснулись — консюмер тригерить обраний сценарій
// (addFiles або нарізку) уже на стиснених файлах (§1.3 handoff).
//
// Рушій — спільний `imageCompressor` (перенесений байт-у-байт зі стенда
// public/lab/pdf-recompress.html, фіксований Середній пресет). Той самий
// рушій тягне і нарізка, і додавання, і модалка, і майбутня вкладка
// «Інструменти» (§7.4). Тут — лише тонка обгортка «один файл → стиснути якщо це
// сканований PDF».
//
// Скоуп: PDF (рушій сам має scanned-guard — searchable PDF проходить як є).
// Не-PDF (DOCX/HTML/зображення ДО конвертації) повертаються незмінними —
// конвертація у PDF робиться далі в addFiles. Best-effort: будь-який збій
// стиснення → оригінал (документ усе одно має додатись, правило resilience).
//
// «Одне торкання»: читаємо байти файлу РАЗ (arrayBuffer), стискаємо в памʼяті,
// віддаємо новий File — без проміжних записів/читань з Drive.

import { compressPdfBuffer, DEFAULT_COMPRESSION_PRESET } from './imageCompressor.js';

// maybeCompressFileForAdd — стиснути ОДИН файл перед додаванням, якщо це PDF.
//   file → File (стиснений PDF) | оригінал (не-PDF / збій / рушій пропустив).
export async function maybeCompressFileForAdd(file, opts = {}) {
  try {
    const isPdf = file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '');
    if (!isPdf || typeof file?.arrayBuffer !== 'function') return file;
    const ab = await file.arrayBuffer();
    const c = await compressPdfBuffer(ab, { preset: opts.preset || DEFAULT_COMPRESSION_PRESET });
    if (c && c.bytes && c.compressed) {
      return new File([c.bytes], file.name, { type: 'application/pdf' });
    }
    return file;
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[compressFrontStep] best-effort failed:', e?.message || e);
    return file;
  }
}

// compressFilesFrontStep — застосувати фронт-крок до масиву File (для DP-комбо
// і майбутньої нарізки). Послідовно (пам'ять — рушій важкий на сторінку).
//   files → File[] (кожен стиснений якщо PDF, інакше як є).
export async function compressFilesFrontStep(files = [], opts = {}) {
  const out = [];
  const total = files.length;
  for (let i = 0; i < files.length; i++) {
    if (typeof opts.onProgress === 'function') {
      try { opts.onProgress({ stage: 'compress', index: i, total }); } catch { /* прогрес ізольований */ }
    }
    out.push(await maybeCompressFileForAdd(files[i], opts));
  }
  return out;
}
