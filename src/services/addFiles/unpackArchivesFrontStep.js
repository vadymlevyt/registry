// ── ZIP-інгест ЄСІТС · фронт-крок розпакування архівів ────────────────────
// Документи з Електронного суду приходять ZIP-архівами. Усередині — реальні
// документи (PDF/HTML/зображення) і файли електронного підпису КЕП
// (.p7s/.sig). Цей крок виконується ПЕРЕД addFiles: розгортає ZIP у складові
// файли, відкидає підписи (рішення власника: факт «підписано» зараз не
// використовується), решту віддає addFiles одним плоским списком — кожен файл
// далі піде своїм шляхом (PDF→як є, HTML/DOCX→PDF, зображення→PDF;
// стиснення/OCR — пост-кроки addFiles).
//
// Один сенс кроку (правило #11): розгортання набору з ZIP і відкидання
// КЕП-підписів. Жодного OCR, жодного стиснення, жодних метаданих —
// це наступні кроки. Single source із `documentPipeline/stages/unpack.js`:
// предикати (`isArchive`/`archiveKind`/`isSignatureFile`) і fflate-розпаковка
// (`defaultUnzipArchive`/`entryToFile`/`guessMime`) тягнуться з одного місця;
// дублювати класифікацію не можна.
//
// НЕ активує дрімаючий `createIntakeWithUnpack` як INTAKE-stage — нарізку
// (executor/run/streamingExecutor/triage/splitDocumentsV3) цим кроком НЕ
// чіпаємо. Це окремий фронт-крок над `addFiles`, не нова труба.
//
// Скоуп: лише ZIP. RAR/7z браузер не розпаковує (пропрієтарний RAR / WASM-7z
// поза скоупом MVP) — лишаються одним файлом у наборі + повідомлення для UI.
//
// Споживач (рішення власника): ТІЛЬКИ Document Processor. Модалка одно-файлова
// (форма на ОДИН документ), ZIP вибухає у багато — це не її UX; модалка
// показує підказку «Архіви додавайте через Document Processor».

import {
  isArchive,
  archiveKind,
  isSignatureFile,
  defaultUnzipArchive,
  entryToFile,
  guessMime,
} from '../documentPipeline/stages/unpack.js';

// Re-export — споживач (DP, модаль-guard, тести) тягне предикати з ОДНОГО
// модуля, щоб не імпортувати dormant `unpack.js` напряму.
export { isArchive, archiveKind, isSignatureFile };

function basename(name) {
  return String(name || '').split(/[\\/]/).pop() || '';
}

// readBytes — повертає Uint8Array з File/Blob/тестового шиму. Null = «не вдалось
// прочитати»: caller лишає архів як є (не падаємо — best-effort, документ усе
// одно має додатись через звичайний шлях).
async function readBytes(file) {
  if (!file) return null;
  if (file._bytes instanceof Uint8Array) return file._bytes;
  if (typeof file.arrayBuffer === 'function') {
    try { return new Uint8Array(await file.arrayBuffer()); } catch { return null; }
  }
  return null;
}

// unpackArchivesFrontStep — чистий фронт-крок ПЕРЕД addFiles.
//
//   files — масив File (з пристрою / Drive-пікера / їх суміш).
//
//   opts.unzipArchive(uint8) → [{name, data:Uint8Array}] — ін'єктований
//     розпакувальник (default lazy fflate; тести стабають без мережі/файлів).
//   opts.makeFile({name, data, type}) → File-like — ін'єктований конструктор
//     File (для Node-тестів, що не мають global File).
//   opts.onArchiveEntry({ name, data, mime, archive }) — ПОРОЖНІЙ гачок для
//     майбутнього HTML metadata extractor'а (spec §5: при HTML→PDF структуровані
//     метадані губляться; єдине місце дістати їх — ДО конвертації, тобто на
//     цьому кроці. Зараз — no-op; реалізацію витягу робить окремий пізніший
//     TASK, краще серверно).
//
//   Повертає { files, report } де
//     files  — плоский список File (вміст ZIP + не-архіви + RAR/7z як є);
//     report — { unpacked: [{archive, entryCount}], signaturesDropped: n,
//                archivesKept: [{name, kind, reason?}] } для тоста/діагностики.
//
// Best-effort: будь-який збій розпакування (read fail / corrupt ZIP) →
// архів лишається у наборі як один файл (звіт фіксує причину), не падаємо.
export async function unpackArchivesFrontStep(files = [], opts = {}) {
  const unzipArchive = opts.unzipArchive || defaultUnzipArchive;
  const makeFile = opts.makeFile || null;
  const onArchiveEntry = typeof opts.onArchiveEntry === 'function'
    ? opts.onArchiveEntry
    : null;

  const out = [];
  const report = { unpacked: [], signaturesDropped: 0, archivesKept: [] };

  for (const file of files) {
    if (!file) continue;

    // 1. Не-архів → passthrough незмінним (PDF/HTML/зображення/DOCX — звичайні
    //    файли, addFiles сам розрулить за типом).
    if (!isArchive(file.name, file.type)) {
      out.push(file);
      continue;
    }

    const kind = archiveKind(file.name, file.type);

    // 2. RAR/7z — не розпаковуємо. Лишаємо архів у наборі як один файл
    //    (Drive iframe покаже як є; адвокат може скачати локально). Звіт
    //    фіксує — UI покаже warning-toast.
    if (kind !== 'zip') {
      report.archivesKept.push({ name: file.name, kind });
      out.push(file);
      continue;
    }

    // 3. ZIP — розпакувати у складові файли.
    const bytes = await readBytes(file);
    if (!bytes) {
      report.archivesKept.push({ name: file.name, kind, reason: 'read_failed' });
      out.push(file);
      continue;
    }

    let entries;
    try {
      entries = await unzipArchive(bytes);
    } catch (err) {
      report.archivesKept.push({
        name: file.name, kind, reason: `unpack_failed: ${err?.message || err}`,
      });
      out.push(file);
      continue;
    }

    let kept = 0;
    for (const e of entries) {
      const name = basename(e.name);
      if (!name) continue;                       // директорія / порожній запис
      if (isSignatureFile(name)) {
        // КЕП-підпис — НЕ документ. Просто відкидаємо (рішення власника:
        // ctx.signatures[] НЕ робимо; легко додати потім окремим TASK).
        report.signaturesDropped += 1;
        continue;
      }
      const entryFile = entryToFile(name, e.data, makeFile);
      if (onArchiveEntry) {
        try {
          onArchiveEntry({
            name,
            data: e.data,
            mime: guessMime(name),
            archive: file.name,
          });
        } catch {
          // Гачок ізольований — no-op у MVP. Майбутній метадата-екстрактор
          // не має валити основний потік розпакування.
        }
      }
      out.push(entryFile);
      kept += 1;
    }
    report.unpacked.push({ archive: file.name, entryCount: kept });
  }

  return { files: out, report };
}
