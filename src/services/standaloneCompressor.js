// ── DP-3 · STANDALONE COMPRESSOR ────────────────────────────────────────────
// Окрема плюшка «Стиснути файл(и)» ПОЗА основним pipeline (§4.1 doctrine).
// Свідомо БЕЗ streaming-executor і Web Worker (один файл, один прохід рендеру;
// накладні витрати воркера тут не виправдані).
//
// TASK 4 E: рушій — РЕАЛЬНИЙ downscale (compression/imageCompressor.compressPdfBuffer:
// рендер→JPEG→pdf-lib-перебудова). Слабкий compressionService.compressPdf
// (re-save 1-2%) як «стиснення» ПРИБРАНО (доктрина: re-save не є функцією
// стиснення для адвоката). Рушій ін'єктується (Provider Pattern + тестованість
// у Node — render браузерний): дефолт = compressPdfBuffer (Середній пресет).
//
// scanned-guard вшито у рушій: searchable PDF проходить як є (skipped:true) —
// звіт чесно показує «текстовий — не стиснуто», пайплайн не падає.
//
// Ціль збереження ін'єктується:
//   • 'drive'      — у вказану Drive-папку (реальний шлях)
//   • 'download'   — локальне завантаження (браузер; ін'єкт saveLocal)
//   • 'email'      — ЗАГЛУШКА (інтеграція — майбутній TASK)
//   • 'messenger'  — ЗАГЛУШКА (інтеграція — майбутній TASK)

import { compressPdfBuffer, DEFAULT_COMPRESSION_PRESET } from './compression/imageCompressor.js';

// deps:
//   compressEngine?(arrayBuffer, {preset}) → { bytes, compressed, skipped,
//                         reason?, inBytes, outBytes } — дефолт compressPdfBuffer.
//                         Ін'єкт для тестів (Node не має canvas).
//   preset?               — пресет рушія (дефолт Середній; «Інструменти» дадуть вибір)
//   drivePort?            — { getOrCreateFolder, uploadBytes } для target 'drive'
//   saveLocal?(name,bytes)— браузерне завантаження (target 'download')
//   sendEmail?, sendMessenger? — ЗАГЛУШКИ; якщо не передані → not_implemented
export function createStandaloneCompressor(deps = {}) {
  const engine = typeof deps.compressEngine === 'function' ? deps.compressEngine : compressPdfBuffer;
  const preset = deps.preset || DEFAULT_COMPRESSION_PRESET;

  // compressOne — стиснути один файл. Повертає {name, before, after, ratio,
  // bytes, compressed, skipped}. Не кидає на guard-skip (рушій повертає вхід).
  async function compressOne(file) {
    const ab = file.arrayBuffer ? await file.arrayBuffer()
      : (file._bytes?.buffer || file._bytes || file.buffer || file);
    const before = ab.byteLength ?? ab.length ?? 0;
    const out = await engine(ab, { preset });
    const bytes = out.bytes instanceof Uint8Array ? out.bytes : new Uint8Array(out.bytes);
    const after = out.outBytes ?? bytes.byteLength;
    return {
      name: file.name || 'document.pdf',
      before: out.inBytes ?? before,
      after,
      ratio: before > 0 ? Number((after / before).toFixed(3)) : 1,
      compressed: out.compressed === true,
      skipped: out.skipped === true,
      reason: out.reason || null,
      bytes,
    };
  }

  // saveTo — куди покласти стиснений результат. Один сенс на target.
  async function saveTo(target, result, options = {}) {
    if (target === 'drive') {
      if (!deps.drivePort) return { saved: false, reason: 'no_drive_port' };
      const folderId = options.folderId
        || (await deps.drivePort.getOrCreateFolder(options.folderName || '05_ЗОВНІШНІ', options.parentId || null)).id;
      const up = await deps.drivePort.uploadBytes(folderId, result.name, result.bytes, 'application/pdf');
      return { saved: true, target: 'drive', driveId: up.id };
    }
    if (target === 'download') {
      if (typeof deps.saveLocal !== 'function') return { saved: false, reason: 'no_local_saver' };
      await deps.saveLocal(result.name, result.bytes);
      return { saved: true, target: 'download' };
    }
    if (target === 'email') {
      if (typeof deps.sendEmail !== 'function') return { saved: false, reason: 'not_implemented', stub: true };
      await deps.sendEmail({ name: result.name, bytes: result.bytes, ...options });
      return { saved: true, target: 'email' };
    }
    if (target === 'messenger') {
      if (typeof deps.sendMessenger !== 'function') return { saved: false, reason: 'not_implemented', stub: true };
      await deps.sendMessenger({ name: result.name, bytes: result.bytes, ...options });
      return { saved: true, target: 'messenger' };
    }
    return { saved: false, reason: `unknown_target:${target}` };
  }

  // compress — публічний вхід. files: File[]|[{name,arrayBuffer|_bytes}].
  // target+options куди зберегти. Повертає по-файловий звіт (з compressed/skipped).
  async function compress(files, { target = 'download', options = {} } = {}) {
    const list = Array.isArray(files) ? files : [files];
    const reports = [];
    for (const f of list) {
      try {
        const result = await compressOne(f);
        const save = await saveTo(target, result, options);
        reports.push({
          name: result.name, before: result.before, after: result.after, ratio: result.ratio,
          compressed: result.compressed, skipped: result.skipped, reason: result.reason,
          ...save,
        });
      } catch (err) {
        reports.push({ name: f.name || 'document.pdf', saved: false, error: err?.message || String(err) });
      }
    }
    return { count: reports.length, target, reports };
  }

  return { compress, compressOne };
}
