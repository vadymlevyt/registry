// ── DP-2 STAGE · UNPACK + SIDECAR + KEP-SIGNATURE FILTER ─────────────────────
// Перша надбудова на pipeline-фундамент DP-1. Підключається через
// deps.stageOverrides[STAGE.INTAKE] — диригент documentPipeline.js НЕ
// змінюється (його DEFAULT_STAGE_ORDER заморожений рівно на 9 стадіях, а
// unpack має відпрацювати ДО convert; intake — перша стадія, тому unpack
// логічно лягає саме в override intake як «нормалізація вводу job+files»:
// архів — це згорнутий набір файлів, розгортання набору і є нормалізація).
//
// Один сенс кожної дії (правило #11):
//   • валідація job/files     — точна копія поведінки дефолтного intakeStage
//                               (NO_CASE / NO_FILES), щоб override не регресував.
//   • unpack                  — ZIP розпаковується у складові файли; RAR/7z
//                               детектуються, НЕ розпаковуються (зберігаються
//                               як оригінал) + повідомлення.
//   • signature filter        — .p7s/.sig відкладаються у ctx.signatures[],
//                               прив'язані до основних файлів, далі по
//                               pipeline НЕ йдуть (підпис КЕП — не документ).
//   • sidecar                 — metadataSidecar.json (у архіві або поряд)
//                               читається/валідовується у ctx.metadataSidecar.
//
// Чиста стадія: жодного Drive/executeAction/React. Розпакування ZIP —
// ін'єктований deps.unzipArchive (за замовчуванням lazy-import fflate, щоб
// бібліотека не тягнулась у бандл доки реально не треба і щоб тести
// підставляли стаб без мережі/файлів).

const ARCHIVE_EXT = /\.(zip|rar|7z)$/i;
const SIGNATURE_EXT = /\.(p7s|sig)$/i;
const SIDECAR_BASENAME = 'metadatasidecar.json';

const ARCHIVE_MIME = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/x-zip',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/x-rar',
  'application/x-7z-compressed',
]);

function basename(name) {
  return String(name || '').split(/[\\/]/).pop() || '';
}

// Один сенс: чи це файл-архів (за розширенням АБО MIME). Не вирішує який саме.
export function isArchive(name, type) {
  return ARCHIVE_EXT.test(String(name || '')) || ARCHIVE_MIME.has(String(type || '').toLowerCase());
}

// Один сенс: тип архіву ('zip' розпаковуємо, 'rar'/'7z' — ні). null якщо не архів.
export function archiveKind(name, type) {
  const n = String(name || '').toLowerCase();
  const t = String(type || '').toLowerCase();
  if (/\.zip$/.test(n) || t === 'application/zip' || t === 'application/x-zip-compressed' || t === 'application/x-zip') return 'zip';
  if (/\.rar$/.test(n) || t === 'application/x-rar-compressed' || t === 'application/vnd.rar' || t === 'application/x-rar') return 'rar';
  if (/\.7z$/.test(n) || t === 'application/x-7z-compressed') return '7z';
  return null;
}

// Один сенс: чи це відокремлений підпис КЕП (.p7s/.sig) — не документ.
export function isSignatureFile(name) {
  return SIGNATURE_EXT.test(String(name || ''));
}

// Один сенс: чи це sidecar ЄСІТС-метаданих (точна назва metadataSidecar.json).
export function isSidecarFile(name) {
  return basename(name).toLowerCase() === SIDECAR_BASENAME;
}

const EXT_MIME = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  html: 'text/html', htm: 'text/html',
  txt: 'text/plain', json: 'application/json',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  heic: 'image/heic', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff',
};

function guessMime(name) {
  const ext = basename(name).split('.').pop()?.toLowerCase();
  return EXT_MIME[ext] || 'application/octet-stream';
}

// Прочитати байти з раніше нормалізованого file-item (browser File / Blob,
// або тестовий стаб з ._bytes). Повертає Uint8Array або null.
async function readBytes(raw) {
  if (!raw) return null;
  if (raw._bytes instanceof Uint8Array) return raw._bytes;
  if (typeof raw.arrayBuffer === 'function') {
    try { return new Uint8Array(await raw.arrayBuffer()); } catch { return null; }
  }
  if (raw instanceof Uint8Array) return raw;
  return null;
}

// Зібрати file-like об'єкт із розпакованого запису. Браузер — справжній File
// (converterService очікує File/Blob); поза браузером — легкий сумісний шим
// (._bytes + .arrayBuffer), якого досить downstream-стадіям/тестам.
function entryToFile(name, data, makeFile) {
  const type = guessMime(name);
  if (typeof makeFile === 'function') return makeFile({ name, data, type });
  if (typeof File !== 'undefined') {
    try { return new File([data], basename(name), { type }); } catch { /* fallthrough */ }
  }
  return {
    name: basename(name),
    size: data?.length || 0,
    type,
    _bytes: data,
    arrayBuffer: async () => (data?.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data),
  };
}

// Дефолтний розпакувальник ZIP — lazy-import fflate (як html2pdf/jspdf/heic2any
// у converterService: важка залежність не в основному бандлі). Повертає
// [{ name, data:Uint8Array }] без директорій.
async function defaultUnzipArchive(uint8) {
  const { unzip } = await import('fflate');
  const map = await new Promise((resolve, reject) => {
    unzip(uint8, (err, unzipped) => (err ? reject(err) : resolve(unzipped)));
  });
  const out = [];
  for (const [name, data] of Object.entries(map)) {
    if (name.endsWith('/')) continue;            // директорія
    out.push({ name, data });
  }
  return out;
}

function validateSidecar(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, error: 'sidecar має бути JSON-об\'єктом' };
  }
  // М'яка валідація: source/ecitsContext опційні, але якщо source задано —
  // має бути рядком (узгоджено з document.source enum, перевірку enum робить
  // споживач/ACTION, не sidecar-парсер — один сенс).
  if (parsed.source != null && typeof parsed.source !== 'string') {
    return { valid: false, error: 'sidecar.source має бути рядком' };
  }
  return { valid: true, value: parsed };
}

function parseSidecarBytes(data) {
  try {
    const text = new TextDecoder('utf-8').decode(data);
    return validateSidecar(JSON.parse(text));
  } catch (e) {
    return { valid: false, error: `sidecar JSON parse: ${e?.message || e}` };
  }
}

export { parseSidecarBytes };

// Фабрика стадії (DI, як createDocumentPipeline/createActions). Повертає
// async (ctx, deps) → StageResult сумісний з контрактом диригента DP-1.
//
// deps (опційно): unzipArchive(uint8)→[{name,data}], makeFile({name,data,type}).
export function createIntakeWithUnpack(stageDeps = {}) {
  const unzipArchive = stageDeps.unzipArchive || defaultUnzipArchive;
  const makeFile = stageDeps.makeFile || null;

  return async function intakeWithUnpack(ctx) {
    // 1. Валідація — поведінка дефолтного intakeStage збережена дослівно.
    if (!ctx.job?.caseId) {
      return { ok: false, error: { code: 'NO_CASE', message: "caseId обов'язковий", fatal: true } };
    }
    if (!Array.isArray(ctx.files) || ctx.files.length === 0) {
      return { ok: false, error: { code: 'NO_FILES', message: 'Немає файлів для обробки', fatal: true } };
    }

    const decisions = [];
    const expanded = [];

    // 2. Розгортання архівів. Не-архів → passthrough незмінним.
    for (const item of ctx.files) {
      if (item.skipped || !isArchive(item.name, item.type)) {
        expanded.push(item);
        continue;
      }
      const kind = archiveKind(item.name, item.type);
      if (kind !== 'zip') {
        // RAR/7z свідомо не розпаковуємо (пропрієтарний RAR / WASM-7z поза
        // обсягом базової реалізації). Зберігаємо архів як оригінал, далі по
        // pipeline він піде як звичайний файл (Drive iframe покаже як є).
        const msg = `Архів ${kind?.toUpperCase() || '?'} поки не розпаковується — збережено як оригінал`;
        expanded.push({ ...item, warnings: [...(item.warnings || []), msg] });
        decisions.push({
          type: 'archive_not_unpacked',
          fileId: item.fileId,
          archive: item.name,
          kind,
          message: msg,
        });
        continue;
      }

      const bytes = await readBytes(item.raw);
      if (!bytes) {
        return {
          ok: false,
          error: {
            code: 'ARCHIVE_READ_FAILED',
            message: `Не вдалось прочитати архів ${item.name}`,
            file_skipped: true,
            fileId: item.fileId,
          },
        };
      }

      let entries;
      try {
        entries = await unzipArchive(bytes);
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'UNPACK_FAILED',
            message: `Не вдалось розпакувати ${item.name}: ${err?.message || err}`,
            file_skipped: true,
            fileId: item.fileId,
          },
        };
      }

      let idx = 0;
      for (const e of entries) {
        const name = basename(e.name);
        if (!name) continue;
        expanded.push({
          fileId: `${item.fileId}::${idx++}`,
          raw: entryToFile(name, e.data, makeFile),
          isDriveSource: false,
          driveId: null,
          originalDriveId: null,
          originalMime: null,
          name,
          size: e.data?.length || 0,
          type: guessMime(name),
          metadataTemplate: { ...(item.metadataTemplate || {}) },
          mergeArtifacts: null,
          extendedMetadata: null,
          warnings: [],
          skipped: false,
          skipReason: null,
          unpackedFrom: item.name,
        });
      }
      decisions.push({
        type: 'archive_unpacked',
        fileId: item.fileId,
        archive: item.name,
        kind: 'zip',
        entryCount: entries.length,
      });
    }

    // 3. Витягнути sidecar (у архіві або поряд) — окремий канал метаданих.
    const signatures = [];
    const files = [];
    let metadataSidecar = ctx.metadataSidecar || null;

    for (const item of expanded) {
      if (isSidecarFile(item.name)) {
        const data = await readBytes(item.raw);
        const res = data ? parseSidecarBytes(data) : { valid: false, error: 'порожній sidecar' };
        if (res.valid) {
          metadataSidecar = res.value;
          decisions.push({ type: 'metadata_sidecar_loaded', source: res.value.source ?? null });
        } else {
          decisions.push({ type: 'metadata_sidecar_invalid', message: res.error });
        }
        continue;                                 // sidecar далі по pipeline НЕ йде
      }
      // 4. Відкласти підписи КЕП — не документи, далі НЕ йдуть.
      if (isSignatureFile(item.name)) {
        const data = await readBytes(item.raw);
        signatures.push({
          name: item.name,
          size: item.size,
          data: data || null,
          // Прив'язка до основного файлу: doc.pdf.p7s / doc.p7s → doc.pdf.
          linkedToName: item.name.replace(SIGNATURE_EXT, ''),
        });
        continue;
      }
      files.push(item);
    }

    if (signatures.length > 0) {
      // Прив'язати кожен підпис до основного файлу за базовою назвою.
      for (const sig of signatures) {
        const target = files.find(f => f.name === sig.linkedToName)
          || files.find(f => f.name.replace(/\.[^.]+$/, '') === sig.linkedToName.replace(/\.[^.]+$/, ''));
        sig.linkedToFileId = target?.fileId || null;
      }
      decisions.push({
        type: 'kep_signatures_detected',
        count: signatures.length,
        items: signatures.map(s => ({ name: s.name, linkedToFileId: s.linkedToFileId })),
      });
    }

    if (files.length === 0) {
      return {
        ok: false,
        error: {
          code: 'NO_FILES',
          message: 'Після розпакування не лишилось файлів для обробки',
          fatal: true,
        },
      };
    }

    return {
      ok: true,
      ctx: { ...ctx, files, metadataSidecar, signatures },
      ...(decisions.length > 0 ? { decisions } : {}),
    };
  };
}
